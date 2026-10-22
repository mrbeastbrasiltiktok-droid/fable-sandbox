// On-screen controls for phones/tablets. Feeds the existing key/mouse state used
// by the player, combat and camera, plus an analog move vector.
const mk = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html != null) el.innerHTML = html;
  return el;
};

export function installTouchControls(game) {
  const input = game.input;
  const root = mk('div', 'touch-ui hidden');
  root.id = 'touch-ui';
  document.body.appendChild(root);

  const look = mk('div', 't-look');
  const joy = mk('div', 't-joy');
  const knob = mk('div', 't-knob');
  joy.appendChild(knob);
  root.appendChild(look);
  root.appendChild(joy);

  const touchKeys = new Set();
  const keyDown = (code) => { if (!input.keys.has(code)) { input.keys.add(code); input.pressed.add(code); } };
  const keyUp = (code) => input.keys.delete(code);
  const holdKey = (code) => { if (touchKeys.has(code)) return; touchKeys.add(code); keyDown(code); };
  const releaseKey = (code) => { if (touchKeys.delete(code)) keyUp(code); };
  const mouseDown = (btn) => { input.mouse[btn] = true; input.mouse[btn + 'Pressed'] = true; };
  const mouseUp = (btn) => { input.mouse[btn] = false; };

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

  function button(label, cls, actions) {
    const el = mk('div', 't-btn ' + cls, `<span>${label}</span>`);
    root.appendChild(el);
    bind(el, () => {
      for (const a of actions) {
        if (a.mouse) mouseDown(a.mouse);
        else holdKey(a.code);
      }
    }, () => {
      for (const a of actions) {
        if (a.mouse) mouseUp(a.mouse);
        else releaseKey(a.code);
      }
    });
    return el;
  }

  button('SWING', 'swing', [{ mouse: 'right' }]);
  button('PUNCH', 'attack', [{ mouse: 'left' }]);
  button('JUMP', 'jump', [{ code: 'Space' }]);
  button('ZIP', 'zip', [{ code: 'KeyE' }]);
  button('DODGE', 'dodge', [{ code: 'KeyQ' }]);
  button('STRIKE', 'strike', [{ code: 'KeyF' }]);
  button('SHOOT', 'shoot', [{ code: 'KeyR' }]);
  button('HEAL', 'heal', [{ code: 'KeyH' }]);

  const pause = mk('div', 't-btn pause', '<span>II</span>');
  root.appendChild(pause);
  bind(pause, () => game.pause(), null);

  let joyId = null;
  function stick(e) {
    const r = joy.getBoundingClientRect();
    let dx = (e.clientX - (r.left + r.width / 2)) / (r.width * 0.5);
    let dy = (e.clientY - (r.top + r.height / 2)) / (r.height * 0.5);
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    knob.style.transform = `translate(${dx * 42}px, ${dy * 42}px)`;
    const dead = 0.18;
    const ax = Math.abs(dx) < dead ? 0 : dx;
    const ay = Math.abs(dy) < dead ? 0 : -dy;
    input.touchMove = { x: ax, y: ay };
    if (ax > 0.35) holdKey('KeyD'); else releaseKey('KeyD');
    if (ax < -0.35) holdKey('KeyA'); else releaseKey('KeyA');
    if (ay > 0.35) holdKey('KeyW'); else releaseKey('KeyW');
    if (ay < -0.35) holdKey('KeyS'); else releaseKey('KeyS');
  }
  function stopStick() {
    joyId = null;
    knob.style.transform = 'translate(0, 0)';
    input.touchMove = null;
    for (const c of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) releaseKey(c);
  }
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

  // Right-side drag turns the camera / aims webs. Buttons sit on top of this area.
  let lookId = null, lx = 0, ly = 0;
  look.addEventListener('pointerdown', (e) => {
    if (lookId !== null) return;
    e.preventDefault();
    lookId = e.pointerId;
    lx = e.clientX; ly = e.clientY;
    try { look.setPointerCapture(lookId); } catch (err) { /* ignore */ }
  });
  look.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookId) return;
    input.mouse.dx += (e.clientX - lx) * 1.6;
    input.mouse.dy += (e.clientY - ly) * 1.6;
    lx = e.clientX; ly = e.clientY;
  });
  const lookEnd = (e) => { if (e.pointerId === lookId) lookId = null; };
  look.addEventListener('pointerup', lookEnd);
  look.addEventListener('pointercancel', lookEnd);
  look.addEventListener('lostpointercapture', lookEnd);
  window.addEventListener('pointerup', lookEnd);
  window.addEventListener('pointercancel', lookEnd);

  function reset() {
    for (const fn of resetHooks) fn();
    stopStick();
    for (const c of [...touchKeys]) releaseKey(c);
    input.mouse.left = false; input.mouse.right = false;
    input.mouse.leftPressed = false; input.mouse.rightPressed = false;
    lookId = null;
    root.querySelectorAll('.t-btn.on').forEach((b) => b.classList.remove('on'));
  }
  function setActive(on) {
    if (!on) reset();
    root.classList.toggle('hidden', !on);
  }

  window.addEventListener('blur', reset);
  setActive(false);
  const api = { setActive, reset, root };
  game.touch = api;
  return api;
}
