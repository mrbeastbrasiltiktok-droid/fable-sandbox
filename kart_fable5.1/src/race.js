import * as THREE from 'three';
import { Track } from './track.js';
import { Kart } from './kart.js';
import { CHARACTERS } from './characters.js';
import { ItemManager } from './items.js';
import { AIDriver, BattleAI } from './ai.js';
import { Arena } from './arena.js';
import { Effects } from './effects.js';
import { ChaseCamera } from './camera.js';
import { RNG, clamp, wrapAngle } from './utils.js';
import { RACER_COUNT, CC_CLASSES, BOOSTS, DRIFT_TIERS, POINTS_TABLE } from './config.js';

export class Race {
  constructor(app, { trackDef, arenaDef = null, playerChar, cc = 150, laps = 3, seed = 1, difficulty = 1 }) {
    this.battle = !!arenaDef; if (this.battle) trackDef = arenaDef;
    this.app = app; this.trackDef = trackDef; this.cc = cc; this.laps = laps; this.difficulty = difficulty;
    this.scene = new THREE.Scene();
    this.rng = new RNG(seed);
    this.track = this.battle ? new Arena(arenaDef) : new Track(trackDef); this.scene.add(this.track.group);
    this.battleTime = 150; this.battleTimer = this.battleTime;
    const sk = trackDef.sky;
    this.scene.fog = new THREE.Fog(sk.fog, 60, sk.fogFar);
    this.scene.background = new THREE.Color(sk.fog);
    this.sun = new THREE.DirectionalLight(sk.sun, sk.sunInt); this.sun.position.set(sk.sunDir[0] * 80, sk.sunDir[1] * 80, sk.sunDir[2] * 80);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048); const sc = this.sun.shadow.camera; sc.near = 10; sc.far = 260; sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; this.sun.shadow.bias = -0.0015; this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun); this.scene.add(this.sun.target);
    this.scene.add(new THREE.HemisphereLight(sk.ambient, 0x404040, sk.ambInt));
    this.fx = new Effects(this.scene);
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 1200);
    this.chase = new ChaseCamera(this.camera);

    // karts
    const ccMult = CC_CLASSES[cc] || 1;
    this.karts = [];
    const others = CHARACTERS.filter((c) => c !== playerChar);
    const order = [];
    for (let i = 0; i < RACER_COUNT - 1; i++) order.push(others[i % others.length]);
    // shuffle grid
    const gridSlots = this.track.grid.slice(0, RACER_COUNT);
    const slotIdx = [...Array(RACER_COUNT).keys()];
    for (let i = slotIdx.length - 1; i > 0; i--) { const j = this.rng.int(0, i); [slotIdx[i], slotIdx[j]] = [slotIdx[j], slotIdx[i]]; }
    const player = new Kart(playerChar, this.track, { isPlayer: true, index: 0, ccMult });
    this.player = player; this.karts.push(player);
    order.forEach((ch, i) => this.karts.push(new Kart(ch, this.track, { index: i + 1, ccMult })));
    this.karts.forEach((k, i) => { k.placeOnGrid(gridSlots[slotIdx[i]]); this.scene.add(k.group); k.paintMats = []; k.group.traverse((m) => { if (m.isMesh && m.material && !m.material.map && m.material.emissive) { k.paintMats.push({ mat: m.material, em: m.material.emissive.getHex(), ei: m.material.emissiveIntensity }); } }); });
    this.ais = new Map();
    this.karts.slice(1).forEach((k, i) => this.ais.set(k, this.battle ? new BattleAI(k, this.track, new RNG(seed * 7 + i * 13), difficulty) : new AIDriver(k, this.track, new RNG(seed * 7 + i * 13), difficulty)));
    if (this.battle) this.buildBalloons();
    this.items = new ItemManager(this.scene, this.track, this.karts, this.fx, app.audio);
    this.inputs = new Map();
    this.state = 'intro'; this.stateT = 0; this.time = 0; this.raceTime = 0; this.countdown = 2.999;
    this.introDur = 2.6;
    this.finishedAll = false; this.results = null; this.playerInput = { steer: 0, throttle: 0, brake: 0, hop: false, hopPressed: false, itemHeld: false, itemPressed: false, itemDir: 0 };
    this.rearView = false;
    this.slipAcc = new Map();
    this.chase.snap(player);
    this.updatePositions();
    this.msg = null; this.msgT = 0;
  }

  dispose() { this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => { m.dispose(); }); } }); }

  nearestOpponent(k) { let best = null, bd = 1e9; for (const o of this.karts) { if (o === k || o.eliminated) continue; const d = o.pos.distanceToSquared(k.pos); if (d < bd) { bd = d; best = o; } } return best; }

  buildBalloons() {
    for (const k of this.karts) {
      const g = new THREE.Group(); g.position.set(0, 1.5, 0.4); k.group.add(g); k.balloonGroup = g; k.balloonMeshes = [];
      const mat = new THREE.MeshStandardMaterial({ color: k.ch.color, roughness: 0.3, metalness: 0.1, emissive: k.ch.color, emissiveIntensity: 0.25 });
      for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 12), mat); b.scale.y = 1.2; b.position.set((i - 1) * 0.55, 0.9 + (i === 1 ? 0.25 : 0), 0); const str = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.9), new THREE.MeshStandardMaterial({ color: 0xffffff })); str.position.set((i - 1) * 0.55, 0.4 + (i === 1 ? 0.12 : 0), 0); str.rotation.z = (i - 1) * -0.25; g.add(b); g.add(str); k.balloonMeshes.push([b, str]); }
    }
  }

  popBalloon(k, source) {
    if (k.balloons <= 0) return;
    k.balloons--; const pair = k.balloonMeshes[k.balloons]; if (pair) { pair[0].visible = false; pair[1].visible = false; const wp = pair[0].getWorldPosition(new THREE.Vector3()); this.fx.burst(wp, 24, k.ch.color, 6, 0.5, 0.8, 4); }
    if (source && source !== k && source.ch) source.score++;
    if (k.isPlayer) this.app.audio.play('pop'); else this.app.audio.play('popFar');
    if (k.balloons === 0) { k.eliminated = true; k.elimTime = this.raceTime; k.finished = true; k.finishTime = this.raceTime; k.speed = 0; this.items.stopTrail(k); this.fx.burst(k.pos.clone().setY(k.pos.y + 1), 40, 0xffffff, 8, 0.8, 1.2, 5); this.app.audio.play('crash'); if (k.isPlayer) this.showMessage('ELIMINATED', 3); else this.showMessage(`${k.ch.name} is out!`, 1.5); k.group.visible = false; }
  }

  updatePositions() {
    if (this.battle) {
      const sorted = [...this.karts].sort((a, b) => { if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1; if (a.eliminated) return b.elimTime - a.elimTime; if (b.balloons !== a.balloons) return b.balloons - a.balloons; return b.score - a.score; });
      sorted.forEach((k, i) => (k.position = i + 1)); this.sorted = sorted; return;
    }
    const sorted = [...this.karts].sort((a, b) => { if (a.finished && b.finished) return a.finishTime - b.finishTime; if (a.finished) return -1; if (b.finished) return 1; return b.progress - a.progress; });
    sorted.forEach((k, i) => (k.position = i + 1));
    this.sorted = sorted;
  }

  showMessage(text, t = 1.5) { this.msg = text; this.msgT = t; }

  /** Fixed-step simulation */
  step(dt, rawInput) {
    this.time += dt;
    const inp = rawInput;
    if (inp.rear !== undefined) this.rearView = inp.rear;
    // state machine
    if (this.state === 'intro') { this.stateT += dt; if (this.stateT >= this.introDur || inp.confirm) { this.state = 'countdown'; this.stateT = 0; this.app.audio.play('countdown'); this.lastBeep = 3; } }
    else if (this.state === 'countdown') {
      this.countdown -= dt; const n = Math.ceil(this.countdown);
      if (n !== this.lastBeep && n > 0) { this.lastBeep = n; this.app.audio.play('countdown'); }
      if (this.countdown <= 0) { this.state = 'racing'; this.app.audio.play('go'); this.app.audio.startMusic(this.trackDef.theme); this.karts.forEach((k) => (k.raceTime = 0)); }
    }
    const racing = this.state === 'racing' || this.state === 'finished';
    // build inputs
    const zero = { steer: 0, throttle: 0, brake: 0, hop: false, hopPressed: false, itemHeld: false, itemPressed: false, itemDir: 0 };
    for (const k of this.karts) {
      let ki;
      if (k.isPlayer) {
        ki = racing ? { steer: inp.steer, throttle: inp.throttle, brake: inp.brake, hop: inp.hop, hopPressed: inp.hopPressed, itemHeld: inp.itemHeld, itemPressed: inp.itemPressed, itemDir: inp.brake ? -1 : 0, itemBack: !!inp.itemBack } : { ...zero, hop: inp.hop };
        // rocket start: hold throttle in the last ~0.8s of countdown
        if (this.state === 'countdown') { if (inp.throttle) k.startHold = (k.startHold || 0) + dt; else k.startHold = 0; }
      } else {
        const ai = this.ais.get(k);
        ki = racing ? ai.update(dt, this.karts, this.items, this.player) : zero;
      }
      this.inputs.set(k, ki);
    }
    if (this.state === 'racing' && this.countdown > -0.05 && this.countdown <= 0) {
      // start boosts
      if (this.player.startHold > 0.15 && this.player.startHold < 1.1) { this.player.applyBoost('mushroom', 1.35, 0.9 + this.player.startHold * 0.6); this.showMessage('Rocket Start!'); this.app.audio.play('mushroom'); }
      else if (this.player.startHold >= 1.1) { this.player.speed = 0; this.player.stun = { type: 'spin', timer: 0.9, total: 0.9 }; this.showMessage('Burnout!'); }
      for (const k of this.karts) if (!k.isPlayer && this.rng.chance(0.5)) k.applyBoost('mushroom', 1.25, 0.8);
      this.countdown = -1;
    }
    // simulate
    for (const k of this.karts) {
      if (this.state === 'intro') continue;
      k.update(this.inputs.get(k), dt, this);
    }
    if (racing) {
      this.collideKarts(dt);
      if (!this.battle) this.slipstream(dt);
      this.items.update(dt, this.inputs);
      this.raceTime += dt;
      if (this.battle && this.state === 'racing') { this.battleTimer -= dt; const alive = this.karts.filter((k) => !k.eliminated); if (this.battleTimer <= 0 || alive.length <= 1 || this.player.eliminated) { this.state = 'finished'; this.stateT = 0; this.app.audio.play('finish'); this.app.audio.stopMusic(); if (!this.player.eliminated) this.showMessage(this.player.position === 1 ? 'YOU WIN!' : 'TIME UP!', 3); } }
    }
    this.updatePositions();
    this.processEvents();
    this.track.update(dt, this.time);
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) this.msg = null; }
    // finish detection
    if (this.state === 'racing' && this.player.finished) { this.state = 'finished'; this.stateT = 0; this.app.audio.play('finish'); this.app.audio.stopMusic(); }
    if (this.state === 'finished') {
      this.stateT += dt;
      const allDone = this.karts.every((k) => k.finished);
      if ((this.battle ? this.stateT > 3 : (allDone || this.stateT > 8)) && !this.results) this.finalize();
    }
  }

  finalize() {
    if (this.battle) { this.updatePositions(); this.results = this.sorted.map((k, i) => ({ kart: k, ch: k.ch, pos: i + 1, balloons: k.balloons, score: k.score, points: POINTS_TABLE[i] || 0, time: 0, lapTimes: [] })); this.state = 'results'; return; }
    // project remaining karts by progress
    const now = this.raceTime;
    for (const k of this.karts) if (!k.finished) { k.finished = true; k.finishTime = now + (this.laps * this.track.length - k.progress) / Math.max(8, k.baseTop * 0.8); }
    this.updatePositions();
    this.results = this.sorted.map((k, i) => ({ kart: k, ch: k.ch, pos: i + 1, time: k.finishTime, points: POINTS_TABLE[i] || 0, lapTimes: k.lapTimes.slice() }));
    this.state = 'results';
  }

  collideKarts(dt) {
    const ks = this.karts; const n = new THREE.Vector2();
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
      const a = ks[i], b = ks[j];
      if (a.eliminated || b.eliminated) continue;
      if (a.falling || b.falling || (a.stun && a.stun.type === 'respawn') || (b.stun && b.stun.type === 'respawn')) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z; const d = Math.hypot(dx, dz);
      const minD = (a.radius + b.radius) * (a.shrunk ? 0.7 : 1) * (b.shrunk ? 0.7 : 1);
      if (d >= minD || d < 1e-4 || Math.abs(a.pos.y - b.pos.y) > 1.6) continue;
      n.set(dx / d, dz / d);
      const ma = a.mass * (a.invincible ? 4 : 1), mb = b.mass * (b.invincible ? 4 : 1);
      const overlap = minD - d;
      a.pos.x -= n.x * overlap * (mb / (ma + mb)); a.pos.z -= n.y * overlap * (mb / (ma + mb));
      b.pos.x += n.x * overlap * (ma / (ma + mb)); b.pos.z += n.y * overlap * (ma / (ma + mb));
      const vax = Math.sin(a.velYaw) * a.speed, vaz = Math.cos(a.velYaw) * a.speed, vbx = Math.sin(b.velYaw) * b.speed, vbz = Math.cos(b.velYaw) * b.speed;
      const vrel = (vbx - vax) * n.x + (vbz - vaz) * n.y;
      if (vrel < 0) {
        const e = 0.55; const jimp = (-(1 + e) * vrel) / (1 / ma + 1 / mb);
        a.bumpVel.x -= (jimp / ma) * n.x; a.bumpVel.y -= (jimp / ma) * n.y;
        b.bumpVel.x += (jimp / mb) * n.x; b.bumpVel.y += (jimp / mb) * n.y;
        const sev = clamp(-vrel / 15, 0, 1);
        // the lighter kart loses more speed
        a.speed *= 1 - 0.12 * sev * (mb / (ma + mb)) * 2; b.speed *= 1 - 0.12 * sev * (ma / (ma + mb)) * 2;
        if (sev > 0.2) { a.emit('bump', { sev }); this.fx.burst(new THREE.Vector3(a.pos.x + dx / 2, a.pos.y + 0.6, a.pos.z + dz / 2), 8, 0xffffff, 3, 0.3, 0.5); }
      }
      // invincible knockouts
      if (a.invincible && !b.invincible) { if (b.hit('flip', a)) { b.bumpVel.x += n.x * 9; b.bumpVel.y += n.y * 9; this.app.audio.play('crash'); } }
      else if (b.invincible && !a.invincible) { if (a.hit('flip', b)) { a.bumpVel.x -= n.x * 9; a.bumpVel.y -= n.y * 9; this.app.audio.play('crash'); } }
    }
  }

  slipstream(dt) {
    for (const a of this.karts) {
      if (a.speed < a.topSpeed * 0.75 || a.boostTimer > 0) { this.slipAcc.set(a, 0); continue; }
      let inDraft = false;
      for (const b of this.karts) { if (a === b) continue; const dp = b.progress - a.progress; if (dp > 2 && dp < 13 && Math.abs(b.smp.lat - a.smp.lat) < 2.4 && b.speed > 10) { inDraft = true; break; } }
      let acc = this.slipAcc.get(a) || 0;
      if (inDraft) { acc += dt; if (acc > 1.4) { a.applyBoost('slipstream', BOOSTS.slipstream.mult, BOOSTS.slipstream.duration); a.emit('slipstream'); acc = 0; } }
      else acc = Math.max(0, acc - dt * 2);
      this.slipAcc.set(a, acc);
    }
  }

  processEvents() {
    const au = this.app.audio;
    for (const k of this.karts) {
      for (const ev of k.events) {
        const near = k.isPlayer || k.pos.distanceTo(this.player.pos) < 40;
        switch (ev.type) {
          case 'miniturbo': { k.stats.mt++; const t = DRIFT_TIERS[ev.data.tier - 1]; this.fx.burst(k.pos.clone().setY(k.pos.y + 0.3), 14 + ev.data.tier * 8, t.color, 5 + ev.data.tier * 2, 0.5, 0.9, 3); if (near) au.play('boost' + ev.data.tier); break; }
          case 'boost': if (k.isPlayer && (ev.data.type === 'pad' || ev.data.type === 'trick' || ev.data.type === 'slipstream')) au.play('pad'); if (k.isPlayer) this.chase.shake = Math.max(this.chase.shake, 0.4); break;
          case 'hit': k.stats.hits++; if (this.battle) this.popBalloon(k, ev.data.source); if (k.isPlayer) { this.chase.shake = 1.0; au.play(ev.data.kind === 'flip' ? 'crash' : 'spin'); } else if (near) au.play('spinFar'); if (ev.data.lost > 0) this.fx.burst(k.pos.clone().setY(k.pos.y + 0.8), ev.data.lost * 3, 0xffd040, 5, 0.6, 0.7, 8); break;
          case 'wall': if (k.isPlayer) { au.play('wall'); this.chase.shake = Math.max(this.chase.shake, ev.data.severity * 0.6); } break;
          case 'hop': if (k.isPlayer) au.play('hop'); break;
          case 'driftTier': if (k.isPlayer && ev.data.tier > 0) au.play('tier' + ev.data.tier); break;
          case 'lap': if (k.isPlayer && ev.data.lap > 1 && ev.data.lap <= this.laps) { au.play('lap'); this.showMessage(ev.data.lap === this.laps ? 'FINAL LAP!' : `LAP ${ev.data.lap}`); } break;
          case 'finish': if (k.isPlayer) this.showMessage('FINISH!', 3); break;
          case 'itemGot': if (k.isPlayer) au.play('itemGot'); break;
          case 'rouletteStart': if (k.isPlayer) au.play('roulette'); break;
          case 'coin': if (k.isPlayer) au.play('coin'); break;
          case 'trickLand': k.stats.tricks++; if (k.isPlayer) { au.play('pad'); this.showMessage('Nice trick!', 1); } this.fx.burst(k.pos, 20, 0xffffff, 6, 0.5, 0.8, 4); break;
          case 'trick': if (k.isPlayer) au.play('trick'); break;
          case 'fall': if (k.isPlayer) au.play('fall'); break;
          case 'respawn': this.fx.burst(k.pos, 20, 0xa0e0ff, 4, 0.6, 0.9, 2); break;
          case 'star': break;
          case 'lightning': this.fx.burst(k.pos, 0, 0xffffff, 0); if (this.player !== k) { this.chase.shake = 0.6; } break;
          case 'inked': if (k.isPlayer) { au.play('inked'); this.app.hud.ink(); } break;
          case 'slipstream': break;
          case 'bump': if (k.isPlayer) au.play('bump'); break;
        }
      }
      k.events.length = 0;
    }
  }

  /** Theme ambience: snow, embers, pollen, sparkles around the camera. */
  ambient(dt) {
    const th = this.trackDef.theme, c = this.camera.position; const n = Math.min(6, Math.round(dt * 60 * 2));
    for (let i = 0; i < n; i++) {
      const x = c.x + (Math.random() - 0.5) * 60, z = c.z + (Math.random() - 0.5) * 60;
      if (th === 'snow') this.fx.spawn(x, c.y + 12 + Math.random() * 10, z, (Math.random() - 0.5) * 2, -3 - Math.random() * 2, (Math.random() - 0.5) * 2, 4, 0xffffff, 0.7, 0);
      else if (th === 'lava') { if (Math.random() < 0.5) this.fx.spawn(x, c.y - 4 + Math.random() * 6, z, (Math.random() - 0.5) * 1.5, 2 + Math.random() * 3, (Math.random() - 0.5) * 1.5, 3, 0xff7020, 0.6, -0.5); }
      else if (th === 'space') { if (Math.random() < 0.4) this.fx.spawn(x, c.y + (Math.random() - 0.5) * 30, z, 0, 0, 0, 2.5, 0x9ad0ff, 0.5, 0); }
      else if (th === 'meadow') { if (Math.random() < 0.25) this.fx.spawn(x, c.y - 1 + Math.random() * 5, z, (Math.random() - 0.5) * 2, Math.random() * 0.8, (Math.random() - 0.5) * 2, 3, 0xfff0a0, 0.45, -0.1); }
      else if (th === 'desert') { if (Math.random() < 0.3) this.fx.spawn(x, c.y - 2 + Math.random() * 3, z, 3 + Math.random() * 3, 0.3, (Math.random() - 0.5), 2.5, 0xe0c090, 0.9, 0); }
      else if (th === 'neon') { if (Math.random() < 0.3) this.fx.spawn(x, c.y + 14, z, 0, -14, 0, 1.2, 0x80c0ff, 0.35, 0); }
    }
  }

  /** Per-frame visuals (not simulation). alpha = fraction of the next fixed step elapsed. */
  render(dt, renderer, alpha = 1) {
    const p = this.player;
    for (const k of this.karts) k.interpolate(clamp(alpha, 0, 1));
    const camK = Object.create(p); camK.pos = p.group.position; // camera follows the interpolated position
    if (this.state === 'intro') {
      const t = this.stateT / this.introDur; const s = p.smp.s || 0;
      const a = this.track.posAt(s - 30 + t * 12, -14, 9 - t * 4); this.camera.position.lerp(a, 1 - Math.exp(-6 * dt)); if (dt > 0.5) this.camera.position.copy(a);
      this.camera.lookAt(p.pos.x, p.pos.y + 1, p.pos.z); this.camera.fov = 50; this.camera.updateProjectionMatrix();
    } else this.chase.update(camK, dt, this.rearView);
    // shadow follows player
    this.sun.target.position.copy(p.pos); this.sun.position.copy(p.pos).add(new THREE.Vector3(this.trackDef.sky.sunDir[0] * 90, this.trackDef.sky.sunDir[1] * 90, this.trackDef.sky.sunDir[2] * 90));
    this.track.sky.position.copy(this.camera.position);
    // per-kart visual fx
    for (const k of this.karts) {
      if (!k.isPlayer && k.bulletTimer <= 0 && !k.eliminated) k.group.visible = k.pos.distanceTo(this.camera.position) > 3.2; // don't let a kart sit in the camera
      const d = k.drift; const fwd = new THREE.Vector3(Math.sin(k.yaw), 0, Math.cos(k.yaw)); const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
      if (d.active && (d.charge > 135 || d.tier > 0) && !k.airborne) {
        const t = d.tier > 0 ? DRIFT_TIERS[d.tier - 1] : null; const col = t ? t.color : 0x8fd8ff; const count = t ? 2 + d.tier : 1;
        for (let i = 0; i < count; i++) { const side = i % 2 ? 1 : -1; const wp = k.pos.clone().addScaledVector(fwd, -0.8).addScaledVector(right, side * 0.8); this.fx.spawn(wp.x, wp.y + 0.2, wp.z, (Math.random() - 0.5) * 3 - fwd.x * 4, Math.random() * 3 + 1, (Math.random() - 0.5) * 3 - fwd.z * 4, 0.35, col, 0.55 + d.tier * 0.15, 8); }
      }
      if (k.boostTimer > 0 && Math.random() < 0.8) { for (const s of [-1, 1]) { const wp = k.pos.clone().addScaledVector(fwd, -1.4).addScaledVector(right, s * 0.35); this.fx.spawn(wp.x, wp.y + 0.6, wp.z, -fwd.x * 6 + (Math.random() - 0.5), 0.5, -fwd.z * 6 + (Math.random() - 0.5), 0.25, k.boostType === 'star' ? 0xffe060 : 0xff9030, 1.1, 0); } }
      if (k.surface === 'offroad' && k.speed > 6 && !k.airborne && Math.random() < 0.7) { const wp = k.pos.clone().addScaledVector(fwd, -0.9); const dustCol = this.trackDef.theme === 'snow' ? 0xffffff : this.trackDef.theme === 'desert' ? 0xd8b070 : 0x8a7050; this.fx.spawn(wp.x, wp.y + 0.2, wp.z, (Math.random() - 0.5) * 2, 1.2, (Math.random() - 0.5) * 2, 0.6, dustCol, 1.6, 0.5); }
      if (k.starTimer > 0) { const h = (this.time * 3) % 1; const c = new THREE.Color().setHSL(h, 1, 0.55); for (const pm of k.paintMats) { pm.mat.emissive.copy(c); pm.mat.emissiveIntensity = 0.9; } if (Math.random() < 0.6) this.fx.spawn(k.pos.x + (Math.random() - 0.5) * 2, k.pos.y + Math.random() * 1.5, k.pos.z + (Math.random() - 0.5) * 2, 0, 1.5, 0, 0.5, c.getHex(), 0.8); }
      else if (k.starWasOn) { for (const pm of k.paintMats) { pm.mat.emissive.setHex(pm.em); pm.mat.emissiveIntensity = pm.ei; } }
      k.starWasOn = k.starTimer > 0;
      if (k.shrunk && Math.random() < 0.2) this.fx.spawn(k.pos.x, k.pos.y + 1, k.pos.z, 0, 1, 0, 0.3, 0xfff27a, 0.5);
      if (k.falling) k.group.rotation.x += dt * 3;
      if (k.balloonGroup) { k.balloonGroup.rotation.z = Math.sin(this.time * 2 + k.index) * 0.08; k.balloonGroup.position.y = 1.5 + Math.sin(this.time * 3 + k.index) * 0.05; }
    }
    this.ambient(dt);
    this.fx.update(dt);
    renderer.render(this.scene, this.camera);
  }
}
