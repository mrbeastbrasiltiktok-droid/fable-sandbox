import * as THREE from 'three';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
// Frame-rate independent exponential smoothing: rate ~ "how fast" (1/s)
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Deterministic PRNG so the city is identical each run
export function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), q: new THREE.Quaternion(), m: new THREE.Matrix4() };

export function yawOf(v) { return Math.atan2(v.x, v.z); }
export function dirFromYaw(yaw, out = new THREE.Vector3()) { return out.set(Math.sin(yaw), 0, Math.cos(yaw)); }
export function shortestAngle(a, b) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }
