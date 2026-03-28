// ─── GuildMemberAdd Event ──────────────────────────────────────────
// When a member joins (or re-joins), checks if they have the rules role.
// If they have the role but never accepted rules in the DB, the role
// is removed. Prevents role persistence across leaves/rejoins.

const { Events } = require("discord.js");
const { createHmac } = require("crypto");
const db = require("../database/db");

function hashUser(userId) {
  const secret = process.env.VOTE_HASH_SECRET ?? "blocklist-default-secret";
  return createHmac("sha256", secret).update(userId).digest("hex");
}

module.exports = {
  name: Events.GuildMemberAdd,

  async execute(member) {
    const roleId = process.env.RULES_ROLE_ID;
    if (!roleId) return;
    if (member.roles.cache.has(roleId)) {
      const rows = await db.query(
        "SELECT id FROM rules_accepted WHERE user_hash = ? LIMIT 1",
        [hashUser(member.user.id)]
      ).catch(err => { console.error("[GuildMemberAdd] Failed to check rules acceptance:", err.message); return []; });

      if (!rows.length) {
        await member.roles.remove(roleId).catch(err => console.error("[GuildMemberAdd] Failed to remove role:", err.message));
      }
    }
  },
};