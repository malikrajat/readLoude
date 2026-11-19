// Behaviour tests for content.js, the script that runs inside pages.
// The browser is replaced by the fake DOM in test/helpers, but the real
// content.js and lib/core.js are loaded, so the message protocol, the
// highlight path and the timer handling are genuinely exercised.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createContentHarness, PAGE_TEXT } = require('./helpers/harness');

const LONG_ARTICLE =
  'Sentence one is here. ' + 'Another readable sentence. '.repeat(12) + 'And the end.';

/** Starts a reading and lets the queued speech actually begin. */
function read(harness, selection) {
  if (selection !== undefined) harness.select(selection);
  const result = harness.send({ action: 'read', settings: {} });
  harness.flush();
  return result;
}

describe('content script — messaging', () => {
  it('answers a status request', () => {
    const harness = createContentHarness();
    const { response, handled } = harness.send({ action: 'getStatus' });
    assert.equal(handled, true);
    assert.equal(response.isReading, false);
    assert.equal(response.isPaused, false);
  });

  it('ignores messages that are not objects', () => {
    const harness = createContentHarness();
    const listener = (message) => harness.send(message).handled;
    assert.equal(listener(null), false);
    assert.equal(listener(undefined), false);
    assert.equal(listener('read'), false);
    assert.equal(listener(42), false);
  });

  it('ignores unknown actions', () => {
    const harness = createContentHarness();
    assert.equal(harness.send({ action: 'not-an-action' }).handled, false);
  });

  it('reports an error instead of throwing when something goes wrong', () => {
    const harness = createContentHarness();
    const { response } = harness.send({ action: 'read', settings: null });
    assert.equal(response.success, false);
    assert.equal(typeof response.error, 'string');
  });
});

describe('content script — starting a reading', () => {
  it('reports no-text when nothing is selected and there is no article', () => {
    const harness = createContentHarness();
    harness.useNoArticle();
    harness.clearSelection();
    const { response } = harness.send({ action: 'read', settings: {} });
    assert.equal(response.success, false);
    assert.equal(response.error, 'no-text');
  });

  it('treats a whitespace-only selection as empty', () => {
    const harness = createContentHarness();
    harness.useNoArticle();
    harness.select('   \n\t ');
    const { response } = harness.send({ action: 'read', settings: {} });
    assert.equal(response.error, 'no-text');
  });

  it('reads a single character', () => {
    const harness = createContentHarness();
    const { response } = read(harness, 'a');
    assert.equal(response.success, true);
    assert.deepEqual(harness.spoken, ['a']);
  });

  it('speaks the selected text and applies the settings', () => {
    const harness = createContentHarness();
    harness.select(PAGE_TEXT);
    const { response } = harness.send({
      action: 'read',
      settings: { rate: 1.5, pitch: 0.75, voice: 'Test Voice' }
    });
    harness.flush();

    assert.equal(response.success, true);
    assert.deepEqual(harness.spoken, [PAGE_TEXT]);

    const utterance = harness.lastUtterance();
    assert.equal(utterance.rate, 1.5);
    assert.equal(utterance.pitch, 0.75);
    assert.equal(utterance.voice.name, 'Test Voice');
  });

  it('clamps a rate that Chrome would reject', () => {
    const harness = createContentHarness();
    harness.select(PAGE_TEXT);
    harness.send({ action: 'read', settings: { rate: 99, pitch: 'abc' } });
    harness.flush();

    const utterance = harness.lastUtterance();
    assert.equal(utterance.rate, 2);
    assert.equal(utterance.pitch, 1);
  });

  it('keeps working when the requested voice is not installed', () => {
    const harness = createContentHarness();
    harness.select(PAGE_TEXT);
    const { response } = read(harness, undefined);
    harness.send({ action: 'stop' });

    const harness2 = createContentHarness();
    harness2.select(PAGE_TEXT);
    const second = harness2.send({ action: 'read', settings: { voice: 'Gone Voice' } });
    harness2.flush();

    assert.equal(response.success, true);
    assert.equal(second.response.success, true);
    assert.equal(harness2.lastUtterance().voice, null);
    assert.ok(
      harness2.logs.warn.some((line) => line.includes('not available')),
      'expected a warning about the missing voice'
    );
  });

  it('detects the main article when nothing is selected', () => {
    const harness = createContentHarness();
    harness.useArticle(LONG_ARTICLE);
    harness.clearSelection();
    const { response } = read(harness);

    assert.equal(response.success, true);
    assert.equal(harness.spoken[0], LONG_ARTICLE.trim());
  });

  it('waits for the voice list and then starts', () => {
    const harness = createContentHarness();
    harness.setVoices([]);
    harness.select(PAGE_TEXT);

    harness.send({ action: 'read', settings: {} });
    assert.deepEqual(harness.spoken, [], 'nothing should be spoken yet');

    harness.setVoices([{ name: 'Test Voice', lang: 'en-US', localService: true }]);
    harness.emitVoicesChanged();
    harness.flush();

    assert.deepEqual(harness.spoken, [PAGE_TEXT]);
    assert.equal((harness.voiceListeners.voiceschanged || []).length, 0, 'listener is removed');
  });

  it('starts anyway when the voice list never arrives', () => {
    const harness = createContentHarness();
    harness.setVoices([]);
    harness.select(PAGE_TEXT);

    harness.send({ action: 'read', settings: {} });
    assert.deepEqual(harness.spoken, []);

    harness.flush();
    assert.deepEqual(harness.spoken, [PAGE_TEXT]);
  });

  it('refuses to read without a selection when the page has no article', () => {
    const harness = createContentHarness();
    harness.useNoArticle();
    harness.clearSelection();
    const { response } = read(harness);

    assert.equal(response.success, false);
    assert.deepEqual(harness.spoken, []);
  });
});

