import * as THREE from 'three';
import { Game } from './game.js';
import { MobileControls } from './mobile.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;

const overlay = document.getElementById('overlay'); const overlayTitle = document.getElementById('overlay-title'); const overlaySub = document.getElementById('overlay-sub');
const game = new Game(renderer, canvas); window.game = game;
const mobile = new MobileControls(game, { onPause: () => pauseGame() }); game.mobile = mobile;
// Debug harness (?debug): step the simulation deterministically from the console, e.g. step(60, ['KeyW']).
window.step = (n, keys = [], mouse = {}) => { for (let i = 0; i < n; i++) { for (const k of keys) { game.input.keys.add(k); if (i === 0) game.input.pressed.add(k); } Object.assign(game.input.mouse, mouse); game.update(1 / 60); } game.input.keys.clear(); game.render(); };
game.resize();

let started = false;
const DEBUG = location.search.includes('debug');
function play() {
  game.audio.init(); game.audio.resume();
  if (DEBUG || mobile.touchMode) { game.input.locked = true; game.input.onLockChange(true); mobile.sync(true); return; }
  game.input.lock();
}
function pauseGame() {
  if (!started) return;
  game.paused = true; game.input.keys.clear(); game.input.moveTouch = false; game.input.move.x = game.input.move.y = 0; game.input.mouse.left = game.input.mouse.right = false;
  overlay.style.display = 'flex'; overlayTitle.textContent = 'PAUSED'; overlaySub.textContent = mobile.touchMode ? 'Tap to resume' : 'Click to resume';
  mobile.sync(false);
}
overlay.addEventListener('click', play);
game.input.onLockChange = (locked) => {
  game.paused = !locked; overlay.style.display = locked ? 'none' : 'flex';
  if (!locked) { overlayTitle.textContent = started ? 'PAUSED' : 'FABLE CITY'; overlaySub.textContent = (mobile.touchMode ? 'Tap to ' : 'Click to ') + (started ? 'resume' : 'play'); }
  if (locked) { started = true; game.audio.resume(); }
  mobile.sync(locked && !game.hud.mapOpen);
};
if (mobile.touchMode) { overlaySub.textContent = 'Tap to play'; }
window.addEventListener('orientationchange', () => setTimeout(() => mobile.sync(started && !game.paused), 200));

let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!game.paused) game.update(dt);
  else { game.env.update(game.dayFrac, new THREE.Vector3(game.player.x, 0, game.player.z)); }
  mobile.sync(started && !game.paused && !game.hud.mapOpen);
  game.render();
}
requestAnimationFrame(loop);
