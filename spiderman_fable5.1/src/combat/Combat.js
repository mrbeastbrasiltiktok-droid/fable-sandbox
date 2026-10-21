import * as THREE from 'three';
import { CFG } from '../core/Config.js';
import { Enemy } from './Enemy.js';
import { WebShots } from '../player/WebLine.js';

/** Freeflow combat: attack chains with lunges, dodge with spider-sense, web-strike, web-shoot, finisher, heal, web bomb. */
export class Combat {
  constructor(game) {
    this.game = game;
    this.enemies = [];
    this.groups = [];
    this.combo = 0; this.comboT = 0;
    this.attackPhase = 0; this.hitApplied = false; this.attackBuffer = 0;
    this.dodgeStart = -10;
    this.shootCd = 0; this.strikeCd = 0;
    this.finisher = null; // { enemy, t }
    this.bomb = { charges: 3, regen: 0 };
    this.webShots = new WebShots(game.scene);
    this.tracers = new WebShots(game.scene, 6);
    this.senseEnemy = null;
    this.counter = null; this.counterT = 0;   // perfect-dodge counter window
    this.diveKick = null;                     // dive-kick target while airborne
    this.throwCd = 0; this.yankCd = 0;
    this._t = new THREE.Vector3(); this._t2 = new THREE.Vector3();
    this.onKO = null;
  }

  // ---------- spawning ----------
  spawnGroup(center, spec, opts = {}) {
    const g = { id: this.groups.length, enemies: [], center: center.clone(), alive: () => g.enemies.filter((e) => e.alive).length };
    const city = this.game.city;
    const baseH = city.heightAt(center.x, center.z);
    for (const { type, n } of spec) {
      for (let i = 0; i < n; i++) {
        let p = null;
        for (let tries = 0; tries < 20; tries++) {
          const a = Math.random() * Math.PI * 2, r = 2.5 + Math.random() * (opts.radius ?? 7);
          const c = new THREE.Vector3(center.x + Math.cos(a) * r, 0, center.z + Math.sin(a) * r);
          if (Math.abs(city.heightAt(c.x, c.z) - baseH) < 0.5 && city.inBounds(c.x, c.z, 10)) { p = c; break; }
        }
        if (!p) p = center.clone();
        const e = new Enemy(this.game, type, p);
        e.group = g; g.enemies.push(e); this.enemies.push(e);
      }
    }
    this.groups.push(g);
    return g;
  }
  clearAll() { for (const e of this.enemies) e.dispose(); this.enemies.length = 0; this.groups.length = 0; }

  get alive() { return this.enemies.filter((e) => e.alive); }

  // ---------- targeting ----------
  /** Nearest alive enemy within range whose direction is inside a cone around `dir` (or any direction if cone ≥ π). */
  pickTarget(range, cone, dir, extra = null) {
    const p = this.game.player.pos;
    let best = null, bestScore = Infinity;
    const consider = (e, pos) => {
      const d = this._t.copy(pos).sub(p); const dist = d.length(); if (dist > range || dist < 0.01) return;
      d.divideScalar(dist);
      const ang = dir ? Math.acos(Math.max(-1, Math.min(1, d.x * dir.x + d.z * dir.z))) : 0;
      if (ang > cone) return;
      const score = dist + ang * 4;
      if (score < bestScore) { bestScore = score; best = e; }
    };
    for (const e of this.enemies) if (e.alive) consider(e, e.pos);
    if (extra) for (const x of extra) consider(x, x.pos);
    return best;
  }

