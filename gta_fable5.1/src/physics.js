// Lightweight 2D (XZ-plane) collision helpers: axis-aligned boxes in a spatial hash,
// circle-vs-AABB resolution for characters, and corner-sampled OBB-vs-AABB for cars.
export class SpatialHash {
  constructor(cell = 24) { this.cell = cell; this.map = new Map(); this.items = []; }
  key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  add(box) { // box: {minX,maxX,minZ,maxZ, ...}
    this.items.push(box);
    const c = this.cell;
    for (let cx = Math.floor(box.minX / c); cx <= Math.floor(box.maxX / c); cx++)
      for (let cz = Math.floor(box.minZ / c); cz <= Math.floor(box.maxZ / c); cz++) {
        const k = this.key(cx, cz); let arr = this.map.get(k); if (!arr) { arr = []; this.map.set(k, arr); } arr.push(box);
      }
  }
  query(minX, maxX, minZ, maxZ, out = []) {
    out.length = 0; const c = this.cell;
    for (let cx = Math.floor(minX / c); cx <= Math.floor(maxX / c); cx++)
      for (let cz = Math.floor(minZ / c); cz <= Math.floor(maxZ / c); cz++) {
        const arr = this.map.get(this.key(cx, cz)); if (!arr) continue;
        for (const b of arr) if (!b.disabled && b.maxX >= minX && b.minX <= maxX && b.maxZ >= minZ && b.minZ <= maxZ && !out.includes(b)) out.push(b);
      }
    return out;
  }
}

const q = [];
// Push a circle (x,z,r) out of all boxes. Mutates and returns pos {x,z}; returns hit box or null.
export function resolveCircle(hash, pos, r, maxH = Infinity, y = 0) {
  let hit = null;
  hash.query(pos.x - r, pos.x + r, pos.z - r, pos.z + r, q);
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const b of q) {
      if (b.minY !== undefined && (y > b.maxY || y + 1.6 < b.minY)) continue;
      const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
      let dx = pos.x - cx, dz = pos.z - cz; let d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      hit = b; moved = true;
      if (d2 < 1e-8) { // centre inside box: push out along the smallest penetration axis
        const l = pos.x - b.minX, rr = b.maxX - pos.x, t = pos.z - b.minZ, bb = b.maxZ - pos.z;
        const m = Math.min(l, rr, t, bb);
        if (m === l) pos.x = b.minX - r; else if (m === rr) pos.x = b.maxX + r; else if (m === t) pos.z = b.minZ - r; else pos.z = b.maxZ + r;
      } else { const d = Math.sqrt(d2); const push = r - d; pos.x += dx / d * push; pos.z += dz / d * push; }
    }
    if (!moved) break;
  }
  return hit;
}

// Ray (2D) vs boxes; returns nearest t or Infinity.
export function raycastBoxes(hash, ox, oz, dx, dz, maxT, accept) {
  const ex = ox + dx * maxT, ez = oz + dz * maxT;
  hash.query(Math.min(ox, ex), Math.max(ox, ex), Math.min(oz, ez), Math.max(oz, ez), q);
  let best = Infinity, bestBox = null;
  for (const b of q) {
    let tmin = 0, tmax = maxT;
    if (Math.abs(dx) < 1e-9) { if (ox < b.minX || ox > b.maxX) continue; }
    else { let t1 = (b.minX - ox) / dx, t2 = (b.maxX - ox) / dx; if (t1 > t2) [t1, t2] = [t2, t1]; tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); }
    if (Math.abs(dz) < 1e-9) { if (oz < b.minZ || oz > b.maxZ) continue; }
    else { let t1 = (b.minZ - oz) / dz, t2 = (b.maxZ - oz) / dz; if (t1 > t2) [t1, t2] = [t2, t1]; tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); }
    if (tmax >= tmin && tmin < best && (!accept || accept(b, tmin))) { best = tmin; bestBox = b; }
  }
  return { t: best, box: bestBox };
}

// Oriented box (car) vs static boxes. Samples the car's outline points; on penetration
// pushes the car out and returns { nx, nz, depth } of the strongest contact (or null).
const samples = [];
export function resolveOBB(hash, car, halfL, halfW) {
  const c = Math.cos(car.heading), s = Math.sin(car.heading);
  // forward = (sin h, cos h) -> matches THREE rotation.y convention (object faces +z rotated by heading)
  const fx = s, fz = c, rx = c, rz = -s;
  samples.length = 0;
  for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1], [0.5, 1], [0.5, -1], [-0.5, 1], [-0.5, -1]])
    samples.push([car.x + fx * halfL * a + rx * halfW * b, car.z + fz * halfL * a + rz * halfW * b]);
  const R = Math.hypot(halfL, halfW);
  hash.query(car.x - R, car.x + R, car.z - R, car.z + R, q);
  let best = null;
  for (const b of q) {
    if (b.minY !== undefined && b.minY > 1.0) continue;
    for (const [px, pz] of samples) {
      if (px < b.minX || px > b.maxX || pz < b.minZ || pz > b.maxZ) continue;
      const l = px - b.minX, r = b.maxX - px, t = pz - b.minZ, bt = b.maxZ - pz;
      const m = Math.min(l, r, t, bt); let nx = 0, nz = 0;
      if (m === l) nx = -1; else if (m === r) nx = 1; else if (m === t) nz = -1; else nz = 1;
      if (!best || m > best.depth) best = { nx, nz, depth: m, box: b };
    }
  }
  if (best) { car.x += best.nx * (best.depth + 0.02); car.z += best.nz * (best.depth + 0.02); }
  return best;
}
