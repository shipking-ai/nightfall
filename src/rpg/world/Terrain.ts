import * as THREE from 'three';
import { NOISE } from '../../render/glsl';
import { worldUniforms } from '../../world/materials';
import { BIOMES } from './biomes';
import { DISTRICT_03, newGround, SEA_Y, type Ground, type WorldGen } from './WorldGen';

/**
 * Ground meshes: a heightfield per chunk (and big coarse tiles for the far
 * view), coloured by what the generator says is there. The shader does the
 * rest: grass breaking up into dirt, rock on anything steep, snow settling
 * on the flats, sand at the waterline, and the whole lot darkening and
 * going glossy in the rain.
 */

export const terrainUniforms = {
  /** snow lying on the ground from weather (0..1), on top of what the climate gives */
  uSnowCover: { value: 0 },
  /** the near ring (x0, z0, x1, z1): far tiles sink out of the way inside it */
  uNear: { value: new THREE.Vector4(0, 0, 0, 0) },
  /** sun direction, for the cheap far-terrain shading */
  uDay: { value: 0 },
};

function patch(shader: THREE.WebGLProgramParametersWithUniforms, far: boolean) {
  Object.assign(shader.uniforms, worldUniforms, terrainUniforms);
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
attribute vec3 aGrass;
attribute vec3 aSoil;
attribute vec4 aMix;
uniform vec4 uNear;
varying vec3 vGrass;
varying vec3 vSoil;
varying vec4 vMix;
varying vec3 vWPos;
varying vec3 vWNrm;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vGrass = aGrass;
vSoil = aSoil;
vMix = aMix;
${far ? `
{
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  // inside the near ring the detailed chunks take over: sink out of sight
  if (wp.x > uNear.x + 0.5 && wp.x < uNear.z - 0.5 && wp.z > uNear.y + 0.5 && wp.z < uNear.w - 0.5) transformed.y -= 60.0;
}` : ''}
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNrm = normalize(mat3(modelMatrix) * objectNormal);`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
uniform float uWet;
uniform float uTime;
uniform float uSnowCover;
varying vec3 vGrass;
varying vec3 vSoil;
varying vec4 vMix;
varying vec3 vWPos;
varying vec3 vWNrm;
${NOISE}`,
    )
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
{
  vec2 p = vWPos.xz;
  vec3 n = normalize(vWNrm);
  float slope = 1.0 - n.y;
  float big = nf_fbm(p * 0.035);
  float mid = nf_noise(p * 0.21);
  float fine = nf_noise(p * 1.7);
  float sand = vMix.x, snow = vMix.y, road = vMix.z, wetG = vMix.w;
  // grass, broken up by bare soil in patches and along the paths animals take
  vec3 grass = vGrass * (0.72 + 0.4 * mid) * (0.9 + 0.2 * fine);
  vec3 soil = vSoil * (0.8 + 0.3 * fine);
  float bare = smoothstep(0.5, 0.78, big + fine * 0.08);
  vec3 col = mix(grass, soil, bare * 0.75);
  float rough = 0.92;
  // sand at beaches and in the desert: ripples
  vec3 sandCol = vec3(0.47, 0.39, 0.27) * (0.86 + 0.18 * nf_noise(p * vec2(0.9, 3.1)));
  col = mix(col, sandCol, sand);
  // rock on anything steep
  vec3 rock = mix(vSoil, vec3(0.3, 0.3, 0.3), 0.55) * (0.65 + 0.5 * nf_noise(p * 0.5 + vWPos.y * 0.3)) ;
  float rk = smoothstep(0.24, 0.42, slope + (mid - 0.5) * 0.12);
  col = mix(col, rock, rk);
  // road (the far tiles show where the roads run; near chunks draw them for real)
  col = mix(col, road > 0.75 ? vec3(0.07, 0.072, 0.075) : vec3(0.25, 0.2, 0.15), smoothstep(0.2, 0.6, road));
  // snow: the climate's, and whatever the weather is laying down, only where it can settle
  float settle = 1.0 - smoothstep(0.3, 0.5, slope);
  float sn = clamp(snow + uSnowCover * (0.6 + 0.4 * big), 0.0, 1.0) * settle;
  sn = smoothstep(0.35, 0.65, sn + (fine - 0.5) * 0.25);
  col = mix(col, vec3(0.78, 0.8, 0.84) * (0.92 + 0.08 * fine), sn);
  rough = mix(rough, 0.55, sn);
  // wet: darker and glossier in rain (not the snow, not the desert)
  float w = clamp(uWet * (1.0 - sn) * (1.0 - sand * 0.6) + wetG * 0.3, 0.0, 1.0);
  float pud = smoothstep(0.6, 0.68, big + fine * 0.05) * w * (1.0 - slope * 3.0) * (0.4 + road * 0.6);
  col *= mix(1.0, 0.62, w * 0.8);
  col = mix(col, col * 0.4, clamp(pud, 0.0, 1.0));
  rough = mix(rough, 0.45, w * 0.6);
  rough = mix(rough, 0.05, clamp(pud, 0.0, 1.0));
  diffuseColor.rgb = col;
  roughnessFactor = rough;
}`,
    )
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>');
}

export function createTerrainMaterial(far: boolean): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, envMapIntensity: 0.5 });
  m.onBeforeCompile = (s) => patch(s, far);
  m.customProgramCacheKey = () => `nf-terrain-${far ? 1 : 0}`;
  return m;
}

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

/** The mesh for a sampled field (relative to (x0, z0), which becomes the mesh position). */
export function fieldMesh(s: ReturnType<typeof buildField>, skirt: number): THREE.BufferGeometry {
  const { field, grass, soil, mix, hb } = s;
  const n = field.n, nb = n + 2, st = field.step;
  const edge = 4 * (n - 1);
  const vc = n * n + (skirt > 0 ? edge : 0);
  const pos = new Float32Array(vc * 3), nrm = new Float32Array(vc * 3);
  const aG = new Float32Array(vc * 3), aS = new Float32Array(vc * 3), aM = new Float32Array(vc * 4);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    const hc = hb[(j + 1) * nb + (i + 1)];
    pos[k * 3] = i * st;
    pos[k * 3 + 1] = hc;
    pos[k * 3 + 2] = j * st;
    const hl = hb[(j + 1) * nb + i], hr = hb[(j + 1) * nb + i + 2], hd = hb[j * nb + i + 1], hu = hb[(j + 2) * nb + i + 1];
    let nx = hl - hr, ny = 2 * st, nz = hd - hu;
    const l = Math.hypot(nx, ny, nz);
    nrm[k * 3] = nx / l;
    nrm[k * 3 + 1] = ny / l;
    nrm[k * 3 + 2] = nz / l;
  }
  aG.set(grass);
  aS.set(soil);
  aM.set(mix);
  const idx: number[] = [];
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  if (skirt > 0) {
    // walk the rim: each rim vertex gets a copy dropped by `skirt`
    const rim: number[] = [];
    for (let i = 0; i < n - 1; i++) rim.push(i);
    for (let j = 0; j < n - 1; j++) rim.push(j * n + n - 1);
    for (let i = n - 1; i > 0; i--) rim.push((n - 1) * n + i);
    for (let j = n - 1; j > 0; j--) rim.push(j * n);
    const base = n * n;
    rim.forEach((v, r) => {
      const k = base + r;
      pos[k * 3] = pos[v * 3];
      pos[k * 3 + 1] = pos[v * 3 + 1] - skirt;
      pos[k * 3 + 2] = pos[v * 3 + 2];
      nrm[k * 3] = nrm[v * 3];
      nrm[k * 3 + 1] = nrm[v * 3 + 1];
      nrm[k * 3 + 2] = nrm[v * 3 + 2];
      aG.set(grass.subarray(v * 3, v * 3 + 3), k * 3);
      aS.set(soil.subarray(v * 3, v * 3 + 3), k * 3);
      aM.set(mix.subarray(v * 4, v * 4 + 4), k * 4);
    });
    for (let r = 0; r < rim.length; r++) {
      const a = rim[r], b = rim[(r + 1) % rim.length], sa = base + r, sb = base + ((r + 1) % rim.length);
      // both windings: the skirt is only ever seen through a crack
      idx.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('aGrass', new THREE.BufferAttribute(aG, 3));
  g.setAttribute('aSoil', new THREE.BufferAttribute(aS, 3));
  g.setAttribute('aMix', new THREE.BufferAttribute(aM, 4));
  g.setIndex(vc > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Height on a field, on the same triangles the mesh draws. */
export function fieldHeight(f: Field, x: number, z: number): number {
  const u = (x - f.x0) / f.step, v = (z - f.z0) / f.step;
  const i = Math.min(f.n - 2, Math.max(0, Math.floor(u))), j = Math.min(f.n - 2, Math.max(0, Math.floor(v)));
  const fx = u - i, fz = v - j;
  const n = f.n;
  const h00 = f.h[j * n + i], h10 = f.h[j * n + i + 1], h01 = f.h[(j + 1) * n + i], h11 = f.h[(j + 1) * n + i + 1];
  if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
  return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
}

/** Water surface near (x, z) on a field (NaN = dry). */
export function fieldWater(f: Field, x: number, z: number): number {
  const i = Math.round((x - f.x0) / f.step), j = Math.round((z - f.z0) / f.step);
  if (i < 0 || j < 0 || i >= f.n || j >= f.n) return NaN;
  return f.water[j * f.n + i];
}

/**
 * Rivers and lakes on a chunk: a sheet at the water's height wherever there's
 * water (the sea is one big sheet of its own, so only fresh water here).
 */
export function waterMesh(f: Field): THREE.BufferGeometry | null {
  const n = f.n;
  const lvl = new Float32Array(n * n).fill(NaN);
  let any = false;
  for (let k = 0; k < n * n; k++) {
    const w = f.water[k];
    if (!Number.isNaN(w) && w > SEA_Y + 0.05) {
      lvl[k] = w;
      any = true;
    }
  }
  if (!any) return null;
  // spill one vertex out so the edge tucks under the bank
  const out = lvl.slice();
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    if (!Number.isNaN(lvl[k])) continue;
    let best = NaN;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      const w = lvl[jj * n + ii];
      if (!Number.isNaN(w) && (Number.isNaN(best) || w > best)) best = w;
    }
    out[k] = best;
  }
  const pos: number[] = [], idx: number[] = [];
  const map = new Int32Array(n * n).fill(-1);
  for (let k = 0; k < n * n; k++) {
    if (Number.isNaN(out[k])) continue;
    map[k] = pos.length / 3;
    pos.push((k % n) * f.step, out[k], Math.floor(k / n) * f.step);
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    const wet = !Number.isNaN(lvl[a]) || !Number.isNaN(lvl[b]) || !Number.isNaN(lvl[c]) || !Number.isNaN(lvl[d]);
    if (!wet || map[a] < 0 || map[b] < 0 || map[c] < 0 || map[d] < 0) continue;
    idx.push(map[a], map[c], map[b], map[b], map[c], map[d]);
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export type { Ground };
