import * as THREE from 'three';
import { NOISE } from '../../render/glsl';
import { worldUniforms } from '../../world/materials';
import { terrainUniforms } from './Terrain';
import { CITY_STYLES } from './biomes';
import type { Towns } from './Towns';
import type { Settlement, WorldGen } from './WorldGen';

/**
 * Every town and city within a few kilometres, as it looks from far off: a
 * block of shade per city block at roughly the right height, its landmarks
 * standing up out of it, windows coming on at dusk. One instanced draw. The
 * real buildings take over (these sink away) inside the near ring, the same
 * way the far terrain does. This is what makes you drive towards something.
 */
const MAX = 6000;
const RANGE = 6500;

const LANDMARK_H: Record<string, number> = { tower: 250, twinTowers: 232, cathedral: 82, clockTower: 56, smokestacks: 78, waterTower: 38, cranes: 48, lighthouse: 36, radioMast: 144, dam: 144, coolingTowers: 56, stadium: 24, ferrisWheel: 44, pier: 44, domes: 22, observatory: 22, mall: 14, statue: 8 };

export class FarCities {
  mesh: THREE.InstancedMesh;
  private tint: THREE.InstancedBufferAttribute;
  private done = new Set<string>();
  private queue: Settlement[] = [];
  private entries = new Map<string, { m: THREE.Matrix4; tint: [number, number, number] }[]>();
  private dirty = false;
  private lastScan = new THREE.Vector3(1e9, 0, 0);
  readonly uniforms = {
    uTime: worldUniforms.uTime,
    uLit: worldUniforms.uLitScale,
    uEmit: worldUniforms.uEmit,
    uNear: terrainUniforms.uNear,
    uDay: terrainUniforms.uDay,
    uFogColor: { value: new THREE.Color() },
    uFog: { value: 0.001 },
    uSunCol: { value: new THREE.Color(1, 1, 1) },
  };

