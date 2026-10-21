import * as THREE from 'three';
import { CFG } from '../core/Config.js';

/**
 * Anchor selection for web-swinging (see docs/RESEARCH.md §1).
 * Fan-casts rays from a point above/ahead of the player against real building geometry.
 * Anchor placement *is* the steering: anchors to the side make you turn, vertical anchors go straight.
 * Anchors alternate sides for the natural zig-zag; A/D shifts the search up to 55°.
 */
export class SwingAnchorFinder {
  constructor(city) {
    this.city = city;
    this._dir = new THREE.Vector3();
    this._origin = new THREE.Vector3();
    this._hit = { point: new THREE.Vector3(), normal: new THREE.Vector3() };
    this.best = { point: new THREE.Vector3(), visual: new THREE.Vector3(), normal: new THREE.Vector3(), score: -Infinity, virtual: false };
  }

  /**
   * @param pos     player centre
   * @param heading unit horizontal travel direction
   * @param side    +1 / -1: preferred side for this swing
   * @param steer   -1..1 A/D input (shifts anchor yaw → turning)
   * @param assist  0..1
   */
  find(pos, heading, side, steer, assist = CFG.assist, hSpeed = 20) {
    this.hSpeed = hSpeed;
    const S = CFG.swing;
    const hy = Math.atan2(heading.x, heading.z);
    const origin = this._origin.copy(pos).addScaledVector(heading, S.castOriginFwd);
    origin.y += S.castOriginUp;
    // yaw decreases to the right (forward = (sin yaw, cos yaw), right = (-cos yaw, sin yaw))
    const baseYaw = hy - side * S.sideBias * (1 - Math.abs(steer) * 0.6) - steer * S.maxSteer;
    const b = this.best; b.virtual = false;
    this.side = side;
    let found = this._scan(origin, pos, heading, baseYaw, S.yawOffsets.map((y) => y * (y > 0.5 ? side : 1)), S.pitches);
    if (!found) found = this._scan(origin, pos, heading, baseYaw, [0.8, -0.8, 1.3, -1.3, 0.5, -0.5], S.pitches); // widen the cone
    if (found && !b.virtual && assist > 0) {
      // Swing assist: keep the web on the real building, but rotate the *physics* anchor toward the heading so the
      // arc carries you along the street instead of under the wall. Steering keeps more of the lateral offset (= turning).
      // If the street is blocked ahead (a building in the way), keep the lateral offset so the arc turns instead.
      const dx = b.point.x - pos.x, dz = b.point.z - pos.z;
      const rx = -heading.z, rz = heading.x; // right of heading
      const fwd = dx * heading.x + dz * heading.z, latS = dx * rx + dz * rz;
      this._dir.set(heading.x, -0.15, heading.z).normalize();
      const ahead = this.city.raycast(pos, this._dir, 48, this._hit);
      const blocked = ahead && ahead.building !== 'ground';
      const keep = blocked ? 1 : 1 - 0.85 * assist * (1 - Math.min(1, Math.abs(steer)));
      b.point.x = pos.x + heading.x * fwd + rx * latS * keep;
      b.point.z = pos.z + heading.z * fwd + rz * latS * keep;
    }
    if (!found && assist > 0.5) {
      // Virtual anchor (swing assist): ahead and above, so the player is never stranded over a plaza.
      b.point.copy(pos).addScaledVector(heading, 12);
      b.point.x += Math.sin(baseYaw) * 8; b.point.z += Math.cos(baseYaw) * 8;
      b.point.y += 24;
      b.normal.set(0, -1, 0); b.visual.copy(b.point);
      b.virtual = true; found = true;
    }
    return found ? b : null;
  }

  _scan(origin, pos, heading, baseYaw, yawOffsets, pitches) {
    const S = CFG.swing;
    const b = this.best;
    let bestScore = -Infinity, found = false;
    for (const yo of yawOffsets) {
      const yaw = baseYaw + yo;
      for (const p of pitches) {
        this._dir.set(Math.sin(yaw) * Math.cos(p), Math.sin(p), Math.cos(yaw) * Math.cos(p));
        const hit = this.city.raycast(origin, this._dir, S.maxAttachDist, this._hit);
        if (!hit || hit.building === 'ground') continue;
        const height = hit.point.y - pos.y;
        if (height < S.minAttachHeight) continue;
        const dist = hit.point.distanceTo(pos);
        if (dist > S.maxRope || dist < S.minAnchorDist) continue;
        const dx = hit.point.x - pos.x, dz = hit.point.z - pos.z;
        const latS = -dx * heading.z + dz * heading.x; // signed: + = right of heading
        const fwd = dx * heading.x + dz * heading.z, lat = Math.abs(latS);
        if (fwd < 4) continue;                              // never anchor behind / beside-only
        let score = 100;
        score -= Math.abs(dist - S.idealRopeLen) * 1.3;   // rope length near ideal → consistent arcs
        // slow start: want the anchor far ahead so the drop turns into forward speed; at speed, higher is better
        const idealPitch = this.hSpeed < 14 ? 0.6 : 1.0;
        score -= Math.abs(p - idealPitch) * 30;
        score -= Math.abs(yo) * 10;                        // stay near the intended heading
        score -= Math.max(0, lat / fwd - 0.7) * 80;        // swing plane must be mostly forward, not sideways
        if (Math.sign(latS) === this.side) score += 18;    // alternate sides: the zig-zag cancels lateral drift
        // A wall facing the player is a wall you will swing straight into; walls beside the path are what we want.
        const facing = -(hit.normal.x * heading.x + hit.normal.z * heading.z); // 1 = wall faces the player
        if (hit.normal.y > 0.5) score -= 25;               // roof top: the arc would dip into the roof
        else score -= Math.max(0, facing - 0.35) * 90;     // head-on wall: strong penalty
        if (score > bestScore) {
          bestScore = score; found = true;
          b.point.copy(hit.point).addScaledVector(hit.normal, hit.normal.y > 0.5 ? 0.3 : S.wallOffset); // physics anchor sits off the wall so the arc's low point clears it
          b.visual.copy(hit.point);
          b.normal.copy(hit.normal);
        }
      }
    }
    b.score = bestScore;
    return found;
  }
}
