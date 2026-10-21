import * as THREE from 'three';
import { CFG } from '../core/Config.js';
import { damp, clamp, shortestAngle } from '../core/Utils.js';

/** Archetypes — each forbids one player strategy (research §2). */
export const ENEMY_TYPES = {
  grunt:  { hp: 40,  speed: 6.5, range: 2.0, damage: 10, color: 0x3a3f4a, scale: 1.0,  windup: 0.42, cooldown: [1.1, 1.9], label: 'Thug' },
  ranged: { hp: 30,  speed: 5.5, range: 16,  keep: 11, damage: 8,  color: 0x5a2f2f, scale: 1.0,  windup: 0.55, cooldown: [1.6, 2.6], gun: true, label: 'Gunman' },
  shield: { hp: 60,  speed: 5.0, range: 2.2, damage: 12, color: 0x2f4a3a, scale: 1.05, windup: 0.45, cooldown: [1.3, 2.1], shield: true, label: 'Shield' },
  brute:  { hp: 180, speed: 4.6, range: 2.8, damage: 22, color: 0x4a3524, scale: 1.45, windup: 0.62, cooldown: [1.6, 2.4], heavy: true, label: 'Brute' },
};

const POSES = {
  idle:   { torso: [0.05, 0, 0], shL: [0.2, 0, 0.2], shR: [0.2, 0, -0.2], elL: [-0.4, 0, 0], elR: [-0.4, 0, 0], hipL: [0, 0, 0.05], hipR: [0, 0, -0.05], knL: [0.05, 0, 0], knR: [0.05, 0, 0] },
  windup: { torso: [-0.15, 0.6, 0], shL: [0.3, 0, 0.4], shR: [1.2, 0, -0.9], elL: [-0.6, 0, 0], elR: [-1.9, 0, 0], hipL: [0.2, 0, 0.1], hipR: [-0.2, 0, -0.1], knL: [0.3, 0, 0], knR: [0.4, 0, 0] },
  attack: { torso: [0.35, -0.5, 0], shL: [0.3, 0, 0.4], shR: [-1.8, 0, -0.1], elL: [-0.6, 0, 0], elR: [-0.1, 0, 0], hipL: [-0.4, 0, 0.1], hipR: [0.3, 0, -0.1], knL: [0.5, 0, 0], knR: [0.2, 0, 0] },
  aim:    { torso: [0.05, -0.3, 0], shL: [-1.2, 0, 0.6], shR: [-1.5, 0, -0.1], elL: [-0.9, 0, 0], elR: [-0.1, 0, 0], hipL: [0, 0, 0.15], hipR: [0, 0, -0.15], knL: [0.05, 0, 0], knR: [0.05, 0, 0] },
  guard:  { torso: [0.1, 0.3, 0], shL: [-1.1, 0.4, 0.3], shR: [0.6, 0, -0.4], elL: [-1.6, 0, 0], elR: [-1.2, 0, 0], hipL: [-0.2, 0, 0.2], hipR: [0.2, 0, -0.2], knL: [0.4, 0, 0], knR: [0.3, 0, 0] },
  hurt:   { torso: [-0.45, 0, 0.15], shL: [-0.9, 0, 0.9], shR: [-0.9, 0, -0.9], elL: [-1.0, 0, 0], elR: [-1.0, 0, 0], hipL: [-0.3, 0, 0.3], hipR: [0.3, 0, -0.3], knL: [0.6, 0, 0], knR: [0.4, 0, 0] },
  juggle: { torso: [-0.8, 0, 0.3], shL: [0.9, 0, 1.4], shR: [0.9, 0, -1.4], elL: [-0.4, 0, 0], elR: [-0.4, 0, 0], hipL: [-0.9, 0, 0.4], hipR: [0.2, 0, -0.4], knL: [1.2, 0, 0], knR: [0.6, 0, 0] },
  stun:   { torso: [0.2, 0, 0], shL: [-0.3, 0, 0.1], shR: [-0.3, 0, -0.1], elL: [-1.8, 0, 0], elR: [-1.8, 0, 0], hipL: [0.1, 0, 0.05], hipR: [0.1, 0, -0.05], knL: [0.2, 0, 0], knR: [0.2, 0, 0] },
  ko:     { torso: [0.1, 0, 0], shL: [0.4, 0, 1.2], shR: [0.4, 0, -1.2], elL: [-0.3, 0, 0], elR: [-0.3, 0, 0], hipL: [0.2, 0, 0.3], hipR: [0.1, 0, -0.3], knL: [0.4, 0, 0], knR: [0.2, 0, 0] },
};

