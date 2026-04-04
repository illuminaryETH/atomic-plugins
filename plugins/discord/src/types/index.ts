// ---- Normalized message (platform-agnostic) ----

export interface NormalizedMessage {
  id: string;
  guild_id: string;
  channel_id: string;
  channel_name: string;
  channel_type: "text" | "forum" | "voice" | "dm";
  author: {
    id: string;
    display_name: string;
  };
  content: string;
  timestamp: Date;
  thread_id?: string;
  thread_name?: string;
  replies?: NormalizedMessage[];
  attachments: Array<{
    url: string;
    filename: string;
    content_type: string;
  }>;
  embeds?: Array<{
    title?: string;
    description?: string;
    url?: string;
  }>;
  tags?: string[];
  permalink: string;
  guild_name: string;
  metadata: Record<string, unknown>;
}

// ---- Channel configuration ----

export type IngestionMode =
  | "full"
  | "digest"
  | "summary"
  | "reaction-only"
  | "forum";

export interface ChannelConfig {
  guild_id: string;
  channel_id: string;
  channel_name: string;
  channel_type: "GUILD_TEXT" | "GUILD_FORUM" | "GUILD_VOICE";
  mode: IngestionMode;
  settle_window_seconds: number;
  include_bot_messages: boolean;
  include_embeds: boolean;
  digest_interval_minutes: number;
  tags: string[];
  forum_tag_mapping: boolean;
  active: boolean;
}

// ---- Atomic REST API types ----

export interface AtomPayload {
  content: string;
  source_url?: string;
  published_at?: string;
  tag_ids?: string[];
}

export interface AtomResponse {
  id: string;
  content: string;
  title: string | null;
  snippet: string | null;
  source_url: string | null;
  source: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  embedding_status: string;
  tagging_status: string;
  tags: AtomTag[];
}

export interface AtomTag {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
}

export interface BulkCreateResponse {
  atoms: AtomResponse[];
  count: number;
  skipped: number;
}

export interface SearchResult {
  id: string;
  content: string;
  title: string | null;
  source_url: string | null;
  similarity_score: number;
  matching_chunk_content: string | null;
  tags: AtomTag[];
}

export interface TagWithCount {
  id: string;
  name: string;
  parent_id: string | null;
  atom_count: number;
  children: TagWithCount[];
}

// ---- Application config (parsed from YAML) ----

export interface AppConfig {
  atomic: {
    server_url: string;
    api_token: string;
  };
  discord: {
    bot_token: string;
  };
  ingestion: {
    reaction_emoji: string;
    fallback_emoji: string;
    default_settle_window: number;
    default_mode: IngestionMode;
    include_bot_messages: boolean;
    include_embeds: boolean;
    max_thread_depth: number;
    forum_tag_mapping: boolean;
  };
  tags: {
    auto_channel: boolean;
    auto_guild: boolean;
    custom_prefix: string;
  };
}

// ---- Dedup ----

export interface DedupEntry {
  discord_key: string;
  atom_id: string;
  created_at: string;
  updated_at: string;
}

// ---- Pipeline result ----

export interface PipelineResult {
  action: "created" | "updated" | "skipped";
  atom_id?: string;
  reason?: string;
}
