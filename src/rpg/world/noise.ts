import { mulberry32 } from '../../world/rng';

/**
 * Deterministic noise for the RPG world. Everything the generator builds
 * (hills, coastlines, where a town stands, which way a road bends) comes out
 * of these few functions and a seed, so the same world is there every time
 * you go back, on every machine.
 */

/** 32-bit integer hash of up to three integers (fast, well mixed). */
export function hash3(a: number, b: number, c = 0): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** 0..1 from integers. */
export function rand3(a: number, b: number, c = 0): number {
  return hash3(a, b, c) / 4294967296;
}

/** A seeded RNG for one thing in the world (a building, a person, a road). */
export function rngFor(a: number, b: number, c = 0) {
  return mulberry32(hash3(a, b, c));
}

/** Hash a string into a seed (names, ids). */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD = new Float32Array([1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 0, 1, 0, -1, 0.7071, 0.7071, -0.7071, 0.7071, 0.7071, -0.7071, -0.7071, -0.7071]);

/** Seeded 2D simplex noise, output roughly −1..1. */
export class Simplex {
  private perm = new Uint8Array(512);
  private permMod = new Uint8Array(512);

  constructor(seed: number) {
    const r = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(r.next() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod[i] = (this.perm[i] % 12) * 2;
    }
  }

  noise(xin: number, yin: number): number {
    const perm = this.perm, pm = this.permMod;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = pm[ii + perm[jj]];
      t0 *= t0;
      n += t0 * t0 * (GRAD[g] * x0 + GRAD[g + 1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = pm[ii + i1 + perm[jj + j1]];
      t1 *= t1;
      n += t1 * t1 * (GRAD[g] * x1 + GRAD[g + 1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = pm[ii + 1 + perm[jj + 1]];
      t2 *= t2;
      n += t2 * t2 * (GRAD[g] * x2 + GRAD[g + 1] * y2);
    }
    return 70 * n;
  }

  /** Fractal sum, −1..1-ish. `lac` frequency step, `gain` amplitude step. */
  fbm(x: number, y: number, oct: number, lac = 2.02, gain = 0.5): number {
    let a = 1, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * this.noise(x * f + i * 17.3, y * f - i * 9.1);
      n += a;
      a *= gain;
      f *= lac;
    }
    return s / n;
  }

  /** Ridged multifractal, 0..1: sharp crests (mountain ranges, river valleys). */
  ridged(x: number, y: number, oct: number): number {
    let a = 1, f = 1, s = 0, n = 0, w = 1;
    for (let i = 0; i < oct; i++) {
      let v = 1 - Math.abs(this.noise(x * f + i * 31.7, y * f + i * 7.9));
      v *= v;
      v *= w;
      w = Math.min(1, Math.max(0, v * 1.6));
      s += a * v;
      n += a;
      a *= 0.5;
      f *= 2.1;
    }
    return s / n;
  }
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function smooth(a: number, b: number, x: number) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Distance from p to segment ab, and the parameter along it (0..1). */
export function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { d: number; t: number } {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * t - px, cz = az + dz * t - pz;
  return { d: Math.sqrt(cx * cx + cz * cz), t };
}
