// ─── /tdr Command (Takedown Request) ───────────────────────────────
// Allows users to request removal of a blocklist entry.
//
// Flow:
// 1. User runs /tdr ref_id:ABC123 → checks cooldowns + rate limits
// 2. Modal asks for removal reason
// 3. TDR is posted in announcements channel with Keep/Remove buttons
// 4. Community votes for 7 days
// 5. tdrScheduler.js resolves the vote after deadline
//
// Voting: 12 net remove-votes needed to remove a post
// Rate limit: 1 TDR per user per week
// Cooldown: 14 days after a TDR resolves before a new one can be filed

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { createHmac, randomInt } = require("crypto");
const db = require("../database/db");

// Generate a random 9-digit ID that doesn't collide with existing TDRs
async function generateTdrId() {
  for (let i = 0; i < 10; i++) {
    const id = randomInt(100_000_000, 999_999_999);
    const existing = await db.query("SELECT id FROM tdr_requests WHERE id = ? LIMIT 1", [id]);
    if (!existing.length) return id;
  }
  throw new Error("Failed to generate unique TDR ID");
}
// Hash voter identity (user + TDR specific, prevents cross-TDR tracking)
function hashVoter(userId, tdrId) {
  const secret = process.env.VOTE_HASH_SECRET ?? "blocklist-default-secret";
  return createHmac("sha256", secret)
    .update(`${userId}:${tdrId}`)
    .digest("hex");
}
// Build the TDR announcement embed with vote counts and deadline
async function buildTDREmbed(tdr, post, upvotes, downvotes, deadline, reason = "–") {
  const deadlineTs = `<t:${Math.floor(new Date(deadline).getTime() / 1000)}:R>`;
  const lead = downvotes - upvotes;
  const needed = Math.max(0, 12 - lead);
  const SEP = "⛞ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ⛞";
  const postLink = tdr.post_channel_id && tdr.post_message_id
    ? `https://discord.com/channels/${tdr.guild_id}/${tdr.post_channel_id}/${tdr.post_message_id}`
    : null;
  return new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle(`Takedown Request — \`${tdr.ref_id}\``)
    .addFields(
      {
        name: "Post",
        value: `**${post.vrc_name}** — -${post.category}${postLink ? `\n[View post](${postLink})` : ""}\n${SEP}`,
        inline: false,
      },
      {
        name: "𝗥𝗲𝗮𝘀𝗼𝗻",
        value: `\`\`\`diff\n- ${reason}\n\`\`\`\n${SEP}`,
        inline: false,
      },
      {
        name: "Keep",
        value: `**${upvotes}**`,
        inline: true,
      },
      {
        name: "Remove",
        value: `**${downvotes}**`,
        inline: true,
      },
      {
        name: "Lead",
        value: lead >= 0 ? `Remove +${lead}` : `Keep +${Math.abs(lead)}`,
        inline: true,
      },
      {
        name: "Voting",
        value: `Ends ${deadlineTs}\n${needed > 0 ? `${needed} more remove-votes needed` : "Ready to be removed!"}\n${SEP}`,
        inline: false,
      },
    )
    .setFooter({ text: "𝗕𝗟𝗢𝗞𝗞𝗟𝗜𝗦𝗧 ᵛ⁴ • TDR" })
    .setTimestamp();
}
// Build Keep/Remove vote buttons for a TDR announcement
function buildVoteButtons(tdrId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`tdr_vote_up_${tdrId}`)
      .setLabel("Keep")
      .setEmoji("1481033501426847929")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`tdr_vote_down_${tdrId}`)
      .setLabel("Remove")
      .setEmoji("1481033566363062292")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );
}
// Stores pending TDR data between /tdr command and modal submission
const pendingTDR = new Map();
module.exports = {
  data: new SlashCommandBuilder()
    .setName("tdr")
    .setDescription("File a Takedown Request for a blocklist post")
    .addStringOption(opt =>
      opt.setName("ref_id")
         .setDescription("REF ID from the blocklist post (e.g. A3F9B2C1)")
         .setRequired(true)
    ),
  async execute(interaction) {
    const refId = interaction.options.getString("ref_id").trim().toUpperCase();
    const posts = await db.query("SELECT * FROM pastes WHERE ref_id = ? LIMIT 1", [refId]);
    if (!posts.length) {
      return interaction.reply({ content: `❌ No post found with REF ID \`${refId}\`.`, flags: 64 });
    }
    const post = posts[0];
    if (true) {
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentLog = await db.query(
        "SELECT * FROM tdr_log WHERE user_hash = ? AND created_at >= ? LIMIT 1",
        [hashVoter(interaction.user.id, "weekly"), oneWeekAgo]
      ).catch(err => { console.error("[TDR] Failed to check rate limit:", err.message); return []; });
      if (recentLog.length) {
        const nextAllowed = new Date(new Date(recentLog[0].created_at).getTime() + 7 * 24 * 60 * 60 * 1000);
        const until = `<t:${Math.floor(nextAllowed.getTime() / 1000)}:R>`;
        return interaction.reply({ content: `❌ You can only file **1 TDR per week**. You can file again ${until}.`, flags: 64 });
      }
    }
    const existing = await db.query(
      "SELECT * FROM tdr_requests WHERE ref_id = ? ORDER BY filed_at DESC LIMIT 1", [refId]
    );
    if (existing.length) {
      const last = existing[0];
      if (last.status === "voting")  return interaction.reply({ content: `⏳ A TDR for \`${refId}\` is already in progress.`, flags: 64 });
      if (last.status === "removed") return interaction.reply({ content: `✅ This post has already been removed.`, flags: 64 });
      if (last.cooldown_until && new Date() < new Date(last.cooldown_until)) {
        const until = `<t:${Math.floor(new Date(last.cooldown_until).getTime() / 1000)}:R>`;
        return interaction.reply({ content: `⏳ This post is on cooldown. You can file again ${until}.`, flags: 64 });
      }
    }
    pendingTDR.set(interaction.user.id, { refId, post });
    const modal = new ModalBuilder()
      .setCustomId("tdr_modal")
      .setTitle(`TDR — ${refId}`);
    const reasonInput = new TextInputBuilder()
      .setCustomId("tdr_reason")
      .setLabel("Why should this post be removed?")
      .setStyle(TextInputStyle.Paragraph)
      .setMinLength(10)
      .setMaxLength(500)
      .setRequired(true)
      .setPlaceholder("e.g. The provided information is incorrect because...");
    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    await interaction.showModal(modal);
  },
  async handleModal(interaction) {
    await interaction.deferReply({ flags: 64 });
    const pending = pendingTDR.get(interaction.user.id);
    if (!pending) return interaction.editReply("Session expired. Please run `/tdr` again.");
    pendingTDR.delete(interaction.user.id);
    const { refId, post } = pending;
    const reason = interaction.fields.getTextInputValue("tdr_reason").trim();
    const announcementChannelId = process.env.ANNOUNCEMENTS_CHANNEL;
    if (!announcementChannelId) return interaction.editReply("❌ `ANNOUNCEMENTS_CHANNEL` not set in `.env`.");
    const announcementChannel = interaction.guild.channels.cache.get(announcementChannelId);
    if (!announcementChannel) return interaction.editReply("❌ Announcements channel not found.");
    let tdrId = null;
    let msg = null;
    try {
      tdrId = await generateTdrId();
      await db.transaction(async (conn) => {
        await conn.execute(
          `INSERT INTO tdr_requests (id, ref_id, filed_by_hash, status) VALUES (?, ?, ?, 'voting')`,
          [tdrId, refId, hashVoter(interaction.user.id, "weekly")]
        );
        await conn.execute(
          "INSERT INTO tdr_log (user_hash) VALUES (?)",
          [hashVoter(interaction.user.id, "weekly")]
        );
        const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const tdrObj = {
          id: tdrId, ref_id: refId,
          filed_at: new Date(), status: "voting",
          post_channel_id: post.channel_id,
          post_message_id: post.message_id,
          guild_id: interaction.guild.id,
        };
        const embed = await buildTDREmbed(tdrObj, post, 0, 0, deadline, reason);
        const buttons = buildVoteButtons(tdrId);
        msg = await announcementChannel.send({ embeds: [embed], components: [buttons] });
        await conn.execute(
          "UPDATE tdr_requests SET announcement_id = ?, channel_id = ?, reason = ? WHERE id = ?",
          [msg.id, announcementChannelId, reason, tdrId]
        );
      });
    } catch (err) {
      if (msg) await announcementChannel.messages.delete(msg.id).catch(e => console.error("[TDR] Failed to clean up announcement:", e.message));
      console.error("[TDR] Transaction failed:", err.message);
      return interaction.editReply("Database error — TDR could not be saved. Please try again.");
    }
    return interaction.editReply(
      `✅ TDR filed for \`${refId}\`.\nVoting has started in <#${announcementChannelId}>.`
    );
  },
  async handleButton(interaction) {
    const parts = interaction.customId.split("_"); 
    const vote  = parts[2]; 
    const tdrId = parseInt(parts[3]);
    await interaction.deferReply({ flags: 64 });
    const voterHash = hashVoter(interaction.user.id, tdrId);
    const existing = await db.query(
      "SELECT * FROM tdr_votes WHERE tdr_id = ? AND voter_hash = ? LIMIT 1",
      [tdrId, voterHash]
    );
    if (existing.length) {
      return interaction.editReply("You have already voted on this TDR. Votes cannot be changed.");
    }
    await db.query(
      "INSERT INTO tdr_votes (tdr_id, voter_hash, vote) VALUES (?, ?, ?)",
      [tdrId, voterHash, vote]
    );
    const counts = await db.query(
      "SELECT vote, COUNT(*) AS count FROM tdr_votes WHERE tdr_id = ? GROUP BY vote",
      [tdrId]
    );
    const upvotes   = counts.find(r => r.vote === "up")?.count   ?? 0;
    const downvotes = counts.find(r => r.vote === "down")?.count ?? 0;
    const tdrs = await db.query("SELECT * FROM tdr_requests WHERE id = ? LIMIT 1", [tdrId]);
    if (!tdrs.length) return interaction.editReply("❌ TDR not found.");
    const tdr = tdrs[0];
    const posts = await db.query("SELECT * FROM pastes WHERE ref_id = ? LIMIT 1", [tdr.ref_id]);
    if (!posts.length) return interaction.editReply("❌ Post not found.");
    const post = posts[0];
    const tdrObj = {
      ...tdr,
      post_channel_id: post.channel_id,
      post_message_id: post.message_id,
      guild_id: interaction.guild.id,
    };
    const deadline = new Date(new Date(tdr.filed_at).getTime() + 7 * 24 * 60 * 60 * 1000);
    const embed = await buildTDREmbed(tdrObj, post, upvotes, downvotes, deadline, tdr.reason ?? "–");
    const buttons = buildVoteButtons(tdrId);
    try {
      const announcementChannel = interaction.guild.channels.cache.get(tdr.channel_id);
      if (announcementChannel) {
        const webhooks = await announcementChannel.fetchWebhooks();
        const msg = await announcementChannel.messages.fetch(tdr.announcement_id);
        if (msg?.webhookId) {
          const wh = webhooks.get(msg.webhookId);
          if (wh) await wh.editMessage(tdr.announcement_id, { embeds: [embed], components: [buttons] });
        } else if (msg) {
          await msg.edit({ embeds: [embed], components: [buttons] });
        }
      }
    } catch (err) { console.error("[TDR] Failed to update announcement message:", err.message); }
    const voteLabel = vote === "up" ? "Keep — vote recorded." : "Remove — vote recorded.";
    return interaction.editReply(`${voteLabel} You cannot change it.`);
  },
  buildTDREmbed,
  buildVoteButtons,
};