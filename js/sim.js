// Cellular-automaton simulation engine.
import {
  EMPTY, WALL, SAND, WATER, OIL, FIRE, STEAM, SMOKE, PLANT, SEED, WOOD,
  ACID, STONE, LAVA, TARGET,
  DENSITY, isLiquid, isGas, FLAMMABILITY, FUEL_LIFE, DISSOLVABLE,
} from './elements.js';

const NEIGH4 = [[0, -1], [0, 1], [-1, 0], [1, 0]];

export class Sim {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.grid = new Uint8Array(w * h);
    this.aux = new Uint8Array(w * h);   // fire/gas lifetime
    this.moved = new Uint8Array(w * h); // processed-this-frame flag
    this.frame = 0;
    this.sprouted = 0; // seeds that became plants this level
    this.counts = new Uint32Array(16);
    this.emitters = []; // {x, y, w, el, every, until}
  }

  reset() {
    this.grid.fill(EMPTY);
    this.aux.fill(0);
    this.frame = 0;
    this.sprouted = 0;
    this.emitters = [];
  }

  idx(x, y) { return y * this.w + x; }
  inBounds(x, y) { return x >= 0 && x < this.w && y >= 0 && y < this.h; }
  get(x, y) { return this.inBounds(x, y) ? this.grid[y * this.w + x] : WALL; }

  set(x, y, e, life = 0) {
    if (!this.inBounds(x, y)) return;
    const i = y * this.w + x;
    this.grid[i] = e;
    this.aux[i] = life;
  }

  swap(i, j) {
    const g = this.grid, a = this.aux;
    const tg = g[i]; g[i] = g[j]; g[j] = tg;
    const ta = a[i]; a[i] = a[j]; a[j] = ta;
    this.moved[i] = 1;
    this.moved[j] = 1;
  }

  // A cell that falling matter can displace: empty or a gas.
  passable(e) { return e === EMPTY || e === STEAM || e === SMOKE; }

  step() {
    const { w, h, grid, aux, moved } = this;
    moved.fill(0);
    this.frame++;
    const ltr = (this.frame & 1) === 0;

    for (const em of this.emitters) {
      if (this.frame <= em.until && this.frame % em.every === 0) {
        for (let x = em.x; x < em.x + em.w; x++) {
          if (this.get(x, em.y) === EMPTY) this.set(x, em.y, em.el);
        }
      }
    }

    for (let y = h - 1; y >= 0; y--) {
      const row = y * w;
      for (let k = 0; k < w; k++) {
        const x = ltr ? k : w - 1 - k;
        const i = row + x;
        if (moved[i]) continue;
        const e = grid[i];
        if (e === EMPTY || e === WALL || e === WOOD) continue;
        switch (e) {
          case SAND: case STONE: case SEED: this.updatePowder(x, y, i, e); break;
          case WATER: case OIL: case ACID: case LAVA: this.updateLiquid(x, y, i, e); break;
          case FIRE: this.updateFire(x, y, i); break;
          case STEAM: case SMOKE: this.updateGas(x, y, i, e); break;
          case PLANT: this.updatePlant(x, y, i); break;
          case TARGET: break;
          default: break;
        }
      }
    }

    // Recount every step (cheap; used by goals and HUD).
    this.counts.fill(0);
    for (let i = 0; i < grid.length; i++) this.counts[grid[i]]++;
  }

  densityOf(e) { return DENSITY[e] ?? 0; }

  // Try to fall into (nx,ny): move into empty/gas, or sink through lighter liquid.
  tryFall(i, nx, ny, myDensity, sinkChance) {
    const e2 = this.get(nx, ny);
    const j = ny * this.w + nx;
    if (this.passable(e2)) { this.swap(i, j); return true; }
    if (isLiquid(e2) && this.densityOf(e2) < myDensity && Math.random() < sinkChance) {
      this.swap(i, j);
      return true;
    }
    return false;
  }

  updatePowder(x, y, i, e) {
    if (e === SEED && this.trySprout(x, y, i)) return;
    const d = this.densityOf(e);
    if (this.tryFall(i, x, y + 1, d, 0.6)) return;
    if (e === STONE) return; // stone stacks in columns, no diagonal slide
    const dir = Math.random() < 0.5 ? 1 : -1;
    if (this.tryFall(i, x + dir, y + 1, d, 0.3)) return;
    this.tryFall(i, x - dir, y + 1, d, 0.3);
  }

  trySprout(x, y, i) {
    for (const [dx, dy] of NEIGH4) {
      if (this.get(x + dx, y + dy) === WATER) {
        this.grid[i] = PLANT;
        this.aux[i] = 0;
        this.sprouted++;
        // Consume the water into a sprout for visible feedback.
        this.set(x + dx, y + dy, PLANT);
        return true;
      }
    }
    return false;
  }

  updateLiquid(x, y, i, e) {
    if (e === LAVA && this.lavaReact(x, y, i)) return;
    if (e === ACID) this.acidReact(x, y);

    const d = this.densityOf(e);
    if (this.tryFall(i, x, y + 1, d, 0.35)) return;
    const dir = Math.random() < 0.5 ? 1 : -1;
    if (this.tryFall(i, x + dir, y + 1, d, 0.2)) return;
    if (this.tryFall(i, x - dir, y + 1, d, 0.2)) return;

    // Horizontal dispersion: slide toward the farthest reachable gap.
    const disp = e === LAVA ? 1 : e === WATER ? 5 : 3;
    let tx = x;
    for (let s = 1; s <= disp; s++) {
      const nx = x + dir * s;
      if (!this.passable(this.get(nx, y))) break;
      tx = nx;
      // Prefer to spill over an edge as soon as one appears.
      if (this.passable(this.get(nx, y + 1))) break;
    }
    if (tx !== x) this.swap(i, y * this.w + tx);
  }

  lavaReact(x, y, i) {
    for (const [dx, dy] of NEIGH4) {
      const nx = x + dx, ny = y + dy;
      const n = this.get(nx, ny);
      if (n === WATER) {
        this.grid[i] = STONE;
        this.aux[i] = 0;
        this.set(nx, ny, STEAM, 90 + (Math.random() * 80 | 0));
        return true;
      }
      const fl = FLAMMABILITY[n];
      if (fl && Math.random() < fl) {
        this.set(nx, ny, FIRE, FUEL_LIFE[n]);
      }
    }
    return false;
  }

  acidReact(x, y) {
    for (const [dx, dy] of NEIGH4) {
      const nx = x + dx, ny = y + dy;
      const n = this.get(nx, ny);
      if (DISSOLVABLE.has(n) && Math.random() < 0.5) {
        this.set(nx, ny, Math.random() < 0.15 ? SMOKE : EMPTY,
          Math.random() < 0.15 ? 40 : 0);
        if (Math.random() < 0.28) this.set(x, y, EMPTY); // acid is consumed
        return;
      }
    }
  }

  updateFire(x, y, i) {
    const { grid, aux } = this;
    // Spread to flammable neighbors; steam off adjacent water.
    let nearFuel = false;
    for (const [dx, dy] of NEIGH4) {
      const nx = x + dx, ny = y + dy;
      const n = this.get(nx, ny);
      if (n === WATER) {
        // Directional dousing so oil slicks can burn ON water: water from
        // above always wins, from the side sometimes, from below it only
        // simmers into steam.
        if (dy === -1 || (dy === 0 && Math.random() < 0.25)) {
          this.set(nx, ny, Math.random() < 0.5 ? STEAM : WATER, 100);
          grid[i] = SMOKE;
          aux[i] = 30 + (Math.random() * 20 | 0);
          return;
        }
        if (dy === 1 && Math.random() < 0.02) {
          this.set(nx, ny, STEAM, 100);
        }
        continue;
      }
      const fl = FLAMMABILITY[n];
      if (fl) {
        nearFuel = true;
        if (Math.random() < fl) this.set(nx, ny, FIRE, FUEL_LIFE[n]);
      }
    }

    if (aux[i] > 0) aux[i]--;
    if (aux[i] === 0) {
      grid[i] = Math.random() < 0.3 ? SMOKE : EMPTY;
      aux[i] = grid[i] === SMOKE ? 30 + (Math.random() * 30 | 0) : 0;
      return;
    }

    if (nearFuel) {
      // Burning fuel stays put and emits short-lived flames above.
      const up = this.get(x, y - 1);
      if (up === EMPTY && Math.random() < 0.4) {
        this.set(x, y - 1, FIRE, 4 + (Math.random() * 8 | 0));
      }
    } else {
      // Free flame: flickers upward and dies fast.
      const dir = Math.random() < 0.5 ? 1 : -1;
      const cands = [[x, y - 1], [x + dir, y - 1], [x - dir, y - 1]];
      for (const [nx, ny] of cands) {
        if (this.get(nx, ny) === EMPTY && Math.random() < 0.7) {
          this.swap(i, ny * this.w + nx);
          return;
        }
      }
    }
  }

  updateGas(x, y, i, e) {
    const { grid, aux } = this;
    if (aux[i] > 0) aux[i]--;
    if (aux[i] === 0) {
      if (e === STEAM && Math.random() < 0.35) {
        grid[i] = WATER;
      } else {
        grid[i] = EMPTY;
      }
      return;
    }

    // Steam trapped under a solid slowly condenses and drips.
    if (e === STEAM) {
      const up = this.get(x, y - 1);
      if ((up === WALL || up === WOOD || up === STONE) && Math.random() < 0.03) {
        grid[i] = WATER;
        aux[i] = 0;
        return;
      }
    }

    const dir = Math.random() < 0.5 ? 1 : -1;
    const cands = Math.random() < 0.8
      ? [[x, y - 1], [x + dir, y - 1], [x + dir, y]]
      : [[x + dir, y], [x, y - 1], [x - dir, y]];
    for (const [nx, ny] of cands) {
      const n = this.get(nx, ny);
      if (n === EMPTY) { this.swap(i, ny * this.w + nx); return; }
      // Gases bubble up through liquids.
      if (isLiquid(n) && ny === y - 1 && Math.random() < 0.4) {
        this.swap(i, ny * this.w + nx);
        return;
      }
    }
  }

  updatePlant(x, y, i) {
    // Grow into adjacent water occasionally.
    for (const [dx, dy] of NEIGH4) {
      const nx = x + dx, ny = y + dy;
      if (this.get(nx, ny) === WATER && Math.random() < 0.06) {
        this.set(nx, ny, PLANT);
      }
    }
  }

  // Count cells of a given element inside a rect zone.
  zoneCount(zone, e) {
    let n = 0;
    const x1 = Math.min(zone.x + zone.w, this.w);
    const y1 = Math.min(zone.y + zone.h, this.h);
    for (let y = zone.y; y < y1; y++) {
      for (let x = zone.x; x < x1; x++) {
        if (this.grid[y * this.w + x] === e) n++;
      }
    }
    return n;
  }

  // Paint a filled circle of element e. Only overwrites EMPTY unless
  // overwrite is true (sandbox). mask marks cells the player cannot paint.
  // Returns number of cells changed.
  paint(cx, cy, r, e, overwrite = false, mask = null) {
    let n = 0;
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const x = cx + dx, y = cy + dy;
        if (!this.inBounds(x, y)) continue;
        const i = y * this.w + x;
        if (mask && mask[i]) continue;
        const cur = this.grid[i];
        if (e === EMPTY) { // eraser
          if (cur !== EMPTY) { this.grid[i] = EMPTY; this.aux[i] = 0; n++; }
          continue;
        }
        if (cur === EMPTY || (overwrite && cur !== e && cur !== WALL)) {
          this.grid[i] = e;
          this.aux[i] = e === FIRE ? 40 + (Math.random() * 20 | 0)
            : (e === STEAM || e === SMOKE) ? 80 + (Math.random() * 60 | 0) : 0;
          n++;
        }
      }
    }
    return n;
  }
}
