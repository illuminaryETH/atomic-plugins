# Atomic Browser Extension - Testing Guide

## Overview

The Atomic Browser Extension allows you to capture web content directly to your Atomic desktop app. It supports capturing full pages (with smart article extraction) or selected text, with offline queueing when the desktop app isn't running.

## Prerequisites

- Atomic desktop app v0.3.4+ (with HTTP server support)
- Chrome, Edge, Brave, or any Chromium-based browser
- macOS, Linux, or Windows

## Installation

### 1. Start the Atomic Desktop App

The extension requires the Atomic desktop app to be running with the HTTP server enabled.

```bash
cd /path/to/atomic
npm run tauri dev
```

**Verify the server is running:**
You should see this message in the terminal:
```
Starting HTTP server on http://127.0.0.1:44380
```

**Quick test:**
```bash
curl http://localhost:44380/health
# Should return: {"status":"ok","version":"0.3.4"}
```

### 2. Load the Extension in Chrome

1. Open your Chromium browser
2. Navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in top-right corner)
4. Click **Load unpacked**
5. Navigate to and select: `/path/to/atomic/extension`
6. The extension should now appear in your extensions list

**You should see:**
- Extension icon in the toolbar (purple square with "A")
- Extension listed as "Atomic Web Clipper"

## Testing Checklist

### ✅ Test 1: Connection Status

**Steps:**
1. With Atomic app running, click the extension icon in toolbar
2. Check the status indicator at the top

**Expected:**
- Green dot with "Connected to Atomic" message

**If you see "Atomic offline":**
- Verify the Atomic app is running
- Check that the HTTP server started (see Prerequisites)
- Try restarting the Atomic app

---

### ✅ Test 2: Full Page Capture

