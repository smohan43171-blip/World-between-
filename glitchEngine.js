// ============================================================
// glitchEngine.js — All Glitch / Visual Effect Functions
// World Between Us | Separate Module
// ============================================================

// ── Master glitch controller ─────────────────────────────────
export function triggerGlitch(type, options = {}) {
  const effects = {
    screen_shake: screenShake,
    color_invert:  colorInvert,
    text_glitch:   textGlitch,
    object_shift:  objectShift,
    scanlines:     scanlines,
    static_burst:  staticBurst,
    rgb_split:     rgbSplit,
    flicker:       flicker,
    reality_tear:  realityTear
  };
  const fn = effects[type];
  if (fn) fn(options);
}

// ── Screen shake ─────────────────────────────────────────────
export function screenShake(options = {}) {
  const { duration = 800, intensity = 10 } = options;
  const gameContainer = document.getElementById("game-container");
  if (!gameContainer) return;

  gameContainer.style.setProperty("--shake-intensity", `${intensity}px`);
  gameContainer.classList.add("screen-shake");
  setTimeout(() => gameContainer.classList.remove("screen-shake"), duration);
}

// ── Color invert flash ───────────────────────────────────────
export function colorInvert(options = {}) {
  const { duration = 300 } = options;
  const overlay = getOrCreateOverlay("invert-overlay");
  overlay.style.cssText = `
    position:fixed; inset:0; background:white; mix-blend-mode:difference;
    opacity:1; pointer-events:none; z-index:9999; transition:opacity ${duration}ms;
  `;
  overlay.style.opacity = "1";
  setTimeout(() => { overlay.style.opacity = "0"; }, 50);
  setTimeout(() => overlay.remove(), duration + 100);
}

// ── Text glitch on screen ────────────────────────────────────
export function textGlitch(options = {}) {
  const { message = "ERROR", duration = 2000 } = options;
  const el = getOrCreateOverlay("glitch-text-overlay");
  el.innerHTML = `<div class="glitch-message" data-text="${message}">${message}</div>`;
  el.style.cssText = `
    position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
    pointer-events:none; z-index:9998; background:transparent;
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ── Object position shift ────────────────────────────────────
export function objectShift(options = {}) {
  const { targets = [], duration = 1200 } = options;
  targets.forEach(id => {
    const el = document.querySelector(`[data-object-id="${id}"]`);
    if (!el) return;
    const dx = (Math.random() - 0.5) * 40;
    const dy = (Math.random() - 0.5) * 20;
    el.style.transition = `transform ${duration / 3}ms ease`;
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    setTimeout(() => {
      el.style.transform = "translate(0,0)";
    }, duration);
  });
}

// ── Scanlines overlay ────────────────────────────────────────
export function scanlines(options = {}) {
  const { duration = 3000, opacity = 0.15 } = options;
  const el = getOrCreateOverlay("scanlines-overlay");
  el.style.cssText = `
    position:fixed; inset:0; pointer-events:none; z-index:9990;
    background: repeating-linear-gradient(
      0deg, transparent, transparent 2px,
      rgba(0,0,0,${opacity}) 2px, rgba(0,0,0,${opacity}) 4px
    );
    opacity:1;
  `;
  document.body.appendChild(el);
  if (duration > 0) {
    setTimeout(() => {
      el.style.transition = "opacity 500ms";
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 600);
    }, duration);
  }
}

// ── Static noise burst ───────────────────────────────────────
export function staticBurst(options = {}) {
  const { duration = 400 } = options;
  const el = getOrCreateOverlay("static-overlay");
  el.style.cssText = `
    position:fixed; inset:0; pointer-events:none; z-index:9995;
    animation: staticNoise ${duration}ms steps(4) forwards;
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), duration + 50);
}

