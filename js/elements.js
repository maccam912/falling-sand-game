// Element ids, properties, and colors for the falling-sand simulation.

export const EMPTY = 0;
export const WALL = 1;
export const SAND = 2;
export const WATER = 3;
export const OIL = 4;
export const FIRE = 5;
export const STEAM = 6;
export const SMOKE = 7;
export const PLANT = 8;
export const SEED = 9;
export const WOOD = 10;
export const ACID = 11;
export const STONE = 12;
export const LAVA = 13;
export const TARGET = 14;
export const ICE = 15;
export const SNOW = 16;
export const GUNPOWDER = 17;
export const GAS = 18;
export const HONEY = 19;
export const GLASS = 20;
export const ERASER = 255; // tool only, never stored in the grid

export const N_ELEMENTS = 32; // size of count tables; ids must stay below this

export const NAMES = {
  [EMPTY]: 'Empty',
  [WALL]: 'Wall',
  [SAND]: 'Sand',
  [WATER]: 'Water',
  [OIL]: 'Oil',
  [FIRE]: 'Fire',
  [STEAM]: 'Steam',
  [SMOKE]: 'Smoke',
  [PLANT]: 'Plant',
  [SEED]: 'Seed',
  [WOOD]: 'Wood',
  [ACID]: 'Acid',
  [STONE]: 'Stone',
  [LAVA]: 'Lava',
  [TARGET]: 'Target',
  [ICE]: 'Ice',
  [SNOW]: 'Snow',
  [GUNPOWDER]: 'Powder',
  [GAS]: 'Gas',
  [HONEY]: 'Honey',
  [GLASS]: 'Glass',
  [ERASER]: 'Erase',
};

// Base colors [r,g,b]. Per-cell noise varies brightness at render time.
export const COLORS = {
  [EMPTY]: [13, 16, 23],
  [WALL]: [84, 89, 100],
  [SAND]: [219, 172, 92],
  [WATER]: [52, 120, 214],
  [OIL]: [94, 84, 46],
  [FIRE]: [255, 110, 30],
  [STEAM]: [186, 202, 216],
  [SMOKE]: [62, 62, 70],
  [PLANT]: [58, 168, 74],
  [SEED]: [204, 212, 100],
  [WOOD]: [133, 88, 44],
  [ACID]: [148, 224, 38],
  [STONE]: [148, 152, 160],
  [LAVA]: [226, 88, 34],
  [TARGET]: [233, 79, 120],
  [ICE]: [150, 204, 238],
  [SNOW]: [232, 238, 246],
  [GUNPOWDER]: [74, 64, 52],
  [GAS]: [152, 166, 94],
  [HONEY]: [216, 158, 44],
  [GLASS]: [176, 214, 222],
};

// Densities: heavier sinks below lighter among movable matter.
// Gases < 0, liquids 1-4, powders/solids 5+.
export const DENSITY = {
  [WATER]: 2,
  [OIL]: 1,
  [ACID]: 2.5,
  [LAVA]: 4,
  [HONEY]: 3,
  [SAND]: 5,
  [SEED]: 1.5, // floats on water so it can sprout at the surface
  [SNOW]: 1.6, // snowflakes float
  [GUNPOWDER]: 5,
  [STONE]: 6,
};

// Liquid feel for the momentum solver.
//   fric:   per-frame horizontal velocity retention (1 = frictionless)
//   disp:   max cells of horizontal flow per frame
//   splash: share of impact speed converted into sideways slosh
//   slow:   chance per frame a viscous liquid skips its move entirely
export const LIQUID_PROPS = {
  [WATER]: { fric: 0.97, disp: 5, splash: 0.85, slow: 0 },
  [OIL]: { fric: 0.94, disp: 4, splash: 0.65, slow: 0 },
  [ACID]: { fric: 0.95, disp: 4, splash: 0.7, slow: 0 },
  [LAVA]: { fric: 0.7, disp: 1, splash: 0.15, slow: 0.55 },
  [HONEY]: { fric: 0.6, disp: 1, splash: 0.1, slow: 0.6 },
};

export const isLiquid = (e) =>
  e === WATER || e === OIL || e === ACID || e === LAVA || e === HONEY;
export const isGas = (e) => e === STEAM || e === SMOKE || e === FIRE || e === GAS;
export const isPowder = (e) =>
  e === SAND || e === SEED || e === STONE || e === SNOW || e === GUNPOWDER;
export const isStatic = (e) =>
  e === WALL || e === WOOD || e === PLANT || e === TARGET || e === ICE || e === GLASS;

// Chance per frame that fire spreads into this element on contact.
// (Gunpowder and gas are handled specially: they detonate/deflagrate.)
export const FLAMMABILITY = {
  [OIL]: 0.65,
  [PLANT]: 0.12,
  [SEED]: 0.2,
  [WOOD]: 0.05,
  [TARGET]: 0.06,
};

// Fire lifetime (frames) once this fuel ignites.
export const FUEL_LIFE = {
  [OIL]: 45,
  [PLANT]: 70,
  [SEED]: 45,
  [WOOD]: 150,
  [TARGET]: 70,
};

export const DISSOLVABLE = new Set([
  SAND, STONE, WOOD, PLANT, SEED, TARGET, OIL, ICE, SNOW, GUNPOWDER, HONEY,
]);

// Cells a blast wave can break (walls are indestructible).
export const BREAKABLE = new Set([
  STONE, WOOD, PLANT, SEED, ICE, GLASS, TARGET, SNOW,
]);
