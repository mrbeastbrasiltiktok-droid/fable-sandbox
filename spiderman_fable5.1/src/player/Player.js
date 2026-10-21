import * as THREE from 'three';
import { CFG } from '../core/Config.js';
import { clamp, damp, shortestAngle } from '../core/Utils.js';
import { SpiderModel } from './SpiderModel.js';
import { SwingAnchorFinder } from './Swing.js';
import { WebLine } from './WebLine.js';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Player controller. Fixed-timestep physics in step(); visuals in updateVisual().
 * States: idle run land jump fall swing zip wall attack dodge hurt ko
 */
export class Player {
  constructor(game) {
    this.game = game;
    this.city = game.city;
    this.pos = new THREE.Vector3(0, 60, 0);
    this.prevPos = this.pos.clone();
    this.renderPos = this.pos.clone();
    this.vel = new THREE.Vector3();
    this.he = new THREE.Vector3(0.4, 0.9, 0.4);
    this.yaw = 0;
    this.state = 'fall';
    this.stateT = 0;
    this.grounded = false;
    this.coyote = 0;
    this.contact = { ground: false, wall: false, wallNormal: new THREE.Vector3(), ceiling: false, roofY: 0, building: null };
    this.model = new SpiderModel();
    this.model.root.rotation.order = 'YXZ';
    game.scene.add(this.model.root);
    this.lean = 0; this.bank = 0;

    // swing
    this.anchorFinder = new SwingAnchorFinder(this.city);
    this.anchor = new THREE.Vector3(); this.anchorVisual = new THREE.Vector3(); this.swingHeading = new THREE.Vector3(0, 0, 1);
    this.anchorVirtual = false;
    this.ropeLen = 0;
    this.swingSide = 1;
    this.web = new WebLine(game.scene);
    this.swingT = 0;
    this.lastRelease = -10;
    this.swingCount = 0;
    this.maxSpeedThisSwing = 0;

    // zip
    this.zipTarget = new THREE.Vector3(); this.zipNormal = new THREE.Vector3(); this.zipStrike = null; this.zipCooldown = 0;

    // wall
    this.wallNormal = new THREE.Vector3(); this.wallRun = false; this.wallT = 0; this.wallVy = 0; this.wallYaw = 0;

    // combat (driven by Combat system)
    this.hp = CFG.combat.maxHealth; this.maxHp = CFG.combat.maxHealth;
    this.focus = 0; this.focusMax = CFG.combat.focusBars * CFG.combat.focusPerBar;
    this.attackIdx = 0; this.attackT = 0; this.attackTarget = null; this.dodgeT = 0; this.dodgeDir = new THREE.Vector3();
    this.combatNear = false;
    this.invuln = 0;
    this.stats = { swingBoost: 1, doubleJump: false, focusGain: 1, zipSpeed: 1, damageMul: 1, healMul: 1, bombCharges: 3 };
    this.jumpsLeft = 0;
    this.diving = false;
    this.airTime = 0;
    this.tricks = 0; this.trickT = 0; this.rollT = 0;

    this._move = new THREE.Vector3(); this._moveDir = new THREE.Vector3();
    this._t = new THREE.Vector3(); this._t2 = new THREE.Vector3(); this._heading = new THREE.Vector3();
    this._hit = { point: new THREE.Vector3(), normal: new THREE.Vector3() }; this._hit2 = { point: new THREE.Vector3(), normal: new THREE.Vector3() };
    this._zt = new THREE.Vector3(); this._zn = new THREE.Vector3(); this._zd = new THREE.Vector3();
  }

  setState(s) { if (this.state !== s) { this.prevState = this.state; this.state = s; this.stateT = 0; } }
  get speed() { return this.vel.length(); }
  get hSpeed() { return Math.hypot(this.vel.x, this.vel.z); }
  get airborne() { return this.state === 'jump' || this.state === 'fall' || this.state === 'swing' || this.state === 'zip'; }
  get canAct() { return this.state !== 'hurt' && this.state !== 'ko'; }
  get inCombatAnim() { return this.state === 'attack' || this.state === 'dodge' || this.state === 'hurt' || this.state === 'ko'; }

