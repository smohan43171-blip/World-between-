// ============================================================
// routes/subscriptions.js — Subscription Plan Routes
// World Between Us | Separate Module
// ============================================================

const express = require("express");
const db      = require("../db/database");
const router  = express.Router();

const PLANS = {
  free:  { name: "Free",      hints: 2,   daily: false, specialAccess: false, price: 0 },
  pro:   { name: "Pro",       hints: 10,  daily: true,  specialAccess: false, price: 4.99 },
  ultra: { name: "Ultra Pro", hints: 13,  daily: true,  specialAccess: true,  price: 9.99 }
};

// ── GET /api/subscription/:userId — Get plan ─────────────────
router.get("/:userId", (req, res) => {
  try {
    const sub = db.get(
      `SELECT plan, hints_used_today, hints_reset_at FROM subscriptions WHERE user_id = ?`,
      [req.params.userId]
    );

    if (!sub) return res.status(404).json({ error: "User not found" });

    const planInfo = PLANS[sub.plan] || PLANS.free;
    const progress = db.get(`SELECT hints_used FROM progress WHERE user_id = ?`, [req.params.userId]);

    res.json({
      plan: sub.plan,
      planName: planInfo.name,
      hintsTotal: planInfo.hints,
      hintsUsedToday: sub.hints_used_today,
      hintsUsedTotal: progress?.hints_used || 0,
      hintsRemaining: planInfo.daily
        ? Math.max(0, planInfo.hints - sub.hints_used_today)
        : Math.max(0, planInfo.hints - (progress?.hints_used || 0)),
      specialAccess: planInfo.specialAccess,
      price: planInfo.price
    });
  } catch (e) {
    res.status(500).json({ error: "Could not fetch subscription" });
  }
});

// ── POST /api/subscription/upgrade — Upgrade plan ────────────
// NOTE: No real payment gateway. Set plan directly (for demo/admin)
router.post("/upgrade", (req, res) => {
  const { userId, plan } = req.body;

  if (!userId || !plan) return res.status(400).json({ error: "userId and plan required" });
  if (!PLANS[plan])      return res.status(400).json({ error: "Invalid plan" });

  try {
    const existing = db.get(`SELECT user_id FROM subscriptions WHERE user_id = ?`, [userId]);

    if (existing) {
      db.run(`UPDATE subscriptions SET plan = ?, hints_used_today = 0 WHERE user_id = ?`, [plan, userId]);
    } else {
      db.run(`INSERT INTO subscriptions (user_id, plan) VALUES (?, ?)`, [userId, plan]);
    }

    db.run(`UPDATE users SET plan = ? WHERE id = ?`, [plan, userId]);

    res.json({
      upgraded: true,
      plan,
      planName: PLANS[plan].name,
      message: `Successfully upgraded to ${PLANS[plan].name}!`
    });
  } catch (e) {
    res.status(500).json({ error: "Could not upgrade plan" });
  }
});

// ── GET /api/subscription/plans — All plan info ───────────────
router.get("/plans/all", (req, res) => {
  res.json({ plans: PLANS });
});

module.exports = router;
