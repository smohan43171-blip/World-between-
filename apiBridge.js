// ============================================================
// apiBridge.js — Frontend ↔ Backend Communication Layer
// World Between Us | Separate Module
// Falls back gracefully if backend is offline
// ============================================================

const API_BASE = "http://localhost:3000/api"; // Change for production
let isBackendAlive = false;
let lastPingTime = 0;

// ── Ping backend to check if it's alive ──────────────────────
export async function pingBackend() {
  const now = Date.now();
  if (now - lastPingTime < 30000) return isBackendAlive; // Cache 30s

  try {
    const res = await fetch(`${API_BASE}/ping`, { signal: AbortSignal.timeout(2000) });
    isBackendAlive = res.ok;
  } catch {
    isBackendAlive = false;
  }

  lastPingTime = now;
  return isBackendAlive;
}

// ── Generic API call with offline fallback ───────────────────
async function apiFetch(endpoint, options = {}, fallbackFn = null) {
  await pingBackend();

  if (!isBackendAlive) {
    if (fallbackFn) return await fallbackFn();
    return { offline: true, data: null };
  }

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
      ...options
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn(`[ApiBridge] ${endpoint} failed:`, e.message);
    isBackendAlive = false;
    if (fallbackFn) return await fallbackFn();
    return { offline: true, error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
// USER SYSTEM
// ─────────────────────────────────────────────────────────────

// ── Guest login (no credentials needed) ──────────────────────
export async function loginAsGuest() {
  return await apiFetch("/auth/guest", { method: "POST" }, () => ({
    userId: "guest_" + Math.random().toString(36).substr(2, 8),
    guestMode: true, plan: "free"
  }));
}

// ── Register user ─────────────────────────────────────────────
export async function registerUser(username, email) {
  return await apiFetch("/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, email })
  });
}

// ── Login user ────────────────────────────────────────────────
export async function loginUser(username) {
  return await apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username })
  });
}

// ─────────────────────────────────────────────────────────────
// PROGRESS SYSTEM
// ─────────────────────────────────────────────────────────────

// ── Save progress to backend ──────────────────────────────────
export async function saveProgressRemote(userId, progress) {
  return await apiFetch(`/progress/${userId}`, {
    method: "POST",
    body: JSON.stringify(progress)
  });
}

// ── Load progress from backend ────────────────────────────────
export async function loadProgressRemote(userId) {
  return await apiFetch(`/progress/${userId}`, {}, () => null);
}

// ─────────────────────────────────────────────────────────────
// LEVEL SYSTEM
// ─────────────────────────────────────────────────────────────

// ── Get all levels ────────────────────────────────────────────
export async function fetchAllLevels() {
  return await apiFetch("/levels", {}, async () => {
    const res = await fetch("./data/levels.json");
    const data = await res.json();
    return data.levels;
  });
}

// ── Get specific level ────────────────────────────────────────
export async function fetchLevel(levelId) {
  return await apiFetch(`/level/${levelId}`, {}, async () => {
    const res = await fetch("./data/levels.json");
    const data = await res.json();
    return data.levels.find(l => l.id === levelId);
  });
}

// ── Get next level ────────────────────────────────────────────
export async function fetchNextLevel(currentLevelId) {
  return await apiFetch(`/next-level/${currentLevelId}`, {}, async () => {
    const res = await fetch("./data/levels.json");
    const data = await res.json();
    return data.levels.find(l => l.id === currentLevelId + 1) || null;
  });
}

// ─────────────────────────────────────────────────────────────
// AI HINT SYSTEM
// ─────────────────────────────────────────────────────────────

// ── Request hint from AI (backend handles AI call + rate limiting)
export async function requestHint(context) {
  const { userId, levelId, currentSanity, lastChoices, plan } = context;

  // Offline fallback hints
  const fallbackHints = [
    "Look more carefully at what doesn't move when it should...",
    "Time here doesn't work the way you remember.",
    "The objects remember more than you do.",
    "Something is watching you from a reflection.",
    "Not every exit leads out."
  ];

  return await apiFetch("/hint", {
    method: "POST",
    body: JSON.stringify({ userId, levelId, currentSanity, lastChoices })
  }, () => ({
    hint: fallbackHints[Math.floor(Math.random() * fallbackHints.length)],
    offline: true,
    remaining: plan === "free" ? 1 : 5
  }));
}

// ─────────────────────────────────────────────────────────────
// MULTIPLAYER SIMULATION / GHOST DATA
// ─────────────────────────────────────────────────────────────

// ── Fetch global choice stats ─────────────────────────────────
export async function fetchGlobalStats(levelId) {
  return await apiFetch(`/global-stats/${levelId}`, {}, () => ({
    left_path: 58,
    right_path: 42,
    escaped: 34,
    trapped: 66,
    totalPlayers: 1247,
    offline: true
  }));
}

// ── Submit player choice to global stats ─────────────────────
export async function submitChoice(levelId, choiceId) {
  return await apiFetch(`/global-stats/${levelId}/submit`, {
    method: "POST",
    body: JSON.stringify({ choice: choiceId })
  });
}

// ── Fetch ghost data (other players' paths) ──────────────────
export async function fetchGhostData(levelId) {
  return await apiFetch(`/ghosts/${levelId}`, {}, () => ({
    ghosts: [
      { path: ["mirror", "clock", "door"], result: "trapped", opacity: 0.2 },
      { path: ["phone", "mirror", "door"], result: "escaped", opacity: 0.15 }
    ],
    offline: true
  }));
}

// ─────────────────────────────────────────────────────────────
// SUBSCRIPTION
// ─────────────────────────────────────────────────────────────

// ── Check subscription plan ───────────────────────────────────
export async function checkPlan(userId) {
  return await apiFetch(`/subscription/${userId}`, {}, () => ({
    plan: "free", hintsRemaining: 2
  }));
}

// ── Upgrade plan (placeholder — no real payment) ──────────────
export async function upgradePlan(userId, targetPlan) {
  return await apiFetch("/subscription/upgrade", {
    method: "POST",
    body: JSON.stringify({ userId, plan: targetPlan })
  }, () => ({
    success: false,
    message: "Backend required for subscription changes.",
    offline: true
  }));
}

// ─────────────────────────────────────────────────────────────
// LEADERBOARD / STATS
// ─────────────────────────────────────────────────────────────

export async function fetchLeaderboard(limit = 10) {
  return await apiFetch(`/leaderboard?limit=${limit}`, {}, () => ({
    entries: [],
    offline: true
  }));
}

export async function submitScore(userId, scoreData) {
  return await apiFetch("/leaderboard/submit", {
    method: "POST",
    body: JSON.stringify({ userId, ...scoreData })
  });
}

// ── Export status ─────────────────────────────────────────────
export function getBackendStatus() {
  return { alive: isBackendAlive, lastChecked: lastPingTime };
}
