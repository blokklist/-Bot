// ─── /deepl-usage Command ──────────────────────────────────────────
// Admin-only. Shows current DeepL API character usage for this month.
// Displays a progress bar with color coding (green/yellow/red).
// Free tier limit: 500k characters/month, bot stops at 480k.

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require("discord.js");
const { getUsage } = require("../helper/deepl");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("deepl-usage")
    .setDescription("Check DeepL API usage for this month")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    let usage;
    try {
      usage = await getUsage();
    } catch (err) {
      console.error("[DeepL] Usage check failed:", err.message);
      return interaction.editReply("❌ Failed to fetch DeepL usage. Is the API key configured?");
    }

    const percent = ((usage.used / usage.limit) * 100).toFixed(1);
    const remaining = usage.limit - usage.used;

    // Color based on usage: green < 50%, yellow < 80%, red >= 80%
    const color = percent < 50 ? 0x2ecc71 : percent < 80 ? 0xf1c40f : 0xe74c3c;

    const bar = buildProgressBar(percent);

    const embed = new EmbedBuilder()
      .setTitle("DeepL API Usage")
      .setColor(color)
      .addFields(
        { name: "Used",      value: `**${usage.used.toLocaleString()}** characters`, inline: true },
        { name: "Limit",     value: `**${usage.limit.toLocaleString()}** characters`, inline: true },
        { name: "Remaining", value: `**${remaining.toLocaleString()}** characters`,  inline: true },
      )
      .setDescription(`${bar}  **${percent}%**`)
      .setFooter({ text: "DeepL API Free \u2022 Resets monthly" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};

// Build a visual progress bar (e.g. "████████░░░░░░░░░░░░")
function buildProgressBar(percent) {
  const total = 20;
  const filled = Math.round((percent / 100) * total);
  const empty = total - filled;
  return "\u2588".repeat(filled) + "\u2591".repeat(empty);
}
