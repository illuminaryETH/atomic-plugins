import {
  type Message,
  type ThreadChannel,
  type ForumChannel,
  type GuildChannel,
  ChannelType,
  type Collection,
  type Snowflake,
} from "discord.js";
import type { NormalizedMessage } from "../types/index.js";

/** Normalize a discord.js Message into our platform-agnostic shape */
export function normalizeMessage(
  msg: Message,
  channelName: string,
  channelType: NormalizedMessage["channel_type"],
  guildName: string,
): NormalizedMessage {
  return {
    id: msg.id,
    guild_id: msg.guildId ?? "",
    channel_id: msg.channelId,
    channel_name: channelName,
    channel_type: channelType,
    author: {
      id: msg.author.id,
      display_name: msg.member?.displayName ?? msg.author.displayName ?? msg.author.username,
    },
    content: msg.content,
    timestamp: new Date(msg.createdTimestamp),
    attachments: [...msg.attachments.values()].map((a) => ({
      url: a.url,
      filename: a.name ?? "unknown",
      content_type: a.contentType ?? "application/octet-stream",
    })),
    embeds: msg.embeds.map((e) => ({
      title: e.title ?? undefined,
      description: e.description ?? undefined,
      url: e.url ?? undefined,
    })),
    permalink: `https://discord.com/channels/${msg.guildId}/${msg.channelId}/${msg.id}`,
    guild_name: guildName,
    metadata: {},
  };
}

/** Determine the normalized channel type from a Discord channel */
export function resolveChannelType(
  channel: GuildChannel | ThreadChannel,
): NormalizedMessage["channel_type"] {
  if (
    channel.type === ChannelType.GuildForum ||
    channel.parent?.type === ChannelType.GuildForum
  ) {
    return "forum";
  }
  if (
    channel.type === ChannelType.GuildVoice ||
    channel.type === ChannelType.GuildStageVoice
  ) {
    return "voice";
  }
  return "text";
}

/** Fetch all messages in a thread, paginating through history */
export async function fetchThreadMessages(
  thread: ThreadChannel,
  maxMessages = 100,
): Promise<Message[]> {
  const messages: Message[] = [];
  let lastId: string | undefined;

  while (messages.length < maxMessages) {
    const batch: Collection<Snowflake, Message> = await thread.messages.fetch({
      limit: Math.min(100, maxMessages - messages.length),
      ...(lastId ? { before: lastId } : {}),
    });

    if (batch.size === 0) break;
    messages.push(...batch.values());
    lastId = batch.lastKey();
    if (batch.size < 100) break;
  }

  // Sort oldest first
  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return messages;
}

/** Build a full NormalizedMessage for a thread (starter + replies) */
export async function buildThreadMessage(
  thread: ThreadChannel,
  maxMessages = 100,
): Promise<NormalizedMessage | null> {
  const messages = await fetchThreadMessages(thread, maxMessages);
  if (messages.length === 0) return null;

  const starter = messages[0];
  const replies = messages.slice(1);

  const parentChannel = thread.parent;
  const channelName =
    parentChannel?.name ?? thread.name ?? "unknown";
  const channelType = resolveChannelType(thread);
  const guildName = thread.guild?.name ?? "Unknown Server";

  const normalized = normalizeMessage(
    starter,
    channelName,
    channelType,
    guildName,
  );

  // Set thread metadata
  normalized.thread_id = thread.id;
  normalized.thread_name = thread.name;

  // Add replies
  normalized.replies = replies.map((r) =>
    normalizeMessage(r, channelName, channelType, guildName),
  );

  // For forum channels, extract forum tags
  if (channelType === "forum" && thread.appliedTags.length > 0) {
    const forumChannel = parentChannel as ForumChannel | null;
    if (forumChannel?.availableTags) {
      normalized.tags = thread.appliedTags
        .map((tagId) => forumChannel.availableTags.find((t) => t.id === tagId)?.name)
        .filter((name): name is string => name !== undefined);
    }
  }

  return normalized;
}

/** Build a NormalizedMessage for a single standalone message */
export function buildSingleMessage(msg: Message): NormalizedMessage {
  const channel = msg.channel;
  const channelName =
    "name" in channel && typeof channel.name === "string"
      ? channel.name
      : "unknown";
  const channelType =
    "type" in channel
      ? resolveChannelType(channel as GuildChannel)
      : "text";
  const guildName = msg.guild?.name ?? "Unknown Server";

  return normalizeMessage(msg, channelName, channelType, guildName);
}
