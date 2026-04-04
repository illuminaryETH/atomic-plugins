# Atomic Discord

A Discord bot that captures conversations, threads, and forum posts into [Atomic](../README.md) as searchable, semantically-indexed atoms.

## Features

- **Reaction capture** — React with a custom emoji to save any message or thread
- **Full-channel capture** — Automatically ingest all messages in subscribed channels
- **Forum support** — Forum posts captured with tags, solved status, and full discussion
- **Settle window** — Waits for a configurable delay after the last reply before ingesting, so threads are captured completely
- **Deduplication** — Tracks ingested messages by Discord ID to prevent duplicates; updates existing atoms when threads grow
- **Hierarchical tagging** — Auto-tags atoms with channel/guild names under a configurable prefix (e.g. `discord/general`)
- **Semantic search** — Members can search the entire knowledge base from Discord via slash command

## Setup

### Prerequisites

- Node.js (ES2022+)
- A running [atomic-server](../crates/atomic-server/) instance
- An Atomic API token (`cargo run -p atomic-server -- token create --name atomic-discord`)

### Create a Discord Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application and add a Bot
3. Enable the **Message Content** privileged intent
4. Generate an invite URL with these scopes and permissions:
   - Scopes: `bot`, `applications.commands`
   - Permissions: Read Messages, Send Messages, Add Reactions, Read Message History, Use Slash Commands
5. Invite the bot to your server

### Configure

```bash
cd discord
cp atomic-discord.config.example.yaml atomic-discord.config.yaml
```

Fill in your values:

```yaml
atomic:
  server_url: "http://localhost:8080"
  api_token: "at_..."

discord:
  bot_token: "MTIz..."
```

Override the config path with the `ATOMIC_DISCORD_CONFIG` env var or as a CLI argument:

```bash
npm run dev -- /path/to/config.yaml
```

### Install and Run

```bash
npm install
npm run dev       # Development (tsx, hot reload)
npm run build     # Compile TypeScript
npm start         # Production (node dist/)
```

## Slash Commands

| Command | Permission | Description |
|---------|-----------|-------------|
| `/atomic-subscribe` | Manage Channels | Subscribe a channel for automatic capture |
| `/atomic-unsubscribe` | Manage Channels | Unsubscribe a channel |
| `/atomic-config` | Manage Channels | Configure mode, settle window, tags per channel |
| `/atomic-save` | Any member | Manually capture a message by link |
| `/atomic-search` | Any member | Search the Atomic knowledge base |
| `/atomic-status` | Manage Channels | Show bot status and subscribed channels |

## Capture Modes

Set per channel via `/atomic-subscribe` or `/atomic-config`:

| Mode | Behavior |
|------|----------|
| `reaction-only` | Only capture when someone reacts with the trigger emoji (default) |
| `full` | Capture all messages automatically after the settle window |
| `forum` | Capture forum posts with Discord tag mapping |
| `digest` | Periodically digest channel messages |
| `summary` | Extract summaries from conversations |

## Configuration Reference

```yaml
atomic:
  server_url: "http://localhost:8080"           # Atomic server URL
  api_token: "at_..."                           # API token

discord:
  bot_token: "MTIz..."                          # Discord bot token

ingestion:
  reaction_emoji: "atomic"                      # Custom emoji name for reaction capture
  fallback_emoji: "🧠"                          # Unicode fallback if custom emoji unavailable
  default_settle_window: 300                    # Seconds to wait after last message before ingesting
  default_mode: "reaction-only"                 # Default mode for new subscriptions
  include_bot_messages: false                   # Capture messages from other bots?
  include_embeds: true                          # Include rich embeds in atom body?
  max_thread_depth: 100                         # Max messages to fetch per thread
  forum_tag_mapping: true                       # Map Discord forum tags to Atomic tags?

tags:
  auto_channel: true                            # Auto-tag with channel name
  auto_guild: false                             # Auto-tag with guild name
  custom_prefix: "discord"                      # Prefix for auto-generated tags
```

## Architecture

```
discord/
├── src/
│   ├── index.ts                 # Entry point — loads config, connects, registers handlers
│   ├── core/
│   │   ├── atomic-client.ts     # REST client for atomic-server
│   │   ├── config.ts            # YAML config loading & validation
│   │   ├── db.ts                # Local SQLite (dedup index, channel configs)
│   │   ├── dedup.ts             # Deduplication via discord_key → atom_id mapping
│   │   ├── pipeline.ts          # Message → Atom ingestion pipeline
│   │   ├── settle.ts            # Settle window timer management
│   │   └── templates.ts         # Markdown formatting for atoms
│   ├── platform/
│   │   ├── commands.ts          # Slash command registration & handlers
│   │   ├── confirm.ts           # Capture confirmation (reactions/replies)
│   │   ├── events.ts            # Message and thread event handlers
│   │   ├── messages.ts          # Discord message → NormalizedMessage conversion
│   │   └── reactions.ts         # Reaction event handler
│   └── types/
│       └── index.ts             # TypeScript type definitions
├── atomic-discord.config.example.yaml
├── package.json
└── tsconfig.json
```

### Data Flow

```
Discord event (message, reaction, thread)
  → Normalize to platform-agnostic format (messages.ts)
  → Check dedup index (dedup.ts)
  → Wait for settle window if needed (settle.ts)
  → Format as markdown atom body (templates.ts)
  → Resolve/create tags in Atomic (atomic-client.ts)
  → Create or update atom via REST API (pipeline.ts)
  → Store dedup entry, confirm in Discord
```

### Local Database

The bot stores its own state in `data/atomic-discord.db` (SQLite, WAL mode):

- **dedup_index** — Maps `guild:channel:message` keys to atom IDs to prevent duplicates
- **channel_configs** — Per-channel subscription settings (mode, settle window, tags, etc.)
