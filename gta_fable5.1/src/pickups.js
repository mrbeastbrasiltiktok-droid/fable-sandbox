import * as THREE from 'three';
import { makeRng, dist2D, pick } from './utils.js';
import { WEAPONS } from './weapons.js';

const mats = {
  health: new THREE.MeshStandardMaterial({ color: 0xff4040, emissive: 0xff2020, emissiveIntensity: 1.2, roughness: 0.3 }),
  armor: new THREE.MeshStandardMaterial({ color: 0x4090ff, emissive: 0x2050ff, emissiveIntensity: 1.2, roughness: 0.3 }),
  money: new THREE.MeshStandardMaterial({ color: 0x40ff70, emissive: 0x20c040, emissiveIntensity: 1.0, roughness: 0.4 }),
  weapon: new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.6 }),
};
function makeMesh(type) {
  const g = new THREE.Group();
  if (type === 'health') { g.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.2), mats.health), new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.2), mats.health)); }
  else if (type === 'armor') { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.18, 0.6, 6), mats.armor); m.rotation.x = Math.PI / 2; g.add(m); }
  else if (type === 'money') { for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.26), mats.money); m.position.y = i * 0.09; m.rotation.y = i * 0.3; g.add(m); } }
  else { const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, WEAPONS[type]?.long ? 0.9 : 0.45), mats.weapon); g.add(b); const gr = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.1), mats.weapon); gr.position.set(0, -0.15, 0.08); g.add(gr); }
  return g;
}
const ringGeo = new THREE.RingGeometry(0.55, 0.75, 24); ringGeo.rotateX(-Math.PI / 2);
const ringMats = { health: new THREE.MeshBasicMaterial({ color: 0xff5050, transparent: true, opacity: 0.6, depthWrite: false }), armor: new THREE.MeshBasicMaterial({ color: 0x5090ff, transparent: true, opacity: 0.6, depthWrite: false }), money: new THREE.MeshBasicMaterial({ color: 0x50ff80, transparent: true, opacity: 0.6, depthWrite: false }), weapon: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }) };

export class Pickups {
  constructor(game) {
    this.game = game; this.items = []; this.rng = makeRng(777);
    const city = game.city; const kinds = ['health', 'health', 'health', 'armor', 'armor', 'money', 'money', 'money', 'money', 'pistol', 'pistol', 'uzi', 'uzi', 'shotgun', 'shotgun', 'rifle'];
    const used = new Set();
    for (let k = 0; k < 44; k++) {
      const b = this.rng.pick(city.blocks); if (used.has(b) && this.rng() < 0.6) continue; used.add(b);
      const corners = [[b.x0 - 1.5, b.z0 - 1.5], [b.x1 + 1.5, b.z0 - 1.5], [b.x1 + 1.5, b.z1 + 1.5], [b.x0 - 1.5, b.z1 + 1.5]];
      const c = this.rng.pick(corners); const t = this.rng.range(0.15, 0.85); const c2 = this.rng.pick(corners);
      const x = c[0] + (c2[0] - c[0]) * t, z = c[1] + (c2[1] - c[1]) * t;
      const type = this.rng.pick(kinds); this.add(type, x, z, false);
    }
  }
  add(type, x, z, temp = false, amount) {
    const g = this.game; const cat = WEAPONS[type] ? 'weapon' : type;
    const mesh = makeMesh(type); const y = g.city.groundHeight(x, z); mesh.position.set(x, y + 0.9, z); g.scene.add(mesh);
    const ring = new THREE.Mesh(ringGeo, ringMats[cat]); ring.position.set(x, y + 0.03, z); g.scene.add(ring);
    const it = { type, cat, x, z, y, mesh, ring, active: true, respawnT: 0, temp, life: temp ? 40 : Infinity, amount: amount ?? (type === 'money' ? Math.floor(this.rng.range(40, 250)) : 0), phase: Math.random() * 6.28 };
    this.items.push(it); return it;
  }
  update(dt) {
    const g = this.game, pl = g.player; const t = g.time;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.temp) { it.life -= dt; if (it.life <= 0) { this.destroy(it); this.items.splice(i, 1); continue; } }
      if (!it.active) { it.respawnT -= dt; if (it.respawnT <= 0) { it.active = true; it.mesh.visible = it.ring.visible = true; } continue; }
      it.mesh.rotation.y = t * 1.5 + it.phase; it.mesh.position.y = it.y + 0.9 + Math.sin(t * 2 + it.phase) * 0.12; it.ring.scale.setScalar(1 + Math.sin(t * 3 + it.phase) * 0.08);
      const r = pl.vehicle ? pl.vehicle.halfW + 0.6 : 1.3;
      if (!pl.dead && dist2D(pl.x, pl.z, it.x, it.z) < r && (it.cat === 'money' || !pl.vehicle)) this.collect(it, i);
    }
  }
  destroy(it) { this.game.scene.remove(it.mesh, it.ring); it.mesh.traverse(o => o.geometry?.dispose()); }
  collect(it, i) {
    const g = this.game, pl = g.player;
    if (it.cat === 'health') { if (pl.health >= 100) return; pl.health = 100; g.audio.pickup(); g.notify('Health restored', 1500); }
    else if (it.cat === 'armor') { if (pl.armor >= 100) return; pl.armor = 100; g.audio.pickup(); g.notify('Armor', 1500); }
    else if (it.cat === 'money') { pl.money += it.amount; g.audio.cash(); g.hud.moneyPop(it.amount); }
    else { pl.giveWeapon(it.type, WEAPONS[it.type].clip); g.audio.pickup(); g.notify(`${WEAPONS[it.type].name} +${WEAPONS[it.type].clip}`, 1500); }
    if (it.temp) { this.destroy(it); this.items.splice(i, 1); }
    else { it.active = false; it.respawnT = 75; it.mesh.visible = it.ring.visible = false; }
  }
}
