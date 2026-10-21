import * as THREE from 'three';
import { mulberry32, clamp } from '../core/Utils.js';
import { buildingMaterial } from './BuildingMaterial.js';

/**
 * Procedural Manhattan-style grid. Regular blocks so spatial lookup is O(1):
 * block (i,j) spans x in [i*P + S/2, i*P + S/2 + B], where P = B + S.
 * Buildings are axis-aligned boxes: { x, z, w, d, h } (x,z = centre). Roof at y = h.
 */
export class City {
  constructor(opts = {}) {
    // Manhattan-ish: short blocks along X (avenues), long blocks along Z (streets)
    this.NX = opts.nx ?? 28;
    this.NZ = opts.nz ?? 18;
    this.BX = opts.blockX ?? 64;   // block size along x
    this.BZ = opts.blockZ ?? 116;  // block size along z
    this.S = opts.street ?? 28;    // street width (≈ 0.5–1 × 2·L·sin60°, L = 30)
    this.PX = this.BX + this.S;    // period x
    this.PZ = this.BZ + this.S;    // period z
    this.seed = opts.seed ?? 1337;
    this.originX = -(this.NX * this.PX) / 2;
    this.originZ = -(this.NZ * this.PZ) / 2;
    this.sizeX = this.NX * this.PX;
    this.sizeZ = this.NZ * this.PZ;
    this.buildings = [];
    this.blocks = [];            // blocks[i][j] = array of buildings
    this.group = new THREE.Group();
    this.rng = mulberry32(this.seed);
    this._generate();
    this._buildMeshes();
  }

  // ---------- generation ----------
  _heightFor(i, j) {
    const rng = this.rng;
    // two-Gaussian skyline field: downtown (south) + midtown (north), dip between, low edges
    const u = (i + 0.5) / this.NX, v = (j + 0.5) / this.NZ;
    const g = (cx, cz, sx, sz) => Math.exp(-(((u - cx) ** 2) / (2 * sx * sx) + ((v - cz) ** 2) / (2 * sz * sz)));
    const field = 0.35 + 1.1 * g(0.5, 0.3, 0.2, 0.14) + 0.9 * g(0.5, 0.75, 0.24, 0.12);
    // log-normal heights, mu = ln(70), sigma = 0.55, gaussian via Box–Muller
    const n = Math.sqrt(-2 * Math.log(1 - rng() + 1e-9)) * Math.cos(2 * Math.PI * rng());
    let h = Math.exp(Math.log(70) + 0.55 * n) * field;
    h = clamp(h, 15, 320);
    return Math.round(h / 3.5) * 3.5;       // snap to floor height 3.5
  }

