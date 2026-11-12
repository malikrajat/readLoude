/* Read Aloud with Highlight - popup controller.
   The popup only talks to the content script in the active tab; it never reads
   or sends page content anywhere. */

// Pure helpers shared with the content script (see lib/core.js).
const core = window.ReadAloudCore;

// chrome.storage has a write quota (about 120 writes per minute), so slider
// movements are batched before anything is written.
const SAVE_DEBOUNCE_MS = 400;
const INJECTION_SETTLE_MS = 200;
const DEFAULTS = { rate: 0.85, pitch: 1 };

const els = {
  readBtn: document.getElementById('readBtn'),
  pauseBtn: document.getElementById('pauseBtn'),
  stopBtn: document.getElementById('stopBtn'),
  voice: document.getElementById('voice'),
  rate: document.getElementById('rate'),
  rateValue: document.getElementById('rateValue'),
  pitch: document.getElementById('pitch'),
  pitchValue: document.getElementById('pitchValue'),
  status: document.getElementById('status'),
  hint: document.getElementById('hint'),
  voiceWarning: document.getElementById('voiceWarning'),
  presetSlow: document.getElementById('presetSlow'),
  presetNormal: document.getElementById('presetNormal'),
  presetFast: document.getElementById('presetFast')
};

const state = {
  isReading: false,
  isPaused: false
};

let voices = [];
let saveTimer = null;

// Storage helpers ------------------------------------------------------------

function storageArea() {
  // storage.sync needs a signed-in profile in rare setups; local always works.
  if (chrome.storage?.sync) return chrome.storage.sync;
  return chrome.storage.local;
}

async function readStoredSettings() {
  try {
    return (await storageArea().get(['voiceName', 'voiceIndex', 'rate', 'pitch'])) || {};
  } catch (e) {
    console.warn('[Read Aloud] Could not read the saved settings:', e);
    return {};
  }
}

async function writeStoredSettings() {
  try {
    await storageArea().set({
      voiceName: selectedVoiceName(),
      voiceIndex: els.voice.value,
      rate: els.rate.value,
      pitch: els.pitch.value
    });
  } catch (e) {
    // Quota, sync-disabled or extension reload: never break the popup for this.
    console.warn('[Read Aloud] Could not save the settings:', e);
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeStoredSettings();
  }, SAVE_DEBOUNCE_MS);
}

function flushSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  writeStoredSettings();
}

// Voices ---------------------------------------------------------------------

function getVoices() {
  try {
    return speechSynthesis.getVoices() || [];
  } catch (_e) {
    return [];
  }
}

function selectedVoice() {
  const index = Number(els.voice.value);
  return voices[index] || null;
}

function selectedVoiceName() {
  const voice = selectedVoice();
  return voice ? voice.name : '';
}

function renderVoices() {
  voices = getVoices();

  els.voice.innerHTML = '';

  if (voices.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Browser default voice';
    els.voice.appendChild(option);
    els.voice.disabled = true;
    return;
  }

  els.voice.disabled = false;
  voices.forEach((voice, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent =
      voice.name + ' (' + voice.lang + ')' + (voice.localService ? '' : ' - online');
    els.voice.appendChild(option);
  });
}

function updateVoiceWarning() {
  const voice = selectedVoice();
  const show = Boolean(voice && voice.localService !== true);

  els.voiceWarning.classList.toggle('hidden', !show);
  els.voiceWarning.textContent = show
    ? 'This is an online voice: word highlighting will not work and long text may stop early. A voice without "(online)" is recommended.'
    : '';
}

// UI helpers -----------------------------------------------------------------

function showHint(message) {
  if (!message) {
    els.hint.classList.add('hidden');
    els.hint.textContent = '';
    return;
  }
  els.hint.textContent = message;
  els.hint.classList.remove('hidden');
}

function updateStatus(kind) {
  const labels = { reading: 'Reading...', paused: 'Paused', stopped: 'Stopped' };
  els.status.className = 'status ' + (kind || '');
  els.status.textContent = kind ? labels[kind] || '' : '';
}

