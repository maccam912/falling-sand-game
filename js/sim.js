// Cellular-automaton simulation engine with momentum and an air-pressure field.
//
// Movable cells (liquids, powders) carry a velocity (vx, vy). Falling builds
// vertical speed; impacts convert it into sideways slosh; horizontal flow
// keeps its momentum and bounces off walls, so liquids slosh back and forth
// instead of instantly levelling.
//
// Gases live in a scalar pressure field: steam and fire pump pressure into
// the air around them, pressure diffuses through open cells (walls block it),
// and both gases and liquid surfaces feel the gradient. A sealed boiler
// builds pressure until it can shove water up a pipe; explosions inject a
// blast wave that flings everything nearby.
import {
  EMPTY, WALL, SAND, WATER, OIL, FIRE, STEAM, SMOKE, PLANT, SEED, WOOD,
  ACID, STONE, LAVA, TARGET, ICE, SNOW, GUNPOWDER, GAS, HONEY, GLASS,
  N_ELEMENTS,
  DENSITY, LIQUID_PROPS, isLiquid, isGas, isPowder,
  FLAMMABILITY, FUEL_LIFE, DISSOLVABLE, BREAKABLE,
} from './elements.js';

const NEIGH4 = [[0, -1], [0, 1], [-1, 0], [1, 0]];

const GRAV = 0.22;      // gravity per frame
const MAXV = 3;         // speed cap, cells per frame
const PMAX = 12;        // steady-state pressure cap (blasts may spike past it)
const PRESS_FORCE = 0.05; // how hard a pressure gradient shoves a liquid

