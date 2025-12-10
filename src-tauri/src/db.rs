use rusqlite::ffi::sqlite3_auto_extension;
use rusqlite::Connection;
use sqlite_vec::sqlite3_vec_init;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub struct Database {
    pub conn: Mutex<Connection>,
    pub db_path: PathBuf,
    pub resource_dir: PathBuf, // Kept for potential future use
}

/// Thread-safe wrapper around Database using Arc
pub type SharedDatabase = Arc<Database>;

impl Database {
    pub fn new(app_data_dir: PathBuf, resource_dir: PathBuf) -> Result<Self, String> {
        // Register sqlite-vec extension
        unsafe {
            #[allow(clippy::missing_transmute_annotations)]
            sqlite3_auto_extension(Some(std::mem::transmute(sqlite3_vec_init as *const ())));
        }

        // Create database directory if it doesn't exist
        std::fs::create_dir_all(&app_data_dir)
            .map_err(|e| format!("Failed to create app data directory: {}", e))?;

        let db_path = app_data_dir.join("atomic.db");
        let conn = Connection::open(&db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        // Run migrations
        Self::run_migrations(&conn)?;

        Ok(Database {
            conn: Mutex::new(conn),
            db_path,
            resource_dir,
        })
    }

    /// Create a new connection to the same database
    /// This is useful for background tasks that need their own connection
    pub fn new_connection(&self) -> Result<Connection, String> {
        let conn = Connection::open(&self.db_path)
            .map_err(|e| format!("Failed to open database connection: {}", e))?;

        Ok(conn)
    }

    fn run_migrations(conn: &Connection) -> Result<(), String> {
        conn.execute_batch(
            r#"
            -- Atoms are the core content units
            CREATE TABLE IF NOT EXISTS atoms (
                id TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                source_url TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                embedding_status TEXT DEFAULT 'pending'
            );

            -- Hierarchical tags
            CREATE TABLE IF NOT EXISTS tags (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL COLLATE NOCASE,
                parent_id TEXT REFERENCES tags(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL,
                UNIQUE(name COLLATE NOCASE)
            );

            -- Many-to-many relationship
            CREATE TABLE IF NOT EXISTS atom_tags (
                atom_id TEXT REFERENCES atoms(id) ON DELETE CASCADE,
                tag_id TEXT REFERENCES tags(id) ON DELETE CASCADE,
                PRIMARY KEY (atom_id, tag_id)
            );

            -- For Phase 2 embeddings
            CREATE TABLE IF NOT EXISTS atom_chunks (
                id TEXT PRIMARY KEY,
                atom_id TEXT REFERENCES atoms(id) ON DELETE CASCADE,
                chunk_index INTEGER NOT NULL,
                content TEXT NOT NULL,
                embedding BLOB
            );

            -- Settings table for app configuration
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            -- Indexes
            CREATE INDEX IF NOT EXISTS idx_atom_chunks_atom_id ON atom_chunks(atom_id);
            CREATE INDEX IF NOT EXISTS idx_atom_tags_atom_id ON atom_tags(atom_id);
            CREATE INDEX IF NOT EXISTS idx_atom_tags_tag_id ON atom_tags(tag_id);
            CREATE INDEX IF NOT EXISTS idx_tags_parent_id ON tags(parent_id);
            CREATE INDEX IF NOT EXISTS idx_tags_name_nocase ON tags(name COLLATE NOCASE);
            CREATE INDEX IF NOT EXISTS idx_atoms_updated_at ON atoms(updated_at);
            CREATE INDEX IF NOT EXISTS idx_atom_chunks_composite ON atom_chunks(atom_id, chunk_index);

            -- Wiki articles for tags
            CREATE TABLE IF NOT EXISTS wiki_articles (
              id TEXT PRIMARY KEY,
              tag_id TEXT UNIQUE REFERENCES tags(id) ON DELETE CASCADE,
              content TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              atom_count INTEGER NOT NULL
            );

            -- Citations linking article content to source atoms/chunks
            CREATE TABLE IF NOT EXISTS wiki_citations (
              id TEXT PRIMARY KEY,
              wiki_article_id TEXT REFERENCES wiki_articles(id) ON DELETE CASCADE,
              citation_index INTEGER NOT NULL,
              atom_id TEXT REFERENCES atoms(id) ON DELETE CASCADE,
              chunk_index INTEGER,
              excerpt TEXT NOT NULL
            );

            -- Indexes for wiki tables
            CREATE INDEX IF NOT EXISTS idx_wiki_articles_tag ON wiki_articles(tag_id);
            CREATE INDEX IF NOT EXISTS idx_wiki_citations_article ON wiki_citations(wiki_article_id);
            CREATE INDEX IF NOT EXISTS idx_wiki_citations_atom ON wiki_citations(atom_id);

            -- Atom positions for canvas view
            CREATE TABLE IF NOT EXISTS atom_positions (
              atom_id TEXT PRIMARY KEY REFERENCES atoms(id) ON DELETE CASCADE,
              x REAL NOT NULL,
              y REAL NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_atom_positions_atom ON atom_positions(atom_id);

            -- Chat conversations
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                is_archived INTEGER DEFAULT 0
            );

            -- Many-to-many: conversation tag scope (editable at any time)
            CREATE TABLE IF NOT EXISTS conversation_tags (
                conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                PRIMARY KEY (conversation_id, tag_id)
            );

            -- Chat messages
            CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                message_index INTEGER NOT NULL
            );

            -- Tool calls for transparency and debugging
            CREATE TABLE IF NOT EXISTS chat_tool_calls (
                id TEXT PRIMARY KEY,
                message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
                tool_name TEXT NOT NULL,
                tool_input TEXT NOT NULL,
                tool_output TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                completed_at TEXT
            );

            -- Chat citations (mirrors wiki_citations pattern)
            CREATE TABLE IF NOT EXISTS chat_citations (
                id TEXT PRIMARY KEY,
                message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
                citation_index INTEGER NOT NULL,
                atom_id TEXT NOT NULL REFERENCES atoms(id) ON DELETE CASCADE,
                chunk_index INTEGER,
                excerpt TEXT NOT NULL,
                relevance_score REAL
            );

            -- Indexes for chat tables
            CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_conversation_tags_conv ON conversation_tags(conversation_id);
            CREATE INDEX IF NOT EXISTS idx_conversation_tags_tag ON conversation_tags(tag_id);
            CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id, message_index);
            CREATE INDEX IF NOT EXISTS idx_chat_tool_calls_message ON chat_tool_calls(message_id);
            CREATE INDEX IF NOT EXISTS idx_chat_citations_message ON chat_citations(message_id);
            CREATE INDEX IF NOT EXISTS idx_chat_citations_atom ON chat_citations(atom_id);

            -- Semantic edges for graph visualization (pre-computed during embedding)
            CREATE TABLE IF NOT EXISTS semantic_edges (
                id TEXT PRIMARY KEY,
                source_atom_id TEXT NOT NULL REFERENCES atoms(id) ON DELETE CASCADE,
                target_atom_id TEXT NOT NULL REFERENCES atoms(id) ON DELETE CASCADE,
                similarity_score REAL NOT NULL,
                source_chunk_index INTEGER,
                target_chunk_index INTEGER,
                created_at TEXT NOT NULL,
                UNIQUE(source_atom_id, target_atom_id)
            );

            CREATE INDEX IF NOT EXISTS idx_semantic_edges_source ON semantic_edges(source_atom_id);
            CREATE INDEX IF NOT EXISTS idx_semantic_edges_target ON semantic_edges(target_atom_id);
            CREATE INDEX IF NOT EXISTS idx_semantic_edges_score ON semantic_edges(similarity_score DESC);

            -- Atom cluster assignments for visual grouping
            CREATE TABLE IF NOT EXISTS atom_clusters (
                atom_id TEXT PRIMARY KEY REFERENCES atoms(id) ON DELETE CASCADE,
                cluster_id INTEGER NOT NULL,
                computed_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_atom_clusters_cluster ON atom_clusters(cluster_id);
            "#,
        )
        .map_err(|e| format!("Failed to run migrations: {}", e))?;

        // Add embedding_status column to atoms table if it doesn't exist
        Self::add_embedding_status_column(conn)?;

        // Add tagging_status column to atoms table if it doesn't exist
        Self::add_tagging_status_column(conn)?;

        // Create vec_chunks virtual table for sqlite-vec similarity search
        Self::create_vec_chunks_table(conn)?;

        // Create FTS5 virtual table for keyword search
        Self::create_fts_table(conn)?;

        // Backfill FTS5 table with existing chunks (if any)
        Self::backfill_fts_table(conn)?;

        // Insert default top-level tags if they don't exist
        Self::insert_default_tags(conn)?;

        Ok(())
    }

    fn add_embedding_status_column(conn: &Connection) -> Result<(), String> {
        // Check if embedding_status column exists
        let column_exists: bool = conn
            .prepare("SELECT 1 FROM pragma_table_info('atoms') WHERE name = 'embedding_status'")
            .map_err(|e| format!("Failed to prepare column check: {}", e))?
            .exists([])
            .map_err(|e| format!("Failed to check column existence: {}", e))?;

        if !column_exists {
            conn.execute(
                "ALTER TABLE atoms ADD COLUMN embedding_status TEXT DEFAULT 'pending'",
                [],
            )
            .map_err(|e| format!("Failed to add embedding_status column: {}", e))?;
        }

        // Create index for embedding_status (safe to run even if it exists)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_atoms_embedding_status ON atoms(embedding_status)",
            [],
        )
        .map_err(|e| format!("Failed to create embedding_status index: {}", e))?;

        Ok(())
    }

