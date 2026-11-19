// Read Aloud with Highlight - background service worker (Manifest V3).
//
// The extension does not need a persistent background page: the popup talks to
// the content script of the active tab directly, so this worker is expected to
// go idle. It only performs a little housekeeping on install and update.

const DEFAULT_SETTINGS = { rate: '0.85', pitch: '1' };

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    // Seed the documented defaults so the popup never shows empty controls.
    const stored = (await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS))) || {};
    const missing = {};

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (stored[key] === undefined) missing[key] = value;
    }

    if (Object.keys(missing).length > 0) {
      await chrome.storage.sync.set(missing);
    }

    console.info(
      '[Read Aloud] ' +
        (details.reason === 'install' ? 'Installed' : 'Updated') +
        ' version ' +
        chrome.runtime.getManifest().version
    );
  } catch (e) {
    // Storage can be unavailable in managed profiles; the extension still works.
    console.warn('[Read Aloud] Could not prepare the default settings:', e);
  }
});
