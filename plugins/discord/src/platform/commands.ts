import {
  type Client,
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
  ChannelType,
  type GuildChannel,
  type ThreadChannel,
  REST,
  Routes,
  PermissionFlagsBits,
} from "discord.js";
import type Database from "better-sqlite3";
import type { AtomicClient } from "../core/atomic-client.js";
import type { Pipeline } from "../core/pipeline.js";
import type { AppConfig, ChannelConfig, IngestionMode } from "../types/index.js";
import {
  upsertChannelConfig,
  deleteChannelConfig,
  getChannelConfig,
  getAllActiveChannelConfigs,
} from "../core/db.js";
import { buildSingleMessage, buildThreadMessage } from "./messages.js";

const VALID_MODES: IngestionMode[] = [
  "full",
  "digest",
  "summary",
  "reaction-only",
  "forum",
];

function buildCommands() {
  const subscribe = new SlashCommandBuilder()
    .setName("atomic-subscribe")
    .setDescription("Subscribe a channel for knowledge capture")
    .addChannelOption((opt) =>
      opt
        .setName("channel")
        .setDescription("Channel to subscribe")
        .setRequired(true)
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildForum,
        ),
    )
    .addStringOption((opt) =>
      opt
        .setName("mode")
        .setDescription("Ingestion mode")
        .setRequired(false)
        .addChoices(
          ...VALID_MODES.map((m) => ({ name: m, value: m })),
        ),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

  const unsubscribe = new SlashCommandBuilder()
    .setName("atomic-unsubscribe")
    .setDescription("Unsubscribe a channel from knowledge capture")
    .addChannelOption((opt) =>
      opt
        .setName("channel")
        .setDescription("Channel to unsubscribe")
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

  const configure = new SlashCommandBuilder()
    .setName("atomic-config")
    .setDescription("Configure ingestion settings for a channel")
    .addChannelOption((opt) =>
      opt
        .setName("channel")
        .setDescription("Channel to configure")
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("mode")
        .setDescription("Ingestion mode")
        .setRequired(false)
        .addChoices(
          ...VALID_MODES.map((m) => ({ name: m, value: m })),
        ),
    )
    .addIntegerOption((opt) =>
      opt
        .setName("settle-window")
        .setDescription("Settle window in seconds")
        .setRequired(false)
        .setMinValue(10)
        .setMaxValue(3600),
    )
    .addStringOption((opt) =>
      opt
        .setName("tags")
        .setDescription("Comma-separated tags to add to captured atoms")
        .setRequired(false),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

  const save = new SlashCommandBuilder()
    .setName("atomic-save")
    .setDescription("Manually save a message to Atomic")
    .addStringOption((opt) =>
      opt
        .setName("message-link")
        .setDescription("Discord message link to save")
        .setRequired(true),
    );

  const search = new SlashCommandBuilder()
    .setName("atomic-search")
    .setDescription("Search your Atomic knowledge base")
    .addStringOption((opt) =>
      opt
        .setName("query")
        .setDescription("Search query")
        .setRequired(true),
    );

  const status = new SlashCommandBuilder()
    .setName("atomic-status")
    .setDescription("Show Atomic bot status and subscribed channels")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

  return [subscribe, unsubscribe, configure, save, search, status];
}

/** Register slash commands with Discord */
export async function registerCommands(
  botToken: string,
  clientId: string,
): Promise<void> {
  const rest = new REST().setToken(botToken);
  const commands = buildCommands().map((c) => c.toJSON());

  await rest.put(Routes.applicationCommands(clientId), {
    body: commands,
  });
  console.log(`Registered ${commands.length} slash commands`);
}

/** Set up slash command interaction handler */
export function setupCommandHandler(
  client: Client,
  pipeline: Pipeline,
  atomicClient: AtomicClient,
  db: Database.Database,
  config: AppConfig,
): void {
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
      switch (interaction.commandName) {
        case "atomic-subscribe":
          await handleSubscribe(interaction, db, config);
          break;
        case "atomic-unsubscribe":
          await handleUnsubscribe(interaction, db);
          break;
        case "atomic-config":
          await handleConfig(interaction, db);
          break;
        case "atomic-save":
          await handleSave(interaction, pipeline, config);
          break;
        case "atomic-search":
          await handleSearch(interaction, atomicClient);
          break;
        case "atomic-status":
          await handleStatus(interaction, db, atomicClient);
          break;
      }
    } catch (err) {
      console.error(`Command ${interaction.commandName} failed:`, err);
      const content = `An error occurred: ${err instanceof Error ? err.message : "Unknown error"}`;
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, ephemeral: true });
      } else {
        await interaction.reply({ content, ephemeral: true });
      }
    }
  });
}

// ---- Command handlers ----

async function handleSubscribe(
  interaction: ChatInputCommandInteraction,
  db: Database.Database,
  config: AppConfig,
): Promise<void> {
  const channel = interaction.options.getChannel("channel", true) as GuildChannel;
  const mode =
    (interaction.options.getString("mode") as IngestionMode) ??
    config.ingestion.default_mode;

  const channelType =
    channel.type === ChannelType.GuildForum
      ? "GUILD_FORUM"
      : channel.type === ChannelType.GuildVoice
        ? "GUILD_VOICE"
        : "GUILD_TEXT";

  const channelConfig: ChannelConfig = {
    guild_id: interaction.guildId ?? "",
    channel_id: channel.id,
    channel_name: channel.name,
    channel_type: channelType,
    mode,
    settle_window_seconds: config.ingestion.default_settle_window,
    include_bot_messages: config.ingestion.include_bot_messages,
    include_embeds: config.ingestion.include_embeds,
    digest_interval_minutes: 60,
    tags: [config.tags.custom_prefix, `${config.tags.custom_prefix}/${channel.name}`],
    forum_tag_mapping: config.ingestion.forum_tag_mapping,
    active: true,
  };

  upsertChannelConfig(db, channelConfig);

  await interaction.reply({
    content: `✅ Subscribed <#${channel.id}> in **${mode}** mode.\nSettle window: ${config.ingestion.default_settle_window}s`,
    ephemeral: true,
  });
}

