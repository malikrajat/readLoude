let isReading = false;
let isPaused = false;

const readBtn = document.getElementById('readBtn');
const pauseBtn = document.getElementById('pauseBtn');
const stopBtn = document.getElementById('stopBtn');
const voiceSelect = document.getElementById('voice');
const rateInput = document.getElementById('rate');
const pitchInput = document.getElementById('pitch');
const rateValue = document.getElementById('rateValue');
const pitchValue = document.getElementById('pitchValue');
const statusDiv = document.getElementById('status');

// Load saved settings with better defaults for Indian English
function loadSettings() {
  chrome.storage.sync.get(['voiceIndex', 'rate', 'pitch'], (result) => {
    if (result.voiceIndex !== undefined) {
      voiceSelect.value = result.voiceIndex;
    } else {
      // Important: We MUST use localService === true (offline voices). 
      // Online/Neural voices (like Google's) do NOT support word highlighting (onboundary events)
      // and they instantly crash on long paragraphs, which was disabling the popup buttons!
      const voices = speechSynthesis.getVoices();
      
      // 1. Priority: Local/Offline Indian Male voice (Microsoft Ravi, Apple Rishi)
      let bestVoiceIndex = voices.findIndex(v => 
        v.localService === true && 
        (v.lang.includes('en-IN') || v.name.toLowerCase().includes('india')) &&
        (v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('ravi') || v.name.toLowerCase().includes('rishi'))
      );
      
      // 2. Fallback: Any Local Indian voice
      if (bestVoiceIndex === -1) {
        bestVoiceIndex = voices.findIndex(v => 
          v.localService === true && 
          (v.lang.includes('en-IN') || v.name.toLowerCase().includes('india'))
        );
      }
      
      // 3. Fallback: Local English Male voice
      if (bestVoiceIndex === -1) {
        bestVoiceIndex = voices.findIndex(v => 
          v.localService === true && 
          v.lang.includes('en') &&
          (v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('david') || v.name.toLowerCase().includes('mark'))
        );
      }
      
      // 4. Final Fallback: Any local voice
      if (bestVoiceIndex === -1) {
        bestVoiceIndex = voices.findIndex(v => v.localService === true);
      }

      if (bestVoiceIndex !== -1) {
        voiceSelect.value = bestVoiceIndex;
      }
    }
    
    if (result.rate !== undefined) {
      rateInput.value = result.rate;
      rateValue.textContent = result.rate;
    } else {
      // Slightly slower speed for clearer, easier to understand pronunciation
      rateInput.value = 0.85;
      rateValue.textContent = '0.85';
    }
    
    if (result.pitch !== undefined) {
      pitchInput.value = result.pitch;
      pitchValue.textContent = result.pitch;
    } else {
      // Default pitch of 1.0 sounds most human and least robotic
      pitchInput.value = 1.0;
      pitchValue.textContent = '1.0';
    }
    checkVoiceCapabilities();
  });
}

// Check if voice supports highlighting
function checkVoiceCapabilities() {
  const voices = speechSynthesis.getVoices();
  const selectedVoice = voices[voiceSelect.value];
  const warningDiv = document.getElementById('voice-warning');
  
  if (selectedVoice && !selectedVoice.localService) {
    if (!warningDiv) {
      const div = document.createElement('div');
      div.id = 'voice-warning';
      div.style.color = '#e65100';
      div.style.backgroundColor = '#fff3e0';
      div.style.padding = '5px';
      div.style.borderRadius = '3px';
      div.style.fontSize = '11px';
      div.style.marginTop = '8px';
      div.textContent = '⚠ Online voice selected. Word highlighting is disabled by the browser.';
      voiceSelect.parentNode.insertBefore(div, voiceSelect.nextSibling);
    }
  } else {
    if (warningDiv) {
      warningDiv.remove();
    }
  }
}

