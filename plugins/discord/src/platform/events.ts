import {
  type Client,
  type Message,
  type ThreadChannel,
  ChannelType,
} from "discord.js";
import type Database from "better-sqlite3";
import type { Pipeline } from "../core/pipeline.js";
import type { AppConfig } from "../types/index.js";
import { SettleManager } from "../core/settle.js";
import { getChannelConfig } from "../core/db.js";
import {
  buildSingleMessage,
  buildThreadMessage,
} from "./messages.js";

/** Set up real-time message and thread event handlers */
export function setupEventHandlers(
  client: Client,
  pipeline: Pipeline,
  db: Database.Database,
  config: AppConfig,
): SettleManager {
  const settleManager = new SettleManager();

  // ---- messageCreate: real-time channel subscription ----
  client.on("messageCreate", async (message: Message) => {
    // Ignore DMs
    if (!message.guild) return;

    // Ignore bot messages unless configured
    if (message.author.bot && !config.ingestion.include_bot_messages) return;

    // Check if this channel is subscribed
    const channelId = message.channel.type === ChannelType.PublicThread ||
      message.channel.type === ChannelType.PrivateThread
      ? (message.channel as ThreadChannel).parentId ?? message.channelId
      : message.channelId;

    const channelConfig = getChannelConfig(db, channelId);
    if (!channelConfig || !channelConfig.active) return;

    // Skip if mode is reaction-only (handled by reaction handler)
    if (channelConfig.mode === "reaction-only") return;

    // For threaded messages, use the thread ID as settle key
    const isThread =
      message.channel.type === ChannelType.PublicThread ||
      message.channel.type === ChannelType.PrivateThread;

    const settleKey = isThread
      ? `thread:${message.channelId}`
      : `channel:${message.channelId}:${message.id}`;

    const settleMs = channelConfig.settle_window_seconds * 1000;

    if (isThread) {
      // For threads, reset settle timer on each new message
      // When timer fires, ingest the full thread
      settleManager.schedule(
        settleKey,
        async () => {
          try {
            const thread = message.channel as ThreadChannel;
            const normalized = await buildThreadMessage(
              thread,
              config.ingestion.max_thread_depth,
            );
            if (normalized) {
              await pipeline.ingest(normalized);
            }
          } catch (err) {
            console.error("Thread ingestion failed:", err);
          }
        },
        settleMs,
      );
    } else {
      // For standalone messages in full mode, use settle window
      // then ingest the single message
      settleManager.schedule(
        settleKey,
        async () => {
          try {
            const normalized = buildSingleMessage(message);
            await pipeline.ingest(normalized);
          } catch (err) {
            console.error("Message ingestion failed:", err);
          }
        },
        settleMs,
      );
    }
  });

  // ---- threadCreate: new thread or forum post ----
  client.on("threadCreate", async (thread: ThreadChannel) => {
    if (!thread.guild) return;

    // Check if parent channel is subscribed
    const parentId = thread.parentId;
    if (!parentId) return;

    const channelConfig = getChannelConfig(db, parentId);
    if (!channelConfig || !channelConfig.active) return;

    // Skip reaction-only channels
    if (channelConfig.mode === "reaction-only") return;

    const settleMs = channelConfig.settle_window_seconds * 1000;
    const settleKey = `thread:${thread.id}`;

    // Wait for the settle window to let the initial post + early replies come in
    settleManager.schedule(
      settleKey,
      async () => {
        try {
          const normalized = await buildThreadMessage(
            thread,
            config.ingestion.max_thread_depth,
          );
          if (normalized) {
            await pipeline.ingest(normalized);
            console.log(
              `Ingested new thread/forum post: ${thread.name} in #${thread.parent?.name}`,
            );
          }
        } catch (err) {
          console.error("Thread creation ingestion failed:", err);
        }
      },
      settleMs,
    );
  });

  return settleManager;
}
