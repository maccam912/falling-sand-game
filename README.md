# Grainfall 🏜️

A falling-sand physics **puzzle game**. Classic powder-toy cellular-automaton
mechanics — sand, water, oil, fire, steam, acid, lava, plants — structured
into 10 hand-designed puzzle levels plus a free sandbox.

**Play it:** https://maccam912.github.io/falling-sand-game/

## How to play

Drag on the screen to paint elements. Each level gives you a limited budget of
elements and a goal: fill a basin with sand, water a seed until it sprouts,
burn crystals without igniting the oil, ferry flames across a lake on a
floating oil slick, boil water into steam that condenses and rains back down…

- **☰** level select · **⏸** pause (you can still paint while paused) ·
  **⟳** reset level · **●** cycle brush size
- Hatched regions are out of reach — you can't paint there.
- Progress is saved locally.

## Tech

- Pure vanilla JS + Canvas, no dependencies, no build step.
- 120×160 cell cellular automaton on typed arrays, ~15 interaction rules
  (fire spreads along fuel, oil floats on water and burns, acid dissolves,
  steam rises and condenses on ceilings, lava + water → stone, plants drink
  water, seeds sprout when wet).
- Installable PWA: offline-capable service worker + manifest, add it to your
  Android home screen from the browser menu ("Install app" / "Add to Home
  screen").
- Deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to
  `main`.

## Development

Serve the repo root with any static server and open it:

```sh
python3 -m http.server 8000
```

Level solvability is validated by scripting player-legal solutions (same
budgets, empty-cell-only painting, no-paint masks) directly against the
engine — `js/sim.js` and `js/levels.js` are DOM-free ES modules, so they run
in Node as-is.
