import * as THREE from 'three';
import { Ped } from './peds.js';
import { CITY } from './config.js';
import { dist2D, pick, rand, clamp, formatMoney } from './utils.js';

const markerGeo = new THREE.CylinderGeometry(2.2, 2.2, 3, 32, 1, true);
const markerMatBase = { transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, toneMapped: false };
const cpGeo = new THREE.CylinderGeometry(4, 4, 6, 32, 1, true);

export class Missions {
  constructor(game) {
    this.game = game; this.active = null; this.markers = []; this.cooldown = 0; this.completed = 0;
    const city = game.city; const b = (i, j) => city.blocks.find(bb => bb.i === i && bb.j === j);
    const defs = [
      { type: 'race', name: 'Street Race', color: 0xffd24a, x: b(2, 6).x1 + 5, z: b(2, 6).z0 - 5, desc: 'Hit every checkpoint before the clock runs out.' },
      { type: 'taxi', name: 'Taxi Fares', color: 0xffd24a, x: b(3, 2).x0 + 30, z: b(3, 2).z0 - 5, desc: 'Ferry passengers across town. Fast and smooth pays.' },
      { type: 'contract', name: 'The Contract', color: 0xff5050, x: b(4, 4).x0 - 5, z: b(4, 4).z0 - 5, desc: 'A rival needs to disappear. Find them before they vanish.' },
      { type: 'hotwheels', name: 'Hot Wheels', color: 0x50c8ff, x: b(6, 0).x0 - 5, z: b(6, 0).z1 + 5, desc: 'Boost the marked car and bring it back to the chop shop.' },
      { type: 'vigilante', name: 'Vigilante', color: 0x6a8cff, x: b(6, 6).x0 + 30, z: b(6, 6).z1 + 5, desc: 'Take a cruiser and run down the fleeing suspects.' },
    ];
    for (const d of defs) {
      const mesh = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: d.color, ...markerMatBase })); mesh.position.set(d.x, city.groundHeight(d.x, d.z) + 1.5, d.z); game.scene.add(mesh);
      this.markers.push({ ...d, mesh });
    }
    this.cpMesh = new THREE.Mesh(cpGeo, new THREE.MeshBasicMaterial({ color: 0xffd24a, ...markerMatBase })); this.cpMesh.visible = false; game.scene.add(this.cpMesh);
    this.targetMarker = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.8, 4), new THREE.MeshBasicMaterial({ color: 0xff4040, toneMapped: false })); this.targetMarker.rotation.x = Math.PI; this.targetMarker.visible = false; game.scene.add(this.targetMarker);
    // vigilante cruiser parked at the precinct
    const v = game.addVehicle('police', defs[4].x + 12, defs[4].z + 6, Math.PI / 2); v.control = 'none'; v.isParked = true;
  }
  blips() {
    const out = [];
    if (!this.active) for (const m of this.markers) out.push({ x: m.x, z: m.z, color: '#' + m.color.toString(16).padStart(6, '0'), kind: 'mission', size: 7, label: m.name[0], name: m.name });
    if (this.active?.blips) { const bl = this.active.blips(); if (bl.length) bl[0].guide = true; out.push(...bl); }
    return out;
  }

  update(dt) {
    const g = this.game, pl = g.player; const t = g.time;
    for (const m of this.markers) { m.mesh.material.opacity = 0.25 + 0.15 * Math.sin(t * 3); m.mesh.rotation.y = t * 0.5; m.mesh.visible = !this.active; }
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.active) {
      if (pl.dead || pl.busted) { this.fail(pl.dead ? 'You died' : 'You got busted'); return; }
      this.active.update(dt);
      return;
    }
    if (this.cooldown > 0) return;
    for (const m of this.markers) {
      const near = dist2D(pl.x, pl.z, m.x, m.z) < 2.6 && !pl.vehicle;
      if (dist2D(pl.x, pl.z, m.x, m.z) < 12 && !pl.vehicle) g.hud.setHint(`${m.name} — ${m.desc}`); 
      if (near) { this.start(m); break; }
    }
    if (!this.markers.some(m => dist2D(pl.x, pl.z, m.x, m.z) < 12) && !pl.vehicle) g.hud.setHint('');
  }
  start(m) {
    const g = this.game; g.hud.setHint(''); g.hud.showBanner(m.name.toUpperCase(), m.desc, '#' + m.color.toString(16).padStart(6, '0'), 3500); g.audio.ui();
    const ctors = { race: RaceMission, taxi: TaxiMission, contract: ContractMission, hotwheels: HotWheelsMission, vigilante: VigilanteMission };
    this.active = new ctors[m.type](g, this, m);
  }
  pass(reward, note = '') {
    const g = this.game; this.active?.cleanup(); this.active = null; this.cooldown = 4; this.completed++; g.player.stats.missions++;
    g.player.money += reward; g.hud.moneyPop(reward); g.hud.showBanner('MISSION PASSED!', `${formatMoney(reward)} ${note}`, '#ffd24a', 5000); g.audio.missionPassed(); g.hud.setObjective(null); g.hud.setTimer(null);
  }
  fail(reason) {
    const g = this.game; this.active?.cleanup(); this.active = null; this.cooldown = 4;
    g.hud.showBanner('MISSION FAILED', reason, '#ff5050', 4000); g.hud.setObjective(null); g.hud.setTimer(null); g.audio.wasted();
  }
}

