// Unit tests for lib/core.js: the pure decision making, with no DOM involved.
// These run in milliseconds and cover the rules that used to be spread across
// the content script and the popup.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const core = require('../lib/core.js');

describe('clamp', () => {
  it('keeps values inside the range', () => {
    assert.equal(core.clamp(1, 0.5, 2, 1), 1);
  });

  it('raises values below the minimum', () => {
    assert.equal(core.clamp(0.1, 0.5, 2, 1), 0.5);
  });

  it('lowers values above the maximum', () => {
    assert.equal(core.clamp(50, 0.5, 2, 1), 2);
  });

  it('accepts numeric strings', () => {
    assert.equal(core.clamp('1.25', 0.5, 2, 1), 1.25);
  });

  it('falls back for values that are not numbers', () => {
    [undefined, null, '', 'abc', Number.NaN, {}, []].forEach((value) => {
      assert.equal(core.clamp(value, 0.5, 2, 0.85), 0.85, 'value: ' + String(value));
    });
  });
});

describe('normalizeSettings', () => {
  it('uses the documented defaults for empty input', () => {
    assert.deepEqual(core.normalizeSettings({}), { voice: null, rate: 0.85, pitch: 1 });
    assert.deepEqual(core.normalizeSettings(undefined), { voice: null, rate: 0.85, pitch: 1 });
    assert.deepEqual(core.normalizeSettings(null), { voice: null, rate: 0.85, pitch: 1 });
    assert.deepEqual(core.normalizeSettings('nonsense'), {
      voice: null,
      rate: 0.85,
      pitch: 1
    });
  });

  it('clamps a rate that would make Chrome throw', () => {
    assert.equal(core.normalizeSettings({ rate: 5 }).rate, 2);
    assert.equal(core.normalizeSettings({ rate: 0 }).rate, 0.5);
    assert.equal(core.normalizeSettings({ rate: 'abc' }).rate, 0.85);
  });

  it('clamps pitch independently of rate', () => {
    assert.equal(core.normalizeSettings({ rate: 1, pitch: 99 }).pitch, 2);
    assert.equal(core.normalizeSettings({ pitch: -3 }).pitch, 0.5);
  });

  it('keeps a real voice name and drops an empty one', () => {
    assert.equal(core.normalizeSettings({ voice: 'Microsoft Ravi' }).voice, 'Microsoft Ravi');
    assert.equal(core.normalizeSettings({ voice: '' }).voice, null);
    assert.equal(core.normalizeSettings({ voice: 42 }).voice, null);
  });
});

describe('buildSpeechChunks', () => {
  it('returns the text unchanged when it is short enough', () => {
    assert.deepEqual(core.buildSpeechChunks('Short text.'), [{ text: 'Short text.', start: 0 }]);
  });

  it('handles empty and non string input', () => {
    assert.deepEqual(core.buildSpeechChunks(''), [{ text: '', start: 0 }]);
    assert.deepEqual(core.buildSpeechChunks(undefined), [{ text: '', start: 0 }]);
    assert.deepEqual(core.buildSpeechChunks(null), [{ text: '', start: 0 }]);
  });

  it('keeps a text of exactly the limit in one piece', () => {
    const text = 'a'.repeat(core.MAX_UTTERANCE_LENGTH);
    assert.equal(core.buildSpeechChunks(text).length, 1);
  });

  it('splits on sentence boundaries when it can', () => {
    const text = 'Read this. Then that. Finally done.';
    const chunks = core.buildSpeechChunks(text, 16);
    assert.equal(chunks.length, 3);
    // The cut happens after the full stop, so each part starts before the space
    // that follows it.
    assert.equal(chunks[0].text, 'Read this.');
    assert.equal(chunks[1].text, ' Then that.');
    assert.equal(chunks[2].text, ' Finally done.');
  });

  it('records the offset of every part', () => {
    const text = 'Read this. Then that. Finally done.';
    const chunks = core.buildSpeechChunks(text, 16);
    assert.equal(chunks[0].start, 0);
    assert.equal(chunks[1].start, 10);
    assert.equal(chunks[2].start, 21);
  });

  it('falls back to a word boundary when there is no sentence end', () => {
    const chunks = core.buildSpeechChunks('alpha beta gamma delta', 10);
    assert.equal(chunks[0].text, 'alpha ');
  });

  it('still makes progress when there are no spaces at all', () => {
    const text = 'x'.repeat(25);
    const chunks = core.buildSpeechChunks(text, 10);
    assert.deepEqual(
      chunks.map((chunk) => chunk.text.length),
      [10, 10, 5]
    );
  });

  it('never breaks on newlines', () => {
    const text = 'line one\nline two\nline three';
    const chunks = core.buildSpeechChunks(text, 12);
    assert.equal(chunks.map((chunk) => chunk.text).join(''), text);
  });

  // The invariant that matters: a split must never drop or duplicate text,
  // because the highlight offsets are computed from the original string.
  const samples = {
    'repeated words': 'word '.repeat(9000).trim(),
    sentences: 'This is sentence number one. '.repeat(400),
    'no spaces': 'y'.repeat(45000),
    'mixed unicode': 'देवनागरी पाठ। '.repeat(500),
    'emoji and symbols': '😀 reading aloud — 100% fun! '.repeat(500),
    'trailing space': 'alpha beta gamma '.repeat(2000),
    'windows newlines': 'first line\r\nsecond line\r\n'.repeat(1000)
  };

  Object.entries(samples).forEach(([name, text]) => {
    it('keeps every character for ' + name, () => {
      const chunks = core.buildSpeechChunks(text);
      assert.equal(chunks.map((chunk) => chunk.text).join(''), text);
      chunks.forEach((chunk) => {
        assert.ok(chunk.text.length > 0, 'chunk is empty');
        assert.ok(chunk.text.length <= core.MAX_UTTERANCE_LENGTH, 'chunk is longer than the limit');
      });
      // Offsets must be the running total.
      let expected = 0;
      chunks.forEach((chunk) => {
        assert.equal(chunk.start, expected);
        expected += chunk.text.length;
      });
    });
  });

  it('splits a long text into a small number of parts', () => {
    const chunks = core.buildSpeechChunks('word '.repeat(9000).trim());
    assert.ok(chunks.length >= 2 && chunks.length <= 3, 'got ' + chunks.length);
  });
});

