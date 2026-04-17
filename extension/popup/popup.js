import { getConfig, authHeaders } from '../lib/config.js';

const QUEUE_KEY = 'captureQueue';

// Update UI on popup open
document.addEventListener('DOMContentLoaded', async () => {
  const config = await getConfig();

  // Settings link
  document.getElementById('settings-link').onclick = (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  };

  // Setup prompt for unconfigured state
  document.getElementById('open-settings').onclick = () => {
    chrome.runtime.openOptionsPage();
  };

  // Show setup prompt if no token configured
  if (!config.apiToken) {
    document.getElementById('setup-prompt').style.display = 'block';
    document.getElementById('actions').style.display = 'none';
  }

  await updateStatus();
  await updateQueue();

  // Button handlers
  document.getElementById('capture-page').onclick = () => captureCurrentTab('page');
  document.getElementById('capture-selection').onclick = () => captureCurrentTab('selection');
  document.getElementById('sync-now').onclick = syncNow;
});

// Check connection status
async function updateStatus() {
  const statusEl = document.getElementById('status');
  const labelEl = document.getElementById('status-label');
  const { serverUrl, apiToken, database } = await getConfig();

  try {
    const response = await fetch(`${serverUrl}/health`, {
      headers: authHeaders(apiToken, database)
    });
    if (response.ok) {
      statusEl.classList.remove('offline');
      labelEl.textContent = 'Connected to Atomic';
    } else {
      throw new Error('Unhealthy');
    }
  } catch (error) {
    statusEl.classList.add('offline');
    labelEl.textContent = 'Atomic offline';
  }
}

// Update queue display
async function updateQueue() {
  const queue = await getQueue();
  const section = document.getElementById('queue-section');
  const list = document.getElementById('queue-list');
  const count = document.getElementById('queue-count');

  if (queue.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  count.textContent = queue.length;

  list.innerHTML = queue.map(item => `
    <div class="queue-item">${item.title || 'Untitled'}</div>
  `).join('');
}

// Get queue from storage
async function getQueue() {
  const result = await chrome.storage.local.get(QUEUE_KEY);
  return result[QUEUE_KEY] || [];
}

// Extract content by injecting content script on demand (activeTab)
async function extractFromTab(tabId, mode) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['lib/readability.min.js', 'lib/turndown.min.js', 'content/content-script.js']
  });

  return chrome.tabs.sendMessage(tabId, { action: 'extract', mode });
}

// Capture from current tab
async function captureCurrentTab(mode) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { serverUrl, apiToken, database } = await getConfig();

  try {
    const result = await extractFromTab(tab.id, mode);

    if (result && result.content) {
      const response = await fetch(`${serverUrl}/api/atoms`, {
        method: 'POST',
        headers: authHeaders(apiToken, database),
        body: JSON.stringify({
          content: result.content,
          source_url: result.url,
          tag_ids: []
        })
      });

      if (response.ok) {
        window.close();
      } else {
        await addToQueue(result);
        window.close();
      }
    }
  } catch (error) {
    console.error('Capture error:', error);
  }
}

// Add to offline queue
async function addToQueue(capture) {
  const queue = await getQueue();
  queue.push({
    id: crypto.randomUUID(),
    ...capture,
    timestamp: Date.now()
  });
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
}

// Manually trigger sync
async function syncNow() {
  // Trigger sync in background script
  chrome.runtime.sendMessage({ action: 'sync' });
  setTimeout(updateQueue, 1000);
}
