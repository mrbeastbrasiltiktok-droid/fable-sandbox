import * as THREE from 'three';
import { Character } from './character.js';
import { resolveCircle } from './physics.js';
import { clamp, damp, angleDamp, rand, pick, dist2D, wrapAngle } from './utils.js';
import { CITY } from './config.js';
import { shootAt } from './weapons.js';

const LINES = {
  ped: ["Nice weather for a heist.", "Do I know you?", "This city's gone to hell.", "Keep walking, pal.", "You look like trouble.", "Have you seen my car? Red sedan. Big dent.", "The burgers at Burger Shot are 40% meat now!", "I'm late for a thing. A very important thing.", "Ammu-Nation's got a sale on. Not that I'd know.", "Watch the road, cabs here drive like maniacs.", "Downtown's beautiful at night, if you like sirens.", "Is that a gun or are you just happy to see me?", "Don't get me started on the traffic lights."],
  cop: ["Move along, citizen.", "Nothing to see here.", "Keep your nose clean.", "I've got my eye on you.", "Stay out of trouble."],
  gang: ["You lost, tourist?", "This is our block.", "Keep steppin'.", "You got a problem?", "Eastside runs this."],
  clerk: ["Welcome in! Press E at the counter to shop.", "Take a look around.", "Cash only, friend."],
  player: ["Hey.", "What's up?", "Sup.", "Nice day.", "Yeah, yeah.", "Sure.", "Alright then."],
};

// Push a walking entity (x,z, radius) out of vehicles; calls onHit(vehicle, relSpeed) when a moving car strikes it.
const _l = new THREE.Vector3();
export function collideWithVehicles(ent, vehicles, onHit) {
  for (const v of vehicles) {
    if (v === ent.vehicle) continue;
    const dx = ent.x - v.x, dz = ent.z - v.z; if (dx * dx + dz * dz > (v.halfL + 1.2) ** 2) continue;
    const s = Math.sin(v.heading), c = Math.cos(v.heading);
    // local: forward z, right x  (right = (c, -s))
    const lz = dx * s + dz * c, lx = dx * c - dz * s;
    const hl = v.halfL + ent.radius, hw = v.halfW + ent.radius;
    if (Math.abs(lz) > hl || Math.abs(lx) > hw) continue;
    if (ent.y > 1.6) continue; // jumped on it
    const pz = hl - Math.abs(lz), px = hw - Math.abs(lx);
    let nx, nz; if (px < pz) { const sg = Math.sign(lx) || 1; nx = c * sg; nz = -s * sg; ent.x += nx * px; ent.z += nz * px; } else { const sg = Math.sign(lz) || 1; nx = s * sg; nz = c * sg; ent.x += nx * pz; ent.z += nz * pz; }
    const rel = -(v.vx * nx + v.vz * nz); // approach speed of car toward entity
    if (rel > 2.5) onHit(v, rel, nx, nz);
  }
}

let pedId = 0;
export class Ped {
  constructor(game, x, z, opts = {}) {
    this.game = game; this.id = pedId++; this.kind = opts.kind || 'ped';
    this.char = new Character({ kind: this.kind, ...opts, weapon: opts.weapon || (this.kind === 'cop' || this.kind === 'gang' ? 'pistol' : 'pistol') });
    this.x = x; this.z = z; this.y = game.city.groundHeight(x, z); this.heading = rand(0, 6.28); this.radius = 0.38;
    this.vx = 0; this.vz = 0; this.vy = 0; this.health = this.kind === 'cop' ? 65 : 60; this.dead = false; this.downT = 0; this.deadT = 0; this.knocked = false;
    this.state = 'walk'; this.panicT = 0; this.fleeDir = 0; this.waitT = 0; this.vehicle = null; this.speed = 0;
    this.walkSpeed = rand(1.2, 2.0); this.runSpeed = rand(5.2, 6.4); this.target = null; this.nav = null; this.money = Math.random() < 0.5 ? Math.floor(rand(5, 60)) : 0;
    this.mission = null; this.important = false; this.hitCooldown = 0; this.weapon = opts.weapon || null; this.shootT = 0; this.arrestT = 0;
    this.stuckT = 0; this.hostile = false; this.talkT = 0; this.gangColor = opts.gangColor;
    if (this.kind === 'gang') { this.weapon = 'pistol'; this.health = 70; }
    game.scene.add(this.char.group); this.syncMesh();
    if (this.kind === 'ped' || this.kind === 'gang') this.pickNav();
  }
  get pos() { return { x: this.x, y: this.y, z: this.z }; }
  syncMesh() { this.char.group.position.set(this.x, this.y, this.z); this.char.group.rotation.y = this.heading; }

