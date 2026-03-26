// ─── TDR Scheduler ─────────────────────────────────────────────────
// Runs every hour to check if any TDR voting deadlines have passed.
// After 7 days of voting:
//   - If 12+ net remove-votes → post is deleted, TDR marked "removed"
//   - Otherwise → TDR marked "expired", post stays
// Both outcomes set a 14-day cooldown before a new TDR can be filed.

const db = require("../database/db");

// Check all active TDRs and resolve expired ones
async function checkTDRs(client) {
  let activeTDRs = [];
  try {
    activeTDRs = await db.query("SELECT * FROM tdr_requests WHERE status = 'voting'");
  } catch (err) { console.error("[TDR Scheduler] Failed to fetch active TDRs:", err.message); return; }

  for (const tdr of activeTDRs) {
    const deadline = new Date(new Date(tdr.filed_at).getTime() + 7 * 24 * 60 * 60 * 1000);
    if (new Date() < deadline) continue;

    let guild = null;
    for (const g of client.guilds.cache.values()) { guild = g; break; }
    if (!guild) continue;

    const announcementChannel = guild.channels.cache.get(tdr.channel_id ?? process.env.ANNOUNCEMENTS_CHANNEL);
    if (!announcementChannel) continue;

    const counts = await db.query(
      "SELECT vote, COUNT(*) AS count FROM tdr_votes WHERE tdr_id = ? GROUP BY vote",
      [tdr.id]
    ).catch(err => { console.error("[TDR Scheduler] Failed to fetch vote counts:", err.message); return []; });
    const upvotes   = counts.find(r => r.vote === "up")?.count   ?? 0;
    const downvotes = counts.find(r => r.vote === "down")?.count ?? 0;
    const lead = downvotes - upvotes;


    let msg = null;
    try {
      msg = await announcementChannel.messages.fetch(tdr.announcement_id);
    } catch (err) {
      console.error("[TDR Scheduler] Failed to fetch announcement message:", err.message);
      await db.query("UPDATE tdr_requests SET status = 'expired' WHERE id = ?", [tdr.id]);
      continue;
    }

    const { buildVoteButtons } = require("../commands/tdr");
    const disabledButtons = buildVoteButtons(tdr.id, true);

    if (lead >= 12) {
      const posts = await db.query("SELECT * FROM pastes WHERE ref_id = ? LIMIT 1", [tdr.ref_id]);
      if (posts.length) {
        const post = posts[0];
        if (post.message_id && post.channel_id) {
          const postChannel = guild.channels.cache.get(post.channel_id);
          if (postChannel) await postChannel.messages.delete(post.message_id).catch(err => console.error("[TDR Scheduler] Failed to delete post message:", err.message));
        }
        await db.query("DELETE FROM pastes WHERE ref_id = ?", [tdr.ref_id]);
      }

      const SEP = "────────────────────────────────────────────";
      await msg.edit({
        content: null,
        embeds: [
          new (require("discord.js").EmbedBuilder)()
            .setColor(0x2ecc71)
            .setTitle(`Takedown Request — \`${tdr.ref_id}\``)
            .setDescription(`${SEP}\nThis post has been **removed** from the blocklist.\n${SEP}`)
            .addFields(
              { name: "Keep",   value: `**${upvotes}**`,  inline: true },
              { name: "Remove", value: `**${downvotes}**`, inline: true },
              { name: "Result", value: `Removed (+${lead})`, inline: true },
            )
            .setFooter({ text: "𝗕𝗟𝗢𝗞𝗞𝗟𝗜𝗦𝗧 ᵛ⁴ • TDR closed" })
            .setTimestamp()
        ],
        components: [disabledButtons],
      }).catch(err => console.error("[TDR Scheduler] Failed to edit removal message:", err.message));

      await db.query("DELETE FROM tdr_votes WHERE tdr_id = ?", [tdr.id]);
      const removedCooldown = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      await db.query(
        "UPDATE tdr_requests SET status = 'removed', cooldown_until = ? WHERE id = ?",
        [removedCooldown, tdr.id]
      );

    } else {
      const cooldownUntil = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

      const SEP2 = "────────────────────────────────────────────";
      await msg.edit({
        content: null,
        embeds: [
          new (require("discord.js").EmbedBuilder)()
            .setColor(0x808080)
            .setTitle(`Takedown Request — \`${tdr.ref_id}\``)
            .setDescription(`${SEP2}\nNot enough votes — this post **stays** on the blocklist.\nA new TDR can be filed in 2 weeks.\n${SEP2}`)
            .addFields(
              { name: "Keep",   value: `**${upvotes}**`,  inline: true },
              { name: "Remove", value: `**${downvotes}**`, inline: true },
              { name: "Result", value: `Rejected (needed +12)`, inline: true },
            )
            .setFooter({ text: "𝗕𝗟𝗢𝗞𝗞𝗟𝗜𝗦𝗧 ᵛ⁴ • TDR closed" })
            .setTimestamp()
        ],
        components: [disabledButtons],
      }).catch(err => console.error("[TDR Scheduler] Failed to edit expired message:", err.message));

      await db.query("DELETE FROM tdr_votes WHERE tdr_id = ?", [tdr.id]);
      await db.query(
        "UPDATE tdr_requests SET status = 'expired', cooldown_until = ? WHERE id = ?",
        [cooldownUntil, tdr.id]
      );
    }
  }
}

function startScheduler(client) {
  setInterval(() => checkTDRs(client), 60 * 60 * 1000);
  setTimeout(() => checkTDRs(client), 10_000);
}

module.exports = { startScheduler, checkTDRs };