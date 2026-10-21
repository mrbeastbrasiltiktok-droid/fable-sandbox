import * as THREE from 'three';
import { makeParticleTexture, makeSmokeTexture } from './textures.js';
import { rand } from './utils.js';

// CPU particle pool rendered as Points (two layers: additive fire/sparks, normal smoke) plus tracers, skid marks and explosion flashes.
class ParticleLayer {
  constructor(scene, max, material) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max); this.col = new Float32Array(max * 3); this.alpha = new Float32Array(max); this.grow = new Float32Array(max); this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1)); g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3)); g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setDrawRange(0, 0);
    this.points = new THREE.Points(g, material); this.points.frustumCulled = false; scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, life, size, r, g, b, grow = 0, drag = 0, grav = 0) {
    let i; if (this.n < this.max) i = this.n++; else i = Math.floor(Math.random() * this.max);
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z; this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size; this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b; this.alpha[i] = 1; this.grow[i] = grow; this.drag[i] = drag; this.grav[i] = grav;
  }
  update(dt) {
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 2] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d + this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt; const t = this.life[i] / this.maxLife[i]; this.alpha[i] = t < 0.5 ? t * 2 : 1; alive++;
    }
    if (alive === 0) this.n = 0;
    this.geo.setDrawRange(0, this.n);
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.aSize.needsUpdate = true; this.geo.attributes.aColor.needsUpdate = true; this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

