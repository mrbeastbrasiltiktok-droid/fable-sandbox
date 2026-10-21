import * as THREE from 'three';
import { clamp, wrapAngle, sign, RNG } from './utils.js';
import { BOOSTS } from './config.js';

export const ITEMS = {
  banana: { name: 'Banana', icon: '🍌', trail: true, count: 1 },
  banana3: { name: 'Triple Banana', icon: '🍌', badge: '×3', trail: true, count: 3, base: 'banana' },
  green: { name: 'Green Shell', icon: '🟢', trail: true, count: 1 },
  green3: { name: 'Triple Green Shell', icon: '🟢', badge: '×3', trail: true, count: 3, base: 'green' },
  red: { name: 'Red Shell', icon: '🔴', trail: true, count: 1 },
  red3: { name: 'Triple Red Shell', icon: '🔴', badge: '×3', trail: true, count: 3, base: 'red' },
  blue: { name: 'Spiny Shell', icon: '🔵', count: 1 },
  mush: { name: 'Mushroom', icon: '🍄', count: 1 },
  mush3: { name: 'Triple Mushroom', icon: '🍄', badge: '×3', count: 3, base: 'mush' },
  gold: { name: 'Golden Mushroom', icon: '🍄', badge: '∞', count: 1 },
  star: { name: 'Super Star', icon: '⭐', count: 1 },
  bullet: { name: 'Bullet Bill', icon: '🚀', count: 1 },
  lightning: { name: 'Lightning', icon: '⚡', count: 1 },
  blooper: { name: 'Blooper', icon: '🦑', count: 1 },
  bomb: { name: 'Bob-omb', icon: '💣', trail: true, count: 1 },
  fire: { name: 'Fire Flower', icon: '🌺', count: 10 },
  horn: { name: 'Super Horn', icon: '📯', count: 1 },
  coin: { name: 'Coin', icon: '🪙', count: 1 },
};
export const ITEM_IDS = Object.keys(ITEMS);

// Weighted distribution by race position (1..8). Based on MK8's shape: defense up front, red shells mid-pack, recovery items at the back.
const DIST = {
  1: { banana: 30, green: 25, coin: 20, fire: 5, horn: 5, banana3: 5, mush: 3, green3: 5, blooper: 2 },
  2: { banana: 15, banana3: 5, green: 20, green3: 5, red: 20, coin: 10, fire: 5, horn: 3, mush: 10, bomb: 2, blooper: 5 },
  3: { banana: 10, banana3: 5, green: 12, green3: 5, red: 20, red3: 5, mush: 12, mush3: 5, fire: 8, bomb: 5, blooper: 5, coin: 4, horn: 2, blue: 2 },
  4: { banana: 5, green: 8, green3: 5, red: 18, red3: 8, mush: 10, mush3: 10, fire: 6, bomb: 8, blooper: 6, blue: 6, lightning: 3, star: 3, gold: 4 },
  5: { banana: 2, green: 5, green3: 3, red: 12, red3: 10, mush: 8, mush3: 14, fire: 4, bomb: 8, blooper: 5, blue: 8, lightning: 6, star: 6, gold: 9 },
  6: { green: 3, red: 8, red3: 8, mush: 5, mush3: 18, bomb: 5, blooper: 3, blue: 8, lightning: 9, star: 12, gold: 14, bullet: 3, fire: 2, banana: 2 },
  7: { red: 4, red3: 6, mush: 4, mush3: 20, blue: 6, lightning: 10, star: 15, gold: 18, bullet: 10, blooper: 2, bomb: 3, banana: 2 },
  8: { red: 2, red3: 4, mush3: 22, blue: 4, lightning: 8, star: 14, gold: 20, bullet: 22, banana: 2, mush: 2 },
};

// Balloon Battle table: no blue shells, bullets or golden mushrooms; offence and defence only.
const BATTLE_DIST = { banana: 12, banana3: 6, green: 16, green3: 8, red: 14, red3: 6, mush: 10, mush3: 3, bomb: 9, fire: 7, horn: 6, star: 2, blooper: 2, lightning: 1 };

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...extra });

