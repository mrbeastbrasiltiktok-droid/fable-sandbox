import * as THREE from 'three';
import { clamp, lerp, damp, pick } from './utils.js';
import { resolveOBB } from './physics.js';

// ---------- vehicle catalogue (profile = side silhouette, x = length axis, y = height) ----------
export const VEHICLE_TYPES = {
  sedan:  { len: 4.5, wid: 1.85, mass: 1300, maxSpeed: 38, accel: 9, brake: 22, grip: 7.5, steer: 0.55, wheelR: 0.34, colors: [0xc0392b, 0x2980b9, 0xecf0f1, 0x2c3e50, 0x7f8c8d, 0x27ae60, 0x8e44ad, 0xf39c12, 0x1a1a1a, 0xd35400],
    profile: [[-2.25, 0.3], [-2.25, 0.78], [-1.85, 0.84], [-1.35, 0.86], [-0.85, 1.36], [0.55, 1.4], [1.25, 0.96], [2.05, 0.86], [2.25, 0.55], [2.25, 0.3]], cabin: [[-1.35, 0.86], [-0.85, 1.36], [0.55, 1.4], [1.25, 0.96]] },
  sports: { len: 4.4, wid: 1.95, mass: 1200, maxSpeed: 52, accel: 14, brake: 26, grip: 9.5, steer: 0.5, wheelR: 0.33, colors: [0xff2d2d, 0xffd600, 0x00c2ff, 0xffffff, 0x111111, 0xff7a00, 0x9b59b6],
    profile: [[-2.2, 0.3], [-2.2, 0.72], [-1.7, 0.8], [-1.1, 0.82], [-0.5, 1.15], [0.6, 1.18], [1.3, 0.8], [2.1, 0.66], [2.2, 0.45], [2.2, 0.3]], cabin: [[-1.1, 0.82], [-0.5, 1.15], [0.6, 1.18], [1.3, 0.8]] },
  suv:    { len: 4.8, wid: 2.0, mass: 2000, maxSpeed: 34, accel: 8, brake: 20, grip: 6.5, steer: 0.5, wheelR: 0.4, colors: [0x2c3e50, 0x1a1a1a, 0xecf0f1, 0x6d4c41, 0x556b2f, 0x7f8c8d],
    profile: [[-2.4, 0.4], [-2.4, 1.1], [-2.3, 1.85], [-2.0, 1.9], [1.0, 1.9], [1.5, 1.2], [2.3, 1.1], [2.4, 0.6], [2.4, 0.4]], cabin: [[-2.3, 1.1], [-2.25, 1.82], [1.0, 1.82], [1.45, 1.2]] },
  van:    { len: 5.0, wid: 2.0, mass: 2200, maxSpeed: 30, accel: 6, brake: 18, grip: 6, steer: 0.45, wheelR: 0.38, colors: [0xecf0f1, 0xbdc3c7, 0x2980b9, 0xc0392b, 0xf1c40f],
    profile: [[-2.5, 0.4], [-2.5, 2.1], [0.9, 2.1], [1.6, 1.25], [2.4, 1.15], [2.5, 0.6], [2.5, 0.4]], cabin: [[0.7, 1.3], [0.9, 2.0], [0.95, 2.0], [1.55, 1.3]] },
  pickup: { len: 5.2, wid: 2.0, mass: 1900, maxSpeed: 36, accel: 8.5, brake: 20, grip: 6.5, steer: 0.5, wheelR: 0.4, colors: [0xc0392b, 0x2c3e50, 0xecf0f1, 0x6d4c41, 0x7f8c8d],
    profile: [[-2.6, 0.45], [-2.6, 1.15], [-0.3, 1.15], [-0.3, 1.85], [0.9, 1.85], [1.5, 1.2], [2.5, 1.1], [2.6, 0.6], [2.6, 0.45]], cabin: [[-0.25, 1.2], [-0.25, 1.78], [0.9, 1.78], [1.45, 1.2]] },
  taxi:   { base: 'sedan', colors: [0xf5c518], maxSpeed: 40 },
  police: { base: 'sedan', colors: [0xf4f4f4], maxSpeed: 50, accel: 13.5, grip: 9, mass: 1500 },
};
for (const k in VEHICLE_TYPES) { const t = VEHICLE_TYPES[k]; if (t.base) VEHICLE_TYPES[k] = { ...VEHICLE_TYPES[t.base], ...t, name: k }; else t.name = k; }

