import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CITY } from './config.js';
import { makeRng } from './utils.js';
import { SpatialHash } from './physics.js';
import * as TX from './textures.js';

const { BLOCKS: N, PITCH, HALF, ASPHALT, LANE, CURB, LAND, WATER } = CITY;
const HALF_ASPHALT = ASPHALT / 2;        // 7
const SIDEWALK_OUT = CITY.ROAD / 2;      // 10
export const STOP_DIST = 10.5;           // stop line distance from intersection centre
export const LANE_OFF = (l) => LANE / 2 + LANE * l; // 1.75, 5.25

// ---------- small geometry builder producing merged static meshes ----------
class Builder {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.idx = []; this.n = 0; }
  quad(a, b, c, d, nx, ny, nz, uvs, color) { // a,b,c,d CCW seen from outside
    for (const p of [a, b, c, d]) { this.pos.push(p[0], p[1], p[2]); this.nrm.push(nx, ny, nz); this.col.push(color.r, color.g, color.b); }
    for (const u of uvs) this.uv.push(u[0], u[1]);
    const n = this.n; this.idx.push(n, n + 1, n + 2, n, n + 2, n + 3); this.n += 4;
  }
  // Box with sides UV-mapped in world metres / scale (so windows keep their size).
  boxSides(x0, y0, z0, x1, y1, z1, color, s = 3) {
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    const uvS = (len, ht) => [[0, 0], [len / s, 0], [len / s, ht / s], [0, ht / s]];
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0, 0, 1, uvS(w, h), color);  // +z
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0, 0, -1, uvS(w, h), color); // -z
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 1, 0, 0, uvS(d, h), color);  // +x
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], -1, 0, 0, uvS(d, h), color); // -x
  }
  boxTop(x0, y, z0, x1, z1, color, s = 4) {
    const w = x1 - x0, d = z1 - z0;
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], 0, 1, 0, [[0, 0], [w / s, 0], [w / s, d / s], [0, d / s]], color);
  }
  box(x0, y0, z0, x1, y1, z1, color, s = 3) { this.boxSides(x0, y0, z0, x1, y1, z1, color, s); this.boxTop(x0, y1, z0, x1, z1, color, s); }
  build() {
    if (this.n === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx); return g;
  }
}

const DISTRICTS = [
  { name: 'Downtown', test: (i, j) => Math.abs(i - 4) <= 1 && Math.abs(j - 4) <= 1 },
  { name: 'Ironworks', test: (i, j) => j === 0 || (j === 1 && i >= 5) },
  { name: 'Palm Heights', test: (i, j) => j >= 7 },
  { name: 'Oakvale', test: (i, j) => i <= 1 },
  { name: 'Eastside', test: (i, j) => i >= 7 },
  { name: 'Midtown', test: () => true },
];
const PARK_BLOCKS = [[2, 6], [6, 3], [1, 1]];
const LOT_BLOCKS = [[3, 2], [6, 6], [2, 4]];

export class City {
  constructor(scene) {
    this.scene = scene;
    this.rng = makeRng(20260901);
    this.hash = new SpatialHash(24);
    this.roadCoords = []; for (let k = 0; k <= N; k++) this.roadCoords.push(-HALF + k * PITCH);
    this.blocks = []; this.lamps = []; this.trees = []; this.parkedSpots = []; this.lightHeads = [];
    this.group = new THREE.Group(); scene.add(this.group);
    this.buildLayout();
    this.buildGround();
    this.buildRoads();
    this.buildBlocks();
    this.buildProps();
    this.buildWater();
  }

