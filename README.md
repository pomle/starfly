# Starfly

Dependency-free WebGL2 game baseline using native ES modules.

## Run
ES modules need HTTP (not `file://`):

    npx serve

Open the URL it prints (http://localhost:3000 by default). A "click to start" screen unlocks audio, then the splash waits for any key or click. Vertical auto-scroller. Controls: WASD/arrows move the ship, mouse aims the turret, left click or Space fires.

## Layout
- `scripts/main.js` – bootstrap (canvas, context, loop)
- `scripts/game.js` – game state, update (fixed step) and render
- `scripts/enemies.js` – enemy types (referenced by name from levels), movement, rendering
- `scripts/level.js` – level JSON loader/validator and the spawn-schedule runner
- `levels/*.json` – level files: which enemy spawns when (format documented in `scripts/level.js`); played in the order listed in `LEVEL_FILES` in `scripts/game.js`
- `scripts/core/gl.js` – context, shader/program/buffer helpers, canvas resize
- `scripts/core/loop.js` – fixed-timestep loop with render interpolation
- `scripts/core/input.js` – keyboard/pointer state
- `scripts/core/sfx.js` – procedural Web Audio sound effects (laser, hit, explosions)
- `scripts/core/math.js` – mat4 helpers
- `scripts/graphics/` – starfield, pooled particles, debris chips, bullets, ship sprite (`assets/spaceship-sprite.png`) + turret mesh
- `scripts/ui/` – crosshair, textured sprites (logo), 5x7 bitmap font, text labels (HUD)
- `assets/logo.png` – splash logo
- `music/bearound.ogg` – splash music, `music/coloris.ogg` – level music (scripts/core/music.js)
