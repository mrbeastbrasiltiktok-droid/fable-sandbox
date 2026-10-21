import { ITEMS } from './items.js';
import { ordinal, formatTime, clamp } from './utils.js';
import { DRIFT_TIERS } from './config.js';

export class HUD {
  constructor(root) {
    this.el = document.createElement('div'); this.el.className = 'hud'; this.el.hidden = true; root.appendChild(this.el);
    this.el.innerHTML = `
      <div class="hud-pos"><span class="pos-num">1</span><span class="pos-suf">st</span></div>
      <div class="hud-lap">LAP <b>1</b>/<span>3</span></div>
      <div class="hud-balloons"></div>
      <div class="hud-battle-timer"></div>
      <div class="hud-battle-list"></div>
      <div class="hud-item"><div class="item-ring"><div class="item-icon"></div><div class="item-badge"></div></div><div class="item-name"></div></div>
      <div class="hud-coins">🪙 <b>0</b></div>
      <div class="hud-time"><div class="t-main">0:00.000</div><div class="t-laps"></div></div>
      <div class="hud-speed"><div class="speed-num">0</div><div class="speed-unit">km/h</div><div class="speed-bar"><i></i></div></div>
      <canvas class="hud-map" width="220" height="220"></canvas>
      <div class="hud-center"></div>
      <div class="hud-msg"></div>
      <div class="hud-wrong">⚠ WRONG WAY</div>
      <div class="hud-standings"></div>
      <div class="hud-ink"></div>
      <div class="hud-flash"></div>`;
    const q = (s) => this.el.querySelector(s);
    this.posNum = q('.pos-num'); this.posSuf = q('.pos-suf'); this.lapB = q('.hud-lap b'); this.lapTot = q('.hud-lap span');
    this.itemIcon = q('.item-icon'); this.itemBadge = q('.item-badge'); this.itemName = q('.item-name'); this.itemRing = q('.item-ring');
    this.coins = q('.hud-coins b'); this.tMain = q('.t-main'); this.tLaps = q('.t-laps');
    this.speedNum = q('.speed-num'); this.speedBar = q('.speed-bar i');
    this.map = q('.hud-map'); this.mctx = this.map.getContext('2d');
    this.balloonsEl = q('.hud-balloons'); this.battleTimer = q('.hud-battle-timer'); this.battleList = q('.hud-battle-list');
    this.center = q('.hud-center'); this.msg = q('.hud-msg'); this.wrong = q('.hud-wrong'); this.standings = q('.hud-standings'); this.inkEl = q('.hud-ink'); this.flash = q('.hud-flash');
    this.rouletteT = 0; this.lastCenter = ''; this.lastMsg = '';
  }
  show() { this.el.hidden = false; } hide() { this.el.hidden = true; }
  setTrack(track) {
    this.track = track;
    const b = track.bounds; const w = b.max.x - b.min.x, h = b.max.z - b.min.z; const sc = 190 / Math.max(w, h);
    this.mapScale = sc; this.mapOff = { x: 110 - (b.min.x + w / 2) * sc, z: 110 - (b.min.z + h / 2) * sc };
    this.mapPath = new Path2D();
    for (let i = 0; i < track.N; i += 4) { const p = track.pos[i]; const x = p.x * sc + this.mapOff.x, y = p.z * sc + this.mapOff.z; if (i === 0) this.mapPath.moveTo(x, y); else this.mapPath.lineTo(x, y); }
    this.mapPath.closePath();
  }
  ink() {
    this.inkEl.innerHTML = ''; for (let i = 0; i < 9; i++) { const d = document.createElement('div'); d.className = 'ink-blob'; const s = 120 + Math.random() * 220; d.style.cssText = `left:${Math.random() * 100}%;top:${Math.random() * 100}%;width:${s}px;height:${s}px;animation-delay:${Math.random() * 0.3}s`; this.inkEl.appendChild(d); }
    this.inkEl.classList.add('on'); clearTimeout(this.inkT); this.inkT = setTimeout(() => this.inkEl.classList.remove('on'), 6200);
  }
  flashScreen(color = 'rgba(255,255,255,0.7)') { this.flash.style.background = color; this.flash.classList.remove('go'); void this.flash.offsetWidth; this.flash.classList.add('go'); }
  update(race, dt) {
    const k = race.player; const tr = race.track;
    this.posNum.textContent = k.position; this.posSuf.textContent = ordinal(k.position).slice(-2);
    this.el.classList.toggle('pos-lead', k.position === 1);
    this.lapB.textContent = clamp(k.lap, 1, race.laps); this.lapTot.textContent = race.laps;
    this.el.classList.toggle('battle', !!race.battle);
    if (race.battle) {
      const bl = '🎈'.repeat(k.balloons) + '<i>' + '🎈'.repeat(3 - k.balloons) + '</i>'; if (bl !== this.lastBl) { this.balloonsEl.innerHTML = bl; this.lastBl = bl; }
      const tt = Math.max(0, race.battleTimer); const ts = `${Math.floor(tt / 60)}:${String(Math.floor(tt % 60)).padStart(2, '0')}`; if (ts !== this.lastTs) { this.battleTimer.textContent = ts; this.lastTs = ts; this.battleTimer.classList.toggle('low', tt < 20); }
      const list = race.sorted.map((o) => `<div class="${o.isPlayer ? 'me' : ''} ${o.eliminated ? 'out' : ''}"><i style="background:#${o.ch.color.toString(16).padStart(6, '0')}"></i>${o.ch.name}<span>${'●'.repeat(o.balloons)}${'○'.repeat(3 - o.balloons)}</span><b>${o.score}</b></div>`).join(''); if (list !== this.lastList) { this.battleList.innerHTML = list; this.lastList = list; }
    }
    // item
    if (k.roulette > 0) { this.rouletteT += dt; const ids = Object.keys(ITEMS); const id = ids[Math.floor(this.rouletteT * 14) % ids.length]; this.itemIcon.textContent = ITEMS[id].icon; this.itemBadge.textContent = ''; this.itemName.textContent = '???'; this.itemRing.classList.add('rolling'); }
    else if (k.item) { const it = ITEMS[k.item]; this.itemIcon.textContent = it.icon; this.itemBadge.textContent = it.count > 1 && k.item !== 'gold' ? '×' + k.itemCount : it.badge || ''; this.itemName.textContent = it.name + (k.item === 'gold' && k.goldenTimer > 0 ? ` ${k.goldenTimer.toFixed(1)}s` : ''); this.itemRing.classList.remove('rolling'); this.itemRing.classList.toggle('trailing', k.trailing); }
    else { this.itemIcon.textContent = ''; this.itemBadge.textContent = ''; this.itemName.textContent = ''; this.itemRing.classList.remove('rolling', 'trailing'); }
    this.coins.textContent = k.coins;
    this.tMain.textContent = formatTime(race.state === 'racing' || race.state === 'finished' || race.state === 'results' ? (k.finished ? k.finishTime : race.raceTime) : 0);
    this.tLaps.innerHTML = k.lapTimes.map((t, i) => `<div>L${i + 1} ${formatTime(t)}</div>`).join('');
    const kmh = Math.abs(k.speed) * 3.6 * 1.9; this.speedNum.textContent = Math.round(kmh);
    this.speedBar.style.width = clamp(k.speed / (k.baseTop * 1.5), 0, 1) * 100 + '%';
    this.speedBar.style.background = k.boostTimer > 0 ? 'linear-gradient(90deg,#ffb020,#ff3060)' : 'linear-gradient(90deg,#40d0ff,#8060ff)';
    // drift charge glow on speed panel
    const d = k.drift; let glow = 'none';
    if (d.active && d.tier > 0) { const c = '#' + DRIFT_TIERS[d.tier - 1].color.toString(16).padStart(6, '0'); glow = `0 0 ${12 + d.tier * 8}px ${c}`; }
    this.speedNum.style.textShadow = glow;
    // center text
    let center = '';
    if (race.state === 'intro') center = `<div class="track-title"><small>${race.battle ? 'BALLOON BATTLE' : race.trackDef.difficulty ? '★'.repeat(race.trackDef.difficulty) : ''}</small>${race.trackDef.name}</div>`;
    else if (race.state === 'countdown') { const n = Math.ceil(race.countdown); center = `<div class="count c${n}">${n}</div>`; }
    else if (race.state === 'racing' && race.raceTime < 1.0) center = `<div class="count go">${race.battle ? 'FIGHT!' : 'GO!'}</div>`;
    if (center !== this.lastCenter) { this.center.innerHTML = center; this.lastCenter = center; }
    const msg = race.msg || ''; if (msg !== this.lastMsg) { this.msg.textContent = msg; this.msg.classList.toggle('on', !!msg); this.lastMsg = msg; }
    this.wrong.classList.toggle('on', k.wrongWay);
    // standings when finished
    if (k.finished && race.state !== 'results' && !race.battle) { this.standings.innerHTML = race.sorted.slice(0, 8).map((o) => `<div class="${o.isPlayer ? 'me' : ''}"><b>${o.position}</b> <i style="background:#${o.ch.color.toString(16).padStart(6, '0')}"></i>${o.ch.name} <span>${o.finished ? formatTime(o.finishTime) : ''}</span></div>`).join(''); this.standings.classList.add('on'); }
    else this.standings.classList.remove('on');
    // minimap
    const ctx = this.mctx; ctx.clearRect(0, 0, 220, 220);
    ctx.lineWidth = 9; ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineJoin = 'round'; ctx.stroke(this.mapPath);
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.stroke(this.mapPath);
    // start line
    if (tr.isArena) { for (const o of tr.obstacles) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; if (o.type === 'circle') { ctx.beginPath(); ctx.arc(o.x * this.mapScale + this.mapOff.x, o.z * this.mapScale + this.mapOff.z, Math.max(2, o.r * this.mapScale), 0, 7); ctx.fill(); } else ctx.fillRect((o.x - o.hx) * this.mapScale + this.mapOff.x, (o.z - o.hz) * this.mapScale + this.mapOff.z, o.hx * 2 * this.mapScale, o.hz * 2 * this.mapScale); } }
    const p0 = tr.pos[0], r0 = tr.right[0]; ctx.strokeStyle = tr.isArena ? 'transparent' : '#ff4060'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo((p0.x - r0.x * 8) * this.mapScale + this.mapOff.x, (p0.z - r0.z * 8) * this.mapScale + this.mapOff.z); ctx.lineTo((p0.x + r0.x * 8) * this.mapScale + this.mapOff.x, (p0.z + r0.z * 8) * this.mapScale + this.mapOff.z); ctx.stroke();
    for (const o of race.karts) { if (o.isPlayer || o.eliminated) continue; const x = o.pos.x * this.mapScale + this.mapOff.x, y = o.pos.z * this.mapScale + this.mapOff.z; ctx.fillStyle = '#' + o.ch.color.toString(16).padStart(6, '0'); ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 7); ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke(); }
    { const x = k.pos.x * this.mapScale + this.mapOff.x, y = k.pos.z * this.mapScale + this.mapOff.z; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.fill(); ctx.fillStyle = '#' + k.ch.color.toString(16).padStart(6, '0'); ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill(); }
    for (const o of race.items.objects) if (o.type === 'blue') { const x = o.pos.x * this.mapScale + this.mapOff.x, y = o.pos.z * this.mapScale + this.mapOff.z; ctx.fillStyle = '#4080ff'; ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill(); }
  }
}
