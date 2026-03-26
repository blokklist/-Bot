// ─── Webhook Manager ───────────────────────────────────────────────
// Caches webhooks per channel to avoid repeated API calls.
// Creates a new webhook if none exists for the bot in that channel.
// All blocklist posts are sent via webhooks so the bot name
// shows as the category name (e.g. "-CREEPS").

const cache = new Map();

// Get or create a webhook for the given channel (cached)
async function getWebhook(channel) {
  if (cache.has(channel.id)) return cache.get(channel.id);

  const webhooks = await channel.fetchWebhooks();
  let webhook = webhooks.find(w => w.owner?.id === channel.client.user.id);

  if (!webhook) {
    webhook = await channel.createWebhook({
      name: channel.client.user.username,
      avatar: channel.client.user.displayAvatarURL({ extension: "png", size: 256 }),
    });
  }

  cache.set(channel.id, webhook);
  return webhook;
}

module.exports = { getWebhook };
