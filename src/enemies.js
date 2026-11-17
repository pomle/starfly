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

/**
 * Enemy types referenced by name from level files. Every numeric field except
 * `radius` and `scale` can be overridden per spawn event via its "params".
 *   hp         hit points
 *   descent    speed down the screen, units/s (relative to the camera)
 *   amplitude  sideways swing of the sine path, world units
 *   frequency  sine speed, rad/s
 *   phase      starting offset on the sine path, radians
 *   score      points awarded when the player shoots it down
 */
export const ENEMY_TYPES = {
  jimmy: {
    mesh: DART_MESH, scale: 0.9, radius: 0.8, maxRoll: 1.0,
    hp: 1, descent: 4, amplitude: 4, frequency: 2.2, phase: 0, score: 100,
    debris: [0.85, 0.3, 0.42], // chip color when hit
  },
  // Slow, tough and big: drops straight down (amplitude 0) and takes 3 hits.
  brute: {
    mesh: BRUTE_MESH, scale: 1.3, radius: 1.1, maxRoll: 1.0,
    hp: 3, descent: 2.5, amplitude: 0, frequency: 1, phase: 0, score: 300,
    debris: [0.22, 0.62, 0.6],
  },
};

// Hit reaction for hits that don't kill: a short shake and a white blink.
export const HIT_TIME = 0.22;   // seconds
const HIT_BLINK = 0.055;        // seconds per blink phase (white, normal, white, ...)
const HIT_SHAKE = 0.14;         // world units at the start of the reaction

export const ENEMY_PARAMS = ['hp', 'descent', 'amplitude', 'frequency', 'phase', 'score'];

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
      age: 0, x, y, prevX: x, prevY: y, roll: 0, prevRoll: 0,
      hp: p.hp, score: p.score, radius: type.radius, dead: false, hitTimer: 0,
    });
  }

  /** Moves enemies and culls those that left the bottom of the screen. */
  update(dt, camY, viewH, scroll) {
    const cullY = camY - viewH / 2 - 2;
    for (const e of this.list) {
      const type = ENEMY_TYPES[e.type];
      e.prevX = e.x; e.prevY = e.y; e.prevRoll = e.roll;
      e.age += dt;
      e.hitTimer = Math.max(0, e.hitTimer - dt);
      e.x = e.cx + e.amp * Math.sin(e.freq * e.age + e.phase);
      e.y += (scroll - e.descent) * dt;
      // Roll into the sideways motion: normalized by the path's top speed.
      const topSpeed = Math.max(1e-6, e.amp * e.freq);
      e.roll = ((e.x - e.prevX) / dt) / topSpeed * type.maxRoll;
      if (e.y < cullY) e.dead = true;
    }
    this.sweep();
  }

  /** Starts the shake + blink reaction (for hits that don't destroy the enemy). */
  hit(e) {
    e.hitTimer = HIT_TIME;
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
      // Shake is render-only, so it never moves the hitbox.
      let ox = 0, oy = 0, flash = 0;
      if (e.hitTimer > 0) {
        const k = e.hitTimer / HIT_TIME;
        ox = Math.sin(e.hitTimer * 120) * HIT_SHAKE * k;
        oy = Math.cos(e.hitTimer * 97) * HIT_SHAKE * k;
        flash = Math.floor((HIT_TIME - e.hitTimer) / HIT_BLINK) % 2 === 0 ? 1 : 0;
      }
      this.meshes.get(e.type).render(viewProj, x + ox, y + oy, 0, ENEMY_TYPES[e.type].scale, roll, flash);
    }
  }
}
