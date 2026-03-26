// ─── BlocklistBot — Main Entry Point ───────────────────────────────
// VRChat blocklist management bot for Discord.
// Dynamically loads commands from /commands and events from /events.
// Routes all interactions (slash commands, modals, buttons, selects)
// to their respective command handlers.

const { Client, GatewayIntentBits, Collection } = require("discord.js");
const fs   = require("fs");
const path = require("path");
require("dotenv").config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
  ],
});
// ─── Dynamic command loading ───────────────────────────────────────
client.commands = new Collection();
const commandsPath = path.join(__dirname, "commands");
if (fs.existsSync(commandsPath)) {
  for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith(".js"))) {
    try {
      const command = require(path.join(commandsPath, file));
      if (command?.data?.name) client.commands.set(command.data.name, command);
    } catch (err) {
      console.error(`[Commands] Failed to load ${file}:`, err.message);
    }
  }
}
// ─── Dynamic event loading ─────────────────────────────────────────
const eventsPath = path.join(__dirname, "events");
if (fs.existsSync(eventsPath)) {
  for (const file of fs.readdirSync(eventsPath).filter(f => f.endsWith(".js"))) {
    try {
      const event = require(path.join(eventsPath, file));
      if (event?.name) {
        event.once
          ? client.once(event.name, (...args) => event.execute(...args, client))
          : client.on(event.name,   (...args) => event.execute(...args, client));
      }
    } catch (err) {
      console.error(`[Events] Failed to load ${file}:`, err.message);
    }
  }
}
// ─── Rate limit logging ────────────────────────────────────────────
client.rest.on("rateLimited", (info) => {
  console.warn(`[RateLimit] Route: ${info.route} — retry after ${info.retryAfter}ms`);
});
// ─── Interaction router ────────────────────────────────────────────
// Routes slash commands, modals, buttons, and select menus to handlers
client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.guild) return;
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
      return;
    }
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("edit_")) {
        const cmd = client.commands.get("edit");
        if (cmd?.handleModal) await cmd.handleModal(interaction);
      } else if (interaction.customId === "tdr_modal") {
        const cmd = client.commands.get("tdr");
        if (cmd?.handleModal) await cmd.handleModal(interaction);
      } else {
        const commandName = interaction.customId.replace("_modal", "");
        const command = client.commands.get(commandName);
        if (command?.handleModal) await command.handleModal(interaction);
      }
      return;
    }
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "setup_category_select") {
        const cmd = client.commands.get("setup");
        if (cmd?.handleCategorySelect) await cmd.handleCategorySelect(interaction);
      }
      if (interaction.customId === "paste_category_select") {
        const cmd = client.commands.get("paste");
        if (cmd?.handleCategorySelect) await cmd.handleCategorySelect(interaction);
      }
      return;
    }
    if (interaction.isButton()) {
      if (interaction.customId.startsWith("tdr_vote_")) {
        const cmd = client.commands.get("tdr");
        if (cmd?.handleButton) await cmd.handleButton(interaction);
      }
      if (interaction.customId === "rules_accept") {
        const cmd = client.commands.get("rules-setup");
        if (cmd?.handleButton) await cmd.handleButton(interaction);
      }
      return;
    }
    if (interaction.isChannelSelectMenu()) {
      if (interaction.customId.startsWith("setup_channel_select:")) {
        const category = interaction.customId.split(":")[1];
        const cmd = client.commands.get("setup");
        if (cmd?.handleChannelSelect) await cmd.handleChannelSelect(interaction, category);
      }
      return;
    }
  } catch (err) {
    console.error("[Interaction]", err?.stack ?? err?.message ?? err);
    const msg = { content: "⚠️ An error occurred.", flags: 64 };
    try {
      interaction.replied || interaction.deferred
        ? await interaction.followUp(msg)
        : await interaction.reply(msg);
    } catch (e) { console.error("[Interaction] Failed to send error response:", e.message); }
  }
});
// ─── Global error handlers ─────────────────────────────────────────
process.on("unhandledRejection", (err) => {
  console.error("[UnhandledRejection]", err?.message ?? err);
});
process.on("uncaughtException", (err) => {
  console.error("[UncaughtException]", err?.message ?? err);
  process.exit(1);
});
client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error("[Login] Invalid token or no network:", err.message);
  process.exit(1);
});