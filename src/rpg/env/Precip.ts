import * as THREE from 'three';
import { worldUniforms } from '../../world/materials';

/**
 * Snow and blowing dust: soft points in a box that wraps round the camera,
 * falling (or streaming sideways) on the GPU. Rain is District 03's own
 * streak renderer, reused.
 */
export class Precip {
  points: THREE.Points;
  private u = {
    uTime: worldUniforms.uTime,
    uCenter: { value: new THREE.Vector3() },
    uSnow: { value: 0 },
    uDust: { value: 0 },
    uWind: { value: new THREE.Vector2(1, 0.4) },
    uDay: { value: 0 },
  };

  constructor(count = 9000) {
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count * 4; i++) seeds[i] = Math.random();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: this.u,
        transparent: true,
        depthWrite: false,
        vertexShader: /* glsl */ `
          attribute vec4 aSeed;
          uniform float uTime; uniform vec3 uCenter; uniform float uSnow; uniform float uDust; uniform vec2 uWind;
          varying float vA; varying float vDust;
          void main() {
            vec3 box = vec3(40.0, 22.0, 40.0);
            float dust = step(aSeed.w, uDust);
            float snow = step(aSeed.w, uSnow) * (1.0 - dust);
            vDust = dust;
            float fall = mix(1.2 + aSeed.y * 0.8, 0.3, dust);
            vec3 p = aSeed.xyz * box;
            p.y -= uTime * fall;
            p.xz += uWind * uTime * mix(0.35, 2.2, dust) + vec2(sin(uTime * 0.8 + aSeed.x * 20.0), cos(uTime * 0.7 + aSeed.z * 17.0)) * 0.6;
            p = mod(p - uCenter + box * 0.5, box) + uCenter - box * 0.5;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            vA = (snow + dust) * smoothstep(40.0, 5.0, -mv.z);
            gl_PointSize = (snow > 0.5 ? 3.0 : 2.0) * 120.0 / max(-mv.z, 1.0);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uDay;
          varying float vA; varying float vDust;
          void main() {
            if (vA < 0.01) discard;
            float r = length(gl_PointCoord - 0.5) * 2.0;
            float a = smoothstep(1.0, 0.2, r) * vA;
            vec3 c = mix(vec3(0.85, 0.88, 0.95), vec3(0.62, 0.46, 0.3), vDust) * (0.25 + 0.75 * uDay);
            gl_FragColor = vec4(c, a * 0.8);
          }`,
      }),
    );
    this.points.frustumCulled = false;
  }

  update(cam: THREE.Vector3, snow: number, dust: number, windDir: number, wind: number, day: number) {
    this.u.uCenter.value.copy(cam);
    this.u.uSnow.value = snow;
    this.u.uDust.value = dust;
    this.u.uWind.value.set(Math.sin(windDir), Math.cos(windDir)).multiplyScalar(0.3 + wind * 0.15);
    this.u.uDay.value = day;
    this.points.visible = snow > 0.01 || dust > 0.01;
  }
}
