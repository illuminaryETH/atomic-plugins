import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { AppConfig, IngestionMode } from "../types/index.js";

const DEFAULTS: Omit<AppConfig, "atomic" | "discord"> = {
  ingestion: {
    reaction_emoji: "atomic",
    fallback_emoji: "🧠",
    default_settle_window: 300,
    default_mode: "reaction-only",
    include_bot_messages: false,
    include_embeds: true,
    max_thread_depth: 100,
    forum_tag_mapping: true,
  },
  tags: {
    auto_channel: true,
    auto_guild: false,
    custom_prefix: "discord",
  },
};

export function loadConfig(configPath: string): AppConfig {
  const raw = readFileSync(configPath, "utf-8");
  const parsed = parse(raw) as Record<string, unknown>;

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid config file: ${configPath}`);
  }

  const atomic = parsed.atomic as Record<string, string> | undefined;
  if (!atomic?.server_url || !atomic?.api_token) {
    throw new Error(
      "Config must include atomic.server_url and atomic.api_token",
    );
  }

  const discord = parsed.discord as Record<string, string> | undefined;
  if (!discord?.bot_token) {
    throw new Error("Config must include discord.bot_token");
  }

  const ingestion = (parsed.ingestion ?? {}) as Record<string, unknown>;
  const tags = (parsed.tags ?? {}) as Record<string, unknown>;

  return {
    atomic: {
      server_url: atomic.server_url.replace(/\/+$/, ""),
      api_token: atomic.api_token,
    },
    discord: {
      bot_token: discord.bot_token,
    },
    ingestion: {
      reaction_emoji:
        str(ingestion.reaction_emoji) ?? DEFAULTS.ingestion.reaction_emoji,
      fallback_emoji:
        str(ingestion.fallback_emoji) ?? DEFAULTS.ingestion.fallback_emoji,
      default_settle_window:
        num(ingestion.default_settle_window) ??
        DEFAULTS.ingestion.default_settle_window,
      default_mode:
        (str(ingestion.default_mode) as IngestionMode | null) ??
        DEFAULTS.ingestion.default_mode,
      include_bot_messages:
        bool(ingestion.include_bot_messages) ??
        DEFAULTS.ingestion.include_bot_messages,
      include_embeds:
        bool(ingestion.include_embeds) ?? DEFAULTS.ingestion.include_embeds,
      max_thread_depth:
        num(ingestion.max_thread_depth) ??
        DEFAULTS.ingestion.max_thread_depth,
      forum_tag_mapping:
        bool(ingestion.forum_tag_mapping) ??
        DEFAULTS.ingestion.forum_tag_mapping,
    },
    tags: {
      auto_channel: bool(tags.auto_channel) ?? DEFAULTS.tags.auto_channel,
      auto_guild: bool(tags.auto_guild) ?? DEFAULTS.tags.auto_guild,
      custom_prefix: str(tags.custom_prefix) ?? DEFAULTS.tags.custom_prefix,
    },
  };
}

/** Type-safe extractors that return null for wrong types instead of truthy strings */
function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}
