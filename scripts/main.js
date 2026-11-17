import { createContext, resizeCanvasToDisplaySize } from './core/gl.js';
import { startLoop } from './core/loop.js';
import { Input } from './core/input.js';
import { Game } from './game.js';

const canvas = document.getElementById('game');
let gl;
try {
  gl = createContext(canvas);
} catch (err) {
  document.body.textContent = err.message;
  throw err;
}

const input = new Input();
const game = new Game(gl, input);

function fitCanvas() {
  if (resizeCanvasToDisplaySize(canvas)) game.resize(canvas.width, canvas.height);
}
fitCanvas();

startLoop({
  update(dt) {
    game.update(dt);
    input.endFrame();
  },
  render(alpha) {
    fitCanvas();
    game.render(alpha);
  },
});
