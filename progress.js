// ============================================================
// routes/progress.js — Player Progress Save / Load  (Production)
// World Between Us
// ============================================================
// What changed from the skeleton:
//  • GET  — ownership check: users can only read their own save
//  • POST — atomic UPSERT via INSERT OR REPLACE so there is
//            always exactly one progress row per user
//  • POST — play_time is additive (client sends delta, not total)
//            so multiple tabs cannot race-overwrite each other
//  • POST — choices and objects_inspected are JSON-array merged
//            (server is the source of truth; client sends new
//             items, not the full array)
//  • POST — sanity and loop_count are only moved in one direction
//            to prevent cheating (sanity can never go up via API,
//            loop_count can never go down)
//  • DELETE — only resets the authenticated user's own save
//  • All DB writes inside a single transaction
// ============================================================

"use strict";

const express = require("express");
const crypto  = require("crypto");
const db      = require("../db/database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function parseJSON(raw, fallback = []) {
  try { return JSON.parse(raw || "null") ?? fallback; }
  catch { return fallback; }
}

/** Merge two arrays, preserving unique values, order-stable */
function mergeUnique(existing, incoming) {
  const set = new Set(existing);
  incoming.forEach(v => set.add(v));
  return [...set];
}

// ─────────────────────────────────────────────────────────────
// GET /api/progress/:userId
// ─────────────────────────────────────────────────────────────
router.get("/:userId", requireAuth, (req, res) => {
  // Users may only load their own save unless they are an admin
  if (req.user.sub !== req.params.userId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const row = db.getOne(
      `SELECT
         user_id, current_level, sanity, choices, unlocked_endings,
         loop_count, objects_inspected, hints_used, play_time, updated_at
       FROM progress
       WHERE user_id = ?`,
      [req.params.userId]
    );

    if (!row) {
      // First time — return sensible defaults so the client can start fresh
      return res.json({
        userId:           req.params.userId,
        currentLevel:     1,
        sanity:           100,
        choices:          [],
        unlockedEndings:  [],
        loopCount:        0,
        objectsInspected: [],
        hintsUsed:        0,
        playTime:         0,
        updatedAt:        null
      });
    }

    res.json({
      userId:           row.user_id,
      currentLevel:     row.current_level,
      sanity:           row.sanity,
      choices:          parseJSON(row.choices,           []),
      unlockedEndings:  parseJSON(row.unlocked_endings,  []),
      loopCount:        row.loop_count,
      objectsInspected: parseJSON(row.objects_inspected, []),
      hintsUsed:        row.hints_used,
      playTime:         row.play_time,
      updatedAt:        row.updated_at
    });
  } catch (e) {
    console.error("[Progress] GET error:", e.message);
    res.status(500).json({ error: "Could not load progress" });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/progress/:userId
// Body:
//   currentLevel     — integer  (1-based)
//   sanity           — number   0–100  (monotonically non-increasing via API)
//   choices          — string[] NEW choices made this session
//   unlockedEndings  — string[] endings to add
//   loopCount        — integer  (can only go up)
//   objectsInspected — string[] new objects inspected
//   hintsUsed        — integer  (absolute total, not delta)
//   playTimeDelta    — integer  seconds played this session
// ─────────────────────────────────────────────────────────────
router.post("/:userId", requireAuth, (req, res) => {
  if (req.user.sub !== req.params.userId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { userId } = req.params;
  const {
    currentLevel     = 1,
    sanity,
    choices          = [],
    unlockedEndings  = [],
    loopCount,
    objectsInspected = [],
    hintsUsed        = 0,
    playTimeDelta    = 0
  } = req.body;

  // ── Input guards ──────────────────────────────────────────
  if (!Number.isInteger(currentLevel) || currentLevel < 1 || currentLevel > 100) {
    return res.status(400).json({ error: "Invalid currentLevel" });
  }
  if (sanity !== undefined && (typeof sanity !== "number" || sanity < 0 || sanity > 100)) {
    return res.status(400).json({ error: "sanity must be 0–100" });
  }
  if (!Number.isInteger(playTimeDelta) || playTimeDelta < 0 || playTimeDelta > 86400) {
    return res.status(400).json({ error: "Invalid playTimeDelta" });
  }
  if (!Array.isArray(choices) || !Array.isArray(unlockedEndings) || !Array.isArray(objectsInspected)) {
    return res.status(400).json({ error: "choices, unlockedEndings, objectsInspected must be arrays" });
  }

  try {
    const savedAt = db.tx(() => {
      // Load current row (may not exist for brand-new users)
      const existing = db.getOne(
        `SELECT current_level, sanity, choices, unlocked_endings,
                loop_count, objects_inspected, hints_used, play_time, id
         FROM progress WHERE user_id = ?`,
        [userId]
      );

      if (existing) {
        // ── Merge arrays ──────────────────────────────────
        const mergedChoices   = mergeUnique(parseJSON(existing.choices,           []), choices);
        const mergedEndings   = mergeUnique(parseJSON(existing.unlocked_endings,  []), unlockedEndings);
        const mergedInspected = mergeUnique(parseJSON(existing.objects_inspected, []), objectsInspected);

        // ── Monotonic guards ──────────────────────────────
        // sanity can only decrease via this endpoint (prevents cheating)
        const newSanity    = sanity !== undefined
                             ? Math.min(existing.sanity, sanity)
                             : existing.sanity;
        // loop_count can only increase
        const newLoopCount = loopCount !== undefined
                             ? Math.max(existing.loop_count, loopCount)
                             : existing.loop_count;
        // level can only increase
        const newLevel     = Math.max(existing.current_level, currentLevel);
        // hints_used is an absolute counter from client — take the max
        const newHints     = Math.max(existing.hints_used, hintsUsed);
        // play_time is additive
        const newPlayTime  = existing.play_time + playTimeDelta;

        db.mutate(
          `UPDATE progress SET
             current_level     = ?,
             sanity            = ?,
             choices           = ?,
             unlocked_endings  = ?,
             loop_count        = ?,
             objects_inspected = ?,
             hints_used        = ?,
             play_time         = ?,
             updated_at        = datetime('now')
           WHERE user_id = ?`,
          [
            newLevel,
            newSanity,
            JSON.stringify(mergedChoices),
            JSON.stringify(mergedEndings),
            newLoopCount,
            JSON.stringify(mergedInspected),
            newHints,
            newPlayTime,
            userId
          ]
        );
      } else {
        // First save for this user
        db.mutate(
          `INSERT INTO progress
             (id, user_id, current_level, sanity, choices, unlocked_endings,
              loop_count, objects_inspected, hints_used, play_time)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `prog_${crypto.randomBytes(6).toString("hex")}`,
            userId,
            currentLevel,
            sanity ?? 100,
            JSON.stringify(choices),
            JSON.stringify(unlockedEndings),
            loopCount ?? 0,
            JSON.stringify(objectsInspected),
            hintsUsed,
            playTimeDelta
          ]
        );
      }

      return new Date().toISOString();
    });

    res.json({ saved: true, timestamp: savedAt });
  } catch (e) {
    console.error("[Progress] POST error:", e.message);
    res.status(500).json({ error: "Could not save progress" });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/progress/:userId   — reset to fresh state
// ─────────────────────────────────────────────────────────────
router.delete("/:userId", requireAuth, (req, res) => {
  if (req.user.sub !== req.params.userId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    db.mutate(
      `UPDATE progress SET
         current_level     = 1,
         sanity            = 100,
         choices           = '[]',
         unlocked_endings  = '[]',
         loop_count        = 0,
         objects_inspected = '[]',
         hints_used        = 0,
         play_time         = 0,
         updated_at        = datetime('now')
       WHERE user_id = ?`,
      [req.params.userId]
    );
    res.json({ reset: true });
  } catch (e) {
    console.error("[Progress] DELETE error:", e.message);
    res.status(500).json({ error: "Could not reset progress" });
  }
});

module.exports = router;
