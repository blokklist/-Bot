// ─── /edit Command ─────────────────────────────────────────────────
// Owner-only command to update VRChat bot account credentials.
// Opens a modal to enter new username, password, and optional OTP.
// Writes directly to .env and clears the VRChat session file.

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require("discord.js");
const fs   = require("fs");
const path = require("path");

// ─── .env file read/write helpers ──────────────────────────────────

function getEnvPath() {
  return path.join(process.cwd(), ".env");
}

function readEnv() {
  const envPath = getEnvPath();
  if (!fs.existsSync(envPath)) return {};
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  const map = {};
  for (const line of lines) {
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    map[key] = val;
  }
  return map;
}

function writeEnv(map) {
  const content = Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  fs.writeFileSync(getEnvPath(), content + "\n", "utf8");
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("edit")
    .setDescription("Update the VRChat account credentials")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (interaction.user.id !== interaction.guild.ownerId) {
      return interaction.reply({ content: "❌ Only the server owner can use this command.", ephemeral: true });
    }

    const modal = new ModalBuilder()
      .setCustomId("edit_vrchat_modal")
      .setTitle("Update VRChat Account");

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("vrchat_user")
          .setLabel("VRChat Username")
          .setStyle(TextInputStyle.Short)
          .setValue(process.env.VRCHAT_USER ?? "")
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("vrchat_pass")
          .setLabel("VRChat Password")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Enter new password")
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("vrchat_otp")
          .setLabel("Email OTP (leave blank if not needed)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("123456")
          .setRequired(false)
      )
    );

    return interaction.showModal(modal);
  },

  async handleModal(interaction) {
    if (interaction.customId !== "edit_vrchat_modal") return;

    const user = interaction.fields.getTextInputValue("vrchat_user").trim();
    const pass = interaction.fields.getTextInputValue("vrchat_pass").trim();
    const otp  = interaction.fields.getTextInputValue("vrchat_otp").trim();

    try {
      const env = readEnv();
      env["VRCHAT_USER"] = user;
      env["VRCHAT_PASS"] = pass;
      if (otp) env["VRCHAT_EMAIL_OTP"] = otp;
      else delete env["VRCHAT_EMAIL_OTP"];
      writeEnv(env);
    } catch (err) {
      console.error("[Edit] Failed to write .env file:", err.message);
      return interaction.reply({ content: "❌ Failed to update .env file.", ephemeral: true });
    }

    process.env.VRCHAT_USER = user;
    process.env.VRCHAT_PASS = pass;
    if (otp) process.env.VRCHAT_EMAIL_OTP = otp;
    else delete process.env.VRCHAT_EMAIL_OTP;
    const sessionFile = path.join(process.cwd(), ".vrc_session");
    try {
      if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
    } catch (err) {
      console.error("[Edit] Failed to delete session file:", err.message);
    }

    return interaction.reply({
      content: `✅ VRChat credentials updated.\n> Username: \`${user}\`\n> Password: updated\n${otp ? "> OTP: set ✅\n" : ""}\nThe bot will log in with the new account on the next request.`,
      ephemeral: true,
    });
  },
};