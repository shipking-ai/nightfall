import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { worldUniforms } from '../../world/materials';
import type { Species } from './biomes';
import { RealTrees, type RealKind } from './RealTrees';

/**
 * Trees, bushes and rocks. Each species is one small mesh built from a few
 * primitives with its colours baked into the vertices, drawn as a single
 * instanced batch for the whole loaded world. Chunks hand their instances in
 * when they load and take them back when they go; the batch is rewritten then.
 * The canopy moves in the wind (more in a storm), the trunk doesn't.
 */

export const floraUniforms = {
  uWind: { value: 0.3 },
  uSnowOn: { value: 0 },
};

const C = (hex: number) => new THREE.Color(hex);

function paint(g: THREE.BufferGeometry, col: THREE.Color, sway: number, jitter = 0.08, seed = 1): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3), s = new Float32Array(n);
  let r = seed;
  for (let i = 0; i < n; i++) {
    r = (r * 16807) % 2147483647;
    const k = 1 + ((r / 2147483647) - 0.5) * jitter * 2;
    c[i * 3] = col.r * k;
    c[i * 3 + 1] = col.g * k;
    c[i * 3 + 2] = col.b * k;
    s[i] = sway;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  geo.setAttribute('aSway', new THREE.BufferAttribute(s, 1));
  for (const a of Object.keys(geo.attributes)) if (!['position', 'normal', 'color', 'aSway'].includes(a)) geo.deleteAttribute(a);
  return geo;
}

const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) =>
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)), new THREE.Vector3(sx, sy, sz)));

