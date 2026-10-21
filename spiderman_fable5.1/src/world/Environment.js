import * as THREE from 'three';

/** Dusk sky, sun with a player-following shadow cascade, hemisphere fill, fog. */
export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.sunDir = new THREE.Vector3(-0.55, 0.32, -0.75).normalize();

    // Sky dome
    const skyGeo = new THREE.SphereGeometry(6000, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x0e1e4a) },
        mid: { value: new THREE.Color(0x4a5f9e) },
        horizon: { value: new THREE.Color(0xf0a06a) },
        below: { value: new THREE.Color(0x2a2430) },
        sunDir: { value: this.sunDir.clone() },
        sunColor: { value: new THREE.Color(0xffe0b0) },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 top, mid, horizon, below, sunDir, sunColor; varying vec3 vDir;
        void main(){
          float y = vDir.y;
          vec3 c;
          if (y < 0.0) c = mix(horizon, below, clamp(-y * 6.0, 0.0, 1.0));
          else { float t = pow(clamp(y, 0.0, 1.0), 0.45); c = mix(horizon, mix(mid, top, clamp((y-0.15)/0.85,0.0,1.0)), t); }
          float s = max(dot(vDir, sunDir), 0.0);
          c += sunColor * (pow(s, 600.0) * 3.0 + pow(s, 12.0) * 0.35 + pow(s, 3.0) * 0.12);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    scene.add(this.sky);

    scene.fog = new THREE.FogExp2(0xc99a80, 0.0011);

    const sun = new THREE.DirectionalLight(0xffd9b0, 2.6);
    sun.position.copy(this.sunDir).multiplyScalar(400);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const R = 140;
    sun.shadow.camera.left = -R; sun.shadow.camera.right = R; sun.shadow.camera.top = R; sun.shadow.camera.bottom = -R;
    sun.shadow.camera.near = 10; sun.shadow.camera.far = 1200;
    sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.6;
    this.sun = sun;
    scene.add(sun); scene.add(sun.target);

    const hemi = new THREE.HemisphereLight(0x8fa4e6, 0x6a5a50, 1.35);
    scene.add(hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(this.ambient);
  }

  /** Keep the shadow frustum + sky centred on the player each frame. */
  update(focus) {
    this.sky.position.copy(focus);
    // Snap shadow cam to texel grid to avoid shimmer
    const snap = 4;
    const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap, fy = Math.round(focus.y / snap) * snap;
    this.sun.target.position.set(fx, fy, fz);
    this.sun.position.set(fx, fy, fz).addScaledVector(this.sunDir, 500);
    this.sun.target.updateMatrixWorld();
  }
}
