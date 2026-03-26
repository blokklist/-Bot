// ─── GuildMemberRemove Event ───────────────────────────────────────
// When a member leaves, their rules acceptance record is deleted.
// If they rejoin, they'll need to accept the rules again.

const { Events } = require("discord.js");
const { createHmac } = require("crypto");
const db = require("../database/db");

function hashUser(userId) {
  const secret = process.env.VOTE_HASH_SECRET ?? "blocklist-default-secret";
  return createHmac("sha256", secret).update(userId).digest("hex");
}

module.exports = {
  name: Events.GuildMemberRemove,

  async execute(member) {
    await db.query("DELETE FROM rules_accepted WHERE user_hash = ?", [hashUser(member.user.id)])
      .catch(err => console.error("[GuildMemberRemove] Failed to delete acceptance record:", err.message));
  },
};