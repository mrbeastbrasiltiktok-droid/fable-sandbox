import * as THREE from 'three';
import { makeRng } from './utils.js';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, repeat = true, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
function noise(ctx, w, h, amount, rng) {
  const img = ctx.getImageData(0, 0, w, h); const d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (rng() - 0.5) * amount; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  ctx.putImageData(img, 0, 0);
}

// One facade tile = 3m x 3m world units (one window per tile, with a mullion pattern).
// Returns { map, emissiveMap } where emissiveMap holds only lit windows (for night).
export function makeFacade(style, seed) {
  const rng = makeRng(seed);
  const S = 256, cols = 4, rows = 4; // 4x4 windows per texture -> texture covers 12m x 12m
  const c = canvas(S, S), ctx = c.getContext('2d');
  const e = canvas(S, S), ectx = e.getContext('2d');
  ectx.fillStyle = '#000'; ectx.fillRect(0, 0, S, S);
  const cw = S / cols, ch = S / rows;
  const palettes = {
    glass:    { wall: ['#44556a', '#3c4d60', '#4d6076'], win: ['#7fa6c8', '#6d94b8', '#93b6d4'], frame: '#1a2430', wx: 0.06, wy: 0.06, ww: 0.88, wh: 0.88 },
    concrete: { wall: ['#8a8378', '#9a9388', '#7d776d'], win: ['#2b3440', '#22303d', '#334252'], frame: '#4a463f', wx: 0.22, wy: 0.24, ww: 0.56, wh: 0.5 },
    brick:    { wall: ['#7a4a3a', '#8a5545', '#6e4234'], win: ['#1f2a33', '#2a3540', '#1b252e'], frame: '#d8d0c0', wx: 0.25, wy: 0.2, ww: 0.5, wh: 0.55 },
    tower:    { wall: ['#c9cdd3', '#bcc1c8', '#d3d7dc'], win: ['#354a5e', '#2e4356', '#41576c'], frame: '#2a2f36', wx: 0.12, wy: 0.14, ww: 0.76, wh: 0.66 },
    house:    { wall: ['#d9c6a5', '#c8b08b', '#e2d3b8'], win: ['#243241', '#2c3c4c', '#1e2b38'], frame: '#f2efe8', wx: 0.3, wy: 0.28, ww: 0.4, wh: 0.44 },
    industrial:{ wall: ['#6d7378', '#767c81', '#62686d'], win: ['#3a4650', '#31404a', '#42505a'], frame: '#40464b', wx: 0.15, wy: 0.4, ww: 0.7, wh: 0.25 },
  };
  const p = palettes[style] || palettes.concrete;
  ctx.fillStyle = p.wall[0]; ctx.fillRect(0, 0, S, S);
  // subtle wall variation
  for (let i = 0; i < 400; i++) { ctx.fillStyle = rng.pick(p.wall); ctx.globalAlpha = 0.25; ctx.fillRect(rng() * S, rng() * S, rng() * 30, rng() * 8); }
  ctx.globalAlpha = 1;
  if (style === 'brick') { // brick courses
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
    for (let y = 0; y < S; y += 6) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y); ctx.stroke(); }
    for (let y = 0; y < S; y += 6) for (let x = (y / 6 % 2) * 8; x < S; x += 16) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 6); ctx.stroke(); }
  }
  if (style === 'glass' || style === 'tower') { // floor slabs
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let r = 0; r < rows; r++) ctx.fillRect(0, r * ch, S, 3);
  }
  for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
    const x = col * cw + p.wx * cw, y = r * ch + p.wy * ch, w = p.ww * cw, h = p.wh * ch;
    ctx.fillStyle = p.frame; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    const wc = rng.pick(p.win); g.addColorStop(0, wc); g.addColorStop(1, '#0d141b');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    // reflection streak
    ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(x + w * 0.1, y, w * 0.18, h);
    if (style !== 'glass') { ctx.fillStyle = p.frame; ctx.fillRect(x + w / 2 - 1, y, 2, h); ctx.fillRect(x, y + h / 2 - 1, w, 2); }
    // emissive: some windows lit at night with warm tint
    if (rng() < 0.45) {
      const warm = rng.pick(['#ffd9a0', '#ffe7c2', '#d8e6ff', '#fff2d6', '#ffcf80']);
      ectx.fillStyle = warm; ectx.globalAlpha = 0.35 + rng() * 0.45; ectx.fillRect(x, y, w, h); ectx.globalAlpha = 1;
      if (rng() < 0.4) { ectx.fillStyle = '#000'; ectx.globalAlpha = 0.6; ectx.fillRect(x + w / 2, y, w / 2, h); ectx.globalAlpha = 1; }
    }
  }
  noise(ctx, S, S, 18, rng);
  return { map: tex(c), emissiveMap: tex(e) };
}

