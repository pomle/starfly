import { mat4 } from './core/math.js';
import { Starfield } from './graphics/starfield.js';
import { Particles } from './graphics/particles.js';
import { Bullets } from './graphics/bullets.js';
import { Ship, SHIP_ENGINE_OFFSET, TURRET_MOUNT_Y, TURRET_BARREL } from './graphics/ship.js';
import { Enemies } from './enemies.js';
import { Crosshair } from './ui/crosshair.js';
import { Music } from './core/music.js';
import { Sfx } from './core/sfx.js';
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
const MAX_ROLL = 1.0;     // radians (~57 degrees) at full sideways speed
const ROLL_RESPONSE = 12; // how quickly the roll chases the target (1/s)
const EDGE_MARGIN = 1.2;  // keeps the ship fully on screen

const LOGO_FADE = 0.6;       // seconds for the splash to fade out once the game starts
const PROMPT_PERIOD = 1.0;   // blink cycle for "PRESS ANY KEY"
const PROMPT_ON = 0.6;       // fraction of the cycle the text is visible

const MUSIC_FADE = 1.0;        // seconds to fade the splash music out / level music in

const BULLET_DAMAGE = 1;    // hp removed from an enemy per bullet hit

const PLAYER_MAX_HP = 3;
const PLAYER_RADIUS = 0.5;   // forgiving hitbox, smaller than the sprite
const CONTACT_FACTOR = 0.8;  // enemy contact radius = enemy.radius * this
const INVULN_TIME = 2;       // seconds of invulnerability after a hit / respawn
const RESPAWN_TIME = 3;      // seconds the ship stays wrecked before respawning

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
    this.ship = { x: 0, y: -5, vx: 0, vy: 0, prevX: 0, prevY: -5, roll: 0, prevRoll: 0,
      hp: PLAYER_MAX_HP, alive: true, invuln: 0, respawn: 0 };
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
    this.enemies = new Enemies(gl);
    this.shipGfx = new Ship(gl);
    this.crosshair = new Crosshair(gl);

    // Splash screen
    // 'gate' (click to unlock audio) -> 'splash' (logo + music) -> 'playing'
    this.state = 'gate';
    this.canvas.style.cursor = 'default';
    this.logoFade = 1;     // 1 while the splash is up; fades to 0 after starting
    this.sprites = new SpriteRenderer(gl);
    this.logo = Sprite.fromUrl(gl, new URL('../assets/logo.png', import.meta.url).href);
    this.prompt = Sprite.fromCanvas(gl, makeTextCanvas('PRESS ANY KEY'), { pixelArt: true });
    this.hud = null;       // "HP n" sprite, rebuilt whenever hp changes
    this.hudHp = -1;
    this.gatePrompt = Sprite.fromCanvas(gl, makeTextCanvas('CLICK TO START'), { pixelArt: true });

    // Splash music. Browsers block audio until a user gesture, so it starts from the
    // gate screen's click rather than on load.
    this.music = new Music(new URL('../music/bearound.ogg', import.meta.url).href);
    this.sfx = new Sfx();
    this.levelMusic = new Music(new URL('../music/coloris.ogg', import.meta.url).href);

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
    s.prevX = s.x; s.prevY = s.y; s.prevRoll = s.roll;
    t.prevAngle = t.angle;
    this.cam.prevY = this.cam.y;
    this.music.update(dt);
    this.levelMusic.update(dt);

    // --- Camera auto-scrolls (also behind the splash screen) ---
    this.cam.y += SCROLL_SPEED * dt;

    if (this.state === 'gate') {
      if (i.anyPressed()) {
        this.state = 'splash';
        this.music.play(); // runs right after the user's gesture, so audio is allowed
        this.sfx.unlock();
      }
      return;
    }
    if (this.state === 'splash') {
      if (i.anyPressed()) this.startGame();
      return;
    }
    this.logoFade = Math.max(0, this.logoFade - dt / LOGO_FADE);

    if (s.alive) this.updatePlayer(dt);
    else this.updateRespawn(dt);

    this.bullets.update(dt);
    this.enemies.update(dt, this.cam.y, this.viewW, this.worldHeight, SCROLL_SPEED);
    this.resolveBulletHits(dt);
    if (s.alive) this.resolvePlayerHits(dt);
    this.particles.update(dt);
  }

  /** Ship movement, roll, turret and shooting. */
  updatePlayer(dt) {
    const s = this.ship, t = this.turret, i = this.input;
    s.invuln = Math.max(0, s.invuln - dt);

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

    // Roll: wings tip into the direction of travel (right = positive).
    const rollTarget = (s.vx / SHIP_SPEED) * MAX_ROLL;
    s.roll += (rollTarget - s.roll) * Math.min(1, ROLL_RESPONSE * dt);

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
  }

  updateRespawn(dt) {
    const s = this.ship;
    this.updateAim(); // keep the reticle live while the ship is wrecked
    s.respawn -= dt;
    if (s.respawn > 0) return;
    this.resetShip();
    s.invuln = INVULN_TIME;
  }

  resetShip() {
    const s = this.ship;
    s.alive = true;
    s.hp = PLAYER_MAX_HP;
    s.x = s.prevX = 0;
    s.y = s.prevY = this.cam.y - 5;
    s.vx = s.vy = 0;
    s.roll = s.prevRoll = 0;
    this.turret.omega = 0;
  }

  /** Enemies that touch the ship blow up and cost it 1 hp. No contact while invulnerable. */
  resolvePlayerHits(dt) {
    const s = this.ship;
    if (s.invuln > 0) return;
    for (const e of this.enemies.list) {
      const reach = PLAYER_RADIUS + e.radius * CONTACT_FACTOR;
      if (Math.hypot(e.x - s.x, e.y - s.y) >= reach) continue;
      e.dead = true;
      this.explode(e.x, e.y);
      s.hp--;
      if (s.hp <= 0) {
        s.alive = false;
        s.respawn = RESPAWN_TIME;
        this.explode(s.x, s.y, 2.5);
      } else {
        s.invuln = INVULN_TIME;
        for (let n = 0; n < 3; n++) this.hitSpark(s.x, s.y);
      }
      break;
    }
    this.enemies.sweep();
  }

  startGame() {
    this.state = 'playing';
    this.music.fadeOut(MUSIC_FADE);
    this.levelMusic.play({ fadeIn: MUSIC_FADE }); // crossfade into the level track
    this.canvas.style.cursor = 'none';
    this.resetShip();
    this.turret.cooldown = 0.25; // don't fire from the key that started the game
  }

  /** Bullets damage enemies; enemies at 0 hp explode. */
  resolveBulletHits(dt) {
    const bullets = this.bullets;
    for (const e of this.enemies.list) {
      for (let b = bullets.count - 1; b >= 0; b--) {
        if (!bullets.hits(b, e.x, e.y, e.radius, dt)) continue;
        bullets.kill(b);
        e.hp -= BULLET_DAMAGE;
        if (e.hp <= 0) {
          e.dead = true;
          this.explode(e.x, e.y);
          break;
        }
        this.hitSpark(e.x, e.y);
      }
    }
    this.enemies.sweep();
  }

  hitSpark(x, y) {
    for (let n = 0; n < 4; n++) {
      const a = rand(0, TAU), sp = rand(2, 6);
      this.particles.emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.08, 0.2), rand(0.2, 0.4));
    }
  }

  /** Small explosion: a quick flash plus a ring of embers. */
  explode(x, y, scale = 1) {
    this.sfx.explosion({ size: scale, pan: x / (this.viewW / 2) });
    for (let n = 0; n < 3; n++) this.particles.emit(x, y, 0, 0, rand(0.12, 0.2), rand(1.8, 2.6) * scale);
    for (let n = 0; n < 28 * scale; n++) {
      const a = rand(0, TAU), sp = rand(1.5, 8) * Math.sqrt(scale);
      this.particles.emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.3, 0.7), rand(0.5, 1.1));
    }
  }

  fire(tx, ty) {
    const s = this.ship, t = this.turret;
    const a = t.angle + rand(-BULLET_SPREAD, BULLET_SPREAD);
    const [dx, dy] = dirOf(a);
    const reach = TURRET_BARREL * SHIP_SCALE;
    const mx = tx + dx * reach, my = ty + dy * reach;
    const wvy = s.vy + SCROLL_SPEED; // world-space ship velocity
    this.sfx.laser({ pan: mx / (this.viewW / 2) });
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
    const roll = s.prevRoll + (s.roll - s.prevRoll) * alpha;
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

    if (this.state === 'gate') {
      this.renderPrompt(this.gatePrompt, false);
      return;
    }
    if (!playing) {
      this.renderSplash();
      return;
    }

    this.enemies.render(this.viewProj, alpha);
    // Blink while invulnerable; hidden while wrecked.
    const blinkOff = s.invuln > 0 && Math.floor(this.time * 12) % 2 === 0;
    if (s.alive && !blinkOff) {
      this.shipGfx.renderHull(this.viewProj, x, y, 0, SHIP_SCALE, roll);
      this.shipGfx.renderTurret(this.viewProj, tx, ty, ta, SHIP_SCALE);
    }

    // UI: white reticle = where you want to aim, orange dot = where the turret points
    // (same distance as the reticle, so the gap shows the spring lag).
    const dist = Math.hypot(this.aim.ox - tx, this.aim.oy - (ty - camY));
    const [dx, dy] = dirOf(ta);
    const ax = (tx + dx * dist) / hw, ay = (ty + dy * dist - camY) / hh;
    this.crosshair.render(this.width, this.height, this.dpr, this.aim.nx, this.aim.ny, ax, ay);

    this.renderHud();
    if (this.logoFade > 0) this.renderSplash();
  }

  renderHud() {
    const hp = Math.max(0, this.ship.hp);
    if (hp !== this.hudHp) {
      this.hud?.dispose();
      this.hud = Sprite.fromCanvas(this.gl, makeTextCanvas(`HP ${hp}`), { pixelArt: true });
      this.hudHp = hp;
    }
    const scale = Math.max(2, Math.round(this.height / 1080 * 4));
    const w = this.hud.width * scale, h = this.hud.height * scale;
    const margin = 24 * this.pxScale;
    this.sprites.draw(this.hud, margin + w / 2, this.height - margin - h / 2, w, h, 1,
      this.width, this.height);
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

    if (waiting) this.renderPrompt(this.prompt, true);
  }

  /** Centered bitmap text (blinking ones sit low, under the logo), at an integer pixel scale to keep the font crisp. */
  renderPrompt(sprite, blink) {
    if (blink && (this.time % PROMPT_PERIOD) / PROMPT_PERIOD >= PROMPT_ON) return;
    const W = this.width, H = this.height;
    const scale = Math.max(2, Math.round(H / 1080 * 6));
    this.sprites.draw(sprite, W / 2, blink ? H * 0.2 : H * 0.5,
      sprite.width * scale, sprite.height * scale, 1, W, H);
  }
}
