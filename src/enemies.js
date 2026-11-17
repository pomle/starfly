import { createProgram } from './core/gl.js';
import { ColorMesh, COLOR_VERT, COLOR_FRAG, tri } from './graphics/colormesh.js';

// Dart-shaped alien fighter, nose pointing -Y (it flies down the screen).
const hull = [0.7, 0.2, 0.35], hullLit = [0.92, 0.32, 0.45];
const wing = [0.35, 0.1, 0.28], wingLit = [0.58, 0.16, 0.42];
const eye = [1.0, 0.85, 0.3];
const DART_MESH = new Float32Array([
  ...tri([0, -1.0], [-0.4, 0.5], [0, 0.3], hull),
  ...tri([0, -1.0], [0, 0.3], [0.4, 0.5], hullLit),
  ...tri([-0.35, 0.2], [-1.0, 0.9], [-0.35, 0.7], wing),
  ...tri([0.35, 0.2], [0.35, 0.7], [1.0, 0.9], wingLit),
  ...tri([0, -0.3], [-0.12, 0.15], [0.12, 0.15], eye),
]);

// Heavy armored gunship, also nose-down. Wide teal body with side pods and a red core.
const bHull = [0.15, 0.45, 0.45], bHullLit = [0.25, 0.7, 0.65];
const bPod = [0.1, 0.3, 0.32], bPodLit = [0.18, 0.5, 0.5];
const bAccent = [0.95, 0.6, 0.2], bCore = [1.0, 0.25, 0.2];
const BRUTE_MESH = new Float32Array([
  ...tri([0, -1.0], [-0.55, 0.6], [0, 0.8], bHull),
  ...tri([0, -1.0], [0, 0.8], [0.55, 0.6], bHullLit),
  ...tri([-0.5, -0.4], [-1.0, -0.2], [-1.0, 0.8], bPod),    // left pod
  ...tri([-0.5, -0.4], [-1.0, 0.8], [-0.5, 0.8], bPod),
  ...tri([0.5, -0.4], [0.5, 0.8], [1.0, 0.8], bPodLit),     // right pod
  ...tri([0.5, -0.4], [1.0, 0.8], [1.0, -0.2], bPodLit),
  ...tri([-0.3, 0.8], [0.3, 0.8], [0, 1.15], bAccent),      // engine block
  ...tri([0, -0.45], [-0.18, 0.1], [0.18, 0.1], bCore),     // core
]);

// Interceptor: slim amber spear with swept fins, nose-down, cyan sensor eye.
const iHull = [0.75, 0.5, 0.1], iHullLit = [1.0, 0.75, 0.2];
const iFin = [0.5, 0.3, 0.08], iFinLit = [0.85, 0.55, 0.12], iEye = [0.3, 1.0, 1.0];
const INTERCEPTOR_MESH = new Float32Array([
  ...tri([0, -1.25], [-0.28, 0.5], [0, 0.35], iHull),
  ...tri([0, -1.25], [0, 0.35], [0.28, 0.5], iHullLit),
  ...tri([-0.28, -0.1], [-0.9, 0.95], [-0.28, 0.65], iFin),     // left fin
  ...tri([0.28, -0.1], [0.28, 0.65], [0.9, 0.95], iFinLit),     // right fin
  ...tri([-0.1, 0.35], [0.1, 0.35], [0, 0.95], iFin),           // tail spike
  ...tri([0, -0.6], [-0.1, -0.15], [0.1, -0.15], iEye),
]);

/**
 * Enemy types referenced by name from level files. Every numeric field except
 * `radius` and `scale` can be overridden per spawn event via its "params".
 *   hp         hit points
 *   descent    speed down the screen, units/s (relative to the camera)
 *   amplitude  sideways swing of the sine path, world units
 *   frequency  sine speed, rad/s
 *   phase      starting offset on the sine path, radians
 *   score      points awarded when the player shoots it down
 *   maxLateral top sideways speed when homing, units/s. 0 = follow the sine path instead
 *   steer      how quickly a homing enemy changes its sideways speed, 1/s
 */
