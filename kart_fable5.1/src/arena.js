import * as THREE from 'three';
import { tex } from './textures.js';
import { RNG, clamp, lerp } from './utils.js';

export const ARENAS = [
  { id: 'plaza', name: 'Block Plaza', theme: 'meadow', shape: 'square', half: 72, blurb: 'A sunny plaza of stone blocks. Classic close-quarters brawling.', groundY: -0.4, rails: true,
    sky: { top: 0x3f8fe8, bottom: 0xbfe6ff, fog: 0xbfe6ff, fogFar: 600, sun: 0xfff2d0, sunInt: 2.1, ambient: 0x8fb5d8, ambInt: 0.9, sunDir: [0.5, 0.9, 0.3] } },
  { id: 'crater', name: 'Crater Bowl', theme: 'lava', shape: 'circle', radius: 78, bowl: 0.0028, blurb: 'A volcanic bowl. Everything rolls to the middle, including shells.', groundY: -1.2, rails: true,
    sky: { top: 0x2a0d0d, bottom: 0x7a2a10, fog: 0x4a1c10, fogFar: 460, sun: 0xffb070, sunInt: 1.8, ambient: 0xff7040, ambInt: 1.6, sunDir: [0.2, 0.7, -0.6] } },
  { id: 'rooftop', name: 'Neon Rooftops', theme: 'neon', shape: 'square', half: 66, blurb: 'Pillars, boost pads and a long drop into the harbor.', groundY: -0.3, rails: true,
    sky: { top: 0x090a1f, bottom: 0x2a1a5a, fog: 0x161334, fogFar: 520, sun: 0x8090ff, sunInt: 1.1, ambient: 0x5050b0, ambInt: 1.4, sunDir: [-0.3, 0.8, 0.4] } },
];

const UP = new THREE.Vector3(0, 1, 0);
const std = (o) => new THREE.MeshStandardMaterial(o);

