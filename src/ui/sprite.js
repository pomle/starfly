import { createProgram, createBuffer } from '../core/gl.js';

const VERT = `#version 300 es
in vec2 aPos;  // -0.5..0.5
in vec2 aUV;
uniform vec2 uCenter;  // px, origin bottom-left of the drawing buffer
uniform vec2 uSize;    // px
uniform vec2 uRes;     // px
out vec2 vUV;
void main() {
  vec2 px = uCenter + aPos * uSize;
  gl_Position = vec4(px / uRes * 2.0 - 1.0, 0.0, 1.0);
  vUV = aUV;
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec2 vUV;
uniform sampler2D uTex;
uniform float uAlpha;
out vec4 outColor;
void main() { outColor = texture(uTex, vUV) * uAlpha; } // texture is premultiplied`;

/** A texture plus its pixel size. `ready` is false until an image finishes loading. */
export class Sprite {
  constructor(gl, { pixelArt = false } = {}) {
    this.gl = gl;
    this.pixelArt = pixelArt;
    this.texture = gl.createTexture();
    this.width = 1;
    this.height = 1;
    this.ready = false;
  }

  setSource(source) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (this.pixelArt) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    } else {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.width = source.width;
    this.height = source.height;
    this.ready = true;
  }

  static fromCanvas(gl, canvas, opts) {
    const s = new Sprite(gl, opts);
    s.setSource(canvas);
    return s;
  }

  static fromUrl(gl, url, opts) {
    const s = new Sprite(gl, opts);
    const img = new Image();
    img.onload = () => s.setSource(img);
    img.onerror = () => console.error(`Failed to load image: ${url}`);
    img.src = url;
    return s;
  }
}

export class SpriteRenderer {
  constructor(gl) {
    this.gl = gl;
    this.prog = createProgram(gl, VERT, FRAG);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    // x, y, u, v  (v = 0 at the top of the image)
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

  /**
   * Draws a sprite centered at (cx, cy) in drawing-buffer pixels (origin bottom-left),
   * `w` x `h` pixels in size.
   */
  draw(sprite, cx, cy, w, h, alpha, resW, resH) {
    if (!sprite.ready || alpha <= 0) return;
    const gl = this.gl, u = this.prog.uniforms;
    if (sprite.pixelArt) { cx = Math.round(cx); cy = Math.round(cy); }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog.program);
    gl.uniform2f(u.uCenter, cx, cy);
    gl.uniform2f(u.uSize, w, h);
    gl.uniform2f(u.uRes, resW, resH);
    gl.uniform1f(u.uAlpha, alpha);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sprite.texture);
    gl.uniform1i(u.uTex, 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }
}
