// ============================================================
// uiController.js — UI Helpers, Menu Particles, Plan Logic
// World Between Us | Separate Module
// ============================================================

import { saveGame, loadGame } from "./saveSystem.js";

// ── Spawn ambient particles in main menu ─────────────────────
export function spawnMenuParticles() {
  const container = document.getElementById("menu-particles");
  if (!container) return;

  for (let i = 0; i < 25; i++) {
    setTimeout(() => {
      const p = document.createElement("div");
      p.className = "particle";
      p.style.cssText = `
        left: ${Math.random() * 100}%;
        width: ${Math.random() * 2 + 1}px;
        height: ${Math.random() * 2 + 1}px;
        --drift: ${(Math.random() - 0.5) * 80}px;
        animation-duration: ${4 + Math.random() * 8}s;
        animation-delay: ${Math.random() * 5}s;
        opacity: ${0.2 + Math.random() * 0.6};
      `;
      container.appendChild(p);

      // Remove and re-add for loop
      p.addEventListener("animationend", () => {
        p.remove();
        spawnSingleParticle(container);
      });
    }, i * 150);
  }
}

function spawnSingleParticle(container) {
  const p = document.createElement("div");
  p.className = "particle";
  p.style.cssText = `
    left: ${Math.random() * 100}%;
    width: ${Math.random() * 2 + 1}px;
    height: ${Math.random() * 2 + 1}px;
    --drift: ${(Math.random() - 0.5) * 80}px;
    animation-duration: ${4 + Math.random() * 8}s;
    opacity: ${0.2 + Math.random() * 0.6};
  `;
  container.appendChild(p);
  p.addEventListener("animationend", () => {
    p.remove();
    spawnSingleParticle(container);
  });
}

// ── Update loop counter HUD ───────────────────────────────────
export function updateLoopHUD(loopCount) {
  const el = document.getElementById("loop-counter");
  if (!el) return;
  if (loopCount > 0) {
    el.textContent = `[LOOP ${loopCount}]`;
    el.style.display = "";
  } else {
    el.style.display = "none";
  }
}

// ── Update subscription status in pause menu ─────────────────
export function updateSubStatusUI(plan, hintsRemaining) {
  const el = document.getElementById("sub-status-pause");
  if (!el) return;

  const planColors = { free: "#6a6080", pro: "#a78bfa", ultra: "#00f0ff" };
  const color = planColors[plan] || "#6a6080";

  el.innerHTML = `
    <div style="font-size:0.6rem; color:${color}; letter-spacing:0.1em; text-align:center; margin-top:0.5rem;">
      ${plan.toUpperCase()} PLAN · ${hintsRemaining} HINTS REMAINING
    </div>
  `;
}

// ── Apply plan locally (demo mode without backend) ────────────
export function upgradeLocalPlan(plan) {
  const save = loadGame();
  save.plan = plan;

  // Reset hints for plan change
  if (plan === "pro")   save.hintsUsed = 0;
  if (plan === "ultra") save.hintsUsed = 0;
  if (plan === "free")  save.hintsUsed = Math.min(save.hintsUsed, 2);

  saveGame(save);

  // Highlight active plan card
  document.querySelectorAll(".sub-card").forEach(card => {
    card.classList.toggle("active-plan", card.getAttribute("data-plan") === plan);
  });

  updateSubStatusUI(plan, getPlanHintsRemaining(plan, save.hintsUsed));
}

function getPlanHintsRemaining(plan, used) {
  const limits = { free: 2, pro: 10, ultra: 13 };
  return Math.max(0, (limits[plan] || 2) - used);
}

// ── Show global choice comparison bar ────────────────────────
export function renderChoiceBar(stats, myChoice) {
  const container = document.getElementById("global-stats");
  if (!container) return;

  const left  = stats.left_path  || 50;
  const right = stats.right_path || 50;
  const isLeft = myChoice === "left_path";

  container.innerHTML = `
    <div style="font-size:0.55rem; color:#6a6080; margin-bottom:4px; letter-spacing:0.1em;">
      WORLD CHOSE
    </div>
    <div style="display:flex; height:6px; border-radius:3px; overflow:hidden; width:200px;">
      <div style="width:${left}%; background:${isLeft ? '#a78bfa' : '#3a2840'}; transition:width 0.5s;"></div>
      <div style="width:${right}%; background:${!isLeft ? '#00f0ff' : '#1a3040'}; transition:width 0.5s;"></div>
    </div>
    <div style="display:flex; justify-content:space-between; font-size:0.55rem; color:#6a6080; margin-top:3px;">
      <span style="color:${isLeft ? '#a78bfa' : '#6a6080'}">← ${left}%</span>
      <span style="color:${!isLeft ? '#00f0ff' : '#6a6080'}">${right}% →</span>
    </div>
  `;
  container.classList.add("visible");
  setTimeout(() => container.classList.remove("visible"), 5000);
}

// ── Update hint button state ──────────────────────────────────
export function updateHintButton(hintsRemaining) {
  const btn = document.getElementById("btn-hint");
  if (!btn) return;
  btn.title = `Get a hint (${hintsRemaining} remaining)`;
  if (hintsRemaining === 0) {
    btn.style.opacity = "0.4";
    btn.style.cursor = "not-allowed";
  } else {
    btn.style.opacity = "";
    btn.style.cursor = "pointer";
  }
}

// ── Narrative title card (shown at level start) ───────────────
export function showLevelTitleCard(levelData) {
  const existing = document.getElementById("title-card");
  if (existing) existing.remove();

  const el = document.createElement("div");
  el.id = "title-card";
  el.style.cssText = `
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: rgba(5,5,8,0.9);
    z-index: 190;
    pointer-events: none;
    animation: titleFadeInOut 3.5s ease-in-out forwards;
  `;
  el.innerHTML = `
    <div style="font-size:0.65rem; color:#6a6080; letter-spacing:0.25em; text-transform:uppercase; margin-bottom:0.5rem;">
      Level ${levelData.id}
    </div>
    <div style="font-family:'Crimson Pro',serif; font-size:clamp(1.5rem,5vw,2.5rem); font-weight:300; font-style:italic; color:#e8e0f0; text-align:center;">
      ${levelData.title}
    </div>
  `;

  // Inject animation if not present
  if (!document.getElementById("title-card-style")) {
    const style = document.createElement("style");
    style.id = "title-card-style";
    style.textContent = `
      @keyframes titleFadeInOut {
        0%   { opacity: 0; }
        15%  { opacity: 1; }
        70%  { opacity: 1; }
        100% { opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

// ── Highlight inspected objects with subtle glow ─────────────
export function pulseObject(objectId) {
  const el = document.querySelector(`[data-object-id="${objectId}"]`);
  if (!el) return;
  el.style.filter = "drop-shadow(0 0 8px rgba(167,139,250,0.6))";
  setTimeout(() => { el.style.filter = ""; }, 1500);
}

// ── Show connection status toast ──────────────────────────────
export function showConnectionStatus(online) {
  const badge = document.getElementById("backend-status");
  if (!badge) return;
  badge.textContent = online ? "● ONLINE" : "◌ OFFLINE";
  badge.className   = online ? "status-online" : "status-offline";
}

// ── Format play time ─────────────────────────────────────────
export function formatPlayTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
