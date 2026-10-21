import { CHARACTERS } from './characters.js';
import { TRACKS } from './tracks.js';
import { ARENAS } from './arena.js';
import { formatTime, ordinal } from './utils.js';

const STAT_KEYS = [['speed', 'Speed'], ['accel', 'Accel'], ['weight', 'Weight'], ['handling', 'Handling'], ['traction', 'Grip'], ['mt', 'Mini-Turbo']];

export class Menu {
  constructor(root, app) {
    this.app = app; this.el = document.createElement('div'); this.el.className = 'menu'; root.appendChild(this.el);
    this.screen = null; this.sel = 0; this.cc = 150; this.mode = 'race'; this.charIdx = 2; this.trackIdx = 0;
    this.el.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) { this.sel = +b.dataset.i; this.render(); this.confirm(); } const nav = e.target.closest('[data-nav]'); if (nav) this[nav.dataset.nav](); });
    this.el.addEventListener('mousemove', (e) => { const b = e.target.closest('[data-i]'); if (b && +b.dataset.i !== this.sel) { this.sel = +b.dataset.i; this.render(); } });
  }
  show(screen, data) { this.screen = screen; this.data = data; this.sel = screen === 'chars' ? this.charIdx : screen === 'tracks' ? this.trackIdx : 0; this.el.hidden = false; this.render(); }
  hide() { this.el.hidden = true; this.screen = null; }
  trackThumb(def, size = 120) {
    const pts = def.points; let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9; for (const p of pts) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); minz = Math.min(minz, p[1]); maxz = Math.max(maxz, p[1]); }
    const w = maxx - minx, h = maxz - minz, sc = (size - 16) / Math.max(w, h); const cx = (minx + maxx) / 2, cz = (minz + maxz) / 2;
    const P = (p) => `${((p[0] - cx) * sc + size / 2).toFixed(1)},${((p[1] - cz) * sc + size / 2).toFixed(1)}`;
    // smooth via catmull-rom sampling
    const n = pts.length; const out = [];
    for (let i = 0; i < n; i++) { const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n]; for (let t = 0; t < 1; t += 0.2) { const t2 = t * t, t3 = t2 * t; const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3); const z = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3); out.push(P([x, z])); } }
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><polygon points="${out.join(' ')}" fill="none" stroke="rgba(0,0,0,0.5)" stroke-width="9" stroke-linejoin="round"/><polygon points="${out.join(' ')}" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="round"/><circle cx="${P(pts[0]).split(',')[0]}" cy="${P(pts[0]).split(',')[1]}" r="4" fill="#ff4060"/></svg>`;
  }
  render() {
    const s = this.screen; let html = '';
    const opt = (i, label, sub = '') => `<div class="opt ${this.sel === i ? 'sel' : ''}" data-i="${i}"><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
    if (s === 'title') html = `<div class="title-wrap"><div class="logo"><span>FABLE</span><span class="k">KART</span></div><div class="tag">Drift. Boost. Bananas.</div><div class="press">Press <kbd>Enter</kbd> or click to start</div><div class="opt sel" data-i="0" style="opacity:0;height:0;padding:0"></div></div>`;
    else if (s === 'main') html = `<h1>Main Menu</h1><div class="opts">${opt(0, 'Single Race', 'Pick any track')}${opt(1, 'Grand Prix', 'All 6 tracks, points decide')}${opt(2, 'Balloon Battle', 'Pop their balloons in an arena')}${opt(3, 'Time Trial', 'Solo, no items, chase the clock')}${opt(4, 'How to Play')}</div>`;
    else if (s === 'cc') html = `<h1>Engine Class</h1><div class="opts">${opt(0, '50cc', 'Relaxed')}${opt(1, '100cc', 'Standard')}${opt(2, '150cc', 'Fast and furious')}</div><div class="hint"><kbd>Esc</kbd> back</div>`;
    else if (s === 'chars') {
      const ch = CHARACTERS[this.sel];
      html = `<h1>Choose Your Racer</h1><div class="chars-wrap"><div class="char-grid">${CHARACTERS.map((c, i) => `<div class="char ${this.sel === i ? 'sel' : ''}" data-i="${i}" style="--c:#${c.color.toString(16).padStart(6, '0')}"><div class="char-dot"></div><b>${c.name}</b><small>${c.cls}</small></div>`).join('')}</div>
      <div class="char-card"><h2>${ch.name} <small>the ${ch.species}</small></h2><p>${ch.tag}</p><div class="stats">${STAT_KEYS.map(([k, l]) => `<div class="stat"><span>${l}</span><div class="bar"><i style="width:${((ch.stats[k] - 1.5) / 3.5) * 100}%"></i></div><b>${ch.stats[k].toFixed(2)}</b></div>`).join('')}</div></div></div><div class="hint"><kbd>←</kbd><kbd>→</kbd> select · <kbd>Enter</kbd> confirm · <kbd>Esc</kbd> back</div>`;
    } else if (s === 'tracks') {
      html = `<h1>Select Course</h1><div class="track-grid">${TRACKS.map((t, i) => `<div class="track ${this.sel === i ? 'sel' : ''}" data-i="${i}"><div class="thumb theme-${t.theme}">${this.trackThumb(t)}</div><b>${t.name}</b><small>${'★'.repeat(t.difficulty)}${'☆'.repeat(5 - t.difficulty)}</small><p>${t.blurb}</p></div>`).join('')}</div><div class="hint"><kbd>←</kbd><kbd>→</kbd> select · <kbd>Enter</kbd> race · <kbd>Esc</kbd> back</div>`;
    } else if (s === 'arenas') {
      html = `<h1>Select Arena</h1><div class="track-grid">${ARENAS.map((a, i) => `<div class="track ${this.sel === i ? 'sel' : ''}" data-i="${i}"><div class="thumb arena theme-${a.theme}">${this.arenaThumb(a)}</div><b>${a.name}</b><small>3 balloons · 2:30</small><p>${a.blurb}</p></div>`).join('')}</div><div class="hint"><kbd>←</kbd><kbd>→</kbd> select · <kbd>Enter</kbd> battle · <kbd>Esc</kbd> back</div>`;
    } else if (s === 'help') {
      html = `<h1>How to Play</h1><div class="help"><div><b>Steer</b> ← → or A D</div><div><b>Accelerate</b> ↑ or W</div><div><b>Brake / Reverse</b> ↓ or S</div><div><b>Hop / Drift</b> Space or Shift · hold while turning, release for a Mini-Turbo. Blue → orange → purple sparks give bigger boosts. Steer <i>into</i> the drift to charge faster.</div><div><b>Use item</b> Ctrl / E / X or <b>left mouse</b> · hold to trail shells & bananas behind you as a shield. Shells fly forward and bananas drop behind; <b>right mouse</b> (or C, or hold ↓) throws backward.</div><div><b>Balloon Battle</b> everyone has 3 balloons. Hit rivals to pop theirs, lose all of yours and you are out. Last kart standing, or most balloons (then hits) when time runs out, wins.</div><div><b>Rear view</b> R</div><div><b>Rocket start</b> hit the gas just as the 2 turns to 1.</div><div><b>Tricks</b> hop while flying off a ramp for a landing boost. Draft behind a rival for slipstream.</div><div><b>Coins</b> up to 10, each one adds top speed. You drop 3 when hit.</div><div><b>Gamepad</b> supported: A / RT gas, LT brake, B / RB hop, X / Y item, Back rear view.</div></div><div class="hint"><kbd>Esc</kbd> back</div>`;
    } else if (s === 'results' && this.data.battle) {
      const r = this.data;
      html = `<h1>${r.trackName} · Battle Results</h1><table class="results"><tr class="head"><td></td><td></td><td>Balloons</td><td>Hits</td></tr>${r.results.map((e) => `<tr class="${e.kart.isPlayer ? 'me' : ''}"><td>${ordinal(e.pos)}</td><td><i style="background:#${e.ch.color.toString(16).padStart(6, '0')}"></i>${e.ch.name}</td><td>${'🎈'.repeat(e.balloons) || '—'}</td><td>${e.score}</td></tr>`).join('')}</table><div class="opts row">${opt(0, 'Battle Again')}${opt(1, 'Main Menu')}</div>`;
    } else if (s === 'results') {
      const r = this.data; const gp = r.gp;
      html = `<h1>${r.trackName} · Results</h1><table class="results">${r.results.map((e) => `<tr class="${e.kart.isPlayer ? 'me' : ''}"><td>${ordinal(e.pos)}</td><td><i style="background:#${e.ch.color.toString(16).padStart(6, '0')}"></i>${e.ch.name}</td><td>${formatTime(e.time)}</td>${gp ? `<td>+${e.points}</td><td><b>${gp.totals[e.ch.id]}</b></td>` : ''}</tr>`).join('')}</table>
      ${r.bestLap ? `<div class="bestlap">Your best lap: <b>${formatTime(r.bestLap)}</b></div>` : ''}
      <div class="opts row">${gp && !gp.last ? opt(0, 'Next Race ▶') : opt(0, 'Race Again')}${opt(1, 'Main Menu')}</div>`;
    } else if (s === 'gpfinal') {
      const gp = this.data; const rows = Object.entries(gp.totals).sort((a, b) => b[1] - a[1]);
      html = `<h1>🏆 ${gp.name} · Final Standings</h1><table class="results">${rows.map(([id, pts], i) => { const c = CHARACTERS.find((c) => c.id === id); return `<tr class="${id === gp.playerId ? 'me' : ''}"><td>${ordinal(i + 1)}</td><td><i style="background:#${c.color.toString(16).padStart(6, '0')}"></i>${c.name}</td><td><b>${pts}</b> pts</td></tr>`; }).join('')}</table><div class="opts row">${opt(0, 'Main Menu')}</div>`;
    } else if (s === 'pause') {
      html = `<h1>Paused</h1><div class="opts">${opt(0, 'Resume')}${opt(1, 'Restart Race')}${opt(2, 'Quit to Menu')}</div>`;
    }
    this.el.innerHTML = `<div class="menu-inner screen-${s}">${html}</div>`;
  }
  arenaThumb(a, size = 120) {
    const ext = a.shape === 'circle' ? a.radius : a.half; const sc = (size - 20) / (ext * 2); const P = (v) => (v * sc + size / 2).toFixed(1);
    const shape = a.shape === 'circle' ? `<circle cx="${size / 2}" cy="${size / 2}" r="${(ext * sc).toFixed(1)}" fill="rgba(0,0,0,0.35)" stroke="#fff" stroke-width="4"/>` : `<rect x="${P(-ext)}" y="${P(-ext)}" width="${(ext * 2 * sc).toFixed(1)}" height="${(ext * 2 * sc).toFixed(1)}" rx="6" fill="rgba(0,0,0,0.35)" stroke="#fff" stroke-width="4"/>`;
    // obstacles are generated by the Arena class; approximate with the same layout rules
    const dots = a.id === 'plaza' ? [-1, 0, 1].flatMap((x) => [-1, 0, 1].filter((z) => !(x === 0 && z === 0)).map((z) => `<rect x="${P(x * 34 - 5)}" y="${P(z * 34 - 5)}" width="${(10 * sc).toFixed(1)}" height="${(10 * sc).toFixed(1)}" fill="#fff" opacity="0.8"/>`)).join('') : a.id === 'crater' ? `<circle cx="${size / 2}" cy="${size / 2}" r="${(7 * sc).toFixed(1)}" fill="#fff" opacity="0.8"/>` + [...Array(12)].map((_, i) => { const an = (i / 12) * Math.PI * 2, rr = 44; return `<circle cx="${P(Math.cos(an) * rr)}" cy="${P(Math.sin(an) * rr)}" r="${(4 * sc).toFixed(1)}" fill="#fff" opacity="0.7"/>`; }).join('') : [...Array(8)].map((_, i) => { const an = (i / 8) * Math.PI * 2; return `<circle cx="${P(Math.cos(an) * 30)}" cy="${P(Math.sin(an) * 30)}" r="${(2.6 * sc).toFixed(1)}" fill="#fff" opacity="0.8"/>`; }).join('') + `<rect x="${P(-3)}" y="${P(-12)}" width="${(6 * sc).toFixed(1)}" height="${(24 * sc).toFixed(1)}" fill="#fff" opacity="0.8"/>`;
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${shape}${dots}</svg>`;
  }
  count() { return this.el.querySelectorAll('[data-i]').length; }
  move(d) { const n = this.count(); if (!n) return; this.sel = (this.sel + d + n) % n; this.app.audio.play('menu'); this.render(); }
  confirm() { this.app.audio.play('confirm'); this.app.menuConfirm(this.screen, this.sel); }
  back() { this.app.audio.play('back'); this.app.menuBack(this.screen); }
  handleInput(inp) {
    if (!this.screen) return;
    const horiz = this.screen === 'chars' || this.screen === 'tracks' || this.screen === 'arenas' || this.screen === 'results' || this.screen === 'gpfinal';
    if (inp.left || (inp.up && !horiz)) this.move(-1);
    if (inp.right || (inp.down && !horiz)) this.move(1);
    if (horiz && this.screen === 'chars') { if (inp.up) this.move(-2); if (inp.down) this.move(2); }
    if (horiz && (this.screen === 'tracks' || this.screen === 'arenas')) { if (inp.up) this.move(-3); if (inp.down) this.move(3); }
    if (inp.confirm) this.confirm();
    if (inp.back) this.back();
  }
}
