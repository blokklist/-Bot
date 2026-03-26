// ─── VRChat API Client ─────────────────────────────────────────────
// Handles authentication and API requests to the VRChat API.
// Session cookies are persisted to .vrc_session to avoid re-login.
// Supports email OTP for two-factor authentication.
// Auto-reconnects on 401 (expired session).
//
// Requires in .env: VRCHAT_USER, VRCHAT_PASS
// Optional: VRCHAT_EMAIL_OTP (only needed once for 2FA setup)

const https = require("https");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const BASE_URL   = "https://api.vrchat.cloud/api/1";
const USER_AGENT = "BlocklistBot/4.0 (Discord Bot)";
const COOKIE_FILE = path.join(__dirname, "../.vrc_session");

let _cookie = null;

// ─── Cookie persistence ────────────────────────────────────────────

function saveCookie(cookie) {
  fs.writeFileSync(COOKIE_FILE, cookie, "utf8");
}

function loadCookie() {
  if (fs.existsSync(COOKIE_FILE)) {
    return fs.readFileSync(COOKIE_FILE, "utf8").trim();
  }
  return null;
}

function clearCookie() {
  if (fs.existsSync(COOKIE_FILE)) fs.unlinkSync(COOKIE_FILE);
  _cookie = null;
}

// ─── API requests ──────────────────────────────────────────────────

// Generic HTTP request to VRChat API
function request(method, endpoint, body = null, cookie = null, useBasicAuth = false) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + endpoint);
    const headers = { "User-Agent": USER_AGENT, "Content-Type": "application/json" };
    if (cookie) headers["Cookie"] = cookie;
    if (useBasicAuth) {
      const creds = Buffer.from(
        `${encodeURIComponent(process.env.VRCHAT_USER)}:${encodeURIComponent(process.env.VRCHAT_PASS)}`
      ).toString("base64");
      headers["Authorization"] = `Basic ${creds}`;
    }
    const req = https.request(
      { hostname: url.hostname, path: url.pathname + url.search, method, headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) }); }
          catch (e) { reject(new Error(`VRChat API invalid response (${res.statusCode}): ${data.slice(0, 200)}`)); }
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}
// ─── Authentication ────────────────────────────────────────────────

// Verify if a saved session cookie is still valid
async function checkSession(cookie) {
  const res = await request("GET", "/auth/user", null, cookie);
  return res.status === 200 && res.body?.displayName;
}
// Login to VRChat — tries saved session first, falls back to credentials
async function login() {
  const saved = loadCookie();
  if (saved) {
    const valid = await checkSession(saved).catch(err => { console.error("[VRC] Session check failed:", err.message); return false; });
    if (valid) {
      _cookie = saved;
      console.log("[VRC] Session loaded from file");
      return;
    }
    console.log("[VRC] Session expired, logging in again...");
    clearCookie();
  }

  const res = await request("GET", "/auth/user", null, null, true);
  if (res.status === 401) throw new Error("VRChat: Invalid username or password");
  if (res.status !== 200) throw new Error(`VRChat login failed (${res.status})`);

  const setCookie = res.headers["set-cookie"];
  if (!setCookie?.length) throw new Error("VRChat: No cookie received");
  let tempCookie = setCookie.map(c => c.split(";")[0]).join("; ");


  if (res.body.requiresTwoFactorAuth?.includes("emailOtp")) {
    const emailCode = process.env.VRCHAT_EMAIL_OTP;
    if (!emailCode) {
      throw new Error(
        "VRChat sent a code to the bot email!\n" +
        "-> Set the code in .env: VRCHAT_EMAIL_OTP=123456\n" +
        "-> Restart the bot (only needed once!)"
      );
    }

    const otpRes = await request("POST", "/auth/twofactorauth/emailotp/verify", { code: emailCode }, tempCookie);
    if (!otpRes.body.verified) throw new Error("VRChat email OTP incorrect or expired");

    const otpCookie = otpRes.headers["set-cookie"];
    tempCookie = [...setCookie, ...(otpCookie ?? [])].map(c => c.split(";")[0]).join("; ");
    console.log("[VRC] Email OTP verified");
  }

  _cookie = tempCookie;
  saveCookie(_cookie);
  console.log(`[VRC] Logged in as: ${res.body.displayName}`);
}

// ─── Public API methods ────────────────────────────────────────────

// Get authenticated cookie (auto-login if needed)
async function getAuth() {
  if (!_cookie) await login();
  return _cookie;
}

// Fetch a VRChat user by their usr_ ID (auto-reconnects on 401)
async function getUserById(userId) {
  const cookie = await getAuth();
  const res = await request("GET", `/users/${userId}`, null, cookie);
  if (res.status === 401) { clearCookie(); return getUserById(userId); }
  if (res.status !== 200) return null;
  return res.body;
}

// Search for a VRChat user by display name
async function searchUser(username) {
  const cookie = await getAuth();
  const res = await request("GET", `/users?search=${encodeURIComponent(username)}&n=1`, null, cookie);
  if (res.status === 401) { clearCookie(); return searchUser(username); }
  if (!Array.isArray(res.body) || res.body.length === 0) return null;
  return res.body[0];
}

// Get the currently logged-in bot account info
async function getCurrentUser() {
  const cookie = await getAuth();
  const res = await request("GET", "/auth/user", null, cookie);
  if (res.status === 401) { clearCookie(); return getCurrentUser(); }
  if (res.status !== 200) return null;
  return res.body;
}

module.exports = { login, getUserById, searchUser, getCurrentUser };
