// A very small fake DOM, plus fake timers and a sandbox loader.
//
// The extension cannot be driven by a real Chrome inside `node --test`, so the
// tests replace only the browser surface the code actually touches. Everything
// that is *not* DOM (settings validation, text chunking, URL rules) is tested
// directly against lib/core.js in test/core.test.js.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

/** Fake timers so tests can decide when time passes. */
function createTimers() {
  const timeouts = [];
  const intervals = [];
  let nextId = 1;

  return {
    timeouts,
    intervals,
    api: {
      setTimeout(fn, delay) {
        const id = nextId++;
        timeouts.push({ id, fn, delay: delay || 0 });
        return id;
      },
      clearTimeout(id) {
        const index = timeouts.findIndex((timer) => timer.id === id);
        if (index !== -1) timeouts.splice(index, 1);
      },
      setInterval(fn, delay) {
        const id = nextId++;
        intervals.push({ id, fn, delay: delay || 0 });
        return id;
      },
      clearInterval(id) {
        const index = intervals.findIndex((timer) => timer.id === id);
        if (index !== -1) intervals.splice(index, 1);
      }
    },
    /**
     * Runs pending timeouts, oldest first.
     * Pass `maxDelay` to run only the timers that would have fired by then,
     * which is how tests separate "speech started" from "the 2 s boundary
     * check ran".
     */
    flush(maxDelay) {
      let guard = 0;
      while (guard++ < 500) {
        const index =
          maxDelay === undefined
            ? timeouts.length > 0
              ? 0
              : -1
            : timeouts.findIndex((timer) => timer.delay <= maxDelay);
        if (index === -1) break;
        timeouts.splice(index, 1)[0].fn();
      }
    },
    /** Fires every registered interval once. */
    runIntervals() {
      intervals.slice().forEach((timer) => {
        timer.fn();
      });
    }
  };
}

function createElement(tag) {
  const element = {
    tagName: String(tag || 'div').toUpperCase(),
    id: '',
    className: '',
    value: '',
    textContent: '',
    disabled: false,
    hidden: false,
    isConnected: false,
    style: {},
    attributes: {},
    children: [],
    parentNode: null,
    firstChild: null,
    _listeners: {},
    _innerHTML: '',
    classList: {
      _set: new Set(),
      add(name) {
        this._set.add(name);
      },
      remove(name) {
        this._set.delete(name);
      },
      toggle(name, force) {
        const on = force === undefined ? !this._set.has(name) : Boolean(force);
        if (on) this._set.add(name);
        else this._set.delete(name);
        return on;
      },
      contains(name) {
        return this._set.has(name);
      }
    },
    addEventListener(type, handler) {
      if (!this._listeners[type]) this._listeners[type] = [];
      this._listeners[type].push(handler);
    },
    removeEventListener(type, handler) {
      this._listeners[type] = (this._listeners[type] || []).filter((item) => item !== handler);
    },
    dispatch(type, event) {
      (this._listeners[type] || []).forEach((handler) => {
        handler(event || {});
      });
    },
    appendChild(child) {
      child.parentNode = this;
      child.isConnected = true;
      this.children.push(child);
      this.firstChild = this.children[0] || null;
      return child;
    },
    insertBefore(child) {
      child.parentNode = this;
      child.isConnected = true;
      this.children.push(child);
      this.firstChild = this.children[0] || null;
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((item) => item !== child);
      child.parentNode = null;
      child.isConnected = false;
      this.firstChild = this.children[0] || null;
      return child;
    },
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    },
    normalize() {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    getAttribute(name) {
      return this.attributes[name] === undefined ? null : this.attributes[name];
    },
    querySelectorAll() {
      return [];
    }
  };

  Object.defineProperty(element, 'innerHTML', {
    get() {
      return this._innerHTML;
    },
    set(value) {
      this._innerHTML = value;
      if (value === '') {
        this.children = [];
        this.firstChild = null;
      }
    }
  });

  return element;
}

