import * as THREE from 'three';
import { tex } from './textures.js';
import { RNG, clamp, lerp, smoothstep } from './utils.js';

const UP = new THREE.Vector3(0, 1, 0);
const CURB_W = 0.8;
const TERRAIN_W = 90;
const TERRAIN_BY_THEME = { lava: 14 };

export class Track {
  constructor(def) {
    this.def = def;
    this.group = new THREE.Group();
    this.rails = def.rails;
    this.shoulder = def.shoulder;
    this.groundY = def.groundY;
    this.fall = def.theme === 'lava' ? 10 : 45; // terrain falloff distance beyond the shoulder
    this.buildSpline();
    this.buildRoad();
    this.buildFeatures();
    this.anim = [];
    this.buildDecor();
    this.buildExtras();
    this.buildSky();
  }

  // ---------- spline ----------
  buildSpline() {
    const pts = this.def.points.map((p) => new THREE.Vector3(p[0], p[2], p[1]));
    const wpts = this.def.points.map((p) => new THREE.Vector3(p[3], 0, 0));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
    this.widthCurve = new THREE.CatmullRomCurve3(wpts, true, 'centripetal', 0.5);
    const approxLen = this.curve.getLength();
    const N = Math.ceil(approxLen / 0.6);
    this.N = N;
    this.pos = new Array(N); this.tan = new Array(N); this.right = new Array(N); this.width = new Float32Array(N); this.s = new Float32Array(N);
    this.curvature = new Float32Array(N);
    let s = 0;
    for (let i = 0; i < N; i++) {
      const u = i / N;
      const p = this.curve.getPointAt(u);
      const t = this.curve.getTangentAt(u).normalize();
      this.pos[i] = p; this.tan[i] = t;
      this.right[i] = new THREE.Vector3().crossVectors(t, UP).normalize();
      this.width[i] = this.widthCurve.getPointAt(u).x;
      if (i > 0) s += p.distanceTo(this.pos[i - 1]);
      this.s[i] = s;
    }
    this.length = s + this.pos[N - 1].distanceTo(this.pos[0]);
    for (let i = 0; i < N; i++) {
      const a = this.tan[(i + N - 8) % N], b = this.tan[(i + 8) % N];
      const ang = Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z);
      this.curvature[i] = ang / (this.s[(i + 8) % N] - this.s[(i + N - 8) % N] + (i + 8 >= N || i - 8 < 0 ? this.length : 0) || 9.6);
    }
    // segment lengths
    this.segLen = new Float32Array(N);
    for (let i = 0; i < N; i++) this.segLen[i] = this.pos[i].distanceTo(this.pos[(i + 1) % N]);
    this.coarse = []; for (let i = 0; i < N; i += 6) this.coarse.push(i);
    // bounds
    const b = new THREE.Box3(); this.pos.forEach((p) => b.expandByPoint(p)); this.bounds = b;
  }

  edgeLat(i) { return this.width[i] * 0.5 + CURB_W + this.shoulder; }

  /** Nearest sample index from a world position. Local search around hint if given. */
  nearestIndex(p, hint = -1) {
    const N = this.N;
    let best = -1, bd = Infinity;
    if (hint >= 0) {
      for (let k = -40; k <= 40; k++) {
        const i = (hint + k + N) % N;
        const q = this.pos[i]; const dx = p.x - q.x, dz = p.z - q.z, dy = (p.y - q.y) * 0.5;
        const d = dx * dx + dz * dz + dy * dy;
        if (d < bd) { bd = d; best = i; }
      }
      if (bd < 900) return best;
    }
    bd = Infinity;
    for (const i of this.coarse) { const q = this.pos[i]; const dx = p.x - q.x, dz = p.z - q.z, dy = (p.y - q.y) * 0.5; const d = dx * dx + dz * dz + dy * dy; if (d < bd) { bd = d; best = i; } }
    let fine = best; bd = Infinity;
    for (let k = -6; k <= 6; k++) { const i = (best + k + N) % N; const q = this.pos[i]; const dx = p.x - q.x, dz = p.z - q.z; const d = dx * dx + dz * dz; if (d < bd) { bd = d; fine = i; } }
    return fine;
  }

  /** Full sample: {idx, s, lat, y, tan, right, width, edge, t} */
  sample(p, hint = -1, out = {}) {
    const N = this.N;
    const i0 = this.nearestIndex(p, hint);
    // choose segment: i0-1..i0 or i0..i0+1 by projecting
    const a = this.pos[i0], b = this.pos[(i0 + 1) % N], c = this.pos[(i0 - 1 + N) % N];
    let i = i0, t;
    const abx = b.x - a.x, abz = b.z - a.z; const apx = p.x - a.x, apz = p.z - a.z;
    const l2 = abx * abx + abz * abz || 1e-6;
    t = (apx * abx + apz * abz) / l2;
    if (t < 0) { // use previous segment
      i = (i0 - 1 + N) % N; const cax = a.x - c.x, caz = a.z - c.z; const cpx = p.x - c.x, cpz = p.z - c.z; const l22 = cax * cax + caz * caz || 1e-6;
      t = clamp((cpx * cax + cpz * caz) / l22, 0, 1);
    } else t = clamp(t, 0, 1);
    const P0 = this.pos[i], P1 = this.pos[(i + 1) % N];
    const R0 = this.right[i], R1 = this.right[(i + 1) % N];
    const T0 = this.tan[i], T1 = this.tan[(i + 1) % N];
    const px = P0.x + (P1.x - P0.x) * t, py = P0.y + (P1.y - P0.y) * t, pz = P0.z + (P1.z - P0.z) * t;
    let rx = R0.x + (R1.x - R0.x) * t, rz = R0.z + (R1.z - R0.z) * t; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
    let tx = T0.x + (T1.x - T0.x) * t, ty = T0.y + (T1.y - T0.y) * t, tz = T0.z + (T1.z - T0.z) * t; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    out.idx = i; out.t = t;
    out.s = (this.s[i] + this.segLen[i] * t) % this.length;
    out.lat = (p.x - px) * rx + (p.z - pz) * rz;
    out.y = py;
    out.rx = rx; out.rz = rz; out.tx = tx; out.ty = ty; out.tz = tz;
    out.width = this.width[i] + (this.width[(i + 1) % N] - this.width[i]) * t;
    out.edge = out.width * 0.5 + CURB_W + this.shoulder;
    out.cx = px; out.cz = pz;
    out.curv = this.curvature[i];
    return out;
  }

  /** Ground height at a sample for a given lateral (beyond edge terrain falls off). */
  heightAt(smp, lat) {
    const a = Math.abs(lat);
    if (a <= smp.edge) return smp.y;
    if (!this.rails && !this.def.terrain) return this.groundY; // void
    const d = a - smp.edge;
    return lerp(smp.y, this.groundY, smoothstep(0, 1, d / this.fall));
  }

  surfaceAt(smp, lat) {
    const a = Math.abs(lat), hw = smp.width * 0.5;
    if (a <= hw) {
      const f = smp.s / this.length;
      for (const z of this.def.hazardZones) if (f >= z.t0 && f <= z.t1) return z.type;
      return 'road';
    }
    if (a <= hw + CURB_W) return 'curb';
    if (a <= smp.edge) return 'offroad';
    return this.rails ? 'offroad' : 'void';
  }

  posAt(s, lat = 0, up = 0) {
    s = ((s % this.length) + this.length) % this.length;
    // binary search s
    let lo = 0, hi = this.N - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.s[m] <= s) lo = m; else hi = m - 1; }
    const i = lo, t = clamp((s - this.s[i]) / (this.segLen[i] || 1), 0, 1);
    const P0 = this.pos[i], P1 = this.pos[(i + 1) % this.N]; const R = this.right[i];
    return new THREE.Vector3(P0.x + (P1.x - P0.x) * t + R.x * lat, P0.y + (P1.y - P0.y) * t + up, P0.z + (P1.z - P0.z) * t + R.z * lat);
  }
  indexAtS(s) { s = ((s % this.length) + this.length) % this.length; let lo = 0, hi = this.N - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.s[m] <= s) lo = m; else hi = m - 1; } return lo; }
  tangentAtS(s) { return this.tan[this.indexAtS(s)]; }

  // ---------- geometry ----------
  strip(latA, latB, mat, opts = {}) {
    const N = this.N, sub = opts.sub || 1;
    const verts = [], uvs = [], idx = [], norms = [];
    const rows = N + 1;
    for (let r = 0; r < rows; r++) {
      const i = r % N; const p = this.pos[i], R = this.right[i];
      const s = r === N ? this.length : this.s[i];
      for (let k = 0; k <= sub; k++) {
        const f = k / sub;
        const la = typeof latA === 'function' ? latA(i) : latA, lb = typeof latB === 'function' ? latB(i) : latB;
        const lat = la + (lb - la) * f;
        let y = p.y + (opts.yOff || 0);
        if (opts.height) y = opts.height(i, lat);
        verts.push(p.x + R.x * lat, y, p.z + R.z * lat);
        uvs.push(s / (opts.tileU || 8), (opts.vScale || 1) * f);
        norms.push(0, 1, 0);
      }
    }
    const cols = sub + 1;
    for (let r = 0; r < N; r++) for (let k = 0; k < sub; k++) {
      const a = r * cols + k, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.castShadow = !!opts.castShadow;
    return m;
  }

  buildRoad() {
    const th = this.def.theme;
    const roadTex = { neon: 'asphaltNeon', space: 'rainbow', lava: 'lavaRock' }[th] || 'asphalt';
    const groundTex = { meadow: 'grass', desert: 'sand', snow: 'snow', neon: 'concrete', lava: 'lavaRock', space: null }[th];
    const roadMat = new THREE.MeshStandardMaterial({ map: tex(roadTex), roughness: 0.92, metalness: 0.02, side: th === 'space' ? THREE.DoubleSide : THREE.FrontSide });
    if (th === 'space') { roadMat.emissive = new THREE.Color(0xffffff); roadMat.emissiveMap = tex('rainbow'); roadMat.emissiveIntensity = 0.55; }
    if (th === 'neon') { roadMat.emissive = new THREE.Color(0x2aa0ff); roadMat.emissiveMap = tex('asphaltNeon'); roadMat.emissiveIntensity = 0.35; }
    const hw = (i) => this.width[i] * 0.5;
    const roadTile = th === 'space' ? 4 : 10;
    this.group.add(this.strip((i) => -hw(i), (i) => hw(i), roadMat, { tileU: roadTile, sub: 2, yOff: 0.0 }));

    // ice / bump zones overlay
    for (const z of this.def.hazardZones) {
      const i0 = Math.floor(z.t0 * this.N), i1 = Math.floor(z.t1 * this.N);
      const mat = z.type === 'ice' ? new THREE.MeshStandardMaterial({ map: tex('ice'), roughness: 0.15, metalness: 0.1 }) : new THREE.MeshStandardMaterial({ map: tex('dirt'), roughness: 1 });
      const verts = [], uvs = [], idx = [];
      let n = 0;
      for (let i = i0; i <= i1; i++) {
        const p = this.pos[i], R = this.right[i], w = hw(i);
        verts.push(p.x - R.x * w, p.y + 0.02, p.z - R.z * w, p.x + R.x * w, p.y + 0.02, p.z + R.z * w);
        uvs.push(this.s[i] / 8, 0, this.s[i] / 8, 1); n++;
      }
      for (let r = 0; r < n - 1; r++) { const a = r * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat); m.receiveShadow = true; this.group.add(m);
    }

    // curbs
    const curbMat = new THREE.MeshStandardMaterial({ map: tex(th === 'neon' || th === 'space' ? 'curbBlue' : 'curb'), roughness: 0.7 });
    this.group.add(this.strip((i) => hw(i), (i) => hw(i) + CURB_W, curbMat, { tileU: 2, yOff: 0.03 }));
    this.group.add(this.strip((i) => -hw(i) - CURB_W, (i) => -hw(i), curbMat, { tileU: 2, yOff: 0.03 }));

    if (th === 'space') {
      // underside + sides of the floating ribbon
      const under = new THREE.MeshStandardMaterial({ color: 0x1b1240, roughness: 0.8, side: THREE.DoubleSide, emissive: 0x2a1a6a, emissiveIntensity: 0.4 });
      const e = (i) => hw(i) + CURB_W;
      this.group.add(this.strip((i) => -e(i), (i) => e(i), under, { yOff: -0.9, sub: 1 }));
      const sideMat = new THREE.MeshStandardMaterial({ color: 0x3a2a8a, roughness: 0.6, side: THREE.DoubleSide, emissive: 0x6040ff, emissiveIntensity: 0.6 });
      for (const sgn of [-1, 1]) {
        const verts = [], idx = [];
        for (let r = 0; r <= this.N; r++) { const i = r % this.N; const p = this.pos[i], R = this.right[i]; const l = e(i) * sgn; verts.push(p.x + R.x * l, p.y + 0.03, p.z + R.z * l, p.x + R.x * l, p.y - 0.9, p.z + R.z * l); }
        for (let r = 0; r < this.N; r++) { const a = r * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); g.setIndex(idx); g.computeVertexNormals();
        this.group.add(new THREE.Mesh(g, sideMat));
      }
      return;
    }

    // shoulder (off-road) + terrain falloff
    const shoulderTex = { meadow: 'grass', desert: 'sand', snow: 'snow', neon: 'concrete', lava: 'lavaRock' }[th];
    const shMat = new THREE.MeshStandardMaterial({ map: tex(shoulderTex), roughness: 1 });
    if (th === 'lava') shMat.color.set(0x8a7a7a);
    const e = (i) => hw(i) + CURB_W;
    const edge = (i) => this.edgeLat(i);
    this.group.add(this.strip(e, edge, shMat, { tileU: 12, vScale: 1, yOff: -0.02 }));
    this.group.add(this.strip((i) => -edge(i), (i) => -e(i), shMat, { tileU: 12, yOff: -0.02 }));
    const terrMat = new THREE.MeshStandardMaterial({ map: tex(groundTex), roughness: 1 });
    if (th === 'lava') { terrMat.color.set(0x5a4a4a); }
    const hf = (sgn) => (i, lat) => { const a = Math.abs(lat) - this.edgeLat(i); return lerp(this.pos[i].y, this.groundY, smoothstep(0, 1, a / this.fall)) - 0.03; };
    const TW = TERRAIN_BY_THEME[th] || TERRAIN_W;
    this.group.add(this.strip(edge, (i) => edge(i) + TW, terrMat, { tileU: 12, vScale: 6, sub: 6, height: hf(1) }));
    this.group.add(this.strip((i) => -edge(i) - TW, (i) => -edge(i), terrMat, { tileU: 12, vScale: 6, sub: 6, height: hf(-1) }));

    // ground plane
    const gSize = 1600;
    let gMat;
    if (th === 'lava') gMat = new THREE.MeshStandardMaterial({ color: 0xff5a10, emissive: 0xff4a00, emissiveIntensity: 1.6, roughness: 1 });
    else gMat = new THREE.MeshStandardMaterial({ map: tex(groundTex), roughness: 1 });
    if (gMat.map) { gMat.map = gMat.map.clone(); gMat.map.repeat.set(140, 140); gMat.map.needsUpdate = true; }
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(gSize, gSize), gMat);
    ground.rotation.x = -Math.PI / 2; ground.position.y = this.groundY - (th === 'lava' ? 0.6 : 0.08); ground.receiveShadow = true;
    const c = this.bounds.getCenter(new THREE.Vector3()); ground.position.x = c.x; ground.position.z = c.z;
    this.group.add(ground);

    // walls
    if (this.rails) {
      const railMat = new THREE.MeshStandardMaterial({ color: th === 'neon' ? 0x30e0ff : th === 'lava' ? 0x606060 : th === 'snow' ? 0x9fb8d0 : 0xc0c8d0, roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide });
      if (th === 'neon') { railMat.emissive = new THREE.Color(0x30e0ff); railMat.emissiveIntensity = 0.9; }
      for (const sgn of [-1, 1]) {
        const verts = [], idx = [], uvs = [];
        for (let r = 0; r <= this.N; r++) { const i = r % this.N; const p = this.pos[i], R = this.right[i]; const l = edge(i) * sgn; verts.push(p.x + R.x * l, p.y - 0.2, p.z + R.z * l, p.x + R.x * l, p.y + 1.0, p.z + R.z * l); uvs.push(this.s[i] / 4, 0, this.s[i] / 4, 1); }
        for (let r = 0; r < this.N; r++) { const a = r * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx); g.computeVertexNormals();
        const m = new THREE.Mesh(g, railMat); m.castShadow = true; m.receiveShadow = true; this.group.add(m);
      }
      // posts
      const postGeo = new THREE.CylinderGeometry(0.08, 0.1, 1.3, 6);
      const postMat = new THREE.MeshStandardMaterial({ color: 0x555a66, roughness: 0.6 });
      const count = Math.ceil(this.length / 6) * 2;
      const posts = new THREE.InstancedMesh(postGeo, postMat, count);
      const M = new THREE.Matrix4(); let n = 0;
      for (let s = 0; s < this.length; s += 6) for (const sgn of [-1, 1]) { const i = this.indexAtS(s); const p = this.pos[i], R = this.right[i]; const l = edge(i) * sgn; M.makeTranslation(p.x + R.x * l, p.y + 0.4, p.z + R.z * l); posts.setMatrixAt(n++, M); }
      posts.count = n; posts.castShadow = true; this.group.add(posts);
    }
  }

  buildFeatures() {
    const th = this.def.theme;
    // start line
    const startMat = new THREE.MeshStandardMaterial({ map: tex('checker'), roughness: 0.8 });
    {
      const i = 0, p = this.pos[i], R = this.right[i], T = this.tan[i], w = this.width[i] * 0.5;
      const g = new THREE.PlaneGeometry(w * 2, 3, 1, 1);
      const m = new THREE.Mesh(g, startMat); startMat.map = startMat.map.clone(); startMat.map.repeat.set(w, 1.5); startMat.map.needsUpdate = true;
      m.position.set(p.x, p.y + 0.04, p.z); m.lookAt(p.x + T.x, p.y + 0.04 + T.y, p.z + T.z); m.rotateX(-Math.PI / 2); m.rotateZ(Math.PI / 2);
      m.receiveShadow = true; this.group.add(m);
      // arch
      const archMat = new THREE.MeshStandardMaterial({ color: th === 'neon' ? 0xff2a9a : 0xd83030, roughness: 0.5, metalness: 0.3 });
      if (th === 'neon') { archMat.emissive = new THREE.Color(0xff2a9a); archMat.emissiveIntensity = 0.8; }
      for (const sgn of [-1, 1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 7, 10), archMat); post.position.set(p.x + R.x * (w + 1.2) * sgn, p.y + 3.5, p.z + R.z * (w + 1.2) * sgn); post.castShadow = true; this.group.add(post); }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 3.2, 1.6, 1.0), new THREE.MeshStandardMaterial({ map: tex('checker'), roughness: 0.7 }));
      beam.material.map = beam.material.map.clone(); beam.material.map.repeat.set(w, 1); beam.material.map.needsUpdate = true;
      beam.position.set(p.x, p.y + 7.2, p.z); beam.lookAt(p.x + T.x, p.y + 7.2, p.z + T.z); beam.rotateY(Math.PI / 2); beam.castShadow = true; this.group.add(beam);
    }

    // boost pads
    this.pads = [];
    const padMat = new THREE.MeshStandardMaterial({ map: tex('boostPad'), emissive: 0xff8a00, emissiveMap: tex('boostPad'), emissiveIntensity: 0.8, roughness: 0.6 });
    for (const pd of this.def.boostPads) {
      const s = pd.t * this.length, len = 7;
      const i = this.indexAtS(s), p = this.posAt(s, pd.lat, 0.05), T = this.tan[i];
      const m = new THREE.Mesh(new THREE.PlaneGeometry(pd.w, len), padMat);
      m.position.copy(p); m.lookAt(p.x + T.x, p.y + T.y, p.z + T.z); m.rotateX(-Math.PI / 2); m.rotateZ(0);
      this.group.add(m);
      this.pads.push({ s0: s - len / 2, s1: s + len / 2, lat: pd.lat, hw: pd.w / 2 });
    }
    // ramps
    this.ramps = [];
    const rampMat = new THREE.MeshStandardMaterial({ color: th === 'space' ? 0x6a5aff : 0xb0a090, roughness: 0.7, emissive: th === 'space' ? 0x3a2aff : 0x000000, emissiveIntensity: 0.5 });
    for (const r of this.def.ramps) {
      const s = r.t * this.length, len = 9, h = 2.2;
      const i = this.indexAtS(s), p = this.posAt(s, r.lat, 0), T = this.tan[i];
      const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(len, 0); shape.lineTo(len, h); shape.lineTo(0, 0);
      const g = new THREE.ExtrudeGeometry(shape, { depth: r.w, bevelEnabled: false });
      g.translate(-len / 2, 0, -r.w / 2); g.rotateY(-Math.PI / 2);
      const m = new THREE.Mesh(g, rampMat); m.position.copy(p); m.lookAt(p.x + T.x, p.y + T.y, p.z + T.z); m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
      this.ramps.push({ s0: s - len / 2, s1: s + len / 2, lat: r.lat, hw: r.w / 2, len, h });
    }

    // item boxes
    this.itemBoxSpots = [];
    for (const t of this.def.itemBoxes) {
      const s = t * this.length; const i = this.indexAtS(s); const w = this.width[i] * 0.5;
      const n = 5;
      for (let k = 0; k < n; k++) { const lat = -w * 0.75 + (w * 1.5 * k) / (n - 1); this.itemBoxSpots.push(this.posAt(s, lat, 1.0)); }
    }
    // coins
    this.coinSpots = [];
    const rng = new RNG(7);
    for (const t of this.def.coins) {
      const s0 = t * this.length; const pattern = rng.int(0, 2);
      for (let k = 0; k < 6; k++) {
        const s = s0 + k * 2.6; const i = this.indexAtS(s); const w = this.width[i] * 0.5;
        const lat = pattern === 0 ? 0 : pattern === 1 ? (k % 2 ? w * 0.5 : -w * 0.5) : Math.sin(k * 0.9) * w * 0.6;
        this.coinSpots.push(this.posAt(s, lat, 0.6));
      }
    }

    // start grid
    this.grid = [];
    for (let i = 0; i < 12; i++) {
      const s = this.length - 7 - i * 2.9; const lat = (i % 2 === 0 ? -1 : 1) * this.width[0] * 0.24; // staggered two-column grid
      const idx = this.indexAtS(s);
      this.grid.push({ pos: this.posAt(s, lat, 0), yaw: Math.atan2(this.tan[idx].x, this.tan[idx].z), s, lat });
    }
    // rendering of grid slots
    const slotMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
    for (const g of this.grid.slice(0, 8)) { const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3), slotMat); m.position.copy(g.pos).y += 0.03; m.rotation.x = -Math.PI / 2; m.rotation.z = -g.yaw; this.group.add(m); }

    // hazard: geysers/bumps decoration placeholders handled in decor
  }

  // Check if point is at least `minDist` beyond the track edge everywhere
  clearOfTrack(x, z, minDist) {
    let bd = Infinity, bi = 0;
    for (const i of this.coarse) { const q = this.pos[i]; const dx = x - q.x, dz = z - q.z; const d = dx * dx + dz * dz; if (d < bd) { bd = d; bi = i; } }
    return Math.sqrt(bd) > this.edgeLat(bi) + minDist;
  }
  randomOutside(rng, minD, maxD) {
    for (let tries = 0; tries < 20; tries++) {
      const i = rng.int(0, this.N - 1); const p = this.pos[i], R = this.right[i];
      const d = this.edgeLat(i) + rng.range(minD, maxD); const sgn = rng.chance(0.5) ? -1 : 1;
      const x = p.x + R.x * d * sgn, z = p.z + R.z * d * sgn;
      if (!this.clearOfTrack(x, z, minD - 0.5)) continue;
      const a = d - this.edgeLat(i); const y = lerp(p.y, this.groundY, smoothstep(0, 1, a / this.fall));
      return new THREE.Vector3(x, y, z);
    }
    return null;
  }

  buildDecor() {
    const th = this.def.theme, rng = new RNG(1234), d = this.def.deco;
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
    const inst = (geo, mat, count) => { const im = new THREE.InstancedMesh(geo, mat, count); im.castShadow = true; im.receiveShadow = true; im.count = 0; this.group.add(im); return im; };
    const put = (im, pos, yaw, sc, color) => { P.copy(pos); Q.setFromAxisAngle(UP, yaw); S.set(sc, sc, sc); M.compose(P, Q, S); im.setMatrixAt(im.count, M); if (color) im.setColorAt(im.count, color); im.count++; };
    const col = new THREE.Color();

    if (th === 'meadow') {
      const fol = inst(new THREE.ConeGeometry(2.2, 5, 7), new THREE.MeshStandardMaterial({ color: 0x3f9a3a, roughness: 0.9 }), d.trees);
      const trunk = inst(new THREE.CylinderGeometry(0.3, 0.4, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 }), d.trees);
      for (let i = 0; i < d.trees; i++) { const p = this.randomOutside(rng, 3, 60); if (!p) continue; const sc = rng.range(0.7, 1.5); col.setHSL(0.3 + rng.range(-0.04, 0.04), 0.55, rng.range(0.3, 0.42)); put(fol, p.clone().add(new THREE.Vector3(0, 2.2 * sc + 2.5 * sc, 0)), rng.range(0, 6), sc, col); put(trunk, p.clone().add(new THREE.Vector3(0, 1.1 * sc, 0)), 0, sc); }
      const hay = inst(new THREE.CylinderGeometry(0.9, 0.9, 1.4, 12), new THREE.MeshStandardMaterial({ color: 0xd8b860, roughness: 1 }), d.extra);
      for (let i = 0; i < d.extra; i++) { const p = this.randomOutside(rng, 1, 6); if (!p) continue; put(hay, p.clone().add(new THREE.Vector3(0, 0.9, 0)), rng.range(0, 6), 1); }
      // flowers
      const fl = inst(new THREE.CircleGeometry(0.35, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, side: THREE.DoubleSide }), 400);
      for (let i = 0; i < 400; i++) { const p = this.randomOutside(rng, 0.5, 40); if (!p) continue; P.copy(p).y += 0.12; Q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)); S.set(1, 1, 1); M.compose(P, Q, S); fl.setMatrixAt(fl.count, M); col.setHSL(rng.range(0, 1), 0.8, 0.6); fl.setColorAt(fl.count, col); fl.count++; }
      this.addClouds(rng, 30);
      // windmill
      const p = this.randomOutside(rng, 20, 40); if (p) this.addWindmill(p);
    } else if (th === 'desert') {
      const cac = inst(new THREE.CapsuleGeometry(0.5, 2.4, 4, 8), new THREE.MeshStandardMaterial({ color: 0x4a8a3a, roughness: 0.9 }), d.cacti * 3);
      for (let i = 0; i < d.cacti; i++) { const p = this.randomOutside(rng, 2, 50); if (!p) continue; const sc = rng.range(0.7, 1.4); put(cac, p.clone().add(new THREE.Vector3(0, 1.6 * sc, 0)), 0, sc); if (rng.chance(0.7)) put(cac, p.clone().add(new THREE.Vector3(0.7 * sc, 1.9 * sc, 0)), 0, sc * 0.5); if (rng.chance(0.7)) put(cac, p.clone().add(new THREE.Vector3(-0.7 * sc, 1.6 * sc, 0)), 0, sc * 0.45); }
      const mesa = inst(new THREE.CylinderGeometry(6, 9, 14, 7), new THREE.MeshStandardMaterial({ color: 0xc86a3a, roughness: 1, flatShading: true }), d.mesas);
      for (let i = 0; i < d.mesas; i++) { const p = this.randomOutside(rng, 12, 70); if (!p) continue; const sc = rng.range(0.8, 2.2); col.setHSL(0.05 + rng.range(-0.02, 0.02), 0.6, rng.range(0.4, 0.5)); put(mesa, p.clone().add(new THREE.Vector3(0, 7 * sc - 2, 0)), rng.range(0, 6), sc, col); }
      this.addRocks(rng, d.rocks, 0xa07050);
      this.addClouds(rng, 12);
    } else if (th === 'snow') {
      const pine = inst(new THREE.ConeGeometry(1.8, 6, 7), new THREE.MeshStandardMaterial({ color: 0x2f6a45, roughness: 0.9 }), d.pines);
      const snowcap = inst(new THREE.ConeGeometry(1.2, 2.4, 7), new THREE.MeshStandardMaterial({ color: 0xf4f8ff, roughness: 1 }), d.pines);
      const trunk = inst(new THREE.CylinderGeometry(0.25, 0.35, 2, 6), new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 1 }), d.pines);
      for (let i = 0; i < d.pines; i++) { const p = this.randomOutside(rng, 3, 60); if (!p) continue; const sc = rng.range(0.7, 1.6); put(pine, p.clone().add(new THREE.Vector3(0, 3 * sc + 1.5 * sc, 0)), rng.range(0, 6), sc); put(snowcap, p.clone().add(new THREE.Vector3(0, 6.2 * sc + 1.5 * sc - 1.2 * sc, 0)), 0, sc); put(trunk, p.clone().add(new THREE.Vector3(0, 1 * sc, 0)), 0, sc); }
      const sm = inst(new THREE.SphereGeometry(0.7, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), d.snowmen * 3);
      for (let i = 0; i < d.snowmen; i++) { const p = this.randomOutside(rng, 1.5, 10); if (!p) continue; put(sm, p.clone().add(new THREE.Vector3(0, 0.7, 0)), 0, 1.1); put(sm, p.clone().add(new THREE.Vector3(0, 1.9, 0)), 0, 0.8); put(sm, p.clone().add(new THREE.Vector3(0, 2.8, 0)), 0, 0.55); }
      this.addRocks(rng, d.rocks, 0x8090a0);
      this.addClouds(rng, 20);
    } else if (th === 'neon') {
      const bmat = new THREE.MeshStandardMaterial({ map: tex('window'), emissive: 0xffffff, emissiveMap: tex('windowEmissive'), emissiveIntensity: 1.2, roughness: 0.6 });
      const bl = inst(new THREE.BoxGeometry(1, 1, 1), bmat, d.buildings);
      for (let i = 0; i < d.buildings; i++) { const p = this.randomOutside(rng, 6, 60); if (!p) continue; const w = rng.range(6, 14), h = rng.range(8, 45), dd = rng.range(6, 14); P.set(p.x, p.y + h / 2 - 0.5, p.z); Q.setFromAxisAngle(UP, Math.round(rng.range(0, 3)) * Math.PI / 2); S.set(w, h, dd); M.compose(P, Q, S); bl.setMatrixAt(bl.count, M); col.setHSL(rng.range(0.55, 0.75), 0.4, rng.range(0.25, 0.5)); bl.setColorAt(bl.count, col); bl.count++; }
      const lampPole = inst(new THREE.CylinderGeometry(0.08, 0.1, 4.5, 6), new THREE.MeshStandardMaterial({ color: 0x334, roughness: 0.6 }), d.lamps);
      const lampHead = inst(new THREE.SphereGeometry(0.35, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff40c0, emissiveIntensity: 2.5 }), d.lamps);
      for (let i = 0; i < d.lamps; i++) { const s = (i / d.lamps) * this.length; const idx = this.indexAtS(s); const sgn = i % 2 ? 1 : -1; const p = this.posAt(s, (this.edgeLat(idx) + 0.8) * sgn, 0); put(lampPole, p.clone().add(new THREE.Vector3(0, 2.2, 0)), 0, 1); const c2 = col.setHSL(rng.range(0, 1), 1, 0.6).clone(); put(lampHead, p.clone().add(new THREE.Vector3(0, 4.6, 0)), 0, 1, c2); }
      // neon signs
      const sign = inst(new THREE.PlaneGeometry(6, 2.2), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.5, side: THREE.DoubleSide }), 40);
      for (let i = 0; i < 40; i++) { const p = this.randomOutside(rng, 3, 12); if (!p) continue; P.set(p.x, p.y + rng.range(3, 8), p.z); Q.setFromAxisAngle(UP, rng.range(0, 6.3)); S.set(1, 1, 1); M.compose(P, Q, S); sign.setMatrixAt(sign.count, M); col.setHSL(rng.range(0, 1), 1, 0.55); sign.setColorAt(sign.count, col); sign.count++; }
    } else if (th === 'lava') {
      this.addRocks(rng, d.rocks, 0x4a3a3a);
      const gz = inst(new THREE.CylinderGeometry(0.4, 1.6, 6, 8), new THREE.MeshStandardMaterial({ color: 0xff9a30, emissive: 0xff6a00, emissiveIntensity: 2.0, transparent: true, opacity: 0.85 }), d.geysers);
      for (let i = 0; i < d.geysers; i++) { const p = this.randomOutside(rng, 4, 30); if (!p) continue; put(gz, p.clone().add(new THREE.Vector3(0, 2.5, 0)), 0, rng.range(0.6, 1.4)); }
      const volcano = new THREE.Mesh(new THREE.ConeGeometry(60, 70, 12), new THREE.MeshStandardMaterial({ color: 0x2a1a1a, roughness: 1, flatShading: true }));
      const c = this.bounds.getCenter(new THREE.Vector3()); volcano.position.set(c.x, this.groundY + 20, c.z); this.group.add(volcano);
      const glow = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 4, 12), new THREE.MeshStandardMaterial({ color: 0xff7020, emissive: 0xff5000, emissiveIntensity: 2.5 })); glow.position.set(c.x, this.groundY + 53, c.z); this.group.add(glow);
    } else if (th === 'space') {
      const crystal = inst(new THREE.OctahedronGeometry(1.5, 0), new THREE.MeshStandardMaterial({ color: 0xa0c0ff, emissive: 0x4060ff, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.6, flatShading: true }), d.crystals);
      for (let i = 0; i < d.crystals; i++) { const idx = rng.int(0, this.N - 1); const p = this.pos[idx], R = this.right[idx]; const dd = rng.range(12, 60) * (rng.chance(0.5) ? 1 : -1); P.set(p.x + R.x * dd, p.y + rng.range(-25, 25), p.z + R.z * dd); Q.setFromEuler(new THREE.Euler(rng.range(0, 6), rng.range(0, 6), 0)); const sc = rng.range(0.6, 3); S.set(sc, sc * 1.8, sc); M.compose(P, Q, S); crystal.setMatrixAt(crystal.count, M); col.setHSL(rng.range(0.5, 0.9), 0.8, 0.65); crystal.setColorAt(crystal.count, col); crystal.count++; }
      const c = this.bounds.getCenter(new THREE.Vector3());
      for (let i = 0; i < d.planets; i++) { const r = rng.range(14, 40); const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 18), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(rng.range(0, 1), 0.6, 0.55), roughness: 0.8, emissive: 0x111133, emissiveIntensity: 0.6 })); const ang = (i / d.planets) * Math.PI * 2; m.position.set(c.x + Math.cos(ang) * rng.range(260, 420), rng.range(-60, 120), c.z + Math.sin(ang) * rng.range(260, 420)); this.group.add(m); if (rng.chance(0.5)) { const ring = new THREE.Mesh(new THREE.RingGeometry(r * 1.4, r * 2.1, 40), new THREE.MeshStandardMaterial({ color: 0xd0c0a0, side: THREE.DoubleSide, roughness: 0.9 })); ring.rotation.x = Math.PI / 2 + rng.range(-0.4, 0.4); m.add(ring); } }
    }
  }
  buildExtras() {
    const th = this.def.theme, d = this.def.deco, rng = new RNG(4321);
    const c = this.bounds.getCenter(new THREE.Vector3());
    if (th === 'meadow') { for (let i = 0; i < (d.barns || 0); i++) { const p = this.randomOutside(rng, 18, 50); if (p) this.addBarn(p, rng); } this.addFences(rng); this.addBalloons(rng, d.balloons || 0); this.addFlowerPatches(rng, 40); }
    if (th === 'desert') { for (let i = 0; i < (d.pyramids || 0); i++) { const p = this.randomOutside(rng, 40, 90); if (p) this.addPyramid(p, rng.range(18, 32)); } for (let i = 0; i < (d.arches || 0); i++) this.addArch(rng); this.addTumbleweeds(rng, d.tumbleweeds || 0); }
    if (th === 'snow') { for (let i = 0; i < (d.lodges || 0); i++) { const p = this.randomOutside(rng, 14, 40); if (p) this.addLodge(p, rng); } if (d.lifts) this.addSkiLift(rng); }
    if (th === 'neon') { this.addWater(c); this.addBoats(rng, d.boats || 0); if (d.ferris) { const p = this.randomOutside(rng, 30, 60); if (p) this.addFerris(p); } this.addSearchlights(rng, d.searchlights || 0); }
    if (th === 'lava') { this.addLavafalls(rng, d.lavafalls || 0); }
    if (th === 'space') { this.addAsteroids(rng, d.asteroids || 0, c); this.addNebulae(rng, d.nebulae || 0, c); if (d.station) this.addStation(rng, c); }
  }
  addBarn(p, rng) {
    const g = new THREE.Group(); g.position.copy(p); g.rotation.y = rng.range(0, 6.3);
    const red = new THREE.MeshStandardMaterial({ color: 0xb8342a, roughness: 0.8 }); const white = new THREE.MeshStandardMaterial({ color: 0xf2efe6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 18), red); body.position.y = 3; body.castShadow = true; body.receiveShadow = true; g.add(body);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 7.5, 18.5, 4, 1, false, Math.PI / 4), new THREE.MeshStandardMaterial({ color: 0x5a3a2a, roughness: 0.9 })); roof.rotation.z = Math.PI / 2; roof.rotation.y = 0; roof.position.y = 6; roof.scale.set(0.6, 1, 1); roof.castShadow = true; g.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 0.3), white); door.position.set(0, 2, 9.1); g.add(door);
    const silo = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 11, 12), new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.4, roughness: 0.5 })); silo.position.set(9, 5.5, -4); silo.castShadow = true; g.add(silo);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(2.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), silo.material); cap.position.set(9, 11, -4); g.add(cap);
    this.group.add(g);
  }
  addFences(rng) {
    const post = new THREE.InstancedMesh(new THREE.BoxGeometry(0.25, 1.2, 0.25), new THREE.MeshStandardMaterial({ color: 0xd9c9a3 }), 1200);
    const rail = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.12, 3.05), post.material, 1200);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1); let n = 0, m = 0;
    for (let seg = 0; seg < 4; seg++) {
      const s0 = rng.range(0, this.length), len = rng.range(80, 160), sgn = rng.chance(0.5) ? 1 : -1, off = rng.range(3, 6);
      for (let s = s0; s < s0 + len && n < 1190; s += 3) {
        const i = this.indexAtS(s), i2 = this.indexAtS(s + 3); const lat = (this.edgeLat(i) + off) * sgn;
        const p = this.posAt(s, lat, 0), p2 = this.posAt(s + 3, (this.edgeLat(i2) + off) * sgn, 0);
        const y = this.heightAt(this.sample(p, i, {}), lat);
        M.compose(new THREE.Vector3(p.x, y + 0.6, p.z), Q, S); post.setMatrixAt(n++, M);
        const mid = p.clone().lerp(p2, 0.5); mid.y = y + 0.9; const yaw = Math.atan2(p2.x - p.x, p2.z - p.z);
        Q.setFromAxisAngle(UP, yaw); M.compose(mid, Q, S); rail.setMatrixAt(m++, M); mid.y = y + 0.4; M.compose(mid, Q, S); rail.setMatrixAt(m++, M); Q.identity();
      }
    }
    post.count = n; rail.count = m; post.castShadow = true; this.group.add(post); this.group.add(rail);
  }
  addBalloons(rng, n) {
    const c = this.bounds.getCenter(new THREE.Vector3());
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group(); const col = new THREE.Color().setHSL(rng.range(0, 1), 0.8, 0.55);
      const env = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 12), new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 })); env.scale.y = 1.25; env.castShadow = true; g.add(env);
      const stripe = new THREE.Mesh(new THREE.SphereGeometry(6.05, 16, 12, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.12), new THREE.MeshStandardMaterial({ color: 0xffffff })); stripe.scale.y = 1.25; g.add(stripe);
      const basket = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 2.2), new THREE.MeshStandardMaterial({ color: 0x8a5a2a })); basket.position.y = -10; g.add(basket);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4), new THREE.MeshStandardMaterial({ color: 0x333 })); rope.position.set(sx * 1, -7.8, sz * 1); g.add(rope); }
      g.position.set(c.x + rng.range(-260, 260), rng.range(28, 55), c.z + rng.range(-260, 260));
      g.userData = { t: rng.range(0, 100), vx: rng.range(-1, 1), vz: rng.range(-1, 1), base: g.position.y };
      this.group.add(g); this.anim.push({ type: 'balloon', obj: g });
    }
  }
  addFlowerPatches(rng, n) {
    const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 0.9, 6), new THREE.MeshStandardMaterial({ color: 0xffd23c, roughness: 0.9 }), n * 25);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(); let k = 0; const col = new THREE.Color();
    for (let i = 0; i < n; i++) { const p = this.randomOutside(rng, 2, 40); if (!p) continue; const h = rng.range(0.05, 0.16); for (let j = 0; j < 25; j++) { const sc = rng.range(0.6, 1.2); S.set(sc, sc, sc); M.compose(new THREE.Vector3(p.x + rng.range(-5, 5), p.y + 0.4 * sc, p.z + rng.range(-5, 5)), Q, S); im.setMatrixAt(k, M); col.setHSL(h, 0.9, 0.55); im.setColorAt(k, col); k++; } }
    im.count = k; this.group.add(im);
  }
  addPyramid(p, size) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(size, size * 0.85, 4), new THREE.MeshStandardMaterial({ color: 0xd9b56a, roughness: 1, flatShading: true }));
    m.position.set(p.x, p.y + size * 0.42 - 1, p.z); m.rotation.y = Math.PI / 4; m.castShadow = true; m.receiveShadow = true; this.group.add(m);
  }
  addArch(rng) {
    const s = rng.range(0, this.length); const i = this.indexAtS(s); const p = this.pos[i], T = this.tan[i], R = this.right[i];
    const w = this.edgeLat(i) + 2; const mat = new THREE.MeshStandardMaterial({ color: 0xb8623a, roughness: 1, flatShading: true });
    const arch = new THREE.Mesh(new THREE.TorusGeometry(w, 3.2, 8, 24, Math.PI), mat); arch.position.set(p.x, p.y + 1, p.z);
    arch.lookAt(p.x + T.x, p.y + 1, p.z + T.z); arch.castShadow = true; this.group.add(arch);
    for (const sgn of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4.2, 6, 8), mat); leg.position.set(p.x + R.x * w * sgn, p.y + 1, p.z + R.z * w * sgn); this.group.add(leg); }
  }
  addTumbleweeds(rng, n) {
    for (let i = 0; i < n; i++) { const p = this.randomOutside(rng, 2, 40); if (!p) continue; const m = new THREE.Mesh(new THREE.IcosahedronGeometry(rng.range(0.6, 1.1), 1), new THREE.MeshStandardMaterial({ color: 0xa88a52, roughness: 1, wireframe: true })); m.position.copy(p).y += 0.9; m.userData = { dir: rng.range(0, 6.3), spd: rng.range(3, 6), hint: this.nearestIndex(p) }; this.group.add(m); this.anim.push({ type: 'tumble', obj: m }); }
  }
  addLodge(p, rng) {
    const g = new THREE.Group(); g.position.copy(p); g.rotation.y = rng.range(0, 6.3);
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a4e2c, roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(14, 5, 10), wood); body.position.y = 2.5; body.castShadow = true; g.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(9.5, 5, 4), new THREE.MeshStandardMaterial({ color: 0xf4f8ff })); roof.position.y = 7.5; roof.rotation.y = Math.PI / 4; roof.scale.z = 0.75; roof.castShadow = true; g.add(roof);
    const win = new THREE.Mesh(new THREE.BoxGeometry(14.2, 1.4, 10.2), new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffb040, emissiveIntensity: 1.2 })); win.position.y = 3; g.add(win);
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(1.2, 4, 1.2), new THREE.MeshStandardMaterial({ color: 0x555 })); chimney.position.set(4, 8, 0); g.add(chimney);
    g.userData = { chimney }; this.group.add(g); this.anim.push({ type: 'chimney', obj: g });
  }
  addSkiLift(rng) {
    const c = this.bounds.getCenter(new THREE.Vector3()); const a = new THREE.Vector3(c.x - 200, this.groundY, c.z + 140), b = new THREE.Vector3(c.x + 160, this.groundY + 50, c.z - 200);
    const mat = new THREE.MeshStandardMaterial({ color: 0x444a55, metalness: 0.6, roughness: 0.4 });
    const n = 8; const towers = [];
    for (let i = 0; i <= n; i++) { const p = a.clone().lerp(b, i / n); const smp = this.sample(p, -1, {}); const y = Math.max(this.heightAt(smp, smp.lat), this.groundY); const tw = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 16, 8), mat); tw.position.set(p.x, y + 8, p.z); tw.castShadow = true; this.group.add(tw); towers.push(new THREE.Vector3(p.x, y + 16, p.z)); }
    const pts = []; towers.forEach((t) => pts.push(t.x, t.y, t.z)); const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); this.group.add(new THREE.Line(cg, new THREE.LineBasicMaterial({ color: 0x222 })));
    const chairs = new THREE.Group(); for (let i = 0; i < 12; i++) { const ch = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 0.8), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(rng.range(0, 1), 0.7, 0.5) })); ch.userData = { t: i / 12 }; chairs.add(ch); }
    chairs.userData = { towers }; this.group.add(chairs); this.anim.push({ type: 'lift', obj: chairs });
  }
  addWater(c) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshStandardMaterial({ color: 0x0a1a3a, roughness: 0.15, metalness: 0.6, emissive: 0x081432, emissiveIntensity: 0.6, transparent: true, opacity: 0.92 }));
    w.rotation.x = -Math.PI / 2; w.position.set(c.x, this.groundY - 0.5, c.z); this.group.add(w); this.water = w;
  }
  addBoats(rng, n) {
    for (let i = 0; i < n; i++) { const p = this.randomOutside(rng, 40, 120); if (!p) continue; const g = new THREE.Group(); const hull = new THREE.Mesh(new THREE.BoxGeometry(4, 1.4, 10), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(rng.range(0, 1), 0.6, 0.5) })); hull.position.y = 0.5; g.add(hull); const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 3), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe0a0, emissiveIntensity: 0.6 })); cabin.position.set(0, 1.9, -1); g.add(cabin); const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3), new THREE.MeshStandardMaterial({ color: 0xff4040, emissive: 0xff2020, emissiveIntensity: 3 })); lamp.position.set(0, 3.2, -1); g.add(lamp); g.position.set(p.x, this.groundY - 0.3, p.z); g.rotation.y = rng.range(0, 6.3); g.userData = { t: rng.range(0, 10) }; this.group.add(g); this.anim.push({ type: 'boat', obj: g }); }
  }
  addFerris(p) {
    const g = new THREE.Group(); g.position.set(p.x, p.y, p.z); const R = 22;
    const mat = new THREE.MeshStandardMaterial({ color: 0xff3aa0, emissive: 0xff3aa0, emissiveIntensity: 1.2 });
    const wheel = new THREE.Group(); wheel.position.y = R + 4; g.add(wheel);
    wheel.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.5, 8, 48), mat));
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, R, 6), mat); sp.position.set(Math.cos(a) * R / 2, Math.sin(a) * R / 2, 0); sp.rotation.z = a + Math.PI / 2; wheel.add(sp); const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2, 2), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(i / 12, 0.9, 0.55), emissive: new THREE.Color().setHSL(i / 12, 0.9, 0.4), emissiveIntensity: 1 })); cab.position.set(Math.cos(a) * R, Math.sin(a) * R, 0); cab.userData = { a }; wheel.add(cab); }
    for (const sgn of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, R + 6, 8), new THREE.MeshStandardMaterial({ color: 0x334 })); leg.position.set(sgn * 6, (R + 4) / 2, sgn * 2); leg.rotation.z = -sgn * 0.22; g.add(leg); }
    this.group.add(g); this.anim.push({ type: 'ferris', obj: wheel });
  }
  addSearchlights(rng, n) {
    for (let i = 0; i < n; i++) { const p = this.randomOutside(rng, 10, 60); if (!p) continue; const g = new THREE.Group(); g.position.copy(p); const base = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2, 3, 8), new THREE.MeshStandardMaterial({ color: 0x223 })); base.position.y = 1.5; g.add(base); const beam = new THREE.Mesh(new THREE.ConeGeometry(9, 140, 12, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(rng.range(0, 1), 1, 0.7), transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })); beam.position.y = 70; const piv = new THREE.Group(); piv.position.y = 3; piv.add(beam); piv.rotation.x = 0.5; g.add(piv); g.userData = { piv, t: rng.range(0, 10), spd: rng.range(0.3, 0.6) }; this.group.add(g); this.anim.push({ type: 'search', obj: g }); }
  }
  addLavafalls(rng, n) {
    for (let i = 0; i < n; i++) { const p = this.randomOutside(rng, 12, 40); if (!p) continue; const h = rng.range(10, 22); const cliff = new THREE.Mesh(new THREE.BoxGeometry(14, h, 6), new THREE.MeshStandardMaterial({ color: 0x2a1a1a, roughness: 1 })); cliff.position.set(p.x, this.groundY + h / 2, p.z); cliff.rotation.y = rng.range(0, 6.3); cliff.castShadow = true; this.group.add(cliff); const fall = new THREE.Mesh(new THREE.PlaneGeometry(5, h), new THREE.MeshStandardMaterial({ color: 0xff7020, emissive: 0xff5000, emissiveIntensity: 2.2, side: THREE.DoubleSide })); fall.position.set(0, 0, 3.05); cliff.add(fall); fall.material.map = tex('lavaRock').clone(); fall.material.map.repeat.set(1, 3); fall.material.emissiveMap = fall.material.map; fall.material.needsUpdate = true; this.anim.push({ type: 'lavafall', obj: fall }); }
    // pulsing geysers: find the geyser instanced mesh is hard; add a few extra animated ones
    for (let i = 0; i < 6; i++) { const p = this.randomOutside(rng, 3, 24); if (!p) continue; const m = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.8, 8, 8), new THREE.MeshStandardMaterial({ color: 0xff9a30, emissive: 0xff6a00, emissiveIntensity: 2.5, transparent: true, opacity: 0.85 })); m.position.copy(p).y += 4; m.userData = { t: rng.range(0, 6) }; this.group.add(m); this.anim.push({ type: 'geyser', obj: m }); }
  }
  addAsteroids(rng, n, c) {
    const im = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x8a8a95, roughness: 1, flatShading: true }), n);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3();
    for (let i = 0; i < n; i++) { const a = rng.range(0, 6.3), r = rng.range(230, 420); const sc = rng.range(1, 6); Q.setFromEuler(new THREE.Euler(rng.range(0, 6), rng.range(0, 6), 0)); S.set(sc, sc * rng.range(0.6, 1), sc); M.compose(new THREE.Vector3(Math.cos(a) * r, rng.range(-40, 60), Math.sin(a) * r), Q, S); im.setMatrixAt(i, M); }
    im.position.set(c.x, 0, c.z); im.userData = { c }; this.group.add(im); this.anim.push({ type: 'belt', obj: im });
  }
  addNebulae(rng, n, c) {
    for (let i = 0; i < n; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(rng.range(60, 120), 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(rng.range(0.5, 0.95), 0.9, 0.5), transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); const a = rng.range(0, 6.3); m.position.set(c.x + Math.cos(a) * rng.range(300, 600), rng.range(-100, 200), c.z + Math.sin(a) * rng.range(300, 600)); m.scale.set(rng.range(1, 2.2), rng.range(0.5, 1), 1); this.group.add(m); }
  }
  addStation(rng, c) {
    const g = new THREE.Group(); g.position.set(c.x + 120, 90, c.z - 260);
    const mat = new THREE.MeshStandardMaterial({ color: 0xd0d8e8, metalness: 0.7, roughness: 0.3, emissive: 0x203060, emissiveIntensity: 0.5 });
    g.add(new THREE.Mesh(new THREE.TorusGeometry(40, 5, 10, 40), mat));
    for (let i = 0; i < 4; i++) { const sp = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 80, 8), mat); sp.rotation.z = (i / 4) * Math.PI; g.add(sp); }
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 30, 12), mat).rotateX(Math.PI / 2));
    const lights = new THREE.Mesh(new THREE.TorusGeometry(40, 1, 6, 40), new THREE.MeshStandardMaterial({ color: 0x40ffd0, emissive: 0x40ffd0, emissiveIntensity: 2.5 })); lights.position.z = 5.5; g.add(lights);
    g.rotation.x = 0.7; this.group.add(g); this.anim.push({ type: 'station', obj: g });
  }
  updateAnim(dt, t) {
    for (const a of this.anim) {
      const o = a.obj, u = o.userData;
      switch (a.type) {
        case 'balloon': o.position.x += u.vx * dt; o.position.z += u.vz * dt; o.position.y = u.base + Math.sin(t * 0.4 + u.t) * 2; break;
        case 'tumble': { const sx = Math.sin(u.dir), sz = Math.cos(u.dir); o.position.x += sx * u.spd * dt; o.position.z += sz * u.spd * dt; o.rotation.x += u.spd * dt * 1.5; o.rotation.z += u.spd * dt * 0.7; const smp = this.sample(o.position, u.hint, u.smp || (u.smp = {})); u.hint = smp.idx; const a2 = Math.abs(smp.lat); if (a2 < smp.edge + 1 || a2 > smp.edge + 60) u.dir += Math.PI + (Math.random() - 0.5); o.position.y = this.heightAt(smp, smp.lat) + 0.9 + Math.abs(Math.sin(t * 4 + u.dir)) * 0.4; break; }
        case 'chimney': break;
        case 'lift': { const tw = u.towers; const n = tw.length - 1; for (const ch of o.children) { ch.userData.t = (ch.userData.t + dt * 0.012) % 1; const f = ch.userData.t * n; const i = Math.min(n - 1, Math.floor(f)); const p = tw[i].clone().lerp(tw[i + 1], f - i); ch.position.set(p.x, p.y - 1.4, p.z); } break; }
        case 'boat': o.position.y = this.groundY - 0.3 + Math.sin(t * 1.3 + u.t) * 0.15; o.rotation.z = Math.sin(t * 0.9 + u.t) * 0.04; break;
        case 'ferris': o.rotation.z += dt * 0.15; for (const ch of o.children) if (ch.userData.a !== undefined) ch.rotation.z = -o.rotation.z; break;
        case 'search': u.piv.rotation.y = Math.sin(t * u.spd + u.t) * 1.2; u.piv.rotation.x = 0.45 + Math.sin(t * u.spd * 0.7 + u.t) * 0.25; break;
        case 'lavafall': o.material.map.offset.y -= dt * 0.4; break;
        case 'geyser': { const ph = (t * 0.6 + u.t) % 3; const h = ph < 0.6 ? 0.2 + ph / 0.6 * 1.2 : Math.max(0.2, 1.4 - (ph - 0.6) * 0.8); o.scale.set(1, h, 1); o.position.y = o.position.y - 0 ; break; }
        case 'belt': o.rotation.y += dt * 0.004; break;
        case 'station': o.rotation.z += dt * 0.08; break;
      }
    }
  }
  addRocks(rng, n, color) {
    const im = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1.2, 0), new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }), n);
    im.castShadow = true; im.receiveShadow = true; const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(); let c = 0;
    for (let i = 0; i < n; i++) { const p = this.randomOutside(rng, 1, 40); if (!p) continue; const sc = rng.range(0.5, 2.6); Q.setFromEuler(new THREE.Euler(rng.range(0, 6), rng.range(0, 6), 0)); S.set(sc, sc * rng.range(0.6, 1), sc); M.compose(p.clone().add(new THREE.Vector3(0, sc * 0.5, 0)), Q, S); im.setMatrixAt(c++, M); }
    im.count = c; this.group.add(im);
  }
  addClouds(rng, n) {
    const im = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.25 }), n * 4);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(); let c = 0; const cen = this.bounds.getCenter(new THREE.Vector3());
    for (let i = 0; i < n; i++) { const x = cen.x + rng.range(-350, 350), z = cen.z + rng.range(-350, 350), y = rng.range(55, 90); for (let k = 0; k < 4; k++) { const sc = rng.range(5, 11); S.set(sc * 1.6, sc * 0.6, sc); M.compose(new THREE.Vector3(x + rng.range(-10, 10), y + rng.range(-2, 2), z + rng.range(-6, 6)), Q, S); im.setMatrixAt(c++, M); } }
    im.count = c; this.group.add(im);
  }
  addWindmill(p) {
    const g = new THREE.Group(); g.position.copy(p);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(2, 3, 12, 8), new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.9 })); body.position.y = 6; body.castShadow = true; g.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 3, 8), new THREE.MeshStandardMaterial({ color: 0xa04030 })); roof.position.y = 13.5; g.add(roof);
    const blades = new THREE.Group(); blades.position.set(0, 11, 2.4);
    for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 0.15), new THREE.MeshStandardMaterial({ color: 0xffffff })); b.position.y = 3.5; const h = new THREE.Group(); h.rotation.z = (i * Math.PI) / 2; h.add(b); blades.add(h); }
    g.add(blades); this.windmillBlades = blades; this.group.add(g);
  }

  buildSky() {
    const sk = this.def.sky;
    const geo = new THREE.SphereGeometry(900, 24, 12);
    let mat;
    if (this.def.theme === 'space') mat = new THREE.MeshBasicMaterial({ map: tex('stars'), side: THREE.BackSide, fog: false });
    else mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, fog: false, depthWrite: false,
      uniforms: { top: { value: new THREE.Color(sk.top) }, bottom: { value: new THREE.Color(sk.bottom) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = normalize(vP).y; float t = smoothstep(-0.05, 0.5, h); gl_FragColor = vec4(mix(bottom, top, t), 1.0); }',
    });
    this.sky = new THREE.Mesh(geo, mat); this.group.add(this.sky);
  }

  update(dt, t) { if (this.windmillBlades) this.windmillBlades.rotation.z += dt * 0.8; this.updateAnim(dt, t); }
}