const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a2c3c, roughness: 0.1, metalness: 0.8, transparent: true, opacity: 0.55 });
const tireMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 });
const rimMat = new THREE.MeshStandardMaterial({ color: 0xaeb4ba, roughness: 0.35, metalness: 0.9 });
const trimMat = new THREE.MeshStandardMaterial({ color: 0x1c1f22, roughness: 0.5, metalness: 0.4 });
const bodyGeoCache = new Map();
for (const m of [glassMat, tireMat, rimMat, trimMat]) m.userData.shared = true;

function profileGeometry(type, key, pts, width, bevel) {
  const ck = type.name + key + width; if (bodyGeoCache.has(ck)) return bodyGeoCache.get(ck);
  const shape = new THREE.Shape(); pts.forEach((p, i) => i === 0 ? shape.moveTo(p[0], p[1]) : shape.lineTo(p[0], p[1]));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: bevel, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2, curveSegments: 2 });
  geo.rotateY(-Math.PI / 2); geo.translate(width / 2, 0, 0); // length -> +z (front), width centred on x
  // After rotateY(-PI/2): original x (length) maps to +z? Let's compute: rotateY(theta) maps (x,z)->(x cosθ + z sinθ, -x sinθ + z cosθ); θ=-90°: (−z, x). So length x -> z' = x (front +z). width z -> x' = -z.
  geo.computeVertexNormals(); geo.userData.shared = true; bodyGeoCache.set(ck, geo); return geo;
}

let vehicleId = 0;
export class Vehicle {
  constructor(typeName, color) {
    const type = this.type = VEHICLE_TYPES[typeName] || VEHICLE_TYPES.sedan;
    this.id = vehicleId++; this.typeName = type.name;
    this.color = color ?? pick(type.colors);
    this.x = 0; this.z = 0; this.y = 0; this.heading = 0; this.vx = 0; this.vz = 0; this.vy = 0; this.angVel = 0; this.steer = 0;
    this.throttle = 0; this.brake = 0; this.handbrake = false; this.steerInput = 0;
    this.health = 100; this.destroyed = false; this.onFire = false; this.fireT = 0; this.smokeT = 0;
    this.driver = null; this.control = 'none'; // 'player' | 'ai' | 'cop' | 'none'
    this.halfL = type.len / 2; this.halfW = type.wid / 2;
    this.wheelSpin = 0; this.lastImpact = 0; this.braking = false; this.hornT = 0; this.airT = 0;
    this.sirenOn = false; this.lightsOn = false; this.owner = null; this.isParked = false; this.stuckT = 0;
    this.buildMesh();
  }

