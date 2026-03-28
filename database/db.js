// ─── Database Connection ───────────────────────────────────────────
// MySQL connection pool using mysql2/promise.
// Auto-creates the database if it doesn't exist on first connect.
// Provides query() for simple queries and transaction() for atomic ops.

const mysql = require("mysql2/promise");
require("dotenv").config();
let pool = null;

// Connect to MySQL — creates DB if missing, then sets up connection pool
async function connect() {
  const temp = await mysql.createConnection({
    host:     process.env.DB_HOST,
    port:     process.env.DB_PORT,
    user:     process.env.DB_USER,
    password: process.env.DB_PASS,
  });
  await temp.query(
    `CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
  );
  await temp.end();
  pool = mysql.createPool({
    host:               process.env.DB_HOST,
    port:               process.env.DB_PORT,
    user:               process.env.DB_USER,
    password:           process.env.DB_PASS,
    database:           process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit:    10,
    queueLimit:         0,
    charset:            "utf8mb4",
  });
  const conn = await pool.getConnection();
  conn.release();
}
// Execute a parameterized SQL query and return rows
async function query(sql, params = []) {
  if (!pool) throw new Error("DB not connected");
  try {
    const [rows] = await pool.execute(sql, params);
    return rows;
  } catch (err) {
    console.error("[DB:Query]", err.message);
    throw err;
  }
}
// Run a function inside a DB transaction (auto-rollback on error)
async function transaction(fn) {
  if (!pool) throw new Error("DB not connected");
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    console.error("[DB:Transaction]", err.message);
    throw err;
  } finally {
    conn.release();
  }
}
module.exports = { connect, query, transaction, getPool: () => pool };