export function buildItemMesh(type) {
  const g = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  switch (type) {
    case 'banana': { const m = add(new THREE.TorusGeometry(0.42, 0.14, 8, 12, 2.4), std(0xffd93b)); m.rotation.set(0, 0, 0.3); add(new THREE.SphereGeometry(0.1, 6, 6), std(0x5a3a10), -0.35, -0.05, 0); g.position.y = 0.35; break; }
    case 'green': case 'red': case 'blue': { const col = type === 'green' ? 0x2fd35a : type === 'red' ? 0xe83030 : 0x2a6cff; add(new THREE.SphereGeometry(0.45, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), std(col, { roughness: 0.3 })); add(new THREE.CylinderGeometry(0.44, 0.34, 0.22, 14), std(0xfff4d0), 0, -0.02, 0); if (type === 'blue') { for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const s = add(new THREE.ConeGeometry(0.08, 0.28, 6), std(0xffffff), Math.cos(a) * 0.3, 0.25, Math.sin(a) * 0.3); s.lookAt(Math.cos(a) * 2, 1.4, Math.sin(a) * 2); s.rotateX(Math.PI / 2); } for (const s of [-1, 1]) { const w = add(new THREE.BoxGeometry(0.7, 0.05, 0.3), std(0xffffff), s * 0.6, 0.1, -0.1); w.rotation.z = s * 0.3; } } break; }
    case 'bomb': { add(new THREE.SphereGeometry(0.42, 14, 12), std(0x1b1b22, { roughness: 0.35, metalness: 0.2 })); add(new THREE.CylinderGeometry(0.06, 0.06, 0.25, 6), std(0xd0d0d0), 0, 0.5, 0); add(new THREE.SphereGeometry(0.07, 6, 6), std(0xffa020, { emissive: 0xff8000, emissiveIntensity: 2 }), 0, 0.66, 0); for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.08, 6, 6), std(0xffffff), s * 0.16, 0.05, 0.38); add(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 8), std(0xffa020), -0.2, -0.4, 0); add(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 8), std(0xffa020), 0.2, -0.4, 0); g.position.y = 0.45; break; }
    case 'fire': { add(new THREE.SphereGeometry(0.3, 10, 8), std(0xff7a10, { emissive: 0xff5000, emissiveIntensity: 2.2 })); break; }
    case 'coin': { const m = add(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 18), std(0xffc93c, { metalness: 0.7, roughness: 0.25, emissive: 0x7a5a00, emissiveIntensity: 0.4 })); m.rotation.x = Math.PI / 2; break; }
    case 'box': { const m = add(new THREE.BoxGeometry(1.1, 1.1, 1.1), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0.1, emissive: 0x88aaff, emissiveIntensity: 0.6, side: THREE.DoubleSide })); m.castShadow = false; const c = document.createElement('canvas'); c.width = c.height = 64; const ctx = c.getContext('2d'); ctx.font = 'bold 52px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText('?', 32, 34); const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true })); sp.scale.setScalar(0.7); g.add(sp); break; }
    case 'bulletVisual': { const m = add(new THREE.CapsuleGeometry(0.9, 2.0, 6, 14), std(0x1a1a1a, { roughness: 0.4, metalness: 0.3 })); m.rotation.x = Math.PI / 2; for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.18, 8, 8), std(0xffffff), s * 0.42, 0.25, 1.3); for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.6, 0.35, 0.2), std(0xffffff), s * 0.85, 0.15, 0.3); g.position.y = 0.9; break; }
  }
  return g;
}

export class ItemManager {
  constructor(scene, track, karts, effects, audio) {
    this.scene = scene; this.track = track; this.karts = karts; this.fx = effects; this.audio = audio; this.battle = !!track.isArena;
    this.objects = []; this.rng = new RNG(Date.now() & 0xffff);
    this.lightningCooldown = 0; this.blueActive = false; this.time = 0;
    this.boxes = track.itemBoxSpots.map((p) => { const m = buildItemMesh('box'); m.position.copy(p); scene.add(m); return { pos: p, mesh: m, active: true, timer: 0 }; });
    this.coins = track.coinSpots.map((p) => { const m = buildItemMesh('coin'); m.position.copy(p); scene.add(m); return { pos: p, mesh: m, active: true, timer: 0 }; });
    this.bulletMeshes = new Map();
  }

