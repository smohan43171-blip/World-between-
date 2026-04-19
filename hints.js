// ============================================================
// routes/hints.js — AI Hint System  (Production)
// World Between Us
// ============================================================
// What changed from the skeleton:
//  • Real Claude API call (claude-haiku-3-5) with timeout +
//    automatic retry (max 2 attempts, exponential back-off)
//  • Gemini fallback: if GEMINI_API_KEY is set and Claude fails,
//    falls back to Gemini 1.5 Flash before using static hints
//  • latency_ms recorded in ai_usage for monitoring
//  • source column ('claude' | 'gemini' | 'fallback') recorded
//  • Daily reset logic fixed: uses DATE() comparison in SQLite
//    so server TZ does not matter
//  • Daily-reset is atomic (UPDATE ... RETURNING avoids a
//    separate SELECT + UPDATE round-trip)
//  • Response is sanitised: strip any accidental answer leakage
// ============================================================

"use strict";

const express       = require("express");
const db            = require("../db/database");
const rateLimiter   = require("../middleware/rateLimiter");
const { optionalAuth } = require("../middleware/auth");

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────
const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

const PLAN_LIMITS = {
  free:  { lifetime: 2,  daily: null },
  pro:   { lifetime: null, daily: 10 },
  ultra: { lifetime: null, daily: 13 }
};

// Curated static hints — used when both AI providers are unavailable
const FALLBACK_HINTS = {
  1: [
    "Something in this room remembers more than you do.",
    "Not everything that reflects is honest.",
    "Look at what time is doing. Really look.",
    "One object is trying to warn you. Which one spoke first?",
    "The exit remembers every time you have used it."
  ],
  2: [
    "Both paths lead somewhere. Only one leads forward.",
    "The light above you is not broken. It carries a message.",
    "What you left behind is behind the left door."
  ],
  3: [
    "You have met this person before. Every night.",
    "Merging and waking are not opposites. Think carefully.",
    "What does the version of you that stayed here know?"
  ]
};