function applyButtonState() {
  els.pauseBtn.textContent = state.isPaused ? 'Resume' : 'Pause';
  els.pauseBtn.disabled = !state.isReading;
  els.stopBtn.disabled = !state.isReading;
  els.status.className =
    'status ' + (state.isReading ? (state.isPaused ? 'paused' : 'reading') : '');
  els.status.textContent = state.isReading ? (state.isPaused ? 'Paused' : 'Reading...') : '';
}

function setReading(reading, paused) {
  state.isReading = Boolean(reading);
  state.isPaused = Boolean(paused);
  applyButtonState();
}

function showStoppedBriefly() {
  setReading(false, false);
  updateStatus('stopped');
  setTimeout(() => {
    if (!state.isReading) updateStatus('');
  }, 2000);
}

// Tabs and messaging ---------------------------------------------------------

async function getActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs?.[0] ? tabs[0] : null;
  } catch (e) {
    console.warn('[Read Aloud] Could not query the active tab:', e);
    return null;
  }
}

/** Sends a message to the content script. Returns null when it is not there. */
async function sendToTab(tabId, message) {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) || null;
  } catch (_e) {
    return null; // No receiver: the content script is not injected yet
  }
}

async function captureSelection(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return null;
        const range = selection.getRangeAt(0);
        return {
          text: selection.toString(),
          startContainer:
            range.startContainer.nodeType === Node.TEXT_NODE
              ? range.startContainer.textContent
              : null,
          startOffset: range.startOffset,
          endOffset: range.endOffset
        };
      }
    });
    return results?.[0] ? results[0].result : null;
  } catch (e) {
    console.warn('[Read Aloud] Could not capture the selection:', e);
    return null;
  }
}

async function injectContentScripts(tabId) {
  try {
    // lib/core.js must be injected before content.js, exactly like in the manifest.
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['lib/core.js', 'content.js']
    });
    await chrome.scripting.insertCSS({ target: { tabId: tabId }, files: ['content.css'] });
    await new Promise((resolve) => setTimeout(resolve, INJECTION_SETTLE_MS));
    return true;
  } catch (e) {
    console.warn('[Read Aloud] Could not inject the content script:', e);
    showHint(
      'This page could not be opened for reading (' +
        e.message +
        '). ' +
        'For local files, enable "Allow access to file URLs" on the extension card in chrome://extensions.'
    );
    return false;
  }
}

// Settings -------------------------------------------------------------------

function applyRate(value) {
  els.rate.value = String(value);
  els.rateValue.textContent = String(value);
}

function applyPitch(value) {
  els.pitch.value = String(value);
  els.pitchValue.textContent = String(value);
}

async function restoreSettings() {
  const stored = await readStoredSettings();

  // Voices are matched by name: their order can change between sessions.
  let voiceIndex = -1;
  if (stored.voiceName) {
    voiceIndex = core.findVoiceIndexByName(voices, stored.voiceName);
  } else if (stored.voiceIndex !== undefined && stored.voiceIndex !== '') {
    const legacyIndex = Number(stored.voiceIndex);
    if (Number.isInteger(legacyIndex) && legacyIndex >= 0 && legacyIndex < voices.length) {
      voiceIndex = legacyIndex; // Settings saved by an older version
    }
  }
  if (voiceIndex === -1) voiceIndex = core.findDefaultVoiceIndex(voices);
  if (voices.length) els.voice.value = String(voiceIndex);

  const storedRate = parseFloat(stored.rate);
  applyRate(Number.isFinite(storedRate) ? storedRate : DEFAULTS.rate);

  const storedPitch = parseFloat(stored.pitch);
  applyPitch(Number.isFinite(storedPitch) ? storedPitch : DEFAULTS.pitch);

  updateVoiceWarning();
}

function currentSettings() {
  return {
    voice: selectedVoiceName() || null,
    rate: parseFloat(els.rate.value) || DEFAULTS.rate,
    pitch: parseFloat(els.pitch.value) || DEFAULTS.pitch
  };
}

// Actions --------------------------------------------------------------------

