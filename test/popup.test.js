// Behaviour tests for popup.js, the toolbar popup controller, driven through
// the fake DOM and a fake chrome.* API.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createPopupHarness } = require('./helpers/harness');

describe('popup — initial state', () => {
  it('builds one option per installed voice', async () => {
    const harness = createPopupHarness();
    await harness.ready();

    assert.equal(harness.el('voice').children.length, 2);
  });

  it('prefers a local voice over an online one', async () => {
    const harness = createPopupHarness();
    await harness.ready();

    // Index 1 is the local voice in the default fixture.
    assert.equal(harness.el('voice').value, '1');
    assert.equal(harness.el('voiceWarning').classList.contains('hidden'), true);
  });

  it('warns when the selected voice is an online voice', async () => {
    const harness = createPopupHarness({ stored: { voiceName: 'Google US English' } });
    await harness.ready();

    assert.equal(harness.el('voice').value, '0');
    assert.equal(harness.el('voiceWarning').classList.contains('hidden'), false);
    assert.match(harness.el('voiceWarning').textContent, /online/);
  });

  it('enables Read on a normal page and hides the hint', async () => {
    const harness = createPopupHarness();
    await harness.ready();

    assert.equal(harness.el('readBtn').disabled, false);
    assert.equal(harness.el('hint').classList.contains('hidden'), true);
    assert.equal(harness.el('pauseBtn').disabled, true);
    assert.equal(harness.el('stopBtn').disabled, true);
  });

  it('asks the content script for the reading state when it opens', async () => {
    const harness = createPopupHarness();
    await harness.ready();

    assert.ok(harness.sentMessages.some((message) => message.action === 'getStatus'));
  });

  it('disables Read on chrome:// pages and explains why', async () => {
    const harness = createPopupHarness();
    harness.state.tab = { id: 9, url: 'chrome://extensions' };
    await harness.ready();
    await harness.run('refreshStatus()');
    await harness.settle();

    assert.equal(harness.el('readBtn').disabled, true);
    assert.equal(harness.el('hint').classList.contains('hidden'), false);
    assert.match(harness.el('hint').textContent, /Chrome does not allow/);
  });

  it('lets file URLs through to the injection step', async () => {
    const harness = createPopupHarness();
    harness.state.tab = { id: 9, url: 'file:///C:/page.html' };
    await harness.ready();
    await harness.run('refreshStatus()');
    await harness.settle();

    assert.equal(harness.el('readBtn').disabled, false);
  });

  it('shows a placeholder and no voice name when nothing is installed', async () => {
    const harness = createPopupHarness({ voices: [] });
    await harness.ready();

    assert.equal(harness.el('voice').children.length, 1);
    assert.equal(harness.el('voice').disabled, true);
    assert.equal(harness.run('currentSettings().voice'), null);
  });

  it('falls back to a local voice when the saved voice is gone', async () => {
    const harness = createPopupHarness({ stored: { voiceName: 'Removed Voice' } });
    await harness.ready();

    assert.equal(harness.el('voice').value, '1');
  });
});

describe('popup — settings', () => {
  it('does not write on every slider movement', async () => {
    const harness = createPopupHarness();
    await harness.ready();

    harness.input('rate');
    harness.input('rate');
    harness.input('rate');

    assert.equal(harness.stored.rate, undefined, 'nothing written before the debounce');
  });

  it('writes the settings once after the debounce', async () => {
    const harness = createPopupHarness();
    await harness.ready();
    harness.el('rate').value = '1.25';

    harness.input('rate');
    harness.timers.flush();
    await harness.settle();

    assert.equal(harness.stored.rate, '1.25');
    assert.equal(harness.stored.pitch, '1');
    assert.equal(harness.stored.voiceName, 'Microsoft David');
  });

  it('writes a pending change when the popup closes', async () => {
    const harness = createPopupHarness();
    await harness.ready();
    harness.el('rate').value = '1.2';

    harness.input('rate');
    assert.equal(harness.stored.rate, undefined);

    harness.windowListeners.pagehide();
    await harness.settle();

    assert.equal(harness.stored.rate, '1.2');
  });

  it('applies the presets', async () => {
    const harness = createPopupHarness();
    await harness.ready();

    await harness.click('presetSlow');
    assert.equal(harness.el('rate').value, '0.8');
    assert.equal(harness.el('rateValue').textContent, '0.8');

    await harness.click('presetFast');
    assert.equal(harness.el('rate').value, '1.1');
    assert.equal(harness.el('pitch').value, '1');
  });

  it('uses the defaults when the stored settings cannot be read', async () => {
    const harness = createPopupHarness();
    await harness.ready();

    harness.breakStorage('get');
    await harness.run('restoreSettings()');
    await harness.settle();

    assert.equal(harness.el('rate').value, '0.85');
    assert.equal(harness.el('pitch').value, '1');
    assert.ok(
      harness.logs.warn.some((line) => line.includes('Could not read the saved settings')),
      'the failure should be reported'
    );
  });

  it('survives a settings write that is rejected', async () => {
    const harness = createPopupHarness();
    await harness.ready();

    harness.breakStorage('set');
    harness.input('rate');
    harness.timers.flush();
    await harness.settle();

    assert.ok(
      harness.logs.warn.some((line) => line.includes('Could not save the settings')),
      'the failure should be reported'
    );
  });
});

