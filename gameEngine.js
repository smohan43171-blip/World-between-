// ============================================================
// gameEngine.js — Main Game Loop + State Orchestrator
// World Between Us | Core Engine
// ============================================================

import { loadLevel, renderScene, handleInteraction, updateSanityBar, transitionToLevel, showDialogue } from "./levelRenderer.js";
import { saveGame, loadGame, resetGame, recordChoice, unlockEnding, incrementLoop, modifySanity, useHint, autoSave } from "./saveSystem.js";
import { runGlitchSequence, applySanityAmbience, triggerGlitch } from "./glitchEngine.js";
import { pingBackend, saveProgressRemote, requestHint, fetchGlobalStats, submitChoice, loginAsGuest } from "./apiBridge.js";

// ── Game state ────────────────────────────────────────────────
let state = {
  userId: null,
  currentLevel: 1,
  sanity: 100,
  choices: [],
  unlockedEndings: [],
  loopCount: 0,
  objectsInspected: [],
  hintsUsed: 0,
  plan: "free",
  isRunning: false,
  currentLevelData: null
};

// ── Boot game ─────────────────────────────────────────────────
export async function bootGame() {
  console.log("[GameEngine] Booting World Between Us...");

  // Show boot screen
  showBootScreen();

  // Load saved game
  const saved = loadGame();
  Object.assign(state, saved);

  // Init user (guest or existing)
  if (!state.userId) {
    const guest = await loginAsGuest();
    state.userId = guest.userId;
    state.guestMode = true;
    state.plan = guest.plan || "free";
    saveGame(state);
  }

  // Check backend
  const backendOnline = await pingBackend();
  updateStatusBadge(backendOnline);

  // Load global stats (non-blocking)
  loadGlobalStats(state.currentLevel);

  // Hide boot, show menu
  setTimeout(() => {
    hideBootScreen();
    showMainMenu();
  }, 2000);
}

// ── Start / resume game ───────────────────────────────────────
export async function startGame(levelId = null) {
  hideMainMenu();

  const targetLevel = levelId ?? state.currentLevel;
  state.isRunning = true;
  state.currentLevel = targetLevel;

  await loadAndRenderLevel(targetLevel);
  startSanityDrain();
}

// ── Load and render level ─────────────────────────────────────
async function loadAndRenderLevel(levelId) {
  const levelData = await loadLevel(levelId);
  if (!levelData) {
    showError("Failed to load level data.");
    return;
  }

  state.currentLevelData = levelData;

  // Set starting sanity if fresh level
  if (!loadGame().currentLevel || loadGame().currentLevel !== levelId) {
    state.sanity = levelData.sanityStart || 100;
  }

  // Render
  renderScene(levelData, state);
  updateSanityBar(state.sanity);
  updateLevelUI(levelData);

  // Loop message
  if (state.loopCount > 0 && levelData.loop) {
    const msg = levelData.loop.messageOnLoop?.[Math.min(state.loopCount, 3)];
    if (msg) showDialogue("System", msg, "system");
  }

  autoSave(state);
}

// ── Handle object interaction (called from rendered objects) ──
export function onObjectClick(obj) {
  if (!state.isRunning) return;

  const result = handleInteraction(obj, state, (field, amount) => {
    if (field === "sanity") {
      state.sanity = Math.max(0, state.sanity + amount);
      updateSanityBar(state.sanity);
      checkGlitchTrigger();
      checkSanityGameOver();
    }
  });

  autoSave(state);

  if (result?.action === "exit") handleLevelExit(obj);
  if (result?.action === "choice") handleChoice(result.value);
}

// ── Handle choice ─────────────────────────────────────────────
export async function handleChoice(choiceId) {
  state.choices.push({ id: choiceId, level: state.currentLevel, time: Date.now() });
  recordChoice(choiceId);
  submitChoice(state.currentLevel, choiceId); // Non-blocking backend call

  autoSave(state);

  // Show global stats after choice
  const stats = await fetchGlobalStats(state.currentLevel);
  if (!stats.offline) showChoiceStats(stats, choiceId);
}

