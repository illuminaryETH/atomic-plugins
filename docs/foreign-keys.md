# Enabling `PRAGMA foreign_keys=ON`

SQLite foreign key constraints are currently **off** (the SQLite default). The schema defines `REFERENCES ... ON DELETE CASCADE` and `ON DELETE SET NULL` throughout, but these constraints are not enforced at runtime. This document tracks what needs to change before enabling them.

## Why enable it

- CASCADE deletes actually fire, eliminating orphaned rows
- Invalid foreign key references are rejected at insert time instead of silently accepted
- The schema becomes the source of truth for referential integrity

## What breaks

### 1. Unvalidated tag IDs on insert

`create_atom`, `update_atom`, `create_conversation`, and `set_conversation_scope` all insert into junction tables (`atom_tags`, `conversation_tags`) using caller-provided tag IDs with no validation. An invalid ID will cause a FK violation error.

**Fix:** Validate tag IDs exist before inserting, or catch the FK error and return a meaningful error to the caller.

**Files:** `lib.rs` (create_atom, update_atom), `chat.rs` (create_conversation, set_conversation_scope)

### 2. Missing transaction wrapping

Several multi-statement operations are not wrapped in transactions. If a FK violation occurs mid-operation, the database is left in a partial state (e.g., old tags deleted but new tags only half-applied).

Operations that need transactions:
- `create_atom` — atom insert + tag inserts
- `update_atom` — content update + tag delete/re-insert
- `set_conversation_scope` — old scope delete + new scope insert
- `save_wiki_article` — old article delete + new article/citations/links insert

**Files:** `lib.rs`, `chat.rs`, `wiki.rs`

### 3. `INSERT OR IGNORE` does not suppress FK violations

SQLite's `OR IGNORE` conflict resolution only applies to UNIQUE, PRIMARY KEY, NOT NULL, and CHECK constraints — **not** foreign key constraints. Several code paths use `INSERT OR IGNORE INTO atom_tags` or `INSERT OR IGNORE INTO conversation_tags` expecting silent failure on conflicts, but FK violations will still raise hard errors.

**Fix:** Either validate the parent exists first, or wrap in a try/catch and handle the FK error.

**Files:** `chat.rs` (add_tag_to_scope), `extraction.rs`, `compaction.rs`, `lib.rs` (bulk tag operations)

### 4. `save_atom_positions` fails on stale atom IDs

The frontend sends positions for all visible atoms in a single batch transaction. If any atom was deleted between the frontend collecting positions and the save, the FK constraint on `atom_positions.atom_id → atoms(id)` rejects the insert and the **entire batch rolls back**.

**Fix:** Filter out positions for nonexistent atoms, or use per-row error handling instead of a single transaction.

**File:** `lib.rs` (save_atom_positions)

### 5. Virtual tables not cleaned up before CASCADE

`delete_atom` relies on CASCADE to delete `atom_chunks`, but two virtual tables that mirror chunk data are not covered by FK constraints:

- **`vec_chunks`** (vec0) — orphaned vectors cause phantom semantic search results
- **`atom_chunks_fts`** (FTS5 external content) — stale index entries cause phantom keyword search results

Similarly, `delete_tag` does not clean up **`vec_tags`** (vec0).

**Fix:** Before deleting an atom, explicitly remove its entries from `vec_chunks` and `atom_chunks_fts`. Before deleting a tag, remove its entry from `vec_tags`. This should happen regardless of FK enforcement — it's a pre-existing bug.

**Files:** `lib.rs` (delete_atom, delete_tag)

### 6. Tag merge compaction destroys wiki articles

`execute_tag_merge` deletes the loser tag, which CASCADE deletes any `wiki_articles` for that tag (and their citations/links). The wiki content is not migrated to the winner tag.

**Fix:** Before deleting the loser tag, either migrate the wiki article to the winner tag or regenerate the winner's wiki after merge.

**File:** `compaction.rs`

## Recommended rollout

1. Fix issues 5 (virtual table cleanup) first — these are bugs today regardless of FK enforcement
2. Add transaction wrapping (issue 2)
3. Add tag ID validation (issue 1) and fix `OR IGNORE` paths (issue 3)
4. Handle stale positions (issue 4) and wiki migration (issue 6)
5. Add `PRAGMA foreign_keys=ON` to `BASE_PRAGMAS` in `db.rs`
6. Run `PRAGMA foreign_key_check` against a production database to find existing violations before enabling
