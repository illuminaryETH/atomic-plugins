import type Database from "better-sqlite3";
import type { DedupEntry } from "../types/index.js";

/** Build the dedup key from Discord IDs */
export function dedupKey(
  guildId: string,
  channelId: string,
  messageId: string,
): string {
  return `${guildId}:${channelId}:${messageId}`;
}

/** Check if a Discord message has already been ingested */
export function checkDedup(
  db: Database.Database,
  key: string,
): DedupEntry | null {
  const row = db
    .prepare("SELECT * FROM dedup_index WHERE discord_key = ?")
    .get(key) as Record<string, unknown> | undefined;

  if (!row) return null;

  return {
    discord_key: row.discord_key as string,
    atom_id: row.atom_id as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/** Store a dedup entry after successful ingestion */
export function storeDedup(
  db: Database.Database,
  key: string,
  atomId: string,
): void {
  db.prepare(
    `INSERT INTO dedup_index (discord_key, atom_id)
     VALUES (?, ?)
     ON CONFLICT(discord_key) DO UPDATE SET
       atom_id = excluded.atom_id,
       updated_at = datetime('now')`,
  ).run(key, atomId);
}

/** Get atom ID for a previously ingested message */
export function getAtomId(
  db: Database.Database,
  key: string,
): string | null {
  const entry = checkDedup(db, key);
  return entry?.atom_id ?? null;
}
