import { clamp, lerp } from './utils.js';

// Everything is synthesised with WebAudio: no audio files.
export class AudioEngine {
  constructor() { this.ctx = null; this.ready = false; this.radioStation = 0; this.sirenVoices = []; }
  init() {
    if (this.ctx) return;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = 0.6; this.master.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0; this.musicBus.connect(this.master);
    // noise buffer
    const len = ctx.sampleRate * 2; const buf = ctx.createBuffer(1, len, ctx.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; this.noiseBuf = buf;
    this.buildEngine(); this.buildAmbience(); this.buildSiren(); this.buildRadio();
    this.ready = true;
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  // ---- engine: two detuned oscillators + noise bed, pitch by rpm ----
  buildEngine() {
    const ctx = this.ctx;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0; this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 600; this.engFilter.Q.value = 2;
    this.engFilter.connect(this.engGain); this.engGain.connect(this.sfx);
    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth'; this.osc2 = ctx.createOscillator(); this.osc2.type = 'square';
    const g2 = ctx.createGain(); g2.gain.value = 0.35; this.osc1.connect(this.engFilter); this.osc2.connect(g2); g2.connect(this.engFilter);
    this.osc1.start(); this.osc2.start();
    // road noise
    this.roadSrc = ctx.createBufferSource(); this.roadSrc.buffer = this.noiseBuf; this.roadSrc.loop = true; const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 400; this.roadGain = ctx.createGain(); this.roadGain.gain.value = 0; this.roadSrc.connect(rf); rf.connect(this.roadGain); this.roadGain.connect(this.sfx); this.roadSrc.start();
    // skid
    this.skidSrc = ctx.createBufferSource(); this.skidSrc.buffer = this.noiseBuf; this.skidSrc.loop = true; const sf = ctx.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 1800; sf.Q.value = 3; this.skidGain = ctx.createGain(); this.skidGain.gain.value = 0; this.skidSrc.connect(sf); sf.connect(this.skidGain); this.skidGain.connect(this.sfx); this.skidSrc.start();
  }
  setEngine(active, rpm01, throttle, speed01, skid01) {
    if (!this.ready) return; const t = this.ctx.currentTime;
    const targetGain = active ? 0.10 + throttle * 0.12 + speed01 * 0.05 : 0;
    this.engGain.gain.setTargetAtTime(targetGain, t, 0.08);
    const f = 45 + rpm01 * 190; this.osc1.frequency.setTargetAtTime(f, t, 0.05); this.osc2.frequency.setTargetAtTime(f * 0.5 + 1.5, t, 0.05);
    this.engFilter.frequency.setTargetAtTime(400 + rpm01 * 1800 + throttle * 600, t, 0.08);
    this.roadGain.gain.setTargetAtTime(active ? speed01 * 0.25 : 0, t, 0.1);
    this.skidGain.gain.setTargetAtTime(active ? skid01 * 0.35 : 0, t, 0.05);
  }
  buildAmbience() {
    const ctx = this.ctx; const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220; const g = ctx.createGain(); g.gain.value = 0.05; src.connect(f); f.connect(g); g.connect(this.sfx); src.start(); this.ambGain = g;
  }
  buildSiren() {
    const ctx = this.ctx; this.sirenGain = ctx.createGain(); this.sirenGain.gain.value = 0; this.sirenGain.connect(this.sfx);
    this.sirenOsc = ctx.createOscillator(); this.sirenOsc.type = 'triangle'; this.sirenOsc.frequency.value = 700; const g = ctx.createGain(); g.gain.value = 0.4; this.sirenOsc.connect(g); g.connect(this.sirenGain); this.sirenOsc.start(); this.sirenPhase = 0;
  }
  setSiren(vol, dt) {
    if (!this.ready) return; const t = this.ctx.currentTime; this.sirenGain.gain.setTargetAtTime(vol * 0.25, t, 0.1);
    if (vol > 0.001) { this.sirenPhase += dt * 1.4; const f = 620 + 280 * (0.5 + 0.5 * Math.sin(this.sirenPhase * Math.PI * 2)); this.sirenOsc.frequency.setTargetAtTime(f, t, 0.03); }
  }

  // ---- one-shots ----
  noiseBurst(dur, freq, q, gain, type = 'bandpass', decay = dur) {
    const ctx = this.ctx, t = ctx.currentTime; const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = 1; const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + decay); s.connect(f); f.connect(g); g.connect(this.sfx); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  tone(freq, dur, gain, type = 'sine', slideTo = null) {
    const ctx = this.ctx, t = ctx.currentTime; const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + dur + 0.05);
  }
  gunshot(kind = 'pistol') {
    if (!this.ready) return;
    if (kind === 'shotgun') { this.noiseBurst(0.35, 500, 0.7, 0.9, 'lowpass', 0.3); this.noiseBurst(0.15, 2500, 1, 0.5); this.tone(90, 0.2, 0.6, 'sine', 40); }
    else if (kind === 'uzi') { this.noiseBurst(0.08, 1800, 1.2, 0.5); this.tone(220, 0.06, 0.35, 'square', 80); }
    else if (kind === 'rifle') { this.noiseBurst(0.18, 1200, 1, 0.7); this.tone(140, 0.12, 0.5, 'sine', 50); }
    else { this.noiseBurst(0.12, 1400, 1, 0.6); this.tone(180, 0.09, 0.45, 'sine', 60); }
  }
  explosion() { if (!this.ready) return; this.noiseBurst(1.4, 180, 0.5, 1.2, 'lowpass', 1.2); this.tone(60, 0.9, 0.9, 'sine', 25); this.noiseBurst(0.4, 3000, 0.8, 0.3); }
  crash(intensity) { if (!this.ready) return; const k = clamp(intensity / 15, 0.15, 1); this.noiseBurst(0.25, 300 + k * 600, 0.8, 0.35 + 0.6 * k, 'lowpass', 0.25); this.tone(120, 0.15, 0.4 * k, 'triangle', 50); if (k > 0.5) this.noiseBurst(0.3, 4000, 2, 0.2 * k); }
  thud() { if (!this.ready) return; this.noiseBurst(0.12, 200, 1, 0.5, 'lowpass'); this.tone(80, 0.12, 0.4, 'sine', 40); }
  punch() { if (!this.ready) return; this.noiseBurst(0.08, 900, 1.5, 0.4); this.tone(150, 0.08, 0.3, 'triangle', 60); }
  pickup() { if (!this.ready) return; this.tone(880, 0.08, 0.25, 'square'); setTimeout(() => this.ready && this.tone(1320, 0.12, 0.25, 'square'), 70); }
  cash() { if (!this.ready) return; this.tone(1200, 0.06, 0.2, 'square'); setTimeout(() => this.ready && this.tone(1600, 0.06, 0.2, 'square'), 60); setTimeout(() => this.ready && this.tone(2000, 0.1, 0.2, 'square'), 120); }
  horn(on) { if (!this.ready) return; const ctx = this.ctx; if (on && !this.hornOsc) { const g = ctx.createGain(); g.gain.value = 0.12; const o1 = ctx.createOscillator(); o1.type = 'square'; o1.frequency.value = 420; const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 520; const f = ctx.createBiquadFilter(); f.frequency.value = 1500; o1.connect(f); o2.connect(f); f.connect(g); g.connect(this.sfx); o1.start(); o2.start(); this.hornOsc = [o1, o2]; } if (!on && this.hornOsc) { this.hornOsc.forEach(o => o.stop()); this.hornOsc = null; } }
  ui() { if (!this.ready) return; this.tone(600, 0.05, 0.15, 'square'); }
  missionPassed() { if (!this.ready) return; [0, 0.12, 0.24, 0.42].forEach((d, i) => setTimeout(() => this.ready && this.tone([523, 659, 784, 1047][i], 0.35, 0.25, 'triangle'), d * 1000)); }
  wasted() { if (!this.ready) return; this.tone(220, 1.6, 0.35, 'sawtooth', 55); this.noiseBurst(1.0, 200, 0.5, 0.3, 'lowpass', 1.0); }
  stars() { if (!this.ready) return; this.tone(300, 0.15, 0.25, 'square', 600); }

  // ---- procedural radio: tiny step sequencer with three stations ----
  buildRadio() {
    this.stations = [
      { name: 'Neon FM', bpm: 112, style: 'synthwave' },
      { name: 'Bounce 105', bpm: 92, style: 'hiphop' },
      { name: 'Vibe Radio', bpm: 124, style: 'house' },
      { name: 'Radio Off', bpm: 0, style: 'off' },
    ];
    this.radioStation = 0; this.step = 0; this.nextNoteT = 0; this.radioOn = false;
    this.scales = { synthwave: [0, 3, 7, 10, 12, 15, 19], hiphop: [0, 2, 3, 7, 8, 12], house: [0, 4, 7, 11, 12, 14, 16] };
    this.seed = 1; this.bar = 0;
  }
  setRadio(on) { if (!this.ready) return; this.radioOn = on; this.musicBus.gain.setTargetAtTime(on && this.stations[this.radioStation].style !== 'off' ? 0.55 : 0, this.ctx.currentTime, 0.2); }
  nextStation() { this.radioStation = (this.radioStation + 1) % this.stations.length; this.step = 0; this.setRadio(this.radioOn); return this.stations[this.radioStation].name; }
  rnd() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }
  note(freq, t, dur, gain, type, dest = this.musicBus, filterF = 0) {
    const ctx = this.ctx; const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (filterF) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(filterF, t); f.frequency.exponentialRampToValueAtTime(200, t + dur); o.connect(f); f.connect(g); } else o.connect(g);
    g.connect(dest); o.start(t); o.stop(t + dur + 0.02);
  }
  drum(kind, t) {
    const ctx = this.ctx;
    if (kind === 'kick') { const o = ctx.createOscillator(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12); const g = ctx.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25); o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + 0.3); }
    else { const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; const f = ctx.createBiquadFilter(); f.type = kind === 'hat' ? 'highpass' : 'bandpass'; f.frequency.value = kind === 'hat' ? 7000 : 1800; const g = ctx.createGain(); const d = kind === 'hat' ? 0.04 : 0.18; g.gain.setValueAtTime(kind === 'hat' ? 0.2 : 0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + d); s.connect(f); f.connect(g); g.connect(this.musicBus); s.start(t, Math.random()); s.stop(t + d + 0.02); }
  }
  updateRadio() {
    if (!this.ready || !this.radioOn) return; const st = this.stations[this.radioStation]; if (st.style === 'off') return;
    const ctx = this.ctx; const stepDur = 60 / st.bpm / 4; // 16th notes
    if (this.nextNoteT < ctx.currentTime) this.nextNoteT = ctx.currentTime + 0.05;
    while (this.nextNoteT < ctx.currentTime + 0.25) {
      const s = this.step % 16; const t = this.nextNoteT; const scale = this.scales[st.style]; const root = 55 * Math.pow(2, [0, 0, 5, 3][Math.floor(this.step / 64) % 4] / 12);
      const chordIdx = Math.floor(this.step / 16) % 4; const chordRoot = root * Math.pow(2, [0, 3, 5, 7][chordIdx] / 12);
      if (st.style === 'synthwave') {
        if (s % 4 === 0) this.drum('kick', t); if (s === 4 || s === 12) this.drum('snare', t); if (s % 2 === 1) this.drum('hat', t);
        this.note(chordRoot * Math.pow(2, scale[[0, 2, 4, 6][s % 4]] / 12) * 2, t, stepDur * 0.9, 0.12, 'sawtooth', this.musicBus, 2500);
        if (s % 8 === 0) this.note(chordRoot / 1, t, stepDur * 7, 0.25, 'square', this.musicBus, 400);
        if (s === 0 && chordIdx % 2 === 0) for (const iv of [0, 2, 4]) this.note(chordRoot * 2 * Math.pow(2, scale[iv] / 12), t, stepDur * 14, 0.06, 'triangle');
      } else if (st.style === 'hiphop') {
        if (s === 0 || s === 7 || s === 10) this.drum('kick', t); if (s === 4 || s === 12) this.drum('snare', t); if (s % 2 === 0) this.drum('hat', t);
        if (s === 0 || s === 6 || s === 11) this.note(chordRoot, t, stepDur * 3, 0.35, 'sine');
        if (this.rnd() < 0.35) this.note(chordRoot * 4 * Math.pow(2, scale[Math.floor(this.rnd() * scale.length)] / 12), t, stepDur * 2, 0.07, 'triangle', this.musicBus, 1800);
      } else {
        if (s % 4 === 0) this.drum('kick', t); if (s % 4 === 2) this.drum('hat', t); if (s === 4 || s === 12) this.drum('snare', t);
        if (s % 4 === 2) this.note(chordRoot * 2, t, stepDur * 1.5, 0.22, 'sawtooth', this.musicBus, 900);
        if (s % 2 === 0) this.note(chordRoot * 4 * Math.pow(2, scale[(s / 2 + chordIdx) % scale.length] / 12), t, stepDur * 0.8, 0.07, 'square', this.musicBus, 3000);
      }
      this.step++; this.nextNoteT += stepDur;
    }
  }
}
