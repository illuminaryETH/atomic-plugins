const SERVER_URL = 'http://localhost:44380';
const QUEUE_KEY = 'captureQueue';

// Update UI on popup open
document.addEventListener('DOMContentLoaded', async () => {
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

  try {
    const response = await fetch(`${SERVER_URL}/health`);
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

// Capture from current tab
async function captureCurrentTab(mode) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Send message to background script
  chrome.runtime.sendMessage({
    action: 'capture',
    tabId: tab.id,
    mode: mode
  });

  // Send message to content script
  try {
    const result = await chrome.tabs.sendMessage(tab.id, {
      action: 'extract',
      mode: mode
    });

    if (result && result.content) {
      // Try to send directly to server
      const response = await fetch(`${SERVER_URL}/atoms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: result.content,
          source_url: result.url,
          tag_ids: []
        })
      });

      if (response.ok) {
        window.close();
      } else {
        // Queue it
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