describe('content script — pause, resume, stop', () => {
  it('reports the reading state', () => {
    const harness = createContentHarness();
    read(harness, PAGE_TEXT);

    assert.equal(harness.send({ action: 'getStatus' }).response.isReading, true);
    assert.equal(harness.send({ action: 'pause' }).response.success, true);
    assert.equal(harness.send({ action: 'getStatus' }).response.isPaused, true);
    assert.equal(harness.send({ action: 'resume' }).response.success, true);
    assert.equal(harness.send({ action: 'getStatus' }).response.isPaused, false);
    assert.equal(harness.speechSynthesis.paused, false);
  });

  it('is a no-op to pause or resume when nothing is playing', () => {
    const harness = createContentHarness();
    assert.equal(harness.send({ action: 'pause' }).response.success, false);
    assert.equal(harness.send({ action: 'resume' }).response.success, false);
    assert.equal(harness.send({ action: 'stop' }).response.success, true);
  });

  it('clears timers and page changes when stopped', () => {
    const harness = createContentHarness();
    read(harness, PAGE_TEXT);
    assert.equal(harness.timers.intervals.length, 1);

    harness.send({ action: 'stop' });

    assert.equal(harness.timers.intervals.length, 0, 'no interval may survive');
    assert.equal(harness.marker(), null, 'the hidden marker is removed');
    assert.equal(harness.highlight(), null, 'the highlight is removed');
    assert.equal(harness.send({ action: 'getStatus' }).response.isReading, false);
  });

  it('adds exactly one keep-alive interval per reading', () => {
    const harness = createContentHarness();
    read(harness, PAGE_TEXT);
    read(harness, 'A second selection to read aloud.');

    assert.equal(harness.timers.intervals.length, 1);
    assert.equal(harness.spoken.length, 2);
  });

  it('does not nudge the speech engine while paused', () => {
    const harness = createContentHarness();
    read(harness, PAGE_TEXT);
    harness.send({ action: 'pause' });

    harness.timers.runIntervals();

    assert.equal(harness.speechSynthesis.paused, true, 'the interval must not resume by itself');
  });

  it('stops and cleans up when the page is unloaded', () => {
    const harness = createContentHarness();
    read(harness, PAGE_TEXT);
    assert.equal(typeof harness.windowListeners.pagehide, 'function');

    harness.unloadPage();

    assert.equal(harness.send({ action: 'getStatus' }).response.isReading, false);
  });
});

