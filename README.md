# Starfly

Dependency-free WebGL2 game baseline using native ES modules.

## Run
ES modules need HTTP (not `file://`):

    python3 -m http.server 8000

Open http://localhost:8000. A "click to start" screen unlocks audio, then the splash waits for any key or click. Vertical auto-scroller. Controls: WASD/arrows move the ship, mouse aims the turret, left click or Space fires.

## Layout
- `src/main.js` – bootstrap (canvas, context, loop)
- `src/game.js` – game state, update (fixed step) and render
- `src/core/gl.js` – context, shader/program/buffer helpers, canvas resize
- `src/core/loop.js` – fixed-timestep loop with render interpolation
- `src/core/input.js` – keyboard/pointer state
- `src/core/math.js` – mat4 helpers
- `src/graphics/` – starfield, pooled particles, bullets, ship + turret meshes
- `src/ui/` – crosshair, textured sprites (logo), 5x7 bitmap font
- `assets/logo.png` – splash logo
- `music/bearound.ogg` – splash music (src/core/music.js)
