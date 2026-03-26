// ─── Post Sync Scheduler ───────────────────────────────────────────
// Self-healing system that runs on two schedules:
//
// 1) checkPosts (every 1 hour, first run 30s after start):
//    Checks if all DB entries still have a message in their channel.
//    If a message was deleted, re-posts it as a V2 container.
//    Also translates untranslated reasons via DeepL.
//
// 2) checkNames (every 24 hours, first run 2 min after start):
//    Detects VRChat display name changes and updates the DB + post.
//    Prevents users from hiding by changing their name.

const db = require("../database/db");
const vrc = require("./vrchat");
const { getWebhook } = require("./webhooks");
const { buildBlocklistContainer } = require("./buildContainer");
const { MessageFlags } = require("discord.js");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Check all posts in DB and re-post missing ones as V2 containers
async function checkPosts(client) {
  let posts = [];
  try {
    posts = await db.query("SELECT ref_id, vrc_id, vrc_name, category, reason, message_id, channel_id FROM pastes");
  } catch (err) {
    console.error("[PostSync] Failed to fetch posts:", err.message);
    return;
  }

  if (!posts.length) return;

  const guild = client.guilds.cache.first();
  if (!guild) return;

  let synced = 0;

  for (const post of posts) {
    if (!post.channel_id || !post.message_id) continue;

    const channel = guild.channels.cache.get(post.channel_id);
    if (!channel) continue;

    // Check if the message still exists
    let exists = false;
    try {
      await channel.messages.fetch(post.message_id);
      exists = true;
    } catch {
      // Message not found or deleted
    }

    if (exists) continue;

    // Message is missing — re-post it
    console.log(`[PostSync] Missing post for ${post.vrc_name ?? post.vrc_id} in -${post.category}, re-posting...`);

    let vrcUser = null;
    try {
      vrcUser = await vrc.getUserById(post.vrc_id);
    } catch (err) {
      console.warn(`[PostSync] VRChat API error for ${post.vrc_id}: ${err.message}`);
    }

    if (!vrcUser) {
      console.warn(`[PostSync] VRChat user ${post.vrc_id} not found, skipping re-post`);
      await sleep(2000);
      continue;
    }

    let reason = post.reason || "No reason recorded";

    // Translate reason to English if not already translated
    try {
      const { translateToEnglish, getUsage } = require("./deepl");
      const usage = await getUsage();
      if (usage.used < 480000) {
        const result = await translateToEnglish(reason);
        if (result.text !== reason) {
          reason = result.text;
          await db.query("UPDATE pastes SET reason = ? WHERE ref_id = ?", [reason, post.ref_id]);
          console.log(`[PostSync] Translated reason for ${post.ref_id} from ${result.detected} to EN`);
        }
      } else {
        console.warn(`[PostSync] DeepL usage at ${usage.used.toLocaleString()}, skipping translation`);
      }
    } catch (err) {
      console.warn(`[PostSync] DeepL translation skipped: ${err.message}`);
    }

    const container = buildBlocklistContainer(vrcUser, reason, post.ref_id, post.category);

    try {
      const webhook = await getWebhook(channel);
      const msg = await webhook.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        username: `-${post.category}`,
      });

      await db.query(
        "UPDATE pastes SET message_id = ?, vrc_name = ? WHERE ref_id = ?",
        [msg.id, vrcUser.displayName, post.ref_id]
      );

      synced++;
      console.log(`[PostSync] Re-posted ${vrcUser.displayName} (${post.ref_id}) in -${post.category}`);
    } catch (err) {
      console.error(`[PostSync] Failed to re-post ${post.ref_id}:`, err.message);
    }

    await sleep(2000);
  }

  if (synced > 0) {
    console.log(`[PostSync] Sync complete: ${synced} post(s) restored`);
  }
}

// Daily check: detect VRChat name changes and update posts + DB
async function checkNames(client) {
  let posts = [];
  try {
    posts = await db.query("SELECT ref_id, vrc_id, vrc_name, reason, category, message_id, channel_id FROM pastes");
  } catch (err) {
    console.error("[NameCheck] Failed to fetch posts:", err.message);
    return;
  }

  if (!posts.length) return;

  const guild = client.guilds.cache.first();
  if (!guild) return;

  let updated = 0;

  for (const post of posts) {
    let vrcUser = null;
    try {
      vrcUser = await vrc.getUserById(post.vrc_id);
    } catch (err) {
      console.warn(`[NameCheck] VRChat API error for ${post.vrc_id}: ${err.message}`);
    }

    if (!vrcUser) {
      await sleep(2000);
      continue;
    }

    if (vrcUser.displayName === post.vrc_name) {
      await sleep(2000);
      continue;
    }

    console.log(`[NameCheck] ${post.ref_id}: "${post.vrc_name}" → "${vrcUser.displayName}"`);

    await db.query(
      "UPDATE pastes SET vrc_name = ? WHERE ref_id = ?",
      [vrcUser.displayName, post.ref_id]
    );

    // Update the post in the channel
    if (post.channel_id && post.message_id) {
      const channel = guild.channels.cache.get(post.channel_id);
      if (channel) {
        try {
          const reason = post.reason || "No reason recorded";
          const container = buildBlocklistContainer(vrcUser, reason, post.ref_id, post.category);
          const webhook = await getWebhook(channel);
          await webhook.editMessage(post.message_id, {
            components: [container],
            flags: MessageFlags.IsComponentsV2,
          });
        } catch (err) {
          console.error(`[NameCheck] Failed to update post ${post.ref_id}:`, err.message);
        }
      }
    }

    updated++;
    await sleep(2000);
  }

  if (updated > 0) {
    console.log(`[NameCheck] Updated ${updated} name(s)`);
  }
}

function startPostSync(client) {
  setInterval(() => checkPosts(client), 60 * 60 * 1000);
  setTimeout(() => checkPosts(client), 30_000);

  // Daily name check — runs every 24h, first check 2 min after start
  setInterval(() => checkNames(client), 24 * 60 * 60 * 1000);
  setTimeout(() => checkNames(client), 2 * 60 * 1000);
}

module.exports = { startPostSync, checkPosts, checkNames };
