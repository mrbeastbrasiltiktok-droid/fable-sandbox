import * as THREE from 'three';
import { Character } from './character.js';
import { resolveCircle } from './physics.js';
import { collideWithVehicles } from './peds.js';
import { WEAPONS, WEAPON_ORDER, fireWeapon, castBullet } from './weapons.js';
import { PLAYER, CITY } from './config.js';
import { clamp, damp, angleDamp, dist2D, wrapAngle, lerp } from './utils.js';

const _f = new THREE.Vector3(), _o = new THREE.Vector3(), _d = new THREE.Vector3(), _w = new THREE.Vector3();

export class Player {
  constructor(game) {
    this.game = game; this.kind = 'player';
    this.char = new Character({ kind: 'player' }); game.scene.add(this.char.group);
    this.x = 0; this.y = 0; this.z = 0; this.heading = 0; this.vy = 0; this.onGround = true; this.radius = PLAYER.RADIUS;
    this.vx = 0; this.vz = 0; this.speed = 0; this.moveX = 0; this.moveZ = 0;
    this.health = PLAYER.MAX_HEALTH; this.armor = 0; this.money = 250; this.dead = false; this.deadT = 0; this.busted = false;
    this.vehicle = null; this.aiming = false; this.fireT = 0; this.punchT = 0; this.knockT = 0; this.enterT = 0; this.wantedVehicle = null;
    this.ammo = { pistol: 60 }; this.currentWeapon = 'pistol'; this.weaponSwitchT = 0;
    this.lastCrimeT = 0; this.swimming = false; this.invulnT = 0; this.respawnT = 0; this.damageFlash = 0; this.stats = { kills: 0, carsStolen: 0, missions: 0 }; this.talkT = 0;
  }
  get pos() { return { x: this.x, y: this.y, z: this.z }; }
  get absSpeed() { return this.vehicle ? this.vehicle.absSpeed : Math.hypot(this.vx, this.vz); }
  has(w) { return w === 'fist' || (this.ammo[w] ?? 0) > 0; }
  giveWeapon(w, amount) { this.ammo[w] = (this.ammo[w] || 0) + amount; if (this.currentWeapon === 'fist' || this.currentWeapon === w) this.currentWeapon = w; }
  cycleWeapon(dir) {
    const list = WEAPON_ORDER.filter(w => this.has(w)); let i = list.indexOf(this.currentWeapon); if (i < 0) i = 0;
    i = (i + dir + list.length) % list.length; this.currentWeapon = list[i]; this.weaponSwitchT = 2; this.game.audio.ui();
  }
  setPosition(x, z, heading = 0) { this.x = x; this.z = z; this.y = this.game.city.groundHeight(x, z); this.heading = heading; this.vx = this.vz = 0; this.syncMesh(); }
  syncMesh() { if (this.vehicle) return; this.char.group.position.set(this.x, this.y, this.z); this.char.group.rotation.y = this.heading; }

  takeDamage(amount, source, kind = 'bullet') {
    if (this.dead || this.invulnT > 0) return;
    if (this.armor > 0) { const a = Math.min(this.armor, amount * 0.7); this.armor -= a; amount -= a; }
    this.health -= amount; this.damageFlash = 1; this.sinceHurt = 0; this.game.rig.addShake(0.2 + Math.min(0.5, amount / 40));
    if (kind === 'bullet') this.game.effects.blood(this.x, this.y + 1, this.z, 4);
    if (this.health <= 0) this.die();
  }
  knock(vx, vz, dmg) { if (this.dead) return; this.vx = vx; this.vz = vz; this.vy = 4; this.knockT = 1.6; this.char.state.dead = true; this.char.deadT = 0; this.char.deadDir = 1; this.game.audio.thud(); this.takeDamage(dmg, null, 'impact'); }
  die() {
    if (this.dead) return; this.dead = true; this.deadT = 0; this.char.state.dead = true; this.char.deadT = 0; this.aiming = false;
    if (this.vehicle) this.exitVehicle(true);
    this.game.onPlayerWasted();
  }
  arrest() { if (this.dead || this.busted) return; this.busted = true; this.deadT = 0; if (this.vehicle) this.exitVehicle(true); this.game.onPlayerBusted(); }
  respawn(x, z, heading) {
    this.dead = false; this.busted = false; this.knockT = 0; this.char.state.dead = false; this.char.deadT = 0; this.health = PLAYER.MAX_HEALTH; this.invulnT = 2;
    this.setPosition(x, z, heading); this.game.rig.snapBehind(heading);
  }