    fn add_tagging_status_column(conn: &Connection) -> Result<(), String> {
        // Check if tagging_status column exists
        let column_exists: bool = conn
            .prepare("SELECT 1 FROM pragma_table_info('atoms') WHERE name = 'tagging_status'")
            .map_err(|e| format!("Failed to prepare column check: {}", e))?
            .exists([])
            .map_err(|e| format!("Failed to check column existence: {}", e))?;

        if !column_exists {
            // Add column with default 'pending'
            conn.execute(
                "ALTER TABLE atoms ADD COLUMN tagging_status TEXT DEFAULT 'pending'",
                [],
            )
            .map_err(|e| format!("Failed to add tagging_status column: {}", e))?;

            // For existing atoms, set tagging_status based on embedding_status:
            // - 'complete' embedding -> 'complete' tagging (already tagged)
            // - 'failed' embedding -> 'skipped' tagging (can't tag without embedding)
            // - 'pending'/'processing' -> 'pending' (needs both)
            conn.execute(
                "UPDATE atoms SET tagging_status = 'complete' WHERE embedding_status = 'complete'",
                [],
            )
            .map_err(|e| format!("Failed to update existing atom tagging status: {}", e))?;

            conn.execute(
                "UPDATE atoms SET tagging_status = 'skipped' WHERE embedding_status = 'failed'",
                [],
            )
            .map_err(|e| format!("Failed to update failed atom tagging status: {}", e))?;
        }

        // Create index for tagging_status
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_atoms_tagging_status ON atoms(tagging_status)",
            [],
        )
        .map_err(|e| format!("Failed to create tagging_status index: {}", e))?;

