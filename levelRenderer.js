// ============================================================
// levelRenderer.js — Scene + Object Rendering Functions
// World Between Us | Separate Module
// ============================================================

import { applySanityAmbience, scrambleText, triggerGlitch } from "./glitchEngine.js";
import { wasInspected, markObjectInspected, loadGame } from "./saveSystem.js";

// ── Load level by ID from local JSON ─────────────────────────
export async function loadLevel(levelId, apiBase = null) {
  try {
    // Try backend first; fall back to local JSON
    if (apiBase) {
      const res = await fetch(`${apiBase}/level/${levelId}`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return await res.json();
    }
  } catch {
    console.log("[LevelRenderer] Backend unavailable, using local JSON.");
  }

  // Fallback: local JSON
  try {
    const res = await fetch("./data/levels.json");
    const data = await res.json();
    return data.levels.find(l => l.id === levelId) || null;
  } catch (e) {
    console.error("[LevelRenderer] Failed to load local levels.json:", e);
    return null;
  }
}

// ── Render full scene ────────────────────────────────────────
export function renderScene(levelData, gameState) {
  const sceneEl = document.getElementById("game-scene");
  if (!sceneEl || !levelData) return;

  // Set background
  sceneEl.className = `scene scene-${levelData.scene}`;
  sceneEl.setAttribute("data-level", levelData.id);

  // Set atmosphere overlay
  const atmoEl = document.getElementById("atmosphere-text");
  if (atmoEl) {
    atmoEl.textContent = "";
    scrambleText(atmoEl, levelData.atmosphere, 1200);
  }

  // Apply sanity visual state
  applySanityAmbience(gameState.sanity || 100);

  // Render objects
  renderObjects(levelData.objects, gameState);

  // Show loop indicator
  if (gameState.loopCount > 0) {
    showLoopIndicator(gameState.loopCount, levelData.loop?.messageOnLoop);
  }
}

// ── Render all objects ───────────────────────────────────────
export function renderObjects(objects, gameState) {
  const objectLayer = document.getElementById("object-layer");
  if (!objectLayer) return;

  objectLayer.innerHTML = "";
  objects.forEach(obj => {
    const el = createObjectElement(obj, gameState);
    objectLayer.appendChild(el);
  });
}

// ── Create a single object element ───────────────────────────
function createObjectElement(obj, gameState) {
  const div = document.createElement("div");
  div.className = `game-object obj-${obj.id}`;
  div.setAttribute("data-object-id", obj.id);
  div.setAttribute("data-interaction", obj.interaction);
  div.setAttribute("data-name", obj.name);

  div.style.cssText = `
    position: absolute;
    left: ${obj.x}%;
    top: ${obj.y}%;
    width: ${obj.width}px;
    height: ${obj.height}px;
    cursor: pointer;
    transform-origin: center bottom;
  `;

  // Inner visual content
  div.innerHTML = buildObjectVisual(obj);

  // Object label
  const label = document.createElement("div");
  label.className = "object-label";
  label.textContent = obj.name;
  div.appendChild(label);

  // Loop-based style changes
  const loopCount = gameState.loopCount || 0;
  if (loopCount > 0 && obj.loopChange) {
    div.classList.add(`loop-${Math.min(loopCount, 3)}`);
  }

  // Already inspected?
  if (wasInspected(obj.id)) {
    div.classList.add("inspected");
  }

  // Attach interaction
  div.addEventListener("click", () => handleInteraction(obj, gameState));
  div.addEventListener("mouseenter", () => showObjectTooltip(obj.name, obj.reality));
  div.addEventListener("mouseleave", hideObjectTooltip);

  return div;
}

// ── Object visual builder (CSS-based, no external assets needed)
function buildObjectVisual(obj) {
  const shapes = {
    mirror:      `<div class="obj-shape mirror-shape"><div class="mirror-reflection"></div></div>`,
    clock:       `<div class="obj-shape clock-shape"><div class="clock-hand hour-hand"></div><div class="clock-hand minute-hand"></div></div>`,
    door:        `<div class="obj-shape door-shape"><div class="door-handle"></div><div class="door-crack"></div></div>`,
    photograph:  `<div class="obj-shape photo-shape"><div class="photo-figure"></div><div class="photo-figure blurred"></div></div>`,
    phone:       `<div class="obj-shape phone-shape"><div class="phone-screen"></div></div>`,
    window:      `<div class="obj-shape window-shape"><div class="window-pane"></div><div class="window-outside"></div></div>`,
    door_left:   `<div class="obj-shape door-shape left-variant"><div class="door-handle"></div></div>`,
    door_right:  `<div class="obj-shape door-shape right-variant"><div class="door-handle right"></div></div>`,
    morse_light: `<div class="obj-shape light-shape"><div class="light-glow"></div></div>`,
    the_other:   `<div class="obj-shape figure-shape"><div class="figure-head"></div><div class="figure-body"></div></div>`
  };
  return shapes[obj.id] || `<div class="obj-shape default-shape"></div>`;
}

// ── Handle object interaction ─────────────────────────────────
export function handleInteraction(obj, gameState, onUpdate) {
  const save = loadGame();
  const inspectIndex = Math.min(
    save.objectsInspected.filter(id => id === obj.id).length,
    (obj.dialogues?.length || 1) - 1
  );

  // Show dialogue
  const dialogue = obj.dialogues?.[inspectIndex] || obj.reality;
  showDialogue(obj.name, dialogue, obj.id);

  // Mark inspected
  markObjectInspected(obj.id);

  // Sanity effect
  if (obj.sanityEffect && onUpdate) {
    onUpdate("sanity", obj.sanityEffect);
  }

  // Glitch trigger
  if (obj.triggersGlitch) {
    const delay = obj.sanityEffect ? 800 : 200;
    setTimeout(() => {
      triggerGlitch("screen_shake", { duration: 500 });
      if (obj.glitchBehavior) applyObjectGlitch(obj);
    }, delay);
  }

  // Exit condition check
  if (obj.isExit) {
    return { action: "exit", levelData: obj };
  }

  // Door choice
  if (obj.id === "door_left")  return { action: "choice", value: "left_path" };
  if (obj.id === "door_right") return { action: "choice", value: "right_path" };

  return { action: "inspect", objectId: obj.id };
}

// ── Apply per-object glitch behavior ─────────────────────────
function applyObjectGlitch(obj) {
  const el = document.querySelector(`[data-object-id="${obj.id}"]`);
  if (!el) return;

  const behaviors = {
    reflection_delay: () => {
      el.classList.add("glitch-mirror");
      setTimeout(() => el.classList.remove("glitch-mirror"), 2000);
    },
    time_reverse: () => {
      const hands = el.querySelectorAll(".clock-hand");
      hands.forEach(h => h.classList.add("reverse-spin"));
      setTimeout(() => hands.forEach(h => h.classList.remove("reverse-spin")), 3000);
    },
    loop_return: () => triggerGlitch("reality_tear"),
    phantom_message: () => {
      el.querySelector(".phone-screen")?.classList.add("has-message");
      triggerGlitch("text_glitch", { message: "DON'T OPEN THE DOOR", duration: 2500 });
    },
    face_morph: () => {
      const figures = el.querySelectorAll(".photo-figure");
      figures.forEach(f => f.classList.add("morphing"));
      setTimeout(() => figures.forEach(f => f.classList.remove("morphing")), 2000);
    },
    infinite_room: () => {
      el.querySelector(".window-outside")?.classList.add("infinite");
      triggerGlitch("rgb_split", { duration: 1200, amount: 12 });
    }
  };

  behaviors[obj.glitchBehavior]?.();
}

// ── Show dialogue box ────────────────────────────────────────
export function showDialogue(speaker, text, objectId) {
  const box = document.getElementById("dialogue-box");
  if (!box) return;

  const speakerEl = box.querySelector(".dialogue-speaker");
  const textEl = box.querySelector(".dialogue-text");

  if (speakerEl) speakerEl.textContent = speaker;
  if (textEl) {
    textEl.textContent = "";
    scrambleText(textEl, text, 600);
  }

  box.classList.add("visible");
  box.setAttribute("data-object", objectId);

  // Auto-hide after 4 seconds
  clearTimeout(box._hideTimer);
  box._hideTimer = setTimeout(() => hideDialogue(), 4000);
}

// ── Hide dialogue ────────────────────────────────────────────
export function hideDialogue() {
  const box = document.getElementById("dialogue-box");
  if (box) box.classList.remove("visible");
}

// ── Tooltip helpers ──────────────────────────────────────────
function showObjectTooltip(name, desc) {
  let tip = document.getElementById("obj-tooltip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "obj-tooltip";
    document.body.appendChild(tip);
  }
  tip.innerHTML = `<strong>${name}</strong><br><small>${desc}</small>`;
  tip.classList.add("visible");
}

function hideObjectTooltip() {
  document.getElementById("obj-tooltip")?.classList.remove("visible");
}

// ── Loop indicator ───────────────────────────────────────────
function showLoopIndicator(loopCount, messages) {
  const msg = messages?.[Math.min(loopCount, messages.length - 1)];
  if (!msg) return;

  const el = document.getElementById("loop-indicator");
  if (el) {
    el.textContent = msg;
    el.classList.add("visible");
    setTimeout(() => el.classList.remove("visible"), 3000);
  }
}

// ── Animate level transition ─────────────────────────────────
export function transitionToLevel(levelId, callback) {
  const container = document.getElementById("game-container");
  container?.classList.add("transitioning");

  setTimeout(() => {
    callback(levelId);
    container?.classList.remove("transitioning");
  }, 800);
}

// ── Update sanity bar UI ─────────────────────────────────────
export function updateSanityBar(sanity) {
  const bar = document.getElementById("sanity-fill");
  const label = document.getElementById("sanity-value");

  if (bar) {
    bar.style.width = `${sanity}%`;
    bar.className = "sanity-fill " + (sanity > 60 ? "high" : sanity > 30 ? "mid" : "low");
  }
  if (label) label.textContent = Math.round(sanity);

  applySanityAmbience(sanity);
}
