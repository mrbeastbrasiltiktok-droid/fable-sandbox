import * as THREE from 'three';

/** Pooled point-particle bursts (impacts, landings, web hits) + expanding hit rings. */
export class FX {
  constructor(scene, max = 600) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    // soft round sprite so sparks don't read as cubes
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'); const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.7)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    this.points = new THREE.Points(this.geo, new THREE.PointsMaterial({ size: 0.42, map: tex, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.next = 0;
    this._c = new THREE.Color();
    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.6, 0.8, 24);
    this.scene = scene;
  }

  burst(p, color, n = 10, speed = 5, up = 2) {
    this._c.set(color);
    for (let i = 0; i < n; i++) {
      const k = this.next; this.next = (this.next + 1) % this.max;
      this.pos[k * 3] = p.x; this.pos[k * 3 + 1] = p.y; this.pos[k * 3 + 2] = p.z;
      this.vel[k * 3] = (Math.random() - 0.5) * speed * 2; this.vel[k * 3 + 1] = Math.random() * speed + up; this.vel[k * 3 + 2] = (Math.random() - 0.5) * speed * 2;
      this.col[k * 3] = this._c.r; this.col[k * 3 + 1] = this._c.g; this.col[k * 3 + 2] = this._c.b;
      this.life[k] = 0.5 + Math.random() * 0.4;
    }
  }

  ring(p, color = 0xffffff, size = 2.5) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    m.position.copy(p); m.rotation.x = -Math.PI / 2; m.scale.setScalar(0.3);
    m.userData = { t: 0, size };
    this.scene.add(m); this.rings.push(m);
  }

  update(dt) {
    for (let k = 0; k < this.max; k++) {
      if (this.life[k] <= 0) { this.pos[k * 3 + 1] = -9999; continue; }
      this.life[k] -= dt;
      this.vel[k * 3 + 1] -= 12 * dt;
      this.pos[k * 3] += this.vel[k * 3] * dt; this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt; this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i], u = r.userData; u.t += dt * 3;
      r.scale.setScalar(0.3 + u.t * u.size); r.material.opacity = Math.max(0, 0.9 - u.t);
      if (u.t >= 1) { this.scene.remove(r); r.material.dispose(); this.rings.splice(i, 1); }
    }
  }
}
