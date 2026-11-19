// Harnesses that load the real extension scripts into the fake DOM.
//
// Each factory returns a fresh, isolated environment, so tests do not depend on
// each other's order and one failure cannot leak into the next test.

const vm = require('node:vm');

const {
  createDocument,
  createElement,
  createSandbox,
  createTimers,
  loadScript
} = require('./fake-dom');

const PAGE_TEXT = 'Hello world from the test page.';

/** Loads lib/core.js + content.js with one paragraph of text on the page. */
function createContentHarness(options) {
  const settings = options || {};
  const timers = createTimers();
  const document = createDocument();
  const messages = [];
  const spoken = [];
  const utterances = [];
  const windowListeners = {};
  const voiceListeners = {};
  const voices = settings.voices || [{ name: 'Test Voice', lang: 'en-US', localService: true }];

  let listener = null;
  const _extensionContextValid = true;
  let selectionText = null;
  let selectionNode = null;
  let walkNodes = null;
  let hasArticleParagraphs = settings.withParagraphs !== false;
  const scrollCalls = [];

  // The page: one paragraph with one text node, which is what the highlighter
  // walks when it looks for the word being spoken.
  const paragraph = document.createElement('p');
  const pageTextNode = document.createTextNode(PAGE_TEXT);
  pageTextNode.parentNode = paragraph;
  pageTextNode.parentElement = paragraph;
  pageTextNode.isConnected = true;
  document.body.appendChild(paragraph);
  walkNodes = [pageTextNode];

  document.getElementsByTagName = (tag) => (hasArticleParagraphs && tag === 'p' ? [paragraph] : []);

  document.createTreeWalker = (_root, _whatToShow, filter) => {
    const nodes = walkNodes;
    let index = 0;
    return {
      nextNode() {
        while (index < nodes.length) {
          const node = nodes[index++];
          if (!filter || filter.acceptNode(node) === 1) return node;
        }
        return null;
      }
    };
  };

  const speechSynthesis = {
    speaking: false,
    paused: false,
    getVoices: () => (voiceListeners.voices === undefined ? voices : voiceListeners.voices),
    speak(utterance) {
      speechSynthesis.speaking = true;
      utterances.push(utterance);
      spoken.push(utterance.text);
      if (utterance.onstart) utterance.onstart();
    },
    cancel() {
      speechSynthesis.speaking = false;
      speechSynthesis.paused = false;
    },
    pause() {
      speechSynthesis.paused = true;
    },
    resume() {
      speechSynthesis.paused = false;
    },
    addEventListener(type, handler) {
      if (!voiceListeners[type]) voiceListeners[type] = [];
      voiceListeners[type].push(handler);
    },
    removeEventListener(type, handler) {
      voiceListeners[type] = (voiceListeners[type] || []).filter((item) => item !== handler);
    }
  };

  function SpeechSynthesisUtterance(text) {
    this.text = text;
    this.rate = 1;
    this.pitch = 1;
    this.voice = null;
    this.onstart = null;
    this.onend = null;
    this.onerror = null;
    this.onboundary = null;
  }

  const chromeStub = {
    runtime: {
      id: 'test-extension-id',
      onMessage: {
        addListener(fn) {
          listener = fn;
        }
      },
      sendMessage(message) {
        messages.push(message);
        return Promise.resolve();
      }
    }
  };

  const { sandbox, logs } = createSandbox({
    setTimeout: timers.api.setTimeout,
    clearTimeout: timers.api.clearTimeout,
    setInterval: timers.api.setInterval,
    clearInterval: timers.api.clearInterval,
    document,
    speechSynthesis,
    SpeechSynthesisUtterance,
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    chrome: chromeStub
  });

  sandbox.window.getSelection = () => {
    const text = selectionText || '';
    const node = selectionNode || pageTextNode;
    return {
      rangeCount: selectionText === null ? 0 : 1,
      toString: () => text,
      getRangeAt: () => document.createSelectionRange(node, text)
    };
  };
  sandbox.window.scrollX = 0;
  sandbox.window.scrollY = 0;
  sandbox.window.innerHeight = 800;
  sandbox.window.scrollTo = (options) => {
    scrollCalls.push(options);
  };
  sandbox.window.addEventListener = (type, handler) => {
    windowListeners[type] = handler;
  };

  loadScript(sandbox, 'lib/core.js');
  loadScript(sandbox, 'content.js');

  return {
    sandbox,
    logs,
    document,
    timers,
    messages,
    spoken,
    utterances,
    speechSynthesis,
    windowListeners,
    voiceListeners,
    pageTextNode,
    paragraph,

    /**
     * Sends a message to the content script.
     * Returns the response and whether the listener kept the channel open.
     */
    send(message) {
      const holder = { value: null };
      const handled = listener(message, {}, (value) => {
        holder.value = value;
      });
      return { response: holder.value, handled };
    },

    /** Pass a delay to run only the timers that would have fired by then. */
    flush(maxDelay) {
      timers.flush(maxDelay);
    },

    /** The most recent utterance handed to speak(). */
    lastUtterance() {
      return utterances.length ? utterances[utterances.length - 1] : null;
    },

    select(text) {
      selectionText = text;
      selectionNode = pageTextNode;
    },

    clearSelection() {
      selectionText = null;
      selectionNode = null;
    },

    /**
     * Builds a page where the same text appears three times (top, middle,
     * bottom) and selects the middle copy - the situation that used to make the
     * highlight jump to the wrong paragraph and drag the viewport with it.
     */
    useRepeatedPage(text) {
      const nodes = [];
      for (let index = 0; index < 3; index++) {
        const element = document.createElement('p');
        const node = document.createTextNode(text);
        node.parentNode = element;
        node.parentElement = element;
        node.isConnected = true;
        document.body.appendChild(element);
        nodes.push(node);
      }

      walkNodes = nodes;
      selectionText = text;
      selectionNode = nodes[1]; // the middle copy
      return { first: nodes[0], middle: nodes[1], last: nodes[2] };
    },

    /** Forces the rect that the next highlight range reports. */
    setHighlightRect(rect) {
      document._rect = rect;
    },

    /**
     * Builds a paragraph made of several adjacent text nodes, so a word can be
     * split across an inline element such as <strong>.
     */
    useInlinePage(parts) {
      const element = document.createElement('p');
      const nodes = parts.map((part) => {
        const node = document.createTextNode(part);
        node.parentNode = element;
        node.parentElement = element;
        node.isConnected = true;
        element.appendChild(node);
        return node;
      });
      document.body.appendChild(element);

      walkNodes = nodes;
      selectionText = parts.join('');
      selectionNode = nodes;
      return nodes;
    },

    /** Makes the page report that the user prefers reduced motion. */
    setReducedMotion(reduced) {
      sandbox.window.matchMedia = () => ({ matches: Boolean(reduced) });
    },

    /** The range the highlighter last drew a box for. */
    lastHighlightRange() {
      return document._lastRange;
    },

    scrollCalls,

    setScrollY(value) {
      sandbox.window.scrollY = value;
    },

    /** Makes the article detector find readable text. */
    useArticle(text) {
      hasArticleParagraphs = false;
      const article = document.createElement('article');
      article.textContent = text;
      document.getElementsByTagName = (tag) => (tag === 'article' ? [article] : []);
    },

    /** Makes the page look unreadable to the article detector. */
    useNoArticle() {
      hasArticleParagraphs = false;
      document.getElementsByTagName = () => [];
    },

    setVoices(list) {
      voiceListeners.voices = list;
    },

    emitVoicesChanged() {
      (voiceListeners.voiceschanged || []).slice().forEach((handler) => {
        handler();
      });
    },

    setHidden(hidden) {
      document.hidden = hidden;
      document.dispatch('visibilitychange');
    },

    unloadPage() {
      if (windowListeners.pagehide) windowListeners.pagehide();
    },

    invalidateExtensionContext() {
      chromeStub.runtime.id = undefined;
    },

    highlight: () => document.getElementById('read-aloud-floating-highlight'),
    marker: () => document.getElementById('read-aloud-selection-marker'),
    toast: () => document.getElementById('read-aloud-toast')
  };
}

