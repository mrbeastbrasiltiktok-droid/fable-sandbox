import * as THREE from 'three';
import { mulberry32, pick, rand } from '../core/Utils.js';

/**
 * Open-world loop: story missions, random crimes, rooftop checkpoint races, backpack collectibles,
 * XP / levels / skill picks. Also owns the getaway van used by chases.
 */
export class Missions {
  constructor(game) {
    this.game = game;
    this.city = game.city;
    this.rng = mulberry32(4242);
    this.level = 1; this.xp = 0; this.xpNext = 120;
    this.skillsTaken = new Set(); this.skillsList = [];
    this.story = this._buildStory();
    this.storyIdx = 0; this.active = null; this.storyDone = false;
    this.crime = null; this.crimeTimer = 40; this.crimesStopped = 0; this.jobsDone = 0; this.tracking = false;
    this.races = []; this.activeRace = null; this.racesWon = 0;
    this.backpacks = []; this.backpacksGot = 0;
    this.van = null;
    this.group = new THREE.Group(); game.scene.add(this.group);
    this._t = new THREE.Vector3();
    this.waypoint = null; this.waypointKind = '';
    this._buildRaces(); this._buildBackpacks();
    this.freeRoamHint = 0;
    game.combat.onKO = (e) => this.onEnemyKO(e);
  }

  // ---------- helpers ----------
  /** Roof centre of a random building with h in [min,max], within dist range of `from`. */
  roofPoint(from, minD, maxD, minH = 25, maxH = 400) {
    const ok = (b) => b.h >= minH && b.h <= maxH && !b.crown && b.w > 12 && b.d > 12;
    const dist = (b) => Math.hypot(b.x - from.x, b.z - from.z);
    let cands = this.city.buildings.filter((b) => ok(b) && dist(b) >= minD && dist(b) <= maxD);
    if (!cands.length) { // widen the ring, then relax height, then take the nearest sensible roof
      cands = this.city.buildings.filter((b) => ok(b) && dist(b) >= minD * 0.5 && dist(b) <= maxD * 1.6);
      if (!cands.length) cands = this.city.buildings.filter((b) => !b.crown && b.w > 12 && b.d > 12 && dist(b) >= minD * 0.5).sort((a, c) => dist(a) - dist(c)).slice(0, 8);
    }
    const b = cands[Math.floor(this.rng() * cands.length)];
    return new THREE.Vector3(b.x, b.h, b.z);
  }
  streetPoint(from, minD, maxD) {
    for (let i = 0; i < 60; i++) {
      const p = this.city.randomStreetPoint(this.rng);
      const d = Math.hypot(p.x - from.x, p.z - from.z);
      if (d >= minD && d <= maxD) return p;
    }
    return this.city.randomStreetPoint(this.rng);
  }
  addXP(n) {
    this.xp += n;
    this.game.hud.alert(`+${n} XP`, 'small gold');
    while (this.xp >= this.xpNext) { this.xp -= this.xpNext; this.level++; this.xpNext = Math.round(120 * Math.pow(this.level, 1.35)); this._levelUp(); }
  }
  _skillPool() {
    const P = this.game.player;
    return [
      { id: 'momentum', name: 'Web Momentum', desc: 'Pumping (W) mid-swing gives 40% more thrust.', apply: () => P.stats.swingBoost *= 1.4 },
      { id: 'dj', name: 'Air Launch', desc: 'Press SPACE in mid-air for a second jump.', apply: () => P.stats.doubleJump = true },
      { id: 'fists', name: 'Iron Fists', desc: 'Punches and kicks deal 30% more damage.', apply: () => P.stats.damageMul *= 1.3 },
      { id: 'flow', name: 'Focus Flow', desc: 'Build Focus 50% faster from hits and dodges.', apply: () => P.stats.focusGain *= 1.5 },
      { id: 'zip', name: 'Quick Zip', desc: 'Web-zip and web-strike travel 35% faster.', apply: () => P.stats.zipSpeed *= 1.35 },
      { id: 'vit', name: 'Spider Vitality', desc: '+30 max health and a full heal now.', apply: () => { P.maxHp += 30; P.hp = P.maxHp; } },
      { id: 'bomb', name: 'Extra Web Bomb', desc: 'Carry one more web bomb charge (key 1).', apply: () => { P.stats.bombCharges++; this.game.combat.bomb.charges++; } },
      { id: 'medic', name: 'Field Medic', desc: 'Healing (H) restores 60% more health.', apply: () => P.stats.healMul *= 1.6 },
    ];
  }
  _levelUp() {
    this.game.audio.levelUp();
    this.game.hud.banner(`LEVEL ${this.level}`, 'CHOOSE AN UPGRADE');
    const pool = this._skillPool().filter((s) => !this.skillsTaken.has(s.id) || s.id === 'fists' || s.id === 'flow' || s.id === 'vit');
    const opts = []; const src = pool.slice();
    while (opts.length < 3 && src.length) opts.push(src.splice(Math.floor(Math.random() * src.length), 1)[0]);
    this.game.pauseForUI(true);
    this.game.hud.showSkills(opts, (o) => { this.skillsTaken.add(o.id); this.skillsList.push(o.id); o.apply(); this.game.audio.ui(); this.game.pauseForUI(false); this.game.hud.alert(o.name.toUpperCase(), 'gold small'); this.save(); });
  }

