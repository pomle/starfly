import { mat4 } from './core/math.js';
import { Starfield } from './graphics/starfield.js';
import { Particles } from './graphics/particles.js';
import { Bullets } from './graphics/bullets.js';
import { Ship, SHIP_ENGINE_OFFSET, TURRET_MOUNT_Y, TURRET_BARREL } from './graphics/ship.js';
import { Crosshair } from './ui/crosshair.js';

const STEP = 1 / 60; // must match the loop's fixed step
const SHIP_SCALE = 0.8;
const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
const wrapPi = (a) => a - TAU * Math.round(a / TAU);

// Turret spring: torque = K * angleError - C * angularVelocity.
// zeta = C / (2*sqrt(K)) ~ 0.4 -> snappy with a visible overshoot/wobble.
const TURRET_K = 60;
const TURRET_C = 6;

const FIRE_INTERVAL = 0.11; // seconds between shots
const BULLET_SPEED = 35;
const BULLET_SPREAD = 0.02; // radians

// Our angle convention: 0 points +Y, positive is counter-clockwise.
const dirOf = (a) => [-Math.sin(a), Math.cos(a)];
const angleOf = (dx, dy) => Math.atan2(-dx, dy);

export class Game {
  constructor(gl, input) {
    this.gl = gl;
    this.canvas = gl.canvas;
    this.input = input;
    this.time = 0;
    this.ship = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, prevX: 0, prevY: 0, prevAngle: 0 };
    // angle/prevAngle are kept unwrapped so interpolation never jumps.
    this.turret = { angle: 0, prevAngle: 0, omega: 0, cooldown: 0 };
    this.aim = { nx: 0, ny: 1, ox: 0, oy: 1 }; // desired aim: NDC and world offset from ship
    this.viewProj = mat4.create();
    this.worldHeight = 20; // world units visible vertically
    this.viewW = this.worldHeight;
    this.width = 1; this.height = 1; this.dpr = 1;
    this.pxPerUnit = 1;
    this.pxScale = 1;

    this.starfield = new Starfield(gl);
    this.particles = new Particles(gl);
    this.bullets = new Bullets(gl);
    this.shipGfx = new Ship(gl);
    this.crosshair = new Crosshair(gl);

    gl.clearColor(0.01, 0.01, 0.04, 1);
  }

  resize(width, height) {
    this.gl.viewport(0, 0, width, height);
    this.width = width; this.height = height;
    this.dpr = height / Math.max(1, this.canvas.clientHeight);
    this.viewW = this.worldHeight * (width / height);
    this.pxPerUnit = height / this.worldHeight;
    this.pxScale = height / 1080;
  }

  /** World position of the turret pivot for a given ship pose. */
  turretPos(x, y, angle) {
    const [fx, fy] = dirOf(angle);
    const d = TURRET_MOUNT_Y * SHIP_SCALE;
    return [x + fx * d, y + fy * d];
  }

  /** Converts the mouse into the desired aim (NDC + world offset from the camera center). */
  updateAim() {
    const r = this.canvas.getBoundingClientRect();
    const m = this.input.mouse;
    const nx = ((m.x - r.left) / r.width) * 2 - 1;
    const ny = 1 - ((m.y - r.top) / r.height) * 2;
    const a = this.aim;
    a.nx = nx; a.ny = ny;
    a.ox = nx * this.viewW / 2;
    a.oy = ny * this.worldHeight / 2;
  }

  /** Fixed-step simulation. */
  update(dt) {
    this.time += dt;
    const s = this.ship, t = this.turret, i = this.input;
    s.prevX = s.x; s.prevY = s.y; s.prevAngle = s.angle;
    t.prevAngle = t.angle;

    // --- Ship ---
    const turn = (i.isDown('ArrowLeft') || i.isDown('KeyA') ? 1 : 0) -
                 (i.isDown('ArrowRight') || i.isDown('KeyD') ? 1 : 0);
    s.angle += turn * 3 * dt;

    const [fx, fy] = dirOf(s.angle);
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

    // --- Turret: spring chases the desired aim direction ---
    this.updateAim();
    const [tx, ty] = this.turretPos(s.x, s.y, s.angle);
    const desired = angleOf(s.x + this.aim.ox - tx, s.y + this.aim.oy - ty);
    const err = wrapPi(desired - t.angle);
    t.omega += (TURRET_K * err - TURRET_C * t.omega) * dt;
    t.angle += t.omega * dt;

    // --- Shooting: fires along the turret's *actual* heading ---
    t.cooldown = Math.max(0, t.cooldown - dt);
    const wantFire = (i.mouse.buttons & 1) || i.isDown('Space');
    if (wantFire && t.cooldown === 0) {
      t.cooldown = FIRE_INTERVAL;
      this.fire(tx, ty);
    }

    this.bullets.update(dt);
    this.particles.update(dt);
  }

  fire(tx, ty) {
    const s = this.ship, t = this.turret;
    const a = t.angle + rand(-BULLET_SPREAD, BULLET_SPREAD);
    const [dx, dy] = dirOf(a);
    const reach = TURRET_BARREL * SHIP_SCALE;
    const mx = tx + dx * reach, my = ty + dy * reach;
    this.bullets.spawn(mx, my, s.vx + dx * BULLET_SPEED, s.vy + dy * BULLET_SPEED);
    for (let n = 0; n < 3; n++) { // muzzle flash
      const sp = rand(3, 9), side = rand(-2, 2);
      this.particles.emit(mx, my, s.vx + dx * sp - dy * side, s.vy + dy * sp + dx * side,
        rand(0.06, 0.14), rand(0.25, 0.45));
    }
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
    const gl = this.gl, s = this.ship, t = this.turret;
    const x = s.prevX + (s.x - s.prevX) * alpha;
    const y = s.prevY + (s.y - s.prevY) * alpha;
    const a = s.prevAngle + (s.angle - s.prevAngle) * alpha;
    const ta = t.prevAngle + (t.angle - t.prevAngle) * alpha;
    const [tx, ty] = this.turretPos(x, y, a);

    // Camera follows the ship.
    const hw = this.viewW / 2, hh = this.worldHeight / 2;
    mat4.ortho(this.viewProj, x - hw, x + hw, y - hh, y + hh, -1, 1);

    gl.clear(gl.COLOR_BUFFER_BIT);

    // Additive layers: stars, exhaust, bullets.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.starfield.render(x, y, this.viewW, this.worldHeight, this.pxScale, this.time);
    this.particles.render(this.viewProj, this.pxPerUnit);
    this.bullets.render(this.viewProj, this.pxScale, alpha * STEP);
    gl.disable(gl.BLEND);

    this.shipGfx.renderHull(this.viewProj, x, y, a, SHIP_SCALE);
    this.shipGfx.renderTurret(this.viewProj, tx, ty, ta, SHIP_SCALE);

    // UI: white reticle = where you want to aim, orange dot = where the turret points
    // (same distance as the reticle, so the gap shows the spring lag).
    const dist = Math.hypot(this.aim.ox - (tx - x), this.aim.oy - (ty - y));
    const [dx, dy] = dirOf(ta);
    const ax = (tx + dx * dist - x) / hw, ay = (ty + dy * dist - y) / hh;
    this.crosshair.render(this.width, this.height, this.dpr, this.aim.nx, this.aim.ny, ax, ay);
  }
}