  /** Intended travel direction: velocity at speed, the camera's forward when slow (blended in between). */
  heading(out) {
    const hs = this.hSpeed;
    const f = this.game.camera.forward(this._hd || (this._hd = new THREE.Vector3()));
    if (hs < 1) return out.copy(f);
    const w = Math.min(0.6, hs / 18); // the camera always keeps ≥40% say: you steer swings by looking
    out.set(this.vel.x / hs * w + f.x * (1 - w), 0, this.vel.z / hs * w + f.z * (1 - w));
    return out.lengthSq() > 1e-4 ? out.normalize() : out.copy(f);
  }

  // ======================= physics step =======================
  step(dt, input) {
    const cam = this.game.camera;
    this.stateT += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.zipCooldown = Math.max(0, this.zipCooldown - dt);

    // Move input relative to camera
    const f = cam.forward(this._t), r = cam.right(this._t2);
    const mv = this._move.set(0, 0, 0);
    const ax = input.axis('KeyA', 'KeyD'), az = input.axis('KeyS', 'KeyW');
    if (this.canAct) mv.addScaledVector(f, az).addScaledVector(r, ax);
    if (mv.lengthSq() > 1) mv.normalize();
    const hasMove = mv.lengthSq() > 0.01;
    this._moveDir.copy(mv);

    this.prevPos.copy(this.pos);
    const s = this.state;
    if (s === 'idle' || s === 'run' || s === 'land') this._ground(dt, input, mv, hasMove);
    else if (s === 'jump' || s === 'fall') this._air(dt, input, mv, hasMove, ax);
    else if (s === 'swing') this._swing(dt, input, ax, az);
    else if (s === 'zip') this._zip(dt, input);
    else if (s === 'wall') this._wall(dt, input, ax, az);
    else if (s === 'roll') this._roll(dt);
    else this._combatMove(dt);

    if (s !== 'swing' && s !== 'zip') this.pos.addScaledVector(this.vel, dt);
    this._collide(dt);
    this.airTime = this.airborne ? this.airTime + dt : 0;
  }

  // ---------- ground ----------
  _ground(dt, input, mv, hasMove) {
    const C = CFG;
    if (!this.grounded) { this.coyote += dt; if (this.coyote > 0.12) { this.setState('fall'); return; } } else this.coyote = 0;
    this.jumpsLeft = this.stats.doubleJump ? 1 : 0;
    const sprint = input.down('ShiftLeft') || input.down('ShiftRight');
    const target = hasMove ? (sprint ? C.sprintSpeed : C.runSpeed) : 0;
    if (hasMove) {
      const rate = C.groundAccel / target * 1.2;
      this.vel.x = damp(this.vel.x, mv.x * target, rate, dt);
      this.vel.z = damp(this.vel.z, mv.z * target, rate, dt);
      this.yaw += shortestAngle(this.yaw, Math.atan2(mv.x, mv.z)) * (1 - Math.exp(-14 * dt));
    } else {
      this.vel.x = damp(this.vel.x, 0, C.groundFriction, dt); this.vel.z = damp(this.vel.z, 0, C.groundFriction, dt);
    }
    if (this.vel.y < -2) this.vel.y = -2;
    const hs = this.hSpeed;
    if (this.state === 'land') { if (this.stateT > 0.18) this.setState(hs > 0.5 ? 'run' : 'idle'); }
    else this.setState(hs > 0.5 ? 'run' : 'idle');

    if (input.take('Space')) this._jump(hasMove ? 1 + (sprint ? 0.15 : 0) : 1);
    else if (input.takeMouse('right')) { this._jump(0.75); this._trySwing(input); }
    else if (input.take('KeyE')) this._tryZip(input);
  }

  _jump(mul = 1) {
    this.vel.y = CFG.jumpVel * mul;
    this.grounded = false; this.coyote = 1;
    this.setState('jump');
    this.game.audio.jump();
  }

