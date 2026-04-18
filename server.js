// ============================================================
// server.js — Main Backend Entry Point
// World Between Us | Node.js Backend
// ============================================================

const express = require("express");
const cors    = require("cors");
const path    = require("path");

// Route modules
const authRoutes         = require("./routes/auth");
const progressRoutes     = require("./routes/progress");
const levelRoutes        = require("./routes/levels");
const hintRoutes         = require("./routes/hints");
const subscriptionRoutes = require("./routes/subscriptions");
const statsRoutes        = require("./routes/stats");

// Middleware modules
const rateLimiter        = require("./middleware/rateLimiter");
const validator          = require("./middleware/validator");
const logger             = require("./middleware/logger");

// Database init
const db = require("./db/database");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Core middleware ───────────────────────────────────────────
app.use(cors({ origin: "*" })); // Restrict in production
app.use(express.json());
app.use(logger);
app.use(rateLimiter.global); // 100 req/min per IP

// ── Health check ──────────────────────────────────────────────
app.get("/api/ping", (req, res) => {
  res.json({ status: "alive", timestamp: Date.now(), version: "1.0.0" });
});

// ── API Routes ────────────────────────────────────────────────
app.use("/api/auth",         authRoutes);
app.use("/api/progress",     progressRoutes);
app.use("/api",              levelRoutes);
app.use("/api/hint",         hintRoutes);
app.use("/api/subscription", subscriptionRoutes);
app.use("/api",              statsRoutes);

// ── Serve frontend in production ──────────────────────────────
app.use(express.static(path.join(__dirname, "../frontend")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// ── Error handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("[Server Error]", err.message);
  res.status(500).json({ error: "Internal server error" });
});

// ── Start ─────────────────────────────────────────────────────
db.init().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🎮 World Between Us — Backend running on port ${PORT}`);
    console.log(`   API: http://localhost:${PORT}/api`);
  });
});

module.exports = app;