describe('popup — reading', () => {
  it('sends a read request with the current settings', async () => {
    const harness = createPopupHarness();
    await harness.ready();
    harness.el('rate').value = '1.4';
    harness.el('pitch').value = '0.9';

    await harness.click('readBtn');

    const request = harness.sentMessages.find((message) => message.action === 'read');
    assert.ok(request, 'a read message should be sent');
    assert.equal(request.settings.rate, 1.4);
    assert.equal(request.settings.pitch, 0.9);
    assert.equal(request.settings.voice, 'Microsoft David');
  });

  it('enables Pause and Stop while reading', async () => {
    const harness = createPopupHarness();
    await harness.ready();

    await harness.click('readBtn');

    assert.equal(harness.el('pauseBtn').disabled, false);
    assert.equal(harness.el('stopBtn').disabled, false);
    assert.match(harness.el('status').textContent, /Reading/);
  });

  it('toggles to Resume', async () => {
    const harness = createPopupHarness();
    await harness.ready();
    await harness.click('readBtn');

    await harness.click('pauseBtn');

    assert.ok(harness.sentMessages.some((message) => message.action === 'pause'));
    assert.equal(harness.el('pauseBtn').textContent, 'Resume');
    assert.match(harness.el('status').textContent, /Paused/);
  });

  it('sends a stop request and disables the buttons', async () => {
    const harness = createPopupHarness();
    await harness.ready();
    await harness.click('readBtn');

    await harness.click('stopBtn');

    assert.ok(harness.sentMessages.some((message) => message.action === 'stop'));
    assert.equal(harness.el('pauseBtn').disabled, true);
    assert.equal(harness.el('stopBtn').disabled, true);
  });

  it('resets the buttons when the content script reports completion', async () => {
    const harness = createPopupHarness();
    await harness.ready();
    await harness.click('readBtn');

    harness.runtimeListeners.forEach((listener) => {
      listener({ action: 'readingComplete' });
    });

    assert.equal(harness.el('pauseBtn').disabled, true);
    assert.equal(harness.el('status').textContent, 'Stopped');
  });

  it('injects the reader when the content script is missing, then retries', async () => {
    const harness = createPopupHarness();
    await harness.ready();
    const before = harness.state.injections;
    harness.state.failReadOnce = true;

    await harness.clickAndFlush('readBtn');

    assert.ok(harness.state.injections > before, 'the scripts should be injected');
    assert.equal(harness.el('pauseBtn').disabled, false, 'the retry should start reading');
    assert.equal(
      harness.sentMessages.filter((message) => message.action === 'read').length,
      2,
      'the read request is retried once'
    );
  });

  it('explains a refused injection', async () => {
    const harness = createPopupHarness();
    await harness.ready();
    harness.state.failReadOnce = true;
    harness.state.failInjection = true;

    await harness.clickAndFlush('readBtn');

    assert.match(harness.el('hint').textContent, /file URLs/);
    assert.equal(harness.el('pauseBtn').disabled, true, 'nothing should be playing');
  });

  it('recovers when the page changes under it', async () => {
    const harness = createPopupHarness();
    await harness.ready();
    await harness.click('readBtn');

    harness.sandbox.chrome.tabs.sendMessage = async () => {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    };
    await harness.click('stopBtn');

    assert.equal(harness.el('pauseBtn').disabled, true);
  });
});

describe('popup — error messages', () => {
  const cases = [
    ['no-text', /Select/],
    ['unsupported', /speech synthesis/],
    ['unexpected', /Reload the page/],
    ['something-else', /Could not start reading/]
  ];

  cases.forEach(([code, pattern]) => {
    it('explains the "' + code + '" error code', async () => {
      const harness = createPopupHarness();
      await harness.ready();
      harness.state.readResponse = { success: false, error: code };

      await harness.click('readBtn');

      assert.match(harness.el('hint').textContent, pattern);
      assert.equal(harness.el('pauseBtn').disabled, true);
    });
  });

  it('reports when there is no active tab', async () => {
    const harness = createPopupHarness();
    await harness.ready();
    harness.sandbox.chrome.tabs.query = async () => [];

    await harness.click('readBtn');

    assert.match(harness.el('hint').textContent, /No active tab/);
  });
});