  // ---------------- layout ----------------
  blockType(i, j) {
    if (PARK_BLOCKS.some(([a, b]) => a === i && b === j)) return 'park';
    if (LOT_BLOCKS.some(([a, b]) => a === i && b === j)) return 'lot';
    if (Math.abs(i - 4) <= 1 && Math.abs(j - 4) <= 1) return 'downtown';
    if (j === 0 || (j === 1 && i >= 5)) return 'industrial';
    if (i <= 1 || i >= 7 || j >= 7) return 'residential';
    return 'commercial';
  }
  districtName(x, z) {
    const i = Math.floor((x + HALF) / PITCH), j = Math.floor((z + HALF) / PITCH);
    if (i < 0 || j < 0 || i >= N || j >= N) return 'The Shore';
    return DISTRICTS.find(d => d.test(i, j)).name;
  }
  buildLayout() {
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const x0 = this.roadCoords[i] + SIDEWALK_OUT, x1 = this.roadCoords[i + 1] - SIDEWALK_OUT;
      const z0 = this.roadCoords[j] + SIDEWALK_OUT, z1 = this.roadCoords[j + 1] - SIDEWALK_OUT;
      this.blocks.push({ i, j, x0, x1, z0, z1, type: this.blockType(i, j), cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 });
    }
  }
  groundHeight(x, z) {
    const ax = Math.abs(x), az = Math.abs(z); const m = Math.max(ax, az);
    if (m > 2500) return 0; // interiors zone
    if (m > LAND) return -1.6 * Math.min(1, (m - LAND) / (WATER - LAND));
    // on a block slab?
    if (ax < HALF && az < HALF) {
      const fx = ((x + HALF) % PITCH), fz = ((z + HALF) % PITCH);
      if (fx > HALF_ASPHALT && fx < PITCH - HALF_ASPHALT && fz > HALF_ASPHALT && fz < PITCH - HALF_ASPHALT) return CURB;
      return 0;
    }
    // outer ring: sidewalk-height pavement beyond the outer roads
    if (m > HALF + HALF_ASPHALT) return CURB;
    return 0;
  }
  isWater(x, z) { const m = Math.max(Math.abs(x), Math.abs(z)); return m > LAND + (WATER - LAND) * 0.55 && m < 2500; }
  onRoad(x, z) { // true if on asphalt
    const ax = Math.abs(x), az = Math.abs(z);
    if (ax > HALF + HALF_ASPHALT || az > HALF + HALF_ASPHALT) return false;
    const fx = ((x + HALF) % PITCH + PITCH) % PITCH, fz = ((z + HALF) % PITCH + PITCH) % PITCH;
    return fx <= HALF_ASPHALT || fx >= PITCH - HALF_ASPHALT || fz <= HALF_ASPHALT || fz >= PITCH - HALF_ASPHALT;
  }

  // Traffic lights: per-intersection phase. Returns 'green' | 'yellow' | 'red' for an approach axis.
  lightState(ix, iz, axis, time) {
    const cycle = 16, offset = ((ix * 7 + iz * 3) % 4) * 4;
    const t = (time + offset) % cycle; // 0..8 NS(z-axis) green, 8..16 EW green
    const nsGreen = t < 8; const phaseT = nsGreen ? t : t - 8;
    const mine = axis === 'z' ? nsGreen : !nsGreen;
    if (!mine) return 'red';
    return phaseT > 6 ? 'yellow' : 'green';
  }

  // Lane centre for heading (dx,dz) & lane index at intersection (X,Z) offset by along (signed, along heading)
  lanePoint(ix, iz, dx, dz, lane, along) {
    const X = this.roadCoords[ix], Z = this.roadCoords[iz];
    const rx = -dz, rz = dx, off = LANE_OFF(lane);
    return { x: X + dx * along + rx * off, z: Z + dz * along + rz * off };
  }

  // ---------------- meshes ----------------
  buildGround() {
    const g = this.group;
    // Island base (grass) - slightly below asphalt to avoid z-fighting
    const grassTex = TX.makeGrassTexture(); grassTex.repeat.set(120, 120);
    const island = new THREE.Mesh(new THREE.PlaneGeometry(LAND * 2 + 8, LAND * 2 + 8), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
    island.rotation.x = -Math.PI / 2; island.position.y = -0.02; island.receiveShadow = true; g.add(island);
    // Beach ring: 4 sloped trapezoid strips
    const sandTex = TX.makeSandTexture(); sandTex.repeat.set(60, 4);
    const sandMat = new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1 });
    const beach = new Builder(); const col = new THREE.Color(1, 1, 1);
    const L = LAND, W = WATER + 6, depth = -1.7;
    // +x side
    beach.quad([L, 0, -L], [L, 0, L], [W, depth, W], [W, depth, -W], -0.1, 1, 0, [[0, 0], [1, 0], [1, 1], [0, 1]].map(u => [u[0] * 60, u[1] * 4]), col);
    beach.quad([-L, 0, L], [-L, 0, -L], [-W, depth, -W], [-W, depth, W], 0.1, 1, 0, [[0, 0], [1, 0], [1, 1], [0, 1]].map(u => [u[0] * 60, u[1] * 4]), col);
    beach.quad([L, 0, L], [-L, 0, L], [-W, depth, W], [W, depth, W], 0, 1, -0.1, [[0, 0], [1, 0], [1, 1], [0, 1]].map(u => [u[0] * 60, u[1] * 4]), col);
    beach.quad([-L, 0, -L], [L, 0, -L], [W, depth, -W], [-W, depth, -W], 0, 1, 0.1, [[0, 0], [1, 0], [1, 1], [0, 1]].map(u => [u[0] * 60, u[1] * 4]), col);
    const bm = new THREE.Mesh(beach.build(), sandMat); bm.receiveShadow = true; g.add(bm);
    // Seabed
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: 0x26505a, roughness: 1 }));
    bed.rotation.x = -Math.PI / 2; bed.position.y = -3; g.add(bed);
  }

  buildRoads() {
    const g = this.group;
    const roadTex = TX.makeRoadTexture(); const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.95, metalness: 0 });
    const interTex = TX.makeIntersectionTexture(); const interMat = new THREE.MeshStandardMaterial({ map: interTex, roughness: 0.95 });
    const cwTex = TX.makeCrosswalkTexture(); const cwMat = new THREE.MeshStandardMaterial({ map: cwTex, transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const segs = [], inters = [], cws = [];
    const segLen = PITCH - ASPHALT; // 66 between intersection squares
    for (let k = 0; k <= N; k++) for (let m = 0; m < N; m++) {
      // vertical road k, segment m (along z)
      let geo = new THREE.PlaneGeometry(ASPHALT, segLen); geo.rotateX(-Math.PI / 2);
      const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * segLen / 14);
      geo.translate(this.roadCoords[k], 0, this.roadCoords[m] + PITCH / 2); segs.push(geo);
      // horizontal road k, segment m (along x)
      geo = new THREE.PlaneGeometry(ASPHALT, segLen); geo.rotateX(-Math.PI / 2); geo.rotateY(Math.PI / 2);
      const uv2 = geo.attributes.uv; for (let i = 0; i < uv2.count; i++) uv2.setY(i, uv2.getY(i) * segLen / 14);
      geo.translate(this.roadCoords[m] + PITCH / 2, 0, this.roadCoords[k]); segs.push(geo);
    }
    for (let a = 0; a <= N; a++) for (let b = 0; b <= N; b++) {
      const X = this.roadCoords[a], Z = this.roadCoords[b];
      const geo = new THREE.PlaneGeometry(ASPHALT, ASPHALT); geo.rotateX(-Math.PI / 2); geo.translate(X, 0, Z); inters.push(geo);
      // 4 crosswalks (3m deep, ASPHALT wide), located between 7 and 10 from centre
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if ((dx !== 0 && (a + dx < 0 || a + dx > N)) || (dz !== 0 && (b + dz < 0 || b + dz > N))) continue;
        const cg = new THREE.PlaneGeometry(ASPHALT, 3); cg.rotateX(-Math.PI / 2); if (dz !== 0) cg.rotateY(0); else cg.rotateY(Math.PI / 2);
        cg.translate(X + dx * (HALF_ASPHALT + 1.5), 0.005, Z + dz * (HALF_ASPHALT + 1.5)); cws.push(cg);
      }
    }
    const roads = new THREE.Mesh(mergeGeometries(segs), roadMat); roads.receiveShadow = true; roads.position.y = 0.0; g.add(roads);
    const im = new THREE.Mesh(mergeGeometries(inters), interMat); im.receiveShadow = true; g.add(im);
    const cm = new THREE.Mesh(mergeGeometries(cws), cwMat); cm.position.y = 0.01; g.add(cm);
    // Sidewalk slabs (curbs) around every block + outer ring
    const swTex = TX.makeSidewalkTexture(); swTex.repeat.set(1, 1);
    const swMat = new THREE.MeshStandardMaterial({ map: swTex, roughness: 0.95, vertexColors: true });
    const sb = new Builder(); const white = new THREE.Color(1, 1, 1), grassC = new THREE.Color(0.9, 1, 0.9);
    for (const b of this.blocks) {
      const x0 = b.x0 - 3, x1 = b.x1 + 3, z0 = b.z0 - 3, z1 = b.z1 + 3;
      sb.box(x0, -0.05, z0, x1, CURB, z1, white, 2);
    }
    // outer ring pavement
    const o = HALF + HALF_ASPHALT, O = LAND + 0.5;
    sb.box(o, -0.05, -O, O, CURB, O, white, 2); sb.box(-O, -0.05, -O, -o, CURB, O, white, 2);
    sb.box(-o, -0.05, o, o, CURB, O, white, 2); sb.box(-o, -0.05, -O, o, CURB, -o, white, 2);
    const swm = new THREE.Mesh(sb.build(), swMat); swm.receiveShadow = true; swm.castShadow = false; g.add(swm);
  }

  addCollider(minX, minZ, maxX, maxZ, kind = 'building', maxY = 999) { const b = { minX, maxX, minZ, maxZ, kind, minY: 0, maxY }; this.hash.add(b); return b; }

  buildBlocks() {
    const rng = this.rng;
    const styles = ['glass', 'concrete', 'brick', 'tower', 'house', 'industrial'];
    const builders = {}; for (const s of styles) builders[s] = new Builder();
    const roofB = new Builder(); const neonB = new Builder(); const detailB = new Builder();
    const grassB = new Builder();
    const roofC = new THREE.Color(0.55, 0.55, 0.55);
    const neonColors = [0xff2d95, 0x2df0ff, 0xffe12d, 0x7dff2d, 0xff6a2d, 0xb52dff].map(c => new THREE.Color(c));

    const addBuilding = (x0, z0, x1, z1, h, style, tint) => {
      const c = new THREE.Color(tint);
      builders[style].boxSides(x0, CURB, z0, x1, CURB + h, z1, c, 3);
      roofB.boxTop(x0, CURB + h, z0, x1, z1, roofC.clone().multiplyScalar(rng.range(0.7, 1.2)), 4);
      // roof parapet & clutter
      const pw = 0.5;
      detailB.box(x0, CURB + h, z0, x1, CURB + h + 0.8, z0 + pw, c); detailB.box(x0, CURB + h, z1 - pw, x1, CURB + h + 0.8, z1, c);
      detailB.box(x0, CURB + h, z0, x0 + pw, CURB + h + 0.8, z1, c); detailB.box(x1 - pw, CURB + h, z0, x1, CURB + h + 0.8, z1, c);
      const n = rng.int(0, 3);
      for (let k = 0; k < n; k++) {
        const bw = rng.range(1.5, 4), bd = rng.range(1.5, 4), bh = rng.range(1, 3);
        const bx = rng.range(x0 + 1.5, x1 - 1.5 - bw), bz = rng.range(z0 + 1.5, z1 - 1.5 - bd);
        if (bx < x0 + 1 || bz < z0 + 1) continue;
        detailB.box(bx, CURB + h, bz, bx + bw, CURB + h + bh, bz + bd, new THREE.Color(0x777f86));
      }
      if (h > 60 && rng.chance(0.6)) { const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2; detailB.box(cx - 0.3, CURB + h, cz - 0.3, cx + 0.3, CURB + h + rng.range(6, 16), cz + 0.3, new THREE.Color(0x999999)); }
      if (style !== 'house' && style !== 'industrial' && h > 10 && rng.chance(0.45)) { // neon sign band on front
        const nc = rng.pick(neonColors); const y = CURB + rng.range(4, Math.min(h - 2, 12)); const side = rng.int(0, 3);
        if (side === 0) neonB.box(x0 + 1, y, z1, x1 - 1, y + 1.2, z1 + 0.2, nc);
        else if (side === 1) neonB.box(x0 + 1, y, z0 - 0.2, x1 - 1, y + 1.2, z0, nc);
        else if (side === 2) neonB.box(x1, y, z0 + 1, x1 + 0.2, y + 1.2, z1 - 1, nc);
        else neonB.box(x0 - 0.2, y, z0 + 1, x0, y + 1.2, z1 - 1, nc);
      }
      this.addCollider(x0, z0, x1, z1, 'building', CURB + h);
    };

    for (const b of this.blocks) {
      const w = b.x1 - b.x0;
      if (b.type === 'park') { this.buildPark(b, grassB); continue; }
      if (b.type === 'lot') { this.buildParkingLot(b); continue; }
      if (b.type === 'downtown') {
        const towers = rng.int(1, 3);
        if (towers === 1) {
          const m = rng.range(4, 8); const h = rng.range(70, 140); const style = rng.pick(['glass', 'tower', 'glass']);
          const tint = rng.pick([0xffffff, 0xdfe8f0, 0xc8d6e0, 0xe8e0d0]);
          // tiered tower
          addBuilding(b.x0 + m, b.z0 + m, b.x1 - m, b.z1 - m, h * 0.55, style, tint);
          const m2 = m + rng.range(4, 8); addBuilding(b.x0 + m2, b.z0 + m2, b.x1 - m2, b.z1 - m2, h * 0.85, style, tint);
          const m3 = m2 + rng.range(4, 7); addBuilding(b.x0 + m3, b.z0 + m3, b.x1 - m3, b.z1 - m3, h, style, tint);
        } else {
          const half = w / 2;
          for (let a = 0; a < 2; a++) for (let c = 0; c < 2; c++) {
            if (towers === 2 && a !== c) continue;
            const x0 = b.x0 + a * half + 2, z0 = b.z0 + c * half + 2, x1 = x0 + half - 4, z1 = z0 + half - 4;
            const h = rng.range(35, 110);
            addBuilding(x0, z0, x1, z1, h, rng.pick(['glass', 'tower', 'concrete']), rng.pick([0xffffff, 0xd7e3ee, 0xe9e2d3, 0xbfc9d3]));
          }
        }
      } else if (b.type === 'commercial') {
        const lots = rng.pick([2, 3]); const lw = w / lots;
        for (let a = 0; a < lots; a++) for (let c = 0; c < lots; c++) {
          if (rng.chance(0.12)) { this.trees.push({ x: b.x0 + (a + 0.5) * lw, z: b.z0 + (c + 0.5) * lw, s: rng.range(0.8, 1.2) }); continue; }
          const gap = rng.range(0.6, 2);
          const h = rng.range(9, 36);
          addBuilding(b.x0 + a * lw + gap, b.z0 + c * lw + gap, b.x0 + (a + 1) * lw - gap, b.z0 + (c + 1) * lw - gap, h,
            rng.pick(['concrete', 'brick', 'brick', 'tower']), rng.pick([0xffffff, 0xf0e6d6, 0xd8d2c8, 0xe6e6ea, 0xf3d9c0]));
        }
      } else if (b.type === 'residential') {
        const lots = 3, lw = w / lots;
        for (let a = 0; a < lots; a++) for (let c = 0; c < lots; c++) {
          const cx = b.x0 + (a + 0.5) * lw, cz = b.z0 + (c + 0.5) * lw;
          if (rng.chance(0.2)) { this.trees.push({ x: cx, z: cz, s: rng.range(0.9, 1.4) }); continue; }
          const hw = rng.range(5, 8), hd = rng.range(5, 8), h = rng.range(5, 9);
          addBuilding(cx - hw, cz - hd, cx + hw, cz + hd, h, 'house', rng.pick([0xffffff, 0xffe9c9, 0xd9f0e0, 0xf7d6d6, 0xe0e6ff, 0xfff4b0]));
          if (rng.chance(0.7)) this.trees.push({ x: cx + rng.range(-9, 9), z: cz + (rng.chance(0.5) ? 9.2 : -9.2), s: rng.range(0.7, 1.1) });
        }
      } else if (b.type === 'industrial') {
        const split = rng.chance(0.5);
        if (split) {
          addBuilding(b.x0 + 2, b.z0 + 2, b.cx - 2, b.z1 - 2, rng.range(8, 14), 'industrial', rng.pick([0xffffff, 0xd0d8dc, 0xc9bfae]));
          addBuilding(b.cx + 2, b.z0 + 2, b.x1 - 2, b.z1 - 2, rng.range(8, 14), 'industrial', rng.pick([0xffffff, 0xd0d8dc, 0xc9bfae]));
        } else {
          addBuilding(b.x0 + 3, b.z0 + 3, b.x1 - 3, b.cz - 3, rng.range(10, 16), 'industrial', rng.pick([0xffffff, 0xd0d8dc]));
          // container yard on other half
          for (let k = 0; k < 6; k++) {
            const cx = rng.range(b.x0 + 6, b.x1 - 6), cz = rng.range(b.cz + 4, b.z1 - 4);
            const col = new THREE.Color(rng.pick([0xc0392b, 0x2980b9, 0xf39c12, 0x27ae60, 0x8e44ad]));
            detailB.box(cx - 3, CURB, cz - 1.2, cx + 3, CURB + 2.6, cz + 1.2, col);
            this.addCollider(cx - 3, cz - 1.2, cx + 3, cz + 1.2, 'prop', 2.6);
          }
          // smokestack
          const sx = b.x1 - 8, sz = b.cz + 10; detailB.box(sx - 1.2, CURB, sz - 1.2, sx + 1.2, CURB + 30, sz + 1.2, new THREE.Color(0x6b6b6b));
          this.addCollider(sx - 1.2, sz - 1.2, sx + 1.2, sz + 1.2, 'prop', 30);
        }
      }
    }

    const roofTex = TX.makeRoof(3);
    for (const s of styles) {
      const geo = builders[s].build(); if (!geo) continue;
      const { map, emissiveMap } = TX.makeFacade(s, 100 + styles.indexOf(s));
      const mat = new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true, roughness: s === 'glass' ? 0.35 : 0.85, metalness: s === 'glass' ? 0.5 : 0.0 });
      const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true; this.group.add(mesh);
      (this.facadeMats ||= []).push(mat);
    }
    const rg = roofB.build(); if (rg) { const m = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ map: roofTex, vertexColors: true, roughness: 1 })); m.receiveShadow = true; this.group.add(m); }
    const dg = detailB.build(); if (dg) { const m = new THREE.Mesh(dg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })); m.castShadow = true; m.receiveShadow = true; this.group.add(m); }
    const ng = neonB.build(); if (ng) { this.neonMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }); const m = new THREE.Mesh(ng, this.neonMat); this.group.add(m); }
    const gg = grassB.build(); if (gg) { const t = TX.makeGrassTexture(12); const m = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ map: t, vertexColors: true, roughness: 1 })); m.receiveShadow = true; this.group.add(m); }
  }

  buildPark(b, grassB) {
    const rng = this.rng; const white = new THREE.Color(1, 1, 1);
    grassB.box(b.x0, CURB, b.z0, b.x1, CURB + 0.05, b.z1, white, 6);
    for (let k = 0; k < 22; k++) {
      const x = rng.range(b.x0 + 3, b.x1 - 3), z = rng.range(b.z0 + 3, b.z1 - 3);
      if (Math.hypot(x - b.cx, z - b.cz) < 9) continue;
      this.trees.push({ x, z, s: rng.range(0.9, 1.6) });
    }
    // fountain
    const f = new THREE.Group(); f.position.set(b.cx, CURB, b.cz);
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.4, 0.9, 24), new THREE.MeshStandardMaterial({ color: 0xbfb8aa, roughness: 0.8 })); basin.position.y = 0.45; basin.castShadow = true; f.add(basin);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 0.2, 24), new THREE.MeshStandardMaterial({ color: 0x3aa0d8, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.85 })); water.position.y = 0.85; f.add(water);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.2, 3, 12), basin.material); column.position.y = 1.8; column.castShadow = true; f.add(column);
    this.group.add(f); this.addCollider(b.cx - 5.2, b.cz - 5.2, b.cx + 5.2, b.cz + 5.2, 'prop', 1);
    (this.fountains ||= []).push(f);
  }

  buildParkingLot(b) {
    const rng = this.rng;
    const lotMat = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.95 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.x1 - b.x0, 0.06, b.z1 - b.z0), lotMat); m.position.set(b.cx, CURB + 0.03, b.cz); m.receiveShadow = true; this.group.add(m);
    // a small shop building in the corner
    // parking rows: two rows of spots facing each other
    const lineB = new Builder(); const lc = new THREE.Color(0.9, 0.9, 0.85);
    for (let r = 0; r < 2; r++) {
      const z = b.z0 + 14 + r * 24;
      for (let k = 0; k < 8; k++) {
        const x = b.x0 + 6 + k * 6.5;
        lineB.boxTop(x - 0.08, CURB + 0.07, z - 5, x + 0.08, z + 5, lc, 1);
        if (k < 7 && rng.chance(0.55)) this.parkedSpots.push({ x: x + 3.25, z, heading: r === 0 ? Math.PI : 0 });
      }
    }
    const lg = lineB.build(); if (lg) this.group.add(new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ vertexColors: true })));
    // lamp posts in lot
    this.lamps.push({ x: b.cx, z: b.z0 + 26, rot: 0 }, { x: b.x0 + 8, z: b.z0 + 26, rot: 0 }, { x: b.x1 - 8, z: b.z0 + 26, rot: 0 });
  }

  buildProps() {
    const rng = this.rng;
    // Lamp posts along both sides of each road segment every ~22m (on the sidewalk, 8.5 from centre)
    for (let k = 0; k <= N; k++) for (let m = 0; m < N; m++) {
      for (let s = 12; s < PITCH - 12; s += 22) {
        const zc = this.roadCoords[m] + s, xc = this.roadCoords[k];
        this.lamps.push({ x: xc - 8.6, z: zc, rot: -Math.PI / 2 }, { x: xc + 8.6, z: zc, rot: Math.PI / 2 });
        this.lamps.push({ x: this.roadCoords[m] + s, z: this.roadCoords[k] - 8.6, rot: Math.PI }, { x: this.roadCoords[m] + s, z: this.roadCoords[k] + 8.6, rot: 0 });
      }
    }
    // Traffic light heads at each intersection: one per approach, mounted on the far-right corner pole.
    for (let a = 0; a <= N; a++) for (let b = 0; b <= N; b++) {
      for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        // approach coming from -d direction; head sits across the intersection on the right
        const X = this.roadCoords[a], Z = this.roadCoords[b];
        const rx = -dz, rz = dx;
        const px = X + dx * 8.3 + rx * 8.3, pz = Z + dz * 8.3 + rz * 8.3;
        this.lightHeads.push({ x: px, z: pz, dx, dz, ix: a, iz: b, axis: dz !== 0 ? 'z' : 'x' });
      }
    }
    // Beach palms
    for (let k = 0; k < 90; k++) {
      const side = rng.int(0, 3); const t = rng.range(-LAND, LAND); const d = rng.range(HALF + 14, LAND + 10);
      const p = side === 0 ? [d, t] : side === 1 ? [-d, t] : side === 2 ? [t, d] : [t, -d];
      this.trees.push({ x: p[0], z: p[1], s: rng.range(0.9, 1.5), palm: true });
    }
    // trees in the outer ring greenery
    for (let k = 0; k < 60; k++) {
      const side = rng.int(0, 3); const t = rng.range(-HALF, HALF); const d = rng.range(HALF + 12, LAND - 12);
      const p = side === 0 ? [d, t] : side === 1 ? [-d, t] : side === 2 ? [t, d] : [t, -d];
      this.trees.push({ x: p[0], z: p[1], s: rng.range(0.9, 1.5) });
    }
    this.buildLampMeshes(); this.buildTreeMeshes(); this.buildTrafficLightMeshes(); this.buildStreetClutter();
  }

  buildLampMeshes() {
    const n = this.lamps.length; const dummy = new THREE.Object3D();
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 7, 8); poleGeo.translate(0, 3.5, 0);
    const armGeo = new THREE.BoxGeometry(0.12, 0.12, 2.2); armGeo.translate(0, 6.9, 1.0);
    const headGeo = new THREE.BoxGeometry(0.5, 0.18, 0.9); headGeo.translate(0, 6.85, 2.0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3b3f44, roughness: 0.6, metalness: 0.6 });
    this.lampHeadMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe2b0, emissiveIntensity: 0 });
    const pole = new THREE.InstancedMesh(mergeGeometries([poleGeo, armGeo]), poleMat, n); pole.castShadow = true;
    const head = new THREE.InstancedMesh(headGeo, this.lampHeadMat, n);
    const glowPos = [];
    this.lamps.forEach((l, i) => {
      const y = this.groundHeight(l.x, l.z);
      dummy.position.set(l.x, y, l.z); dummy.rotation.set(0, l.rot, 0); dummy.updateMatrix();
      pole.setMatrixAt(i, dummy.matrix); head.setMatrixAt(i, dummy.matrix);
      glowPos.push(l.x + Math.sin(l.rot) * 2.0, y + 6.7, l.z + Math.cos(l.rot) * 2.0);
      this.addCollider(l.x - 0.15, l.z - 0.15, l.x + 0.15, l.z + 0.15, 'pole', 7);
    });
    this.group.add(pole, head);
    // glow sprites (night only)
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(glowPos, 3));
    this.lampGlowMat = new THREE.PointsMaterial({ map: TX.makeParticleTexture(), color: 0xffd9a0, size: 6, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    this.lampGlow = new THREE.Points(gg, this.lampGlowMat); this.group.add(this.lampGlow);
    this.lampPositions = glowPos;
  }

  buildTreeMeshes() {
    const dummy = new THREE.Object3D();
    const trees = this.trees.filter(t => !t.palm), palms = this.trees.filter(t => t.palm);
    // regular trees: trunk + 3 canopy blobs
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 2.6, 7); trunkGeo.translate(0, 1.3, 0);
    const canopy = mergeGeometries([
      new THREE.IcosahedronGeometry(1.9, 1).translate(0, 3.6, 0),
      new THREE.IcosahedronGeometry(1.4, 1).translate(1.0, 4.4, 0.4),
      new THREE.IcosahedronGeometry(1.3, 1).translate(-0.9, 4.3, -0.5),
    ]);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3f2a, roughness: 1 });
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x3f7a2e, roughness: 1, flatShading: true });
    const tm = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length); const cm = new THREE.InstancedMesh(canopy, canopyMat, trees.length);
    tm.castShadow = true; cm.castShadow = true; cm.receiveShadow = true;
    const col = new THREE.Color();
    trees.forEach((t, i) => {
      const y = this.groundHeight(t.x, t.z);
      dummy.position.set(t.x, y, t.z); dummy.rotation.set(0, this.rng() * 6.28, 0); dummy.scale.setScalar(t.s); dummy.updateMatrix();
      tm.setMatrixAt(i, dummy.matrix); cm.setMatrixAt(i, dummy.matrix);
      cm.setColorAt(i, col.setHSL(0.26 + this.rng() * 0.08, 0.5, 0.3 + this.rng() * 0.15));
      this.addCollider(t.x - 0.35, t.z - 0.35, t.x + 0.35, t.z + 0.35, 'tree', 3);
    });
    this.group.add(tm, cm);
    // palms: leaning trunk + fronds
    const ptrunk = new THREE.CylinderGeometry(0.14, 0.24, 6, 7); ptrunk.translate(0, 3, 0); ptrunk.rotateZ(0.12);
    const frondParts = [];
    for (let k = 0; k < 7; k++) {
      const f = new THREE.ConeGeometry(0.5, 3.2, 4); f.scale(1, 1, 0.25); f.translate(0, 1.4, 0); f.rotateX(-1.9); f.rotateY(k / 7 * 6.28); f.translate(0.7, 6.0, 0);
      frondParts.push(f);
    }
    const frond = mergeGeometries(frondParts);
    const pm = new THREE.InstancedMesh(ptrunk, new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 1 }), palms.length);
    const fm = new THREE.InstancedMesh(frond, new THREE.MeshStandardMaterial({ color: 0x3d8f3a, roughness: 1, side: THREE.DoubleSide }), palms.length);
    pm.castShadow = true; fm.castShadow = true;
    palms.forEach((t, i) => {
      const y = this.groundHeight(t.x, t.z);
      dummy.position.set(t.x, y, t.z); dummy.rotation.set(0, this.rng() * 6.28, 0); dummy.scale.setScalar(t.s); dummy.updateMatrix();
      pm.setMatrixAt(i, dummy.matrix); fm.setMatrixAt(i, dummy.matrix);
      this.addCollider(t.x - 0.3, t.z - 0.3, t.x + 0.3, t.z + 0.3, 'tree', 6);
    });
    this.group.add(pm, fm);
  }

  buildTrafficLightMeshes() {
    const heads = this.lightHeads; const dummy = new THREE.Object3D();
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.12, 5.5, 8); poleGeo.translate(0, 2.75, 0);
    const boxGeo = new THREE.BoxGeometry(0.4, 1.1, 0.4); boxGeo.translate(0, 4.6, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2f3336, roughness: 0.7, metalness: 0.5 });
    const pm = new THREE.InstancedMesh(mergeGeometries([poleGeo, boxGeo]), poleMat, heads.length);
    const bulbGeo = new THREE.SphereGeometry(0.12, 8, 8);
    this.bulbs = new THREE.InstancedMesh(bulbGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), heads.length * 3);
    heads.forEach((h, i) => {
      dummy.position.set(h.x, 0.15, h.z); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); pm.setMatrixAt(i, dummy.matrix);
      // bulbs face the approaching traffic: approach travels along (dx,dz), so face -d
      for (let k = 0; k < 3; k++) {
        dummy.position.set(h.x - h.dx * 0.22, 0.15 + 4.95 - k * 0.33, h.z - h.dz * 0.22); dummy.updateMatrix();
        this.bulbs.setMatrixAt(i * 3 + k, dummy.matrix); this.bulbs.setColorAt(i * 3 + k, new THREE.Color(0x222222));
      }
      this.addCollider(h.x - 0.15, h.z - 0.15, h.x + 0.15, h.z + 0.15, 'pole', 5);
    });
    this.group.add(pm, this.bulbs);
    this._bulbColors = { red: new THREE.Color(2.5, 0.15, 0.1), yellow: new THREE.Color(2.5, 1.8, 0.2), green: new THREE.Color(0.2, 2.5, 0.6), off: new THREE.Color(0.08, 0.08, 0.08) };
  }

  buildStreetClutter() {
    const rng = this.rng; const dummy = new THREE.Object3D();
    // hydrants, bins and benches on sidewalks
    const items = [];
    for (const b of this.blocks) {
      if (b.type === 'park' || b.type === 'lot') continue;
      for (let k = 0; k < 4; k++) {
        const side = rng.int(0, 3); const t = rng.range(0.1, 0.9); const kind = rng.pick(['hydrant', 'bin', 'bench', 'bin']);
        let x, z, rot;
        if (side === 0) { x = b.x0 + t * (b.x1 - b.x0); z = b.z0 - 1.6; rot = Math.PI; }
        else if (side === 1) { x = b.x0 + t * (b.x1 - b.x0); z = b.z1 + 1.6; rot = 0; }
        else if (side === 2) { x = b.x0 - 1.6; z = b.z0 + t * (b.z1 - b.z0); rot = -Math.PI / 2; }
        else { x = b.x1 + 1.6; z = b.z0 + t * (b.z1 - b.z0); rot = Math.PI / 2; }
        items.push({ kind, x, z, rot });
      }
    }
    const make = (kind, geo, mat) => {
      const list = items.filter(i => i.kind === kind); if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length); im.castShadow = true;
      list.forEach((it, i) => { dummy.position.set(it.x, CURB, it.z); dummy.rotation.set(0, it.rot, 0); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); this.addCollider(it.x - 0.4, it.z - 0.4, it.x + 0.4, it.z + 0.4, 'prop', 1); });
      this.group.add(im);
    };
    const hyd = mergeGeometries([new THREE.CylinderGeometry(0.16, 0.2, 0.8, 8).translate(0, 0.4, 0), new THREE.SphereGeometry(0.18, 8, 8).translate(0, 0.85, 0), new THREE.BoxGeometry(0.5, 0.12, 0.14).translate(0, 0.55, 0)]);
    make('hydrant', hyd, new THREE.MeshStandardMaterial({ color: 0xd8342a, roughness: 0.5, metalness: 0.3 }));
    make('bin', new THREE.CylinderGeometry(0.35, 0.3, 1.0, 10).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x2f5d3a, roughness: 0.8 }));
    const bench = mergeGeometries([new THREE.BoxGeometry(1.8, 0.08, 0.5).translate(0, 0.45, 0), new THREE.BoxGeometry(1.8, 0.45, 0.08).translate(0, 0.72, -0.22), new THREE.BoxGeometry(0.08, 0.45, 0.5).translate(-0.8, 0.22, 0), new THREE.BoxGeometry(0.08, 0.45, 0.5).translate(0.8, 0.22, 0)]);
    make('bench', bench, new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 }));
  }

  buildWater() {
    this.waterUniforms = { uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uDeep: { value: new THREE.Color(0x0b3d5c) }, uShallow: { value: new THREE.Color(0x2fa3c4) }, uSky: { value: new THREE.Color(0x87b6e0) }, uFogColor: { value: new THREE.Color(0xbcd) }, uFogNear: { value: 200 }, uFogFar: { value: 900 }, uNight: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.waterUniforms, transparent: true,
      vertexShader: `uniform float uTime; varying vec3 vPos; varying vec3 vWorld;
        void main(){ vec3 p = position; float w = sin(p.x*0.08+uTime*1.2)*0.25 + sin(p.z*0.11-uTime*0.9)*0.2 + sin((p.x+p.z)*0.05+uTime*0.6)*0.3; p.y += w;
          vec4 wp = modelMatrix*vec4(p,1.0); vWorld = wp.xyz; vPos = p; gl_Position = projectionMatrix*viewMatrix*wp; }`,
      fragmentShader: `uniform float uTime; uniform vec3 uSunDir, uDeep, uShallow, uSky, uFogColor; uniform float uFogNear, uFogFar, uNight; varying vec3 vPos; varying vec3 vWorld;
        void main(){ float d = max(abs(vWorld.x), abs(vWorld.z)); float shore = smoothstep(${WATER + 60}.0, ${LAND}.0, d);
          vec3 n = normalize(vec3(cos(vWorld.x*0.3+uTime*2.0)*0.08 + cos(vWorld.z*0.7-uTime*1.3)*0.05, 1.0, sin(vWorld.z*0.35+uTime*1.7)*0.08));
          vec3 v = normalize(cameraPosition - vWorld); float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
          vec3 base = mix(uDeep, uShallow, shore*0.8); vec3 col = mix(base, uSky, fres*0.7);
          vec3 h = normalize(uSunDir + v); float spec = pow(max(dot(n,h),0.0), 180.0) * (1.0-uNight*0.8); col += vec3(1.0,0.95,0.85)*spec*1.5;
          float foam = smoothstep(0.75, 0.95, shore) * (0.5+0.5*sin(d*0.8 - uTime*2.0)); col = mix(col, vec3(0.9), foam*0.6);
          col *= mix(1.0, 0.18, uNight);
          float fog = smoothstep(uFogNear, uFogFar, length(cameraPosition - vWorld)); col = mix(col, uFogColor, fog);
          gl_FragColor = vec4(col, 0.92); }`,
    });
    const geo = new THREE.PlaneGeometry(5000, 5000, 120, 120); geo.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(geo, mat); this.water.position.y = -0.7; this.water.renderOrder = -1; this.group.add(this.water);
  }

  // ---------------- per-frame ----------------
  update(dt, time, night, env) {
    this.waterUniforms.uTime.value = time;
    if (env) { this.waterUniforms.uSunDir.value.copy(env.sunDir); this.waterUniforms.uFogColor.value.copy(env.fogColor); this.waterUniforms.uNight.value = night; this.waterUniforms.uSky.value.copy(env.skyColor); }
    if (this.facadeMats) for (const m of this.facadeMats) m.emissiveIntensity = night * 0.75;
    this.lampHeadMat.emissiveIntensity = night * 3; this.lampGlowMat.opacity = night * 0.7;
    if (this.neonMat) this.neonMat.opacity = 1;
    if (this.fountains) for (const f of this.fountains) f.children[1].rotation.y += dt * 0.3;
    // traffic bulbs (update every ~0.2s)
    this._bulbT = (this._bulbT || 0) + dt;
    if (this._bulbT > 0.2) {
      this._bulbT = 0; const c = this._bulbColors;
      this.lightHeads.forEach((h, i) => {
        const st = this.lightState(h.ix, h.iz, h.axis, time);
        this.bulbs.setColorAt(i * 3, st === 'red' ? c.red : c.off);
        this.bulbs.setColorAt(i * 3 + 1, st === 'yellow' ? c.yellow : c.off);
        this.bulbs.setColorAt(i * 3 + 2, st === 'green' ? c.green : c.off);
      });
      this.bulbs.instanceColor.needsUpdate = true;
    }
  }
}