  _generate() {
    const rng = this.rng;
    for (let i = 0; i < this.NX; i++) {
      this.blocks[i] = [];
      for (let j = 0; j < this.NZ; j++) {
        const list = [];
        this.blocks[i][j] = list;
        const bx = this.originX + i * this.PX + this.S / 2;
        const bz = this.originZ + j * this.PZ + this.S / 2;
        // Lot subdivision along the long axis: 1–3 lots deep, sometimes split across
        const r = rng();
        let lots;
        if (r < 0.18) lots = [[0, 0, 1, 1]];
        else if (r < 0.45) lots = [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]];
        else if (r < 0.7) lots = [[0, 0, 1, 1 / 3], [0, 1 / 3, 1, 1 / 3], [0, 2 / 3, 1, 1 / 3]];
        else lots = [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]];
        // occasionally a plaza/park (skip one lot)
        const skip = rng() < 0.12 ? Math.floor(rng() * lots.length) : -1;
        lots.forEach((lot, li) => {
          if (li === skip) return;
          const setback = 2 + rng() * 3;
          const lw = lot[2] * this.BX, ld = lot[3] * this.BZ;
          const w = lw - setback * 2, d = ld - setback * 2;
          const x = bx + lot[0] * this.BX + lw / 2;
          const z = bz + lot[1] * this.BZ + ld / 2;
          const h = this._heightFor(i, j) * (lots.length === 4 ? 0.85 : 1);
          const style = rng();
          const b = { x, z, w, d, h, style, id: this.buildings.length, i, j, tier: rng() < 0.35 && h > 60 ? 1 : 0 };
          this.buildings.push(b);
          list.push(b);
        });
      }
    }
  }

  // ---------- rendering ----------
  _buildMeshes() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0); // origin at base
    const mat = buildingMaterial();
    const count = this.buildings.length + this.buildings.filter(b => b.tier).length;
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    const palette = [0x8d8f96, 0x6f7480, 0xa08c78, 0x7a6c5f, 0x5d6572, 0x9b9a92, 0x74665e, 0x4f5a6b, 0xb3a58f, 0x62707d];
    let k = 0;
    for (const b of this.buildings) {
      m.makeScale(b.w, b.h, b.d).setPosition(b.x, 0, b.z);
      mesh.setMatrixAt(k, m);
      color.setHex(palette[Math.floor(b.style * palette.length)]);
      mesh.setColorAt(k, color);
      k++;
      if (b.tier) { // stepped crown for tall buildings (setback tower)
        const tw = b.w * 0.6, td = b.d * 0.6, th = b.h * 0.25;
        m.makeScale(tw, th, td).setPosition(b.x, b.h - 0.01, b.z);
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, color);
        b.crown = { x: b.x, z: b.z, w: tw, d: td, y0: b.h, h: b.h + th };
        k++;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    this.mesh = mesh;
    this.group.add(mesh);

    this._buildGround();
    this._buildRoofProps();
  }

  _buildGround() {
    // One texture tile == one block period. Repeated NX x NZ times.
    const c = document.createElement('canvas');
    const px = 6; // texels per metre
    const RX = Math.round(this.PX * px), RZ = Math.round(this.PZ * px);
    c.width = RX; c.height = RZ;
    const g = c.getContext('2d');
    // asphalt
    g.fillStyle = '#3a3d44'; g.fillRect(0, 0, RX, RZ);
    // block area (sidewalk) — block starts at S/2
    const s0 = (this.S / 2) * px, bw = this.BX * px, bd = this.BZ * px;
    g.fillStyle = '#7a7c82'; g.fillRect(s0, s0, bw, bd);
    g.fillStyle = '#686a70'; g.fillRect(s0 + 6, s0 + 6, bw - 12, bd - 12);
    g.strokeStyle = '#8a8c90'; g.lineWidth = 2; g.strokeRect(s0, s0, bw, bd);
    // lane markings: street centres sit on the tile edges (x = 0/RX, y = 0/RZ)
    const lane = (vertical) => {
      const R = vertical ? RX : RZ, L = vertical ? RZ : RX;
      for (const m of [0, R]) {
        g.setLineDash([16, 14]); g.strokeStyle = '#c9a227'; g.lineWidth = 2;
        g.beginPath(); if (vertical) { g.moveTo(m, 0); g.lineTo(m, L); } else { g.moveTo(0, m); g.lineTo(L, m); } g.stroke();
        g.setLineDash([]); g.strokeStyle = '#c8c8c8'; g.lineWidth = 1.5;
        for (const off of [-(this.S / 2 - 2) * px, (this.S / 2 - 2) * px]) {
          g.beginPath(); if (vertical) { g.moveTo(m + off, 0); g.lineTo(m + off, L); } else { g.moveTo(0, m + off); g.lineTo(L, m + off); } g.stroke();
        }
      }
    };
    lane(true); lane(false);
    // crosswalk stripes
    g.fillStyle = '#d0d0d0';
    for (let k = 0; k < 6; k++) {
      const o = s0 + 10 + k * 8;
      g.fillRect(o, 0, 4, s0 - 4); g.fillRect(o, RZ - s0 + 4, 4, s0 - 4);
      g.fillRect(0, o, s0 - 4, 4); g.fillRect(RX - s0 + 4, o, s0 - 4, 4);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(this.NX, this.NZ);
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(this.sizeX, this.sizeZ);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 });
    const ground = new THREE.Mesh(geo, mat);
    ground.position.set(this.originX + this.sizeX / 2, 0, this.originZ + this.sizeZ / 2);
    ground.receiveShadow = true;
    this.group.add(ground);

    // Outer "water" plane so the world edge doesn't look like the void
    const water = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x1b2a3a, roughness: 0.3, metalness: 0.2 }));
    water.position.y = -0.5;
    this.group.add(water);
  }

  _buildRoofProps() {
    const rng = mulberry32(this.seed + 7);
    const towerGeo = new THREE.CylinderGeometry(1.6, 1.8, 3.2, 10);
    towerGeo.translate(0, 1.6 + 1.5, 0);
    const legs = new THREE.BoxGeometry(2.6, 1.5, 2.6); legs.translate(0, 0.75, 0);
    const coneGeo = new THREE.ConeGeometry(1.9, 1.2, 10); coneGeo.translate(0, 3.2 + 1.5 + 0.6, 0);
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 0.9 });
    const acGeo = new THREE.BoxGeometry(2.4, 1.4, 2.4); acGeo.translate(0, 0.7, 0);
    const acMat = new THREE.MeshStandardMaterial({ color: 0x9a9da3, roughness: 0.6, metalness: 0.4 });
    const antGeo = new THREE.CylinderGeometry(0.12, 0.2, 9, 6); antGeo.translate(0, 4.5, 0);
    const antMat = new THREE.MeshStandardMaterial({ color: 0x333, roughness: 0.5, metalness: 0.7 });
    const stairGeo = new THREE.BoxGeometry(3.2, 2.8, 4); stairGeo.translate(0, 1.4, 0);
    const stairMat = new THREE.MeshStandardMaterial({ color: 0x70737a, roughness: 0.9 });

    const towers = [], acs = [], ants = [], stairs = [];
    for (const b of this.buildings) {
      if (b.w < 14 || b.d < 14) continue;
      const roofY = b.h;
      const px = (f) => b.x + (rng() - 0.5) * (b.w - 6) * f;
      const pz = (f) => b.z + (rng() - 0.5) * (b.d - 6) * f;
      if (rng() < 0.35 && !b.tier) towers.push([px(0.8), roofY, pz(0.8)]);
      const n = Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) acs.push([px(0.9), roofY, pz(0.9)]);
      if (rng() < 0.3) ants.push([px(0.6), b.crown ? b.crown.h : roofY, pz(0.6)]);
      if (rng() < 0.5 && !b.tier) stairs.push([px(0.7), roofY, pz(0.7)]);
    }
    const inst = (geo, mat, arr) => {
      if (!arr.length) return;
      const mesh = new THREE.InstancedMesh(geo, mat, arr.length);
      const m = new THREE.Matrix4();
      arr.forEach((p, k) => { m.makeRotationY(0).setPosition(p[0], p[1], p[2]); mesh.setMatrixAt(k, m); });
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    inst(towerGeo, towerMat, towers); inst(legs, antMat, towers); inst(coneGeo, towerMat, towers);
    inst(acGeo, acMat, acs); inst(antGeo, antMat, ants); inst(stairGeo, stairMat, stairs);
  }

  // ---------- spatial queries ----------
  blockIndex(x, z) {
    return [Math.floor((x - this.originX) / this.PX), Math.floor((z - this.originZ) / this.PZ)];
  }

  /** Buildings whose blocks fall within radius r of (x,z). */
  near(x, z, r, out = []) {
    out.length = 0;
    const [i0, j0] = this.blockIndex(x - r, z - r);
    const [i1, j1] = this.blockIndex(x + r, z + r);
    for (let i = Math.max(0, i0); i <= Math.min(this.NX - 1, i1); i++)
      for (let j = Math.max(0, j0); j <= Math.min(this.NZ - 1, j1); j++)
        for (const b of this.blocks[i][j]) out.push(b);
    return out;
  }

  /** Highest solid surface under (x,z): roof of building containing the point, else 0. */
  heightAt(x, z) {
    const [i, j] = this.blockIndex(x, z);
    if (i < 0 || j < 0 || i >= this.NX || j >= this.NZ) return 0;
    let h = 0;
    for (const b of this.blocks[i][j]) {
      if (Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2) {
        h = Math.max(h, b.h);
        if (b.crown && Math.abs(x - b.crown.x) <= b.crown.w / 2 && Math.abs(z - b.crown.z) <= b.crown.d / 2) h = Math.max(h, b.crown.h);
      }
    }
    return h;
  }

  inBounds(x, z, margin = 0) {
    return x > this.originX + margin && x < this.originX + this.sizeX - margin && z > this.originZ + margin && z < this.originZ + this.sizeZ - margin;
  }

  /** Random point on a street (for spawning cars / crimes). */
  randomStreetPoint(rng = Math.random) {
    const vertical = rng() < 0.5;
    const i = Math.floor(rng() * (this.NX - 1)) + 1, j = Math.floor(rng() * (this.NZ - 1)) + 1;
    const x = this.originX + i * this.PX, z = this.originZ + j * this.PZ;
    const off = (rng() - 0.5) * (this.S - 8);
    return vertical ? new THREE.Vector3(x + off, 0, z + (rng() - 0.5) * this.BZ) : new THREE.Vector3(x + (rng() - 0.5) * this.BX, 0, z + off);
  }

  /**
   * Ray vs building boxes. Returns { point, normal, dist, building } or null.
   */
  raycast(origin, dir, maxDist, out = {}) {
    const ex = origin.x + dir.x * maxDist, ez = origin.z + dir.z * maxDist;
    const minX = Math.min(origin.x, ex), maxX = Math.max(origin.x, ex);
    const minZ = Math.min(origin.z, ez), maxZ = Math.max(origin.z, ez);
    const [i0, j0] = this.blockIndex(minX, minZ);
    const [i1, j1] = this.blockIndex(maxX, maxZ);
    let best = maxDist, hit = null, nx = 0, ny = 0, nz = 0;
    const ix = 1 / (dir.x || 1e-9), iy = 1 / (dir.y || 1e-9), iz = 1 / (dir.z || 1e-9);
    const test = (bx0, bx1, by0, by1, bz0, bz1, b) => {
      let tmin = 0, tmax = best, axis = -1, sign = 0;
      // X
      let t1 = (bx0 - origin.x) * ix, t2 = (bx1 - origin.x) * ix; let s = -1;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = 0; sign = s; }
      tmax = Math.min(tmax, t2); if (tmin > tmax) return;
      t1 = (by0 - origin.y) * iy; t2 = (by1 - origin.y) * iy; s = -1;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = 1; sign = s; }
      tmax = Math.min(tmax, t2); if (tmin > tmax) return;
      t1 = (bz0 - origin.z) * iz; t2 = (bz1 - origin.z) * iz; s = -1;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = 2; sign = s; }
      tmax = Math.min(tmax, t2); if (tmin > tmax) return;
      if (tmin <= 0 || tmin >= best || axis < 0) return; // origin inside or farther
      best = tmin; hit = b; nx = ny = nz = 0;
      if (axis === 0) nx = sign; else if (axis === 1) ny = sign; else nz = sign;
    };
    for (let i = Math.max(0, i0); i <= Math.min(this.NX - 1, i1); i++)
      for (let j = Math.max(0, j0); j <= Math.min(this.NZ - 1, j1); j++)
        for (const b of this.blocks[i][j]) {
          test(b.x - b.w / 2, b.x + b.w / 2, 0, b.h, b.z - b.d / 2, b.z + b.d / 2, b);
          if (b.crown) test(b.crown.x - b.crown.w / 2, b.crown.x + b.crown.w / 2, b.crown.y0, b.crown.h, b.crown.z - b.crown.d / 2, b.crown.z + b.crown.d / 2, b);
        }
    // ground plane
    if (dir.y < 0) {
      const t = -origin.y / dir.y;
      if (t > 0 && t < best) { best = t; hit = 'ground'; nx = 0; ny = 1; nz = 0; }
    }
    if (!hit) return null;
    out.dist = best;
    out.point = (out.point || new THREE.Vector3()).copy(origin).addScaledVector(dir, best);
    out.normal = (out.normal || new THREE.Vector3()).set(nx, ny, nz);
    out.building = hit;
    return out;
  }

  /**
   * Resolve an AABB (centre pos, half extents he) against buildings + ground.
   * Mutates pos. Returns { ground, wall, wallNormal, roofY } contact info.
   */
  resolveBox(pos, he, contact, scratch = []) {
    contact.ground = false; contact.wall = false; contact.wallNormal.set(0, 0, 0); contact.ceiling = false;
    // ground plane
    if (pos.y - he.y < 0) { pos.y = he.y; contact.ground = true; }
    const list = this.near(pos.x, pos.z, he.x + 2, scratch);
    for (let iter = 0; iter < 3; iter++) {
      let any = false;
      for (const b of list) {
        const boxes = b.crown ? [[b.x, b.z, b.w, b.d, 0, b.h], [b.crown.x, b.crown.z, b.crown.w, b.crown.d, b.crown.y0, b.crown.h]] : [[b.x, b.z, b.w, b.d, 0, b.h]];
        for (const [bx, bz, bw, bd, y0, y1] of boxes) {
          const ox = (bw / 2 + he.x) - Math.abs(pos.x - bx);
          if (ox <= 0) continue;
          const oz = (bd / 2 + he.z) - Math.abs(pos.z - bz);
          if (oz <= 0) continue;
          const oyTop = (y1 + he.y) - pos.y;       // push up to roof
          const oyBot = (pos.y + he.y) - y0;       // push down below (crown underside)
          if (oyTop <= 0 || oyBot <= 0) continue;
          any = true;
          // choose smallest push. Favor vertical resolution when it's close (so landings are stable).
          const oy = Math.min(oyTop, oyBot);
          if (oy <= ox * 1.05 && oy <= oz * 1.05 && oy < 3) {
            if (oyTop <= oyBot) { pos.y = y1 + he.y; contact.ground = true; contact.roofY = y1; contact.building = b; }
            else { pos.y = y0 - he.y; contact.ceiling = true; }
          } else if (ox < oz) {
            const s = Math.sign(pos.x - bx) || 1;
            pos.x = bx + s * (bw / 2 + he.x);
            contact.wall = true; contact.wallNormal.set(s, 0, 0); contact.building = b;
          } else {
            const s = Math.sign(pos.z - bz) || 1;
            pos.z = bz + s * (bd / 2 + he.z);
            contact.wall = true; contact.wallNormal.set(0, 0, s); contact.building = b;
          }
        }
      }
      if (!any) break;
    }
    return contact;
  }
}
