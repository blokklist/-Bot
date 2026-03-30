// ─── Database Migrations ───────────────────────────────────────────
// Sequential schema migrations tracked in a _migrations table.
// Each migration runs once and is recorded. Safe to re-run on startup.
// All migrations use IF NOT EXISTS / SHOW COLUMNS checks to be idempotent.
//
// Migration history:
// 001 — paste_log + pastes tables
// 002 — tdr_requests + tdr_log + tdr_votes tables
// 003 — rules_accepted table
// 004 — add missing columns (ref_id, channel_id, reason, etc.)
// 005 — drop unused paste columns (bio, links, avatar_url, etc.)
// 006 — anonymize: remove sequential IDs, use random/composite PKs
// 007 — add reason column to pastes (for self-healing sync)
// 008 — add created_at column to pastes (original post date in footer)
// 009 — feedbacks + feedback_log tables

const db = require("./db");

const migrations = [
  {
    name: "001_create_paste_tables",
    async up(pool) {
      await db.query(`
        CREATE TABLE IF NOT EXISTS paste_log (
          id         INT AUTO_INCREMENT PRIMARY KEY,
          user_hash  VARCHAR(64) NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) CHARACTER SET utf8mb4;
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS pastes (
          id          INT AUTO_INCREMENT PRIMARY KEY,
          ref_id      VARCHAR(10)  NOT NULL DEFAULT '',
          vrc_id      VARCHAR(60)  NOT NULL,
          vrc_name    VARCHAR(100) NOT NULL,
          category    VARCHAR(50),
          message_id  VARCHAR(30)  NOT NULL,
          channel_id  VARCHAR(30)  NOT NULL,
          added_at    DATETIME DEFAULT CURRENT_TIMESTAMP
        ) CHARACTER SET utf8mb4;
      `);
    },
  },
  {
    name: "002_create_tdr_tables",
    async up(pool) {
      await db.query(`
        CREATE TABLE IF NOT EXISTS tdr_requests (
          id              INT AUTO_INCREMENT PRIMARY KEY,
          ref_id          VARCHAR(10)  NOT NULL,
          filed_by_hash   VARCHAR(64)  NOT NULL,
          filed_at        DATETIME     DEFAULT CURRENT_TIMESTAMP,
          announcement_id VARCHAR(30)  DEFAULT NULL,
          channel_id      VARCHAR(30)  DEFAULT NULL,
          reason          TEXT         DEFAULT NULL,
          status          ENUM('voting','removed','rejected','expired') DEFAULT 'voting',
          cooldown_until  DATETIME     DEFAULT NULL
        ) CHARACTER SET utf8mb4;
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS tdr_log (
          id         INT AUTO_INCREMENT PRIMARY KEY,
          user_hash  VARCHAR(64) NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) CHARACTER SET utf8mb4;
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS tdr_votes (
          id         INT AUTO_INCREMENT PRIMARY KEY,
          tdr_id     INT         NOT NULL,
          voter_hash VARCHAR(64) NOT NULL,
          vote       ENUM('up','down') NOT NULL,
          voted_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_vote (tdr_id, voter_hash)
        ) CHARACTER SET utf8mb4;
      `);
    },
  },
  {
    name: "003_create_rules_table",
    async up(pool) {
      await db.query(`
        CREATE TABLE IF NOT EXISTS rules_accepted (
          id          INT AUTO_INCREMENT PRIMARY KEY,
          user_hash   VARCHAR(64) NOT NULL UNIQUE,
          accepted_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) CHARACTER SET utf8mb4;
      `);
    },
  },
  {
    name: "004_add_missing_columns",
    async up(pool) {
      const addColumnIfMissing = async (table, column, definition) => {
        const cols = await db.query(`SHOW COLUMNS FROM ${table}`);
        if (!cols.some(c => c.Field === column)) {
          await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        }
      };

      await addColumnIfMissing("pastes", "ref_id", "VARCHAR(10) NOT NULL DEFAULT ''");
      await addColumnIfMissing("pastes", "message_id", "VARCHAR(30) NOT NULL DEFAULT ''");
      await addColumnIfMissing("pastes", "channel_id", "VARCHAR(30) NOT NULL DEFAULT ''");
      await addColumnIfMissing("tdr_requests", "channel_id", "VARCHAR(30) DEFAULT NULL");
      await addColumnIfMissing("tdr_requests", "reason", "TEXT DEFAULT NULL");

      // Rename tdr_log.filed_at -> created_at if needed
      const tdrLogCols = await db.query("SHOW COLUMNS FROM tdr_log");
      const colNames = tdrLogCols.map(c => c.Field);
      if (colNames.includes("filed_at") && !colNames.includes("created_at")) {
        await db.query("ALTER TABLE tdr_log CHANGE filed_at created_at DATETIME DEFAULT CURRENT_TIMESTAMP");
      }
    },
  },
  {
    name: "005_drop_unused_paste_columns",
    async up(pool) {
      const cols = await db.query("SHOW COLUMNS FROM pastes");
      const colNames = cols.map(c => c.Field);
      for (const col of ["reason", "languages", "links", "bio", "avatar_url"]) {
        if (colNames.includes(col)) {
          await db.query(`ALTER TABLE pastes DROP COLUMN ${col}`);
        }
      }
    },
  },
  {
    name: "006_anonymize_remove_sequential_ids",
    async up(pool) {
      // --- pastes: ref_id becomes PRIMARY KEY, drop id + added_at ---
      const pastesCols = await db.query("SHOW COLUMNS FROM pastes");
      const pastesColNames = pastesCols.map(c => c.Field);
      if (pastesColNames.includes("id")) {
        // Fill empty ref_ids with random values before making ref_id the PK
        const { randomUUID } = require("crypto");
        const emptyRefs = await db.query("SELECT id FROM pastes WHERE ref_id = '' OR ref_id IS NULL");
        for (const row of emptyRefs) {
          const newRef = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
          await db.query("UPDATE pastes SET ref_id = ? WHERE id = ?", [newRef, row.id]);
        }
        await db.query("ALTER TABLE pastes DROP PRIMARY KEY, DROP COLUMN id");
        await db.query("ALTER TABLE pastes ADD PRIMARY KEY (ref_id)");
      }
      if (pastesColNames.includes("added_at")) {
        await db.query("ALTER TABLE pastes DROP COLUMN added_at");
      }

      // --- paste_log: drop id, no sequential ordering ---
      const plCols = await db.query("SHOW COLUMNS FROM paste_log");
      if (plCols.some(c => c.Field === "id")) {
        await db.query("ALTER TABLE paste_log DROP PRIMARY KEY, DROP COLUMN id");
      }

      // --- tdr_requests: replace auto-increment with random id ---
      const tdrCols = await db.query("SHOW COLUMNS FROM tdr_requests");
      const tdrIdCol = tdrCols.find(c => c.Field === "id");
      if (tdrIdCol && tdrIdCol.Extra.includes("auto_increment")) {
        await db.query("ALTER TABLE tdr_requests MODIFY id INT NOT NULL");
      }

      // --- tdr_log: drop id ---
      const tlCols = await db.query("SHOW COLUMNS FROM tdr_log");
      if (tlCols.some(c => c.Field === "id")) {
        await db.query("ALTER TABLE tdr_log DROP PRIMARY KEY, DROP COLUMN id");
      }

      // --- tdr_votes: drop id, use composite PK ---
      const tvCols = await db.query("SHOW COLUMNS FROM tdr_votes");
      if (tvCols.some(c => c.Field === "id")) {
        await db.query("ALTER TABLE tdr_votes DROP PRIMARY KEY, DROP COLUMN id");
        // unique_vote already exists, promote it to PRIMARY KEY
        await db.query("ALTER TABLE tdr_votes DROP INDEX unique_vote");
        await db.query("ALTER TABLE tdr_votes ADD PRIMARY KEY (tdr_id, voter_hash)");
      }

      // --- rules_accepted: drop id, user_hash becomes PK ---
      const raCols = await db.query("SHOW COLUMNS FROM rules_accepted");
      if (raCols.some(c => c.Field === "id")) {
        await db.query("ALTER TABLE rules_accepted DROP PRIMARY KEY, DROP COLUMN id");
        await db.query("ALTER TABLE rules_accepted DROP INDEX user_hash");
        await db.query("ALTER TABLE rules_accepted ADD PRIMARY KEY (user_hash)");
      }

      // --- tdr_votes: drop voted_at (not needed, reveals timing) ---
      const tvCols2 = await db.query("SHOW COLUMNS FROM tdr_votes");
      if (tvCols2.some(c => c.Field === "voted_at")) {
        await db.query("ALTER TABLE tdr_votes DROP COLUMN voted_at");
      }

      // --- rules_accepted: drop accepted_at (not needed) ---
      const raCols2 = await db.query("SHOW COLUMNS FROM rules_accepted");
      if (raCols2.some(c => c.Field === "accepted_at")) {
        await db.query("ALTER TABLE rules_accepted DROP COLUMN accepted_at");
      }
    },
  },
  {
    name: "007_add_reason_to_pastes",
    async up() {
      const cols = await db.query("SHOW COLUMNS FROM pastes");
      if (!cols.some(c => c.Field === "reason")) {
        await db.query("ALTER TABLE pastes ADD COLUMN reason TEXT DEFAULT NULL");
      }
    },
  },
  {
    name: "008_add_created_at_to_pastes",
    async up() {
      const cols = await db.query("SHOW COLUMNS FROM pastes");
      if (!cols.some(c => c.Field === "created_at")) {
        await db.query("ALTER TABLE pastes ADD COLUMN created_at DATE DEFAULT NULL");
      }
    },
  },
  {
    name: "009_create_feedback_table",
    async up() {
      await db.query(`
        CREATE TABLE IF NOT EXISTS feedbacks (
          id           INT NOT NULL PRIMARY KEY,
          user_hash    VARCHAR(64)  NOT NULL,
          type         ENUM('feedback','feature','bug') NOT NULL DEFAULT 'feedback',
          title        VARCHAR(200) NOT NULL,
          description  TEXT         NOT NULL,
          message_id   VARCHAR(30)  DEFAULT NULL,
          channel_id   VARCHAR(30)  DEFAULT NULL,
          status       ENUM('open','answered','closed') DEFAULT 'open',
          answer       TEXT         DEFAULT NULL,
          created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP
        ) CHARACTER SET utf8mb4;
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS feedback_log (
          user_hash  VARCHAR(64) NOT NULL,
          created_at DATETIME    DEFAULT CURRENT_TIMESTAMP
        ) CHARACTER SET utf8mb4;
      `);
    },
  },
];

async function runMigrations() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id       INT AUTO_INCREMENT PRIMARY KEY,
      name     VARCHAR(255) NOT NULL UNIQUE,
      ran_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4;
  `);

  const ran = await db.query("SELECT name FROM _migrations");
  const ranNames = new Set(ran.map(r => r.name));
  const pool = db.getPool();

  for (const migration of migrations) {
    if (ranNames.has(migration.name)) continue;
    console.log(`[Migrations] Running: ${migration.name}`);
    await migration.up(pool);
    await db.query("INSERT INTO _migrations (name) VALUES (?)", [migration.name]);
    console.log(`[Migrations] Completed: ${migration.name}`);
  }
}

module.exports = { runMigrations };
