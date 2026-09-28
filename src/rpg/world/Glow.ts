import * as THREE from 'three';
import type { Lamp } from '../../world/WorldContext';
import { worldUniforms } from '../../world/materials';

/**
 * Halos for every lamp the streamer has loaded: one instanced draw, rebuilt
 * when lamps come or go. (District 03's own lamps keep their LightFX.)
 * Brighter the darker it is; nearly gone at noon.
 */
export class Glow {
  mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private lamps: Lamp[] = [];
  private dirty = false;
  private cap = 0;
  readonly uniforms = { uNight: { value: 1 }, uEmit: worldUniforms.uEmit };

  constructor() {
    this.geo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1) as unknown as THREE.InstancedBufferGeometry);
    this.alloc(512);
    this.mesh = new THREE.Mesh(
      this.geo,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute vec3 iPos; attribute vec3 iCol; attribute float iSize; attribute float iGain;
          varying vec2 vUv; varying vec3 vCol; varying float vFade;
          void main() {
            vUv = uv;
            vCol = iCol * iGain;
            vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
            float d = -mv.z;
            float s = iSize * (1.0 + d * 0.01);
            mv.xyz += normalize(-mv.xyz) * min(iSize * 0.6, d * 0.5);
            mv.xy += position.xy * s * 2.0;
            vFade = smoothstep(0.5, 3.0, d) * (0.3 + 0.7 * exp(-d * 0.004));
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uNight; uniform float uEmit;
          varying vec2 vUv; varying vec3 vCol; varying float vFade;
          void main() {
            vec2 q = vUv - 0.5;
            float r = length(q) * 2.0;
            float a = exp(-r * r * 5.0) * 0.55 + exp(-r * 14.0) * 0.8;
            a *= vFade * uNight * uEmit;
            if (a < 0.003) discard;
            gl_FragColor = vec4(vCol * a, 1.0);
          }`,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  private alloc(n: number) {
    this.cap = n;
    this.geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('iCol', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('iGain', new THREE.InstancedBufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.instanceCount = 0;
  }

  set(lamps: Lamp[]) {
    this.lamps = lamps.filter((l) => l.halo > 0);
    this.dirty = true;
  }

  update() {
    const L = this.lamps;
    if (this.dirty) {
      this.dirty = false;
      if (L.length > this.cap) this.alloc(Math.ceil(L.length * 1.5));
      const p = this.geo.attributes.iPos as THREE.InstancedBufferAttribute, c = this.geo.attributes.iCol as THREE.InstancedBufferAttribute, s = this.geo.attributes.iSize as THREE.InstancedBufferAttribute;
      L.forEach((l, i) => {
        p.setXYZ(i, l.pos.x, l.pos.y, l.pos.z);
        c.setXYZ(i, l.color.r, l.color.g, l.color.b);
        s.setX(i, l.halo);
      });
      p.needsUpdate = c.needsUpdate = s.needsUpdate = true;
      this.geo.instanceCount = L.length;
    }
    const g = this.geo.attributes.iGain as THREE.InstancedBufferAttribute;
    for (let i = 0; i < L.length; i++) g.setX(i, L[i].gain);
    g.needsUpdate = true;
  }
}
