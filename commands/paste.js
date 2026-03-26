// ─── /paste Command ────────────────────────────────────────────────
// Adds a VRChat user to the blocklist.
//
// Flow:
// 1. User runs /paste → category selector dropdown
// 2. User picks category → modal with profile link + reason
// 3. Bot fetches VRChat profile, translates reason via DeepL
// 4. Checks for duplicates (appends reason if already listed)
// 5. Posts V2 container via webhook, saves to DB
//
// Rate limit: 2 pastes per user per week (tracked by hashed user ID)
// Blocked patterns: prevents CSAM-related accusations

const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");
const { randomUUID, createHmac } = require("crypto");
const db = require("../database/db");
const vrc = require("../helper/vrchat");
const { getWebhook } = require("../helper/webhooks");
const { CATEGORIES, getChannelId } = require("./setup");
const { translateToEnglish } = require("../helper/deepl");

// Maps VRChat language tags to readable names
const LANG_MAP = {
  language_eng: "English",   language_kor: "Korean",    language_rus: "Russian",
  language_spa: "Spanish",   language_por: "Portuguese",language_zho: "Chinese",
  language_deu: "German",    language_jpn: "Japanese",  language_fra: "French",
  language_swe: "Swedish",   language_nld: "Dutch",     language_pol: "Polish",
  language_dan: "Danish",    language_nor: "Norwegian", language_ita: "Italian",
  language_tha: "Thai",      language_fin: "Finnish",   language_hun: "Hungarian",
  language_ces: "Czech",     language_tur: "Turkish",   language_ara: "Arabic",
  language_ron: "Romanian",  language_vie: "Vietnamese",language_ase: "ASL",
  language_bfi: "BSL",       language_dse: "Dutch Sign Language",
  language_fsl: "French Sign Language",                  language_kvk: "Korean Sign Language",
};
// Hash user ID for anonymous rate limiting (one-way, not reversible)
function hashUser(userId) {
  const secret = process.env.VOTE_HASH_SECRET ?? "blocklist-default-secret";
  return createHmac("sha256", secret).update(userId).digest("hex");
}
// Break long text into lines (used for old embed formatting, kept for compat)
function toLines(text, maxLen = 40) {
  const result = [];
  for (const rawLine of text.split("\n")) {
    for (const sentence of rawLine.split(/(?<=[.!?]) +/)) {
      const s = sentence.trim();
      if (!s) continue;
      const broken = s.replace(/\S+/g, (word) => {
        if (word.length <= maxLen) return word;
        const chunks = [];
        for (let i = 0; i < word.length; i += maxLen) chunks.push(word.slice(i, i + maxLen));
        return chunks.join("\n");
      });
      for (const l of broken.split("\n")) {
        if (l.trim()) result.push(l);
      }
    }
  }
  return result.length ? result : ["–"];
}
function formatSection(lines) {
  const inner = lines
    .flatMap((l) => toLines(l))
    .map((l) => `#\u200b ${l}`)
    .join("\n");
  return `${SEP}\n#\n${inner}\n#\n${SEP}`;
}
function formatList(items) {
  const filled = items.length ? items.map((i) => `- ${i.trim()}`) : ["-"];
  return formatSection(filled);
}
// Generate a random 8-char reference ID (e.g. "A3F9B2C1")
function genRefId() {
  return randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}
