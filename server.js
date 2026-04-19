// ============================================================
// server.js — Express Entry Point  (Production)
// World Between Us
// ============================================================
// What changed from the skeleton:
//  • cookie-parser added  (required for refresh-token cookie)
//  • helmet added         (HTTP security headers)
//  • CORS locked to ALLOWED_ORIGIN env var in production
//  • ENV validation at startup — clear error if secrets missing
//  • Graceful DB-init failure — process exits with code 1
//  • Trust proxy enabled for Render / Railway / Heroku
// ============================================================

"use strict";

const express      = require("express");
const cors         = require("cors");
const cookieParser = require("cookie-parser");   // npm i cookie-parser
const helmet       = require("helmet");           // npm i helmet
const path         = require("path");

// Route modules
const authRoutes         = require("./routes/auth");
const progressRoutes     = require("./routes/progress");
const levelRoutes        = require("./routes/levels");
const hintRoutes         = require("./routes/hints");
const subscriptionRoutes = require("./routes/subscriptions");
const statsRoutes        = require("./routes/stats");

// Middleware modules
const rateLimiter = require("./middleware/rateLimiter");
const logger      = require("./middleware/logger");

// Database
const db = require("./db/database");

// ─────────────────────────────────────────────────────────────
// ENV validation
// ─────────────────────────────────────────────────────────────
const ENV = process.env.NODE_ENV || "development";
const PORT = parseInt(process.env.PORT, 10) || 3000;

if (ENV === "production") {
  const required = ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"];
  const missing  = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`[Server] Missing required env vars: ${missing.join(", ")}`);
    process.exit(1);
  }
} else {
  if (!process.env.JWT_ACCESS_SECRET) {
    console.warn("[Server] JWT_ACCESS_SECRET not set — using insecure dev default");
  }
}

// ─────────────────────────────────────────────────────────────
// App setup
// ─────────────────────────────────────────────────────────────
const app = express();

// Trust first proxy (Render, Railway, Heroku, etc.)
app.set("trust proxy", 1);

// ── Security headers ──────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false  // frontend uses inline scripts; tighten later
}));

// ── CORS ──────────────────────────────────────────────────────
const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
app.use(cors({
  origin:      allowedOrigin,
  credentials: true              // required for cookie-based refresh token
}));

// ── Body / cookie parsing ─────────────────────────────────────
app.use(express.json({ limit: "64kb" }));
app.use(cookieParser());

// ── Request logging ───────────────────────────────────────────
app.use(logger);

// ── Global rate limiter (100 req / min / IP) ──────────────────
app.use(rateLimiter.global);

// ─────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────

app.get("/api/ping", (req, res) => {
  res.json({ status: "alive", env: ENV, timestamp: Date.now(), version: "1.0.0" });
});

app.use("/api/auth",         authRoutes);
app.use("/api/progress",     progressRoutes);
app.use("/api",              levelRoutes);
app.use("/api/hint",         hintRoutes);
app.use("/api/subscription", subscriptionRoutes);
app.use("/api",              statsRoutes);

// ─────────────────────────────────────────────────────────────
// Static frontend (production mode)
// ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "../frontend")));
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// ─────────────────────────────────────────────────────────────
// Global error handler
// ─────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error("[Server] Unhandled error:", err.stack || err.message);
  res.status(500).json({ error: "Internal server error" });
});

// ─────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────
db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n🎮 World Between Us — ${ENV} — port ${PORT}`);
      console.log(`   API:  http://localhost:${PORT}/api`);
      console.log(`   CORS: ${allowedOrigin}\n`);
    });
  })
  .catch(err => {
    console.error("[Server] Database init failed:", err.message);
    process.exit(1);
  });

module.exports = app;
