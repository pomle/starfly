import { createProgram } from '../core/gl.js';

const VERT = `#version 300 es
in vec2 aPos;
in float aSize;   // world units; negative = crisp spark (hard dot), positive = soft glow
in float aT;      // normalized age 0..1
in vec3 aColor;
uniform mat4 uViewProj;
uniform float uPxPerUnit;
out vec3 vColor;
out float vAlpha;
out float vCrisp;
void main() {
  float px = abs(aSize) * uPxPerUnit;
  vCrisp = aSize < 0.0 ? 1.0 : 0.0;
  gl_Position = uViewProj * vec4(aPos, 0.0, 1.0);
  gl_PointSize = max(1.0, px * (1.0 - 0.6 * aT * (1.0 - vCrisp))); // glows shrink as they fade
  vAlpha = (1.0 - aT) * (1.0 - aT);                                  // quick fade-out
  // Glows start white-hot and settle to their own color, like the exhaust.
  vColor = mix(mix(vec3(1.0), aColor, smoothstep(0.0, 0.25, aT)), aColor, vCrisp);
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec3 vColor;
in float vAlpha;
in float vCrisp;
out vec4 outColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float glow = pow(max(0.0, 1.0 - d), 1.5);
  float a = vAlpha * mix(glow, 1.0, vCrisp);
  // Premultiplied color with reduced alpha makes the glows partly additive.
  outColor = vec4(vColor * a, a * mix(0.5, 1.0, vCrisp));
}`;

const FLOATS = 7; // x, y, size, t, r, g, b
const DRAG = 1.2;

/**
 * Hit debris: soft glowing hull chips that fade out fast (like the exhaust), plus tiny
 * 1-2 px crisp sparks. Emit a negative size for a spark (hard dot) or a positive one for a glow.
 */
export class Debris {
  constructor(gl, max = 512) {
    this.gl = gl;
    this.max = max;
    this.count = 0;
    this.px = new Float32Array(max);
    this.py = new Float32Array(max);
    this.vx = new Float32Array(max);
    this.vy = new Float32Array(max);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.size = new Float32Array(max);
    this.color = new Float32Array(max * 3);
    this.data = new Float32Array(max * FLOATS);

    this.prog = createProgram(gl, VERT, FRAG);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const { aPos, aSize, aT, aColor } = this.prog.attribs;
    const stride = FLOATS * 4;
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(aSize);
    gl.vertexAttribPointer(aSize, 1, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(aT);
    gl.vertexAttribPointer(aT, 1, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(aColor);
    gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, stride, 16);
    gl.bindVertexArray(null);
  }

  emit(x, y, vx, vy, size, [r, g, b], life) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.px[i] = x; this.py[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.age[i] = 0; this.life[i] = life; this.size[i] = size;
    this.color[i * 3] = r; this.color[i * 3 + 1] = g; this.color[i * 3 + 2] = b;
  }

  update(dt) {
    const drag = Math.max(0, 1 - DRAG * dt);
    for (let i = 0; i < this.count; ) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        const l = --this.count; // swap-remove
        this.px[i] = this.px[l]; this.py[i] = this.py[l];
        this.vx[i] = this.vx[l]; this.vy[i] = this.vy[l];
        this.age[i] = this.age[l]; this.life[i] = this.life[l]; this.size[i] = this.size[l];
        this.color.copyWithin(i * 3, l * 3, l * 3 + 3);
        continue;
      }
      this.vx[i] *= drag; this.vy[i] *= drag;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      i++;
    }
  }

  render(viewProj, pxPerUnit) {
    if (this.count === 0) return;
    const gl = this.gl, d = this.data;
    for (let i = 0, o = 0; i < this.count; i++, o += FLOATS) {
      d[o] = this.px[i]; d[o + 1] = this.py[i]; d[o + 2] = this.size[i];
      d[o + 3] = this.age[i] / this.life[i];
      d[o + 4] = this.color[i * 3]; d[o + 5] = this.color[i * 3 + 1]; d[o + 6] = this.color[i * 3 + 2];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, this.count * FLOATS);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog.program);
    gl.uniformMatrix4fv(this.prog.uniforms.uViewProj, false, viewProj);
    gl.uniform1f(this.prog.uniforms.uPxPerUnit, pxPerUnit);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }
}
