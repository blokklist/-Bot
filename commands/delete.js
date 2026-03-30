// ─── /delete Command ────────────────────────────────────────────────
// Admin-only command to delete a feedback submission.
// Removes the embed from the channel and marks it as closed.

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require("discord.js");
const db = require("../database/db");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("delete")
    .setDescription("Delete a feedback submission")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption(opt =>
      opt.setName("id")
         .setDescription("Feedback ID (e.g. 123456)")
         .setRequired(true)
    ),

  async execute(interaction) {
    const feedbackId = interaction.options.getInteger("id");

    const rows = await db.query("SELECT * FROM feedbacks WHERE id = ? LIMIT 1", [feedbackId]);
    if (!rows.length) {
      return interaction.reply({ content: `❌ No feedback found with ID \`${feedbackId}\`.`, flags: 64 });
    }

    const feedback = rows[0];
    if (feedback.status === "closed") {
      return interaction.reply({ content: `❌ Feedback \`#${feedbackId}\` is already deleted.`, flags: 64 });
    }

    try {
      // Delete the message from the channel
      const channel = interaction.guild.channels.cache.get(feedback.channel_id);
      if (channel && feedback.message_id) {
        try {
          const msg = await channel.messages.fetch(feedback.message_id);
          if (msg) await msg.delete();
        } catch (err) {
          console.error("[Delete] Failed to delete message:", err.message);
        }
      }

      await db.query("UPDATE feedbacks SET status = 'closed' WHERE id = ?", [feedbackId]);
    } catch (err) {
      console.error("[Delete] Failed:", err.message);
      return interaction.reply({ content: "❌ Failed to delete feedback.", flags: 64 });
    }

    return interaction.reply({ content: `✅ Feedback **#${feedbackId}** has been deleted.`, flags: 64 });
  },
};
