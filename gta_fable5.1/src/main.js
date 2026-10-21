import * as THREE from 'three';
import { Game } from './game.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;

const overlay = document.getElementById('overlay'); const overlayTitle = document.getElementById('overlay-title'); const overlaySub = document.getElementById('overlay-sub');
const game = new Game(renderer, canvas); window.game = game;
// Debug harness (?debug): step the simulation deterministically from the console, e.g. step(60, ['KeyW']).
window.step = (n, keys = [], mouse = {}) => { for (let i = 0; i < n; i++) { for (const k of keys) { game.input.keys.add(k); if (i === 0) game.input.pressed.add(k); } Object.assign(game.input.mouse, mouse); game.update(1 / 60); } game.input.keys.clear(); game.render(); };
game.resize();

let started = false;
const DEBUG = location.search.includes('debug');
function play() {
  game.audio.init(); game.audio.resume();
  if (DEBUG) { game.input.locked = true; game.input.onLockChange(true); return; }
  game.input.lock();
}
overlay.addEventListener('click', play);
game.input.onLockChange = (locked) => {
  game.paused = !locked; overlay.style.display = locked ? 'none' : 'flex';
  if (!locked) { overlayTitle.textContent = started ? 'PAUSED' : 'FABLE CITY'; overlaySub.textContent = 'Click to ' + (started ? 'resume' : 'play'); }
  if (locked) { started = true; game.audio.resume(); }
};

let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!game.paused) game.update(dt);
  else { game.env.update(game.dayFrac, new THREE.Vector3(game.player.x, 0, game.player.z)); }
  game.render();
}
requestAnimationFrame(loop);