function lumpy(geo: THREE.BufferGeometry, amt: number, seed: number) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + Math.sin(x * 3.1 + seed) * Math.cos(z * 2.7 + y * 1.3 + seed) * amt;
    p.setXYZ(i, x * k, y * (1 + (k - 1) * 0.6), z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

/** A species' mesh, about 1 m = 1 unit (instances scale it). */
function speciesGeometry(s: Species): THREE.BufferGeometry {
  const bark = C(0x3a2a1e), leaf = C(0x2f4a1c), dark = C(0x1f3318);
  const parts: THREE.BufferGeometry[] = [];
  switch (s) {
    case 'oak': {
      parts.push(paint(at(new THREE.CylinderGeometry(0.22, 0.34, 4, 7), 0, 2, 0), bark, 0));
      for (const [x, y, z, r] of [[0, 5.6, 0, 2.6], [1.5, 4.9, 0.6, 1.8], [-1.3, 5.1, -0.7, 1.9], [0.3, 6.6, -0.8, 1.6], [-0.6, 4.6, 1.3, 1.5]])
        parts.push(paint(lumpy(at(new THREE.IcosahedronGeometry(1, 1), x, y, z, r, r * 0.8, r), 0.12, x), leaf, 1, 0.12, x * 100 + 7));
      break;
    }
    case 'birch': {
      parts.push(paint(at(new THREE.CylinderGeometry(0.1, 0.16, 7, 6), 0, 3.5, 0), C(0xb8b4a8), 0, 0.2));
      for (const [x, y, z, r] of [[0, 6.8, 0, 1.4], [0.6, 5.6, 0.3, 1.1], [-0.5, 6, -0.4, 1.1]])
        parts.push(paint(lumpy(at(new THREE.IcosahedronGeometry(1, 1), x, y, z, r, r * 1.3, r), 0.15, y), C(0x4c6a26), 1, 0.12, y * 50));
      break;
    }
    case 'pine': {
      parts.push(paint(at(new THREE.CylinderGeometry(0.16, 0.28, 9, 6), 0, 4.5, 0), bark, 0));
      for (const [y, r] of [[6.8, 1.8], [8.3, 1.4], [9.6, 1]]) parts.push(paint(at(new THREE.ConeGeometry(1, 2.6, 7), 0, y, 0, r, 1, r), dark, 0.7, 0.1, y * 30));
      break;
    }
    case 'spruce': {
      parts.push(paint(at(new THREE.CylinderGeometry(0.12, 0.24, 2, 6), 0, 1, 0), bark, 0));
      for (const [y, r, h] of [[2.6, 2.3, 3.4], [4.6, 1.8, 3], [6.4, 1.3, 2.6], [8, 0.8, 2.2]]) parts.push(paint(at(new THREE.ConeGeometry(1, h, 8), 0, y, 0, r, 1, r), C(0x1a2c1a), 0.6, 0.1, y * 17));
      break;
    }
    case 'cypress': {
      parts.push(paint(at(new THREE.CylinderGeometry(0.3, 0.7, 2.4, 7), 0, 1.2, 0), C(0x4a3a2c), 0));
      parts.push(paint(lumpy(at(new THREE.IcosahedronGeometry(1, 1), 0, 6.5, 0, 1.6, 4.6, 1.6), 0.2, 3), C(0x3a4a26), 0.8, 0.14, 5));
      parts.push(paint(at(new THREE.CylinderGeometry(0.08, 0.12, 5, 5), 0.8, 5, 0, 1, 1, 1, 0, 0.3), C(0x6a7a5a), 1, 0.2, 9));
      break;
    }
    case 'palm': {
      // a trunk that leans and curves, fronds at the top
      for (let i = 0; i < 5; i++) parts.push(paint(at(new THREE.CylinderGeometry(0.19 - i * 0.015, 0.22 - i * 0.015, 1.9, 6), i * i * 0.05, 0.95 + i * 1.85, 0, 1, 1, 1, 0, -0.03 - i * 0.03), C(0x6a5540), i * 0.12));
      const top = new THREE.Vector3(0.8, 9.3, 0);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const f = new THREE.BoxGeometry(3.4, 0.05, 0.55).translate(1.7, 0, 0);
        f.applyMatrix4(new THREE.Matrix4().makeRotationZ(-0.45));
        f.applyMatrix4(new THREE.Matrix4().makeRotationY(a));
        f.translate(top.x, top.y, top.z);
        parts.push(paint(f, C(0x3d5a22), 1.2, 0.15, k + 3));
      }
      break;
    }
    case 'cactus': {
      parts.push(paint(at(new THREE.CylinderGeometry(0.32, 0.36, 4.2, 8), 0, 2.1, 0), C(0x3e5a32), 0.05, 0.1));
      parts.push(paint(at(new THREE.CylinderGeometry(0.2, 0.22, 1.6, 7), 0.62, 2.2, 0, 1, 1, 1, 0, -1.4), C(0x3e5a32), 0.05));
      parts.push(paint(at(new THREE.CylinderGeometry(0.2, 0.22, 1.5, 7), 1.05, 3, 0), C(0x3e5a32), 0.05));
      parts.push(paint(at(new THREE.CylinderGeometry(0.18, 0.2, 1.3, 7), -0.9, 2.9, 0), C(0x42603a), 0.05));
      parts.push(paint(at(new THREE.CylinderGeometry(0.18, 0.2, 0.9, 7), -0.5, 2.2, 0, 1, 1, 1, 0, 1.4), C(0x42603a), 0.05));
      break;
    }
    case 'deadTree': {
      parts.push(paint(at(new THREE.CylinderGeometry(0.12, 0.3, 5, 6), 0, 2.5, 0), C(0x4a423a), 0));
      for (const [y, rz, ry, l] of [[3, 0.8, 0, 2.2], [3.8, -0.9, 1.2, 1.8], [4.4, 0.7, 2.6, 1.5], [2.4, -0.7, 4, 1.6]]) {
        const b = new THREE.CylinderGeometry(0.04, 0.1, l, 5).translate(0, l / 2, 0);
        b.applyMatrix4(new THREE.Matrix4().makeRotationZ(rz));
        b.applyMatrix4(new THREE.Matrix4().makeRotationY(ry));
        b.translate(0, y, 0);
        parts.push(paint(b, C(0x4a423a), 0.3));
      }
      break;
    }
    case 'bush':
      for (const [x, z, r] of [[0, 0, 1], [0.7, 0.3, 0.7], [-0.6, -0.2, 0.75]]) parts.push(paint(lumpy(at(new THREE.IcosahedronGeometry(1, 1), x, r * 0.6, z, r, r * 0.8, r), 0.2, x), C(0x2c3e1c), 0.5, 0.15, x * 90 + 3));
      break;
    case 'fern':
      for (let k = 0; k < 6; k++) {
        const f = new THREE.BoxGeometry(0.9, 0.03, 0.22).translate(0.45, 0, 0);
        f.applyMatrix4(new THREE.Matrix4().makeRotationZ(0.5));
        f.applyMatrix4(new THREE.Matrix4().makeRotationY((k / 6) * Math.PI * 2));
        parts.push(paint(f, C(0x2e4a1c), 0.8, 0.15, k));
      }
      break;
    case 'reed':
      for (let k = 0; k < 9; k++) {
        const a = k * 2.4, r = 0.3 + (k % 3) * 0.15;
        parts.push(paint(at(new THREE.CylinderGeometry(0.015, 0.03, 1.8 + (k % 4) * 0.3, 3), Math.cos(a) * r, 0.9, Math.sin(a) * r, 1, 1, 1, (k % 2) * 0.1, 0.12), C(0x5a6a38), 0.9, 0.2, k));
      }
      break;
    case 'rock':
      parts.push(paint(lumpy(at(new THREE.DodecahedronGeometry(0.8, 0), 0, 0.3, 0, 1, 0.65, 1.2), 0.25, 2), C(0x55524c), 0, 0.2, 3));
      break;
    case 'boulder':
      parts.push(paint(lumpy(at(new THREE.DodecahedronGeometry(1.6, 1), 0, 0.7, 0, 1.2, 0.8, 1), 0.2, 5), C(0x5a5650), 0, 0.15, 5));
      break;
    case 'stump':
      parts.push(paint(at(new THREE.CylinderGeometry(0.34, 0.4, 0.5, 8), 0, 0.25, 0), bark, 0));
      break;
  }
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}

