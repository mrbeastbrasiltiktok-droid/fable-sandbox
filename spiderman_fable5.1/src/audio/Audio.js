/** Synthesised sound effects — no audio files needed. Call init() from a user gesture. */
export class Audio {
  constructor() { this.ctx = null; this.master = null; this.whooshGain = null; this.whooshFilter = null; this.ready = false; }

  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(ctx.destination);
    // noise buffer
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // continuous wind/whoosh
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    this.whooshFilter = ctx.createBiquadFilter(); this.whooshFilter.type = 'bandpass'; this.whooshFilter.frequency.value = 400; this.whooshFilter.Q.value = 0.6;
    this.whooshGain = ctx.createGain(); this.whooshGain.gain.value = 0;
    src.connect(this.whooshFilter).connect(this.whooshGain).connect(this.master);
    src.start();
    // ambient city hum
    const hum = ctx.createBufferSource(); hum.buffer = buf; hum.loop = true;
    const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 180;
    const hg = ctx.createGain(); hg.gain.value = 0.06;
    hum.connect(hf).connect(hg).connect(this.master); hum.start();
    this._music();
    this.ready = true;
  }

  /** Generative score: detuned saw pad on a slow minor progression + sub, with a pulse layer that rises in combat. */
  _music() {
    const ctx = this.ctx;
    this.mus = { gain: ctx.createGain(), filter: ctx.createBiquadFilter(), oscs: [], beat: 0, chord: 0, intensity: 0, t: 0, step: 0 };
    const m = this.mus;
    m.filter.type = 'lowpass'; m.filter.frequency.value = 420; m.filter.Q.value = 0.8;
    m.gain.gain.value = 0.0;
    m.filter.connect(m.gain).connect(this.master);
    const voices = [[0, -7], [0, 5], [12, 4], [-12, 0]]; // semitone offset, detune cents
    for (const [semi, det] of voices) {
      const o = ctx.createOscillator(); o.type = semi === -12 ? 'sine' : 'sawtooth'; o.detune.value = det;
      const g = ctx.createGain(); g.gain.value = semi === -12 ? 0.5 : 0.18;
      o.connect(g).connect(m.filter); o.start(); m.oscs.push({ o, semi });
    }
    this._setChord(0);
    m.gain.gain.setTargetAtTime(0.16, ctx.currentTime, 4);
  }
  _setChord(i) {
    const roots = [45, 41, 48, 43]; // A2 F2 C3 G2 (MIDI)
    const root = roots[i % roots.length];
    for (const v of this.mus.oscs) v.o.frequency.setTargetAtTime(440 * Math.pow(2, (root + v.semi - 69) / 12), this.ctx.currentTime, 0.6);
  }
  /** intensity 0..1 (combat nearby). Call every frame. */
  music(dt, intensity) {
    if (!this.ready) return;
    const m = this.mus, ctx = this.ctx;
    m.t += dt;
    m.intensity += (intensity - m.intensity) * Math.min(1, dt * 0.8);
    if (m.t > 8) { m.t = 0; m.chord++; this._setChord(m.chord); }
    m.filter.frequency.setTargetAtTime(420 + m.intensity * 1400 + Math.sin(performance.now() * 0.0004) * 120, ctx.currentTime, 0.2);
    m.beat += dt;
    const period = 0.5;
    if (m.beat >= period) {
      m.beat -= period; m.step++;
      if (m.intensity > 0.15) {
        const k = m.intensity;
        if (m.step % 2 === 0) this._tone({ freq: 70, freqEnd: 32, dur: 0.18, gain: 0.32 * k });                       // kick
        if (m.step % 4 === 2) this._burst({ freq: 1800, freqEnd: 900, dur: 0.09, gain: 0.12 * k, type: 'highpass' });  // snare-ish
        if (m.step % 2 === 1) this._burst({ freq: 7000, freqEnd: 5000, dur: 0.03, gain: 0.05 * k, type: 'highpass' }); // hat
      }
    }
  }

  resume() { this.ctx?.resume(); }

  /** speed in m/s */
  setSpeed(speed, airborne) {
    if (!this.ready) return;
    const t = Math.max(0, (speed - 10) / 45);
    const g = airborne ? Math.min(0.6, t * 0.7) : t * 0.15;
    this.whooshGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.08);
    this.whooshFilter.frequency.setTargetAtTime(300 + t * 900, this.ctx.currentTime, 0.1);
  }

  _burst({ freq = 800, freqEnd = 200, dur = 0.15, gain = 0.4, type = 'bandpass', q = 1 }) {
    if (!this.ready) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t0); f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    s.connect(f).connect(g).connect(this.master); s.start(t0); s.stop(t0 + dur + 0.05);
  }
  _tone({ freq = 440, freqEnd, dur = 0.1, gain = 0.2, type = 'sine', delay = 0 }) {
    if (!this.ready) return;
    const ctx = this.ctx, t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(this.master); o.start(t0); o.stop(t0 + dur + 0.05);
  }

  thwip() { this._burst({ freq: 3000, freqEnd: 600, dur: 0.12, gain: 0.5, q: 2 }); }
  release() { this._burst({ freq: 900, freqEnd: 300, dur: 0.08, gain: 0.15 }); }
  jump() { this._burst({ freq: 500, freqEnd: 1500, dur: 0.1, gain: 0.12 }); }
  land(hard) { this._tone({ freq: 90, freqEnd: 40, dur: hard ? 0.25 : 0.12, gain: hard ? 0.5 : 0.2 }); this._burst({ freq: 300, freqEnd: 80, dur: 0.15, gain: hard ? 0.35 : 0.1, type: 'lowpass' }); }
  punch(heavy) { this._tone({ freq: heavy ? 110 : 160, freqEnd: 50, dur: 0.14, gain: 0.55, type: 'triangle' }); this._burst({ freq: 1800, freqEnd: 300, dur: 0.07, gain: 0.3 }); }
  hurt() { this._tone({ freq: 220, freqEnd: 90, dur: 0.25, gain: 0.35, type: 'sawtooth' }); }
  dodge() { this._burst({ freq: 1200, freqEnd: 2500, dur: 0.18, gain: 0.25 }); }
  sense() { this._tone({ freq: 1400, dur: 0.08, gain: 0.15 }); this._tone({ freq: 1900, dur: 0.08, gain: 0.15, delay: 0.09 }); }
  pickup() { this._tone({ freq: 880, dur: 0.1, gain: 0.2 }); this._tone({ freq: 1320, dur: 0.18, gain: 0.2, delay: 0.1 }); }
  alert() { this._tone({ freq: 330, dur: 0.15, gain: 0.25, type: 'square' }); this._tone({ freq: 440, dur: 0.25, gain: 0.25, type: 'square', delay: 0.15 }); }
  complete() { [523, 659, 784, 1046].forEach((f, i) => this._tone({ freq: f, dur: 0.25, gain: 0.22, delay: i * 0.11 })); }
  ko() { this._tone({ freq: 200, freqEnd: 60, dur: 0.3, gain: 0.4, type: 'square' }); }
  levelUp() { [392, 523, 659, 784, 1046].forEach((f, i) => this._tone({ freq: f, dur: 0.3, gain: 0.25, type: 'triangle', delay: i * 0.09 })); }
  gunshot() { this._burst({ freq: 900, freqEnd: 120, dur: 0.12, gain: 0.35, type: 'lowpass' }); }
  ui() { this._tone({ freq: 700, dur: 0.05, gain: 0.12 }); }
}
