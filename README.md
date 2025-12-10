# Atomic

A personal knowledge base with AI-powered semantic search, wiki synthesis, and chat.

Atomic stores knowledge as "atoms" — markdown notes that are automatically embedded for semantic search. Your atoms can be synthesized into wiki articles, explored on an interactive canvas, and queried through a conversational chat interface.

## Features

- **Atoms** — Markdown notes as atomic units of knowledge with hierarchical tagging
- **Semantic Search** — AI-powered vector search using embeddings (sqlite-vec)
- **Canvas View** — Spatial visualization with force-directed layout based on semantic similarity
- **Wiki Synthesis** — Auto-generated articles from your notes with inline citations
- **Chat** — Conversational RAG interface with tool-calling agent
- **Automatic Tagging** — LLM-powered tag extraction and hierarchy organization
- **Multiple Providers** — Use OpenRouter (cloud) or Ollama (local) for embeddings and LLMs
- **Browser Extension** — Capture web content directly to Atomic via Chromium extension
- **MCP Server** — Expose your knowledge base to Claude and other AI tools

## Getting Started

### Installation

Download the latest release for your platform from [GitHub Releases](https://github.com/kenforthewin/atomic/releases).

Available for macOS, Linux, and Windows.

### Initial Setup

1. Download and install the app for your platform
2. Open Settings (gear icon) and configure your AI provider:
   - **OpenRouter** (cloud): Get an API key from [openrouter.ai](https://openrouter.ai)
   - **Ollama** (local): Install [Ollama](https://ollama.com) and pull models (e.g., `ollama pull nomic-embed-text`)
3. Create your first atom with the + button

### Browser Extension (Optional)

The Atomic Web Clipper lets you capture web content directly into the app:

1. Open Chrome/Edge/Brave and navigate to `chrome://extensions`
2. Enable "Developer mode" (top-right toggle)
3. Click "Load unpacked" and select the `extension/` directory from this repo
4. Make sure the Atomic desktop app is running

The extension works offline — captures are queued and synced when the app is available.

### MCP Server (Optional)

Atomic exposes an MCP (Model Context Protocol) server so Claude and other AI tools can search and create atoms in your knowledge base.

The server runs automatically on `http://localhost:44380/mcp` when the app is open.

**Configure Claude Desktop:**

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "atomic": {
      "url": "http://localhost:44380/mcp"
    }
  }
}
```

**Available tools:**
- `semantic_search` — Search for atoms by semantic similarity
- `read_atom` — Get full content of an atom
- `create_atom` — Create a new atom

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop Framework | Tauri v2 (Rust backend) |
| Frontend | React 18, TypeScript, Vite 6 |
| Styling | Tailwind CSS v4 |
| State Management | Zustand 5 |
| Database | SQLite + sqlite-vec |
| Editor | CodeMirror 6 |
| AI Providers | OpenRouter (cloud) or Ollama (local) |
| Canvas | d3-force, react-zoom-pan-pinch |

## Project Structure

```
/src-tauri          # Rust backend
  /src
    commands.rs     # Tauri command handlers
    db.rs           # SQLite setup and migrations
    embedding.rs    # Embedding generation pipeline
    extraction.rs   # Tag extraction logic
    wiki.rs         # Wiki article generation
    chat.rs         # Chat/conversation management
    agent.rs        # Agentic chat loop with tool calling
    /mcp            # MCP server implementation
    /providers      # AI provider abstraction (OpenRouter)
/src                # React frontend
  /components
    /layout         # LeftPanel, MainView, RightDrawer
    /atoms          # AtomCard, AtomEditor, AtomViewer
    /canvas         # CanvasView, AtomNode, ConnectionLines
    /tags           # TagTree, TagSelector
    /wiki           # WikiViewer, CitationPopover
    /chat           # ChatViewer, ChatMessage
  /stores           # Zustand stores (atoms, tags, ui, settings, wiki, chat)
/extension          # Chromium browser extension
/scripts            # Utility scripts (Wikipedia import)
```

## Local Development

### Prerequisites

- Node.js 18+
- Rust toolchain ([rustup](https://rustup.rs))
- Platform-specific Tauri dependencies:
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, etc. ([see Tauri docs](https://v2.tauri.app/start/prerequisites/))
  - **Windows**: Microsoft Visual Studio C++ Build Tools, WebView2

### Commands

```bash
# Install dependencies
npm install

# Development (with hot reload)
npm run tauri dev

# Production build
npm run tauri build

# Type check frontend
npm run build

# Check Rust code
cd src-tauri && cargo check

# Run Rust tests
cd src-tauri && cargo test
```

### Utility Scripts

```bash
# Import Wikipedia articles for stress testing
npm run import:wikipedia        # 500 articles (default)
npm run import:wikipedia 1000   # Custom count
```

## Documentation

- [`extension/README.md`](./extension/README.md) — Browser extension testing guide

## License

MIT