**Steps:**
1. Navigate to an article page (e.g., https://en.wikipedia.org/wiki/Atomic_theory)
2. Right-click anywhere on the page
3. Select **"Save to Atomic"** from the context menu

**Expected:**
- Success notification: "Saved to Atomic"
- Atom appears in Atomic app with:
  - Article content converted to markdown
  - Source URL in metadata: `> Source: https://...`
  - Embedding status: "pending" (will process automatically)

**Test different page types:**
- ✅ News article (e.g., NYTimes, BBC)
- ✅ Blog post (e.g., Medium, dev.to)
- ✅ GitHub README
- ✅ Wikipedia article
- ✅ Documentation page

---

### ✅ Test 3: Selected Text Capture

**Steps:**
1. Navigate to any webpage
2. Select a portion of text (highlight with mouse)
3. Right-click on the selected text
4. Select **"Save to Atomic"** from the context menu

**Expected:**
- Success notification: "Saved to Atomic"
- Atom contains only the selected text (no surrounding content)
- Source URL is still captured

---

### ✅ Test 4: Toolbar Popup Capture

**Steps:**
1. Navigate to an article page
2. Click the extension icon in toolbar
3. Click **"📄 Capture Page"** button

**Expected:**
- Popup closes automatically
- Success notification appears
- Atom appears in Atomic app

**Also test:**
- Click **"✂️ Capture Selection"** with text selected

---

### ✅ Test 5: Offline Queue

**Steps:**
1. **Quit the Atomic desktop app** (important: fully close it)
2. Navigate to a webpage
3. Right-click → "Save to Atomic"

**Expected:**
- Notification: "Queued for later - Will sync when Atomic is available"
- Extension badge shows count (e.g., "1")

**Continue:**
4. Capture 2-3 more pages while app is offline
5. Open the extension popup

**Expected:**
- Status: "Atomic offline" (gray dot)
- "Pending Captures" section visible
- Queue count shows number of pending items
- Items listed with titles

---

### ✅ Test 6: Auto-Sync

**Steps:**
1. With items in queue (from Test 5), restart the Atomic app
2. Wait 30 seconds (auto-sync runs every 30 seconds)

**Expected:**
- Notification: "Queue synced - X items synced to Atomic"
- Extension badge clears
- All queued atoms appear in Atomic app
- Queue section disappears from popup

**Alternative: Manual Sync**
1. Open extension popup
2. Click **"Sync Now"** button
3. Should sync immediately (don't wait 30 seconds)

---

### ✅ Test 7: Queue Persistence

**Steps:**
1. With Atomic app offline, capture 2-3 pages
2. **Close your browser completely**
3. Reopen browser
4. Open extension popup

**Expected:**
- Queue still contains the 2-3 items
- Items persist across browser restarts
- Clicking "Sync Now" (with app running) syncs them

---

### ✅ Test 8: Content Quality

**Test markdown conversion:**
1. Capture an article with various formatting:
   - Headings (h1, h2, h3)
   - Bold and italic text
   - Lists (ordered and unordered)
   - Links
   - Code blocks
   - Blockquotes

**Expected in Atomic:**
- Headings: `# Heading`, `## Subheading`
- Bold: `**text**`
- Italic: `*text*`
- Lists: `-` or `1.` with proper indentation
- Links: `[text](url)`
- Code: Triple backticks for blocks
- Blockquotes: `>` prefix

**Metadata:**
- Source URL at top: `> Source: https://example.com`
- Clean, readable markdown without HTML tags

---

### ✅ Test 9: Edge Cases

**Test these scenarios:**

**Large page:**
- Capture a very long Wikipedia article
- Should handle without errors

**Page with no article content:**
- Capture Google search results
- Should fall back to visible text

**Page with special characters:**
- Capture page with emojis, math symbols, code
- Should preserve special characters in markdown

**Rapid captures:**
- Capture 5 pages in quick succession
- All should queue or save successfully

**Tab switching during capture:**
- Start capture, immediately switch tabs
- Should still complete successfully

---

## Troubleshooting

### Extension icon not showing
- Check chrome://extensions - ensure extension is enabled
- Try reloading the extension (click reload button)
- Check browser console for errors (F12 → Console tab)

### "Atomic offline" when app is running
- Verify HTTP server started: `curl http://localhost:44380/health`
- Check firewall isn't blocking localhost:44380
- Try restarting Atomic app
- Check Atomic terminal for server errors

### Context menu not appearing
- Extension may need permissions - check chrome://extensions
- Try reloading the extension
- Check that extension has "activeTab" permission

### Queue not syncing
- Open extension popup and click "Sync Now"
- Check Atomic app is running and health endpoint responds
- Inspect queue in browser DevTools:
  ```javascript
  chrome.storage.local.get('captureQueue', console.log)
  ```

### Content extraction fails
- Try selecting text manually and using "Capture Selection"
- Some pages block content extraction (e.g., paywalls)
- Check browser console for Readability errors

### Atoms not appearing in Atomic
- Check Atomic database: Look in main view for new atoms
- Verify source_url is populated
- Check terminal for any error messages
- Try capturing directly via API:
  ```bash
  curl -X POST http://localhost:44380/atoms \
    -H "Content-Type: application/json" \
    -d '{"content":"Test","source_url":"https://test.com","tag_ids":[]}'
  ```

## Development / Debugging

### View Extension Logs

**Service Worker (background):**
1. Go to `chrome://extensions`
2. Find "Atomic Web Clipper"
3. Click "service worker" link
4. Console opens with background logs

**Content Script:**
1. Open any webpage
2. Press F12 → Console tab
3. Content script logs appear here

**Popup:**
1. Right-click extension icon → "Inspect popup"
2. DevTools opens for popup

### Inspect Queue

Open browser console and run:
```javascript
// View queue
chrome.storage.local.get('captureQueue', (result) => {
  console.log('Queue:', result.captureQueue);
});

// Clear queue
chrome.storage.local.set({ captureQueue: [] });
```

### Test HTTP Endpoints Directly

**Health check:**
```bash
curl http://localhost:44380/health
```

**Create atom:**
```bash
curl -X POST http://localhost:44380/atoms \
  -H "Content-Type: application/json" \
  -d '{
    "content": "# Test Atom\n\nThis is a test from curl.",
    "source_url": "https://example.com",
    "tag_ids": []
  }'
```

### Reload Extension After Changes

1. Make code changes to extension files
2. Go to `chrome://extensions`
3. Click reload button on "Atomic Web Clipper"
4. No need to remove and re-add

## Architecture Notes

### How It Works

1. **User triggers capture** (context menu or toolbar)
2. **Content script extracts content** using Readability.js
3. **Content converted to Markdown** using Turndown.js
4. **Service worker sends to Atomic** via HTTP POST to localhost:44380
5. **If offline:** Item added to chrome.storage.local queue
6. **Auto-sync runs every 30s** to sync queue when app available

### Data Flow

```
Webpage → Content Script → Service Worker → HTTP API → Atomic App
                              ↓ (if offline)
                        chrome.storage.local
                              ↓ (auto-sync)
                          HTTP API → Atomic App
```

### Files

- `manifest.json` - Extension configuration
- `background/service-worker.js` - Queue, sync, context menu
- `content/content-script.js` - Page extraction (Readability + Turndown)
- `popup/popup.html` - Toolbar UI
- `popup/popup.js` - UI logic
- `popup/popup.css` - Dark theme styles
- `lib/readability.min.js` - Mozilla Readability library
- `lib/turndown.min.js` - HTML to Markdown converter
- `icons/` - Extension icons (16, 48, 128px)

## Known Limitations (MVP)

- ✅ **No authentication**: Relies on localhost-only binding (safe for single-user desktop app)
- ✅ **No tag suggestions**: Tags must be applied manually in Atomic (future enhancement)
- ✅ **No preview modal**: Content is captured directly (future enhancement)
- ✅ **No keyboard shortcuts**: Use context menu or toolbar only
- ✅ **Chrome/Chromium only**: Firefox support requires different manifest (future)
- ✅ **No image handling**: Images are not downloaded, only markdown image links preserved

## Success Criteria

The extension is working correctly when:

- ✅ Context menu "Save to Atomic" appears on all pages
- ✅ Full page capture extracts clean article content
- ✅ Selected text capture works
- ✅ Toolbar popup shows connection status
- ✅ Atoms appear in Atomic with source URL
- ✅ Offline queue persists and auto-syncs
- ✅ Content is converted to clean markdown
- ✅ Embedding pipeline triggers automatically for captured atoms

## Next Steps / Future Enhancements

- [ ] Tag suggestions using OpenRouter LLM
- [ ] Preview modal before capture
- [ ] Keyboard shortcuts (Cmd+Shift+A)
- [ ] Settings page (configure port, defaults)
- [ ] Firefox support
- [ ] Token-based authentication
- [ ] Image download support
- [ ] Better error handling with retry logic

## Feedback

Report issues or suggest improvements at: https://github.com/your-repo/atomic/issues