  roll(kart) {
    const pos = clamp(kart.position, 1, 8);
    const table = this.battle ? { ...BATTLE_DIST } : { ...DIST[pos] };
    // rules
    if (this.blueActive || pos === 1) delete table.blue;
    if (this.lightningCooldown > 0 || pos <= 2) delete table.lightning;
    if (pos <= 4) delete table.bullet;
    if (kart.isPlayer && kart.position === 1 && this.karts.length > 1) { /* leader gets a bit more coins */ table.coin = (table.coin || 0) + 6; }
    let total = 0; for (const k in table) total += table[k];
    let r = this.rng.next() * total;
    for (const k in table) { r -= table[k]; if (r <= 0) return k; }
    return 'banana';
  }

  giveItem(kart) {
    if (kart.item || kart.roulette > 0) return;
    const id = this.roll(kart);
    kart.rouletteItem = id; kart.rouletteCount = ITEMS[id].count; kart.roulette = 1.6 + Math.random() * 0.6;
    kart.emit('rouletteStart');
  }

  consume(kart) { kart.itemCount--; if (kart.itemCount <= 0) { kart.item = null; kart.itemCount = 0; this.stopTrail(kart); } }

  /** Called when item button released (or AI chooses). dir: +1 forward, -1 backward, 0 default */
  use(kart, dir = 0) {
    if (!kart.item || kart.roulette > 0) return;
    const id = kart.item; const base = ITEMS[id].base || id;
    const fwd = new THREE.Vector3(Math.sin(kart.yaw), 0, Math.cos(kart.yaw));
    const behind = kart.pos.clone().addScaledVector(fwd, -2.2); behind.y = kart.pos.y + 0.4;
    const ahead = kart.pos.clone().addScaledVector(fwd, 2.4); ahead.y = kart.pos.y + 0.5;
    switch (base) {
      case 'banana': if (dir > 0) this.spawnThrown('banana', ahead, fwd, kart, 14 + kart.speed, 7); else this.spawnHazard('banana', behind, kart); this.consume(kart); this.audio.play('drop'); break;
      case 'green': this.spawnShell('green', dir < 0 ? behind : ahead, dir < 0 ? -1 : 1, kart); this.consume(kart); this.audio.play('throw'); break;
      case 'red': this.spawnShell('red', dir < 0 ? behind : ahead, dir < 0 ? -1 : 1, kart); this.consume(kart); this.audio.play('throw'); break;
      case 'blue': this.spawnBlue(kart); this.consume(kart); this.audio.play('blue'); break;
      case 'mush': kart.applyBoost('mushroom', BOOSTS.mushroom.mult, BOOSTS.mushroom.duration); this.consume(kart); this.audio.play('mushroom'); break;
      case 'gold': if (kart.goldenTimer <= 0) kart.goldenTimer = 7.5; kart.applyBoost('golden', BOOSTS.golden.mult, BOOSTS.golden.duration); this.audio.play('mushroom'); break;
      case 'star': kart.starTimer = BOOSTS.star.duration; kart.applyBoost('star', 1.0, 0.1); this.consume(kart); this.audio.play('star'); kart.emit('star'); break;
      case 'bullet': kart.bulletTimer = BOOSTS.bullet.duration; kart.hitInvuln = BOOSTS.bullet.duration; if (kart.drift.active) kart.endDrift(false); this.consume(kart); this.audio.play('bullet'); kart.emit('bullet'); break;
      case 'lightning': this.lightning(kart); this.consume(kart); break;
      case 'blooper': this.blooper(kart); this.consume(kart); break;
      case 'bomb': this.spawnThrown('bomb', dir < 0 ? behind : ahead, fwd, kart, dir < 0 ? -6 : 16 + kart.speed, 6); this.consume(kart); this.audio.play('throw'); break;
      case 'fire': this.spawnFire(kart, dir < 0 ? -1 : 1); kart.itemCount--; if (kart.itemCount <= 0) kart.item = null; this.audio.play('fire'); break;
      case 'horn': this.horn(kart); this.consume(kart); break;
      case 'coin': kart.addCoins(2); this.consume(kart); this.audio.play('coin'); break;
    }
  }

