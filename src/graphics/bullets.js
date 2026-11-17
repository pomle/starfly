import { createProgram } from '../core/gl.js';

const VERT = `#version 300 es
in vec2 aPos;
in float aA;   // trail intensity 0..1
uniform mat4 uViewProj;
uniform float uSize;   // px
out float vA;
void main() {
  vA = aA;
  gl_Position = uViewProj * vec4(aPos, 0.0, 1.0);
  gl_PointSize = max(1.0, uSize * (0.4 + 0.6 * aA));
}`;

const FRAG = `#version 300 es
precision mediump float;
in float vA;
out vec4 outColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float f = pow(max(0.0, 1.0 - d), 1.5) * vA;
  vec3 c = mix(vec3(0.2, 0.7, 1.0), vec3(1.0), f * f);
  outColor = vec4(c * f, f);
}`;

const TRAIL = [1.0, 0.7, 0.45, 0.25, 0.1];
const TRAIL_STEP = 0.012; // seconds of travel between trail points
const FLOATS = 3;

export class Bullets {
  constructor(gl, max = 256) {
    this.gl = gl;
    this.max = max;
    this.count = 0;
    this.px = new Float32Array(max);
    this.py = new Float32Array(max);
    this.vx = new Float32Array(max);
    this.vy = new Float32Array(max);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.data = new Float32Array(max * TRAIL.length * FLOATS);

    this.prog = createProgram(gl, VERT, FRAG);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const { aPos, aA } = this.prog.attribs;
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, FLOATS * 4, 0);
    gl.enableVertexAttribArray(aA);
    gl.vertexAttribPointer(aA, 1, gl.FLOAT, false, FLOATS * 4, 8);
    gl.bindVertexArray(null);
  }

  spawn(x, y, vx, vy, life = 1.5) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.px[i] = x; this.py[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.age[i] = 0; this.life[i] = life;
  }

  /** Removes bullet i (swap-remove, so iterate backwards when killing in a loop). */
  kill(i) {
    const l = --this.count;
    this.px[i] = this.px[l]; this.py[i] = this.py[l];
    this.vx[i] = this.vx[l]; this.vy[i] = this.vy[l];
    this.age[i] = this.age[l]; this.life[i] = this.life[l];
  }

  /** Swept test: did bullet i cross the circle (cx, cy, r) during the last `dt`? */
  hits(i, cx, cy, r, dt) {
    const bx = this.px[i], by = this.py[i];
    const ax = bx - this.vx[i] * dt, ay = by - this.vy[i] * dt;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((cx - ax) * dx + (cy - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const ex = ax + dx * t - cx, ey = ay + dy * t - cy;
    return ex * ex + ey * ey <= r * r;
  }

  update(dt) {
    for (let i = 0; i < this.count; ) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        const l = --this.count;
        this.px[i] = this.px[l]; this.py[i] = this.py[l];
        this.vx[i] = this.vx[l]; this.vy[i] = this.vy[l];
        this.age[i] = this.age[l]; this.life[i] = this.life[l];
        continue;
      }
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      i++;
    }
  }

  /** `lead` = seconds since the last fixed step, for smooth motion at any refresh rate. */
  render(viewProj, pxScale, lead) {
    if (this.count === 0) return;
    const gl = this.gl, d = this.data;
    let o = 0;
    for (let i = 0; i < this.count; i++) {
      const x = this.px[i] + this.vx[i] * lead;
      const y = this.py[i] + this.vy[i] * lead;
      for (let k = 0; k < TRAIL.length; k++) {
        const back = k * TRAIL_STEP;
        d[o++] = x - this.vx[i] * back;
        d[o++] = y - this.vy[i] * back;
        d[o++] = TRAIL[k];
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, o);
    gl.useProgram(this.prog.program);
    gl.uniformMatrix4fv(this.prog.uniforms.uViewProj, false, viewProj);
    gl.uniform1f(this.prog.uniforms.uSize, 22 * pxScale);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.count * TRAIL.length);
    gl.bindVertexArray(null);
  }
}