// ── Handle level exit ─────────────────────────────────────────
function handleLevelExit(exitObj) {
  const levelData = state.currentLevelData;
  if (!levelData) return;

  const exitCond = levelData.exitCondition;

  if (exitCond.type === "object_sequence") {
    const inspected = state.objectsInspected;
    const seq = exitCond.sequence;
    const meetsCondition = seq.every(id => inspected.includes(id));

    if (meetsCondition) {
      // Good exit
      completeLevel(levelData.endings?.good?.id || "escape");
    } else {
      // Loop
      triggerLoop();
    }
  } else if (exitCond.type === "final_choice") {
    showFinalChoice(exitCond.choices);
  } else {
    completeLevel();
  }
}

// ── Complete level ────────────────────────────────────────────
async function completeLevel(endingId = null) {
  state.isRunning = false;
  stopSanityDrain();

  if (endingId) unlockEnding(endingId);

  // Level complete animation
  triggerGlitch("static_burst", { duration: 500 });
  await delay(600);

  const nextLevel = state.currentLevel + 1;
  const totalLevels = 3; // From levels.json meta

  if (nextLevel > totalLevels) {
    showGameEnd(state.choices, state.unlockedEndings);
    return;
  }

  state.currentLevel = nextLevel;
  state.loopCount = 0;
  autoSave(state);

  transitionToLevel(nextLevel, () => {
    state.isRunning = true;
    loadAndRenderLevel(nextLevel);
    startSanityDrain();
  });
}

// ── Trigger loop ──────────────────────────────────────────────
function triggerLoop() {
  const loopCount = incrementLoop();
  state.loopCount = loopCount;
  state.sanity = Math.max(0, state.sanity - 10);

  // Full glitch sequence
  const seq = state.currentLevelData?.glitchSequence;
  if (seq) runGlitchSequence(seq);

  setTimeout(() => {
    updateSanityBar(state.sanity);
    loadAndRenderLevel(state.currentLevel);
    autoSave(state);
  }, 2500);
}

// ── Sanity drain loop ─────────────────────────────────────────
let sanityDrainInterval = null;

function startSanityDrain() {
  if (sanityDrainInterval) return;
  const rate = state.currentLevelData?.sanityDrainRate || 2;

  sanityDrainInterval = setInterval(() => {
    if (!state.isRunning) return;
    state.sanity = Math.max(0, state.sanity - rate * 0.1); // Per 100ms = rate/10 per second
    updateSanityBar(state.sanity);
    checkGlitchTrigger();
    checkSanityGameOver();
  }, 100);
}

function stopSanityDrain() {
  if (sanityDrainInterval) {
    clearInterval(sanityDrainInterval);
    sanityDrainInterval = null;
  }
}

// ── Glitch trigger on sanity threshold ───────────────────────
let glitchTriggered = false;
function checkGlitchTrigger() {
  const threshold = state.currentLevelData?.glitchThreshold || 60;
  if (!glitchTriggered && state.sanity < threshold) {
    glitchTriggered = true;
    runGlitchSequence(state.currentLevelData?.glitchSequence);
    setTimeout(() => { glitchTriggered = false; }, 30000); // Reset after 30s
  }
}

// ── Sanity zero → game over / alternate ending ───────────────
function checkSanityGameOver() {
  if (state.sanity <= 0) {
    stopSanityDrain();
    state.isRunning = false;
    const altEnding = state.currentLevelData?.exitCondition?.alternateExit;
    if (altEnding) {
      unlockEnding(altEnding.ending);
      showGameOver(altEnding.ending);
    } else {
      showGameOver("sanity_zero");
    }
  }
}

// ── Hint system ───────────────────────────────────────────────
export async function requestGameHint() {
  const hintResult = useHint();
  if (!hintResult.allowed) {
    showHintDenied(hintResult.limit, state.plan);
    return;
  }

  showHintLoading();

  const hint = await requestHint({
    userId: state.userId,
    levelId: state.currentLevel,
    currentSanity: state.sanity,
    lastChoices: state.choices.slice(-3),
    plan: state.plan
  });

  showHintText(hint.hint, hintResult.limit - hintResult.used);
  autoSave(state);
}

// ── Final choice (Level 3) ────────────────────────────────────
function showFinalChoice(choices) {
  const overlay = document.getElementById("final-choice-overlay");
  const choicesContainer = overlay?.querySelector(".choices-container");
  if (!overlay || !choicesContainer) return;

  choicesContainer.innerHTML = "";
  choices.forEach(choice => {
    const btn = document.createElement("button");
    btn.className = "final-choice-btn";
    btn.textContent = choice.text;
    btn.onclick = () => {
      unlockEnding(choice.ending);
      overlay.classList.remove("visible");
      showEndingCinematic(choice.ending);
    };
    choicesContainer.appendChild(btn);
  });

  overlay.classList.add("visible");
}

