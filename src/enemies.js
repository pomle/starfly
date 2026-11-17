import { createProgram } from './core/gl.js';
import { ColorMesh, COLOR_VERT, COLOR_FRAG, tri } from './graphics/colormesh.js';

// Dart-shaped alien fighter, nose pointing -Y (it flies down the screen).
const hull = [0.7, 0.2, 0.35], hullLit = [0.92, 0.32, 0.45];
const wing = [0.35, 0.1, 0.28], wingLit = [0.58, 0.16, 0.42];
const eye = [1.0, 0.85, 0.3];
const MESH = new Float32Array([
  ...tri([0, -1.0], [-0.4, 0.5], [0, 0.3], hull),
  ...tri([0, -1.0], [0, 0.3], [0.4, 0.5], hullLit),
  ...tri([-0.35, 0.2], [-1.0, 0.9], [-0.35, 0.7], wing),
  ...tri([0.35, 0.2], [0.35, 0.7], [1.0, 0.9], wingLit),
  ...tri([0, -0.3], [-0.12, 0.15], [0.12, 0.15], eye),
]);

const SCALE = 0.9;
const RADIUS = 0.8;       // hit radius, world units
const DESCENT = 4;        // speed down the screen, units/s (relative to the camera)
const SINE_FREQ = 2.2;    // rad/s
const MAX_SINE_AMP = 4;   // world units
const MAX_ROLL = 1.0;     // radians, at the fastest sideways speed of the sine path

// Waves of enemies that all follow the same sinusoidal path, one after another.
const WAVE_SIZE = 6;
const WAVE_SPACING = 0.4; // seconds between enemies in a wave
const WAVE_GAP = 3;       // seconds between waves
const FIRST_DELAY = 1.5;

export class Enemies {
  constructor(gl) {
    this.mesh = new ColorMesh(gl, createProgram(gl, COLOR_VERT, COLOR_FRAG), MESH);
    this.list = [];
    this.timer = FIRST_DELAY;
    this.waveLeft = 0;
    this.wave = null;
  }

  spawn(wave, y) {
    this.list.push({
      cx: wave.cx, amp: wave.amp, phase: wave.phase, age: 0,
      x: wave.cx + wave.amp * Math.sin(wave.phase), y,
      prevX: 0, prevY: y, roll: 0, prevRoll: 0,
      hp: 1, radius: RADIUS, dead: false,
    });
    const e = this.list[this.list.length - 1];
    e.prevX = e.x;
  }

  /** Spawns waves just above the screen, moves enemies and culls those that left it. */
  update(dt, camY, viewW, viewH, scroll) {
    this.timer -= dt;
    if (this.timer <= 0) {
      if (this.waveLeft === 0) {
        const amp = Math.min(MAX_SINE_AMP, viewW * 0.3);
        this.wave = {
          amp,
          cx: (Math.random() * 2 - 1) * Math.max(0, viewW / 2 - amp - 1),
          phase: Math.random() * Math.PI * 2,
        };
        this.waveLeft = WAVE_SIZE;
      }
      this.spawn(this.wave, camY + viewH / 2 + 1.5);
      this.waveLeft--;
      this.timer = this.waveLeft > 0 ? WAVE_SPACING : WAVE_GAP;
    }

    const cullY = camY - viewH / 2 - 2;
    for (const e of this.list) {
      e.prevX = e.x; e.prevY = e.y; e.prevRoll = e.roll;
      e.age += dt;
      e.x = e.cx + e.amp * Math.sin(SINE_FREQ * e.age + e.phase);
      e.y += (scroll - DESCENT) * dt;
      // Roll (not yaw) into the sideways motion: normalized by the path's top speed.
      e.roll = ((e.x - e.prevX) / dt) / (e.amp * SINE_FREQ) * MAX_ROLL;
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
      this.mesh.render(viewProj, x, y, 0, SCALE, roll);
    }
  }
}