  // ---------- air ----------
  _air(dt, input, mv, hasMove, ax) {
    const C = CFG;
    this.diving = (input.down('ShiftLeft') || input.down('ControlLeft')) && this.state === 'fall';
    this.vel.y -= (C.gravity + (this.diving ? C.diveAccel : 0)) * dt;
    if (hasMove) {
      // air control: steer, but never gain horizontal speed above what you already have (unless slow)
      const hs = this.hSpeed, cap = Math.max(C.runSpeed, hs);
      this.vel.x += mv.x * C.airControl * dt; this.vel.z += mv.z * C.airControl * dt;
      const hs2 = this.hSpeed;
      if (hs2 > cap) { this.vel.x *= cap / hs2; this.vel.z *= cap / hs2; }
      this.yaw += shortestAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z)) * (1 - Math.exp(-6 * dt));
    }
    const drag = this.diving ? C.airDrag * 0.25 : C.airDrag;
    const sp = this.speed;
    this.vel.multiplyScalar(Math.max(0, 1 - drag * dt * sp));
    if (this.vel.y < -C.terminalVel) this.vel.y = -C.terminalVel;
    if (this.state === 'jump' && this.vel.y < 0) this.setState('fall');

    if (input.mouse.right && this.game.time - this.lastRelease > 0.15) this._trySwing(input, ax);
    else if (input.take('KeyE')) this._tryZip(input);
    else if (input.take('Space') && this.jumpsLeft > 0) {
      this.jumpsLeft--; this.vel.y = Math.max(this.vel.y, 0) + C.jumpVel * 0.85; this.setState('jump');
      this.game.audio.jump(); this.game.fx.burst(this.pos, 0xffffff, 8, 4);
    }
  }

  // ---------- swing ----------
  _trySwing(input, steer = 0) {
    const heading = this.heading(this._heading);
    const side = this.swingSide;
    const a = this.anchorFinder.find(this.pos, heading, side, steer, CFG.assist, this.hSpeed);
    if (!a) return false;
    this.anchor.copy(a.point); this.anchorVisual.copy(a.visual); this.anchorVirtual = a.virtual;
    this.swingHeading.copy(heading);
    this.ropeLen = clamp(this.pos.distanceTo(this.anchor), CFG.swing.minRopeLen, CFG.swing.maxAttachDist);
    // Slow start: a forward web-kick so the swing plane is ahead, not toward the wall under the anchor
    const along = this.vel.x * heading.x + this.vel.z * heading.z;
    if (along < CFG.swing.startKick) { const add = CFG.swing.startKick - Math.max(0, along); this.vel.x += heading.x * add; this.vel.z += heading.z * add; }
    this.swingSide = -side;
    this.model.swingHand = side;
    this.setState('swing');
    this.swingT = 0; this.swingCount++; this.maxSpeedThisSwing = 0;
    this.web.attach(this.pos, this.anchorVisual);
    this.game.audio.thwip();
    this.game.camera.fovKick(CFG.swing.attachFovKick);
    this.game.onSwingAttach?.();
    return true;
  }

  /** Cheat #1: shorten the rope (gradually, ≤ 25 m/s) so the bottom of the arc never dips into the street. */
  _clampRopeToGround(dt) {
    const S = CFG.swing;
    const floor = Math.max(0, this.city.heightAt(this.pos.x, this.pos.z)) + S.groundClearance + this.he.y;
    const maxLen = this.anchor.y - floor;
    if (this.ropeLen > maxLen) this.ropeLen = Math.max(Math.max(S.minRopeLen, maxLen), this.ropeLen - 25 * dt);
  }

  _swing(dt, input, ax, az) {
    const S = CFG.swing, C = CFG;
    this.swingT += dt;
    const d = this._t.copy(this.pos).sub(this.anchor);
    const wantRelease = !input.mouse.right;
    const jumpRelease = input.take('Space');
    // release: let go, jump-release, or the rope went slack above the anchor for a while
    // release: let go, jump-release, rope slack above the anchor, or stalled at the apex (don't swing backwards)
    const stalled = this.swingT > 0.5 && this.vel.y > -1 && this.speed < 7 && d.y > -this.ropeLen * 0.75;
    if (wantRelease || jumpRelease || (d.y > 0 && this.swingT > 0.4) || stalled) { this._releaseSwing(jumpRelease); return; }
    if (input.take('KeyE')) { this._releaseSwing(false); this._tryZip(input); return; }

    // --- forces on the free point ---
    this.vel.y -= C.gravity * dt;
    const hs = this.hSpeed;
    const heading = hs > 1 ? this._heading.set(this.vel.x / hs, 0, this.vel.z / hs) : this.game.camera.forward(this._heading);
    const right = this._t2.set(-heading.z, 0, heading.x); // right of heading
    // small lateral help (the real steering is anchor placement) — scaled by assist
    this.vel.addScaledVector(right, ax * S.steerForce * C.assist * dt);
    // swing-steering assist: bleed off sideways drift so a held swing tracks your heading instead of the wall
    if (hs > 5) {
      const sh = this.swingHeading; const latX = -sh.z, latZ = sh.x; // right of the intended heading
      const lat = this.vel.x * latX + this.vel.z * latZ;
      const k = Math.min(1, S.lateralDamp * C.assist * dt);
      this.vel.x -= latX * lat * k; this.vel.z -= latZ * lat * k;
    }
    // W: reel in (shorter rope = faster) + thrust on the down-swing. S: let out.
    if (az > 0) {
      this.ropeLen = Math.max(S.minRopeLen, this.ropeLen - S.reelSpeed * dt);
      if (this.vel.y < 0) this.vel.addScaledVector(heading, S.pumpForce * this.stats.swingBoost * dt);
    } else if (az < 0) this.ropeLen = Math.min(S.maxAttachDist, this.ropeLen + S.reelSpeed * 0.6 * dt);
    // Cheat #3: forward momentum auto-correct — a stalled swing still gets you moving
    if (hs < 12 && this.vel.y < 0) this.vel.addScaledVector(heading, 8 * dt);
    this._clampRopeToGround(dt);

    // --- integrate, then rigid rope constraint: project onto the sphere and re-derive velocity ---
    const old = this._t2.copy(this.pos);
    this.pos.addScaledVector(this.vel, dt);
    d.copy(this.pos).sub(this.anchor);
    const len = d.length();
    if (len > this.ropeLen) {
      this.pos.copy(this.anchor).addScaledVector(d, this.ropeLen / len);
      this.vel.copy(this.pos).sub(old).multiplyScalar(1 / dt);
    }
    // drag + soft horizontal cap
    const sp = this.speed;
    this.vel.multiplyScalar(Math.max(0, 1 - S.drag * sp * dt));
    const hs2 = this.hSpeed;
    if (hs2 > S.hCap) { const k = (S.hCap + (hs2 - S.hCap) * Math.pow(S.hCapDamp, dt * 60)) / hs2; this.vel.x *= k; this.vel.z *= k; }
    this.maxSpeedThisSwing = Math.max(this.maxSpeedThisSwing, sp);
    this.yaw += shortestAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z)) * (1 - Math.exp(-8 * dt));
  }

  _releaseSwing(jumped) {
    const S = CFG.swing;
    this.web.release();
    const heading = this.heading(this._heading);
    // Never damp on transition; add a boost when releasing on the rise ("release = jump")
    if (this.vel.y > 0 || jumped) {
      this.vel.addScaledVector(heading, S.releaseAlong).y += S.releaseUp;
    }
    if (jumped) { this.vel.y = Math.max(this.vel.y, 0) + CFG.jumpVel * 0.6; this.game.audio.jump(); }
    else this.game.audio.release();
    this.lastRelease = this.game.time;
    this.setState(this.vel.y > 0 ? 'jump' : 'fall');
    this.game.onSwingRelease?.(this.maxSpeedThisSwing, this.swingT);
  }

  // ---------- zip / point launch ----------
  _tryZip(input) {
    if (this.zipCooldown > 0) return false;
    const Z = CFG.zip;
    const cam = this.game.camera.cam;
    const dir = this._t2.set(0, 0, -1).applyQuaternion(cam.quaternion);
    // 1) exactly what the crosshair is on: cast from the camera, then confirm the line from the player is clear
    let hit = null;
    const camHit = this.city.raycast(cam.position, dir, Z.maxDist + 12, this._hit);
    if (camHit && camHit.building !== 'ground' && camHit.point.distanceTo(this.pos) <= Z.maxDist && camHit.point.distanceTo(this.pos) >= Z.minDist) {
      const target = this._zt.copy(camHit.point); const n = this._zn.copy(camHit.normal);
      const from = this._t.copy(this.pos); const d = this._zd.copy(target).sub(from); const len = d.length(); d.divideScalar(len);
      const block = this.city.raycast(from, d, len - 1.2, this._hit2);
      if (!block || block.building === 'ground') { hit = { point: target, normal: n }; }
    }
    // 2) otherwise sweep a small cone around the crosshair from the player (near-misses still count)
    if (!hit) {
      const yaw0 = Math.atan2(dir.x, dir.z), pitch0 = Math.asin(clamp(dir.y, -1, 1));
      outer: for (const dp of [0, 0.12, -0.12, 0.25, 0.4]) for (const dy of [0, 0.1, -0.1, 0.2, -0.2]) {
        const yaw = yaw0 + dy, p = pitch0 + dp;
        this._zd.set(Math.sin(yaw) * Math.cos(p), Math.sin(p), Math.cos(yaw) * Math.cos(p));
        const h = this.city.raycast(this.pos, this._zd, Z.maxDist, this._hit);
        if (h && h.building !== 'ground' && h.point.y > 1.5 && h.dist >= Z.minDist) { hit = { point: this._zt.copy(h.point), normal: this._zn.copy(h.normal) }; break outer; }
      }
    }
    if (!hit) { this.game.hud.hint('No zip point — aim at a building or ledge', 1.2); return false; }
    this.startZipTo(hit.point, hit.normal, null);
    return true;
  }

  /** Zip toward a point. normal = surface normal (roof → land, side → point launch); strike = enemy to hit on arrival. */
  startZipTo(point, normal, strike) {
    this.zipTarget.copy(point);
    this.zipNormal.copy(normal);
    this.zipStrike = strike;
    if (!strike) {
      this.zipTarget.addScaledVector(normal, 0.9);
      if (normal.y > 0.5) this.zipTarget.y += this.he.y;
    }
    this.web.release();
    this.web.attach(this.pos, this.zipTarget);
    this.model.swingHand = 1;
    this.setState('zip');
    this.zipCooldown = CFG.zip.cooldown;
    this.game.audio.thwip();
    this.game.camera.fovKick(3);
    this.zipCount = (this.zipCount || 0) + 1;
  }

  _zip(dt, input) {
    const Z = CFG.zip;
    if (this.zipStrike) { // track a moving target
      this.zipTarget.copy(this.zipStrike.pos); this.zipTarget.y += 0.4;
    }
    // chain: E mid-flight re-targets from where you are now
    if (!this.zipStrike && this.stateT > 0.15 && input.take('KeyE')) { this.zipCooldown = 0; if (this._tryZip(input)) return; }
    if (!this.zipStrike && input.mouse.right && this.stateT > 0.2) { this.web.release(); this.setState('fall'); this._trySwing(input); return; }
    const d = this._t.copy(this.zipTarget).sub(this.pos);
    const dist = d.length();
    const sp = Z.speed * this.stats.zipSpeed + Math.min(18, this.hSpeed * 0.4);
    if (dist < Math.max(1.6, sp * dt * 1.5) || this.stateT > 4) {
      this.web.release();
      if (this.zipStrike) { const e = this.zipStrike; this.zipStrike = null; this.game.combat.onWebStrikeArrive(e); return; }
      this.pos.copy(this.zipTarget);
      if (this.zipNormal.y > 0.5) { // ledge / roof: perch, keep a little forward roll
        const heading = this.heading(this._heading);
        this.vel.set(heading.x * 3, 1.5, heading.z * 3); this.setState('fall'); this.game.fx.burst(this.pos, 0xffffff, 6, 3, 1); return;
      }
      // wall: SPACE held = point launch (up and over), otherwise cling and crawl
      const heading = this.heading(this._heading);
      if (input.down('Space') || input.down('KeyW')) {
        this.vel.copy(this.zipNormal).multiplyScalar(-2).addScaledVector(heading, Z.launchFwd * 0.6).addScaledVector(UP, Z.launchUp);
        this.setState('jump'); this.game.fx.burst(this.pos, 0xffffff, 10, 5); this.game.audio.jump(); this.game.hud.hint('', 0);
        return;
      }
      this.wallNormal.copy(this.zipNormal); this.vel.set(0, 0, 0); this.wallRun = false; this.wallVy = 0; this.setState('wall'); this.wallT = 0;
      this.wallYaw = Math.atan2(-this.zipNormal.x, -this.zipNormal.z);
      this.game.audio.land(false);
      return;
    }
    d.multiplyScalar(1 / dist);
    this.vel.copy(d).multiplyScalar(sp);
    this.pos.addScaledVector(this.vel, dt);
    this.yaw += shortestAngle(this.yaw, Math.atan2(d.x, d.z)) * (1 - Math.exp(-12 * dt));
  }

  // ---------- wall run / crawl ----------
  _enterWall(normal, minRun = 0) {
    this.wallNormal.copy(normal);
    const toward = -(this.vel.x * normal.x + this.vel.z * normal.z);
    // Cheat #2: convert impact into an upward wall-run instead of a face-plant
    this.wallVy = Math.max(this.vel.y, Math.min(toward * 0.95, 30), minRun);
    this.wallRun = this.wallVy > 3;
    this.vel.set(0, this.wallVy, 0);
    this.wallT = 0;
    this.setState('wall');
    this.wallYaw = Math.atan2(-normal.x, -normal.z);
    if (this.web.active) this.web.release();
  }

  _wall(dt, input, ax, az) {
    const W = CFG.wall, n = this.wallNormal;
    this.wallT += dt;
    // wall-run momentum decays (slower while you keep pushing up), then blends into a steady climb
    if (this.wallRun) {
      this.wallVy -= CFG.gravity * (az > 0 ? W.runGravityHeld : W.runGravity) * dt;
      if (this.wallVy <= (az > 0 ? W.climbSpeed : 0)) { this.wallRun = false; this.wallVy = 0; }
    }
    const climb = az * W.climbSpeed;
    const vy = this.wallRun ? Math.max(this.wallVy, climb) : climb;
    const right = this._t.set(-n.z, 0, n.x);
    // smooth the crawl so starts/stops don't pop
    const tx = -ax * W.climbSpeed * 0.85 * right.x, tz = -ax * W.climbSpeed * 0.85 * right.z;
    this.vel.x = damp(this.vel.x, tx, 14, dt); this.vel.z = damp(this.vel.z, tz, 14, dt);
    this.vel.y = this.wallRun ? vy : damp(this.vel.y, vy, 14, dt);
    this.vel.addScaledVector(n, -3); // stick
    const b = this.contact.building;
    if (b) {
      const onCrown = b.crown && this.pos.y > b.h + 0.5;
      const roofY = onCrown ? b.crown.h : b.h;
      if (this.pos.y - this.he.y + 0.5 >= roofY) { // mantle onto the roof
        this.pos.y = roofY + this.he.y + 0.05; this.pos.addScaledVector(n, -1.4);
        this.vel.set(-n.x * 5, 4, -n.z * 5);
        this.setState('jump'); return;
      }
    }
    if (input.take('Space')) {
      const f = this.game.camera.forward(this._t2);
      this.vel.copy(n).multiplyScalar(W.jumpOff).addScaledVector(UP, W.jumpUp);
      if (f.dot(n) < -0.3) { this.vel.set(n.x * 2, W.jumpUp * 1.5, n.z * 2); } // looking into the wall: hop straight up
      this.setState('jump'); this.game.audio.jump(); return;
    }
    if (input.takeMouse('right') || (input.mouse.right && this.wallT > 0.35)) {
      // kick off the wall first; the swing attaches ~0.15 s later once we've separated from the face
      this.vel.copy(n).multiplyScalar(W.jumpOff * 0.8).addScaledVector(UP, 8);
      this.lastRelease = this.game.time; this.setState('jump'); this.game.audio.jump(); return;
    }
    if (input.take('KeyE')) { this._tryZip(input); return; }
    if (!this.contact.wall && this.wallT > 0.15) this.setState('fall');
    if (this.grounded && az <= 0) this.setState('idle');
  }

  // ---------- landing roll: keep momentum instead of face-planting ----------
  _roll(dt) {
    if (!this.grounded) this.vel.y -= CFG.gravity * dt;
    this.vel.x = damp(this.vel.x, 0, 0.5, dt); this.vel.z = damp(this.vel.z, 0, 0.5, dt);
    this.rollT = Math.min(1, this.rollT + dt / 0.42);
    if (this.rollT >= 1) this.setState(this.hSpeed > 0.5 ? 'run' : 'idle');
  }

  // ---------- combat animations (velocity set by Combat) ----------
  _combatMove(dt) {
    const s = this.state, C = CFG.combat;
    const airAttack = s === 'attack' && !this.grounded;
    if (!this.grounded) this.vel.y -= CFG.gravity * (airAttack ? C.juggleGravity : 1) * dt;
    const fr = s === 'dodge' ? 1.5 : (airAttack ? 3 : 9);
    this.vel.x = damp(this.vel.x, 0, fr, dt); this.vel.z = damp(this.vel.z, 0, fr, dt);
    if (s === 'dodge') { this.dodgeT += dt / (C.dodge.time + C.dodge.recovery); if (this.dodgeT >= 1) this.setState(this.grounded ? 'idle' : 'fall'); }
    if (s === 'attack') { this.attackT -= dt; if (this.attackT <= 0) this.setState(this.grounded ? 'idle' : 'fall'); }
    if (s === 'hurt' && this.stateT > 0.45) this.setState(this.grounded ? 'idle' : 'fall');
  }

  // ---------- collision ----------
  _collide(dt) {
    const c = this.contact;
    const vy = this.vel.y, wasAir = this.airborne, hs = this.hSpeed;
    this.city.resolveBox(this.pos, this.he, c);
    const m = 8;
    if (!this.city.inBounds(this.pos.x, this.pos.z, m)) {
      this.pos.x = clamp(this.pos.x, this.city.originX + m, this.city.originX + this.city.sizeX - m);
      this.pos.z = clamp(this.pos.z, this.city.originZ + m, this.city.originZ + this.city.sizeZ - m);
      this.vel.x *= -0.3; this.vel.z *= -0.3;
      if (this.state === 'swing') this.web.release();
      this.game.hud.hint('Edge of the city — turn back', 1.2);
    }
    if (c.ground) {
      if (wasAir && this.state !== 'zip') {
        const hard = vy < -22;
        if (this.state === 'swing') this.web.release();
        this.game.audio.land(hard);
        if (hard && hs > 10) { // fast landing → roll through it, keep most of the speed
          this.game.camera.addShake(0.2); this.game.fx.burst(this.pos, 0xbbbbbb, 10, 3, 2); this.setState('roll'); this.rollT = 0; this.vel.x *= 0.85; this.vel.z *= 0.85;
        } else if (hard) { this.game.camera.addShake(0.35); this.game.fx.burst(this.pos, 0xbbbbbb, 12, 3, 2); this.setState('land'); this.vel.x *= 0.6; this.vel.z *= 0.6; }
        else this.setState(hs > 0.5 ? 'run' : 'idle');
        this.game.onLanding?.(vy, this.airTime);
      }
      if (this.vel.y < 0) this.vel.y = 0;
      this.grounded = true;
    } else this.grounded = false;
    if (c.ceiling && this.vel.y > 0) this.vel.y = 0;
    if (c.wall) {
      const n = c.wallNormal;
      const vn = this.vel.x * n.x + this.vel.z * n.z;
      if (vn >= 0) { /* moving away from the wall: nothing to resolve */ }
      else if ((this.state === 'run' || this.state === 'land' || this.state === 'roll') && this._moveDir.dot(n) < -0.45 && hs > 3) {
        // running into a wall on foot → straight into a wall-run (no jump needed)
        this._enterWall(n, clamp(hs * 1.15, CFG.wall.minRunFromGround, 20));
        this.game.audio.jump();
      }
      else if (this.state === 'jump' || this.state === 'fall' || this.state === 'swing') {
        const sp = this.speed;
        if (-vn < 3.5 || -vn < 0.5 * sp) {
          // glancing hit: slide along the wall and keep going (only head-on impacts become wall-runs)
          this.vel.x -= n.x * vn; this.vel.z -= n.z * vn;
        } else {
          if (this.state === 'swing') this.web.release();
          this._enterWall(n);
        }
      } else if (this.state === 'zip' && !this.zipStrike) {
        this.web.release(); this._enterWall(n); this.wallRun = false; this.vel.set(0, 0, 0);
      } else if (vn < 0) { this.vel.x -= n.x * vn; this.vel.z -= n.z * vn; }
    }
  }

  // ======================= visuals (per frame) =======================
  updateVisual(dt, alpha = 1) {
    const m = this.model, r = m.root, s = this.state, sp = this.speed;
    // interpolate between physics steps so 120 Hz physics renders smoothly at any frame rate
    if (this.prevPos.distanceToSquared(this.pos) < 25) this.renderPos.lerpVectors(this.prevPos, this.pos, alpha); else this.renderPos.copy(this.pos);
    r.position.copy(this.renderPos);
    if (s === 'wall') r.position.addScaledVector(this.wallNormal, this.wallRun ? 0.22 : 0.05);
    let lean = 0, bank = 0, yaw = this.yaw;
    if (s === 'swing') { lean = clamp(sp / 70, 0.1, 0.7); const right = this._t.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw)); bank = clamp(this.vel.dot(right) / 40, -0.5, 0.5); }
    else if (s === 'fall') lean = this.diving || sp > 30 ? 1.25 : 0.25;
    else if (s === 'zip') lean = 1.35;
    else if (s === 'jump') lean = 0.15;
    else if (s === 'wall') { this.yaw += shortestAngle(this.yaw, this.wallYaw) * (1 - Math.exp(-14 * dt)); yaw = this.yaw; lean = this.wallRun ? -0.62 : -0.12; }
    else if (s === 'run') lean = clamp(sp / 40, 0, 0.3);
    else if (s === 'attack' && this.attackTarget) { const want = Math.atan2(this.attackTarget.pos.x - this.pos.x, this.attackTarget.pos.z - this.pos.z); this.yaw += shortestAngle(this.yaw, want) * (1 - Math.exp(-22 * dt)); yaw = this.yaw; }
    this.lean = damp(this.lean, lean, 8, dt);
    this.bank = damp(this.bank, bank, 6, dt);
    if (this.trickT > 0) { this.trickT = Math.max(0, this.trickT - dt); const u = 1 - this.trickT / 0.7; lean += Math.sin(u * Math.PI) * 0; r.rotation.set(this.lean + u * Math.PI * 2, yaw, this.bank + Math.sin(u * Math.PI) * 0.6); }
    else r.rotation.set(this.lean, yaw, this.bank);

    const ctx = { state: s, speed: sp, anchorDir: null, attackIdx: this.attackIdx, dodgeT: this.dodgeT, spin: 0 };
    if (s === 'dodge') ctx.spin = this.dodgeT;
    if (s === 'roll') { ctx.state = 'dodge'; ctx.spin = this.rollT; }
    if (s === 'wall') { if (this.wallRun) { ctx.state = 'run'; ctx.speed = Math.max(8, Math.abs(this.vel.y)); } else { ctx.state = 'crawl'; ctx.speed = this.speed; } }
    if (s === 'swing') ctx.anchorDir = this._t2.copy(this.anchorVisual).sub(this.pos).normalize();
    if (s === 'zip') { ctx.anchorDir = this._t2.copy(this.zipTarget).sub(this.pos).normalize(); }
    m.update(dt, ctx);

    if (this.web.active) {
      const hand = this.handWorld(this._t, m.swingHand > 0);
      const slack = s === 'swing' ? clamp((this.pos.distanceTo(this.anchor) / this.ropeLen - 0.96) / 0.04, 0, 1) : 1;
      this.web.update(dt, hand, s === 'zip' ? this.zipTarget : this.anchorVisual, slack);
    }
  }

  handWorld(out, right = true) { return (right ? this.model.armR : this.model.armL).end.getWorldPosition(out); }

  damage(amount, fromPos) {
    if (this.invuln > 0 || this.state === 'ko') return false;
    this.hp = Math.max(0, this.hp - amount);
    this.invuln = 0.5;
    this.game.hud.damage(); this.game.audio.hurt(); this.game.camera.addShake(0.3);
    if (this.state === 'swing') this.web.release();
    if (this.hp <= 0) { this.setState('ko'); this.game.onPlayerKO?.(); return true; }
    this.setState('hurt');
    if (fromPos) { const d = this._t.copy(this.pos).sub(fromPos); d.y = 0; d.normalize(); this.vel.set(d.x * 6, 3, d.z * 6); }
    return true;
  }

  addFocus(n) { this.focus = Math.min(this.focusMax, this.focus + n * this.stats.focusGain); }

  respawn() {
    this.hp = this.maxHp; this.focus = 0;
    this.setState('fall'); this.vel.set(0, 0, 0);
  }
}