class EnemyModel {
  constructor(cfg) {
    this.root = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0xc9a07a, roughness: 0.8 });
    const cloth = new THREE.MeshStandardMaterial({ color: cfg.color, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.9 });
    const cap = (r, len, mat) => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 3, 8), mat); m.castShadow = true; return m; };
    this.hips = new THREE.Group(); this.root.add(this.hips);
    this.torso = new THREE.Group(); this.torso.position.y = 0.05; this.hips.add(this.torso);
    const pelvis = cap(0.17, 0.1, dark); this.hips.add(pelvis);
    const chest = cap(0.21, 0.34, cloth); chest.position.y = 0.32; chest.scale.set(1.25, 1, 0.8); this.torso.add(chest);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 12), skin); head.position.y = 0.76; head.castShadow = true; this.torso.add(head);
    const mask = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), dark); mask.position.y = 0.77; this.torso.add(mask);
    const limb = (parent, pos, r1, l1, r2, l2, m1, m2) => {
      const p = new THREE.Group(); p.position.copy(pos); parent.add(p);
      const upper = cap(r1, l1, m1); upper.position.y = -(l1 / 2 + r1 * 0.3); p.add(upper);
      const joint = new THREE.Group(); joint.position.y = -(l1 + r1 * 0.6); p.add(joint);
      const lower = cap(r2, l2, m2); lower.position.y = -(l2 / 2 + r2 * 0.3); joint.add(lower);
      const end = new THREE.Mesh(new THREE.SphereGeometry(r2 * 1.1, 8, 8), m2 === cloth ? skin : dark); end.position.y = -(l2 + r2 * 0.6); joint.add(end);
      return { pivot: p, joint, end };
    };
    this.armL = limb(this.torso, new THREE.Vector3(-0.28, 0.52, 0), 0.07, 0.26, 0.06, 0.26, cloth, cloth);
    this.armR = limb(this.torso, new THREE.Vector3(0.28, 0.52, 0), 0.07, 0.26, 0.06, 0.26, cloth, cloth);
    this.legL = limb(this.hips, new THREE.Vector3(-0.13, -0.02, 0), 0.09, 0.36, 0.075, 0.36, dark, dark);
    this.legR = limb(this.hips, new THREE.Vector3(0.13, -0.02, 0), 0.09, 0.36, 0.075, 0.36, dark, dark);
    if (cfg.shield) {
      this.shield = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.2, 0.08), new THREE.MeshStandardMaterial({ color: 0x8a939e, metalness: 0.7, roughness: 0.35 }));
      this.shield.position.set(0, -0.45, 0.12); this.shield.castShadow = true; this.armL.joint.add(this.shield);
    }
    if (cfg.gun) {
      const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.5), dark); gun.position.set(0, -0.5, 0.2); this.armR.joint.add(gun);
    }
    // web cocoon shown while stunned
    this.cocoon = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.9, 4, 10), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, transparent: true, opacity: 0.85 }));
    this.cocoon.position.y = 0.2; this.cocoon.visible = false; this.hips.add(this.cocoon);
    this.root.scale.setScalar(cfg.scale);
    this.flashT = 0; this.flashMats = [cloth, skin, dark];
    this.parts = { torso: this.torso, shL: this.armL.pivot, shR: this.armR.pivot, elL: this.armL.joint, elR: this.armR.joint, hipL: this.legL.pivot, hipR: this.legR.pivot, knL: this.legL.joint, knR: this.legR.joint };
    this._pose = {}; for (const k in this.parts) this._pose[k] = new THREE.Euler();
    this.phase = 0;
  }
  flash() { this.flashT = 0.12; }
  update(dt, state, speed, cfg) {
    let pose = POSES.idle, rate = 14, walk = false;
    if (state === 'approach') walk = speed > 0.5;
    else if (state === 'windup') pose = cfg.gun ? POSES.aim : POSES.windup;
    else if (state === 'attack') pose = cfg.gun ? POSES.aim : POSES.attack;
    else if (state === 'hurt') pose = POSES.hurt;
    else if (state === 'juggle') pose = POSES.juggle;
    else if (state === 'stun') pose = POSES.stun;
    else if (state === 'ko') pose = POSES.ko;
    else if (cfg.shield) pose = POSES.guard;
    const t = {};
    if (walk) {
      this.phase += dt * speed * 1.6;
      const s = Math.sin(this.phase), s2 = Math.sin(this.phase + Math.PI);
      t.torso = [0.1, 0, 0]; t.shL = [s2 * 0.6, 0, 0.2]; t.shR = [s * 0.6, 0, -0.2]; t.elL = [-0.5, 0, 0]; t.elR = [-0.5, 0, 0];
      t.hipL = [s * 0.7, 0, 0.05]; t.hipR = [s2 * 0.7, 0, -0.05]; t.knL = [Math.max(0, -s2) * 1.2 + 0.1, 0, 0]; t.knR = [Math.max(0, -s) * 1.2 + 0.1, 0, 0];
      if (cfg.shield) { t.shL = POSES.guard.shL; t.elL = POSES.guard.elL; }
    } else for (const k in this.parts) t[k] = pose[k] || POSES.idle[k];
    for (const k in this.parts) {
      const e = this._pose[k], g = t[k];
      e.x = damp(e.x, g[0], rate, dt); e.y = damp(e.y, g[1], rate, dt); e.z = damp(e.z, g[2], rate, dt);
      this.parts[k].rotation.copy(e);
    }
    this.cocoon.visible = state === 'stun';
    if (this.flashT > 0) { this.flashT -= dt; const k = Math.max(0, this.flashT / 0.12); for (const m of this.flashMats) { m.emissive.setRGB(k, k, k); m.emissiveIntensity = 0.9; } }
    this.hips.rotation.x = damp(this.hips.rotation.x, state === 'ko' ? -Math.PI / 2 : (state === 'juggle' ? -0.6 : 0), 10, dt);
    this.hips.position.y = damp(this.hips.position.y, state === 'ko' ? -0.7 : 0, 10, dt);
  }
}