async function startReading() {
  const tab = await getActiveTab();
  if (!tab || typeof tab.id !== 'number') {
    showHint('No active tab found.');
    return;
  }

  const blocked = core.blockedPageReason(tab.url);
  if (blocked) {
    showHint(blocked);
    return;
  }

  showHint('');
  const settings = currentSettings();
  const selectionData = await captureSelection(tab.id);

  let response = await sendToTab(tab.id, {
    action: 'read',
    settings: settings,
    selectionData: selectionData
  });

  if (!response) {
    // The page was already open before the extension was installed.
    const injected = await injectContentScripts(tab.id);
    if (!injected) return;
    response = await sendToTab(tab.id, {
      action: 'read',
      settings: settings,
      selectionData: selectionData
    });
  }

  if (response?.success) {
    setReading(true, false);
    return;
  }

  showHint(core.messageForErrorCode(response ? response.error : undefined));
}

async function togglePause() {
  const tab = await getActiveTab();
  if (!tab || typeof tab.id !== 'number') return;

  const action = state.isPaused ? 'resume' : 'pause';
  const response = await sendToTab(tab.id, { action: action });

  if (response?.success) {
    setReading(true, action === 'pause');
  } else if (response === null) {
    setReading(false, false);
    showHint('The page changed. Select the text again and press Read.');
  }
}

async function stopReading() {
  const tab = await getActiveTab();
  if (tab && typeof tab.id === 'number') {
    await sendToTab(tab.id, { action: 'stop' });
  }
  showStoppedBriefly();
  showHint('');
}

async function refreshStatus() {
  const tab = await getActiveTab();
  if (!tab || typeof tab.id !== 'number') {
    showHint('No active tab found.');
    return;
  }

  const blocked = core.blockedPageReason(tab.url);
  if (blocked) {
    els.readBtn.disabled = true;
    showHint(blocked);
    return;
  }

  els.readBtn.disabled = false;
  const response = await sendToTab(tab.id, { action: 'getStatus' });
  if (response?.isReading) {
    setReading(true, Boolean(response.isPaused));
  } else {
    setReading(false, false);
  }
}

// Wiring ---------------------------------------------------------------------

function bindEvents() {
  els.readBtn.addEventListener('click', () => {
    const run = state.isPaused ? togglePause() : startReading();
    run.catch((error) => {
      console.error('[Read Aloud]', error);
      showHint('Unexpected error: ' + error.message);
    });
  });

  els.pauseBtn.addEventListener('click', () => {
    togglePause().catch((error) => {
      console.error('[Read Aloud]', error);
      showHint('Unexpected error: ' + error.message);
    });
  });

  els.stopBtn.addEventListener('click', () => {
    stopReading().catch((error) => {
      console.error('[Read Aloud]', error);
    });
  });

  els.rate.addEventListener('input', () => {
    els.rateValue.textContent = els.rate.value;
    scheduleSave();
  });

  els.pitch.addEventListener('input', () => {
    els.pitchValue.textContent = els.pitch.value;
    scheduleSave();
  });

  els.voice.addEventListener('change', () => {
    updateVoiceWarning();
    scheduleSave();
  });

  els.presetSlow.addEventListener('click', () => applyPreset(core.PRESETS.slow));
  els.presetNormal.addEventListener('click', () => applyPreset(core.PRESETS.normal));
  els.presetFast.addEventListener('click', () => applyPreset(core.PRESETS.fast));

  // Saving must not be lost when the popup closes right after a change.
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushSave();
  });

  // The content script tells us when playback ends on its own.
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.action === 'readingComplete') {
      showStoppedBriefly();
    }
    return false;
  });
}

function applyPreset(preset) {
  applyRate(preset.rate);
  applyPitch(preset.pitch);
  scheduleSave();
}

async function init() {
  bindEvents();

  renderVoices();
  await restoreSettings();

  // Voices load asynchronously in Chrome, so refresh once they are ready.
  try {
    speechSynthesis.addEventListener('voiceschanged', async () => {
      const previous = selectedVoiceName();
      renderVoices();
      const stillThere = voices.findIndex((voice) => voice.name === previous);
      if (stillThere !== -1) {
        els.voice.value = String(stillThere);
      } else {
        await restoreSettings();
      }
      updateVoiceWarning();
    });
  } catch (e) {
    console.warn('[Read Aloud] Could not listen for voice changes:', e);
  }

  await refreshStatus();
}

init().catch((error) => {
  console.error('[Read Aloud] Popup failed to initialise:', error);
  showHint('The extension could not start: ' + error.message);
});
