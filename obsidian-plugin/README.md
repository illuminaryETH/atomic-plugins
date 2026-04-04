# Atomic for Obsidian

Obsidian plugin that connects your vault to an [Atomic](../README.md) knowledge base — giving you semantic search, automatic sync, similar-note discovery, and AI-generated wiki articles.

## Features

### Semantic Search

Search your knowledge base using meaning, not just keywords. The search modal (`Ctrl/Cmd+Shift+S`) supports hybrid search combining keyword and vector similarity, displaying results with relevance scores and matching snippets.

### Live Sync

Notes are automatically synced to the Atomic server as atoms. The sync engine:

- **Watches for changes** — create, modify, delete, and rename events are detected and synced with configurable debouncing (default 2s)
- **Tracks content hashes** (SHA-256) to skip unchanged files
- **Deduplicates** by checking server for existing atoms before creating new ones
- **Excludes patterns** — `.obsidian/`, `.trash/`, `.git/`, and `node_modules/` are excluded by default, with custom glob patterns supported
- **Optionally deletes** remote atoms when local files are removed

Sync can run automatically in the background or be triggered manually per-file or vault-wide.

### Similar Notes

A sidebar panel that shows semantically related notes for whatever file you're viewing. Updates automatically as you switch between files, displaying the top 10 similar atoms with similarity percentages and matching content chunks.

### Wiki Articles

Browse AI-generated wiki articles organized by your tag hierarchy. Select a tag to view its synthesized summary, or generate a new article from all atoms under that tag. Articles include inline citations linking back to source atoms.

## Commands

| Command | Description |
|---|---|
| **Semantic Search** | Open hybrid semantic search modal |
| **Sync Current Note** | Upload the active note to Atomic |
| **Sync Entire Vault** | Batch upload all markdown files |
| **Toggle Auto Sync** | Enable/disable automatic file watching |
| **Open Similar Notes** | Show sidebar with related notes |
| **Open Wiki** | Browse wiki articles by tag |

## Setup

### Prerequisites

A running [Atomic server](../crates/atomic-server/) — either standalone or via the Tauri desktop app.

### Installation

1. Build the plugin:

   ```bash
   cd obsidian-plugin
   npm install
   npm run build
   ```

2. Copy `manifest.json`, `main.js`, and `styles.css` to your vault's plugin directory:

   ```bash
   mkdir -p /path/to/vault/.obsidian/plugins/atomic
   cp manifest.json main.js styles.css /path/to/vault/.obsidian/plugins/atomic/
   ```

3. Enable the plugin in Obsidian: Settings > Community Plugins > Atomic.

### Configuration

Open the plugin settings (Settings > Atomic) and configure:

| Setting | Default | Description |
|---|---|---|
| **Server URL** | `http://localhost:8080` | Atomic server address |
| **Auth Token** | — | API token for authentication |
| **Vault Name** | — | Identifier used in source URLs (`obsidian://VaultName/path.md`) |
| **Auto Sync** | `false` | Automatically sync on file changes |
| **Sync Debounce** | `2000ms` | Delay before syncing after a change |
| **Sync Folder Tags** | `false` | Convert folder structure to hierarchical tags |
| **Delete on Remove** | `false` | Delete remote atoms when local files are removed |
| **Exclude Patterns** | `.obsidian/**`, `.trash/**`, `.git/**`, `node_modules/**` | Glob patterns for files to skip |

Use the **Test Connection** button to verify connectivity before syncing.

## Development

```bash
cd obsidian-plugin
npm install
npm run dev     # Watch mode with sourcemaps
npm run build   # Production build with type checking
```

The build outputs `main.js` (CommonJS bundle) using esbuild. For development, symlink the plugin directory into your test vault:

```bash
ln -s /path/to/atomic-discord/obsidian-plugin /path/to/vault/.obsidian/plugins/atomic
```

## Architecture

The plugin follows the same thin-client pattern as all Atomic frontends. It communicates exclusively over HTTP with `atomic-server` — no local database or Rust bindings required.

```
Obsidian Vault
     │
     ▼
┌─────────────┐     HTTP/REST     ┌────────────────┐
│  obsidian-  │ ◄──────────────► │ atomic-server  │
│  atomic     │   Bearer token    │ (or Tauri       │
│  plugin     │                   │  sidecar)       │
└─────────────┘                   └───────┬────────┘
                                          │
                                  ┌───────▼────────┐
                                  │  atomic-core   │
                                  │  (embeddings,  │
                                  │   wiki, search)│
                                  └────────────────┘
```

Source files are identified by URL (`obsidian://VaultName/path/to/note.md`), enabling bidirectional linking — search results and similar notes link back to files in your vault.
