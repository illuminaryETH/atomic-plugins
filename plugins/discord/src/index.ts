import { Client, GatewayIntentBits, Partials } from "discord.js";
import { resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { loadConfig } from "./core/config.js";
import { AtomicClient } from "./core/atomic-client.js";
import { initDatabase } from "./core/db.js";
import { Pipeline } from "./core/pipeline.js";
import { setupReactionHandler } from "./platform/reactions.js";
import { setupEventHandlers } from "./platform/events.js";
import { registerCommands, setupCommandHandler } from "./platform/commands.js";

async function main() {
  // 1. Load config
  const configPath =
    process.argv[2] ??
    process.env.ATOMIC_DISCORD_CONFIG ??
    "atomic-discord.config.yaml";

  console.log(`Loading config from: ${configPath}`);
  const config = loadConfig(configPath);

  // 2. Initialize SQLite database
  const dataDir = resolve("data");
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  const db = initDatabase(resolve(dataDir, "atomic-discord.db"));
  console.log("Database initialized");

  // 3. Initialize Atomic client and verify connection
  const atomicClient = new AtomicClient(
    config.atomic.server_url,
    config.atomic.api_token,
  );

  const connected = await atomicClient.ping();
  if (connected) {
    console.log(`Connected to Atomic server at ${config.atomic.server_url}`);
  } else {
    console.warn(
      `WARNING: Cannot reach Atomic server at ${config.atomic.server_url}. ` +
        "The bot will start but atom creation will fail until the server is available.",
    );
  }

  // 4. Create pipeline
  const pipeline = new Pipeline(atomicClient, db, config);

  // 5. Create Discord client with required intents
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent,
    ],
    partials: [
      Partials.Message,
      Partials.Reaction,
      Partials.Channel,
      Partials.User,
    ],
  });

  // 6. Register event handlers
  client.once("ready", async (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);
    console.log(`Serving ${readyClient.guilds.cache.size} guild(s)`);

    // Register slash commands
    try {
      await registerCommands(config.discord.bot_token, readyClient.user.id);
    } catch (err) {
      console.error("Failed to register slash commands:", err);
    }
  });

  // Reaction-based capture (works everywhere, no subscription needed)
  setupReactionHandler(client, pipeline, config);

  // Real-time event handlers (for subscribed channels)
  const settleManager = setupEventHandlers(client, pipeline, db, config);

  // Slash command handler
  setupCommandHandler(client, pipeline, atomicClient, db, config);

  // 7. Graceful shutdown
  const shutdown = () => {
    console.log("Shutting down...");
    settleManager.cancelAll();
    db.close();
    client.destroy();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // 8. Login
  await client.login(config.discord.bot_token);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
