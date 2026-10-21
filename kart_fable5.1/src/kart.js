import * as THREE from 'three';
import { buildKart } from './characters.js';
import { clamp, lerp, damp, wrapAngle, sign } from './utils.js';
import { DRIFT_CHARGE_TIGHT, DRIFT_CHARGE_LOOSE, DRIFT_TIGHT_INPUT, DRIFT_TIERS, DRIFT_MIN_SPEED, BOOSTS, OFFROAD_SPEED, ICE_TRACTION, MAX_COINS, COIN_SPEED_BONUS } from './config.js';

const GRAVITY = 24;
const KART_RADIUS = 1.25;

export class Kart {
  constructor(ch, track, { isPlayer = false, index = 0, ccMult = 1 } = {}) {
    this.ch = ch; this.track = track; this.isPlayer = isPlayer; this.index = index; this.ccMult = ccMult;
    const st = ch.stats;
    this.baseTop = 27.5 * (1 + 0.05 * (st.speed - 3.5));
    this.accelK = 1.0 + 0.38 * (st.accel - 2);
    this.accLimit = 6.5 + 3.2 * (st.accel - 2);
    this.steerRate = 1.15 + 0.22 * (st.handling - 3);
    this.tractionRate = 7 + 1.6 * (st.traction - 3);
    this.mass = 1 + 0.45 * (st.weight - 1);
    this.mtFactor = 0.8 + 0.09 * st.mt;

    this.pos = new THREE.Vector3(); this.yaw = 0; this.velYaw = 0; this.speed = 0; this.vy = 0; this.airborne = false; this.airTime = 0;
    this.groundY = 0; this.smp = {}; this.hint = -1; this.surface = 'road';
    this.drift = { active: false, dir: 0, charge: 0, tier: 0, pendingDir: 0, hopHeld: false };
    this.hopCooldown = 0; this.hopY = 0;
    this.boostTimer = 0; this.boostMult = 1; this.boostType = null;
    this.stun = null; this.hitInvuln = 0; this.spinAngle = 0; this.flipAngle = 0;
    this.starTimer = 0; this.bulletTimer = 0; this.shrinkTimer = 0; this.inkTimer = 0; this.goldenTimer = 0;
    this.trick = false; this.trickable = false; this.trickSpin = 0; this.trickAxis = 1;
    this.item = null; this.itemCount = 0; this.roulette = 0; this.rouletteItem = null; this.trailing = false; this.trailObjs = [];
    this.coins = 0; this.lap = 0; this.progress = 0; this.cp1 = false; this.cp2 = false; this.lastS = 0; this.position = 1;
    this.finished = false; this.finishTime = 0; this.lapTimes = []; this.lapStart = 0; this.raceTime = 0;
    this.wrongWayT = 0; this.wrongWay = false; this.falling = false; this.fallTimer = 0; this.lastGoodS = 0; this.lastGoodLat = 0;
    this.slipT = 0; this.bumpT = 0; this.bumpVel = new THREE.Vector2(); this.wallHit = 0; this.landed = 0;
    this.events = []; // transient events for audio/fx: {type, data}
    this.topSpeed = this.baseTop;
    this.lightningScaleT = 1;
    this.model = buildKart(ch); this.group = this.model.group;
    this.group.userData.kart = this;
    this.radius = KART_RADIUS * (0.85 + 0.15 * (this.mass - 1));
    this.aiState = {}; this.aiSpeedMult = 1; this.steerSm = 0; this.visPos = new THREE.Vector3(); this.prevVisPos = new THREE.Vector3(); this.visYaw = 0; this.prevVisYaw = 0; this.visInit = false; this.stats = { mt: 0, hits: 0, items: 0, tricks: 0 }; this.balloons = 3; this.score = 0; this.eliminated = false; this.elimTime = 0; this.world = null;
  }

  placeOnGrid(slot) {
    this.pos.copy(slot.pos); this.yaw = slot.yaw; this.velYaw = slot.yaw; this.speed = 0;
    this.smp = this.track.sample(this.pos, -1, this.smp); this.hint = this.smp.idx; this.lastS = this.smp.s; this.lastGoodS = this.smp.s;
    this.groundY = this.smp.y; this.pos.y = this.groundY; this.lap = 0; this.progress = this.smp.s - this.track.length; this.cp1 = false; this.cp2 = false;
    this.updateModel(0);
  }

