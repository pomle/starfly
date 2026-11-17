import { createProgram, createBuffer } from '../core/gl.js';
import { Sprite } from '../ui/sprite.js';

const VERT = `#version 300 es
in vec2 aPos;  // -0.5..0.5
in vec2 aUV;
uniform mat4 uViewProj;
uniform vec2 uCenter;  // world position
uniform float uSize;   // world units (side of the square quad)
uniform float uRoll;   // radians; roll around the vertical axis, seen from above
out vec2 vUV;
out float vShade;
void main() {
  // Top-down roll: foreshorten sideways, brighten one wing and darken the other.
  vec2 p = vec2(aPos.x * cos(uRoll), aPos.y) * uSize + uCenter;
  gl_Position = uViewProj * vec4(p, 0.0, 1.0);
  vUV = aUV;
  vShade = 1.0 - sin(uRoll) * clamp(aPos.x * 2.0, -1.0, 1.0) * 0.35;
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec2 vUV;
in float vShade;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  vec4 c = texture(uTex, vUV); // premultiplied alpha
  outColor = vec4(c.rgb * vShade, c.a);
}`;

/** A textured quad drawn in world space (nose up), loaded from an image URL. */
export class WorldSprite {
  constructor(gl, url) {
    this.gl = gl;
    this.sprite = Sprite.fromUrl(gl, url);
    this.prog = createProgram(gl, VERT, FRAG);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    createBuffer(gl, new Float32Array([
      -0.5, -0.5, 0, 1,   0.5, -0.5, 1, 1,   -0.5, 0.5, 0, 0,
       0.5, -0.5, 1, 1,   0.5,  0.5, 1, 0,   -0.5, 0.5, 0, 0,
    ]));
    const { aPos, aUV } = this.prog.attribs;
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUV);
    gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);
  }

  render(viewProj, x, y, size, roll = 0) {
    if (!this.sprite.ready) return;
    const gl = this.gl, u = this.prog.uniforms;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog.program);
    gl.uniformMatrix4fv(u.uViewProj, false, viewProj);
    gl.uniform2f(u.uCenter, x, y);
    gl.uniform1f(u.uSize, size);
    gl.uniform1f(u.uRoll, roll);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sprite.texture);
    gl.uniform1i(u.uTex, 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }
}
