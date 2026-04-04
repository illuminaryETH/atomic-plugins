import {
  type Client,
  type MessageReaction,
  type PartialMessageReaction,
  type User,
  type PartialUser,
  type ThreadChannel,
  ChannelType,
} from "discord.js";
import type { Pipeline } from "../core/pipeline.js";
import type { AppConfig } from "../types/index.js";
import {
  buildSingleMessage,
  buildThreadMessage,
} from "./messages.js";
import { confirmCapture } from "./confirm.js";

/** Set up reaction-based capture */
export function setupReactionHandler(
  client: Client,
  pipeline: Pipeline,
  config: AppConfig,
): void {
  client.on(
    "messageReactionAdd",
    async (
      reaction: MessageReaction | PartialMessageReaction,
      user: User | PartialUser,
    ) => {
      // Ignore bot reactions
      if (user.bot) return;

      // Check if the emoji matches our trigger
      const emojiName = reaction.emoji.name;
      if (
        emojiName !== config.ingestion.reaction_emoji &&
        emojiName !== config.ingestion.fallback_emoji
      ) {
        return;
      }

      try {
        // Ensure the message is fully fetched
        const message = reaction.message.partial
          ? await reaction.message.fetch()
          : reaction.message;

        // Skip bot messages unless configured otherwise
        if (message.author.bot && !config.ingestion.include_bot_messages) {
          return;
        }

        // Determine if this message is in a thread
        const channel = message.channel;
        let normalizedMsg;

        if (
          channel.type === ChannelType.PublicThread ||
          channel.type === ChannelType.PrivateThread
        ) {
          // Capture the full thread
          normalizedMsg = await buildThreadMessage(
            channel as ThreadChannel,
            config.ingestion.max_thread_depth,
          );
        } else {
          // Single message capture
          normalizedMsg = buildSingleMessage(message);
        }

        if (!normalizedMsg) {
          console.warn("Could not normalize message for reaction capture");
          return;
        }

        const result = await pipeline.ingest(normalizedMsg);
        await confirmCapture(message, result);
      } catch (err) {
        console.error("Reaction capture failed:", err);
      }
    },
  );
}
