import * as THREE from 'three';
import type { Lamp } from '../world/WorldContext';
import { NOISE } from '../render/glsl';
import { worldUniforms } from '../world/materials';

/**
 * Cheap light presence for every lamp in the district:
 *  - halos: soft billboards at the source (read as glare in wet air)
 *  - cones: faint shafts under street lamps, visible because of the rain
 *  - streaks: elongated reflections on wet ground / water, pointing at the viewer
 * All three are single instanced draws; flicker is written into a per-instance gain.
 */
export class LightFX {
  group = new THREE.Group();
  private haloGain: THREE.InstancedBufferAttribute;
  private streakGain: THREE.InstancedBufferAttribute;
  private coneGain: THREE.InstancedBufferAttribute | null = null;
  private coneLamps: Lamp[] = [];
  readonly uniforms = {
    uHalo: { value: 1 },
    uCone: { value: 1 },
    uStreak: { value: 1 },
    uRain: { value: 0.6 },
  };
  private halos: THREE.Mesh;
  private cones: THREE.Mesh | null = null;
  private streaks: THREE.Mesh;

  constructor(private lamps: Lamp[]) {
    /* halos */
    const hl = lamps.filter((l) => l.halo > 0);
    const hg = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1) as unknown as THREE.InstancedBufferGeometry);
    hg.instanceCount = hl.length;
    hg.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(hl.flatMap((l) => l.pos.toArray())), 3));
    hg.setAttribute('iCol', new THREE.InstancedBufferAttribute(new Float32Array(hl.flatMap((l) => l.color.toArray())), 3));
    hg.setAttribute('iSize', new THREE.InstancedBufferAttribute(new Float32Array(hl.map((l) => l.halo)), 1));
    this.haloGain = new THREE.InstancedBufferAttribute(new Float32Array(hl.length).fill(1), 1);
    this.haloGain.setUsage(THREE.DynamicDrawUsage);
    hg.setAttribute('iGain', this.haloGain);
    this.halos = new THREE.Mesh(
      hg,
      new THREE.ShaderMaterial({
        uniforms: { uHalo: this.uniforms.uHalo, uRain: this.uniforms.uRain, uEmit: worldUniforms.uEmit },
        vertexShader: /* glsl */ `
          attribute vec3 iPos; attribute vec3 iCol; attribute float iSize; attribute float iGain;
          varying vec2 vUv; varying vec3 vCol; varying float vFade;
          void main() {
            vUv = uv;
            vCol = iCol * iGain;
            vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
            float d = -mv.z;
            float s = iSize * (1.1 + d * 0.012);
            mv.xyz += normalize(-mv.xyz) * min(iSize * 0.6, d * 0.5);
            mv.xy += position.xy * s * 2.0;
            vFade = smoothstep(0.3, 2.5, d) * (0.35 + 0.65 * exp(-d * 0.006));
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uHalo; uniform float uRain; uniform float uEmit;
          varying vec2 vUv; varying vec3 vCol; varying float vFade;
          void main() {
            float r = length(vUv - 0.5) * 2.0;
            float glow = pow(max(1.0 - r, 0.0), 3.0) * (0.22 + 0.25 * uRain);
            float core = exp(-r * r * 60.0) * 1.6;
            vec3 c = vCol * (glow + core) * vFade * uHalo * uEmit;
            gl_FragColor = vec4(c, 1.0);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.halos.frustumCulled = false;
    this.halos.renderOrder = 5;
    this.group.add(this.halos);

    /* cones */
    const cl = lamps.filter((l) => l.cone && l.pos.y - l.ground > 2.5);
    this.coneLamps = cl;
    if (cl.length) {
      const base = new THREE.CylinderGeometry(0.12, 1, 1, 18, 1, true).translate(0, -0.5, 0);
      const cg = new THREE.InstancedBufferGeometry().copy(base as unknown as THREE.InstancedBufferGeometry);
      cg.instanceCount = cl.length;
      cg.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(cl.flatMap((l) => l.pos.toArray())), 3));
      cg.setAttribute('iCol', new THREE.InstancedBufferAttribute(new Float32Array(cl.flatMap((l) => l.color.toArray())), 3));
      cg.setAttribute('iH', new THREE.InstancedBufferAttribute(new Float32Array(cl.map((l) => l.pos.y - l.ground)), 1));
      this.coneGain = new THREE.InstancedBufferAttribute(new Float32Array(cl.length).fill(1), 1);
      this.coneGain.setUsage(THREE.DynamicDrawUsage);
      cg.setAttribute('iGain', this.coneGain);
      this.cones = new THREE.Mesh(
        cg,
        new THREE.ShaderMaterial({
          uniforms: { uCone: this.uniforms.uCone, uRain: this.uniforms.uRain, uEmit: worldUniforms.uEmit },
          vertexShader: /* glsl */ `
            attribute vec3 iPos; attribute vec3 iCol; attribute float iH; attribute float iGain;
            varying float vY; varying vec3 vCol; varying float vRim; varying float vDist;
            void main() {
              float spread = iH * 0.62;
              vec3 p = vec3(position.x * spread, position.y * iH, position.z * spread) + iPos;
              vY = -position.y;
              vCol = iCol * iGain;
              vec4 mv = modelViewMatrix * vec4(p, 1.0);
              vec3 n = normalize(normalMatrix * vec3(normal.x, 0.35, normal.z));
              vRim = abs(dot(n, normalize(-mv.xyz)));
              vDist = -mv.z;
              gl_Position = projectionMatrix * mv;
            }`,
          fragmentShader: /* glsl */ `
            uniform float uCone; uniform float uRain; uniform float uEmit;
            varying float vY; varying vec3 vCol; varying float vRim; varying float vDist;
            void main() {
              float y = clamp(vY, 0.0, 1.0);
              float rim = clamp(vRim, 0.0, 1.0);
              float a = pow(1.0 - y, 1.8) * rim * rim * 0.05 * (0.4 + uRain);
              a *= smoothstep(1.0, 4.0, vDist) * exp(-vDist * 0.012);
              gl_FragColor = vec4(vCol * max(a, 0.0) * uCone * uEmit, 1.0);
            }`,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        }),
      );
      this.cones.frustumCulled = false;
      this.cones.renderOrder = 4;
      this.group.add(this.cones);
    }

    /* streaks */
    const sl = lamps.filter((l) => l.streak > 0);
    const sg = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1, 1, 6) as unknown as THREE.InstancedBufferGeometry);
    sg.instanceCount = sl.length;
    sg.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(sl.flatMap((l) => [l.pos.x, l.ground + (l.ground < -1 ? 0.03 : 0.022), l.pos.z])), 3));
    sg.setAttribute('iCol', new THREE.InstancedBufferAttribute(new Float32Array(sl.flatMap((l) => l.color.toArray())), 3));
    sg.setAttribute('iH', new THREE.InstancedBufferAttribute(new Float32Array(sl.map((l) => Math.max(0.3, l.pos.y - l.ground))), 1));
    sg.setAttribute('iStr', new THREE.InstancedBufferAttribute(new Float32Array(sl.map((l) => l.streak)), 1));
    this.streakGain = new THREE.InstancedBufferAttribute(new Float32Array(sl.length).fill(1), 1);
    this.streakGain.setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('iGain', this.streakGain);
    this.streaks = new THREE.Mesh(
      sg,
      new THREE.ShaderMaterial({
        uniforms: { uStreak: this.uniforms.uStreak, uTime: worldUniforms.uTime, uWet: worldUniforms.uWet, uEmit: worldUniforms.uEmit },
        vertexShader: /* glsl */ `
          attribute vec3 iPos; attribute vec3 iCol; attribute float iH; attribute float iStr; attribute float iGain;
          varying vec2 vUv; varying vec3 vCol; varying vec3 vW; varying float vFade; varying float vWater;
          void main() {
            vec2 toCam = cameraPosition.xz - iPos.xz;
            float D = max(length(toCam), 0.01);
            vec2 d = toCam / D;
            vec2 perp = vec2(-d.y, d.x);
            float eye = max(cameraPosition.y - iPos.y, 0.3);
            float R = D * iH / (iH + eye);           // mirror point, from the light's foot
            float L = min(R * 1.05, 2.0 + iH * 2.4 * iStr);
            float v = position.y + 0.5;              // 0 far end … 1 near end
            float s = R - L + v * L * 1.18;
            float w = (0.35 + 0.09 * iH) * (0.6 + 0.8 * v) * iStr;
            vec2 xz = iPos.xz + d * s + perp * position.x * w;
            vW = vec3(xz.x, iPos.y, xz.y);
            vUv = vec2(position.x + 0.5, v);
            vCol = iCol * iGain;
            vWater = step(iPos.y, -1.0);
            float dc = length(cameraPosition.xz - xz);
            vFade = exp(-dc * (0.012 - vWater * 0.008)) * smoothstep(0.5, 3.0, D);
            gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float uStreak; uniform float uTime; uniform float uWet; uniform float uEmit;
          varying vec2 vUv; varying vec3 vCol; varying vec3 vW; varying float vFade; varying float vWater;
          ${NOISE}
          void main() {
            float across = abs(vUv.x - 0.5) * 2.0;
            float prof = exp(-across * across * 5.0);
            float env = smoothstep(0.0, 0.8, vUv.y) * (1.0 - smoothstep(0.82, 1.0, vUv.y));
            float shimmer = nf_noise(vec2(vW.x * 3.0, vW.z * 0.7 + uTime * 2.4)) * nf_noise(vW.xz * 1.6 - vec2(uTime * 0.6, 0.0));
            float puddle = smoothstep(0.5, 0.62, nf_fbm(vW.xz * 0.06));
            float wet = mix(0.25 + 0.75 * puddle, 1.0, vWater) * uWet;
            float a = prof * env * (0.25 + 1.6 * shimmer) * wet;
            a *= mix(0.55, 1.1, vWater);
            gl_FragColor = vec4(vCol * a * vFade * uStreak * uEmit, 1.0);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.streaks.frustumCulled = false;
    this.streaks.renderOrder = 3;
    this.group.add(this.streaks);

    this.haloLamps = hl;
    this.streakLamps = sl;
  }

  private haloLamps: Lamp[];
  private streakLamps: Lamp[];

  /** Push lamp gains (flicker, blink) to the GPU. */
  sync() {
    this.syncDynamic(this.halos, this.haloLamps, false);
    this.syncDynamic(this.streaks, this.streakLamps, true);
    const hg = this.haloGain.array as Float32Array;
    for (let i = 0; i < this.haloLamps.length; i++) hg[i] = this.haloLamps[i].gain;
    this.haloGain.needsUpdate = true;
    const sg = this.streakGain.array as Float32Array;
    for (let i = 0; i < this.streakLamps.length; i++) sg[i] = this.streakLamps[i].gain;
    this.streakGain.needsUpdate = true;
    if (this.coneGain) {
      const cg = this.coneGain.array as Float32Array;
      for (let i = 0; i < this.coneLamps.length; i++) cg[i] = this.coneLamps[i].gain;
      this.coneGain.needsUpdate = true;
    }
  }

  private dynIdx = new Map<THREE.Mesh, number[]>();
  private syncDynamic(mesh: THREE.Mesh, lamps: Lamp[], ground: boolean) {
    let idx = this.dynIdx.get(mesh);
    if (!idx) this.dynIdx.set(mesh, (idx = lamps.map((l, i) => (l.dynamic ? i : -1)).filter((i) => i >= 0)));
    if (!idx.length) return;
    const attr = mesh.geometry.getAttribute('iPos') as THREE.InstancedBufferAttribute;
    const a = attr.array as Float32Array;
    for (const i of idx) {
      const l = lamps[i];
      a[i * 3] = l.pos.x;
      a[i * 3 + 1] = ground ? l.ground + (l.ground < -1 ? 0.03 : 0.022) : l.pos.y;
      a[i * 3 + 2] = l.pos.z;
    }
    attr.needsUpdate = true;
  }

  setAtmosphere(on: boolean) {
    if (this.cones) this.cones.visible = on;
    this.streaks.visible = on;
  }
}