// ── RGB split / chromatic aberration ────────────────────────
export function rgbSplit(options = {}) {
  const { duration = 600, amount = 8 } = options;
  const container = document.getElementById("game-container");
  if (!container) return;

  container.style.setProperty("--rgb-amount", `${amount}px`);
  container.classList.add("rgb-split");
  setTimeout(() => container.classList.remove("rgb-split"), duration);
}

// ── Flicker effect ───────────────────────────────────────────
export function flicker(options = {}) {
  const { duration = 1500, target = "game-container" } = options;
  const el = document.getElementById(target) || document.querySelector(`[data-object-id="${target}"]`);
  if (!el) return;
  el.classList.add("flickering");
  setTimeout(() => el.classList.remove("flickering"), duration);
}

// ── Reality tear — diagonal rip effect ──────────────────────
export function realityTear(options = {}) {
  const { duration = 1800 } = options;
  const el = getOrCreateOverlay("tear-overlay");
  const x = 20 + Math.random() * 60;
  el.style.cssText = `
    position:fixed; inset:0; pointer-events:none; z-index:9997;
    background: linear-gradient(
      ${90 + (Math.random() - 0.5) * 30}deg,
      transparent ${x - 1}%, rgba(255,255,255,0.9) ${x}%,
      rgba(0,255,200,0.3) ${x + 0.5}%, transparent ${x + 2}%
    );
    animation: tearFade ${duration}ms ease-out forwards;
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), duration + 50);
}

// ── Sanity-based ambient glitch ──────────────────────────────
export function applySanityAmbience(sanity) {
  const container = document.getElementById("game-container");
  if (!container) return;

  // Remove all sanity classes
  container.classList.remove("sanity-high", "sanity-mid", "sanity-low", "sanity-critical");

  if (sanity > 75) container.classList.add("sanity-high");
  else if (sanity > 50) container.classList.add("sanity-mid");
  else if (sanity > 25) container.classList.add("sanity-low");
  else container.classList.add("sanity-critical");

  // Update CSS variable for dynamic effects
  container.style.setProperty("--sanity", sanity / 100);
  container.style.setProperty("--glitch-intensity", (1 - sanity / 100) * 2);
}

// ── Glitch text character scramble ───────────────────────────
export function scrambleText(element, finalText, duration = 800) {
  const chars = "!@#$%^&*∂∆◊∑≈Ω≤≥∞§¶•";
  const steps = 20;
  const interval = duration / steps;
  let step = 0;

  const timer = setInterval(() => {
    const progress = step / steps;
    element.textContent = finalText
      .split("")
      .map((char, i) =>
        i < finalText.length * progress
          ? char
          : chars[Math.floor(Math.random() * chars.length)]
      )
      .join("");
    step++;
    if (step > steps) {
      element.textContent = finalText;
      clearInterval(timer);
    }
  }, interval);
}

// ── Reflection delay simulation ──────────────────────────────
export function applyReflectionDelay(mirrorEl, delay = 1500) {
  if (!mirrorEl) return;
  mirrorEl.style.transition = `filter ${delay}ms ease`;
  mirrorEl.style.filter = "hue-rotate(180deg) brightness(0.7)";
  setTimeout(() => {
    mirrorEl.style.filter = "hue-rotate(0deg) brightness(1)";
  }, delay);
}

// ── Helper: get or create overlay element ────────────────────
function getOrCreateOverlay(id) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    document.body.appendChild(el);
  }
  return el;
}

// ── Trigger full glitch sequence from level data ─────────────
export function runGlitchSequence(sequence) {
  if (!sequence || !sequence.events) return;
  let delay = 0;
  sequence.events.forEach(event => {
    setTimeout(() => triggerGlitch(event.type, event), delay);
    delay += (event.duration || 1000) + 200;
  });
},function triggerScreenShake(duration = 200) {
    const gameContainer = document.body; // or your game div
    gameContainer.classList.add('shake');
    
    setTimeout(() => {
        gameContainer.classList.remove('shake');
    }, duration);
}
