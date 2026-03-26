// ─── DeepL API Helper ──────────────────────────────────────────────
// Handles translation and usage tracking via the DeepL Free API.
// All reasons submitted through /paste are auto-translated to English.
// Usage is capped at 480k characters to stay within the 500k free limit.
// Requires DEEPL_API_KEY in .env

const https = require("https");
require("dotenv").config();

const API_KEY = process.env.DEEPL_API_KEY;
// Free API uses api-free.deepl.com, Pro uses api.deepl.com
const API_HOST = "api-free.deepl.com";

// Low-level POST request to DeepL API (form-encoded)
function request(endpoint, params = {}) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const req = https.request(
      {
        hostname: API_HOST,
        path: `/v2${endpoint}`,
        method: "POST",
        headers: {
          "Authorization": `DeepL-Auth-Key ${API_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            reject(new Error(`DeepL API invalid response (${res.statusCode}): ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Translate text to English. Returns the translated text.
 * DeepL auto-detects the source language.
 * If the text is already English, DeepL returns it unchanged.
 */
async function translateToEnglish(text) {
  if (!API_KEY) {
    console.warn("[DeepL] No API key configured, skipping translation");
    return { text, detected: null };
  }

  const res = await request("/translate", {
    text,
    target_lang: "EN",
  });

  if (res.status !== 200) {
    throw new Error(`DeepL translation failed (${res.status}): ${JSON.stringify(res.body)}`);
  }

  const translation = res.body.translations?.[0];
  if (!translation) {
    throw new Error("DeepL returned no translation");
  }

  return {
    text: translation.text,
    detected: translation.detected_source_language,
  };
}

/**
 * Get current API usage stats.
 * Returns { character_count, character_limit }
 */
async function getUsage() {
  if (!API_KEY) {
    throw new Error("No DeepL API key configured");
  }

  const res = await request("/usage", {});

  if (res.status !== 200) {
    throw new Error(`DeepL usage check failed (${res.status})`);
  }

  return {
    used: res.body.character_count ?? 0,
    limit: res.body.character_limit ?? 500000,
  };
}

module.exports = { translateToEnglish, getUsage };
