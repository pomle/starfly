// Background music track with autoplay-policy handling and fades.

export class Music {
  constructor(url, { volume = 0.6, loop = true } = {}) {
    this.audio = new Audio(url);
    this.audio.loop = loop;
    this.audio.preload = 'auto';
    this.volume = volume;
    this.audio.volume = volume;
    this.fade = null; // { from, to, left, total, stop }
  }

  /**
   * Starts playback, optionally fading in. Resolves to 'playing', 'blocked'
   * (browser autoplay policy: retry after a user gesture) or 'error'.
   */
  async play({ fadeIn = 0 } = {}) {
    this.fade = null;
    this.audio.currentTime = 0;
    this.audio.volume = fadeIn > 0 ? 0 : this.volume;
    try {
      await this.audio.play();
      if (fadeIn > 0) this.fade = { from: 0, to: this.volume, left: fadeIn, total: fadeIn, stop: false };
      return 'playing';
    } catch (err) {
      if (err.name === 'NotAllowedError') return 'blocked';
      console.error('Music failed to play:', err);
      return 'error';
    }
  }

  fadeOut(seconds = 1) {
    if (this.audio.paused) return;
    this.fade = { from: this.audio.volume, to: 0, left: seconds, total: seconds, stop: true };
  }

  update(dt) {
    const f = this.fade;
    if (!f) return;
    f.left = Math.max(0, f.left - dt);
    const t = 1 - f.left / f.total;
    this.audio.volume = f.from + (f.to - f.from) * t;
    if (f.left === 0) {
      this.fade = null;
      if (f.stop) {
        this.audio.pause();
        this.audio.currentTime = 0;
      }
    }
  }
}
