import * as THREE from 'three';
import { mulberry32 } from './utils.js';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function noiseFill(ctx, w, h, base, variance, seed = 1, density = 1) {
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  const r = mulberry32(seed);
  const img = ctx.getImageData(0, 0, w, h); const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (r() > density) continue;
    const n = (r() - 0.5) * variance * 2;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

function finish(c, repeatX = 1, repeatY = 1, aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeatX, repeatY);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  return t;
}

const cache = {};
export function tex(name) { if (!cache[name]) cache[name] = builders[name](); return cache[name]; }

const builders = {
  asphalt() {
    const c = canvas(256, 256), ctx = c.getContext('2d');
    noiseFill(ctx, 256, 256, '#3a3d44', 14, 3);
    // subtle cracks
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1;
    const r = mulberry32(9);
    for (let i = 0; i < 12; i++) { ctx.beginPath(); let x = r() * 256, y = r() * 256; ctx.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; ctx.lineTo(x, y); } ctx.stroke(); }
    return finish(c, 1, 1);
  },
  asphaltNeon() {
    const c = canvas(256, 256), ctx = c.getContext('2d');
    noiseFill(ctx, 256, 256, '#1d1f2e', 10, 5);
    ctx.strokeStyle = 'rgba(80,220,255,0.35)'; ctx.lineWidth = 2;
    for (let i = 0; i <= 256; i += 64) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke(); }
    return finish(c, 1, 1);
  },
  rainbow() {
    const c = canvas(64, 256), ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 64, 0);
    const cols = ['#ff3b3b', '#ff9f1a', '#ffe81a', '#3bff5a', '#1ad8ff', '#5a5aff', '#e03bff', '#ff3b3b'];
    cols.forEach((col, i) => g.addColorStop(i / (cols.length - 1), col));
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 256);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (let y = 0; y < 256; y += 32) ctx.fillRect(0, y, 64, 2);
    return finish(c, 1, 1);
  },
  lavaRock() {
    const c = canvas(256, 256), ctx = c.getContext('2d');
    noiseFill(ctx, 256, 256, '#3b2b2b', 18, 11);
    ctx.strokeStyle = 'rgba(255,90,20,0.55)'; ctx.lineWidth = 2;
    const r = mulberry32(21);
    for (let i = 0; i < 8; i++) { ctx.beginPath(); let x = r() * 256, y = r() * 256; ctx.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 50; y += (r() - 0.5) * 50; ctx.lineTo(x, y); } ctx.stroke(); }
    return finish(c, 1, 1);
  },
  curb() {
    const c = canvas(64, 64), ctx = c.getContext('2d');
    ctx.fillStyle = '#e8ecef'; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#d8232a'; ctx.fillRect(0, 0, 32, 64);
    return finish(c, 1, 1);
  },
  curbBlue() {
    const c = canvas(64, 64), ctx = c.getContext('2d');
    ctx.fillStyle = '#e8ecef'; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#2a6be0'; ctx.fillRect(0, 0, 32, 64);
    return finish(c, 1, 1);
  },
  grass() {
    const c = canvas(256, 256), ctx = c.getContext('2d');
    noiseFill(ctx, 256, 256, '#5aa83c', 16, 7);
    const r = mulberry32(31); ctx.fillStyle = 'rgba(40,110,30,0.5)';
    for (let i = 0; i < 400; i++) ctx.fillRect(r() * 256, r() * 256, 2, 4);
    return finish(c, 1, 1);
  },
  sand() {
    const c = canvas(256, 256), ctx = c.getContext('2d');
    noiseFill(ctx, 256, 256, '#d9b46f', 14, 13);
    return finish(c, 1, 1);
  },
  snow() {
    const c = canvas(256, 256), ctx = c.getContext('2d');
    noiseFill(ctx, 256, 256, '#eef3fa', 8, 17);
    return finish(c, 1, 1);
  },
  ice() {
    const c = canvas(256, 256), ctx = c.getContext('2d');
    noiseFill(ctx, 256, 256, '#bfe6f7', 6, 19);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
    const r = mulberry32(23);
    for (let i = 0; i < 10; i++) { ctx.beginPath(); let x = r() * 256, y = r() * 256; ctx.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 70; y += (r() - 0.5) * 70; ctx.lineTo(x, y); } ctx.stroke(); }
    return finish(c, 1, 1);
  },
  dirt() {
    const c = canvas(256, 256), ctx = c.getContext('2d');
    noiseFill(ctx, 256, 256, '#8a6b45', 16, 29);
    return finish(c, 1, 1);
  },
  stone() {
    const c = canvas(256, 256), ctx = c.getContext('2d');
    noiseFill(ctx, 256, 256, '#cfc9bc', 9, 53);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 3;
    for (let i = 0; i <= 256; i += 64) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke(); }
    return finish(c, 1, 1);
  },
  concrete() {
    const c = canvas(256, 256), ctx = c.getContext('2d');
    noiseFill(ctx, 256, 256, '#6d7078', 10, 37);
    return finish(c, 1, 1);
  },
  boostPad() {
    const c = canvas(64, 128), ctx = c.getContext('2d');
    ctx.fillStyle = '#ff8a00'; ctx.fillRect(0, 0, 64, 128);
    ctx.fillStyle = '#fff2a8';
    for (let y = 0; y < 128; y += 32) { ctx.beginPath(); ctx.moveTo(8, y + 28); ctx.lineTo(32, y + 8); ctx.lineTo(56, y + 28); ctx.lineTo(56, y + 20); ctx.lineTo(32, y); ctx.lineTo(8, y + 20); ctx.closePath(); ctx.fill(); }
    return finish(c, 1, 1);
  },
  checker() {
    const c = canvas(64, 64), ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 64, 64); ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, 32, 32); ctx.fillRect(32, 32, 32, 32);
    return finish(c, 1, 1);
  },
  window() {
    const c = canvas(64, 64), ctx = c.getContext('2d');
    ctx.fillStyle = '#1a1c28'; ctx.fillRect(0, 0, 64, 64);
    const r = mulberry32(41);
    for (let y = 4; y < 64; y += 16) for (let x = 4; x < 64; x += 16) { const on = r() > 0.35; ctx.fillStyle = on ? (r() > 0.5 ? '#ffe89a' : '#9ad6ff') : '#2a2d3d'; ctx.fillRect(x, y, 8, 10); }
    return finish(c, 1, 1);
  },
  windowEmissive() {
    const c = canvas(64, 64), ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 64, 64);
    const r = mulberry32(41);
    for (let y = 4; y < 64; y += 16) for (let x = 4; x < 64; x += 16) { const on = r() > 0.35; ctx.fillStyle = on ? (r() > 0.5 ? '#ffe89a' : '#9ad6ff') : '#000'; ctx.fillRect(x, y, 8, 10); }
    return finish(c, 1, 1);
  },
  stars() {
    const c = canvas(1024, 512), ctx = c.getContext('2d');
    ctx.fillStyle = '#05030f'; ctx.fillRect(0, 0, 1024, 512);
    const r = mulberry32(77);
    for (let i = 0; i < 1400; i++) { const s = r() * 1.8 + 0.3; ctx.fillStyle = `rgba(${200 + r() * 55},${200 + r() * 55},255,${0.4 + r() * 0.6})`; ctx.fillRect(r() * 1024, r() * 512, s, s); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  },
};