        Ok(())
    }

    fn create_vec_chunks_table(conn: &Connection) -> Result<(), String> {
        // Create vec_chunks virtual table for sqlite-vec similarity search
        // This uses the vec0 module from sqlite-vec for vector similarity
        // Using 1536 dimensions for OpenRouter's text-embedding-3-small model
        conn.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
                chunk_id TEXT PRIMARY KEY,
                embedding float[1536]
            )",
            [],
        )
        .map_err(|e| format!("Failed to create vec_chunks table: {}", e))?;

        Ok(())
    }

    fn create_fts_table(conn: &Connection) -> Result<(), String> {
        // Create FTS5 virtual table for keyword/BM25 search
        // Using porter tokenizer for English stemming (matches "run", "running", "ran")
        // unicode61 handles non-ASCII characters properly
        // UNINDEXED columns are stored but not searchable
        conn.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS atom_chunks_fts USING fts5(
                chunk_id UNINDEXED,
                atom_id UNINDEXED,
                content,
                chunk_index UNINDEXED,
                tokenize = 'porter unicode61'
            )",
            [],
        )
        .map_err(|e| format!("Failed to create atom_chunks_fts table: {}", e))?;

        Ok(())
    }

    fn backfill_fts_table(conn: &Connection) -> Result<(), String> {
        // Check if FTS table needs backfilling by comparing counts
        let fts_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM atom_chunks_fts", [], |row| row.get(0))
            .unwrap_or(0);

        let chunks_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM atom_chunks", [], |row| row.get(0))
            .unwrap_or(0);

        // Only backfill if FTS is empty but chunks exist
        if fts_count == 0 && chunks_count > 0 {
            conn.execute(
                "INSERT INTO atom_chunks_fts (chunk_id, atom_id, content, chunk_index)
                 SELECT id, atom_id, content, chunk_index FROM atom_chunks",
                [],
            )
            .map_err(|e| format!("Failed to backfill FTS table: {}", e))?;

            eprintln!("Backfilled {} chunks into FTS5 table", chunks_count);
        }

        Ok(())
    }

    fn insert_default_tags(conn: &Connection) -> Result<(), String> {
        // Default top-level category tags for auto-tagging
        // These must match the categories in scripts/reset-tags.js and scripts/reset-database.js
        let default_tags = vec!["Topics", "People", "Locations", "Organizations", "Events"];
        let now = chrono::Utc::now().to_rfc3339();

        for tag_name in default_tags {
            // Check if tag already exists
            let exists: bool = conn
                .prepare("SELECT 1 FROM tags WHERE name = ?1 COLLATE NOCASE")
                .map_err(|e| format!("Failed to prepare tag check: {}", e))?
                .exists([tag_name])
                .map_err(|e| format!("Failed to check tag existence: {}", e))?;

            if !exists {
                // Generate a simple UUID-like ID for the tag
                let tag_id = uuid::Uuid::new_v4().to_string();

                conn.execute(
                    "INSERT INTO tags (id, name, parent_id, created_at) VALUES (?1, ?2, NULL, ?3)",
                    [&tag_id, tag_name, &now],
                )
                .map_err(|e| format!("Failed to insert default tag '{}': {}", tag_name, e))?;
            }
        }

        Ok(())
    }
}

