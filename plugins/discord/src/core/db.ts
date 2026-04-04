import Database from "better-sqlite3";
import type { ChannelConfig, IngestionMode } from "../types/index.js";

export function initDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS dedup_index (
      discord_key TEXT PRIMARY KEY,
      atom_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS channel_configs (
      channel_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_name TEXT NOT NULL DEFAULT '',
      channel_type TEXT NOT NULL DEFAULT 'GUILD_TEXT',
      mode TEXT NOT NULL DEFAULT 'reaction-only',
      settle_window_seconds INTEGER NOT NULL DEFAULT 300,
      include_bot_messages INTEGER NOT NULL DEFAULT 0,
      include_embeds INTEGER NOT NULL DEFAULT 1,
      digest_interval_minutes INTEGER NOT NULL DEFAULT 60,
      tags TEXT NOT NULL DEFAULT '[]',
      forum_tag_mapping INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1
    );
  `);

  return db;
}

// ---- Channel config CRUD ----

export function getChannelConfig(
  db: Database.Database,
  channelId: string,
): ChannelConfig | null {
  const row = db
    .prepare("SELECT * FROM channel_configs WHERE channel_id = ?")
    .get(channelId) as Record<string, unknown> | undefined;

  if (!row) return null;
  return rowToChannelConfig(row);
}

export function getAllActiveChannelConfigs(
  db: Database.Database,
): ChannelConfig[] {
  const rows = db
    .prepare("SELECT * FROM channel_configs WHERE active = 1")
    .all() as Record<string, unknown>[];

  return rows.map(rowToChannelConfig);
}

export function upsertChannelConfig(
  db: Database.Database,
  config: ChannelConfig,
): void {
  db.prepare(`
    INSERT INTO channel_configs (
      channel_id, guild_id, channel_name, channel_type, mode,
      settle_window_seconds, include_bot_messages, include_embeds,
      digest_interval_minutes, tags, forum_tag_mapping, active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET
      guild_id = excluded.guild_id,
      channel_name = excluded.channel_name,
      channel_type = excluded.channel_type,
      mode = excluded.mode,
      settle_window_seconds = excluded.settle_window_seconds,
      include_bot_messages = excluded.include_bot_messages,
      include_embeds = excluded.include_embeds,
      digest_interval_minutes = excluded.digest_interval_minutes,
      tags = excluded.tags,
      forum_tag_mapping = excluded.forum_tag_mapping,
      active = excluded.active
  `).run(
    config.channel_id,
    config.guild_id,
    config.channel_name,
    config.channel_type,
    config.mode,
    config.settle_window_seconds,
    config.include_bot_messages ? 1 : 0,
    config.include_embeds ? 1 : 0,
    config.digest_interval_minutes,
    JSON.stringify(config.tags),
    config.forum_tag_mapping ? 1 : 0,
    config.active ? 1 : 0,
  );
}

export function deleteChannelConfig(
  db: Database.Database,
  channelId: string,
): void {
  db.prepare("DELETE FROM channel_configs WHERE channel_id = ?").run(channelId);
}

function rowToChannelConfig(row: Record<string, unknown>): ChannelConfig {
  return {
    channel_id: row.channel_id as string,
    guild_id: row.guild_id as string,
    channel_name: row.channel_name as string,
    channel_type: row.channel_type as ChannelConfig["channel_type"],
    mode: row.mode as IngestionMode,
    settle_window_seconds: row.settle_window_seconds as number,
    include_bot_messages: Boolean(row.include_bot_messages),
    include_embeds: Boolean(row.include_embeds),
    digest_interval_minutes: row.digest_interval_minutes as number,
    tags: JSON.parse(row.tags as string) as string[],
    forum_tag_mapping: Boolean(row.forum_tag_mapping),
    active: Boolean(row.active),
  };
}
