import { mat4 } from './core/math.js';
import { Starfield } from './graphics/starfield.js';
import { Particles } from './graphics/particles.js';
import { Debris } from './graphics/debris.js';
import { Bullets } from './graphics/bullets.js';
import { Ship, SHIP_ENGINE_Y, SHIP_NOZZLES_X, TURRET_MOUNT_Y, TURRET_REACH } from './graphics/ship.js';
import { Enemies, ENEMY_TYPES } from './enemies.js';
import { loadLevel, LevelRunner } from './level.js';
import { Crosshair } from './ui/crosshair.js';
import { Music } from './core/music.js';
import { Sfx } from './core/sfx.js';
import { Sprite, SpriteRenderer } from './ui/sprite.js';
import { TextLabel } from './ui/textlabel.js';
import { makeTextCanvas } from './ui/bitmapfont.js';

const STEP = 1 / 60; // must match the loop's fixed step
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
const MAX_ROLL = 0.8;     // radians (~57 degrees) at full sideways speed
const ROLL_RESPONSE = 12; // how quickly the roll chases the target (1/s)
const EDGE_MARGIN = 1.2;  // keeps the ship fully on screen

const LOGO_FADE = 0.6;       // seconds for the splash to fade out once the game starts
const CLEAR_MUSIC_FADE = 1.5;    // seconds to fade the music out when the level is cleared
// Levels are played in this order; clearing one starts the next.
const LEVEL_FILES = ['level1.json', 'level2.json', 'level3.json'];
const LEVEL_CLEAR_TIME = 3.5;  // seconds "LEVEL CLEAR" shows before the next level begins

const INTRO_TIME = 4;         // seconds the level name blinks before the level starts
const INTRO_BLINK = 1.0;       // blink cycle (half on, half off)
const PROMPT_PERIOD = 1.0;   // blink cycle for "PRESS ANY KEY"
const PROMPT_ON = 0.6;       // fraction of the cycle the text is visible

const MUSIC_FADE = 1.0;        // seconds to fade the splash music out / level music in

const BULLET_DAMAGE = 1;    // hp removed from an enemy per bullet hit

const PLAYER_MAX_HP = 3;
const PLAYER_RADIUS = 0.5;   // forgiving hitbox, smaller than the sprite
const CONTACT_FACTOR = 0.8;  // enemy contact radius = enemy.radius * this
const FLY_IN_TIME = 1.2;      // seconds for the ship to fly in from below the screen
const FLY_IN_REST_Y = -5;      // where the ship settles, relative to the screen center
const INVULN_TIME = 2;       // seconds of invulnerability after a hit / respawn
const RESPAWN_TIME = 3;      // seconds the ship stays wrecked before respawning