  constructor(private gen: WorldGen, private towns: Towns) {
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    geo.setAttribute('iTint', this.tint);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec3 iTint;
        uniform vec4 uNear;
        varying vec3 vW; varying vec3 vN; varying vec3 vTint; flat varying float vSeed; flat varying float vTop; flat varying float vBase;
        void main() {
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vec3 c = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          // the real buildings stand here
          if (c.x > uNear.x && c.x < uNear.z && c.z > uNear.y && c.z < uNear.w) w.y -= 900.0;
          vW = w.xyz;
          vN = normalize(mat3(instanceMatrix) * normal);
          vTint = iTint;
          vSeed = c.x * 0.013 + c.z * 0.007;
          vTop = (instanceMatrix * vec4(0.0, 1.0, 0.0, 1.0)).y;
          vBase = c.y;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uLit; uniform float uEmit; uniform float uDay; uniform vec3 uFogColor; uniform float uFog; uniform vec3 uSunCol;
        varying vec3 vW; varying vec3 vN; varying vec3 vTint; flat varying float vSeed; flat varying float vTop; flat varying float vBase;
        ${NOISE}
        void main() {
          float shade = 0.55 + 0.45 * max(dot(vN, normalize(vec3(0.3, 0.8, 0.5))), 0.0);
          vec3 col = vTint * shade * mix(0.04, 0.9, uDay) * mix(vec3(1.0), uSunCol, 0.3);
          if (abs(vN.y) < 0.5) {
            float u = abs(vN.x) > 0.5 ? vW.z : vW.x;
            float y = vW.y - vBase;
            vec2 cell = floor(vec2(u / 3.0, y / 3.5));
            vec2 f = fract(vec2(u / 3.0, y / 3.5));
            float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.25, f.y) * step(f.y, 0.8) * step(4.0, y) * step(y, vTop - vBase - 2.0);
            float hsh = nf_hash(cell + vSeed * 91.0);
            col = mix(col, col * 0.35 + vec3(0.05, 0.07, 0.09) * uDay, win * 0.6);
            float lit = step(hsh, 0.28 * uLit) * win;
            vec3 wc = mix(vec3(1.0, 0.64, 0.34), vec3(0.85, 0.9, 1.0), step(0.8, nf_hash(cell * 1.3 + vSeed)));
            col += wc * lit * (0.6 + nf_hash(cell * 2.1) * 0.9) * uEmit;
          }
          // aviation lights on the tall ones
          col += vec3(1.0, 0.1, 0.05) * step(vTop - 1.2, vW.y) * step(90.0, vTop - vBase) * step(0.82, fract(uTime * 0.4 + vSeed * 3.0)) * 4.0 * (1.0 - uDay);
          float dist = length(cameraPosition - vW);
          float fg = 1.0 - exp(-pow(uFog * dist, 2.0));
          col = mix(col, uFogColor, fg);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  /** Find the settlements in range; plan one new one per call (plans cost a few ms). */
  update(at: THREE.Vector3, fog: THREE.FogExp2, sunCol: THREE.Color) {
    this.uniforms.uFogColor.value.copy(fog.color);
    this.uniforms.uFog.value = fog.density;
    this.uniforms.uSunCol.value.copy(sunCol);
    if (at.distanceToSquared(this.lastScan) > 400 * 400) {
      this.lastScan.copy(at);
      const want = new Set<string>();
      for (const s of this.gen.settlementsNear(at.x, at.z, 3)) {
        if (s.kind === 'junction' || s.kind === 'ruin') continue;
        if (Math.hypot(s.x - at.x, s.z - at.z) > RANGE + s.radius) continue;
        want.add(s.id);
        if (!this.done.has(s.id) && !this.queue.includes(s)) this.queue.push(s);
      }
      for (const id of [...this.entries.keys()]) if (!want.has(id)) {
        this.entries.delete(id);
        this.done.delete(id);
        this.dirty = true;
      }
      this.queue = this.queue.filter((s) => want.has(s.id));
      this.queue.sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z));
    }
    const s = this.queue.shift();
    if (s) {
      this.done.add(s.id);
      this.entries.set(s.id, this.boxes(s));
      this.dirty = true;
    }
    if (this.dirty) {
      this.dirty = false;
      let i = 0;
      for (const list of this.entries.values()) for (const e of list) {
        if (i >= MAX) break;
        this.mesh.setMatrixAt(i, e.m);
        this.tint.setXYZ(i, e.tint[0], e.tint[1], e.tint[2]);
        i++;
      }
      this.mesh.count = i;
      this.mesh.instanceMatrix.needsUpdate = true;
      this.tint.needsUpdate = true;
    }
  }

  private boxes(s: Settlement) {
    const out: { m: THREE.Matrix4; tint: [number, number, number] }[] = [];
    const plan = this.towns.plan(s);
    const st = CITY_STYLES[s.archetype ?? 'historic'];
    const tint = (): [number, number, number] => {
      const k = st.styles[0][0];
      return k === 'glass' ? [0.12, 0.14, 0.17] : k === 'stucco' ? [0.55, 0.52, 0.46] : k === 'adobe' ? [0.5, 0.36, 0.24] : k === 'brick' ? [0.28, 0.17, 0.13] : k === 'timber' ? [0.22, 0.15, 0.1] : k === 'siding' ? [0.45, 0.46, 0.44] : [0.3, 0.3, 0.29];
    };
    for (const b of plan.blocks) {
      if (b.use === 'park' || b.use === 'parking' || b.use === 'plaza') continue;
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      let h: number;
      if (b.use === 'landmark') h = LANDMARK_H[b.landmark ?? 'statue'] ?? 30;
      else if (b.use === 'houses') h = 5;
      else {
        const k = this.gen.spot(cx, cz, 23);
        h = (st.edge[0] + (st.core[1] - st.edge[0]) * b.core * b.core) * (0.55 + 0.6 * k);
      }
      const w = b.use === 'landmark' ? Math.min(b.x1 - b.x0, 30) : (b.x1 - b.x0) * 0.9;
      const d = b.use === 'landmark' ? Math.min(b.z1 - b.z0, 30) : (b.z1 - b.z0) * 0.9;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, b.y, cz), new THREE.Quaternion(), new THREE.Vector3(w, h, d));
      out.push({ m, tint: tint() });
    }
    return out;
  }

  clear() {
    this.entries.clear();
    this.done.clear();
    this.queue = [];
    this.mesh.count = 0;
    this.lastScan.set(1e9, 0, 0);
  }
}