  buildMesh() {
    const t = this.type; const g = this.group = new THREE.Group(); g.userData.vehicle = this;
    const body = this.body = new THREE.Group(); g.add(body);
    this.paint = new THREE.MeshStandardMaterial({ color: this.color, roughness: 0.25, metalness: 0.6 });
    const shell = new THREE.Mesh(profileGeometry(t, 'body', t.profile, t.wid, true), this.paint); shell.castShadow = true; shell.receiveShadow = true; body.add(shell);
    const cabinPts = [...t.cabin, [t.cabin[t.cabin.length - 1][0], t.cabin[0][1]]];
    const cabin = new THREE.Mesh(profileGeometry(t, 'cabin', cabinPts, t.wid + 0.04, false), glassMat); cabin.position.y = 0.005; body.add(cabin);
    // pillars (thin dark boxes at cabin corners) & side trim
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(t.wid + 0.06, 0.05, 0.08), trimMat); pillar.position.set(0, t.cabin[0][1] + 0.02, t.cabin[0][0] + 0.02); body.add(pillar);
    const bpX = (t.cabin[1][0] + t.cabin[2][0]) / 2; const bp = new THREE.Mesh(new THREE.BoxGeometry(t.wid + 0.06, Math.max(0.1, t.cabin[1][1] - t.cabin[0][1] - 0.05), 0.08), trimMat); bp.position.set(0, (t.cabin[1][1] + t.cabin[0][1]) / 2, bpX); body.add(bp);
    const bumperF = new THREE.Mesh(new THREE.BoxGeometry(t.wid * 0.98, 0.22, 0.12), trimMat); bumperF.position.set(0, 0.42, t.len / 2 + 0.02); body.add(bumperF);
    const bumperR = bumperF.clone(); bumperR.position.z = -t.len / 2 - 0.02; body.add(bumperR);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(t.wid * 0.45, 0.16, 0.06), trimMat); grille.position.set(0, 0.68, t.len / 2 + 0.03); body.add(grille);
    // lights
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff2cc, emissiveIntensity: 0.3, roughness: 0.2 });
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x8b0000, emissive: 0xff2010, emissiveIntensity: 0.4, roughness: 0.3 });
    const hy = t.profile[t.profile.length - 3][1] + 0.05;
    for (const s of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.08), this.headMat); hl.position.set(s * (t.wid / 2 - 0.32), hy, t.len / 2 + 0.02); body.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.08), this.tailMat); tl.position.set(s * (t.wid / 2 - 0.3), t.profile[1][1] - 0.1, -t.len / 2 - 0.02); body.add(tl);
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.18), this.paint); mirror.position.set(s * (t.wid / 2 + 0.08), t.cabin[0][1] + 0.1, t.cabin[t.cabin.length - 1][0] - 0.1); body.add(mirror);
    }
    this.headY = hy; // headlight height (the game positions pooled spotlights here for the player's car)
    // wheels
    this.wheels = [];
    const wk = 'wheel' + t.wheelR; if (!bodyGeoCache.has(wk)) { const a = new THREE.CylinderGeometry(t.wheelR, t.wheelR, 0.26, 16); a.rotateZ(Math.PI / 2); a.userData.shared = true; const b = new THREE.CylinderGeometry(t.wheelR * 0.6, t.wheelR * 0.6, 0.27, 8); b.rotateZ(Math.PI / 2); b.userData.shared = true; bodyGeoCache.set(wk, [a, b]); }
    const [wg, rg] = bodyGeoCache.get(wk);
    const wb = t.len * 0.32;
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const pivot = new THREE.Group(); pivot.position.set(sx * (t.wid / 2 - 0.12), t.wheelR, sz * wb); g.add(pivot);
      const w = new THREE.Mesh(wg, tireMat); w.castShadow = true; pivot.add(w); const r = new THREE.Mesh(rg, rimMat); pivot.add(r);
      this.wheels.push({ pivot, mesh: w, rim: r, front: sz > 0 });
    }
    this.wheelbase = wb * 2;
    // type-specific extras
    if (t.name === 'police') {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.14, 0.3), trimMat); bar.position.set(0, t.cabin[1][1] + 0.07, (t.cabin[1][0] + t.cabin[2][0]) / 2); body.add(bar);
      this.sirenR = new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false }); this.sirenB = new THREE.MeshBasicMaterial({ color: 0x2060ff, toneMapped: false });
      const lr = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.14, 0.28), this.sirenR); lr.position.set(-0.3, t.cabin[1][1] + 0.16, bar.position.z); body.add(lr);
      const lb = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.14, 0.28), this.sirenB); lb.position.set(0.3, t.cabin[1][1] + 0.16, bar.position.z); body.add(lb);
      this.sirenY = t.cabin[1][1] + 0.6;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(t.wid + 0.02, 0.35, t.len * 0.6), new THREE.MeshStandardMaterial({ color: 0x0b1a3a, roughness: 0.3, metalness: 0.5 })); stripe.position.set(0, 0.62, 0); body.add(stripe);
    }
    if (t.name === 'taxi') {
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.3), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe680, emissiveIntensity: 0.6 })); sign.position.set(0, t.cabin[1][1] + 0.11, (t.cabin[1][0] + t.cabin[2][0]) / 2); body.add(sign);
      const check = new THREE.Mesh(new THREE.BoxGeometry(t.wid + 0.02, 0.18, t.len * 0.7), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 })); check.position.set(0, 0.7, 0); body.add(check);
    }
    // seat anchor
    this.seat = new THREE.Object3D(); this.seat.position.set(-0.38, 0.3 + (t.cabin[0][1] - 0.86), (t.cabin[0][0] + t.cabin[t.cabin.length - 1][0]) / 2 - 0.2); body.add(this.seat);
    // smoke/fire anchor at the hood
    this.hood = new THREE.Object3D(); this.hood.position.set(0, hy + 0.1, t.len / 2 - 0.8); body.add(this.hood);
  }

  get speed() { const s = Math.sin(this.heading), c = Math.cos(this.heading); return this.vx * s + this.vz * c; }
  get absSpeed() { return Math.hypot(this.vx, this.vz); }
  setPosition(x, z, heading) { this.x = x; this.z = z; this.heading = heading; this.vx = this.vz = 0; this.angVel = 0; this.syncMesh(); }

  syncMesh() { this.group.position.set(this.x, this.y, this.z); this.group.rotation.y = this.heading; }

  // Core arcade physics step. hash = city collider hash, ground(x,z) height fn.
  update(dt, world) {
    const t = this.type;
    if (this.destroyed) { this.throttle = 0; this.brake = 0; this.steerInput = 0; }
    const s = Math.sin(this.heading), c = Math.cos(this.heading);
    const fx = s, fz = c, rx = c, rz = -s;
    let vf = this.vx * fx + this.vz * fz, vr = this.vx * rx + this.vz * rz;
    const speedRatio = Math.abs(vf) / t.maxSpeed;
    // engine / brakes
    if (this.throttle > 0) {
      const a = t.accel * this.throttle * Math.max(0.15, 1 - speedRatio * speedRatio); vf += a * dt;
    }
    this.braking = false;
    if (this.brake > 0) {
      if (vf > 0.6) { vf -= t.brake * this.brake * dt; this.braking = true; if (vf < 0) vf = 0; }
      else if (vf > -t.maxSpeed * 0.35) { vf -= t.accel * 0.6 * this.brake * dt; }
    }
    if (this.handbrake && Math.abs(vf) > 0.2) { vf -= Math.sign(vf) * 6 * dt; this.braking = true; }
    // drag & rolling resistance
    vf -= vf * (0.04 + 0.0015 * Math.abs(vf)) * dt;
    if (this.throttle === 0 && this.brake === 0) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 1.2 * dt);
    if (this.destroyed) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 4 * dt);
    // lateral grip (handbrake -> drift)
    const gripBase = t.grip * (this.handbrake ? 0.22 : 1);
    const slide = Math.min(1, Math.abs(vr) / 9);
    const grip = gripBase * (1 - slide * 0.55);
    vr *= Math.exp(-grip * dt);
    // steering: full lock at low speed, tight at high speed
    const steerFalloff = 1 / (1 + Math.pow(Math.abs(vf) / 16, 1.5));
    const targetSteer = this.steerInput * t.steer * (0.35 + 0.65 * steerFalloff);
    this.steer = damp(this.steer, targetSteer, 10, dt);
    let yawRate = (vf / this.wheelbase) * Math.tan(this.steer) * 0.85;
    if (this.handbrake) yawRate *= 1.55;
    yawRate = clamp(yawRate, -2.6, 2.6);
    this.angVel = damp(this.angVel, yawRate, 8, dt);
    this.heading += this.angVel * dt;
    // recompose velocity in the new frame
    const s2 = Math.sin(this.heading), c2 = Math.cos(this.heading);
    this.vx = s2 * vf + c2 * vr; this.vz = c2 * vf - s2 * vr;
    this.x += this.vx * dt; this.z += this.vz * dt;
    // ground follow & water
    const gh = world.ground(this.x, this.z);
    if (this.y > gh + 0.05) { this.vy -= 22 * dt; this.y += this.vy * dt; this.airT += dt; if (this.y < gh) { this.y = gh; if (this.vy < -6) this.damage(-this.vy * 1.5, 'fall'); this.vy = 0; } }
    else { this.y = damp(this.y, gh, 12, dt); this.vy = 0; this.airT = 0; }
    if (world.isWater(this.x, this.z)) { this.waterT = (this.waterT || 0) + dt; this.vx *= 0.96; this.vz *= 0.96; if (this.waterT > 1.5 && !this.destroyed) this.kill('drown'); } else this.waterT = 0;
    // collisions with static world
    const hit = resolveOBB(world.hash, this, this.halfL, this.halfW);
    this.lastHit = null;
    if (hit) {
      const vn = this.vx * hit.nx + this.vz * hit.nz;
      if (vn < 0) {
        const rest = 0.25; this.vx -= (1 + rest) * vn * hit.nx; this.vz -= (1 + rest) * vn * hit.nz;
        const impact = -vn; if (impact > 3) { this.damage(impact * 1.6, 'crash'); this.lastHit = { impact, nx: hit.nx, nz: hit.nz, box: hit.box }; }
        // scrape: kill some tangential speed & spin a little
        this.vx *= 0.92; this.vz *= 0.92; this.angVel += (Math.random() - 0.5) * impact * 0.05;
      }
    }
    // fire / explosion timeline
    if (this.onFire && !this.destroyed) { this.fireT += dt; if (this.fireT > 3.5) this.explode(world); }
    // visuals
    this.wheelSpin += vf * dt / t.wheelR;
    for (const w of this.wheels) { w.pivot.rotation.y = w.front ? this.steer : 0; w.mesh.rotation.x = this.wheelSpin; w.rim.rotation.x = this.wheelSpin; }
    const latAcc = (vr - (this._pvr || 0)) / Math.max(dt, 1e-3); this._pvr = vr; const lonAcc = (vf - (this._pvf || 0)) / Math.max(dt, 1e-3); this._pvf = vf;
    this.body.rotation.z = damp(this.body.rotation.z, clamp(-this.angVel * Math.abs(vf) * 0.006 + latAcc * 0.002, -0.08, 0.08), 6, dt);
    this.body.rotation.x = damp(this.body.rotation.x, clamp(-lonAcc * 0.004, -0.05, 0.05), 6, dt);
    this.tailMat.emissiveIntensity = this.braking ? 3.0 : (this.lightsOn ? 1.0 : 0.3);
    this.headMat.emissiveIntensity = this.lightsOn ? 3.0 : 0.3;
    if (this.type.name === 'police' && this.sirenOn) {
      const ph = (performance.now() / 180) % 2 < 1;
      this.sirenR.color.setHex(ph ? 0xff2020 : 0x300000); this.sirenB.color.setHex(ph ? 0x100030 : 0x2060ff); this.sirenPhase = ph;
    } else if (this.sirenR) { this.sirenR.color.setHex(0x801010); this.sirenB.color.setHex(0x102080); }
    this.syncMesh();
  }

  setLights(on) { this.lightsOn = on; }

  damage(amount, cause, source = null) {
    if (this.destroyed) return;
    const byPlayer = !!(source && (source.kind === 'player' || source.control === 'player' || source.driver?.kind === 'player' || source.byPlayer || source.lastDamage?.byPlayer));
    this.health -= amount; this.lastDamage = { amount, cause, t: performance.now(), byPlayer: byPlayer || (this.lastDamage?.byPlayer && performance.now() - this.lastDamage.t < 4000) };
    this.onDamaged?.(amount, cause);
    if (this.health < 25 && !this.onFire) { this.onFire = true; this.fireT = 0; }
    if (this.health <= -40) this.explode(this.world);
  }
  kill(cause) { if (this.destroyed) return; this.destroyed = true; this.onFire = false; this.paint.color.setHex(0x1a1a1a); this.paint.roughness = 0.95; this.paint.metalness = 0.1; this.headMat.emissiveIntensity = 0; this.tailMat.emissiveIntensity = 0; this.setLights(false); this.sirenOn = false; this.onDestroyed?.(cause); }
  explode(world) { if (this.destroyed) return; this.kill('explode'); this.vy = 6; this.y += 0.1; this.angVel += (Math.random() - 0.5) * 3; this.onExploded?.(); }
  dispose() {
    this.group.parent?.remove(this.group);
    const geos = new Set(), mats = new Set();
    this.group.traverse(o => { if (o.geometry) geos.add(o.geometry); const list = Array.isArray(o.material) ? o.material : [o.material]; for (const m of list) if (m) mats.add(m); });
    for (const geo of geos) if (!geo.userData.shared) geo.dispose();
    for (const m of mats) if (!m.userData.shared) m.dispose();
  }
}

