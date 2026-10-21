import * as THREE from 'three';
import { mulberry32 } from '../core/Utils.js';

/** Decorative traffic: instanced cars looping along every street lane. */
export class Traffic {
  constructor(city, count = 520) {
    this.city = city;
    this.cars = [];
    const rng = mulberry32(99);
    const lane = city.S * 0.22;
    for (let k = 0; k < count; k++) {
      const vertical = rng() < 0.5;
      const idx = 1 + Math.floor(rng() * (vertical ? city.NX - 1 : city.NZ - 1));
      const line = (vertical ? city.originX : city.originZ) + idx * (vertical ? city.PX : city.PZ);
      const dir = rng() < 0.5 ? 1 : -1;
      this.cars.push({
        vertical, line: line + dir * lane, dir,
        t: (vertical ? city.originZ : city.originX) + rng() * (vertical ? city.sizeZ : city.sizeX),
        speed: 11 + rng() * 9,
        color: new THREE.Color().setHSL(rng(), rng() < 0.4 ? 0.0 : 0.6, 0.2 + rng() * 0.5),
      });
    }
    const body = new THREE.BoxGeometry(1.9, 0.6, 4.3); body.translate(0, 0.55, 0);
    const cabin = new THREE.BoxGeometry(1.7, 0.55, 2.2); cabin.translate(0, 1.1, -0.2);
    const wheels = new THREE.BoxGeometry(2.0, 0.35, 0.7);
    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.5 });
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0x1a2430, roughness: 0.15, metalness: 0.6 });
    const lightMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xfff2c0, emissiveIntensity: 3 });
    const tailMat = new THREE.MeshStandardMaterial({ color: 0x110000, emissive: 0xff2020, emissiveIntensity: 2.5 });
    const head = new THREE.BoxGeometry(1.5, 0.2, 0.1); head.translate(0, 0.6, 2.15);
    const tail = new THREE.BoxGeometry(1.5, 0.15, 0.1); tail.translate(0, 0.65, -2.15);

    this.meshes = [
      new THREE.InstancedMesh(body, bodyMat, count),
      new THREE.InstancedMesh(cabin, cabinMat, count),
      new THREE.InstancedMesh(head, lightMat, count),
      new THREE.InstancedMesh(tail, tailMat, count),
    ];
    const c = new THREE.Color();
    this.cars.forEach((car, k) => this.meshes[0].setColorAt(k, c.copy(car.color)));
    this.meshes[0].instanceColor.needsUpdate = true;
    this.meshes.forEach((m) => { m.castShadow = true; m.frustumCulled = false; });
    this.group = new THREE.Group();
    this.meshes.forEach((m) => this.group.add(m));
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this.update(0);
  }

  update(dt) {
    const c = this.city;
    for (let k = 0; k < this.cars.length; k++) {
      const car = this.cars[k];
      car.t += car.dir * car.speed * dt;
      const lo = car.vertical ? c.originZ : c.originX, len = car.vertical ? c.sizeZ : c.sizeX;
      if (car.t > lo + len) car.t = lo; else if (car.t < lo) car.t = lo + len;
      if (car.vertical) { this._p.set(car.line, 0, car.t); this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), car.dir > 0 ? 0 : Math.PI); }
      else { this._p.set(car.t, 0, car.line); this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), car.dir > 0 ? Math.PI / 2 : -Math.PI / 2); }
      this._m.compose(this._p, this._q, this._s);
      for (const m of this.meshes) m.setMatrixAt(k, this._m);
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }
}
