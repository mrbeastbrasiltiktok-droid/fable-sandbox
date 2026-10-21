import * as THREE from 'three';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'), health: document.querySelector('.bar.health .fill'), focus: document.querySelector('.bar.focus'),
      focusFill: document.querySelector('.bar.focus .fill'), xp: document.querySelector('.bar.xp .fill'), level: $('level-num'),
      mTitle: $('mission-title'), mDesc: $('mission-desc'), speed: $('speed-num'), waypoint: $('waypoint'), wpDist: document.querySelector('#waypoint .dist'),
      sense: $('spider-sense'), hit: $('hit-marker'), alerts: $('alerts'), hint: $('hint'), combo: $('combat-combo'), comboNum: $('combo-num'),
      vignette: $('vignette'), dmg: $('damage-flash'), context: $('context'), controls: $('controls-panel'), minimap: $('minimap'), skills: $('skills'), skillOpts: $('skill-options'), menu: $('menu'), loading: $('loading'),
    };
    this.mm = this.el.minimap.getContext('2d');
    this._v = new THREE.Vector3();
    this._hintT = 0;
    this._lastCombo = 0;
  }

  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }

  setVitals(hp, maxHp, focus, maxFocus, xp, xpNext, level) {
    this.el.health.style.transform = `scaleX(${Math.max(0, hp / maxHp)})`;
    this.el.focusFill.style.transform = `scaleX(${Math.max(0, focus / maxFocus)})`;
    this.el.focus.classList.toggle('full', focus >= maxFocus);
    this.el.xp.style.transform = `scaleX(${Math.max(0, xp / xpNext)})`;
    this.el.level.textContent = `LV ${level}`;
  }
  setMission(title, desc) {
    if (this.el.mTitle.textContent !== title) this.el.mTitle.textContent = title;
    if (this.el.mDesc.textContent !== desc) this.el.mDesc.textContent = desc;
  }
  setSpeed(ms) { this.el.speed.textContent = Math.round(ms * 3.6); this.el.vignette.classList.toggle('speed', ms > 32); }

  /** Project a world point; place a HUD element at it (clamped to screen edge). Returns true if on-screen. */
  place(el, world, camera, edgeMargin = 40) {
    const v = this._v.copy(world).project(camera);
    const behind = v.z > 1;
    let x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight;
    if (behind) { x = innerWidth - x; y = innerHeight - y; }
    const onScreen = !behind && x > edgeMargin && x < innerWidth - edgeMargin && y > edgeMargin && y < innerHeight - edgeMargin;
    if (!onScreen) {
      // clamp to screen edge along the direction from centre
      const cx = innerWidth / 2, cy = innerHeight / 2;
      let dx = x - cx, dy = y - cy;
      if (behind) { dx = -dx; dy = -dy; }
      const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      const sx = (cx - edgeMargin) / Math.abs(dx || 1e-6), sy = (cy - edgeMargin) / Math.abs(dy || 1e-6);
      const s = Math.min(sx, sy);
      x = cx + dx * s; y = cy + dy * s;
    }
    el.style.left = `${x}px`; el.style.top = `${y}px`;
    return onScreen;
  }

  setWaypoint(world, camera, dist, kind = '') {
    if (!world) { this.el.waypoint.classList.add('hidden'); return; }
    this.el.waypoint.classList.remove('hidden');
    const on = this.place(this.el.waypoint, world, camera);
    this.el.waypoint.classList.toggle('edge', !on);
    this.el.waypoint.classList.toggle('crime', kind === 'crime');
    this.el.wpDist.textContent = `${Math.round(dist)} m`;
  }
  spiderSense(world, camera) {
    if (!world) { this.el.sense.classList.add('hidden'); return; }
    this.el.sense.classList.remove('hidden');
    this.place(this.el.sense, world, camera, 30);
  }
  hitMarker() { this.el.hit.classList.remove('flash'); void this.el.hit.offsetWidth; this.el.hit.classList.add('flash'); }
  damage() { this.el.dmg.classList.add('on'); setTimeout(() => this.el.dmg.classList.remove('on'), 140); }
  combo(n) {
    if (n <= 0) { this.el.combo.classList.add('hidden'); this._lastCombo = 0; return; }
    this.el.combo.classList.remove('hidden');
    if (n !== this._lastCombo) { this.el.comboNum.textContent = n; this.el.combo.classList.remove('pop'); void this.el.combo.offsetWidth; this.el.combo.classList.add('pop'); this._lastCombo = n; }
  }
  alert(text, style = '') {
    const d = document.createElement('div'); d.className = `alert ${style}`; d.textContent = text;
    this.el.alerts.appendChild(d); setTimeout(() => d.remove(), 3200);
  }
  banner(title, sub) {
    const d = document.createElement('div'); d.className = 'banner';
    d.innerHTML = `<h2>${title}</h2><p>${sub || ''}</p>`;
    this.el.hud.appendChild(d); setTimeout(() => d.remove(), 3900);
  }
  hint(html, seconds = 4) {
    if (html) { this.el.hint.innerHTML = html; this.el.hint.classList.add('show'); this._hintT = seconds; }
  }
  update(dt) { if (this._hintT > 0) { this._hintT -= dt; if (this._hintT <= 0) this.el.hint.classList.remove('show'); } }

  showSkills(options, onPick) {
    this.el.skillOpts.innerHTML = '';
    for (const o of options) {
      const d = document.createElement('div'); d.className = 'skill';
      d.innerHTML = `<h3>${o.name}</h3><p>${o.desc}</p>`;
      d.onclick = () => { this.el.skills.classList.add('hidden'); onPick(o); };
      this.el.skillOpts.appendChild(d);
    }
    this.el.skills.classList.remove('hidden');
  }

  /** Contextual key prompts for the current state. */
  context(P, combat) {
    const s = P.state; let html = '';
    const k = (key, what) => `<span><kbd>${key}</kbd>${what}</span>`;
    if (combat.alive.length && P.pos.distanceTo(combat.alive[0].pos) < 30 && (s === 'idle' || s === 'run' || s === 'attack' || s === 'dodge' || s === 'land'))
      html = k('LMB', 'attack') + k('Q', 'dodge') + k('F', 'web-strike') + k('R', 'web') + k('T', 'throw') + k('V', 'yank') + (P.focus >= 100 ? k('G', 'finisher') + k('H', 'heal') : '');
    else if (s === 'idle' || s === 'run' || s === 'land') html = k('RMB', 'hold to swing') + k('SPACE', 'jump') + k('E', 'zip to aim') + k('SHIFT', 'sprint');
    else if (s === 'swing') html = k('RMB', 'release = let go') + k('SPACE', 'jump-release') + k('W', 'pump') + k('A D', 'steer') + k('E', 'zip');
    else if (s === 'jump' || s === 'fall') html = k('RMB', 'swing') + k('E', 'zip to aim') + k('SHIFT', 'dive') + (combat.alive.length ? k('LMB', 'dive kick') : k('T', 'trick'));
    else if (s === 'zip') html = k('E', 'chain zip') + k('SPACE', 'hold: launch at wall') + k('RMB', 'swing');
    else if (s === 'wall') html = k('W', P.wallRun ? 'keep running' : 'climb') + k('S', 'down') + k('A D', 'sidle') + k('SPACE', 'jump off') + k('E', 'zip') + k('RMB', 'swing') + (combat.alive.length ? k('LMB', 'leap attack') : '');
    if (html !== this._ctx) { this._ctx = html; this.el.context.innerHTML = html; }
  }
  showControls(seconds) { this.el.controls.classList.remove('hidden'); clearTimeout(this._ctlT); if (seconds) this._ctlT = setTimeout(() => this.el.controls.classList.add('hidden'), seconds * 1000); }
  toggleControls() { clearTimeout(this._ctlT); this.el.controls.classList.toggle('hidden'); }

  /** Minimap: camera-forward up, centred on the player. */
  drawMinimap(city, player, markers, camYaw) {
    const g = this.mm, W = 200, R = 240; // metres visible radius
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2); g.clip();
    g.fillStyle = 'rgba(20,24,32,0.9)'; g.fillRect(0, 0, W, W);
    const s = (W / 2) / R;
    const px = player.pos.x, pz = player.pos.z;
    g.translate(W / 2, W / 2);
    g.rotate(camYaw);      // camera-forward maps to "up"
    g.scale(-s, -s);       // world +z (yaw 0 forward) → canvas up, world right (−x) → canvas right
    g.translate(-px, -pz);
    // streets are the negative space; draw building footprints
    const list = city.near(px, pz, R);
    for (const b of list) {
      const t = Math.min(1, b.h / 180);
      g.fillStyle = `rgb(${70 + t * 90},${75 + t * 90},${85 + t * 90})`;
      g.fillRect(b.x - b.w / 2, b.z - b.d / 2, b.w, b.d);
    }
    for (const m of markers) {
      g.fillStyle = m.color; g.beginPath(); g.arc(m.x, m.z, m.r || 5, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    // player arrow (points along facing, rotated with map)
    g.save(); g.translate(W / 2, W / 2); g.rotate(camYaw - player.yaw);
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -8); g.lineTo(5, 6); g.lineTo(-5, 6); g.closePath(); g.fill();
    g.restore();
  }
}