  emit(type, data) { this.events.push({ type, data }); }

  get shrunk() { return this.shrinkTimer > 0; }
  get invincible() { return this.starTimer > 0 || this.bulletTimer > 0; }
  get controllable() { return !this.stun && !this.falling && this.bulletTimer <= 0 && !this.finished; }

  applyBoost(type, mult, duration) {
    if (mult >= this.boostMult || this.boostTimer <= 0.05) { this.boostMult = mult; this.boostType = type; }
    this.boostTimer = Math.max(this.boostTimer, duration);
    this.emit('boost', { type });
  }

  hit(kind, source) {
    // kind: 'spin' | 'flip' | 'shock' | 'squash'
    if (this.invincible || this.hitInvuln > 0 || this.finished) return false;
    if (this.stun && this.stun.type === 'respawn') return false;
    if (this.drift.active) this.endDrift(false);
    this.boostTimer = 0; this.boostMult = 1;
    const dur = kind === 'spin' ? 1.0 : kind === 'flip' ? 1.5 : kind === 'shock' ? 0.7 : 1.2;
    this.stun = { type: kind, timer: dur, total: dur };
    this.hitInvuln = dur + 1.0;
    if (kind === 'spin') this.speed *= 0.35; else if (kind === 'flip') { this.speed *= 0.05; this.vy = 4; this.airborne = true; } else if (kind === 'shock') this.speed *= 0.5; else this.speed *= 0.2;
    this.spinAngle = 0; this.flipAngle = 0;
    const lost = Math.min(this.coins, 3); this.coins -= lost;
    this.emit('hit', { kind, lost, source });
    if (this.trailing) this.emit('dropTrail');
    return true;
  }

  addCoins(n) { const before = this.coins; this.coins = clamp(this.coins + n, 0, MAX_COINS); if (this.coins > before) this.emit('coin'); }

  endDrift(applyBoost) {
    const d = this.drift;
    if (applyBoost && d.tier > 0) { const t = DRIFT_TIERS[d.tier - 1]; this.applyBoost('mt' + d.tier, t.mult, t.duration * this.mtFactor); this.emit('miniturbo', { tier: d.tier }); }
    d.active = false; d.charge = 0; d.tier = 0; d.dir = 0; d.pendingDir = 0;
  }