  // ---- sidewalk navigation ----
  pickNav() {
    const city = this.game.city; let best = null, bd = Infinity;
    for (const b of city.blocks) { const d = Math.hypot(b.cx - this.x, b.cz - this.z); if (d < bd) { bd = d; best = b; } }
    const corners = this.blockCorners(best); let bc = 0, cd = Infinity; corners.forEach((c, i) => { const d = Math.hypot(c.x - this.x, c.z - this.z); if (d < cd) { cd = d; bc = i; } });
    this.nav = { block: best, corner: bc, dir: Math.random() < 0.5 ? 1 : -1 }; this.target = corners[bc];
  }
  blockCorners(b) { return [{ x: b.x0 - 1.5, z: b.z0 - 1.5 }, { x: b.x1 + 1.5, z: b.z0 - 1.5 }, { x: b.x1 + 1.5, z: b.z1 + 1.5 }, { x: b.x0 - 1.5, z: b.z1 + 1.5 }]; }
  nextNavTarget() {
    const city = this.game.city; const n = this.nav; const b = n.block;
    // maybe cross to a neighbouring block at this corner
    if (Math.random() < 0.35) {
      const cx = n.corner; const di = (cx === 1 || cx === 2) ? 1 : -1, dj = (cx >= 2) ? 1 : -1;
      const opts = [];
      const nb1 = city.blocks.find(bb => bb.i === b.i + di && bb.j === b.j); if (nb1) opts.push({ b: nb1, c: [1, 0, 3, 2][cx] });
      const nb2 = city.blocks.find(bb => bb.i === b.i && bb.j === b.j + dj); if (nb2) opts.push({ b: nb2, c: [3, 2, 1, 0][cx] });
      if (opts.length) { const o = pick(opts); n.block = o.b; n.corner = o.c; this.target = this.blockCorners(o.b)[o.c]; this.crossing = true; return; }
    }
    this.crossing = false; n.corner = (n.corner + n.dir + 4) % 4; this.target = this.blockCorners(b)[n.corner];
    if (Math.random() < 0.15) this.waitT = rand(1, 4);
  }

  talk(by) {
    if (this.dead || this.vehicle) return null;
    this.talkT = 3; this.heading = Math.atan2(by.x - this.x, by.z - this.z); this.speed = 0;
    const line = pick(LINES[this.kind] || LINES.ped); this.game.hud.speak(this, line, 3000); return line;
  }
  panic(fromX, fromZ, time = 6) {
    if (this.dead || this.kind === 'cop' || this.kind === 'clerk' || this.vehicle) return;
    if (this.kind === 'gang') { this.hostile = true; this.hostileT = 25; return; }
    this.state = 'flee'; this.panicT = Math.max(this.panicT, time);
    this.fleeDir = Math.atan2(this.x - fromX, this.z - fromZ) + rand(-0.6, 0.6);
  }
  hurt(amount, source, dir) {
    if (this.dead) return;
    this.health -= amount; this.lastAttacker = source;
    if (this.health <= 0) this.die(source, dir);
    else { this.panic(source?.x ?? this.x, source?.z ?? this.z, 8); if (this.kind === 'cop') this.game.police.onCopHurt(this, source); if (this.kind === 'gang') this.game.pedsMgr.alertGang(this); }
  }
  knock(vx, vz, dmg, source) {
    if (this.dead) return;
    this.vx = vx; this.vz = vz; this.vy = 3.5; this.knocked = true; this.downT = 1.8; this.char.state.dead = true; this.char.deadT = 0; this.char.deadDir = Math.random() < 0.5 ? 1 : -1;
    this.health -= dmg; this.game.audio.thud(); this.game.effects.blood(this.x, this.y + 0.8, this.z, 5);
    if (this.health <= 0) this.die(source); else this.panicT = 8;
  }
  die(source, dir) {
    if (this.dead) return; this.dead = true; this.deadT = 0; this.state = 'dead'; this.char.state.dead = true; this.char.deadT = 0; this.char.deadDir = Math.random() < 0.5 ? 1 : -1;
    if (dir) { this.vx = dir.x * 2; this.vz = dir.z * 2; }
    this.game.onPedKilled(this, source);
  }

