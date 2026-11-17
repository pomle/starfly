import { createBuffer } from '../core/gl.js';
import { mat4 } from '../core/math.js';

export const COLOR_VERT = `#version 300 es
in vec2 aPos;
in vec3 aColor;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform float uRoll;   // radians; roll around the nose axis, seen from above
out vec3 vColor;
void main() {
  // Top-down view of a roll: wings foreshorten (x * cos) and the side tipping
  // away from the light darkens while the other side brightens.
  vec2 p = vec2(aPos.x * cos(uRoll), aPos.y);
  float side = clamp(aPos.x * 2.0, -1.0, 1.0);
  vColor = aColor * (1.0 - sin(uRoll) * side * 0.4);
  gl_Position = uViewProj * uModel * vec4(p, 0.0, 1.0);
}`;

export const COLOR_FRAG = `#version 300 es
precision mediump float;
in vec3 vColor;
out vec4 outColor;
void main() { outColor = vec4(vColor, 1.0); }`;

/** Triangle helper: three [x, y] points and one [r, g, b] color -> interleaved vertex data. */
export const tri = (a, b, c, col) => [a, b, c].flatMap((p) => [...p, ...col]);

/** Flat-colored 2D mesh (vertex: x, y, r, g, b) drawn with a TRS model matrix. */
export class ColorMesh {
  constructor(gl, prog, data) {
    this.gl = gl;
    this.prog = prog;
    this.vertexCount = data.length / 5;
    this.model = mat4.create();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    createBuffer(gl, data);
    const { aPos, aColor } = prog.attribs;
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(aColor);
    gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, 20, 8);
    gl.bindVertexArray(null);
  }

  render(viewProj, x, y, angle, scale, roll = 0) {
    const gl = this.gl;
    mat4.fromTRS2D(this.model, x, y, angle, scale);
    gl.useProgram(this.prog.program);
    gl.uniformMatrix4fv(this.prog.uniforms.uViewProj, false, viewProj);
    gl.uniformMatrix4fv(this.prog.uniforms.uModel, false, this.model);
    gl.uniform1f(this.prog.uniforms.uRoll, roll);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
    gl.bindVertexArray(null);
  }
}
