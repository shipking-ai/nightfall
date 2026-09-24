import * as THREE from 'three';
import { NOISE } from '../render/glsl';
import { worldUniforms } from '../world/materials';

const BOX = new THREE.Vector3(44, 26, 44);

/**
 * Rain: GPU-animated streaks in a box that wraps around the camera, ground
 * splashes, and steam from the vents. No per-frame CPU work beyond uniforms.
 */
export class Weather {
  group = new THREE.Group();
  intensity = 0.7; // 0..1, drives particle density, sound and haze
  private rain: THREE.LineSegments;
  private splashes: THREE.Mesh;
  private steam: THREE.Points | null = null;
  private rainU = {
    uTime: worldUniforms.uTime,
    uCenter: { value: new THREE.Vector3() },
    uBox: { value: BOX },
    uWind: { value: new THREE.Vector2(1.2, 0.5) },
    uIntensity: { value: 0.7 },
    uLen: { value: 0.75 },
  };

  constructor(maxDrops: number, vents: THREE.Vector3[]) {
    this.rain = this.makeRain(maxDrops);
    this.splashes = this.makeSplashes(700);
    this.group.add(this.rain, this.splashes);
    if (vents.length) {
      this.steam = this.makeSteam(vents);
      this.group.add(this.steam);
    }
  }

  setDensity(maxDrops: number) {
    this.rain.geometry.setDrawRange(0, maxDrops * 2);
  }

  setAtmosphere(on: boolean) {
    this.splashes.visible = on;
    if (this.steam) this.steam.visible = on;
  }

  update(camPos: THREE.Vector3) {
    this.rainU.uCenter.value.copy(camPos);
    this.rainU.uIntensity.value = this.intensity;
  }

  private makeRain(n: number) {
    const MAX = 12000;
    const seeds = new Float32Array(MAX * 2 * 4);
    const ends = new Float32Array(MAX * 2);
    for (let i = 0; i < MAX; i++) {
      const s = [Math.random(), Math.random(), Math.random(), Math.random()];
      for (let k = 0; k < 2; k++) {
        seeds.set(s, (i * 2 + k) * 4);
        ends[i * 2 + k] = k;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 2 * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    g.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    g.setDrawRange(0, n * 2);
    const m = new THREE.ShaderMaterial({
      uniforms: this.rainU,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed; attribute float aEnd;
        uniform float uTime; uniform vec3 uCenter; uniform vec3 uBox; uniform vec2 uWind; uniform float uIntensity; uniform float uLen;
        varying float vA;
        void main() {
          float speed = 12.0 + aSeed.w * 5.0;
          vec3 p0 = aSeed.xyz * uBox + vec3(uWind.x * uTime, -speed * uTime, uWind.y * uTime);
          vec3 p = uCenter + mod(p0 - uCenter, uBox) - uBox * 0.5;
          vec3 vel = normalize(vec3(uWind.x, -speed, uWind.y));
          p += vel * aEnd * uLen * (0.6 + aSeed.w * 0.8);
          float d = length(p - cameraPosition);
          vA = (1.0 - aEnd * 0.8) * smoothstep(0.6, 2.5, d) * (1.0 - smoothstep(14.0, 22.0, d));
          if (aSeed.w > uIntensity) vA = 0.0;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          if (vA <= 0.001) discard;
          gl_FragColor = vec4(vec3(0.55, 0.57, 0.6) * vA * 0.14, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const l = new THREE.LineSegments(g, m);
    l.frustumCulled = false;
    return l;
  }

  private makeSplashes(n: number) {
    const base = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const g = new THREE.InstancedBufferGeometry().copy(base as unknown as THREE.InstancedBufferGeometry);
    const seeds = new Float32Array(n * 2);
    for (let i = 0; i < n * 2; i++) seeds[i] = Math.random();
    g.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seeds, 2));
    g.instanceCount = n;
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: worldUniforms.uTime, uCenter: this.rainU.uCenter, uIntensity: this.rainU.uIntensity },
      vertexShader: /* glsl */ `
        attribute vec2 iSeed;
        uniform float uTime; uniform vec3 uCenter; uniform float uIntensity;
        varying vec2 vUv; varying float vLife; varying float vA;
        ${NOISE}
        void main() {
          float period = 0.55 + iSeed.y * 0.4;
          float t = uTime / period + iSeed.x * 10.0;
          float cyc = floor(t);
          vLife = fract(t);
          vec2 r = vec2(nf_hash(vec2(cyc, iSeed.x * 97.0)), nf_hash(vec2(iSeed.y * 53.0, cyc))) - 0.5;
          vec2 xz = floor(uCenter.xz / 4.0) * 4.0 + r * 30.0;
          vec3 p = vec3(xz.x, 0.165, xz.y);
          vUv = uv;
          float d = length(p.xz - cameraPosition.xz);
          vA = (1.0 - smoothstep(6.0, 15.0, d)) * step(iSeed.y, uIntensity);
          p += position * (0.05 + vLife * 0.13);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; varying float vLife; varying float vA;
        void main() {
          float r = length(vUv - 0.5) * 2.0;
          float ring = smoothstep(0.62, 0.86, r) * (1.0 - smoothstep(0.86, 1.0, r));
          float a = ring * (1.0 - vLife) * vA * 0.1;
          gl_FragColor = vec4(vec3(0.6, 0.62, 0.66) * a, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    return mesh;
  }

  private makeSteam(vents: THREE.Vector3[]) {
    const per = 36;
    const n = vents.length * per;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    vents.forEach((v, i) => {
      for (let k = 0; k < per; k++) {
        const j = i * per + k;
        pos.set([v.x, v.y, v.z], j * 3);
        seed[j] = Math.random();
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: worldUniforms.uTime, uScale: { value: 380 } },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime; uniform float uScale;
        varying float vA;
        void main() {
          float life = fract(uTime * 0.09 + aSeed);
          vec3 p = position;
          p.y += life * 5.5;
          p.x += sin(aSeed * 40.0 + uTime * 0.3) * 0.4 * life + life * life * 1.6;
          p.z += cos(aSeed * 23.0 + uTime * 0.2) * 0.4 * life + life * 0.6;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vA = sin(life * 3.14159) * 0.14;
          gl_PointSize = (0.8 + life * 3.6) * uScale / max(-mv.z, 0.5);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float a = pow(max(1.0 - r, 0.0), 2.0) * vA;
          gl_FragColor = vec4(vec3(0.34, 0.31, 0.28), a);
        }`,
      transparent: true,
      depthWrite: false,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    return pts;
  }
}
