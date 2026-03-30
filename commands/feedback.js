// ─── /feedback Command ──────────────────────────────────────────────
// Allows users to submit feedback, feature requests, or bug reports.
//
// Flow:
// 1. User runs /feedback → checks 2-week cooldown
// 2. Modal asks for type, title, and description
// 3. Feedback is posted in the feedback channel as a V2 Container
// 4. Stored in DB for admins to /answer or /delete
//
// Rate limit: 1 feedback per user per 14 days

const {
  SlashCommandBuilder,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  ContainerBuilder,
  SeparatorSpacingSize,
} = require("discord.js");
const { randomInt, createHmac } = require("crypto");
const db = require("../database/db");

function hashUser(userId) {
  const secret = process.env.VOTE_HASH_SECRET ?? "blocklist-default-secret";
  return createHmac("sha256", secret).update(userId).digest("hex");
}
const { translateToEnglish } = require("../helper/deepl");

const FEEDBACK_CHANNEL = process.env.FEEDBACK_CHANNEL;

const TYPE_LABELS = {
  feedback: "Feedback",
  feature: "Feature Request",
  bug: "Bug Report",
};

const TYPE_COLORS = {
  feedback: 0x5865f2,
  feature: 0x57f287,
  bug: 0xed4245,
};

async function generateFeedbackId() {
  for (let i = 0; i < 10; i++) {
    const id = randomInt(100_000, 999_999);
    const existing = await db.query("SELECT id FROM feedbacks WHERE id = ? LIMIT 1", [id]);
    if (!existing.length) return id;
  }
  throw new Error("Failed to generate unique feedback ID");
}