describe('content script — highlighting', () => {
  it('draws a highlight for the word being spoken', () => {
    const harness = createContentHarness();
    harness.select(PAGE_TEXT);
    harness.send({ action: 'read', settings: {} });
    harness.flush(200); // speech has started, the 2 s boundary check has not run
    assert.equal(harness.highlight(), null, 'nothing is highlighted before the first word');

    harness.lastUtterance().onboundary({ name: 'word', charIndex: 6, charLength: 5 });

    assert.notEqual(harness.highlight(), null);
  });

  it('ignores whitespace-only boundary events', () => {
    const harness = createContentHarness();
    read(harness, PAGE_TEXT);
    harness.lastUtterance().onboundary({ name: 'word', charIndex: 6, charLength: 5 });
    const first = harness.highlight();

    harness.lastUtterance().onboundary({ name: 'word', charIndex: 5, charLength: 1 });

    assert.equal(harness.highlight(), first, 'the box must not be redrawn for a space');
  });

  it('ignores boundary events past the end of the text', () => {
    const harness = createContentHarness();
    read(harness, PAGE_TEXT);
    harness.lastUtterance().onboundary({ name: 'word', charIndex: 6, charLength: 5 });
    const first = harness.highlight();

    harness.lastUtterance().onboundary({ name: 'word', charIndex: 99999, charLength: 5 });

    assert.equal(harness.highlight(), first);
  });

  it('treats a missing charLength as one character', () => {
    const harness = createContentHarness();
    read(harness, PAGE_TEXT);

    harness.lastUtterance().onboundary({ name: 'word', charIndex: 0 });

    assert.notEqual(harness.highlight(), null);
  });

  it('does not redraw for text that is not on the page', () => {
    const harness = createContentHarness();
    read(harness, 'This sentence is not present in the document.');
    const fallback = harness.highlight();
    assert.notEqual(fallback, null, 'the fallback box is painted when no boundaries arrive');

    harness.lastUtterance().onboundary({ name: 'word', charIndex: 0, charLength: 4 });

    assert.equal(harness.highlight(), fallback);
    assert.equal(
      harness.send({ action: 'getStatus' }).response.isReading,
      true,
      'playback continues'
    );
  });

  it('paints a fallback box for voices without boundary events', () => {
    const harness = createContentHarness();
    read(harness, PAGE_TEXT);

    // flush() already ran the 2 second boundary check, which found no events.
    assert.notEqual(harness.highlight(), null);
  });

  it('removes the highlight and the marker when the reading ends', () => {
    const harness = createContentHarness();
    read(harness, PAGE_TEXT);
    harness.lastUtterance().onboundary({ name: 'word', charIndex: 0, charLength: 5 });
    assert.notEqual(harness.highlight(), null);
    assert.notEqual(harness.marker(), null);

    harness.lastUtterance().onend();

    assert.equal(harness.highlight(), null);
    assert.equal(harness.marker(), null);
    assert.equal(harness.logs.warn.length, 0, 'no warnings on a normal finish');
  });
});

describe('content script — lifecycle', () => {
  it('ignores events from an utterance that was replaced', () => {
    const harness = createContentHarness();
    read(harness, PAGE_TEXT);
    const first = harness.lastUtterance();

    read(harness, 'A second reading replaces the first.');
    const completions = harness.messages.filter(
      (message) => message.action === 'readingComplete'
    ).length;

    first.onend();
    first.onerror({ error: 'interrupted' });

    assert.equal(
      harness.messages.filter((message) => message.action === 'readingComplete').length,
      completions,
      'the replaced utterance must not report completion'
    );
    assert.equal(harness.send({ action: 'getStatus' }).response.isReading, true);
  });

  it('tells the popup when a reading finishes', () => {
    const harness = createContentHarness();
    read(harness, PAGE_TEXT);

    harness.lastUtterance().onend();

    assert.ok(harness.messages.some((message) => message.action === 'readingComplete'));
    assert.equal(harness.send({ action: 'getStatus' }).response.isReading, false);
  });

  it('stays quiet when the extension context is gone', () => {
    const harness = createContentHarness();
    read(harness, PAGE_TEXT);
    harness.invalidateExtensionContext();
    const before = harness.messages.length;

    harness.lastUtterance().onend();

    assert.equal(harness.messages.length, before);
  });

  it('shows an on-page message when speech fails and stops reading', () => {
    const harness = createContentHarness();
    read(harness, PAGE_TEXT);

    harness.lastUtterance().onerror({ error: 'network' });

    assert.notEqual(harness.toast(), null);
    assert.equal(harness.send({ action: 'getStatus' }).response.isReading, false);
    assert.equal(harness.timers.intervals.length, 0);
  });

  it('removes the on-page message after its timeout', () => {
    const harness = createContentHarness();
    read(harness, PAGE_TEXT);
    harness.lastUtterance().onerror({ error: 'audio-busy' });
    assert.notEqual(harness.toast(), null);

    harness.flush();

    assert.equal(harness.toast(), null);
  });

  it('treats a user cancellation as normal', () => {
    const harness = createContentHarness();
    read(harness, PAGE_TEXT);

    harness.lastUtterance().onerror({ error: 'interrupted' });

    assert.equal(harness.toast(), null, 'no message for an expected stop');
  });

  it('survives a speech error without an error code', () => {
    const harness = createContentHarness();
    read(harness, PAGE_TEXT);
    harness.lastUtterance().onerror({});
    assert.notEqual(harness.toast(), null);
  });
});

