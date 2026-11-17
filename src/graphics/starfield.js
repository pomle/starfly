import { createProgram, createBuffer } from '../core/gl.js';

const VERT = `#version 300 es
in vec2 aPos;     // 0..1 tile position
in float aSize;   // base size in px @1080p
in float aBright;
uniform vec2 uCam;
uniform vec2 uView;     // visible world size
uniform float uParallax;
uniform float uScale;   // pixel scale relative to 1080p
uniform float uTime;
out float vBright;
void main() {
  vec2 p = fract(aPos - uCam * uParallax / uView);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = max(1.0, aSize * uScale);
  vBright = aBright * (0.75 + 0.25 * sin(uTime * 2.0 + aPos.x * 100.0));
}`;

const FRAG = `#version 300 es
precision mediump float;
in float vBright;
out vec4 outColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d) * vBright;
  outColor = vec4(vec3(0.8, 0.9, 1.0) * a, a);
}`;

// Far layers move less, are smaller and dimmer.
const LAYERS = [
  { count: 220, parallax: 0.10, size: [1.5, 2.5], bright: [0.25, 0.5] },
  { count: 120, parallax: 0.25, size: [2.0, 3.5], bright: [0.4, 0.75] },
  { count: 50,  parallax: 0.50, size: [3.0, 5.0], bright: [0.7, 1.0] },
];

const rand = (a, b) => a + Math.random() * (b - a);

export class Starfield {
  constructor(gl) {
    this.gl = gl;
    this.prog = createProgram(gl, VERT, FRAG);
    this.layers = LAYERS.map((cfg) => {
      const data = new Float32Array(cfg.count * 4);
      for (let i = 0; i < cfg.count; i++) {
        data.set([Math.random(), Math.random(), rand(...cfg.size), rand(...cfg.bright)], i * 4);
      }
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      createBuffer(gl, data);
      const { aPos, aSize, aBright } = this.prog.attribs;
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(aSize);
      gl.vertexAttribPointer(aSize, 1, gl.FLOAT, false, 16, 8);
      gl.enableVertexAttribArray(aBright);
      gl.vertexAttribPointer(aBright, 1, gl.FLOAT, false, 16, 12);
      gl.bindVertexArray(null);
      return { vao, count: cfg.count, parallax: cfg.parallax };
    });
  }

  render(camX, camY, viewW, viewH, pxScale, time) {
    const gl = this.gl, u = this.prog.uniforms;
    gl.useProgram(this.prog.program);
    gl.uniform2f(u.uCam, camX, camY);
    gl.uniform2f(u.uView, viewW, viewH);
    gl.uniform1f(u.uScale, pxScale);
    gl.uniform1f(u.uTime, time);
    for (const l of this.layers) {
      gl.uniform1f(u.uParallax, l.parallax);
      gl.bindVertexArray(l.vao);
      gl.drawArrays(gl.POINTS, 0, l.count);
    }
    gl.bindVertexArray(null);
  }
}
