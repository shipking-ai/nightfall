import { BIOMES } from './biomes';
import { DISTRICT_03, newGround, type WorldGen } from './WorldGen';

/*
 * A chunk's field: heights and what's there, sampled from the generator on a
 * grid. Pure (the generator and arrays, nothing to do with drawing), so it
 * can be worked out in a worker ahead of time.
 */

/** Heights and what's there, sampled on a grid (the mesh, the collision and the water all read it). */
export interface Field {
  x0: number;
  z0: number;
  step: number;
  /** vertices per side (segments + 1) */
  n: number;
  h: Float32Array;
  /** water surface per vertex (NaN = dry) */
  water: Float32Array;
  /** 0..1 */
  forest: Float32Array;
  road: Float32Array;
  urban: Float32Array;
  biome: Uint8Array;
}

export const BIOME_LIST = Object.keys(BIOMES) as (keyof typeof BIOMES)[];
const _g = newGround();

/**
 * Sample the world on a grid with a one-vertex border (for normals), and
 * write the mesh. `skirt` drops a curtain round the edge to hide the cracks
 * where a finer chunk meets a coarser one.
 */
export function buildField(gen: WorldGen, x0: number, z0: number, size: number, seg: number): { field: Field; grass: Float32Array; soil: Float32Array; mix: Float32Array; hb: Float32Array } {
  const n = seg + 1, step = size / seg, nb = n + 2;
  const hb = new Float32Array(nb * nb);
  const grass = new Float32Array(n * n * 3), soil = new Float32Array(n * n * 3), mix = new Float32Array(n * n * 4);
  const field: Field = {
    x0, z0, step, n, h: new Float32Array(n * n), water: new Float32Array(n * n), forest: new Float32Array(n * n), road: new Float32Array(n * n), urban: new Float32Array(n * n),
    biome: new Uint8Array(n * n),
  };
  const d3 = DISTRICT_03;
  for (let j = 0; j < nb; j++) for (let i = 0; i < nb; i++) {
    const x = x0 + (i - 1) * step, z = z0 + (j - 1) * step;
    const inner = i >= 1 && i <= n && j >= 1 && j <= n;
    const g = gen.ground(x, z, _g);
    let h = g.h;
    // District 03 draws its own ground: hide ours under it, meeting it flush at the edge
    if (x > d3.x0 && x < d3.x1 && z > d3.z0 && z < d3.z1) {
      const e = Math.min(x - d3.x0, d3.x1 - x, z - d3.z0, d3.z1 - z);
      h = e <= step + 0.01 ? -0.08 : -9;
    }
    hb[j * nb + i] = h;
    if (!inner) continue;
    const k = (j - 1) * n + (i - 1);
    field.h[k] = h;
    field.water[k] = g.water == null ? NaN : g.water;
    field.forest[k] = g.forest;
    field.road[k] = g.road;
    field.urban[k] = g.urban;
    field.biome[k] = BIOME_LIST.indexOf(g.biome);
    const b = BIOMES[g.biome];
    // towns: trampled, mown, paved in places
    const u = g.urban;
    const gr = b.grass, so = b.dirt;
    const f = g.forest;
    grass[k * 3] = lerp3(gr[0] * (1 - f * 0.35), 0.1, u * 0.3);
    grass[k * 3 + 1] = lerp3(gr[1] * (1 - f * 0.25), 0.11, u * 0.3);
    grass[k * 3 + 2] = lerp3(gr[2] * (1 - f * 0.2), 0.07, u * 0.3);
    soil[k * 3] = so[0];
    soil[k * 3 + 1] = so[1];
    soil[k * 3 + 2] = so[2];
    mix[k * 4] = g.sand;
    mix[k * 4 + 1] = g.snow;
    mix[k * 4 + 2] = g.road > 0 ? (g.roadKind >= 2 ? 1 : 0.5) : 0;
    mix[k * 4 + 3] = g.wet;
  }
  return { field, grass, soil, mix, hb };
}

function lerp3(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** What buildField returns (all plain arrays, so it can cross from a worker). */
export type FieldSamples = ReturnType<typeof buildField>;
