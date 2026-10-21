import * as THREE from 'three';
import { Ped } from './peds.js';
import { Character } from './character.js';
import { WEAPONS } from './weapons.js';
import { CITY } from './config.js';
import { dist2D, formatMoney, pick } from './utils.js';

export const INTERIOR_X = 3000; // interiors live far off the island, GTA-style
const mkMat = (c, r = 0.8, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, ...extra });

function signTexture(text, color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const ctx = c.getContext('2d');
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 512, 128); ctx.fillStyle = color; ctx.fillRect(6, 6, 500, 116);
  ctx.fillStyle = '#111'; ctx.fillRect(12, 12, 488, 104);
  ctx.font = 'bold 64px Impact, Arial Narrow, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 18; ctx.fillText(text, 256, 66);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const OUTFITS = [
  { name: 'Street', shirt: 0xf4f4f4, pants: 0x2f4f8f, price: 0 },
  { name: 'Blackout', shirt: 0x151515, pants: 0x101010, price: 200 },
  { name: 'Tourist', shirt: 0xff6fa3, pants: 0xd9c48f, price: 150 },
  { name: 'Vice', shirt: 0x7fe7ff, pants: 0xf8f8f8, price: 300 },
  { name: 'Suit', shirt: 0x3a3f4a, pants: 0x2c3038, price: 500 },
  { name: 'Hi-Vis', shirt: 0xffb300, pants: 0x2b2b2b, price: 120 },
  { name: 'Track', shirt: 0x2ecc71, pants: 0x1e8449, price: 180 },
];

