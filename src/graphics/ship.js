import { createProgram, createBuffer } from '../core/gl.js';
import { mat4 } from '../core/math.js';

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
precision mediump float;
in vec3 vColor;
out vec4 outColor;
void main() { outColor = vec4(vColor, 1.0); }`;

// Flat-shaded triangles, nose pointing +Y. Each vertex: x, y, r, g, b.
// Left side is shaded darker than right to fake a light from the right.
const hull = [0.55, 0.62, 0.72], hullLit = [0.78, 0.84, 0.92];
const wing = [0.25, 0.32, 0.5], wingLit = [0.38, 0.5, 0.75];
const glass = [0.3, 0.9, 1.0], accent = [0.95, 0.3, 0.25];
const tri = (a, b, c, col) => [a, b, c].flatMap((p) => [...p, ...col]);

const MESH = new Float32Array([
  ...tri([0, 1.2], [-0.3, -0.6], [0, -0.4], hull),         // body left
  ...tri([0, 1.2], [0, -0.4], [0.3, -0.6], hullLit),       // body right
  ...tri([-0.3, 0.1], [-1.0, -0.8], [-0.3, -0.6], wing),   // wing left
  ...tri([0.3, 0.1], [0.3, -0.6], [1.0, -0.8], wingLit),   // wing right
  ...tri([-1.0, -0.8], [-0.82, -0.8], [-0.88, -0.4], accent),
  ...tri([1.0, -0.8], [0.88, -0.4], [0.82, -0.8], accent),
  ...tri([0, 0.75], [-0.12, 0.15], [0.12, 0.15], glass),   // cockpit
  ...tri([-0.2, -0.6], [0.2, -0.6], [0, -0.75], [0.2, 0.22, 0.3]), // nozzle
]);

export const SHIP_ENGINE_OFFSET = -0.7; // local Y of the exhaust, in mesh units

export class Ship {
  constructor(gl) {
    this.gl = gl;
    this.model = mat4.create();
    this.prog = createProgram(gl, VERT, FRAG);
    this.vertexCount = MESH.length / 5;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    createBuffer(gl, MESH);
    const { aPos, aColor } = this.prog.attribs;
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(aColor);
    gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, 20, 8);
    gl.bindVertexArray(null);
  }

  render(viewProj, x, y, angle, scale) {
    const gl = this.gl;
    mat4.fromTRS2D(this.model, x, y, angle, scale);
    gl.useProgram(this.prog.program);
    gl.uniformMatrix4fv(this.prog.uniforms.uViewProj, false, viewProj);
    gl.uniformMatrix4fv(this.prog.uniforms.uModel, false, this.model);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
    gl.bindVertexArray(null);
  }
}
