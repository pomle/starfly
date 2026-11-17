// Procedural sound effects built on the Web Audio API (no sample files).
// All tuning values live in the constants below.

const MASTER_VOLUME = 0.7;
const MAX_VOICES = 8;

// Explosion shape. `size` scales duration, depth and loudness (1 = small, ~2.5 = big).
const EXPLOSION = {
  duration: 0.4,        // seconds at size 1; grows with size
  durationPerSize: 0.35,
  noiseCutoffStart: 2400, // Hz, low-pass at the moment of the blast...
  noiseCutoffEnd: 90,     // ...sweeping down to this for the rumble
  thumpFreqStart: 130,    // Hz, sine "boom" pitch drop
  thumpFreqEnd: 32,
  crackLength: 0.05,      // seconds of bright noise transient
};

// Laser shot: short downward pitch sweep. Fires ~9x/s, so keep it short and quiet.
const LASER = {
  duration: 0.11,
  freqStart: 1500,  // Hz
  freqEnd: 320,
  cutoff: 3200,     // Hz low-pass to take the edge off the sawtooth
  level: 0.16,
  pitchJitter: 0.06,
};

export class Sfx {
  constructor() {
    this.ctx = null;
    this.voices = 0;
  }

  /** Call from a user gesture. Creates (or resumes) the audio context. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = MASTER_VOLUME;
      // Compressor keeps stacked explosions from clipping.
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
      this.noise = this.makeBrownNoise(2);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  /** Low-heavy noise: much better than white noise for booms. */
  makeBrownNoise(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  }

  /** Tracks a voice's lifetime so we can cap simultaneous sounds. */
  track(node) {
    this.voices++;
    node.onended = () => { this.voices--; };
  }

  /**
   * Laser shot: a sawtooth that sweeps down in pitch, plus a faint square one octave
   * lower for body. Pitch is randomised slightly so rapid fire doesn't sound mechanical.
   * @param pan -1 (left) .. 1 (right)
   */
  laser({ pan = 0 } = {}) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.voices >= MAX_VOICES) return;

    const L = LASER;
    const t0 = ctx.currentTime;
    const pitch = 1 + (Math.random() * 2 - 1) * L.pitchJitter;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(L.level, t0 + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + L.duration);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = L.cutoff;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    env.connect(lp).connect(panner).connect(this.master);

    const voice = (type, mult, gain) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(L.freqStart * pitch * mult, t0);
      osc.frequency.exponentialRampToValueAtTime(L.freqEnd * pitch * mult, t0 + L.duration);
      const g = ctx.createGain();
      g.gain.value = gain;
      osc.connect(g).connect(env);
      osc.start(t0);
      osc.stop(t0 + L.duration + 0.02);
      return osc;
    };
    this.track(voice('sawtooth', 1, 1));
    voice('square', 0.5, 0.35);
  }

  /**
   * Explosion: noise burst with a falling low-pass, a sub thump and a short crack.
   * @param size 1 = small (enemy), ~2.5 = big (player ship)
   * @param pan  -1 (left) .. 1 (right)
   */
  explosion({ size = 1, pan = 0 } = {}) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (this.voices >= MAX_VOICES && size < 2) return; // never drop the big ones

    const E = EXPLOSION;
    const t0 = ctx.currentTime;
    const dur = E.duration + E.durationPerSize * (size - 1);
    const jitter = (amt) => 1 + (Math.random() * 2 - 1) * amt;
    const level = Math.min(1, 0.45 + 0.2 * size);

    const out = ctx.createGain();
    out.gain.value = level;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(panner).connect(this.master);

    // Rumble: brown noise through a sweeping low-pass.
    const rumble = ctx.createBufferSource();
    rumble.buffer = this.noise;
    rumble.playbackRate.value = jitter(0.15);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(E.noiseCutoffStart * jitter(0.15), t0);
    lp.frequency.exponentialRampToValueAtTime(E.noiseCutoffEnd, t0 + dur);
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.0001, t0);
    rg.gain.exponentialRampToValueAtTime(1, t0 + 0.008);
    rg.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    rumble.connect(lp).connect(rg).connect(out);
    rumble.start(t0, Math.random() * 0.5);
    rumble.stop(t0 + dur + 0.05);
    this.track(rumble);

    // Thump: sine dropping in pitch.
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    const tDur = dur * 0.8;
    thump.frequency.setValueAtTime(E.thumpFreqStart * jitter(0.1) / Math.sqrt(size), t0);
    thump.frequency.exponentialRampToValueAtTime(E.thumpFreqEnd, t0 + tDur);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, t0);
    tg.gain.exponentialRampToValueAtTime(0.9, t0 + 0.01);
    tg.gain.exponentialRampToValueAtTime(0.0001, t0 + tDur);
    thump.connect(tg).connect(out);
    thump.start(t0);
    thump.stop(t0 + tDur + 0.05);

    // Crack: a few ms of bright noise for the initial punch.
    const crack = ctx.createBufferSource();
    crack.buffer = this.noise;
    crack.playbackRate.value = 4;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.5, t0);
    cg.gain.exponentialRampToValueAtTime(0.0001, t0 + E.crackLength);
    crack.connect(hp).connect(cg).connect(out);
    crack.start(t0, Math.random() * 0.5);
    crack.stop(t0 + E.crackLength + 0.02);
  }
}