export class Stores {
  constructor(game) {
    this.game = game; this.stores = []; this.interior = null; this.shopOpen = null; this.fadeT = 0; this.cooldown = 0;
    // three shared room lights, moved to whichever interior the player is in (constant light count = no shader recompiles)
    this.roomLights = []; for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xfff1dc, 0, 16, 1.6); l.position.set(0, -100, 0); game.scene.add(l); this.roomLights.push(l); }
    const city = game.city; const b = (i, j) => city.blocks.find(bb => bb.i === i && bb.j === j);
    const defs = [
      { id: 'ammu', name: 'AMMU-NATION', color: '#ff8c1a', hex: 0xff8c1a, block: b(5, 3), side: 'S', kind: 'gun', greet: ["Welcome to Ammu-Nation. Protect yourself, friend.", "Second amendment special today. What'll it be?"] },
      { id: 'ammu2', name: 'AMMU-NATION', color: '#ff8c1a', hex: 0xff8c1a, block: b(7, 5), side: 'W', kind: 'gun', greet: ["Guns, ammo, body armor. No questions asked."] },
      { id: 'burger', name: 'BURGER SHOT', color: '#ff3b7a', hex: 0xff3b7a, block: b(3, 5), side: 'N', kind: 'food', greet: ["Welcome to Burger Shot! Would you like to go large?", "Hey! Our burgers are 40% real meat now!"] },
      { id: 'burger2', name: 'BURGER SHOT', color: '#ff3b7a', hex: 0xff3b7a, block: b(2, 2), side: 'E', kind: 'food', greet: ["Fresh off the grill. Mostly."] },
      { id: 'cloth', name: 'THREADS', color: '#3bd1ff', hex: 0x3bd1ff, block: b(4, 2), side: 'S', kind: 'clothes', greet: ["Looking sharp is a lifestyle. Pick an outfit.", "You've got the walk, now get the look."] },
      { id: 'spray', name: "PAY 'N' SPRAY", color: '#2bff88', hex: 0x2bff88, block: b(5, 5), side: 'E', kind: 'spray' },
    ];
    defs.forEach((d, i) => this.buildStore(d, i));
  }

  buildStore(d, i) {
    const g = this.game, city = g.city, b = d.block;
    // door position on the block's sidewalk edge, facing the street
    let x, z, rot; const mid = 0.5;
    if (d.side === 'S') { x = b.x0 + (b.x1 - b.x0) * mid; z = b.z1 + 0.2; rot = 0; }
    else if (d.side === 'N') { x = b.x0 + (b.x1 - b.x0) * mid; z = b.z0 - 0.2; rot = Math.PI; }
    else if (d.side === 'E') { x = b.x1 + 0.2; z = b.z0 + (b.z1 - b.z0) * mid; rot = Math.PI / 2; }
    else { x = b.x0 - 0.2; z = b.z0 + (b.z1 - b.z0) * mid; rot = -Math.PI / 2; }
    const s = { ...d, x, z, rot, index: i };
    const fx = Math.sin(rot), fz = Math.cos(rot); // facing out toward street
    s.doorX = x + fx * 1.6; s.doorZ = z + fz * 1.6; // marker in front of the door
    // storefront: sign, awning, door
    const front = new THREE.Group(); front.position.set(x, CITY.CURB, z); front.rotation.y = rot; g.scene.add(front);
    if (d.kind !== 'spray') {
      const sign = new THREE.Mesh(new THREE.BoxGeometry(8, 1.6, 0.3), [mkMat(0x111111), mkMat(0x111111), mkMat(0x111111), mkMat(0x111111), new THREE.MeshBasicMaterial({ map: signTexture(d.name, d.color), toneMapped: false }), mkMat(0x111111)]);
      sign.position.set(0, 4.2, 0.35); front.add(sign);
      const awning = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.12, 1.8), mkMat(d.hex, 0.9)); awning.position.set(0, 3.3, 1.0); awning.castShadow = true; front.add(awning);
      const door = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3, 0.15), mkMat(0x0d1b26, 0.2, { metalness: 0.7 })); door.position.set(0, 1.5, 0.12); front.add(door);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.2, 0.1), mkMat(0xdddddd, 0.5)); frame.position.set(0, 1.6, 0.06); front.add(frame);
      for (const sx of [-3, 3]) { const win = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.2, 0.12), mkMat(0x1a2f44, 0.15, { metalness: 0.8 })); win.position.set(sx, 1.7, 0.12); front.add(win); }

      this.buildInterior(s);
    } else {
      // Pay'n'Spray: a garage bay on the block edge with a marker you drive into
      const bay = new THREE.Group(); bay.position.set(x + fx * 7, 0, z + fz * 7); bay.rotation.y = rot; g.scene.add(bay);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(8, 1.6, 0.3), [mkMat(0x111111), mkMat(0x111111), mkMat(0x111111), mkMat(0x111111), new THREE.MeshBasicMaterial({ map: signTexture(d.name, d.color), toneMapped: false }), mkMat(0x111111)]);
      sign.position.set(0, 4.2, 0.35); front.add(sign);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(9, 0.3, 8), mkMat(0x555b60)); roof.position.set(0, 4.3, 0); roof.castShadow = true; bay.add(roof);
      for (const sx of [-4.4, 4.4]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.3, 0.3), mkMat(0x555b60)); post.position.set(sx, 2.15, -3.7); bay.add(post); const post2 = post.clone(); post2.position.z = 3.7; bay.add(post2); }
      s.doorX = bay.position.x; s.doorZ = bay.position.z;
    }
    // door marker (glowing disc)
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(d.kind === 'spray' ? 3.2 : 1.1, d.kind === 'spray' ? 3.2 : 1.1, d.kind === 'spray' ? 2 : 1.2, 24, 1, true), new THREE.MeshBasicMaterial({ color: d.hex, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    ring.position.set(s.doorX, city.groundHeight(s.doorX, s.doorZ) + 0.7, s.doorZ); g.scene.add(ring); s.ring = ring;
    this.stores.push(s);
  }

  buildInterior(s) {
    const g = this.game; const ox = INTERIOR_X, oz = INTERIOR_X + s.index * 120; const W = 16, D = 12, H = 4;
    s.int = { x: ox, z: oz, spawnX: ox, spawnZ: oz + D / 2 - 2, exitX: ox, exitZ: oz + D / 2 - 1.2, counterX: ox, counterZ: oz - D / 2 + 4.6 };
    const room = new THREE.Group(); room.position.set(ox, 0, oz); g.scene.add(room);
    const floorMat = mkMat(s.kind === 'food' ? 0xd8c9a8 : s.kind === 'gun' ? 0x3c3f44 : 0xe8e2d8, 0.8);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.2, D), floorMat); floor.position.y = -0.1; floor.receiveShadow = true; room.add(floor);
    const wallMat = mkMat(s.kind === 'food' ? 0xf2e6c8 : s.kind === 'gun' ? 0x8a2f2f : 0xf7f7f7, 0.9);
    const walls = [[0, H / 2, -D / 2, W, H, 0.3], [0, H / 2, D / 2, W, H, 0.3], [-W / 2, H / 2, 0, 0.3, H, D], [W / 2, H / 2, 0, 0.3, H, D]];
    for (const [x, y, z, w, h, d] of walls) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat); m.position.set(x, y, z); m.receiveShadow = true; room.add(m); g.city.addCollider(ox + x - w / 2, oz + z - d / 2, ox + x + w / 2, oz + z + d / 2, 'building', H); }
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(W, 0.3, D), mkMat(0xdddddd)); ceil.position.y = H; ceil.castShadow = true; room.add(ceil);
    // door on the back (+z) wall
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3, 0.2), mkMat(0x0d1b26, 0.2, { metalness: 0.7 })); door.position.set(0, 1.5, D / 2 - 0.25); room.add(door);
    // lights
    for (const [lx, lz] of [[-4, -2], [4, -2], [0, 3]]) { const fixture = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.4), new THREE.MeshBasicMaterial({ color: 0xfff6e0 })); fixture.position.set(lx, H - 0.2, lz); room.add(fixture); }
    s.int.lights = [[-4, H - 0.4, -2], [4, H - 0.4, -2], [0, H - 0.4, 3]];
    // counter
    const counter = new THREE.Mesh(new THREE.BoxGeometry(7, 1.1, 1.2), mkMat(s.kind === 'food' ? 0xc0392b : 0x2b2b2b, 0.5)); counter.position.set(0, 0.55, -D / 2 + 2.6); counter.castShadow = true; room.add(counter);
    const top = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.08, 1.4), mkMat(0xeeeeee, 0.2, { metalness: 0.5 })); top.position.set(0, 1.12, -D / 2 + 2.6); room.add(top);
    g.city.addCollider(ox - 3.5, oz - D / 2 + 2.0, ox + 3.5, oz - D / 2 + 3.2, 'prop', 1.2);
    // themed props
    if (s.kind === 'gun') {
      for (let k = 0; k < 6; k++) { const rack = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 1.4), mkMat(0x111111, 0.3, { metalness: 0.6 })); rack.position.set(-W / 2 + 0.3, 1.6 + (k % 3) * 0.7, -3 + Math.floor(k / 3) * 3); room.add(rack); }
      for (let k = 0; k < 6; k++) { const rack = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 1.4), mkMat(0x111111, 0.3, { metalness: 0.6 })); rack.position.set(W / 2 - 0.3, 1.6 + (k % 3) * 0.7, -3 + Math.floor(k / 3) * 3); room.add(rack); }
      const target = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.8, 0.05), mkMat(0xf4f4f4)); target.position.set(0, 2.2, -D / 2 + 0.2); room.add(target);
      const rings = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.5, 24), new THREE.MeshBasicMaterial({ color: 0xff2020, side: THREE.DoubleSide })); rings.position.set(0, 2.3, -D / 2 + 0.24); room.add(rings);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.6, 1.0), mkMat(0x88aacc, 0.1, { transparent: true, opacity: 0.35 })); glass.position.set(0, 1.45, -D / 2 + 2.6); room.add(glass);
    } else if (s.kind === 'food') {
      for (const [tx, tz] of [[-4.5, 1], [4.5, 1], [-4.5, 4], [4.5, 4]]) {
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.08, 16), mkMat(0xfafafa, 0.4)); t.position.set(tx, 0.8, tz); room.add(t); const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.2, 0.8, 8), mkMat(0x888888)); leg.position.set(tx, 0.4, tz); room.add(leg);
        for (const a of [0, Math.PI]) { const ch = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mkMat(0xc0392b)); ch.position.set(tx + Math.cos(a) * 1.3, 0.25, tz + Math.sin(a) * 1.3); room.add(ch); }
        g.city.addCollider(ox + tx - 0.8, oz + tz - 0.8, ox + tx + 0.8, oz + tz + 0.8, 'prop', 1);
      }
      const menu = new THREE.Mesh(new THREE.BoxGeometry(5, 1.2, 0.05), new THREE.MeshBasicMaterial({ map: signTexture('BURGERS • FRIES • SODA', '#ffd24a'), toneMapped: false })); menu.position.set(0, 3.0, -D / 2 + 0.2); room.add(menu);
      const fryer = new THREE.Mesh(new THREE.BoxGeometry(3, 1.4, 1), mkMat(0xbfc5c9, 0.3, { metalness: 0.8 })); fryer.position.set(-3, 0.7, -D / 2 + 0.8); room.add(fryer);
    } else {
      for (let k = 0; k < 8; k++) { const sx = k < 4 ? -W / 2 + 1.2 : W / 2 - 1.2; const sz = -3 + (k % 4) * 2.2; const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.8), mkMat(0xaaaaaa, 0.3, { metalness: 0.8 })); rail.position.set(sx, 1.7, sz); room.add(rail);
        for (let c = 0; c < 4; c++) { const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.35), mkMat(OUTFITS[(k + c) % OUTFITS.length].shirt, 0.9)); shirt.position.set(sx, 1.3, sz - 0.7 + c * 0.45); room.add(shirt); }
        g.city.addCollider(ox + sx - 0.3, oz + sz - 1, ox + sx + 0.3, oz + sz + 1, 'prop', 2);
      }
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3, 0.05), mkMat(0xbcd8ee, 0.05, { metalness: 1 })); mirror.position.set(4, 1.8, -D / 2 + 0.2); room.add(mirror);
    }
    // clerk behind the counter
    const clerk = new Ped(g, ox, oz - D / 2 + 1.4, { kind: 'clerk', shirt: s.kind === 'food' ? 0xff3b7a : s.kind === 'gun' ? 0x3a3a3a : 0x3bd1ff, pants: 0x222222 });
    clerk.heading = 0; clerk.waitT = 1e12; clerk.important = true; clerk.state = 'idle'; clerk.store = s; clerk.syncMesh(); g.peds.push(clerk); s.clerk = clerk;
    // exit marker
    const exitRing = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.2, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false })); exitRing.position.set(s.int.exitX, 0.6, s.int.exitZ); g.scene.add(exitRing);
    const shopRing = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.2, 24, 1, true), new THREE.MeshBasicMaterial({ color: s.hex, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false })); shopRing.position.set(s.int.counterX, 0.6, s.int.counterZ); g.scene.add(shopRing);
  }

  items(s) {
    const pl = this.game.player;
    if (s.kind === 'gun') return [
      { name: 'Pistol ammo (34)', price: 150, buy: () => pl.giveWeapon('pistol', 34) },
      { name: 'Uzi + 90 rounds', price: 600, buy: () => pl.giveWeapon('uzi', 90) },
      { name: 'Shotgun + 24 shells', price: 800, buy: () => pl.giveWeapon('shotgun', 24) },
      { name: 'Rifle + 30 rounds', price: 1200, buy: () => pl.giveWeapon('rifle', 30) },
      { name: 'RPG + 3 rockets', price: 2500, buy: () => pl.giveWeapon('rpg', 3) },
      { name: 'Body armor', price: 250, buy: () => { pl.armor = 100; } },
    ];
    if (s.kind === 'food') return [
      { name: 'Soda (+10 hp)', price: 3, buy: () => { pl.health = Math.min(100, pl.health + 10); } },
      { name: 'Burger (+40 hp)', price: 12, buy: () => { pl.health = Math.min(100, pl.health + 40); } },
      { name: 'Double Meal (+100 hp)', price: 25, buy: () => { pl.health = 100; } },
    ];
    return OUTFITS.map(o => ({ name: `${o.name} outfit`, price: o.price, buy: () => pl.setOutfit(o.shirt, o.pants) }));
  }

  openShop(s) {
    const g = this.game; this.shopOpen = s; g.hud.showShop(s.name, this.items(s), s.color);
    if (s.clerk && s.greet) g.hud.speak(s.clerk, pick(s.greet), 3500);
  }
  closeShop() { this.shopOpen = null; this.game.hud.hideShop(); }
  buy(i) {
    const s = this.shopOpen; if (!s) return; const it = this.items(s)[i]; if (!it) return; const pl = this.game.player;
    if (pl.money < it.price) { this.game.hud.notify("You can't afford that", 1500); this.game.hud.speak(s.clerk, "No cash, no goods, pal.", 2000); return; }
    pl.money -= it.price; if (it.price > 0) this.game.hud.moneyPop(-it.price); it.buy(); this.game.audio.cash(); this.game.hud.notify(`Bought ${it.name}`, 1500);
    this.game.hud.speak(s.clerk, pick(['Pleasure doing business.', 'Come again!', 'Good choice.']), 2000);
  }

  enter(s) {
    const g = this.game, pl = g.player; this.interior = s; this.cooldown = 1.2; this.fadeT = 0.5;
    this.roomLights.forEach((l, i) => { const [lx, ly, lz] = s.int.lights[i]; l.position.set(s.int.x + lx, ly, s.int.z + lz); l.intensity = 18; });
    pl.setPosition(s.int.spawnX, s.int.spawnZ, Math.PI); g.rig.snapBehind(Math.PI); g.rig.pos.set(pl.x, 2, pl.z + 4); g.audio.ui();
    g.hud.notify(`${s.name}`, 2000);
  }
  exit() {
    const g = this.game, pl = g.player, s = this.interior; this.interior = null; this.cooldown = 1.2; this.fadeT = 0.5; this.closeShop();
    for (const l of this.roomLights) l.intensity = 0;
    pl.setPosition(s.doorX + Math.sin(s.rot) * 1.5, s.doorZ + Math.cos(s.rot) * 1.5, s.rot); g.rig.snapBehind(s.rot); g.rig.pos.set(pl.x - Math.sin(s.rot) * 4, 2, pl.z - Math.cos(s.rot) * 4); g.audio.ui();
  }

  update(dt) {
    const g = this.game, pl = g.player, input = g.input; const t = g.time;
    this.cooldown = Math.max(0, this.cooldown - dt); this.fadeT = Math.max(0, this.fadeT - dt);
    for (const s of this.stores) { s.ring.material.opacity = 0.25 + 0.12 * Math.sin(t * 3 + s.index); }
    if (pl.dead || pl.busted) { if (this.shopOpen) this.closeShop(); return; }
    if (this.shopOpen) {
      for (let i = 0; i < 9; i++) if (input.hitCode('Digit' + (i + 1))) this.buy(i);
      if (input.hit('interact') || input.hitCode('Escape') || dist2D(pl.x, pl.z, this.shopOpen.int.counterX, this.shopOpen.int.counterZ) > 3.5) this.closeShop();
      return;
    }
    if (this.interior) {
      const s = this.interior;
      if (this.cooldown <= 0 && dist2D(pl.x, pl.z, s.int.exitX, s.int.exitZ) < 1.4) { this.exit(); return; }
      const nearCounter = dist2D(pl.x, pl.z, s.int.counterX, s.int.counterZ) < 2.2;
      if (nearCounter) { g.hud.setHint('Press E to shop'); if (input.hit('interact')) this.openShop(s); }
      return;
    }
    if (this.cooldown > 0) return;
    for (const s of this.stores) {
      if (s.kind === 'spray') {
        if (pl.vehicle && dist2D(pl.x, pl.z, s.doorX, s.doorZ) < 3.5 && pl.vehicle.absSpeed < 1.5) {
          if (pl.money < 100) { g.hud.notify("Pay 'n' Spray costs $100", 1500); this.cooldown = 3; continue; }
          pl.money -= 100; g.hud.moneyPop(-100); const v = pl.vehicle; v.health = 100; v.onFire = false; v.fireT = 0; v.paint.color.setHex(pick(v.type.colors)); g.police.clear(); g.hud.notify('Resprayed. The cops lost your trail.', 3000); g.audio.cash(); this.cooldown = 4; this.fadeT = 0.6;
        }
        continue;
      }
      if (!pl.vehicle && dist2D(pl.x, pl.z, s.doorX, s.doorZ) < 1.5) { this.enter(s); return; }
    }
  }
}