export class Enemy {
  constructor(game, type, pos) {
    this.game = game; this.type = type; this.cfg = ENEMY_TYPES[type];
    this.pos = pos.clone(); this.vel = new THREE.Vector3(); this.yaw = 0;
    this.he = new THREE.Vector3(0.4 * this.cfg.scale, 0.9 * this.cfg.scale, 0.4 * this.cfg.scale);
    this.pos.y = game.city.heightAt(pos.x, pos.z) + this.he.y;
    this.hp = this.cfg.hp; this.maxHp = this.cfg.hp;
    this.state = 'approach'; this.t = 0; this.cooldown = 1 + Math.random();
    this.stunT = 0; this.shieldUp = !!this.cfg.shield; this.juggleHits = 0; this.grounded = true;
    this.alive = true; this.dead = false; this.senseFired = false; this.thrown = false; this.thrownHits = 0;
    this.model = new EnemyModel(this.cfg);
    this.model.root.rotation.order = 'YXZ';
    game.scene.add(this.model.root);
    this.contact = { ground: false, wall: false, wallNormal: new THREE.Vector3(), ceiling: false };
    this._t = new THREE.Vector3(); this.speedNow = 0;
    this.group = null;
  }

  get head() { return this._t.copy(this.pos).setY(this.pos.y + 1.0 * this.cfg.scale); }
  get impactTime() { return this.state === 'windup' ? this.cfg.windup + CFG.combat.perfectWindow - this.t : Infinity; }

