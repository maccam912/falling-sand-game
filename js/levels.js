// Puzzle level definitions. Grid is 120 wide x 160 tall.
import {
  WALL, SAND, WATER, OIL, FIRE, PLANT, SEED, WOOD, ACID, STONE, LAVA, TARGET,
  ERASER,
} from './elements.js';

export const GRID_W = 120;
export const GRID_H = 160;

// Painting helpers bound to a sim instance.
function api(sim) {
  return {
    rect(x, y, w, h, e) {
      for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++) sim.set(xx, yy, e);
    },
    line(x0, y0, x1, y1, e, t = 2) {
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (let s = 0; s <= steps; s++) {
        const x = Math.round(x0 + (x1 - x0) * s / steps);
        const y = Math.round(y0 + (y1 - y0) * s / steps);
        this.rect(x, y, t, t, e);
      }
    },
    floor(e = WALL, t = 4) { this.rect(0, GRID_H - t, GRID_W, t, e); },
  };
}

// Each level: name, desc (shown in intro), budget [[element, cells]...],
// build(p, sim), win(sim) -> bool, fail(sim) -> string|null.
// zones: dashed goal outlines. noPaint: rects where the player cannot paint.
export const LEVELS = [
  {
    name: 'First Grains',
    desc: 'Drag on the screen to pour sand. Fill the glowing basin.',
    budget: [[SAND, 900]],
    zones: [{ x: 42, y: 138, w: 36, h: 18, label: 'fill with sand' }],
    build(p) {
      p.floor();
      p.rect(38, 120, 4, 36, WALL);
      p.rect(78, 120, 4, 36, WALL);
      // funnel lips to make pouring forgiving
      p.line(20, 100, 38, 120, WALL, 3);
      p.line(99, 100, 78, 120, WALL, 3);
    },
    win(sim) { return sim.zoneCount(this.zones[0], SAND) >= 420; },
    fail() { return null; },
  },
  {
    name: 'Thirsty Seed',
    desc: 'Pour water so it reaches the seeds. Wet seeds sprout into plants.',
    budget: [[WATER, 500]],
    build(p, sim) {
      p.floor();
      // basin holding the seeds
      p.rect(70, 140, 30, 4, WALL);
      p.rect(70, 120, 3, 24, WALL);
      p.rect(97, 120, 3, 24, WALL);
      sim.set(84, 138, SEED);
      sim.set(85, 138, SEED);
      // ramp: water poured top-left runs down into the basin
      p.line(10, 60, 80, 100, WALL, 3);
    },
    win(sim) { return sim.sprouted >= 1; },
    fail() { return null; },
  },
  {
    name: 'Split the Stream',
    desc: 'Two seeds, one spout. Build a wooden deflector to split the falling water so BOTH seeds sprout. Tip: you can pause ⏸ and build while time stands still.',
    budget: [[WOOD, 340]],
    emitters: [{ x: 58, y: 2, w: 4, el: WATER, every: 2, until: 1800 }],
    build(p, sim) {
      // spout nozzle at top center; the emitter pours through it
      p.rect(52, 0, 6, 8, WALL);
      p.rect(62, 0, 6, 8, WALL);
      p.floor();
      // two basins far apart
      p.rect(4, 140, 3, 16, WALL); p.rect(34, 140, 3, 16, WALL);
      p.rect(83, 140, 3, 16, WALL); p.rect(113, 140, 3, 16, WALL);
      sim.set(19, 152, SEED); sim.set(20, 152, SEED);
      sim.set(98, 152, SEED); sim.set(99, 152, SEED);
    },
    win(sim) { return sim.sprouted >= 2; },
    fail() { return null; },
  },
  {
    name: 'Firestarter',
    desc: 'The crystals hide inside a wooden shield. You can\'t reach them — but fire spreads along wood. Light the roof.',
    budget: [[FIRE, 60]],
    noPaint: [{ x: 30, y: 100, w: 60, h: 56 }],
    build(p) {
      p.floor();
      // wooden shield: roof, walls, floor plank — one connected fuse
      p.rect(30, 100, 60, 6, WOOD);
      p.rect(30, 106, 6, 48, WOOD);
      p.rect(84, 106, 6, 48, WOOD);
      p.rect(30, 152, 60, 4, WOOD);
      p.rect(56, 106, 8, 8, TARGET);  // hangs from the roof
      p.rect(45, 144, 8, 8, TARGET);  // stand on the plank
      p.rect(67, 144, 8, 8, TARGET);
    },
    win(sim) { return sim.counts[TARGET] === 0; },
    fail() { return null; },
  },
  {
    name: 'Oil, Carefully',
    desc: 'Burn the crystal off its perch — but if the oil pool catches fire, you fail. Aim carefully.',
    budget: [[FIRE, 25]],
    build(p) {
      p.floor();
      // oil pool on the left, walled
      p.rect(4, 140, 3, 16, WALL);
      p.rect(52, 140, 3, 16, WALL);
      p.rect(7, 146, 45, 10, OIL);
      // crystal on a wooden platform on the right
      p.rect(80, 120, 30, 4, WOOD);
      p.rect(88, 112, 10, 8, TARGET);
      p.rect(92, 124, 4, 32, WALL);
    },
    afterBuild(sim) { this._oil0 = sim.zoneCount({ x: 0, y: 0, w: GRID_W, h: GRID_H }, OIL); },
    win(sim) { return sim.counts[TARGET] === 0; },
    fail(sim) {
      return sim.counts[OIL] < this._oil0 - 12 ? 'The oil caught fire!' : null;
    },
  },
  {
    name: 'Acid Drop',
    desc: 'These crystals are sealed in stone — fire is useless here. Send acid down the chute to melt through the vault.',
    budget: [[ACID, 260]],
    build(p) {
      p.floor();
      // zig-zag chute ending over the vault's stone lid
      p.line(0, 40, 85, 62, WALL, 3);
      p.line(119, 70, 58, 95, WALL, 3);
      // bunker: soluble stone lid, indestructible walls; acid rains in and
      // pools around the crystals
      p.rect(40, 128, 40, 10, STONE);
      p.rect(40, 138, 4, 18, WALL);
      p.rect(76, 138, 4, 18, WALL);
      p.rect(46, 152, 8, 4, TARGET);
      p.rect(62, 152, 8, 4, TARGET);
    },
    win(sim) { return sim.counts[TARGET] === 0; },
    fail() { return null; },
  },
  {
    name: 'Oil Ferry',
    desc: 'The crystal is out of reach across the lake. Oil floats on water — pour a slick, then light it and let the flames sail over.',
    budget: [[OIL, 320], [FIRE, 15]],
    noPaint: [{ x: 88, y: 80, w: 32, h: 80 }],
    build(p) {
      p.floor();
      // lake with raised lips
      p.rect(10, 150, 100, 6, WALL);
      p.rect(10, 118, 4, 32, WALL);
      p.rect(102, 118, 4, 32, WALL);
      p.rect(14, 126, 88, 24, WATER);
      // crystal perched on the far lip, overhanging the water
      p.rect(101, 110, 7, 8, TARGET);
    },
    win(sim) { return sim.counts[TARGET] === 0; },
    fail() { return null; },
  },
  {
    name: 'Steam Engine',
    desc: 'The seeds sit in a hanging basin you can\'t reach. Boil water on the lava below — steam rises, condenses on the roof, and rains back down.',
    budget: [[WATER, 420]],
    noPaint: [{ x: 40, y: 40, w: 50, h: 53 }],
    build(p, sim) {
      p.floor();
      // lava pit at the bottom of a tall shaft
      p.rect(26, 140, 4, 16, WALL);
      p.rect(90, 140, 4, 16, WALL);
      p.rect(30, 148, 60, 8, LAVA);
      // shaft walls; right wall reaches the roof, left leaves a pour lane
      p.rect(26, 60, 4, 80, WALL);
      p.rect(90, 44, 4, 96, WALL);
      // condenser roof over the shaft (pour lane stays open at x 30-40)
      p.rect(40, 40, 60, 4, WALL);
      // hanging seed basin
      p.rect(44, 90, 32, 3, WALL);
      p.rect(44, 80, 3, 12, WALL);
      p.rect(73, 80, 3, 12, WALL);
      sim.set(56, 88, SEED); sim.set(59, 88, SEED); sim.set(62, 88, SEED);
    },
    win(sim) { return sim.sprouted >= 1; },
    fail(sim) {
      return sim.counts[SEED] === 0 && sim.sprouted === 0 ? 'The seeds were destroyed!' : null;
    },
  },
  {
    name: 'The Garden',
    desc: 'Plants grow by drinking water. Drop seeds, keep them wet, and grow a jungle: 300 plant cells.',
    budget: [[SEED, 30], [WATER, 900]],
    build(p) {
      p.floor();
      // terraced planters with raised outer walls
      p.rect(0, 130, 40, 3, WALL);
      p.rect(40, 114, 3, 19, WALL);
      p.rect(80, 110, 40, 3, WALL);
      p.rect(78, 94, 3, 19, WALL);
    },
    win(sim) { return sim.counts[PLANT] >= 300; },
    fail() { return null; },
  },
  {
    name: 'The Gauntlet',
    desc: 'Everything at once: melt the stone vault with acid, sail fire across the lake on an oil slick, then water the seeds. Don\'t destroy them.',
    budget: [[ACID, 160], [OIL, 220], [FIRE, 12], [WATER, 300]],
    noPaint: [{ x: 104, y: 100, w: 16, h: 44 }],
    build(p, sim) {
      p.floor();
      // center tower holding the seeds
      p.rect(52, 96, 16, 3, WALL);
      p.rect(52, 84, 3, 12, WALL);
      p.rect(65, 84, 3, 12, WALL);
      sim.set(58, 94, SEED); sim.set(61, 94, SEED);
      // left: crystal in a bunker under a soluble stone lid
      p.rect(6, 126, 34, 8, STONE);
      p.rect(6, 134, 4, 22, WALL);
      p.rect(36, 134, 4, 22, WALL);
      p.rect(16, 151, 10, 5, TARGET);
      // right: lake with the far crystal perched on the rim
      p.rect(66, 150, 54, 6, WALL);
      p.rect(66, 126, 4, 30, WALL);
      p.rect(116, 126, 4, 24, WALL);
      p.rect(70, 134, 46, 16, WATER);
      p.rect(113, 118, 6, 8, TARGET);
    },
    win(sim) { return sim.counts[TARGET] === 0 && sim.sprouted >= 1; },
    fail(sim) {
      return sim.counts[SEED] === 0 && sim.sprouted === 0 ? 'The seeds were destroyed!' : null;
    },
  },
];

export const SANDBOX = {
  name: 'Sandbox',
  desc: 'No goals, no limits. Play with every element.',
  budget: [
    [SAND, Infinity], [WATER, Infinity], [OIL, Infinity], [FIRE, Infinity],
    [PLANT, Infinity], [SEED, Infinity], [WOOD, Infinity], [ACID, Infinity],
    [STONE, Infinity], [LAVA, Infinity], [WALL, Infinity], [ERASER, Infinity],
  ],
  build(p) { p.floor(); },
  win() { return false; },
  fail() { return null; },
};

export function buildLevel(sim, level) {
  sim.reset();
  level.build(api(sim), sim);
  if (level.emitters) sim.emitters = level.emitters.map((e) => ({ ...e }));
  if (level.afterBuild) level.afterBuild(sim);
}
