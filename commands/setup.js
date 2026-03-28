// ─── /setup Command ────────────────────────────────────────────────
// Shows an overview of all blocklist categories and their configured channels.
// Admin-only. Channels are set via environment variables in .env.

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require("discord.js");

// All blocklist categories — each maps to a .env channel variable
const CATEGORIES = [
  { id: "CREEPS",          emoji: "🩷", env: "CH_CREEPS"          },
  { id: "LIARS",           emoji: "🩷", env: "CH_LIARS"           },
  { id: "SHITTALKERS",     emoji: "🩷", env: "CH_SHITTALKERS"     },
  { id: "E-HOES",          emoji: "🩷", env: "CH_E_HOES"          },
  { id: "E-BOYS",          emoji: "🩷", env: "CH_E_BOYS"          },
  { id: "STREAMERS",       emoji: "🩷", env: "CH_STREAMERS"       },
  { id: "CRASHERS",        emoji: "🩷", env: "CH_CRASHERS"        },
  { id: "MODDERS",         emoji: "🩷", env: "CH_MODDERS"         },
  { id: "MAIN-CHARACTERS", emoji: "🩷", env: "CH_MAIN_CHARACTERS" },
  { id: "VRC-STAFF",       emoji: "🩷", env: "CH_VRC_STAFF"       },
  { id: "TYRANTS",         emoji: "🩷", env: "CH_TYRANTS"         },
  { id: "DOXXERS",         emoji: "🩷", env: "CH_DOXXERS"         },
];

// Get channel ID from .env
function getChannelId(categoryId) {
  const cat = CATEGORIES.find(c => c.id === categoryId);
  return cat ? process.env[cat.env] || null : null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Show blocklist channel overview")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const lines = CATEGORIES.map(cat => {
      const chId = process.env[cat.env];
      return `${cat.emoji} **-${cat.id}** → ${chId ? `<#${chId}>` : "\`not set\`"}`;
    });

    const missing = CATEGORIES.filter(c => !process.env[c.env]);

    const embed = new EmbedBuilder()
      .setTitle("------------ LISTING SETUP ------------")
      .setColor(missing.length === 0 ? 0x2ecc71 : 0xe74c3c)
      .setDescription(lines.join("\n"))
      .setFooter({
        text: missing.length === 0
          ? "All channels configured"
          : `${missing.length} category/categories without a channel — set them in .env`,
      })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },

  CATEGORIES,
  getChannelId,
};