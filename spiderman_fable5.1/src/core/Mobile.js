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
    if (Math.hypot(x, y) < 0.14) { x = 0; y = 0; }
    this.input.move.x = clamp(x, -1, 1); this.input.move.y = clamp(y, -1, 1); this.input.moveTouch = x !== 0 || y !== 0;
  }
  end(e) {
    if (this.id !== e.pointerId) return;
    this.id = null; this.knob.style.transform = 'translate(0px, 0px)';
    this.input.move.x = 0; this.input.move.y = 0; this.input.moveTouch = false;
  }
}

export class MobileControls {
  constructor(game) {
    this.game = game; this.input = game.input;
    this.touchMode = isTouchDevice();
    this.enabled = this.touchMode || innerWidth <= 900;
    if (!this.enabled) return;
    if (this.touchMode) document.body.classList.add('touch-device');
    this.build();
    this.joy = new Joystick(this.input, this.root.querySelector('.mc-stick'), this.root.querySelector('.mc-knob'));
    this.bindLook();
    this.bind();
  }

  build() {
    const root = this.root = document.createElement('div');
    root.id = 'mobile-controls'; root.className = 'mc-root hidden';
    root.innerHTML = `
      <div class="mc-look" aria-hidden="true"></div>
      <div class="mc-stick"><div class="mc-ring"></div><div class="mc-knob"></div></div>
      <div class="mc-pause">
        <button class="mc-mini" data-pause="1" aria-label="Pause">II</button>
        <button class="mc-mini" data-more="1" aria-label="More actions">MORE</button>
        <button class="mc-mini" data-key="KeyC" aria-label="Controls">?</button>
        <button class="mc-mini" data-key="Tab" aria-label="Track">TRACK</button>
      </div>
      <div class="mc-actions">
        <button class="mc-btn mc-swing" data-mouse="right">SWING</button>
        <button class="mc-btn mc-attack" data-mouse="left">ATK</button>
        <button class="mc-btn" data-key="Space">JUMP</button>
        <button class="mc-btn" data-key="KeyE">ZIP</button>
        <button class="mc-btn" data-key="KeyQ">DODGE</button>
        <button class="mc-btn" data-key="ShiftLeft">RUN</button>
        <button class="mc-btn mc-extra" data-key="KeyF">STRIKE</button>
        <button class="mc-btn mc-extra" data-key="KeyR">WEB</button>
        <button class="mc-btn mc-extra" data-key="KeyT">THROW</button>
        <button class="mc-btn mc-extra" data-key="KeyV">YANK</button>
        <button class="mc-btn mc-extra" data-key="KeyG">FIN</button>
        <button class="mc-btn mc-extra" data-key="KeyH">HEAL</button>
        <button class="mc-btn mc-extra" data-key="Digit1">BOMB</button>
        <button class="mc-btn mc-extra" data-key="KeyP">PHOTO</button>
      </div>`;
    document.body.appendChild(root);
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
      this.input.mouse.dx += (e.clientX - lastX) * 1.35;
      this.input.mouse.dy += (e.clientY - lastY) * 1.35;
      lastX = e.clientX; lastY = e.clientY;
    });
    pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end); pad.addEventListener('lostpointercapture', end);
  }

  bind() {
    this.root.querySelectorAll('[data-key]').forEach((el) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId); el.classList.add('down'); this.input.setVirtual(el.dataset.key, true);
      });
      const release = (e) => { e.preventDefault(); el.classList.remove('down'); this.input.setVirtual(el.dataset.key, false); };
      el.addEventListener('pointerup', release); el.addEventListener('pointercancel', release); el.addEventListener('lostpointercapture', release);
    });
    this.root.querySelectorAll('[data-mouse]').forEach((el) => {
      const btn = el.dataset.mouse;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId); el.classList.add('down');
        this.input.mouse[btn] = true; this.input.mouse[btn + 'Pressed'] = true;
      });
      const release = (e) => { e.preventDefault(); el.classList.remove('down'); this.input.mouse[btn] = false; };
      el.addEventListener('pointerup', release); el.addEventListener('pointercancel', release); el.addEventListener('lostpointercapture', release);
    });
    this.root.querySelectorAll('[data-pause]').forEach((el) => {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.game.pause(); });
    });
    this.root.querySelector('[data-more]').addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation(); this.root.classList.toggle('more');
    });
  }

  show(on = true) { if (this.enabled) this.root.classList.toggle('hidden', !on); }
  hide() { this.show(false); }
}
