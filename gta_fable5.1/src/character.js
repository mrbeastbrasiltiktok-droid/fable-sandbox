import * as THREE from 'three';
import { lerp, damp, clamp } from './utils.js';

const matCache = new Map();
function mat(color, rough = 0.85) { const k = color + '_' + rough; if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough })); return matCache.get(k); }
const SKINS = [0xf1c9a5, 0xd9a877, 0xb17a4b, 0x7a4b2a, 0xe7b78f, 0x5b3a21];
const SHIRTS = [0xe74c3c, 0x3498db, 0xf1c40f, 0x2ecc71, 0x9b59b6, 0xecf0f1, 0x1abc9c, 0xe67e22, 0x34495e, 0xff7eb6];
const PANTS = [0x2c3e50, 0x34495e, 0x7f8c8d, 0x1f2a36, 0x5d4037, 0x2e4a7a];
const HAIR = [0x2b1d12, 0x000000, 0x6b4a2b, 0xd9b26f, 0x8a8a8a, 0xa0522d];

// Procedural low-poly humanoid with a code-driven animation rig.
export class Character {
  constructor(opts = {}) {
    const kind = opts.kind || 'ped';
    const skin = opts.skin ?? SKINS[Math.floor(Math.random() * SKINS.length)];
    let shirt = opts.shirt ?? SHIRTS[Math.floor(Math.random() * SHIRTS.length)];
    let pants = opts.pants ?? PANTS[Math.floor(Math.random() * PANTS.length)];
    const hair = opts.hair ?? HAIR[Math.floor(Math.random() * HAIR.length)];
    if (kind === 'cop') { shirt = 0x1f3a93; pants = 0x141c33; }
    if (kind === 'gang') { shirt = opts.shirt ?? 0x1b1b1b; pants = opts.pants ?? 0x2a2a2a; }
    if (kind === 'clerk') { pants = 0x222222; }
    if (kind === 'player') { shirt = opts.shirt ?? 0xf4f4f4; pants = opts.pants ?? 0x2f4f8f; }
    this.kind = kind;
    this.group = new THREE.Group();
    const g = this.group;
    const body = this.body = new THREE.Group(); g.add(body);

    const skinM = mat(skin), shirtM = mat(shirt), pantsM = mat(pants), hairM = mat(hair, 0.6);
    // torso
    const torso = this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.62, 0.26), shirtM); torso.position.y = 1.29; torso.castShadow = true; body.add(torso);
    const hips = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.26), pantsM); hips.position.y = 0.9; body.add(hips);
    // head
    const headG = this.headG = new THREE.Group(); headG.position.y = 1.62; body.add(headG);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), skinM); head.position.y = 0.2; head.castShadow = true; headG.add(head);
    const hairMesh = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.28), hairM); hairMesh.position.y = 0.36; headG.add(hairMesh);
    if (kind === 'cop') { const cap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.3), mat(0x0f1a3a)); cap.position.y = 0.38; headG.add(cap); const brim = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.14), mat(0x0a0f22)); brim.position.set(0, 0.33, 0.2); headG.add(brim); }
    if (kind === 'player') { const glasses = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.04), mat(0x111111, 0.2)); glasses.position.set(0, 0.22, 0.14); headG.add(glasses); }
    if (kind === 'gang') { const band = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.07, 0.29), mat(opts.gangColor ?? 0x8e44ad, 0.9)); band.position.y = 0.3; headG.add(band); }
    if (kind === 'clerk') { const cap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.3), mat(shirt, 0.8)); cap.position.y = 0.38; headG.add(cap); const apron = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.05), mat(0xf5f5f5, 0.9)); apron.position.set(0, -0.35, 0.15); headG.add(apron); }
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.12), skinM); neck.position.y = 0.02; headG.add(neck);
    // limbs: pivot groups at joints
    const limb = (w, len, m1, m2, split) => {
      const grp = new THREE.Group();
      const upper = new THREE.Mesh(new THREE.BoxGeometry(w, len * split, w), m1); upper.position.y = -len * split / 2; upper.castShadow = true; grp.add(upper);
      const lowerG = new THREE.Group(); lowerG.position.y = -len * split; grp.add(lowerG);
      const lower = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, len * (1 - split), w * 0.9), m2); lower.position.y = -len * (1 - split) / 2; lower.castShadow = true; lowerG.add(lower);
      grp.lowerG = lowerG; return grp;
    };
    this.armL = limb(0.13, 0.66, shirtM, skinM, 0.5); this.armL.position.set(-0.3, 1.56, 0); body.add(this.armL);
    this.armR = limb(0.13, 0.66, shirtM, skinM, 0.5); this.armR.position.set(0.3, 1.56, 0); body.add(this.armR);
    this.legL = limb(0.16, 0.9, pantsM, pantsM, 0.5); this.legL.position.set(-0.12, 0.88, 0); body.add(this.legL);
    this.legR = limb(0.16, 0.9, pantsM, pantsM, 0.5); this.legR.position.set(0.12, 0.88, 0); body.add(this.legR);
    const shoeM = mat(0x1a1a1a, 0.5);
    for (const l of [this.legL, this.legR]) { const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.28), shoeM); shoe.position.set(0, -0.42, 0.06); l.lowerG.add(shoe); }
    // weapon holder in the right hand (at the end of the lower arm)
    this.hand = new THREE.Group(); this.hand.position.y = -0.3; this.armR.lowerG.add(this.hand);
    this.gun = new THREE.Group(); this.hand.add(this.gun); this.gun.visible = false; this.gun.rotation.x = Math.PI / 2; // barrel runs along the arm
    this.muzzle = new THREE.Object3D(); this.gun.add(this.muzzle); this.gunKey = null;
    this.setWeapon(opts.weapon || 'pistol');

    this.phase = Math.random() * 6.28; this.lean = 0; this.bob = 0; this.deadT = 0;
    this.state = { move: 0, run: 0, aiming: false, sitting: false, dead: false, punch: 0, airborne: false, swim: false, panic: false, weaponLong: false, hasWeapon: false, aimPitch: 0, firePose: 0 };
  }

  dispose() {
    const seen = new Set(); this.group.traverse(o => { if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); } });
    this.group.parent?.remove(this.group);
  }
  // Build a chunky procedural gun model. Barrel points along +z of the gun group; origin sits in the palm.
  setWeapon(key) {
    if (key === this.gunKey) return; this.gunKey = key;
    while (this.gun.children.length > 1) this.gun.remove(this.gun.children[this.gun.children.length - 1]);
    const dark = mat(0x1a1c1f, 0.35), metal = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.3, metalness: 0.85 }), wood = mat(0x6b4a2b, 0.7), olive = mat(0x4b5a2e, 0.7);
    const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = true; this.gun.add(o); return o; };
    const box = (w, h, d) => new THREE.BoxGeometry(w, h, d); const cyl = (r, l, r2 = r) => { const g = new THREE.CylinderGeometry(r, r2, l, 10); g.rotateX(Math.PI / 2); return g; };
    let muzzleZ = 0.25;
    if (key === 'pistol') {
      add(box(0.045, 0.07, 0.22), dark, 0, 0.03, 0.1); add(cyl(0.012, 0.07), metal, 0, 0.03, 0.24); add(box(0.04, 0.13, 0.055), mat(0x2a2a2a, 0.5), 0, -0.05, 0.0, 0.2);
      add(box(0.03, 0.02, 0.06), dark, 0, -0.02, 0.07); muzzleZ = 0.28;
    } else if (key === 'uzi') {
      add(box(0.06, 0.09, 0.3), dark, 0, 0.02, 0.12); add(box(0.035, 0.18, 0.05), metal, 0, -0.1, 0.03); add(cyl(0.014, 0.12), metal, 0, 0.03, 0.32);
      add(box(0.04, 0.12, 0.05), mat(0x2a2a2a, 0.5), 0, -0.06, -0.04, 0.2); add(box(0.03, 0.03, 0.22), metal, 0, 0.04, -0.14); muzzleZ = 0.38;
    } else if (key === 'shotgun') {
      add(cyl(0.017, 0.72), metal, 0, 0.04, 0.42); add(cyl(0.014, 0.5), metal, 0, 0.005, 0.4); add(box(0.05, 0.05, 0.16), wood, 0, 0.0, 0.32);
      add(box(0.05, 0.08, 0.22), dark, 0, 0.02, 0.06); add(box(0.045, 0.09, 0.3), wood, 0, -0.04, -0.2, -0.12); muzzleZ = 0.8;
    } else if (key === 'rifle') {
      add(cyl(0.013, 0.62), metal, 0, 0.045, 0.5); add(box(0.05, 0.09, 0.32), dark, 0, 0.02, 0.1); add(box(0.035, 0.16, 0.06), dark, 0, -0.09, 0.14, 0.25);
      add(box(0.04, 0.05, 0.22), dark, 0, 0.0, 0.32); add(box(0.045, 0.08, 0.28), dark, 0, -0.02, -0.22, -0.1); add(cyl(0.02, 0.16), metal, 0, 0.1, 0.08); add(box(0.04, 0.12, 0.05), mat(0x2a2a2a, 0.5), 0, -0.06, -0.03, 0.2); muzzleZ = 0.82;
    } else if (key === 'rpg') {
      add(cyl(0.045, 0.9), olive, 0, 0.06, 0.2); add(cyl(0.05, 0.22, 0.02), mat(0x8a3a2a, 0.5), 0, 0.06, 0.76); add(cyl(0.06, 0.1, 0.045), olive, 0, 0.06, -0.3);
      add(box(0.04, 0.12, 0.05), mat(0x2a2a2a, 0.5), 0, -0.05, 0.05, 0.2); add(box(0.04, 0.1, 0.05), mat(0x2a2a2a, 0.5), 0, -0.04, 0.3, 0.2); muzzleZ = 0.9;
    } else { muzzleZ = 0.2; }
    const sc = key === 'pistol' ? 1.7 : key === 'uzi' ? 1.5 : 1.3; // chunky, readable silhouettes
    this.muzzle.position.set(0, 0.04 * sc, muzzleZ * sc);
    for (const c of this.gun.children) if (c !== this.muzzle) { c.scale.setScalar(sc); c.position.multiplyScalar(sc); }
  }

  // move: 0..1 blend, run: 0..1
  animate(dt, s = this.state) {
    const { move, run } = s;
    const speedMul = 6 + run * 6; if (move > 0.05 && !s.sitting) this.phase += dt * speedMul * (0.5 + move * 0.5);
    const amp = s.sitting ? 0 : lerp(0.35, 0.95, run) * move;
    const sw = Math.sin(this.phase), cw = Math.cos(this.phase);
    const L = 1 - Math.exp(-14 * dt);
    const setRot = (o, x, y = 0, z = 0) => { o.rotation.x = lerp(o.rotation.x, x, L); o.rotation.y = lerp(o.rotation.y, y, L); o.rotation.z = lerp(o.rotation.z, z, L); };
    this.gun.visible = s.hasWeapon && !s.dead;
    if (s.dead) {
      this.deadT += dt; const t = clamp(this.deadT * 2.2, 0, 1); const e = 1 - (1 - t) * (1 - t);
      this.body.rotation.x = lerp(this.body.rotation.x, -Math.PI / 2 * (this.deadDir ?? 1), e * 0.3 + 0.05);
      this.body.position.y = lerp(this.body.position.y, 0.15, 0.2);
      setRot(this.armL, -0.4, 0, -1.2); setRot(this.armR, 0.5, 0, 1.0); setRot(this.legL, 0.1, 0, 0.3); setRot(this.legR, -0.2, 0, -0.2); this.legL.lowerG.rotation.x = 0.4;
      return;
    }
    this.body.rotation.x = lerp(this.body.rotation.x, 0, L); this.body.position.y = lerp(this.body.position.y, 0, L);
    if (s.sitting) {
      setRot(this.legL, -1.45, 0, 0.05); setRot(this.legR, -1.45, 0, -0.05); this.legL.lowerG.rotation.x = lerp(this.legL.lowerG.rotation.x, 1.3, L); this.legR.lowerG.rotation.x = lerp(this.legR.lowerG.rotation.x, 1.3, L);
      setRot(this.armL, -1.0, 0, 0.35); setRot(this.armR, -1.0, 0, -0.35); this.armL.lowerG.rotation.x = lerp(this.armL.lowerG.rotation.x, -0.6, L); this.armR.lowerG.rotation.x = lerp(this.armR.lowerG.rotation.x, -0.6, L);
      this.torso.rotation.x = 0; this.body.position.y = -1.0; setRot(this.headG, 0, 0, 0);
      return;
    }
    if (s.swim) {
      this.phase += dt * 5; const p = this.phase;
      setRot(this.armL, -Math.PI + Math.sin(p) * 1.2, 0, 0.4); setRot(this.armR, -Math.PI + Math.sin(p + Math.PI) * 1.2, 0, -0.4);
      setRot(this.legL, Math.sin(p * 2) * 0.4, 0, 0); setRot(this.legR, -Math.sin(p * 2) * 0.4, 0, 0);
      this.body.rotation.x = lerp(this.body.rotation.x, 1.35, L); this.body.position.y = -0.6; return;
    }
    // legs
    setRot(this.legL, sw * amp, 0, 0); setRot(this.legR, -sw * amp, 0, 0);
    this.legL.lowerG.rotation.x = lerp(this.legL.lowerG.rotation.x, Math.max(0, -cw) * amp * 1.2, L);
    this.legR.lowerG.rotation.x = lerp(this.legR.lowerG.rotation.x, Math.max(0, cw) * amp * 1.2, L);
    if (s.airborne) { setRot(this.legL, -0.5, 0, 0.1); setRot(this.legR, 0.3, 0, -0.1); this.legL.lowerG.rotation.x = 1.0; }
    // arms
    const posing = (s.aiming || s.firePose > 0) && s.hasWeapon;
    if (posing) {
      const ap = s.aimPitch || 0; // + = aiming up
      // both hands meet in front of the chest so the weapon sits between the shoulders and reads from the over-shoulder camera
      // (Euler XYZ: z swings the hanging arm sideways, then x lifts it forward — so z is what brings the hands together)
      if (s.weaponLong) { setRot(this.armR, -Math.PI / 2 - ap, 0, -0.42); setRot(this.armL, -Math.PI / 2 - ap + 0.12, 0, 0.55); this.armL.lowerG.rotation.x = lerp(this.armL.lowerG.rotation.x, -0.55, L); this.armR.lowerG.rotation.x = lerp(this.armR.lowerG.rotation.x, 0, L); }
      else { setRot(this.armR, -Math.PI / 2 - ap, 0, -0.38); setRot(this.armL, -Math.PI / 2 - ap + 0.2, 0, 0.6); this.armL.lowerG.rotation.x = lerp(this.armL.lowerG.rotation.x, -0.5, L); this.armR.lowerG.rotation.x = lerp(this.armR.lowerG.rotation.x, 0, L); }
      this.gun.rotation.x = Math.PI / 2; this.gun.rotation.y = 0; this.gun.position.set(0, 0.03, 0.02);
      this.torso.rotation.y = lerp(this.torso.rotation.y, -0.35, L);
    } else if (s.punch > 0) {
      const p = s.punch; setRot(this.armR, -1.4 - Math.sin(p * Math.PI) * 0.6, 0.2, -0.1); this.armR.lowerG.rotation.x = -0.4 + Math.sin(p * Math.PI) * 0.4; setRot(this.armL, -0.9, -0.3, 0.3); this.armL.lowerG.rotation.x = -1.3;
    } else {
      const armAmp = amp * 0.9; const panic = s.panic ? 1 : 0;
      setRot(this.armL, -sw * armAmp - panic * 2.4, 0, 0.12 + panic * 0.6); setRot(this.armR, sw * armAmp - panic * 2.4, 0, -0.12 - panic * 0.6);
      this.armL.lowerG.rotation.x = lerp(this.armL.lowerG.rotation.x, -0.3 - run * 0.9, L); this.armR.lowerG.rotation.x = lerp(this.armR.lowerG.rotation.x, -0.3 - run * 0.9 - (s.hasWeapon ? 0.5 : 0), L);
      this.gun.rotation.x = Math.PI / 2; this.gun.position.set(0, 0, 0.02); this.torso.rotation.y = lerp(this.torso.rotation.y, 0, L);
    }
    // torso lean & bob
    this.torso.rotation.x = 0;
    this.body.rotation.x = lerp(this.body.rotation.x, run * 0.18 * move + (s.airborne ? 0.15 : 0), L);
    this.body.position.y = Math.abs(cw) * amp * 0.08;
    setRot(this.headG, posing ? -0.05 - (s.aimPitch || 0) * 0.5 : 0.05 - run * 0.1, posing ? 0.15 : 0, 0);
  }
}
