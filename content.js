// Prevent multiple injections
if (!window.readAloudExtensionLoaded) {
  window.readAloudExtensionLoaded = true;

  let utterance = null;
  let isPaused = false;
  let currentText = '';
  let currentSettings = {};
  let originalSelection = null;
  let textNodes = [];
  let selectionContainer = null; // Container to preserve selection
  let originalText = ''; // Store the original text for index mapping
  let lastMatchOffset = -1; // Track the position of the last matched word in allText

  let lastValidRange = null;
  let lastValidText = '';

  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const text = sel.toString().trim();
      if (text) {
        lastValidRange = sel.getRangeAt(0).cloneRange();
        lastValidText = text;
      }
    }
  });

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      if (message.action === 'read') {
        startReading(message.settings, message.selectionData);
        sendResponse({ success: true });
        return true;
      } else if (message.action === 'pause') {
        pauseReading();
        sendResponse({ success: true });
        return true;
      } else if (message.action === 'resume') {
        resumeReading();
        sendResponse({ success: true });
        return true;
      } else if (message.action === 'stop') {
        stopReading();
        sendResponse({ success: true });
        return true;
      } else if (message.action === 'getStatus') {
        sendResponse({
          isReading: !!utterance && speechSynthesis.speaking,
          isPaused: isPaused
        });
        return true;
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
      return true;
    }
    // If no action matched, don't keep channel open
    return false;
  });

  function extractMainContent() {
    // 1. Check for semantic tags
    const semanticTags = ['article', 'main'];
    for (const tag of semanticTags) {
      const elements = document.getElementsByTagName(tag);
      if (elements.length > 0) {
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
        if (className.includes('comment') || className.includes('sidebar') || className.includes('menu') || className.includes('footer') || id.includes('comment') || id.includes('sidebar') || id.includes('menu')) {
          break;
        }
        
        const currentScore = containers.get(parent) || 0;
        containers.set(parent, currentScore + textLen);
        
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
  }

  function startReading(settings, selectionData) {
    console.log('📥 startReading called with selectionData:', selectionData);
    
    // Get selected text
    const selection = window.getSelection();
    let selectedText = selection ? selection.toString().trim() : '';
    let activeRange = null;
    
    console.log('Current selection text:', selectedText ? selectedText.substring(0, 50) + '...' : 'none');
    
    if (selectedText && selection && selection.rangeCount > 0) {
      activeRange = selection.getRangeAt(0).cloneRange();
    } else if (lastValidText && lastValidRange) {
      selectedText = lastValidText;
      activeRange = lastValidRange.cloneRange();
      console.log('✓ Using last valid selection tracked by content script');
    } else if (selectionData && selectionData.text) {
      selectedText = selectionData.text.trim();
      console.log('✓ Using captured selection data:', selectedText.substring(0, 50) + '...');
    }
    
    if (!selectedText) {
      console.log('⚠ No text selected, attempting to auto-extract main article...');
      const articleRange = extractMainContent();
      
      if (articleRange) {
        activeRange = articleRange;
        selectedText = articleRange.toString().trim();
        console.log('✓ Successfully extracted main article:', selectedText.substring(0, 50) + '...');
      } else {
        alert('Could not detect the main article. Please select some text to read aloud.');
        return;
      }
    }

    // Stop any ongoing speech
    speechSynthesis.cancel();
    removeHighlight();
    
    currentText = selectedText;
    originalText = selectedText; // Store original text
    currentSettings = settings;
    lastMatchOffset = -1; // Reset for new reading
    
    console.log('📝 Original text stored:', originalText.substring(0, 50) + '...');
    
    // Don't wrap - just store the range for reference
    console.log('📍 Checking selection...');
    
    try {
      if (activeRange) {
        originalSelection = activeRange.cloneRange();
        console.log('✓ Selection range captured');
      } else {
        console.warn('⚠ No active selection, will try to find text in page');
        // Try to find the text in the page
        if (selectedText) {
          const textToFind = selectedText.substring(0, 50); // First 50 chars
          const bodyText = document.body.innerText;
          const index = bodyText.indexOf(textToFind);
          
          if (index !== -1) {
            console.log('✓ Found text in page at index', index);
            // We'll create a marker anyway for reference
          }
        }
      }
    } catch (e) {
      console.error('❌ Error capturing selection:', e);
    }
    
    // Create a simple marker at the start of selection for reference
    // Even if we don't have originalSelection, create a marker for the text search
    try {
      selectionContainer = document.createElement('span');
      selectionContainer.id = 'read-aloud-selection-marker';
      selectionContainer.style.cssText = 'display: none;'; // Hidden marker
      selectionContainer.setAttribute('data-read-aloud-text', originalText);
      selectionContainer.textContent = ''; // Empty marker
      
      if (originalSelection) {
        const startRange = originalSelection.cloneRange();
        startRange.collapse(true); // Collapse to start
        startRange.insertNode(selectionContainer);
        console.log('✓ Selection marker inserted at selection start');
      } else {
        // Insert at body start as fallback
        document.body.insertBefore(selectionContainer, document.body.firstChild);
        console.log('✓ Fallback marker inserted at body start');
      }
    } catch (e) {
      console.error('❌ Could not insert marker:', e);
    }
    
    // Create utterance
    utterance = new SpeechSynthesisUtterance(selectedText);
    
    utterance.rate = settings.rate || 1;
    utterance.pitch = settings.pitch || 1;
    
    // Handle word highlighting with better event handling
    let boundaryEventFired = false;
    let boundaryCheckTimeout = null;
    
    utterance.onboundary = (event) => {
      boundaryEventFired = true;
      console.log('✓ Boundary event:', event.name, 'at index', event.charIndex, 'length', event.charLength);
      if (event.name === 'word') {
        highlightWordAtIndex(event.charIndex, event.charLength || 1);
      }
    };
    
    // Fallback: Check if boundary events are working
    boundaryCheckTimeout = setTimeout(() => {
      if (!boundaryEventFired && speechSynthesis.speaking) {
        console.warn('⚠ Boundary events NOT supported by this voice');
        console.log('→ Try selecting a different voice from the dropdown');
        highlightEntireSelection(); // Trigger fallback highlighting
      } else if (boundaryEventFired) {
        console.log('✓ Boundary events working - word-by-word highlighting active');
      }
    }, 2000);
    
    let keepAliveInterval = null;
    
    utterance.onstart = () => {
      console.log('🔊 Speech started');
      console.log('Selected text length:', selectedText.length, 'characters');
      console.log('Voice:', utterance.voice ? utterance.voice.name : 'default (NO VOICE SET - select one from dropdown!)');
      console.log('Rate:', utterance.rate, 'Pitch:', utterance.pitch);
      console.log('Waiting for boundary events...');
      
      // Chrome bug workaround: Keep speech alive for long texts
      keepAliveInterval = setInterval(() => {
        if (speechSynthesis.speaking && !isPaused) {
          speechSynthesis.pause();
          speechSynthesis.resume();
        }
      }, 10000);
    };
    
    utterance.onend = () => {
      if (keepAliveInterval) clearInterval(keepAliveInterval);
      if (boundaryCheckTimeout) clearTimeout(boundaryCheckTimeout);
      console.log('✓ Speech completed');
      removeHighlight();
      try {
        chrome.runtime.sendMessage({ action: 'readingComplete' }).catch(() => {
          console.log('Extension context may be invalid');
        });
      } catch (e) {
        console.log('Could not send completion message:', e);
      }
    };
    
    utterance.onerror = (event) => {
      if (keepAliveInterval) clearInterval(keepAliveInterval);
      if (boundaryCheckTimeout) clearTimeout(boundaryCheckTimeout);
      removeHighlight();
      
      // Try to send completion message
      try {
        chrome.runtime.sendMessage({ action: 'readingComplete' }).catch(() => {});
      } catch (e) {
        // Ignore if extension context is invalid
      }
      
      // Handle errors (suppress expected ones)
      if (event.error === 'interrupted' || event.error === 'canceled') {
        // Normal - user clicked stop/pause, don't show error
        console.log('ℹ Speech stopped');
      } else if (event.error === 'network') {
        console.error('❌ Network error');
        alert('Network error. Try again or select a different voice.');
      } else {
        console.error('❌ Speech error:', event.error);
      }
    };
  
    const applyVoiceAndSpeak = () => {
      if (settings.voice) {
        const voices = speechSynthesis.getVoices();
        console.log('🎤 Looking for voice:', settings.voice);
        const voice = voices.find(v => v.name === settings.voice);
        if (voice) {
          utterance.voice = voice;
          console.log('✓ Voice set to:', voice.name);
        } else {
          console.warn('⚠ Voice not found:', settings.voice);
        }
      } else {
        console.warn('⚠ No voice specified in settings - using default (may not support word highlighting)');
      }
      
      // Start speaking
      speechSynthesis.speak(utterance);
      isPaused = false;
    };

    let availableVoices = speechSynthesis.getVoices();
    if (availableVoices.length === 0) {
      console.log('⏳ Waiting for voices to load...');
      let voicesLoaded = false;
      
      const onVoicesChanged = () => {
        if (!voicesLoaded) {
          voicesLoaded = true;
          speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
          applyVoiceAndSpeak();
        }
      };
      
      speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
      
      // Fallback in case event doesn't fire
      setTimeout(() => {
        if (!voicesLoaded) {
          voicesLoaded = true;
          speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
          console.warn('⚠ Voices load timeout, proceeding with available voices');
          applyVoiceAndSpeak();
        }
      }, 1000);
    } else {
      applyVoiceAndSpeak();
    }
  }

  function getTextNodesInRange(range) {
    const nodes = [];
    const walker = document.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const nodeRange = document.createRange();
          nodeRange.selectNodeContents(node);
          return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      }
    );
  
    let node;
    while (node = walker.nextNode()) {
      nodes.push(node);
    }
    return nodes;
  }

  function pauseReading() {
    if (speechSynthesis.speaking && !speechSynthesis.paused) {
      speechSynthesis.pause();
      isPaused = true;
    }
  }

  function resumeReading() {
    if (speechSynthesis.paused) {
      speechSynthesis.resume();
      isPaused = false;
    }
  }

  function stopReading() {
    speechSynthesis.cancel();
    removeHighlight();
    isPaused = false;
    utterance = null;
    lastMatchOffset = -1;
  }

  let floatingHighlight = null;
  let searchStartNode = null; // Track where to start searching
  
  function highlightWordAtIndex(charIndex, charLength) {
    console.log('🎯 highlightWordAtIndex called:', charIndex, charLength);
    
    if (!originalText) {
      console.warn('⚠ No originalText');
      return;
    }
    
    if (!selectionContainer) {
      console.warn('⚠ No selectionContainer');
      return;
    }
    
    // Use the ORIGINAL text
    const word = originalText.substring(charIndex, charIndex + charLength);
    if (!word.trim()) {
      console.log('⚠ Empty word, skipping');
      return; // Skip empty words
    }
    
    console.log('💡 Highlighting word:', '"' + word + '"', 'at index', charIndex);
    
    // Find the word by searching in the page
    try {
      // Simple approach: search for the word in the visible page text
      const searchText = word.trim();
      
      // Use TreeWalker to find all text nodes
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            // Skip script, style, and our marker
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            const tagName = parent.tagName.toLowerCase();
            if (tagName === 'script' || tagName === 'style' || tagName === 'noscript') {
              return NodeFilter.FILTER_REJECT;
            }
            if (parent.id === 'read-aloud-selection-marker' || parent.id === 'read-aloud-floating-highlight') {
              return NodeFilter.FILTER_REJECT;
            }
            return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          }
        }
      );
      
      // Collect all text and find the word position
      let allText = '';
      const textNodeMap = [];
      let node;
      
      while (node = walker.nextNode()) {
        const startPos = allText.length;
        const nodeText = node.textContent;
        allText += nodeText;
        textNodeMap.push({
          node: node,
          startPos: startPos,
          endPos: allText.length,
          text: nodeText
        });
      }
      
      // Find where the selection marker is in allText
      let selectionMarkerOffset = 0;
      if (selectionContainer && selectionContainer.parentNode) {
        // Find the text node that immediately follows the marker
        let nextNode = selectionContainer.nextSibling;
        if (nextNode && nextNode.nodeType === Node.TEXT_NODE) {
          for (let item of textNodeMap) {
            if (item.node === nextNode) {
              selectionMarkerOffset = item.startPos;
              break;
            }
          }
        } else {
          // Fallback: search for the original text in allText
          const firstChunk = originalText.substring(0, Math.min(40, originalText.length));
          const idx = allText.indexOf(firstChunk);
          if (idx !== -1) {
            selectionMarkerOffset = idx;
          }
        }
      }
      
      // Find where our word should be in the collected text
      // Look for the text around charIndex
      const contextStart = Math.max(0, charIndex - 20);
      const contextEnd = Math.min(originalText.length, charIndex + 50);
      const context = originalText.substring(contextStart, contextEnd);
      
      // Determine where to start searching in allText
      let searchStartIndex = 0;
      if (lastMatchOffset !== -1) {
        // If we have a previous match, start slightly before it
        searchStartIndex = Math.max(0, lastMatchOffset - 20);
      } else {
        // For the first match, use the selection marker offset
        searchStartIndex = Math.max(0, selectionMarkerOffset - 50);
      }
      
      let wordPosInPage = -1;
      
      // Find this context in the page text
      let contextIndex = allText.indexOf(context, searchStartIndex);
      
      if (contextIndex === -1 && searchStartIndex > 0) {
        // Fallback: search from selection marker or beginning if we lost track
        contextIndex = allText.indexOf(context, Math.max(0, selectionMarkerOffset - 50));
        if (contextIndex === -1) {
          contextIndex = allText.indexOf(context);
        }
      }
      
      if (contextIndex !== -1) {
        // Calculate the actual position of the word
        wordPosInPage = contextIndex + (charIndex - contextStart);
        lastMatchOffset = contextIndex;
      } else {
        // Try just the word
        let wordIndex = allText.indexOf(searchText, searchStartIndex);
        if (wordIndex === -1 && searchStartIndex > 0) {
          wordIndex = allText.indexOf(searchText, Math.max(0, selectionMarkerOffset - 50));
          if (wordIndex === -1) {
            wordIndex = allText.indexOf(searchText);
          }
        }
        
        if (wordIndex !== -1) {
          wordPosInPage = wordIndex;
          // Since we matched the word, update lastMatchOffset assuming context would have started accordingly
          lastMatchOffset = Math.max(0, wordIndex - (charIndex - contextStart));
        } else {
          console.warn('⚠ Could not find text in page');
          return;
        }
      }
      
      // Find which text node contains this position
      let targetNode = null;
      let nodeOffset = 0;
      
      for (let item of textNodeMap) {
        if (item.startPos <= wordPosInPage && item.endPos > wordPosInPage) {
          targetNode = item.node;
          nodeOffset = wordPosInPage - item.startPos;
          break;
        }
      }
      
      if (!targetNode) {
        console.warn('⚠ Target node not found');
        return;
      }
      
      // Create range
      const range = document.createRange();
      const endOffset = Math.min(nodeOffset + charLength, targetNode.textContent.length);
      range.setStart(targetNode, nodeOffset);
      range.setEnd(targetNode, endOffset);
      
      const rect = range.getBoundingClientRect();
      
      if (rect.width === 0 || rect.height === 0) {
        console.warn('⚠ Empty rect, word might be hidden');
        return;
      }
      
      // Remove old highlight
      if (floatingHighlight) {
        floatingHighlight.remove();
      }
      
      // Create floating highlight
      floatingHighlight = document.createElement('div');
      floatingHighlight.id = 'read-aloud-floating-highlight';
      
      const absoluteLeft = rect.left + window.scrollX;
      const absoluteTop = rect.top + window.scrollY;
      
      floatingHighlight.style.cssText = `
        position: absolute !important;
        left: ${absoluteLeft}px !important;
        top: ${absoluteTop}px !important;
        width: ${rect.width}px !important;
        height: ${rect.height}px !important;
        background-color: rgba(59, 130, 246, 0.25) !important;
        border-bottom: 2px solid #3b82f6 !important;
        border-radius: 2px !important;
        pointer-events: none !important;
        z-index: 999999 !important;
        box-shadow: 0 2px 5px rgba(59, 130, 246, 0.15) !important;
        transition: left 0.1s ease-out, top 0.1s ease-out, width 0.1s ease-out, height 0.1s ease-out !important;
      `;
      
      document.body.appendChild(floatingHighlight);
      console.log('✅ Highlight box created at:', rect.left, rect.top, 'size:', rect.width, 'x', rect.height);
      
      // Only scroll if the word is close to the top or bottom edge of the viewport
      const padding = 150; // 150px from edge
      const windowHeight = window.innerHeight || document.documentElement.clientHeight;
      
      if (rect.top < padding || rect.bottom > windowHeight - padding) {
        // Calculate absolute position on page and scroll so word is in the center
        const absoluteTop = rect.top + window.scrollY;
        window.scrollTo({
          top: absoluteTop - (windowHeight / 2) + (rect.height / 2),
          behavior: 'smooth'
        });
      }
      
    } catch (e) {
      console.warn('⚠ Highlight error:', e.message);
    }
  }
  
  function highlightEntireSelection() {
    // Fallback: highlight the selection if word-by-word doesn't work
    if (!originalText && !selectionContainer) return;
    
    try {
      if (originalSelection) {
        // Safe highlight for ranges
        const span = document.createElement('span');
        span.className = 'read-aloud-highlight';
        span.style.cssText = 'background-color: rgba(59, 130, 246, 0.25) !important; color: inherit !important; border-bottom: 2px solid #3b82f6 !important;';
        try {
          originalSelection.surroundContents(span);
        } catch (e) {
          // If surroundContents fails (spans multiple block elements), we fallback to drawing a box over the first element
          const rect = originalSelection.getBoundingClientRect();
          if (rect.width > 0) {
            floatingHighlight = document.createElement('div');
            floatingHighlight.className = 'read-aloud-highlight';
            floatingHighlight.style.cssText = `
              position: absolute !important;
              left: ${rect.left + window.scrollX}px !important;
              top: ${rect.top + window.scrollY}px !important;
              width: ${rect.width}px !important;
              height: ${rect.height}px !important;
              background-color: rgba(59, 130, 246, 0.15) !important;
              border: 1px solid rgba(59, 130, 246, 0.5) !important;
              border-radius: 3px !important;
              pointer-events: none !important;
              z-index: 999999 !important;
            `;
            document.body.appendChild(floatingHighlight);
          }
        }
        console.log('Fallback: Selection highlighted');
      }
    } catch (e) {
      console.log('Could not highlight selection:', e);
    }
  }

  function removeHighlight() {
    // Remove floating highlight
    if (floatingHighlight) {
      floatingHighlight.remove();
      floatingHighlight = null;
    }
    
    // Remove highlight spans
    const highlights = document.querySelectorAll('.read-aloud-highlight');
    highlights.forEach(highlight => {
      const parent = highlight.parentNode;
      if (parent) {
        while (highlight.firstChild) {
          parent.insertBefore(highlight.firstChild, highlight);
        }
        parent.removeChild(highlight);
        parent.normalize();
      }
    });
    
    // Remove selection container
    if (selectionContainer && selectionContainer.parentNode) {
      const parent = selectionContainer.parentNode;
      while (selectionContainer.firstChild) {
        parent.insertBefore(selectionContainer.firstChild, selectionContainer);
      }
      parent.removeChild(selectionContainer);
      parent.normalize();
      selectionContainer = null;
      console.log('✓ Selection container removed');
    }
  }

  // Handle tab visibility changes
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (speechSynthesis.speaking && !speechSynthesis.paused) {
        pauseReading();
      }
    } else {
      if (isPaused && speechSynthesis.paused) {
        resumeReading();
      }
    }
  });
}