class Mission {
  constructor(game, mgr, def) { this.g = game; this.mgr = mgr; this.def = def; this.timer = null; }
  tick(dt) { if (this.timer != null) { this.timer -= dt; this.g.hud.setTimer(this.timer); if (this.timer <= 0) { this.mgr.fail('Out of time'); return false; } } return true; }
  cleanup() { this.g.hud.setHint(''); }
}

// Random road-side point (lane centre) far enough from a reference point.
function roadPoint(g, fromX, fromZ, minD, maxD) {
  const N = CITY.BLOCKS; const city = g.city;
  for (let k = 0; k < 40; k++) {
    const ix = Math.floor(Math.random() * (N + 1)), iz = Math.floor(Math.random() * (N + 1));
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]].filter(([dx, dz]) => ix + dx >= 0 && ix + dx <= N && iz + dz >= 0 && iz + dz <= N);
    const [dx, dz] = pick(dirs); const p = city.lanePoint(ix, iz, dx, dz, 1, rand(16, CITY.PITCH - 16)); p.heading = Math.atan2(dx, dz);
    const d = dist2D(p.x, p.z, fromX, fromZ); if (d >= minD && d <= maxD) return p;
  }
  return { x: 0, z: 0, heading: 0 };
}
function sidewalkPoint(g, fromX, fromZ, minD, maxD) {
  const city = g.city;
  for (let k = 0; k < 40; k++) {
    const b = pick(city.blocks); const side = Math.floor(Math.random() * 4); const t = rand(0.1, 0.9);
    const p = side === 0 ? { x: b.x0 + t * (b.x1 - b.x0), z: b.z0 - 1.5 } : side === 1 ? { x: b.x0 + t * (b.x1 - b.x0), z: b.z1 + 1.5 } : side === 2 ? { x: b.x0 - 1.5, z: b.z0 + t * (b.z1 - b.z0) } : { x: b.x1 + 1.5, z: b.z0 + t * (b.z1 - b.z0) };
    const d = dist2D(p.x, p.z, fromX, fromZ); if (d >= minD && d <= maxD) return p;
  }
  return { x: 0, z: 0 };
}

class RaceMission extends Mission {
  constructor(g, mgr, def) {
    super(g, mgr, def);
    this.cps = []; let px = def.x, pz = def.z;
    for (let i = 0; i < 7; i++) { const p = roadPoint(g, px, pz, 90, 170); this.cps.push(p); px = p.x; pz = p.z; }
    this.i = 0; this.timer = 100; this.state = g.player.vehicle ? 'go' : 'car'; this.showCp();
  }
  showCp() { const c = this.cps[this.i]; this.mgr.cpMesh.visible = true; this.mgr.cpMesh.position.set(c.x, this.g.city.groundHeight(c.x, c.z) + 3, c.z); this.g.hud.setObjective(`Checkpoint ${this.i + 1} / ${this.cps.length}`); }
  blips() { const c = this.cps[this.i]; return [{ x: c.x, z: c.z, color: '#ffd24a', kind: 'checkpoint', size: 7 }]; }
  update(dt) {
    if (!this.tick(dt)) return; const pl = this.g.player;
    if (!pl.vehicle) { this.g.hud.setObjective('Get in a vehicle!'); return; }
    this.g.hud.setObjective(`Checkpoint ${this.i + 1} / ${this.cps.length}`);
    const c = this.cps[this.i]; this.mgr.cpMesh.rotation.y += dt;
    if (dist2D(pl.x, pl.z, c.x, c.z) < 4.5) {
      this.g.audio.pickup(); this.i++; this.timer += 4;
      if (this.i >= this.cps.length) { const bonus = Math.floor(this.timer * 20); this.mgr.pass(1500 + bonus, `(+${formatMoney(bonus)} time bonus)`); return; }
      this.showCp();
    }
  }
  cleanup() { super.cleanup(); this.mgr.cpMesh.visible = false; }
}

