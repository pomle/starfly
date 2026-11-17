import { Sprite } from './sprite.js';
import { makeTextCanvas } from './bitmapfont.js';

/** A bitmap-font text sprite that only rebuilds its texture when the text changes. */
export class TextLabel {
  constructor(gl, opts) {
    this.gl = gl;
    this.opts = opts;
    this.text = null;
    this.sprite = null;
  }

  set(text) {
    if (text === this.text) return;
    this.sprite?.dispose();
    this.sprite = Sprite.fromCanvas(this.gl, makeTextCanvas(text, this.opts), { pixelArt: true });
    this.text = text;
  }
}