export class Sim {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.grid = new Uint8Array(w * h);
    this.aux = new Uint8Array(w * h);   // fire/gas lifetime
    this.moved = new Uint8Array(w * h); // processed-this-frame flag
    this.vx = new Float32Array(w * h);  // per-cell velocity (movables only)
    this.vy = new Float32Array(w * h);  // +y is down
    this.press = new Float32Array(w * h);    // air pressure (gas/empty cells)
    this.pressTmp = new Float32Array(w * h);
    this.frame = 0;
    this.sprouted = 0; // seeds that became plants this level
    this.counts = new Uint32Array(N_ELEMENTS);
    this.emitters = []; // {x, y, w, el, every, until}
  }

  reset() {
    this.grid.fill(EMPTY);
    this.aux.fill(0);
    this.vx.fill(0);
    this.vy.fill(0);
    this.press.fill(0);
    this.pressTmp.fill(0);
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
    this.vx[i] = 0;
    this.vy[i] = 0;
  }

  swap(i, j) {
    const g = this.grid, a = this.aux, vx = this.vx, vy = this.vy;
    const tg = g[i]; g[i] = g[j]; g[j] = tg;
    const ta = a[i]; a[i] = a[j]; a[j] = ta;
    const tx = vx[i]; vx[i] = vx[j]; vx[j] = tx;
    const ty = vy[i]; vy[i] = vy[j]; vy[j] = ty;
    this.moved[i] = 1;
    this.moved[j] = 1;
  }

  // A cell that falling matter can displace: empty or a gas.
  passable(e) { return e === EMPTY || e === STEAM || e === SMOKE || e === GAS; }

  // A cell the pressure field lives in and diffuses through.
  airy(e) { return e === EMPTY || isGas(e); }

  step() {
    const { w, h, grid, moved } = this;
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

    this.updatePressure();

    for (let y = h - 1; y >= 0; y--) {
      const row = y * w;
      for (let k = 0; k < w; k++) {
        const x = ltr ? k : w - 1 - k;
        const i = row + x;
        if (moved[i]) continue;
        const e = grid[i];
        if (e === EMPTY || e === WALL || e === WOOD || e === GLASS) continue;
        switch (e) {
          case SAND: case STONE: case SEED: case SNOW: case GUNPOWDER:
            this.updatePowder(x, y, i, e); break;
          case WATER: case OIL: case ACID: case LAVA: case HONEY:
            this.updateLiquid(x, y, i, e); break;
          case FIRE: this.updateFire(x, y, i); break;
          case STEAM: case SMOKE: case GAS: this.updateGas(x, y, i, e); break;
          case PLANT: this.updatePlant(x, y, i); break;
          case ICE: case TARGET: break;
          default: break;
        }
      }
    }

    // Recount every step (cheap; used by goals and HUD).
    this.counts.fill(0);
    for (let i = 0; i < grid.length; i++) this.counts[grid[i]]++;
  }

  // ---------- pressure field ----------
  updatePressure() {
    const { grid, w, h } = this;
    let P = this.press, T = this.pressTmp;

    // Sources: hot gases pump pressure into their cell; anything that isn't
    // air (solids, liquids, powders) holds no pressure and blocks diffusion.
    for (let i = 0; i < grid.length; i++) {
      const e = grid[i];
      if (e === EMPTY) continue;
      if (e === STEAM) P[i] = Math.min(P[i] + 0.5, PMAX);
      else if (e === FIRE) P[i] = Math.min(P[i] + 0.25, PMAX);
      else if (e === GAS) P[i] = Math.min(P[i] + 0.05, PMAX);
      else if (e === SMOKE) P[i] = Math.min(P[i] + 0.04, PMAX);
      else P[i] = 0;
    }

    // Diffuse through open cells; walls/liquids reflect. Slight decay lets
    // pressure bleed away so open rooms return to ambient.
    for (let it = 0; it < 2; it++) {
      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
          const i = row + x;
          if (!this.airy(grid[i])) { T[i] = 0; continue; }
          let sum = P[i] * 2, n = 2; // self-weighted for stability
          if (x > 0 && this.airy(grid[i - 1])) { sum += P[i - 1]; n++; }
          if (x < w - 1 && this.airy(grid[i + 1])) { sum += P[i + 1]; n++; }
          if (y > 0 && this.airy(grid[i - w])) { sum += P[i - w]; n++; }
          if (y < h - 1 && this.airy(grid[i + w])) { sum += P[i + w]; n++; }
          T[i] = (sum / n) * 0.985;
        }
      }
      const t = P; P = T; T = t;
    }
    this.press = P;
    this.pressTmp = T;
  }

  // Neighboring gas pockets shove this (liquid) cell along their gradient.
  applyPressureForce(x, y, i) {
    const P = this.press, w = this.w;
    const pl = x > 0 ? P[i - 1] : 0;
    const pr = x < w - 1 ? P[i + 1] : 0;
    const pu = y > 0 ? P[i - w] : 0;
    const pd = y < this.h - 1 ? P[i + w] : 0;
    this.vx[i] += (pl - pr) * PRESS_FORCE;
    this.vy[i] += (pu - pd) * PRESS_FORCE;
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

  // ---------- powders ----------
  updatePowder(x, y, i, e) {
    if (e === SEED && this.trySprout(x, y, i)) return;
    if (e === SNOW && this.snowMelt(x, y, i)) return;
    const { vx, vy, w } = this;
    const d = this.densityOf(e);

    if (e === SNOW && Math.random() < 0.4) return; // lazy flakes drift down

    // Tossed upward by a blast: fly, then gravity claws it back.
    if (vy[i] < -0.6) {
      let ci = i, cy = y;
      let up = Math.min(Math.round(-vy[ci]), MAXV);
      while (up-- > 0 && cy > 0 && this.passable(this.get(x, cy - 1))) {
        this.swap(ci, ci - w);
        ci -= w; cy--;
      }
      vy[ci] = Math.min(vy[ci] + GRAV, MAXV);
      this.driftPowder(ci, x, cy);
      return;
    }

    vy[i] = Math.min(vy[i] + GRAV, MAXV);

    // Fall, carrying momentum across multiple cells per frame.
    let ci = i, cx = x, cy = y;
    const steps = Math.max(1, Math.round(vy[ci]));
    let fell = 0;
    for (let s = 0; s < steps && cy + 1 < this.h; s++) {
      if (this.tryFall(ci, cx, cy + 1, d, 0.6)) { cy++; ci += w; fell++; }
      else break;
    }
    [cx, ci] = this.driftPowder(ci, cx, cy);
    if (fell >= steps) return; // still in free fall
    vy[ci] = 0;

    if (e === STONE) return; // stone stacks in columns, no diagonal slide
    const dir = Math.random() < 0.5 ? 1 : -1;
    if (this.tryFall(ci, cx + dir, cy + 1, d, 0.3)) return;
    this.tryFall(ci, cx - dir, cy + 1, d, 0.3);
  }

  // Sideways carry for powders with blast-imparted velocity.
  driftPowder(i, x, y) {
    const { vx, w } = this;
    if (Math.abs(vx[i]) <= 0.6) return [x, i];
    const dir = vx[i] > 0 ? 1 : -1;
    let hs = Math.min(Math.round(Math.abs(vx[i])), 2);
    let cx = x, ci = i;
    while (hs-- > 0 && this.passable(this.get(cx + dir, y))) {
      this.swap(ci, y * w + cx + dir);
      cx += dir; ci = y * w + cx;
    }
    vx[ci] *= 0.75;
    return [cx, ci];
  }

  snowMelt(x, y, i) {
    for (const [dx, dy] of NEIGH4) {
      const n = this.get(x + dx, y + dy);
      if ((n === FIRE || n === LAVA) && Math.random() < 0.3) {
        this.set(x, y, WATER);
        return true;
      }
      if (n === WATER && Math.random() < 0.02) { // slush
        this.set(x, y, WATER);
        return true;
      }
    }
    return false;
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

  // ---------- liquids ----------
  updateLiquid(x, y, i, e) {
    if (e === LAVA && this.lavaReact(x, y, i)) return;
    if (e === ACID) this.acidReact(x, y);
    if (e === WATER && Math.random() < 0.02 && this.tryFreeze(x, y, i)) return;

    const props = LIQUID_PROPS[e];
    const { vx, vy, w } = this;
    const d = this.densityOf(e);

    this.applyPressureForce(x, y, i);

    // Viscous liquids mostly sit; they ooze one cell at a time.
    if (props.slow && Math.random() < props.slow) {
      vx[i] *= props.fric;
      if (!this.tryFall(i, x, y + 1, d, 0.35)) vy[i] = 0;
      return;
    }

    // Pressure can shove liquid upward (boilers, geysers).
    if (vy[i] < -0.6) {
      let ci = i, cy = y;
      let up = Math.min(Math.round(-vy[ci]), 2);
      while (up-- > 0 && cy > 0 && this.passable(this.get(x, cy - 1))) {
        this.swap(ci, ci - w);
        ci -= w; cy--;
      }
      vy[ci] = Math.min(vy[ci] + GRAV, 0);
      vx[ci] *= props.fric;
      return;
    }

    vy[i] = Math.min(vy[i] + GRAV, MAXV);

    // Fall, carrying momentum across multiple cells per frame.
    let ci = i, cx = x, cy = y;
    const steps = Math.max(1, Math.round(vy[ci]));
    let fell = 0;
    for (let s = 0; s < steps && cy + 1 < this.h; s++) {
      if (this.tryFall(ci, cx, cy + 1, d, 0.4)) { cy++; ci += w; fell++; }
      else break;
    }
    if (fell >= steps) return; // still in free fall

    // Impact: falling speed becomes sideways slosh toward open space, or
    // shoves the pool below aside so pouring water kicks up waves.
    const impact = vy[ci];
    vy[ci] = 0;
    if (impact > 0.9) {
      const openL = this.passable(this.get(cx - 1, cy));
      const openR = this.passable(this.get(cx + 1, cy));
      const dir = openL && openR ? (Math.random() < 0.5 ? 1 : -1)
        : openR ? 1 : openL ? -1 : 0;
      if (dir) {
        vx[ci] += dir * impact * props.splash * (0.6 + Math.random() * 0.4);
      } else if (cy + 1 < this.h && this.grid[ci + w] === e) {
        const j = ci + w;
        vx[j] = Math.max(-MAXV, Math.min(MAXV,
          vx[j] + (Math.random() < 0.5 ? 1 : -1) * impact * props.splash * 0.5));
      }
    }

    // Diagonal seep.
    const dv = vx[ci];
    const dir0 = dv > 0.2 ? 1 : dv < -0.2 ? -1 : (Math.random() < 0.5 ? 1 : -1);
    if (this.tryFall(ci, cx + dir0, cy + 1, d, 0.25)) return;
    if (this.tryFall(ci, cx - dir0, cy + 1, d, 0.25)) return;

    // Liquid stacked above pressurizes the cell and drives outflow.
    let depth = 0;
    for (let yy = cy - 1; yy >= cy - 8 && yy >= 0; yy--) {
      if (!isLiquid(this.grid[yy * w + cx])) break;
      depth++;
    }

    let hv = vx[ci];
    if (Math.abs(hv) < 0.35) {
      // Viscous liquids only creep sideways when weight sits on them, so
      // honey and lava pile into blobs instead of thinning into a film.
      if (props.slow && depth === 0) { vx[ci] = hv * props.fric; return; }
      hv = dir0 * (0.35 + depth * 0.12);
    } else {
      hv += Math.sign(hv) * depth * 0.04;
    }
    hv = Math.max(-MAXV, Math.min(MAXV, hv));

    // Horizontal flow with momentum; bounce off walls so waves reflect.
    const sdir = hv > 0 ? 1 : -1;
    let hs = Math.min(Math.max(1, Math.round(Math.abs(hv))), props.disp);
    let movedH = 0;
    while (hs-- > 0) {
      const nx = cx + sdir;
      if (!this.passable(this.get(nx, cy))) break;
      this.swap(ci, cy * w + nx);
      cx = nx; ci = cy * w + nx;
      movedH++;
      // Spill over an edge as soon as one appears.
      if (this.passable(this.get(cx, cy + 1))) { vy[ci] = Math.max(vy[ci], 0.4); break; }
    }
    if (movedH === 0) {
      const j = cy * w + cx + sdir;
      if (this.inBounds(cx + sdir, cy) && this.grid[j] === e) {
        // Blocked by our own liquid: hand the momentum over so waves travel
        // through the body of the fluid instead of dying at the surface.
        vx[j] = Math.max(-MAXV, Math.min(MAXV, vx[j] + hv * 0.55));
        hv *= 0.25;
      } else {
        hv = -hv * 0.5; // wall bounce: the slosh comes back
      }
    }
    vx[ci] = hv * props.fric;
  }

  tryFreeze(x, y, i) {
    for (const [dx, dy] of NEIGH4) {
      if (this.get(x + dx, y + dy) === ICE && Math.random() < 0.08) {
        this.set(x, y, ICE);
        return true;
      }
    }
    return false;
  }

  lavaReact(x, y, i) {
    for (const [dx, dy] of NEIGH4) {
      const nx = x + dx, ny = y + dy;
      const n = this.get(nx, ny);
      if (n === WATER) {
        // Boil the water off; the lava only sometimes crusts over, so a
        // heated pool keeps steaming instead of sealing itself instantly.
        this.set(nx, ny, STEAM, 90 + (Math.random() * 80 | 0));
        if (Math.random() < 0.4) {
          this.grid[i] = STONE;
          this.aux[i] = 0;
          return true;
        }
        continue;
      }
      if (n === ICE || n === SNOW) {
        this.set(nx, ny, Math.random() < 0.4 ? STEAM : WATER,
          Math.random() < 0.4 ? 90 : 0);
        continue;
      }
      if (n === SAND && Math.random() < 0.02) { // lava vitrifies sand
        this.set(nx, ny, GLASS);
        continue;
      }
      if (n === GUNPOWDER) {
        this.explode(nx, ny, 7 + (Math.random() * 3 | 0));
        continue;
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

  // ---------- fire & explosions ----------
  updateFire(x, y, i) {
    const { grid, aux, press, w } = this;
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
      if (n === GUNPOWDER) {
        this.explode(nx, ny, 7 + (Math.random() * 3 | 0));
        continue;
      }
      if (n === GAS) {
        // Deflagration: the flame front races through the cloud and pops
        // the pressure up, so a filled room goes off with a real whump.
        this.set(nx, ny, FIRE, 10 + (Math.random() * 10 | 0));
        press[ny * w + nx] += 4;
        nearFuel = true;
        continue;
      }
      if (n === SNOW) {
        if (Math.random() < 0.25) this.set(nx, ny, WATER);
        nearFuel = true; // cling to what it's melting
        continue;
      }
      if (n === ICE) {
        if (Math.random() < 0.18) this.set(nx, ny, WATER);
        nearFuel = true;
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

  // Blast: vaporize the core, break weak material further out, fling
  // movables, and slam a pressure wave into the air.
  explode(cx, cy, r) {
    const { grid, aux, vx, vy, press, w, h } = this;
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= h) continue;
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= w) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const i = y * w + x;
        const e = grid[i];
        if (e === WALL) continue;
        const dist = Math.sqrt(d2);
        const power = 1 - dist / (r + 1);
        if (this.airy(e) || e === EMPTY) press[i] = Math.min(press[i] + power * 26, 40);
        if (e === GUNPOWDER && (dist > r * 0.55 && Math.random() > 0.3)) {
          // Powder beyond the core survives this blast; the fireball sets it
          // off over the next frames, so a big pile detonates as a rolling
          // chain of blasts instead of one flash.
          continue;
        }
        if (dist <= r * 0.55) {
          if (e !== EMPTY) {
            grid[i] = Math.random() < 0.6 ? FIRE : EMPTY;
            aux[i] = grid[i] === FIRE ? 6 + (Math.random() * 16 | 0) : 0;
            vx[i] = 0; vy[i] = 0;
          }
        } else if (BREAKABLE.has(e) && Math.random() < power * 1.6) {
          grid[i] = Math.random() < 0.3 ? SMOKE : EMPTY;
          aux[i] = grid[i] === SMOKE ? 30 + (Math.random() * 30 | 0) : 0;
        } else if ((isLiquid(e) || isPowder(e)) && dist > 0) {
          const kick = power * 6 / dist;
          vx[i] = Math.max(-2 * MAXV, Math.min(2 * MAXV, vx[i] + dx * kick));
          vy[i] = Math.max(-2 * MAXV, Math.min(2 * MAXV, vy[i] + dy * kick - 1.2));
        }
      }
    }
  }

  // ---------- gases ----------
  updateGas(x, y, i, e) {
    const { grid, aux, press, w } = this;
    if (aux[i] > 0) aux[i]--;
    if (aux[i] === 0) {
      if (e === STEAM && Math.random() < 0.35) {
        grid[i] = WATER;
      } else {
        grid[i] = EMPTY;
      }
      return;
    }

    // Flammable gas checks its own surroundings too, so a flame front races
    // through a cloud instead of nibbling at its edge.
    if (e === GAS) {
      for (const [dx, dy] of NEIGH4) {
        const n = this.get(x + dx, y + dy);
        if (n === FIRE || n === LAVA) {
          grid[i] = FIRE;
          aux[i] = 10 + (Math.random() * 10 | 0);
          press[i] += 4;
          return;
        }
      }
    }

    // Steam trapped under a solid slowly condenses and drips.
    if (e === STEAM) {
      const up = this.get(x, y - 1);
      if ((up === WALL || up === WOOD || up === STONE || up === GLASS || up === ICE)
        && Math.random() < 0.03) {
        grid[i] = WATER;
        aux[i] = 0;
        return;
      }
    }

    // Drift by buoyancy, biased down the pressure gradient so gas vents
    // toward openings and jets out of pressurized chambers.
    const buoy = e === GAS ? 0.3 : e === STEAM ? 0.45 : 0.35;
    const pHere = press[i];
    const dir = Math.random() < 0.5 ? 1 : -1;
    const cands = [
      [x, y - 1], [x + dir, y - 1], [x - dir, y - 1],
      [x + dir, y], [x - dir, y], [x, y + 1],
    ];
    let best = -1, bestScore = 0.02;
    for (const [nx, ny] of cands) {
      if (!this.inBounds(nx, ny)) continue;
      const j = ny * w + nx;
      const n = grid[j];
      if (n === EMPTY) {
        const score = (pHere - press[j]) + (y - ny) * buoy + Math.random() * 0.4;
        if (score > bestScore) { bestScore = score; best = j; }
      } else if (isLiquid(n) && ny === y - 1 && Math.random() < 0.4) {
        this.swap(i, j); // gases bubble up through liquids
        return;
      }
    }
    if (best >= 0) this.swap(i, best);
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
          if (cur !== EMPTY) { this.set(x, y, EMPTY); n++; }
          continue;
        }
        if (cur === EMPTY || (overwrite && cur !== e && cur !== WALL)) {
          this.set(x, y, e,
            e === FIRE ? 40 + (Math.random() * 20 | 0)
              : (e === STEAM || e === SMOKE) ? 80 + (Math.random() * 60 | 0)
                : e === GAS ? 160 + (Math.random() * 80 | 0) : 0);
          n++;
        }
      }
    }
    return n;
  }
}
