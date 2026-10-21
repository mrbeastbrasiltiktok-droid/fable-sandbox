import * as THREE from 'three';
import { damp, lerp, clamp } from './utils.js';

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3(); this.look = new THREE.Vector3();
    this.yaw = 0; this.fov = 62; this.init = false; this.shake = 0;
    this.orbit = null;
  }
  snap(kart) { this.init = false; this.update(kart, 1, false); }
  update(kart, dt, rear = false) {
    const k = kart;
    // camera follows the direction of travel, lagging behind heading
    const targetYaw = k.velYaw + (rear ? Math.PI : 0);
    if (!this.init) { this.yaw = k.yaw + (rear ? Math.PI : 0); this.init = true; }
    // shortest-path smoothing
    let d = targetYaw - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * (1 - Math.exp(-(rear ? 30 : 7.5) * dt));
    // swing slightly to the outside of a drift
    const driftOff = k.drift && k.drift.active ? -k.drift.dir * 1.1 : 0;
    this.side = this.side === undefined ? 0 : this.side + (driftOff - this.side) * (1 - Math.exp(-4 * dt));
    const speedT = clamp(k.speed / k.topSpeed, 0, 1.6);
    const dist = 6.2 + speedT * 1.6 + (k.boostTimer > 0 ? 0.9 : 0);
    const height = 2.6 + speedT * 0.3;
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw); // screen-right
    const desired = new THREE.Vector3(k.pos.x - Math.sin(this.yaw) * dist + rx * this.side, k.pos.y + height, k.pos.z - Math.cos(this.yaw) * dist + rz * this.side);
    // keep camera above ground
    const gy = k.groundY !== undefined ? k.groundY : k.pos.y;
    desired.y = Math.max(desired.y, gy + 1.6);
    if (!this.init2) { this.pos.copy(desired); this.init2 = true; }
    this.pos.x = damp(this.pos.x, desired.x, 9, dt); this.pos.z = damp(this.pos.z, desired.z, 9, dt); this.pos.y = damp(this.pos.y, desired.y, 6, dt);
    const lookT = new THREE.Vector3(k.pos.x + Math.sin(this.yaw) * 3, k.pos.y + 1.1, k.pos.z + Math.cos(this.yaw) * 3);
    this.look.lerp(lookT, 1 - Math.exp(-12 * dt));
    const targetFov = 62 + speedT * 10 + (k.boostTimer > 0 ? 12 : 0) + (k.bulletTimer > 0 ? 10 : 0);
    this.fov = damp(this.fov, targetFov, 4, dt);
    this.shake = Math.max(0, this.shake - dt * 3);
    const sh = this.shake * 0.25;
    this.camera.position.set(this.pos.x + (Math.random() - 0.5) * sh, this.pos.y + (Math.random() - 0.5) * sh, this.pos.z + (Math.random() - 0.5) * sh);
    this.camera.lookAt(this.look);
    const slip = k.yaw !== undefined ? Math.atan2(Math.sin(k.yaw - k.velYaw), Math.cos(k.yaw - k.velYaw)) : 0;
    this.roll = this.roll === undefined ? 0 : this.roll + (slip * 0.06 - this.roll) * (1 - Math.exp(-6 * dt));
    this.camera.rotateZ(this.roll);
    this.camera.fov = this.fov; this.camera.updateProjectionMatrix();
  }
  /** Showroom orbit around a point */
  showroom(center, t, dist = 5.5) {
    this.camera.position.set(center.x + Math.sin(t * 0.5) * dist, center.y + 2.2, center.z + Math.cos(t * 0.5) * dist);
    this.camera.lookAt(center.x, center.y + 0.9, center.z);
    this.camera.fov = 45; this.camera.updateProjectionMatrix(); this.init = false; this.init2 = false;
  }
}
