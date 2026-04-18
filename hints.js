// ============================================================
// routes/hints.js — AI Hint System Routes
// World Between Us | Separate Module
// ============================================================

const express = require("express");
const db      = require("../db/database");
const rateLimiter = require("../middleware/rateLimiter");
const router  = express.Router();

// ── Plan limits ───────────────────────────────────────────────
const PLAN_LIMITS = {
  free:  { total: 2,  daily: null, hasSpecialAccess: false },
  pro:   { total: null, daily: 10, hasSpecialAccess: false },
  ultra: { total: null, daily: 13, hasSpecialAccess: true  }
};

// ── Fallback hints when AI is not configured ─────────────────
const FALLBACK_HINTS = {
  1: [
    "Something in this room remembers more than you do.",
    "Not everything that reflects is honest.",
    "Look at what time is doing. Really look.",
    "One object is trying to warn you. Which one responds to you first?",
    "The exit remembers every time you've used it."
  ],
  2: [
    "Both paths lead somewhere. Only one leads forward.",
    "The light above you is not broken. It has a message.",
    "What you left behind is behind the left door."
  ],
  3: [
    "You've met this person before. Every night.",
    "Merging and waking are not opposites. Think carefully.",
    "What does the version of you that stayed here know?"
  ]
};

// ── POST /api/hint — Request a hint ──────────────────────────
router.post("/", rateLimiter.hints, async (req, res) => {
  const { userId, levelId = 1, currentSanity, lastChoices } = req.body;

  if (!userId) return res.status(400).json({ error: "userId required" });

  try {
    // Get user's subscription
    const sub = db.get(`SELECT plan, hints_used_today, hints_reset_at FROM subscriptions WHERE user_id = ?`, [userId]);
    if (!sub) return res.status(404).json({ error: "User not found" });

    // Get total hints used
    const progress = db.get(`SELECT hints_used FROM progress WHERE user_id = ?`, [userId]);
    const totalUsed = progress?.hints_used || 0;

    const limits = PLAN_LIMITS[sub.plan] || PLAN_LIMITS.free;

    // Check daily reset for pro/ultra
    if (limits.daily) {
      const resetDate = new Date(sub.hints_reset_at);
      const now       = new Date();
      if (now.toDateString() !== resetDate.toDateString()) {
        db.run(`UPDATE subscriptions SET hints_used_today = 0, hints_reset_at = datetime('now') WHERE user_id = ?`, [userId]);
        sub.hints_used_today = 0;
      }
      if (sub.hints_used_today >= limits.daily) {
        return res.json({
          allowed: false,
          reason: "Daily limit reached",
          plan: sub.plan,
          resetsAt: "tomorrow",
          remaining: 0
        });
      }
    }

    // Check total for free users
    if (limits.total && totalUsed >= limits.total) {
      return res.json({
        allowed: false,
        reason: "Lifetime hint limit reached",
        plan: "free",
        remaining: 0,
        upgradeMessage: "Upgrade to Pro for 10 daily hints!"
      });
    }

    // Generate hint
    const hint = await generateHint({ userId, levelId, currentSanity, lastChoices, plan: sub.plan });

    // Log hint usage
    db.run(`INSERT INTO ai_usage (user_id, level_id, hint_text) VALUES (?, ?, ?)`, [userId, levelId, hint]);
    db.run(`UPDATE progress SET hints_used = hints_used + 1 WHERE user_id = ?`, [userId]);
    db.run(`UPDATE subscriptions SET hints_used_today = hints_used_today + 1 WHERE user_id = ?`, [userId]);

    // Calculate remaining
    const newTotal = totalUsed + 1;
    const remaining = limits.total
      ? Math.max(0, limits.total - newTotal)
      : Math.max(0, limits.daily - (sub.hints_used_today + 1));

    res.json({ allowed: true, hint, remaining, plan: sub.plan });

  } catch (e) {
    console.error("[Hints] Error:", e.message);
    res.status(500).json({ error: "Hint service unavailable", hint: getFallbackHint(levelId) });
  }
});

// ── AI hint generator (Gemini/Claude integration placeholder) ─
async function generateHint({ userId, levelId, currentSanity, lastChoices, plan }) {
  const AI_KEY = process.env.AI_API_KEY;

  if (AI_KEY) {
    try {
      // ── Claude API integration ────────────────────────────
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method:  "POST",
        headers: {
          "Content-Type":    "application/json",
          "x-api-key":       AI_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model:      "claude-3-haiku-20240307",
          max_tokens: 120,
          system: `You are a cryptic narrator in a psychological horror game. Give HINTS only — never full solutions.
                   Be poetic, unsettling, and vague. Max 2 sentences. Never mention passwords or exact answers.
                   Current player sanity: ${currentSanity}%. Adjust tone accordingly — lower sanity = more fragmented hint.`,
          messages: [{
            role:    "user",
            content: `Player is on level ${levelId}. Their last choices: ${JSON.stringify(lastChoices)}. Give a hint.`
          }]
        })
      });

      const data = await response.json();
      return data.content?.[0]?.text || getFallbackHint(levelId);
    } catch {
      return getFallbackHint(levelId);
    }
  }

  // No AI key — use curated fallbacks
  return getFallbackHint(levelId);
}

function getFallbackHint(levelId) {
  const hints = FALLBACK_HINTS[levelId] || FALLBACK_HINTS[1];
  return hints[Math.floor(Math.random() * hints.length)];
}

module.exports = router;