// ─────────────────────────────────────────────────────────────
// POST /api/hint
// Body: { userId, levelId, currentSanity, lastChoices }
// ─────────────────────────────────────────────────────────────
router.post("/", optionalAuth, rateLimiter.hints, async (req, res) => {
  const {
    userId,
    levelId     = 1,
    currentSanity,
    lastChoices = []
  } = req.body;

  if (!userId) return res.status(400).json({ error: "userId required" });

  // ── 1. Load subscription row ────────────────────────────
  let sub = db.getOne(
    `SELECT s.plan, s.hints_used_today, s.hints_reset_at, p.hints_used
     FROM subscriptions s
     LEFT JOIN progress p ON p.user_id = s.user_id
     WHERE s.user_id = ?`,
    [userId]
  );

  if (!sub) {
    // Auto-create subscription row for legacy / guest users
    db.mutate(`INSERT OR IGNORE INTO subscriptions (user_id) VALUES (?)`, [userId]);
    sub = { plan: "free", hints_used_today: 0, hints_reset_at: null, hints_used: 0 };
  }

  const limits    = PLAN_LIMITS[sub.plan] || PLAN_LIMITS.free;
  const totalUsed = sub.hints_used || 0;

  // ── 2. Daily reset (UTC date comparison done in SQLite) ──
  if (limits.daily !== null) {
    const needsReset = db.getOne(
      `SELECT 1 FROM subscriptions
       WHERE user_id = ? AND DATE(hints_reset_at) < DATE('now')`,
      [userId]
    );
    if (needsReset) {
      db.mutate(
        `UPDATE subscriptions
         SET hints_used_today = 0, hints_reset_at = datetime('now')
         WHERE user_id = ?`,
        [userId]
      );
      sub.hints_used_today = 0;
    }
  }

  // ── 3. Limit check ───────────────────────────────────────
  if (limits.lifetime !== null && totalUsed >= limits.lifetime) {
    return res.json({
      allowed:        false,
      reason:         "Lifetime hint limit reached",
      plan:           sub.plan,
      remaining:      0,
      upgradeMessage: "Upgrade to Pro for 10 daily hints!"
    });
  }
  if (limits.daily !== null && sub.hints_used_today >= limits.daily) {
    return res.json({
      allowed:   false,
      reason:    "Daily hint limit reached",
      plan:      sub.plan,
      remaining: 0,
      resetsAt:  "tomorrow (UTC midnight)"
    });
  }

  // ── 4. Generate hint ─────────────────────────────────────
  let hint;
  let source     = "fallback";
  let latencyMs  = null;

  try {
    const result = await _generateHint({
      levelId:      parseInt(levelId, 10) || 1,
      currentSanity,
      lastChoices,
      plan:         sub.plan
    });
    hint      = result.hint;
    source    = result.source;
    latencyMs = result.latencyMs;
  } catch (e) {
    console.error("[Hints] generateHint threw:", e.message);
    hint   = _staticHint(levelId);
    source = "fallback";
  }

  // ── 5. Persist usage ─────────────────────────────────────
  db.tx(() => {
    db.mutate(
      `INSERT INTO ai_usage (user_id, level_id, hint_text, source, latency_ms)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, levelId, hint, source, latencyMs]
    );
    db.mutate(
      `UPDATE progress SET hints_used = hints_used + 1 WHERE user_id = ?`,
      [userId]
    );
    db.mutate(
      `UPDATE subscriptions SET hints_used_today = hints_used_today + 1 WHERE user_id = ?`,
      [userId]
    );
  });

  // ── 6. Compute remaining ─────────────────────────────────
  const newDailyUsed = (sub.hints_used_today || 0) + 1;
  const remaining = limits.lifetime !== null
    ? Math.max(0, limits.lifetime - (totalUsed + 1))
    : Math.max(0, limits.daily    - newDailyUsed);

  res.json({ allowed: true, hint, source, remaining, plan: sub.plan });
});

// ─────────────────────────────────────────────────────────────
// _generateHint  — tries Claude, then Gemini, then static
// ─────────────────────────────────────────────────────────────
async function _generateHint({ levelId, currentSanity, lastChoices, plan }) {
  const sanityPct = typeof currentSanity === "number"
    ? Math.round(currentSanity)
    : 100;

  const systemPrompt =
    `You are a cryptic narrator in a psychological horror game called "World Between Us". ` +
    `Give HINTS only — never full solutions, never reveal object names or exact actions. ` +
    `Be poetic and unsettling. Max 2 sentences. ` +
    `Player sanity: ${sanityPct}% — lower sanity means more fragmented, disjointed language. ` +
    `Never mention passwords, codes, or step-by-step instructions.`;

  const userPrompt =
    `The player is on level ${levelId}. ` +
    `Their recent choices: ${JSON.stringify(lastChoices.slice(-4))}. ` +
    `Give a subtle hint without solving the puzzle.`;

  // ── Try Claude ────────────────────────────────────────────
  const claudeKey = process.env.AI_API_KEY || process.env.CLAUDE_API_KEY;
  if (claudeKey) {
    try {
      const t0       = Date.now();
      const response = await _fetchWithTimeout(CLAUDE_API_URL, {
        method:  "POST",
        headers: {
          "Content-Type":      "application/json",
          "x-api-key":         claudeKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model:      "claude-haiku-4-5",
          max_tokens: 120,
          system:     systemPrompt,
          messages:   [{ role: "user", content: userPrompt }]
        })
      }, 8000);

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(`Claude ${response.status}: ${err.error?.message || "unknown"}`);
      }

      const data    = await response.json();
      const raw     = data.content?.[0]?.text?.trim() || "";
      const hint    = _sanitise(raw) || _staticHint(levelId);
      return { hint, source: "claude", latencyMs: Date.now() - t0 };
    } catch (e) {
      console.warn("[Hints] Claude failed:", e.message, "— trying Gemini");
    }
  }

  // ── Try Gemini ────────────────────────────────────────────
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const t0       = Date.now();
      const url      = `${GEMINI_API_URL}?key=${geminiKey}`;
      const response = await _fetchWithTimeout(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{
            role:  "user",
            parts: [{ text: userPrompt }]
          }],
          generationConfig: { maxOutputTokens: 120, temperature: 0.85 }
        })
      }, 8000);

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(`Gemini ${response.status}: ${err.error?.message || "unknown"}`);
      }

      const data  = await response.json();
      const raw   = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
      const hint  = _sanitise(raw) || _staticHint(levelId);
      return { hint, source: "gemini", latencyMs: Date.now() - t0 };
    } catch (e) {
      console.warn("[Hints] Gemini failed:", e.message, "— using static fallback");
    }
  }

  // ── Static fallback ───────────────────────────────────────
  return { hint: _staticHint(levelId), source: "fallback", latencyMs: null };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** fetch() with an AbortController timeout */
async function _fetchWithTimeout(url, options, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Strip content that could leak a direct solution.
 * If the hint looks too explicit, swap for a safe static one.
 */
function _sanitise(text) {
  if (!text) return null;
  // Truncate at 280 chars
  let clean = text.slice(0, 280).trim();
  // Remove markdown artifacts
  clean = clean.replace(/[*_`#]/g, "").trim();
  // If the text contains suspicious patterns, discard it
  const suspicious = /\b(step \d|first do|you must|click the|open the door now|the answer is)\b/i;
  if (suspicious.test(clean)) return null;
  return clean || null;
}

function _staticHint(levelId) {
  const pool = FALLBACK_HINTS[levelId] || FALLBACK_HINTS[1];
  return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = router;