export function makeRoof(seed) {
  const rng = makeRng(seed); const S = 128; const c = canvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = '#4b4a48'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 300; i++) { ctx.fillStyle = `rgba(${rng() < 0.5 ? 0 : 255},${rng() < 0.5 ? 0 : 255},${rng() < 0.5 ? 0 : 255},0.05)`; ctx.fillRect(rng() * S, rng() * S, rng() * 12, rng() * 12); }
  noise(ctx, S, S, 24, rng);
  return tex(c);
}

// Asphalt tile: 1 texture = ASPHALT width x 14m length, with 4 lanes (2 each way), dashed white dividers, double yellow centre.
export function makeRoadTexture(seed = 7) {
  const rng = makeRng(seed); const W = 512, H = 512; const c = canvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#2d2f33'; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 6000; i++) { ctx.fillStyle = `rgba(${rng() < 0.5 ? 0 : 255},${rng() < 0.5 ? 0 : 255},${rng() < 0.5 ? 0 : 255},0.06)`; ctx.fillRect(rng() * W, rng() * H, 2, 2); }
  // lanes across X (width 14m => 512px, 1m = 36.57px). Texture v runs along road length (14m).
  const px = W / 14;
  // centre double yellow
  ctx.fillStyle = '#d6b23a'; ctx.fillRect(W / 2 - px * 0.25, 0, px * 0.12, H); ctx.fillRect(W / 2 + px * 0.13, 0, px * 0.12, H);
  // dashed white between lanes at x = 3.5 and 10.5
  ctx.fillStyle = '#d9d9d2';
  for (const lx of [3.5, 10.5]) for (let y = 0; y < H; y += H / 2) ctx.fillRect(lx * px - px * 0.06, y + H * 0.1, px * 0.12, H * 0.28);
  // edge lines
  ctx.fillStyle = 'rgba(230,230,220,0.8)'; ctx.fillRect(px * 0.2, 0, px * 0.1, H); ctx.fillRect(W - px * 0.3, 0, px * 0.1, H);
  // wear streaks in wheel tracks
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (const lx of [1.1, 2.5, 4.6, 6.0, 8.0, 9.4, 11.5, 12.9]) ctx.fillRect(lx * px - px * 0.25, 0, px * 0.5, H);
  noise(ctx, W, H, 14, rng);
  return tex(c);
}

export function makeIntersectionTexture(seed = 8) {
  const rng = makeRng(seed); const S = 256; const c = canvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = '#2d2f33'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 2500; i++) { ctx.fillStyle = `rgba(${rng() < 0.5 ? 0 : 255},${rng() < 0.5 ? 0 : 255},${rng() < 0.5 ? 0 : 255},0.06)`; ctx.fillRect(rng() * S, rng() * S, 2, 2); }
  noise(ctx, S, S, 14, rng);
  return tex(c);
}

export function makeCrosswalkTexture() {
  const S = 256; const c = canvas(S, S), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(235,235,225,0.85)';
  for (let x = 8; x < S; x += 32) ctx.fillRect(x, 0, 18, S);
  const t = tex(c, false); return t;
}

export function makeSidewalkTexture(seed = 9) {
  const rng = makeRng(seed); const S = 256; const c = canvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = '#a8a49c'; ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 3;
  for (let i = 0; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * S / 2, 0); ctx.lineTo(i * S / 2, S); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * S / 2); ctx.lineTo(S, i * S / 2); ctx.stroke(); }
  for (let i = 0; i < 2000; i++) { ctx.fillStyle = `rgba(0,0,0,${rng() * 0.08})`; ctx.fillRect(rng() * S, rng() * S, 2, 2); }
  noise(ctx, S, S, 16, rng);
  return tex(c);
}

export function makeGrassTexture(seed = 10) {
  const rng = makeRng(seed); const S = 256; const c = canvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = '#4f7a34'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 6000; i++) { ctx.fillStyle = rng.pick(['#5c8a3c', '#476e2e', '#67963f', '#3f6529']); ctx.fillRect(rng() * S, rng() * S, 2 + rng() * 3, 1 + rng() * 2); }
  noise(ctx, S, S, 12, rng);
  return tex(c);
}

export function makeSandTexture(seed = 11) {
  const rng = makeRng(seed); const S = 256; const c = canvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = '#d9c48f'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 4000; i++) { ctx.fillStyle = rng.pick(['#e3d2a3', '#cdb47c', '#e8dab0']); ctx.fillRect(rng() * S, rng() * S, 2, 2); }
  noise(ctx, S, S, 10, rng);
  return tex(c);
}

export function makeParticleTexture() {
  const S = 64; const c = canvas(S, S), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return tex(c, false, false);
}

export function makeSmokeTexture() {
  const S = 64; const c = canvas(S, S), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.5, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return tex(c, false, false);
}
