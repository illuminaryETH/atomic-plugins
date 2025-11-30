# Atomic Long-Term Roadmap

## Vision
Empower end users with modern, best-practice RAG pipeline functionality for personal notes, research, and education. Position Atomic as **"the only personal knowledge manager that synthesizes your notes into verifiable, cited knowledge using AI that can run entirely on your device."**

## Strategic Positioning
- **Target Users**: Personal power users, students/academics, knowledge workers
- **Architecture**: Cloud-optional (works offline with local models, cloud for enhanced quality)
- **Unique Value**: Verified AI Synthesis = RAG + Citations + Privacy + Local-first

## Approach
Features-first development: Ship high-value user features using current OpenRouter infrastructure, then layer in local model support and technical improvements iteratively.

---

## Phase 6: Conversational AI
**Theme: "Talk to Your Knowledge"**

The highest-impact feature for making users say "I can't go back." Users converse with an AI grounded in their own notes, with transparent citations.

### Features
| Feature | Description | Effort |
|---------|-------------|--------|
| Chat Interface | Slide-out chat panel in right drawer | M |
| RAG-Enhanced Responses | Query embeddings to inject relevant chunks into LLM prompts | L |
| Citation Links | Clickable [N] citations linking to source atoms | M |
| Streaming Responses | Display tokens as they arrive | S |
| Conversation History | Persist chat threads in SQLite | M |
| Context Pinning | "Add to context" button on atoms for manual context injection | S |

### Technical Implementation
- New tables: `chat_conversations`, `chat_messages`
- New commands: `send_chat_message`, `get_chat_history`, `create_conversation`
- Components: `src/components/chat/` (ChatPanel, MessageList, ChatInput)
- Reuse existing `search_atoms_semantic` for context retrieval
- Leverage OpenRouter for LLM completion with structured output for citations (same pattern as wiki synthesis)

### Key Files to Modify
- `src-tauri/src/commands.rs` - Add chat commands
- `src-tauri/src/db.rs` - Add chat tables
- `src/stores/` - New `chat.ts` store
- `src/components/layout/RightDrawer.tsx` - Add chat mode

---

## Phase 7: Smart Capture & Input
**Theme: "Frictionless Knowledge Ingestion"**

Lower the barrier to adding knowledge. If capture is hard, the system stays empty.

### Features
| Feature | Description | Effort |
|---------|-------------|--------|
| Enhanced Web Clipper | Right-click context menu, selection highlighting in extension | M |
| PDF Import | Drag-and-drop PDF, extract text and create atoms | L |
| URL Auto-Extraction | Paste URL, auto-fetch title and summarize content | M |
| Quick Capture Hotkey | Global hotkey opens minimal capture window | M |
| Smart Duplicate Detection | Warn when creating atom similar to existing one | M |
| Voice Notes | Record audio, transcribe via Whisper API | L |

### Technical Implementation
- Extend browser extension with context menu capture
- Add `pdf-extract` Rust crate for PDF parsing
- Tauri globalShortcut for quick capture window
- Use existing embedding similarity for duplicate detection
- OpenRouter Whisper or local whisper.cpp for transcription

### Key Files to Modify
- `src-tauri/src/commands.rs` - Add import commands
- `src-tauri/src/lib.rs` - Register global shortcuts
- Browser extension in separate repo

---

## Phase 8: Advanced Retrieval
**Theme: "Find What You Forgot You Knew"**

Move beyond basic semantic search to production-quality RAG.

### Features
| Feature | Description | Effort |
|---------|-------------|--------|
| Hybrid Search | Combine BM25 (FTS5) + vector similarity | M |
| Query Expansion | LLM rewrites query for better retrieval | S |
| Temporal Search | "What did I save last week about X?" | M |
| Daily Review | Show atoms from 1 week, 1 month, 1 year ago (spaced repetition) | M |
| Related Suggestions | Proactive "You might want to connect this to..." | M |

### Technical Implementation
- Add FTS5 virtual table: `atom_chunks_fts`
- New `search_hybrid` command combining BM25 + vector scores (Reciprocal Rank Fusion)
- `get_atoms_by_date_range` command
- `DailyReview` component for "on this day" feature

### Key Files to Modify
- `src-tauri/src/db.rs` - Add FTS5 table
- `src-tauri/src/commands.rs` - Add hybrid search, temporal queries
- `src/components/search/` - Enhanced search UI

---

## Phase 9: Local AI Mode
**Theme: "Your Notes Never Leave Your Device"**

Enable full offline operation with local embedding and LLM models.

### Features
| Feature | Description | Effort |
|---------|-------------|--------|
| Provider Abstraction | Trait-based embedding/LLM providers | M |
| Local Embeddings | Enable sqlite-lembed (already bundled) | S |
| Local LLM | llama.cpp integration via llama-cpp-rs | XL |
| Model Manager | Download, manage, switch between models | L |
| Hybrid Mode | Prefer local, fall back to cloud | M |

### Technical Implementation
- Extract provider traits: `EmbeddingProvider`, `LLMProvider`
- Implement `LocalEmbeddingProvider` using existing sqlite-lembed setup
- Integrate `llama-cpp-rs` for local LLM inference
- Model management UI in Settings
- Setting to toggle: Cloud / Local / Hybrid