  startTrail(kart) { if (!kart.item || kart.roulette > 0 || !ITEMS[kart.item].trail || kart.trailing) return; kart.trailing = true; const base = ITEMS[kart.item].base || kart.item; kart.trailObjs = []; for (let i = 0; i < kart.itemCount; i++) { const m = buildItemMesh(base); this.scene.add(m); kart.trailObjs.push(m); } }
  stopTrail(kart) { if (!kart.trailing) return; kart.trailing = false; for (const m of kart.trailObjs) { this.scene.remove(m); this.disposeMesh(m); } kart.trailObjs = []; }
  syncTrail(kart) {
    if (!kart.trailing) return;
    if (!kart.item || kart.trailObjs.length !== kart.itemCount) { this.stopTrail(kart); if (kart.item && ITEMS[kart.item].trail) this.startTrail(kart); if (!kart.trailing) return; }
    const n = kart.trailObjs.length; const fwd = new THREE.Vector3(Math.sin(kart.yaw), 0, Math.cos(kart.yaw));
    for (let i = 0; i < n; i++) {
      const m = kart.trailObjs[i];
      if (n === 1) { m.position.copy(kart.pos).addScaledVector(fwd, -2.0); m.position.y = kart.pos.y + 0.4; }
      else { const a = this.time * 3 + (i / n) * Math.PI * 2; m.position.set(kart.pos.x + Math.sin(a) * 1.9, kart.pos.y + 0.45, kart.pos.z + Math.cos(a) * 1.9); }
      m.rotation.y = this.time * 4;
    }
  }
  /** Trailing item absorbs a hit. Returns true if absorbed. */
  absorb(kart) {
    if (!kart.trailing || !kart.item) return false;
    kart.itemCount--; if (kart.itemCount <= 0) { kart.item = null; kart.itemCount = 0; }
    const m = kart.trailObjs.pop(); if (m) { this.scene.remove(m); this.disposeMesh(m); this.fx.burst(m.position, 12, 0xffffff, 4, 0.4, 0.6); }
    if (!kart.item) this.stopTrail(kart);
    this.audio.play('shellBreak');
    return true;
  }

