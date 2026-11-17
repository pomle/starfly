import { createProgram, createBuffer } from './core/gl.js';
import { mat4 } from './core/math.js';

const VERT = `#version 300 es
in vec2 aPos;
in vec3 aColor;
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = uViewProj * uModel * vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;
void main() { outColor = vec4(vColor, 1.0); }`;

// Placeholder "ship": position (x,y) + color (r,g,b) interleaved.
const SHIP = new Float32Array([
   0.0,  1.0,  0.4, 0.9, 1.0,
  -0.7, -0.8,  0.1, 0.3, 0.9,
   0.7, -0.8,  0.1, 0.3, 0.9,
]);

export class Game {
  constructor(gl, input) {
    this.gl = gl;
    this.input = input;
    this.ship = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, prevX: 0, prevY: 0, prevAngle: 0 };
    this.viewProj = mat4.create();
    this.model = mat4.create();
    this.worldHeight = 20; // world units visible vertically

    this.prog = createProgram(gl, VERT, FRAG);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vbo = createBuffer(gl, SHIP);
    const stride = 5 * 4;
    gl.enableVertexAttribArray(this.prog.attribs.aPos);
    gl.vertexAttribPointer(this.prog.attribs.aPos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.prog.attribs.aColor);
    gl.vertexAttribPointer(this.prog.attribs.aColor, 3, gl.FLOAT, false, stride, 8);
    gl.bindVertexArray(null);

    gl.clearColor(0.02, 0.02, 0.06, 1);
  }

  resize(width, height) {
    this.gl.viewport(0, 0, width, height);
    const h = this.worldHeight / 2;
    const w = h * (width / height);
    mat4.ortho(this.viewProj, -w, w, -h, h, -1, 1);
  }

  /** Fixed-step simulation. */
  update(dt) {
    const s = this.ship, i = this.input;
    s.prevX = s.x; s.prevY = s.y; s.prevAngle = s.angle;

    const turn = (i.isDown('ArrowLeft') || i.isDown('KeyA') ? 1 : 0) -
                 (i.isDown('ArrowRight') || i.isDown('KeyD') ? 1 : 0);
    s.angle += turn * 3 * dt;
    if (i.isDown('ArrowUp') || i.isDown('KeyW')) {
      const thrust = 12;
      s.vx += -Math.sin(s.angle) * thrust * dt;
      s.vy +=  Math.cos(s.angle) * thrust * dt;
    }
    s.vx *= 1 - 0.5 * dt;
    s.vy *= 1 - 0.5 * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
  }

  /** Variable-rate render; alpha interpolates between the last two sim states. */
  render(alpha) {
    const gl = this.gl, s = this.ship;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const x = s.prevX + (s.x - s.prevX) * alpha;
    const y = s.prevY + (s.y - s.prevY) * alpha;
    const a = s.prevAngle + (s.angle - s.prevAngle) * alpha;
    mat4.fromTRS2D(this.model, x, y, a, 0.8);

    gl.useProgram(this.prog.program);
    gl.uniformMatrix4fv(this.prog.uniforms.uViewProj, false, this.viewProj);
    gl.uniformMatrix4fv(this.prog.uniforms.uModel, false, this.model);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
}