export const ENEMY_TYPES = {
  jimmy: {
    mesh: DART_MESH, scale: 0.9, radius: 0.8, maxRoll: 1.0,
    hp: 3, descent: 4, amplitude: 4, frequency: 2.2, phase: 0, score: 100,
    maxLateral: 0, steer: 0,
    debris: [0.85, 0.3, 0.42], // chip color when hit
  },
  // Slow, tough and big: drops straight down (amplitude 0) and takes 10 hits.
  brute: {
    mesh: BRUTE_MESH, scale: 1.3, radius: 1.1, maxRoll: 1.0,
    hp: 10, descent: 2.5, amplitude: 0, frequency: 1, phase: 0, score: 300,
    maxLateral: 0, steer: 0,
    debris: [0.22, 0.62, 0.6],
  },
  // Rare and fast: dives straight down but drifts sideways toward the player's position
  // (slowly enough to dodge) until it has passed them. Tougher than a jimmy.
  interceptor: {
    mesh: INTERCEPTOR_MESH, scale: 1.0, radius: 0.85, maxRoll: 1.0,
    hp: 5, descent: 5, amplitude: 0, frequency: 1, phase: 0, score: 500,
    maxLateral: 3.5, steer: 2.5,
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

export const ENEMY_PARAMS = ['hp', 'descent', 'amplitude', 'frequency', 'phase', 'score', 'maxLateral', 'steer'];

export class Enemies {
  constructor(gl) {
    const prog = createProgram(gl, COLOR_VERT, COLOR_FRAG);
    this.meshes = new Map();
    for (const [name, type] of Object.entries(ENEMY_TYPES)) {
      this.meshes.set(name, new ColorMesh(gl, prog, type.mesh));
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
    const y = camY + viewH / 2 + 1.5;
    this.list.push({
      type: name, cx, amp, freq: p.frequency, phase: p.phase, descent: p.descent,
      maxLat: p.maxLateral, steer: p.steer, vx: 0,
      age: 0, x, y, prevX: x, prevY: y, roll: 0, prevRoll: 0,
      hp: p.hp, score: p.score, radius: type.radius, dead: false, hitTimer: 0,
      kx: 0, ky: 0, kvx: 0, kvy: 0, prevKx: 0, prevKy: 0,
    });
  }

  /**
   * Moves enemies and culls those that left the bottom of the screen.
   * `target` ({ x, y }) is the player's position, used by homing enemies.
   */
  update(dt, camY, viewH, scroll, target) {
    const cullY = camY - viewH / 2 - 2;
    for (const e of this.list) {
      const type = ENEMY_TYPES[e.type];
      e.prevX = e.x; e.prevY = e.y; e.prevRoll = e.roll;
      e.age += dt;
      e.hitTimer = Math.max(0, e.hitTimer - dt);
      e.prevKx = e.kx; e.prevKy = e.ky;
      e.kvx += (-KICK_STIFFNESS * e.kx - KICK_DAMPING * e.kvx) * dt;
      e.kvy += (-KICK_STIFFNESS * e.ky - KICK_DAMPING * e.kvy) * dt;
      e.kx += e.kvx * dt;
      e.ky += e.kvy * dt;
      const m = Math.hypot(e.kx, e.ky);
      if (m > KICK_MAX) { e.kx *= KICK_MAX / m; e.ky *= KICK_MAX / m; }
      e.y += (scroll - e.descent) * dt;
      if (e.maxLat > 0) {
        // Homing: steer sideways toward the player while still above them, else straighten out.
        let want = 0;
        if (target && e.y > target.y + 1) {
          want = Math.max(-e.maxLat, Math.min(e.maxLat, (target.x - e.x) * 1.5));
        }
        e.vx += (want - e.vx) * Math.min(1, e.steer * dt);
        e.x += e.vx * dt;
        e.roll = (e.vx / e.maxLat) * type.maxRoll;
      } else {
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
      const ox = e.prevKx + (e.kx - e.prevKx) * alpha;
      const oy = e.prevKy + (e.ky - e.prevKy) * alpha;
      let flash = 0;
      if (e.hitTimer > 0) {
        flash = Math.floor((HIT_TIME - e.hitTimer) / HIT_BLINK) % 2 === 0 ? 1 : 0;
      }
      this.meshes.get(e.type).render(viewProj, x + ox, y + oy, 0, ENEMY_TYPES[e.type].scale, roll, flash);
    }
  }
}
