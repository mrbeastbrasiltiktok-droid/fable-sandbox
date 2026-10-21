import * as THREE from 'three';
import { Vehicle, VEHICLE_TYPES } from './vehicle.js';
import { CITY } from './config.js';
import { STOP_DIST } from './city.js';
import { clamp, wrapAngle, dist2D, pick, rand } from './utils.js';

const { BLOCKS: N, PITCH, HALF } = CITY;
const TRAFFIC_TYPES = ['sedan', 'sedan', 'sedan', 'sports', 'suv', 'van', 'pickup', 'taxi', 'taxi'];

// Lane-following traffic with traffic lights, car-following and pedestrian avoidance.
export class Traffic {
  constructor(game) { this.game = game; this.cars = []; this.max = 26; this.spawnT = 0; }

  spawnParked() {
    const g = this.game;
    for (const s of g.city.parkedSpots) { const v = g.addVehicle(pick(TRAFFIC_TYPES.filter(t => t !== 'taxi')), s.x, s.z, s.heading); v.isParked = true; v.control = 'none'; }
  }

  // Snap a vehicle onto the nearest lane and give it a route.
  newRoute(v, opts = {}) {
    const city = this.game.city; const rc = city.roadCoords;
    const kx = clamp(Math.round((v.x + HALF) / PITCH), 0, N), kz = clamp(Math.round((v.z + HALF) / PITCH), 0, N);
    const dxr = Math.abs(v.x - rc[kx]), dzr = Math.abs(v.z - rc[kz]);
    const prev = v.ai; const dirHint = opts.dirHint;
    const ai = v.ai = { lane: Math.random() < 0.5 ? 0 : 1, path: [], pi: 0, scared: 0, honkT: 0, stuckT: 0, reverseT: 0, laneT: 0, cruise: v.type.name === 'sports' ? 16 : rand(11, 14) };
    if (prev?.aggressive) { ai.aggressive = true; ai.goal = prev.goal; ai.cruise = prev.cruise; ai.scared = prev.scared; }
    Object.assign(ai, opts);
    const hs = Math.sin(v.heading), hc = Math.cos(v.heading);
    if (dxr < dzr) { // on a vertical road (runs along z)
      ai.dx = 0; ai.dz = dirHint ? dirHint.dz : (hc >= 0 ? 1 : -1); ai.ix = kx;
      ai.iz = ai.dz > 0 ? Math.ceil((v.z + HALF) / PITCH - 0.01) : Math.floor((v.z + HALF) / PITCH + 0.01);
      ai.iz = clamp(ai.iz, 0, N); if ((ai.dz > 0 && ai.iz === kz && v.z > rc[kz]) || (ai.dz < 0 && ai.iz === kz && v.z < rc[kz])) ai.iz += ai.dz;
      ai.iz = clamp(ai.iz, 0, N);
    } else {
      ai.dz = 0; ai.dx = dirHint ? dirHint.dx : (hs >= 0 ? 1 : -1); ai.iz = kz;
      ai.ix = ai.dx > 0 ? Math.ceil((v.x + HALF) / PITCH - 0.01) : Math.floor((v.x + HALF) / PITCH + 0.01);
      ai.ix = clamp(ai.ix, 0, N);
    }
    // if we're heading off the grid edge, flip
    if (ai.ix < 0 || ai.ix > N || ai.iz < 0 || ai.iz > N || (ai.dx !== 0 && (ai.ix + ai.dx < -1)) ) { ai.dx *= -1; ai.dz *= -1; }
    this.extendPath(v);
    return ai;
  }
  placeOnLane(v, ai) { const p = this.game.city.lanePoint(ai.ix, ai.iz, ai.dx, ai.dz, ai.lane, -STOP_DIST - 6); v.setPosition(p.x, p.z, Math.atan2(ai.dx, ai.dz)); }

