import * as THREE from 'three';

/** A web strand from the hand to an anchor. Animates out on attach and sags slightly. */
export class WebLine {
  constructor(scene, segments = 14) {
    this.segments = segments;
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array((segments + 1) * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xf4f4f4, transparent: true, opacity: 0.95 }));
    this.line.frustumCulled = false;
    this.line.visible = false;
    scene.add(this.line);
    this.progress = 0;
    this.from = new THREE.Vector3(); this.to = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this.active = false;
  }

  attach(from, to) { this.from.copy(from); this.to.copy(to); this.progress = 0; this.active = true; this.line.visible = true; }
  release() { this.active = false; this.line.visible = false; }

  update(dt, from, to, tension = 1) {
    if (!this.active) return;
    this.from.copy(from); this.to.copy(to);
    this.progress = Math.min(1, this.progress + dt / 0.07);
    const n = this.segments;
    const sag = (1 - tension) * 0.35 * this.from.distanceTo(this.to) * 0.08;
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * this.progress;
      this._p.lerpVectors(this.from, this.to, t);
      this._p.y -= Math.sin(t * Math.PI) * sag;
      this.positions[i * 3] = this._p.x; this.positions[i * 3 + 1] = this._p.y; this.positions[i * 3 + 2] = this._p.z;
    }
    this.line.geometry.attributes.position.needsUpdate = true;
  }
}

/** Short-lived straight web shots (web-shoot / web-strike). */
export class WebShots {
  constructor(scene, max = 8) {
    this.pool = [];
    for (let i = 0; i < max; i++) {
      const w = new WebLine(scene, 4);
      w.ttl = 0;
      this.pool.push(w);
    }
  }
  fire(from, to, ttl = 0.25) {
    const w = this.pool.find((p) => !p.active) || this.pool[0];
    w.attach(from, to); w.ttl = ttl; w.f = from.clone(); w.t = to.clone();
    w.line.material.opacity = 1;
  }
  update(dt) {
    for (const w of this.pool) {
      if (!w.active) continue;
      w.ttl -= dt;
      w.update(dt, w.f, w.t, 1);
      w.line.material.opacity = Math.min(1, w.ttl * 6);
      if (w.ttl <= 0) w.release();
    }
  }
}