// Save settings
function saveSettings() {
  chrome.storage.sync.set({
    voiceIndex: voiceSelect.value,
    rate: rateInput.value,
    pitch: pitchInput.value
  });
}

// Load voices
function loadVoices() {
  const voices = speechSynthesis.getVoices();
  voiceSelect.innerHTML = '';
  voices.forEach((voice, index) => {
    const option = document.createElement('option');
    option.value = index;
    option.textContent = `${voice.name} (${voice.lang})`;
    voiceSelect.appendChild(option);
  });
  loadSettings();
}

speechSynthesis.onvoiceschanged = loadVoices;
loadVoices();

// Update rate and pitch display
rateInput.addEventListener('input', () => {
  rateValue.textContent = rateInput.value;
  saveSettings();
});

pitchInput.addEventListener('input', () => {
  pitchValue.textContent = pitchInput.value;
  saveSettings();
});

voiceSelect.addEventListener('change', () => {
  saveSettings();
  checkVoiceCapabilities();
});

// Preset buttons for easy adjustment
document.getElementById('presetSlow').addEventListener('click', () => {
  rateInput.value = 0.8;
  pitchInput.value = 1.0;
  rateValue.textContent = '0.8';
  pitchValue.textContent = '1.0';
  saveSettings();
});

document.getElementById('presetNormal').addEventListener('click', () => {
  rateInput.value = 0.95;
  pitchInput.value = 1.0;
  rateValue.textContent = '0.95';
  pitchValue.textContent = '1.0';
  saveSettings();
});

document.getElementById('presetFast').addEventListener('click', () => {
  rateInput.value = 1.1;
  pitchInput.value = 1.0;
  rateValue.textContent = '1.1';
  pitchValue.textContent = '1.0';
  saveSettings();
});

// Update status display
function updateStatus(status) {
  statusDiv.className = 'status ' + status;
  switch(status) {
    case 'reading':
      statusDiv.textContent = '🔊 Reading...';
      break;
    case 'paused':
      statusDiv.textContent = '⏸️ Paused';
      break;
    case 'stopped':
      statusDiv.textContent = '⏹️ Stopped';
      break;
    default:
      statusDiv.textContent = '';
      statusDiv.className = 'status';
  }
}