  extendPath(v) {
    const city = this.game.city; const ai = v.ai;
    const { ix, iz, dx, dz, lane } = ai;
    const stop = city.lanePoint(ix, iz, dx, dz, lane, -STOP_DIST); stop.stop = true; stop.ix = ix; stop.iz = iz; stop.axis = dz !== 0 ? 'z' : 'x'; stop.dx = dx; stop.dz = dz;
    ai.path.push(stop);
    // choose next direction
    const opts = [];
    const straight = { dx, dz }, left = { dx: -dz, dz: dx }, right = { dx: dz, dz: -dx };
    for (const [d, w] of [[straight, 3], [left, 1], [right, 1]]) { const nx = ix + d.dx, nz = iz + d.dz; if (nx >= 0 && nx <= N && nz >= 0 && nz <= N) for (let k = 0; k < w; k++) opts.push(d); }
    let nd = opts.length ? pick(opts) : { dx: -dx, dz: -dz };
    if (ai.goal) { // pursuit: pick the exit that brings us closest to the goal
      const cands = [straight, left, right].filter(d => { const nx = ix + d.dx, nz = iz + d.dz; return nx >= 0 && nx <= N && nz >= 0 && nz <= N; });
      if (cands.length) { let best = Infinity; for (const d of cands) { const px = city.roadCoords[ix + d.dx], pz = city.roadCoords[iz + d.dz]; const sc = Math.hypot(px - ai.goal.x, pz - ai.goal.z) + Math.random() * 6; if (sc < best) { best = sc; nd = d; } } }
    }
    const exit = city.lanePoint(ix, iz, nd.dx, nd.dz, lane, STOP_DIST);
    if (nd.dx === dx && nd.dz === dz) { exit.speed = ai.cruise; ai.path.push(exit); }
    else if (nd.dx === -dx && nd.dz === -dz) { // U-turn through the intersection
      const mid = city.lanePoint(ix, iz, dx, dz, lane, 0); mid.speed = 4; ai.path.push(mid); exit.speed = 5; ai.path.push(exit);
    } else {
      const along = (exit.x - stop.x) * dx + (exit.z - stop.z) * dz; const cx = stop.x + dx * along, cz = stop.z + dz * along;
      const isRight = (nd.dx === right.dx && nd.dz === right.dz);
      for (const t of [0.3, 0.55, 0.8, 1]) { const u = 1 - t; const p = { x: u * u * stop.x + 2 * u * t * cx + t * t * exit.x, z: u * u * stop.z + 2 * u * t * cz + t * t * exit.z, speed: isRight ? 5 : 7 }; ai.path.push(p); }
    }
    ai.ix = ix + nd.dx; ai.iz = iz + nd.dz; ai.dx = nd.dx; ai.dz = nd.dz;
    ai.path[ai.path.length - 1].turnEnd = true;
  }