describe('isReadableText', () => {
  it('accepts real text', () => {
    assert.equal(core.isReadableText('a'), true);
    assert.equal(core.isReadableText('  hello  '), true);
  });

  it('rejects everything else', () => {
    ['', '   ', '\n\t ', undefined, null, 42, {}].forEach((value) => {
      assert.equal(core.isReadableText(value), false, 'value: ' + String(value));
    });
  });
});

describe('blockedPageReason', () => {
  it('allows normal pages', () => {
    assert.equal(core.blockedPageReason('https://example.com/article'), null);
    assert.equal(core.blockedPageReason('http://localhost:3000/'), null);
  });

  it('allows file URLs so the injection step can explain the permission', () => {
    assert.equal(core.blockedPageReason('file:///C:/page.html'), null);
  });

  it('blocks browser pages', () => {
    [
      'chrome://extensions',
      'chrome-extension://abc/popup.html',
      'chrome-untrusted://print',
      'devtools://devtools/bundled/',
      'about:blank',
      'edge://settings',
      'view-source:https://example.com',
      'data:text/html,hello',
      'blob:https://example.com/1234'
    ].forEach((url) => {
      const reason = core.blockedPageReason(url);
      assert.equal(typeof reason, 'string', url + ' should be blocked');
    });
  });

  it('is case insensitive', () => {
    assert.equal(typeof core.blockedPageReason('CHROME://EXTENSIONS'), 'string');
  });

  it('blocks the Web Store', () => {
    assert.equal(
      typeof core.blockedPageReason('https://chromewebstore.google.com/detail/read-aloud/abc'),
      'string'
    );
    assert.equal(
      typeof core.blockedPageReason('https://chrome.google.com/webstore/detail/abc'),
      'string'
    );
  });

  it('blocks a tab without a URL', () => {
    assert.equal(typeof core.blockedPageReason(undefined), 'string');
    assert.equal(typeof core.blockedPageReason(''), 'string');
    assert.equal(typeof core.blockedPageReason(null), 'string');
  });
});

describe('messageForErrorCode', () => {
  it('explains an empty selection', () => {
    assert.match(core.messageForErrorCode('no-text'), /Select some text/);
  });

  it('explains missing speech support', () => {
    assert.match(core.messageForErrorCode('unsupported'), /speech synthesis/);
  });

  it('explains an unexpected failure', () => {
    assert.match(core.messageForErrorCode('unexpected'), /Reload the page/);
  });

  it('falls back for unknown or missing codes', () => {
    assert.match(core.messageForErrorCode('who-knows'), /Reload the page/);
    assert.match(core.messageForErrorCode(undefined), /Reload the page/);
  });
});