/**
 * A few dozen triangles standing in for a species past the near distance:
 * the same silhouette and colours, none of the detail.
 */
function speciesLow(s: Species): THREE.BufferGeometry | null {
  const bark = C(0x3a2a1e);
  const parts: THREE.BufferGeometry[] = [];
  const blob = (x: number, y: number, z: number, sx: number, sy: number, sz: number, col: THREE.Color) => parts.push(paint(at(new THREE.IcosahedronGeometry(1, 0), x, y, z, sx, sy, sz), col, 1, 0.1, 3));
  switch (s) {
    case 'oak':
      parts.push(paint(at(new THREE.CylinderGeometry(0.22, 0.34, 4, 4), 0, 2, 0), bark, 0));
      blob(0, 5.5, 0, 3.1, 2.4, 3.1, C(0x2f4a1c));
      break;
    case 'birch':
      parts.push(paint(at(new THREE.CylinderGeometry(0.1, 0.16, 7, 4), 0, 3.5, 0), C(0xb8b4a8), 0));
      blob(0, 6.3, 0, 1.6, 2, 1.6, C(0x4c6a26));
      break;
    case 'pine':
      parts.push(paint(at(new THREE.CylinderGeometry(0.16, 0.28, 7, 4), 0, 3.5, 0), bark, 0));
      parts.push(paint(at(new THREE.ConeGeometry(1, 5.2, 5), 0, 8, 0, 1.8, 1, 1.8), C(0x1f3318), 0.7));
      break;
    case 'spruce':
      parts.push(paint(at(new THREE.ConeGeometry(1, 8.6, 6), 0, 4.9, 0, 2.3, 1, 2.3), C(0x1a2c1a), 0.6));
      break;
    case 'cypress':
      parts.push(paint(at(new THREE.CylinderGeometry(0.3, 0.7, 2.4, 4), 0, 1.2, 0), C(0x4a3a2c), 0));
      blob(0, 6.5, 0, 1.6, 4.6, 1.6, C(0x3a4a26));
      break;
    case 'palm': {
      parts.push(paint(at(new THREE.CylinderGeometry(0.15, 0.22, 9.3, 4), 0.4, 4.65, 0, 1, 1, 1, 0, -0.08), C(0x6a5540), 0));
      for (let k = 0; k < 4; k++) {
        const f = new THREE.BoxGeometry(6.4, 0.05, 0.6);
        f.applyMatrix4(new THREE.Matrix4().makeRotationY((k / 4) * Math.PI));
        f.translate(0.8, 9.1, 0);
        parts.push(paint(f, C(0x3d5a22), 1.2));
      }
      break;
    }
    case 'cactus':
      parts.push(paint(at(new THREE.CylinderGeometry(0.34, 0.36, 4.2, 5), 0, 2.1, 0), C(0x3e5a32), 0));
      parts.push(paint(at(new THREE.BoxGeometry(2.2, 0.3, 0.3), 0, 2.3, 0), C(0x3e5a32), 0));
      break;
    case 'deadTree':
      parts.push(paint(at(new THREE.CylinderGeometry(0.12, 0.3, 5, 4), 0, 2.5, 0), C(0x4a423a), 0));
      parts.push(paint(at(new THREE.BoxGeometry(2.4, 0.08, 0.08), 0, 3.6, 0, 1, 1, 1, 0, 0.5), C(0x4a423a), 0));
      break;
    case 'bush':
      blob(0, 0.6, 0, 1.3, 0.9, 1.3, C(0x2c3e1c));
      break;
    case 'rock':
      parts.push(paint(at(new THREE.OctahedronGeometry(0.8, 0), 0, 0.3, 0, 1, 0.65, 1.2), C(0x55524c), 0));
      break;
    case 'boulder':
      parts.push(paint(at(new THREE.OctahedronGeometry(1.6, 0), 0, 0.7, 0, 1.2, 0.8, 1), C(0x5a5650), 0));
      break;
    default:
      return null;
  }
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}