/** Loads lib/core.js + popup.js with the popup markup stubbed out. */
function createPopupHarness(options) {
  const settings = options || {};
  const timers = createTimers();
  const document = createDocument();
  const elements = new Map();
  const stored = Object.assign({}, settings.stored);
  const sentMessages = [];
  const runtimeListeners = [];
  const windowListeners = {};

  const state = {
    failReadOnce: false,
    failInjection: false,
    injections: 0,
    readResponse: null,
    tab: { id: 7, url: 'https://example.com/article' },
    voices: settings.voices || [
      { name: 'Google US English', lang: 'en-US', localService: false },
      { name: 'Microsoft David', lang: 'en-US', localService: true }
    ]
  };

  // Mirrors the initial markup in popup.html, which a fake DOM cannot parse.
  const initial = {
    readBtn: { disabled: false, textContent: 'Read' },
    pauseBtn: { disabled: true, textContent: 'Pause' },
    stopBtn: { disabled: true, textContent: 'Stop' },
    rate: { value: '0.85' },
    rateValue: { textContent: '0.85' },
    pitch: { value: '1' },
    pitchValue: { textContent: '1' },
    hint: { classes: ['hidden'] },
    voiceWarning: { classes: ['hidden'] }
  };

  document.readyState = 'complete';
  document.getElementById = (id) => {
    if (!elements.has(id)) {
      const element = createElement('div');
      element.id = id;
      const preset = initial[id] || {};
      if (preset.disabled !== undefined) element.disabled = preset.disabled;
      if (preset.textContent !== undefined) element.textContent = preset.textContent;
      if (preset.value !== undefined) element.value = preset.value;
      (preset.classes || []).forEach((name) => {
        element.classList.add(name);
      });
      elements.set(id, element);
    }
    return elements.get(id);
  };

  const { sandbox, logs } = createSandbox({
    setTimeout: timers.api.setTimeout,
    clearTimeout: timers.api.clearTimeout,
    setInterval: timers.api.setInterval,
    clearInterval: timers.api.clearInterval,
    document,
    speechSynthesis: {
      getVoices: () => state.voices,
      addEventListener() {}
    },
    chrome: {
      runtime: {
        id: 'test-extension-id',
        lastError: undefined,
        onMessage: {
          addListener(fn) {
            runtimeListeners.push(fn);
          }
        },
        getManifest: () => ({ version: '1.0.0' })
      },
      storage: {
        sync: {
          get: async () => Object.assign({}, stored),
          set: async (values) => Object.assign(stored, values)
        },
        local: {
          get: async () => Object.assign({}, stored),
          set: async (values) => Object.assign(stored, values)
        }
      },
      tabs: {
        query: async () => [state.tab],
        sendMessage: async (_tabId, message) => {
          sentMessages.push(message);
          if (message.action === 'read' && state.failReadOnce) {
            state.failReadOnce = false;
            throw new Error('Could not establish connection. Receiving end does not exist.');
          }
          return state.readResponse || { success: true, isReading: false, isPaused: false };
        }
      },
      scripting: {
        executeScript: async (execOptions) => {
          if (execOptions?.files) {
            state.injections++;
            if (state.failInjection) {
              throw new Error(
                'Cannot access contents of the page. Extension manifest must request permission.'
              );
            }
          }
          return [{ result: { text: 'selected text' } }];
        },
        insertCSS: async () => {}
      }
    }
  });

  sandbox.window.addEventListener = (type, handler) => {
    windowListeners[type] = handler;
  };

  loadScript(sandbox, 'lib/core.js');
  loadScript(sandbox, 'popup.js');

  const settle = async () => {
    for (let round = 0; round < 60; round++) await Promise.resolve();
  };

  return {
    sandbox,
    logs,
    document,
    elements,
    stored,
    sentMessages,
    runtimeListeners,
    windowListeners,
    state,
    timers,
    settle,

    el: (id) => elements.get(id),

    async ready() {
      await settle();
    },

    async click(id) {
      elements.get(id).dispatch('click');
      await settle();
    },

    async clickAndFlush(id) {
      elements.get(id).dispatch('click');
      await settle();
      timers.flush();
      await settle();
    },

    input(id) {
      elements.get(id).dispatch('input');
    },

    /** Replaces a storage method with one that rejects, like a real quota error. */
    breakStorage(method) {
      sandbox.chrome.storage.sync[method] = async () => {
        throw new Error(
          method === 'get' ? 'QUOTA_BYTES exceeded' : 'MAX_WRITE_OPERATIONS exceeded'
        );
      };
    },

    run(expression) {
      return vm.runInContext(expression, sandbox);
    }
  };
}

module.exports = { createContentHarness, createPopupHarness, PAGE_TEXT };