describe('findDefaultVoiceIndex', () => {
  const localIndia = { name: 'Microsoft Ravi', lang: 'en-IN', localService: true };
  const localEnglish = { name: 'Microsoft David', lang: 'en-US', localService: true };
  const localOther = { name: 'Anna', lang: 'de-DE', localService: true };
  const onlineEnglish = { name: 'Google US English', lang: 'en-US', localService: false };

  it('prefers a local Indian English voice', () => {
    assert.equal(core.findDefaultVoiceIndex([onlineEnglish, localEnglish, localIndia]), 2);
  });

  it('falls back to a local English voice', () => {
    assert.equal(core.findDefaultVoiceIndex([onlineEnglish, localEnglish]), 1);
  });

  it('falls back to any local voice', () => {
    assert.equal(core.findDefaultVoiceIndex([onlineEnglish, localOther]), 1);
  });

  it('uses the first voice when everything is online', () => {
    assert.equal(core.findDefaultVoiceIndex([onlineEnglish]), 0);
  });

  it('returns -1 when there are no voices', () => {
    assert.equal(core.findDefaultVoiceIndex([]), -1);
    assert.equal(core.findDefaultVoiceIndex(undefined), -1);
  });

  it('survives a malformed voice list', () => {
    assert.equal(core.findDefaultVoiceIndex([null, undefined, localEnglish]), 2);
    assert.equal(core.findDefaultVoiceIndex([{}]), 0);
  });
});

describe('findVoiceIndexByName', () => {
  const voices = [{ name: 'A' }, { name: 'B' }];

  it('finds the voice even when the order changed', () => {
    assert.equal(core.findVoiceIndexByName(voices, 'B'), 1);
    assert.equal(core.findVoiceIndexByName([{ name: 'B' }, { name: 'A' }], 'B'), 0);
  });

  it('returns -1 when the voice is gone', () => {
    assert.equal(core.findVoiceIndexByName(voices, 'Removed Voice'), -1);
    assert.equal(core.findVoiceIndexByName(voices, ''), -1);
    assert.equal(core.findVoiceIndexByName(undefined, 'A'), -1);
  });
});

describe('presets', () => {
  it('keeps every preset inside the ranges Chrome accepts', () => {
    Object.entries(core.PRESETS).forEach(([name, preset]) => {
      assert.ok(preset.rate >= core.RATE.min && preset.rate <= core.RATE.max, name + ' rate');
      assert.ok(preset.pitch >= core.PITCH.min && preset.pitch <= core.PITCH.max, name + ' pitch');
    });
  });

  it('orders the presets from slow to fast', () => {
    assert.ok(core.PRESETS.slow.rate < core.PRESETS.normal.rate);
    assert.ok(core.PRESETS.normal.rate < core.PRESETS.fast.rate);
  });
});

describe('findTextPosition', () => {
  // Three text nodes: "Hello " (6), "world " (6), "again" (5) = 17 characters.
  const entries = [
    { node: 'a', start: 0, end: 6, dataStart: 0 },
    { node: 'b', start: 6, end: 12, dataStart: 0 },
    { node: 'c', start: 12, end: 17, dataStart: 0 }
  ];

  it('finds an offset in the first entry', () => {
    assert.deepEqual(core.findTextPosition(entries, 0), { index: 0, offsetInEntry: 0 });
    assert.deepEqual(core.findTextPosition(entries, 5), { index: 0, offsetInEntry: 5 });
  });

  it('finds the exact boundary between entries', () => {
    assert.deepEqual(core.findTextPosition(entries, 6), { index: 1, offsetInEntry: 0 });
    assert.deepEqual(core.findTextPosition(entries, 11), { index: 1, offsetInEntry: 5 });
    assert.deepEqual(core.findTextPosition(entries, 12), { index: 2, offsetInEntry: 0 });
  });

  it('finds an offset in the last entry', () => {
    assert.deepEqual(core.findTextPosition(entries, 16), { index: 2, offsetInEntry: 4 });
  });

  it('returns null past the end of the text', () => {
    assert.equal(core.findTextPosition(entries, 17), null);
    assert.equal(core.findTextPosition(entries, 999), null);
  });

  it('returns null for invalid input', () => {
    assert.equal(core.findTextPosition(entries, -1), null);
    assert.equal(core.findTextPosition(entries, Number.NaN), null);
    assert.equal(core.findTextPosition([], 0), null);
    assert.equal(core.findTextPosition(undefined, 0), null);
  });

  it('handles a single entry', () => {
    const single = [{ node: 'a', start: 0, end: 3, dataStart: 0 }];
    assert.deepEqual(core.findTextPosition(single, 2), { index: 0, offsetInEntry: 2 });
    assert.equal(core.findTextPosition(single, 3), null);
  });

  it('stays correct when a node starts part way in', () => {
    const partial = [{ node: 'a', start: 0, end: 4, dataStart: 10 }];
    assert.deepEqual(core.findTextPosition(partial, 1), { index: 0, offsetInEntry: 1 });
  });
});

