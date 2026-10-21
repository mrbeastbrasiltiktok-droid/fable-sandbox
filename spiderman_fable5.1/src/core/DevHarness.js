/**
 * Dev-only helpers (load with ?dev in the URL). Lets automated tests drive the game deterministically
 * even in a hidden tab where requestAnimationFrame / timers are throttled.
 *   dbgStart()            – skip the menu, unpause, fake pointer lock
 *   sim(seconds, fn)      – run N fixed 60 Hz frames synchronously; fn(t) can poke game.input each frame
 *   key(code, down) / mouse(btn, down)
 */
import * as THREE from 'three';

export function installDevHarness(game) {
  window.game = game;
  window.dbgStart = () => {
    document.getElementById('menu').classList.add('hidden');
    game.hud.show(); game.paused = false; game.input.enabled = true; game.input.locked = true;
    game.audio.init?.();
  };
  window.resetInput = () => { const I = game.input; I.keys.clear(); I.pressed.clear(); I.mouse.left = I.mouse.right = I.mouse.leftPressed = I.mouse.rightPressed = false; };
  window.key = (code, down = true) => { const k = game.input.keys; if (down) { k.add(code); game.input.pressed.add(code); } else k.delete(code); };
  window.mouse = (btn, down = true) => { game.input.mouse[btn] = down; if (down) game.input.mouse[btn + 'Pressed'] = true; };
  window.sim = (seconds, fn) => {
    const raf = window.requestAnimationFrame; window.requestAnimationFrame = () => 0;
    const render = game._render; game._render = () => {};
    let now = performance.now();
    const frames = Math.round(seconds * 60);
    const log = [];
    try {
      for (let i = 0; i < frames; i++) {
        game._last = now; now += 1000 / 60;
        fn?.(i / 60, log);
        game._loop(now);
      }
    } finally {
      game._render = render; window.requestAnimationFrame = raf;
    }
    game._render();
    return log;
  };
  /** Hold-swing down a street for `secs`; returns wall-run count, state histogram and distance covered. */
  window.swingTest = (startSpeed = 12, secs = 20, streetI = 14, blockJ = 3, hold = 2.4, gap = 0.7) => {
    const c = game.city, P = game.player;
    const sx = c.originX + streetI * c.PX, sz = c.originZ + blockJ * c.PZ + 20;
    P.pos.set(sx, 35, sz); P.vel.set(0, 0, startSpeed); P.setState('fall'); game.camera.yaw = 0; game.camera.smoothTarget.copy(P.pos); P.web.release();
    let walls = 0, last = '', maxSp = 0; const states = {}; const anchors = [];
    const origTry = P._trySwing.bind(P);
    P._trySwing = (i, st) => { const r = origTry(i, st); if (r) anchors.push([+(P.anchor.x - sx).toFixed(0), +P.anchor.y.toFixed(0), +(P.anchor.z - sz).toFixed(0), 'rope', +P.ropeLen.toFixed(0)]); return r; };
    const log = window.sim(secs, (t, log) => {
      const ph = t % (hold + gap), holding = ph < hold; game.input.mouse.right = holding; if (holding && ph < 0.02) game.input.mouse.rightPressed = true;
      const s = P.state; states[s] = (states[s] || 0) + 1; if (s === 'wall' && last !== 'wall') walls++; last = s; maxSp = Math.max(maxSp, P.speed);
      if (Math.round(t * 60) % 60 === 0) log.push([t.toFixed(0), s, +P.speed.toFixed(0), +(P.pos.x - sx).toFixed(0), +P.pos.y.toFixed(0), +(P.pos.z - sz).toFixed(0)]);
    });
    P._trySwing = origTry; window.resetInput();
    return { walls, states, maxSp: +maxSp.toFixed(0), dist: +Math.hypot(P.pos.x - sx, P.pos.z - sz).toFixed(0), fwd: +(P.pos.z - sz).toFixed(0), anchors, log };
  };
  /** Spawn a group next to the player on the current roof and brawl for `secs`. */
  window.combatTest = (spec = [{ type: 'grunt', n: 3 }], secs = 30) => {
    const P = game.player, C = game.combat;
    C.clearAll();
    P.hp = P.maxHp; P.vel.set(0, 0, 0); P.setState('idle');
    const g = C.spawnGroup(P.pos.clone().add(new THREE.Vector3(6, 0, 0)), spec, { radius: 4 });
    let hits = 0, dmgTaken = 0, lastHp = P.hp, kos = 0; const ev = [];
    const origApply = C._applyHit.bind(C); C._applyHit = () => { const before = C.combo; origApply(); if (C.combo > before) hits++; };
    const origKO = C.onEnemyKO.bind(C); C.onEnemyKO = (e) => { kos++; origKO(e); };
    const log = window.sim(secs, (t, log) => {
      if (P.hp < lastHp) dmgTaken += lastHp - P.hp; lastHp = P.hp;
      const f = Math.round(t * 60);
      if (f % 24 === 0) window.mouse('left');                        // attack every 0.4 s
      if (C.senseEnemy && f % 6 === 0) window.key('KeyQ');          // dodge when spider-sense fires
      if (f % 180 === 90) window.key('KeyR');                        // web-shoot now and then
      if (f % 300 === 150) window.key('KeyF');                        // web-strike
      if (f % 60 === 0) log.push([t.toFixed(0), P.state, 'hp', P.hp, 'focus', +P.focus.toFixed(0), 'alive', g.alive(), 'combo', C.combo, 'pos', P.pos.toArray().map((v) => +v.toFixed(0))]);
    });
    C._applyHit = origApply; C.onEnemyKO = origKO; window.resetInput();
    return { hits, kos, dmgTaken, hpLeft: P.hp, aliveLeft: g.alive(), log };
  };
  window.snap = () => { const p = game.player; return { state: p.state, speed: +p.speed.toFixed(1), pos: p.pos.toArray().map((v) => +v.toFixed(1)), rope: +p.ropeLen.toFixed(1), virtual: p.anchorVirtual, hp: p.hp, focus: +p.focus.toFixed(0), enemies: game.combat.alive.length }; };
}
