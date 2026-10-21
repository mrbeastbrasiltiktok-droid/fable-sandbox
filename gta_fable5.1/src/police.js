import * as THREE from 'three';
import { Ped } from './peds.js';
import { WANTED, CITY } from './config.js';
import { raycastBoxes } from './physics.js';
import { castBullet } from './weapons.js';
import { clamp, wrapAngle, dist2D, pick, rand, angleDamp } from './utils.js';

const { BLOCKS: N, PITCH, HALF } = CITY;
const SEVERITY = { hit_ped: 0.34, kill_ped: 0.8, assault: 0.2, gunfire: 0.34, carjack: 0.5, attack_cop: 1.0, kill_cop: 1.5, destroy_vehicle: 0.8, explosion: 1.0, hit_cop_car: 0.5 };
const _f = new THREE.Vector3(), _o = new THREE.Vector3(), _d = new THREE.Vector3();

export class Police {
  constructor(game) { this.game = game; this.level = 0; this.heat = 0; this.seenT = 0; this.cops = []; this.copCars = []; this.spawnT = 0; this.flashT = 0; this.lastCrimeT = -99; this.cleared = true; }

  crime(type, x, z) {
    const g = this.game; const s = SEVERITY[type] ?? 0.3;
    // minor crimes only count if someone could plausibly see them (a cop nearby or plain bad luck)
    const chance = { gunfire: 0.4, hit_ped: 0.5, carjack: 0.6, assault: 0.5 }[type] ?? 1;
    const witnessed = this.level > 0 || this.copNear(x, z, 80) || Math.random() < chance;
    if (!witnessed) return;
    this.heat = Math.min(WANTED.MAX + 0.99, this.heat + s); this.seenT = 0; this.lastCrimeT = g.time;
    const nl = Math.min(WANTED.MAX, Math.floor(this.heat));
    if (nl > this.level) { this.level = nl; this.flashT = 1.5; g.audio.stars(); g.hud.flashStars(); }
  }
  copNear(x, z, r) { return this.cops.some(c => !c.dead && dist2D(c.x, c.z, x, z) < r); }
  clear() { this.level = 0; this.heat = 0; this.seenT = 0; }
  noteRam() { this.crime('hit_cop_car', this.game.player.x, this.game.player.z); }
  onCopHurt(cop, source) { if (source === this.game.player || source?.driver === this.game.player) this.crime('attack_cop', cop.x, cop.z); }
  onCopKilled(cop, source) { if (source === this.game.player || source?.driver === this.game.player) this.crime('kill_cop', cop.x, cop.z); }
  release(v) { const i = this.copCars.indexOf(v); if (i >= 0) this.copCars.splice(i, 1); v.sirenOn = false; }

  update(dt) {
    const g = this.game, pl = g.player;
    this.flashT = Math.max(0, this.flashT - dt);
    if (this.level > 0) {
      const seen = this.cops.some(c => !c.dead && dist2D(c.x, c.z, pl.x, pl.z) < WANTED.COP_SIGHT);
      if (seen) this.seenT = 0; else this.seenT += dt;
      if (this.seenT > WANTED.DECAY_TIME[this.level]) { this.level--; this.heat = this.level; this.seenT = 0; if (this.level === 0) g.notify('You lost the cops', 2500); }
    }
    // spawn / despawn cop cars
    const wantCars = WANTED.COPS_PER_LEVEL[this.level];
    this.spawnT -= dt;
    if (this.copCars.length < wantCars && this.spawnT <= 0) { this.spawnT = this.copCars.length === 0 ? 0.5 : rand(2, 5) / Math.max(1, this.level * 0.6); this.spawnCopCar(); }
    for (let i = this.copCars.length - 1; i >= 0; i--) {
      const v = this.copCars[i]; const d = dist2D(v.x, v.z, pl.x, pl.z);
      const extra = this.copCars.length > wantCars;
      if (v.destroyed && d > 60 || (d > 260) || (extra && d > 120) || (this.level === 0 && d > 90)) { this.copCars.splice(i, 1); this.removeCopOf(v); g.removeVehicle(v); continue; }
      if (v.destroyed) continue;
      if (this.level === 0) { v.throttle = 0; v.brake = 0.5; v.handbrake = false; v.sirenOn = false; v.setLights(false); continue; }
      if (v.driver && v.driver.kind === 'cop') this.driveCopCar(v, dt); else { v.throttle = 0; v.brake = 0.5; v.sirenOn = false; }
    }
    // on-foot cops: cleanup dead & far
    for (let i = this.cops.length - 1; i >= 0; i--) {
      const c = this.cops[i]; const d = dist2D(c.x, c.z, pl.x, pl.z);
      if ((c.dead && c.deadT > 20) || (!c.vehicle && d > 200) || (this.level === 0 && !c.vehicle && d > 80)) { this.cops.splice(i, 1); const pi = g.peds.indexOf(c); if (pi >= 0) g.peds.splice(pi, 1); c.dispose(); }
    }
  }
  removeCopOf(v) { for (const c of this.cops) if (c.vehicle === v) { c.vehicle = null; } }

