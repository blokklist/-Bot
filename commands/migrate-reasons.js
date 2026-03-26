// ─── /migrate-reasons Command ──────────────────────────────────────
// One-time migration tool. Reads reasons from old embed posts in
// Discord channels and saves them to the database.
// Supports both old embeds and V2 containers (diff block parsing).
// Owner-only. Run this BEFORE deleting old posts.

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require("discord.js");
const db = require("../database/db");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("migrate-reasons")
    .setDescription("Pull reasons from old embeds into the database (one-time migration)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (interaction.user.id !== interaction.guild.ownerId) {
      return interaction.reply({ content: "Only the server owner can use this command.", ephemeral: true });
    }

    await interaction.deferReply({ flags: 64 });

    // Get all posts that have no reason stored in DB
    let posts = [];
    try {
      posts = await db.query(
        "SELECT ref_id, message_id, channel_id, category FROM pastes WHERE reason IS NULL OR reason = ''"
      );
    } catch (err) {
      console.error("[Migrate] Failed to fetch posts:", err.message);
      return interaction.editReply("\u274C Failed to fetch posts from database.");
    }

    if (!posts.length) {
      return interaction.editReply("\u2705 Nothing to migrate \u2014 all posts already have a reason in the database.");
    }

    await interaction.editReply(`\u23F3 Found **${posts.length}** post(s) without a reason. Scanning embeds...`);

    let migrated = 0;
    let skipped = 0;
    let failed = 0;
    const results = [];

    for (const post of posts) {
      if (!post.message_id || !post.channel_id) {
        skipped++;
        results.push(`\u23ED \`${post.ref_id}\` \u2014 no message/channel ID`);
        continue;
      }

      const channel = interaction.guild.channels.cache.get(post.channel_id);
      if (!channel) {
        skipped++;
        results.push(`\u23ED \`${post.ref_id}\` \u2014 channel not found`);
        continue;
      }

      let message;
      try {
        message = await channel.messages.fetch({ message: post.message_id, force: true });
      } catch {
        skipped++;
        results.push(`\u23ED \`${post.ref_id}\` \u2014 message not found (already deleted?)`);
        continue;
      }

      // Check if this is a V2 component message (already migrated by sync)
      const v2Text = message.components
        ?.flatMap((c) => c.components ?? [])
        ?.filter((c) => c.data?.type === 10) // TextDisplay
        ?.map((c) => c.data?.content ?? "")
        ?.join("\n") ?? "";

      let embed = message.embeds?.[0] ?? null;

      // Debug: log what we found
      console.log(`[Migrate] ${post.ref_id}: embeds=${message.embeds?.length ?? 0}, components=${message.components?.length ?? 0}, v2Text=${v2Text.length > 0}`);

      // V2 Container: extract reason from text displays
      if (!embed && v2Text) {
        const diffMatch = v2Text.match(/```diff\n-\s*(.+?)\n```/s);
        if (diffMatch) {
          const reason = diffMatch[1].trim();
          if (reason) {
            try {
              await db.query("UPDATE pastes SET reason = ? WHERE ref_id = ?", [reason, post.ref_id]);
              migrated++;
              results.push(`\u2705 \`${post.ref_id}\` (-${post.category}) \u2014 "${reason.slice(0, 60)}${reason.length > 60 ? "\u2026" : ""}" (from V2)`);
            } catch (err) {
              failed++;
              results.push(`\u274C \`${post.ref_id}\` \u2014 DB error: ${err.message}`);
            }
            continue;
          }
        }
        skipped++;
        results.push(`\u23ED \`${post.ref_id}\` \u2014 V2 container but no reason found`);
        continue;
      }

      if (!embed) {
        skipped++;
        results.push(`\u23ED \`${post.ref_id}\` \u2014 no embed or V2 content found`);
        continue;
      }

      // Look for the Reason field (bold unicode "𝗥𝗲𝗮𝘀𝗼𝗻" or plain "Reason")
      const reasonField = embed.fields?.find(
        (f) => f.name === "\uD835\uDDE5\uD835\uDDF2\uD835\uDDEE\uD835\uDE00\uD835\uDDFC\uD835\uDDFB" || f.name.toLowerCase() === "reason"
      );

      if (!reasonField) {
        skipped++;
        results.push(`\u23ED \`${post.ref_id}\` \u2014 no reason field in embed`);
        continue;
      }

      // Extract reason from ```diff\n- reason\n``` format
      let reason = reasonField.value;
      const diffMatch = reason.match(/```diff\n-\s*(.+?)\n```/s);
      if (diffMatch) {
        reason = diffMatch[1].trim();
      }

      // Remove the separator if it's appended
      reason = reason.replace(/\n?\u26DE[\s\u2501]*\u26DE\s*$/, "").trim();

      if (!reason) {
        skipped++;
        results.push(`\u23ED \`${post.ref_id}\` \u2014 empty reason after parsing`);
        continue;
      }

      try {
        await db.query("UPDATE pastes SET reason = ? WHERE ref_id = ?", [reason, post.ref_id]);
        migrated++;
        results.push(`\u2705 \`${post.ref_id}\` (-${post.category}) \u2014 "${reason.slice(0, 60)}${reason.length > 60 ? "\u2026" : ""}"`);
      } catch (err) {
        failed++;
        results.push(`\u274C \`${post.ref_id}\` \u2014 DB error: ${err.message}`);
        console.error(`[Migrate] Failed to update ${post.ref_id}:`, err.message);
      }
    }

    const summary = [
      `**Migration complete**`,
      `\u2705 Migrated: **${migrated}**`,
      skipped ? `\u23ED Skipped: **${skipped}**` : null,
      failed ? `\u274C Failed: **${failed}**` : null,
      ``,
      ...results,
    ].filter(Boolean).join("\n");

    // Discord message limit is 2000 chars
    if (summary.length > 1900) {
      await interaction.editReply(summary.slice(0, 1900) + "\n\u2026 (truncated)");
    } else {
      await interaction.editReply(summary);
    }
  },
};
