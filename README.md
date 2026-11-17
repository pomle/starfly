# Starfly

Dependency-free WebGL2 game baseline using native ES modules.

## Run
ES modules need HTTP (not `file://`):

    npx serve src

Open the URL it prints (http://localhost:3000 by default). A "click to start" screen unlocks audio, then the splash waits for any key or click. Vertical auto-scroller. Controls: WASD/arrows move the ship, mouse aims the turret, left click or Space fires.

## Layout
The game lives in `src/` (the web root served above). `resources/` at the repo root holds source art and is not served.

- `src/scripts/main.js` – bootstrap (canvas, context, loop)
- `src/scripts/game.js` – game state, update (fixed step) and render
- `src/scripts/enemies.js` – enemy types (referenced by name from levels), movement, rendering
- `src/scripts/level.js` – level JSON loader/validator and the spawn-schedule runner
- `src/levels/*.json` – level files: which enemy spawns when (format documented in `src/scripts/level.js`); played in the order listed in `LEVEL_FILES` in `src/scripts/game.js`
- `src/scripts/core/gl.js` – context, shader/program/buffer helpers, canvas resize
- `src/scripts/core/loop.js` – fixed-timestep loop with render interpolation
- `src/scripts/core/input.js` – keyboard/pointer state
- `src/scripts/core/sfx.js` – procedural Web Audio sound effects (laser, hit, explosions)
- `src/scripts/core/math.js` – mat4 helpers
- `src/scripts/graphics/` – starfield, pooled particles, debris chips, bullets, ship sprite (`src/assets/spaceship-sprite.png`) + turret mesh
- `src/scripts/ui/` – crosshair, textured sprites (logo), 5x7 bitmap font, text labels (HUD)
- `src/assets/` – sprite images (logo, ship, enemies)
- `src/index.html` – page that loads `scripts/main.js`
- `resources/` – source art (not loaded by the game)
- `src/music/*.ogg` – splash and level music (a level picks its track with its `"music"` field; see `src/scripts/core/music.js`)