  update(input, dt, world) {
    const tr = this.track; this.world = world;
    this.raceTime += dt;
    if (this.eliminated) { this.speed = 0; return; }
    // timers
    this.boostTimer = Math.max(0, this.boostTimer - dt); if (this.boostTimer === 0) { this.boostMult = 1; this.boostType = null; }
    this.hitInvuln = Math.max(0, this.hitInvuln - dt); this.hopCooldown = Math.max(0, this.hopCooldown - dt);
    this.starTimer = Math.max(0, this.starTimer - dt); this.bulletTimer = Math.max(0, this.bulletTimer - dt);
    this.shrinkTimer = Math.max(0, this.shrinkTimer - dt); this.inkTimer = Math.max(0, this.inkTimer - dt); this.goldenTimer = Math.max(0, this.goldenTimer - dt);
    this.slipT = Math.max(0, this.slipT - dt); this.wallHit = Math.max(0, this.wallHit - dt); this.landed = Math.max(0, this.landed - dt);
    if (this.stun) { this.stun.timer -= dt; if (this.stun.timer <= 0) this.stun = null; }
    if (this.roulette > 0) { this.roulette -= dt; if (this.roulette <= 0) { this.item = this.rouletteItem; this.itemCount = this.rouletteCount; this.rouletteItem = null; this.emit('itemGot', { id: this.item }); } }

    // effective input
    // Input convention: steer +1 = right. Internal convention: positive yaw rate = counter-clockwise (left), so we negate once here.
    let steerIn = 0, throttle = 0, brake = 0, hop = false, hopPressed = false;
    const canControl = this.controllable;
    if (canControl) { steerIn = clamp(input.steer, -1, 1); throttle = input.throttle; brake = input.brake; hop = input.hop; hopPressed = input.hopPressed; }
    else if (this.bulletTimer > 0 && !this.finished) { throttle = 1; steerIn = this.autoSteer(30); }
    else if (this.finished && !this.stun) { throttle = 1; steerIn = this.autoSteer(22); }
    // analog-style ramp so keyboard steering doesn't snap
    const ramp = Math.abs(steerIn) > Math.abs(this.steerSm) ? 9 : 16;
    this.steerSm += clamp(steerIn - this.steerSm, -ramp * dt, ramp * dt);
    const steerRaw = -steerIn;
    let steer = -this.steerSm;
    if (this.inkTimer > 0 && !this.isPlayer) steer += Math.sin(this.raceTime * 7) * 0.35; // AI wobbles when inked
    if (this.stun && this.stun.type === 'respawn') { this.speed = 0; }

    // track sample & surface
    const smp = tr.sample(this.pos, this.hint, this.smp); this.hint = smp.idx;
    const lat = smp.lat; this.surface = tr.surfaceAt(smp, lat);
    let groundY = tr.heightAt(smp, lat);
    // ramps: raise ground while on ramp
    let onRamp = false;
    for (const r of tr.ramps) { const ds = smp.s - r.s0; if (ds >= 0 && ds <= r.len && Math.abs(lat - r.lat) <= r.hw) { groundY = smp.y + (r.h * ds) / r.len; onRamp = true; this.onRampObj = r; } }
    if (!onRamp && this.onRampObj && !this.airborne) { // just left ramp top -> launch
      const r = this.onRampObj; this.onRampObj = null;
      if (this.speed > 6) { this.vy = 5 + this.speed * 0.16; this.airborne = true; this.trickable = true; this.trick = false; this.airTime = 0; this.emit('launch'); }
    }
    if (!onRamp) this.onRampObj = null;
    // bumps zone: little hops and speed loss
    if (this.surface === 'bumps' && !this.airborne && this.speed > 4) { this.bumpT -= dt; if (this.bumpT <= 0) { this.bumpT = 0.22; this.vy = 1.6; this.airborne = true; this.speed *= 0.965; } }
    this.groundY = groundY;
    const isVoid = this.surface === 'void';

    // ---- hop / drift initiation ----
    const d = this.drift;
    if (hopPressed && !this.airborne && this.hopCooldown <= 0 && !d.active && this.speed > 3) {
      this.vy = 3.6; this.airborne = true; this.hopCooldown = 0.25; d.pendingDir = sign(steerRaw) || sign(steer); d.hopHeld = true; this.airTime = 0; this.emit('hop');
    }
    if (hopPressed && this.airborne && this.trickable && !this.trick) { this.trick = true; this.trickSpin = 0; this.trickAxis = Math.random() < 0.5 ? 0 : 1; this.emit('trick'); }

    // ---- vertical ----
    if (this.airborne) {
      this.airTime += dt;
      this.vy -= GRAVITY * dt; this.pos.y += this.vy * dt;
      const floor = isVoid ? -Infinity : groundY;
      if (this.pos.y <= floor && this.vy <= 0) {
        this.pos.y = floor; this.airborne = false; const hardness = -this.vy; this.vy = 0; this.landed = 0.2;
        if (this.trick) { this.trick = false; this.applyBoost('trick', BOOSTS.trick.mult, BOOSTS.trick.duration); this.emit('trickLand'); }
        this.trickable = false;
        if (hardness > 6) this.emit('land', { hardness });
        // start drift on landing
        if (hop && !d.active && this.speed > DRIFT_MIN_SPEED && canControl) {
          const dir = d.pendingDir || sign(steerRaw) || sign(steer);
          if (dir !== 0) { d.active = true; d.dir = dir; d.charge = 0; d.tier = 0; this.emit('driftStart'); }
        }
        d.pendingDir = 0;
      }
      if (isVoid && !this.falling && this.pos.y < smp.y - 3) this.startFall();
    } else {
      // grounded: follow ground, detect drops (cliff edges)
      if (isVoid) { this.airborne = true; this.vy = 0; }
      else if (groundY < this.pos.y - 0.9) { this.airborne = true; this.vy = 0; this.trickable = this.speed > 10 && !this.onRampObj; }
      else this.pos.y = groundY;
    }

    // ---- drift maintenance ----
    if (d.active) {
      if (!hop || this.speed < DRIFT_MIN_SPEED || !canControl) this.endDrift(hop === false && canControl);
      else {
        const toward = steer * d.dir; // +1 steering into the drift
        const rate = toward >= DRIFT_TIGHT_INPUT ? DRIFT_CHARGE_TIGHT : DRIFT_CHARGE_LOOSE;
        d.charge += rate * dt * (0.82 + 0.06 * this.ch.stats.mt);
        let tier = 0; for (let i = 0; i < DRIFT_TIERS.length; i++) if (d.charge >= DRIFT_TIERS[i].charge) tier = i + 1;
        if (tier !== d.tier) { d.tier = tier; this.emit('driftTier', { tier }); }
      }
    }

    // ---- speed ----
    const shrinkMult = this.shrunk ? 0.72 : 1;
    let top = this.baseTop * this.ccMult * (1 + this.coins * COIN_SPEED_BONUS) * shrinkMult;
    const boosting = this.boostTimer > 0 || this.invincible;
    if (this.surface === 'offroad' && !boosting) top *= OFFROAD_SPEED;
    if (this.surface === 'curb' && !boosting) top *= 0.92;
    if (d.active) top *= 0.985;
    if (this.starTimer > 0) top *= BOOSTS.star.mult;
    if (this.bulletTimer > 0) top *= BOOSTS.bullet.mult;
    if (this.boostTimer > 0) top *= this.boostMult;
    if (this.slipT > 0) top *= 1.08;
    if (!this.isPlayer) top *= this.aiSpeedMult;
    this.topSpeed = top;
    let target = throttle > 0 ? top : 0;
    if (this.speed > 0.5 && brake > 0) target = 0;
    else if (brake > 0 && throttle === 0 && this.speed <= 0.5) target = -top * 0.32;
    if (this.airborne) target = Math.max(target, Math.min(this.speed, top)); // no accel changes in air (except drag)
    if (this.boostTimer > 0 && !this.airborne) this.speed = Math.max(this.speed, top * 0.985);
    if (this.bulletTimer > 0) this.speed = Math.max(this.speed, top);
    if (target > this.speed) {
      const dv = Math.min((target - this.speed) * this.accelK, this.accLimit * (this.surface === 'offroad' ? 0.6 : 1));
      this.speed += dv * dt;
      if (this.speed > target) this.speed = target;
    } else {
      let decel = brake > 0 ? 22 : this.speed > top + 0.5 ? 7.5 : 8;
      if (this.surface === 'offroad' && this.speed > top) decel = 16;
      const dv = Math.max((target - this.speed) * 1.1, -decel);
      this.speed += dv * dt; if (this.speed < target) this.speed = target;
    }
    if (this.stun && this.stun.type !== 'respawn') this.speed = damp(this.speed, 0, this.stun.type === 'spin' ? 1.5 : 6, dt);

    // ---- steering ----
    const spdF = clamp(Math.abs(this.speed) / 7, 0, 1) * (this.speed < 0 ? -1 : 1);
    let yawRate = 0;
    const hf = 0.86 + 0.07 * this.ch.stats.handling;
    if (d.active) {
      // steering into the drift tightens the arc, steering away opens it up (MK8-style inward drift)
      const toward = steer * d.dir; // -1 .. 1
      yawRate = d.dir * (0.25 + 0.9 * (toward + 1)) * hf;
    } else {
      yawRate = steer * this.steerRate * spdF * (this.airborne ? 0.4 : 1) * (this.surface === 'ice' ? 0.85 : 1);
    }
    if (this.inkTimer > 0) yawRate *= 0.85;
    this.yaw += yawRate * dt;
    // velocity direction lags heading (traction)
    let trac = this.tractionRate;
    if (d.active) trac = 3.2 + 0.3 * this.ch.stats.traction;
    if (this.surface === 'ice') trac = ICE_TRACTION;
    else if (this.surface === 'offroad') trac *= 0.6;
    if (this.airborne) trac = 0.6;
    if (this.stun) trac = 1.5;
    this.velYaw += wrapAngle(this.yaw - this.velYaw) * (1 - Math.exp(-trac * dt));
    // move
    const sx = Math.sin(this.velYaw), sz = Math.cos(this.velYaw);
    this.pos.x += sx * this.speed * dt + this.bumpVel.x * dt; this.pos.z += sz * this.speed * dt + this.bumpVel.y * dt; this.bumpVel.multiplyScalar(Math.exp(-5 * dt));

    // ---- walls / edges ----
    if (tr.isArena) { tr.collideKart(this, sx, sz); if (!this.airborne && tr.onPad(this.pos.x, this.pos.z) && (this.boostType !== 'pad' || this.boostTimer < 0.3)) this.applyBoost('pad', BOOSTS.pad.mult, BOOSTS.pad.duration); }
    const s2 = tr.sample(this.pos, this.hint, this.smp); this.hint = s2.idx;
    const lim = s2.edge - this.radius * 0.6;
    if (tr.rails && Math.abs(s2.lat) > lim) {
      const sgn = sign(s2.lat);
      const push = Math.abs(s2.lat) - lim;
      this.pos.x -= s2.rx * push * sgn; this.pos.z -= s2.rz * push * sgn;
      // velocity component into the wall
      const vn = (sx * s2.rx + sz * s2.rz) * sgn * this.speed;
      if (vn > 0.5) {
        const tanYaw = Math.atan2(s2.tx, s2.tz);
        const along = Math.cos(wrapAngle(this.velYaw - tanYaw));
        const severity = clamp(vn / Math.max(this.speed, 1), 0, 1);
        this.speed *= 1 - 0.55 * severity;
        this.velYaw = tanYaw + (along < 0 ? Math.PI : 0) - sgn * 0.08;
        this.yaw += wrapAngle(this.velYaw - this.yaw) * 0.6;
        if (severity > 0.25) { this.wallHit = 0.3; this.emit('wall', { severity }); }
      }
      this.smp = s2;
    }
    if (!tr.rails && !this.falling && Math.abs(s2.lat) > s2.edge + 0.9 && !this.airborne) { this.airborne = true; this.vy = 0; }
    if (this.falling) { this.fallTimer += dt; if (this.fallTimer > 1.1) { this.respawn(); this.updateModel(dt, 0); return; } }
    else if (!isVoid && !this.airborne) { this.lastGoodS = s2.s; this.lastGoodLat = clamp(s2.lat, -s2.width * 0.4, s2.width * 0.4); }

    // ---- boost pads ----
    for (const p of tr.pads) { const ds = s2.s - p.s0; if (ds >= 0 && ds <= p.s1 - p.s0 && Math.abs(s2.lat - p.lat) <= p.hw && !this.airborne) { if (this.boostType !== 'pad' || this.boostTimer < 0.3) this.applyBoost('pad', BOOSTS.pad.mult, BOOSTS.pad.duration); } }

    // ---- lap / progress ----
    if (tr.isArena) { this.progress = 0; this.lastS = 0; this.wrongWay = false; this.updateModel(dt, steer); return; }
    const L = tr.length, s = s2.s;
    if (s > L * 0.3 && s < L * 0.5 && !this.cp1) this.cp1 = true;
    if (s > L * 0.6 && s < L * 0.8 && this.cp1) this.cp2 = true;
    let ds = s - this.lastS; if (ds < -L / 2) ds += L; else if (ds > L / 2) ds -= L; // wrapped progress this frame
    const crossedFwd = s < this.lastS && ds > 0 && ds < 25;
    const crossedBack = s > this.lastS && ds < 0 && ds > -25;
    if (crossedFwd) {
      if (this.cp1 && this.cp2 || this.lap === 0) { this.lap++; this.cp1 = false; this.cp2 = false; if (this.lap > 1) { this.lapTimes.push(this.raceTime - this.lapStart); } this.lapStart = this.raceTime; this.emit('lap', { lap: this.lap }); if (this.lap > world.laps && !this.finished) { this.finished = true; this.finishTime = this.raceTime; this.emit('finish'); } }
    } else if (crossedBack && this.lap > 0) { this.lap--; this.cp1 = true; this.cp2 = true; if (this.lapTimes.length && this.lap >= 1) this.lapStart -= this.lapTimes.pop(); }
    this.lastS = s;
    this.progress = (this.lap - 1) * L + s;
    // wrong way
    const dirDot = sx * s2.tx + sz * s2.tz;
    if (this.speed > 4 && dirDot < -0.2) this.wrongWayT += dt; else this.wrongWayT = Math.max(0, this.wrongWayT - dt * 2);
    this.wrongWay = this.wrongWayT > 0.8;

    // visual state
    this.updateModel(dt, steer);
  }

