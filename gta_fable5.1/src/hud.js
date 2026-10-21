import { CITY } from './config.js';
import { WEAPONS } from './weapons.js';
import * as THREE from 'three';
import { formatMoney, formatClock, clamp, damp, lerp } from './utils.js';
const _v = new THREE.Vector3();

const el = (tag, cls, parent, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; (parent || document.body).appendChild(e); return e; };

export class HUD {
  constructor(game) {
    this.game = game; const root = this.root = el('div', 'hud');
    // top-right: money / stars / weapon
    const tr = el('div', 'hud-tr', root);
    this.money = el('div', 'money', tr, '$0'); this.moneyDelta = el('div', 'money-delta', tr, '');
    this.stars = el('div', 'stars', tr, ''); for (let i = 0; i < 5; i++) el('span', 'star', this.stars, '★');
    this.weapon = el('div', 'weapon', tr, ''); this.weaponIcon = el('div', 'wicon', this.weapon, ''); this.weaponText = el('div', 'wtext', this.weapon, '');
    this.clock = el('div', 'clock', tr, '00:00');
    // bottom-left: minimap + bars
    const bl = el('div', 'hud-bl', root);
    this.mapWrap = el('div', 'minimap', bl); this.mapCanvas = el('canvas', '', this.mapWrap); this.mapCanvas.width = 220; this.mapCanvas.height = 220; this.mctx = this.mapCanvas.getContext('2d');
    this.bars = el('div', 'bars', bl); this.healthBar = el('div', 'bar health', this.bars); this.healthFill = el('div', 'fill', this.healthBar); this.armorBar = el('div', 'bar armor', this.bars); this.armorFill = el('div', 'fill', this.armorBar);
    // bottom-right: speed / area
    const br = el('div', 'hud-br', root); this.area = el('div', 'area', br, ''); this.speed = el('div', 'speed', br, '');
    // centre
    this.crosshair = el('div', 'crosshair', root); this.crosshair.style.display = 'none';
    this.objective = el('div', 'objective', root, ''); this.timer = el('div', 'timer', root, '');
    this.notice = el('div', 'notice', root, ''); this.banner = el('div', 'banner', root, ''); this.bannerSub = el('div', 'banner-sub', root, '');
    this.hint = el('div', 'hint', root, '');
    this.vignette = el('div', 'vignette', root); this.damage = el('div', 'damage', root);
    this.bigMap = el('div', 'bigmap', root); const mapRow = el('div', 'map-row', this.bigMap);
    this.bigCanvas = el('canvas', '', mapRow); this.bigCanvas.width = 700; this.bigCanvas.height = 700; this.bctx = this.bigCanvas.getContext('2d');
    this.mapPanel = el('div', 'map-panel', mapRow, ''); this.bigMap.style.display = 'none'; this.mapOpen = false; this.mapT = 0;
    this.help = el('div', 'help', root, `<h2>CONTROLS</h2>
      <div><b>WASD</b> move &nbsp; <b>Shift</b> sprint &nbsp; <b>Space</b> jump / handbrake &nbsp; <b>Mouse</b> look</div>
      <div><b>F</b> enter / exit vehicle (steals occupied cars) &nbsp; <b>LMB</b> fire / punch &nbsp; <b>RMB</b> aim</div>
      <div><b>1-6</b> / <b>Q</b> / <b>wheel</b> weapons &nbsp; <b>E</b> talk to people / shop &nbsp; <b>H</b> horn &nbsp; <b>R</b> radio &nbsp; <b>M</b> map &nbsp; <b>T</b> skip time &nbsp; <b>O</b> ambient occlusion &nbsp; <b>F1</b> this help</div>
      <div class="dim">Walk into the glowing markers to start missions. Walk through store doors to shop: <span style="color:#ff8c1a">Ammu-Nation</span> <span style="color:#ff3b7a">Burger Shot</span> <span style="color:#3bd1ff">Threads</span> — drive into <span style="color:#2bff88">Pay 'n' Spray</span> to repair and lose the cops.</div>
      <div class="dim">Pickups: <span style="color:#ff5050">health</span> <span style="color:#5090ff">armor</span> <span style="color:#50ff80">cash</span> <span>weapons</span>. Hold RMB to lock on; headshots do 2.5x. Red barrels explode.</div>`);
    this.help.style.display = 'none';
    // always-visible, context-sensitive control strip
    this.controls = el('div', 'controls-bar', root, ''); this.controlsMode = '';
    this.hit = el('div', 'hitmarker', root, ''); this.shop = el('div', 'shop', root, ''); this.shop.style.display = 'none';
    this.bubbleLayer = el('div', 'bubbles', root); this.bubbles = []; this.hitT = 0;
    this.noticeT = 0; this.bannerT = 0; this.areaT = 0; this.lastArea = ''; this.starFlash = 0; this.moneyShown = 0; this.deltaT = 0; this.deltaSum = 0;
    this.blips = []; this.buildMapImage(); this.damageA = 0;
  }
  buildMapImage() {
    const city = this.game.city; const R = CITY.WATER + 60; this.mapR = R; const S = this.mapS = 1024; const px = S / (R * 2);
    const c = document.createElement('canvas'); c.width = c.height = S; const ctx = c.getContext('2d');
    const w2p = (x) => (x + R) * px;
    ctx.fillStyle = '#5c9fd6'; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#d9c68f'; ctx.fillRect(w2p(-CITY.WATER + 8), w2p(-CITY.WATER + 8), (CITY.WATER - 8) * 2 * px, (CITY.WATER - 8) * 2 * px);
    ctx.fillStyle = '#7fa66a'; ctx.fillRect(w2p(-CITY.LAND), w2p(-CITY.LAND), CITY.LAND * 2 * px, CITY.LAND * 2 * px);
    for (const b of city.blocks) { ctx.fillStyle = b.type === 'park' ? '#5f9a4c' : b.type === 'lot' ? '#a8a8a0' : '#cfcac0'; ctx.fillRect(w2p(b.x0 - 3), w2p(b.z0 - 3), (b.x1 - b.x0 + 6) * px, (b.z1 - b.z0 + 6) * px); }
    ctx.fillStyle = '#e9e6dd'; const o = CITY.HALF + CITY.ASPHALT / 2, O = CITY.LAND; ctx.fillRect(w2p(o), w2p(-O), (O - o) * px, 2 * O * px); ctx.fillRect(w2p(-O), w2p(-O), (O - o) * px, 2 * O * px); ctx.fillRect(w2p(-O), w2p(o), 2 * O * px, (O - o) * px); ctx.fillRect(w2p(-O), w2p(-O), 2 * O * px, (O - o) * px);
    ctx.fillStyle = '#9a9a9a'; for (const b of city.blocks) { if (b.type === 'park') continue; }
    for (const box of city.hash.items) if (box.kind === 'building') { ctx.fillStyle = '#8d8a84'; ctx.fillRect(w2p(box.minX), w2p(box.minZ), (box.maxX - box.minX) * px, (box.maxZ - box.minZ) * px); }
    ctx.fillStyle = '#4d5057'; for (const rc of city.roadCoords) { ctx.fillRect(w2p(rc - 7), w2p(-CITY.HALF - 7), 14 * px, (CITY.HALF * 2 + 14) * px); ctx.fillRect(w2p(-CITY.HALF - 7), w2p(rc - 7), (CITY.HALF * 2 + 14) * px, 14 * px); }
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; for (const rc of city.roadCoords) { ctx.beginPath(); ctx.moveTo(w2p(rc), w2p(-CITY.HALF)); ctx.lineTo(w2p(rc), w2p(CITY.HALF)); ctx.stroke(); ctx.beginPath(); ctx.moveTo(w2p(-CITY.HALF), w2p(rc)); ctx.lineTo(w2p(CITY.HALF), w2p(rc)); ctx.stroke(); }
    this.mapImg = c; this.mapPx = px;
  }
  notify(text, ms = 2500) { this.notice.textContent = text; this.notice.style.opacity = 1; this.noticeT = ms / 1000; }
  showBanner(title, sub = '', color = '#ffd24a', ms = 4000) { this.banner.textContent = title; this.banner.style.color = color; this.bannerSub.textContent = sub; this.banner.style.opacity = 1; this.bannerSub.style.opacity = 1; this.bannerT = ms / 1000; }
  setObjective(t, soft = false) { if (soft && this.game.missions.active) return; this.objectiveText = t || ''; this.objective.textContent = this.objectiveText; this.objective.style.opacity = t ? 1 : 0; }
  setDistance(d) { if (this.objectiveText) this.objective.textContent = `${this.objectiveText}  ·  ${Math.round(d)} m`; }
  updateControls() {
    const g = this.game, pl = g.player;
    const mode = g.stores.shopOpen ? 'shop' : pl.vehicle ? 'car' : 'foot'; if (mode === this.controlsMode) return; this.controlsMode = mode;
    const k = (key, what) => `<span class="kc"><b>${key}</b>${what}</span>`;
    this.controls.innerHTML = mode === 'car'
      ? k('W / S', 'gas / brake') + k('A / D', 'steer') + k('Space', 'handbrake') + k('LMB', 'drive-by') + k('F', 'get out') + k('R', 'radio') + k('H', 'horn') + k('M', 'map')
      : mode === 'shop' ? k('1-9', 'buy') + k('E / Esc', 'leave')
      : k('WASD', 'move') + k('Shift', 'run') + k('Space', 'jump') + k('RMB', 'aim') + k('LMB', 'fire') + k('Q / 1-6', 'weapon') + k('F', 'enter car') + k('E', 'talk / shop') + k('M', 'map') + k('F1', 'help');
  }
  setTimer(sec) { if (sec == null) { this.timer.style.opacity = 0; return; } this.timer.style.opacity = 1; const s = Math.max(0, Math.ceil(sec)); this.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; this.timer.style.color = s < 10 ? '#ff5050' : '#fff'; }
  setHint(t) { this.hint.textContent = t || ''; this.hint.style.opacity = t ? 1 : 0; }
  flashStars() { this.starFlash = 1.5; }
  moneyPop(amount) { this.deltaSum += amount; this.deltaT = 2; this.moneyDelta.textContent = (this.deltaSum >= 0 ? '+' : '-') + formatMoney(Math.abs(this.deltaSum)); this.moneyDelta.style.color = this.deltaSum >= 0 ? '#7dff9a' : '#ff6a6a'; this.moneyDelta.style.opacity = 1; }
  toggleHelp() { this.help.style.display = this.help.style.display === 'none' ? 'block' : 'none'; }
  hitmarker(kind) { this.hit.className = 'hitmarker show ' + kind; this.hitT = 0.25; if (kind === 'kill') this.game.audio.tone(900, 0.08, 0.15, 'square'); else if (kind === 'head') this.game.audio.tone(1400, 0.06, 0.15, 'square'); else this.game.audio.tone(700, 0.04, 0.1, 'square'); }
  showShop(name, items, color) {
    this.shop.style.display = 'block'; this.shop.style.borderColor = color;
    this.shop.innerHTML = `<h2 style="color:${color}">${name}</h2>` + items.map((it, i) => `<div class="row"><span class="key">${i + 1}</span><span class="name">${it.name}</span><span class="price">${it.price ? formatMoney(it.price) : 'free'}</span></div>`).join('') + `<div class="dim">Press a number to buy · E or Esc to leave</div>`;
  }
  hideShop() { this.shop.style.display = 'none'; }
  speak(ent, text, ms = 2500) {
    for (let i = this.bubbles.length - 1; i >= 0; i--) if (this.bubbles[i].ent === ent) { this.bubbles[i].e.remove(); this.bubbles.splice(i, 1); }
    const e = el('div', 'bubble', this.bubbleLayer, text); this.bubbles.push({ ent, e, t: ms / 1000 });
  }
  updateBubbles(dt) {
    const cam = this.game.camera;
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i]; b.t -= dt; if (b.t <= 0 || b.ent.dead) { b.e.remove(); this.bubbles.splice(i, 1); continue; }
      const ent = b.ent; _v.set(ent.x, ent.y + (ent.vehicle ? 1.9 : 2.15), ent.z).project(cam);
      const behind = _v.z > 1; const x = (_v.x * 0.5 + 0.5) * innerWidth, y = (-_v.y * 0.5 + 0.5) * innerHeight;
      b.e.style.display = behind ? 'none' : 'block'; b.e.style.left = x + 'px'; b.e.style.top = y + 'px'; b.e.style.opacity = Math.min(1, b.t * 3);
    }
  }
  toggleMap() { this.mapOpen = !this.mapOpen; this.bigMap.style.display = this.mapOpen ? 'flex' : 'none'; if (this.mapOpen) { this.buildMapPanel(); this.drawBigMap(); } }
  buildMapPanel() {
    const g = this.game, pl = g.player; const dist = (x, z) => Math.round(Math.hypot(x - pl.x, z - pl.z)) + ' m';
    const missions = g.missions.markers.map(m => `<div class="row"><span class="dot" style="background:#${m.color.toString(16).padStart(6, '0')}">${m.name[0]}</span><span class="name">${m.name}</span><span class="dist">${dist(m.x, m.z)}</span></div><div class="desc">${m.desc}</div>`).join('');
    const stores = g.stores.stores.map(s => `<div class="row"><span class="dot" style="background:${s.color}">${s.kind === 'gun' ? 'A' : s.kind === 'food' ? 'B' : s.kind === 'clothes' ? 'T' : 'S'}</span><span class="name">${s.name}</span><span class="dist">${dist(s.doorX, s.doorZ)}</span></div>`).join('');
    const active = g.missions.active ? `<div class="active">Current: ${this.objectiveText || 'mission in progress'}</div>` : '';
    this.mapPanel.innerHTML = `<h2>THINGS TO DO</h2>${active}<div class="sub">Missions — walk into the marker</div>${missions}<div class="sub">Shops — walk through the door</div>${stores}
      <div class="sub">Legend</div>
      <div class="legend"><span><i style="background:#fff"></i> you</span><span><i style="background:#ffd24a"></i> mission / checkpoint</span><span><i style="background:#ff5050"></i> target</span><span><i style="background:#4d7cff"></i> police</span><span><i style="background:#50c8ff"></i> marked car</span><span><i style="background:#ff5050;border-radius:0"></i> health <i style="background:#5090ff;border-radius:0"></i> armor <i style="background:#50ff80;border-radius:0"></i> cash</span></div>
      <div class="dim">The world is paused while the map is open. The floating arrow above you points at your objective. Press M to close.</div>`;
  }

  update(dt) {
    const g = this.game, pl = g.player, police = g.police;
    // money
    this.moneyShown = Math.abs(pl.money - this.moneyShown) < 1 ? pl.money : damp(this.moneyShown, pl.money, 6, dt); this.money.textContent = formatMoney(this.moneyShown);
    if (this.deltaT > 0) { this.deltaT -= dt; if (this.deltaT <= 0) { this.moneyDelta.style.opacity = 0; this.deltaSum = 0; } }
    // stars
    this.starFlash = Math.max(0, this.starFlash - dt);
    const flash = this.starFlash > 0 && Math.floor(this.starFlash * 8) % 2 === 0;
    this.stars.childNodes.forEach((s, i) => { s.className = 'star' + (i < police.level ? ' on' : '') + (flash && i < police.level ? ' flash' : ''); });
    this.stars.style.opacity = police.level > 0 ? 1 : 0.25;
    // weapon
    const w = WEAPONS[pl.currentWeapon]; this.weaponIcon.textContent = w.icon; this.weaponText.textContent = w.melee ? w.name : `${w.name}  ${pl.ammo[pl.currentWeapon] || 0}`;
    this.clock.textContent = formatClock(g.dayFrac);
    // bars
    this.healthFill.style.width = clamp(pl.health, 0, 100) + '%'; this.armorFill.style.width = clamp(pl.armor, 0, 100) + '%'; this.armorBar.style.opacity = pl.armor > 0 ? 1 : 0.25;
    this.healthFill.style.background = pl.health > 35 ? '#4caf50' : '#e53935';
    // speed
    if (pl.vehicle) { this.speed.textContent = Math.round(pl.vehicle.absSpeed * 3.6) + ' km/h'; this.speed.style.opacity = 1; } else this.speed.style.opacity = 0;
    // area name
    const area = g.stores.interior ? g.stores.interior.name : g.city.districtName(pl.x, pl.z);
    if (area !== this.lastArea) { this.lastArea = area; this.area.textContent = area; this.areaT = 4; }
    if (this.areaT > 0) { this.areaT -= dt; this.area.style.opacity = Math.min(1, this.areaT); }
    // crosshair
    this.crosshair.style.display = (pl.aiming || pl.firePoseT > 0 || (pl.vehicle && (g.input.mouse.left || g.input.mouse.right))) && !pl.dead ? 'block' : 'none';
    this.crosshair.className = 'crosshair' + (g.aimTarget ? ' locked' : '');
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) this.hit.className = 'hitmarker'; }
    this.updateBubbles(dt);
    // notice / banner
    if (this.noticeT > 0) { this.noticeT -= dt; if (this.noticeT <= 0) this.notice.style.opacity = 0; }
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) { this.banner.style.opacity = 0; this.bannerSub.style.opacity = 0; } }
    // damage overlay
    this.damageA = damp(this.damageA, pl.damageFlash * 0.6 + (pl.health < 30 ? 0.25 : 0), 8, dt); this.damage.style.opacity = this.damageA;
    this.updateControls();
    this.drawMinimap();
    if (this.mapOpen) { this.mapT += dt; if (this.mapT > 0.25) { this.mapT = 0; this.drawBigMap(); } }
  }

  drawMinimap() {
    const g = this.game, pl = g.player, ctx = this.mctx; const S = 220, R = S / 2; const zoom = pl.vehicle ? 1.4 : 2.0; // px per metre
    ctx.clearRect(0, 0, S, S); ctx.save(); ctx.beginPath(); ctx.arc(R, R, R - 4, 0, 6.28); ctx.clip();
    const yaw = g.rig.yaw; const fx = -Math.sin(yaw), fz = -Math.cos(yaw); const rot = -Math.PI / 2 - Math.atan2(fz, fx);
    ctx.translate(R, R + 20); ctx.rotate(rot); ctx.scale(zoom / this.mapPx, zoom / this.mapPx);
    ctx.translate(-(pl.x + this.mapR) * this.mapPx, -(pl.z + this.mapR) * this.mapPx);
    ctx.drawImage(this.mapImg, 0, 0);
    ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.arc(R, R, R - 4, 0, 6.28); ctx.clip(); ctx.translate(R, R + 20); ctx.rotate(rot);
    const drawBlip = (b) => {
      let dx = (b.x - pl.x) * zoom, dz = (b.z - pl.z) * zoom; const d = Math.hypot(dx, dz); const maxD = R - 14;
      let edge = false; if (d > maxD) { dx *= maxD / d; dz *= maxD / d; edge = true; }
      ctx.save(); ctx.translate(dx, dz); ctx.rotate(-rot);
      ctx.fillStyle = b.color; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1.5;
      const s = b.size || 6;
      if (b.kind === 'cop') { ctx.beginPath(); ctx.arc(0, 0, s * 0.7, 0, 6.28); ctx.fill(); ctx.stroke(); }
      else if (b.kind === 'store') { ctx.beginPath(); ctx.arc(0, 0, s, 0, 6.28); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#000'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(b.label, 0, 3.5); }
      else if (b.kind === 'mission') { ctx.beginPath(); ctx.moveTo(0, -s - 1); ctx.lineTo(s + 1, 0); ctx.lineTo(0, s + 1); ctx.lineTo(-s - 1, 0); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#000'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(b.label, 0, 3.5); }
      else if (b.kind === 'car') { ctx.beginPath(); ctx.rect(-s * 0.6, -s * 0.6, s * 1.2, s * 1.2); ctx.fill(); ctx.stroke(); }
      else { ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s, 0); ctx.lineTo(0, s); ctx.lineTo(-s, 0); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      if (edge) { ctx.globalAlpha = 0.9; }
      ctx.restore();
    };
    for (const b of this.blips) drawBlip(b);
    ctx.restore();
    // player arrow (points along player heading relative to camera)
    ctx.save(); ctx.translate(R, R + 20); const h = pl.heading; const hx = Math.sin(h), hz = Math.cos(h); ctx.rotate(rot + Math.atan2(hx, -hz) ); // convert to canvas angle
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 4); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    // north indicator
    ctx.save(); ctx.translate(R, R + 20); ctx.rotate(rot); ctx.translate(0, -(R - 16)); ctx.rotate(-rot); ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('N', 0, 4); ctx.restore();
  }
  drawBigMap() {
    const g = this.game, pl = g.player, ctx = this.bctx; const S = 700; const R = this.mapR; const sc = S / (R * 2);
    if (!this.bigBase) { const c = document.createElement('canvas'); c.width = c.height = S; c.getContext('2d').drawImage(this.mapImg, 0, 0, S, S); this.bigBase = c; }
    ctx.clearRect(0, 0, S, S); ctx.drawImage(this.bigBase, 0, 0);
    const w2 = (x, z) => [(x + R) * sc, (z + R) * sc];
    for (const b of this.blips) {
      const [x, y] = w2(b.x, b.z); ctx.fillStyle = b.color; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; const r = b.kind === 'store' || b.kind === 'mission' ? 8 : b.kind === 'pickup' ? 3 : 5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.28); ctx.fill(); ctx.stroke();
      if (b.label) { ctx.fillStyle = '#000'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(b.label, x, y + 3.5); }
      if (b.name) { ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 3; ctx.font = 'bold 11px sans-serif'; ctx.strokeText(b.name, x, y - 11); ctx.fillText(b.name, x, y - 11); }
      if (b.guide) { ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 13 + Math.sin(this.game.time * 6) * 2, 0, 6.28); ctx.stroke(); }
    }
    for (const s of this.game.stores.stores) { const [x, y] = w2(s.doorX, s.doorZ); ctx.fillStyle = s.color; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 8, 0, 6.28); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#000'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(s.kind === 'gun' ? 'A' : s.kind === 'food' ? 'B' : s.kind === 'clothes' ? 'T' : 'S', x, y + 3.5); }
    for (const [n, p, col] of [['Hospital', this.game.hospital, '#ff7070'], ['Police', this.game.station, '#7fa0ff']]) { const [x, y] = w2(p.x, p.z); ctx.fillStyle = col; ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.rect(x - 6, y - 6, 12, 12); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 3; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.strokeText(n, x, y - 10); ctx.fillText(n, x, y - 10); }
    const [px, py] = w2(pl.x, pl.z); ctx.save(); ctx.translate(px, py); ctx.rotate(Math.atan2(Math.sin(pl.heading), -Math.cos(pl.heading))); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 4); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
    const names = [['Downtown', 0, 0], ['Ironworks', 0, -330], ['Palm Heights', 0, 300], ['Oakvale', -300, 0], ['Eastside', 300, 0], ['Midtown', -160, -160]];
    for (const [n, x, z] of names) { const [a, b] = w2(x, z); ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 3; ctx.strokeText(n, a, b); ctx.fillText(n, a, b); }
  }
}
