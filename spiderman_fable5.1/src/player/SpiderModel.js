import * as THREE from 'three';
import { damp, clamp } from '../core/Utils.js';

/**
 * Procedural Spider-Man built from capsules, with a tiny pose-based animation system.
 * Model origin = centre of the character (hips). Feet at y ≈ -0.9, head top at y ≈ +0.95.
 */
function webTexture(base, line) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = line; g.lineWidth = 2.2; g.globalAlpha = 0.8;
  const cx = 128, cy = 128;
  for (let a = 0; a < 16; a++) {
    const t = (a / 16) * Math.PI * 2;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(t) * 200, cy + Math.sin(t) * 200); g.stroke();
  }
  for (let r = 14; r < 200; r += 16) {
    g.beginPath();
    for (let a = 0; a <= 16; a++) {
      const t0 = (a / 16) * Math.PI * 2, t1 = ((a + 0.5) / 16) * Math.PI * 2;
      const x0 = cx + Math.cos(t0) * r, y0 = cy + Math.sin(t0) * r;
      const xm = cx + Math.cos(t1) * (r - 4), ym = cy + Math.sin(t1) * (r - 4);
      if (a === 0) g.moveTo(x0, y0); else g.quadraticCurveTo(xm, ym, x0, y0);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class SpiderModel {
  constructor() {
    this.root = new THREE.Group();
    const redTex = webTexture('#d81f2a', '#2a0a0c');
    const red = new THREE.MeshStandardMaterial({ map: redTex, color: 0xffffff, roughness: 0.55 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x1e3aa8, roughness: 0.6 });
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, emissive: 0xffffff, emissiveIntensity: 0.35 });
    const black = new THREE.MeshStandardMaterial({ color: 0x0b0b0e, roughness: 0.7 });
    this.mats = { red, blue, white, black };

    const cap = (r, len, mat) => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat); m.castShadow = true; return m; };
    const sph = (r, mat, ws = 12) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, ws, ws), mat); m.castShadow = true; return m; };

    // Hips / torso
    this.hips = new THREE.Group(); this.root.add(this.hips);
    this.torso = new THREE.Group(); this.torso.position.y = 0.08; this.hips.add(this.torso);
    const pelvis = cap(0.17, 0.12, blue); pelvis.position.y = 0.0; pelvis.scale.set(1.15, 1, 0.8); this.hips.add(pelvis);
    const chest = cap(0.2, 0.32, red); chest.position.y = 0.32; chest.scale.set(1.25, 1, 0.75); this.torso.add(chest);
    const abdomen = cap(0.16, 0.12, blue); abdomen.position.y = 0.12; abdomen.scale.set(1.15, 1, 0.75); this.torso.add(abdomen);
    // spider emblem
    const emblem = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), black); emblem.position.set(0, 0.42, 0.17); emblem.scale.set(0.9, 1.4, 0.4); this.torso.add(emblem);

    // Head
    this.neck = new THREE.Group(); this.neck.position.y = 0.6; this.torso.add(this.neck);
    const head = sph(0.155, red, 16); head.position.y = 0.16; head.scale.set(0.95, 1.1, 1); this.neck.add(head);
    for (const s of [-1, 1]) {
      const lensB = sph(0.065, black); lensB.position.set(s * 0.07, 0.19, 0.115); lensB.scale.set(1.15, 0.85, 0.5); lensB.rotation.z = -s * 0.35; this.neck.add(lensB);
      const lens = sph(0.055, white); lens.position.set(s * 0.07, 0.19, 0.125); lens.scale.set(1.15, 0.8, 0.5); lens.rotation.z = -s * 0.35; this.neck.add(lens);
    }

    // Limbs: pivot -> segment -> joint pivot -> segment
    const limb = (parent, pos, r1, l1, r2, l2, m1, m2, m3) => {
      const p = new THREE.Group(); p.position.copy(pos); parent.add(p);
      const upper = cap(r1, l1, m1); upper.position.y = -(l1 / 2 + r1 * 0.3); p.add(upper);
      const joint = new THREE.Group(); joint.position.y = -(l1 + r1 * 0.6); p.add(joint);
      const lower = cap(r2, l2, m2); lower.position.y = -(l2 / 2 + r2 * 0.3); joint.add(lower);
      const end = sph(r2 * 1.1, m3, 8); end.position.y = -(l2 + r2 * 0.6); joint.add(end);
      return { pivot: p, joint, end };
    };
    this.armL = limb(this.torso, new THREE.Vector3(-0.27, 0.52, 0), 0.065, 0.26, 0.055, 0.26, red, blue, red);
    this.armR = limb(this.torso, new THREE.Vector3(0.27, 0.52, 0), 0.065, 0.26, 0.055, 0.26, red, blue, red);
    this.legL = limb(this.hips, new THREE.Vector3(-0.12, -0.02, 0), 0.085, 0.36, 0.07, 0.36, blue, blue, red);
    this.legR = limb(this.hips, new THREE.Vector3(0.12, -0.02, 0), 0.085, 0.36, 0.07, 0.36, blue, blue, red);
    // slightly boot-shaped feet
    for (const l of [this.legL, this.legR]) l.end.scale.set(1, 0.7, 1.6);

    this.state = 'idle';
    this.phase = 0;
    this.attackT = 0; this.attackIdx = 0;
    this.dodgeT = 0;
    this.anchorLocal = new THREE.Vector3(0, 1, 0);
    this.swingHand = 1; // 1 right, -1 left
    this._pose = {};
    this._target = {};
    this.parts = { torso: this.torso, neck: this.neck, shL: this.armL.pivot, shR: this.armR.pivot, elL: this.armL.joint, elR: this.armR.joint, hipL: this.legL.pivot, hipR: this.legR.pivot, knL: this.legL.joint, knR: this.legR.joint };
    for (const k in this.parts) this._pose[k] = new THREE.Euler();
    this.hipsY = 0;
    this._armQuat = new THREE.Quaternion(); this._aimQ = new THREE.Quaternion(); this._aiming = false;
    this._inv = new THREE.Matrix4(); this._down = new THREE.Vector3(0, -1, 0);
    this._tmpV = new THREE.Vector3();
  }

  /** Poses: [x, y, z] euler per part. */
  static POSES = {
    idle: { torso: [0.05, 0, 0], neck: [0, 0, 0], shL: [0.15, 0, 0.18], shR: [0.15, 0, -0.18], elL: [-0.35, 0, 0], elR: [-0.35, 0, 0], hipL: [0, 0, 0.06], hipR: [0, 0, -0.06], knL: [0.05, 0, 0], knR: [0.05, 0, 0] },
    crouch: { torso: [0.45, 0, 0], neck: [-0.3, 0, 0], shL: [-0.6, 0, 0.5], shR: [-0.6, 0, -0.5], elL: [-1.2, 0, 0], elR: [-1.2, 0, 0], hipL: [-1.5, 0.3, 0.4], hipR: [-1.5, -0.3, -0.4], knL: [2.2, 0, 0], knR: [2.2, 0, 0] },
    jump: { torso: [-0.1, 0, 0], neck: [-0.1, 0, 0], shL: [-0.5, 0, 1.2], shR: [-0.5, 0, -1.2], elL: [-0.6, 0, 0], elR: [-0.6, 0, 0], hipL: [-1.0, 0, 0.2], hipR: [0.4, 0, -0.2], knL: [1.6, 0, 0], knR: [0.8, 0, 0] },
    fall: { torso: [0.35, 0, 0], neck: [-0.35, 0, 0], shL: [-0.3, 0, 1.6], shR: [-0.3, 0, -1.6], elL: [-0.5, 0, 0], elR: [-0.5, 0, 0], hipL: [-0.5, 0, 0.5], hipR: [-0.5, 0, -0.5], knL: [0.9, 0, 0], knR: [0.9, 0, 0] },
    dive: { torso: [1.2, 0, 0], neck: [-0.7, 0, 0], shL: [-1.6, 0, 0.25], shR: [-1.6, 0, -0.25], elL: [-0.1, 0, 0], elR: [-0.1, 0, 0], hipL: [-0.1, 0, 0.1], hipR: [-0.1, 0, -0.1], knL: [0.15, 0, 0], knR: [0.15, 0, 0] },
    swing: { torso: [0.25, 0, 0], neck: [-0.4, 0, 0], shL: [-0.9, 0, 0.9], shR: [-0.9, 0, -0.9], elL: [-0.6, 0, 0], elR: [-0.6, 0, 0], hipL: [-0.9, 0, 0.25], hipR: [-0.5, 0, -0.25], knL: [1.5, 0, 0], knR: [1.0, 0, 0] },
    zip: { torso: [1.3, 0, 0], neck: [-0.8, 0, 0], shL: [-2.6, 0, 0.15], shR: [-2.6, 0, -0.15], elL: [0, 0, 0], elR: [0, 0, 0], hipL: [0, 0, 0.1], hipR: [0, 0, -0.1], knL: [0.1, 0, 0], knR: [0.1, 0, 0] },
    wall: { torso: [0.3, 0, 0], neck: [-0.6, 0, 0], shL: [-1.4, 0, 1.3], shR: [-1.4, 0, -1.3], elL: [-1.0, 0, 0], elR: [-1.0, 0, 0], hipL: [-1.6, 0.6, 0.9], hipR: [-1.6, -0.6, -0.9], knL: [1.9, 0, 0], knR: [1.9, 0, 0] },
    punch: { torso: [0.15, -0.5, 0], neck: [0, 0.4, 0], shL: [-1.7, 0, 0.3], shR: [0.6, 0, -0.5], elL: [-0.15, 0, 0], elR: [-1.6, 0, 0], hipL: [-0.3, 0, 0.25], hipR: [0.2, 0, -0.25], knL: [0.5, 0, 0], knR: [0.3, 0, 0] },
    punch2: { torso: [0.15, 0.5, 0], neck: [0, -0.4, 0], shR: [-1.7, 0, -0.3], shL: [0.6, 0, 0.5], elR: [-0.15, 0, 0], elL: [-1.6, 0, 0], hipR: [-0.3, 0, -0.25], hipL: [0.2, 0, 0.25], knR: [0.5, 0, 0], knL: [0.3, 0, 0] },
    kick: { torso: [-0.2, 0.3, 0], neck: [0, -0.2, 0], shL: [0.5, 0, 1.1], shR: [0.5, 0, -1.1], elL: [-0.9, 0, 0], elR: [-0.9, 0, 0], hipL: [-2.0, 0, 0.2], hipR: [0.3, 0, -0.2], knL: [0.2, 0, 0], knR: [0.5, 0, 0] },
    uppercut: { torso: [-0.35, -0.6, 0], neck: [-0.2, 0.3, 0], shL: [0.2, 0, 0.3], shR: [-2.9, 0, -0.4], elL: [-0.6, 0, 0], elR: [-0.9, 0, 0], hipL: [-0.4, 0, 0.3], hipR: [-0.9, 0, -0.3], knL: [0.8, 0, 0], knR: [1.4, 0, 0] },
    hurt: { torso: [-0.4, 0, 0.2], neck: [0.3, 0, 0], shL: [-0.8, 0, 0.8], shR: [-0.8, 0, -0.8], elL: [-1.0, 0, 0], elR: [-1.0, 0, 0], hipL: [-0.3, 0, 0.3], hipR: [0.3, 0, -0.3], knL: [0.6, 0, 0], knR: [0.4, 0, 0] },
    ko: { torso: [0.2, 0, 0], neck: [0.4, 0, 0], shL: [0.3, 0, 1.4], shR: [0.3, 0, -1.4], elL: [-0.4, 0, 0], elR: [-0.4, 0, 0], hipL: [0.3, 0, 0.4], hipR: [0.2, 0, -0.4], knL: [0.5, 0, 0], knR: [0.3, 0, 0] },
  };

  /** ctx: { speed, runPhase, anchorDir (world), velocity, facing (yaw), grounded, attack:{idx,t}, dodgeT, landT } */
  update(dt, ctx) {
    const P = SpiderModel.POSES;
    let pose = P.idle, rate = 12, crawl = false;
    let hipsY = 0;
    const s = ctx.state;
    if (s === 'run') { pose = null; }
    else if (s === 'idle') pose = P.idle;
    else if (s === 'jump') pose = P.jump;
    else if (s === 'fall') pose = ctx.speed > 28 ? P.dive : P.fall;
    else if (s === 'swing') pose = P.swing;
    else if (s === 'zip') pose = P.zip;
    else if (s === 'wall') pose = P.wall;
    else if (s === 'crawl') { pose = null; crawl = true; }
    else if (s === 'land') { pose = P.crouch; hipsY = -0.25; rate = 22; }
    else if (s === 'attack') { pose = [P.punch, P.punch2, P.kick, P.uppercut][ctx.attackIdx % 4]; rate = 26; }
    else if (s === 'hurt') pose = P.hurt;
    else if (s === 'dodge') { pose = P.crouch; rate = 20; }
    else if (s === 'ko') pose = P.ko;

    const t = {};
    if (pose) for (const k in this.parts) t[k] = pose[k] || P.idle[k];
    else if (crawl) {
      // spider crawl: limbs alternate around the spread 'wall' pose, amplitude follows speed
      const moving = clamp(ctx.speed / 6, 0, 1);
      this.phase += dt * (2 + ctx.speed * 0.9) * moving;
      const a = 0.45 * moving, sw = Math.sin(this.phase), sw2 = Math.sin(this.phase + Math.PI);
      const base = P.wall;
      for (const k in this.parts) t[k] = base[k].slice();
      t.shL[0] += sw * a; t.shR[0] += sw2 * a; t.hipL[0] += sw2 * a; t.hipR[0] += sw * a;
      t.knL[0] -= Math.max(0, sw) * a; t.knR[0] -= Math.max(0, sw2) * a;
      rate = 14;
    }
    else {
      // procedural run cycle
      this.phase += dt * clamp(ctx.speed, 4, 22) * 0.55;
      const ph = this.phase, sw = Math.sin(ph), sw2 = Math.sin(ph + Math.PI);
      const amp = 0.9, sprint = clamp((ctx.speed - 10) / 10, 0, 1);
      t.torso = [0.25 + sprint * 0.3, 0, sw * 0.08];
      t.neck = [-0.2 - sprint * 0.2, 0, 0];
      t.shL = [sw2 * amp * 0.8, 0, 0.25]; t.shR = [sw * amp * 0.8, 0, -0.25];
      t.elL = [-1.2, 0, 0]; t.elR = [-1.2, 0, 0];
      t.hipL = [sw * amp, 0, 0.05]; t.hipR = [sw2 * amp, 0, -0.05];
      t.knL = [Math.max(0, -sw2) * 1.6 + 0.2, 0, 0]; t.knR = [Math.max(0, -sw) * 1.6 + 0.2, 0, 0];
      hipsY = Math.abs(Math.cos(ph)) * 0.06;
      rate = 16;
    }
    // Apply with smoothing
    for (const k in this.parts) {
      const e = this._pose[k], tg = t[k];
      e.x = damp(e.x, tg[0], rate, dt); e.y = damp(e.y, tg[1], rate, dt); e.z = damp(e.z, tg[2], rate, dt);
      this.parts[k].rotation.copy(e);
    }
    this.hipsY = damp(this.hipsY, hipsY, rate, dt);
    this.hips.position.y = this.hipsY;

    // Swinging: point the web arm at the anchor
    if ((s === 'swing' || s === 'zip') && ctx.anchorDir) {
      const arm = this.swingHand > 0 ? this.armR : this.armL;
      const pivot = arm.pivot;
      // anchor direction in torso-local space; the arm's rest direction is (0,-1,0)
      this.torso.updateWorldMatrix(true, false);
      this._inv.copy(this.torso.matrixWorld).invert();
      const local = this._tmpV.copy(ctx.anchorDir).transformDirection(this._inv).normalize();
      this._armQuat.setFromUnitVectors(this._down, local);
      if (!this._aiming) { this._aimQ.copy(this._armQuat); this._aiming = true; }
      this._aimQ.slerp(this._armQuat, 1 - Math.exp(-25 * dt));
      pivot.quaternion.copy(this._aimQ);
      arm.joint.rotation.set(damp(arm.joint.rotation.x, -0.1, 20, dt), 0, 0);
    } else this._aiming = false;
    // Dodge roll: spin around local X
    if (ctx.spin > 0 && ctx.spin < 1) this.hips.rotation.x = ctx.spin * Math.PI * 2; else this.hips.rotation.x = damp(this.hips.rotation.x, 0, 15, dt);
  }
}
