import * as THREE from 'three';
import { raycastBoxes } from './physics.js';

export const WEAPONS = {
  fist:    { name: 'Fists', damage: 14, rate: 0.42, range: 1.7, melee: true, icon: '✊' },
  pistol:  { name: 'Pistol', damage: 26, rate: 0.26, spread: 0.012, range: 90, clip: 34, sound: 'pistol', icon: '🔫', recoil: 0.35 },
  uzi:     { name: 'Uzi', damage: 13, rate: 0.07, spread: 0.04, range: 60, auto: true, clip: 90, sound: 'uzi', icon: '🔫', recoil: 0.18 },
  shotgun: { name: 'Shotgun', damage: 11, pellets: 9, rate: 0.85, spread: 0.075, range: 32, clip: 24, sound: 'shotgun', icon: '🔫', long: true, recoil: 0.9 },
  rifle:   { name: 'Rifle', damage: 60, rate: 0.55, spread: 0.004, range: 200, clip: 30, sound: 'rifle', icon: '🔫', long: true, recoil: 0.6 },
  rpg:     { name: 'RPG', damage: 0, rate: 1.4, spread: 0.0, range: 150, clip: 3, sound: 'rifle', icon: '🚀', long: true, recoil: 1.2, projectile: true },
};
export const WEAPON_ORDER = ['fist', 'pistol', 'uzi', 'shotgun', 'rifle', 'rpg'];

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _inv = new THREE.Matrix4(), _lo = new THREE.Vector3(), _ld = new THREE.Vector3();
const _ray = new THREE.Ray(), _box = new THREE.Box3(), _sph = new THREE.Sphere();

// Cast a bullet ray against buildings, vehicles and characters. Returns nearest hit.
export function castBullet(game, origin, dir, maxDist, shooter) {
  let best = { t: maxDist, type: 'none', entity: null };
  const L = Math.hypot(dir.x, dir.z);
  if (L > 1e-4) {
    const hb = raycastBoxes(game.city.hash, origin.x, origin.z, dir.x / L, dir.z / L, maxDist * L, (b, ht) => { const y = origin.y + dir.y * (ht / L); return y >= (b.minY ?? 0) && y <= (b.maxY ?? Infinity); });
    if (hb.box) { const t = hb.t / L; if (t < best.t) best = { t, type: 'world', entity: hb.box }; }
  }
  // ground plane
  if (dir.y < -1e-4) { const t = -(origin.y - 0.02) / dir.y; if (t > 0 && t < best.t) best = { t, type: 'ground', entity: null }; }
  _ray.set(origin, dir);
  for (const v of game.vehicles) {
    if (v === shooter?.vehicle) continue;
    const dx = v.x - origin.x, dz = v.z - origin.z; const dd = Math.hypot(dx, dz); if (dd - v.halfL > best.t) continue;
    _inv.copy(v.group.matrixWorld).invert(); _lo.copy(origin).applyMatrix4(_inv); _ld.copy(dir).transformDirection(_inv);
    _box.min.set(-v.halfW, 0.2, -v.halfL); _box.max.set(v.halfW, v.type.profile.reduce((m, p) => Math.max(m, p[1]), 0), v.halfL);
    const r = new THREE.Ray(_lo, _ld); const hit = r.intersectBox(_box, _p);
    if (hit) { const t = _p.distanceTo(_lo); if (t < best.t) best = { t, type: 'vehicle', entity: v }; }
  }
  const targets = game.peds; const ents = shooter === game.player ? targets : [...targets, game.player];
  for (const p of ents) {
    if (p === shooter || p.dead || p.vehicle) continue;
    _sph.center.set(p.x, p.y + 0.9, p.z); _sph.radius = 0.45;
    const hit = _ray.intersectSphere(_sph, _p); if (hit) { const t = _p.distanceTo(origin); if (t < best.t) best = { t, type: 'ped', entity: p }; }
    _sph.center.set(p.x, p.y + 1.72, p.z); _sph.radius = 0.2;
    const hh = _ray.intersectSphere(_sph, _p); if (hh) { const t = _p.distanceTo(origin); if (t <= best.t + 0.05) best = { t, type: 'ped', entity: p, head: true }; }
  }
  for (const b of game.barrels) {
    if (b.dead) continue; _sph.center.set(b.x, b.y + 0.55, b.z); _sph.radius = 0.55;
    const hit = _ray.intersectSphere(_sph, _p); if (hit) { const t = _p.distanceTo(origin); if (t < best.t) best = { t, type: 'barrel', entity: b }; }
  }
  best.point = _p.copy(origin).addScaledVector(dir, best.t).clone();
  return best;
}

