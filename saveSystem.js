// ============================================================
// saveSystem.js — Frontend Save/Load via localStorage
// World Between Us | Separate Module
// ============================================================

const SAVE_KEY = "wbu_save";
const SETTINGS_KEY = "wbu_settings";

// ── Default save state ───────────────────────────────────────
const DEFAULT_SAVE = {
  userId: null,
  guestMode: true,
  currentLevel: 1,
  sanity: 100,
  choices: [],
  unlockedEndings: [],
  loopCount: 0,
  objectsInspected: [],
  hintsUsed: 0,
  plan: "free",
  playTime: 0,
  lastSaved: null,
  version: "1.0.0"
};

// ── Save game ────────────────────────────────────────────────
export function saveGame(state) {
  try {
    const save = {
      ...DEFAULT_SAVE,
      ...state,
      lastSaved: new Date().toISOString()
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    showSaveIndicator();
    return true;
  } catch (e) {
    console.warn("[SaveSystem] Save failed:", e.message);
    return false;
  }
}

// ── Load game ────────────────────────────────────────────────
export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { ...DEFAULT_SAVE };
    const save = JSON.parse(raw);
    // Merge with defaults to handle new fields in future versions
    return { ...DEFAULT_SAVE, ...save };
  } catch (e) {
    console.warn("[SaveSystem] Load failed, resetting:", e.message);
    return { ...DEFAULT_SAVE };
  }
}

// ── Reset / New Game ─────────────────────────────────────────
export function resetGame() {
  localStorage.removeItem(SAVE_KEY);
  return { ...DEFAULT_SAVE };
}

// ── Auto-save after action ───────────────────────────────────
export function autoSave(gameState) {
  return saveGame(gameState);
}

// ── Update a specific field ──────────────────────────────────
export function updateSaveField(field, value) {
  const current = loadGame();
  current[field] = value;
  return saveGame(current);
}

// ── Track object interaction ─────────────────────────────────
export function markObjectInspected(objectId) {
  const save = loadGame();
  if (!save.objectsInspected.includes(objectId)) {
    save.objectsInspected.push(objectId);
    saveGame(save);
  }
  return save.objectsInspected;
}

// ── Track choice made ────────────────────────────────────────
export function recordChoice(choiceId) {
  const save = loadGame();
  save.choices.push({ id: choiceId, timestamp: Date.now() });
  saveGame(save);
  return save.choices;
}

// ── Unlock ending ────────────────────────────────────────────
export function unlockEnding(endingId) {
  const save = loadGame();
  if (!save.unlockedEndings.includes(endingId)) {
    save.unlockedEndings.push(endingId);
    saveGame(save);
  }
  return save.unlockedEndings;
}

// ── Increment loop count ─────────────────────────────────────
export function incrementLoop() {
  const save = loadGame();
  save.loopCount = (save.loopCount || 0) + 1;
  save.sanity = Math.max(0, save.sanity - 10);
  saveGame(save);
  return save.loopCount;
}

// ── Modify sanity ────────────────────────────────────────────
export function modifySanity(amount) {
  const save = loadGame();
  save.sanity = Math.max(0, Math.min(100, save.sanity + amount));
  saveGame(save);
  return save.sanity;
}

// ── Track hint usage ─────────────────────────────────────────
export function useHint() {
  const save = loadGame();
  const limits = { free: 2, pro: 10, ultra: 13 };
  const limit = limits[save.plan] || 2;
  if (save.hintsUsed >= limit) {
    return { allowed: false, used: save.hintsUsed, limit };
  }
  save.hintsUsed += 1;
  saveGame(save);
  return { allowed: true, used: save.hintsUsed, limit };
}

// ── Check if object was inspected ───────────────────────────
export function wasInspected(objectId) {
  const save = loadGame();
  return save.objectsInspected.includes(objectId);
}

// ── Get inspection count ─────────────────────────────────────
export function getInspectCount(objectId) {
  const save = loadGame();
  return save.objectsInspected.filter(id => id === objectId).length;
}

// ── Save settings ────────────────────────────────────────────
export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn("[SaveSystem] Settings save failed");
  }
}

// ── Load settings ────────────────────────────────────────────
export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : { sfxVolume: 0.7, glitchIntensity: 1, language: "en" };
  } catch (e) {
    return { sfxVolume: 0.7, glitchIntensity: 1, language: "en" };
  }
}

// ── Visual feedback: floating "SAVED" ────────────────────────
function showSaveIndicator() {
  const el = document.getElementById("save-indicator");
  if (!el) return;
  el.classList.add("visible");
  setTimeout(() => el.classList.remove("visible"), 2000);
}

// ── Check if game has save ───────────────────────────────────
export function hasSave() {
  return !!localStorage.getItem(SAVE_KEY);
}
