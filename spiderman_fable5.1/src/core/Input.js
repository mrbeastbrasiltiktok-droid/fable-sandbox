// Keyboard + mouse with pointer lock (+ gamepad translated onto the same codes). Exposes held keys, one-frame presses and mouse deltas.
const GP_BUTTONS = { 0: 'Space', 1: 'KeyQ', 2: 'MouseLeft', 3: 'KeyE', 4: 'KeyR', 5: 'KeyF', 6: 'ShiftLeft', 7: 'MouseRight', 8: 'Tab', 10: 'KeyT', 11: 'KeyV', 12: 'KeyG', 13: 'KeyH', 14: 'Digit1', 15: 'KeyC' };
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();   // cleared each frame
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false, rightPressed: false, wheel: 0 };
    this.locked = false;
    this.enabled = false;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.code;
      this.keys.add(k);
      this.pressed.add(k);
      if (['Space', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });

    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked) { this._requestLock(); return; }
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; this._kbLeft = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightPressed = true; this._kbRight = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.mouse.left = false; this._kbLeft = false; }
      if (e.button === 2) { this.mouse.right = false; this._kbRight = false; }
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    window.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.keys.clear(); this.mouse.left = this.mouse.right = false; this.onUnlock?.(); }
    });
  }

  /** Poll the first connected gamepad and translate it into the same key/mouse events (standard mapping). */
  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find((p) => p && p.connected);
    this.gp = null;
    if (!gp) { if (this._gpPrev) { for (const c of Object.values(GP_BUTTONS)) this.keys.delete(c); this._gpPrev = null; this.gpMove = null; } return; }
    this.gp = gp;
    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
    this.gpMove = { x: dz(gp.axes[0] || 0), y: dz(gp.axes[1] || 0) };
    this.mouse.dx += dz(gp.axes[2] || 0) * 22; this.mouse.dy += dz(gp.axes[3] || 0) * 18;
    const prev = this._gpPrev || {};
    const now = {};
    gp.buttons.forEach((b, i) => {
      const down = b.pressed || b.value > 0.5; now[i] = down;
      const code = GP_BUTTONS[i]; if (!code) return;
      if (code === 'MouseLeft' || code === 'MouseRight') {
        const k = code === 'MouseLeft' ? 'left' : 'right';
        if (down && !prev[i]) this.mouse[k + 'Pressed'] = true;
        this.mouse[k] = down || (k === 'left' ? this._kbLeft : this._kbRight) || false;
        return;
      }
      if (down && !prev[i]) { this.keys.add(code); this.pressed.add(code); }
      else if (!down && prev[i]) this.keys.delete(code);
    });
    this._gpPrev = now;
  }

  lock() { this.enabled = true; this._requestLock(); }
  _requestLock() { try { const p = this.canvas.requestPointerLock?.(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* not available (iframe / background) */ } }
  unlock() { document.exitPointerLock?.(); }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }
  /** One-shot press that is consumed (safe to poll from multiple physics substeps). */
  take(code) { const h = this.pressed.has(code); if (h) this.pressed.delete(code); return h; }
  takeMouse(btn) { const k = btn + 'Pressed'; const h = this.mouse[k]; this.mouse[k] = false; return h; }
  axis(neg, pos) {
    const kb = (this.down(pos) ? 1 : 0) - (this.down(neg) ? 1 : 0);
    if (kb !== 0 || !this.gpMove) return kb;
    if (neg === 'KeyA') return this.gpMove.x;         // stick x → right positive
    if (neg === 'KeyS') return -this.gpMove.y;        // stick y → forward positive
    return 0;
  }

  endFrame() {
    this.pressed.clear();
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
    this.mouse.leftPressed = false; this.mouse.rightPressed = false;
  }
}
