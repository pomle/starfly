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
  },
};

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
      hp: p.hp, score: p.score, radius: type.radius, dead: false,
    });
  }

  /** Moves enemies and culls those that left the bottom of the screen. */
  update(dt, camY, viewH, scroll) {
    const cullY = camY - viewH / 2 - 2;
    for (const e of this.list) {
      const type = ENEMY_TYPES[e.type];
      e.prevX = e.x; e.prevY = e.y; e.prevRoll = e.roll;
      e.age += dt;
      e.x = e.cx + e.amp * Math.sin(e.freq * e.age + e.phase);
      e.y += (scroll - e.descent) * dt;
      // Roll into the sideways motion: normalized by the path's top speed.
      const topSpeed = Math.max(1e-6, e.amp * e.freq);
      e.roll = ((e.x - e.prevX) / dt) / topSpeed * type.maxRoll;
      if (e.y < cullY) e.dead = true;
    }
    this.sweep();
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
      this.meshes.get(e.type).render(viewProj, x, y, 0, ENEMY_TYPES[e.type].scale, roll);
    }
  }
}
