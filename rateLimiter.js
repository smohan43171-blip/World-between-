// ============================================================
// middleware/rateLimiter.js — Rate Limiting Middleware
// World Between Us | Separate Module
// ============================================================

// In-memory store (use Redis for 100k+ scale)
const ipStore   = new Map(); // IP → { count, resetAt }
const hintStore = new Map(); // userId → { count, resetAt }

// ── Generic rate limiter factory ─────────────────────────────
function createLimiter({ windowMs, max, keyFn, message }) {
  return (req, res, next) => {
    const key     = keyFn(req);
    const now     = Date.now();
    const record  = ipStore.get(key);

    if (!record || now > record.resetAt) {
      ipStore.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (record.count >= max) {
      res.setHeader("Retry-After", Math.ceil((record.resetAt - now) / 1000));
      return res.status(429).json({ error: message, retryAfter: Math.ceil((record.resetAt - now) / 1000) });
    }

    record.count++;
    next();
  };
}

// ── Global: 100 requests/minute per IP ───────────────────────
const global = createLimiter({
  windowMs: 60 * 1000,
  max:      100,
  keyFn:    req => req.ip || req.headers["x-forwarded-for"] || "unknown",
  message:  "Too many requests. Slow down."
});

// ── Hints: 5 hint requests/minute per IP ─────────────────────
const hints = createLimiter({
  windowMs: 60 * 1000,
  max:      5,
  keyFn:    req => (req.body?.userId || req.ip),
  message:  "Too many hint requests. Wait a moment."
});

// ── Auth: 10 login attempts/minute per IP ────────────────────
const auth = createLimiter({
  windowMs: 60 * 1000,
  max:      10,
  keyFn:    req => req.ip || "unknown",
  message:  "Too many auth attempts."
});

// ── Save progress: 30/minute (auto-save is frequent) ─────────
const save = createLimiter({
  windowMs: 60 * 1000,
  max:      30,
  keyFn:    req => req.params?.userId || req.ip,
  message:  "Save rate exceeded."
});

// ── Cleanup stale entries every 5 minutes ────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of ipStore.entries()) {
    if (now > val.resetAt) ipStore.delete(key);
  }
}, 5 * 60 * 1000);

module.exports = { global, hints, auth, save };
