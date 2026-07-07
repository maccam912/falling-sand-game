// Game shell: rendering, input, HUD, level flow.
import {
  EMPTY, WALL, FIRE, STEAM, SMOKE, WATER, OIL, ACID, LAVA, TARGET, ERASER,
  NAMES, COLORS,
} from './elements.js';
import { Sim } from './sim.js';
import { LEVELS, SANDBOX, GRID_W, GRID_H, buildLevel } from './levels.js';

const W = GRID_W, H = GRID_H;
const sim = new Sim(W, H);

// ---------- DOM ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const off = document.createElement('canvas');
off.width = W; off.height = H;
const offCtx = off.getContext('2d');
const img = offCtx.createImageData(W, H);

const els = {
  title: document.getElementById('level-title'),
  toolbar: document.getElementById('toolbar'),
  brushBtn: document.getElementById('brush-btn'),
  pauseBtn: document.getElementById('pause-btn'),
  resetBtn: document.getElementById('reset-btn'),
  menuBtn: document.getElementById('menu-btn'),
  overlay: document.getElementById('overlay'),
  stage: document.getElementById('stage'),
};

// ---------- state ----------
const PROGRESS_KEY = 'fsg-progress-v1';
let unlocked = Math.min(parseInt(localStorage.getItem(PROGRESS_KEY) || '0', 10) || 0, LEVELS.length);
let levelIndex = -1;          // -1 = sandbox
let level = null;
let mode = 'menu';            // menu | playing | won | failed
let paused = false;
let budget = new Map();       // element -> remaining cells
let tool = null;              // selected element id
let brushIdx = 1;
const BRUSHES = [1, 2, 3];
let winStreak = 0;            // consecutive successful win checks
let startFrame = 0;
let noPaintMask = null;       // Uint8Array; 1 = player cannot paint here

// Per-cell static noise for texture; second table for shimmer.
const noise = new Float32Array(W * H);
for (let i = 0; i < noise.length; i++) noise[i] = 0.85 + Math.random() * 0.3;
const shimmer = new Float32Array(4096);
for (let i = 0; i < shimmer.length; i++) shimmer[i] = 0.85 + Math.random() * 0.3;

