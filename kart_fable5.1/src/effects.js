import * as THREE from 'three';

const MAX = 3000;
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.n = 0;
    this.pos = new Float32Array(MAX * 3); this.col = new Float32Array(MAX * 3); this.size = new Float32Array(MAX);
    this.vel = new Float32Array(MAX * 3); this.life = new Float32Array(MAX); this.maxLife = new Float32Array(MAX); this.grav = new Float32Array(MAX); this.startSize = new Float32Array(MAX);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3)); g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
      uniforms: {},
      vertexShader: `attribute float size; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * (300.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d); if (r > 0.25) discard; float a = smoothstep(0.25, 0.0, r); gl_FragColor = vec4(vC * a, a); }`,
    });
    this.points = new THREE.Points(g, mat); this.points.frustumCulled = false; scene.add(this.points);
    this.rings = [];
    this.tmpC = new THREE.Color();
  }
  spawn(x, y, z, vx, vy, vz, life, color, size, grav = 0) {
    if (this.n >= MAX) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.grav[i] = grav; this.startSize[i] = size; this.size[i] = size;
    const c = this.tmpC.set(color); this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
  }
  burst(p, count, color, speed, life = 0.6, size = 0.5, grav = 6) {
    for (let i = 0; i < count; i++) { const a = Math.random() * Math.PI * 2, b = (Math.random() - 0.3) * Math.PI; const sp = speed * (0.4 + Math.random() * 0.6); this.spawn(p.x, p.y, p.z, Math.cos(a) * Math.cos(b) * sp, Math.sin(b) * sp + speed * 0.3, Math.sin(a) * Math.cos(b) * sp, life * (0.6 + Math.random() * 0.6), color, size, grav); }
  }
  ring(p, color, radius = 6, duration = 0.5) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    m.position.copy(p); m.position.y += 0.3; m.rotation.x = -Math.PI / 2; this.scene.add(m);
    this.rings.push({ m, t: 0, d: duration, r: radius });
  }
  explosion(p, radius = 4) {
    this.burst(p, 60, 0xff8a20, 12, 0.7, 1.4, 8); this.burst(p, 30, 0xffe090, 8, 0.5, 1.0, 4); this.burst(p, 25, 0x333333, 6, 1.1, 1.8, 3);
    this.ring(p, 0xffa040, radius * 1.4, 0.45);
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { const l = --this.n; if (i !== l) { for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] = this.pos[l * 3 + k]; this.vel[i * 3 + k] = this.vel[l * 3 + k]; this.col[i * 3 + k] = this.col[l * 3 + k]; } this.life[i] = this.life[l]; this.maxLife[i] = this.maxLife[l]; this.grav[i] = this.grav[l]; this.startSize[i] = this.startSize[l]; } i--; continue; }
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const f = this.life[i] / this.maxLife[i]; this.size[i] = this.startSize[i] * (0.3 + 0.7 * f);
    }
    const g = this.points.geometry; g.setDrawRange(0, this.n);
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.size.needsUpdate = true;
    for (let i = this.rings.length - 1; i >= 0; i--) { const r = this.rings[i]; r.t += dt; const f = r.t / r.d; if (f >= 1) { this.scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); this.rings.splice(i, 1); continue; } const s = 1 + f * r.r; r.m.scale.set(s, s, 1); r.m.material.opacity = 0.9 * (1 - f); }
  }
}
