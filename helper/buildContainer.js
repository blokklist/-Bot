// ─── Components V2 Container Builder ───────────────────────────────
// Shared builder for blocklist posts using Discord's Components V2.
// Used by: /paste, /test, postSyncScheduler, nameCheck
// Builds a container with: profile header, pronouns, platform,
// bio, languages, links, reason, and footer with ref ID.

const {
  ContainerBuilder,
  SeparatorSpacingSize,
} = require("discord.js");

// Maps VRChat language tags (e.g. "language_deu") to readable names
const LANG_MAP = {
  language_eng: "English",   language_kor: "Korean",    language_rus: "Russian",
  language_spa: "Spanish",   language_por: "Portuguese", language_zho: "Chinese",
  language_deu: "German",    language_jpn: "Japanese",  language_fra: "French",
  language_swe: "Swedish",   language_nld: "Dutch",     language_pol: "Polish",
  language_dan: "Danish",    language_nor: "Norwegian", language_ita: "Italian",
  language_tha: "Thai",      language_fin: "Finnish",   language_hun: "Hungarian",
  language_ces: "Czech",     language_tur: "Turkish",   language_ara: "Arabic",
  language_ron: "Romanian",  language_vie: "Vietnamese", language_ase: "ASL",
  language_bfi: "BSL",       language_dse: "Dutch Sign Language",
  language_fsl: "French Sign Language", language_kvk: "Korean Sign Language",
};

// Truncate a string to max length, adding ellipsis if needed
function trunc(str, max) {
  return str.length > max ? str.slice(0, max - 1) + "\u2026" : str;
}

// Convert VRChat platform string to readable label
function getPlatformLabel(vrcUser) {
  const raw = vrcUser.last_platform ?? vrcUser.lastPlatform ?? "unknown";
  if (raw === "standalonewindows") return "PC";
  if (raw === "android") return "Quest";
  if (raw === "ios") return "iOS";
  return "Unknown";
}

// Extract language names from VRChat user tags
function getLanguages(vrcUser) {
  return (vrcUser.tags ?? [])
    .filter((t) => t.startsWith("language_"))
    .map((t) => LANG_MAP[t] ?? t.replace("language_", "").toUpperCase());
}

/**
 * Build a Components V2 container for a blocklist entry.
 * @param {object} vrcUser  - VRChat user object from the API
 * @param {string} reason   - Reason for blocklisting
 * @param {string} refId    - Reference ID (e.g. "A1B2C3D4")
 * @param {string} category - Category ID (e.g. "CRASHERS")
 * @returns {ContainerBuilder}
 */
function buildBlocklistContainer(vrcUser, reason, refId, category) {
  const displayName = trunc(vrcUser.displayName || "Unknown", 256);
  const pronouns    = vrcUser.pronouns?.trim() || "\u2013";
  const bio         = trunc(vrcUser.bio?.trim() || "No bio available", 950);
  const languages   = getLanguages(vrcUser);
  const langVal     = languages.length ? languages.map((l) => `\u2022 ${l}`).join("\n") : "\u2013";
  const links       = (vrcUser.bioLinks ?? []).filter(Boolean);
  const linksVal    = links.length ? links.join("\n") : "\u2013";
  const platform    = getPlatformLabel(vrcUser);
  const thumbnail   = vrcUser.profilePicOverride || vrcUser.currentAvatarThumbnailImageUrl || null;
  const profileUrl  = `https://vrchat.com/home/user/${vrcUser.id}`;

  const container = new ContainerBuilder().setAccentColor(0xff0000);

  // Header
  container.addTextDisplayComponents(
    (td) => td.setContent(`## [${displayName}](${profileUrl})`),
  );

  container.addSeparatorComponents(
    (sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );

  // Profile section with thumbnail
  if (thumbnail) {
    container.addSectionComponents(
      (section) =>
        section
          .addTextDisplayComponents(
            (td) => td.setContent(
              `**Pronouns**\n${pronouns}\n\n` +
              `**Platform**\n${platform}`
            ),
          )
          .setThumbnailAccessory(
            (thumb) => thumb.setURL(thumbnail).setDescription(displayName),
          ),
    );
  } else {
    container.addTextDisplayComponents(
      (td) => td.setContent(
        `**Pronouns**\n${pronouns}\n\n` +
        `**Platform**\n${platform}`
      ),
    );
  }

  container.addSeparatorComponents(
    (sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );

  // Bio
  container.addTextDisplayComponents(
    (td) => td.setContent(`**Bio**\n> ${bio.split("\n").join("\n> ")}`),
  );

  container.addSeparatorComponents(
    (sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );

  // Languages
  container.addTextDisplayComponents(
    (td) => td.setContent(`**Languages**\n${langVal}`),
  );

  container.addSeparatorComponents(
    (sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );

  // Links
  container.addTextDisplayComponents(
    (td) => td.setContent(`**Links**\n${linksVal}`),
  );

  container.addSeparatorComponents(
    (sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );

  // Reason
  container.addTextDisplayComponents(
    (td) => td.setContent(`**Reason**\n\`\`\`diff\n${trunc(reason, 3800).split("\n").map(l => `- ${l}`).join("\n")}\n\`\`\``),
  );

  container.addSeparatorComponents(
    (sep) => sep.setDivider(false).setSpacing(SeparatorSpacingSize.Large),
  );

  // Footer
  container.addTextDisplayComponents(
    (td) => td.setContent(`-# BLOCKLIST v4 \u2022 REF: ${refId} \u2022 -${category}`),
  );

  return container;
}

module.exports = { buildBlocklistContainer, LANG_MAP, trunc, getPlatformLabel, getLanguages };