  // ---------- main update ----------
  update(dt, input) {
    const P = this.game.player, C = CFG.combat, cam = this.game.camera;
    this.shootCd = Math.max(0, this.shootCd - dt); this.strikeCd = Math.max(0, this.strikeCd - dt); this.throwCd = Math.max(0, this.throwCd - dt); this.yankCd = Math.max(0, this.yankCd - dt);
    if (this.counterT > 0) { this.counterT -= dt; if (this.counterT <= 0) this.counter = null; }
    if (this.bomb.charges < 3 + (P.stats.bombCharges - 3)) { this.bomb.regen += dt; if (this.bomb.regen > 20) { this.bomb.regen = 0; this.bomb.charges++; } }
    if (this.combo > 0) { this.comboT += dt; if (this.comboT > C.comboDecay) { this.combo = 0; this.game.hud.combo(0); } }

    // enemies
    let near = false, nearest = null, nd = Infinity;
    this.senseEnemy = null; let senseT = Infinity;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.update(dt, P, this);
      if (e.dead) { e.dispose(); this.enemies.splice(i, 1); continue; }
      if (!e.alive) continue;
      const d = e.pos.distanceTo(P.pos);
      if (d < 22) near = true;
      if (d < nd) { nd = d; nearest = e; }
      if (e.state === 'windup') {
        const it = e.impactTime;
        if (it < senseT && d < (e.cfg.gun ? 40 : 6)) { senseT = it; this.senseEnemy = e; }
        if (!e.senseFired && d < 40) { e.senseFired = true; this.game.audio.sense(); }
      }
    }
    P.combatNear = near;
    cam.lockOn = near && nearest && nd < 14 && !P.airborne ? nearest.pos : null;

    // finisher cinematic
    if (this.finisher) {
      this.finisher.t += dt;
      if (this.finisher.t > 0.45 && !this.finisher.done) {
        this.finisher.done = true;
        const e = this.finisher.enemy;
        this.game.fx.burst(e.pos, 0xffd33a, 30, 9, 4); this.game.fx.ring(e.pos.clone().setY(e.pos.y - e.he.y + 0.1), 0xffd33a, 5);
        this.game.audio.punch(true); this.game.camera.addShake(0.7);
        e.ko(); this.game.hud.hitMarker();
      }
      if (this.finisher.t > 0.8) this.finisher = null;
      return;
    }

    // dive kick: falls onto the target, shockwave on impact
    if (this.diveKick) {
      const tgt = this.diveKick;
      if (!tgt.alive || P.state !== 'attack') this.diveKick = null;
      else {
        const d = this._t.copy(tgt.pos).sub(P.pos); d.y += 0.5;
        const dist = d.length();
        if (dist > 1.8 && !P.grounded) { d.divideScalar(dist); P.vel.copy(d).multiplyScalar(34); P.attackT = Math.max(P.attackT, 0.1); }
        else this._diveImpact();
      }
    }

    // attack phases
    if (P.state === 'attack') {
      const A = C.attack;
      const elapsed = (A.startup + A.active + A.recovery) - P.attackT;
      if (!this.hitApplied && elapsed >= A.startup) { this.hitApplied = true; this._applyHit(); }
      if (this.attackBuffer > 0 && elapsed >= A.startup + A.active + A.chainFrom) { this.attackBuffer = 0; this.attack(); }
    }
    if (this.attackBuffer > 0) this.attackBuffer -= dt;

