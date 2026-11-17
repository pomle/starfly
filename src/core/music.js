// Background music track with autoplay-policy handling and fade-out.

export class Music {
  constructor(url, { volume = 0.6, loop = true } = {}) {
    this.audio = new Audio(url);
    this.audio.loop = loop;
    this.audio.preload = 'auto';
    this.volume = volume;
    this.audio.volume = volume;
    this.fadeLeft = 0;      // seconds remaining in a fade-out
    this.fadeDuration = 0;
  }

  /**
   * Starts playback. Resolves to 'playing', 'blocked' (browser autoplay policy:
   * retry after a user gesture) or 'error' (e.g. file missing/unsupported).
   */
  async play() {
    this.fadeLeft = 0;
    this.audio.volume = this.volume;
    try {
      await this.audio.play();
      return 'playing';
    } catch (err) {
      if (err.name === 'NotAllowedError') return 'blocked';
      console.error('Music failed to play:', err);
      return 'error';
    }
  }

  fadeOut(seconds = 1) {
    if (this.audio.paused) return;
    this.fadeDuration = this.fadeLeft = seconds;
  }

  update(dt) {
    if (this.fadeLeft <= 0) return;
    this.fadeLeft = Math.max(0, this.fadeLeft - dt);
    this.audio.volume = this.volume * (this.fadeLeft / this.fadeDuration);
    if (this.fadeLeft === 0) {
      this.audio.pause();
      this.audio.currentTime = 0;
    }
  }
}
