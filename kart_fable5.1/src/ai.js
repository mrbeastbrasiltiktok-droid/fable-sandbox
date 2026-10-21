import { clamp, wrapAngle, sign } from './utils.js';
import { ITEMS } from './items.js';

/** Produces an input object for an AI kart each fixed step. */
export class AIDriver {
  constructor(kart, track, rng, difficulty = 1) {
    this.k = kart; this.tr = track; this.rng = rng; this.diff = difficulty;
    this.lane = rng.range(-0.55, 0.55);
    this.laneTimer = rng.range(2, 5);
    this.hopCd = 0; this.itemCd = rng.range(1, 3); this.driftHold = 0; this.skill = clamp(0.6 + difficulty * 0.2 + rng.range(-0.1, 0.1), 0.4, 1.0);
    this.noise = 0; this.noiseT = 0; this.wantTrail = false; this.trailT = 0;
    this.input = { steer: 0, throttle: 1, brake: 0, hop: false, hopPressed: false, itemHeld: false, itemPressed: false, itemDir: 0 };
  }
  update(dt, karts, items, player) {
    const k = this.k, tr = this.tr, inp = this.input;
    inp.hopPressed = false; inp.itemPressed = false; inp.brake = 0; inp.throttle = 1;
    this.hopCd -= dt; this.itemCd -= dt; this.laneTimer -= dt; this.noiseT -= dt;
    if (this.laneTimer <= 0) { this.laneTimer = this.rng.range(3, 7); this.lane = this.rng.range(-0.6, 0.6); }
    if (this.noiseT <= 0) { this.noiseT = this.rng.range(0.3, 0.8); this.noise = this.rng.range(-0.12, 0.12) * (1.1 - this.skill); }
    const smp = k.smp; if (smp.s === undefined) return inp;
    const speed = Math.max(k.speed, 5);
    const look = 8 + speed * 0.55;
    // target point: lane offset within track width, avoid hazards
    let lat = this.lane * smp.width * 0.42;
    // hazard avoidance
    for (const o of items.objects) {
      if (!(o.hazard || o.type === 'bomb') || o.dead) continue;
      const dx = o.pos.x - k.pos.x, dz = o.pos.z - k.pos.z; const d = Math.hypot(dx, dz);
      if (d > look * 1.6) continue;
      const fwd = dx * Math.sin(k.yaw) + dz * Math.cos(k.yaw); if (fwd < 0) continue;
      if (o._aiT !== items.time) { o._aiT = items.time; o._aiSmp = tr.sample(o.pos, o.hint || k.hint, o._aiSmp || {}); }
      const os = o._aiSmp;
      if (Math.abs(os.lat - lat) < 2.4) lat = os.lat + (os.lat > lat ? -3 : 3) * 1;
    }
    lat = clamp(lat, -smp.width * 0.46, smp.width * 0.46);
    const target = tr.posAt(smp.s + look, lat, 0);
    const want = Math.atan2(target.x - k.pos.x, target.z - k.pos.z);
    // while drifting the body points inward of the travel direction, so measure error against velYaw
    let err = wrapAngle(want - (k.drift.active ? k.velYaw : k.yaw));
    // curvature ahead for drift decisions. curvature sign: negative = left turn (internal steer +), positive = right turn.
    const i1 = tr.indexAtS(smp.s + look * 0.7), i2 = tr.indexAtS(smp.s + look * 1.6), i3 = tr.indexAtS(smp.s + look * 2.4);
    const curvAhead = (tr.curvature[i1] + tr.curvature[i2]) * 0.5;
    const curvFar = tr.curvature[i3];
    let steer = clamp(err * 2.6, -1, 1) + this.noise;
    // rubber band: slower when far ahead of the player, faster when far behind
    if (player && player !== k) k.aiSpeedMult = clamp(1 + (player.progress - k.progress) / 1800, 0.94, 1.06);
    const d = k.drift;
    if (d.active) {
      const dir = d.dir; const towardErr = err * dir;
      // desired yaw rate = road curvature rate + error correction; invert the kart's drift yaw-rate curve to find the steer input
      const roadRate = -tr.curvature[tr.indexAtS(smp.s + 4)] * Math.max(k.speed, 8);
      const desired = roadRate + err * 2.2;
      const hf = 0.86 + 0.07 * k.ch.stats.handling;
      const toward = clamp(((desired * dir) / hf - 0.25) / 0.9 - 1, -1, 1);
      steer = dir * toward;
      this.driftHold += dt;
      const tierGoal = this.skill > 0.8 ? 3 : this.skill > 0.6 ? 2 : 1;
      const turnEnding = Math.abs(curvAhead) < 0.006 && Math.abs(err) < 0.12;
      const wrongWay = towardErr < -0.55 && this.driftHold > 0.6;
      let reason = null;
      if (d.tier >= tierGoal && (turnEnding || this.driftHold > 2.2)) reason = 'goal';
      else if (d.tier >= 1 && turnEnding && this.driftHold > 1.2) reason = 'turnEnd';
      else if (this.driftHold > 3.4) reason = 'timeout';
      else if (k.speed < 9) reason = 'slow';
      else if (wrongWay) reason = 'wrongWay';
      this.dbg = { err: +err.toFixed(2), curv: +curvAhead.toFixed(4), toward: +towardErr.toFixed(2), tier: d.tier, hold: +this.driftHold.toFixed(2) };
      if (reason) { inp.hop = false; this.hopCd = 0.5; this.lastReason = reason; }
      else inp.hop = true;
    } else {
      // keep the hop button held briefly after a hop so the drift engages on landing
      this.hopHoldT = (this.hopHoldT || 0) - dt;
      inp.hop = this.hopHoldT > 0;
      const c = Math.abs(curvAhead);
      const wantDrift = c > 0.012 && k.speed > 14 && this.hopCd <= 0 && !k.airborne && k.controllable;
      if (wantDrift && this.rng.chance(0.4 + this.skill * 0.6)) {
        let dir = -sign(curvAhead); if (Math.abs(err) > 0.12) dir = sign(err);
        inp.hopPressed = true; inp.hop = true; this.hopHoldT = 0.7; this.hopCd = 1.4; this.driftHold = 0; steer = dir;
      } else if (wantDrift) this.hopCd = 0.4;
      // trick when airborne
      if (k.airborne && k.trickable && !k.trick && k.airTime > 0.1 && this.rng.chance(0.3)) inp.hopPressed = true;
    }
    inp.steer = -clamp(steer, -1, 1); // internal (+ = left) -> input space (+ = right)
    // brake if way off line at speed
    inp.brake = Math.abs(err) > 0.9 && k.speed > 12 ? 1 : 0;
    // ---- items ----
    inp.itemHeld = false; inp.itemDir = 0;
    if (!k.item) this.releaseNext = false;
    if (k.item && k.roulette <= 0 && k.controllable) {
      const id = k.item, base = ITEMS[id].base || id;
      const ahead = karts.filter((o) => o !== k && !o.finished && o.progress > k.progress).sort((a, b) => a.progress - b.progress)[0];
      const behind = karts.filter((o) => o !== k && !o.finished && o.progress < k.progress).sort((a, b) => b.progress - a.progress)[0];
      const distAhead = ahead ? ahead.progress - k.progress : Infinity;
      const distBehind = behind ? k.progress - behind.progress : Infinity;
      const straight = Math.abs(curvAhead) < 0.006;
      let use = false, dir = 0;
      if (ITEMS[id].trail) {
        const threat = distBehind < 25;
        if (this.releaseNext) { inp.itemHeld = false; inp.itemDir = this.pendingDir; this.releaseNext = false; }
        else {
          if (base === 'banana') { if (this.itemCd <= 0 && (distBehind < 14 || this.rng.chance(0.02 * dt * 60))) { use = true; dir = -1; } }
          else if (base === 'green') { if (this.itemCd <= 0 && ahead && distAhead < 35 && straight && Math.abs(err) < 0.1) { use = true; dir = 1; } else if (this.itemCd <= 0 && distBehind < 10) { use = true; dir = -1; } }
          else if (base === 'red') { if (this.itemCd <= 0 && ahead && distAhead < 90) { use = true; dir = 1; } }
          else if (base === 'bomb') { if (this.itemCd <= 0 && ahead && distAhead < 25) { use = true; dir = 1; } }
          if (use) { this.itemCd = this.rng.range(0.6, 2); inp.itemHeld = true; this.pendingDir = dir; this.releaseNext = true; }
          else if (k.trailing && !threat && this.rng.chance(0.01)) { inp.itemHeld = false; inp.itemDir = -1; }
          else inp.itemHeld = threat || k.trailing;
        }
      } else if (this.itemCd <= 0) {
        if (base === 'mush' || base === 'gold') { if (straight || k.surface === 'offroad' || k.position > 4) use = true; }
        else if (base === 'star' || base === 'bullet' || base === 'lightning' || base === 'blooper') use = this.rng.chance(0.5);
        else if (base === 'blue') use = k.position > 2;
        else if (base === 'fire') use = ahead && distAhead < 40 || distBehind < 15;
        else if (base === 'horn') { const near = karts.some((o) => o !== k && o.pos.distanceTo(k.pos) < 6); const blue = items.objects.some((o) => o.type === 'blue' && items.blueTarget(o) === k && o.pos.distanceTo(k.pos) < 18); use = near || blue || this.rng.chance(0.002); }
        else if (base === 'coin') use = true;
        if (use) { inp.itemPressed = true; inp.itemDir = base === 'fire' && distBehind < 15 && !(ahead && distAhead < 40) ? -1 : 1; this.itemCd = base === 'fire' || base === 'gold' ? 0.35 : this.rng.range(0.8, 2.5); }
      }
    }
    return inp;
  }
}