  update(dt, player, combat) {
    const C = CFG.combat, cfg = this.cfg;
    this.t += dt;
    const toP = this._t.copy(player.pos).sub(this.pos); toP.y = 0;
    const dist = toP.length(); if (dist > 0.01) toP.divideScalar(dist);
    const hDiff = player.pos.y - this.pos.y;
    const faceP = () => { this.yaw += shortestAngle(this.yaw, Math.atan2(toP.x, toP.z)) * (1 - Math.exp(-10 * dt)); };
    let wantVel = 0;

    if (this.state === 'ko') {
      if (this.t > 4.5) { this.dead = true; }
      if (this.t > 2.5) this.model.root.position.y -= dt * 0.7; // sink away
      this.vel.x = damp(this.vel.x, 0, 6, dt); this.vel.z = damp(this.vel.z, 0, 6, dt);
    } else if (this.state === 'stun') {
      this.stunT -= dt; if (this.stunT <= 0) { this.state = 'approach'; this.t = 0; }
    } else if (this.state === 'juggle') {
      // in the air: float while the player keeps hitting, otherwise fall
      if (this.grounded && this.t > 0.15) { this.state = this.hp > 0 ? 'hurt' : 'ko'; this.t = 0; this.juggleHits = 0; }
    } else if (this.state === 'hurt') {
      if (this.t > 0.35) { this.state = 'approach'; this.t = 0; }
    } else if (this.state === 'approach') {
      faceP();
      this.cooldown -= dt;
      if (cfg.gun) {
        if (dist < cfg.keep - 3) wantVel = -cfg.speed * 0.7; else if (dist > cfg.keep + 3) wantVel = cfg.speed;
        if (dist < cfg.range && Math.abs(hDiff) < 25 && this.cooldown <= 0) { this.state = 'windup'; this.t = 0; this.senseFired = false; }
      } else {
        if (dist > cfg.range * 0.85) wantVel = cfg.speed;
        if (dist <= cfg.range + 0.4 && Math.abs(hDiff) < 2.5 && this.cooldown <= 0) { this.state = 'windup'; this.t = 0; this.senseFired = false; }
      }
    } else if (this.state === 'windup') {
      faceP();
      const total = cfg.windup + C.perfectWindow + C.lateWindow;
      if (this.t >= total) { this.state = 'attack'; this.t = 0; this._impact(player, combat, dist, hDiff, toP); }
    } else if (this.state === 'attack') {
      if (this.t > 0.35) { this.state = 'approach'; this.t = 0; this.cooldown = cfg.cooldown[0] + Math.random() * (cfg.cooldown[1] - cfg.cooldown[0]); }
    }

    // locomotion
    if (this.state === 'approach' || this.state === 'stun' && false) {
      this.vel.x = damp(this.vel.x, toP.x * wantVel, 8, dt); this.vel.z = damp(this.vel.z, toP.z * wantVel, 8, dt);
      // separation from other enemies
      for (const o of combat.enemies) {
        if (o === this || !o.alive) continue;
        const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, d2 = dx * dx + dz * dz;
        if (d2 < 2.5 && d2 > 0.001) { const d = Math.sqrt(d2); this.vel.x += dx / d * 3 * dt * 10; this.vel.z += dz / d * 3 * dt * 10; }
      }
    } else if (this.state !== 'ko' && this.state !== 'juggle' && this.state !== 'hurt') { this.vel.x = damp(this.vel.x, 0, 10, dt); this.vel.z = damp(this.vel.z, 0, 10, dt); }
    else if (this.state === 'hurt') { this.vel.x = damp(this.vel.x, 0, 5, dt); this.vel.z = damp(this.vel.z, 0, 5, dt); }

    // gravity + collide
    const juggleFloat = this.state === 'juggle' && player.state === 'attack' && !this.thrown;
    this.vel.y -= CFG.gravity * (juggleFloat ? C.juggleGravity : 1) * dt;
    const prevVy = this.vel.y;
    this.pos.addScaledVector(this.vel, dt);
    this.game.city.resolveBox(this.pos, this.he, this.contact);
    this.grounded = this.contact.ground;
    // thrown bodies bowl over whoever they hit, and slam into walls
    if (this.thrown) {
      const sp = this.vel.length();
      for (const o of combat.enemies) {
        if (o === this || !o.alive || o.thrown) continue;
        if (o.pos.distanceTo(this.pos) < 1.6 + 0.5 * o.cfg.scale) {
          const d = o.pos.clone().sub(this.pos).setY(0).normalize();
          o.takeHit(30, d, { heavy: true, launch: !o.cfg.heavy, ignoreShield: true });
          this.game.fx.burst(o.pos, 0xffffff, 12, 5, 2); this.game.audio.punch(true); this.game.hitstop(0.05);
          combat.registerHit(); this.thrownHits++;
        }
      }
      if (this.contact.wall || (this.grounded && sp < 8) || (this.grounded && this.t > 0.3)) {
        this.thrown = false;
        const res = this.takeHit(45, this.vel.clone().setY(0).normalize(), { heavy: true, ignoreShield: true });
        this.game.fx.burst(this.pos, 0xffd33a, 14, 5, 2); this.game.audio.land(true);
        if (res !== 'ko') { this.state = 'hurt'; this.t = -0.5; }
        combat.registerHit();
      }
    }
    if (this.grounded && prevVy < -18 && this.alive) { // fell off a roof
      const res = this.takeHit(60, new THREE.Vector3(), { heavy: true, ignoreShield: true });
      this.game.fx.burst(this.pos, 0xbbbbbb, 10, 3, 2);
      if (res !== 'ko') { this.state = 'hurt'; this.t = -0.4; }
    }
    if (this.grounded && this.vel.y < 0) this.vel.y = 0;
    this.speedNow = Math.hypot(this.vel.x, this.vel.z);

    // visuals
    const r = this.model.root;
    if (this.state !== 'ko' || this.t <= 2.5) r.position.copy(this.pos);
    r.rotation.y = this.yaw;
    this.model.update(dt, this.state, this.speedNow, cfg);
  }