describe('planScroll', () => {
  const viewport = { height: 800 };

  it('does not scroll when the word is comfortably visible', () => {
    const plan = core.planScroll({ top: 300, bottom: 330 }, viewport, 1000);
    assert.equal(plan.scroll, false);
    assert.equal(plan.top, 1000);
  });

  it('scrolls down when the word is below the fold', () => {
    const plan = core.planScroll({ top: 900, bottom: 930 }, viewport, 0);
    assert.equal(plan.scroll, true);
    assert.equal(plan.direction, 'down');
    // The word is anchored at 35% of the viewport, leaving room for the lines
    // that follow, so the next words do not need another scroll.
    assert.equal(plan.top, 900 - 800 * 0.35);
  });

  it('does not scroll when the word is just below the margin', () => {
    const plan = core.planScroll({ top: 20, bottom: 40 }, viewport, 0);
    assert.equal(plan.scroll, false);
  });

  it('never scrolls up for a word in the upper half of the viewport', () => {
    const plan = core.planScroll({ top: 40, bottom: 70 }, viewport, 500);
    assert.equal(plan.scroll, false);
  });

  it('scrolls up only when the word is completely above the viewport', () => {
    const plan = core.planScroll({ top: -200, bottom: -170 }, viewport, 2000);
    assert.equal(plan.scroll, true);
    assert.equal(plan.direction, 'up');
    assert.equal(plan.top, 2000 - 200 - 800 * 0.35);
  });

  it('does not scroll when the word is at the very bottom but still visible', () => {
    const plan = core.planScroll({ top: 645, bottom: 675 }, viewport, 0);
    assert.equal(plan.scroll, false, '675 is still inside the 680 margin');
  });

  it('scrolls once the word crosses the margin', () => {
    const plan = core.planScroll({ top: 700, bottom: 730 }, viewport, 0);
    assert.equal(plan.scroll, true);
    assert.equal(plan.direction, 'down');
  });

  it('never produces a negative scroll position', () => {
    // Scrolled away from a word that is now above the viewport, close enough to
    // the top of the document that the anchor would be negative.
    const plan = core.planScroll({ top: -200, bottom: -170 }, viewport, 100);
    assert.equal(plan.scroll, true);
    assert.equal(plan.top, 0);
  });

  it('does not scroll when the top of the page is already reached', () => {
    const plan = core.planScroll({ top: -100, bottom: -70 }, viewport, 0);
    assert.equal(plan.scroll, false);
  });

  it('does nothing for a hidden element or a broken viewport', () => {
    assert.equal(core.planScroll({ top: 900, bottom: 900 }, viewport, 0).scroll, false);
    assert.equal(core.planScroll(null, viewport, 0).scroll, false);
    assert.equal(core.planScroll({ top: 900, bottom: 930 }, { height: 0 }, 0).scroll, false);
    assert.equal(core.planScroll({ top: 900, bottom: 930 }, null, 0).scroll, false);
  });

  it('clamps the margin on very short viewports', () => {
    // With a 120px viewport the margin has to shrink, otherwise every word
    // would count as "below the fold".
    const inside = core.planScroll({ top: 40, bottom: 60 }, { height: 120 }, 0);
    assert.equal(inside.scroll, false);

    const outside = core.planScroll({ top: 100, bottom: 120 }, { height: 120 }, 0);
    assert.equal(outside.scroll, true);
  });

  it('keeps the word visible across a long reading', () => {
    // Simulates following a word down the page: after each scroll the word must
    // end up inside the viewport and no further scroll is needed for it.
    let scrollY = 0;
    for (let documentTop = 0; documentTop < 6000; documentTop += 60) {
      const rect = { top: documentTop - scrollY, bottom: documentTop - scrollY + 30 };
      const plan = core.planScroll(rect, viewport, scrollY);
      if (plan.scroll) {
        assert.equal(plan.direction, 'down', 'the reading only moves forward');
        scrollY = plan.top;
        const after = { top: documentTop - scrollY, bottom: documentTop - scrollY + 30 };
        assert.ok(after.bottom <= 800 && after.top >= 0, 'word landed outside the viewport');
      }
    }
  });
});

describe('isSameScrollTarget', () => {
  it('treats close targets as the same', () => {
    assert.equal(core.isSameScrollTarget(1000, 1008), true);
    assert.equal(core.isSameScrollTarget(1000, 1030), false);
  });

  it('treats unusable numbers as the same, so no scroll happens', () => {
    assert.equal(core.isSameScrollTarget(Number.NaN, 10), true);
    assert.equal(core.isSameScrollTarget(undefined, 10), true);
  });
});