// ---------- rendering ----------
function render() {
  const data = img.data;
  const g = sim.grid, aux = sim.aux, f = sim.frame;
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    const e = g[i];
    let r, gg, b;
    if (e === FIRE) {
      const life = aux[i];
      const t = Math.min(life / 30, 1);
      r = 255; gg = 90 + 130 * t + ((i * 7 + f * 13) % 40); b = 20 + 40 * t;
    } else if (e === LAVA) {
      const n = shimmer[(i + f * 5) & 4095];
      r = 236 * n; gg = 84 * n; b = 26;
    } else {
      const c = COLORS[e];
      const dyn = (e === WATER || e === OIL || e === ACID || e === STEAM || e === SMOKE);
      const n = dyn ? shimmer[(i * 31 + f * 3) & 4095] : noise[i];
      r = c[0] * n; gg = c[1] * n; b = c[2] * n;
      if (e === TARGET) { // gentle pulse so goals read as special
        const pulse = 0.85 + 0.15 * Math.sin(f * 0.1 + i);
        r *= pulse; gg *= pulse; b *= pulse;
      }
    }
    data[p] = r; data[p + 1] = gg; data[p + 2] = b; data[p + 3] = 255;
  }
  offCtx.putImageData(img, 0, 0);

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);

  const sx = canvas.width / W, sy = canvas.height / H;

  // out-of-reach veil
  if (level && level.noPaint) {
    ctx.save();
    ctx.fillStyle = 'rgba(90, 110, 160, 0.13)';
    ctx.strokeStyle = 'rgba(140, 160, 210, 0.35)';
    ctx.setLineDash([2, 4]);
    ctx.lineWidth = 1;
    for (const z of level.noPaint) {
      ctx.fillRect(z.x * sx, z.y * sy, z.w * sx, z.h * sy);
      ctx.strokeRect(z.x * sx, z.y * sy, z.w * sx, z.h * sy);
    }
    ctx.restore();
  }

  // zone outlines
  if (level && level.zones) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 2;
    ctx.font = `${Math.round(11 * (window.devicePixelRatio || 1))}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (const z of level.zones) {
      ctx.strokeRect(z.x * sx, z.y * sy, z.w * sx, z.h * sy);
      if (z.label) ctx.fillText(z.label, z.x * sx + 4, z.y * sy - 5);
    }
    ctx.restore();
  }
}

function resize() {
  const rect = els.stage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  // Fit grid aspect (3:4) inside the stage.
  const scale = Math.min(rect.width / W, rect.height / H);
  const cssW = Math.floor(W * scale), cssH = Math.floor(H * scale);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
}
window.addEventListener('resize', resize);

// ---------- input ----------
let painting = false;
let lastCell = null;

function cellFromEvent(ev) {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor((ev.clientX - r.left) / r.width * W);
  const y = Math.floor((ev.clientY - r.top) / r.height * H);
  return [x, y];
}

function paintAt(x, y) {
  if (tool == null || mode !== 'playing') return;
  const isSandbox = levelIndex === -1;
  const e = tool === ERASER ? EMPTY : tool;
  const rem = budget.get(tool) ?? 0;
  if (rem <= 0) return;
  const r = BRUSHES[brushIdx];
  const n = sim.paint(x, y, r, e, isSandbox, noPaintMask);
  if (tool !== ERASER && rem !== Infinity) {
    // The final stamp may exceed the budget by a few cells; that's fine.
    budget.set(tool, Math.max(0, rem - n));
    updateToolbar();
  }
}

function strokeTo(x, y) {
  if (!lastCell) { paintAt(x, y); lastCell = [x, y]; return; }
  const [x0, y0] = lastCell;
  const steps = Math.max(Math.abs(x - x0), Math.abs(y - y0), 1);
  for (let s = 1; s <= steps; s++) {
    paintAt(Math.round(x0 + (x - x0) * s / steps), Math.round(y0 + (y - y0) * s / steps));
  }
  lastCell = [x, y];
}

canvas.addEventListener('pointerdown', (ev) => {
  ev.preventDefault();
  canvas.setPointerCapture(ev.pointerId);
  painting = true;
  lastCell = null;
  const [x, y] = cellFromEvent(ev);
  strokeTo(x, y);
});
canvas.addEventListener('pointermove', (ev) => {
  if (!painting) return;
  ev.preventDefault();
  const [x, y] = cellFromEvent(ev);
  strokeTo(x, y);
});
const endPaint = () => { painting = false; lastCell = null; };
canvas.addEventListener('pointerup', endPaint);
canvas.addEventListener('pointercancel', endPaint);

// ---------- toolbar ----------
function fmtBudget(n) { return n === Infinity ? '∞' : String(n); }

function updateToolbar() {
  for (const chip of els.toolbar.querySelectorAll('.chip')) {
    const e = Number(chip.dataset.el);
    const rem = budget.get(e) ?? 0;
    chip.querySelector('.chip-count').textContent = fmtBudget(rem);
    chip.classList.toggle('selected', tool === e);
    chip.classList.toggle('depleted', rem <= 0);
  }
}

function chipColor(e) {
  if (e === ERASER) return '#20242e';
  const c = COLORS[e];
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function buildToolbar() {
  els.toolbar.innerHTML = '';
  for (const [e] of level.budget) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.dataset.el = e;
    chip.innerHTML = `<span class="chip-dot" style="background:${chipColor(e)}"></span>` +
      `<span class="chip-name">${NAMES[e]}</span><span class="chip-count"></span>`;
    chip.addEventListener('click', () => { tool = e; updateToolbar(); });
    els.toolbar.appendChild(chip);
  }
  updateToolbar();
}

els.brushBtn.addEventListener('click', () => {
  brushIdx = (brushIdx + 1) % BRUSHES.length;
  els.brushBtn.textContent = ['•', '●', '⬤'][brushIdx];
});
els.pauseBtn.addEventListener('click', () => {
  paused = !paused;
  els.pauseBtn.textContent = paused ? '▶' : '⏸';
});
els.resetBtn.addEventListener('click', () => { if (level) startLevel(levelIndex, true); });
els.menuBtn.addEventListener('click', showMenu);

// ---------- overlays / flow ----------
function showOverlay(html) {
  els.overlay.innerHTML = html;
  els.overlay.classList.remove('hidden');
}
function hideOverlay() { els.overlay.classList.add('hidden'); }

function showMenu() {
  mode = 'menu';
  let rows = '';
  for (let i = 0; i < LEVELS.length; i++) {
    const locked = i > unlocked;
    const done = i < unlocked;
    rows += `<button class="level-btn${locked ? ' locked' : ''}" data-level="${i}" ${locked ? 'disabled' : ''}>` +
      `<span class="level-num">${i + 1}</span><span>${LEVELS[i].name}</span>` +
      `<span class="level-mark">${done ? '✓' : locked ? '🔒' : ''}</span></button>`;
  }
  showOverlay(`
    <div class="panel menu-panel">
      <h1 class="game-title">Grainfall</h1>
      <p class="subtitle">a falling-sand puzzle game</p>
      <div class="level-list">${rows}</div>
      <button class="level-btn sandbox-btn" data-level="-1">
        <span class="level-num">∞</span><span>Sandbox</span><span class="level-mark"></span>
      </button>
    </div>`);
  for (const btn of els.overlay.querySelectorAll('[data-level]')) {
    btn.addEventListener('click', () => startLevel(Number(btn.dataset.level)));
  }
}

function startLevel(i, skipIntro = false) {
  levelIndex = i;
  level = i === -1 ? SANDBOX : LEVELS[i];
  buildLevel(sim, level);
  noPaintMask = null;
  if (level.noPaint) {
    noPaintMask = new Uint8Array(W * H);
    for (const z of level.noPaint) {
      for (let y = z.y; y < z.y + z.h && y < H; y++)
        for (let x = z.x; x < z.x + z.w && x < W; x++) noPaintMask[y * W + x] = 1;
    }
  }
  budget = new Map(level.budget);
  tool = level.budget.length ? level.budget[0][0] : null;
  // Skip the first tool if it has zero budget (display-only entries).
  if (tool != null && (budget.get(tool) ?? 0) <= 0) {
    const alt = level.budget.find(([, n]) => n > 0);
    tool = alt ? alt[0] : null;
  }
  paused = false;
  els.pauseBtn.textContent = '⏸';
  winStreak = 0;
  startFrame = sim.frame;
  els.title.textContent = i === -1 ? 'Sandbox' : `${i + 1}. ${level.name}`;
  buildToolbar();
  mode = 'playing';
  if (skipIntro) { hideOverlay(); return; }
  paused = true; // time stands still while the intro is up
  showOverlay(`
    <div class="panel">
      <h2>${i === -1 ? '' : `Level ${i + 1}: `}${level.name}</h2>
      <p class="desc">${level.desc}</p>
      <button class="big-btn" id="go-btn">Go</button>
    </div>`);
  document.getElementById('go-btn').addEventListener('click', () => {
    paused = false;
    els.pauseBtn.textContent = '⏸';
    hideOverlay();
  });
}

function onWin() {
  mode = 'won';
  if (levelIndex >= 0 && levelIndex + 1 > unlocked) {
    unlocked = levelIndex + 1;
    localStorage.setItem(PROGRESS_KEY, String(unlocked));
  }
  const last = levelIndex >= LEVELS.length - 1;
  showOverlay(`
    <div class="panel">
      <h2>✨ Solved!</h2>
      <p class="desc">${last ? 'That was the last level — you beat the game! Sandbox is all yours.' : level.name + ' complete.'}</p>
      <div class="btn-row">
        <button class="big-btn ghost" id="again-btn">Replay</button>
        <button class="big-btn" id="next-btn">${last ? 'Sandbox' : 'Next level'}</button>
      </div>
    </div>`);
  document.getElementById('next-btn').addEventListener('click', () =>
    startLevel(last ? -1 : levelIndex + 1));
  document.getElementById('again-btn').addEventListener('click', () =>
    startLevel(levelIndex, true));
}

function onFail(reason) {
  mode = 'failed';
  showOverlay(`
    <div class="panel">
      <h2>💥 Failed</h2>
      <p class="desc">${reason}</p>
      <button class="big-btn" id="retry-btn">Try again</button>
    </div>`);
  document.getElementById('retry-btn').addEventListener('click', () =>
    startLevel(levelIndex, true));
}

// ---------- loop ----------
function tick() {
  if (mode === 'playing' || mode === 'menu') {
    if (!paused) sim.step();
    if (mode === 'playing' && levelIndex !== -1 && sim.frame % 10 === 0 && !paused) {
      if (sim.frame - startFrame > 90) {
        const reason = level.fail(sim);
        if (reason) { render(); onFail(reason); requestAnimationFrame(tick); return; }
      }
      if (level.win(sim)) {
        winStreak++;
        if (winStreak >= 3) { render(); onWin(); requestAnimationFrame(tick); return; }
      } else {
        winStreak = 0;
      }
    }
  }
  render();
  requestAnimationFrame(tick);
}

// ---------- pwa ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// ---------- boot ----------
resize();
startLevel(unlocked >= LEVELS.length ? -1 : unlocked, true);
showMenu();
requestAnimationFrame(tick);

// Test hooks (used by automated validation; harmless in production).
window.__game = {
  sim, startLevel, LEVELS,
  get mode() { return mode; },
  get levelIndex() { return levelIndex; },
  paint: (x, y, r, e) => sim.paint(x, y, r, e, true),
  steps: (n) => { for (let i = 0; i < n; i++) sim.step(); },
  setUnlocked: (n) => { unlocked = n; localStorage.setItem(PROGRESS_KEY, String(n)); },
};
