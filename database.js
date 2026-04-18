// ============================================================
// db/database.js — SQLite Database Layer
// World Between Us | Separate Module
// ============================================================

const Database = require("better-sqlite3");
const path     = require("path");
const fs       = require("fs");

const DB_PATH = path.join(__dirname, "../../data/game.db");
let db = null;

// ── Initialize DB and create tables ──────────────────────────
async function init() {
  // Ensure data directory exists
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  createTables();
  console.log("[Database] SQLite initialized at", DB_PATH);
}

function createTables() {
  // ── Users table ───────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      username    TEXT UNIQUE,
      email       TEXT UNIQUE,
      guest_mode  INTEGER DEFAULT 1,
      plan        TEXT DEFAULT 'free',
      created_at  TEXT DEFAULT (datetime('now')),
      last_active TEXT DEFAULT (datetime('now'))
    );
  `);

  // ── Progress table ────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS progress (
      id                TEXT PRIMARY KEY,
      user_id           TEXT NOT NULL,
      current_level     INTEGER DEFAULT 1,
      sanity            REAL DEFAULT 100,
      choices           TEXT DEFAULT '[]',
      unlocked_endings  TEXT DEFAULT '[]',
      loop_count        INTEGER DEFAULT 0,
      objects_inspected TEXT DEFAULT '[]',
      hints_used        INTEGER DEFAULT 0,
      play_time         INTEGER DEFAULT 0,
      updated_at        TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // ── AI usage log ──────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_usage (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    TEXT NOT NULL,
      level_id   INTEGER,
      hint_text  TEXT,
      used_at    TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // ── Global stats (choice aggregation) ────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS global_stats (
      level_id    INTEGER,
      choice_id   TEXT,
      count       INTEGER DEFAULT 0,
      PRIMARY KEY (level_id, choice_id)
    );
  `);

  // ── Subscription table ────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      user_id         TEXT PRIMARY KEY,
      plan            TEXT DEFAULT 'free',
      hints_used_today INTEGER DEFAULT 0,
      hints_reset_at  TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // ── Insert default global stats ───────────────────────────
  const seedStats = db.prepare(`
    INSERT OR IGNORE INTO global_stats (level_id, choice_id, count) VALUES (?, ?, ?)
  `);
  [[1, "left_path", 58], [1, "right_path", 42], [2, "left_path", 45], [2, "right_path", 55],
   [3, "merge", 38], [3, "reject", 62]].forEach(row => seedStats.run(...row));
}

// ── Generic query helpers ─────────────────────────────────────

function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}

function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

function transaction(fn) {
  return db.transaction(fn)();
}

// ── Exported DB interface ─────────────────────────────────────
module.exports = {
  init,
  get,
  all,
  run,
  transaction,
  getInstance: () => db
};