  update(dt) {
    const game = this.game, city = game.city; const cs = this.char.state;
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    if (this.vehicle) { this.syncSeat(); return; }
    // physics for knocked / dead bodies
    if (this.dead || this.knocked) {
      this.vy -= 22 * dt; this.y += this.vy * dt; const gh = city.groundHeight(this.x, this.z); if (this.y < gh) { this.y = gh; this.vy = 0; this.vx *= 0.6; this.vz *= 0.6; }
      this.x += this.vx * dt; this.z += this.vz * dt; this.vx *= Math.exp(-3 * dt); this.vz *= Math.exp(-3 * dt);
      resolveCircle(city.hash, this, this.radius, 2, this.y);
      if (this.dead) { this.deadT += dt; }
      else { this.downT -= dt; if (this.downT <= 0) { this.knocked = false; cs.dead = false; this.state = 'flee'; this.panicT = 6; this.fleeDir = rand(0, 6.28); } }
      this.char.animate(dt); this.syncMesh(); return;
    }
    if (this.talkT > 0) { this.talkT -= dt; this.speed = 0; }
    else if (this.kind === 'cop') { game.police.updateCop(this, dt); }
    else if (this.kind === 'clerk') { this.speed = 0; }
    else if (this.kind === 'gang' && this.hostile) this.gangBrain(dt);
    else this.civilianBrain(dt);
    // move
    let mvx = 0, mvz = 0; const spd = this.speed;
    if (spd > 0) { mvx = Math.sin(this.heading) * spd; mvz = Math.cos(this.heading) * spd; }
    const ox = this.x, oz = this.z;
    this.x += mvx * dt; this.z += mvz * dt;
    resolveCircle(city.hash, this, this.radius, 2, this.y);
    collideWithVehicles(this, game.vehicles, (v, rel, nx, nz) => {
      if (this.hitCooldown > 0) return; this.hitCooldown = 0.5;
      const dmg = rel * (rel > 8 ? 6 : 3); this.knock(v.vx * 0.9 + nx * 2, v.vz * 0.9 + nz * 2, dmg, v.driver || v);
      v.lastPedHit = { ped: this, impact: rel };
      if (v.control === 'player' && !this.dead) game.crime('hit_ped', this.x, this.z);
      if (v.driver === game.player) game.rig.addShake(0.25);
    });
    const moved = Math.hypot(this.x - ox, this.z - oz);
    if (spd > 0.5 && moved < spd * dt * 0.3) { this.stuckT += dt; if (this.stuckT > 0.8) { this.stuckT = 0; if (this.state === 'flee') this.fleeDir += rand(1.5, 3); else this.pickNav(); } } else this.stuckT = 0;
    // keep off the water
    if (Math.max(Math.abs(this.x), Math.abs(this.z)) > CITY.LAND + 4) { this.fleeDir = Math.atan2(-this.x, -this.z); this.heading = this.fleeDir; }
    this.y = damp(this.y, city.groundHeight(this.x, this.z), 20, dt);
    const m = this.speed > 0.1 ? 1 : 0; cs.move = damp(cs.move, m, 10, dt); cs.run = damp(cs.run, this.speed > 3 ? 1 : 0, 8, dt); cs.panic = this.state === 'flee' && this.kind !== 'cop';
    cs.hasWeapon = !!this.weapon && (this.kind !== 'gang' || this.hostile); cs.aiming = this.aiming; cs.weaponLong = false;
    this.char.animate(dt); this.syncMesh();
  }

  gangBrain(dt) {
    const g = this.game, pl = g.player; const d = dist2D(this.x, this.z, pl.x, pl.z);
    this.hostileT -= dt; if (this.hostileT <= 0 || pl.dead || d > 90) { this.hostile = false; this.aiming = false; this.pickNav(); return; }
    const want = Math.atan2(pl.x - this.x, pl.z - this.z); this.heading = angleDamp(this.heading, want, 10, dt);
    this.aiming = d < 35; this.speed = d > 14 ? this.runSpeed : d > 8 ? 2 : 0;
    this.shootT -= dt;
    if (d < 35 && this.shootT <= 0) { this.shootT = rand(1.3, 2.2); shootAt(g, this, this.x, this.y + 1.35, this.z, pl, clamp(0.45 - d / 90, 0.12, 0.45), 5); }
  }

  civilianBrain(dt) {
    const game = this.game; const pl = game.player;
    // threats: fast player car nearby
    const pv = pl.vehicle; if (pv) { const d = dist2D(this.x, this.z, pv.x, pv.z); if (d < 7 && pv.absSpeed > 7 && this.state !== 'flee') this.panic(pv.x, pv.z, 4); }
    if (pl.aiming && pl.currentWeapon !== 'fist' && dist2D(this.x, this.z, pl.x, pl.z) < 14 && this.state !== 'flee') this.panic(pl.x, pl.z, 5);
    if (this.state === 'flee') {
      this.panicT -= dt; if (this.panicT <= 0) { this.state = 'walk'; this.pickNav(); return; }
      // steer away, sample a couple of directions to avoid walls
      this.heading = angleDamp(this.heading, this.fleeDir, 8, dt); this.speed = this.runSpeed; return;
    }
    if (this.waitT > 0) { this.waitT -= dt; this.speed = 0; return; }
    if (!this.target) this.pickNav();
    const dx = this.target.x - this.x, dz = this.target.z - this.z; const d = Math.hypot(dx, dz);
    if (d < 1.0) { this.nextNavTarget(); return; }
    // wait at kerb if crossing and a car is coming
    if (this.crossing && d > 3) { for (const v of game.vehicles) { if (v.absSpeed > 2 && dist2D(v.x, v.z, this.target.x, this.target.z) < 14 && dist2D(v.x, v.z, this.x, this.z) < 12) { this.speed = 0; return; } } }
    const want = Math.atan2(dx, dz); this.heading = angleDamp(this.heading, want, 6, dt);
    this.speed = Math.abs(wrapAngle(want - this.heading)) < 1 ? this.walkSpeed : this.walkSpeed * 0.4;
  }

