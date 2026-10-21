// Procedural WebAudio: engine, sfx, and a small chiptune sequencer per theme.
export class Audio {
  constructor() { this.ctx = null; this.enabled = true; this.master = null; this.musicOn = true; this.sfxOn = true; }
  init() {
    if (this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext; if (!C) { this.enabled = false; return; }
    this.ctx = new C(); const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.5; this.master.connect(c.destination);
    this.sfxBus = c.createGain(); this.sfxBus.gain.value = 0.8; this.sfxBus.connect(this.master);
    this.musicBus = c.createGain(); this.musicBus.gain.value = 0.32; this.musicBus.connect(this.master);
    // engine
    this.engGain = c.createGain(); this.engGain.gain.value = 0; this.engGain.connect(this.master);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.connect(this.engGain); this.engLP = lp;
    this.osc1 = c.createOscillator(); this.osc1.type = 'sawtooth'; this.osc1.frequency.value = 60; const g1 = c.createGain(); g1.gain.value = 0.35; this.osc1.connect(g1); g1.connect(lp);
    this.osc2 = c.createOscillator(); this.osc2.type = 'square'; this.osc2.frequency.value = 120; const g2 = c.createGain(); g2.gain.value = 0.12; this.osc2.connect(g2); g2.connect(lp);
    this.osc1.start(); this.osc2.start();
    // drift noise
    const buf = c.createBuffer(1, c.sampleRate * 1, c.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = c.createBufferSource(); this.noise.buffer = buf; this.noise.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 1.2;
    this.driftGain = c.createGain(); this.driftGain.gain.value = 0; this.noise.connect(bp); bp.connect(this.driftGain); this.driftGain.connect(this.master); this.noise.start();
    this.noiseBuf = buf;
    this.music = null;
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setEngine(rpm, load, drifting, driftTier, muted) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    const f = 55 + rpm * 190;
    this.osc1.frequency.setTargetAtTime(f, t, 0.05); this.osc2.frequency.setTargetAtTime(f * 2.01, t, 0.05);
    this.engLP.frequency.setTargetAtTime(500 + rpm * 1800, t, 0.1);
    this.engGain.gain.setTargetAtTime(muted ? 0 : 0.05 + rpm * 0.09 + load * 0.03, t, 0.1);
    this.driftGain.gain.setTargetAtTime(drifting ? 0.05 + driftTier * 0.03 : 0, t, 0.08);
  }
  tone(freq, dur, type = 'square', vol = 0.3, slide = 0, delay = 0) {
    if (!this.ctx || !this.sfxOn) return; const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + dur + 0.02);
  }
  noiseHit(dur, vol = 0.4, freq = 800, delay = 0) {
    if (!this.ctx || !this.sfxOn) return; const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(freq * 3, t); f.frequency.exponentialRampToValueAtTime(freq * 0.3, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); s.connect(f); f.connect(g); g.connect(this.sfxBus); s.start(t); s.stop(t + dur + 0.02);
  }
  play(name) {
    if (!this.ctx) return;
    switch (name) {
      case 'countdown': this.tone(440, 0.25, 'square', 0.25); break;
      case 'go': this.tone(880, 0.5, 'square', 0.3); this.tone(1320, 0.5, 'square', 0.2, 0, 0.05); break;
      case 'hop': this.tone(300, 0.08, 'triangle', 0.2, 200); break;
      case 'tier1': this.tone(700, 0.1, 'sine', 0.25, 300); break;
      case 'tier2': this.tone(900, 0.1, 'sine', 0.25, 400); this.tone(1200, 0.1, 'sine', 0.2, 0, 0.06); break;
      case 'tier3': this.tone(1000, 0.12, 'sine', 0.25, 600); this.tone(1500, 0.12, 'sine', 0.2, 0, 0.06); this.tone(2000, 0.15, 'sine', 0.2, 0, 0.12); break;
      case 'boost1': case 'boost2': case 'boost3': this.noiseHit(0.35, 0.3, 1500); this.tone(250, 0.35, 'sawtooth', 0.15, 500); break;
      case 'pad': case 'mushroom': this.noiseHit(0.45, 0.35, 2000); this.tone(300, 0.4, 'sawtooth', 0.18, 900); break;
      case 'spin': this.tone(500, 0.35, 'square', 0.2, -400); this.noiseHit(0.2, 0.2, 600); break;
      case 'spinFar': this.tone(500, 0.25, 'square', 0.08, -400); break;
      case 'crash': this.noiseHit(0.5, 0.5, 400); this.tone(120, 0.5, 'square', 0.2, -80); break;
      case 'wall': this.noiseHit(0.15, 0.3, 500); break;
      case 'bump': this.noiseHit(0.12, 0.2, 700); break;
      case 'lap': this.tone(660, 0.12, 'square', 0.2); this.tone(880, 0.2, 'square', 0.2, 0, 0.12); break;
      case 'finish': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.35, 'square', 0.22, 0, i * 0.13)); break;
      case 'box': this.tone(800, 0.08, 'square', 0.2); this.tone(1200, 0.12, 'square', 0.2, 0, 0.07); break;
      case 'roulette': for (let i = 0; i < 10; i++) this.tone(600 + (i % 3) * 120, 0.05, 'square', 0.12, 0, i * 0.15); break;
      case 'itemGot': this.tone(1000, 0.1, 'square', 0.2); this.tone(1500, 0.15, 'square', 0.2, 0, 0.08); break;
      case 'coin': this.tone(1400, 0.08, 'square', 0.18); this.tone(1900, 0.15, 'square', 0.18, 0, 0.06); break;
      case 'throw': this.noiseHit(0.15, 0.25, 1200); this.tone(400, 0.12, 'triangle', 0.15, 300); break;
      case 'drop': this.tone(250, 0.1, 'triangle', 0.15, -100); break;
      case 'bounce': this.tone(600, 0.06, 'square', 0.12, -200); break;
      case 'shellBreak': this.noiseHit(0.2, 0.3, 1500); this.tone(900, 0.1, 'square', 0.12, -500); break;
      case 'explosion': this.noiseHit(0.8, 0.6, 250); this.tone(80, 0.6, 'sawtooth', 0.3, -50); break;
      case 'blue': this.tone(200, 0.6, 'sawtooth', 0.2, 800); this.noiseHit(0.5, 0.2, 2500); break;
      case 'star': [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.12, 'square', 0.2, 0, i * 0.07)); break;
      case 'bullet': this.noiseHit(0.9, 0.5, 900); this.tone(150, 0.8, 'sawtooth', 0.25, 400); break;
      case 'lightning': this.noiseHit(0.7, 0.5, 3000); this.tone(1800, 0.5, 'sawtooth', 0.15, -1600); break;
      case 'blooper': this.tone(300, 0.4, 'sine', 0.25, -200); this.tone(220, 0.4, 'sine', 0.2, -150, 0.15); break;
      case 'inked': this.tone(200, 0.5, 'sine', 0.3, -120); break;
      case 'horn': this.tone(220, 0.5, 'sawtooth', 0.3, 20); this.tone(330, 0.5, 'sawtooth', 0.25, 20); this.tone(440, 0.5, 'square', 0.2, 20); break;
      case 'fire': this.noiseHit(0.15, 0.25, 1800); this.tone(700, 0.12, 'square', 0.12, -300); break;
      case 'trick': this.tone(500, 0.15, 'square', 0.15, 500); break;
      case 'fall': this.tone(600, 0.8, 'sine', 0.25, -550); break;
      case 'pop': this.noiseHit(0.12, 0.5, 2500); this.tone(900, 0.12, 'square', 0.25, -600); break;
      case 'popFar': this.noiseHit(0.1, 0.2, 2200); break;
      case 'menu': this.tone(700, 0.06, 'square', 0.15); break;
      case 'confirm': this.tone(600, 0.08, 'square', 0.18); this.tone(900, 0.12, 'square', 0.18, 0, 0.07); break;
      case 'back': this.tone(500, 0.1, 'square', 0.15, -200); break;
    }
  }
  // ---- music sequencer ----
  startMusic(theme) {
    if (!this.ctx || !this.musicOn) return; this.stopMusic();
    const themes = {
      meadow: { bpm: 150, root: 60, scale: [0, 2, 4, 7, 9], lead: 'square', bass: 'triangle' },
      desert: { bpm: 140, root: 57, scale: [0, 1, 4, 5, 7, 8, 10], lead: 'sawtooth', bass: 'triangle' },
      snow: { bpm: 138, root: 62, scale: [0, 2, 3, 7, 9], lead: 'triangle', bass: 'sine' },
      neon: { bpm: 160, root: 55, scale: [0, 3, 5, 7, 10], lead: 'square', bass: 'sawtooth' },
      lava: { bpm: 165, root: 52, scale: [0, 1, 3, 5, 6, 8, 10], lead: 'sawtooth', bass: 'square' },
      space: { bpm: 145, root: 64, scale: [0, 2, 4, 6, 7, 9, 11], lead: 'triangle', bass: 'sine' },
    };
    const th = themes[theme] || themes.meadow;
    const c = this.ctx; const stepDur = 60 / th.bpm / 2; // 8th notes
    let step = 0; let next = c.currentTime + 0.1; let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const chordRoots = [0, 0, 5, 3, 0, 0, 4, 5];
    const note = (freq, t, dur, type, vol) => { const o = c.createOscillator(); o.type = type; o.frequency.value = freq; const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + dur + 0.02); };
    const melody = []; for (let i = 0; i < 64; i++) melody.push(rnd() < 0.8 ? Math.floor(rnd() * th.scale.length) + (rnd() < 0.3 ? th.scale.length : 0) : -1);
    const tick = () => {
      if (next < c.currentTime) next = c.currentTime + 0.05; // don't burst-play notes missed while the tab was hidden
      while (next < c.currentTime + 0.3) {
        const bar = Math.floor(step / 8) % chordRoots.length; const root = th.root + chordRoots[bar];
        if (step % 2 === 0) note(mtof(root - 24 + (step % 8 === 4 ? 7 : 0)), next, stepDur * 1.6, th.bass, 0.25);
        const m = melody[step % 64]; if (m >= 0) { const deg = m % th.scale.length, oct = Math.floor(m / th.scale.length); note(mtof(root + th.scale[deg] + oct * 12 + 12), next, stepDur * 0.9, th.lead, 0.12); }
        if (step % 4 === 0) { const s = c.createBufferSource(); s.buffer = this.noiseBuf; const g = c.createGain(); g.gain.setValueAtTime(0.12, next); g.gain.exponentialRampToValueAtTime(0.001, next + 0.08); s.connect(g); g.connect(this.musicBus); s.start(next); s.stop(next + 0.1); }
        if (step % 4 === 2) { const s = c.createBufferSource(); s.buffer = this.noiseBuf; const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000; const g = c.createGain(); g.gain.setValueAtTime(0.07, next); g.gain.exponentialRampToValueAtTime(0.001, next + 0.05); s.connect(f); f.connect(g); g.connect(this.musicBus); s.start(next); s.stop(next + 0.06); }
        next += stepDur; step++;
      }
    };
    this.music = setInterval(tick, 100); tick();
  }
  stopMusic() { if (this.music) { clearInterval(this.music); this.music = null; } }
  setMusicRate(fast) { if (this.musicBus) this.musicBus.gain.setTargetAtTime(fast ? 0.4 : 0.32, this.ctx.currentTime, 0.5); }
}
