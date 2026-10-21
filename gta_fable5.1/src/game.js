import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { City } from './city.js';
import { Environment } from './sky.js';
import { Effects } from './effects.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { CameraRig } from './camera.js';
import { Player } from './player.js';
import { Vehicle, collideVehicles } from './vehicle.js';
import { PedManager } from './peds.js';
import { Traffic } from './traffic.js';
import { Police } from './police.js';
import { Pickups } from './pickups.js';
import { Missions } from './missions.js';
import { HUD } from './hud.js';
import { Stores } from './stores.js';
import { Projectiles } from './weapons.js';
import { N8AOPass } from 'n8ao';
import { DAY, CITY } from './config.js';
import { clamp, dist2D, damp, formatMoney } from './utils.js';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uDesat: { value: 0 }, uVignette: { value: 0.35 }, uRed: { value: 0 }, uFade: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uDesat, uVignette, uRed, uFade; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); float l = dot(c.rgb, vec3(0.299,0.587,0.114)); c.rgb = mix(c.rgb, vec3(l), uDesat);
      vec2 q = vUv - 0.5; float v = 1.0 - smoothstep(0.35, 0.95, length(q) * 1.15) * uVignette; c.rgb *= v;
      c.rgb = mix(c.rgb, vec3(0.6, 0.02, 0.02), uRed * smoothstep(0.2, 0.8, length(q)));
      c.rgb *= 1.0 - uFade; gl_FragColor = c; }`,
};

export class Game {
  constructor(renderer, canvas) {
    this.renderer = renderer; this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 3000);
    this.input = new Input(canvas);
    this.time = 0; this.dayFrac = DAY.START; this.night = 0; this.paused = true; this.slowmo = 1;
    this.vehicles = []; this.peds = [];
    this.city = new City(this.scene);
    this.world = { hash: this.city.hash, ground: (x, z) => this.city.groundHeight(x, z), isWater: (x, z) => this.city.isWater(x, z) };
    this.env = new Environment(this.scene, renderer);
    this.effects = new Effects(this.scene);
    this.audio = new AudioEngine();
    this.rig = new CameraRig(this.camera, this.city);
    this.player = new Player(this);
    this.hud = new HUD(this);
    this.traffic = new Traffic(this); this.police = new Police(this); this.pedsMgr = new PedManager(this);
    this.pickups = new Pickups(this); this.missions = new Missions(this);
    this.barrels = []; this.projectiles = new Projectiles(this); this.aimTarget = null;
    this.stores = new Stores(this); this.buildBarrels();
    // pooled vehicle lights: 2 headlight spots for the player's car, 2 siren lights for the nearest cruisers
    this.headlights = []; for (let i = 0; i < 2; i++) { const sp = new THREE.SpotLight(0xfff1d0, 0, 45, 0.55, 0.5, 1.2); sp.position.set(0, -100, 0); this.scene.add(sp, sp.target); this.headlights.push(sp); }
    this.sirenLights = []; for (let i = 0; i < 2; i++) { const l = new THREE.PointLight(0xff3030, 0, 18, 1.5); l.position.set(0, -100, 0); this.scene.add(l); this.sirenLights.push(l); }
    // objective guide arrow floating above the player
    const arrowGeo = new THREE.ConeGeometry(0.22, 0.7, 4); arrowGeo.rotateX(Math.PI / 2);
    this.guideArrow = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: 0xffd24a, toneMapped: false, transparent: true, opacity: 0.9 })); this.guideArrow.visible = false; this.scene.add(this.guideArrow);
    this.guide = null;
    this.traffic.spawnParked();
    // spawn: Midtown corner with a car waiting
    const b = this.city.blocks.find(bb => bb.i === 3 && bb.j === 3);
    this.player.setPosition(b.x0 + 12, b.z1 + 1.6, Math.PI);
    const starter = this.addVehicle('sedan', b.x0 + 13, b.z1 + 5.2, Math.PI / 2, 0xc0392b); starter.isParked = true;
    this.rig.snapBehind(this.player.heading); this.rig.pos.set(this.player.x, 3, this.player.z + 6);
    this.hospital = { x: this.city.blocks.find(bb => bb.i === 1 && bb.j === 4).x1 + 1.5, z: this.city.blocks.find(bb => bb.i === 1 && bb.j === 4).cz, h: Math.PI / 2 };
    this.station = { x: this.missions.markers[4].x - 6, z: this.missions.markers[4].z, h: 0 };
    this.setupPost();
    this.respawnT = 0; this.wastedT = 0; this.fade = 0;
    addEventListener('resize', () => this.resize());
    this.hud.notify('Welcome to Fable City. Press F1 for controls.', 5000);
  }
  setupPost() {
    const r = this.renderer; const size = new THREE.Vector2(); r.getSize(size);
    this.composer = new EffectComposer(r);
    const pr = r.getPixelRatio();
    this.renderPass = new RenderPass(this.scene, this.camera); this.renderPass.enabled = false; this.composer.addPass(this.renderPass);
    // N8AO renders the scene itself (acts as the render pass) and composites screen-space ambient occlusion.
    this.ao = new N8AOPass(this.scene, this.camera, size.x * pr, size.y * pr);
    Object.assign(this.ao.configuration, { aoRadius: 2.0, distanceFalloff: 0.5, intensity: 6.0, aoSamples: 12, denoiseSamples: 6, denoiseRadius: 12, halfRes: true, gammaCorrection: false, screenSpaceRadius: false });
    this.composer.addPass(this.ao); this.aoEnabled = true;
    this.frameMs = 8;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.45, 0.6, 0.92); this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader); this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }
  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); this.composer.setSize(innerWidth, innerHeight); }
  setAO(on) { this.aoEnabled = on; this.ao.enabled = on; this.renderPass.enabled = !on; }
  buildBarrels() {
    const rng = this.city.rng; const geo = new THREE.CylinderGeometry(0.42, 0.42, 1.1, 12); const mat = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5, metalness: 0.4 });
    const band = new THREE.CylinderGeometry(0.43, 0.43, 0.08, 12); const bandMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 });
    const spots = [];
    for (const b of this.city.blocks) {
      if (b.type === 'industrial') for (let k = 0; k < 4; k++) spots.push([rng.range(b.x0 + 3, b.x1 - 3), rng.range(b.z0 + 3, b.z1 - 3)]);
      else if (b.type === 'lot') for (let k = 0; k < 3; k++) spots.push([rng.range(b.x0 + 2, b.x1 - 2), rng.range(b.z1 - 8, b.z1 - 2)]);
      else if (rng.chance(0.25)) spots.push([rng.chance(0.5) ? b.x0 - 1.5 : b.x1 + 1.5, rng.range(b.z0 + 2, b.z1 - 2)]);
    }
    for (const [x, z] of spots) {
      if (this.city.hash.query(x - 0.6, x + 0.6, z - 0.6, z + 0.6, []).some(bx => bx.kind === 'building')) continue;
      const m = new THREE.Mesh(geo, mat); const y = this.city.groundHeight(x, z); m.position.set(x, y + 0.55, z); m.castShadow = true; this.scene.add(m);
      const bd = new THREE.Mesh(band, bandMat); bd.position.y = 0.2; m.add(bd); const bd2 = bd.clone(); bd2.position.y = -0.2; m.add(bd2);
      const barrel = { x, y, z, mesh: m, health: 30, dead: false, hurt: (a, source) => { if (barrel.dead) return; barrel.health -= a; if (source) barrel.lastSource = source; if (barrel.health <= 0) this.explodeBarrel(barrel); } };
      barrel.collider = this.city.addCollider(x - 0.42, z - 0.42, x + 0.42, z + 0.42, 'prop', 1.1); this.barrels.push(barrel);
    }
  }
  explodeBarrel(b) {
    if (b.dead) return; b.dead = true; this.scene.remove(b.mesh); b.collider.disabled = true;
    this.effects.explosion(b.x, b.y, b.z, 0.8); this.audio.explosion(); this.rig.addShake(clamp(1.2 - dist2D(b.x, b.z, this.player.x, this.player.z) / 35, 0, 1));
    const src = b.lastSource || b; b.byPlayer = src.kind === 'player';
    setTimeout(() => this.explodeAt(b.x, b.y, b.z, 7, b.byPlayer ? this.player : b), 0);
    for (const o of this.barrels) if (o !== b && !o.dead && dist2D(o.x, o.z, b.x, b.z) < 8) o.lastSource = b.lastSource;
    this.pedsMgr.panicAround(b.x, b.z, 40, 6);
  }

  // ---------- entity helpers ----------
  addVehicle(type, x, z, heading, color) {
    const v = new Vehicle(type, color); v.world = this.world; v.setPosition(x, z, heading); v.y = this.city.groundHeight(x, z); v.syncMesh();
    this.scene.add(v.group); this.vehicles.push(v);
    v.onExploded = () => this.onVehicleExploded(v);
    v.onDamaged = (amount, cause) => { if (v.driver === this.player && cause !== 'bullet') { this.rig.addShake(Math.min(0.8, amount / 30)); } };
    v.onDestroyed = (cause) => { if (cause !== 'explode' && v.lastDamage?.byPlayer && v.control !== 'player') this.police.crime('destroy_vehicle', v.x, v.z); };
    return v;
  }
  removeVehicle(v) {
    const i = this.vehicles.indexOf(v); if (i >= 0) this.vehicles.splice(i, 1);
    if (v.driver && v.driver !== this.player) { const d = v.driver; d.vehicle = null; const pi = this.peds.indexOf(d); if (pi >= 0) { this.peds.splice(pi, 1); } const ci = this.police.cops.indexOf(d); if (ci >= 0) this.police.cops.splice(ci, 1); d.dispose(); }
    this.traffic.release(v); this.police.release(v); v.dispose();
  }
  crime(type, x, z) { this.police.crime(type, x, z); this.player.lastCrimeT = this.time; }
  notify(text, ms) { this.hud.notify(text, ms); }
  noise(x, z, r, shooter) { if (shooter === this.player || shooter?.kind === 'player') this.pedsMgr.panicAround(x, z, r, 6); }
  hornAt(v) { if (dist2D(v.x, v.z, this.player.x, this.player.z) < 60 && this.audio.ready) { this.audio.tone(380 + Math.random() * 80, 0.35, 0.08, 'square'); } }
  onPedKilled(ped, source) {
    const byPlayer = source === this.player || source?.driver === this.player || source?.kind === 'player';
    if (ped.kind === 'cop') { this.police.onCopKilled(ped, source); if (byPlayer) this.player.stats.kills++; }
    else if (byPlayer) { this.crime('kill_ped', ped.x, ped.z); this.player.stats.kills++; }
    if (ped.money > 0 && Math.random() < 0.7) this.pickups.add('money', ped.x + (Math.random() - 0.5), ped.z + (Math.random() - 0.5), true, ped.money);
    this.pedsMgr.panicAround(ped.x, ped.z, 25, 7);
  }
  onVehicleExploded(v) {
    this.effects.explosion(v.x, v.y, v.z, v.type.mass > 1800 ? 1.3 : 1); this.audio.explosion();
    const d = dist2D(v.x, v.z, this.player.x, this.player.z); this.rig.addShake(clamp(1.5 - d / 40, 0, 1.2));
    this.explodeAt(v.x, v.y, v.z, 9, v);
    this.pedsMgr.panicAround(v.x, v.z, 60, 8);
    if (v.lastDamage?.byPlayer && v.control !== 'player') this.crime('explosion', v.x, v.z);
  }
  explodeAt(x, y, z, r, source, byPlayerOk = false) {
    for (const b of this.barrels) { if (b !== source && !b.dead && dist2D(b.x, b.z, x, z) < r + 1) setTimeout(() => this.explodeBarrel(b), 120 + Math.random() * 250); }
    for (const p of this.peds) { const d = dist2D(p.x, p.z, x, z); if (d < r && !p.dead) { p.knock((p.x - x) / (d + 0.1) * 8, (p.z - z) / (d + 0.1) * 8, 200, source); } }
    const pd = dist2D(this.player.x, this.player.z, x, z);
    if (pd < r) { if (this.player.vehicle) this.player.vehicle.damage(60 * (1 - pd / r), 'explosion', source); else { this.player.knock((this.player.x - x) / (pd + 0.1) * 7, (this.player.z - z) / (pd + 0.1) * 7, 110 * (1 - pd / (r * 1.1))); } }
    for (const v of this.vehicles) { if (v === source) continue; const d = dist2D(v.x, v.z, x, z); if (d < r + 2) { v.damage(70 * (1 - d / (r + 2)), 'explosion', source); v.vy += 3 * (1 - d / (r + 2)); v.vx += (v.x - x) / (d + 0.1) * 4; v.vz += (v.z - z) / (d + 0.1) * 4; } }
  }
  onEnterVehicle(v) { this.hud.notify(v.type.name === 'police' ? 'Police cruiser — press R for radio' : `${v.typeName[0].toUpperCase() + v.typeName.slice(1)} — press R for radio, H for horn`, 2200); }
  onExitVehicle(v) { }
  onPlayerWasted() { this.hud.showBanner('WASTED', '', '#ff4040', 5000); this.audio.wasted(); this.respawnT = 5; this.respawnKind = 'hospital'; this.audio.setRadio(false); }
  onPlayerBusted() { this.hud.showBanner('BUSTED', '', '#6a8cff', 5000); this.audio.wasted(); this.respawnT = 5; this.respawnKind = 'station'; this.audio.setRadio(false); }
  doRespawn() {
    const pl = this.player;
    if (this.stores.interior) { this.stores.interior = null; this.stores.closeShop(); this.stores.cooldown = 1.2; } const loss = Math.floor(pl.money * 0.1); pl.money -= loss; if (loss > 0) this.hud.moneyPop(-loss);
    if (this.respawnKind === 'station') { for (const k in pl.ammo) pl.ammo[k] = Math.floor(pl.ammo[k] / 2); }
    const p = this.respawnKind === 'station' ? this.station : this.hospital; pl.respawn(p.x, p.z, p.h); pl.armor = 0;
    this.police.clear(); for (const c of [...this.police.copCars]) { this.police.copCars.splice(0); this.removeVehicle(c); }
    for (let i = this.police.cops.length - 1; i >= 0; i--) { const c = this.police.cops[i]; const pi = this.peds.indexOf(c); if (pi >= 0) this.peds.splice(pi, 1); c.dispose(); } this.police.cops.length = 0;
    this.hud.notify(this.respawnKind === 'station' ? 'Released from custody. Half your ammo was confiscated.' : 'Discharged from hospital.', 4000);
  }

  // ---------- main update ----------
  update(rawDt) {
    const dt = Math.min(rawDt, 1 / 30) * this.slowmo; const input = this.input, pl = this.player;
    if (input.hit('help')) this.hud.toggleHelp(); if (input.hit('map')) this.hud.toggleMap();
    if (this.hud.mapOpen) { this.hud.update(dt); input.endFrame(); return; } // the world pauses while the map is open
    if (input.hit('skiptime')) { this.dayFrac = (this.dayFrac + 0.1) % 1; this.hud.notify('Time skipped', 1000); }
    if (input.hitCode('KeyR') && !pl.vehicle && this.audio.ready) { /* radio only in cars */ }
    this.time += dt; this.dayFrac = (this.dayFrac + dt / DAY.LENGTH) % 1;
    this.night = this.env.update(this.dayFrac, new THREE.Vector3(pl.x, 0, pl.z));
    this.city.update(dt, this.time, this.night, this.env);
    // respawn flow
    if (this.respawnT > 0) { this.respawnT -= dt; if (this.respawnT <= 0) this.doRespawn(); }
    pl.update(dt);
    this.traffic.update(dt); this.police.update(dt); this.pedsMgr.update(dt);
    // vehicles physics
    for (const v of this.vehicles) {
      if (v.isParked && !v.driver && v.absSpeed < 0.01 && !v.lastCarHit && !v.onFire) { continue; }
      v.update(dt, this.world);
      if (v.lastHit && v.lastHit.impact > 3) { const d = dist2D(v.x, v.z, pl.x, pl.z); if (d < 80) this.audio.crash(v.lastHit.impact * clamp(1 - d / 80, 0.2, 1)); this.effects.sparks(v.x + v.lastHit.nx * -v.halfL * 0.5, v.y + 0.5, v.z + v.lastHit.nz * -v.halfL * 0.5, 6); if (v.driver === pl) this.rig.addShake(Math.min(1, v.lastHit.impact / 12)); }
    }
    for (let i = 0; i < this.vehicles.length; i++) for (let j = i + 1; j < this.vehicles.length; j++) {
      const a = this.vehicles[i], b = this.vehicles[j]; if (a.isParked && b.isParked) continue;
      const imp = collideVehicles(a, b);
      if (imp > 2.5) {
        const d = dist2D(a.x, a.z, pl.x, pl.z); if (d < 80) this.audio.crash(imp * clamp(1 - d / 80, 0.2, 1));
        this.effects.sparks((a.x + b.x) / 2, 0.6, (a.z + b.z) / 2, 8);
        if (a.isParked) { a.isParked = false; } if (b.isParked) b.isParked = false;
        const pv = pl.vehicle; if (pv === a || pv === b) { const o = pv === a ? b : a; this.rig.addShake(Math.min(1, imp / 10)); if (o.type.name === 'police' && o.control === 'cop') this.police.noteRam(); if (o.ai) { o.ai.scared = Math.max(o.ai.scared, 4); } }
        if (a.ai && !a.ai.scared) a.ai.honkT = 0; 
      }
    }
    // vehicle effects (smoke/fire/skids)
    const _hp = new THREE.Vector3();
    for (const v of this.vehicles) {
      const d = dist2D(v.x, v.z, pl.x, pl.z); if (d > 140) continue;
      if (v.health < 55 || v.destroyed) { v.hood.getWorldPosition(_hp); this.effects.carSmoke(_hp, v.destroyed ? 0.35 : clamp((55 - v.health) / 40, 0.1, 0.9)); }
      if (v.onFire) { v.hood.getWorldPosition(_hp); this.effects.carFire(_hp); }
      if (v.destroyed && Math.random() < 0.3) { this.effects.carFire(v.group.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0.6, (Math.random() - 0.5) * 3))); }
      // skids
      const s = Math.sin(v.heading), c = Math.cos(v.heading); const vr = v.vx * c - v.vz * s; const spd = v.absSpeed;
      const skidding = (Math.abs(vr) > 3.5 && spd > 4) || (v.handbrake && spd > 5) || (v.braking && spd > 14 && v.brake > 0.8);
      v.skidLevel = damp(v.skidLevel || 0, skidding ? 1 : 0, 10, dt);
      if (skidding && this.city.onRoad(v.x, v.z)) {
        const wb = v.wheelbase / 2; const dirX = v.vx / spd, dirZ = v.vz / spd;
        for (const sx of [-1, 1]) { const wx = v.x - s * wb + c * sx * (v.halfW - 0.15), wz = v.z - c * wb - s * sx * (v.halfW - 0.15); this.effects.skid(wx, wz, v.y + 0.02, dirX, dirZ, 0.25, clamp(Math.abs(vr) / 8 + (v.handbrake ? 0.4 : 0), 0.3, 0.9)); }
        if (Math.random() < 0.5) this.effects.puff(v.x - s * wb, v.y + 0.2, v.z - c * wb, 1, 0.8);
      }
    }
    this.pickups.update(dt); this.missions.update(dt); this.stores.update(dt); this.projectiles.update(dt);
    // recycle cars the player abandoned far away (and wrecks) so the vehicle list doesn't grow forever
    if ((this._gcT = (this._gcT || 0) + dt) > 2) { this._gcT = 0; for (let i = this.vehicles.length - 1; i >= 0; i--) { const v = this.vehicles[i]; if (!v.driver && !v.mission && v !== pl.vehicle && (v.abandoned || (v.destroyed && v.control === 'none')) && dist2D(v.x, v.z, pl.x, pl.z) > 180) this.removeVehicle(v); } }
    this.effects.update(dt);
    if (input.hit('ao')) { this.setAO(!this.aoEnabled); this.hud.notify('Ambient occlusion ' + (this.aoEnabled ? 'on' : 'off'), 1200); }
    // camera
    const mode = pl.vehicle ? 'car' : pl.aiming ? 'aim' : 'foot';
    const focus = pl.vehicle ? { x: pl.vehicle.x, y: pl.vehicle.y + 0.3, z: pl.vehicle.z } : { x: pl.x, y: pl.y, z: pl.z };
    const velHeading = pl.vehicle && pl.vehicle.absSpeed > 1 ? Math.atan2(pl.vehicle.vx, pl.vehicle.vz) : pl.heading;
    const carVelH = pl.vehicle ? (pl.vehicle.speed < -1 ? pl.vehicle.heading : velHeading) : pl.heading;
    this.rig.update(dt, input, focus, pl.heading, pl.absSpeed, mode, carVelH);
    // post grade
    const dead = pl.dead || pl.busted;
    this.grade.uniforms.uDesat.value = damp(this.grade.uniforms.uDesat.value, dead ? 0.85 : 0, 3, dt);
    this.grade.uniforms.uRed.value = damp(this.grade.uniforms.uRed.value, pl.damageFlash * 0.5 + (pl.health < 25 && !dead ? 0.18 : 0), 8, dt);
    this.grade.uniforms.uFade.value = damp(this.grade.uniforms.uFade.value, this.respawnT > 0 && this.respawnT < 1.2 ? 1 : 0, 6, dt);
    this.bloom.strength = 0.35 + this.night * 0.35;
    // HUD blips
    const blips = this.missions.blips();
    for (const c of this.police.copCars) if (!c.destroyed) blips.push({ x: c.x, z: c.z, color: '#4d7cff', kind: 'cop', size: 6 });
    for (const c of this.police.cops) if (!c.vehicle && !c.dead) blips.push({ x: c.x, z: c.z, color: '#4d7cff', kind: 'cop', size: 5 });
    for (const it of this.pickups.items) if (it.active && dist2D(it.x, it.z, pl.x, pl.z) < 90) blips.push({ x: it.x, z: it.z, color: it.cat === 'health' ? '#ff5050' : it.cat === 'armor' ? '#5090ff' : it.cat === 'money' ? '#50ff80' : '#ffffff', kind: 'pickup', size: 3 });
    for (const s of this.stores.stores) blips.push({ x: s.doorX, z: s.doorZ, color: s.color, kind: 'store', size: 7, label: s.kind === 'gun' ? 'A' : s.kind === 'food' ? 'B' : s.kind === 'clothes' ? 'T' : 'S' });
    for (const p of this.peds) if (p.kind === 'gang' && p.hostile && !p.dead) blips.push({ x: p.x, z: p.z, color: '#ff3030', kind: 'cop', size: 5 });
    this.hud.blips = blips;
    this.updateGuide(dt, blips);
    this.updateVehicleLights();
    // hints
    if (!pl.vehicle && !pl.dead && !this.missions.active && !this.stores.interior) { const v = pl.nearestVehicle(4.5); const np = pl.nearestPed(2.6); if (v) this.hud.setHint(v.driver && v.driver !== pl ? 'Press F to jack the car' : 'Press F to enter'); else if (np && pl.talkT <= 0) this.hud.setHint('Press E to talk'); else if (!this.missions.markers.some(m => dist2D(pl.x, pl.z, m.x, m.z) < 12)) this.hud.setHint(''); }
    else if (pl.vehicle) this.hud.setHint('');
    pl.talkT = Math.max(0, pl.talkT - dt);
    // auto-disable AO if the frame budget is blown
    this.frameMs = damp(this.frameMs, rawDt * 1000, 1, dt); if (this.aoEnabled && this.frameMs > 30 && this.time > 5 && !this._aoWarned) { this._aoWarned = true; this.setAO(false); this.hud.notify('Ambient occlusion disabled for performance (O to re-enable)', 3000); }
    this.hud.update(dt);
    this.updateAudio(dt);
    input.endFrame();
  }
  // Points the arrow above the player at the current objective (or the nearest mission marker when idle) and writes the distance into the objective text.
  updateGuide(dt, blips) {
    const pl = this.player; let target = null, label = null;
    if (this.missions.active) { target = blips.find(b => b.guide) || null; }
    else if (!this.stores.interior) {
      let best = Infinity; for (const m of this.missions.markers) { const d = dist2D(m.x, m.z, pl.x, pl.z); if (d < best) { best = d; target = m; } }
      if (target) label = `Nearest mission: ${target.name} · ${Math.round(best)} m — walk into the yellow marker (M for map)`;
    }
    this.guide = target;
    if (label !== null && !this.missions.active) this.hud.setObjective(label, true);
    if (!target || pl.dead) { this.guideArrow.visible = false; return; }
    const d = dist2D(target.x, target.z, pl.x, pl.z);
    this.guideArrow.visible = d > 6;
    const y = (pl.vehicle ? pl.vehicle.y + 2.6 : pl.y + 3.1) + Math.sin(this.time * 4) * 0.12;
    this.guideArrow.position.set(pl.x, y, pl.z); this.guideArrow.lookAt(target.x, y, target.z); this.guideArrow.rotation.z += this.time * 2;
    if (this.missions.active) this.hud.setDistance(d);
  }
  updateVehicleLights() {
    const pl = this.player, v = pl.vehicle; const on = v && v.lightsOn && !v.destroyed;
    this.headlights.forEach((sp, i) => {
      if (!on) { sp.intensity = 0; return; }
      const s = Math.sin(v.heading), c = Math.cos(v.heading); const side = i === 0 ? -1 : 1; const rx = c * side * (v.halfW - 0.35), rz = -s * side * (v.halfW - 0.35);
      sp.position.set(v.x + s * v.halfL + rx, v.y + v.headY, v.z + c * v.halfL + rz); sp.target.position.set(v.x + s * (v.halfL + 14) + rx * 2, v.y - 0.3, v.z + c * (v.halfL + 14) + rz * 2); sp.intensity = 60;
    });
    const cops = this.police.copCars.filter(c => c.sirenOn && !c.destroyed).sort((a, b) => dist2D(a.x, a.z, pl.x, pl.z) - dist2D(b.x, b.z, pl.x, pl.z));
    this.sirenLights.forEach((l, i) => { const c = cops[i]; if (!c) { l.intensity = 0; return; } l.position.set(c.x, c.y + (c.sirenY || 1.8), c.z); l.color.setHex(c.sirenPhase ? 0xff3030 : 0x3060ff); l.intensity = 25; });
  }
  updateAudio(dt) {
    const a = this.audio, pl = this.player; if (!a.ready) return;
    const v = pl.vehicle;
    if (v && !v.destroyed) { const sp = clamp(v.absSpeed / v.type.maxSpeed, 0, 1); const gear = Math.min(4, Math.floor(sp * 5)); const rpm = clamp((sp * 5 - gear) * 0.7 + 0.2 + v.throttle * 0.15, 0, 1); a.setEngine(true, rpm, v.throttle, sp, v.skidLevel || 0); }
    else a.setEngine(false, 0, 0, 0, 0);
    // nearest siren
    let best = 0; for (const c of this.police.copCars) if (c.sirenOn) best = Math.max(best, clamp(1 - dist2D(c.x, c.z, pl.x, pl.z) / 130, 0, 1));
    a.setSiren(best, dt);
    a.updateRadio();
  }
  render() { this.composer.render(); }
}