// Pairwise car-vs-car collision (two circles per car). Applies impulses and returns impact magnitude.
const A = { x: 0, z: 0 }, B = { x: 0, z: 0 };
export function collideVehicles(a, b) {
  const dxC = a.x - b.x, dzC = a.z - b.z; const rr = a.halfL + b.halfL;
  if (dxC * dxC + dzC * dzC > rr * rr) return 0;
  let maxImpact = 0;
  const sa = Math.sin(a.heading), ca = Math.cos(a.heading), sb = Math.sin(b.heading), cb = Math.cos(b.heading);
  const offA = a.halfL - a.halfW, offB = b.halfL - b.halfW; const ra = a.halfW + 0.05, rb = b.halfW + 0.05;
  for (const ka of [-1, 0, 1]) for (const kb of [-1, 0, 1]) {
    A.x = a.x + sa * offA * ka; A.z = a.z + ca * offA * ka; B.x = b.x + sb * offB * kb; B.z = b.z + cb * offB * kb;
    const dx = A.x - B.x, dz = A.z - B.z; const d2 = dx * dx + dz * dz; const minD = ra + rb;
    if (d2 >= minD * minD || d2 < 1e-6) continue;
    const d = Math.sqrt(d2); const nx = dx / d, nz = dz / d; const pen = minD - d;
    const ma = a.type.mass, mb = b.type.mass; const tot = ma + mb;
    a.x += nx * pen * (mb / tot); a.z += nz * pen * (mb / tot); b.x -= nx * pen * (ma / tot); b.z -= nz * pen * (ma / tot);
    const rvx = a.vx - b.vx, rvz = a.vz - b.vz; const vn = rvx * nx + rvz * nz;
    if (vn < 0) {
      const e = 0.35; const j = -(1 + e) * vn / (1 / ma + 1 / mb);
      a.vx += j / ma * nx; a.vz += j / ma * nz; b.vx -= j / mb * nx; b.vz -= j / mb * nz;
      // spin from off-centre hits
      a.angVel += (ka * 0.35) * (vn) * -0.15 * (nx * ca - nz * sa) * (mb / tot); b.angVel += (kb * 0.35) * (vn) * 0.15 * (nx * cb - nz * sb) * (ma / tot);
      const impact = -vn; maxImpact = Math.max(maxImpact, impact);
      if (impact > 2.5) { a.damage(impact * 1.2 * (mb / tot) * 2, 'car', b); b.damage(impact * 1.2 * (ma / tot) * 2, 'car', a); a.lastCarHit = { other: b, impact }; b.lastCarHit = { other: a, impact }; }
    }
  }
  return maxImpact;
}
