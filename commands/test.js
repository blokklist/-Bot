// ─── /test Command ─────────────────────────────────────────────────
// Admin-only preview command for testing Components V2 layouts.
// Fetches a real VRChat profile and displays it as a TDR V2 container.
// Owner-only — used for development and visual testing.

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ContainerBuilder,
  SeparatorSpacingSize,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} = require("discord.js");
const { randomUUID, randomInt } = require("crypto");
const vrc = require("../helper/vrchat");
const { buildBlocklistContainer } = require("../helper/buildContainer");

// Build a TDR announcement as a V2 container (for testing)
function buildTDRContainer(vrcName, refId, category, reason, upvotes, downvotes, deadline) {
  const lead = downvotes - upvotes;
  const needed = Math.max(0, 12 - lead);
  const deadlineTs = `<t:${Math.floor(deadline.getTime() / 1000)}:R>`;
  const leadText = lead >= 0 ? `Remove +${lead}` : `Keep +${Math.abs(lead)}`;

  const container = new ContainerBuilder().setAccentColor(0x2ecc71);

  container.addTextDisplayComponents(
    (td) => td.setContent(`## Takedown Request \u2014 \`${refId}\``),
  );

  container.addSeparatorComponents(
    (sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );

  container.addTextDisplayComponents(
    (td) => td.setContent(
      `**Post**\n**${vrcName}** \u2014 -${category}`
    ),
  );

  container.addSeparatorComponents(
    (sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );

  container.addTextDisplayComponents(
    (td) => td.setContent(`**Reason**\n\`\`\`diff\n- ${reason}\n\`\`\``),
  );

  container.addSeparatorComponents(
    (sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );

  container.addTextDisplayComponents(
    (td) => td.setContent(
      `**Keep:** ${upvotes} \u2003 **Remove:** ${downvotes} \u2003 **Lead:** ${leadText}`
    ),
  );

  container.addSeparatorComponents(
    (sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );

  container.addTextDisplayComponents(
    (td) => td.setContent(
      `Voting ends ${deadlineTs}\n${needed > 0 ? `${needed} more remove-votes needed` : "Ready to be removed!"}`
    ),
  );

  container.addSeparatorComponents(
    (sep) => sep.setDivider(false).setSpacing(SeparatorSpacingSize.Large),
  );

  container.addTextDisplayComponents(
    (td) => td.setContent(`-# BLOCKLIST v4 \u2022 TDR`),
  );

  return container;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("test")
    .setDescription("Components V2 preview with a real VRChat profile")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o.setName("link")
        .setDescription("VRChat profile link (https://vrchat.com/home/user/usr_...)")
        .setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("reason")
        .setDescription("Example reason for blocklisting")
        .setRequired(false)
    ),

  async execute(interaction) {
    if (interaction.user.id !== interaction.guild.ownerId) {
      return interaction.reply({ content: "Only the server owner can use this command.", ephemeral: true });
    }

    await interaction.deferReply({ flags: 64 });

    const profileLink = interaction.options.getString("link").trim();
    const reason = interaction.options.getString("reason")?.trim() || "Example reason for blocklisting";

    const match = profileLink.match(/usr_[a-f0-9-]+/i);
    if (!match) {
      return interaction.editReply("Invalid link. Format: `https://vrchat.com/home/user/usr_...`");
    }

    let vrcUser;
    try {
      vrcUser = await vrc.getUserById(match[0]);
    } catch (err) {
      return interaction.editReply(`Failed to fetch VRChat profile: ${err.message}`);
    }
    if (!vrcUser) {
      return interaction.editReply("VRChat user not found.");
    }

    const refId = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();

    // TDR V2 demo
    const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const tdrContainer = buildTDRContainer(
      vrcUser.displayName, refId, "TEST", "This person was incorrectly reported", 3, 8, deadline
    );

    await interaction.editReply({
      components: [tdrContainer],
      flags: MessageFlags.IsComponentsV2,
    });
  },

  buildTDRContainer,
};
