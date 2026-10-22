// On-screen driving controls. Writes into the same key state the keyboard uses,
// plus an analog steering value read by Input.poll().
const mk = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html != null) el.innerHTML = html;
  return el;
};

export function installTouchControls(app) {
  const input = app.input;
  const root = mk('div', 'touch-ui hidden');
  root.id = 'touch-ui';
  document.body.appendChild(root);

  const joy = mk('div', 't-joy');
  const knob = mk('div', 't-knob');
  joy.appendChild(knob);
  root.appendChild(joy);

  const touchKeys = new Set();
  const keyDown = (code) => { if (!input.keys.has(code)) { input.keys.add(code); input.pressed.add(code); } };
  const keyUp = (code) => input.keys.delete(code);
  const holdKey = (code) => { if (touchKeys.has(code)) return; touchKeys.add(code); keyDown(code); };
  const releaseKey = (code) => { if (touchKeys.delete(code)) keyUp(code); };

  const resetHooks = new Set();
  function bind(el, onDown, onUp) {
    let id = null;
    const finish = () => {
      if (id === null) return;
      id = null; el.classList.remove('on');
      onUp?.();
    };
    const end = (e) => {
      if (id === null || e.pointerId !== id) return;
      finish();
    };
    resetHooks.add(finish);
    el.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      e.preventDefault(); e.stopPropagation();
      id = e.pointerId;
      try { el.setPointerCapture(id); } catch (err) { /* ignore */ }
      el.classList.add('on');
      onDown?.();
    });
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  function button(label, cls, code) {
    const el = mk('div', 't-btn ' + cls, `<span>${label}</span>`);
    root.appendChild(el);
    if (code) bind(el, () => holdKey(code), () => releaseKey(code));
    return el;
  }

  button('GAS', 'gas', 'ArrowUp');
  button('BRAKE', 'brake', 'ArrowDown');
  button('DRIFT', 'drift', 'Space');
  button('ITEM', 'item', 'KeyE');
  button('BACK', 'back', 'KeyC');
  button('REAR', 'rear', 'KeyR');
  const pause = mk('div', 't-btn pause', '<span>II</span>');
  root.appendChild(pause);
  bind(pause, () => app.togglePause(), null);

  let joyId = null;
  function stick(e) {
    const r = joy.getBoundingClientRect();
    let dx = (e.clientX - (r.left + r.width / 2)) / (r.width * 0.5);
    let dy = (e.clientY - (r.top + r.height / 2)) / (r.height * 0.5);
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
    input.touchSteer = Math.abs(dx) < 0.16 ? 0 : Math.max(-1, Math.min(1, dx * 1.08));
  }
  function stopStick() { joyId = null; knob.style.transform = 'translate(0, 0)'; input.touchSteer = 0; }

  joy.addEventListener('pointerdown', (e) => {
    if (joyId !== null) return;
    e.preventDefault(); e.stopPropagation();
    joyId = e.pointerId;
    try { joy.setPointerCapture(joyId); } catch (err) { /* ignore */ }
    joy.classList.add('on');
    stick(e);
  });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) { e.preventDefault(); stick(e); } });
  const joyEnd = (e) => { if (e.pointerId !== joyId) return; joy.classList.remove('on'); stopStick(); };
  joy.addEventListener('pointerup', joyEnd);
  joy.addEventListener('pointercancel', joyEnd);
  joy.addEventListener('lostpointercapture', joyEnd);
  window.addEventListener('pointerup', joyEnd);
  window.addEventListener('pointercancel', joyEnd);

  function reset() {
    for (const fn of resetHooks) fn();
    stopStick();
    for (const c of [...touchKeys]) releaseKey(c);
    root.querySelectorAll('.t-btn.on').forEach((b) => b.classList.remove('on'));
  }
  function setActive(on) {
    if (!on) reset();
    root.classList.toggle('hidden', !on);
  }

  window.addEventListener('blur', reset);
  setActive(false);
  const api = { setActive, reset, root };
  app.touch = api;
  return api;
}
