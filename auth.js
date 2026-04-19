// ============================================================
// middleware/auth.js — JWT Verification Middleware
// World Between Us
// ============================================================
// Exports:
//   requireAuth   — 401 if no valid token; sets req.user
//   optionalAuth  — sets req.user if token present, never 401s
// ============================================================

"use strict";

const jwt = require("jsonwebtoken");
const db  = require("../db/database");

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "wbu_access_dev_secret_change_me";

/**
 * Extract Bearer token from Authorization header.
 * Returns the raw token string or null.
 */
function _extractToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return null;
}

/**
 * Core verification logic shared by both middleware variants.
 * Returns the decoded payload or null on any failure.
 */
function _verify(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, ACCESS_SECRET);
  } catch {
    return null;
  }
}

/**
 * requireAuth
 * Guards a route: responds 401 if the token is missing, expired,
 * or its version has been revoked.  Sets req.user on success.
 */
function requireAuth(req, res, next) {
  const decoded = _verify(_extractToken(req));

  if (!decoded) {
    return res.status(401).json({ error: "Authentication required" });
  }

  // Validate token_version against the DB to support logout/revocation
  const user = db.getOne(
    `SELECT id, token_version, plan FROM users WHERE id = ?`,
    [decoded.sub]
  );
  if (!user || user.token_version !== decoded.ver) {
    return res.status(401).json({ error: "Token revoked — please log in again" });
  }

  req.user = decoded;   // { sub, ver, plan, iat, exp }
  next();
}

/**
 * optionalAuth
 * Never blocks the request.  Sets req.user if the token is valid
 * so downstream handlers can personalise the response.
 */
function optionalAuth(req, res, next) {
  const decoded = _verify(_extractToken(req));
  if (decoded) {
    const user = db.getOne(
      `SELECT id, token_version FROM users WHERE id = ?`,
      [decoded.sub]
    );
    if (user && user.token_version === decoded.ver) {
      req.user = decoded;
    }
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
