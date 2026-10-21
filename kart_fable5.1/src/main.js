import * as THREE from 'three';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { HUD } from './hud.js';
import { Menu } from './menu.js';
import { Race } from './race.js';
import { CHARACTERS, buildKart } from './characters.js';
import { TRACKS, CUP } from './tracks.js';
import { ARENAS } from './arena.js';
import { FIXED_DT, DEFAULT_LAPS } from './config.js';
import { formatTime } from './utils.js';
import { AIDriver, BattleAI } from './ai.js';
import { RNG } from './utils.js';

class App {
  constructor() {
    const root = document.getElementById('app');
    this.debug = new URLSearchParams(location.search).has('debug');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = 'gl'; root.appendChild(this.renderer.domElement);
    this.input = new Input(); this.audio = new Audio(); this.hud = new HUD(root); this.menu = new Menu(root, this);
    const wake = () => { this.audio.init(); this.audio.resume(); };
    window.addEventListener('keydown', wake); window.addEventListener('pointerdown', wake);
    window.addEventListener('resize', () => { this.renderer.setSize(innerWidth, innerHeight); if (this.race) { this.race.camera.aspect = innerWidth / innerHeight; this.race.camera.updateProjectionMatrix(); } this.showCam.aspect = innerWidth / innerHeight; this.showCam.updateProjectionMatrix(); });
    this.buildShowroom();
    this.race = null; this.gp = null; this.cc = 150; this.mode = 'race'; this.charIdx = 2; this.trackIdx = 0; this.paused = false;
    this.acc = 0; this.last = performance.now(); this.time = 0;
    this.menu.show('title');
    if (this.debug) { this.dbg = document.createElement('div'); this.dbg.className = 'debug-overlay'; root.appendChild(this.dbg); window.step = (n = 1, keys = {}) => this.debugStep(n, keys); window.app = this; window.__mods = { AIDriver, BattleAI, RNG }; }
    requestAnimationFrame((t) => this.frame(t));
  }
  buildShowroom() {
    this.showScene = new THREE.Scene(); this.showScene.background = new THREE.Color(0x141630);
    this.showScene.fog = new THREE.Fog(0x141630, 12, 40);
    this.showCam = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
    const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(4, 8, 5); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); this.showScene.add(sun);
    this.showScene.add(new THREE.HemisphereLight(0x8090ff, 0x202030, 1.2));
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.MeshStandardMaterial({ color: 0x2a2c50, roughness: 0.4, metalness: 0.3 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.showScene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(4, 4.3, 48), new THREE.MeshBasicMaterial({ color: 0xffcc33 })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; this.showScene.add(ring);
    this.showKart = null; this.showKartId = null;
  }
  updateShowroom(dt) {
    const wantId = this.menu.screen === 'chars' ? CHARACTERS[this.menu.sel].id : this.menu.screen === 'title' || this.menu.screen === 'main' || this.menu.screen === 'cc' || this.menu.screen === 'tracks' || this.menu.screen === 'help' ? CHARACTERS[this.charIdx].id : null;
    if (wantId !== this.showKartId) { if (this.showKart) this.showScene.remove(this.showKart.group); this.showKartId = wantId; this.showKart = wantId ? buildKart(CHARACTERS.find((c) => c.id === wantId)) : null; if (this.showKart) { this.showScene.add(this.showKart.group); this.showKart.group.position.y = 0; } }
    if (this.showKart) { this.showKart.group.rotation.y = this.time * 0.6; this.showKart.wheels.forEach((w) => (w.mesh.rotation.x += dt * 4)); this.showKart.body.position.y = Math.sin(this.time * 3) * 0.03; }
    const chars = this.menu.screen === 'chars';
    const d = chars ? 7.0 : 9;
    this.showCam.position.set(Math.sin(this.time * 0.15) * d, chars ? 2.6 : 3.5, Math.cos(this.time * 0.15) * d);
    this.showCam.lookAt(0, 0.7, 0);
    const W = innerWidth, H = innerHeight;
    if (chars) this.showCam.clearViewOffset(); else this.showCam.setViewOffset(W * 1.7, H, W * 0.7, 0, W, H);
    this.renderer.render(this.showScene, this.showCam);
  }

  // ---- menu flow ----
  menuConfirm(screen, sel) {
    if (screen === 'title') this.menu.show('main');
    else if (screen === 'main') { if (sel === 0) { this.mode = 'race'; this.menu.show('cc'); } else if (sel === 1) { this.mode = 'gp'; this.menu.show('cc'); } else if (sel === 2) { this.mode = 'battle'; this.menu.show('chars'); } else if (sel === 3) { this.mode = 'tt'; this.menu.show('chars'); } else this.menu.show('help'); }
    else if (screen === 'cc') { this.cc = [50, 100, 150][sel]; this.menu.show('chars'); }
    else if (screen === 'chars') { this.charIdx = sel; this.menu.charIdx = sel; if (this.mode === 'gp') this.startGP(); else if (this.mode === 'battle') this.menu.show('arenas'); else this.menu.show('tracks'); }
    else if (screen === 'arenas') { this.arenaIdx = sel; this.startBattle(ARENAS[sel]); }
    else if (screen === 'tracks') { this.trackIdx = sel; this.menu.trackIdx = sel; this.startRace(TRACKS[sel]); }
    else if (screen === 'results') { const r = this.menu.data; if (sel === 0) { if (r.battle) this.startBattle(this.race.trackDef); else if (r.gp) { if (r.gp.last) this.menu.show('gpfinal', r.gp); else this.nextGPRace(); } else this.startRace(this.race.trackDef); } else this.quitToMenu(); }
    else if (screen === 'gpfinal') this.quitToMenu();
    else if (screen === 'help') this.menu.show('main');
    else if (screen === 'pause') { if (sel === 0) this.togglePause(); else if (sel === 1) { this.paused = false; if (this.race.battle) this.startBattle(this.race.trackDef); else this.startRace(this.race.trackDef); } else this.quitToMenu(); }
  }
  menuBack(screen) {
    if (screen === 'main' || screen === 'title') return;
    if (screen === 'cc') this.menu.show('main');
    else if (screen === 'chars') this.menu.show(this.mode === 'tt' || this.mode === 'battle' ? 'main' : 'cc');
    else if (screen === 'arenas') this.menu.show('chars');
    else if (screen === 'tracks') this.menu.show('chars');
    else if (screen === 'help') this.menu.show('main');
    else if (screen === 'pause') this.togglePause();
  }
  startGP() { this.gp = { name: CUP.name, idx: 0, totals: Object.fromEntries(CHARACTERS.map((c) => [c.id, 0])), playerId: CHARACTERS[this.charIdx].id }; this.startRace(TRACKS.find((t) => t.id === CUP.tracks[0])); }
  nextGPRace() { this.gp.idx++; this.startRace(TRACKS.find((t) => t.id === CUP.tracks[this.gp.idx])); }
  startRace(trackDef) {
    if (this.race) this.race.dispose();
    this.menu.hide(); this.audio.stopMusic();
    this.race = new Race(this, { trackDef, playerChar: CHARACTERS[this.charIdx], cc: this.mode === 'tt' ? 150 : this.cc, laps: DEFAULT_LAPS, seed: (Date.now() % 100000) | 1, difficulty: this.cc === 150 ? 1.2 : this.cc === 100 ? 0.9 : 0.6, timeTrial: this.mode === 'tt' });
    if (this.mode === 'tt') { this.race.karts.slice(1).forEach((k) => { this.race.scene.remove(k.group); k.group.traverse((m) => { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); }); }); this.race.karts.length = 1; this.race.items.karts = this.race.karts; this.race.items.boxes.forEach((b) => { b.active = false; b.timer = 1e9; b.mesh.visible = false; }); this.race.updatePositions(); }
    this.hud.setTrack(this.race.track); this.hud.show(); this.resultsShown = false; this.paused = false;
    this.race.camera.aspect = innerWidth / innerHeight; this.race.camera.updateProjectionMatrix();
  }
  startBattle(arenaDef) {
    if (this.race) this.race.dispose();
    this.menu.hide(); this.audio.stopMusic();
    this.race = new Race(this, { arenaDef, playerChar: CHARACTERS[this.charIdx], cc: 150, seed: (Date.now() % 100000) | 1, difficulty: 1.0 });
    this.hud.setTrack(this.race.track); this.hud.show(); this.resultsShown = false; this.paused = false;
    this.race.camera.aspect = innerWidth / innerHeight; this.race.camera.updateProjectionMatrix();
  }
  quitToMenu() { if (this.race) { this.race.dispose(); this.race = null; } this.gp = null; this.paused = false; this.hud.hide(); this.audio.stopMusic(); this.audio.setEngine(0, 0, false, 0, true); this.menu.show('main'); }
  togglePause() { if (!this.race || this.race.state === 'results') return; this.paused = !this.paused; if (this.paused) { this.menu.show('pause'); this.audio.setEngine(0, 0, false, 0, true); } else this.menu.hide(); }
  showResults() {
    const r = this.race; const res = r.results; let gp = null;
    if (r.battle) { this.menu.show('results', { battle: true, results: res, trackName: r.trackDef.name }); this.resultsShown = true; this.hud.hide(); return; }
    if (this.gp) { for (const e of res) this.gp.totals[e.ch.id] += e.points; gp = { totals: this.gp.totals, last: this.gp.idx >= CUP.tracks.length - 1, name: this.gp.name, playerId: this.gp.playerId }; }
    const best = r.player.lapTimes.length ? Math.min(...r.player.lapTimes) : 0;
    this.menu.show('results', { results: res, trackName: r.trackDef.name, gp, bestLap: best });
    this.resultsShown = true; this.hud.hide();
  }