function particleMaterial(map, additive) {
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: map } }, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: `attribute float aSize; attribute vec3 aColor; attribute float aAlpha; varying vec3 vC; varying float vA;
      void main(){ vC = aColor; vA = aAlpha; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = aSize * 300.0 / -mv.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform sampler2D uMap; varying vec3 vC; varying float vA; void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vC, t.a*vA); if (gl_FragColor.a < 0.01) discard; }`,
  });
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.fire = new ParticleLayer(scene, 1500, particleMaterial(makeParticleTexture(), true));
    this.smoke = new ParticleLayer(scene, 1500, particleMaterial(makeSmokeTexture(), false));
    this.fire.points.renderOrder = 10; this.smoke.points.renderOrder = 9;
    // tracers
    this.tracerGeo = new THREE.BufferGeometry(); this.tracerPos = new Float32Array(64 * 6); this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3));
    this.tracers = new THREE.LineSegments(this.tracerGeo, new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9, toneMapped: false })); this.tracers.frustumCulled = false; scene.add(this.tracers);
    this.tracerLife = new Float32Array(64); this.tracerN = 0;
    // flashes (explosion spheres + lights)
    this.flashes = []; this.lights = [];
    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false });
    this.flashGeo = new THREE.SphereGeometry(1, 12, 8);
    this.ringGeo = new THREE.RingGeometry(0.6, 1, 32); this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false });
    // skid marks: ring buffer of quads
    this.skidMax = 600; this.skidPos = new Float32Array(this.skidMax * 4 * 3); this.skidAlpha = new Float32Array(this.skidMax * 4); const idx = [];
    for (let i = 0; i < this.skidMax; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    this.skidGeo = new THREE.BufferGeometry(); this.skidGeo.setAttribute('position', new THREE.BufferAttribute(this.skidPos, 3)); this.skidGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.skidAlpha, 1)); this.skidGeo.setIndex(idx); this.skidGeo.setDrawRange(0, 0);
    this.skidMesh = new THREE.Mesh(this.skidGeo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
      vertexShader: `attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(0.05,0.05,0.05, vA*0.55); }` }));
    this.skidMesh.frustumCulled = false; scene.add(this.skidMesh); this.skidI = 0; this.skidCount = 0;
    // muzzle flash light
    this.muzzleLight = new THREE.PointLight(0xffc060, 0, 12, 2); scene.add(this.muzzleLight);
    // fixed pool of explosion lights: the light count never changes, so shaders never recompile mid-game
    this.lightPool = []; for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xffa040, 0, 60, 1.5); l.position.set(0, -100, 0); scene.add(l); this.lightPool.push(l); }
    this.dust = 0;
  }

  addTracer(a, b) {
    const i = this.tracerN % 64; this.tracerN++;
    this.tracerPos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6); this.tracerLife[i] = 0.06;
  }
  muzzle(p, dir) {
    this.muzzleLight.position.copy(p); this.muzzleLight.intensity = 40;
    for (let i = 0; i < 6; i++) this.fire.emit(p.x, p.y, p.z, dir.x * 6 + rand(-2, 2), rand(-1, 2), dir.z * 6 + rand(-2, 2), 0.08, 0.5, 1, 0.8, 0.3, 4, 8, 0);
  }
  sparks(x, y, z, n = 8, color = [1, 0.8, 0.4]) {
    for (let i = 0; i < n; i++) this.fire.emit(x, y, z, rand(-4, 4), rand(1, 5), rand(-4, 4), rand(0.2, 0.5), 0.12, ...color, 0, 1, -12);
  }
  blood(x, y, z, n = 10) {
    for (let i = 0; i < n; i++) this.smoke.emit(x, y, z, rand(-2, 2), rand(0.5, 3), rand(-2, 2), rand(0.3, 0.6), 0.25, 0.5, 0.02, 0.02, 0.3, 3, -9);
  }
  puff(x, y, z, n = 6, size = 0.6) { for (let i = 0; i < n; i++) this.smoke.emit(x, y, z, rand(-1.5, 1.5), rand(0.5, 2), rand(-1.5, 1.5), rand(0.4, 0.9), size, 0.6, 0.6, 0.6, 1.2, 2, 0.5); }
  carSmoke(p, intensity) { if (Math.random() < intensity) this.smoke.emit(p.x + rand(-0.3, 0.3), p.y, p.z + rand(-0.3, 0.3), rand(-0.5, 0.5), rand(1, 2.2), rand(-0.5, 0.5), rand(1.2, 2.2), 0.7, 0.25, 0.25, 0.25, 1.6, 1.5, 0.3); }
  carFire(p) {
    this.fire.emit(p.x + rand(-0.4, 0.4), p.y, p.z + rand(-0.4, 0.4), rand(-0.4, 0.4), rand(1.5, 3.5), rand(-0.4, 0.4), rand(0.3, 0.7), 0.9, 1, rand(0.3, 0.6), 0.05, 0.5, 2, 1);
    if (Math.random() < 0.5) this.smoke.emit(p.x, p.y + 0.5, p.z, rand(-0.5, 0.5), rand(2, 3), rand(-0.5, 0.5), rand(1.5, 3), 1.0, 0.08, 0.08, 0.08, 2.2, 1.2, 0.4);
  }
  explosion(x, y, z, scale = 1) {
    for (let i = 0; i < 90; i++) { const a = rand(0, 6.28), s = rand(2, 14) * scale; this.fire.emit(x, y + 0.5, z, Math.cos(a) * s, rand(2, 12) * scale, Math.sin(a) * s, rand(0.4, 1.1), rand(0.8, 2.0) * scale, 1, rand(0.35, 0.7), 0.1, 1.5, 3, -4); }
    for (let i = 0; i < 60; i++) { const a = rand(0, 6.28), s = rand(1, 6) * scale; this.smoke.emit(x, y + 1, z, Math.cos(a) * s, rand(3, 9) * scale, Math.sin(a) * s, rand(1.5, 3.5), rand(1.5, 3) * scale, 0.1, 0.1, 0.1, 3, 1.5, 0.8); }
    this.sparks(x, y + 1, z, 40, [1, 0.9, 0.5]);
    const m = new THREE.Mesh(this.flashGeo, this.flashMat.clone()); m.position.set(x, y + 1, z); m.scale.setScalar(0.5); this.scene.add(m); this.flashes.push({ m, t: 0, life: 0.45, scale: 6 * scale });
    const ring = new THREE.Mesh(this.ringGeo, this.ringMat.clone()); ring.position.set(x, y + 0.3, z); ring.rotation.x = -Math.PI / 2; this.scene.add(ring); this.flashes.push({ m: ring, t: 0, life: 0.6, scale: 18 * scale, ring: true });
    const l = this.lightPool.reduce((a, b) => (a.intensity <= b.intensity ? a : b)); l.position.set(x, y + 2, z); l.intensity = 400 * scale; l.distance = 60 * scale;
    if (!this.lights.some(e => e.l === l)) this.lights.push({ l, t: 0, life: 0.9 });
  }
  skid(x, z, y, dirX, dirZ, width, alpha) {
    const i = this.skidI; this.skidI = (this.skidI + 1) % this.skidMax; this.skidCount = Math.min(this.skidCount + 1, this.skidMax);
    const rx = -dirZ * width / 2, rz = dirX * width / 2; const lx = dirX * 0.25, lz = dirZ * 0.25;
    this.skidPos.set([x - rx - lx, y, z - rz - lz, x + rx - lx, y, z + rz - lz, x + rx + lx, y, z + rz + lz, x - rx + lx, y, z - rz + lz], i * 12);
    this.skidAlpha.fill(alpha, i * 4, i * 4 + 4);
    this.skidGeo.setDrawRange(0, this.skidCount * 6); this.skidGeo.attributes.position.needsUpdate = true; this.skidGeo.attributes.aAlpha.needsUpdate = true;
  }
  update(dt) {
    this.fire.update(dt); this.smoke.update(dt);
    for (let i = 0; i < 64; i++) { if (this.tracerLife[i] > 0) { this.tracerLife[i] -= dt; if (this.tracerLife[i] <= 0) this.tracerPos.fill(0, i * 6, i * 6 + 6); } }
    this.tracerGeo.attributes.position.needsUpdate = true;
    this.muzzleLight.intensity *= Math.exp(-30 * dt);
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]; f.t += dt; const k = f.t / f.life;
      f.m.scale.setScalar(0.5 + f.scale * (f.ring ? k : Math.sqrt(k))); f.m.material.opacity = (1 - k) * (f.ring ? 0.5 : 0.9);
      if (k >= 1) { this.scene.remove(f.m); f.m.material.dispose(); this.flashes.splice(i, 1); }
    }
    for (let i = this.lights.length - 1; i >= 0; i--) { const f = this.lights[i]; f.t += dt; f.l.intensity *= Math.exp(-6 * dt); if (f.t > f.life) { f.l.intensity = 0; this.lights.splice(i, 1); } }
  }
}
