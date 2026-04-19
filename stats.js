// ============================================================
// routes/stats.js — Global Stats + Ghost Data  (Production)
// World Between Us
// ============================================================
// What changed from the skeleton:
//  • POST submit — atomic INSERT + UPDATE in one transaction so
//    the count can never go out of sync with the player_choices log
//  • Duplicate-vote guard — one vote per user per level per session
//    (uses player_choices table; allows re-vote after 30 minutes)
//  • GET global-stats — percentage computed server-side with
//    integer rounding that always sums to 100
//  • GET ghosts — real data from player_choices (last 100 rows),
//    not hardcoded templates; templates used only as seed/fallback
//  • GET leaderboard — includes endings count + formatted play time
// ============================================================

"use strict";

const express = require("express");
const db      = require("../db/database");
const { optionalAuth } = require("../middleware/auth");

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// GET /api/global-stats/:levelId
// ─────────────────────────────────────────────────────────────
router.get("/global-stats/:levelId", (req, res) => {
  const levelId = _parseLevel(req.params.levelId);
  if (!levelId) return res.status(400).json({ error: "Invalid level ID" });

  try {
    const rows = db.getMany(
      `SELECT choice_id, count FROM global_stats WHERE level_id = ? ORDER BY count DESC`,
      [levelId]
    );

    if (rows.length === 0) {
      return res.json({ levelId, total: 0, choices: {}, totalPlayers: 0 });
    }

    const total = rows.reduce((s, r) => s + r.count, 0);

    // Build percentage map; ensure values sum to exactly 100
    const choices = {};
    let assigned  = 0;
    rows.forEach((row, i) => {
      const pct = i < rows.length - 1
        ? Math.round((row.count / total) * 100)
        : 100 - assigned;            // last bucket absorbs rounding error
      choices[row.choice_id] = { count: row.count, percent: pct };
      assigned += pct;
    });

    // Convenience aliases kept for backwards-compat with apiBridge.js
    const result = {
      levelId,
      total,
      totalPlayers: total,
      choices,
      left_path:  choices.left_path?.percent  ?? null,
      right_path: choices.right_path?.percent ?? null,
      merge:      choices.merge?.percent      ?? null,
      reject:     choices.reject?.percent     ?? null
    };

    res.json(result);
  } catch (e) {
    console.error("[Stats] GET global-stats error:", e.message);
    res.status(500).json({ error: "Could not fetch stats" });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/global-stats/:levelId/submit
// Body: { userId, choice, objectSeq?, result? }
// ─────────────────────────────────────────────────────────────
router.post("/global-stats/:levelId/submit", optionalAuth, (req, res) => {
  const levelId = _parseLevel(req.params.levelId);
  if (!levelId) return res.status(400).json({ error: "Invalid level ID" });

  const { userId, choice, objectSeq = [], result = null } = req.body;

  if (!choice || typeof choice !== "string" || choice.length > 64) {
    return res.status(400).json({ error: "choice required (max 64 chars)" });
  }

  // ── Duplicate-vote guard ─────────────────────────────────
  // Allow re-vote after 30 minutes so loops are counted correctly,
  // but prevent accidental double-submission in the same session.
  if (userId) {
    const recent = db.getOne(
      `SELECT id FROM player_choices
       WHERE user_id  = ?
         AND level_id = ?
         AND choice_id = ?
         AND recorded_at > datetime('now', '-30 minutes')`,
      [userId, levelId, choice]
    );
    if (recent) {
      // Silently succeed — idempotent from the client's perspective
      return res.json({ submitted: true, duplicate: true });
    }
  }

  try {
    db.tx(() => {
      // 1. Upsert aggregate counter
      db.mutate(
        `INSERT INTO global_stats (level_id, choice_id, count)
         VALUES (?, ?, 1)
         ON CONFLICT(level_id, choice_id)
         DO UPDATE SET count = count + 1`,
        [levelId, choice]
      );

      // 2. Log individual choice (enables real ghost paths)
      if (userId) {
        db.mutate(
          `INSERT INTO player_choices (user_id, level_id, choice_id, object_seq, result)
           VALUES (?, ?, ?, ?, ?)`,
          [userId, levelId, choice, JSON.stringify(objectSeq), result]
        );
      }
    });

    res.json({ submitted: true, duplicate: false });
  } catch (e) {
    console.error("[Stats] submit error:", e.message);
    res.status(500).json({ error: "Could not submit choice" });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/ghosts/:levelId
// Returns up to 5 recent real player paths (anonymised),
// with hardcoded fallback when the table is still sparse.
// ─────────────────────────────────────────────────────────────
router.get("/ghosts/:levelId", (req, res) => {
  const levelId = _parseLevel(req.params.levelId);
  if (!levelId) return res.status(400).json({ error: "Invalid level ID" });

  try {
    // Pull the 100 most-recent choices, then pick 5 at random to keep
    // the response varied across page loads.
    const rows = db.getMany(
      `SELECT object_seq, choice_id, result
       FROM player_choices
       WHERE level_id = ?
       ORDER BY recorded_at DESC
       LIMIT 100`,
      [levelId]
    );

    let ghosts;
    if (rows.length >= 3) {
      // Sample up to 5 rows (shuffle via sort + slice)
      ghosts = rows
        .sort(() => Math.random() - 0.5)
        .slice(0, 5)
        .map((r, i) => ({
          path:    _parseJSON(r.object_seq, []),
          result:  r.result || r.choice_id,
          opacity: parseFloat((0.12 + i * 0.02).toFixed(2))
        }));
    } else {
      // Not enough real data yet — serve seeded templates
      ghosts = _ghostFallback(levelId);
    }

    res.json({
      levelId,
      ghosts,
      source:  rows.length >= 3 ? "live" : "seeded",
      message: "These are echoes of other players."
    });
  } catch (e) {
    console.error("[Stats] ghosts error:", e.message);
    res.json({ levelId, ghosts: _ghostFallback(levelId), source: "seeded" });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/leaderboard
// ─────────────────────────────────────────────────────────────
router.get("/leaderboard", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);

  try {
    const rows = db.getMany(
      `SELECT u.username,
              p.current_level,
              p.unlocked_endings,
              p.play_time,
              p.loop_count
       FROM users u
       JOIN progress p ON u.id = p.user_id
       WHERE u.guest_mode = 0
       ORDER BY p.current_level DESC, p.loop_count ASC, p.play_time ASC
       LIMIT ?`,
      [limit]
    );

    res.json({
      entries: rows.map((r, i) => ({
        rank:         i + 1,
        username:     r.username || "Unknown",
        level:        r.current_level,
        endingsCount: _parseJSON(r.unlocked_endings, []).length,
        loopCount:    r.loop_count,
        playTime:     _formatPlayTime(r.play_time)
      }))
    });
  } catch (e) {
    console.error("[Stats] leaderboard error:", e.message);
    res.status(500).json({ error: "Could not load leaderboard" });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/leaderboard/submit  (no-op — progress route handles it)
// ─────────────────────────────────────────────────────────────
router.post("/leaderboard/submit", (req, res) => res.json({ submitted: true }));

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function _parseLevel(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 && n <= 100 ? n : null;
}

function _parseJSON(raw, fallback) {
  try { return JSON.parse(raw || "null") ?? fallback; }
  catch { return fallback; }
}

function _formatPlayTime(seconds) {
  if (!seconds) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Seeded ghost templates used before enough real data accumulates
function _ghostFallback(levelId) {
  const t = {
    1: [
      { path: ["mirror", "clock", "door"],               result: "trapped",  opacity: 0.18 },
      { path: ["phone", "mirror", "door"],               result: "escaped",  opacity: 0.14 },
      { path: ["photograph", "window", "door"],          result: "trapped",  opacity: 0.12 },
      { path: ["phone", "photograph", "mirror", "door"], result: "escaped",  opacity: 0.20 }
    ],
    2: [
      { path: ["morse_light", "door_left"],  result: "past",   opacity: 0.15 },
      { path: ["door_right"],               result: "future", opacity: 0.18 }
    ],
    3: [
      { path: ["the_other"], result: "merged",   opacity: 0.22 },
      { path: ["the_other"], result: "rejected", opacity: 0.16 }
    ]
  };
  return t[levelId] || [];
}

module.exports = router;