describe('content script — tab visibility', () => {
  it('pauses when the tab is hidden and resumes when it returns', () => {
    const harness = createContentHarness();
    read(harness, PAGE_TEXT);

    harness.setHidden(true);
    assert.equal(harness.speechSynthesis.paused, true);
    assert.equal(harness.send({ action: 'getStatus' }).response.isPaused, true);

    harness.setHidden(false);
    assert.equal(harness.speechSynthesis.paused, false);
  });

  it('keeps a pause the user asked for across a tab switch', () => {
    const harness = createContentHarness();
    read(harness, PAGE_TEXT);
    harness.send({ action: 'pause' });

    harness.setHidden(true);
    harness.setHidden(false);

    assert.equal(harness.speechSynthesis.paused, true);
  });

  it('does nothing when the tab becomes visible without an automatic pause', () => {
    const harness = createContentHarness();
    harness.setHidden(false);
    assert.equal(harness.speechSynthesis.paused, false);
  });
});

describe('content script — repeated text on the page', () => {
  const REPEATED = 'The same sentence appears three times on this page.';

  it('highlights the copy that was selected, not an earlier one', () => {
    const harness = createContentHarness();
    const nodes = harness.useRepeatedPage(REPEATED);

    harness.send({ action: 'read', settings: {} });
    harness.flush(200);
    harness.lastUtterance().onboundary({ name: 'word', charIndex: 4, charLength: 4 });

    const range = harness.lastHighlightRange();
    assert.ok(range, 'a highlight range should have been created');
    assert.equal(range.startNode, nodes.middle, 'the middle copy is the one that was selected');
    assert.notEqual(range.startNode, nodes.first);
    assert.notEqual(range.startNode, nodes.last);
  });

  it('stays on the selected copy for later words too', () => {
    const harness = createContentHarness();
    const nodes = harness.useRepeatedPage(REPEATED);

    harness.send({ action: 'read', settings: {} });
    harness.flush(200);

    // Walk through several words, as the boundary events would.
    [0, 4, 9, 18, 25, 32].forEach((charIndex) => {
      harness.lastUtterance().onboundary({ name: 'word', charIndex: charIndex, charLength: 4 });
      const range = harness.lastHighlightRange();
      assert.equal(
        range.startNode,
        nodes.middle,
        'word at ' + charIndex + ' moved to another copy of the text'
      );
    });
  });

  it('maps a word that is split across inline markup', () => {
    const harness = createContentHarness();
    // "Hello world again" with the word "world" split between two nodes.
    const nodes = harness.useInlinePage(['Hello wor', 'ld again']);

    harness.send({ action: 'read', settings: {} });
    harness.flush(200);
    harness.lastUtterance().onboundary({ name: 'word', charIndex: 6, charLength: 5 });

    const range = harness.lastHighlightRange();
    assert.ok(range, 'a highlight range should have been created');
    assert.equal(range.startNode, nodes[0]);
    assert.equal(range.startOffset, 6);
    assert.equal(range.endNode, nodes[1]);
    assert.equal(range.endOffset, 2);
  });
});