function buildFeedbackContainer(feedbackId, type, title, description, username, answer = null, status = "open") {
  const color = TYPE_COLORS[type] ?? 0x5865f2;
  const label = TYPE_LABELS[type] ?? "Feedback";

  const container = new ContainerBuilder().setAccentColor(color);

  // Header
  container.addTextDisplayComponents(
    (td) => td.setContent(`## ${label}`),
  );

  container.addSeparatorComponents(
    (sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );

  // Title
  container.addTextDisplayComponents(
    (td) => td.setContent(`**Title**\n${title}`),
  );

  container.addSeparatorComponents(
    (sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );

  // Description
  container.addTextDisplayComponents(
    (td) => td.setContent(`**Description**\n${description}`),
  );

  // Answer (if present)
  if (answer) {
    container.addSeparatorComponents(
      (sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    );

    container.addTextDisplayComponents(
      (td) => td.setContent(`**Answer**\n\`\`\`\n${answer}\n\`\`\``),
    );
  }

  container.addSeparatorComponents(
    (sep) => sep.setDivider(false).setSpacing(SeparatorSpacingSize.Large),
  );

  // Footer
  container.addTextDisplayComponents(
    (td) => td.setContent(`-# BLOKKLIST v4 \u2022 ${label} \u2022 #${feedbackId} \u2022 ${status.toUpperCase()}`),
  );

  return container;
}

// Stores pending feedback type selection between select menu and modal
const pendingFeedback = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName("feedback")
    .setDescription("Submit feedback, a feature request, or a bug report"),

  async execute(interaction) {
    // Check 2-week cooldown
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const recent = await db.query(
      "SELECT created_at FROM feedback_log WHERE user_hash = ? AND created_at >= ? LIMIT 1",
      [hashUser(interaction.user.id), twoWeeksAgo]
    );
    if (recent.length) {
      const nextAllowed = new Date(new Date(recent[0].created_at).getTime() + 14 * 24 * 60 * 60 * 1000);
      const until = `<t:${Math.floor(nextAllowed.getTime() / 1000)}:R>`;
      return interaction.reply({
        content: `❌ You can only submit feedback **once every 2 weeks**. You can submit again ${until}.`,
        flags: 64,
      });
    }

    // Show type selection
    const select = new StringSelectMenuBuilder()
      .setCustomId("feedback_type_select")
      .setPlaceholder("What type of feedback?")
      .addOptions(
        { label: "Feedback", description: "General feedback", value: "feedback" },
        { label: "Feature Request", description: "Suggest a new feature", value: "feature" },
      );

    const row = new ActionRowBuilder().addComponents(select);
    await interaction.reply({ content: "**What type of feedback do you want to submit?**", components: [row], flags: 64 });
  },

  async handleTypeSelect(interaction) {
    const type = interaction.values[0];
    pendingFeedback.set(interaction.user.id, { type });

    const modal = new ModalBuilder()
      .setCustomId("feedback_modal")
      .setTitle(`${TYPE_LABELS[type]}`);

    const placeholders = {
      feedback: { title: "Short summary of your feedback", desc: "Describe your feedback in detail..." },
      feature:  { title: "What feature would you like?", desc: "Describe the feature and why it would be useful..." },
    };
    const ph = placeholders[type] ?? placeholders.feedback;

    const titleInput = new TextInputBuilder()
      .setCustomId("feedback_title")
      .setLabel("Title")
      .setStyle(TextInputStyle.Short)
      .setMinLength(3)
      .setMaxLength(200)
      .setRequired(true)
      .setPlaceholder(ph.title);

    const descInput = new TextInputBuilder()
      .setCustomId("feedback_description")
      .setLabel("Description")
      .setStyle(TextInputStyle.Paragraph)
      .setMinLength(10)
      .setMaxLength(2000)
      .setRequired(true)
      .setPlaceholder(ph.desc);

    modal.addComponents(
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(descInput),
    );

    await interaction.showModal(modal);
  },

  async handleModal(interaction) {
    await interaction.deferReply({ flags: 64 });

    const pending = pendingFeedback.get(interaction.user.id);
    if (!pending) return interaction.editReply("Session expired. Please run `/feedback` again.");
    pendingFeedback.delete(interaction.user.id);

    const { type } = pending;
    const titleRaw = interaction.fields.getTextInputValue("feedback_title").trim();
    const descRaw = interaction.fields.getTextInputValue("feedback_description").trim();

    // Translate to English (DeepL auto-detects source language)
    let title = titleRaw;
    let description = descRaw;
    try {
      const [titleResult, descResult] = await Promise.all([
        translateToEnglish(titleRaw),
        translateToEnglish(descRaw),
      ]);
      title = titleResult.text;
      description = descResult.text;
    } catch (err) {
      console.warn("[Feedback] Translation failed, using original text:", err.message);
    }

    const channel = interaction.guild.channels.cache.get(FEEDBACK_CHANNEL);
    if (!channel) return interaction.editReply("❌ Feedback channel not found.");

    let feedbackId = null;
    let msg = null;

    try {
      feedbackId = await generateFeedbackId();
      const container = buildFeedbackContainer(feedbackId, type, title, description, interaction.user.username);
      msg = await channel.send({ components: [container], flags: 32768 });

      await db.query(
        `INSERT INTO feedbacks (id, user_hash, type, title, description, message_id, channel_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`,
        [feedbackId, hashUser(interaction.user.id), type, title, description, msg.id, FEEDBACK_CHANNEL]
      );
      await db.query(
        "INSERT INTO feedback_log (user_hash) VALUES (?)",
        [hashUser(interaction.user.id)]
      );
    } catch (err) {
      if (msg) await channel.messages.delete(msg.id).catch(() => {});
      console.error("[Feedback] Failed:", err.message);
      return interaction.editReply("❌ Failed to submit feedback. Please try again.");
    }

    return interaction.editReply(
      `✅ Your ${TYPE_LABELS[type].toLowerCase()} **#${feedbackId}** has been submitted in <#${FEEDBACK_CHANNEL}>.`
    );
  },

  buildFeedbackContainer,
};