  // ---------- persistence ----------
  static KEY = 'webslinger.save.v1';
  static hasSave() { try { return !!localStorage.getItem(Missions.KEY); } catch { return false; } }
  static clearSave() { try { localStorage.removeItem(Missions.KEY); } catch {} }
  save() {
    const P = this.game.player;
    const data = {
      level: this.level, xp: this.xp, xpNext: this.xpNext, skills: this.skillsList,
      storyIdx: this.storyIdx, storyDone: this.storyDone,
      backpacks: this.backpacks.map((b, i) => (b.got ? i : -1)).filter((i) => i >= 0),
      crimesStopped: this.crimesStopped, jobsDone: this.jobsDone, racesWon: this.racesWon, raceBests: this.races.map((r) => r.best),
      maxHp: P.maxHp, t: Date.now(),
    };
    try { localStorage.setItem(Missions.KEY, JSON.stringify(data)); } catch {}
  }
  load() {
    let d; try { d = JSON.parse(localStorage.getItem(Missions.KEY)); } catch { return false; }
    if (!d) return false;
    const P = this.game.player;
    this.level = d.level; this.xp = d.xp; this.xpNext = d.xpNext;
    const pool = this._skillPool();
    for (const id of d.skills || []) { const sk = pool.find((s) => s.id === id); if (sk) { sk.apply(); this.skillsTaken.add(id); this.skillsList.push(id); } }
    this.storyIdx = d.storyIdx; this.storyDone = d.storyDone; this.storyDelay = 3;
    for (const i of d.backpacks || []) { const b = this.backpacks[i]; if (b && !b.got) { b.got = true; this.backpacksGot++; this.group.remove(b.mesh); } }
    this.crimesStopped = d.crimesStopped; this.jobsDone = d.jobsDone || 0; this.racesWon = d.racesWon;
    (d.raceBests || []).forEach((b, i) => { if (this.races[i]) this.races[i].best = b; });
    if (d.maxHp) { P.maxHp = d.maxHp; P.hp = d.maxHp; }
    return true;
  }

