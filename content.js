// Read Aloud with Highlight - content script.
//
// Injected into every page (see manifest.json). It reads the current selection
// aloud, or the main article when nothing is selected, using the browser's
// built-in Web Speech API.
//
// Privacy note: this script never sends page content anywhere. All speech is
// produced locally by speechSynthesis.

// Prevent multiple injections. The popup injects this file manually when a page
// was already open before the extension was installed.
if (!window.readAloudExtensionLoaded) {
  window.readAloudExtensionLoaded = true;

  // Pure logic lives in lib/core.js, which this file expects to be loaded first
  // (see manifest.json and lib/core.js for the unit tests that cover it).
  const core = window.ReadAloudCore;

  // Tunables -----------------------------------------------------------------
  const DEBUG = false; // set to true to get verbose logging in the page console
  const VOICES_TIMEOUT_MS = 1500; // stop waiting for the 'voiceschanged' event
  const SPEAK_DELAY_MS = 150; // Chrome can drop an utterance queued right after cancel()
  const KEEP_ALIVE_MS = 10000; // Chrome bug workaround: long speech dies after ~15s
  const BOUNDARY_CHECK_MS = 2000; // detect voices that never fire boundary events
  const TOAST_TIMEOUT_MS = 6000;

  // Speech state -------------------------------------------------------------
  let isReading = false;
  let isPaused = false;
  let pausedByVisibility = false;
  let currentSettings = {};
  let originalSelection = null;
  let originalText = ''; // Original text, used to map speech offsets back to the page
  let lastMatchOffset = -1; // Position of the last matched word in the page text
  let speechSession = 0; // Invalidates callbacks from an older utterance

  // Exact map from offsets in originalText to text nodes on the page. Building
  // it once per reading is what stops repeated text on the page from dragging
  // the highlight (and the viewport) to the wrong copy.
  let rangeEntries = [];
  let rangeAdjust = 0;
  let lastScrollTarget = null;

  // Last selection seen by the page (opening the popup clears the live one)
  let lastValidRange = null;
  let lastValidText = '';

  // Chunked speech state (only used for very long texts) ----------------------
  let speechChunks = []; // [{ text, start }] - start is an offset inside originalText
  let keepAliveInterval = null;
  let boundaryCheckTimeout = null;
  let boundaryEventFired = false;
  let voiceLoadTimeout = null;
  let toastTimeout = null;

  let floatingHighlight = null;

  const log = DEBUG ? console.log.bind(console, '[Read Aloud]') : () => {};
  const warn = console.warn.bind(console, '[Read Aloud]');

  // Helpers ------------------------------------------------------------------

  function clearSpeechTimers() {
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
    }
    if (boundaryCheckTimeout) {
      clearTimeout(boundaryCheckTimeout);
      boundaryCheckTimeout = null;
    }
    if (voiceLoadTimeout) {
      clearTimeout(voiceLoadTimeout);
      voiceLoadTimeout = null;
    }
  }

  /** Cancels speech and every pending timer, without touching highlights. */
  function cancelSpeech() {
    speechSession++; // All callbacks of the previous utterance become no-ops
    try {
      speechSynthesis.cancel();
    } catch (e) {
      warn('Could not cancel speech:', e);
    }
    clearSpeechTimers();
    isReading = false;
    isPaused = false;
  }

  /** Small non-blocking message shown inside the page (it never blocks the UI). */
  function showToast(message) {
    try {
      const host = document.body || document.documentElement;
      if (!host) return;

      let toast = document.getElementById('read-aloud-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'read-aloud-toast';
        toast.setAttribute('role', 'status');
        host.appendChild(toast);
      }
      toast.textContent = message;

      if (toastTimeout) clearTimeout(toastTimeout);
      toastTimeout = setTimeout(() => {
        toastTimeout = null;
        try {
          if (toast.parentNode) toast.parentNode.removeChild(toast);
        } catch (_e) {
          /* the page navigated away */
        }
      }, TOAST_TIMEOUT_MS);
    } catch (e) {
      warn('Could not show the on-page message:', e);
    }
  }

  function isExtensionContextValid() {
    try {
      return Boolean(chrome?.runtime?.id);
    } catch (_e) {
      return false;
    }
  }

  function notifyPopup(message) {
    if (!isExtensionContextValid()) return;
    try {
      const result = chrome.runtime.sendMessage(message);
      if (result && typeof result.catch === 'function') {
        result.catch(() => {}); // The popup is usually closed while reading
      }
    } catch (e) {
      log('Could not notify the popup:', e);
    }
  }

  function getVoices() {
    try {
      return speechSynthesis.getVoices() || [];
    } catch (_e) {
      return [];
    }
  }

  // Selection handling -------------------------------------------------------

  document.addEventListener('selectionchange', () => {
    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        // Stored untrimmed: these offsets have to match the range exactly.
        const text = sel.toString();
        if (core.isReadableText(text)) {
          lastValidRange = sel.getRangeAt(0).cloneRange();
          lastValidText = text;
        }
      }
    } catch (e) {
      log('Could not track the selection:', e);
    }
  });

  /**
   * Picks the best container to read when the user selected nothing.
   * Returns a Range, or null when the page has no obvious article.
   */
  function extractMainContent() {
    try {
      if (!document.body) return null;

      // 1. Semantic tags
      const semanticTags = ['article', 'main'];
      for (const tag of semanticTags) {
        const elements = document.getElementsByTagName(tag);
        if (elements.length === 0) continue;

        let bestElement = elements[0];
        let maxLen = (bestElement.textContent || '').trim().length;
        for (let i = 1; i < elements.length; i++) {
          const len = (elements[i].textContent || '').trim().length;
          if (len > maxLen) {
            maxLen = len;
            bestElement = elements[i];
          }
        }

        if (maxLen > 200) {
          const range = document.createRange();
          range.selectNodeContents(bestElement);
          return range;
        }
      }

      // 2. Score containers based on paragraph content
      const paragraphs = document.getElementsByTagName('p');
      if (paragraphs.length === 0) return null;

      const containers = new Map();

      for (const p of paragraphs) {
        const textLen = (p.textContent || '').trim().length;
        if (textLen < 20) continue; // Skip very short paragraphs

        let parent = p.parentElement;
        let depth = 0;
        while (parent && parent.tagName !== 'BODY' && depth < 4) {
          const tag = parent.tagName.toLowerCase();
          const className = (parent.className || '').toString().toLowerCase();
          const id = (parent.id || '').toLowerCase();

          // Skip common non-article containers
          if (['nav', 'footer', 'aside', 'header'].includes(tag)) break;
          if (
            className.includes('comment') ||
            className.includes('sidebar') ||
            className.includes('menu') ||
            className.includes('footer') ||
            id.includes('comment') ||
            id.includes('sidebar') ||
            id.includes('menu')
          ) {
            break;
          }

          containers.set(parent, (containers.get(parent) || 0) + textLen);

          parent = parent.parentElement;
          depth++;
        }
      }

      let bestContainer = null;
      let maxScore = 0;

      for (const [node, score] of containers.entries()) {
        if (score > maxScore) {
          maxScore = score;
          bestContainer = node;
        }
      }

      if (bestContainer && maxScore > 200) {
        const range = document.createRange();
        range.selectNodeContents(bestContainer);
        return range;
      }

      return null;
    } catch (e) {
      warn('Could not detect the main article:', e);
      return null;
    }
  }

  /**
   * Resolves the text to read plus the range it came from.
   * Order: live selection > last known selection > selection captured by the
   * popup > main article of the page.
   */
  function resolveSelection(selectionData) {
    const selection = window.getSelection();
    // The text is kept exactly as the range reports it. Trimming it would shift
    // every offset by the number of removed characters and the highlight would
    // land one word early on long selections.
    let text = selection ? selection.toString() : '';
    let range = null;

    if (core.isReadableText(text) && selection && selection.rangeCount > 0) {
      try {
        range = selection.getRangeAt(0).cloneRange();
      } catch (_e) {
        range = null;
      }
    } else if (core.isReadableText(lastValidText) && lastValidRange) {
      text = lastValidText;
      try {
        range = lastValidRange.cloneRange();
      } catch (_e) {
        range = null; // The page changed since that selection was made
      }
      log('Using the last selection tracked by the content script');
    } else if (
      selectionData &&
      typeof selectionData.text === 'string' &&
      core.isReadableText(selectionData.text)
    ) {
      text = selectionData.text;
      log('Using the selection captured by the popup');
    }

    if (!core.isReadableText(text)) {
      text = '';
      const articleRange = extractMainContent();
      if (articleRange) {
        range = articleRange;
        text = articleRange.toString() || '';
        log('Using the main article of the page');
      }
    }

    return { text: text, range: range };
  }

  /**
   * Inserts a hidden marker at the start of the selection so highlighting can
   * find the right place on the page. Safe to fail: everything still works
   * without it (highlighting then falls back to a plain text search).
   */
  function insertSelectionMarker(range) {
    try {
      if (!document.body) return;

      const marker = document.createElement('span');
      marker.id = 'read-aloud-selection-marker';
      marker.style.cssText = 'display: none !important;';
      marker.setAttribute('data-read-aloud-text', originalText.substring(0, 200));

      if (range) {
        const startRange = range.cloneRange();
        startRange.collapse(true); // Collapse to the start of the selection
        startRange.insertNode(marker);
      } else {
        document.body.insertBefore(marker, document.body.firstChild);
      }
    } catch (e) {
      // A page that rejects DOM changes must not break reading.
      log('Could not insert the selection marker:', e);
    }
  }

  // Speech -------------------------------------------------------------------

  function startKeepAlive(session) {
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    keepAliveInterval = setInterval(() => {
      if (session !== speechSession) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
        return;
      }
      try {
        // Chrome stops long utterances after ~15 seconds unless it is nudged.
        if (isReading && !isPaused && speechSynthesis.speaking) {
          speechSynthesis.pause();
          speechSynthesis.resume();
        }
      } catch (e) {
        log('Keep-alive nudge failed:', e);
      }
    }, KEEP_ALIVE_MS);
  }

  function resetSpeechState() {
    clearSpeechTimers();
    isReading = false;
    isPaused = false;
    pausedByVisibility = false;
    speechChunks = [];
    rangeEntries = [];
    rangeAdjust = 0;
    lastScrollTarget = null;
  }

  function finishReading(session) {
    if (session !== speechSession) return;
    resetSpeechState();
    removeHighlight();
    log('Speech finished');
    notifyPopup({ action: 'readingComplete' });
  }

  function handleSpeechError(event, session) {
    if (session !== speechSession) return;

    resetSpeechState();
    removeHighlight();

    const error = event?.error ? event.error : 'unknown';

    // Expected: the user pressed stop, or a new reading replaced this one.
    if (error === 'interrupted' || error === 'canceled') {
      log('Speech stopped');
      return;
    }

    if (error === 'not-allowed') {
      showToast('Read Aloud needs a click on the page before it can speak.');
    } else if (error === 'network') {
      showToast(
        'Network error while loading the voice. Try another voice or check your connection.'
      );
    } else if (error === 'audio-busy' || error === 'audio-hardware') {
      showToast('Your audio device is busy. Close other audio apps and try again.');
    } else {
      warn('Speech error:', error);
      showToast('Reading stopped: ' + error);
    }

    notifyPopup({ action: 'readingComplete' });
  }

  /**
   * Starts reading. Returns true when speech was queued, otherwise an error
   * code that the popup turns into a readable message.
   */
  function startReading(rawSettings, selectionData) {
    if (!core) {
      warn('lib/core.js is missing, so reading cannot start');
      return 'unsupported';
    }

    if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') {
      return 'unsupported';
    }

    currentSettings = core.normalizeSettings(rawSettings);

    const resolved = resolveSelection(selectionData);
    const text = resolved.text;

    if (!core.isReadableText(text)) {
      return 'no-text';
    }

    cancelSpeech();
    removeHighlight();

    originalText = text;
    lastMatchOffset = -1;
    lastScrollTarget = null;
    boundaryEventFired = false;
    speechChunks = core.buildSpeechChunks(text);
    if (speechChunks.length > 1) {
      log('Split the text into', speechChunks.length, 'parts for reliable playback');
    }

    originalSelection = resolved.range ? resolved.range.cloneRange() : null;
    // Build the offset map before the marker is inserted, so the map describes
    // exactly the text the user selected.
    prepareHighlightMap(originalSelection);
    insertSelectionMarker(resolved.range);

    const session = speechSession;

    const speakChunk = (index) => {
      if (session !== speechSession) return;
      if (index < 0 || index >= speechChunks.length) return;

      const chunk = speechChunks[index];

      let chunkUtterance;
      try {
        chunkUtterance = new SpeechSynthesisUtterance(chunk.text);
      } catch (e) {
        warn('Could not create the utterance:', e);
        handleSpeechError({ error: 'synthesis-failed' }, session);
        return;
      }

      chunkUtterance.rate = currentSettings.rate;
      chunkUtterance.pitch = currentSettings.pitch;

      if (currentSettings.voice) {
        const voice = getVoices().find((v) => v.name === currentSettings.voice);
        if (voice) {
          chunkUtterance.voice = voice;
        } else if (index === 0) {
          warn(
            'This voice is not available here, using the browser default:',
            currentSettings.voice
          );
        }
      }

      chunkUtterance.onboundary = (event) => {
        if (session !== speechSession) return;
        boundaryEventFired = true;
        if (event.name === 'word' || event.name === 'sentence') {
          highlightWordAtIndex(chunk.start + event.charIndex, event.charLength || 1);
        }
      };

      chunkUtterance.onstart = () => {
        if (session !== speechSession) return;
        isReading = true;
        startKeepAlive(session);

        // Several online voices never fire boundary events. Detect that once
        // and highlight the selection instead of showing nothing at all.
        if (index === 0 && !boundaryEventFired) {
          if (boundaryCheckTimeout) clearTimeout(boundaryCheckTimeout);
          boundaryCheckTimeout = setTimeout(() => {
            boundaryCheckTimeout = null;
            if (session !== speechSession || boundaryEventFired) return;
            if (isReading) {
              log('This voice does not report word boundaries');
              highlightEntireSelection();
            }
          }, BOUNDARY_CHECK_MS);
        }
      };

      chunkUtterance.onend = () => {
        if (session !== speechSession) return;
        if (index + 1 < speechChunks.length) {
          speakChunk(index + 1);
        } else {
          finishReading(session);
        }
      };

      chunkUtterance.onerror = (event) => handleSpeechError(event, session);

      try {
        isReading = true;
        speechSynthesis.speak(chunkUtterance);
      } catch (e) {
        warn('Could not start speech:', e);
        handleSpeechError({ error: 'synthesis-failed' }, session);
      }
    };

    const applyVoiceAndSpeak = () => {
      if (session !== speechSession) return;
      // Chrome can ignore an utterance queued in the same tick as cancel().
      setTimeout(() => {
        if (session === speechSession) speakChunk(0);
      }, SPEAK_DELAY_MS);
    };

    if (getVoices().length === 0) {
      // Chrome loads the voice list asynchronously.
      let voicesSettled = false;

      const onVoicesChanged = () => {
        if (voicesSettled) return;
        voicesSettled = true;
        try {
          speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
        } catch (_e) {
          /* ignore */
        }
        if (voiceLoadTimeout) {
          clearTimeout(voiceLoadTimeout);
          voiceLoadTimeout = null;
        }
        applyVoiceAndSpeak();
      };

      try {
        speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
      } catch (e) {
        warn('Could not listen for voice changes:', e);
      }

      voiceLoadTimeout = setTimeout(() => {
        voiceLoadTimeout = null;
        if (voicesSettled) return;
        log('The voice list did not load in time, using the browser default');
        onVoicesChanged();
      }, VOICES_TIMEOUT_MS);
    } else {
      applyVoiceAndSpeak();
    }

    return true;
  }

  function pauseReading() {
    if (!isReading) return false;
    try {
      if (!speechSynthesis.paused) speechSynthesis.pause();
      isPaused = true;
      return true;
    } catch (e) {
      warn('Could not pause:', e);
      return false;
    }
  }

  function resumeReading() {
    if (!isReading) return false;
    try {
      if (speechSynthesis.paused) speechSynthesis.resume();
      isPaused = false;
      return true;
    } catch (e) {
      warn('Could not resume:', e);
      return false;
    }
  }

  function stopReading() {
    cancelSpeech();
    removeHighlight();
    lastMatchOffset = -1;
    originalSelection = null;
    log('Stopped');
  }

  // Highlighting -------------------------------------------------------------

  /** True for text nodes the extension itself created. */
  function isOwnElement(element) {
    return (
      element?.id === 'read-aloud-selection-marker' ||
      element?.id === 'read-aloud-floating-highlight' ||
      element?.id === 'read-aloud-toast'
    );
  }

  /**
   * Describes the text nodes of a range as contiguous offsets:
   *   [{ node, start, end, dataStart }]
   * Concatenating every entry reproduces range.toString(), which is exactly the
   * text that is spoken, so an offset in the spoken text maps to one place on
   * the page - no searching, and no ambiguity when the same sentence appears
   * several times.
   */
  function buildRangeMap(range) {
    try {
      const root = range.commonAncestorContainer;
      const walkRoot = root?.nodeType === Node.TEXT_NODE ? root.parentNode : root;
      if (!walkRoot) return null;

      const walker = document.createTreeWalker(walkRoot, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          if (isOwnElement(node.parentElement)) return NodeFilter.FILTER_REJECT;
          return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });

      const entries = [];
      let position = 0;
      let node = walker.nextNode();

      while (node) {
        const data = node.textContent || '';
        let from = 0;
        let to = data.length;

        // The range may start or end inside a text node.
        if (node === range.startContainer) from = Math.min(range.startOffset, data.length);
        if (node === range.endContainer) to = Math.min(range.endOffset, data.length);

        if (to > from) {
          entries.push({
            node: node,
            start: position,
            end: position + (to - from),
            dataStart: from
          });
          position += to - from;
        }
        node = walker.nextNode();
      }

      return entries.length > 0 ? entries : null;
    } catch (e) {
      log('Could not map the selection onto the page:', e);
      return null;
    }
  }

  function concatEntries(entries) {
    let text = '';
    for (const entry of entries) {
      const data = entry.node.textContent || '';
      text += data.slice(entry.dataStart, entry.dataStart + (entry.end - entry.start));
    }
    return text;
  }

  /**
   * Prepares the offset map for a reading. The mapped text and the spoken text
   * normally match character for character; when they do not (for example when
   * the browser includes a few extra characters at the edges) the difference is
   * measured once as `rangeAdjust` instead of being guessed per word.
   */
  function prepareHighlightMap(range) {
    rangeEntries = [];
    rangeAdjust = 0;
    if (!range || !originalText) return;

    const entries = buildRangeMap(range);
    if (!entries) return;

    const mapped = concatEntries(entries);
    if (mapped === originalText) {
      rangeEntries = entries;
      return;
    }

    // The spoken text is a slice of the mapped text, or the other way round.
    const insideSpoken = originalText.indexOf(mapped);
    if (insideSpoken !== -1) {
      rangeEntries = entries;
      rangeAdjust = -insideSpoken;
      return;
    }

    const insideMapped = mapped.indexOf(originalText);
    if (insideMapped !== -1) {
      rangeEntries = entries;
      rangeAdjust = insideMapped;
      return;
    }

    log('The page changed since the text was selected, falling back to a search');
  }

  /**
   * Maps an offset (and length) in the spoken text onto concrete DOM positions.
   * Extends across text nodes so a word split by inline markup stays together.
   */
  function mapRangePosition(position, length) {
    const start = core.findTextPosition(rangeEntries, position);
    if (!start) return null;

    const startEntry = rangeEntries[start.index];
    if (!startEntry.node.isConnected) return null;

    const endPosition = position + Math.max(1, length) - 1;
    let end = core.findTextPosition(rangeEntries, endPosition);
    if (!end) {
      const last = rangeEntries[rangeEntries.length - 1];
      end = { index: rangeEntries.length - 1, offsetInEntry: last.end - last.start - 1 };
    }

    const endEntry = rangeEntries[end.index];
    if (!endEntry.node.isConnected) return null;

    const startOffset = startEntry.dataStart + start.offsetInEntry;
    let endOffset = endEntry.dataStart + end.offsetInEntry + 1;

    if (endEntry.node === startEntry.node && endOffset <= startOffset) {
      endOffset = Math.min(startOffset + 1, (startEntry.node.textContent || '').length);
    }

    return {
      startNode: startEntry.node,
      startOffset: startOffset,
      endNode: endEntry.node,
      endOffset: endOffset
    };
  }

  function prefersReducedMotion() {
    try {
      return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    } catch {
      return false;
    }
  }

  /**
   * Paints the highlight box over a DOM range and returns its viewport rect,
   * or null when the target is not visible.
   */
  function drawHighlightRange(startNode, startOffset, endNode, endOffset) {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    if (endNode === startNode) {
      range.setEnd(startNode, Math.max(startOffset, endOffset));
    } else {
      range.setEnd(endNode, endOffset);
    }

    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return null;

    if (floatingHighlight?.parentNode) floatingHighlight.remove();

    floatingHighlight = document.createElement('div');
    floatingHighlight.id = 'read-aloud-floating-highlight';
    floatingHighlight.style.cssText =
      [
        'position: absolute',
        'pointer-events: none',
        'z-index: 2147483646',
        'left: ' + (rect.left + window.scrollX) + 'px',
        'top: ' + (rect.top + window.scrollY) + 'px',
        'width: ' + rect.width + 'px',
        'height: ' + rect.height + 'px'
      ].join(' !important; ') + ' !important;';

    document.body.appendChild(floatingHighlight);
    return rect;
  }

  /**
   * Keeps the spoken word on screen. lib/core.js decides *whether* to move and
   * where; this only performs the scroll. A word that is already visible never
   * moves the page, which is what removes the bouncing.
   */
  function followWord(rect) {
    const height = window.innerHeight || document.documentElement?.clientHeight || 0;
    const plan = core.planScroll(rect, { height: height }, window.scrollY || 0);
    if (!plan.scroll) return;

    // A smooth scroll may still be running towards the same place.
    if (lastScrollTarget !== null && core.isSameScrollTarget(plan.top, lastScrollTarget)) return;

    lastScrollTarget = plan.top;
    try {
      window.scrollTo({ top: plan.top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    } catch (e) {
      log('Could not scroll to the word:', e);
    }
  }

  /**
   * Draws a highlight box over the word that is being spoken.
   * charIndex is an offset into originalText.
   */
  function highlightWordAtIndex(charIndex, charLength) {
    if (!originalText || !document.body) return;

    const word = originalText.substring(charIndex, charIndex + charLength);
    if (!word.trim()) return; // Skip whitespace and empty boundary events

    // Exact path: the selection is mapped, so the offset points at one place.
    if (rangeEntries.length > 0) {
      const target = mapRangePosition(charIndex + rangeAdjust, charLength);
      if (target) {
        const rect = drawHighlightRange(
          target.startNode,
          target.startOffset,
          target.endNode,
          target.endOffset
        );
        if (rect) {
          followWord(rect);
          return;
        }
      }
      // The page changed under the reading: rebuild the map once and retry.
      prepareHighlightMap(originalSelection);
      const retry = mapRangePosition(charIndex + rangeAdjust, charLength);
      if (retry) {
        const rect = drawHighlightRange(
          retry.startNode,
          retry.startOffset,
          retry.endNode,
          retry.endOffset
        );
        if (rect) {
          followWord(rect);
          return;
        }
      }
    }

    try {
      const searchText = word.trim();

      // Collect every visible text node together with its offset, skipping
      // scripts, styles and our own helper elements.
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

          const tagName = parent.tagName.toLowerCase();
          if (tagName === 'script' || tagName === 'style' || tagName === 'noscript') {
            return NodeFilter.FILTER_REJECT;
          }
          if (
            parent.id === 'read-aloud-selection-marker' ||
            parent.id === 'read-aloud-floating-highlight' ||
            parent.id === 'read-aloud-toast'
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });

      let allText = '';
      const textNodeMap = [];
      let node = walker.nextNode();

      while (node) {
        const startPos = allText.length;
        allText += node.textContent;
        textNodeMap.push({ node: node, startPos: startPos, endPos: allText.length });
        node = walker.nextNode();
      }

      if (!allText) return;

      // Find where the selection marker sits inside the collected text.
      let selectionMarkerOffset = 0;
      const marker = document.getElementById('read-aloud-selection-marker');
      if (marker?.parentNode) {
        const nextNode = marker.nextSibling;
        if (nextNode && nextNode.nodeType === Node.TEXT_NODE) {
          for (const item of textNodeMap) {
            if (item.node === nextNode) {
              selectionMarkerOffset = item.startPos;
              break;
            }
          }
        } else {
          // Fallback: search for the beginning of the original text.
          const firstChunk = originalText.substring(0, Math.min(40, originalText.length));
          const idx = allText.indexOf(firstChunk);
          if (idx !== -1) selectionMarkerOffset = idx;
        }
      }

      // Locate the surrounding sentence so repeated words stay in order.
      const contextStart = Math.max(0, charIndex - 20);
      const contextEnd = Math.min(originalText.length, charIndex + 50);
      const context = originalText.substring(contextStart, contextEnd);

      const searchStartIndex =
        lastMatchOffset !== -1
          ? Math.max(0, lastMatchOffset - 20)
          : Math.max(0, selectionMarkerOffset - 50);

      let wordPosInPage = -1;
      let contextIndex = allText.indexOf(context, searchStartIndex);

      if (contextIndex === -1 && searchStartIndex > 0) {
        // Fallback: search from the selection marker, then from the beginning.
        contextIndex = allText.indexOf(context, Math.max(0, selectionMarkerOffset - 50));
        if (contextIndex === -1) contextIndex = allText.indexOf(context);
      }

      if (contextIndex !== -1) {
        wordPosInPage = contextIndex + (charIndex - contextStart);
        lastMatchOffset = contextIndex;
      } else {
        // Last resort: match the bare word.
        let wordIndex = allText.indexOf(searchText, searchStartIndex);
        if (wordIndex === -1 && searchStartIndex > 0) {
          wordIndex = allText.indexOf(searchText, Math.max(0, selectionMarkerOffset - 50));
          if (wordIndex === -1) wordIndex = allText.indexOf(searchText);
        }

        if (wordIndex === -1) return; // Not on the page (image, canvas, PDF text layer, ...)

        wordPosInPage = wordIndex;
        lastMatchOffset = Math.max(0, wordIndex - (charIndex - contextStart));
      }

      let targetNode = null;
      let nodeOffset = 0;

      for (const item of textNodeMap) {
        if (item.startPos <= wordPosInPage && item.endPos > wordPosInPage) {
          targetNode = item.node;
          nodeOffset = wordPosInPage - item.startPos;
          break;
        }
      }

      if (!targetNode?.parentNode) return;

      const rect = drawHighlightRange(
        targetNode,
        nodeOffset,
        targetNode,
        Math.min(nodeOffset + charLength, (targetNode.textContent || '').length)
      );
      if (rect) followWord(rect);
    } catch (e) {
      // Highlighting is cosmetic: it must never break playback.
      log('Could not highlight the current word:', e);
    }
  }

  /**
   * Fallback for voices without boundary events: outline the reading position.
   * This only paints a box; it never modifies the structure of the page.
   */
  function highlightEntireSelection() {
    try {
      const range = originalSelection;
      if (!range || typeof range.getClientRects !== 'function') return;

      const rects = range.getClientRects();
      const rect = rects?.length ? rects[0] : range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return;

      if (floatingHighlight?.parentNode) floatingHighlight.remove();

      floatingHighlight = document.createElement('div');
      floatingHighlight.id = 'read-aloud-floating-highlight';
      floatingHighlight.className = 'read-aloud-highlight-box';
      floatingHighlight.style.cssText =
        [
          'position: absolute',
          'pointer-events: none',
          'z-index: 2147483646',
          'left: ' + (rect.left + window.scrollX) + 'px',
          'top: ' + (rect.top + window.scrollY) + 'px',
          'width: ' + rect.width + 'px',
          'height: ' + rect.height + 'px'
        ].join(' !important; ') + ' !important;';

      document.body.appendChild(floatingHighlight);
    } catch (e) {
      log('Could not highlight the selection:', e);
    }
  }

  /** Removes every trace of this extension from the page. */
  function removeHighlight() {
    try {
      if (floatingHighlight?.parentNode) floatingHighlight.remove();
    } catch (_e) {
      /* already removed */
    }
    floatingHighlight = null;

    try {
      document.querySelectorAll('.read-aloud-highlight').forEach((highlight) => {
        const parent = highlight.parentNode;
        if (!parent) return;
        while (highlight.firstChild) parent.insertBefore(highlight.firstChild, highlight);
        parent.removeChild(highlight);
        parent.normalize();
      });
    } catch (e) {
      log('Could not clean up highlight spans:', e);
    }

    try {
      // querySelectorAll also removes markers left behind by an older injection.
      document.querySelectorAll('#read-aloud-selection-marker').forEach((marker) => {
        const parent = marker.parentNode;
        if (!parent) return;
        while (marker.firstChild) parent.insertBefore(marker.firstChild, marker);
        parent.removeChild(marker);
        parent.normalize();
      });
    } catch (e) {
      log('Could not clean up the selection marker:', e);
    }
  }

  // Messages -----------------------------------------------------------------

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object' || typeof message.action !== 'string') {
      return false;
    }

    try {
      switch (message.action) {
        case 'read': {
          const result = startReading(message.settings, message.selectionData);
          sendResponse(result === true ? { success: true } : { success: false, error: result });
          return true;
        }
        case 'pause':
          sendResponse({ success: pauseReading() });
          return true;
        case 'resume':
          sendResponse({ success: resumeReading() });
          return true;
        case 'stop':
          stopReading();
          sendResponse({ success: true });
          return true;
        case 'getStatus':
          sendResponse({ isReading: isReading, isPaused: isPaused });
          return true;
        default:
          return false; // Unknown action: do not keep the message channel open
      }
    } catch (error) {
      warn('Message handler failed:', error);
      try {
        sendResponse({ success: false, error: 'unexpected' });
      } catch (_e) {
        /* the channel is already closed */
      }
      return true;
    }
  });

  // Pause while the tab is in the background, resume when it comes back.
  // A pause the user asked for is never overridden.
  document.addEventListener('visibilitychange', () => {
    try {
      if (document.hidden) {
        if (isReading && !isPaused && pauseReading()) {
          pausedByVisibility = true;
        }
      } else if (pausedByVisibility) {
        pausedByVisibility = false;
        resumeReading();
      }
    } catch (e) {
      log('Visibility handling failed:', e);
    }
  });

  // The page is going away: stop speaking, drop the timers.
  window.addEventListener('pagehide', () => {
    try {
      cancelSpeech();
    } catch (_e) {
      /* ignore */
    }
  });
}
