// ============================================================
// db/database.js — SQLite Database Layer  (Production-Ready)
// World Between Us
// ============================================================
// What changed from the skeleton:
//  • Prepared-statement cache  — never re-compile the same SQL twice
//  • Schema migration system   — version-gated ALTER TABLE
//  • password_hash + token_version columns for real JWT auth
//  • player_choices table for real ghost-path queries
//  • source column on ai_usage for analytics
//  • Typed helpers: getOne / getMany / mutate / tx
//  • Graceful shutdown / SIGTERM handling
// ============================================================

"use strict";

const Database = require("better-sqlite3");
const path     = require("path");
const fs       = require("fs");

// ── Config ────────────────────────────────────────────────────
const DB_PATH     = process.env.DB_PATH
                    || path.join(__dirname, "../../data/game.db");
const SCHEMA_VER  = 3;          // bump this when adding a new migration

let db         = null;
const stmtCache = new Map();   // sql string → better-sqlite3 Statement

// ─────────────────────────────────────────────────────────────
// init()  ─ call once at startup
// ─────────────────────────────────────────────────────────────
async function init() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(DB_PATH);

  // Performance pragmas
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous   = NORMAL");
  db.pragma("cache_size    = -16000");  // 16 MB page cache
  db.pragma("temp_store    = MEMORY");

  _createCoreTables();
  _runMigrations();
  _seedDefaultStats();

  // Graceful shutdown
  const close = () => { try { db.close(); } catch {} };
  process.on("exit",    close);
  process.on("SIGINT",  () => { close(); process.exit(0); });
  process.on("SIGTERM", () => { close(); process.exit(0); });

  console.log(`[Database] SQLite ready — schema v${SCHEMA_VER} — ${DB_PATH}`);
}

// ─────────────────────────────────────────────────────────────
// _createCoreTables()  — baseline schema (v1)
// ─────────────────────────────────────────────────────────────
function _createCoreTables() {
  db.exec(`
    -- tracks which migrations have been applied
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── users ───────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT    PRIMARY KEY,
      username      TEXT    UNIQUE,
      email         TEXT    UNIQUE,
      password_hash TEXT,                       -- bcrypt hash; NULL = guest
      token_version INTEGER NOT NULL DEFAULT 0, -- incremented on logout/password change
      guest_mode    INTEGER NOT NULL DEFAULT 1,
      plan          TEXT    NOT NULL DEFAULT 'free'
                              CHECK (plan IN ('free','pro','ultra')),
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      last_active   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ── progress ────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS progress (
      id                TEXT    PRIMARY KEY,
      user_id           TEXT    NOT NULL UNIQUE,
      current_level     INTEGER NOT NULL DEFAULT 1 CHECK (current_level >= 1),
      sanity            REAL    NOT NULL DEFAULT 100
                                  CHECK (sanity >= 0 AND sanity <= 100),
      choices           TEXT    NOT NULL DEFAULT '[]',
      unlocked_endings  TEXT    NOT NULL DEFAULT '[]',
      loop_count        INTEGER NOT NULL DEFAULT 0,
      objects_inspected TEXT    NOT NULL DEFAULT '[]',
      hints_used        INTEGER NOT NULL DEFAULT 0,
      play_time         INTEGER NOT NULL DEFAULT 0,  -- seconds
      updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ── ai_usage ────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS ai_usage (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    TEXT    NOT NULL,
      level_id   INTEGER NOT NULL DEFAULT 1,
      hint_text  TEXT    NOT NULL,
      source     TEXT    NOT NULL DEFAULT 'fallback',  -- 'claude'|'gemini'|'fallback'
      latency_ms INTEGER,                              -- API round-trip time
      used_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ── global_stats (aggregated choice pool) ───────────────
    CREATE TABLE IF NOT EXISTS global_stats (
      level_id   INTEGER NOT NULL,
      choice_id  TEXT    NOT NULL,
      count      INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (level_id, choice_id)
    );

    -- ── subscriptions ───────────────────────────────────────
    CREATE TABLE IF NOT EXISTS subscriptions (
      user_id          TEXT    PRIMARY KEY,
      plan             TEXT    NOT NULL DEFAULT 'free',
      hints_used_today INTEGER NOT NULL DEFAULT 0,
      hints_reset_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ── player_choices (real ghost-path rows) ───────────────
    -- one row per "door open / major decision" event
    CREATE TABLE IF NOT EXISTS player_choices (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     TEXT    NOT NULL,
      level_id    INTEGER NOT NULL,
      choice_id   TEXT    NOT NULL,
      object_seq  TEXT    NOT NULL DEFAULT '[]',  -- JSON array of object ids inspected before choice
      result      TEXT,                            -- ending id if final choice
      recorded_at TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // ── Indexes ─────────────────────────────────────────────────
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_progress_user_id     ON progress(user_id);
    CREATE INDEX IF NOT EXISTS idx_ai_usage_user_id     ON ai_usage(user_id);
    CREATE INDEX IF NOT EXISTS idx_ai_usage_used_at     ON ai_usage(used_at);
    CREATE INDEX IF NOT EXISTS idx_player_choices_level ON player_choices(level_id, recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_users_username       ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_last_active    ON users(last_active DESC);
  `);
}