  /** Apply interpolated visual transform (alpha = fraction of the next fixed step already elapsed). */
  interpolate(alpha) {
    const g = this.group;
    g.position.lerpVectors(this.prevVisPos, this.visPos, alpha);
    g.rotation.y = this.prevVisYaw + wrapAngle(this.visYaw - this.prevVisYaw) * alpha;
    return g.position;
  }

  autoSteer(lookahead) {
    const tr = this.track;
    let p;
    if (tr.isArena) { const t = this.world && this.world.nearestOpponent ? this.world.nearestOpponent(this) : null; p = t ? t.pos : new THREE.Vector3(0, 0, 0); }
    else { const s = (this.smp.s || 0) + lookahead; p = tr.posAt(s, 0, 0); }
    const want = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    return -clamp(wrapAngle(want - this.yaw) * 2.5, -1, 1); // returns input-space steer (+1 = right)
  }

  startFall() { this.falling = true; this.fallTimer = 0; this.speed *= 0.3; this.emit('fall'); if (this.drift.active) this.endDrift(false); }

  respawn() {
    const tr = this.track; const p = tr.posAt(this.lastGoodS, this.lastGoodLat, 0);
    this.pos.copy(p); this.pos.y += 3; this.airborne = true; this.vy = 0; this.falling = false; this.speed = 0;
    const idx = tr.indexAtS(this.lastGoodS); this.yaw = this.velYaw = Math.atan2(tr.tan[idx].x, tr.tan[idx].z);
    this.hint = idx; this.stun = { type: 'respawn', timer: 1.0, total: 1.0 }; this.hitInvuln = 2.0; this.coins = Math.max(0, this.coins - 3);
    this.lastS = this.lastGoodS; this.boostTimer = 0; this.emit('respawn');
  }