  update(dt) {
    const g = this.game, input = g.input;
    this.invulnT = Math.max(0, this.invulnT - dt); this.damageFlash = Math.max(0, this.damageFlash - dt * 2); this.weaponSwitchT = Math.max(0, this.weaponSwitchT - dt);
    this.sinceHurt = (this.sinceHurt || 0) + dt; if (!this.dead && this.sinceHurt > 5 && this.health < 50) this.health = Math.min(50, this.health + 4 * dt);
    if (this.dead || this.busted) { this.deadT += dt; this.updateBody(dt, true); return; }
    // weapon selection
    if (input.mouse.wheel !== 0) this.cycleWeapon(input.mouse.wheel > 0 ? 1 : -1);
    if (input.hit('nextWeapon')) this.cycleWeapon(1);
    if (!g.stores.shopOpen) for (let i = 0; i < WEAPON_ORDER.length; i++) if (input.hitCode('Digit' + (i + 1)) && this.has(WEAPON_ORDER[i])) { this.currentWeapon = WEAPON_ORDER[i]; this.weaponSwitchT = 2; }
    this.fireT = Math.max(0, this.fireT - dt);
    if (this.vehicle) this.updateInVehicle(dt); else this.updateOnFoot(dt);
  }

  updateOnFoot(dt) {
    const g = this.game, input = g.input, city = g.city, cs = this.char.state;
    // enter vehicle
    if (this.enterT > 0) { this.enterT -= dt; if (this.enterT <= 0 && this.wantedVehicle) this.finishEnter(); this.updateBody(dt, false, 0); return; }
    if (input.hit('enter')) { const v = this.nearestVehicle(4.5); if (v) this.beginEnter(v); }
    if (input.hit('interact') && !g.stores.shopOpen) { const p = this.nearestPed(2.6); if (p) { const line = p.talk(this); if (line) { this.talkT = 3; setTimeout(() => { if (!this.dead) g.hud.speak(this, ['Hey.', "What's up?", 'Sup.', 'Sure.', 'Alright then.', 'Yeah, yeah.'][Math.floor(Math.random() * 6)], 2000); }, 1200); } } }
    // knocked down: ragdoll-ish
    if (this.knockT > 0) { this.knockT -= dt; this.updateBody(dt, true); if (this.knockT <= 0) { cs.dead = false; } return; }
    // movement input relative to camera
    const fwd = g.rig.forward(_f); const rx = -fwd.z, rz = fwd.x;
    const ix = input.axis('left', 'right'), iz = input.axis('back', 'forward');
    let mx = fwd.x * iz + rx * ix, mz = fwd.z * iz + rz * ix; const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
    const wasAiming = this.aiming;
    this.aiming = input.mouse.right && this.currentWeapon !== 'fist';
    if (this.aiming) this.aimAssist(dt, !wasAiming); else g.aimTarget = null;
    this.firePoseT = Math.max(0, (this.firePoseT || 0) - dt);
    this.char.setWeapon(this.currentWeapon);
    this.swimming = city.isWater(this.x, this.z);
    const sprint = input.down('sprint') && !this.aiming && !this.swimming;
    const maxSpeed = this.swimming ? PLAYER.SWIM : this.aiming ? PLAYER.WALK * 1.3 : sprint ? PLAYER.SPRINT : PLAYER.RUN;
    const tvx = mx * maxSpeed, tvz = mz * maxSpeed;
    const acc = this.onGround ? PLAYER.ACCEL : 8;
    this.vx = damp(this.vx, tvx, acc / 3, dt); this.vz = damp(this.vz, tvz, acc / 3, dt);
    // facing
    if (this.aiming || this.firePoseT > 0) { this.heading = angleDamp(this.heading, Math.atan2(fwd.x, fwd.z), 20, dt); }
    else if (ml > 0.1) this.heading = angleDamp(this.heading, Math.atan2(mx, mz), 12, dt);
    // jump / gravity
    const gh = city.groundHeight(this.x, this.z);
    if (this.swimming) { this.y = damp(this.y, -1.1, 6, dt); this.onGround = true; this.vy = 0; }
    else {
      if (this.onGround && input.hit('jump')) { this.vy = PLAYER.JUMP; this.onGround = false; }
      this.vy -= PLAYER.GRAVITY * dt; this.y += this.vy * dt;
      if (this.y <= gh) { this.y = gh; this.vy = 0; this.onGround = true; } else this.onGround = false;
    }
    this.x += this.vx * dt; this.z += this.vz * dt;
    resolveCircle(city.hash, this, this.radius, 2, this.y);
    collideWithVehicles(this, g.vehicles, (v, rel, nx, nz) => { if (this.knockT <= 0 && this.invulnT <= 0) { this.knock(v.vx * 0.9 + nx * 2, v.vz * 0.9 + nz * 2, rel * 3); v.driver?.kind === 'cop' && g.police.noteRam(); } });
    if (!g.stores.interior) { const lim = CITY.WATER + 30; this.x = clamp(this.x, -lim, lim); this.z = clamp(this.z, -lim, lim); }
    // combat
    this.updateCombat(dt, fwd);
    // animation
    const sp = Math.hypot(this.vx, this.vz);
    cs.move = damp(cs.move, clamp(sp / PLAYER.WALK, 0, 1), 12, dt); cs.run = damp(cs.run, clamp((sp - PLAYER.WALK) / (PLAYER.SPRINT - PLAYER.WALK), 0, 1), 8, dt);
    cs.aiming = this.aiming; cs.firePose = this.firePoseT; cs.aimPitch = -g.rig.pitch + 0.05; cs.airborne = !this.onGround && !this.swimming; cs.swim = this.swimming; cs.hasWeapon = this.currentWeapon !== 'fist'; cs.weaponLong = !!WEAPONS[this.currentWeapon].long; cs.sitting = false;
    this.punchT = Math.max(0, this.punchT - dt * 3); cs.punch = this.punchT;
    this.char.animate(dt); this.syncMesh(); this.speed = sp;
  }

