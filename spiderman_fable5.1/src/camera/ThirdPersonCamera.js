import * as THREE from 'three';
import { CFG } from '../core/Config.js';
import { clamp, damp, shortestAngle } from '../core/Utils.js';

/** Orbit-follow camera: mouse orbit, auto-yaw toward travel direction while swinging, FOV speed boost, collision. */
export class ThirdPersonCamera {
  constructor(camera, city) {
    this.cam = camera;
    this.city = city;
    this.yaw = 0; this.pitch = -0.15;
    this.target = new THREE.Vector3();
    this.smoothTarget = new THREE.Vector3();
    this.fov = CFG.cam.fov;
    this.dist = CFG.cam.dist;
    this.shake = 0;
    this.roll = 0;
    this.idleMouse = 0;
    this._dir = new THREE.Vector3();
    this._hit = {};
    this._up = new THREE.Vector3(0, 1, 0);
    this.lockOn = null; // vec3 to bias toward (combat)
    this.kick = 0;      // FOV kick on web attach ("dolly heartbeat")
  }

  fovKick(deg) { this.kick = Math.max(this.kick, deg); }

  update(dt, player, input) {
    const mx = input.mouse.dx, my = input.mouse.dy;
    if (Math.abs(mx) + Math.abs(my) > 0) this.idleMouse = 0; else this.idleMouse += dt;
    this.yaw -= mx * CFG.cam.sens;
    this.pitch = clamp(this.pitch - my * CFG.cam.sens, -1.25, 1.0);

    // Auto-follow: while swinging/falling and the mouse is idle, ease yaw toward the velocity heading
    const v = player.vel, hs = Math.hypot(v.x, v.z);
    if ((player.state === 'swing' || player.state === 'fall' || player.state === 'zip') && hs > 6 && this.idleMouse > 0.25) {
      const want = Math.atan2(v.x, v.z);
      const rate = player.state === 'swing' ? 2.2 : 1.4;
      this.yaw += shortestAngle(this.yaw, want) * (1 - Math.exp(-rate * dt));
      // ease pitch toward slightly-below-horizon during swings so the ground rushes by
      // pitch follows the pendulum tangent a little: look down on the dive, up on the rise
      const wantPitch = player.state === 'swing' ? -0.2 + clamp(v.y / 50, -0.3, 0.3) : -0.35;
      this.pitch = damp(this.pitch, wantPitch, 0.8, dt);
    }
    if (player.state === 'wall' && this.idleMouse > 0.35) {
      this.yaw += shortestAngle(this.yaw, player.wallYaw) * (1 - Math.exp(-2.2 * dt));
      this.pitch = damp(this.pitch, player.wallRun ? 0.5 : 0.3, 1.6, dt); // look up the wall so the climb reads
    }
    if (this.lockOn && this.idleMouse > 0.4) {
      const d = this._dir.copy(this.lockOn).sub(player.pos);
      const want = Math.atan2(d.x, d.z);
      this.yaw += shortestAngle(this.yaw, want) * (1 - Math.exp(-3 * dt));
    }

    // Follow target (smoothed so fast physics doesn't jitter the camera)
    this.target.copy(player.renderPos).y += CFG.cam.height * 0.5;
    const speed = v.length();
    const followRate = player.state === 'swing' ? 22 : 30;
    this.smoothTarget.lerp(this.target, 1 - Math.exp(-followRate * dt));

    // Orbit direction
    const cp = Math.cos(this.pitch);
    this._dir.set(-Math.sin(this.yaw) * cp, -Math.sin(this.pitch), -Math.cos(this.yaw) * cp); // from target to camera
    // Pull camera back a little at speed, sit lower when swinging fast
    const speedT = clamp((speed - CFG.cam.speedLo) / (CFG.cam.speedHi - CFG.cam.speedLo), 0, 1);
    const wantDist = CFG.cam.dist + (CFG.cam.distFast - CFG.cam.dist) * speedT + (player.combatNear ? 1.5 : 0) + (player.state === 'wall' ? 2 : 0);
    this.dist = damp(this.dist, wantDist, 4, dt);
    let d = this.dist;
    // Collision
    const hit = this.city.raycast(this.smoothTarget, this._dir, d + 0.4, this._hit);
    if (hit) d = Math.max(0.6, hit.dist - 0.5);
    const pos = this.cam.position.copy(this.smoothTarget).addScaledVector(this._dir, d);
    if (pos.y < 0.6) pos.y = 0.6;

    // Shake
    if (this.shake > 0.001) {
      pos.x += (Math.random() - 0.5) * this.shake; pos.y += (Math.random() - 0.5) * this.shake; pos.z += (Math.random() - 0.5) * this.shake;
      this.shake = damp(this.shake, 0, 8, dt);
    }

    // Look, and bank into the turn while swinging (roll is camera-relative)
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
    const lateral = player.state === 'swing' ? (v.x * rx + v.z * rz) : 0;
    this.roll = damp(this.roll, clamp(lateral / 50, -0.105, 0.105), 3, dt);
    this.cam.up.set(rx * Math.sin(this.roll), Math.cos(this.roll), rz * Math.sin(this.roll));
    this.cam.lookAt(this.smoothTarget.x, this.smoothTarget.y + CFG.cam.height * 0.5, this.smoothTarget.z);

    // FOV boost with speed
    const wantFov = CFG.cam.fov + (CFG.cam.fovFast - CFG.cam.fov) * speedT;
    this.fov = damp(this.fov, wantFov, 1 / CFG.cam.smooth * 0.5, dt);
    this.kick = damp(this.kick, 0, 7, dt);
    this.fov += this.kick;
    if (Math.abs(this.cam.fov - this.fov) > 0.05) { this.cam.fov = this.fov; this.cam.updateProjectionMatrix(); }
  }

  forward(out) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  right(out) { return out.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw)); } // forward × up (three.js is right-handed, y up)
  addShake(a) { this.shake = Math.min(1.2, this.shake + a); }
}
