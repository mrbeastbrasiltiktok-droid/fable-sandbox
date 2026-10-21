import * as THREE from 'three';

// Stats on MK8D-style scale (roughly 2..5). speed, accel, weight, handling, traction, mt(mini-turbo)
export const CHARACTERS = [
  { id: 'pip', name: 'Pip', species: 'Mouse', cls: 'Feather', color: 0xf27fb0, accent: 0xffe0f0, kart: 0xf25c9c, stats: { speed: 2.75, accel: 4.5, weight: 2.25, handling: 4.5, traction: 4.0, mt: 4.25 }, size: 0.82, tag: 'Tiny, twitchy, turns on a dime.' },
  { id: 'kiko', name: 'Kiko', species: 'Frog', cls: 'Light', color: 0x5fd06a, accent: 0xe8ffb0, kart: 0x38b24a, stats: { speed: 3.25, accel: 4.0, weight: 2.75, handling: 4.25, traction: 4.0, mt: 3.75 }, size: 0.9, tag: 'Bouncy and quick off the line.' },
  { id: 'nova', name: 'Nova', species: 'Fox', cls: 'Medium', color: 0xff8a3c, accent: 0xfff0dc, kart: 0xff6a1a, stats: { speed: 3.5, accel: 3.75, weight: 3.0, handling: 4.0, traction: 3.75, mt: 3.5 }, size: 0.96, tag: 'Balanced with a great drift.' },
  { id: 'lulu', name: 'Lulu', species: 'Cat', cls: 'Medium', color: 0xb58cff, accent: 0xf4ecff, kart: 0x8a5cf0, stats: { speed: 3.5, accel: 3.75, weight: 3.0, handling: 4.0, traction: 3.5, mt: 3.75 }, size: 0.96, tag: 'Slippery, sneaky, stylish.' },
  { id: 'rocco', name: 'Rocco', species: 'Raccoon', cls: 'Medium', color: 0x9aa3ad, accent: 0x2b2f36, kart: 0x5b6470, stats: { speed: 3.75, accel: 3.5, weight: 3.25, handling: 3.75, traction: 3.5, mt: 3.25 }, size: 1.0, tag: 'All-rounder with a bit of muscle.' },
  { id: 'zap', name: 'Zap', species: 'Robot', cls: 'Cruiser', color: 0x4fd8ff, accent: 0xdfe8ff, kart: 0x1ea8d8, stats: { speed: 4.25, accel: 3.25, weight: 3.75, handling: 3.25, traction: 3.75, mt: 3.25 }, size: 1.06, tag: 'High top speed, sticky tires.' },
  { id: 'bruno', name: 'Bruno', species: 'Bear', cls: 'Heavy', color: 0x9c6a3c, accent: 0xe6c9a0, kart: 0x7a4a24, stats: { speed: 4.5, accel: 3.0, weight: 4.0, handling: 3.0, traction: 3.5, mt: 3.0 }, size: 1.14, tag: 'Bumps everyone out of the way.' },
  { id: 'gorb', name: 'Gorb', species: 'Ogre', cls: 'Colossal', color: 0x6c9c3a, accent: 0xd8f0a0, kart: 0x3c5c22, stats: { speed: 4.75, accel: 3.0, weight: 4.5, handling: 2.5, traction: 3.0, mt: 2.75 }, size: 1.24, tag: 'Slow to start, unstoppable at speed.' },
];

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...extra });

function mesh(geo, mat, x = 0, y = 0, z = 0, parent) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; if (parent) parent.add(m); return m; }

