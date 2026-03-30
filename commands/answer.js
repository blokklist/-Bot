// ─── /answer Command ────────────────────────────────────────────────
// Admin-only command to answer a feedback submission.
// Updates the feedback embed in the channel with the answer.

const {
  SlashCommandBuilder,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} = require("discord.js");
const db = require("../database/db");
const { translateToEnglish } = require("../helper/deepl");

const pendingAnswer = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName("answer")
    .setDescription("Answer a feedback submission")
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
      return interaction.reply({ content: `❌ Feedback \`#${feedbackId}\` has been deleted.`, flags: 64 });
    }

    pendingAnswer.set(interaction.user.id, { feedbackId, feedback });

    const modal = new ModalBuilder()
      .setCustomId("answer_modal")
      .setTitle(`Answer — #${feedbackId}`);

    const answerInput = new TextInputBuilder()
      .setCustomId("answer_text")
      .setLabel("Your answer")
      .setStyle(TextInputStyle.Paragraph)
      .setMinLength(5)
      .setMaxLength(2000)
      .setRequired(true)
      .setPlaceholder("Write your response...");

    modal.addComponents(new ActionRowBuilder().addComponents(answerInput));
    await interaction.showModal(modal);
  },

  async handleModal(interaction) {
    await interaction.deferReply({ flags: 64 });

    const pending = pendingAnswer.get(interaction.user.id);
    if (!pending) return interaction.editReply("Session expired. Please run `/answer` again.");
    pendingAnswer.delete(interaction.user.id);

    const { feedbackId, feedback } = pending;
    let answer = interaction.fields.getTextInputValue("answer_text").trim();

    // Translate answer to English
    try {
      const result = await translateToEnglish(answer);
      answer = result.text;
    } catch (err) {
      console.warn("[Answer] Translation failed, using original:", err.message);
    }

    try {
      await db.query(
        "UPDATE feedbacks SET answer = ?, status = 'answered' WHERE id = ?",
        [answer, feedbackId]
      );

      // Update the container in the feedback channel
      const channel = interaction.guild.channels.cache.get(feedback.channel_id);
      if (channel && feedback.message_id) {
        try {
          const msg = await channel.messages.fetch(feedback.message_id);
          if (msg) {
            const { buildFeedbackContainer } = require("./feedback");
            const container = buildFeedbackContainer(feedbackId, feedback.type, feedback.title, feedback.description, null, answer, "answered");
            await msg.edit({ components: [container], flags: 32768 });
          }
        } catch (err) {
          console.error("[Answer] Failed to update container:", err.message);
        }
      }
    } catch (err) {
      console.error("[Answer] Failed:", err.message);
      return interaction.editReply("❌ Failed to save answer.");
    }

    return interaction.editReply(`✅ Feedback **#${feedbackId}** has been answered.`);
  },
};
