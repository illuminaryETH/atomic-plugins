const SERVER_URL = 'http://localhost:44380';
const QUEUE_KEY = 'captureQueue';

// Add context menu on install
chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.contextMenus.create({
      id: 'save-to-atomic',
      title: 'Save to Atomic',
      contexts: ['selection', 'page']
    });
  } catch (error) {
    console.error('Failed to create context menu:', error);
  }
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'save-to-atomic') {
    captureContent(tab.id, info.selectionText ? 'selection' : 'page');
  }
});

// Capture content from tab
async function captureContent(tabId, mode) {
  let result;
  try {
    // Ask content script to extract content
    result = await chrome.tabs.sendMessage(tabId, {
      action: 'extract',
      mode: mode
    });

    if (!result || !result.content) {
      throw new Error('No content extracted');
    }

    // Try to send to desktop app immediately (instant when online)
    await sendToDesktop(result);

    // Success notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: '../icons/icon48.png',
      title: 'Saved to Atomic',
      message: result.title || 'Content captured successfully'
    });
  } catch (error) {
    // Failed - add to queue (will sync on 30s interval)
    if (result) {
      await addToQueue(result);

      chrome.notifications.create({
        type: 'basic',
        iconUrl: '../icons/icon48.png',
        title: 'Queued for later',
        message: 'Will sync when Atomic is available'
      });
    } else {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: '../icons/icon48.png',
        title: 'Capture failed',
        message: 'Could not extract content from page'
      });
    }
  }
}

// Send to desktop app via HTTP
async function sendToDesktop(capture) {
  const response = await fetch(`${SERVER_URL}/atoms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: capture.content,
      source_url: capture.url,
      tag_ids: []
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
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
  updateBadge();
}

// Get queue from storage
async function getQueue() {
  const result = await chrome.storage.local.get(QUEUE_KEY);
  return result[QUEUE_KEY] || [];
}

// Check connection and sync queue
async function syncQueue() {
  try {
    // Health check
    const response = await fetch(`${SERVER_URL}/health`);
    if (!response.ok) throw new Error('Unhealthy');

    // Connected - update badge
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
    chrome.action.setBadgeText({ text: '●' });

    // Sync queue
    const queue = await getQueue();
    const failed = [];

    for (const item of queue) {
      try {
        await sendToDesktop(item);
      } catch (error) {
        failed.push(item);
      }
    }

    // Update queue with only failed items
    await chrome.storage.local.set({ [QUEUE_KEY]: failed });
    updateBadge();

    if (queue.length > failed.length) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: '../icons/icon48.png',
        title: 'Queue synced',
        message: `${queue.length - failed.length} items synced to Atomic`
      });
    }
  } catch (error) {
    // Offline - gray badge
    chrome.action.setBadgeBackgroundColor({ color: '#9ca3af' });
    chrome.action.setBadgeText({ text: '●' });
  }
}

// Update badge with queue count
async function updateBadge() {
  const queue = await getQueue();
  if (queue.length > 0) {
    chrome.action.setBadgeText({ text: queue.length.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
  } else {
    // Clear badge when queue is empty, show connection status dot
    const response = await fetch(`${SERVER_URL}/health`).catch(() => null);
    if (response && response.ok) {
      chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
      chrome.action.setBadgeText({ text: '●' });
    } else {
      chrome.action.setBadgeBackgroundColor({ color: '#9ca3af' });
      chrome.action.setBadgeText({ text: '●' });
    }
  }
}

// Sync every 30 seconds (only needed for offline queue)
chrome.alarms.create('sync', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'sync') syncQueue();
});

// Initial sync on startup
syncQueue();