// Read button
readBtn.addEventListener('click', async () => {
  if (isPaused) {
    // Resume reading
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'resume' }, (response) => {
        if (chrome.runtime.lastError) {
          console.log('Error:', chrome.runtime.lastError.message);
          return;
        }
      });
    });
    isPaused = false;
    isReading = true;
    readBtn.textContent = 'Read';
    pauseBtn.textContent = 'Pause';
    pauseBtn.disabled = false;
    stopBtn.disabled = false;
    updateStatus('reading');
  } else {
    // Start reading
    const voices = speechSynthesis.getVoices();
    const selectedVoice = voices[voiceSelect.value];
    
    const settings = {
      voice: selectedVoice ? selectedVoice.name : null,
      rate: parseFloat(rateInput.value),
      pitch: parseFloat(pitchInput.value)
    };

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      
      // Check if we can inject scripts on this page
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://')) {
        updateStatus('');
        alert('Cannot read on browser internal pages.\nTry on a regular webpage like:\n• News sites\n• Blogs\n• Articles');
        return;
      }
      
      // First, capture the selection before it's lost
      const captureSelection = async () => {
        try {
          const result = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const sel = window.getSelection();
              if (!sel || sel.rangeCount === 0) return null;
              const range = sel.getRangeAt(0);
              return {
                text: sel.toString(),
                startContainer: range.startContainer.nodeType === Node.TEXT_NODE ? 
                  range.startContainer.textContent : null,
                startOffset: range.startOffset,
                endOffset: range.endOffset
              };
            }
          });
          return result && result[0] && result[0].result;
        } catch (e) {
          console.error('Could not capture selection:', e);
          return null;
        }
      };
      
      const selectionData = await captureSelection();
      console.log('Selection data:', selectionData);
      
      // Try to send message first
      const tryMessage = () => {
        return new Promise((resolve) => {
          chrome.tabs.sendMessage(tab.id, { 
            action: 'read', 
            settings: settings,
            selectionData: selectionData
          }, (response) => {
            if (chrome.runtime.lastError) {
              resolve(false);
            } else {
              resolve(response && response.success);
            }
          });
        });
      };
      
      let success = await tryMessage();
      console.log('First message attempt:', success);
      
      // If failed, try to inject the scripts manually
      if (!success) {
        console.log('Attempting manual injection...');
        try {
          // Inject content script
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
          console.log('Content script injected');
          
          // Inject CSS
          await chrome.scripting.insertCSS({
            target: { tabId: tab.id },
            files: ['content.css']
          });
          console.log('CSS injected');
          
          // Wait a moment for initialization
          await new Promise(resolve => setTimeout(resolve, 200));
          
          // Try again
          success = await tryMessage();
          console.log('Second message attempt:', success);
        } catch (e) {
          console.error('Injection failed:', e);
          updateStatus('');
          alert('Error: ' + e.message + '\n\nFor file:// URLs:\n1. Go to chrome://extensions\n2. Find this extension\n3. Enable "Allow access to file URLs"');
          return;
        }
      }
      
      if (success) {
        isReading = true;
        pauseBtn.disabled = false;
        stopBtn.disabled = false;
        updateStatus('reading');
      } else {
        updateStatus('');
        alert('Could not start reading.\n\nTroubleshooting:\n1. Check browser console (F12) for errors\n2. Refresh the page (F5)\n3. Select text again\n4. For file:// URLs, enable "Allow access to file URLs" in chrome://extensions');
      }
    });
  }
});

// Pause button
pauseBtn.addEventListener('click', () => {
  if (isPaused) {
    // Resume
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'resume' }, (response) => {
        if (chrome.runtime.lastError) {
          console.log('Error:', chrome.runtime.lastError.message);
          return;
        }
      });
    });
    isPaused = false;
    pauseBtn.textContent = 'Pause';
    updateStatus('reading');
  } else {
    // Pause
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'pause' }, (response) => {
        if (chrome.runtime.lastError) {
          console.log('Error:', chrome.runtime.lastError.message);
          return;
        }
      });
    });
    isPaused = true;
    pauseBtn.textContent = 'Resume';
    updateStatus('paused');
  }
});

// Stop button
stopBtn.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { action: 'stop' }, (response) => {
      if (chrome.runtime.lastError) {
        console.log('Error:', chrome.runtime.lastError.message);
        return;
      }
    });
  });
  isReading = false;
  isPaused = false;
  readBtn.textContent = 'Read';
  pauseBtn.textContent = 'Pause';
  pauseBtn.disabled = true;
  stopBtn.disabled = true;
  updateStatus('stopped');
  setTimeout(() => updateStatus(''), 2000);
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'readingComplete') {
    isReading = false;
    isPaused = false;
    readBtn.textContent = 'Read';
    pauseBtn.textContent = 'Pause';
    pauseBtn.disabled = true;
    stopBtn.disabled = true;
    updateStatus('stopped');
    setTimeout(() => updateStatus(''), 2000);
    return false; // No async response needed
  }
  return false;
});

// On popup load, check if currently reading
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) {
    chrome.tabs.sendMessage(tabs[0].id, { action: 'getStatus' }, (response) => {
      if (chrome.runtime.lastError) {
        return;
      }
      if (response && response.isReading) {
        isReading = true;
        isPaused = response.isPaused;
        pauseBtn.disabled = false;
        stopBtn.disabled = false;
        if (isPaused) {
          pauseBtn.textContent = 'Resume';
          updateStatus('paused');
        } else {
          pauseBtn.textContent = 'Pause';
          updateStatus('reading');
        }
      }
    });
  }
});