  spawnOne() {
    const g = this.game, city = g.city, pl = g.player; const fwd = g.rig.forward(new THREE.Vector3());
    for (let tries = 0; tries < 8; tries++) {
      const ix = Math.floor(Math.random() * (N + 1)), iz = Math.floor(Math.random() * (N + 1));
      const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]].filter(([dx, dz]) => ix + dx >= 0 && ix + dx <= N && iz + dz >= 0 && iz + dz <= N);
      const [dx, dz] = pick(dirs); const lane = Math.random() < 0.5 ? 0 : 1;
      const p = city.lanePoint(ix, iz, dx, dz, lane, rand(14, PITCH - 14));
      const d = dist2D(p.x, p.z, pl.x, pl.z); if (d < 70 || d > 210) continue;
      const dot = ((p.x - pl.x) * fwd.x + (p.z - pl.z) * fwd.z) / d; if (dot > 0.3 && d < 140) continue;
      if (g.vehicles.some(v => dist2D(v.x, v.z, p.x, p.z) < 14)) continue;
      const v = g.addVehicle(pick(TRAFFIC_TYPES), p.x, p.z, Math.atan2(dx, dz)); this.adopt(v);
      return v;
    }
  }
  adopt(v) { v.control = 'ai'; v.isParked = false; this.newRoute(v); if (!this.cars.includes(v)) this.cars.push(v); }
  release(v) { const i = this.cars.indexOf(v); if (i >= 0) this.cars.splice(i, 1); v.ai = null; }

  update(dt) {
    const g = this.game, pl = g.player;
    this.spawnT -= dt;
    if (this.spawnT <= 0) { this.spawnT = 0.4; if (this.cars.length < this.max) this.spawnOne(); }
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const v = this.cars[i];
      const d = dist2D(v.x, v.z, pl.x, pl.z);
      if (d > 280 || (v.destroyed && d > 90)) { this.cars.splice(i, 1); g.removeVehicle(v); continue; }
      if (v.destroyed) { v.throttle = 0; v.brake = 1; continue; }
      this.drive(v, dt);
    }
  }

  drive(v, dt) {
    const g = this.game, city = g.city, ai = v.ai; if (!ai) return;
    const spd = v.speed; const s = Math.sin(v.heading), c = Math.cos(v.heading);
    ai.scared = Math.max(0, ai.scared - dt); ai.honkT = Math.max(0, ai.honkT - dt); ai.laneT = Math.max(0, (ai.laneT || 0) - dt);
    // reverse manoeuvre when stuck
    if (ai.reverseT > 0) { ai.reverseT -= dt; v.throttle = 0; v.brake = 1; v.steerInput = ai.reverseSteer; if (ai.reverseT <= 0) { this.newRoute(v); } return; }
    // advance path
    while (ai.path.length < 8) this.extendPath(v);
    let tp = ai.path[ai.pi];
    const passed = (p) => ((v.x - p.x) * s + (v.z - p.z) * c) > -0.5 || dist2D(v.x, v.z, p.x, p.z) < 2.2;
    while (ai.pi < ai.path.length - 1 && passed(tp)) { ai.pi++; tp = ai.path[ai.pi]; }
    if (ai.pi > 3) { ai.path.splice(0, ai.pi); ai.pi = 0; tp = ai.path[0]; }
    // lost? (knocked far off the route)
    const dTarget = dist2D(v.x, v.z, tp.x, tp.z);
    const lateral = Math.abs((tp.x - v.x) * c - (tp.z - v.z) * s); // sideways offset of the target from our heading line
    const ahead = (tp.x - v.x) * s + (tp.z - v.z) * c;
    if (dTarget > PITCH * 1.6 || (dTarget > 6 && lateral > 9) || (ahead < -4 && dTarget > 6)) { this.newRoute(v); return; }
    // lookahead point
    let la = tp; const look = 4 + Math.abs(spd) * 0.35;
    for (let k = ai.pi; k < ai.path.length; k++) { la = ai.path[k]; if (dist2D(v.x, v.z, la.x, la.z) > look) break; }
    const want = Math.atan2(la.x - v.x, la.z - v.z); const err = wrapAngle(want - v.heading);
    v.steerInput = clamp(err * 2.2, -1, 1);
    // speed planning
    let target = ai.scared > 0 ? 24 : ai.cruise;
    for (let k = ai.pi; k < Math.min(ai.path.length, ai.pi + 5); k++) { const p = ai.path[k]; if (p.speed !== undefined) { const dd = dist2D(v.x, v.z, p.x, p.z); const ps = p.speed * (ai.aggressive ? 1.8 : 1); target = Math.min(target, Math.max(ps, Math.sqrt(ps * ps + 2 * (ai.aggressive ? 10 : 6) * Math.max(0, dd - 2)))); } }
    if (Math.abs(err) > 0.5) target = Math.min(target, ai.aggressive ? 9 : 5);
    // traffic light at the next stop point
    for (let k = ai.pi; k < Math.min(ai.path.length, ai.pi + 3); k++) {
      const p = ai.path[k]; if (!p.stop) continue;
      const dd = (p.x - v.x) * s + (p.z - v.z) * c; // distance ahead along heading
      if (dd < -1) continue;
      const st = city.lightState(p.ix, p.iz, p.axis, g.time);
      if (ai.scared > 0) break;
      if (ai.aggressive) break;
      if (st === 'red' || (st === 'yellow' && dd > 6)) { const allowed = Math.sqrt(2 * 5 * Math.max(0, dd - 1.5)); target = Math.min(target, dd < 1.5 ? 0 : allowed); }
      break;
    }
    // car following / obstacles
    let honk = false;
    for (const o of g.vehicles) {
      if (o === v) continue; const dx = o.x - v.x, dz = o.z - v.z; if (dx * dx + dz * dz > 40 * 40) continue;
      const lz = dx * s + dz * c, lx = dx * c - dz * s;
      const reach = (ai.aggressive ? 3 : 6) + Math.abs(spd) * (ai.aggressive ? 0.7 : 1.3);
      if (ai.aggressive && o.control === 'player') continue; // cops ram the player's car instead of queueing behind it
      if (lz > 0 && lz < reach + o.halfL && Math.abs(lx) < 2.6) {
        const gap = lz - o.halfL - v.halfL; const os = o.vx * s + o.vz * c;
        const allowed = gap < (ai.aggressive ? 1 : 2.5) ? 0 : Math.min(Math.max(0, os) + Math.sqrt(2 * (ai.aggressive ? 12 : 5) * Math.max(0, gap - 2.5)), target);
        // pursuers overtake slow traffic by hopping to the other lane
        if (ai.aggressive && ai.laneT <= 0 && gap > 3 && os < spd - 2 && !ai.path.slice(ai.pi, ai.pi + 3).some(pp => pp.stop && dist2D(v.x, v.z, pp.x, pp.z) < 22)) { this.newRoute(v, { lane: 1 - ai.lane, laneT: 3 }); return; }
        target = Math.min(target, allowed);
        if (gap < 4 && o.control === 'player' && Math.abs(spd) < 1 && ai.honkT <= 0 && Math.random() < 0.02) honk = true;
      }
    }
    for (const p of g.peds) {
      if (p.dead && p.deadT > 2) continue; const dx = p.x - v.x, dz = p.z - v.z; if (dx * dx + dz * dz > 30 * 30) continue;
      const lz = dx * s + dz * c, lx = dx * c - dz * s;
      if (lz > 0 && lz < 5 + Math.abs(spd) * 1.2 && Math.abs(lx) < v.halfW + 0.8) { target = Math.min(target, lz < 4 ? 0 : Math.sqrt(2 * 6 * (lz - 3))); if (ai.honkT <= 0) honk = true; }
    }
    if (!ai.aggressive && g.player.vehicle == null && dist2D(g.player.x, g.player.z, v.x, v.z) < 30) {
      const dx = g.player.x - v.x, dz = g.player.z - v.z; const lz = dx * s + dz * c, lx = dx * c - dz * s;
      if (lz > 0 && lz < 6 + Math.abs(spd) * 1.2 && Math.abs(lx) < v.halfW + 0.8) { target = Math.min(target, lz < 4 ? 0 : Math.sqrt(2 * 6 * (lz - 3))); if (ai.honkT <= 0) honk = true; }
    }
    if (honk) { ai.honkT = rand(2, 5); g.hornAt(v); }
    // throttle / brake
    if (spd < target - 0.4) { v.throttle = clamp((target - spd) / 4, 0.3, 1); v.brake = 0; }
    else if (spd > target + 0.4) { v.throttle = 0; v.brake = clamp((spd - target) / 4, 0.25, 1); }
    else { v.throttle = 0.15; v.brake = 0; }
    v.handbrake = false;
    // stuck detection
    if (v.throttle > 0.3 && Math.abs(spd) < 0.4 && target > 2) { ai.stuckT += dt; if (ai.stuckT > 2.5) { ai.stuckT = 0; ai.reverseT = 1.3; ai.reverseSteer = Math.random() < 0.5 ? -1 : 1; } } else ai.stuckT = Math.max(0, ai.stuckT - dt);
    v.setLights(g.night > 0.35);
  }
}