/** Past this, the stand-ins. */
const LOD_NEAR = 130;
/** Inside this, the real trees (EZ-Tree). */
const REAL_NEAR = 75;
const REAL: Partial<Record<Species, RealKind>> = { oak: 'oak', birch: 'birch', pine: 'pine', spruce: 'spruce', bush: 'bush', rock: 'rock', boulder: 'boulder' };

/** How big each species can be, how solid its trunk, and how far it's drawn. */
const SPEC: Record<Species, { trunk: number; far: number; shadow: boolean }> = {
  oak: { trunk: 0.35, far: 620, shadow: true },
  birch: { trunk: 0.16, far: 560, shadow: true },
  pine: { trunk: 0.28, far: 640, shadow: true },
  spruce: { trunk: 0.26, far: 640, shadow: true },
  cypress: { trunk: 0.6, far: 560, shadow: true },
  palm: { trunk: 0.22, far: 560, shadow: true },
  cactus: { trunk: 0.35, far: 360, shadow: false },
  deadTree: { trunk: 0.28, far: 420, shadow: false },
  bush: { trunk: 0, far: 220, shadow: false },
  fern: { trunk: 0, far: 110, shadow: false },
  reed: { trunk: 0, far: 140, shadow: false },
  rock: { trunk: 0.7, far: 260, shadow: false },
  boulder: { trunk: 1.8, far: 420, shadow: true },
  stump: { trunk: 0.4, far: 160, shadow: false },
};
export const trunkOf = (s: Species) => SPEC[s].trunk;

/** One placed plant: where, which way, how big. */
export interface Plant {
  s: Species;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

class Pool {
  mesh: THREE.InstancedMesh;
  cap: number;
  constructor(public species: Species, geo: THREE.BufferGeometry, mat: THREE.Material, cap: number) {
    this.cap = cap;
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = SPEC[species].shadow;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
}

export class Flora {
  group = new THREE.Group();
  private pools = new Map<Species, Pool>();
  private lows = new Map<Species, Pool>();
  private owners = new Map<string, Plant[]>();
  private dirty = false;
  private mat: THREE.MeshStandardMaterial;
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpS = new THREE.Vector3();
  private lastRebuild = new THREE.Vector3(1e9, 0, 0);
  /** grown on first use (the RPG), not for District 03 */
  real = new RealTrees();
  private heights: Record<RealKind, number> = { oak: 10, birch: 10, pine: 12, spruce: 12, bush: 1.5, rock: 0.8, boulder: 1.8 };

