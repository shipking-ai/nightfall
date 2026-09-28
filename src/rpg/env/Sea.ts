import * as THREE from 'three';
import { NOISE } from '../../render/glsl';
import { worldUniforms } from '../../world/materials';
import type { Sky } from '../../env/Sky';
import { SEA_Y } from '../world/WorldGen';

/**
 * Open water for the wider world: the sea (one big sheet that follows you)
 * and the rivers and lakes the streamer lays into the land. Reflects the sky
 * it's under — grey in rain, gold at sunset, a line of moonlight at night —
 * with the sun's glitter on it and swell that grows with the wind.
 */
export function createSeaMaterial(sky: Sky, fog: THREE.FogExp2): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: worldUniforms.uTime,
      uZenith: sky.uniforms.uZenith,
      uHorizon: sky.uniforms.uHorizon,
      uGlow: sky.uniforms.uGlow,
      uSunDir: sky.uniforms.uSunDir,
      uSunCol: sky.uniforms.uSunCol,
      uDay: sky.uniforms.uDay,
      uMoonDir: sky.uniforms.uMoonDir,
      uFogColor: { value: fog.color },
      uFog: { value: 0.001 },
      uWind: { value: 0.3 },
      uRain: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uWind;
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        // long swell on the sea (the fresh water sheets stay flat)
        float sea = step(abs(w.y - (${SEA_Y.toFixed(2)})), 0.05);
        w.y += sea * (sin(w.x * 0.05 + uTime * 0.9) * 0.18 + sin(w.z * 0.07 - uTime * 0.7) * 0.14) * (0.4 + uWind);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGlow; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uDay;
      uniform vec3 uMoonDir; uniform vec3 uFogColor; uniform float uFog; uniform float uWind; uniform float uRain;
      varying vec3 vW;
      ${NOISE}
      void main() {
        vec2 p = vW.xz;
        float e = 0.2;
        float sc = 0.12 + uWind * 0.06;
        vec2 flow = vec2(uTime * 0.25, uTime * 0.11);
        float h0 = nf_fbm(p * sc + flow) + nf_noise(p * 0.9 - flow * 3.0) * 0.12;
        float hx = nf_fbm((p + vec2(e, 0.0)) * sc + flow) + nf_noise((p + vec2(e, 0.0)) * 0.9 - flow * 3.0) * 0.12;
        float hz = nf_fbm((p + vec2(0.0, e)) * sc + flow) + nf_noise((p + vec2(0.0, e)) * 0.9 - flow * 3.0) * 0.12;
        float amp = 1.2 + uWind * 2.5 + uRain;
        vec3 n = normalize(vec3((h0 - hx) * amp, 1.0, (h0 - hz) * amp));
        vec3 V = normalize(cameraPosition - vW);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
        vec3 R = reflect(-V, n);
        float up = max(R.y, 0.0);
        vec3 skyRef = mix(uHorizon, uZenith, smoothstep(0.0, 0.5, up)) + uGlow * exp(-up * 6.0);
        // sun glitter, moon path
        float s = max(dot(R, normalize(uSunDir)), 0.0);
        vec3 spec = uSunCol * (pow(s, 600.0) * 60.0 + pow(s, 60.0) * 1.2) * smoothstep(-0.05, 0.1, uSunDir.y);
        float m = max(dot(R, normalize(uMoonDir)), 0.0);
        spec += vec3(0.6, 0.65, 0.8) * pow(m, 300.0) * 6.0 * (1.0 - uDay);
        vec3 deep = mix(vec3(0.004, 0.008, 0.012), vec3(0.02, 0.07, 0.09), uDay);
        vec3 col = mix(deep, skyRef, fres) + spec * (1.0 - uRain * 0.7);
        float dist = length(cameraPosition - vW);
        float f = 1.0 - exp(-pow(uFog * dist, 2.0));
        col = mix(col, uFogColor, f);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/** The sea: a big sheet at sea level that follows you (the land hides it wherever it's above water). */
export class Sea {
  mesh: THREE.Mesh;
  constructor(public material: THREE.ShaderMaterial) {
    // finer in the middle, where you see the swell
    const g = new THREE.PlaneGeometry(14000, 14000, 140, 140).rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.position.y = SEA_Y;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  update(cam: THREE.Vector3, fogDensity: number, wind: number, rain: number) {
    // snap to the grid spacing so the swell doesn't swim
    const step = 100;
    this.mesh.position.x = Math.round(cam.x / step) * step;
    this.mesh.position.z = Math.round(cam.z / step) * step;
    const u = this.material.uniforms;
    u.uFog.value = fogDensity;
    u.uWind.value = Math.min(1, wind / 14);
    u.uRain.value = rain;
  }
}
