// ============================================================
// routes/levels.js — Level API Routes
// World Between Us | Separate Module
// ============================================================

const express = require("express");
const path    = require("path");
const fs      = require("fs");
const router  = express.Router();

// ── Load levels.json once ─────────────────────────────────────
let levelsCache = null;
function getLevels() {
  if (levelsCache) return levelsCache;
  const filePath = path.join(__dirname, "../../frontend/data/levels.json");
  levelsCache = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return levelsCache;
}

// ── GET /api/levels — All levels (stripped for performance) ───
router.get("/levels", (req, res) => {
  try {
    const { levels } = getLevels();
    // Return stripped version for level select screen
    const summary = levels.map(({ id, title, scene, atmosphere }) => ({
      id, title, scene, atmosphere
    }));
    res.json({ levels: summary, total: levels.length });
  } catch (e) {
    res.status(500).json({ error: "Could not load levels" });
  }
});

// ── GET /api/level/:id — Full level data ──────────────────────
router.get("/level/:id", (req, res) => {
  const levelId = parseInt(req.params.id, 10);
  if (isNaN(levelId) || levelId < 1) {
    return res.status(400).json({ error: "Invalid level ID" });
  }

  try {
    const { levels } = getLevels();
    const level = levels.find(l => l.id === levelId);

    if (!level) return res.status(404).json({ error: "Level not found" });

    res.json(level);
  } catch (e) {
    res.status(500).json({ error: "Could not load level" });
  }
});

// ── GET /api/next-level/:id — Next level or null ──────────────
router.get("/next-level/:id", (req, res) => {
  const currentId = parseInt(req.params.id, 10);

  try {
    const { levels } = getLevels();
    const next = levels.find(l => l.id === currentId + 1);

    if (!next) return res.json({ level: null, message: "Game complete" });

    res.json({ level: { id: next.id, title: next.title, scene: next.scene } });
  } catch (e) {
    res.status(500).json({ error: "Could not load next level" });
  }
});

module.exports = router;