  // ---------- markers (meshes) ----------
  _ring(color = 0xffd33a, r = 4) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.3, 10, 36), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6, roughness: 0.4 }));
    this.group.add(m); return m;
  }
  _beacon(pos, color = 0xffd33a) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 400, 12, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
    m.position.copy(pos); m.position.y += 200; this.group.add(m); return m;
  }

  // ---------- packages / photo markers ----------
  _package(pos) {
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 0.8, 1), new THREE.MeshStandardMaterial({ color: 0xc98a3a, emissive: 0xffa040, emissiveIntensity: 0.6, roughness: 0.7 }));
    box.position.y = 0.4; box.castShadow = true; g.add(box);
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.2, 1.04), new THREE.MeshStandardMaterial({ color: 0xffd33a, emissive: 0xffd33a, emissiveIntensity: 0.8 })); band.position.y = 0.4; g.add(band);
    g.add(this._beacon(new THREE.Vector3(0, 0, 0), 0xffd33a));
    g.position.copy(pos); this.group.add(g); return g;
  }
  _dropZone(pos) {
    const r = this._ring(0xffd33a, 3.5); r.position.copy(pos); r.position.y += 0.4; r.rotation.x = Math.PI / 2;
    r.add(this._beacon(new THREE.Vector3(0, 0, 0), 0xffd33a)); return r;
  }
  /** Delivery job: carry a package from A to B before the clock runs out. */
  _makeDelivery(from, opts = {}) {
    const pickup = opts.pickup || this.roofPoint(from, 120, 260, 20, 90);
    const drop = this.roofPoint(pickup, opts.minD ?? 300, opts.maxD ?? 520, 25, 200);
    const dist = pickup.distanceTo(drop);
    const d = { pickup, drop, phase: 'pickup', timer: 0, limit: Math.round(dist / (opts.pace ?? 11) + 12), mesh: this._package(pickup), zone: null, done: false, failed: false };
    return d;
  }
  _updateDelivery(d, dt, P) {
    if (d.phase === 'pickup') {
      d.mesh.rotation.y += dt;
      if (P.pos.distanceTo(d.pickup) < 4) {
        d.phase = 'deliver'; this.group.remove(d.mesh); d.zone = this._dropZone(d.drop);
        this.game.audio.pickup(); this.game.hud.alert(`PACKAGE PICKED UP · ${d.limit} s`, 'gold small');
      }
    } else {
      d.timer += dt; d.zone.rotation.z += dt * 2;
      if (P.pos.distanceTo(d.drop) < 5) { d.done = true; this.group.remove(d.zone); this.game.fx.burst(d.drop, 0xffd33a, 24, 5, 3); }
      else if (d.timer > d.limit) { d.failed = true; this.group.remove(d.zone); }
    }
  }
  _deliveryPos(d) { return d.phase === 'pickup' ? d.pickup : d.drop; }
  _deliveryText(d) { return d.phase === 'pickup' ? 'Pick up the package.' : `Deliver it! ${Math.max(0, Math.ceil(d.limit - d.timer))} s left`; }
  _cleanDelivery(d) { this.group.remove(d.mesh); if (d.zone) this.group.remove(d.zone); }

  /** Photo op: get to the vantage point and press P with the subject in frame. */
  _makePhoto(from) {
    const subject = this.roofPoint(from, 250, 500, 60, 400);
    const vantage = this.roofPoint(subject, 60, 140, 25, subject.y + 40);
    const spot = this._ring(0x5ac8fa, 2.5); spot.position.copy(vantage); spot.position.y += 0.4; spot.rotation.x = Math.PI / 2;
    spot.add(this._beacon(new THREE.Vector3(0, 0, 0), 0x5ac8fa));
    const subjMark = this._beacon(subject, 0xffd33a);
    return { subject, vantage, spot, subjMark, done: false };
  }
  _updatePhoto(ph, dt, P, input) {
    ph.spot.rotation.z += dt;
    const near = P.pos.distanceTo(ph.vantage) < 9;
    if (near && !ph.hinted) { ph.hinted = true; this.game.hud.hint('Frame the subject and press <kbd>P</kbd>', 5); }
    if (near && input.take('KeyP')) {
      // subject must be roughly in front of the camera
      const cam = this.game.camera.cam; const v = ph.subject.clone().project(cam);
      // the subject's beacon is a tall column, so only the horizontal framing matters
      if (v.z < 1 && Math.abs(v.x) < 0.85) { ph.done = true; this.group.remove(ph.spot); this.group.remove(ph.subjMark); this.game.audio.complete(); this.game.hud.alert('PHOTO TAKEN', 'gold small'); this.game.hud.damage(); }
      else this.game.hud.hint('Turn until the gold beacon is on screen, then <kbd>P</kbd>', 3);
    }
  }
  _cleanPhoto(ph) { this.group.remove(ph.spot); this.group.remove(ph.subjMark); }

  // ---------- backpacks ----------
  _buildBackpacks() {
    const cands = this.city.buildings.filter((b) => b.h > 30 && b.w > 12 && b.d > 12);
    const geo = new THREE.BoxGeometry(0.6, 0.8, 0.35);
    const mat = new THREE.MeshStandardMaterial({ color: 0xe0202c, emissive: 0xff4040, emissiveIntensity: 0.9, roughness: 0.6 });
    for (let i = 0; i < 40; i++) {
      const b = cands[Math.floor(this.rng() * cands.length)];
      const pos = new THREE.Vector3(b.x + (this.rng() - 0.5) * (b.w - 8), b.h + 0.5, b.z + (this.rng() - 0.5) * (b.d - 8));
      const mesh = new THREE.Mesh(geo, mat); mesh.position.copy(pos); mesh.castShadow = true;
      const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 6, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xff6060, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
      glow.position.y = 3; mesh.add(glow);
      this.group.add(mesh);
      this.backpacks.push({ pos, mesh, got: false });
    }
  }

  // ---------- races ----------
  _buildRaces() {
    const centers = [new THREE.Vector3(-300, 0, -200), new THREE.Vector3(350, 0, 150), new THREE.Vector3(-200, 0, 500), new THREE.Vector3(500, 0, -600)];
    centers.forEach((c, k) => {
      const start = this.roofPoint(c, 0, 300, 30, 120);
      const cps = []; let cur = start.clone(); let heading = Math.random() * Math.PI * 2;
      for (let i = 0; i < 7; i++) {
        heading += (this.rng() - 0.5) * 1.2;
        const d = 90 + this.rng() * 60;
        let p = new THREE.Vector3(cur.x + Math.sin(heading) * d, 0, cur.z + Math.cos(heading) * d);
        if (!this.city.inBounds(p.x, p.z, 80)) { heading += Math.PI; p.set(cur.x + Math.sin(heading) * d, 0, cur.z + Math.cos(heading) * d); }
        const h = this.city.heightAt(p.x, p.z);
        p.y = Math.max(h + 8, 22 + this.rng() * 30);
        cps.push(p); cur = p;
      }
      const startRing = this._ring(0x5ac8fa, 4); startRing.position.copy(start); startRing.position.y += 3; startRing.rotation.x = Math.PI / 2;
      const beacon = this._beacon(start, 0x5ac8fa);
      const cpRing = this._ring(0xffd33a, 4.5); cpRing.visible = false;
      this.races.push({ id: k, name: ['Harbor Dash', 'Midtown Sprint', 'Skyline Circuit', 'Downtown Drop'][k], start, cps, startRing, beacon, cpRing, par: 55 + cps.length * 4, best: null });
    });
  }
  _startRace(r) {
    this.activeRace = { race: r, idx: 0, t: 0 };
    r.startRing.visible = false; r.beacon.visible = false; r.cpRing.visible = true;
    this.game.hud.alert(`${r.name.toUpperCase()} — GO!`, 'gold');
    this.game.audio.alert();
  }
  _updateRace(dt, P) {
    const a = this.activeRace, r = a.race, cp = r.cps[a.idx];
    a.t += dt;
    r.cpRing.position.copy(cp); r.cpRing.lookAt(P.pos); r.cpRing.rotation.z += a.t * 2;
    if (P.pos.distanceTo(cp) < 6) {
      a.idx++; this.game.audio.pickup(); this.game.fx.burst(cp, 0xffd33a, 20, 5, 2);
      if (a.idx >= r.cps.length) {
        const gold = a.t <= r.par; const xp = gold ? 300 : 140;
        r.best = r.best === null ? a.t : Math.min(r.best, a.t);
        this.game.hud.banner(gold ? 'GOLD TIME' : 'RACE COMPLETE', `${a.t.toFixed(1)} s · PAR ${r.par} s`);
        this.game.audio.complete(); this.addXP(xp); this.racesWon++; this.save();
        r.startRing.visible = true; r.beacon.visible = true; r.cpRing.visible = false;
        this.activeRace = null;
      }
    }
    if (P.hp <= 0) { this.activeRace = null; r.startRing.visible = true; r.beacon.visible = true; r.cpRing.visible = false; }
  }

  // ---------- van (chase) ----------
  spawnVan(near) {
    const p = this.streetPoint(near, 120, 220);
    const body = new THREE.Group();
    const m1 = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.1, 5.6), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5, metalness: 0.4 })); m1.position.y = 1.35; m1.castShadow = true; body.add(m1);
    const m2 = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.8, 1.6), new THREE.MeshStandardMaterial({ color: 0xffd33a, emissive: 0xffd33a, emissiveIntensity: 0.4 })); m2.position.set(0, 2.85, 1.0); body.add(m2);
    const beacon = this._beacon(p, 0xe0202c); body.add(beacon); beacon.position.set(0, 200, 0);
    this.group.add(body);
    // heading along the street axis
    const onVertical = Math.abs(((p.x - this.city.originX) % this.city.PX)) < this.city.S;
    const dir = onVertical ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    this.van = { pos: p.clone(), dir, speed: 21, hp: 3, mesh: body, stopped: false, isVan: true, onTop: 0, takeHit: () => this._hitVan(), nextTurn: 0 };
    return this.van;
  }
  _hitVan() {
    const v = this.van; if (!v || v.stopped) return;
    v.hp--; this.game.hud.alert(v.hp > 0 ? `VAN HIT · ${v.hp} MORE` : 'VAN STOPPED', 'small');
    this.game.fx.burst(v.pos.clone().setY(2), 0xffd33a, 20, 6, 3);
    if (v.hp <= 0) { v.stopped = true; v.speed = 0; }
  }
  _updateVan(dt, P) {
    const v = this.van, c = this.city;
    if (v.stopped) return;
    // steer at intersections: street centre lines are at multiples of the period
    const nx = v.pos.x + v.dir.x * v.speed * dt, nz = v.pos.z + v.dir.z * v.speed * dt;
    const crossX = Math.floor((v.pos.x - c.originX) / c.PX) !== Math.floor((nx - c.originX) / c.PX);
    const crossZ = Math.floor((v.pos.z - c.originZ) / c.PZ) !== Math.floor((nz - c.originZ) / c.PZ);
    if ((v.dir.x !== 0 && crossX) || (v.dir.z !== 0 && crossZ)) {
      if (Math.random() < 0.45 || !c.inBounds(nx + v.dir.x * 120, nz + v.dir.z * 120, 40)) {
        // turn onto the cross street, snap to its centre
        const s = Math.random() < 0.5 ? 1 : -1;
        if (v.dir.x !== 0) { const cx = c.originX + Math.round((nx - c.originX) / c.PX) * c.PX; v.pos.x = cx - s * c.S * 0.22; v.dir.set(0, 0, s); }
        else { const cz = c.originZ + Math.round((nz - c.originZ) / c.PZ) * c.PZ; v.pos.z = cz + s * c.S * 0.22; v.dir.set(s, 0, 0); }
        if (!c.inBounds(v.pos.x + v.dir.x * 150, v.pos.z + v.dir.z * 150, 40)) v.dir.negate();
      }
    }
    v.pos.addScaledVector(v.dir, v.speed * dt);
    v.mesh.position.copy(v.pos); v.mesh.rotation.y = Math.atan2(v.dir.x, v.dir.z);
    // riding on the roof stops it too
    const dx = P.pos.x - v.pos.x, dz = P.pos.z - v.pos.z;
    if (Math.abs(dx) < 2 && Math.abs(dz) < 3.5 && P.pos.y > 2 && P.pos.y < 6) { v.onTop += dt; if (v.onTop > 1.5) { v.hp = 0; v.stopped = true; v.speed = 0; this.game.hud.alert('VAN STOPPED', 'small'); } }
  }
  removeVan() { if (this.van) { this.group.remove(this.van.mesh); this.van = null; } }
  strikeTargets() { return this.van && !this.van.stopped ? [this.van] : []; }

  // ---------- crimes ----------
  _spawnCrime(type) {
    const P = this.game.player;
    const kinds = {
      mugging: { title: 'MUGGING', desc: 'Thugs are shaking someone down. Take them out.', spec: [{ type: 'grunt', n: 3 }] },
      robbery: { title: 'ARMED ROBBERY', desc: 'Armed crew hitting a store. Gunmen first, then the shield.', spec: [{ type: 'grunt', n: 2 }, { type: 'ranged', n: 2 }, { type: 'shield', n: 1 }] },
      brawl: { title: 'GANG BRAWL', desc: 'A brute is leading a crew. Web him up (R) before you swing.', spec: [{ type: 'brute', n: 1 }, { type: 'grunt', n: 3 }] },
      chase: { title: 'GETAWAY VAN', desc: 'Catch the van: web-strike it (F) three times or ride its roof.', van: true },
      rescue: { title: 'RESCUE', desc: 'A hostage has 60 seconds. Get there and clear the thugs.', spec: [{ type: 'grunt', n: 2 }, { type: 'ranged', n: 1 }], timer: 60 },
      delivery: { title: 'COURIER JOB', desc: 'Grab the package and swing it across town before the clock runs out.', delivery: true },
      rush: { title: 'MEDICAL RUSH', desc: 'An organ cooler needs to reach the hospital roof. Fast.', delivery: true, pace: 15 },
      photo: { title: 'PHOTO OP', desc: 'The Bugle wants a shot. Get to the vantage point and frame the beacon (P).', photo: true },
    };
    const k = kinds[type];
    const c = { type, ...k, pos: null, group: null, timer: k.timer ?? 150, expires: 150, done: false };
    if (k.van) { const v = this.spawnVan(P.pos); c.pos = v.pos; }
    else if (k.delivery) { c.job = this._makeDelivery(P.pos, { pace: k.pace }); c.pos = c.job.pickup; c.expires = 240; }
    else if (k.photo) { c.job = this._makePhoto(P.pos); c.pos = c.job.vantage; c.expires = 240; }
    else { c.pos = this.streetPoint(P.pos, 260, 650); c.group = this.game.combat.spawnGroup(c.pos, k.spec); }
    c.beacon = (k.van || k.delivery || k.photo) ? null : this._beacon(c.pos, 0xe0202c);
    this.crime = c;
    this.game.hud.alert(k.delivery || k.photo ? `NEW JOB: ${k.title}` : `${k.title} IN PROGRESS`, k.delivery || k.photo ? 'gold' : '');
    this.game.hud.hint('Press <kbd>TAB</kbd> to track it', 4);
    this.game.audio.alert();
  }
  _updateCrime(dt, P, input) {
    const c = this.crime;
    if (c.delivery) {
      this._updateDelivery(c.job, dt, P); c.pos = this._deliveryPos(c.job); c.desc = this._deliveryText(c.job);
      if (c.job.done) return this._endCrime(true); if (c.job.failed) return this._endCrime(false);
    }
    if (c.photo) {
      this._updatePhoto(c.job, dt, P, input);
      if (c.job.done) return this._endCrime(true);
    }
    if (c.van) {
      c.pos = this.van.pos;
      if (this.van.stopped && !c.group) { c.group = this.game.combat.spawnGroup(this.van.pos, [{ type: 'grunt', n: 3 }], { radius: 5 }); c.desc = 'The crew bailed out. Finish them.'; }
    }
    if (c.timer !== undefined && c.type === 'rescue') { c.timer -= dt; if (c.timer <= 0) return this._endCrime(false); }
    c.expires -= dt; if (c.expires <= 0 && (!c.group || c.group.alive() === c.group.enemies.length)) return this._endCrime(false);
    if (c.group && c.group.alive() === 0) return this._endCrime(true);
  }
  _endCrime(success) {
    const c = this.crime; this.crime = null; this.tracking = false;
    if (c.beacon) this.group.remove(c.beacon);
    if (c.van) this.removeVan();
    if (c.delivery) this._cleanDelivery(c.job);
    if (c.photo) this._cleanPhoto(c.job);
    const civic = c.delivery || c.photo;
    if (success) { if (!civic) this.crimesStopped++; else this.jobsDone++; this.game.hud.banner(civic ? 'JOB DONE' : 'CRIME STOPPED', c.title); this.game.audio.complete(); this.addXP(c.type === 'brawl' ? 180 : c.type === 'rush' ? 160 : 110); this.save(); }
    else { this.game.hud.alert(civic ? 'JOB FAILED' : 'THEY GOT AWAY', 'small'); if (c.group) for (const e of c.group.enemies) if (e.alive) { e.alive = false; e.dead = true; } }
    this.crimeTimer = 70 + Math.random() * 70;
  }

  // ---------- story ----------
  _buildStory() {
    const G = this.game;
    const M = [];
    // 1 — traversal tutorial, three steps from the street
    M.push({
      title: 'GET YOUR LEGS', desc: 'Run to the marker. WASD moves, SHIFT sprints, SPACE jumps.',
      start: (m) => {
        const P = G.player, c = this.city;
        m.step = 0;
        m.t1 = P.pos.clone().add(new THREE.Vector3(0, 0, 42)); m.t1.y = 0.5;   // down the street
        m.t2 = this.roofPoint(P.pos, 300, 420, 35, 110);                         // a rooftop
        m.beacon = this._beacon(m.t1, 0xffd33a);
        G.hud.hint('Move with <kbd>WASD</kbd> · look with the mouse · <kbd>C</kbd> shows all controls', 7);
      },
      waypoint: (m) => m.step === 0 ? m.t1 : m.step === 1 ? m.t2 : m.t3,
      update: (m, dt) => {
        const P = G.player;
        if (m.step === 0 && P.pos.distanceTo(m.t1) < 5) {
          m.step = 1; m.desc = 'Now swing: HOLD RIGHT MOUSE, release near the bottom of the arc. Reach the rooftop marker.';
          this.group.remove(m.beacon); m.beacon = this._beacon(m.t2, 0xffd33a);
          G.hud.hint('Hold <kbd>RMB</kbd> to swing · <kbd>W</kbd> to pump · <kbd>SPACE</kbd> to jump-release · walls auto wall-run', 9);
          G.audio.pickup(); this.addXP(20);
        } else if (m.step === 1 && P.pos.distanceTo(m.t2) < 14) {
          m.step = 2; m.desc = 'Zip: aim at the next rooftop marker and press E. Press E again mid-zip to chain.';
          m.t3 = this.roofPoint(m.t2, 45, 90, 20, m.t2.y + 25);
          this.group.remove(m.beacon); m.beacon = this._beacon(m.t3, 0xffd33a);
          G.hud.hint('Aim at the marker and press <kbd>E</kbd> · hold <kbd>SPACE</kbd> at a wall to launch over it', 9);
          G.audio.pickup(); this.addXP(40);
        } else if (m.step === 2 && P.pos.distanceTo(m.t3) < 12) return true;
        return false;
      },
      end: (m) => { this.group.remove(m.beacon); this.addXP(80); },
    });
    // 2 — first fight
    M.push({
      title: 'STREET JUSTICE', desc: 'A mugging nearby. LMB to attack, Q to dodge when your spider-sense flashes.',
      start: (m) => { m.pos = this.streetPoint(G.player.pos, 140, 260); m.group = G.combat.spawnGroup(m.pos, [{ type: 'grunt', n: 3 }]); m.beacon = this._beacon(m.pos, 0xe0202c); },
      waypoint: (m) => m.group.alive() ? (m.group.enemies.find((e) => e.alive)?.pos || m.pos) : m.pos, kind: 'crime',
      update: (m) => { if (m.group.alive() < 3 && !m.h1) { m.h1 = true; G.hud.hint('4th hit launches · <kbd>F</kbd> web-strikes from range · <kbd>G</kbd> finisher with full Focus', 6); } return m.group.alive() === 0; },
      end: (m) => { this.group.remove(m.beacon); this.addXP(150); this.crimesStopped++; },
    });
    // 3 — race
    M.push({
      title: 'ROOFTOP RUN', desc: 'Traversal is the point. Enter the blue ring to start a checkpoint race.',
      start: (m) => { m.race = this.races.reduce((a, r) => r.start.distanceTo(G.player.pos) < a.start.distanceTo(G.player.pos) ? r : a); m.doneRaces = this.racesWon; },
      waypoint: (m) => this.activeRace ? null : m.race.start,
      update: (m) => this.racesWon > m.doneRaces,
      end: () => { G.hud.hint('Race rings stay in the city — beat the par time for GOLD', 5); },
    });
    // 4 — delivery
    M.push({
      title: 'SPECIAL DELIVERY', desc: 'A courier job: pick up the package, then swing it across town before the clock runs out.',
      start: (m) => { m.job = this._makeDelivery(G.player.pos, { minD: 320, maxD: 480 }); },
      waypoint: (m) => this._deliveryPos(m.job),
      update: (m, dt) => { this._updateDelivery(m.job, dt, G.player); m.desc = this._deliveryText(m.job); if (m.job.failed) { this._cleanDelivery(m.job); m.job = this._makeDelivery(G.player.pos, { minD: 320, maxD: 480 }); G.hud.alert('TOO SLOW — NEW PACKAGE', 'small'); } return m.job.done; },
      end: (m) => { this._cleanDelivery(m.job); this.addXP(180); this.jobsDone++; },
    });
    // 5 — robbery
    M.push({
      title: 'ARMED AND DANGEROUS', desc: 'Gunmen and a shield. Web-shoot (R) gunmen, hit shields from behind or with F.',
      start: (m) => { m.pos = this.streetPoint(G.player.pos, 250, 450); m.group = G.combat.spawnGroup(m.pos, [{ type: 'grunt', n: 2 }, { type: 'ranged', n: 2 }, { type: 'shield', n: 1 }]); m.beacon = this._beacon(m.pos, 0xe0202c); },
      waypoint: (m) => m.group.alive() ? (m.group.enemies.find((e) => e.alive)?.pos || m.pos) : m.pos, kind: 'crime',
      update: (m) => m.group.alive() === 0,
      end: (m) => { this.group.remove(m.beacon); this.addXP(220); this.crimesStopped++; },
    });
    // 6 — photo op
    M.push({
      title: 'FRONT PAGE', desc: 'The Bugle needs a skyline shot. Get to the blue vantage ring, frame the gold beacon, press P.',
      start: (m) => { m.job = this._makePhoto(G.player.pos); },
      waypoint: (m) => m.job.vantage,
      update: (m, dt) => { this._updatePhoto(m.job, dt, G.player, this._input); return m.job.done; },
      end: (m) => { this.addXP(160); this.jobsDone++; },
    });
    // 7 — chase
    M.push({
      title: 'HOT PURSUIT', desc: 'A getaway van is on the move. Web-strike it (F) three times or ride its roof.',
      start: (m) => { m.van = this.spawnVan(G.player.pos); m.group = null; },
      waypoint: (m) => m.group ? (m.group.enemies.find((e) => e.alive)?.pos || this.van?.pos) : this.van?.pos, kind: 'crime',
      update: (m) => {
        if (this.van?.stopped && !m.group) { m.group = G.combat.spawnGroup(this.van.pos, [{ type: 'grunt', n: 3 }], { radius: 5 }); m.desc = 'They bailed out. Clean up.'; }
        return m.group && m.group.alive() === 0;
      },
      end: () => { this.removeVan(); this.addXP(260); this.crimesStopped++; },
    });
    // 6 — backpacks
    M.push({
      title: 'LOST AND FOUND', desc: 'Old backpacks are stashed on rooftops. Grab 4 — they show on the minimap.',
      start: (m) => { m.base = this.backpacksGot; },
      waypoint: () => this._nearestBackpack(), 
      update: (m) => this.backpacksGot - m.base >= 4,
      end: () => { this.addXP(200); },
    });
    // 7 — finale
    M.push({
      title: 'THE BIG ONE', desc: 'The gang leader is on the tallest roof with his brutes. Web brutes (R), finish them (G) with two bars.',
      start: (m) => { const b = this.city.buildings.reduce((a, x) => (x.h > a.h && !x.crown ? x : a)); m.pos = new THREE.Vector3(b.x, b.h, b.z); m.group = G.combat.spawnGroup(m.pos, [{ type: 'brute', n: 2 }, { type: 'grunt', n: 4 }, { type: 'ranged', n: 2 }], { radius: 9 }); m.beacon = this._beacon(m.pos, 0xe0202c); },
      waypoint: (m) => m.group.alive() ? (m.group.enemies.find((e) => e.alive)?.pos || m.pos) : m.pos, kind: 'crime',
      update: (m) => m.group.alive() === 0,
      end: (m) => { this.group.remove(m.beacon); this.addXP(600); this.crimesStopped++; G.hud.banner('CITY SAVED', 'FREE ROAM UNLOCKED — CRIMES, RACES, BACKPACKS'); this.storyDone = true; },
    });
    return M;
  }
  _nearestBackpack() {
    const P = this.game.player; let best = null, bd = Infinity;
    for (const b of this.backpacks) if (!b.got) { const d = b.pos.distanceTo(P.pos); if (d < bd) { bd = d; best = b.pos; } }
    return best;
  }
  _startStory(i) {
    const m = this.story[i]; if (!m) return;
    this.active = { def: m, state: { desc: m.desc } };
    m.start(this.active.state);
    this.game.hud.alert(m.title, 'gold');
    this.game.audio.alert();
  }

  onEnemyKO(e) { this.addXP(e.cfg.heavy ? 60 : e.cfg.shield ? 30 : 20); }

  // ---------- update ----------
  update(dt, input) {
    const P = this.game.player, hud = this.game.hud;
    this._input = input;
    // story
    if (!this.active && !this.storyDone) { this.storyDelay = (this.storyDelay ?? 2) - dt; if (this.storyDelay <= 0) { this._startStory(this.storyIdx); } }
    if (this.active) {
      const { def, state } = this.active;
      if (def.update(state, dt)) {
        def.end(state); this.active = null; this.storyIdx++; this.storyDelay = 4; this.save();
        if (!this.storyDone) { hud.banner('MISSION COMPLETE', def.title); this.game.audio.complete(); }
      }
    }
    // races
    if (this.activeRace) this._updateRace(dt, P);
    else for (const r of this.races) { r.startRing.rotation.z += dt; if (P.pos.distanceTo(r.start) < 6 && P.pos.y > r.start.y - 2 && this.storyIdx >= 2) { this._startRace(r); break; } }
    // backpacks
    for (const b of this.backpacks) {
      if (b.got) continue;
      b.mesh.rotation.y += dt * 1.5; b.mesh.position.y = b.pos.y + Math.sin(this.game.time * 2 + b.pos.x) * 0.15;
      if (P.pos.distanceTo(b.pos) < 2.6) { b.got = true; this.backpacksGot++; this.group.remove(b.mesh); this.game.audio.pickup(); this.game.fx.burst(b.pos, 0xff6060, 14, 3, 3); this.addXP(25); hud.alert(`BACKPACK ${this.backpacksGot}/40`, 'small'); this.save(); }
    }
    // van
    if (this.van) this._updateVan(dt, P);
    // crimes
    const storyCombat = this.active && (this.active.state.group || this.active.def.title === 'HOT PURSUIT');
    if (this.crime) this._updateCrime(dt, P, input);
    else if (this.storyIdx >= 2 && !storyCombat) { this.crimeTimer -= dt; if (this.crimeTimer <= 0) this._spawnCrime(pick(['mugging', 'robbery', 'chase', 'rescue', 'brawl', 'delivery', 'rush', 'photo'])); }
    if (input.take('Tab') && this.crime) { this.tracking = !this.tracking; hud.hint(this.tracking ? 'Tracking crime' : 'Tracking mission', 1); }

    // waypoint priority
    this.waypoint = null; this.waypointKind = '';
    if (this.activeRace) { this.waypoint = this.activeRace.race.cps[this.activeRace.idx]; this.waypointKind = 'race'; }
    else if (this.crime && (this.tracking || !this.active)) { this.waypoint = this.crime.pos; this.waypointKind = 'crime'; }
    else if (this.active) { this.waypoint = this.active.def.waypoint(this.active.state); this.waypointKind = this.active.def.kind || ''; }
    else { const nb = this._nearestBackpack(); if (nb && nb.distanceTo(P.pos) < 140) { this.waypoint = nb; this.waypointKind = 'backpack'; } }

    // mission panel
    if (this.activeRace) { const a = this.activeRace; hud.setMission(a.race.name.toUpperCase(), `Checkpoint ${a.idx + 1}/${a.race.cps.length} · ${a.t.toFixed(1)} s · par ${a.race.par} s`); }
    else if (this.crime && (this.tracking || !this.active)) { const c = this.crime; hud.setMission(c.title, c.desc + (c.type === 'rescue' ? ` · ${Math.ceil(c.timer)} s` : '')); }
    else if (this.active) hud.setMission(this.active.def.title, this.active.state.desc);
    else hud.setMission(this.storyDone ? 'FREE ROAM' : 'STAND BY', `Backpacks ${this.backpacksGot}/40 · Crimes ${this.crimesStopped} · Jobs ${this.jobsDone} · Races ${this.racesWon}`);
  }

  markers(out) {
    if (this.active?.state.job?.pickup) { const j = this.active.state.job; out.push({ x: this._deliveryPos(j).x, z: this._deliveryPos(j).z, color: '#ffd33a', r: 5 }); }
    for (const b of this.backpacks) if (!b.got) out.push({ x: b.pos.x, z: b.pos.z, color: '#ff8080', r: 3 });
    for (const r of this.races) if (!this.activeRace) out.push({ x: r.start.x, z: r.start.z, color: '#5ac8fa', r: 4 });
    if (this.crime) out.push({ x: this.crime.pos.x, z: this.crime.pos.z, color: '#ff3030', r: 6 });
    if (this.waypoint) out.push({ x: this.waypoint.x, z: this.waypoint.z, color: '#ffd33a', r: 5 });
    return out;
  }
}