export function buildDriver(ch) {
  const g = new THREE.Group();
  const skin = std(ch.color), light = std(ch.accent), dark = std(0x222226), white = std(0xffffff);
  const eyeMat = std(0x111111, { roughness: 0.3 });
  // torso
  mesh(new THREE.CapsuleGeometry(0.28, 0.28, 4, 10), std(ch.kart), 0, 0.42, 0, g);
  // arms reaching the wheel
  for (const s of [-1, 1]) { const a = mesh(new THREE.CapsuleGeometry(0.09, 0.4, 3, 8), skin, s * 0.3, 0.5, 0.25, g); a.rotation.x = -1.1; a.rotation.z = s * 0.4; }
  // head
  const head = new THREE.Group(); head.position.y = 0.98; g.add(head);
  const headMesh = mesh(ch.id === 'zap' ? new THREE.BoxGeometry(0.5, 0.5, 0.5) : new THREE.SphereGeometry(0.32, 16, 14), skin, 0, 0, 0, head);
  // eyes
  for (const s of [-1, 1]) { mesh(new THREE.SphereGeometry(0.085, 10, 8), white, s * 0.12, 0.06, 0.26, head); mesh(new THREE.SphereGeometry(0.045, 8, 8), eyeMat, s * 0.12, 0.06, 0.33, head); }
  const ear = (geo, x, y, z, rz = 0, mat = skin) => { const e = mesh(geo, mat, x, y, z, head); e.rotation.z = rz; return e; };
  switch (ch.id) {
    case 'pip': ear(new THREE.SphereGeometry(0.17, 12, 10), -0.28, 0.28, 0); ear(new THREE.SphereGeometry(0.17, 12, 10), 0.28, 0.28, 0); ear(new THREE.SphereGeometry(0.1, 10, 8), -0.28, 0.28, 0.06, 0, light); ear(new THREE.SphereGeometry(0.1, 10, 8), 0.28, 0.28, 0.06, 0, light); mesh(new THREE.SphereGeometry(0.05, 8, 8), eyeMat, 0, -0.06, 0.32, head); break;
    case 'kiko': ear(new THREE.SphereGeometry(0.13, 12, 10), -0.17, 0.27, 0.1); ear(new THREE.SphereGeometry(0.13, 12, 10), 0.17, 0.27, 0.1); mesh(new THREE.BoxGeometry(0.34, 0.05, 0.1), dark, 0, -0.12, 0.3, head); break;
    case 'nova': ear(new THREE.ConeGeometry(0.11, 0.3, 8), -0.2, 0.34, 0, 0.3); ear(new THREE.ConeGeometry(0.11, 0.3, 8), 0.2, 0.34, 0, -0.3); mesh(new THREE.ConeGeometry(0.12, 0.28, 10), light, 0, -0.08, 0.36, head).rotation.x = Math.PI / 2; mesh(new THREE.SphereGeometry(0.05, 8, 8), eyeMat, 0, -0.06, 0.5, head); break;
    case 'lulu': ear(new THREE.ConeGeometry(0.1, 0.26, 4), -0.18, 0.34, 0, 0.25); ear(new THREE.ConeGeometry(0.1, 0.26, 4), 0.18, 0.34, 0, -0.25); mesh(new THREE.SphereGeometry(0.05, 8, 8), std(0xff8fb0), 0, -0.06, 0.32, head); break;
    case 'rocco': ear(new THREE.SphereGeometry(0.1, 10, 8), -0.24, 0.26, 0); ear(new THREE.SphereGeometry(0.1, 10, 8), 0.24, 0.26, 0); mesh(new THREE.BoxGeometry(0.5, 0.14, 0.12), dark, 0, 0.06, 0.24, head); mesh(new THREE.SphereGeometry(0.06, 8, 8), eyeMat, 0, -0.08, 0.32, head); break;
    case 'zap': mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), dark, 0, 0.38, 0, head); mesh(new THREE.SphereGeometry(0.06, 8, 8), std(0xff3040, { emissive: 0xff3040, emissiveIntensity: 1.5 }), 0, 0.54, 0, head); mesh(new THREE.BoxGeometry(0.3, 0.06, 0.06), std(0x40ffd0, { emissive: 0x40ffd0, emissiveIntensity: 1 }), 0, -0.12, 0.26, head); break;
    case 'bruno': ear(new THREE.SphereGeometry(0.11, 10, 8), -0.24, 0.26, 0); ear(new THREE.SphereGeometry(0.11, 10, 8), 0.24, 0.26, 0); mesh(new THREE.SphereGeometry(0.15, 10, 8), light, 0, -0.1, 0.28, head); mesh(new THREE.SphereGeometry(0.06, 8, 8), eyeMat, 0, -0.06, 0.4, head); break;
    case 'gorb': ear(new THREE.ConeGeometry(0.07, 0.28, 6), -0.22, 0.32, 0, 0.6, light); ear(new THREE.ConeGeometry(0.07, 0.28, 6), 0.22, 0.32, 0, -0.6, light); mesh(new THREE.BoxGeometry(0.4, 0.12, 0.2), light, 0, -0.2, 0.22, head); for (const s of [-1, 1]) mesh(new THREE.ConeGeometry(0.03, 0.1, 5), white, s * 0.12, -0.1, 0.3, head); break;
  }
  g.scale.setScalar(ch.size);
  return { group: g, head };
}

