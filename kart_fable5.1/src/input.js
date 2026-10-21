export class Input {
  constructor() {
    this.keys = new Set(); this.pressed = new Set();
    this.override = null; // for debug harness
    window.addEventListener('keydown', (e) => { if (e.repeat) return; this.keys.add(e.code); this.pressed.add(e.code); if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault(); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.gp = null;
    this.prevGp = {};
    this.mouseL = false; this.mouseLPressed = false; this.mouseRPressed = false;
    window.addEventListener('pointerdown', (e) => { if (e.target.closest && e.target.closest('.menu')) return; if (e.button === 0) { this.mouseL = true; this.mouseLPressed = true; } if (e.button === 2) this.mouseRPressed = true; });
    window.addEventListener('pointerup', (e) => { if (e.button === 0) this.mouseL = false; });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  has(...codes) { return codes.some((c) => this.keys.has(c)); }
  hit(...codes) { return codes.some((c) => this.pressed.has(c)); }
  /** Returns a normalized control state for this frame. Call endFrame() after use. */
  poll() {
    if (this.override) return { ...this.override, _pressedNames: [] };
    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = Array.from(gps || []).find((g) => g && g.connected);
    let steer = (this.has('ArrowRight', 'KeyD') ? 1 : 0) - (this.has('ArrowLeft', 'KeyA') ? 1 : 0);
    let throttle = this.has('ArrowUp', 'KeyW') ? 1 : 0;
    let brake = this.has('ArrowDown', 'KeyS') ? 1 : 0;
    let hop = this.has('Space', 'ShiftLeft', 'ShiftRight');
    let hopPressed = this.hit('Space', 'ShiftLeft', 'ShiftRight');
    let itemHeld = this.has('ControlLeft', 'ControlRight', 'KeyE', 'Enter', 'KeyX') || this.mouseL;
    let itemPressed = this.hit('ControlLeft', 'ControlRight', 'KeyE', 'Enter', 'KeyX') || this.mouseLPressed;
    const itemBack = this.mouseRPressed || this.hit('KeyC');
    let rear = this.has('KeyR', 'KeyQ');
    let pause = this.hit('Escape', 'KeyP');
    let confirm = this.hit('Enter', 'Space', 'KeyE');
    let back = this.hit('Escape', 'Backspace');
    let up = this.hit('ArrowUp', 'KeyW'), down = this.hit('ArrowDown', 'KeyS'), left = this.hit('ArrowLeft', 'KeyA'), right = this.hit('ArrowRight', 'KeyD');
    if (gp) {
      const ax = gp.axes[0] || 0; if (Math.abs(ax) > 0.15) steer = Math.max(-1, Math.min(1, ax));
      const b = (i) => gp.buttons[i] && gp.buttons[i].pressed;
      const edge = (name, v) => { const was = this.prevGp[name]; this.prevGp[name] = v; return v && !was; };
      if (b(0) || b(7)) throttle = 1; if (b(6)) brake = 1;
      const h = b(1) || b(5) || b(4); if (h) hop = true; if (edge('hop', h)) hopPressed = true;
      const it = b(2) || b(3); if (it) itemHeld = true; if (edge('item', it)) itemPressed = true;
      if (b(12) || (gp.axes[1] || 0) < -0.5) { up = up || edge('up', true); throttle = 1; } else this.prevGp.up = false;
      if (b(13) || (gp.axes[1] || 0) > 0.5) { down = down || edge('down', true); brake = 1; } else this.prevGp.down = false;
      if (b(14) || ax < -0.5) left = left || edge('left', true); else this.prevGp.left = false;
      if (b(15) || ax > 0.5) right = right || edge('right', true); else this.prevGp.right = false;
      if (edge('confirm', b(0))) confirm = true; if (edge('back', b(1))) back = true; if (edge('pause', b(9))) pause = true;
      if (b(8)) rear = true;
    }
    return { steer, throttle, brake, hop, hopPressed, itemHeld, itemPressed, itemBack, rear, pause, confirm, back, up, down, left, right };
  }
  endFrame() { this.pressed.clear(); this.mouseLPressed = false; this.mouseRPressed = false; }
}
