# Atomic - Note-Taking Desktop Application

## Project Overview
Atomic is a Tauri v2 desktop application for note-taking with a React frontend. It features markdown editing, hierarchical tagging, and is designed to support AI-powered semantic search in future phases.

## Current Status: Phase 1 Complete
Phase 1 (Foundation + Data Layer) is complete with:
- Full UI layout with left panel, main view, and right drawer
- SQLite database with sqlite-vec extension ready for future embeddings
- Complete CRUD operations for atoms and tags
- Markdown editing with CodeMirror and rendering with react-markdown
- Hierarchical tag navigation with context menus
- Grid and list view modes for atoms
- Dark theme (Obsidian-inspired)

## Tech Stack
- **Desktop Framework**: Tauri v2 (Rust backend)
- **Frontend**: React 18+ with TypeScript
- **Build Tool**: Vite 6
- **Styling**: Tailwind CSS v4 (using `@tailwindcss/vite` plugin)
- **State Management**: Zustand 5
- **Database**: SQLite with sqlite-vec extension (via rusqlite)
- **Markdown Editor**: CodeMirror 6 (`@uiw/react-codemirror`)
- **Markdown Rendering**: react-markdown with remark-gfm

## Project Structure
```
/src-tauri
  /src
    main.rs           # Tauri entry point
    lib.rs            # App setup, command registration
    db.rs             # SQLite setup, migrations, connection pool
    commands.rs       # All Tauri command implementations
    models.rs         # Rust structs for data
  Cargo.toml
  tauri.conf.json

/src
  /components
    /layout           # LeftPanel, MainView, RightDrawer, Layout
    /atoms            # AtomCard, AtomEditor, AtomViewer, AtomGrid, AtomList
    /tags             # TagTree, TagNode, TagChip, TagSelector
    /ui               # Button, Input, Modal, FAB, ContextMenu
  /stores             # Zustand stores (atoms.ts, tags.ts, ui.ts)
  /hooks              # Custom hooks (useClickOutside, useKeyboard)
  /lib                # Utilities (tauri.ts, markdown.ts, date.ts)
  App.tsx
  main.tsx
  index.css           # Tailwind imports + custom animations

/index.html
/vite.config.ts
/package.json
```

## Common Commands

### Development
```bash
# Install dependencies
npm install

# Run development server (frontend only)
npm run dev

# Run development server (frontend + Tauri)
npm run tauri dev

# Build for production
npm run tauri build

# Type check
npm run build
```

### Rust Backend
```bash
# Check Rust code
cd src-tauri && cargo check

# Build Rust code
cd src-tauri && cargo build
```

## Database

### Location
The SQLite database is stored in the Tauri app data directory:
- macOS: `~/Library/Application Support/com.atomic.app/atomic.db`
- Linux: `~/.local/share/com.atomic.app/atomic.db`
- Windows: `%APPDATA%/com.atomic.app/atomic.db`

### Schema
```sql
-- Core content units
CREATE TABLE atoms (
  id TEXT PRIMARY KEY,  -- UUID
  content TEXT NOT NULL,
  source_url TEXT,
  created_at TEXT NOT NULL,  -- ISO 8601
  updated_at TEXT NOT NULL
);

-- Hierarchical tags
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES tags(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

-- Many-to-many relationship
CREATE TABLE atom_tags (
  atom_id TEXT REFERENCES atoms(id) ON DELETE CASCADE,
  tag_id TEXT REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (atom_id, tag_id)
);

-- For Phase 2 embeddings
CREATE TABLE atom_chunks (
  id TEXT PRIMARY KEY,
  atom_id TEXT REFERENCES atoms(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding BLOB
);
```

## Tauri Commands (API)

### Atom Operations
- `get_all_atoms()` → `Vec<AtomWithTags>`
- `get_atom(id)` → `AtomWithTags`
- `create_atom(content, source_url?, tag_ids)` → `AtomWithTags`
- `update_atom(id, content, source_url?, tag_ids)` → `AtomWithTags`
- `delete_atom(id)` → `()`
- `get_atoms_by_tag(tag_id)` → `Vec<AtomWithTags>`

### Tag Operations
- `get_all_tags()` → `Vec<TagWithCount>` (hierarchical tree)
- `create_tag(name, parent_id?)` → `Tag`
- `update_tag(id, name, parent_id?)` → `Tag`
- `delete_tag(id)` → `()`

### Utility
- `check_sqlite_vec()` → `String` (version check)

## Key Dependencies

### Rust (Cargo.toml)
- `tauri` = "2"
- `tauri-plugin-opener` = "2"
- `rusqlite` = { version = "0.32", features = ["bundled"] }
- `sqlite-vec` = "0.1.6"
- `serde` = { version = "1", features = ["derive"] }
- `serde_json` = "1"
- `uuid` = { version = "1", features = ["v4"] }
- `chrono` = { version = "0.4", features = ["serde"] }
- `zerocopy` = { version = "0.8", features = ["derive"] }

### Frontend (package.json)
- `@tauri-apps/api` = "^2.0.0"
- `react` = "^18.3.1"
- `zustand` = "^5.0.0"
- `@uiw/react-codemirror` = "^4.25.3"
- `@codemirror/lang-markdown` = "^6.5.0"
- `@codemirror/theme-one-dark` = "^6.1.3"
- `react-markdown` = "^10.1.0"
- `remark-gfm` = "^4.0.1"
- `tailwindcss` = "^4.0.0"
- `@tailwindcss/vite` = "^4.0.0"
- `@tailwindcss/typography` = "^0.5.19"

## Design System (Dark Theme - Obsidian-inspired)

### Colors
- Background: `#1e1e1e` (main), `#252525` (panels), `#2d2d2d` (cards/elevated)
- Text: `#dcddde` (primary), `#888888` (secondary/muted), `#666666` (tertiary)
- Borders: `#3d3d3d`
- Accent: `#7c3aed` (purple), `#a78bfa` (light purple for tags)

### Layout
- Left Panel: 250px fixed width
- Main View: Flexible, fills remaining space
- Right Drawer: 500px max or 40% of screen, slides from right as overlay

### Animations
- Drawer slide: 200ms ease-out
- Modal fade/zoom: 200ms
- Hover transitions: 150ms

## State Management (Zustand Stores)

### atoms.ts
- `atoms: AtomWithTags[]` - All loaded atoms
- `isLoading: boolean` - Loading state
- `error: string | null` - Error message
- Actions: `fetchAtoms`, `fetchAtomsByTag`, `createAtom`, `updateAtom`, `deleteAtom`

### tags.ts
- `tags: TagWithCount[]` - Hierarchical tag tree
- `isLoading: boolean`
- `error: string | null`
- Actions: `fetchTags`, `createTag`, `updateTag`, `deleteTag`

### ui.ts
- `selectedTagId: string | null` - Currently selected tag filter
- `drawerState: { isOpen, mode, atomId }` - Drawer state
- `viewMode: 'grid' | 'list'` - Atom display mode
- `searchQuery: string` - Search filter
- Actions: `setSelectedTag`, `openDrawer`, `closeDrawer`, `setViewMode`, `setSearchQuery`

## Future Phases

### Phase 2: AI/Embeddings
- Integrate embedding model for semantic search
- Populate `atom_chunks` table with chunked content and embeddings
- Add vector similarity search using sqlite-vec

### Phase 3: Wiki Integration
- Wikipedia article fetching and display
- Wiki viewer in right drawer

