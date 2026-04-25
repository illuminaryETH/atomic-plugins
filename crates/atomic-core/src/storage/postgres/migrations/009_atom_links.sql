-- Materialized Obsidian-style atom links extracted from atom markdown.

CREATE TABLE IF NOT EXISTS atom_links (
    id TEXT PRIMARY KEY,
    source_atom_id TEXT NOT NULL,
    target_atom_id TEXT,
    raw_target TEXT NOT NULL,
    label TEXT,
    target_kind TEXT NOT NULL,
    status TEXT NOT NULL,
    start_offset INTEGER,
    end_offset INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    db_id TEXT NOT NULL DEFAULT 'default'
);

CREATE INDEX IF NOT EXISTS idx_atom_links_source
    ON atom_links(db_id, source_atom_id, start_offset);
CREATE INDEX IF NOT EXISTS idx_atom_links_target
    ON atom_links(db_id, target_atom_id)
    WHERE target_atom_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_atom_links_status
    ON atom_links(db_id, status);

INSERT INTO schema_version (version) VALUES (9);
