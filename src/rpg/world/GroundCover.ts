import * as THREE from 'three';
import { worldUniforms } from '../../world/materials';
import { BIOMES } from './biomes';
import { floraUniforms } from './Flora';
import { gltfLoader } from './gltf';
import { warm } from './warm';
import { BIOME_LIST } from './Terrain';
import type { Streamer } from './Streamer';
import { fieldHeight } from './Terrain';

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
/** the carpet is kept in tiles this size */
const TILE = 8;
const CELL = 0.3;
const MAX = 46000;
const FLOWERS = 700;

export class GroundCover {
  group = new THREE.Group();
  private grass: THREE.InstancedMesh | null = null;
  private flowers: THREE.InstancedMesh[] = [];
  private loading = false;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(private streamer: Streamer) {}

  private loadP: Promise<void> | null = null;
  /** Load and compile the grass and flowers now (the loading screen waits for it). */
  prepare() {
    if (!this.loadP) {
      this.loading = true;
      this.loadP = this.load().catch((e) => console.warn('ground cover', e));
    }
    return this.loadP;
  }

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
    const fresh: THREE.Object3D[] = [this.grass];
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
        fresh.push(im);
      });
    }
    // compile their shaders off the frame first, then show them
    const hold = new THREE.Group();
    hold.add(...fresh);
    for (const o of fresh) (o as THREE.InstancedMesh).count = 1;
    await warm(hold);
    for (const o of fresh) (o as THREE.InstancedMesh).count = 0;
    this.group.add(...fresh);
    this.dirty = true;
  }

  /**
   * Called every frame. The carpet is built from 8 m tiles, each worked out
   * once from the loaded chunk's data and kept; a few new tiles a frame (within
   * a couple of milliseconds), and the carpet is put back together from the
   * cached tiles when the set round you changes. Nothing here costs more as
   * you go faster, so it never holds a frame up.
   */
  update(p: THREE.Vector3, snow: number) {
    if (!this.grass) {
      if (!this.loading) void this.prepare();
      return;
    }
    // (deep snow changes what grows: start again, rarely)
    if (Math.abs(snow - this.snowAt) > 0.15) {
      this.snowAt = snow;
      this.tiles.clear();
      this.dirty = true;
    }
    const ti0 = Math.floor((p.x - RADIUS) / TILE), ti1 = Math.floor((p.x + RADIUS) / TILE);
    const tj0 = Math.floor((p.z - RADIUS) / TILE), tj1 = Math.floor((p.z + RADIUS) / TILE);
    const key = `${ti0},${tj0}`;
    if (key !== this.around) {
      this.around = key;
      this.dirty = true;
    }
    // work out missing tiles, nearest first, within the budget
    const t0 = performance.now();
    const want: [number, number, number][] = [];
    for (let tj = tj0; tj <= tj1; tj++) for (let ti = ti0; ti <= ti1; ti++) {
      if (this.tiles.has(`${ti},${tj}`)) continue;
      const cx = (ti + 0.5) * TILE - p.x, cz = (tj + 0.5) * TILE - p.z;
      const d = Math.hypot(cx, cz);
      if (d < RADIUS + TILE) want.push([ti, tj, d]);
    }
    want.sort((a, b) => a[2] - b[2]);
    for (const [ti, tj] of want) {
      if (performance.now() - t0 > 2) break;
      const t = this.tile(ti, tj, this.snowAt);
      if (!t) continue;
      this.tiles.set(`${ti},${tj}`, t);
      this.dirty = true;
    }
    if (this.tiles.size > 900) {
      // forget the tiles furthest away
      for (const k of [...this.tiles.keys()]) {
        const [i, j] = k.split(',').map(Number);
        if (Math.abs((i + 0.5) * TILE - p.x) > RADIUS * 3 || Math.abs((j + 0.5) * TILE - p.z) > RADIUS * 3) this.tiles.delete(k);
      }
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.assemble(ti0, ti1, tj0, tj1, p);
  }

  private tiles = new Map<string, CoverTile>();
  private around = '';
  private dirty = false;
  private snowAt = 0;

  /** Put the carpet together from the cached tiles round you (copies, no maths). */
  private assemble(ti0: number, ti1: number, tj0: number, tj1: number, p: THREE.Vector3) {
    const gm = this.grass!;
    const M = gm.instanceMatrix.array as Float32Array, C = gm.instanceColor!.array as Float32Array;
    let n = 0;
    const fc = new Map<THREE.InstancedMesh, number>();
    for (const f of this.flowers) fc.set(f, 0);
    for (let tj = tj0; tj <= tj1; tj++) for (let ti = ti0; ti <= ti1; ti++) {
      const t = this.tiles.get(`${ti},${tj}`);
      if (!t) continue;
      const cx = (ti + 0.5) * TILE - p.x, cz = (tj + 0.5) * TILE - p.z;
      if (Math.hypot(cx, cz) > RADIUS + TILE * 0.75) continue;
      const k = Math.min(t.n, MAX - n);
      if (k <= 0) break;
      M.set(t.m.subarray(0, k * 16), n * 16);
      C.set(t.c.subarray(0, k * 3), n * 3);
      n += k;
      for (const [kind, arr] of t.flowers) for (const fm of this.flowers) {
        if (fm.userData.kind !== kind) continue;
        const fi = fc.get(fm)!;
        const kk = Math.min(arr.length / 16, FLOWERS - fi);
        if (kk <= 0) continue;
        (fm.instanceMatrix.array as Float32Array).set(arr.subarray(0, kk * 16), fi * 16);
        fc.set(fm, fi + kk);
      }
    }
    gm.count = n;
    gm.instanceMatrix.needsUpdate = true;
    gm.instanceColor!.needsUpdate = true;
    for (const [fm, k] of fc) {
      fm.count = k;
      fm.instanceMatrix.needsUpdate = true;
    }
  }

  /** One tile's blades (and flowers), or null if its ground isn't loaded yet. */
  private tile(ti: number, tj: number, snow: number): CoverTile | null {
    const x0 = ti * TILE, z0 = tj * TILE;
    const c = this.streamer.chunkAt(x0 + TILE / 2, z0 + TILE / 2);
    if (!c) return null;
    const f = c.field;
    const per = Math.ceil(TILE / CELL);
    const m = new Float32Array(per * per * 16), col = new Float32Array(per * per * 3);
    const flowers = new Map<string, number[]>();
    let n = 0;
    const i0 = Math.floor(x0 / CELL), j0 = Math.floor(z0 / CELL);
    for (let j = j0; j < j0 + per; j++) for (let i = i0; i < i0 + per; i++) {
      // a fixed jitter per cell
      const h1 = hash(i, j), h2 = hash(j + 71, i - 13), h3 = hash(i * 3 + 7, j * 5 - 1);
      const x = (i + h1) * CELL, z = (j + h2) * CELL;
      if (x < x0 || x >= x0 + TILE || z < z0 || z >= z0 + TILE) continue;
      const vi = Math.round((x - f.x0) / f.step), vj = Math.round((z - f.z0) / f.step);
      if (vi < 0 || vj < 0 || vi >= f.n || vj >= f.n) continue;
      const k = vj * f.n + vi;
      if (!Number.isNaN(f.water[k]) || f.road[k] > 0.05 || f.urban[k] > 0.15) continue;
      const bi = BIOME_LIST[f.biome[k]];
      const density = bi === 'temperate' || bi === 'forest' ? 1 : bi === 'boreal' || bi === 'swamp' ? 0.75 : bi === 'coast' || bi === 'alpine' ? 0.35 : bi === 'scrub' ? 0.3 : 0;
      // in patches
      const patch = 0.55 + 0.45 * Math.sin(x * 0.11 + Math.sin(z * 0.07) * 3) * Math.cos(z * 0.09 + x * 0.03);
      if (h3 > density * patch * (1 - snow)) continue;
      const y = fieldHeight(f, x, z);
      // steep: bare (the slope from the field's own samples)
      const ia = Math.max(0, vi - 1), ib = Math.min(f.n - 1, vi + 1), ja = Math.max(0, vj - 1), jb = Math.min(f.n - 1, vj + 1);
      const sx = (f.h[vj * f.n + ib] - f.h[vj * f.n + ia]) / ((ib - ia) * f.step), sz = (f.h[jb * f.n + vi] - f.h[ja * f.n + vi]) / ((jb - ja) * f.step);
      if (Math.abs(sx) + Math.abs(sz) > 0.9) continue;
      const scale = 0.7 + h1 * 0.7 + (bi === 'forest' ? 0.3 : 0);
      this.q.setFromAxisAngle(UP, h2 * 6.283);
      this.m.compose(this.p.set(x, y - 0.02, z), this.q, this.s.set(scale * (0.8 + h3 * 0.4), scale, scale * (0.8 + h3 * 0.4)));
      this.m.toArray(m, n * 16);
      // tinted by the land: lush green, or dry and straw-coloured in the scrub
      const b = BIOMES[bi].grass;
      const v = 1.7 + h2 * 0.7;
      col[n * 3] = b[0] * v;
      col[n * 3 + 1] = b[1] * v;
      col[n * 3 + 2] = b[2] * v;
      n++;
      // the odd wildflower in the green
      if ((bi === 'temperate' || bi === 'forest') && hash(i * 7, j * 11) > 0.992 && snow < 0.2) {
        const kind = ['flower_white', 'flower_blue', 'flower_yellow'][Math.floor(hash(i, j * 3) * 3)];
        this.m.compose(this.p.set(x + 0.1, y - 0.02, z), this.q, this.s.setScalar(0.8 + h1 * 0.5));
        let arr = flowers.get(kind);
        if (!arr) flowers.set(kind, (arr = []));
        const at = arr.length;
        arr.length += 16;
        this.m.toArray(arr, at);
      }
    }
    return { n, m, c: col, flowers: new Map([...flowers].map(([k, a]) => [k, new Float32Array(a)])) };
  }

  clear() {
    if (this.grass) this.grass.count = 0;
    for (const f of this.flowers) f.count = 0;
    this.around = '';
    this.dirty = true;
  }
}

interface CoverTile {
  n: number;
  m: Float32Array;
  c: Float32Array;
  flowers: Map<string, Float32Array>;
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
  // thinning out towards the edge of the carpet (done here, so the carpet itself needn't be re-laid as you move)
  float edge = 1.0 - smoothstep(${(RADIUS * 0.68).toFixed(1)}, ${RADIUS.toFixed(1)}, distance(ip.xz, cameraPosition.xz));
  transformed *= edge;
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