class TaxiMission extends Mission {
  constructor(g, mgr, def) { super(g, mgr, def); this.fares = 0; this.total = 0; this.state = 'pickup'; this.spawnPassenger(); this.timer = null; }
  spawnPassenger() {
    const pl = this.g.player; const p = sidewalkPoint(this.g, pl.x, pl.z, 60, 140);
    this.pass = new Ped(this.g, p.x, p.z); this.pass.important = true; this.pass.waitT = 1e9; this.pass.heading = Math.random() * 6.28; this.g.peds.push(this.pass);
    this.state = 'pickup'; this.g.hud.setObjective('Pick up the passenger'); this.g.hud.setTimer(null); this.timer = null;
  }
  blips() { if (this.state === 'pickup') return [{ x: this.pass.x, z: this.pass.z, color: '#ffd24a', kind: 'target', size: 6 }]; return [{ x: this.dest.x, z: this.dest.z, color: '#ffd24a', kind: 'checkpoint', size: 7 }]; }
  update(dt) {
    const pl = this.g.player; if (!this.tick(dt)) return;
    if (!pl.vehicle) { this.g.hud.setObjective(this.state === 'pickup' ? 'Get a vehicle and pick up the passenger' : 'Get back in a vehicle!'); if (this.state === 'drive' && this.pass.vehicle) { /* passenger waits */ } return; }
    if (this.state === 'pickup') {
      if (this.pass.dead) { this.mgr.fail('Your passenger died'); return; }
      this.g.hud.setObjective('Pick up the passenger'); 
      if (dist2D(pl.x, pl.z, this.pass.x, this.pass.z) < 6 && pl.vehicle.absSpeed < 1.5) {
        this.pass.enterVehicle(pl.vehicle); pl.vehicle.driver = pl; this.pass.char.group.position.set(0.76, 0, 0); this.pass.vehicle = pl.vehicle; this.pass.isPassenger = true;
        this.dest = sidewalkPoint(this.g, pl.x, pl.z, 120, 260); this.state = 'drive'; this.timer = 25 + dist2D(pl.x, pl.z, this.dest.x, this.dest.z) / 9;
        this.mgr.cpMesh.visible = true; this.mgr.cpMesh.position.set(this.dest.x, this.g.city.groundHeight(this.dest.x, this.dest.z) + 3, this.dest.z); this.g.audio.ui();
      }
    } else {
      this.g.hud.setObjective(`Drop the passenger at the marker (fare ${this.fares + 1}/3)`);
      this.mgr.cpMesh.rotation.y += dt;
      if (this.pass.vehicle !== pl.vehicle) { this.mgr.fail('You lost your passenger'); return; }
      if (dist2D(pl.x, pl.z, this.dest.x, this.dest.z) < 6 && pl.vehicle.absSpeed < 1.5) {
        const fare = Math.floor(200 + this.timer * 12); this.total += fare; this.g.player.money += fare; this.g.hud.moneyPop(fare); this.g.audio.cash();
        this.pass.exitVehicle(); this.pass.vehicle = null; this.pass.important = false; this.pass.waitT = 0; this.pass.pickNav();
        this.fares++; this.mgr.cpMesh.visible = false;
        if (this.fares >= 3) { this.mgr.pass(800, `(fares ${formatMoney(this.total)})`); return; }
        this.spawnPassenger();
      }
    }
  }
  cleanup() { super.cleanup(); this.mgr.cpMesh.visible = false; if (this.pass) { this.pass.important = false; if (this.pass.vehicle) { this.pass.exitVehicle(); } this.pass.waitT = 0; if (!this.pass.dead) this.pass.pickNav(); } }
}

class ContractMission extends Mission {
  constructor(g, mgr, def) {
    super(g, mgr, def); const pl = g.player; const p = sidewalkPoint(g, pl.x, pl.z, 150, 300);
    this.target = new Ped(g, p.x, p.z, { shirt: 0x111111, pants: 0x111111 }); this.target.important = true; this.target.health = 140; this.target.runSpeed = 6.8; g.peds.push(this.target);
    this.timer = 150; g.hud.setObjective('Find and eliminate the target'); this.esc = 0;
  }
  blips() { return [{ x: this.target.x, z: this.target.z, color: '#ff5050', kind: 'target', size: 6 }]; }
  update(dt) {
    if (!this.tick(dt)) return; const pl = this.g.player, t = this.target;
    const d = dist2D(pl.x, pl.z, t.x, t.z);
    this.mgr.targetMarker.visible = !t.dead; this.mgr.targetMarker.position.set(t.x, t.y + 2.5 + Math.sin(this.g.time * 4) * 0.15, t.z); this.mgr.targetMarker.rotation.y += dt * 2;
    if (!t.dead && d < 30) { t.panic(pl.x, pl.z, 3); }
    if (t.dead) { this.mgr.pass(2500); return; }
    this.g.hud.setObjective(d < 40 ? 'Take the target down!' : 'Find the target (red blip)');
  }
  cleanup() { super.cleanup(); this.mgr.targetMarker.visible = false; if (this.target) this.target.important = false; }
}