  updateCombat(dt, fwd) {
    const g = this.game, input = g.input; const w = WEAPONS[this.currentWeapon];
    const wantFire = w.auto ? input.mouse.left : input.mouse.leftPressed;
    if (!wantFire || this.fireT > 0) return;
    if (w.melee) {
      this.fireT = w.rate; this.punchT = 1; g.audio.punch();
      // hit nearest ped in front
      for (const p of [...g.peds]) { if (p.dead) continue; const d = dist2D(p.x, p.z, this.x, this.z); if (d > 2.0) continue; const ang = Math.atan2(p.x - this.x, p.z - this.z); if (Math.abs(wrapAngle(ang - this.heading)) > 1.0) continue; p.hurt(w.damage, this, _d.set(Math.sin(this.heading), 0, Math.cos(this.heading))); p.vx = Math.sin(this.heading) * 3; p.vz = Math.cos(this.heading) * 3; g.effects.blood(p.x, p.y + 1.2, p.z, 3); g.crime('assault', this.x, this.z); break; }
      return;
    }
    if ((this.ammo[this.currentWeapon] || 0) <= 0) { this.currentWeapon = 'fist'; return; }
    this.fireT = w.rate; this.ammo[this.currentWeapon]--;
    // aim: from camera through the crosshair; origin at the muzzle
    const cam = g.camera; _d.set(0, 0, -1).applyQuaternion(cam.quaternion);
    // find where the camera ray hits, then shoot from the muzzle towards that point (so bullets go where the crosshair is)
    const camHit = castBullet(g, cam.position, _d, w.range + 10, this);
    if (!this.vehicle && !this.aiming) { this.firePoseT = 0.7; }
    if (!this.vehicle) { this.char.state.aimPitch = -g.rig.pitch + 0.05; this.char.state.firePose = 1; this.char.animate(0.05); }
    this.char.group.updateMatrixWorld(true); this.char.muzzle.getWorldPosition(_o);
    if (this.vehicle) { _o.set(this.x + Math.sin(this.heading) * 0.3, this.y + 1.2, this.z + Math.cos(this.heading) * 0.3); }
    _w.copy(camHit.point).sub(_o); if (_w.length() < 1.5) _w.copy(_d); _w.normalize();
    fireWeapon(g, this, this.currentWeapon, _o.clone(), _w);
    g.rig.recoil += w.recoil * 0.06; g.rig.addShake(w.recoil * 0.15);
    g.crime('gunfire', this.x, this.z);
    if (this.ammo[this.currentWeapon] <= 0) setTimeout(() => { if (this.ammo[this.currentWeapon] <= 0) this.currentWeapon = 'fist'; }, 300);
  }