// Stores selected category between dropdown selection and modal submission
const pendingCategory = new Map();
module.exports = {
  data: new SlashCommandBuilder()
    .setName("paste")
    .setDescription("Add a VRChat user to the blocklist"),
  async execute(interaction) {
    const requiredRole = process.env.BLOCKLIST_ROLE_ID;
    if (requiredRole && !interaction.member.roles.cache.has(requiredRole)) {
      return interaction.reply({
        content: "❌ You do not have permission to use this command.",
        flags: 64,
      });
    }
    if (true) {
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recent = await db.query(
        "SELECT COUNT(*) AS count FROM paste_log WHERE user_hash = ? AND created_at >= ?",
        [hashUser(interaction.user.id), oneWeekAgo]
      ).catch(err => { console.error("[Paste] Failed to check rate limit:", err.message); return [{ count: 0 }]; });
      const count = recent[0]?.count ?? 0;
      if (count >= 2) {
        return interaction.reply({
          content: `❌ You have reached your limit of **2 pastes per week**.\nYour limit resets 7 days after your first paste this week.`,
          flags: 64,
        });
      }
    }
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("paste_category_select")
        .setPlaceholder("📂 Select a category...")
        .addOptions(
          CATEGORIES.map((cat) => ({
            label: `-${cat.id}`,
            value: cat.id,
            emoji: cat.emoji,
          }))
        )
    );
    const { resource } = await interaction.reply({
      content: "**Step 1:** Which category should this user be added to?",
      components: [row],
      flags: 64,
      withResponse: true,
    });
    const reply = resource.message;
    const collector = reply.createMessageComponentCollector({
      time: 2 * 60 * 1000,
      max: 1,
    });
    collector.on("end", async (collected) => {
      if (collected.size === 0) {
        await interaction.editReply({
          content: "⏳ Timeout — please run `/paste` again.",
          components: [],
        }).catch(err => console.error("[Paste] Failed to edit timeout reply:", err.message));
      }
    });
  },
  async handleCategorySelect(interaction) {
    const category = interaction.values[0];
    pendingCategory.set(interaction.user.id, category);
    const modal = new ModalBuilder()
      .setCustomId("paste_modal")
      .setTitle(`Blocklist → -${category}`);
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("profile_link")
          .setLabel("VRChat Profile Link")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("https://vrchat.com/home/user/usr_...")
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Reason")
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder("Why is this user being reported?")
          .setMinLength(10)
          .setMaxLength(255)
          .setRequired(true)
      )
    );
    await interaction.showModal(modal);
    await interaction.deleteReply().catch(err => console.error("[Paste] Failed to delete reply:", err.message));
  },
  async handleModal(interaction) {
    await interaction.deferReply({ flags: 64 });
    const category    = pendingCategory.get(interaction.user.id) ?? "CREEPS";
    const profileLink = interaction.fields.getTextInputValue("profile_link").trim();
    // Strip URLs from reason (links are not allowed in reasons)
    const rawReason   = interaction.fields.getTextInputValue("reason").trim();
    const reason      = rawReason.replace(/https?:\/\/\S+/gi, "").replace(/\s{2,}/g, " ").trim();
    pendingCategory.delete(interaction.user.id);

    if (!reason || reason.length < 10) {
      return interaction.editReply("❌ Your reason is too short after removing links. Please provide a valid reason without URLs.");
    }

    const BLOCKED_PATTERNS = [
      /p[\W_]*[e3][\W_]*[d][\W_]*[o0]/i,
      /p[\W_]*[a@][\W_]*[e3][\W_]*[d][\W_]*[o0]/i,
      /p[\W_]*[aä@][\W_]*d[\W_]*[o0][\W_]*ph/i,
      /child[\W_]*abus/i,
      /child[\W_]*molest/i,
      /minor[\W_]*abus/i,
      /underage[\W_]*sex/i,
      /\bcsam\b/i,
      /kind[\W_]*sch[\W_]*[aä]nd/i,
      /kind[\W_]*miss[\W_]*brauch/i,
      /kind[\W_]*mi[sß][\W_]*brauch/i,
      /missbrauch[\W_]*von[\W_]*minderj/i,
      /minderj[\W_]*[aä]hrig[\W_]*(sex|missbrauch|mi[sß]brauch)/i,
    ];
    if (BLOCKED_PATTERNS.some(p => p.test(reason))) {
      return interaction.editReply(
        "❌ Your reason contains terms that are not allowed.\n" +
        "Accusations of this nature cannot be posted through this bot as they may put the server at legal risk.\n" +
        "If you have evidence of illegal activity, please report it to the appropriate authorities."
      );
    }
    // Auto-translate reason to English via DeepL (skip if usage > 480k)
    let translatedReason = reason;
    let detectedLang = null;
    try {
      const { getUsage } = require("../helper/deepl");
      const usage = await getUsage();
      if (usage.used >= 480000) {
        console.warn(`[Paste] DeepL usage at ${usage.used.toLocaleString()}/${usage.limit.toLocaleString()}, skipping translation`);
      } else {
        const result = await translateToEnglish(reason);
        translatedReason = result.text;
        detectedLang = result.detected;
      }
    } catch (err) {
      console.error("[Paste] DeepL translation failed, using original:", err.message);
    }
    const match = profileLink.match(/usr_[a-f0-9-]+/i);
    if (!match) {
      return interaction.editReply("❌ Invalid link.\nFormat: `https://vrchat.com/home/user/usr_...`");
    }
    let vrcUser = null;
    try {
      vrcUser = await vrc.getUserById(match[0]);
    } catch (err) {
      console.error("[Paste] VRChat error:", err.message);
      if (err.message?.includes("429") || err.message?.toLowerCase().includes("rate")) {
        return interaction.editReply("The VRChat API is currently rate limited. Please wait a moment and try again.");
      }
      if (err.message?.includes("401") || err.message?.includes("unauthorized")) {
        return interaction.editReply("The VRChat session expired. The bot will reconnect automatically — please try again in a few seconds.");
      }
      return interaction.editReply("Failed to fetch the VRChat profile. The API may be temporarily unavailable — please try again.");
    }
    const bio       = vrcUser.bio?.trim() || "No bio available";
    const pronouns  = vrcUser.pronouns?.trim() || null;
    const languages = (vrcUser.tags ?? [])
      .filter((t) => t.startsWith("language_"))
      .map((t) => LANG_MAP[t] ?? t.replace("language_", "").toUpperCase());
    const links     = (vrcUser.bioLinks ?? []).filter(Boolean);
    const refId     = genRefId();
    const thumbnail = vrcUser.profilePicOverride || vrcUser.currentAvatarThumbnailImageUrl || null;
    const channelId = getChannelId(category);
    try {
      const existing = await db.query(
        "SELECT message_id, channel_id, ref_id, reason, created_at FROM pastes WHERE vrc_id = ? AND category = ? LIMIT 1",
        [vrcUser.id, category]
      );
      if (existing.length && existing[0].ref_id) {
        const activeTDR = await db.query(
          "SELECT id FROM tdr_requests WHERE ref_id = ? AND status = 'voting' LIMIT 1",
          [existing[0].ref_id]
        ).catch(err => { console.error("[Paste] Failed to check active TDR:", err.message); return []; });
        if (activeTDR.length) {
          return interaction.editReply(
            `❌ **${vrcUser.displayName}** already has an active post in **-${category}** that is currently in a TDR vote.\n` +
            `The post cannot be updated while a TDR is in progress. Please wait for the vote to finish.`
          );
        }
      }
      if (existing.length && existing[0].ref_id) {
        // Append new reason to existing entry
        const today = new Date().toISOString().slice(0, 10);
        const oldReason = existing[0].reason || "No reason recorded";
        const combinedReason = `${oldReason}\n${translatedReason} [${today}]`;
        const trunc = (str, max) => str.length > max ? str.slice(0, max - 1) + "\u2026" : str;
        const truncatedCombined = trunc(combinedReason, 3800);

        await db.query(
          "UPDATE pastes SET reason = ?, vrc_name = ? WHERE ref_id = ?",
          [truncatedCombined, vrcUser.displayName, existing[0].ref_id]
        );

        // Update the post in the channel
        if (existing[0].message_id && existing[0].channel_id) {
          const oldChannel = interaction.guild.channels.cache.get(existing[0].channel_id);
          if (oldChannel) {
            try {
              const { buildBlocklistContainer } = require("../helper/buildContainer");
              const { MessageFlags } = require("discord.js");
              const existingDate = existing[0].created_at ? new Date(existing[0].created_at).toISOString().slice(0, 10) : null;
              const container = buildBlocklistContainer(vrcUser, truncatedCombined, existing[0].ref_id, category, existingDate);
              const wh = await getWebhook(oldChannel);
              await wh.editMessage(existing[0].message_id, {
                components: [container],
                flags: MessageFlags.IsComponentsV2,
              });
            } catch (err) {
              console.error("[Paste] Failed to update existing post:", err.message);
            }
          }
        }

        await db.query(
          "INSERT INTO paste_log (user_hash) VALUES (?)",
          [hashUser(interaction.user.id)]
        );

        const langNote = detectedLang && detectedLang !== "EN"
          ? `\n\uD83C\uDF10 Reason was translated from **${detectedLang}** to **EN**`
          : "";
        return interaction.editReply(
          `\u2705 **${vrcUser.displayName}** already exists in **-${category}** — reason has been updated.\nRef ID: \`${existing[0].ref_id}\`` + langNote
        );
      }
    } catch (err) {
      console.error("[Paste] Duplicate check error:", err.message);
    }
    const { buildBlocklistContainer } = require("../helper/buildContainer");
    const { MessageFlags } = require("discord.js");
    const today = new Date().toISOString().slice(0, 10);
    const container = buildBlocklistContainer(vrcUser, translatedReason, refId, category, today);
    if (channelId) {
      const channel = interaction.guild.channels.cache.get(channelId);
      if (channel) {
        const webhook = await getWebhook(channel);
        const msg = await webhook.send({
          components: [container],
          flags: MessageFlags.IsComponentsV2,
          username: `-${category}`,
        });
        try {
          await db.transaction(async (conn) => {
            await conn.execute(
              `INSERT INTO pastes (ref_id, vrc_id, vrc_name, category, message_id, channel_id, reason, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [refId, vrcUser.id, vrcUser.displayName, category, msg.id, channelId, translatedReason, today]
            );
            await conn.execute(
              "INSERT INTO paste_log (user_hash) VALUES (?)",
              [hashUser(interaction.user.id)]
            );
          });
        } catch (err) {
          await webhook.deleteMessage(msg.id).catch(e => console.error("[Paste] Failed to clean up webhook message:", e.message));
          console.error("[Paste] Transaction failed, webhook message deleted:", err.message);
          return interaction.editReply("❌ Database error — the post was not saved. Please try again.");
        }
        const langNote = detectedLang && detectedLang !== "EN"
          ? `\n🌐 Reason was translated from **${detectedLang}** to **EN**`
          : "";
        return interaction.editReply(
          `✅ **${vrcUser.displayName}** has been posted to <#${channelId}>.\nRef ID: \`${refId}\`` + langNote
        );
      }
    }
    await interaction.editReply(
      `⚠️ No channel configured for **-${category}**. Use \`/setup\` to set one.`
    );
  },
};