  spawnCopCar() {
    const g = this.game, city = g.city, pl = g.player; const fwd = g.rig.forward(_f);
    for (let tries = 0; tries < 10; tries++) {
      const ix = Math.floor(Math.random() * (N + 1)), iz = Math.floor(Math.random() * (N + 1));
      const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]].filter(([dx, dz]) => ix + dx >= 0 && ix + dx <= N && iz + dz >= 0 && iz + dz <= N);
      const [dx, dz] = pick(dirs); const p = city.lanePoint(ix, iz, dx, dz, 0, rand(14, PITCH - 14));
      const d = dist2D(p.x, p.z, pl.x, pl.z); if (d < 60 || d > 150) continue;
      const dot = ((p.x - pl.x) * fwd.x + (p.z - pl.z) * fwd.z) / d; if (dot > 0.5 && d < 80) continue;
      if (g.vehicles.some(v => dist2D(v.x, v.z, p.x, p.z) < 12)) continue;
      const v = g.addVehicle('police', p.x, p.z, Math.atan2(dx, dz)); v.control = 'cop'; v.sirenOn = true; v.avoid = { t: 0, side: 1 };
      g.traffic.newRoute(v, { aggressive: true, cruise: 40, goal: { x: pl.x, z: pl.z } });
      const cop = new Ped(g, p.x, p.z, { kind: 'cop', weapon: 'pistol' }); cop.important = true; g.peds.push(cop); this.cops.push(cop); cop.enterVehicle(v); cop.car = v;
      this.copCars.push(v); return v;
    }
  }

  // Pursuit driving with whisker avoidance. Rams the player's car; pulls up when the player is on foot.
  driveCopCar(v, dt) {
    const g = this.game, pl = g.player, city = g.city; const cop = v.driver;
    const tx = pl.x + pl.vx * 0.6, tz = pl.z + pl.vz * 0.6; const d = dist2D(v.x, v.z, pl.x, pl.z);
    const s = Math.sin(v.heading), c = Math.cos(v.heading); const spd = v.speed;
    v.sirenOn = true; v.setLights(g.night > 0.35);
    // Far away or no line of sight: follow the road network towards the player (fast, ignores lights).
    const ddx = pl.x - v.x, ddz = pl.z - v.z; const hb = d < 1 ? null : raycastBoxes(city.hash, v.x, v.z, ddx / d, ddz / d, d).box; const los = !hb || hb.kind !== 'building';
    const direct = d < 70 && los;
    if (!direct) {
      if (!v.ai) { g.traffic.newRoute(v, { aggressive: true, cruise: 40, goal: { x: pl.x, z: pl.z } }); }
      v.ai.goal = { x: pl.x, z: pl.z }; v.ai.aggressive = true; v.ai.cruise = 40; v.ai.scared = 0;
      g.traffic.drive(v, dt); v.setLights(g.night > 0.35);
      // drive-by at high wanted levels even while routing
      if (this.level >= 3 && pl.vehicle && d < 26 && !pl.dead) { cop.shootT -= dt; if (cop.shootT <= 0) { cop.shootT = 2.2; this.copShoot(cop, v.x, v.y + 1.2, v.z, 0.25); } }
      return;
    }
    v.ai = null;
    if (v.avoid.reverseT > 0) { v.avoid.reverseT -= dt; v.throttle = 0; v.brake = 1; v.steerInput = v.avoid.side; v.handbrake = false; if (v.avoid.reverseT <= 0) v.avoid.stuck = 0; return; }
    let want = Math.atan2(tx - v.x, tz - v.z);
    // whiskers
    const L = 9 + Math.abs(spd) * 0.7; const rays = [[0, 1], [0.45, 0.7], [-0.45, 0.7]];
    let block = [0, 0, 0];
    rays.forEach(([a, w], i) => { const h = v.heading + a; const hit = raycastBoxes(city.hash, v.x, v.z, Math.sin(h), Math.cos(h), L * w); if (hit.box && hit.box.kind === 'building') block[i] = 1 - hit.t / (L * w); });
    if (block[0] > 0.1 || block[1] > 0.4 || block[2] > 0.4) { const bias = (block[2] - block[1]) * 1.2 + (block[0] > 0.1 ? v.avoid.side * 0.8 : 0); want = v.heading + bias; }
    const err = wrapAngle(want - v.heading); v.steerInput = clamp(err * 2.0, -1, 1);
    let target = pl.vehicle ? 40 : Math.min(30, d * 0.8);
    if (Math.abs(err) > 1.2) target = Math.min(target, 6);
    if (block[0] > 0.5) target = Math.min(target, 4);
    if (!pl.vehicle && d < 9) target = 0;
    // avoid running straight into other cop cars head on
    if (spd < target - 0.5) { v.throttle = 1; v.brake = 0; } else if (spd > target + 0.5) { v.throttle = 0; v.brake = 1; } else { v.throttle = 0.2; v.brake = 0; }
    v.handbrake = Math.abs(err) > 1.4 && Math.abs(spd) > 8;
    // stuck
    if (v.throttle > 0.5 && Math.abs(spd) < 0.5) { v.avoid.stuck = (v.avoid.stuck || 0) + dt; if (v.avoid.stuck > 1.5) { v.avoid.reverseT = 1.2; v.avoid.side = Math.random() < 0.5 ? -1 : 1; } } else v.avoid.stuck = 0;
    // ramming crime feedback
    if (v.lastCarHit && v.lastCarHit.other === pl.vehicle && v.lastCarHit.impact > 4) { v.lastCarHit = null; g.rig.addShake(0.3); }
    // get out when the player is on foot and we're close & slow
    if (!pl.vehicle && d < 12 && Math.abs(spd) < 3 && !pl.dead) { cop.exitVehicle(); cop.car = v; cop.aiming = true; }
    // drive-by at high wanted levels
    if (this.level >= 3 && pl.vehicle && d < 26 && !pl.dead) { cop.shootT -= dt; if (cop.shootT <= 0) { cop.shootT = 1.6; this.copShoot(cop, v.x, v.y + 1.2, v.z, 0.3); } }
  }

  // On-foot cop brain (called by Ped.update). Chases, arrests when the player stands still, shoots at 2+ stars.
  updateCop(cop, dt) {
    const g = this.game, pl = g.player; const d = dist2D(cop.x, cop.z, pl.x, pl.z);
    cop.shootT -= dt;
    if (pl.dead || pl.busted || this.level === 0) { cop.speed = 0; cop.aiming = false; this.maybeReturnToCar(cop, dt); return; }
    // return to the car if the player is escaping in a vehicle
    if (pl.vehicle && d > 30 && cop.car && !cop.car.destroyed && !cop.car.driver && dist2D(cop.car.x, cop.car.z, cop.x, cop.z) < 60) { this.walkToCar(cop, dt); return; }
    const want = Math.atan2(pl.x - cop.x, pl.z - cop.z);
    cop.heading = angleDamp(cop.heading, want, 10, dt);
    cop.aiming = this.level >= 2 && d < 32;
    if (d > 2.0) cop.speed = cop.aiming && d < 10 ? 3.2 : 6.6; else cop.speed = 0;
    // arrest
    if (!pl.vehicle && d < 2.0 && pl.absSpeed < 3) { cop.arrestT += dt; if (cop.arrestT > 0.9) pl.arrest(); } else cop.arrestT = Math.max(0, cop.arrestT - dt);
    // shoot
    if (this.level >= 2 && d < 32 && cop.shootT <= 0) {
      const chance = clamp(0.6 - d / 55, 0.15, 0.6);
      cop.shootT = Math.max(1.0, 2.0 - this.level * 0.15);
      this.copShoot(cop, cop.x, cop.y + 1.35, cop.z, chance);
    }
  }
  walkToCar(cop, dt) {
    const car = cop.car; const want = Math.atan2(car.x - cop.x, car.z - cop.z); cop.heading = angleDamp(cop.heading, want, 10, dt); cop.aiming = false;
    const d = dist2D(cop.x, cop.z, car.x, car.z); cop.speed = d > car.halfW + 1.5 ? 6.6 : 0;
    if (d <= car.halfW + 1.6) { cop.enterVehicle(car); car.control = 'cop'; if (!this.copCars.includes(car)) this.copCars.push(car); }
  }
  maybeReturnToCar(cop, dt) { if (cop.car && !cop.car.destroyed && !cop.car.driver && dist2D(cop.car.x, cop.car.z, cop.x, cop.z) < 60) this.walkToCar(cop, dt); }
  copShoot(cop, x, y, z, chance) {
    const g = this.game, pl = g.player; const fx = g.effects;
    _o.set(x, y, z); _d.set(pl.x - x, pl.y + 1.0 - y, pl.z - z).normalize();
    const hit = castBullet(g, _o, _d, 60, cop);
    if (hit.type !== 'ped' && hit.type !== 'vehicle' && hit.type !== 'none') { return; } // no line of sight
    const miss = Math.random() > chance; if (miss) { _d.x += rand(-0.08, 0.08); _d.y += rand(-0.04, 0.04); _d.z += rand(-0.08, 0.08); }
    const h2 = castBullet(g, _o, _d, 60, cop); fx.addTracer(_o, h2.point); fx.muzzle(_o, _d);
    g.audio.gunshot('pistol');
    if (h2.type === 'ped' && h2.entity === pl) pl.takeDamage(4 + this.level, cop);
    else if (h2.type === 'ped') h2.entity.hurt(12, cop, _d);
    else if (h2.type === 'vehicle') { h2.entity.damage(4, 'bullet', cop); fx.sparks(h2.point.x, h2.point.y, h2.point.z, 4); if (h2.entity === pl.vehicle) pl.takeDamage(2, cop, 'impact'); }
  }
}