class HotWheelsMission extends Mission {
  constructor(g, mgr, def) {
    super(g, mgr, def); const p = roadPoint(g, def.x, def.z, 200, 420);
    this.car = g.addVehicle('sports', p.x, p.z, p.heading); this.car.control = 'none'; this.car.isParked = true; this.car.mission = this;
    this.drop = { x: def.x + 14, z: def.z + 14 }; this.state = 'find'; this.timer = 180; this.startHealth = 100;
    this.mgr.cpMesh.visible = false; g.hud.setObjective('Steal the marked car');
  }
  blips() { return this.state === 'find' ? [{ x: this.car.x, z: this.car.z, color: '#50c8ff', kind: 'car', size: 6 }] : [{ x: this.drop.x, z: this.drop.z, color: '#50c8ff', kind: 'checkpoint', size: 7 }]; }
  update(dt) {
    if (!this.tick(dt)) return; const pl = this.g.player;
    if (this.car.destroyed) { this.mgr.fail('The car was destroyed'); return; }
    if (this.state === 'find') { if (pl.vehicle === this.car) { this.state = 'deliver'; this.g.hud.setObjective('Deliver the car to the chop shop'); this.mgr.cpMesh.visible = true; this.mgr.cpMesh.position.set(this.drop.x, this.g.city.groundHeight(this.drop.x, this.drop.z) + 3, this.drop.z); this.g.police.crime('carjack', pl.x, pl.z); } }
    else {
      this.mgr.cpMesh.rotation.y += dt;
      if (pl.vehicle !== this.car) this.g.hud.setObjective('Get back in the marked car!'); else this.g.hud.setObjective('Deliver the car to the chop shop');
      if (pl.vehicle === this.car && dist2D(pl.x, pl.z, this.drop.x, this.drop.z) < 6 && this.car.absSpeed < 1.5) {
        const cond = clamp(this.car.health / 100, 0, 1); const reward = Math.floor(1000 + 2000 * cond);
        pl.exitVehicle(true); this.g.removeVehicle(this.car); this.car = null;
        this.mgr.pass(reward, `(condition ${Math.round(cond * 100)}%)`);
      }
    }
  }
  cleanup() { super.cleanup(); this.mgr.cpMesh.visible = false; if (this.car && this.g.player.vehicle !== this.car) this.g.removeVehicle(this.car); else if (this.car) this.car.mission = null; }
}

class VigilanteMission extends Mission {
  constructor(g, mgr, def) { super(g, mgr, def); this.wave = 0; this.timer = null; this.suspect = null; this.nextWave(); }
  nextWave() {
    const g = this.g, pl = g.player; this.wave++;
    const p = roadPoint(g, pl.x, pl.z, 120, 220);
    const v = g.addVehicle(pick(['sedan', 'sports', 'pickup']), p.x, p.z, p.heading); g.traffic.adopt(v); v.ai.scared = 1e9; v.ai.cruise = 22 + this.wave * 2;
    const drv = new Ped(g, p.x, p.z, { shirt: 0x222222 }); drv.important = true; g.peds.push(drv); drv.enterVehicle(v); drv.health = 40;
    this.suspect = v; this.driver = drv; this.timer = 90;
    g.hud.setObjective(`Wave ${this.wave}/3 — stop the suspect vehicle`); g.hud.setTimer(this.timer);
  }
  blips() { return this.suspect ? [{ x: this.suspect.x, z: this.suspect.z, color: '#ff5050', kind: 'car', size: 6 }] : []; }
  update(dt) {
    if (!this.tick(dt)) return; const g = this.g, pl = g.player, v = this.suspect;
    if (!pl.vehicle || pl.vehicle.type.name !== 'police') { g.hud.setObjective('Get in a police cruiser!'); } else g.hud.setObjective(`Wave ${this.wave}/3 — stop the suspect vehicle`);
    if (v.ai) { v.ai.scared = 1e9; }
    // suspect bails when the car is wrecked & fights on foot
    const inCruiser = pl.vehicle?.type.name === 'police';
    const done = inCruiser && (v.destroyed || this.driver.dead || (v.health < 30 && v.absSpeed < 2 && dist2D(pl.x, pl.z, v.x, v.z) < 15));
    if (done) {
      if (!this.driver.dead && this.driver.vehicle) { this.driver.exitVehicle(); this.driver.panic(pl.x, pl.z, 10); }
      const reward = 600 * this.wave; pl.money += reward; g.hud.moneyPop(reward); g.audio.cash(); this.driver.important = false;
      if (v.mission) v.mission = null;
      if (this.wave >= 3) { this.mgr.pass(1500, '(vigilante bonus)'); return; }
      this.nextWave();
    }
  }
  cleanup() { super.cleanup(); if (this.driver) this.driver.important = false; }
}