  // ---- loop ----
  frame(t) {
    requestAnimationFrame((tt) => this.frame(tt));
    let dt = Math.min(0.1, (t - this.last) / 1000); this.last = t; this.time += dt;
    const inp = this.input.poll();
    if (this.menu.screen) this.menu.handleInput(inp);
    else if (inp.pause && this.race) this.togglePause();
    if (this.race && !this.paused && !this.debugManual) {
      this.acc += dt; let steps = 0;
      while (this.acc >= FIXED_DT && steps < 5) { this.race.step(FIXED_DT, inp); this.acc -= FIXED_DT; steps++; inp.hopPressed = false; inp.itemPressed = false; inp.confirm = false; }
      if (steps === 5) this.acc = 0;
    }
    this.input.endFrame();
    if (this.race) {
      this.race.render(this.paused ? 0 : dt, this.renderer, this.paused ? 1 : this.acc / FIXED_DT);
      if (!this.paused) this.hud.update(this.race, dt);
      const p = this.race.player; const rpm = Math.min(1.3, Math.abs(p.speed) / p.baseTop);
      this.audio.setEngine(rpm * (p.airborne ? 1.15 : 1), p.boostTimer > 0 ? 1 : 0, p.drift.active, p.drift.tier, this.paused || this.race.state === 'results');
      if (this.race.state === 'results' && !this.resultsShown) this.showResults();
      if (this.race.state === 'racing' && this.race.player.lap === this.race.laps && !this.finalLapMusic) { this.audio.setMusicRate(true); this.finalLapMusic = true; }
      if (this.race.state !== 'racing') this.finalLapMusic = false;
      if (this.dbg) this.dbg.textContent = `state ${this.race.state} pos ${p.position} lap ${p.lap} s ${(p.smp.s || 0).toFixed(1)} lat ${(p.smp.lat || 0).toFixed(2)} surf ${p.surface}\nspeed ${p.speed.toFixed(2)}/${p.topSpeed.toFixed(1)} yaw ${p.yaw.toFixed(2)} vyaw ${p.velYaw.toFixed(2)} air ${p.airborne} y ${p.pos.y.toFixed(2)}\ndrift ${p.drift.active} dir ${p.drift.dir} charge ${p.drift.charge.toFixed(0)} tier ${p.drift.tier} boost ${p.boostTimer.toFixed(2)}x${p.boostMult}\nitem ${p.item} x${p.itemCount} roul ${p.roulette.toFixed(2)} coins ${p.coins} stun ${p.stun ? p.stun.type : '-'} trail ${p.trailing}\nobjs ${this.race.items.objects.length} fps ${(1 / Math.max(dt, 1e-3)).toFixed(0)}`;
    } else { this.updateShowroom(dt); if (this.dbg) this.dbg.textContent = ''; }
  }
  /** Debug harness: run n fixed steps with a given key state (override), then render. */
  debugStep(n, keys) {
    if (!this.race) return 'no race';
    this.debugManual = true;
    const base = { steer: 0, throttle: 0, brake: 0, hop: false, hopPressed: false, itemHeld: false, itemPressed: false, rear: false, pause: false, confirm: false, back: false, up: false, down: false, left: false, right: false };
    const fn = typeof keys === 'function' ? keys : null;
    let inp = { ...base, ...(fn ? {} : keys) };
    for (let i = 0; i < n; i++) { if (fn) inp = { ...base, ...fn(i, this.race.player, this.race) }; this.race.step(FIXED_DT, inp); inp.hopPressed = false; inp.itemPressed = false; inp.confirm = false; }
    this.race.render(FIXED_DT * n, this.renderer); this.hud.update(this.race, FIXED_DT * n);
    if (this.race.state === 'results' && !this.resultsShown) this.showResults();
    const p = this.race.player;
    return { state: this.race.state, pos: p.position, lap: p.lap, s: +(p.smp.s || 0).toFixed(1), lat: +(p.smp.lat || 0).toFixed(2), speed: +p.speed.toFixed(2), top: +p.topSpeed.toFixed(1), surface: p.surface, drift: { ...p.drift }, boost: +p.boostTimer.toFixed(2), item: p.item, count: p.itemCount, coins: p.coins, stun: p.stun && p.stun.type, air: p.airborne, y: +p.pos.y.toFixed(2), objs: this.race.items.objects.length, standings: this.race.sorted.map((k) => k.ch.name + ':' + k.progress.toFixed(0)) };
  }
  debugAuto(on) { this.debugManual = !on; }
}
window.addEventListener('DOMContentLoaded', () => { window.__app = new App(); });
