// ============================================================
// routes/stats.js — Global Stats + Ghost Data Routes
// World Between Us | Separate Module
// ============================================================

const express = require("express");
const db      = require("../db/database");
const router  = express.Router();

// ── GET /api/global-stats/:levelId — Aggregated choice stats ─
router.get("/global-stats/:levelId", (req, res) => {
  const levelId = parseInt(req.params.levelId, 10);

  try {
    const rows = db.all(
      `SELECT choice_id, count FROM global_stats WHERE level_id = ?`,
      [levelId]
    );

    const total = rows.reduce((sum, r) => sum + r.count, 0);
    const result = { levelId, total, choices: {} };

    rows.forEach(row => {
      result.choices[row.choice_id] = {
        count: row.count,
        percent: total > 0 ? Math.round((row.count / total) * 100) : 0
      };
    });

    // Convenience aliases for Level 1
    if (levelId === 1) {
      result.left_path  = result.choices.left_path?.percent  || 58;
      result.right_path = result.choices.right_path?.percent || 42;
    }

    result.totalPlayers = total;
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: "Could not fetch stats" });
  }
});

// ── POST /api/global-stats/:levelId/submit — Submit a choice ─
router.post("/global-stats/:levelId/submit", (req, res) => {
  const levelId  = parseInt(req.params.levelId, 10);
  const { choice } = req.body;

  if (!choice) return res.status(400).json({ error: "choice required" });

  try {
    // Upsert: increment existing or create new
    const existing = db.get(
      `SELECT count FROM global_stats WHERE level_id = ? AND choice_id = ?`,
      [levelId, choice]
    );

    if (existing) {
      db.run(
        `UPDATE global_stats SET count = count + 1 WHERE level_id = ? AND choice_id = ?`,
        [levelId, choice]
      );
    } else {
      db.run(
        `INSERT INTO global_stats (level_id, choice_id, count) VALUES (?, ?, 1)`,
        [levelId, choice]
      );
    }

    res.json({ submitted: true });
  } catch (e) {
    res.status(500).json({ error: "Could not submit choice" });
  }
});

// ── GET /api/ghosts/:levelId — Ghost player paths ────────────
router.get("/ghosts/:levelId", (req, res) => {
  const levelId = parseInt(req.params.levelId, 10);

  // Simulated ghost data (in production: query real player paths)
  const ghostTemplates = {
    1: [
      { path: ["mirror", "clock", "door"],          result: "trapped",  opacity: 0.18 },
      { path: ["phone", "mirror", "door"],          result: "escaped",  opacity: 0.14 },
      { path: ["photograph", "window", "door"],     result: "trapped",  opacity: 0.12 },
      { path: ["phone", "photograph", "mirror", "door"], result: "escaped", opacity: 0.20 }
    ],
    2: [
      { path: ["morse_light", "door_left"],  result: "past",   opacity: 0.15 },
      { path: ["door_right"],               result: "future", opacity: 0.18 }
    ],
    3: [
      { path: ["the_other"],               result: "merged",  opacity: 0.22 },
      { path: ["the_other"],               result: "rejected", opacity: 0.16 }
    ]
  };

  res.json({
    levelId,
    ghosts: ghostTemplates[levelId] || [],
    message: "These are echoes of other players."
  });
});

// ── GET /api/leaderboard — Top players ───────────────────────
router.get("/leaderboard", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);

  try {
    const rows = db.all(
      `SELECT u.username, p.current_level, p.unlocked_endings, p.play_time
       FROM users u
       JOIN progress p ON u.id = p.user_id
       WHERE u.guest_mode = 0
       ORDER BY p.current_level DESC, p.play_time ASC
       LIMIT ?`,
      [limit]
    );

    res.json({
      entries: rows.map((r, i) => ({
        rank:     i + 1,
        username: r.username || "Unknown",
        level:    r.current_level,
        endings:  JSON.parse(r.unlocked_endings || "[]").length,
        playTime: r.play_time
      }))
    });
  } catch (e) {
    res.status(500).json({ error: "Could not load leaderboard" });
  }
});

// ── POST /api/leaderboard/submit — Submit score ───────────────
router.post("/leaderboard/submit", (req, res) => {
  // Progress is already saved via /progress endpoint
  // This endpoint is a no-op for now, returns success
  res.json({ submitted: true });
});

module.exports = router;