### Key Files to Modify
- New `src-tauri/src/providers/` directory
- `src-tauri/src/embedding.rs` - Refactor to use provider trait
- `src-tauri/src/extraction.rs` - Use LLM provider
- `src-tauri/src/wiki.rs` - Use LLM provider
- `src/components/settings/` - Model management UI

### Cargo Dependencies
```toml
llama-cpp-rs = { version = "0.9", features = ["cuda"] }  # Optional CUDA
```

---

## Phase 10: Multi-Modal Knowledge
**Theme: "Beyond Text"**

Support images, audio, and visual content as first-class knowledge.

### Features
| Feature | Description | Effort |
|---------|-------------|--------|
| Image Attachments | Attach images to atoms, display inline | M |
| Screenshot Capture | Hotkey to screenshot and create atom | M |
| OCR | Extract text from images/screenshots | M |
| Image Embedding | CLIP-style embeddings for image search | L |
| Audio Clips | Attach and transcribe audio | L |

### Technical Implementation
- New `attachments` table with `atom_id`, `type`, `path`, `embedding`
- Store files in Tauri app data directory
- CLIP embeddings via OpenRouter vision models or local nomic-embed-vision
- Tesseract or vision LLM for OCR

### Key Files to Modify
- `src-tauri/src/db.rs` - Add attachments table
- `src-tauri/src/commands.rs` - Attachment CRUD
- `src/components/atoms/` - Attachment display components

---

## Phase 11: Collaboration & Sharing
**Theme: "Knowledge Amplified"**

Optional cloud features without compromising local-first philosophy.

### Features
| Feature | Description | Effort |
|---------|-------------|--------|
| Export to Markdown | Export atoms/tags to standard MD files | S |
| Public Wiki Pages | Generate shareable links for wiki articles | L |
| Read-Only Sharing | Share specific atoms with expiring links | L |
| Selective Sync | Choose which tags sync to cloud | XL |
| Import from Others | Accept shared atoms | M |

### Technical Implementation
- Backend service (Rust/Axum) for cloud features
- E2E encryption option for synced data
- Publish/unpublish workflows

---

## Phase 12: Productivity Integration
**Theme: "Knowledge in Context"**

Connect Atomic to existing workflows.

### Features
| Feature | Description | Effort |
|---------|-------------|--------|
| Alfred/Raycast Plugin | Quick search from launcher | M |
| Obsidian Import | Bulk import from Obsidian vault | M |
| Notion Import | Import from Notion export | M |
| REST API | Full CRUD API for automation | M |
| Calendar Integration | Create atoms from calendar events | M |

---

## Roadmap Summary

| Phase | Theme | Key Deliverables | Target |
|-------|-------|------------------|--------|
| 6 | Conversational AI | Chat with citations, streaming | All users |
| 7 | Smart Capture | PDF, URL, voice, quick capture | All users |
| 8 | Advanced Retrieval | Hybrid search, daily review | Students, Researchers |
| 9 | Local AI Mode | Offline embeddings + LLM | Privacy-conscious |
| 10 | Multi-Modal | Images, audio, OCR | Visual learners |
| 11 | Collaboration | Sharing, selective sync | Teams |
| 12 | Integration | Launchers, imports, API | Power users |

---

## Competitive Moats to Build

1. **Verified AI Synthesis**: Every AI claim cites source atoms - no competitor does this well
2. **True Offline AI**: Local LLM + embeddings with no cloud dependency
3. **Native Performance**: Tauri/Rust vs Electron (10x smaller, faster)
4. **Citation Graph**: Bidirectional tracking of which atoms informed which synthesis
5. **Research Workflows**: PDF import, citation export, hypothesis canvas

---

## Technical Debt to Address Along the Way

**During Phase 6 (Chat):**
- Unify OpenRouter request/response types (duplicated in extraction.rs, wiki.rs)

**During Phase 8 (Retrieval):**
- Add connection pooling (replace single Mutex<Connection>)
- Consolidate `distance_to_similarity` functions

**During Phase 9 (Local AI):**
- Provider abstraction enables swapping implementations
- Handle different embedding dimensions (384 local vs 1536 cloud)

**Ongoing:**
- Add comprehensive tests for each phase
- Extract hardcoded API URLs into config

---

## Risk Areas

| Risk | Mitigation |
|------|------------|
| llama.cpp build complexity | Use pre-built binaries, provide fallback to cloud |
| Model file sizes (4-8GB) | Optional download, don't bundle |
| Embedding dimension mismatch | Store model_id with chunks, support multiple vec tables |
| Scale beyond 100K atoms | Add pagination, connection pooling in Phase 8 |

---

## Success Metrics by Phase

- **Phase 6**: Daily active chat sessions, citation click-through rate
- **Phase 7**: Atoms created per day, capture-to-tag completion rate
- **Phase 8**: Search result relevance (user feedback), daily review retention
- **Phase 9**: % users on local-only mode, offline session duration
- **Phase 10**: Multi-modal atoms created, image search usage
- **Phase 11**: Shared wiki views, sync adoption rate