// ── Load global stats ─────────────────────────────────────────
async function loadGlobalStats(levelId) {
  const stats = await fetchGlobalStats(levelId);
  updateGlobalStatsUI(stats);
}

// ─────────────────────────────────────────────────────────────
// UI HELPERS
// ─────────────────────────────────────────────────────────────

function showBootScreen() {
  document.getElementById("boot-screen")?.classList.add("visible");
}
function hideBootScreen() {
  document.getElementById("boot-screen")?.classList.remove("visible");
}
function showMainMenu() {
  document.getElementById("main-menu")?.classList.add("visible");
}
function hideMainMenu() {
  document.getElementById("main-menu")?.classList.remove("visible");
}

function updateStatusBadge(online) {
  const badge = document.getElementById("backend-status");
  if (badge) {
    badge.textContent = online ? "● ONLINE" : "◌ OFFLINE";
    badge.className = online ? "status-online" : "status-offline";
  }
}

function updateLevelUI(levelData) {
  const el = document.getElementById("level-title");
  if (el) el.textContent = `Level ${levelData.id}: ${levelData.title}`;
}

function showChoiceStats(stats, myChoice) {
  const el = document.getElementById("global-stats");
  if (!el) return;
  el.innerHTML = `
    <div class="stats-popup">
      <span>Players chose ${myChoice === "left_path" ? "↑ " + stats.left_path + "%" : "↑ " + stats.right_path + "%"}</span>
    </div>
  `;
  el.classList.add("visible");
  setTimeout(() => el.classList.remove("visible"), 3000);
}

function updateGlobalStatsUI(stats) {
  const el = document.getElementById("world-stats");
  if (!el || stats.offline) return;
  el.querySelector(".left-stat")?.textContent && (el.querySelector(".left-stat").textContent = stats.left_path + "%");
  el.querySelector(".right-stat")?.textContent && (el.querySelector(".right-stat").textContent = stats.right_path + "%");
}

function showHintLoading() {
  const el = document.getElementById("hint-box");
  if (el) { el.textContent = "Searching the void..."; el.classList.add("visible"); }
}
function showHintText(text, remaining) {
  const el = document.getElementById("hint-box");
  if (el) {
    el.innerHTML = `<p>${text}</p><small>${remaining} hints left</small>`;
    setTimeout(() => el.classList.remove("visible"), 5000);
  }
}
function showHintDenied(limit, plan) {
  const el = document.getElementById("hint-box");
  if (el) {
    el.innerHTML = `<p>No hints remaining on <strong>${plan}</strong> plan. Upgrade for more.</p>`;
    el.classList.add("visible");
    setTimeout(() => el.classList.remove("visible"), 4000);
  }
}

function showGameOver(endingId) {
  const overlay = document.getElementById("gameover-overlay");
  const msg = overlay?.querySelector(".gameover-msg");
  if (msg) msg.textContent = endingId === "trapped_in_loop"
    ? "You are part of the loop now."
    : "Your mind fractured. The dream won.";
  overlay?.classList.add("visible");
}

function showGameEnd(choices, endings) {
  const overlay = document.getElementById("game-end-overlay");
  overlay?.classList.add("visible");
}

function showEndingCinematic(endingId) {
  const endingTexts = {
    dreamer_ending: "You chose the dream. You are at peace, in a world that never was.",
    reality_ending: "You woke up. The world outside is cold and real. You remember everything.",
    escape_aware: "You knew the trap. You walked out with your mind intact.",
    trapped_in_loop: "The door closed. The clock read 3:17. You blinked. The room was the same."
  };

  const overlay = document.getElementById("ending-overlay");
  const text = overlay?.querySelector(".ending-text");
  if (text) text.textContent = endingTexts[endingId] || "The loop continues...";
  overlay?.classList.add("visible");
}

function showError(msg) {
  console.error("[GameEngine]", msg);
  alert(msg);
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── New game ──────────────────────────────────────────────────
export function newGame() {
  stopSanityDrain();
  const fresh = resetGame();
  Object.assign(state, fresh);
  saveGame(state);
  startGame(1);
}

// ── Export state accessor ─────────────────────────────────────
export function getGameState() { return { ...state }; }
