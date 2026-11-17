import { createProgram } from '../core/gl.js';

const VERT = `#version 300 es
in vec2 aPos;
in float aT;      // normalized age 0..1
in float aSize;   // world units
uniform mat4 uViewProj;
uniform float uPxPerUnit;
out float vT;
void main() {
  vT = aT;
  gl_Position = uViewProj * vec4(aPos, 0.0, 1.0);
  gl_PointSize = max(1.0, aSize * (1.0 - 0.6 * aT) * uPxPerUnit);
}`;

const FRAG = `#version 300 es
precision mediump float;
in float vT;
out vec4 outColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float falloff = pow(max(0.0, 1.0 - d), 1.5);
  vec3 hot = vec3(1.0, 0.95, 0.7);
  vec3 mid = vec3(1.0, 0.45, 0.1);
  vec3 cool = vec3(0.4, 0.08, 0.05);
  vec3 c = mix(mix(hot, mid, smoothstep(0.0, 0.4, vT)), cool, smoothstep(0.4, 1.0, vT));
  float a = falloff * (1.0 - vT);
  outColor = vec4(c * a, a); // premultiplied-style, used with additive blending
}`;

const FLOATS = 4; // x, y, t, size

export class Particles {
  constructor(gl, max = 4000) {
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
    this.data = new Float32Array(max * FLOATS);

    this.prog = createProgram(gl, VERT, FRAG);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const { aPos, aT, aSize } = this.prog.attribs;
    const stride = FLOATS * 4;
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(aT);
    gl.vertexAttribPointer(aT, 1, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(aSize);
    gl.vertexAttribPointer(aSize, 1, gl.FLOAT, false, stride, 12);
    gl.bindVertexArray(null);
  }

  emit(x, y, vx, vy, life, size) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.px[i] = x; this.py[i] = y;
    this.vx[i] = vx; this.vy[i] = vy;
    this.age[i] = 0; this.life[i] = life; this.size[i] = size;
  }

  update(dt) {
    for (let i = 0; i < this.count; ) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        const last = --this.count; // swap-remove
        this.px[i] = this.px[last]; this.py[i] = this.py[last];
        this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last];
        this.age[i] = this.age[last]; this.life[i] = this.life[last];
        this.size[i] = this.size[last];
        continue;
      }
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      i++;
    }
  }

  render(viewProj, pxPerUnit) {
    if (this.count === 0) return;
    const gl = this.gl, d = this.data;
    for (let i = 0, o = 0; i < this.count; i++, o += FLOATS) {
      d[o] = this.px[i]; d[o + 1] = this.py[i];
      d[o + 2] = this.age[i] / this.life[i]; d[o + 3] = this.size[i];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, this.count * FLOATS);

    gl.useProgram(this.prog.program);
    gl.uniformMatrix4fv(this.prog.uniforms.uViewProj, false, viewProj);
    gl.uniform1f(this.prog.uniforms.uPxPerUnit, pxPerUnit);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.bindVertexArray(null);
  }
}
