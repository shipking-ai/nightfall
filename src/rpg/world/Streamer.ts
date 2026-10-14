import * as THREE from 'three';
import { signsFor, type SignSet } from './Signs';
import { WorldContext, type Lamp } from '../../world/WorldContext';
import type { Materials } from '../../world/materials';
import type { Collision, Box } from '../../world/Collision';
import { G, M } from '../../world/builders/props';
import { mulberry32 } from '../../world/rng';
import { hash3 } from './noise';
import { BIOMES, type Species } from './biomes';
import { DISTRICT_03, type WorldGen } from './WorldGen';
import { fieldMesh, fieldHeight, fieldWater, waterMesh, createTerrainMaterial, terrainUniforms } from './Terrain';
import { buildField, BIOME_LIST, type Field, type FieldSamples } from './fieldGen';
import { Flora, trunkOf, type Plant } from './Flora';
import { Towns, type Poi, type TownOut } from './Towns';
import { roadGeometry, createRoadMaterial, deckHeight, type Deck } from './Roads';
import { Glow } from './Glow';

export const CHUNK = 128;
/** chunks kept on each side of the one you're in */
const NEAR_R = 3;
const SEG = 32;
const TILE = 1024;
const TILE_SEG = 32;
const FAR_R = 3;

export interface Chunk {
  key: string;
  ci: number;
  cj: number;
  x0: number;
  z0: number;
  group: THREE.Group;
  field: Field;
  boxes: Box[];
  lamps: Lamp[];
  pois: Poi[];
  spots: TownOut['spots'];
  cars: TownOut['cars'];
  decks: Deck[];
  plants: number;
  /** shop signs and lit doors (their own group: the plane geometry is shared) */
  signs: SignSet | null;
}

interface Tile {
  key: string;
  mesh: THREE.Mesh;
}

/**
 * Builds the world around you out of the generator's answers and forgets it
 * behind you. Near chunks (128 m) are the real thing: ground, water, roads,
 * buildings, trees, lamps, collision. Past them, coarse 1 km tiles carry the
 * land to the horizon and sink out of the way wherever near chunks stand.
 * Work is spread over frames under a time budget, nearest first, so driving
 * fast never stops the game to think.
 */
export class Streamer {
  group = new THREE.Group();
  chunks = new Map<string, Chunk>();
  private tiles = new Map<string, Tile>();
  flora = new Flora();
  glow = new Glow();
  towns: Towns;
  private terrainMat = createTerrainMaterial(false);
  private farMat = createTerrainMaterial(true);
  private roadMat = createRoadMaterial();
  private center = { ci: 1e9, cj: 1e9 };
  /** lamps changed: the lighting pool and the glow need the new list */
  onLamps: ((all: Lamp[]) => void) | null = null;
  /** a chunk came in or went (the population, traffic and quests listen) */
  onChunk: ((c: Chunk, loaded: boolean) => void) | null = null;
  private lampsDirty = false;
  stats = { built: 0, dropped: 0, lastMs: 0, tiles: 0 };
  /** fields worked out in the workers, waiting to be built into chunks and tiles */
  private fields = new Map<string, FieldSamples>();
  private asked = new Set<string>();
  private workers: Worker[] = [];
  /** the chunk being built, a piece a frame */
  private job: { key: string; it: Generator<void, void>; rec: Box[] } | null = null;
  private nextWorker = 0;