/// Get the embedding dimension for an OpenRouter model
pub fn get_openrouter_embedding_dimension(model: &str) -> usize {
    match model {
        "openai/text-embedding-3-small" => 1536,
        "openai/text-embedding-3-large" => 3072,
        _ => 1536, // Default to small model dimension
    }
}

/// Get embedding dimension based on current settings
/// Uses ProviderConfig to determine the correct dimension for the active provider
pub fn get_current_embedding_dimension(conn: &Connection) -> usize {
    use crate::providers::ProviderConfig;
    use crate::settings;

    let settings_map = settings::get_all_settings(conn).unwrap_or_default();
    let config = ProviderConfig::from_settings(&settings_map);
    config.embedding_dimension()
}

/// Check if dimension will change with new settings
pub fn will_dimension_change(
    conn: &Connection,
    key: &str,
    new_value: &str,
) -> (bool, usize) {
    use crate::providers::ProviderConfig;
    use crate::settings;

    let current_dim = get_current_embedding_dimension(conn);

    // Get current settings and apply the change
    let mut settings_map = settings::get_all_settings(conn).unwrap_or_default();
    settings_map.insert(key.to_string(), new_value.to_string());

    let new_config = ProviderConfig::from_settings(&settings_map);
    let new_dim = new_config.embedding_dimension();

    (current_dim != new_dim, new_dim)
}

/// Recreate vec_chunks table with a new dimension and reset embedding status
/// Tags are preserved - only embeddings need to be regenerated
pub fn recreate_vec_chunks_with_dimension(conn: &Connection, dimension: usize) -> Result<(), String> {
    // Drop existing vec_chunks table
    conn.execute("DROP TABLE IF EXISTS vec_chunks", [])
        .map_err(|e| format!("Failed to drop vec_chunks table: {}", e))?;

    // Create new vec_chunks table with the specified dimension
    let create_sql = format!(
        "CREATE VIRTUAL TABLE vec_chunks USING vec0(chunk_id TEXT PRIMARY KEY, embedding float[{}])",
        dimension
    );
    conn.execute(&create_sql, [])
        .map_err(|e| format!("Failed to create vec_chunks table: {}", e))?;

    // Reset ONLY embedding status to pending (need to re-embed)
    conn.execute("UPDATE atoms SET embedding_status = 'pending'", [])
        .map_err(|e| format!("Failed to reset atom embedding status: {}", e))?;

    // Set tagging_status to 'skipped' - existing tags are preserved, no re-tagging needed
    conn.execute("UPDATE atoms SET tagging_status = 'skipped'", [])
        .map_err(|e| format!("Failed to update atom tagging status: {}", e))?;

    // Clear all existing chunk data since it's invalid with new dimensions
    conn.execute("DELETE FROM atom_chunks", [])
        .map_err(|e| format!("Failed to clear atom_chunks: {}", e))?;

    // Clear FTS5 table since it mirrors atom_chunks
    conn.execute("DELETE FROM atom_chunks_fts", [])
        .map_err(|e| format!("Failed to clear atom_chunks_fts: {}", e))?;

    // Clear semantic edges since they depend on embeddings
    conn.execute("DELETE FROM semantic_edges", [])
        .map_err(|e| format!("Failed to clear semantic_edges: {}", e))?;

    // Clear canvas positions since they were based on old embedding similarities
    conn.execute("DELETE FROM atom_positions", [])
        .map_err(|e| format!("Failed to clear atom_positions: {}", e))?;

    Ok(())
}