    // ---------- input ----------
    if (!P.canAct) return;
    const canFight = P.state !== 'zip' && P.state !== 'wall';
    if (P.state === 'wall') {
      // wall combat: leap off into a strike (dive kick if they're below you), or kick off to dodge
      if (input.takeMouse('left')) this.wallLeap();
      if (input.take('KeyQ')) { const n = P.wallNormal; P.vel.set(n.x * 11, 9, n.z * 11); P.setState('dodge'); P.dodgeT = 0; P.invuln = 0.35; this.dodgeStart = this.game.time; this.game.audio.dodge(); }
    }
    if (input.takeMouse('left') && canFight) {
      if (P.state === 'attack') this.attackBuffer = 0.25; else this.attack();
    }
    if (input.take('KeyQ') && canFight && (P.state !== 'dodge' || P.dodgeT > 0.6)) this.dodge(input);
    if (input.take('KeyF') && this.strikeCd <= 0 && P.state !== 'zip') this.webStrike();
    if (input.take('KeyR') && this.shootCd <= 0) this.webShoot();
    if (input.take('KeyT')) { if (P.airborne && !this.pickTarget(4.5, Math.PI, null)) this.airTrick(); else if (this.throwCd <= 0) this.webThrow(); }
    if (input.take('KeyV') && this.yankCd <= 0) this.webYank();
    if (input.take('KeyG')) this.tryFinisher();
    if (input.take('KeyH')) this.tryHeal();
    if (input.take('Digit1')) this.webBomb();
  }

  // ---------- player actions ----------
  attack() {
    const P = this.game.player, C = CFG.combat, A = C.attack;
    // Perfect-dodge counter: the next attack in the window is an instant web-strike on the attacker
    if (this.counter && this.counter.alive && this.counter.pos.distanceTo(P.pos) < 12) {
      const e = this.counter; this.counter = null; this.counterT = 0;
      this.game.hud.alert('COUNTER', 'gold small'); this.game.slowmo(0.25, 0.4);
      P.startZipTo(e.pos, new THREE.Vector3(0, 1, 0), e); return;
    }
    const dir = P.heading(this._t2);
    const target = this.pickTarget(C.lungeRange + (P.airborne ? 3 : 0), C.lungeCone, dir) || this.pickTarget(C.attackRange + 1, Math.PI, null);
    // Dive kick: airborne and well above someone → drop onto them with a shockwave
    if (P.airborne && !this.diveKick && P.state !== 'zip') {
      let below = null, bd = Infinity;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const hd = Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z), dy = P.pos.y - e.pos.y;
        if (dy > 2.5 && dy < 40 && hd < 10 && hd < bd) { bd = hd; below = e; }
      }
      if (below) {
        this.diveKick = below; P.attackTarget = below; P.attackIdx = 2; P.setState('attack'); P.attackT = 1.4; this.hitApplied = true;
        P.yaw = Math.atan2(below.pos.x - P.pos.x, below.pos.z - P.pos.z);
        if (P.web.active) P.web.release();
        this.game.audio.thwip(); return;
      }
    }
    if (this.comboT > C.comboWindow * 2 || P.attackIdx >= 3 || P.state !== 'attack') P.attackIdx = (P.state === 'attack' && this.comboT < C.comboWindow * 2) ? (P.attackIdx + 1) % 4 : 0;
    else P.attackIdx = (P.attackIdx + 1) % 4;
    P.attackTarget = target;
    P.setState('attack');
    P.attackT = A.startup + A.active + A.recovery;
    this.hitApplied = false;
    if (target) {
      const d = this._t.copy(target.pos).sub(P.pos);
      const dist = d.length();
      if (dist > C.attackRange * 0.7) {
        // lunge: close to ~1.2 m over startup+active, up to 3.5 m (research: 3 m)
        const travel = Math.min(dist - 1.2, P.airborne ? 6 : 3.5);
        d.divideScalar(dist);
        P.vel.copy(d).multiplyScalar(travel / (A.startup + A.active));
        if (!P.airborne) P.vel.y = Math.max(P.vel.y, target.state === 'juggle' ? 7 : 1.5);
      } else { P.vel.x *= 0.3; P.vel.z *= 0.3; }
      P.yaw = Math.atan2(target.pos.x - P.pos.x, target.pos.z - P.pos.z);
    } else {
      P.vel.x *= 0.5; P.vel.z *= 0.5;
    }
  }

  _applyHit() {
    const P = this.game.player, C = CFG.combat;
    const idx = P.attackIdx, target = P.attackTarget;
    const heavy = idx === 3;
    const dmg = C.hitDamage[idx] * P.stats.damageMul;
    const dir = P.heading(this._t2);
    let hitSomething = false;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = this._t.copy(e.pos).sub(P.pos);
      const dist = d.length();
      const isTarget = e === target;
      if (dist > (isTarget ? C.attackRange * 1.6 : C.attackRange * 0.9)) continue;
      d.y = 0; d.normalize();
      const facing = Math.sin(P.yaw) * d.x + Math.cos(P.yaw) * d.z;
      if (!isTarget && facing < 0.3) continue;
      const res = e.takeHit(isTarget ? dmg : dmg * 0.5, d, { launch: heavy, heavy, fromAbove: P.pos.y - e.pos.y > 1.5 });
      if (res === 'blocked') { this.game.hud.hint('Shield! Web-shoot <kbd>R</kbd>, web-strike <kbd>F</kbd>, or hit from behind', 2); this.game.audio.punch(false); P.vel.multiplyScalar(-0.3); continue; }
      hitSomething = true;
      this.game.fx.burst(e.pos, heavy ? 0xffd33a : 0xffffff, heavy ? 16 : 7, heavy ? 6 : 3, 2);
      if (heavy && res !== 'ko' && !e.cfg.heavy && P.grounded) { P.vel.y = 8; P.grounded = false; } // follow the launch into the air
      this.game.hud.hitMarker();
    }
    if (hitSomething) {
      this.game.audio.punch(heavy);
      this.game.hitstop(heavy ? C.hitstopHeavy : C.hitstop);
      this.game.camera.addShake(heavy ? 0.25 : 0.08);
      this.combo++; this.comboT = 0; this.game.hud.combo(this.combo);
      P.addFocus(C.focusPerHit * (heavy ? 1.6 : 1) * (1 + Math.min(this.combo, 20) * 0.03));
    }
  }

  dodge(input) {
    const P = this.game.player, C = CFG.combat;
    const cam = this.game.camera;
    const f = cam.forward(this._t), r = cam.right(this._t2);
    const mv = new THREE.Vector3().addScaledVector(f, input.axis('KeyS', 'KeyW')).addScaledVector(r, input.axis('KeyA', 'KeyD'));
    if (mv.lengthSq() < 0.01) {
      // dodge away from the most imminent threat, else backwards
      const threat = this.senseEnemy || this.pickTarget(6, Math.PI, null);
      if (threat) mv.copy(P.pos).sub(threat.pos).setY(0); else mv.copy(f).negate();
    }
    mv.normalize();
    P.dodgeDir.copy(mv);
    P.setState('dodge'); P.dodgeT = 0;
    P.vel.set(mv.x * C.dodge.speed, P.grounded ? 3.5 : 2, mv.z * C.dodge.speed);
    P.invuln = Math.max(P.invuln, C.dodge.iframes);
    this.dodgeStart = this.game.time;
    this.game.audio.dodge();
    this.game.fx.burst(P.pos, 0xffffff, 5, 2, 0.5);
  }

  /** Called by enemies at impact time. */
  playerEvading() {
    const P = this.game.player, C = CFG.combat;
    if (P.state !== 'dodge') return { iframes: false, perfect: false };
    const el = this.game.time - this.dodgeStart;
    return { iframes: el < C.dodge.iframes, perfect: el < C.perfectWindow };
  }

  perfectDodge(enemy) {
    const P = this.game.player, C = CFG.combat;
    this.game.slowmo(C.perfectSlow.time, C.perfectSlow.scale);
    P.addFocus(C.focusPerfectDodge);
    enemy.stun(1.1); enemy.shieldUp = enemy.cfg.shield; // brief stagger window for a counter
    this.counter = enemy; this.counterT = 0.9;
    this.game.hud.hint('<kbd>LMB</kbd> now to counter', 1);
    this.game.hud.alert('PERFECT DODGE', 'gold small');
    this.game.fx.ring(P.pos.clone().setY(P.pos.y - P.he.y + 0.1), 0xffffff, 3);
    this.game.audio.sense();
  }

  hitPlayer(enemy, dmg, heavy = false) {
    const P = this.game.player;
    if (!P.damage(dmg, enemy.pos)) return;
    if (heavy) this.game.camera.addShake(0.5);
    this.combo = 0; this.game.hud.combo(0);
  }

  webStrike() {
    const P = this.game.player;
    const dir = this._t2.set(0, 0, -1).applyQuaternion(this.game.camera.cam.quaternion); dir.y = 0; dir.normalize();
    const extra = this.game.missions.strikeTargets();
    const target = this.pickTarget(30, 0.9, dir, extra) || this.pickTarget(14, Math.PI, null, extra);
    if (!target) { this.game.hud.hint('No target in range for web-strike', 1.2); return; }
    this.strikeCd = 0.5;
    P.startZipTo(target.pos, new THREE.Vector3(0, 1, 0), target);
    this.game.hud.hint('', 0);
  }

  onWebStrikeArrive(target) {
    const P = this.game.player, C = CFG.combat;
    if (target.isVan) { target.takeHit(); P.vel.set(0, 9, 0); P.setState('jump'); this.game.fx.burst(P.pos, 0xffffff, 14, 6, 3); this.game.audio.punch(true); this.game.hitstop(0.08); return; }
    const d = this._t.copy(target.pos).sub(P.pos).setY(0).normalize();
    const res = target.takeHit(25 * P.stats.damageMul, d, { launch: !target.cfg.heavy, heavy: true, fromAbove: true, ignoreShield: true });
    target.shieldUp = false;
    P.attackIdx = 3; P.attackTarget = target; P.setState('attack'); P.attackT = 0.25; this.hitApplied = true;
    P.vel.set(-d.x * 3, 7, -d.z * 3); P.grounded = false;
    this.game.fx.burst(target.pos, 0xffffff, 18, 7, 3);
    this.game.audio.punch(true); this.game.hitstop(C.hitstopHeavy); this.game.camera.addShake(0.3);
    this.combo++; this.comboT = 0; this.game.hud.combo(this.combo); this.game.hud.hitMarker();
    P.addFocus(C.focusPerHit * 2);
    if (res === 'ko') {} // handled by enemy.ko
  }

  webShoot() {
    const P = this.game.player;
    this.shootCd = 0.45;
    const cam = this.game.camera.cam;
    const dir = this._t2.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const hDir = this._t.copy(dir).setY(0).normalize();
    const target = this.pickTarget(24, 0.6, hDir);
    const hand = P.handWorld(new THREE.Vector3(), true);
    this.game.audio.thwip();
    if (target) {
      this.webShots.fire(hand, target.pos.clone().setY(target.pos.y + 0.3), 0.3);
      target.stun(target.cfg.heavy ? 2 : 3.2);
      this.game.fx.burst(target.pos, 0xffffff, 8, 2, 1);
      P.addFocus(4);
    } else {
      this.webShots.fire(hand, hand.clone().addScaledVector(dir, 22), 0.2);
    }
  }

  tryFinisher() {
    const P = this.game.player, C = CFG.combat;
    const target = P.attackTarget && P.attackTarget.alive && P.attackTarget.pos.distanceTo(P.pos) < 5 ? P.attackTarget : this.pickTarget(5, Math.PI, null);
    if (!target) { this.game.hud.hint('No enemy close enough for a finisher', 1.2); return; }
    const cost = target.cfg.heavy ? C.focusFinisherCost * 2 : C.focusFinisherCost;
    if (P.focus < cost) { this.game.hud.hint(`Need ${cost === C.focusFinisherCost ? 'a full' : 'two'} Focus bar${cost > 100 ? 's' : ''} for a finisher`, 1.5); return; }
    P.focus -= cost;
    this.finisher = { enemy: target, t: 0, done: false };
    target.stun(2); // suppressed during the cinematic
    P.attackIdx = 3; P.attackTarget = target; P.setState('attack'); P.attackT = 0.8; this.hitApplied = true;
    const d = this._t.copy(target.pos).sub(P.pos); const dist = d.length(); d.divideScalar(dist);
    P.vel.copy(d).multiplyScalar(Math.max(0, dist - 1.3) / 0.4); P.vel.y = 4;
    this.game.slowmo(0.6, 0.3);
    this.game.hud.alert('FINISHER', 'gold small');
  }

  tryHeal() {
    const P = this.game.player, C = CFG.combat;
    if (P.focus < C.focusHealCost) { this.game.hud.hint('Need a full Focus bar to heal', 1.5); return; }
    if (P.hp >= P.maxHp) { this.game.hud.hint('Health already full', 1); return; }
    P.focus -= C.focusHealCost; P.hp = Math.min(P.maxHp, P.hp + C.healAmount * P.stats.healMul);
    this.game.fx.burst(P.pos, 0x4cff88, 20, 3, 3); this.game.audio.pickup();
  }

  webBomb() {
    const P = this.game.player;
    if (this.bomb.charges <= 0) { this.game.hud.hint('Web bomb recharging…', 1); return; }
    this.bomb.charges--;
    this.game.fx.ring(P.pos.clone().setY(P.pos.y - P.he.y + 0.1), 0xffffff, 9); this.game.fx.burst(P.pos, 0xffffff, 40, 10, 3);
    this.game.audio.thwip(); this.game.audio.land(false);
    let n = 0;
    for (const e of this.enemies) if (e.alive && e.pos.distanceTo(P.pos) < 9) { e.stun(4); n++; }
    this.game.hud.alert(n ? `WEB BOMB · ${n} WEBBED` : 'WEB BOMB', 'small');
  }

  tracer(from, to) { this.tracers.fire(from, to, 0.08); }

  /** Count a hit toward the combo/focus (used by thrown bodies and special moves). */
  registerHit(focus = CFG.combat.focusPerHit) {
    this.combo++; this.comboT = 0; this.game.hud.combo(this.combo); this.game.hud.hitMarker();
    this.game.player.addFocus(focus);
  }

  _diveImpact() {
    const P = this.game.player, C = CFG.combat;
    const tgt = this.diveKick; this.diveKick = null;
    const center = tgt.pos;
    let n = 0;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dist = e.pos.distanceTo(center);
      if (dist > 4.5) continue;
      const d = this._t.copy(e.pos).sub(center).setY(0); if (d.lengthSq() < 0.01) d.copy(P.heading(this._t2)); d.normalize();
      e.takeHit((e === tgt ? 28 : 18) * P.stats.damageMul, d, { heavy: true, launch: e !== tgt && !e.cfg.heavy, fromAbove: true, ignoreShield: true });
      n++;
    }
    P.vel.set(0, 4, 0); P.attackT = 0.25; P.attackIdx = 3;
    this.game.fx.ring(center.clone().setY(center.y - tgt.he.y + 0.1), 0xffffff, 6); this.game.fx.burst(center, 0xffffff, 26, 8, 3);
    this.game.audio.punch(true); this.game.audio.land(true); this.game.hitstop(0.12); this.game.camera.addShake(0.5);
    if (n) { this.registerHit(C.focusPerHit * 2); this.game.hud.alert('DIVE KICK', 'gold small'); }
  }

  /** Leap off a wall into an enemy: web-strike them, or dive-kick if they're below. */
  wallLeap() {
    const P = this.game.player;
    const target = this.pickTarget(28, Math.PI, null);
    const n = P.wallNormal;
    if (!target) { P.vel.set(n.x * 8, 9, n.z * 8); P.setState('jump'); this.game.audio.jump(); return; }
    P.vel.set(n.x * 6, 6, n.z * 6); P.setState('fall'); P.grounded = false;
    const hd = Math.hypot(target.pos.x - P.pos.x, target.pos.z - P.pos.z);
    if (P.pos.y - target.pos.y > 2.5 && hd < 10) { this.attack(); return; } // → dive kick
    this.strikeCd = 0.5; P.startZipTo(target.pos, new THREE.Vector3(0, 1, 0), target);
  }

  /** Web Throw (T): grab the nearest thug and hurl him where you're looking. Bowls over anyone in the way. */
  webThrow() {
    const P = this.game.player;
    if (P.airborne) return;
    const stunned = this.enemies.filter((e) => e.alive && e.state === 'stun' && e.pos.distanceTo(P.pos) < 5);
    const target = stunned[0] || this.pickTarget(4.5, Math.PI, null);
    if (!target) { this.game.hud.hint('Nobody close enough to throw', 1); return; }
    if (target.cfg.heavy && target.state !== 'stun') { this.game.hud.hint('Too heavy — web him first (<kbd>R</kbd>)', 1.5); return; }
    this.throwCd = 0.8;
    const dir = this._t2.set(0, 0, -1).applyQuaternion(this.game.camera.cam.quaternion); dir.y = 0; dir.normalize();
    // prefer aiming at another enemy roughly in front
    const bowl = this.pickTarget(18, 0.6, dir, null);
    if (bowl && bowl !== target) { dir.copy(bowl.pos).sub(target.pos).setY(0).normalize(); }
    target.pos.copy(P.pos).addScaledVector(dir, 1.2); target.pos.y = P.pos.y + 0.6;
    target.throwAlong(dir, 26);
    P.attackIdx = 3; P.attackTarget = target; P.setState('attack'); P.attackT = 0.4; this.hitApplied = true;
    P.yaw = Math.atan2(dir.x, dir.z); P.vel.set(0, 0, 0);
    this.game.fx.burst(P.pos, 0xffffff, 10, 3, 2); this.game.audio.thwip(); this.game.audio.dodge();
    this.game.camera.addShake(0.15); this.game.hud.alert('WEB THROW', 'gold small');
    this.registerHit(6);
  }

  /** Web Yank (V): pull a distant enemy (gunmen!) to your feet, helpless. */
  webYank() {
    const P = this.game.player;
    const dir = this._t2.set(0, 0, -1).applyQuaternion(this.game.camera.cam.quaternion); dir.y = 0; dir.normalize();
    const target = this.pickTarget(26, 0.7, dir) || this.pickTarget(12, Math.PI, null);
    if (!target) { this.game.hud.hint('No target to yank', 1); return; }
    if (target.cfg.heavy && target.state !== 'stun') { this.game.hud.hint('Too heavy to yank — web him first (<kbd>R</kbd>)', 1.5); return; }
    this.yankCd = 0.9;
    const hand = P.handWorld(new THREE.Vector3(), false);
    this.webShots.fire(hand, target.pos.clone().setY(target.pos.y + 0.3), 0.25);
    target.yankTo(P.pos.clone().addScaledVector(dir, 1.5));
    P.attackIdx = 1; P.attackTarget = target; P.setState('attack'); P.attackT = 0.3; this.hitApplied = true;
    P.yaw = Math.atan2(target.pos.x - P.pos.x, target.pos.z - P.pos.z);
    this.game.audio.thwip(); this.game.hud.alert('WEB YANK', 'small');
    P.addFocus(5);
  }

  /** Air trick (T while airborne with no one around): style points → Focus + XP. */
  airTrick() {
    const P = this.game.player;
    if (P.trickT > 0) return;
    P.trickT = 0.7; P.tricks++;
    P.addFocus(8); this.game.missions.addXP(5);
    this.game.audio.dodge(); this.game.hud.alert(['FLIP', 'TWIST', 'SPIDER SPIN', 'CORKSCREW'][P.tricks % 4], 'small');
  }

  onEnemyKO(e) {
    this.game.audio.ko();
    this.game.fx.burst(e.pos, 0xffd33a, 10, 4, 3);
    this.onKO?.(e);
  }

  updateVisual(dt) { this.webShots.update(dt); this.tracers.update(dt); }

  enemyMarkers(out) { for (const e of this.enemies) if (e.alive) out.push({ x: e.pos.x, z: e.pos.z, color: '#ff3b3b', r: 3.5 }); return out; }
}