  updateModel(dt, steer = 0) {
    const g = this.group, m = this.model;
    g.position.copy(this.pos);
    // record visual state for sub-frame interpolation
    if (!this.visInit || dt === 0) { this.prevVisPos.copy(this.pos); this.prevVisYaw = this.yaw; this.visInit = true; } else { this.prevVisPos.copy(this.visPos); this.prevVisYaw = this.visYaw; }
    this.visPos.copy(this.pos);
    const scale = this.shrunk ? 0.55 : 1;
    this.lightningScaleT = damp(this.lightningScaleT, scale, 10, dt || 0.016);
    g.scale.setScalar(this.lightningScaleT || scale);
    let yaw = this.yaw;
    if (this.stun) {
      if (this.stun.type === 'spin' || this.stun.type === 'shock') { const p = 1 - this.stun.timer / this.stun.total; this.spinAngle = p * Math.PI * (this.stun.type === 'spin' ? 4 : 2); yaw += this.spinAngle; }
      if (this.stun.type === 'flip') { const p = 1 - this.stun.timer / this.stun.total; m.body.rotation.x = p < 0.8 ? -p / 0.8 * Math.PI * 2 : 0; m.body.rotation.z = Math.sin(p * Math.PI) * 0.6; }
      if (this.stun.type === 'respawn') { m.body.rotation.x = 0; m.body.rotation.z = 0; }
    } else if (this.trick) {
      this.trickSpin += (dt || 0) * 7; const a = Math.min(this.trickSpin, Math.PI * 2);
      if (this.trickAxis === 0) m.body.rotation.x = -a; else m.body.rotation.z = a;
    } else {
      // roll into turns / drift, pitch on air
      const drift = this.drift.active ? this.drift.dir : 0;
      const slip = wrapAngle(this.yaw - this.velYaw);
      const targetRoll = -steer * 0.08 - drift * 0.18 + slip * 0.35;
      m.body.rotation.z = damp(m.body.rotation.z, clamp(targetRoll, -0.5, 0.5), 8, dt || 0.016);
      const targetPitch = this.airborne ? clamp(-this.vy * 0.05, -0.35, 0.35) : this.boostTimer > 0 ? -0.06 : 0;
      m.body.rotation.x = damp(m.body.rotation.x, targetPitch, 6, dt || 0.016);
    }
    g.rotation.set(0, yaw, 0);
    this.visYaw = yaw;
    // body squash on landing
    const sq = this.landed > 0 ? 1 - this.landed * 0.6 : 1;
    m.body.scale.set(1 + (1 - sq) * 0.5, sq, 1 + (1 - sq) * 0.5);
    // wheels
    const wr = (this.speed * (dt || 0)) / 0.34;
    m.wheels.forEach((w, i) => { w.mesh.rotation.x += wr; if (i < 2) w.pivot.rotation.y = damp(w.pivot.rotation.y, steer * 0.45 + (this.drift.active ? this.drift.dir * 0.25 : 0), 12, dt || 0.016); });
    // driver lean
    if (m.head) m.head.rotation.z = m.body.rotation.z * -1.2;
  }
}