// ─────────────────────────────────────────────────────────────
// _runMigrations()  — additive-only, version-gated
// ─────────────────────────────────────────────────────────────
function _runMigrations() {
  const applied = new Set(
    db.prepare("SELECT version FROM schema_version").all().map(r => r.version)
  );
  const mark = db.prepare("INSERT OR IGNORE INTO schema_version(version) VALUES (?)");

  const migrations = {
    // v2 — token_version added to pre-existing DBs
    2: () => {
      // SQLite has no IF NOT EXISTS for ADD COLUMN; swallow "duplicate column" error
      try { db.exec(`ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0`); } catch {}
      try { db.exec(`ALTER TABLE users ADD COLUMN password_hash TEXT`); } catch {}
    },
    // v3 — source + latency_ms on ai_usage
    3: () => {
      try { db.exec(`ALTER TABLE ai_usage ADD COLUMN source     TEXT    NOT NULL DEFAULT 'fallback'`); } catch {}
      try { db.exec(`ALTER TABLE ai_usage ADD COLUMN latency_ms INTEGER`); } catch {}
    }
  };

  db.transaction(() => {
    for (let v = 2; v <= SCHEMA_VER; v++) {
      if (!applied.has(v) && migrations[v]) {
        console.log(`[Database] Applying migration v${v}`);
        migrations[v]();
        mark.run(v);
      }
    }
  })();
}

// ─────────────────────────────────────────────────────────────
// _seedDefaultStats()  — idempotent seed for global_stats
// ─────────────────────────────────────────────────────────────
function _seedDefaultStats() {
  const seed = db.prepare(
    `INSERT OR IGNORE INTO global_stats (level_id, choice_id, count) VALUES (?, ?, ?)`
  );
  const defaults = [
    [1, "left_path",  58], [1, "right_path", 42],
    [2, "left_path",  45], [2, "right_path", 55],
    [3, "merge",      38], [3, "reject",     62]
  ];
  db.transaction(() => defaults.forEach(row => seed.run(...row)))();
}

// ─────────────────────────────────────────────────────────────
// Prepared-statement cache
// ─────────────────────────────────────────────────────────────
function _stmt(sql) {
  if (!stmtCache.has(sql)) stmtCache.set(sql, db.prepare(sql));
  return stmtCache.get(sql);
}

// ─────────────────────────────────────────────────────────────
// Public query helpers
// ─────────────────────────────────────────────────────────────

/** Return the first matching row, or undefined */
function getOne(sql, params = []) {
  return _stmt(sql).get(...params);
}

/** Return all matching rows as an array */
function getMany(sql, params = []) {
  return _stmt(sql).all(...params);
}

/**
 * INSERT / UPDATE / DELETE
 * Returns { changes: number, lastInsertRowid: number|bigint }
 */
function mutate(sql, params = []) {
  return _stmt(sql).run(...params);
}

/**
 * Wrap multiple mutate() / getOne() calls in one atomic transaction.
 * fn receives no arguments; use closures to pass data.
 * Returns whatever fn returns.
 */
function tx(fn) {
  return db.transaction(fn)();
}

// ── Legacy aliases so existing route files need zero changes ──
const get         = getOne;
const all         = getMany;
const run         = mutate;
const transaction = tx;

module.exports = {
  init,
  // ── preferred API ──
  getOne,
  getMany,
  mutate,
  tx,
  // ── legacy aliases ──
  get,
  all,
  run,
  transaction,
  getInstance: () => db
};
