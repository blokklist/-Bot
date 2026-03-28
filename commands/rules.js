// ─── /rules-setup Command ──────────────────────────────────────────
// Posts a "I accept the rules" button in the current channel.
// When clicked: grants or revokes the rules role (toggle).
// Tracks acceptance in DB via hashed user ID for persistence.
// Requires RULES_ROLE_ID in .env.

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const db = require("../database/db");

const { createHmac } = require("crypto");

function hashUser(userId) {
  const secret = process.env.VOTE_HASH_SECRET ?? "blocklist-default-secret";
  return createHmac("sha256", secret).update(userId).digest("hex");
}

// Schema is managed by database/migrations.js

function buildButton(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("rules_accept")
      .setLabel("I accept the rules")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("rules-setup")
    .setDescription("Posts the verify button in the current channel (Admin only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.member.permissions.has("Administrator")) {
      return interaction.reply({ content: "Only admins can use this command.", flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });

    await interaction.channel.send({ components: [buildButton()] });
    return interaction.editReply("Verify button has been posted in the channel.");
  },

  async handleButton(interaction) {
    await interaction.deferReply({ flags: 64 });

    const roleId = process.env.RULES_ROLE_ID;
    if (!roleId) return interaction.editReply("`RULES_ROLE_ID` not set in `.env`.");

    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) return interaction.editReply("Role not found.");

    const member = interaction.member;

    // ─── Block if user already has both verified roles ─────────────────────
    const VERIFIED_ROLES = ["1480599906585677986", "1480600171996778710"];
    if (VERIFIED_ROLES.some(id => member.roles.cache.has(id))) {
      return interaction.editReply("You have already been verified and cannot use this button.");
    }

    const hasRole = member.roles.cache.has(roleId);

    if (hasRole) {
      await member.roles.remove(role);
      await db.query("DELETE FROM rules_accepted WHERE user_hash = ?", [hashUser(interaction.user.id)])
        .catch(err => console.error("[Rules] Failed to delete acceptance record:", err.message));
      return interaction.editReply("Your rule acceptance has been revoked and your role was removed.");
    } else {
      await member.roles.add(role);
      await db.query(
        "INSERT IGNORE INTO rules_accepted (user_hash) VALUES (?)",
        [hashUser(interaction.user.id)]
      ).catch(err => console.error("[Rules] Failed to insert acceptance record:", err.message));
      return interaction.editReply("Rules accepted — your role has been granted.");
    }
  },
};
