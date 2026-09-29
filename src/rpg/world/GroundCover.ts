import * as THREE from 'three';
import { worldUniforms } from '../../world/materials';
import { BIOMES } from './biomes';
import { floraUniforms } from './Flora';
import { gltfLoader } from './gltf';
import { BIOME_LIST } from './Terrain';
import type { Streamer } from './Streamer';

/**
 * What grows underfoot: a carpet of grass blades round you, thick in the
 * meadows and the woods, thin and dry in the scrub, none on the roads, in
 * town, on sand or under snow, all leaning with the wind; wildflowers in
 * the green country. The blades are laid on a grid fixed to the ground (so
 * they don't swim as you walk) and re-laid as you move.
 *
 * Models: the EZ-Tree demo's grass and flowers (Daniel Greenheck, MIT).
 */

const RADIUS = 28;
const CELL = 0.3;
const MAX = 46000;
const FLOWERS = 700;

export class GroundCover {
  group = new THREE.Group();
  private grass: THREE.InstancedMesh | null = null;
  private flowers: THREE.InstancedMesh[] = [];
  private last = new THREE.Vector3(1e9, 0, 0);
  private loading = false;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(private streamer: Streamer) {}

  private async load() {
    this.loading = true;
    const l = gltfLoader();
    const base = `${import.meta.env.BASE_URL ?? '/'}rpg/models/`;
    const blade = (await l.loadAsync(`${base}grass.glb`)).scene.getObjectByProperty('isMesh', true) as THREE.Mesh;
    const g = blade.geometry.clone();
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    // stand the blade on the ground, half a metre tall
    g.translate(0, -bb.min.y, 0);
    g.scale(0.5 / (bb.max.y - bb.min.y), 0.5 / (bb.max.y - bb.min.y), 0.5 / (bb.max.y - bb.min.y));
    // lit like the ground it grows from, not like a wall of little cards
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    const src = blade.material as THREE.MeshStandardMaterial;
    const mat = new THREE.MeshStandardMaterial({ map: src.map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
    sway(mat, 0.5);
    this.grass = new THREE.InstancedMesh(g, mat, MAX);
    this.grass.count = 0;
    this.grass.frustumCulled = false;
    this.grass.receiveShadow = true;
    this.grass.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.group.add(this.grass);
    for (const f of ['flower_white', 'flower_blue', 'flower_yellow']) {
      const scene = (await l.loadAsync(`${base}${f}.glb`)).scene;
      scene.updateMatrixWorld(true);
      // one mesh per material part; each becomes its own instanced batch, sharing the placements
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
        geo.computeBoundingBox();
        const h = geo.boundingBox!.max.y - geo.boundingBox!.min.y;
        geo.translate(0, -geo.boundingBox!.min.y, 0);
        geo.scale(0.35 / h, 0.35 / h, 0.35 / h);
        const m0 = mesh.material as THREE.MeshStandardMaterial;
        const mat = new THREE.MeshStandardMaterial({ color: m0.color, map: m0.map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
        sway(mat, 0.35);
        const im = new THREE.InstancedMesh(geo, mat, FLOWERS);
        im.count = 0;
        im.frustumCulled = false;
        im.userData.kind = f;
        this.flowers.push(im);
        this.group.add(im);
      });
    }
    this.last.set(1e9, 0, 0);
  }

  update(p: THREE.Vector3, snow: number) {
    if (!this.grass) {
      if (!this.loading) void this.load();
      return;
    }
    if (p.distanceToSquared(this.last) < 5 * 5) return;
    this.last.copy(p);
    this.lay(p, snow);
  }

  /** Lay the blades on the fixed grid round you. */
  private lay(p: THREE.Vector3, snow: number) {
    const gm = this.grass!;
    let n = 0;
    const fc = new Map<THREE.InstancedMesh, number>();
    for (const f of this.flowers) fc.set(f, 0);
    const i0 = Math.floor((p.x - RADIUS) / CELL), i1 = Math.ceil((p.x + RADIUS) / CELL);
    const j0 = Math.floor((p.z - RADIUS) / CELL), j1 = Math.ceil((p.z + RADIUS) / CELL);
    const r2 = RADIUS * RADIUS;
    for (let j = j0; j <= j1 && n < MAX; j++) for (let i = i0; i <= i1 && n < MAX; i++) {
      // a fixed jitter per cell
      const h1 = hash(i, j), h2 = hash(j + 71, i - 13), h3 = hash(i * 3 + 7, j * 5 - 1);
      const x = (i + h1) * CELL, z = (j + h2) * CELL;
      const dx = x - p.x, dz = z - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const c = this.streamer.chunkAt(x, z);
      if (!c) continue;
      const f = c.field;
      const vi = Math.round((x - f.x0) / f.step), vj = Math.round((z - f.z0) / f.step);
      if (vi < 0 || vj < 0 || vi >= f.n || vj >= f.n) continue;
      const k = vj * f.n + vi;
      if (!Number.isNaN(f.water[k]) || f.road[k] > 0.05 || f.urban[k] > 0.15) continue;
      const bi = BIOME_LIST[f.biome[k]];
      const density = bi === 'temperate' || bi === 'forest' ? 1 : bi === 'boreal' || bi === 'swamp' ? 0.75 : bi === 'coast' || bi === 'alpine' ? 0.35 : bi === 'scrub' ? 0.3 : 0;
      // thinner towards the edge of the carpet, and in patches
      const patch = 0.55 + 0.45 * Math.sin(x * 0.11 + Math.sin(z * 0.07) * 3) * Math.cos(z * 0.09 + x * 0.03);
      if (h3 > density * patch * (1 - snow) * (1 - Math.max(0, (Math.sqrt(d2) - RADIUS * 0.7) / (RADIUS * 0.3)))) continue;
      const y = this.streamer.heightAt(x, z);
      // steep: bare
      const sx = this.streamer.heightAt(x + 0.6, z) - y, sz = this.streamer.heightAt(x, z + 0.6) - y;
      if (Math.abs(sx) + Math.abs(sz) > 0.55) continue;
      const scale = 0.7 + h1 * 0.7 + (bi === 'forest' ? 0.3 : 0);
      this.q.setFromAxisAngle(UP, h2 * 6.283);
      this.m.compose(this.p.set(x, y - 0.02, z), this.q, this.s.set(scale * (0.8 + h3 * 0.4), scale, scale * (0.8 + h3 * 0.4)));
      gm.setMatrixAt(n, this.m);
      // tint by the land: lush green, or dry and straw-coloured in the scrub
      const b = BIOMES[bi].grass;
      this.c.setRGB(b[0], b[1], b[2]).multiplyScalar(1.7 + h2 * 0.7);
      gm.setColorAt(n, this.c);
      n++;
      // the odd wildflower in the green
      if ((bi === 'temperate' || bi === 'forest') && hash(i * 7, j * 11) > 0.992 && snow < 0.2) {
        const kind = Math.floor(hash(i, j * 3) * 3);
        for (const fm of this.flowers) {
          if (fm.userData.kind !== ['flower_white', 'flower_blue', 'flower_yellow'][kind]) continue;
          const fi = fc.get(fm)!;
          if (fi >= FLOWERS) continue;
          this.m.compose(this.p.set(x + 0.1, y - 0.02, z), this.q, this.s.setScalar(0.8 + h1 * 0.5));
          fm.setMatrixAt(fi, this.m);
          fc.set(fm, fi + 1);
        }
      }
    }
    gm.count = n;
    gm.instanceMatrix.needsUpdate = true;
    if (gm.instanceColor) gm.instanceColor.needsUpdate = true;
    for (const [fm, k] of fc) {
      fm.count = k;
      fm.instanceMatrix.needsUpdate = true;
    }
  }

  clear() {
    if (this.grass) this.grass.count = 0;
    for (const f of this.flowers) f.count = 0;
    this.last.set(1e9, 0, 0);
  }
}

/** Blades and petals move with the wind (more at the tips). */
function sway(m: THREE.MeshStandardMaterial, h: number) {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, floraUniforms, { uTime: worldUniforms.uTime });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nuniform float uWind;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  vec3 ip = instanceMatrix[3].xyz;
  float t = clamp(position.y / ${h.toFixed(2)}, 0.0, 1.0);
  float gust = 0.5 + 0.5 * sin(uTime * 0.8 + ip.x * 0.05 + ip.z * 0.04);
  float k = t * t * (0.05 + 0.1 * uWind * gust);
  transformed.x += sin(uTime * 2.2 + ip.x * 0.7 + ip.z * 0.3) * k;
  transformed.z += cos(uTime * 1.8 + ip.z * 0.6) * k * 0.7;
}
#endif`,
      );
    // both faces of a blade take the light from above, as the up-pointing normals mean them to
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal);');
  };
  m.customProgramCacheKey = () => `nf-cover-${h}`;
}

function hash(a: number, b: number) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const UP = new THREE.Vector3(0, 1, 0);
