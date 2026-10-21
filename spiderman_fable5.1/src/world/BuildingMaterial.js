import * as THREE from 'three';

/**
 * Standard PBR material with procedurally generated windows computed from world position,
 * so a single instanced box geometry reads as a lit skyscraper. Works with shadows + fog.
 */
export function buildingMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.05 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    mat.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNormal;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        {
          mat4 im = mat4(1.0);
          #ifdef USE_INSTANCING
            im = instanceMatrix;
          #endif
          vec4 wp = modelMatrix * im * vec4(transformed, 1.0);
          vWPos = wp.xyz;
          vWNormal = normalize(mat3(modelMatrix * im) * objectNormal);
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNormal;
        float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 n = normalize(vWNormal);
          if (abs(n.y) > 0.5) {
            // roof: gravel grey with subtle noise
            float g = hash21(floor(vWPos.xz * 0.25));
            diffuseColor.rgb = mix(vec3(0.24, 0.24, 0.25), vec3(0.28, 0.275, 0.27), g) * (0.9 + 0.2 * step(0.5, n.y));
          } else {
            float u = abs(n.x) > 0.5 ? vWPos.z : vWPos.x;
            float v = vWPos.y;
            float floorH = 3.5, winW = 2.2;
            vec2 cell = vec2(floor(u / winW), floor(v / floorH));
            vec2 f = vec2(fract(u / winW), fract(v / floorH));
            float bx = 0.42 + 0.2 * hash21(floor(vWPos.xz * 0.02) + 3.0);   // per-building window width
            float win = step(abs(f.x - 0.5), bx * 0.5) * step(abs(f.y - 0.52), 0.2);
            float ground = step(v, floorH * 1.05);
            // facade banding per floor
            float band = 0.9 + 0.1 * step(0.9, f.y);
            diffuseColor.rgb *= band;
            // glass
            vec3 glass = vec3(0.12, 0.15, 0.2);
            float h = hash21(cell + floor(vWPos.xz * 0.013));
            float lit = step(0.72, h);
            float bright = 0.5 + 0.5 * hash21(cell * 1.7 + 11.0);
            vec3 warm = mix(vec3(1.0, 0.82, 0.55), vec3(0.85, 0.95, 1.0), step(0.85, hash21(cell + 5.0)));
            diffuseColor.rgb = mix(diffuseColor.rgb, glass, win);
            // storefront: lit strip at ground floor
            float store = ground * step(abs(f.y - 0.5), 0.3) * step(abs(f.x - 0.5), 0.42) * step(0.45, h);
            vec3 em = warm * (lit * bright * 0.75 * win + store * 0.45);
            vEmissiveHack = em;
          }
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vEmissiveHack;`)
      .replace('void main() {', `vec3 vEmissiveHack = vec3(0.0);
        void main() {`);
  };
  mat.customProgramCacheKey = () => 'building-v1';
  return mat;
}
