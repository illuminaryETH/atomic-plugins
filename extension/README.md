# Atomic Web Clipper

Browser extension for capturing web content to your [Atomic](https://github.com/kenforthewin/atomic) knowledge base.

## Install

1. Open Chrome/Edge/Brave and go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `extension/` directory

## Setup

1. Click the extension icon and open **Settings**
2. Enter your Atomic server URL (e.g. `http://localhost:44380`)
3. Enter your API token
4. Click **Test Connection** to verify

## Usage

**Capture a full page** — right-click anywhere and select "Save to Atomic", or click the extension icon and choose "Capture Page".

**Capture selected text** — highlight text, then right-click and select "Save to Atomic", or use "Capture Selection" from the popup.

Pages are extracted with [Readability](https://github.com/mozilla/readability) and converted to markdown with [Turndown](https://github.com/mixmark-io/turndown). The resulting atom includes the source URL and is automatically embedded, tagged, and linked once it reaches your server.

## Offline Queue

If your server is unreachable, captures are queued locally and sync automatically every 30 seconds when the connection is restored. The extension badge shows the queue count. You can also trigger a manual sync from the popup.

## Files

```
manifest.json              # Extension manifest (Manifest V3)
background/service-worker.js  # Context menu, capture, queue, sync
content/content-script.js     # Page extraction (Readability + Turndown)
popup/                        # Toolbar popup UI
options/                      # Settings page (server URL, API token)
lib/                          # Bundled libraries
icons/                        # Extension icons
```