  _impact(player, combat, dist, hDiff, toP) {
    const cfg = this.cfg;
    if (cfg.gun) {
      // hitscan; fast-moving or dodging players are hard to hit
      combat.tracer(this.pos.clone().setY(this.pos.y + 0.6), player.pos);
      this.game.audio.gunshot();
      const evade = combat.playerEvading();
      const missChance = evade.iframes ? 1 : (player.speed > 18 ? 0.65 : player.state === 'swing' ? 0.5 : 0.1);
      if (Math.random() < missChance) { if (evade.perfect) combat.perfectDodge(this); return; }
      combat.hitPlayer(this, cfg.damage);
    } else {
      const evade = combat.playerEvading();
      if (evade.perfect) { combat.perfectDodge(this); return; }
      if (evade.iframes) return;
      if (dist <= cfg.range + 0.8 && Math.abs(hDiff) < 2.5) combat.hitPlayer(this, cfg.damage, cfg.heavy);
    }
  }

  /** Returns 'blocked' | 'hit' | 'ko' */
  takeHit(dmg, fromDir, opts = {}) {
    if (!this.alive) return 'dead';
    const { launch = false, heavy = false, fromAbove = false, ignoreShield = false } = opts;
    // Shield: blocks frontal attacks until broken (web-shoot / web-strike / attack from behind)
    if (this.shieldUp && !ignoreShield && !fromAbove) {
      const facing = Math.sin(this.yaw) * -fromDir.x + Math.cos(this.yaw) * -fromDir.z; // fromDir points from player to enemy
      if (facing > 0.2 && this.state !== 'stun') return 'blocked';
    }
    this.hp -= dmg;
    this.model.flash();
    this.juggleHits += this.state === 'juggle' ? 1 : 0;
    const canStagger = !this.cfg.heavy || this.state === 'stun' || heavy;
    if (this.hp <= 0) { this.ko(); return 'ko'; }
    if (this.state === 'stun' && !heavy) { /* stays webbed but takes damage */ }
    else if (launch && (!this.cfg.heavy || this.state === 'stun') && this.juggleHits < 8) {
      this.state = 'juggle'; this.t = 0; this.vel.y = 9; this.vel.x = fromDir.x * 2; this.vel.z = fromDir.z * 2; this.grounded = false;
    } else if (this.state === 'juggle') {
      this.vel.y = Math.max(this.vel.y, 4); this.t = 0;
    } else if (canStagger) {
      this.state = 'hurt'; this.t = 0;
      const kb = heavy ? 9 : 4;
      this.vel.x = fromDir.x * kb; this.vel.z = fromDir.z * kb; this.vel.y = heavy ? 3 : 1;
    }
    return 'hit';
  }

  stun(seconds) { if (!this.alive) return; this.state = 'stun'; this.stunT = seconds; this.shieldUp = false; this.vel.set(0, 0, 0); this.thrown = false; }
  /** Launched through the air by the player (web throw): bowls over others, slams on impact. */
  throwAlong(dir, speed) {
    if (!this.alive) return;
    this.thrown = true; this.thrownHits = 0; this.state = 'juggle'; this.t = 0; this.grounded = false; this.shieldUp = false;
    this.vel.copy(dir).multiplyScalar(speed); this.vel.y += 5;
  }
  /** Yanked toward the player (web yank): airborne and helpless on arrival. */
  yankTo(target) {
    if (!this.alive) return;
    const d = target.clone().sub(this.pos); const dist = d.length(); d.divideScalar(dist);
    this.state = 'juggle'; this.t = 0; this.grounded = false; this.shieldUp = false; this.juggleHits = 0;
    this.vel.copy(d).multiplyScalar(Math.min(28, dist * 2.2)); this.vel.y += 6 + dist * 0.15;
  }
  ko() {
    if (!this.alive) return;
    this.alive = false; this.state = 'ko'; this.t = 0; this.hp = 0;
    this.game.combat.onEnemyKO(this);
  }
  dispose() { this.game.scene.remove(this.model.root); }
}
