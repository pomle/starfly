import { mat4 } from './core/math.js';
import { Starfield } from './graphics/starfield.js';
import { Particles } from './graphics/particles.js';
import { Bullets } from './graphics/bullets.js';
import { Ship, SHIP_ENGINE_OFFSET, TURRET_MOUNT_Y, TURRET_BARREL } from './graphics/ship.js';
import { Crosshair } from './ui/crosshair.js';
import { Sprite, SpriteRenderer } from './ui/sprite.js';
import { makeTextCanvas } from './ui/bitmapfont.js';

const STEP = 1 / 60; // must match the loop's fixed step
const SHIP_SCALE = 0.8;
const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
const wrapPi = (a) => a - TAU * Math.round(a / TAU);

// Turret spring: torque = K * angleError - C * angularVelocity.
// zeta = C / (2*sqrt(K)) ~ 0.4 -> snappy with a visible overshoot/wobble.
const TURRET_K = 60;
const TURRET_C = 6;

// Vertical auto-scroller: the camera climbs +Y at a constant speed; the ship flies
// relative to the screen and is clamped inside it.
const SCROLL_SPEED = 3;   // world units / s
const SHIP_SPEED = 10;    // max speed relative to the screen
const SHIP_RESPONSE = 10; // how quickly velocity chases the input (1/s)
const EDGE_MARGIN = 1.2;  // keeps the ship fully on screen