/** CPU driver for Balloon Battle: hunts the nearest opponent, grabs boxes, dodges walls and obstacles. */
export class BattleAI {
  constructor(kart, arena, rng, difficulty = 1) {
    this.k = kart; this.ar = arena; this.rng = rng; this.skill = clamp(0.55 + difficulty * 0.25 + rng.range(-0.1, 0.1), 0.4, 1.0);
    this.target = null; this.retarget = 0; this.itemCd = rng.range(1, 2); this.hopCd = 0; this.wanderT = 0; this.wander = 0; this.releaseNext = false; this.pendingDir = -1;
    this.input = { steer: 0, throttle: 1, brake: 0, hop: false, hopPressed: false, itemHeld: false, itemPressed: false, itemDir: 0 };
  }
  update(dt, karts, items) {
    const k = this.k, ar = this.ar, inp = this.input;
    inp.hopPressed = false; inp.itemPressed = false; inp.brake = 0; inp.throttle = 1; inp.itemHeld = false; inp.itemDir = 0;
    this.retarget -= dt; this.itemCd -= dt; this.hopCd -= dt; this.wanderT -= dt;
    if (this.wanderT <= 0) { this.wanderT = this.rng.range(1, 3); this.wander = this.rng.range(-0.4, 0.4); }
    if (this.retarget <= 0 || !this.target || this.target.eliminated) {
      this.retarget = this.rng.range(1.5, 3); let best = null, bd = 1e9;
      for (const o of karts) { if (o === k || o.eliminated) continue; const d = o.pos.distanceTo(k.pos) + (o.invincible ? 60 : 0); if (d < bd) { bd = d; best = o; } }
      this.target = best;
    }
    const t = this.target;
    // where to go: a box if we have no item, otherwise the target (with lead)
    let goal;
    if (!k.item && k.roulette <= 0) { let best = null, bd = 1e9; for (const b of items.boxes) { if (!b.active) continue; const d = b.pos.distanceTo(k.pos); if (d < bd) { bd = d; best = b; } } goal = best ? best.pos : (t ? t.pos : null); }
    else if (t) { const lead = Math.min(1.2, t.pos.distanceTo(k.pos) / 40); goal = { x: t.pos.x + Math.sin(t.velYaw) * t.speed * lead, z: t.pos.z + Math.cos(t.velYaw) * t.speed * lead }; }
    if (!goal) goal = { x: 0, z: 0 };
    // keep some distance when the target is invincible
    if (t && t.invincible && t.pos.distanceTo(k.pos) < 25) goal = { x: k.pos.x - (t.pos.x - k.pos.x), z: k.pos.z - (t.pos.z - k.pos.z) };
    let want = Math.atan2(goal.x - k.pos.x, goal.z - k.pos.z);
    let err = wrapAngle(want - (k.drift.active ? k.velYaw : k.yaw));
    let steer = clamp(err * 2.4, -1, 1) + this.wander * (1 - this.skill);
    // obstacle / wall avoidance: probe ahead and to the sides
    const look = 10 + k.speed * 0.6; const sx = Math.sin(k.yaw), sz = Math.cos(k.yaw);
    const ahead = ar.probe(k.pos.x, k.pos.z, sx, sz, look);
    if (ahead) {
      const la = Math.sin(k.yaw + 0.6), lz = Math.cos(k.yaw + 0.6), ra = Math.sin(k.yaw - 0.6), rz = Math.cos(k.yaw - 0.6);
      const left = ar.probe(k.pos.x, k.pos.z, la, lz, look) || 99, right = ar.probe(k.pos.x, k.pos.z, ra, rz, look) || 99;
      const urgency = clamp(1.4 - ahead / look, 0.4, 1.4);
      steer = left >= right ? urgency : -urgency; // internal +: left
      if (ahead < 6 && k.speed > 10) inp.brake = 1;
    }
    // drift on sharp turns
    const d = k.drift;
    if (d.active) { inp.hop = Math.abs(err) > 0.2 && k.speed > 9; if (!inp.hop) this.hopCd = 0.8; }
    else { this.hopHoldT = (this.hopHoldT || 0) - dt; inp.hop = this.hopHoldT > 0; if (Math.abs(err) > 0.7 && k.speed > 13 && this.hopCd <= 0 && !ahead && k.controllable && this.rng.chance(this.skill)) { inp.hopPressed = true; inp.hop = true; this.hopHoldT = 0.7; this.hopCd = 1.5; steer = sign(err); } }
    inp.steer = -clamp(steer, -1, 1);
    // ---- items ----
    if (k.item && k.roulette <= 0 && k.controllable && t) {
      const id = k.item, base = ITEMS[id].base || id; const dist = t.pos.distanceTo(k.pos); const aimed = Math.abs(err) < 0.25;
      const behind = karts.some((o) => o !== k && !o.eliminated && o.pos.distanceTo(k.pos) < 16 && ((o.pos.x - k.pos.x) * sx + (o.pos.z - k.pos.z) * sz) < 0);
      let use = false, dir = 1;
      if (ITEMS[id].trail) {
        if (this.releaseNext) { inp.itemHeld = false; inp.itemDir = this.pendingDir; this.releaseNext = false; }
        else {
          if (base === 'banana') { if (this.itemCd <= 0 && (behind || this.rng.chance(0.01))) { use = true; dir = -1; } }
          else if (base === 'green' || base === 'red') { if (this.itemCd <= 0 && aimed && dist < (base === 'red' ? 60 : 35)) { use = true; dir = 1; } else if (this.itemCd <= 0 && behind && this.rng.chance(0.3)) { use = true; dir = -1; } }
          else if (base === 'bomb') { if (this.itemCd <= 0 && aimed && dist < 24 && dist > 8) { use = true; dir = 1; } }
          if (use) { this.itemCd = this.rng.range(0.5, 1.5); inp.itemHeld = true; this.pendingDir = dir; this.releaseNext = true; }
          else inp.itemHeld = behind || k.trailing;
        }
      } else if (this.itemCd <= 0) {
        if (base === 'mush') use = dist > 30 || behind;
        else if (base === 'fire') use = aimed && dist < 35;
        else if (base === 'horn') use = karts.some((o) => o !== k && !o.eliminated && o.pos.distanceTo(k.pos) < 7.5) || items.objects.some((o) => o.type === 'red' && o.target === k && o.pos.distanceTo(k.pos) < 10);
        else if (base === 'star' || base === 'blooper' || base === 'lightning') use = dist < 40 || this.rng.chance(0.01);
        else use = true;
        if (use) { inp.itemPressed = true; inp.itemDir = 1; this.itemCd = base === 'fire' ? 0.3 : this.rng.range(0.6, 1.6); }
      }
    } else if (!k.item) this.releaseNext = false;
    return inp;
  }
}