  /**
   * A field, if it's ready; otherwise it's asked for (from a worker) and this
   * returns undefined, and the chunk or tile is built on a later frame.
   */
  private field(key: string, x0: number, z0: number, size: number, seg: number): FieldSamples | undefined {
    const f = this.fields.get(key);
    if (f) {
      this.fields.delete(key);
      return f;
    }
    if (typeof Worker === 'undefined') return buildField(this.gen, x0, z0, size, seg);
    if (this.asked.has(key)) return undefined;
    if (!this.workers.length) {
      const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 2));
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./field.worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e: MessageEvent<{ key: string; s: FieldSamples }>) => {
          if (!this.asked.delete(e.data.key)) return; // (forgotten meanwhile)
          this.fields.set(e.data.key, e.data.s);
        };
        this.workers.push(w);
      }
    }
    this.asked.add(key);
    this.workers[this.nextWorker++ % this.workers.length].postMessage({ seed: this.gen.seed, x0, z0, size, seg, key });
    return undefined;
  }

  constructor(private gen: WorldGen, private collision: Collision, private mats: Materials, private waterMat: THREE.Material) {
    this.towns = new Towns(gen);
    this.group.add(this.flora.group, this.glow.mesh);
  }

  /** Everything built now, around `pos` (behind the intermission card). */
  async preload(pos: THREE.Vector3, progress: (k: number) => void) {
    const ci = Math.floor(pos.x / CHUNK), cj = Math.floor(pos.z / CHUNK);
    const todo: [number, number][] = [];
    for (let i = -NEAR_R; i <= NEAR_R; i++) for (let j = -NEAR_R; j <= NEAR_R; j++) todo.push([ci + i, cj + j]);
    todo.sort((a, b) => Math.hypot(a[0] - ci, a[1] - cj) - Math.hypot(b[0] - ci, b[1] - cj));
    const ti = Math.floor(pos.x / TILE), tj = Math.floor(pos.z / TILE);
    const tiles: [number, number][] = [];
    for (let i = -FAR_R; i <= FAR_R; i++) for (let j = -FAR_R; j <= FAR_R; j++) tiles.push([ti + i, tj + j]);
    const total = todo.length + tiles.length;
    let done = 0;
    let t0 = performance.now();
    for (const [i, j] of todo) {
      if (!this.chunks.has(`${i},${j}`)) this.buildChunk(i, j);
      done++;
      if (performance.now() - t0 > 30) {
        progress(done / total);
        await yieldFrame();
        t0 = performance.now();
      }
    }
    for (const [i, j] of tiles) {
      if (!this.tiles.has(`${i},${j}`)) this.buildTile(i, j);
      done++;
      if (performance.now() - t0 > 30) {
        progress(done / total);
        await yieldFrame();
        t0 = performance.now();
      }
    }
    this.update(pos, 0);
    progress(1);
  }

  update(pos: THREE.Vector3, budgetMs = 5) {
    const t0 = performance.now();
    const ci = Math.floor(pos.x / CHUNK), cj = Math.floor(pos.z / CHUNK);
    this.center = { ci, cj };
    // a chunk being built: carry on with it
    if (this.job) {
      const j = this.job;
      while (performance.now() - t0 < budgetMs || budgetMs <= 0) {
        if (j.it.next().done) {
          this.job = null;
          break;
        }
      }
    }
    // what's wanted, nearest first
    let built = 0;
    for (let ring = 0; ring <= NEAR_R; ring++) {
      for (let i = -ring; i <= ring; i++) for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        const key = `${ci + i},${cj + j}`;
        if (this.chunks.has(key) || this.job) continue;
        if (built > 0 && performance.now() - t0 > budgetMs) continue;
        const f = this.field(`c:${key}`, (ci + i) * CHUNK, (cj + j) * CHUNK, CHUNK, SEG);
        if (!f) continue;
        const rec: Box[] = [];
        const it = this.chunkSteps(ci + i, cj + j, f, rec);
        this.job = { key, it, rec };
        while (performance.now() - t0 < budgetMs) {
          if (it.next().done) {
            this.job = null;
            break;
          }
        }
        built++;
      }
    }
    // the next ring out, worked out ahead
    for (let i = -NEAR_R - 1; i <= NEAR_R + 1; i++) for (let j = -NEAR_R - 1; j <= NEAR_R + 1; j++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== NEAR_R + 1) continue;
      const key = `c:${ci + i},${cj + j}`;
      if (!this.fields.has(key) && !this.asked.has(key) && this.asked.size < 12) this.field(key, (ci + i) * CHUNK, (cj + j) * CHUNK, CHUNK, SEG);
    }
    // forget fields for places left behind
    for (const k of this.fields.keys()) {
      const [kind, rest] = k.split(':');
      const [a, b] = rest.split(',').map(Number);
      if (kind === 'c' ? Math.max(Math.abs(a - ci), Math.abs(b - cj)) > NEAR_R + 2 : Math.max(Math.abs(a - Math.floor(pos.x / TILE)), Math.abs(b - Math.floor(pos.z / TILE))) > FAR_R + 2) this.fields.delete(k);
    }
    // what's gone (with a margin, so walking along a border doesn't thrash)
    for (const c of this.chunks.values()) if (Math.abs(c.ci - ci) > NEAR_R + 1 || Math.abs(c.cj - cj) > NEAR_R + 1) this.dropChunk(c);
    // far tiles
    const ti = Math.floor(pos.x / TILE), tj = Math.floor(pos.z / TILE);
    for (let i = -FAR_R; i <= FAR_R; i++) for (let j = -FAR_R; j <= FAR_R; j++) {
      const key = `${ti + i},${tj + j}`;
      if (this.tiles.has(key)) continue;
      if (performance.now() - t0 > budgetMs && budgetMs > 0) break;
      const f = budgetMs > 0 ? this.field(`t:${key}`, (ti + i) * TILE, (tj + j) * TILE, TILE, TILE_SEG) : buildField(this.gen, (ti + i) * TILE, (tj + j) * TILE, TILE, TILE_SEG);
      if (!f) continue;
      this.buildTile(ti + i, tj + j, f);
    }
    for (const [k, t] of this.tiles) {
      const [a, b] = k.split(',').map(Number);
      if (Math.abs(a - ti) > FAR_R + 1 || Math.abs(b - tj) > FAR_R + 1) {
        this.group.remove(t.mesh);
        t.mesh.geometry.dispose();
        this.tiles.delete(k);
      }
    }
    // the far tiles sink under the largest square of near chunks that's complete
    let k = NEAR_R - 1;
    for (; k >= 0; k--) {
      let full = true;
      for (let i = -k; i <= k && full; i++) for (let j = -k; j <= k && full; j++) if (!this.chunks.has(`${ci + i},${cj + j}`)) full = false;
      if (full) break;
    }
    const u = terrainUniforms.uNear.value;
    if (k >= 0) u.set((ci - k) * CHUNK, (cj - k) * CHUNK, (ci + k + 1) * CHUNK, (cj + k + 1) * CHUNK);
    else u.set(0, 0, 0, 0);
    this.flora.update(pos);
    if (this.lampsDirty) {
      this.lampsDirty = false;
      const all: Lamp[] = [];
      for (const c of this.chunks.values()) all.push(...c.lamps);
      this.glow.set(all);
      this.onLamps?.(all);
    }
    this.glow.update();
    this.stats.lastMs = performance.now() - t0;
    this.stats.tiles = this.tiles.size;
  }

  /** Build a chunk now, all of it (the loading screen). */
  private buildChunk(ci: number, cj: number, ready?: FieldSamples) {
    const it = this.chunkSteps(ci, cj, ready, []);
    while (!it.next().done);
  }

  /**
   * A chunk, a piece at a time: the ground, water and roads, then the town a
   * block at a time, then bridges, trees and the rest. Nothing shows (and it
   * isn't a chunk yet) until it's all there. `rec` collects its collision boxes.
   */
  private *chunkSteps(ci: number, cj: number, ready: FieldSamples | undefined, rec: Box[]): Generator<void, void> {
    const col = Object.create(this.collision) as Collision;
    col.add = (...a: Parameters<Collision['add']>) => {
      const b = this.collision.add(...a);
      rec.push(b);
      return b;
    };
    const x0 = ci * CHUNK, z0 = cj * CHUNK;
    const key = `${ci},${cj}`;
    const group = new THREE.Group();
    const s = ready ?? buildField(this.gen, x0, z0, CHUNK, SEG);
    const f = s.field;
    const terrain = new THREE.Mesh(fieldMesh(s, 3), this.terrainMat);
    terrain.position.set(x0, 0, z0);
    terrain.receiveShadow = true;
    terrain.matrixAutoUpdate = false;
    terrain.updateMatrix();
    group.add(terrain);
    const wg = waterMesh(f);
    if (wg) {
      const w = new THREE.Mesh(wg, this.waterMat);
      w.position.set(x0, 0, z0);
      w.matrixAutoUpdate = false;
      w.updateMatrix();
      group.add(w);
    }
    // roads
    const cx = x0 + CHUNK / 2, cz = z0 + CHUNK / 2;
    const rg = roadGeometry(this.gen.roadsNear(cx, cz), x0, z0, CHUNK, x0, z0);
    if (rg.geo) {
      const rm = new THREE.Mesh(rg.geo, this.roadMat);
      rm.position.set(x0, 0, z0);
      rm.receiveShadow = true;
      rm.matrixAutoUpdate = false;
      rm.updateMatrix();
      group.add(rm);
    }
    // towns, bridges, trees
    const ctx = new WorldContext(this.mats);
    ctx.batch.declare(this.mats.facade, [
      ['aBld', 4],
      ['aTop', 3],
    ]);
    ctx.collision = col;
    const out: TownOut = { plants: [], lamps: [], pois: [], spots: [], cars: [] };
    yield;
    yield* this.towns.buildSteps(ctx, x0, z0, CHUNK, out);
    for (const p of rg.piers) {
      const ground = this.gen.height(p.x, p.z);
      const bottom = Math.min(ground, p.top) - 2;
      // Only a pier that actually spans something gets built. The cap used to be
      // added unconditionally, so a crossing too short to need a column still
      // got a block hanging in mid-air on nothing.
      if (p.top - bottom > 2) {
        ctx.batch.add(this.mats.concrete, G.box, M(p.x, bottom, p.z, p.w * 0.8, p.top - 0.6 - bottom, 1.6, p.yaw));
        ctx.batch.add(this.mats.concrete, G.box, M(p.x, p.top - 0.9, p.z, p.w + 1.4, 0.85, 3.4, p.yaw));
      }
    }
    for (const r of rg.rails) {
      const len = Math.hypot(r.bx - r.ax, r.bz - r.az);
      const yaw = Math.atan2(r.bx - r.ax, r.bz - r.az);
      const mid = (r.ha + r.hb) / 2;
      const pitch = -Math.atan2(r.hb - r.ha, len);
      ctx.batch.add(this.mats.concrete, G.box, M((r.ax + r.bx) / 2, mid, (r.az + r.bz) / 2, 0.4, 1.0, len + 0.1, yaw, pitch));
    }
    const plants = out.plants;
    this.wild(f, ci, cj, plants);
    // trunks are solid
    for (const p of plants) {
      const t = trunkOf(p.s) * p.scale;
      if (t > 0.05) col.add(p.x - t * 0.5, p.y, p.z - t * 0.5, p.x + t * 0.5, p.y + 3.2, p.z + t * 0.5, false);
    }
    yield;
    ctx.batch.build(group);
    group.traverse((o) => {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    });
    group.updateMatrixWorld(true);
    this.group.add(group);
    this.flora.add(key, plants);
    const signs = out.pois.length ? signsFor(out.pois) : null;
    if (signs) this.group.add(signs.group);
    const chunk: Chunk = {
      key, ci, cj, x0, z0, group, field: f, boxes: rec, lamps: ctx.lamps, pois: out.pois, spots: out.spots, cars: out.cars, decks: rg.decks, plants: plants.length, signs,
    };
    this.chunks.set(key, chunk);
    if (ctx.lamps.length) this.lampsDirty = true;
    this.stats.built++;
    this.onChunk?.(chunk, true);
  }

  /** Trees, bushes, rocks by what grows here: a jittered grid, thinned by the biome's density. */
  private wild(f: Field, ci: number, cj: number, out: Plant[]) {
    const CELLM = 7;
    const n = Math.floor(CHUNK / CELLM);
    const d3 = DISTRICT_03;
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const h = hash3(ci * 64 + a, cj * 64 + b, this.gen.seed);
      const r = mulberry32(h);
      const x = f.x0 + (a + r.next()) * CELLM, z = f.z0 + (b + r.next()) * CELLM;
      if (x > d3.x0 - 20 && x < d3.x1 + 20 && z > d3.z0 - 20 && z < d3.z1 + 20) continue;
      const i = Math.min(f.n - 1, Math.round((x - f.x0) / f.step)), j = Math.min(f.n - 1, Math.round((z - f.z0) / f.step));
      const k = j * f.n + i;
      if (!Number.isNaN(f.water[k]) || f.road[k] > 0 || f.urban[k] > 0.12) continue;
      const bi = BIOMES[BIOME_LIST[f.biome[k]]];
      if (!bi.flora.length) continue;
      const forest = f.forest[k];
      const p = (bi.density * (CELLM * CELLM)) / 10000 * (0.25 + forest * 1.1);
      if (r.next() > p) continue;
      // steep ground: rocks only
      const hh = fieldHeight(f, x, z);
      const slope = Math.abs(fieldHeight(f, x + 2, z) - hh) + Math.abs(fieldHeight(f, x, z + 2) - hh);
      let s = pickSpecies(bi.flora, r.next());
      if (slope > 1.6) s = r.chance(0.5) ? 'rock' : 'boulder';
      if (s === 'reed' && Number.isNaN(fieldWater(f, x + 4, z)) && Number.isNaN(fieldWater(f, x - 4, z)) && bi.id !== 'swamp') s = 'bush';
      out.push({ s, x, y: hh - 0.08, z, yaw: r.next() * 6.283, scale: 0.7 + r.next() * 0.6 });
    }
  }

  private dropChunk(c: Chunk) {
    this.chunks.delete(c.key);
    this.group.remove(c.group);
    c.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.collision.remove(c.boxes);
    this.flora.remove(c.key);
    if (c.signs) {
      this.group.remove(c.signs.group);
      c.signs.dispose();
    }
    if (c.lamps.length) this.lampsDirty = true;
    this.stats.dropped++;
    this.onChunk?.(c, false);
  }

  private buildTile(ti: number, tj: number, ready?: FieldSamples) {
    const s = ready ?? buildField(this.gen, ti * TILE, tj * TILE, TILE, TILE_SEG);
    const mesh = new THREE.Mesh(fieldMesh(s, 30), this.farMat);
    mesh.position.set(ti * TILE, 0, tj * TILE);
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    this.tiles.set(`${ti},${tj}`, { key: `${ti},${tj}`, mesh });
  }

  /** Drop everything (leaving the mode). */
  clear() {
    // a chunk half built: its boxes go, the rest was never shown
    if (this.job) {
      this.collision.remove(this.job.rec);
      this.job = null;
    }
    for (const c of [...this.chunks.values()]) this.dropChunk(c);
    for (const t of this.tiles.values()) {
      this.group.remove(t.mesh);
      t.mesh.geometry.dispose();
    }
    this.tiles.clear();
    this.fields.clear();
    this.asked.clear();
    this.flora.clear();
    this.flora.update(new THREE.Vector3(1e9, 0, 0));
    this.glow.set([]);
    this.onLamps?.([]);
  }

  chunkAt(x: number, z: number): Chunk | undefined {
    return this.chunks.get(`${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`);
  }

  /** Ground height: from the loaded mesh when there is one (so feet meet what's drawn). */
  heightAt(x: number, z: number): number {
    const c = this.chunkAt(x, z);
    return c ? fieldHeight(c.field, x, z) : this.gen.height(x, z);
  }

  /** What you'd stand on at (x, z) from height y: the ground, or a bridge deck within a step. */
  surfaceAt(x: number, z: number, y: number, step: number): number {
    let g = this.heightAt(x, z);
    const c = this.chunkAt(x, z);
    if (c) {
      // decks can hang over the next chunk: check the neighbours' too
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const n = this.chunks.get(`${c.ci + di},${c.cj + dj}`);
        if (!n) continue;
        for (const d of n.decks) {
          const h = deckHeight(d, x, z);
          if (!Number.isNaN(h) && h <= y + step && h > g) g = h;
        }
      }
    }
    return g;
  }

  /** Water surface at (x, z), or null. */
  waterAt(x: number, z: number): number | null {
    const c = this.chunkAt(x, z);
    if (c) {
      const w = fieldWater(c.field, x, z);
      return Number.isNaN(w) ? null : w;
    }
    return this.gen.ground(x, z).water;
  }

  /** Loaded shop doors and such near a point. */
  poisNear(x: number, z: number, r: number): Poi[] {
    const out: Poi[] = [];
    for (const c of this.chunks.values()) for (const p of c.pois) if (Math.hypot(p.x - x, p.z - z) < r) out.push(p);
    return out;
  }
}

function pickSpecies(opts: [Species, number][], u: number): Species {
  let sum = 0;
  for (const [, w] of opts) sum += w;
  let k = u * sum;
  for (const [s, w] of opts) if ((k -= w) <= 0) return s;
  return opts[0][0];
}

const yieldFrame = () =>
  new Promise<void>((r) => {
    requestAnimationFrame(() => r());
    setTimeout(() => r(), 40);
  });
