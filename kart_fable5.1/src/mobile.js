export function isTouchDevice() {
  return (typeof matchMedia === 'function' && (matchMedia('(pointer: coarse)').matches || (matchMedia('(hover: none)').matches && (navigator.maxTouchPoints || 0) > 0)))
    || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || new URLSearchParams(location.search).has('touch');
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

class Joystick {
  constructor(input, pad, knob) {
    this.input = input; this.pad = pad; this.knob = knob; this.id = null;
    pad.addEventListener('pointerdown', (e) => this.start(e));
    pad.addEventListener('pointermove', (e) => this.move(e));
    pad.addEventListener('pointerup', (e) => this.end(e));
    pad.addEventListener('pointercancel', (e) => this.end(e));
    pad.addEventListener('lostpointercapture', (e) => this.end(e));
  }
  start(e) {
    e.preventDefault(); e.stopPropagation();
    this.id = e.pointerId; this.pad.setPointerCapture(e.pointerId); this.move(e);
  }
  move(e) {
    if (this.id !== e.pointerId) return;
    e.preventDefault();
    const r = this.pad.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const radius = r.width * 0.38;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const len = Math.hypot(dx, dy); if (len > radius) { dx *= radius / len; dy *= radius / len; }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    let x = dx / radius, y = -dy / radius;
    if (Math.abs(x) < 0.14) x = 0;
    if (Math.abs(y) < 0.18) y = 0;
    this.input.touchSteer = clamp(x, -1, 1);
    this.input.touchThrottle = clamp(y, -1, 1);
  }
  end(e) {
    if (this.id !== e.pointerId) return;
    this.id = null; this.knob.style.transform = 'translate(0px, 0px)';
    this.input.touchSteer = 0; this.input.touchThrottle = 0;
  }
}

export class MobileControls {
  constructor(app) {
    this.app = app; this.input = app.input;
    this.touchMode = isTouchDevice();
    this.enabled = this.touchMode || innerWidth <= 900;
    if (!this.enabled) return;
    if (this.touchMode) document.body.classList.add('touch-device');
    this.build();
    this.joy = new Joystick(this.input, this.root.querySelector('.mc-stick'), this.root.querySelector('.mc-knob'));
    this.bind();
  }

  build() {
    const root = this.root = document.createElement('div');
    root.id = 'mobile-controls'; root.className = 'mc-root hidden';
    root.innerHTML = `
      <div class="mc-stick"><div class="mc-ring"></div><div class="mc-knob"></div></div>
      <div class="mc-pause">
        <button class="mc-mini" data-pause="1" aria-label="Pause">II</button>
        <button class="mc-mini" data-key="KeyR" aria-label="Rear view">REAR</button>
      </div>
      <div class="mc-actions">
        <button class="mc-pedal mc-gas" data-key="ArrowUp">GAS</button>
        <button class="mc-pedal mc-brake" data-key="ArrowDown">BRAKE</button>
        <button class="mc-btn" data-key="Space">DRIFT</button>
        <button class="mc-btn" data-key="KeyX">ITEM</button>
      </div>`;
    document.body.appendChild(root);
  }

  bind() {
    const down = (el) => { if (el.dataset.key) this.input.setVirtual(el.dataset.key, true); };
    const up = (el) => { if (el.dataset.key) this.input.setVirtual(el.dataset.key, false); };
    this.root.querySelectorAll('[data-key]').forEach((el) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId); el.classList.add('down'); down(el);
      });
      const release = (e) => { e.preventDefault(); el.classList.remove('down'); up(el); };
      el.addEventListener('pointerup', release); el.addEventListener('pointercancel', release); el.addEventListener('lostpointercapture', release);
    });
    this.root.querySelectorAll('[data-pause]').forEach((el) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation(); this.input.pressVirtual('Escape');
      });
    });
    addEventListener('blur', () => { this.input.touchSteer = 0; this.input.touchThrottle = 0; });
  }

  sync() {
    if (!this.enabled) return;
    const app = this.app;
    const active = !!app.race && !app.paused && !app.menu.screen && app.race.state !== 'results';
    this.root.classList.toggle('hidden', !active);
  }
}
