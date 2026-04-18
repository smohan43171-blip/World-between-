// ============================================================
// routes/progress.js — Player Progress Save/Load Routes
// World Between Us | Separate Module
// ============================================================

const express = require("express");
const crypto  = require("crypto");
const db      = require("../db/database");
const router  = express.Router();

// ── GET /api/progress/:userId — Load progress ─────────────────
router.get("/:userId", (req, res) => {
  try {
    const row = db.get(
      `SELECT * FROM progress WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1`,
      [req.params.userId]
    );

    if (!row) return res.status(404).json({ error: "No progress found" });

    res.json({
      userId:           row.user_id,
      currentLevel:     row.current_level,
      sanity:           row.sanity,
      choices:          JSON.parse(row.choices || "[]"),
      unlockedEndings:  JSON.parse(row.unlocked_endings || "[]"),
      loopCount:        row.loop_count,
      objectsInspected: JSON.parse(row.objects_inspected || "[]"),
      hintsUsed:        row.hints_used,
      playTime:         row.play_time,
      updatedAt:        row.updated_at
    });
  } catch (e) {
    console.error("[Progress] Load error:", e.message);
    res.status(500).json({ error: "Could not load progress" });
  }
});

// ── POST /api/progress/:userId — Save progress ────────────────
router.post("/:userId", (req, res) => {
  const { userId } = req.params;
  const {
    currentLevel     = 1,
    sanity           = 100,
    choices          = [],
    unlockedEndings  = [],
    loopCount        = 0,
    objectsInspected = [],
    hintsUsed        = 0,
    playTime         = 0
  } = req.body;

  // Basic validation
  if (typeof currentLevel !== "number" || currentLevel < 1) {
    return res.status(400).json({ error: "Invalid level" });
  }
  if (typeof sanity !== "number" || sanity < 0 || sanity > 100) {
    return res.status(400).json({ error: "Invalid sanity value" });
  }

  try {
    const existing = db.get(`SELECT id FROM progress WHERE user_id = ?`, [userId]);

    if (existing) {
      db.run(
        `UPDATE progress SET
          current_level = ?, sanity = ?, choices = ?, unlocked_endings = ?,
          loop_count = ?, objects_inspected = ?, hints_used = ?,
          play_time = ?, updated_at = datetime('now')
         WHERE user_id = ?`,
        [
          currentLevel,
          sanity,
          JSON.stringify(choices),
          JSON.stringify(unlockedEndings),
          loopCount,
          JSON.stringify(objectsInspected),
          hintsUsed,
          playTime,
          userId
        ]
      );
    } else {
      db.run(
        `INSERT INTO progress
          (id, user_id, current_level, sanity, choices, unlocked_endings,
           loop_count, objects_inspected, hints_used, play_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `prog_${crypto.randomBytes(6).toString("hex")}`,
          userId,
          currentLevel,
          sanity,
          JSON.stringify(choices),
          JSON.stringify(unlockedEndings),
          loopCount,
          JSON.stringify(objectsInspected),
          hintsUsed,
          playTime
        ]
      );
    }

    res.json({ saved: true, timestamp: new Date().toISOString() });
  } catch (e) {
    console.error("[Progress] Save error:", e.message);
    res.status(500).json({ error: "Could not save progress" });
  }
});

// ── DELETE /api/progress/:userId — Reset progress ─────────────
router.delete("/:userId", (req, res) => {
  try {
    db.run(`DELETE FROM progress WHERE user_id = ?`, [req.params.userId]);
    res.json({ reset: true });
  } catch (e) {
    res.status(500).json({ error: "Could not reset progress" });
  }
});

module.exports = router;
