import * as THREE from 'three';
import { clamp, damp, angleDamp, angleLerp, wrapAngle, lerp } from './utils.js';
import { raycastBoxes } from './physics.js';

// Third-person camera rig: orbit on foot, lagging chase cam in vehicles, over-shoulder when aiming.
export class CameraRig {
  constructor(camera, city) {
    this.cam = camera; this.city = city;
    this.yaw = 0; this.pitch = 0.18; this.userYaw = 0; this.idleT = 0;
    this.pos = new THREE.Vector3(); this.look = new THREE.Vector3(); this.shake = 0; this.shakeV = new THREE.Vector3();
    this.fov = 62; this.mode = 'foot'; this.curDist = 4; this.recoil = 0;
    this._target = new THREE.Vector3(); this._desired = new THREE.Vector3();
  }
  addShake(a) { this.shake = Math.min(1.5, this.shake + a); }
  // t: {x,y,z} focus; heading: entity facing; velocity heading & speed for chase
  update(dt, input, t, heading, speed, mode, velHeading, mouseSens = 0.0022) {
    this.mode = mode;
    const mdx = input.mouse.dx * mouseSens, mdy = input.mouse.dy * mouseSens;
    const hasMouse = Math.abs(mdx) + Math.abs(mdy) > 0;
    if (hasMouse) this.idleT = 0; else this.idleT += dt;
    this.yaw -= mdx; this.pitch = clamp(this.pitch + mdy, -0.35, 0.9);
    let dist, height, fovT, side = 0;
    if (mode === 'car') {
      // chase: yaw follows blend of heading and velocity direction; user offset decays after idle
      const sp = Math.min(1, speed / 30);
      const target = wrapAngle(angleLerp(heading, velHeading, sp * 0.6) + Math.PI); // camera sits behind => yaw = heading + PI
      if (this.idleT > 1.2) this.yaw = angleDamp(this.yaw, target, 3.5 + sp * 3, dt);
      if (this.idleT > 1.2) this.pitch = damp(this.pitch, 0.16 + sp * 0.06, 2, dt);
      dist = 6.2 + sp * 2.2; height = 1.9 + sp * 0.5; fovT = 62 + sp * 16;
    } else if (mode === 'aim') {
      dist = 2.4; height = 1.45; fovT = 50; side = 1.05;
    } else {
      dist = 4.2; height = 1.6; fovT = 62;
      // gentle recentre behind the player when moving and mouse idle
      if (speed > 1 && this.idleT > 1.6) this.yaw = angleDamp(this.yaw, heading + Math.PI, 0.8, dt);
    }
    this.fov = damp(this.fov, fovT, 4, dt);
    this.curDist = damp(this.curDist, dist, mode === 'aim' ? 14 : 5, dt);
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw); // direction from target to camera
    const rx = fz, rz = -fx;
    const tgt = this._target.set(t.x + rx * side, t.y + height, t.z + rz * side);
    const cy = Math.sin(this.pitch), ch = Math.cos(this.pitch);
    const d = this._desired.set(tgt.x + fx * ch * this.curDist, tgt.y + cy * this.curDist, tgt.z + fz * ch * this.curDist);
    // collision: pull in when a building blocks the line
    const dx = d.x - tgt.x, dz = d.z - tgt.z; const L = Math.hypot(dx, dz);
    if (L > 0.01) {
      const hit = raycastBoxes(this.city.hash, tgt.x, tgt.z, dx / L, dz / L, L + 0.3, (b) => b.kind === 'building' && (b.maxY ?? 999) > Math.min(d.y, tgt.y) - 0.5);
      if (hit.t < L + 0.3 && hit.box) {
        const f = Math.max(0.12, (hit.t - 0.4) / L); d.set(tgt.x + dx * f, tgt.y + (d.y - tgt.y) * f, tgt.z + dz * f);
      }
    }
    const gy = this.city.groundHeight(d.x, d.z) + 0.35; if (d.y < gy) d.y = gy;
    const lam = mode === 'car' ? 12 : 18;
    this.pos.x = damp(this.pos.x, d.x, lam, dt); this.pos.y = damp(this.pos.y, d.y, lam, dt); this.pos.z = damp(this.pos.z, d.z, lam, dt);
    this.look.x = damp(this.look.x, tgt.x, 25, dt); this.look.y = damp(this.look.y, tgt.y, 25, dt); this.look.z = damp(this.look.z, tgt.z, 25, dt);
    // shake & recoil
    this.shake = Math.max(0, this.shake - dt * 2.2); this.recoil = damp(this.recoil, 0, 12, dt);
    const s = this.shake * this.shake * 0.35;
    this.shakeV.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    this.cam.position.copy(this.pos).add(this.shakeV);
    this.cam.lookAt(this.look.x + this.shakeV.x * 0.5, this.look.y + this.recoil * 0.4, this.look.z + this.shakeV.z * 0.5);
    if (mode === 'car') this.cam.rotateZ(clamp(-this._roll || 0, -0.05, 0.05));
    if (Math.abs(this.cam.fov - this.fov) > 0.05) { this.cam.fov = this.fov; this.cam.updateProjectionMatrix(); }
  }
  snapBehind(heading) { this.yaw = heading + Math.PI; this.idleT = 5; }
  forward(out) { out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); return out; } // where the camera looks (XZ)
}
