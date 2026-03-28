// ─── /status Command ───────────────────────────────────────────────
// Owner-only. Checks if the VRChat bot account is online and not banned.

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const vrc = require("../helper/vrchat");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("status")
    .setDescription("Check the VRChat bot account status")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (interaction.user.id !== interaction.guild.ownerId) {
      return interaction.reply({ content: "❌ Only the server owner can use this command.", ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    let user = null;
    let error = null;

    try {
      user = await vrc.getCurrentUser();
    } catch (err) {
      error = err.message;
    }

    if (!user) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle("❌ VRChat Account — Offline")
            .setDescription(
              error
                ? `\`\`\`${error}\`\`\``
                : "Could not reach the VRChat API or the session has expired."
            )
            .addFields({ name: "Logged in as", value: process.env.VRCHAT_USER ?? "Unknown" })
        ],
      });
    }

    const isBanned = user.isBanned ?? false;

    return interaction.editReply({
      content: isBanned
        ? "🚫 The VRChat account is **banned**."
        : "✅ The VRChat account is **not banned**.",
    });
  },
};