/** A bounded battle arena that exposes the same interface the kart physics uses on a Track. */
export class Arena {
  constructor(def) {
    this.def = def; this.isArena = true; this.rails = true; this.shoulder = 0; this.groundY = def.groundY; this.fall = 45;
    this.group = new THREE.Group(); this.pads = []; this.ramps = []; this.length = 1000; this.anim = [];
    this.extent = def.shape === 'circle' ? def.radius : def.half;
    this.obstacles = []; // { type: 'circle', x, z, r, h } | { type: 'box', x, z, hx, hz, h }
    this.rng = new RNG(99);
    this.buildLayout(); this.buildFloor(); this.buildWalls(); this.buildObstacles(); this.buildDecor(); this.buildSky();
    // interface shims used by HUD / camera / misc
    this.bounds = new THREE.Box3(new THREE.Vector3(-this.extent, -5, -this.extent), new THREE.Vector3(this.extent, 5, this.extent));
    this.pos = []; this.N = 96; for (let i = 0; i < this.N; i++) { const a = (i / this.N) * Math.PI * 2; const r = def.shape === 'circle' ? def.radius : def.half / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))); this.pos.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
    this.right = [new THREE.Vector3(1, 0, 0)]; this.tan = [new THREE.Vector3(0, 0, 1)]; this.curvature = new Float32Array(this.N);
  }
  floorY(x, z) { if (this.def.bowl) { const d2 = x * x + z * z; return this.def.bowl * d2 - this.def.bowl * this.def.radius * this.def.radius * 0.5; } return 0; }
  inside(x, z, margin = 0) { return this.def.shape === 'circle' ? Math.hypot(x, z) < this.def.radius - margin : Math.max(Math.abs(x), Math.abs(z)) < this.def.half - margin; }

  buildLayout() {
    const d = this.def, r = this.rng;
    if (d.id === 'plaza') {
      for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) { if (gx === 0 && gz === 0) continue; this.obstacles.push({ type: 'box', x: gx * 34, z: gz * 34, hx: 5, hz: 5, h: 3.5 + ((gx + gz) & 1) * 2 }); }
      for (const [x, z] of [[0, 34], [0, -34], [34, 0], [-34, 0]]) this.obstacles.push({ type: 'circle', x, z, r: 2.2, h: 5 });
      this.itemBoxSpots = [[0, 0], [17, 17], [-17, 17], [17, -17], [-17, -17], [52, 0], [-52, 0], [0, 52], [0, -52], [52, 52], [-52, 52], [52, -52], [-52, -52]].map(([x, z]) => new THREE.Vector3(x, 1, z));
    } else if (d.id === 'crater') {
      this.obstacles.push({ type: 'circle', x: 0, z: 0, r: 7, h: 6 });
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2 + r.range(-0.2, 0.2), rr = r.range(28, 60); this.obstacles.push({ type: 'circle', x: Math.cos(a) * rr, z: Math.sin(a) * rr, r: r.range(2.5, 5), h: r.range(3, 7) }); }
      this.itemBoxSpots = []; for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; this.itemBoxSpots.push(new THREE.Vector3(Math.cos(a) * 18, 0, Math.sin(a) * 18)); } for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.3; this.itemBoxSpots.push(new THREE.Vector3(Math.cos(a) * 62, 0, Math.sin(a) * 62)); }
    } else {
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; this.obstacles.push({ type: 'circle', x: Math.cos(a) * 30, z: Math.sin(a) * 30, r: 2.6, h: 7 }); }
      for (const [x, z] of [[46, 46], [-46, 46], [46, -46], [-46, -46]]) this.obstacles.push({ type: 'box', x, z, hx: 7, hz: 7, h: 4 });
      this.obstacles.push({ type: 'box', x: 0, z: 0, hx: 3, hz: 12, h: 2.5 });
      this.pads = [{ x: 0, z: 46, w: 6, yaw: Math.PI }, { x: 0, z: -46, w: 6, yaw: 0 }, { x: 46, z: 0, w: 6, yaw: -Math.PI / 2 }, { x: -46, z: 0, w: 6, yaw: Math.PI / 2 }];
      this.itemBoxSpots = [[16, 0], [-16, 0], [0, 22], [0, -22], [30, 30], [-30, 30], [30, -30], [-30, -30], [58, 20], [-58, -20], [20, -58], [-20, 58]].map(([x, z]) => new THREE.Vector3(x, 1, z));
    }
    this.itemBoxSpots.forEach((p) => (p.y = this.floorY(p.x, p.z) + 1.0));
    this.coinSpots = [];
    // spawn ring facing the centre
    this.grid = []; const R = this.extent * 0.72;
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2 + Math.PI / 12; const x = Math.cos(a) * R, z = Math.sin(a) * R; this.grid.push({ pos: new THREE.Vector3(x, this.floorY(x, z), z), yaw: Math.atan2(-x, -z), s: 0, lat: 0 }); }
  }

  buildFloor() {
    const th = this.def.theme; const size = this.extent * 2 + 4; const seg = 48;
    const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2);
    const pa = g.attributes.position; for (let i = 0; i < pa.count; i++) pa.setY(i, this.floorY(pa.getX(i), pa.getZ(i))); g.computeVertexNormals();
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size / 8, uv.getY(i) * size / 8);
    const map = { meadow: 'stone', lava: 'lavaRock', neon: 'asphaltNeon' }[th];
    const mat = std({ map: tex(map), roughness: 0.9 });
    if (th === 'neon') { mat.emissive = new THREE.Color(0x2aa0ff); mat.emissiveMap = tex('asphaltNeon'); mat.emissiveIntensity = 0.35; }
    const floor = new THREE.Mesh(g, mat); floor.receiveShadow = true; this.group.add(floor);
    // outer ground
    const gTex = { meadow: 'grass', lava: null, neon: null }[th];
    let gm;
    if (th === 'lava') gm = std({ color: 0xff5a10, emissive: 0xff4a00, emissiveIntensity: 1.6, roughness: 1 });
    else if (th === 'neon') gm = std({ color: 0x0a1a3a, roughness: 0.15, metalness: 0.6, emissive: 0x081432, emissiveIntensity: 0.6 });
    else { gm = std({ map: tex(gTex).clone(), roughness: 1 }); gm.map.repeat.set(140, 140); gm.map.needsUpdate = true; }
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), gm); ground.rotation.x = -Math.PI / 2; ground.position.y = this.groundY - (th === 'neon' ? 12 : 0.3); ground.receiveShadow = true; this.group.add(ground);
    if (th === 'neon') { const base = new THREE.Mesh(new THREE.BoxGeometry(size + 6, 14, size + 6), std({ map: tex('window'), emissive: 0xffffff, emissiveMap: tex('windowEmissive'), emissiveIntensity: 1.0 })); base.position.y = -7.2; this.group.add(base); }
    if (this.def.shape === 'circle') { const rim = new THREE.Mesh(new THREE.RingGeometry(this.def.radius, this.def.radius + 12, 48), std({ color: 0x3a2a2a, roughness: 1 })); rim.rotation.x = -Math.PI / 2; rim.position.y = this.floorY(this.def.radius, 0) + 0.02; this.group.add(rim); }
    // boost pads
    const padMat = std({ map: tex('boostPad'), emissive: 0xff8a00, emissiveMap: tex('boostPad'), emissiveIntensity: 0.8 });
    for (const p of this.pads) { const m = new THREE.Mesh(new THREE.PlaneGeometry(p.w, 7), padMat); m.rotation.x = -Math.PI / 2; m.rotation.z = -p.yaw; m.position.set(p.x, this.floorY(p.x, p.z) + 0.05, p.z); this.group.add(m); }
  }
  buildWalls() {
    const th = this.def.theme; const h = 1.6;
    const mat = std({ color: th === 'neon' ? 0x30e0ff : th === 'lava' ? 0x606060 : 0xd8d0c0, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide });
    if (th === 'neon') { mat.emissive = new THREE.Color(0x30e0ff); mat.emissiveIntensity = 0.9; }
    if (this.def.shape === 'circle') {
      const R = this.def.radius; const seg = 64; const verts = [], idx = [];
      for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2; const x = Math.cos(a) * R, z = Math.sin(a) * R; const y = this.floorY(x, z); verts.push(x, y - 0.3, z, x, y + h, z); }
      for (let i = 0; i < seg; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat); m.castShadow = true; this.group.add(m);
    } else {
      const H = this.def.half;
      for (const [x, z, rot] of [[0, H, 0], [0, -H, 0], [H, 0, Math.PI / 2], [-H, 0, Math.PI / 2]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(H * 2 + 1, h + 0.3, 0.6), mat); m.position.set(x, h / 2, z); m.rotation.y = rot; m.castShadow = true; m.receiveShadow = true; this.group.add(m); }
      const postMat = std({ color: 0x555a66 }); for (let i = -H; i <= H; i += 8) for (const [x, z] of [[i, H], [i, -H], [H, i], [-H, i]]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, h + 0.8, 6), postMat); p.position.set(x, h / 2 + 0.1, z); this.group.add(p); }
    }
  }
  buildObstacles() {
    const th = this.def.theme;
    const mat = th === 'lava' ? std({ color: 0x4a3a3a, roughness: 1, flatShading: true }) : th === 'neon' ? std({ color: 0x223, emissive: 0xff40c0, emissiveIntensity: 0.8, roughness: 0.4 }) : std({ color: 0xe0cfa8, roughness: 0.9 });
    const top = th === 'meadow' ? std({ map: tex('checker'), roughness: 0.8 }) : mat;
    for (const o of this.obstacles) {
      const y0 = this.floorY(o.x, o.z);
      let m;
      if (o.type === 'circle') m = new THREE.Mesh(th === 'lava' ? new THREE.DodecahedronGeometry(o.r, 1) : new THREE.CylinderGeometry(o.r, o.r * 1.05, o.h, 16), mat);
      else m = new THREE.Mesh(new THREE.BoxGeometry(o.hx * 2, o.h, o.hz * 2), [mat, mat, top, mat, mat, mat]);
      m.position.set(o.x, y0 + (th === 'lava' && o.type === 'circle' ? o.r * 0.6 : o.h / 2), o.z); if (th === 'lava' && o.type === 'circle') { m.scale.y = o.h / o.r * 0.7; }
      m.castShadow = true; m.receiveShadow = true; this.group.add(m);
      if (th === 'neon' && o.type === 'circle') { const cap = new THREE.Mesh(new THREE.SphereGeometry(o.r * 0.8, 12, 10), std({ color: 0xffffff, emissive: 0x40ffd0, emissiveIntensity: 2.5 })); cap.position.set(o.x, y0 + o.h + 0.5, o.z); this.group.add(cap); }
    }
  }
  buildDecor() {
    const th = this.def.theme, r = this.rng; const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(); const col = new THREE.Color();
    const ring = (n, minD, maxD, fn) => { for (let i = 0; i < n; i++) { const a = r.range(0, 6.3), d = this.extent + r.range(minD, maxD); fn(Math.cos(a) * d, Math.sin(a) * d, i); } };
    if (th === 'meadow') {
      const fol = new THREE.InstancedMesh(new THREE.ConeGeometry(2.2, 5, 7), std({ color: 0x3f9a3a, roughness: 0.9 }), 300); const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.4, 2.2, 6), std({ color: 0x6b4a2b }), 300); let n = 0;
      ring(300, 6, 120, (x, z) => { const sc = r.range(0.8, 1.6); Q.identity(); S.set(sc, sc, sc); M.compose(new THREE.Vector3(x, this.groundY + 4.7 * sc, z), Q, S); fol.setMatrixAt(n, M); col.setHSL(0.3 + r.range(-0.04, 0.04), 0.55, r.range(0.3, 0.42)); fol.setColorAt(n, col); M.compose(new THREE.Vector3(x, this.groundY + 1.1 * sc, z), Q, S); trunk.setMatrixAt(n, M); n++; });
      fol.count = trunk.count = n; fol.castShadow = trunk.castShadow = true; this.group.add(fol); this.group.add(trunk);
      // grandstands
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; const g = new THREE.Mesh(new THREE.BoxGeometry(30, 6, 8), std({ color: new THREE.Color().setHSL(i / 4, 0.7, 0.5) })); g.position.set(Math.cos(a) * (this.extent + 14), 3, Math.sin(a) * (this.extent + 14)); g.rotation.y = -a + Math.PI / 2; g.castShadow = true; this.group.add(g); }
      const cl = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), std({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.25 }), 80); let c = 0;
      for (let i = 0; i < 20; i++) { const x = r.range(-350, 350), z = r.range(-350, 350), y = r.range(55, 90); for (let k = 0; k < 4; k++) { const sc = r.range(5, 11); Q.identity(); S.set(sc * 1.6, sc * 0.6, sc); M.compose(new THREE.Vector3(x + r.range(-10, 10), y, z + r.range(-6, 6)), Q, S); cl.setMatrixAt(c++, M); } } cl.count = c; this.group.add(cl);
    } else if (th === 'lava') {
      const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1.2, 0), std({ color: 0x3a2a2a, roughness: 1, flatShading: true }), 200); let n = 0;
      ring(200, 4, 120, (x, z) => { const sc = r.range(1, 5); Q.setFromEuler(new THREE.Euler(r.range(0, 6), r.range(0, 6), 0)); S.set(sc, sc * 0.8, sc); M.compose(new THREE.Vector3(x, this.groundY + sc * 0.4, z), Q, S); rocks.setMatrixAt(n++, M); }); rocks.count = n; rocks.castShadow = true; this.group.add(rocks);
      const volcano = new THREE.Mesh(new THREE.ConeGeometry(90, 110, 12), std({ color: 0x2a1a1a, roughness: 1, flatShading: true })); volcano.position.set(0, this.groundY + 30, -this.extent - 220); this.group.add(volcano);
      const glow = new THREE.Mesh(new THREE.CylinderGeometry(18, 18, 6, 12), std({ color: 0xff7020, emissive: 0xff5000, emissiveIntensity: 2.5 })); glow.position.set(0, this.groundY + 83, -this.extent - 220); this.group.add(glow);
    } else {
      const bmat = std({ map: tex('window'), emissive: 0xffffff, emissiveMap: tex('windowEmissive'), emissiveIntensity: 1.2, roughness: 0.6 });
      const bl = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), bmat, 220); let n = 0;
      ring(220, 25, 200, (x, z) => { const w = r.range(8, 18), h = r.range(10, 70), dd = r.range(8, 18); Q.setFromAxisAngle(UP, Math.round(r.range(0, 3)) * Math.PI / 2); S.set(w, h, dd); M.compose(new THREE.Vector3(x, this.groundY - 12 + h / 2, z), Q, S); bl.setMatrixAt(n, M); col.setHSL(r.range(0.55, 0.75), 0.4, r.range(0.25, 0.5)); bl.setColorAt(n, col); n++; }); bl.count = n; this.group.add(bl);
      const sign = new THREE.InstancedMesh(new THREE.PlaneGeometry(8, 3), std({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.5, side: THREE.DoubleSide }), 30); let s2 = 0;
      ring(30, 8, 40, (x, z) => { Q.setFromAxisAngle(UP, r.range(0, 6.3)); S.set(1, 1, 1); M.compose(new THREE.Vector3(x, r.range(4, 12), z), Q, S); sign.setMatrixAt(s2, M); col.setHSL(r.range(0, 1), 1, 0.55); sign.setColorAt(s2, col); s2++; }); sign.count = s2; this.group.add(sign);
    }
  }
  buildSky() {
    const sk = this.def.sky;
    const geo = new THREE.SphereGeometry(900, 24, 12);
    const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, fog: false, depthWrite: false, uniforms: { top: { value: new THREE.Color(sk.top) }, bottom: { value: new THREE.Color(sk.bottom) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = normalize(vP).y; float t = smoothstep(-0.05, 0.5, h); gl_FragColor = vec4(mix(bottom, top, t), 1.0); }' });
    this.sky = new THREE.Mesh(geo, mat); this.group.add(this.sky);
  }

  // ---------- physics interface ----------
  sample(p, hint = -1, out = {}) {
    out.idx = 0; out.t = 0; out.s = 0; out.lat = 0; out.y = this.floorY(p.x, p.z); out.rx = 1; out.rz = 0; out.tx = 0; out.ty = 0; out.tz = 1;
    out.width = this.extent * 2; out.edge = 1e9; out.cx = p.x; out.cz = p.z; out.curv = 0; return out;
  }
  heightAt(smp) { return smp.y; }
  surfaceAt() { return 'road'; }
  posAt(s, lat = 0, up = 0) { return new THREE.Vector3(0, up, 0); }
  indexAtS() { return 0; }
  tangentAtS() { return this.tan[0]; }
  nearestIndex() { return 0; }
  update(dt, t) {}
  /** Nearest obstacle/boundary penetration for a circle at (x,z). Returns { nx, nz, depth } or null (pushes out in place if `pos` given). */
  collidePoint(pos, radius) {
    let hit = null;
    const apply = (nx, nz, depth) => { pos.x += nx * depth; pos.z += nz * depth; hit = { nx, nz, depth }; };
    if (this.def.shape === 'circle') { const d = Math.hypot(pos.x, pos.z); const lim = this.def.radius - radius; if (d > lim) apply(-pos.x / d, -pos.z / d, d - lim); }
    else { const lim = this.def.half - radius; if (pos.x > lim) apply(-1, 0, pos.x - lim); if (pos.x < -lim) apply(1, 0, -lim - pos.x); if (pos.z > lim) apply(0, -1, pos.z - lim); if (pos.z < -lim) apply(0, 1, -lim - pos.z); }
    for (const o of this.obstacles) {
      if (o.type === 'circle') { const dx = pos.x - o.x, dz = pos.z - o.z; const d = Math.hypot(dx, dz) || 1e-4; const min = o.r + radius; if (d < min) apply(dx / d, dz / d, min - d); }
      else { const cx = clamp(pos.x, o.x - o.hx, o.x + o.hx), cz = clamp(pos.z, o.z - o.hz, o.z + o.hz); const dx = pos.x - cx, dz = pos.z - cz; const d = Math.hypot(dx, dz); if (d < radius) { if (d < 1e-4) { const px = o.hx - Math.abs(pos.x - o.x), pz = o.hz - Math.abs(pos.z - o.z); if (px < pz) apply(Math.sign(pos.x - o.x) || 1, 0, px + radius); else apply(0, Math.sign(pos.z - o.z) || 1, pz + radius); } else apply(dx / d, dz / d, radius - d); } }
    }
    return hit;
  }
  /** Kart vs walls/obstacles: push out and reflect motion. */
  collideKart(k, sx, sz) {
    const hit = this.collidePoint(k.pos, k.radius * 0.8);
    if (!hit) return;
    const dot = sx * hit.nx + sz * hit.nz; // negative = moving into the surface
    if (dot < 0) {
      const severity = clamp(-dot, 0, 1);
      const rx = sx - 2 * dot * hit.nx, rz = sz - 2 * dot * hit.nz;
      k.velYaw = Math.atan2(rx, rz); k.yaw += Math.atan2(Math.sin(k.velYaw - k.yaw), Math.cos(k.velYaw - k.yaw)) * 0.5;
      k.speed *= 1 - 0.5 * severity;
      if (severity > 0.3) { k.wallHit = 0.3; k.emit('wall', { severity }); }
    }
  }
  /** Is the straight segment from p toward (dx,dz) for `len` metres blocked? Returns lateral sign to steer (or 0). */
  probe(x, z, dirx, dirz, len) {
    for (let t = 4; t <= len; t += 4) { const px = x + dirx * t, pz = z + dirz * t; const tmp = { x: px, z: pz }; if (this.collidePoint(tmp, 1.5)) return t; }
    return 0;
  }
  /** Boost pad check for arena pads. */
  onPad(x, z) { for (const p of this.pads) { const dx = x - p.x, dz = z - p.z; const lx = dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw), lz = dx * Math.sin(p.yaw) + dz * Math.cos(p.yaw); if (Math.abs(lx) < p.w / 2 && Math.abs(lz) < 3.5) return true; } return false; }
}