  updateBody(dt, ragdoll, _spd) {
    const city = this.game.city;
    if (ragdoll) {
      this.vy -= PLAYER.GRAVITY * dt; this.y += this.vy * dt; const gh = city.groundHeight(this.x, this.z); if (this.y < gh) { this.y = gh; this.vy = 0; this.vx *= 0.5; this.vz *= 0.5; }
      this.x += this.vx * dt; this.z += this.vz * dt; this.vx *= Math.exp(-3 * dt); this.vz *= Math.exp(-3 * dt);
      resolveCircle(city.hash, this, this.radius, 2, this.y);
    }
    this.char.animate(dt); this.syncMesh();
  }

  nearestPed(r) {
    let best = null, bd = r;
    for (const p of this.game.peds) { if (p.dead || p.vehicle) continue; const d = dist2D(p.x, p.z, this.x, this.z); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  // GTA-style soft lock: snap to the closest target in front when aiming starts, then gently track it.
  aimAssist(dt, snap) {
    const g = this.game, rig = g.rig; const fwd = rig.forward(_f);
    let best = null, bestScore = snap ? 0.94 : 0.985; // cos of the acceptance cone
    for (const p of g.peds) {
      if (p.dead || p.vehicle) continue; const dx = p.x - this.x, dz = p.z - this.z; const d = Math.hypot(dx, dz); if (d < 1.5 || d > 45) continue;
      const cos = (dx * fwd.x + dz * fwd.z) / d; const score = cos - d * 0.0008; if (score > bestScore) { bestScore = score; best = p; }
    }
    g.aimTarget = best; if (!best) return;
    const wantYaw = Math.atan2(-(best.x - rig.pos.x), -(best.z - rig.pos.z));
    const dy = (best.y + 1.1) - rig.pos.y, dh = Math.hypot(best.x - rig.pos.x, best.z - rig.pos.z); const wantPitch = -Math.atan2(dy, dh) ;
    const mouseActive = Math.abs(g.input.mouse.dx) + Math.abs(g.input.mouse.dy) > 2;
    const lam = snap ? 40 : mouseActive ? 1.5 : 6;
    rig.yaw = angleDamp(rig.yaw, wantYaw, lam, dt); rig.pitch = lerp(rig.pitch, clamp(wantPitch, -0.35, 0.9), 1 - Math.exp(-lam * dt));
  }
  setOutfit(shirt, pants) {
    const old = this.char; const inCar = !!this.vehicle;
    this.char = new Character({ kind: 'player', shirt, pants, weapon: old.gunKey }); this.char.state = old.state; this.char.phase = old.phase;
    old.dispose(); (inCar ? this.vehicle.seat : this.game.scene).add(this.char.group); if (!inCar) this.syncMesh();
  }
  nearestVehicle(r) {
    let best = null, bd = r;
    for (const v of this.game.vehicles) { const d = dist2D(v.x, v.z, this.x, this.z) - v.halfW; if (d < bd && !v.destroyed) { bd = d; best = v; } }
    return best;
  }
  beginEnter(v) {
    this.wantedVehicle = v; this.enterT = 0.45; this.aiming = false;
    // face the car door
    this.heading = Math.atan2(v.x - this.x, v.z - this.z);
    if (v.driver && v.driver !== this) { // carjack: yank the driver out
      const d = v.driver; d.exitVehicle(); d.panic(this.x, this.z, 8); if (d.kind === 'cop') this.game.police.onCopHurt(d, this);
      this.game.crime('carjack', v.x, v.z); this.stats.carsStolen++; this.enterT = 0.8;
    } else if (v.control === 'ai' || v.control === 'cop') {
      // traffic cars have an implicit driver: spawn them and throw them out of the door
      this.game.traffic.release(v); v.control = 'none'; v.throttle = 0; v.brake = 1;
      const d = this.game.pedsMgr.spawnDriver(v); d.panic(this.x, this.z, 8);
      this.game.crime('carjack', v.x, v.z); this.stats.carsStolen++; this.enterT = 0.8;
    }
  }
  finishEnter() {
    const v = this.wantedVehicle; this.wantedVehicle = null; if (!v || v.destroyed) return;
    this.game.traffic.release(v); this.game.police.release(v);
    this.vehicle = v; v.driver = this; v.control = 'player'; v.isParked = false; v.abandoned = false;
    v.seat.add(this.char.group); this.char.group.position.set(0, 0, 0); this.char.group.rotation.set(0, 0, 0);
    this.char.state.sitting = true; this.char.state.aiming = false; this.char.state.hasWeapon = false;
    this.game.rig.snapBehind(v.heading); this.game.audio.setRadio(true); this.game.onEnterVehicle(v);
  }
  exitVehicle(force = false) {
    const v = this.vehicle; if (!v) return;
    const bail = v.absSpeed > 9;
    this.vehicle = null; v.driver = null; v.control = 'none'; v.throttle = 0; v.brake = bail ? 0 : 0.3; v.steerInput = 0; v.handbrake = false; v.setLights(false); v.sirenOn = false;
    if (!bail) { v.vx = v.vz = 0; v.angVel = 0; }
    v.abandoned = true;
    this.invulnT = Math.max(this.invulnT, 0.6);
    this.game.scene.add(this.char.group); this.char.state.sitting = false;
    const s = Math.sin(v.heading), c = Math.cos(v.heading); this.x = v.x - c * (v.halfW + 0.9); this.z = v.z + s * (v.halfW + 0.9); this.y = this.game.city.groundHeight(this.x, this.z); this.heading = v.heading;
    if (bail && !force) this.knock(v.vx * 0.5, v.vz * 0.5, v.absSpeed * 1.2);
    this.game.audio.setRadio(false); this.game.onExitVehicle(v); this.syncMesh();
  }

  updateInVehicle(dt) {
    const g = this.game, input = g.input, v = this.vehicle;
    if (v.destroyed) { this.takeDamage(200, null, 'explosion'); return; }
    if (input.hit('enter')) { this.exitVehicle(); return; }
    v.throttle = input.down('forward') ? 1 : 0; v.brake = input.down('back') ? 1 : 0; v.steerInput = -input.axis('left', 'right'); // heading grows toward +x, which is the LEFT of +z v.handbrake = input.down('handbrake');
    if (input.hit('horn')) g.audio.horn(true); if (!input.down('horn')) g.audio.horn(false);
    if (input.hit('radio')) g.notify('📻 ' + g.audio.nextStation(), 1800);
    v.setLights(g.night > 0.35);
    if (v.type.name === 'police') v.sirenOn = true;
    // drive-by
    this.aiming = false; const fwd = g.rig.forward(_f);
    if (this.currentWeapon !== 'fist' && !WEAPONS[this.currentWeapon].long) { this.char.state.hasWeapon = input.mouse.left; this.updateCombat(dt, fwd); }
    // position mirrors the vehicle for queries
    this.x = v.x; this.z = v.z; this.y = v.y; this.heading = v.heading; this.vx = v.vx; this.vz = v.vz; this.speed = v.absSpeed;
    this.char.state.sitting = true; this.char.animate(dt);
  }
}
