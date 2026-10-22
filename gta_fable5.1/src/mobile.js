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
    const dead = 0.14;
    let x = dx / radius, y = -dy / radius;
    if (Math.hypot(x, y) < dead) { x = 0; y = 0; }
    this.input.move.x = x; this.input.move.y = y; this.input.moveTouch = x !== 0 || y !== 0;
  }
  end(e) {
    if (this.id !== e.pointerId) return;
    this.id = null; this.knob.style.transform = 'translate(0px, 0px)';
    this.input.move.x = 0; this.input.move.y = 0; this.input.moveTouch = false;
  }
}

export class MobileControls {
  constructor(game, opts = {}) {
    this.game = game; this.input = game.input; this.onPause = opts.onPause || (() => {});
    this.touchMode = isTouchDevice();
    this.enabled = this.touchMode || innerWidth <= 700;
    if (!this.enabled) return;
    if (this.touchMode) document.body.classList.add('touch-device');
    this.build();
    this.joy = new Joystick(this.input, this.root.querySelector('.mc-stick'), this.root.querySelector('.mc-knob'));
    this.bindLook();
    this.bindButtons();
    addEventListener('resize', () => this.input.endFrame());
  }

  build() {
    const root = this.root = document.createElement('div');
    root.id = 'mobile-controls'; root.className = 'mc-root';
    root.innerHTML = `
      <div class="mc-look" aria-hidden="true"></div>
      <div class="mc-stick"><div class="mc-ring"></div><div class="mc-knob"></div></div>
      <div class="mc-pause">
        <button class="mc-mini" data-pause="1" aria-label="Pause">II</button>
        <button class="mc-mini" data-key="KeyM" aria-label="Map">MAP</button>
        <button class="mc-mini" data-key="F1" aria-label="Help">?</button>
        <button class="mc-mini" data-key="KeyQ" aria-label="Next weapon">WPN</button>
        <button class="mc-mini" data-more="1" aria-label="More actions">MORE</button>
      </div>
      <div class="mc-actions">
        <button class="mc-btn mc-fire" data-mouse="left">FIRE</button>
        <button class="mc-btn mc-aim" data-aim="1">AIM</button>
        <button class="mc-btn" data-key="Space">JUMP</button>
        <button class="mc-btn" data-key="ShiftLeft">RUN</button>
        <button class="mc-btn" data-key="KeyF">CAR</button>
        <button class="mc-btn" data-key="KeyE">USE</button>
        <button class="mc-btn mc-extra" data-key="KeyH">HORN</button>
        <button class="mc-btn mc-extra" data-key="KeyR">RADIO</button>
        <button class="mc-btn mc-extra" data-key="KeyT">TIME</button>
      </div>`;
    document.body.appendChild(root);
    this.fireBtn = root.querySelector('.mc-fire');
    this.aimBtn = root.querySelector('.mc-aim');
  }

  bindLook() {
    const pad = this.root.querySelector('.mc-look'); let id = null, lastX = 0, lastY = 0;
    const end = (e) => { if (id === e.pointerId) { id = null; pad.classList.remove('active'); } };
    pad.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      e.preventDefault(); id = e.pointerId; lastX = e.clientX; lastY = e.clientY;
      pad.setPointerCapture(e.pointerId); pad.classList.add('active');
    });
    pad.addEventListener('pointermove', (e) => {
      if (id !== e.pointerId) return;
      e.preventDefault();
      this.input.mouse.dx += (e.clientX - lastX) * 1.5;
      this.input.mouse.dy += (e.clientY - lastY) * 1.5;
      lastX = e.clientX; lastY = e.clientY;
    });
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    pad.addEventListener('lostpointercapture', end);
  }

  bindButtons() {
    const press = (el) => { if (el.dataset.key) this.input.setVirtual(el.dataset.key, true); };
    const release = (el) => { if (el.dataset.key) this.input.setVirtual(el.dataset.key, false); };
    this.root.querySelectorAll('[data-key]').forEach((el) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId); el.classList.add('down'); press(el);
      });
      const up = (e) => { e.preventDefault(); el.classList.remove('down'); release(el); };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
    });
    this.root.querySelectorAll('[data-mouse]').forEach((el) => {
      const btn = el.dataset.mouse;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId); el.classList.add('down');
        this.input.mouse[btn] = true; this.input.mouse[btn + 'Pressed'] = true;
      });
      const up = (e) => { e.preventDefault(); el.classList.remove('down'); this.input.mouse[btn] = false; };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
    });
    this.aimBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.input.mouse.right = !this.input.mouse.right;
      if (this.input.mouse.right) this.input.mouse.rightPressed = true;
      this.aimBtn.classList.toggle('on', this.input.mouse.right);
    });
    this.root.querySelector('[data-pause]').addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation(); this.onPause();
    });
    this.root.querySelector('[data-more]').addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation(); this.root.classList.toggle('more');
    });
  }

  show(on) { if (this.enabled) this.root.classList.toggle('hidden', !on); }
  sync(active) { this.show(active); }
}