function createDocument() {
  const created = [];
  const body = createElement('body');
  const documentElement = createElement('html');

  function matches(element, selector) {
    if (selector.startsWith('#')) return element.id === selector.slice(1);
    if (selector.startsWith('.')) {
      return String(element.className).split(/\s+/).includes(selector.slice(1));
    }
    return element.tagName.toLowerCase() === selector.toLowerCase();
  }

  const document = {
    body,
    documentElement,
    hidden: false,
    _listeners: {},
    _created: created,
    addEventListener(type, handler) {
      if (!this._listeners[type]) this._listeners[type] = [];
      this._listeners[type].push(handler);
    },
    dispatch(type, event) {
      (this._listeners[type] || []).forEach((handler) => {
        handler(event || {});
      });
    },
    createElement(tag) {
      const element = createElement(tag);
      created.push(element);
      return element;
    },
    createTextNode(text) {
      return {
        nodeType: 3,
        textContent: text,
        parentNode: null,
        parentElement: null,
        isConnected: false
      };
    },
    getElementById(id) {
      return created.find((element) => element.id === id && element.parentNode) || null;
    },
    querySelectorAll(selector) {
      return created.filter((element) => element.parentNode && matches(element, selector));
    },
    getElementsByTagName() {
      return [];
    },
    createRange() {
      const range = {
        commonAncestorContainer: body,
        startContainer: null,
        endContainer: null,
        startNode: null,
        endNode: null,
        startOffset: 0,
        endOffset: 0,
        _text: '',
        _selectionNodes: null,
        _rect: null,
        intersectsNode(node) {
          return this._selectionNodes === null ? true : this._selectionNodes.includes(node);
        },
        setStart(node, offset) {
          this.startNode = node;
          this.startOffset = offset;
          document._lastRange = this;
        },
        setEnd(node, offset) {
          this.endNode = node;
          this.endOffset = offset;
        },
        selectNodeContents(node) {
          this._text = node?.textContent || '';
        },
        toString() {
          return this._text || '';
        },
        collapse() {},
        cloneRange() {
          return this;
        },
        getBoundingClientRect() {
          return (
            document._rect ||
            this._rect || {
              left: 12,
              top: 24,
              right: 92,
              bottom: 44,
              width: 80,
              height: 20
            }
          );
        },
        getClientRects() {
          return [this.getBoundingClientRect()];
        },
        insertNode(node) {
          // Give the marker a parent so getElementById() can find it again.
          node.parentNode = body;
          node.isConnected = true;
          body.appendChild(node);
        }
      };
      return range;
    },
    /**
     * Fakes a user selection over one text node, or over several when the
     * selection crosses an inline element such as <strong>.
     */
    createSelectionRange(nodes, text) {
      const list = Array.isArray(nodes) ? nodes : [nodes];
      const first = list[0];
      const last = list[list.length - 1];
      const range = document.createRange();
      range.startContainer = first;
      range.endContainer = last;
      range.startOffset = 0;
      range.endOffset = Math.min(
        String(text || '').length -
          list.slice(0, -1).reduce((total, node) => total + node.textContent.length, 0),
        String(last.textContent || '').length
      );
      range.commonAncestorContainer = first.parentNode || document.body;
      range._selectionNodes = list;
      return range;
    }
  };

  document._rect = null;
  document._lastRange = null;

  return document;
}

/** Collects everything the code logs, so tests can assert on warnings. */
function createConsole() {
  const logs = { log: [], warn: [], error: [], info: [] };

  const record =
    (level) =>
    (...args) => {
      logs[level].push(args.map((value) => String(value)).join(' '));
    };

  return {
    logs,
    api: {
      log: record('log'),
      warn: record('warn'),
      error: record('error'),
      info: record('info')
    }
  };
}

/** Creates a vm sandbox whose `window` and `globalThis` point at itself. */
function createSandbox(globals) {
  const consoleStub = createConsole();
  const sandbox = Object.assign({ console: consoleStub.api }, globals);
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return { sandbox, logs: consoleStub.logs };
}

/** Runs one of the extension's plain scripts inside a sandbox. */
function loadScript(sandbox, relativePath) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
  vm.runInContext(source, sandbox, { filename: relativePath });
}

module.exports = {
  ROOT,
  createTimers,
  createElement,
  createDocument,
  createConsole,
  createSandbox,
  loadScript
};