describe('content script — following the spoken word', () => {
  const belowTheFold = { left: 10, top: 900, bottom: 930, width: 60, height: 30 };

  function startReading(harness) {
    harness.select(PAGE_TEXT);
    harness.send({ action: 'read', settings: {} });
    harness.flush(200);
  }

  it('scrolls down once when the word is below the viewport', () => {
    const harness = createContentHarness();
    startReading(harness);
    harness.setHighlightRect(belowTheFold);

    harness.lastUtterance().onboundary({ name: 'word', charIndex: 6, charLength: 5 });

    assert.equal(harness.scrollCalls.length, 1);
    assert.equal(harness.scrollCalls[0].top, 900 - 800 * 0.35);
    assert.equal(harness.scrollCalls[0].behavior, 'smooth');
  });

  it('does not scroll again while the words stay visible', () => {
    const harness = createContentHarness();
    startReading(harness);
    harness.setHighlightRect(belowTheFold);
    harness.lastUtterance().onboundary({ name: 'word', charIndex: 6, charLength: 5 });
    assert.equal(harness.scrollCalls.length, 1);

    // The next words are inside the viewport after that scroll.
    harness.setHighlightRect({ left: 10, top: 300, bottom: 330, width: 60, height: 30 });
    harness.lastUtterance().onboundary({ name: 'word', charIndex: 0, charLength: 5 });
    harness.lastUtterance().onboundary({ name: 'word', charIndex: 6, charLength: 5 });

    assert.equal(harness.scrollCalls.length, 1, 'visible words must not move the page');
  });

  it('does not scroll twice towards the same place', () => {
    const harness = createContentHarness();
    startReading(harness);
    harness.setHighlightRect(belowTheFold);

    harness.lastUtterance().onboundary({ name: 'word', charIndex: 6, charLength: 5 });
    harness.lastUtterance().onboundary({ name: 'word', charIndex: 0, charLength: 5 });

    assert.equal(harness.scrollCalls.length, 1, 'the animation is still running');
  });

  it('never scrolls up for a word that is merely near the top', () => {
    const harness = createContentHarness();
    startReading(harness);
    harness.setScrollY(2000);
    harness.setHighlightRect({ left: 10, top: 40, bottom: 70, width: 60, height: 30 });

    harness.lastUtterance().onboundary({ name: 'word', charIndex: 6, charLength: 5 });

    assert.equal(harness.scrollCalls.length, 0);
  });

  it('catches up when the word is completely above the viewport', () => {
    const harness = createContentHarness();
    startReading(harness);
    harness.setScrollY(2000);
    harness.setHighlightRect({ left: 10, top: -200, bottom: -170, width: 60, height: 30 });

    harness.lastUtterance().onboundary({ name: 'word', charIndex: 6, charLength: 5 });

    assert.equal(harness.scrollCalls.length, 1);
    assert.equal(harness.scrollCalls[0].top, 2000 - 200 - 800 * 0.35);
  });

  it('scrolls instantly when the user prefers reduced motion', () => {
    const harness = createContentHarness();
    startReading(harness);
    harness.setReducedMotion(true);
    harness.setHighlightRect(belowTheFold);

    harness.lastUtterance().onboundary({ name: 'word', charIndex: 6, charLength: 5 });

    assert.equal(harness.scrollCalls.length, 1);
    assert.equal(harness.scrollCalls[0].behavior, 'auto');
  });

  it('forgets the last target when a new reading starts', () => {
    const harness = createContentHarness();
    startReading(harness);
    harness.setHighlightRect(belowTheFold);
    harness.lastUtterance().onboundary({ name: 'word', charIndex: 6, charLength: 5 });
    assert.equal(harness.scrollCalls.length, 1);

    harness.send({ action: 'stop' });
    startReading(harness);
    harness.setHighlightRect(belowTheFold);
    harness.lastUtterance().onboundary({ name: 'word', charIndex: 6, charLength: 5 });

    assert.equal(harness.scrollCalls.length, 2, 'a fresh reading may scroll again');
  });
});

describe('content script — very long text', () => {
  it('splits long text, keeps every character and finishes', () => {
    const harness = createContentHarness();
    const longText = 'word '.repeat(9000).trim();
    read(harness, longText);

    let parts = 1;
    while (parts < 40) {
      const before = harness.spoken.length;
      harness.lastUtterance().onend();
      if (harness.spoken.length === before) break;
      parts++;
    }

    assert.ok(parts > 1, 'the text should be split');
    assert.equal(harness.spoken.join(''), longText);
    assert.equal(harness.send({ action: 'getStatus' }).response.isReading, false);
    assert.equal(harness.timers.intervals.length, 0);
  });

  it('keeps the offsets correct across the split', () => {
    const harness = createContentHarness();
    const longText = 'word '.repeat(9000).trim();
    read(harness, longText);

    // The second part starts where the first one ended, so a boundary event in
    // the second part still points at the right characters.
    const firstLength = harness.spoken[0].length;
    harness.lastUtterance().onend();
    const second = harness.lastUtterance();
    assert.equal(second.text.length + firstLength, longText.length);
    assert.equal(second.text[0], longText[firstLength]);
  });
});
