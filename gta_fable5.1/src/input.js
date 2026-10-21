import { KEYS } from './config.js';

export class Input {
  constructor(canvas) {
    this.keys = new Set(); this.pressed = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false, wheel: 0 };
    this.locked = false; this.canvas = canvas;
    window.addEventListener('keydown', (e) => { if (e.repeat) return; this.keys.add(e.code); this.pressed.add(e.code); if (['Space', 'Tab', 'F1'].includes(e.code)) e.preventDefault(); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    document.addEventListener('mousemove', (e) => { if (!this.locked) return; this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; });
    document.addEventListener('mousedown', (e) => { if (!this.locked) return; if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; } if (e.button === 2) this.mouse.right = true; });
    document.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.left = false; if (e.button === 2) this.mouse.right = false; });
    document.addEventListener('wheel', (e) => { if (this.locked) this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; this.onLockChange?.(this.locked); });
  }
  lock() { this.canvas.requestPointerLock?.(); }
  down(action) { return KEYS[action].some(k => this.keys.has(k)); }
  hit(action) { return KEYS[action].some(k => this.pressed.has(k)); }
  hitCode(code) { return this.pressed.has(code); }
  axis(neg, pos) { return (this.down(pos) ? 1 : 0) - (this.down(neg) ? 1 : 0); }
  endFrame() { this.pressed.clear(); this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.leftPressed = false; this.mouse.wheel = 0; }
}
