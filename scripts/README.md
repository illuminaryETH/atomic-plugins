# Atomic Scripts

This directory contains utility scripts for the Atomic application.

## Wikipedia Import Script

The `import-wikipedia.js` script fetches Wikipedia articles and imports them into the Atomic database for stress testing.

### Prerequisites

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the Atomic app at least once to create the database.

### Usage

```bash
# Import 500 articles (default)
npm run import:wikipedia

# Import a custom number of articles
npm run import:wikipedia 1000

# Specify a custom database path
npm run import:wikipedia 500 --db /path/to/atomic.db
```

### Topics

The script imports articles from three domains for diversity:

1. **Computing** (~200 articles)
   - History of computing, Alan Turing, Programming languages, AI, etc.

2. **Philosophy** (~200 articles)
   - Plato, Aristotle, Ethics, Metaphysics, Existentialism, etc.

3. **History** (~200 articles)
   - European history, World Wars, Ancient civilizations, etc.

### How It Works

1. Starts with seed articles from each domain
2. Fetches article summaries from Wikipedia's REST API
3. Follows related article links to discover more content
4. Inserts articles into the SQLite database with `embedding_status: 'pending'`
5. Respects rate limits (100ms delay between requests)

### After Import

When you open the Atomic app after importing:

1. The embedding pipeline will process all pending atoms
2. If auto-tagging is enabled, tags will be extracted using the configured model
3. Processing time depends on:
   - Number of imported articles
   - Your OpenRouter API rate limits
   - The configured tagging model (gpt-4o-mini is faster/cheaper)

### Database Location

The script automatically detects the database location based on your OS:

- **macOS**: `~/Library/Application Support/com.atomic.app/atomic.db`
- **Linux**: `~/.local/share/com.atomic.app/atomic.db`
- **Windows**: `%APPDATA%/com.atomic.app/atomic.db`

You can override this with the `--db` flag.

### Tips for Bulk Import

1. **Use a cheaper model**: Set the tagging model to `openai/gpt-4o-mini` in settings before importing
2. **Disable auto-tagging**: If you don't need tags, disable auto-tagging in settings to speed up processing
3. **Start small**: Test with 50-100 articles first to estimate processing time

---

## Chunk Reset Script

The `reset-chunks.js` script deletes all chunks and related data, then marks atoms for re-embedding. This is useful after changing the chunking strategy or embedding model.

### What It Deletes

- All chat conversations, messages, tool calls, and citations
- All wiki articles and citations
- All semantic edges and atom clusters
- All atom positions (canvas will re-simulate)
- All vector chunks and FTS entries
- All atom chunks

### What It Preserves

- All atoms (content is preserved)
- All tags and tag associations

### Usage

```bash
# Preview what would be deleted (recommended first step)
node scripts/reset-chunks.js --dry-run

# Reset with backup (recommended)
node scripts/reset-chunks.js --backup

# Reset without confirmation
node scripts/reset-chunks.js --force --backup

# Specify custom database path
node scripts/reset-chunks.js --db /path/to/atomic.db
```

### Options

| Option | Description |
|--------|-------------|
| `--dry-run` | Show what would happen without making changes |
| `--backup` | Create a backup before resetting |
| `--force` | Skip confirmation prompt |
| `--db <path>` | Custom database path |
| `--help` | Show help message |

### After Reset

1. Start the Atomic app
2. Go to Settings and click "Process Pending Embeddings"
3. Wait for all atoms to be re-embedded with the new chunking strategy

---

## Tag Reset Script

The `reset-tags.js` script resets all tags to default top-level categories and marks atoms for re-tagging.

### Usage

```bash
# Preview what would be deleted
node scripts/reset-tags.js --dry-run

# Reset with backup
node scripts/reset-tags.js --backup

# Reset without confirmation
node scripts/reset-tags.js --force --backup
```

### What It Does

1. Deletes all wiki articles and citations
2. Deletes all atom-tag associations
3. Deletes all tags and recreates default categories
4. Marks all atoms for re-tagging

---

## Database Location

All scripts automatically detect the database location based on your OS:

- **macOS**: `~/Library/Application Support/com.atomic.app/atomic.db`
- **Linux**: `~/.local/share/com.atomic.app/atomic.db`
- **Windows**: `%APPDATA%/com.atomic.app/atomic.db`

You can override this with the `--db` flag on any script.