const LOGO_FADE = 0.6;       // seconds for the splash to fade out once the game starts
const PROMPT_PERIOD = 1.0;   // blink cycle for "PRESS ANY KEY"
const PROMPT_ON = 0.6;       // fraction of the cycle the text is visible

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
    // vx/vy are the ship's velocity relative to the screen (not including scroll).
    this.ship = { x: 0, y: -5, vx: 0, vy: 0, prevX: 0, prevY: -5 };
    this.cam = { y: 0, prevY: 0 }; // camera x is fixed at 0
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

    // Splash screen
    this.state = 'splash'; // 'splash' | 'playing'
    this.canvas.style.cursor = 'default';
    this.logoFade = 1;     // 1 while the splash is up; fades to 0 after starting
    this.sprites = new SpriteRenderer(gl);
    this.logo = Sprite.fromUrl(gl, new URL('../assets/logo.png', import.meta.url).href);
    this.prompt = Sprite.fromCanvas(gl, makeTextCanvas('PRESS ANY KEY'), { pixelArt: true });

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

  /** World position of the turret pivot for a given ship position (ship always points up). */
  turretPos(x, y) {
    return [x, y + TURRET_MOUNT_Y * SHIP_SCALE];
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
    s.prevX = s.x; s.prevY = s.y;
    t.prevAngle = t.angle;
    this.cam.prevY = this.cam.y;

    // --- Camera auto-scrolls (also behind the splash screen) ---
    this.cam.y += SCROLL_SPEED * dt;

    if (this.state === 'splash') {
      if (i.anyPressed()) this.startGame();
      return;
    }
    this.logoFade = Math.max(0, this.logoFade - dt / LOGO_FADE);

    // --- Ship: screen-relative movement ---
    const k = (a, b) => (i.isDown(a) || i.isDown(b) ? 1 : 0);
    let mx = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft');
    let my = k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown');
    if (mx && my) { mx *= Math.SQRT1_2; my *= Math.SQRT1_2; }
    const blend = Math.min(1, SHIP_RESPONSE * dt);
    s.vx += (mx * SHIP_SPEED - s.vx) * blend;
    s.vy += (my * SHIP_SPEED - s.vy) * blend;
    s.x += s.vx * dt;
    s.y += (s.vy + SCROLL_SPEED) * dt; // rides along with the camera

    const hw = this.viewW / 2 - EDGE_MARGIN, hh = this.worldHeight / 2 - EDGE_MARGIN;
    if (s.x < -hw) { s.x = -hw; s.vx = Math.max(0, s.vx); }
    if (s.x > hw) { s.x = hw; s.vx = Math.min(0, s.vx); }
    const minY = this.cam.y - hh, maxY = this.cam.y + hh;
    if (s.y < minY) { s.y = minY; s.vy = Math.max(0, s.vy); }
    if (s.y > maxY) { s.y = maxY; s.vy = Math.min(0, s.vy); }

    this.emitExhaust(my > 0 ? 3 : 1);

    // --- Turret: spring chases the desired aim direction ---
    this.updateAim();
    const [tx, ty] = this.turretPos(s.x, s.y);
    const desired = angleOf(this.aim.ox - tx, this.cam.y + this.aim.oy - ty);
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

  startGame() {
    this.state = 'playing';
    this.canvas.style.cursor = 'none';
    const s = this.ship;
    s.x = s.prevX = 0;
    s.y = s.prevY = this.cam.y - 5;
    s.vx = s.vy = 0;
    this.turret.cooldown = 0.25; // don't fire from the key that started the game
  }

  fire(tx, ty) {
    const s = this.ship, t = this.turret;
    const a = t.angle + rand(-BULLET_SPREAD, BULLET_SPREAD);
    const [dx, dy] = dirOf(a);
    const reach = TURRET_BARREL * SHIP_SCALE;
    const mx = tx + dx * reach, my = ty + dy * reach;
    const wvy = s.vy + SCROLL_SPEED; // world-space ship velocity
    this.bullets.spawn(mx, my, s.vx + dx * BULLET_SPEED, wvy + dy * BULLET_SPEED);
    for (let n = 0; n < 3; n++) { // muzzle flash
      const sp = rand(3, 9), side = rand(-2, 2);
      this.particles.emit(mx, my, s.vx + dx * sp - dy * side, wvy + dy * sp + dx * side,
        rand(0.06, 0.14), rand(0.25, 0.45));
    }
  }

  emitExhaust(count) {
    const s = this.ship;
    const ex = s.x, ey = s.y + SHIP_ENGINE_OFFSET * SHIP_SCALE;
    const wvy = s.vy + SCROLL_SPEED;
    for (let n = 0; n < count; n++) {
      const speed = rand(6, 11);
      const side = rand(-1.2, 1.2);
      this.particles.emit(
        ex + rand(-0.1, 0.1), ey + rand(-0.1, 0.1),
        s.vx + side,
        wvy - speed,
        rand(0.3, 0.7), rand(0.5, 0.9),
      );
    }
  }

  /** Variable-rate render; alpha interpolates between the last two sim states. */
  render(alpha) {
    const gl = this.gl, s = this.ship, t = this.turret;
    const x = s.prevX + (s.x - s.prevX) * alpha;
    const y = s.prevY + (s.y - s.prevY) * alpha;
    const camY = this.cam.prevY + (this.cam.y - this.cam.prevY) * alpha;
    const ta = t.prevAngle + (t.angle - t.prevAngle) * alpha;
    const [tx, ty] = this.turretPos(x, y);

    // Camera scrolls upward at a constant rate.
    const hw = this.viewW / 2, hh = this.worldHeight / 2;
    mat4.ortho(this.viewProj, -hw, hw, camY - hh, camY + hh, -1, 1);

    gl.clear(gl.COLOR_BUFFER_BIT);
    const playing = this.state === 'playing';

    // Additive layers: stars, exhaust, bullets.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.starfield.render(0, camY, this.viewW, this.worldHeight, this.pxScale, this.time);
    if (playing) {
      this.particles.render(this.viewProj, this.pxPerUnit);
      this.bullets.render(this.viewProj, this.pxScale, alpha * STEP);
    }
    gl.disable(gl.BLEND);

    if (!playing) {
      this.renderSplash();
      return;
    }

    this.shipGfx.renderHull(this.viewProj, x, y, 0, SHIP_SCALE);
    this.shipGfx.renderTurret(this.viewProj, tx, ty, ta, SHIP_SCALE);

    // UI: white reticle = where you want to aim, orange dot = where the turret points
    // (same distance as the reticle, so the gap shows the spring lag).
    const dist = Math.hypot(this.aim.ox - tx, this.aim.oy - (ty - camY));
    const [dx, dy] = dirOf(ta);
    const ax = (tx + dx * dist) / hw, ay = (ty + dy * dist - camY) / hh;
    this.crosshair.render(this.width, this.height, this.dpr, this.aim.nx, this.aim.ny, ax, ay);

    if (this.logoFade > 0) this.renderSplash();
  }

  /** Logo plus blinking prompt. While fading out, only the logo is drawn. */
  renderSplash() {
    const W = this.width, H = this.height;
    const waiting = this.state === 'splash';
    const fade = waiting ? 1 : this.logoFade;

    // Logo: up to 80% of the width / 45% of the height, gently bobbing.
    const aspect = this.logo.width / this.logo.height;
    const lw = Math.min(W * 0.8, H * 0.45 * aspect);
    const lh = lw / aspect;
    const bob = Math.sin(this.time * 1.5) * H * 0.01;
    this.sprites.draw(this.logo, W / 2, H * 0.6 + bob, lw, lh, fade, W, H);

    // Prompt: integer pixel scale keeps the bitmap font crisp.
    if (waiting && (this.time % PROMPT_PERIOD) / PROMPT_PERIOD < PROMPT_ON) {
      const scale = Math.max(2, Math.round(H / 1080 * 6));
      this.sprites.draw(this.prompt, W / 2, H * 0.2,
        this.prompt.width * scale, this.prompt.height * scale, 1, W, H);
    }
  }
}