export function fireWeapon(game, shooter, weaponKey, origin, dir) {
  const w = WEAPONS[weaponKey]; const fx = game.effects;
  if (w.projectile) { game.projectiles.launch(origin, dir, shooter); fx.muzzle(origin, dir); game.audio.gunshot('shotgun'); game.noise(origin.x, origin.z, 60, shooter); return; }
  const n = w.pellets || 1; let anyHit = false, headshot = false, kill = false;
  for (let i = 0; i < n; i++) {
    _d.copy(dir); _d.x += (Math.random() - 0.5) * w.spread * 2; _d.y += (Math.random() - 0.5) * w.spread * 2; _d.z += (Math.random() - 0.5) * w.spread * 2; _d.normalize();
    const hit = castBullet(game, origin, _d, w.range, shooter);
    fx.addTracer(origin, hit.point);
    if (hit.type === 'ped') { const wasAlive = !hit.entity.dead; hit.entity.hurt(hit.head ? w.damage * 2.5 : w.damage, shooter, _d); fx.blood(hit.point.x, hit.point.y, hit.point.z, hit.head ? 12 : 6); anyHit = true; if (hit.head) headshot = true; if (wasAlive && hit.entity.dead) kill = true; }
    else if (hit.type === 'vehicle') { hit.entity.damage(w.damage * 0.45, 'bullet', shooter); fx.sparks(hit.point.x, hit.point.y, hit.point.z, 5); if (hit.entity.control === 'ai') hit.entity.ai && (hit.entity.ai.scared = 6); anyHit = true; }
    else if (hit.type === 'barrel') { hit.entity.hurt(w.damage, shooter); fx.sparks(hit.point.x, hit.point.y, hit.point.z, 6); anyHit = true; }
    else if (hit.type === 'world' || hit.type === 'ground') fx.puff(hit.point.x, hit.point.y, hit.point.z, 3, 0.35);
  }
  fx.muzzle(origin, dir); game.audio.gunshot(w.sound);
  game.noise(origin.x, origin.z, 45, shooter);
  if (shooter === game.player && anyHit) game.hud.hitmarker(kill ? 'kill' : headshot ? 'head' : 'hit');
}

// NPC shooting helper (cops, gangs): fires a pistol-like shot at a target ped/player with a hit chance.
export function shootAt(game, shooter, x, y, z, target, chance, damage) {
  const fx = game.effects; _o.set(x, y, z); _d.set(target.x - x, target.y + 1.0 - y, target.z - z).normalize();
  const los = castBullet(game, _o, _d, 70, shooter);
  if (!(los.type === 'ped' && los.entity === target) && !(los.type === 'vehicle' && los.entity === target.vehicle)) return false;
  if (Math.random() > chance) { _d.x += (Math.random() - 0.5) * 0.16; _d.y += (Math.random() - 0.5) * 0.06; _d.z += (Math.random() - 0.5) * 0.16; _d.normalize(); }
  const h = castBullet(game, _o, _d, 70, shooter); fx.addTracer(_o, h.point); fx.muzzle(_o, _d);
  const dist = Math.hypot(x - game.player.x, z - game.player.z); if (dist < 90) game.audio.gunshot('pistol');
  if (h.type === 'ped') { if (h.entity === game.player) game.player.takeDamage(damage, shooter); else h.entity.hurt(damage, shooter, _d); fx.blood(h.point.x, h.point.y, h.point.z, 4); }
  else if (h.type === 'vehicle') { h.entity.damage(3, 'bullet', shooter); fx.sparks(h.point.x, h.point.y, h.point.z, 4); if (h.entity === game.player.vehicle) game.player.takeDamage(damage * 0.4, shooter, 'impact'); }
  else if (h.type === 'barrel') h.entity.hurt(20, shooter);
  return true;
}

// Rockets: simple projectiles that explode on contact.
const rocketGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.7, 8); rocketGeo.rotateX(Math.PI / 2);
const rocketMat = new THREE.MeshStandardMaterial({ color: 0x556b2f, roughness: 0.6, metalness: 0.3 });
export class Projectiles {
  constructor(game) { this.game = game; this.list = []; }
  launch(origin, dir, shooter) {
    const m = new THREE.Mesh(rocketGeo, rocketMat); m.position.copy(origin); m.lookAt(origin.clone().add(dir)); this.game.scene.add(m);
    const light = new THREE.PointLight(0xffa040, 15, 12, 2); m.add(light);
    this.list.push({ m, pos: origin.clone(), dir: dir.clone().normalize(), speed: 55, life: 5, shooter });
  }
  update(dt) {
    const g = this.game;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const r = this.list[i]; r.life -= dt; const step = r.speed * dt;
      const hit = castBullet(g, r.pos, r.dir, step + 0.3, r.shooter);
      const struck = hit.type !== 'none' && hit.t <= step + 0.3;
      if (struck || r.life <= 0) {
        const p = struck ? hit.point : r.pos; g.effects.explosion(p.x, p.y - 0.5, p.z, 1.1); g.audio.explosion(); g.explodeAt(p.x, p.y, p.z, 9, r.shooter);
        g.rig.addShake(Math.max(0, 1 - Math.hypot(p.x - g.player.x, p.z - g.player.z) / 40)); if (r.shooter === g.player) g.crime('explosion', p.x, p.z);
        g.scene.remove(r.m); this.list.splice(i, 1); continue;
      }
      r.pos.addScaledVector(r.dir, step); r.m.position.copy(r.pos);
      g.effects.smoke.emit(r.pos.x, r.pos.y, r.pos.z, 0, 0.5, 0, 0.9, 0.5, 0.75, 0.75, 0.75, 1.5, 1, 0.2);
      g.effects.fire.emit(r.pos.x, r.pos.y, r.pos.z, -r.dir.x * 3, 0, -r.dir.z * 3, 0.15, 0.5, 1, 0.6, 0.2, 0, 2, 0);
    }
  }
}