  add(o) { this.scene.add(o.mesh); this.objects.push(o); return o; }
  disposeMesh(m) { m.traverse((c) => { if (c.geometry) c.geometry.dispose(); if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); } }); }
  remove(o) { this.scene.remove(o.mesh); this.disposeMesh(o.mesh); o.dead = true; if (o.type === 'blue') this.blueActive = false; }

  spawnHazard(type, pos, owner) { const mesh = buildItemMesh(type); mesh.position.copy(pos); const smp = this.track.sample(pos, owner.hint); mesh.position.y = this.track.heightAt(smp, smp.lat) + (type === 'banana' ? 0.0 : 0); return this.add({ type, mesh, pos: mesh.position, owner, life: 90, hint: smp.idx, hazard: true, ownerGrace: 0.6 }); }
  spawnThrown(type, pos, fwd, owner, speed, vy) { const mesh = buildItemMesh(type); mesh.position.copy(pos); const vel = fwd.clone().multiplyScalar(speed); vel.y = vy; return this.add({ type, mesh, pos: mesh.position, vel, owner, life: type === 'bomb' ? 3.2 : 90, hint: owner.hint, thrown: true, ownerGrace: 0.6, fuse: 2.6 }); }
  spawnShell(type, pos, dir, owner) {
    const mesh = buildItemMesh(type); mesh.position.copy(pos);
    const yaw = owner.yaw + (dir < 0 ? Math.PI : 0);
    let target = null;
    if (type === 'red' && dir > 0) {
      if (this.battle) { let best = null, bd = 1e9; for (const k of this.karts) { if (k.eliminated) continue; if (k === owner || k.eliminated) continue; const d = k.pos.distanceTo(owner.pos); const fwd = (k.pos.x - owner.pos.x) * Math.sin(owner.yaw) + (k.pos.z - owner.pos.z) * Math.cos(owner.yaw); const score = d - (fwd > 0 ? 25 : 0); if (score < bd) { bd = score; best = k; } } target = best; }
      else target = this.karts.filter((k) => k !== owner && !k.finished).sort((a, b) => a.progress - b.progress).find((k) => k.progress > owner.progress) || null;
    }
    const sp = type === 'red' ? 42 : 40;
    return this.add({ type, mesh, pos: mesh.position, yaw, speed: sp + Math.max(0, owner.speed * (dir > 0 ? 0.5 : -0.2)), owner, life: 12, hint: owner.hint, bounces: 0, target, ownerGrace: 0.5, projectile: true });
  }
  spawnBlue(owner) {
    const mesh = buildItemMesh('blue'); mesh.position.copy(owner.pos); mesh.position.y += 2;
    this.blueActive = true;
    const s = owner.smp.s || 0;
    return this.add({ type: 'blue', mesh, pos: mesh.position, owner, s, life: 30, hint: owner.hint, speed: 62, alt: 3, projectile: true, flying: true });
  }
  spawnFire(owner, dir) {
    const fwd = new THREE.Vector3(Math.sin(owner.yaw), 0, Math.cos(owner.yaw)).multiplyScalar(dir);
    const pos = owner.pos.clone().addScaledVector(fwd, 2.2); pos.y += 0.5;
    const mesh = buildItemMesh('fire'); mesh.position.copy(pos);
    const yaw = owner.yaw + (dir < 0 ? Math.PI : 0) + (Math.random() - 0.5) * 0.35;
    return this.add({ type: 'fire', mesh, pos: mesh.position, yaw, speed: 34 + Math.max(0, owner.speed * dir * 0.6), owner, life: 2.4, hint: owner.hint, bounces: 0, ownerGrace: 0.4, projectile: true });
  }

  lightning(user) {
    this.lightningCooldown = 25; this.audio.play('lightning');
    user.emit('lightning');
    for (const k of this.karts) { if (k.eliminated) continue;
      if (k === user || k.invincible) continue;
      // leaders shrink longer
      const dur = 3 + (this.karts.length - k.position) * 0.5;
      const wasBullet = k.bulletTimer > 0;
      if (!wasBullet) { k.hit('shock', user); k.shrinkTimer = Math.max(k.shrinkTimer, dur); if (k.item && !k.trailing) { k.item = null; k.itemCount = 0; } this.stopTrail(k); k.emit('shrunk'); }
      this.fx.burst(k.pos, 20, 0xfff27a, 6, 0.4, 0.8, 4);
    }
    // destroy loose items on track
    for (const o of this.objects) if (o.hazard || o.type === 'green' || o.type === 'red') this.remove(o);
  }
  blooper(user) {
    this.audio.play('blooper'); user.emit('blooper');
    for (const k of this.karts) if (k !== user && !k.eliminated && (this.battle || k.progress > user.progress) && !k.invincible) { k.inkTimer = 6.5; k.emit('inked'); }
  }
  horn(user) {
    this.audio.play('horn'); this.fx.ring(user.pos, 0xffffff, 8, 0.5); this.fx.burst(user.pos, 30, 0xfff0a0, 8, 0.5, 0.9, 2);
    user.emit('horn');
    for (const k of this.karts) { if (k.eliminated) continue; if (k === user) continue; const d = k.pos.distanceTo(user.pos); if (d < 8.5) { if (!k.hit('spin', user)) {} else { k.vy = 3; k.airborne = true; } } }
    for (const o of this.objects) { const d = o.pos.distanceTo(user.pos); if (d < 10 || (o.type === 'blue' && this.blueTarget(o) === user && d < 20)) { this.fx.burst(o.pos, 12, 0xffffff, 4, 0.4); this.remove(o); } }
  }
  blueTarget(o) { let best = null; for (const k of this.karts) { if (k.eliminated) continue; if (k.finished || k.eliminated) continue; if (!best || (this.battle ? k.balloons > best.balloons : k.progress > best.progress)) best = k; } return best; }

  hitKart(k, o, kind) {
    if (k === o.owner && o.ownerGrace > 0) return false;
    if (k.invincible) { this.fx.burst(o.pos, 10, 0xffffff, 4); this.remove(o); return true; }
    if ((o.type === 'green' || o.type === 'red' || o.type === 'fire' || o.hazard) && this.absorb(k)) { this.remove(o); return true; }
    if (k.hit(kind, o.owner)) { this.fx.burst(o.pos, 14, 0xffffff, 5, 0.4); this.audio.play(kind === 'spin' ? 'spin' : 'crash'); }
    this.remove(o);
    return true;
  }
  explode(o, radius = 4.5) {
    this.fx.explosion(o.pos, radius); this.audio.play('explosion');
    for (const k of this.karts) { if (k.eliminated) continue; const d = k.pos.distanceTo(o.pos); if (d < radius) { if (k.hit('flip', o.owner)) { k.vy = 6; k.airborne = true; } } }
    for (const p of this.objects) if (p !== o && !p.dead && p.pos.distanceTo(o.pos) < radius) this.remove(p);
    this.remove(o);
  }

  update(dt, inputs) {
    this.time += dt; const tr = this.track;
    this.lightningCooldown = Math.max(0, this.lightningCooldown - dt);
    // boxes & coins
    for (const b of this.boxes) {
      b.mesh.rotation.y += dt * 1.5; b.mesh.rotation.x += dt * 0.7;
      if (!b.active) { b.timer -= dt; if (b.timer <= 0) { b.active = true; b.mesh.visible = true; } continue; }
      for (const k of this.karts) { if (k.eliminated) continue; const dx = k.pos.x - b.pos.x, dz = k.pos.z - b.pos.z; if (dx * dx + dz * dz < 2.6 * 2.6 && Math.abs(k.pos.y - b.pos.y) < 2.5 && k.roulette <= 0 && !k.item) { b.active = false; b.timer = 3; b.mesh.visible = false; this.giveItem(k); this.fx.burst(b.pos, 16, 0x9ad0ff, 5, 0.4, 0.8, 2); if (k.isPlayer) this.audio.play('box'); break; } }
    }
    for (const c of this.coins) {
      c.mesh.rotation.y += dt * 3;
      if (!c.active) { c.timer -= dt; if (c.timer <= 0) { c.active = true; c.mesh.visible = true; } continue; }
      for (const k of this.karts) { if (k.eliminated) continue; const dx = k.pos.x - c.pos.x, dz = k.pos.z - c.pos.z; if (dx * dx + dz * dz < 2.0 * 2.0 && Math.abs(k.pos.y - c.pos.y) < 2.0) { c.active = false; c.timer = 20; c.mesh.visible = false; k.addCoins(1); if (k.isPlayer) this.audio.play('coin'); this.fx.burst(c.pos, 6, 0xffd040, 3, 0.35, 0.6, 2); break; } }
    }
    // kart-driven item usage & trailing
    for (const k of this.karts) { if (k.eliminated) continue;
      const inp = inputs.get(k);
      if (k.goldenTimer > 0 && k.item === 'gold') { /* keep */ } else if (k.item === 'gold' && k.goldenTimer <= 0 && k.goldenUsed) { k.item = null; k.goldenUsed = false; }
      if (k.item === 'gold' && k.goldenTimer > 0) k.goldenUsed = true;
      if (k.item === 'fire') { k.fireTimer = (k.fireTimer || 0) + dt; if (k.fireTimer > 9) { k.item = null; k.itemCount = 0; k.fireTimer = 0; } } else k.fireTimer = 0;
      if (inp && inp.itemBack && k.controllable && k.item && k.roulette <= 0) { this.stopTrail(k); this.use(k, -1); }
      else if (inp && k.controllable && k.item && k.roulette <= 0) {
        const trailable = ITEMS[k.item].trail;
        if (trailable) {
          if (inp.itemHeld && !k.trailing) this.startTrail(k);
          else if (!inp.itemHeld && k.trailing) { this.stopTrail(k); this.use(k, inp.itemDir); }
        } else if (inp.itemPressed) this.use(k, inp.itemDir);
      } else if (k.trailing && (!k.item || !k.controllable)) this.stopTrail(k);
      this.syncTrail(k);
      // bullet visual
      if (k.bulletTimer > 0) { let m = this.bulletMeshes.get(k); if (!m) { m = buildItemMesh('bulletVisual'); this.scene.add(m); this.bulletMeshes.set(k, m); k.group.visible = false; } m.position.copy(k.pos); m.rotation.y = k.yaw; m.position.y += 0.2 + Math.sin(this.time * 12) * 0.1; if (Math.random() < 0.6) this.fx.spawn(k.pos.x, k.pos.y + 0.8, k.pos.z, (Math.random() - 0.5) * 3, 1, (Math.random() - 0.5) * 3, 0.4, 0xffb060, 1.2); }
      else if (this.bulletMeshes.has(k)) { this.scene.remove(this.bulletMeshes.get(k)); this.bulletMeshes.delete(k); k.group.visible = true; }
    }
    // objects
    for (const o of this.objects) {
      if (o.dead) continue;
      o.life -= dt; o.ownerGrace = Math.max(0, (o.ownerGrace || 0) - dt);
      if (o.life <= 0) { if (o.type === 'bomb') this.explode(o); else this.remove(o); continue; }
      if (o.thrown) {
        o.vel.y -= 22 * dt; o.pos.addScaledVector(o.vel, dt); o.mesh.rotation.x += dt * 6;
        const smp = tr.sample(o.pos, o.hint, o._smp || (o._smp = {})); o.hint = smp.idx; const gy = tr.heightAt(smp, smp.lat);
        if (tr.isArena) { const hit = tr.collidePoint(o.pos, 0.4); if (hit) { const dn = o.vel.x * hit.nx + o.vel.z * hit.nz; if (dn < 0) { o.vel.x = (o.vel.x - 2 * dn * hit.nx) * 0.4; o.vel.z = (o.vel.z - 2 * dn * hit.nz) * 0.4; } } }
        else if (tr.rails && Math.abs(smp.lat) > smp.edge - 0.4) { o.vel.x *= -0.4; o.vel.z *= -0.4; o.pos.x -= smp.rx * sign(smp.lat) * 0.5; o.pos.z -= smp.rz * sign(smp.lat) * 0.5; }
        if (o.pos.y <= gy + (o.type === 'banana' ? 0.0 : 0.45)) { o.pos.y = gy + (o.type === 'banana' ? 0.0 : 0.45); if (Math.abs(o.vel.y) > 3) { o.vel.y = -o.vel.y * 0.35; o.vel.x *= 0.6; o.vel.z *= 0.6; } else { o.thrown = false; o.vel.set(0, 0, 0); if (o.type === 'banana') o.hazard = true; else o.landed = true; } }
        if (tr.surfaceAt(smp, smp.lat) === 'void' && o.pos.y < smp.y - 5) { this.remove(o); continue; }
      }
      if (o.type === 'bomb') { if (!o.thrown) { o.fuse -= dt; o.mesh.rotation.y += dt * 2; o.mesh.scale.setScalar(1 + Math.sin(this.time * 20) * 0.08 * (o.fuse < 1 ? 1 : 0.3)); if (o.fuse <= 0) { this.explode(o); continue; } } for (const k of this.karts) { if (k.eliminated) continue; if (k === o.owner && o.ownerGrace > 0) continue; if (k.pos.distanceTo(o.pos) < 2.3) { this.explode(o); break; } } if (o.dead) continue; }
      if (o.hazard) { o.mesh.rotation.y += dt; for (const k of this.karts) { if (k.eliminated) continue; if (k.pos.distanceToSquared(o.pos) < (k.radius + 0.5) ** 2 && k.pos.y < o.pos.y + 1.2) { this.hitKart(k, o, 'spin'); break; } } continue; }
      if (o.type === 'green' || o.type === 'fire' || o.type === 'red') {
        // red shell homing behaviour
        if (o.type === 'red' && o.target) {
          const t = o.target; const dx = t.pos.x - o.pos.x, dz = t.pos.z - o.pos.z; const dist = Math.hypot(dx, dz);
          let want;
          if (this.battle || dist < 30 || t.finished) want = Math.atan2(dx, dz);
          else { const smp = tr.sample(o.pos, o.hint, o._smp || (o._smp = {})); const ahead = tr.posAt(smp.s + 12, 0, 0); want = Math.atan2(ahead.x - o.pos.x, ahead.z - o.pos.z); }
          o.yaw += clamp(wrapAngle(want - o.yaw), -4.5 * dt, 4.5 * dt);
          if (t.finished || t.eliminated || t.pos.distanceTo(o.pos) > 200) o.target = null;
        }
        const sx = Math.sin(o.yaw), sz = Math.cos(o.yaw);
        o.pos.x += sx * o.speed * dt; o.pos.z += sz * o.speed * dt;
        const smp = tr.sample(o.pos, o.hint, o._smp || (o._smp = {})); o.hint = smp.idx;
        const surf = tr.surfaceAt(smp, smp.lat);
        if (surf === 'void') { o.pos.y -= 20 * dt; if (o.pos.y < smp.y - 6) { this.remove(o); continue; } }
        else o.pos.y = tr.heightAt(smp, smp.lat) + 0.4;
        o.mesh.rotation.y += dt * 12;
        const lim = smp.edge - 0.45;
        if (tr.isArena) {
          const hit = tr.collidePoint(o.pos, 0.45);
          if (hit) {
            if (o.type === 'red') { this.fx.burst(o.pos, 12, 0xff8080, 4); this.audio.play('shellBreak'); this.remove(o); continue; }
            const dn = sx * hit.nx + sz * hit.nz; o.yaw = Math.atan2(sx - 2 * dn * hit.nx, sz - 2 * dn * hit.nz);
            o.bounces++; this.fx.burst(o.pos, 6, 0xffffff, 3, 0.3, 0.5); this.audio.play('bounce');
            if (o.bounces > (o.type === 'fire' ? 2 : 6)) { this.remove(o); continue; }
          }
        } else if (tr.rails && Math.abs(smp.lat) > lim) {
          if (o.type === 'red') { this.fx.burst(o.pos, 12, 0xff8080, 4); this.audio.play('shellBreak'); this.remove(o); continue; }
          const sgn = sign(smp.lat); o.pos.x -= smp.rx * sgn * (Math.abs(smp.lat) - lim); o.pos.z -= smp.rz * sgn * (Math.abs(smp.lat) - lim);
          // reflect direction across wall (right vector)
          const dn = sx * smp.rx + sz * smp.rz; const nx = sx - 2 * dn * smp.rx, nz = sz - 2 * dn * smp.rz; o.yaw = Math.atan2(nx, nz);
          o.bounces++; this.fx.burst(o.pos, 6, 0xffffff, 3, 0.3, 0.5); this.audio.play('bounce');
          if (o.bounces > (o.type === 'fire' ? 2 : 6)) { this.remove(o); continue; }
        }
        for (const k of this.karts) { if (k.eliminated) continue; if (k === o.owner && o.ownerGrace > 0) continue; if (k.pos.distanceToSquared(o.pos) < (k.radius + 0.5) ** 2 && Math.abs(k.pos.y - o.pos.y) < 1.5) { this.hitKart(k, o, 'spin'); break; } }
        if (o.dead) continue;
        // shell vs shell/hazard
        for (const p of this.objects) if (p !== o && !p.dead && (p.hazard || p.projectile) && p.type !== 'blue' && p.pos.distanceToSquared(o.pos) < 1.2) { this.fx.burst(o.pos, 10, 0xffffff, 4); this.remove(p); this.remove(o); this.audio.play('shellBreak'); break; }
        continue;
      }
      if (o.type === 'blue') {
        const t = this.blueTarget(o); if (!t) { this.remove(o); continue; }
        if (tr.isArena) { const dx = t.pos.x - o.pos.x, dz = t.pos.z - o.pos.z; const dd = Math.hypot(dx, dz) || 1; const st = Math.min(dd, o.speed * dt); o.pos.x += dx / dd * st; o.pos.z += dz / dd * st; o.pos.y = t.pos.y + (dd < 12 ? 1 : 3); o.mesh.rotation.y += dt * 10; if (dd < 3) { o.pos.copy(t.pos); this.explode(o, 5); } continue; }
        o.s += o.speed * dt; const pt = tr.posAt(o.s, 0, o.alt); o.pos.copy(pt);
        const tp = t.smp; // target track position (kept current by the kart)
        let dS = tp.s - (o.s % tr.length); if (dS < -tr.length / 2) dS += tr.length; if (dS > tr.length / 2) dS -= tr.length;
        const distToT = o.pos.distanceTo(t.pos);
        if (dS < -3) { o.s = tp.s - 2; } // overshoot fix
        if (distToT < 4.5 || (Math.abs(dS) < 2.5)) { o.pos.copy(t.pos); this.explode(o, 5); continue; }
        if (Math.abs(dS) < 25) { o.alt = Math.max(1.2, o.alt - 3 * dt); o.speed = Math.max(t.speed + 15, 36); }
        o.mesh.rotation.y += dt * 10; o.mesh.position.y += Math.sin(this.time * 6) * 0.02;
        if (Math.random() < 0.5) this.fx.spawn(o.pos.x, o.pos.y, o.pos.z, 0, 0, 0, 0.5, 0x60a0ff, 1.0);
        continue;
      }
    }
    this.objects = this.objects.filter((o) => !o.dead);
  }
}
