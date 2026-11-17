import { createProgram, createBuffer } from '../core/gl.js';

const VERT = `#version 300 es
in vec2 aPos;          // pixel offset from center
uniform vec2 uCenter;  // NDC
uniform vec2 uRes;     // drawing buffer size in px
uniform float uScale;  // device pixel ratio
void main() {
  gl_Position = vec4(uCenter + aPos * uScale * 2.0 / uRes, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = uColor; }`;

function ring(out, r0, r1, seg) {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p = (a, r) => [Math.cos(a) * r, Math.sin(a) * r];
    const A = p(a0, r0), B = p(a0, r1), C = p(a1, r0), D = p(a1, r1);
    out.push(...A, ...B, ...C, ...C, ...B, ...D);
  }
}
function disc(out, r, seg) {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    out.push(0, 0, Math.cos(a0) * r, Math.sin(a0) * r, Math.cos(a1) * r, Math.sin(a1) * r);
  }
}
function tick(out, dx, dy, r0, r1, w) {
  const px = -dy * w, py = dx * w; // perpendicular half-width
  const a = [dx * r0 + px, dy * r0 + py], b = [dx * r0 - px, dy * r0 - py];
  const c = [dx * r1 + px, dy * r1 + py], d = [dx * r1 - px, dy * r1 - py];
  out.push(...a, ...b, ...c, ...c, ...b, ...d);
}

/** Screen-space reticle (desired aim) and a dot (where the turret really points). */
export class Crosshair {
  constructor(gl) {
    this.gl = gl;
    const v = [];
    ring(v, 12, 14, 32);
    tick(v, 1, 0, 18, 28, 1); tick(v, -1, 0, 18, 28, 1);
    tick(v, 0, 1, 18, 28, 1); tick(v, 0, -1, 18, 28, 1);
    this.reticleCount = v.length / 2;
    disc(v, 4, 16);
    this.dotCount = v.length / 2 - this.reticleCount;

    this.prog = createProgram(gl, VERT, FRAG);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    createBuffer(gl, new Float32Array(v));
    gl.enableVertexAttribArray(this.prog.attribs.aPos);
    gl.vertexAttribPointer(this.prog.attribs.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  /** Positions are NDC (-1..1). */
  render(width, height, dpr, desiredX, desiredY, actualX, actualY) {
    const gl = this.gl, u = this.prog.uniforms;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog.program);
    gl.uniform2f(u.uRes, width, height);
    gl.uniform1f(u.uScale, dpr);
    gl.bindVertexArray(this.vao);

    gl.uniform2f(u.uCenter, desiredX, desiredY);
    gl.uniform4f(u.uColor, 1.0, 1.0, 1.0, 0.85);
    gl.drawArrays(gl.TRIANGLES, 0, this.reticleCount);

    gl.uniform2f(u.uCenter, actualX, actualY);
    gl.uniform4f(u.uColor, 1.0, 0.45, 0.2, 0.95);
    gl.drawArrays(gl.TRIANGLES, this.reticleCount, this.dotCount);

    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }
}
