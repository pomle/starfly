import { createProgram } from './core/gl.js';
import { ColorMesh, COLOR_VERT, COLOR_FRAG } from './graphics/colormesh.js';
import { WorldSprite } from './graphics/worldsprite.js';

/**
 * Enemy types referenced by name from level files. Every numeric field except
 * `radius`, `scale` and the sprite fields can be overridden per spawn event via "params".
 * A type is drawn either from a vertex `mesh` (nose down, scaled by `scale`) or from a
 * `sprite` image (`spriteSize` = world units for the whole square image, `spriteRotation`
 * = how much to rotate the art so it faces down; art in the files faces up, so use PI).
 *   hp         hit points
 *   descent    speed down the screen, units/s (relative to the camera)
 *   amplitude  sideways swing of the sine path, world units
 *   frequency  sine speed, rad/s
 *   phase      starting offset on the sine path, radians
 *   score      points awarded when the player shoots it down
 *   speed      flight speed of a homing enemy, units/s (relative to the camera)
 *   turnRate   max turning speed of a homing enemy, rad/s. 0 = not homing: it follows
 *              the sine path / descends at `descent` instead
 *   accel      how quickly a homing enemy's velocity catches up with where it points, 1/s.
 *              Lower = more inertia (it slides through turns)
 */
export const ENEMY_TYPES = {
  jimmy: {
    sprite: new URL('../assets/jimmy.png', import.meta.url).href, spriteSize: 2.6,
    spriteRotation: Math.PI, radius: 0.8, maxRoll: 1.0,
    hp: 3, descent: 4, amplitude: 4, frequency: 2.2, phase: 0, score: 100,
    speed: 0, turnRate: 0, accel: 0,
    debris: [0.9, 0.15, 0.35], // chip color when hit
  },
  // Slow, tough and big: drops straight down (amplitude 0) and takes 10 hits.
  brute: {
    sprite: new URL('../assets/brute.png', import.meta.url).href, spriteSize: 7.2,
    spriteRotation: Math.PI, radius: 2.4, maxRoll: 1.0,
    hp: 10, descent: 2.5, amplitude: 0, frequency: 1, phase: 0, score: 300,
    speed: 0, turnRate: 0, accel: 0,
    debris: [0.7, 0.4, 0.22], // rusty hull chips
  },
  // Rare kamikaze: always points at the player and flies at them, turning at a limited
  // rate so a quick dodge makes it swing wide. Tougher than a jimmy.
  interceptor: {
    sprite: new URL('../assets/interceptor.png', import.meta.url).href, spriteSize: 2.8,
    spriteRotation: Math.PI, radius: 0.9, maxRoll: 1.0,
    hp: 5, descent: 0, amplitude: 0, frequency: 1, phase: 0, score: 500,
    speed: 6, turnRate: 2.2, accel: 2.5,
    debris: [1.0, 0.7, 0.2],
  },
};

// Hit reaction for hits that don't kill: a knock along the shot direction and a white blink.
export const HIT_TIME = 0.22;   // seconds
const HIT_BLINK = 0.055;        // seconds per blink phase (white, normal, white, ...)
// The knock is a damped spring on a render-only offset (it never moves the hitbox):
// a hit adds velocity along the bullet's direction, the enemy slides a little way, overshoots
// slightly and settles back, which gives it a bit of inertia.
const KICK_SPEED = 4.5;         // units/s of knock velocity added per hit
const KICK_STIFFNESS = 300;     // spring pulling the offset back to 0
const KICK_DAMPING = 18;        // ~0.5 damping ratio: one small overshoot
const KICK_MAX = 0.5;           // clamp on the offset, world units

export const ENEMY_PARAMS = ['hp', 'descent', 'amplitude', 'frequency', 'phase', 'score', 'speed', 'turnRate', 'accel'];

export class Enemies {
  constructor(gl) {
    const prog = createProgram(gl, COLOR_VERT, COLOR_FRAG);
    // One draw function per type: (viewProj, x, y, angle, roll, flash) => void
    this.drawers = new Map();
    for (const [name, type] of Object.entries(ENEMY_TYPES)) {
      if (type.sprite) {
        const sprite = new WorldSprite(gl, type.sprite);
        // The art is rotated by spriteRotation; flip the roll's sign with it so the lit
        // wing stays on the same side of the screen.
        const rollSign = Math.cos(type.spriteRotation);
        this.drawers.set(name, (vp, x, y, angle, roll, flash) => sprite.render(
          vp, x, y, type.spriteSize, roll * rollSign, angle + type.spriteRotation, flash));
      } else {
        const mesh = new ColorMesh(gl, prog, type.mesh);
        this.drawers.set(name, (vp, x, y, angle, roll, flash) => mesh.render(
          vp, x, y, angle, type.scale, roll, flash));
      }
    }
    this.list = [];
  }

