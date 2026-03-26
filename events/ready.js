// ─── Ready Event ───────────────────────────────────────────────────
// Runs once when the bot connects to Discord. Handles:
// 1. Database connection + migrations
// 2. Slash command registration (global)
// 3. Bot presence (status message)
// 4. TDR scheduler + Post sync scheduler startup
// 5. Webhook pre-creation for all configured channels

const { Events, ActivityType, REST, Routes } = require("discord.js");
const db = require("../database/db");
const { runMigrations } = require("../database/migrations");
const fs = require("fs");
const path = require("path");
const { startScheduler } = require("../helper/tdrScheduler");
const { startPostSync } = require("../helper/postSyncScheduler");
require("dotenv").config();
module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    try {
      await db.connect();
      console.log(`[DB] MySQL connected → ${process.env.DB_NAME}@${process.env.DB_HOST}`);
    } catch (err) {
      console.error("[DB] Connection failed:", err.message);
      process.exit(1);
    }

    // ----------------------------------------------------------------------------
    // Run database migrations
    try {
      await runMigrations();
      console.log("[DB] All tables ready");
    } catch (err) {
      console.error("[DB] Migration failed:", err.message);
    }

    try {
      const commandsPath = path.join(__dirname, "../commands");
      const commandData = [];
      if (fs.existsSync(commandsPath)) {
        for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith(".js"))) {
          const cmd = require(path.join(commandsPath, file));
          if (cmd?.data?.toJSON) commandData.push(cmd.data.toJSON());
        }
      }
      const rest = new REST().setToken(process.env.DISCORD_TOKEN);
      await rest.put(
        Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
        { body: commandData }
      );
      console.log(`[Commands] ${commandData.length} command(s) registered globally`);
    } catch (err) {
      console.error("[Commands] Registration failed:", err.message);
    }
    client.user.setPresence({
      activities: [{ name: "/paste • /tdr", type: ActivityType.Custom }],
      status: "dnd",
    });
    startScheduler(client);
    startPostSync(client);
    try {
      const { getWebhook } = require("../helper/webhooks");
      const CH_KEYS = [
        "CH_CREEPS","CH_LIARS","CH_SHITTALKERS","CH_E_HOES","CH_E_BOYS",
        "CH_STREAMERS","CH_CRASHERS","CH_MODDERS","CH_MAIN_CHARACTERS",
        "CH_VRC_STAFF","CH_TYRANTS","CH_DOXXERS",
      ];
      const guild = client.guilds.cache.first();
      if (guild) {
        let created = 0;
        for (const key of CH_KEYS) {
          const channelId = process.env[key];
          if (!channelId) continue;
          const channel = guild.channels.cache.get(channelId);
          if (!channel) continue;
          await getWebhook(channel).catch(err => console.error(`[Webhooks] Failed to create webhook for ${key}:`, err.message));
          created++;
        }
        console.log(`[Webhooks] ${created} webhook(s) ready`);
      }
    } catch (err) {
      console.error("[Webhooks] Error:", err.message);
    }
    console.log(
      [
        "",
        "╔══════════════════════════════════════╗",
        `║  ${client.user.tag.padEnd(36)}║`,
        `║  ${String(client.guilds.cache.size + " Server").padEnd(36)}║`,
        `║  ${String(client.commands?.size + " Commands").padEnd(36)}║`,
        "║                                      ║",
        "║  developed by SilentByQuiet          ║",
        "╚══════════════════════════════════════╝",
        "",
      ].join("\n")
    );
  },
};
