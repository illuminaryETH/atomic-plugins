-- Migration 002: Add db_id column for multi-database support
--
-- All per-database tables get a db_id column that scopes data to a logical
-- knowledge base. UUIDs remain globally unique so primary keys and foreign
-- keys don't change — db_id is purely a filter column.
--
-- Tables that stay global (no db_id): settings, api_tokens, schema_version

ALTER TABLE atoms ADD COLUMN IF NOT EXISTS db_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE tags ADD COLUMN IF NOT EXISTS db_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE atom_tags ADD COLUMN IF NOT EXISTS db_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE atom_chunks ADD COLUMN IF NOT EXISTS db_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE atom_positions ADD COLUMN IF NOT EXISTS db_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE semantic_edges ADD COLUMN IF NOT EXISTS db_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE atom_clusters ADD COLUMN IF NOT EXISTS db_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE tag_embeddings ADD COLUMN IF NOT EXISTS db_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE wiki_articles ADD COLUMN IF NOT EXISTS db_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE wiki_citations ADD COLUMN IF NOT EXISTS db_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE wiki_links ADD COLUMN IF NOT EXISTS db_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE wiki_article_versions ADD COLUMN IF NOT EXISTS db_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS db_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE conversation_tags ADD COLUMN IF NOT EXISTS db_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS db_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE chat_tool_calls ADD COLUMN IF NOT EXISTS db_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE chat_citations ADD COLUMN IF NOT EXISTS db_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE feeds ADD COLUMN IF NOT EXISTS db_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE feed_tags ADD COLUMN IF NOT EXISTS db_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE feed_items ADD COLUMN IF NOT EXISTS db_id TEXT NOT NULL DEFAULT 'default';

-- Indexes for db_id scoping on high-traffic tables
CREATE INDEX IF NOT EXISTS idx_atoms_db_id ON atoms(db_id);
CREATE INDEX IF NOT EXISTS idx_tags_db_id ON tags(db_id);
CREATE INDEX IF NOT EXISTS idx_conversations_db_id ON conversations(db_id);
CREATE INDEX IF NOT EXISTS idx_feeds_db_id ON feeds(db_id);
CREATE INDEX IF NOT EXISTS idx_wiki_articles_db_id ON wiki_articles(db_id);
CREATE INDEX IF NOT EXISTS idx_atom_chunks_db_id ON atom_chunks(db_id);

-- Recreate unique constraints to include db_id
DROP INDEX IF EXISTS idx_tags_name_parent;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name_parent ON tags(db_id, LOWER(name), COALESCE(parent_id, ''));

-- Unique constraints that include db_id for ON CONFLICT usage
CREATE UNIQUE INDEX IF NOT EXISTS idx_atom_positions_db_id ON atom_positions(atom_id, db_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tag_embeddings_db_id ON tag_embeddings(tag_id, db_id);

INSERT INTO schema_version (version) VALUES (2);
