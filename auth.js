// ============================================================
// routes/auth.js — User Authentication Routes
// World Between Us | Separate Module
// ============================================================

const express = require("express");
const crypto  = require("crypto");
const db      = require("../db/database");
const router  = express.Router();

// ── Generate user ID ──────────────────────────────────────────
function generateId(prefix = "user") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

// ── POST /api/auth/guest — Create guest session ───────────────
router.post("/guest", (req, res) => {
  try {
    const userId = generateId("guest");

    db.run(
      `INSERT INTO users (id, guest_mode, plan) VALUES (?, 1, 'free')`,
      [userId]
    );

    db.run(
      `INSERT INTO progress (id, user_id) VALUES (?, ?)`,
      [generateId("prog"), userId]
    );

    db.run(
      `INSERT INTO subscriptions (user_id) VALUES (?)`,
      [userId]
    );

    res.json({ userId, guestMode: true, plan: "free" });
  } catch (e) {
    console.error("[Auth] Guest login error:", e.message);
    res.status(500).json({ error: "Could not create guest session" });
  }
});

// ── POST /api/auth/register — Register new user ───────────────
router.post("/register", (req, res) => {
  const { username, email } = req.body;

  if (!username || username.length < 2) {
    return res.status(400).json({ error: "Username too short" });
  }

  try {
    const userId   = generateId("user");
    const existing = db.get(`SELECT id FROM users WHERE username = ?`, [username]);

    if (existing) {
      return res.status(409).json({ error: "Username taken" });
    }

    db.run(
      `INSERT INTO users (id, username, email, guest_mode, plan) VALUES (?, ?, ?, 0, 'free')`,
      [userId, username, email || null]
    );

    db.run(
      `INSERT INTO progress (id, user_id) VALUES (?, ?)`,
      [generateId("prog"), userId]
    );

    db.run(
      `INSERT INTO subscriptions (user_id) VALUES (?)`,
      [userId]
    );

    res.json({ userId, username, plan: "free" });
  } catch (e) {
    console.error("[Auth] Register error:", e.message);
    res.status(500).json({ error: "Registration failed" });
  }
});

// ── POST /api/auth/login — Simple username login ──────────────
router.post("/login", (req, res) => {
  const { username } = req.body;

  if (!username) return res.status(400).json({ error: "Username required" });

  try {
    const user = db.get(`SELECT id, username, plan FROM users WHERE username = ?`, [username]);

    if (!user) return res.status(404).json({ error: "User not found" });

    // Update last active
    db.run(`UPDATE users SET last_active = datetime('now') WHERE id = ?`, [user.id]);

    res.json({ userId: user.id, username: user.username, plan: user.plan });
  } catch (e) {
    res.status(500).json({ error: "Login failed" });
  }
});

// ── GET /api/auth/user/:userId — Get user info ────────────────
router.get("/user/:userId", (req, res) => {
  const user = db.get(
    `SELECT id, username, plan, guest_mode, created_at FROM users WHERE id = ?`,
    [req.params.userId]
  );

  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
});

module.exports = router;