async function handleUnsubscribe(
  interaction: ChatInputCommandInteraction,
  db: Database.Database,
): Promise<void> {
  const channel = interaction.options.getChannel("channel", true);

  const existing = getChannelConfig(db, channel.id);
  if (!existing) {
    await interaction.reply({
      content: `<#${channel.id}> is not subscribed.`,
      ephemeral: true,
    });
    return;
  }

  deleteChannelConfig(db, channel.id);

  await interaction.reply({
    content: `🚫 Unsubscribed <#${channel.id}>.`,
    ephemeral: true,
  });
}

async function handleConfig(
  interaction: ChatInputCommandInteraction,
  db: Database.Database,
): Promise<void> {
  const channel = interaction.options.getChannel("channel", true);
  const existing = getChannelConfig(db, channel.id);

  if (!existing) {
    await interaction.reply({
      content: `<#${channel.id}> is not subscribed. Use \`/atomic-subscribe\` first.`,
      ephemeral: true,
    });
    return;
  }

  const mode = interaction.options.getString("mode") as IngestionMode | null;
  const settleWindow = interaction.options.getInteger("settle-window");
  const tagsStr = interaction.options.getString("tags");

  if (mode) existing.mode = mode;
  if (settleWindow) existing.settle_window_seconds = settleWindow;
  if (tagsStr) existing.tags = tagsStr.split(",").map((t) => t.trim());

  upsertChannelConfig(db, existing);

  await interaction.reply({
    content: `⚙️ Updated <#${channel.id}>:\n- Mode: **${existing.mode}**\n- Settle window: **${existing.settle_window_seconds}s**\n- Tags: ${existing.tags.join(", ") || "none"}`,
    ephemeral: true,
  });
}

async function handleSave(
  interaction: ChatInputCommandInteraction,
  pipeline: Pipeline,
  config: AppConfig,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const messageLink = interaction.options.getString("message-link", true);

  // Parse Discord message link: https://discord.com/channels/{guild}/{channel}/{message}
  const match = messageLink.match(
    /discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/,
  );
  if (!match) {
    await interaction.editReply("Invalid message link format.");
    return;
  }

  const [, , channelId, messageId] = match;

  try {
    const channel = await interaction.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !("messages" in channel)) {
      await interaction.editReply("Could not access that channel.");
      return;
    }

    const message = await channel.messages.fetch(messageId);

    // Check if it's in a thread
    if (
      channel.type === ChannelType.PublicThread ||
      channel.type === ChannelType.PrivateThread
    ) {
      const normalized = await buildThreadMessage(
        channel as ThreadChannel,
        config.ingestion.max_thread_depth,
      );
      if (normalized) {
        const result = await pipeline.ingest(normalized);
        await interaction.editReply(
          result.action === "skipped"
            ? `⚠️ Skipped: ${result.reason}`
            : `✅ Thread ${result.action} in Atomic (${result.atom_id})`,
        );
        return;
      }
    }

    const normalized = buildSingleMessage(message);
    const result = await pipeline.ingest(normalized);

    await interaction.editReply(
      result.action === "skipped"
        ? `⚠️ Skipped: ${result.reason}`
        : `✅ Message ${result.action} in Atomic (${result.atom_id})`,
    );
  } catch (err) {
    await interaction.editReply(
      `Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`,
    );
  }
}

async function handleSearch(
  interaction: ChatInputCommandInteraction,
  atomicClient: AtomicClient,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const query = interaction.options.getString("query", true);

  try {
    const results = await atomicClient.searchAtoms(query, "semantic", 5);

    if (results.length === 0) {
      await interaction.editReply("No results found.");
      return;
    }

    const formatted = results
      .map((r, i) => {
        const title = r.title ?? "Untitled";
        const score = (r.similarity_score * 100).toFixed(0);
        const chunk = r.matching_chunk_content ?? "";
        const snippet =
          chunk.length > 150 ? chunk.slice(0, 150) + "..." : chunk;
        return `**${i + 1}. ${title}** (${score}% match)\n${snippet}`;
      })
      .join("\n\n");

    await interaction.editReply(`🔍 **Results for "${query}":**\n\n${formatted}`);
  } catch (err) {
    await interaction.editReply(
      `Search failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    );
  }
}

async function handleStatus(
  interaction: ChatInputCommandInteraction,
  db: Database.Database,
  atomicClient: AtomicClient,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const configs = getAllActiveChannelConfigs(db);
  const connected = await atomicClient.ping();

  let status = `**Atomic Discord Bot Status**\n\n`;
  status += `Atomic Server: ${connected ? "✅ Connected" : "❌ Disconnected"}\n`;
  status += `Subscribed channels: ${configs.length}\n\n`;

  if (configs.length > 0) {
    status += configs
      .map(
        (c) =>
          `• <#${c.channel_id}> — **${c.mode}** (settle: ${c.settle_window_seconds}s)`,
      )
      .join("\n");
  }

  await interaction.editReply(status);
}
