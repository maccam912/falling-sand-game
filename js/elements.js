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
export const ERASER = 255; // tool only, never stored in the grid

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
};

// Densities: heavier sinks below lighter among movable matter.
// Gases < 0, liquids 1-4, powders/solids 5+.
export const DENSITY = {
  [WATER]: 2,
  [OIL]: 1,
  [ACID]: 2.5,
  [LAVA]: 4,
  [SAND]: 5,
  [SEED]: 1.5, // floats on water so it can sprout at the surface
  [STONE]: 6,
};

export const isLiquid = (e) => e === WATER || e === OIL || e === ACID || e === LAVA;
export const isGas = (e) => e === STEAM || e === SMOKE || e === FIRE;
export const isPowder = (e) => e === SAND || e === SEED || e === STONE;
export const isStatic = (e) => e === WALL || e === WOOD || e === PLANT || e === TARGET;

// Chance per frame that fire spreads into this element on contact.
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

export const DISSOLVABLE = new Set([SAND, STONE, WOOD, PLANT, SEED, TARGET, OIL]);
