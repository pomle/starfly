# Starfly

Dependency-free WebGL2 game baseline using native ES modules.

## Run
ES modules need HTTP (not `file://`):

    python3 -m http.server 8000

Open http://localhost:8000. Controls: W/Up thrust, A/D or Left/Right turn.

## Layout
- `src/main.js` – bootstrap (canvas, context, loop)
- `src/game.js` – game state, update (fixed step) and render
- `src/core/gl.js` – context, shader/program/buffer helpers, canvas resize
- `src/core/loop.js` – fixed-timestep loop with render interpolation
- `src/core/input.js` – keyboard/pointer state
- `src/core/math.js` – mat4 helpers
- `src/graphics/` – starfield (parallax point layers), particles (pooled exhaust), ship mesh