export function buildKart(ch) {
  const g = new THREE.Group();
  const paint = std(ch.kart, { roughness: 0.35, metalness: 0.3 });
  const chrome = std(0xd8dde4, { roughness: 0.25, metalness: 0.8 });
  const rubber = std(0x1a1a1e, { roughness: 0.9 });
  const body = new THREE.Group(); g.add(body);
  // chassis
  const ch1 = mesh(new THREE.BoxGeometry(1.4, 0.36, 2.2), paint, 0, 0.42, 0, body);
  mesh(new THREE.BoxGeometry(1.0, 0.28, 0.9), paint, 0, 0.56, 0.95, body); // nose
  mesh(new THREE.BoxGeometry(0.7, 0.2, 0.5), chrome, 0, 0.62, 1.2, body);
  mesh(new THREE.BoxGeometry(1.1, 0.5, 0.6), std(0x33363c), 0, 0.6, -0.95, body); // engine
  for (const s of [-1, 1]) { const ex = mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.5, 8), chrome, s * 0.35, 0.62, -1.35, body); ex.rotation.x = Math.PI / 2; }
  // seat + wheel
  mesh(new THREE.BoxGeometry(0.7, 0.5, 0.35), std(0x2a2a30), 0, 0.85, -0.45, body);
  const sw = mesh(new THREE.TorusGeometry(0.2, 0.04, 8, 16), std(0x333), 0, 0.95, 0.45, body); sw.rotation.x = -1.1;
  // spoiler for heavy classes
  if (ch.stats.weight >= 3.75) { mesh(new THREE.BoxGeometry(1.5, 0.06, 0.4), paint, 0, 0.98, -1.15, body); for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.06, 0.3, 0.3), paint, s * 0.6, 0.82, -1.15, body); }
  // number plate stripe
  mesh(new THREE.BoxGeometry(0.4, 0.02, 2.2), std(ch.accent), 0, 0.61, 0, body);
  // wheels
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.3, 14); wheelGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.32, 8); rimGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  const wp = [[-0.78, 0.34, 0.75], [0.78, 0.34, 0.75], [-0.78, 0.34, -0.75], [0.78, 0.34, -0.75]];
  for (const [x, y, z] of wp) { const pivot = new THREE.Group(); pivot.position.set(x, y, z); const w = mesh(wheelGeo, rubber, 0, 0, 0, pivot); mesh(rimGeo, chrome, 0, 0, 0, w); g.add(pivot); wheels.push({ pivot, mesh: w }); }
  // driver
  const driver = buildDriver(ch); driver.group.position.set(0, 0.55, -0.35); body.add(driver.group);
  // trail sparks anchors
  return { group: g, body, wheels, driver: driver.group, head: driver.head, chassis: ch1 };
}
