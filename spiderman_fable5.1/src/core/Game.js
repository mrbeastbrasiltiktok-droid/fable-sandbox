import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CFG } from './Config.js';
import { Input } from './Input.js';
import { FX } from './FX.js';
import { City } from '../world/City.js';
import { Environment } from '../world/Environment.js';
import { Traffic } from '../world/Traffic.js';
import { Player } from '../player/Player.js';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera.js';
import { Combat } from '../combat/Combat.js';
import { Missions } from '../missions/Missions.js';
import { HUD } from '../ui/HUD.js';
import { Audio } from '../audio/Audio.js';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;

    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(CFG.cam.fov, innerWidth / innerHeight, 0.3, 6000);
    this.time = 0; this.timeScale = 1; this.hitstopT = 0; this.slowT = 0; this.slowScale = 1;
    this.paused = true; this.uiPaused = false;
    this.acc = 0;

    this.hud = new HUD();
    this.audio = new Audio();
    this.input = new Input(canvas);
    this.fx = new FX(this.scene);
    this.env = new Environment(this.scene);
    this.city = new City();
    this.scene.add(this.city.group);
    this.traffic = new Traffic(this.city);
    this.scene.add(this.traffic.group);
    this.camera = new ThirdPersonCamera(this.cam, this.city);
    this.player = new Player(this);
    this.combat = new Combat(this);
    this.missions = new Missions(this);

    // Post: subtle bloom for lit windows / web glow
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.cam));
    // Ground-truth ambient occlusion: grounds the character/props against roofs and darkens street canyons.
    this.gtao = new GTAOPass(this.scene, this.cam, innerWidth, innerHeight);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.updateGtaoMaterial({ blendIntensity: 0.85, radius: 2.2, distanceExponent: 1.5, thickness: 1.2, scale: 1.4, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 3, radiusExponent: 1, rings: 2, samples: 12 });
    this.composer.addPass(this.gtao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.5, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    addEventListener('resize', () => this.resize());
    this.input.onUnlock = () => { if (!this.uiPaused) this.pause(); };
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && !this.paused) this.pause();
      if (e.code === 'KeyO') { this.gtao.enabled = !this.gtao.enabled; this.hud.alert(`AMBIENT OCCLUSION ${this.gtao.enabled ? 'ON' : 'OFF'}`, 'small'); }
      if (e.code === 'KeyC' && !this.paused) this.hud.toggleControls();
    });

    // Spawn on the street at a central intersection, looking down the avenue
    const c = this.city;
    this.player.pos.set(c.originX + Math.floor(c.NX / 2) * c.PX, 0.95, c.originZ + Math.floor(c.NZ / 2) * c.PZ + c.S / 2 + 6);
    this.player.prevPos.copy(this.player.pos); this.player.renderPos.copy(this.player.pos);
    this.player.setState('idle');
    this.camera.yaw = 0; this.camera.pitch = -0.12;
    this.camera.smoothTarget.copy(this.player.pos);

    // adaptive quality: drop AO / pixel ratio if the frame time stays high
    this.quality = 2; this.frameMs = 16; this.qualityT = 0;

    this.stats = { swings: 0, maxSpeed: 0, tricks: 0 };
    this.player.game.onSwingRelease = (maxSpeed, dur) => { this.stats.swings++; this.stats.maxSpeed = Math.max(this.stats.maxSpeed, maxSpeed); if (maxSpeed > 40) this.player.addFocus(3); };
    this.onLanding = (vy, airTime) => { if (airTime > 4) { this.hud.alert('AIR TIME', 'small'); this.player.addFocus(6); } };
    this.onPlayerKO = () => { this.hud.banner('KNOCKED OUT', 'RESPAWNING…'); setTimeout(() => this.respawn(), 2600); };

    this._last = performance.now();
    this._loop = this._loop.bind(this);
    this.frame = 0;
    requestAnimationFrame(this._loop);
  }

  resize() {
    this.cam.aspect = innerWidth / innerHeight; this.cam.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight); this.composer.setSize(innerWidth, innerHeight); this.gtao.setSize(innerWidth, innerHeight);
  }

  start(opts = {}) {
    if (!this._started) { if (opts.fresh) Missions.clearSave(); else if (Missions.hasSave() && this.missions.load()) this.hud.alert('PROGRESS RESTORED', 'gold small'); }
    this.audio.init(); this.audio.resume();
    this.paused = false; this.hud.show();
    this.hud.el.menu.classList.add('hidden');
    if (!this._started) { this._started = true; this.hud.showControls(28); }
    this.input.lock();
    this._last = performance.now();
  }
  pause() { this.paused = true; this.hud.el.menu.classList.remove('hidden'); this.input.unlock(); }
  pauseForUI(on) { this.uiPaused = on; if (on) this.input.unlock(); else { this.input.lock(); } }

  hitstop(t) { this.hitstopT = Math.max(this.hitstopT, t); }
  slowmo(t, scale) { this.slowT = Math.max(this.slowT, t); this.slowScale = scale; }

  respawn() {
    const P = this.player;
    this.combat.clearAll();
    if (this.missions.active) { const a = this.missions.active; a.def.end?.(a.state); this.missions.active = null; this.missions.storyDelay = 3; }
    if (this.missions.crime) this.missions._endCrime(false);
    this.missions.removeVan();
    const b = this.city.buildings.filter((x) => x.h > 40 && x.h < 90 && x.x !== undefined).sort((x, y) => Math.hypot(x.x - P.pos.x, x.z - P.pos.z) - Math.hypot(y.x - P.pos.x, y.z - P.pos.z))[3];
    P.pos.set(b.x, b.h + 2, b.z); P.respawn();
  }

  _loop(now) {
    requestAnimationFrame(this._loop);
    const raw = Math.min(0.05, (now - this._last) / 1000); this._last = now;
    if (this.paused || this.uiPaused) { this._render(0); return; }
    this.input.pollGamepad();
    // time scaling: hitstop freezes, slow-mo scales
    let scale = 1;
    if (this.hitstopT > 0) { this.hitstopT -= raw; scale = 0.02; }
    else if (this.slowT > 0) { this.slowT -= raw; scale = this.slowScale; }
    const dt = raw * scale;
    this.time += dt;

    // fixed-step physics (+ render interpolation via alpha)
    this.acc += dt;
    let steps = 0;
    while (this.acc >= CFG.fixedDt && steps < 8) { this.player.step(CFG.fixedDt, this.input); this.acc -= CFG.fixedDt; steps++; }
    if (steps === 8) this.acc = 0;
    const alpha = Math.min(1, this.acc / CFG.fixedDt);

    this.combat.update(dt, this.input);
    this.missions.update(dt, this.input);
    this.traffic.update(dt);
    this.player.updateVisual(dt, alpha);
    this._adaptQuality(raw);
    this.combat.updateVisual(dt);
    this.fx.update(dt);
    this.camera.update(raw, this.player, this.input); // camera in real time so slow-mo still feels smooth
    this.env.update(this.player.pos);
    this.audio.setSpeed(this.player.speed, this.player.airborne);
    this.audio.music(raw, this.player.combatNear ? 1 : (this.missions.activeRace ? 0.5 : 0));
    this._hud(raw);
    this.input.endFrame();
    this._render(dt);
  }

  _hud(dt) {
    const P = this.player, H = this.hud, M = this.missions;
    H.setVitals(P.hp, P.maxHp, P.focus, P.focusMax, M.xp, M.xpNext, M.level);
    H.setSpeed(P.speed);
    H.update(dt);
    H.context(P, this.combat);
    if (M.waypoint) H.setWaypoint(M.waypoint, this.cam, M.waypoint.distanceTo(P.pos), M.waypointKind); else H.setWaypoint(null);
    const se = this.combat.senseEnemy;
    H.spiderSense(se ? se.head : null, this.cam);
    if ((this.frame++ & 1) === 0) {
      const markers = M.markers([]); this.combat.enemyMarkers(markers);
      H.drawMinimap(this.city, P, markers, this.camera.yaw);
    }
  }

  _adaptQuality(raw) {
    this.frameMs = this.frameMs * 0.95 + raw * 1000 * 0.05;
    this.qualityT += raw;
    if (this.qualityT < 3) return;
    this.qualityT = 0;
    if (this.frameMs > 24 && this.quality > 0) {
      this.quality--;
      if (this.quality === 1) { this.gtao.enabled = false; this.hud.alert('PERFORMANCE: AO OFF', 'small'); }
      else { this.renderer.setPixelRatio(1); this.composer.setPixelRatio?.(1); this.resize(); this.env.sun.shadow.mapSize.set(1024, 1024); this.env.sun.shadow.map?.dispose(); this.env.sun.shadow.map = null; this.hud.alert('PERFORMANCE MODE', 'small'); }
    }
  }

  _render() { this.composer.render(); }
}
