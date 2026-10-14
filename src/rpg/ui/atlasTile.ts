import { BIOMES } from '../world/biomes';
import { newGround, type WorldGen } from '../world/WorldGen';

/**
 * One tile of the atlas's land, as RGBA: relief lit from the north-west,
 * water by depth, forest darker, sand, bare rock high up, snow, and the
 * grey of towns, with a little of the paper showing through. Pure (the
 * generator and some arithmetic), so it runs in a worker.
 */

export const TILE = 128;
/** samples per tile side (each drawn 2×2) */
export const SAMP = 64;

const PAPER: [number, number, number] = [0.9, 0.87, 0.8];
const srgb = (c: number) => Math.pow(Math.min(1, Math.max(0, c)), 1 / 2.2);
const _g = newGround();

export function renderTile(gen: WorldGen, lv: number, ti: number, tj: number): Uint8ClampedArray {
  const tw = TILE * lv;
  const step = tw / SAMP;
  const N = SAMP + 2;
  const hs = new Float32Array(N * N);
  const cols = new Float32Array(SAMP * SAMP * 3);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = ti * tw + (i - 1 + 0.5) * step, z = tj * tw + (j - 1 + 0.5) * step;
    const gr = gen.ground(x, z, _g);
    hs[j * N + i] = gr.water != null ? Math.max(gr.h, gr.water) : gr.h;
    if (i === 0 || j === 0 || i === N - 1 || j === N - 1) continue;
    const b = BIOMES[gr.biome];
    let r: number, gg: number, bb: number;
    if (gr.water != null && gr.water > gr.h) {
      const depth = Math.min(1, (gr.water - gr.h) / 18);
      r = 0.2 - depth * 0.1;
      gg = 0.34 - depth * 0.12;
      bb = 0.42 - depth * 0.1;
    } else {
      [r, gg, bb] = b.grass;
      const forest = gr.forest;
      r *= 1 - forest * 0.35;
      gg *= 1 - forest * 0.22;
      bb *= 1 - forest * 0.3;
      if (gr.sand > 0) (r += (b.dirt[0] - r) * gr.sand), (gg += (b.dirt[1] - gg) * gr.sand), (bb += (b.dirt[2] - bb) * gr.sand);
      // bare rock high up
      const rock = Math.min(1, Math.max(0, (gr.h - 380) / 400));
      if (rock > 0) (r += (b.rock[0] - r) * rock), (gg += (b.rock[1] - gg) * rock), (bb += (b.rock[2] - bb) * rock);
      if (gr.snow > 0) (r += (0.8 - r) * gr.snow), (gg += (0.82 - gg) * gr.snow), (bb += (0.86 - bb) * gr.snow);
      if (gr.urban > 0.25) {
        const u = Math.min(1, (gr.urban - 0.25) * 2);
        r += (0.3 - r) * u;
        gg += (0.27 - gg) * u;
        bb += (0.24 - bb) * u;
      }
      r *= 1.9;
      gg *= 1.9;
      bb *= 1.9;
    }
    const k = ((j - 1) * SAMP + (i - 1)) * 3;
    cols[k] = r;
    cols[k + 1] = gg;
    cols[k + 2] = bb;
  }
  const out = new Uint8ClampedArray(SAMP * SAMP * 4);
  // relief: lit from the north-west, darker the steeper it faces away
  const relief = 1.6 / step;
  for (let j = 0; j < SAMP; j++) for (let i = 0; i < SAMP; i++) {
    const c = (j + 1) * N + (i + 1);
    const dx = (hs[c + 1] - hs[c - 1]) * relief * 0.5, dz = (hs[c + N] - hs[c - N]) * relief * 0.5;
    const shade = Math.min(1.35, Math.max(0.45, 1 - (dx + dz) * 0.35));
    const k = (j * SAMP + i) * 3, o = (j * SAMP + i) * 4;
    // (a little of the paper shows through: an atlas, not a satellite)
    for (let q = 0; q < 3; q++) out[o + q] = (srgb(cols[k + q] * shade) * 0.84 + PAPER[q] * 0.16) * 255;
    out[o + 3] = 255;
  }
  return out;
}