  /**
   * Spawns an enemy just above the screen.
   * @param name   key of ENEMY_TYPES
   * @param event  level event: `x` (-1..1 across the playable width) and optional `params`
   */
  spawn(name, event, camY, viewW, viewH) {
    const type = ENEMY_TYPES[name];
    const p = { ...type, ...event.params };
    // Keep the whole sine path on screen, whatever the window shape.
    const amp = Math.min(p.amplitude, viewW * 0.3);
    const cx = (event.x ?? 0) * Math.max(0, viewW / 2 - amp - 1);
    const x = cx + amp * Math.sin(p.phase);
    // Spawn just far enough above the screen that the whole sprite starts off-screen.
    const extent = Math.max(1.5, (type.spriteSize ?? 0) / 2);
    const y = camY + viewH / 2 + extent;
    this.list.push({
      type: name, cx, amp, freq: p.frequency, phase: p.phase, descent: p.descent,
      speed: p.speed, turnRate: p.turnRate, accel: p.accel, angle: 0, prevAngle: 0,
      vx: 0, vy: -p.speed, // starts at full speed, nose down
      age: 0, x, y, prevX: x, prevY: y, roll: 0, prevRoll: 0,
      hp: p.hp, score: p.score, radius: type.radius, dead: false, hitTimer: 0,
      kx: 0, ky: 0, kvx: 0, kvy: 0, prevKx: 0, prevKy: 0, extent,
    });
  }

  /**
   * Moves enemies and culls those that left the bottom of the screen.
   * `target` ({ x, y }) is the player's position, used by homing enemies.
   */
  update(dt, camY, viewH, scroll, target) {
    for (const e of this.list) {
      const cullY = camY - viewH / 2 - e.extent - 0.5; // gone only once fully off the bottom
      const type = ENEMY_TYPES[e.type];
      e.prevX = e.x; e.prevY = e.y; e.prevRoll = e.roll; e.prevAngle = e.angle;
      e.age += dt;
      e.hitTimer = Math.max(0, e.hitTimer - dt);
      e.prevKx = e.kx; e.prevKy = e.ky;
      e.kvx += (-KICK_STIFFNESS * e.kx - KICK_DAMPING * e.kvx) * dt;
      e.kvy += (-KICK_STIFFNESS * e.ky - KICK_DAMPING * e.kvy) * dt;
      e.kx += e.kvx * dt;
      e.ky += e.kvy * dt;
      const m = Math.hypot(e.kx, e.ky);
      if (m > KICK_MAX) { e.kx *= KICK_MAX / m; e.ky *= KICK_MAX / m; }
      if (e.turnRate > 0) {
        // Homing: turn the nose toward the player (limited turn rate) and thrust where it points.
        // Angle 0 = nose down (-Y); the nose direction is (sin a, -cos a).
        if (target) {
          const want = Math.atan2(target.x - e.x, -(target.y - e.y));
          const diff = want - e.angle;
          const err = diff - 2 * Math.PI * Math.round(diff / (2 * Math.PI)); // shortest way round
          const step = e.turnRate * dt;
          e.angle += Math.max(-step, Math.min(step, err));
        }
        // Inertia: velocity only eases toward the heading's full-speed velocity, so the
        // enemy slides a little through turns instead of changing direction instantly.
        const k = Math.min(1, e.accel * dt);
        e.vx += (Math.sin(e.angle) * e.speed - e.vx) * k;
        e.vy += (-Math.cos(e.angle) * e.speed - e.vy) * k;
        e.x += e.vx * dt;
        e.y += (e.vy + scroll) * dt;
        // No roll: homing enemies only yaw to face the player.
        if (e.age > 25) e.dead = true; // safety net: never let a chaser live forever
      } else {
        e.y += (scroll - e.descent) * dt;
        e.x = e.cx + e.amp * Math.sin(e.freq * e.age + e.phase);
        // Roll into the sideways motion: normalized by the path's top speed.
        const topSpeed = Math.max(1e-6, e.amp * e.freq);
        e.roll = ((e.x - e.prevX) / dt) / topSpeed * type.maxRoll;
      }
      if (e.y < cullY) e.dead = true;
    }
    this.sweep();
  }

  /**
   * Starts the knock + blink reaction (for hits that don't destroy the enemy).
   * (dx, dy) is the direction the bullet was travelling; it need not be normalized.
   */
  hit(e, dx, dy) {
    e.hitTimer = HIT_TIME;
    const len = Math.hypot(dx, dy) || 1;
    e.kvx += (dx / len) * KICK_SPEED;
    e.kvy += (dy / len) * KICK_SPEED;
  }

  /** Drops enemies marked dead. */
  sweep() {
    this.list = this.list.filter((e) => !e.dead);
  }

  render(viewProj, alpha) {
    for (const e of this.list) {
      const x = e.prevX + (e.x - e.prevX) * alpha;
      const y = e.prevY + (e.y - e.prevY) * alpha;
      const roll = e.prevRoll + (e.roll - e.prevRoll) * alpha;
      const angle = e.prevAngle + (e.angle - e.prevAngle) * alpha;
      const ox = e.prevKx + (e.kx - e.prevKx) * alpha;
      const oy = e.prevKy + (e.ky - e.prevKy) * alpha;
      let flash = 0;
      if (e.hitTimer > 0) {
        flash = Math.floor((HIT_TIME - e.hitTimer) / HIT_BLINK) % 2 === 0 ? 1 : 0;
      }
      this.drawers.get(e.type)(viewProj, x + ox, y + oy, angle, roll, flash);
    }
  }
}
