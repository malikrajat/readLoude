// Shared, side-effect free logic for Read Aloud with Highlight.
//
// This file is loaded before content.js in the page and before popup.js in the
// popup, and it is also required directly by the unit tests in test/. Keeping
// the decision making here (and only the DOM/speech work in the two entry
// points) is what makes the behaviour testable without a browser.

((root, factory) => {
  const api = factory();

  // Node (unit tests). In a content script or an extension page `module` does
  // not exist, so only the global is set there.
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.ReadAloudCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  // Chrome silently fails on utterances that are too long.
  const MAX_UTTERANCE_LENGTH = 30000;
  const MIN_SELECTION_LENGTH = 1;

  // Chrome throws a TypeError for out-of-range rate and pitch values.
  const RATE = { min: 0.5, max: 2, fallback: 0.85 };
  const PITCH = { min: 0.5, max: 2, fallback: 1 };

  const PRESETS = {
    slow: { rate: 0.8, pitch: 1 },
    normal: { rate: 0.95, pitch: 1 },
    fast: { rate: 1.1, pitch: 1 }
  };

  // Pages Chrome never lets an extension read.
  const BLOCKED_URL_PREFIXES = [
    'chrome:',
    'chrome-extension:',
    'chrome-untrusted:',
    'chrome-search:',
    'devtools:',
    'edge:',
    'about:',
    'brave:',
    'opera:',
    'vivaldi:',
    'view-source:',
    'data:',
    'blob:'
  ];

  const BLOCKED_HOSTS = ['chrome.google.com/webstore', 'chromewebstore.google.com'];

  const ERROR_MESSAGES = {
    'no-text': 'Nothing to read. Select some text on the page, or open an article and try again.',
    unsupported: 'This browser does not support speech synthesis.',
    unexpected: 'Something went wrong while starting playback. Reload the page and try again.',
    default: 'Could not start reading. Reload the page (F5) and try again.'
  };

  // How the page follows the spoken word.
  const SCROLL = {
    margin: 120, // never let the word sit closer than this to an edge
    anchorRatio: 0.35, // when scrolling down, put the word at 35% of the height
    settle: 16 // two targets closer than this are "already there"
  };

  /**
   * Parses a number and keeps it inside a range, falling back when it is not a
   * usable number at all.
   */
  function clamp(value, min, max, fallback) {
    const number = Number.parseFloat(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  /**
   * Settings arrive from the popup and from storage, so they are validated
   * before they reach SpeechSynthesisUtterance.
   */
  function normalizeSettings(settings) {
    const input = settings && typeof settings === 'object' ? settings : {};
    return {
      voice: typeof input.voice === 'string' && input.voice ? input.voice : null,
      rate: clamp(input.rate, RATE.min, RATE.max, RATE.fallback),
      pitch: clamp(input.pitch, PITCH.min, PITCH.max, PITCH.fallback)
    };
  }

  /**
   * Splits long text into parts Chrome can speak reliably, preferring sentence
   * boundaries, then word boundaries. Every character is kept, and each part
   * records its offset in the original text so highlighting still lines up.
   */
  function buildSpeechChunks(text, maxLength) {
    const limit = maxLength || MAX_UTTERANCE_LENGTH;
    const value = typeof text === 'string' ? text : '';

    if (value.length <= limit) return [{ text: value, start: 0 }];

    const chunks = [];
    let start = 0;

    while (start < value.length) {
      let end = Math.min(value.length, start + limit);

      if (end < value.length) {
        const windowText = value.slice(start, end);
        let cut = Math.max(
          windowText.lastIndexOf('. '),
          windowText.lastIndexOf('! '),
          windowText.lastIndexOf('? '),
          windowText.lastIndexOf('\n')
        );
        if (cut < limit * 0.5) cut = windowText.lastIndexOf(' ');
        if (cut > 0) end = start + cut + 1;
      }

      chunks.push({ text: value.slice(start, end), start: start });
      start = end;
    }

    return chunks;
  }

  /** True when the selection has nothing speakable in it. */
  function isReadableText(text) {
    return typeof text === 'string' && text.trim().length >= MIN_SELECTION_LENGTH;
  }

  /**
   * Returns a user readable reason when a page can never be read, or null when
   * the page is allowed. `file:` URLs are allowed through on purpose: whether
   * they work depends on the user enabling file access, which is reported later
   * by the injection step.
   */
  function blockedPageReason(url) {
    if (typeof url !== 'string' || url === '') {
      return 'This page cannot be read. Open a normal web page and try again.';
    }

    const lower = url.toLowerCase();
    if (BLOCKED_URL_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
      return 'Chrome does not allow extensions to read browser pages (chrome://, the New Tab page, the Web Store, or the built-in PDF viewer). Open a regular website instead.';
    }
    if (BLOCKED_HOSTS.some((host) => lower.includes(host))) {
      return 'Chrome does not allow extensions to read the Chrome Web Store. Open a regular website instead.';
    }

    return null;
  }

  /** Maps an error code from the content script to a message for the popup. */
  function messageForErrorCode(code) {
    return ERROR_MESSAGES[code] || ERROR_MESSAGES.default;
  }

  /**
   * Picks a sensible default voice. Local voices are preferred: they start
   * instantly and report word boundaries, which is what highlighting needs.
   */
  function findDefaultVoiceIndex(voices) {
    const list = Array.isArray(voices) ? voices : [];
    if (list.length === 0) return -1;

    const isLocal = (voice) => voice && voice.localService === true;
    const name = (voice) => String(voice?.name || '').toLowerCase();
    const lang = (voice) => String(voice?.lang || '').toLowerCase();

    // 1. A local Indian English voice
    let index = list.findIndex(
      (voice) => isLocal(voice) && (lang(voice).includes('en-in') || name(voice).includes('india'))
    );
    if (index !== -1) return index;

    // 2. A local English voice
    index = list.findIndex((voice) => isLocal(voice) && lang(voice).startsWith('en'));
    if (index !== -1) return index;

    // 3. Any local voice
    index = list.findIndex(isLocal);
    if (index !== -1) return index;

    return 0;
  }

  /**
   * Finds a stored voice by name, because the order of the voice list changes
   * between sessions and machines. Returns -1 when it is gone.
   */
  function findVoiceIndexByName(voices, name) {
    if (!name || !Array.isArray(voices)) return -1;
    return voices.findIndex((voice) => voice && voice.name === name);
  }

  /**
   * Maps a character offset in the text being read onto the page.
   *
   * `entries` describes the text nodes that make up the reading, in order:
   *   [{ node, start, end, dataStart }]
   * where start/end are offsets in the reading and dataStart is the offset
   * inside the node. Entries are contiguous and sorted, so this is a binary
   * search - and, crucially, it is exact. Repeated text on the page can no
   * longer pull the highlight to the wrong copy, which is what used to make the
   * view jump around.
   *
   * Returns {index, offsetInEntry} or null when the offset is outside the text.
   */
  function findTextPosition(entries, offset) {
    if (!Array.isArray(entries) || entries.length === 0) return null;
    if (!Number.isFinite(offset) || offset < 0) return null;

    let low = 0;
    let high = entries.length - 1;

    while (low <= high) {
      const middle = (low + high) >> 1;
      const entry = entries[middle];

      if (offset < entry.start) {
        high = middle - 1;
      } else if (offset >= entry.end) {
        low = middle + 1;
      } else {
        return { index: middle, offsetInEntry: offset - entry.start };
      }
    }

    return null;
  }

  /**
   * Decides whether the page should scroll, and where to, so the spoken word
   * stays visible.
   *
   * Rules that keep the view still:
   *   - a word that is already comfortably visible never scrolls;
   *   - scrolling down anchors the word at anchorRatio of the viewport, so the
   *     next several lines need no movement at all;
   *   - scrolling up only happens when the word is completely above the
   *     viewport (the user scrolled away), never for a word that is merely
   *     close to the top, which is what used to make the page bounce.
   */
  function planScroll(rect, viewport, scrollY, options) {
    const settings = Object.assign({}, SCROLL, options || {});
    const idle = { scroll: false, top: scrollY, direction: null };

    if (!rect || !viewport) return idle;

    const height = Number(viewport.height) || 0;
    if (height <= 0) return idle;
    if (!Number.isFinite(scrollY) || scrollY < 0) scrollY = 0;

    const top = Number(rect.top) || 0;
    const bottom = Number(rect.bottom) || 0;
    if (bottom === top) return idle; // hidden element

    const margin = Math.min(settings.margin, height * 0.25);
    const anchor = Math.max(0, scrollY + top - height * settings.anchorRatio);

    // Already where we would scroll to: doing it again would only interrupt an
    // animation that is still running.
    if (isSameScrollTarget(anchor, scrollY, settings.settle)) return idle;

    // Below the visible area: follow the reading downwards.
    if (bottom > height - margin) {
      return { scroll: true, top: anchor, direction: 'down' };
    }

    // Completely above the viewport: the user scrolled away, so catch up.
    if (bottom < 0) {
      return { scroll: true, top: anchor, direction: 'up' };
    }

    return idle;
  }

  /**
   * True when two scroll targets are so close that scrolling again would only
   * interrupt the animation that is still running.
   */
  function isSameScrollTarget(a, b, tolerance) {
    const limit = tolerance === undefined ? SCROLL.settle : tolerance;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
    return Math.abs(a - b) < limit;
  }

  return {
    MAX_UTTERANCE_LENGTH: MAX_UTTERANCE_LENGTH,
    MIN_SELECTION_LENGTH: MIN_SELECTION_LENGTH,
    RATE: RATE,
    PITCH: PITCH,
    PRESETS: PRESETS,
    SCROLL: SCROLL,
    BLOCKED_URL_PREFIXES: BLOCKED_URL_PREFIXES,
    clamp: clamp,
    normalizeSettings: normalizeSettings,
    buildSpeechChunks: buildSpeechChunks,
    isReadableText: isReadableText,
    blockedPageReason: blockedPageReason,
    messageForErrorCode: messageForErrorCode,
    findDefaultVoiceIndex: findDefaultVoiceIndex,
    findVoiceIndexByName: findVoiceIndexByName,
    findTextPosition: findTextPosition,
    planScroll: planScroll,
    isSameScrollTarget: isSameScrollTarget
  };
});
