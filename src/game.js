import { mat4 } from './core/math.js';
import { Starfield } from './graphics/starfield.js';
import { Particles } from './graphics/particles.js';
import { Ship, SHIP_ENGINE_OFFSET } from './graphics/ship.js';

const SHIP_SCALE = 0.8;
const rand = (a, b) => a + Math.random() * (b - a);

export class Game {
  constructor(gl, input) {
    this.gl = gl;
    this.input = input;
    this.time = 0;
    this.ship = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, prevX: 0, prevY: 0, prevAngle: 0 };
    this.viewProj = mat4.create();
    this.worldHeight = 20; // world units visible vertically
    this.viewW = this.worldHeight;
    this.pxPerUnit = 1;
    this.pxScale = 1;

    this.starfield = new Starfield(gl);
    this.particles = new Particles(gl);
    this.shipGfx = new Ship(gl);

    gl.clearColor(0.01, 0.01, 0.04, 1);
  }

  resize(width, height) {
    this.gl.viewport(0, 0, width, height);
    this.viewW = this.worldHeight * (width / height);
    this.pxPerUnit = height / this.worldHeight;
    this.pxScale = height / 1080;
  }

  /** Fixed-step simulation. */
  update(dt) {
    this.time += dt;
    const s = this.ship, i = this.input;
    s.prevX = s.x; s.prevY = s.y; s.prevAngle = s.angle;

    const turn = (i.isDown('ArrowLeft') || i.isDown('KeyA') ? 1 : 0) -
                 (i.isDown('ArrowRight') || i.isDown('KeyD') ? 1 : 0);
    s.angle += turn * 3 * dt;

    const fx = -Math.sin(s.angle), fy = Math.cos(s.angle); // forward
    if (i.isDown('ArrowUp') || i.isDown('KeyW')) {
      const thrust = 12;
      s.vx += fx * thrust * dt;
      s.vy += fy * thrust * dt;
      this.emitExhaust(fx, fy);
    }
    s.vx *= 1 - 0.5 * dt;
    s.vy *= 1 - 0.5 * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;

    this.particles.update(dt);
  }

  emitExhaust(fx, fy) {
    const s = this.ship;
    const off = SHIP_ENGINE_OFFSET * SHIP_SCALE;
    const ex = s.x + fx * off, ey = s.y + fy * off;
    for (let n = 0; n < 3; n++) {
      const speed = rand(6, 11);
      const side = rand(-1.2, 1.2);
      this.particles.emit(
        ex + rand(-0.1, 0.1), ey + rand(-0.1, 0.1),
        s.vx - fx * speed - fy * side,
        s.vy - fy * speed + fx * side,
        rand(0.3, 0.7), rand(0.5, 0.9),
      );
    }
  }

  /** Variable-rate render; alpha interpolates between the last two sim states. */
  render(alpha) {
    const gl = this.gl, s = this.ship;
    const x = s.prevX + (s.x - s.prevX) * alpha;
    const y = s.prevY + (s.y - s.prevY) * alpha;
    const a = s.prevAngle + (s.angle - s.prevAngle) * alpha;

    // Camera follows the ship.
    const hw = this.viewW / 2, hh = this.worldHeight / 2;
    mat4.ortho(this.viewProj, x - hw, x + hw, y - hh, y + hh, -1, 1);

    gl.clear(gl.COLOR_BUFFER_BIT);

    // Additive layers: stars and exhaust.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.starfield.render(x, y, this.viewW, this.worldHeight, this.pxScale, this.time);
    this.particles.render(this.viewProj, this.pxPerUnit);
    gl.disable(gl.BLEND);

    this.shipGfx.render(this.viewProj, x, y, a, SHIP_SCALE);
  }
}