const SPARK_COUNT = 10;          // tiny monochrome sparks per non-lethal hit
const SPRAY_ANGLE = Math.PI / 4;  // total width of the spark cone: 45 degrees

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
      hp: PLAYER_MAX_HP, alive: true, invuln: 0, respawn: 0, flyIn: 0 };
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
    this.debris = new Debris(gl);
    this.enemies = new Enemies(gl);
    this.levels = null;    // all parsed levels, once loaded
    this.levelMusics = null; // Music (or null) per level, from each level's "music" field
    this.levelIndex = 0;
    this.level = null;     // the current level's parsed data
    this.runner = null;    // LevelRunner for the current level, created lazily
    this.clearTimer = 0;   // counts down while "LEVEL CLEAR" shows
    Promise.all(LEVEL_FILES.map((f) => loadLevel(new URL(`../levels/${f}`, import.meta.url).href)))
      .then((levels) => {
        this.levels = levels;
        this.level = levels[0];
        // One Music per level that names a track (null = silence), preloaded up front.
        this.levelMusics = levels.map((l) => (l.music
          ? new Music(new URL(`../${l.music}`, import.meta.url).href) : null));
        if (this.state === 'playing') this.playLevelMusic(); // the game started while loading
      })
      .catch((err) => console.error(err));
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
    this.score = 0;
    this.introLeft = INTRO_TIME; // level name shows (and the level clock waits) until 0
    this.nameLabel = new TextLabel(gl);
    this.clearLabel = new TextLabel(gl);
    this.levelClear = false;     // set once a non-looping level is finished and cleared
    this.hpLabel = new TextLabel(gl);
    this.scoreLabel = new TextLabel(gl);
    this.gatePrompt = Sprite.fromCanvas(gl, makeTextCanvas('CLICK TO START'), { pixelArt: true });

    // Splash music. Browsers block audio until a user gesture, so it starts from the
    // gate screen's click rather than on load.
    this.music = new Music(new URL('../music/bearound.ogg', import.meta.url).href);
    this.sfx = new Sfx();

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
    return [x, y + TURRET_MOUNT_Y];
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
    for (const m of this.levelMusics ?? []) m?.update(dt);

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
    this.updateLevel(dt);
    this.enemies.update(dt, this.cam.y, this.worldHeight, SCROLL_SPEED, this.ship);
    this.resolveBulletHits(dt);
    if (s.alive) this.resolvePlayerHits(dt);
    this.particles.update(dt);
    this.debris.update(dt);
  }

  /** Spawns enemies on the level's schedule; loops the level if it asks to. */
  updateLevel(dt) {
    if (!this.level) return; // still loading
    if (this.introLeft > 0) { // level name is showing; no enemies yet
      this.introLeft = Math.max(0, this.introLeft - dt);
      return;
    }
    if (this.levelClear) {
      // Show the label for a while, then move on to the next level (if there is one).
      if (this.levelIndex + 1 < this.levels.length && (this.clearTimer -= dt) <= 0) this.nextLevel();
      return;
    }
    if (!this.runner) this.runner = new LevelRunner(this.level);
    const r = this.runner;
    r.update(dt, (sp) => this.enemies.spawn(sp.enemy, sp, this.cam.y, this.viewW, this.worldHeight));
    if (r.done && this.enemies.list.length === 0) {
      if (this.level.loop) {
        r.reset(this.level.loopDelay);
      } else {
        this.levelClear = true; // all spawned and cleared: end the level
        this.clearTimer = LEVEL_CLEAR_TIME;
        this.levelMusics[this.levelIndex]?.fadeOut(CLEAR_MUSIC_FADE);
      }
    }
  }

  /** Starts the next level: name intro, fresh spawn schedule, music back in. */
  nextLevel() {
    this.levelIndex++;
    this.level = this.levels[this.levelIndex];
    this.runner = null;
    this.levelClear = false;
    this.introLeft = INTRO_TIME;
    this.playLevelMusic();
  }

  /** Fades in the current level's music, if its level file names one. */
  playLevelMusic() {
    this.levelMusics?.[this.levelIndex]?.play({ fadeIn: MUSIC_FADE });
  }

  /** Ship movement, roll, turret and shooting. */
  updatePlayer(dt) {
    const s = this.ship, t = this.turret, i = this.input;
    if (s.flyIn === 0) s.invuln = Math.max(0, s.invuln - dt); // the timer starts after the fly-in

    const thrust = s.flyIn > 0 ? this.flyInStep(dt) : this.moveShip(dt);
    this.emitExhaust(thrust > 0 ? 3 : 1);

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

  /** Player-controlled movement. Returns the up/down input (for exhaust strength). */
  moveShip(dt) {
    const s = this.ship, i = this.input;
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
    return my;
  }

  /** Scripted entry from below the screen with an ease-out, ignoring input. Returns 1 (thrusting). */
  flyInStep(dt) {
    const s = this.ship;
    s.flyIn = Math.max(0, s.flyIn - dt);
    const t = 1 - s.flyIn / FLY_IN_TIME;
    const ease = 1 - (1 - t) ** 3; // fast at first, settling gently
    const startRel = -(this.worldHeight / 2 + 2);
    s.x = 0;
    s.y = this.cam.y + startRel + (FLY_IN_REST_Y - startRel) * ease;
    s.vx = s.vy = 0;
    s.roll += (0 - s.roll) * Math.min(1, ROLL_RESPONSE * dt);
    return 1;
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
    s.y = s.prevY = this.cam.y - (this.worldHeight / 2 + 2); // just below the screen
    s.flyIn = FLY_IN_TIME;
    s.vx = s.vy = 0;
    s.roll = s.prevRoll = 0;
    this.turret.omega = 0;
  }

  /** Enemies that touch the ship blow up and cost it 1 hp. No contact while invulnerable. */
  resolvePlayerHits(dt) {
    const s = this.ship;
    if (s.invuln > 0 || s.flyIn > 0) return;
    for (const e of this.enemies.list) {
      const reach = PLAYER_RADIUS + e.radius * CONTACT_FACTOR;
      if (Math.hypot(e.x - s.x, e.y - s.y) >= reach) continue;
      e.dead = true;
      this.explode(e.x, e.y, ENEMY_TYPES[e.type].explosion ?? 1);
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
    this.playLevelMusic(); // crossfade into the level track
    this.canvas.style.cursor = 'none';
    this.resetShip();
    this.score = 0;
    this.introLeft = INTRO_TIME;
    this.levelClear = false;
    this.turret.cooldown = 0.25; // don't fire from the key that started the game
  }

  /** Bullets damage enemies; enemies at 0 hp explode. */
  resolveBulletHits(dt) {
    const bullets = this.bullets;
    for (const e of this.enemies.list) {
      for (let b = bullets.count - 1; b >= 0; b--) {
        if (!bullets.hits(b, e.x, e.y, e.radius, dt)) continue;
        const bvx = bullets.vx[b], bvy = bullets.vy[b]; // read before kill() swaps slots
        bullets.kill(b);
        e.hp -= BULLET_DAMAGE;
        if (e.hp <= 0) {
          e.dead = true;
          this.score += e.score; // only shot-down enemies score, not ramming
          this.explode(e.x, e.y, ENEMY_TYPES[e.type].explosion ?? 1);
          break;
        }
        this.enemies.hit(e, bvx, bvy);
        this.sfx.hit({ pan: e.x / (this.viewW / 2) });
        this.hitDebris(e, bvx, bvy);
        this.hitSpark(e.x, e.y);
      }
    }
    this.enemies.sweep();
  }

  /**
   * Hit debris, thrown out of the side facing away from the shot: a few soft glowing
   * chips in the enemy's color plus a spray of 1-2 px monochrome sparks in a cone
   * (SPRAY_ANGLE wide) around the bullet's direction.
   */
  hitDebris(e, bvx, bvy) {
    const len = Math.hypot(bvx, bvy) || 1;
    const dx = bvx / len, dy = bvy / len; // direction the bullet was travelling
    const px = -dy, py = dx;              // perpendicular
    const base = ENEMY_TYPES[e.type].debris;
    const carry = SCROLL_SPEED - e.descent; // the enemy's own world velocity (y)
    const out = e.radius * 0.75;
    const ex = e.x + dx * out, ey = e.y + dy * out; // exit point on the far side

    // Chips.
    const chips = 3 + (Math.random() < 0.5 ? 1 : 0);
    for (let k = 0; k < chips; k++) {
      const side = rand(-0.5, 0.5) * e.radius;
      const sp = rand(3, 7), spread = rand(-2.5, 2.5);
      const shade = rand(0.8, 1.25);
      this.debris.emit(
        ex + px * side, ey + py * side,
        dx * sp + px * spread, dy * sp + py * spread + carry,
        rand(0.2, 0.34) * (e.radius > 1 ? 1.3 : 1),
        base.map((c) => Math.min(1, c * shade)),
        rand(0.75, 1.35), // 3x the original 0.25-0.45 s
      );
    }

    // Spray of tiny sparks.
    const heading = Math.atan2(dy, dx);
    const pxToUnits = this.dpr / this.pxPerUnit; // 1 CSS px in world units
    for (let k = 0; k < SPARK_COUNT; k++) {
      const a = heading + rand(-SPRAY_ANGLE / 2, SPRAY_ANGLE / 2);
      const sp = rand(8, 18);
      const g = rand(0.7, 1);
      this.debris.emit(
        ex, ey,
        Math.cos(a) * sp, Math.sin(a) * sp + carry,
        -(Math.random() < 0.5 ? 1 : 2) * pxToUnits, // negative size = crisp spark
        [g, g, g],
        rand(0.45, 1.2), // 3x the original 0.15-0.4 s
      );
    }
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
    const reach = TURRET_REACH;
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
    // The hull foreshortens by cos(roll) around the ship's center line, so the nozzles do too.
    const squeeze = Math.cos(s.roll);
    for (let n = 0; n < count; n++) {
      // Spread the emissions along this step's travel so the trail is continuous.
      const f = (n + 1) / count;
      const nozzle = SHIP_NOZZLES_X[count >= SHIP_NOZZLES_X.length ? n % SHIP_NOZZLES_X.length
                                                                    : Math.floor(Math.random() * SHIP_NOZZLES_X.length)];
      const ex = s.prevX + (s.x - s.prevX) * f + nozzle * squeeze + rand(-0.03, 0.03);
      const ey = s.prevY + (s.y - s.prevY) * f + SHIP_ENGINE_Y + rand(-0.03, 0.03);
      const speed = rand(6, 11);
      // Exhaust doesn't inherit the ship's own sideways/forward motion: it is left behind
      // in the world (which only scrolls), so it trails the ship instead of running ahead.
      this.particles.emit(
        ex, ey,
        rand(-1.2, 1.2),
        SCROLL_SPEED - speed,
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

    this.enemies.render(this.viewProj, alpha, this.pxPerUnit);
    this.debris.render(this.viewProj, this.pxPerUnit);
    // Blink while invulnerable; hidden while wrecked.
    const blinkOff = s.invuln > 0 && s.flyIn === 0 && Math.floor(this.time * 12) % 2 === 0;
    if (s.alive && !blinkOff) {
      this.shipGfx.renderHull(this.viewProj, x, y, roll);
      // The turret is simulated (it aims and fires) but intentionally not drawn.
      // this.shipGfx.renderTurret(this.viewProj, tx, ty, ta);
    }

    // UI: white reticle = where you want to aim, orange dot = where the turret points
    // (same distance as the reticle, so the gap shows the spring lag).
    const dist = Math.hypot(this.aim.ox - tx, this.aim.oy - (ty - camY));
    const [dx, dy] = dirOf(ta);
    const ax = (tx + dx * dist) / hw, ay = (ty + dy * dist - camY) / hh;
    this.crosshair.render(this.width, this.height, this.dpr, this.aim.nx, this.aim.ny, ax, ay);

    this.renderHud();
    this.renderLevelName();
    this.renderLevelClear();
    if (this.logoFade > 0) this.renderSplash();
  }

  /** Blinking level title during the intro. Uses the bitmap font (A-Z, 0-9, space, - ! .). */
  renderLevelName() {
    if (!this.level || this.introLeft <= 0) return;
    const elapsed = INTRO_TIME - this.introLeft;
    if ((elapsed % INTRO_BLINK) >= INTRO_BLINK / 2) return;
    this.nameLabel.set(this.level.name.toUpperCase());
    const sp = this.nameLabel.sprite;
    const scale = Math.max(3, Math.round(this.height / 1080 * 10));
    this.sprites.draw(sp, this.width / 2, this.height * 0.55,
      sp.width * scale, sp.height * scale, 1, this.width, this.height);
  }

  /** Steady "LEVEL CLEAR" label once a non-looping level has ended. */
  renderLevelClear() {
    if (!this.levelClear) return;
    this.clearLabel.set('LEVEL CLEAR');
    const sp = this.clearLabel.sprite;
    const scale = Math.max(3, Math.round(this.height / 1080 * 10));
    this.sprites.draw(sp, this.width / 2, this.height * 0.55,
      sp.width * scale, sp.height * scale, 1, this.width, this.height);
  }

  /** HP top-left, score top-right. */
  renderHud() {
    const W = this.width, H = this.height;
    this.hpLabel.set(`SHIELD ${Math.max(0, this.ship.hp)}`);
    this.scoreLabel.set(`SCORE ${String(this.score).padStart(6, '0')}`);

    const scale = Math.max(2, Math.round(H / 1080 * 4));
    const margin = 24 * this.pxScale;
    for (const [label, right] of [[this.hpLabel, false], [this.scoreLabel, true]]) {
      const sp = label.sprite;
      const w = sp.width * scale, h = sp.height * scale;
      const cx = right ? W - margin - w / 2 : margin + w / 2;
      this.sprites.draw(sp, cx, H - margin - h / 2, w, h, 1, W, H);
    }
  }

  /** Logo plus blinking prompt. While fading out, only the logo is drawn. */
  renderSplash() {
    const W = this.width, H = this.height;
    const waiting = this.state === 'splash';
    const fade = waiting ? 1 : this.logoFade;

    // Logo: up to 80% of the width / 45% of the height.
    const aspect = this.logo.width / this.logo.height;
    const lw = Math.min(W * 0.8, H * 0.45 * aspect);
    const lh = lw / aspect;
    this.sprites.draw(this.logo, W / 2, H * 0.6, lw, lh, fade, W, H);

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
