import { createProgram } from '../core/gl.js';
import { ColorMesh, COLOR_VERT, COLOR_FRAG, tri } from './colormesh.js';
import { WorldSprite } from './worldsprite.js';

// The hull is assets/spaceship-sprite.png (256x256, nose up). All sizes below are
// world units; the screen is 20 units tall.
export const SHIP_SIZE = 2.8;        // side of the sprite's square quad
export const SHIP_ENGINE_Y = -0.9;   // exhaust origin, relative to the ship center
                                     // (the sprite's engine nozzles sit ~0.9 below center)

// Turret: a small mesh mounted on the hull, barrel along +Y of its own frame.
export const TURRET_MOUNT_Y = 0.25;  // pivot, relative to the ship center
const TURRET_SCALE = 1.1;
const BARREL_LENGTH = 0.75;          // mesh units
export const TURRET_REACH = BARREL_LENGTH * TURRET_SCALE; // pivot -> muzzle, world units

const base = [0.12, 0.12, 0.18], barrel = [0.85, 0.8, 0.92];
const TURRET_MESH = (() => {
  const v = [];
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * Math.PI * 2, a1 = ((i + 1) / 8) * Math.PI * 2;
    v.push(...tri([0, 0], [Math.cos(a0) * 0.22, Math.sin(a0) * 0.22],
                  [Math.cos(a1) * 0.22, Math.sin(a1) * 0.22], base));
  }
  v.push(...tri([-0.05, 0], [0.05, 0], [-0.05, BARREL_LENGTH], barrel));
  v.push(...tri([0.05, 0], [0.05, BARREL_LENGTH], [-0.05, BARREL_LENGTH], barrel));
  return new Float32Array(v);
})();

export class Ship {
  constructor(gl) {
    this.hull = new WorldSprite(gl, new URL('../../assets/spaceship-sprite.png', import.meta.url).href);
    this.turret = new ColorMesh(gl, createProgram(gl, COLOR_VERT, COLOR_FRAG), TURRET_MESH);
  }
  renderHull(viewProj, x, y, roll = 0) { this.hull.render(viewProj, x, y, SHIP_SIZE, roll); }
  renderTurret(viewProj, x, y, angle) { this.turret.render(viewProj, x, y, angle, TURRET_SCALE); }
}