  enterVehicle(v) { this.vehicle = v; v.driver = this; this.char.state.sitting = true; this.char.state.dead = false; v.seat.add(this.char.group); this.char.group.position.set(0, 0, 0); this.char.group.rotation.set(0, 0, 0); }
  exitVehicle() {
    const v = this.vehicle; if (!v) return; this.vehicle = null; if (v.driver === this) v.driver = null;
    this.game.scene.add(this.char.group); this.char.state.sitting = false;
    const s = Math.sin(v.heading), c = Math.cos(v.heading); this.x = v.x - c * (v.halfW + 0.8); this.z = v.z + s * (v.halfW + 0.8); this.y = this.game.city.groundHeight(this.x, this.z); this.heading = v.heading - Math.PI / 2;
    this.syncMesh();
  }
  syncSeat() { const v = this.vehicle; this.x = v.x; this.z = v.z; this.y = v.y; this.heading = v.heading; this.char.animate(0.016); }
  dispose() { this.char.dispose(); }
}

export class PedManager {
  constructor(game) { this.game = game; this.peds = game.peds; this.spawnT = 0; this.maxPeds = 55; }
  update(dt) {
    const g = this.game; const pl = g.player; const cam = g.rig;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 0.25;
      const civ = this.peds.filter(p => p.kind === 'ped' && !p.dead).length;
      if (civ < this.maxPeds) this.spawnOne();
    }
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i]; p.update(dt);
      const d = dist2D(p.x, p.z, pl.x, pl.z);
      const expire = p.dead && p.deadT > 25;
      if ((expire || (d > 230 && !p.important)) && !p.vehicle && p.kind !== 'cop') { p.dispose(); this.peds.splice(i, 1); }
    }
  }
  spawnOne() {
    const g = this.game, city = g.city, pl = g.player; const fwd = g.rig.forward(new THREE.Vector3());
    for (let tries = 0; tries < 6; tries++) {
      const b = pick(city.blocks); const corners = [{ x: b.x0 - 1.5, z: b.z0 - 1.5 }, { x: b.x1 + 1.5, z: b.z0 - 1.5 }, { x: b.x1 + 1.5, z: b.z1 + 1.5 }, { x: b.x0 - 1.5, z: b.z1 + 1.5 }];
      const c = pick(corners); const t = Math.random(); const c2 = pick(corners); const x = c.x + (c2.x - c.x) * t, z = c.z + (c2.z - c.z) * t;
      const d = dist2D(x, z, pl.x, pl.z); if (d < 45 || d > 170) continue;
      const dot = ((x - pl.x) * fwd.x + (z - pl.z) * fwd.z) / d; if (dot > 0.35 && d < 90) continue; // don't pop in front of the camera
      const gangHood = (b.i >= 7 || b.j === 0) && b.type !== 'park';
      const p = gangHood && Math.random() < 0.35 ? new Ped(g, x, z, { kind: 'gang', gangColor: b.i >= 7 ? 0x8e44ad : 0x27ae60 }) : new Ped(g, x, z);
      this.peds.push(p); return p;
    }
    return null;
  }
  // shooting a gang member brings his friends
  alertGang(p) { for (const q of this.peds) if (q.kind === 'gang' && !q.dead && dist2D(q.x, q.z, p.x, p.z) < 40) { q.hostile = true; q.hostileT = 25; } }
  spawnDriver(v) {
    const s = Math.sin(v.heading), c = Math.cos(v.heading);
    const p = new Ped(this.game, v.x - c * (v.halfW + 0.9), v.z + s * (v.halfW + 0.9)); p.heading = v.heading - Math.PI / 2; p.vx = -c * 2.5; p.vz = s * 2.5; p.syncMesh();
    this.peds.push(p); return p;
  }
  // scare everyone near a point
  panicAround(x, z, r, time = 6) { for (const p of this.peds) if (dist2D(p.x, p.z, x, z) < r) p.panic(x, z, time); }
}