  constructor() {
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    this.mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, floraUniforms, { uTime: worldUniforms.uTime });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\nattribute float aSway;\nuniform float uTime;\nuniform float uWind;\nvarying float vUp;`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vUp = normal.y;
#ifdef USE_INSTANCING
{
  vec3 ip = instanceMatrix[3].xyz;
  float ph = ip.x * 0.37 + ip.z * 0.21;
  float gust = 0.6 + 0.4 * sin(uTime * 0.7 + ph * 0.3);
  float k = aSway * max(transformed.y, 0.0) * 0.012 * uWind * gust;
  transformed.x += sin(uTime * 1.9 + ph) * k * 3.0;
  transformed.z += cos(uTime * 1.6 + ph * 1.3) * k * 2.0;
}
#endif`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform float uSnowOn;\nvarying float vUp;`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75, 0.77, 0.8), uSnowOn * smoothstep(0.35, 0.8, vUp));`);
    };
    this.mat.customProgramCacheKey = () => 'nf-flora';
    const caps: Partial<Record<Species, number>> = { bush: 5000, fern: 4000, reed: 4000, rock: 3000, oak: 5000, spruce: 6000, pine: 5000, cypress: 3000, birch: 3000 };
    for (const s of Object.keys(SPEC) as Species[]) {
      const geo = speciesGeometry(s);
      const rk = REAL[s];
      if (rk) {
        geo.computeBoundingBox();
        this.heights[rk] = geo.boundingBox!.max.y;
      }
      const p = new Pool(s, geo, this.mat, Math.min(3500, caps[s] ?? 2500));
      this.pools.set(s, p);
      this.group.add(p.mesh);
      const low = speciesLow(s);
      if (low) {
        const lp = new Pool(s, low, this.mat, 14000);
        lp.mesh.castShadow = false;
        this.lows.set(s, lp);
        this.group.add(lp.mesh);
      }
    }
  }

  add(owner: string, plants: Plant[]) {
    if (!this.real.ready) {
      void this.real.load(this.heights).then(() => {
        this.dirty = true;
      });
      if (!this.real.group.parent) this.group.add(this.real.group);
    }
    this.owners.set(owner, plants);
    this.dirty = true;
  }

  remove(owner: string) {
    if (this.owners.delete(owner)) this.dirty = true;
  }

  clear() {
    this.owners.clear();
    this.dirty = true;
  }

  /** Rewrite the batches when chunks came or went, or when you've moved far enough that the draw distances cut differently. */
  update(center: THREE.Vector3) {
    if (!this.dirty && center.distanceToSquared(this.lastRebuild) < 30 * 30) return;
    this.dirty = false;
    this.lastRebuild.copy(center);
    const counts = new Map<Pool, number>();
    for (const p of this.pools.values()) counts.set(p, 0);
    for (const p of this.lows.values()) counts.set(p, 0);
    const near2 = LOD_NEAR * LOD_NEAR;
    const real2 = REAL_NEAR * REAL_NEAR;
    const realCounts = new Map<THREE.InstancedMesh, number>();
    if (this.real.ready) for (const list of this.real.models.values()) for (const m of list) realCounts.set(m.bark, 0);
    for (const list of this.owners.values()) {
      for (const pl of list) {
        const far = SPEC[pl.s].far;
        const dx = pl.x - center.x, dz = pl.z - center.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > far * far) continue;
        const rk = REAL[pl.s];
        const vs = rk && d2 < real2 && this.real.ready ? this.real.models.get(rk) : undefined;
        if (vs) {
          const m = vs[Math.abs(Math.floor(pl.x * 13.1 + pl.z * 7.7)) % vs.length];
          const i = realCounts.get(m.bark)!;
          if (i < m.bark.instanceMatrix.count) {
            this.tmpQ.setFromAxisAngle(UP, pl.yaw);
            this.tmpM.compose(this.tmpV.set(pl.x, pl.y - 0.05, pl.z), this.tmpQ, this.tmpS.setScalar(pl.scale * m.fit));
            m.bark.setMatrixAt(i, this.tmpM);
            m.leaf?.setMatrixAt(i, this.tmpM);
            realCounts.set(m.bark, i + 1);
            continue;
          }
        }
        const pool = d2 > near2 ? this.lows.get(pl.s) ?? this.pools.get(pl.s)! : this.pools.get(pl.s)!;
        const i = counts.get(pool)!;
        if (i >= pool.cap) continue;
        this.tmpQ.setFromAxisAngle(UP, pl.yaw);
        this.tmpM.compose(this.tmpV.set(pl.x, pl.y, pl.z), this.tmpQ, this.tmpS.setScalar(pl.scale));
        pool.mesh.setMatrixAt(i, this.tmpM);
        counts.set(pool, i + 1);
      }
    }
    for (const [p, n] of counts) {
      p.mesh.count = n;
      p.mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.real.ready) for (const list of this.real.models.values()) for (const m of list) {
      const n = realCounts.get(m.bark) ?? 0;
      m.bark.count = n;
      m.bark.instanceMatrix.needsUpdate = true;
      if (m.leaf) {
        m.leaf.count = n;
        m.leaf.instanceMatrix.needsUpdate = true;
      }
    }
  }

  get total() {
    let n = 0;
    for (const p of this.pools.values()) n += p.mesh.count;
    for (const p of this.lows.values()) n += p.mesh.count;
    return n;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
