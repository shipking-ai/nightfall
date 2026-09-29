import * as THREE from 'three';
import type { Body } from '../../entities/Humanoid';
import { bindPose, type BindAngles } from './bind';
import { B, headCentre, shoes as sdfShoes, extras as sdfExtras, type HumanSpec, type Joints, type MatKind, type Fabric } from './anatomy';
import { mesh } from './nets';
import type { BuiltPart } from './build';
import type { V3 } from './sdf';

/**
 * RPG people from MakeHuman's human (bundled assets, CC0 1.0 —
 * http://www.makehumancommunity.org). tools/mh/convert.py packs the base mesh,
 * its morph targets and skeleton weights into public/rpg/mh; here a person's
 * spec becomes target weights (sex, age, muscle, weight, ancestry, and the
 * details of a face), the mesh is morphed, and then retargeted onto the game's
 * own rig in its bind pose, so the same animation drives it as everyone else.
 *
 * The base mesh's helpers become the rest of them: the tights are cut into
 * shirts and trousers, the skirt helper hangs a coat's skirt, the hair helper
 * is a head of hair, the lash helpers are lashes, and the eye proxy is fitted
 * into the sockets.
 */

export interface MHData {
  meta: {
    nv: number;
    nr: number;
    qt: number;
    groups: string[];
    targets: string[];
    layout: Record<string, { offset: number; count: number }>;
    joints: Record<string, number[]>;
    eyeScales: Record<string, [number, number, number]>;
  };
  buf: ArrayBuffer;
}

let loading: Promise<MHData> | null = null;
export function loadMH(base = ''): Promise<MHData> {
  if (!loading)
    loading = Promise.all([fetch(`${base}/rpg/mh/mh.json`).then((r) => r.json()), fetch(`${base}/rpg/mh/mh.bin`).then((r) => r.arrayBuffer())]).then(([meta, buf]) => ({ meta, buf }));
  return loading;
}

const f32 = (d: MHData, k: string) => {
  const l = d.meta.layout[k];
  return new Float32Array(d.buf, l.offset, l.count);
};
const u32 = (d: MHData, k: string) => {
  const l = d.meta.layout[k];
  return new Uint32Array(d.buf, l.offset, l.count);
};

/** Weights for every target, from a person's spec. */
function targetWeights(d: MHData, s: HumanSpec): Map<string, number> {
  const w = new Map<string, number>();
  const g = s.sex;
  const gw: Record<string, number> = { female: 1 - g, male: g };
  // 0 = a young adult (25) … 1 = old (about 80)
  const a = 0.5 + s.age * 0.42;
  const aw: Record<string, number> = { young: 1 - (a - 0.5) / 0.5, old: (a - 0.5) / 0.5 };
  const three = (v: number): Record<string, number> => (v < 0.5 ? { min: 1 - v * 2, average: v * 2, max: 0 } : { min: 0, average: 2 - v * 2, max: v * 2 - 1 });
  const mw = three(Math.min(1, Math.max(0, s.muscle)));
  const ww = three(Math.min(1, Math.max(0, 0.3 + s.fat * 0.62)));
  // ancestry from the skin and the face (the three MakeHuman references blend)
  const c = new THREE.Color(s.skin);
  const lum = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
  const african = THREE.MathUtils.smoothstep(0.52, 0.2, lum);
  const asian = (1 - african) * THREE.MathUtils.clamp((s.cheeks - 0.45) * 1.4, 0, 0.85) * THREE.MathUtils.smoothstep(0.35, 0.6, lum);
  const rw: Record<string, number> = { african, asian, caucasian: Math.max(0, 1 - african - asian) };
  for (const name of d.meta.targets) {
    let m: RegExpMatchArray | null;
    if ((m = name.match(/^race\/(\w+)-(female|male)-(young|old)$/))) w.set(name, rw[m[1]] * gw[m[2]] * aw[m[3]]);
    else if ((m = name.match(/^uni\/(female|male)-(young|old)-(min|average|max)muscle-(min|average|max)weight$/))) w.set(name, gw[m[1]] * aw[m[2]] * mw[m[3]] * ww[m[4]]);
  }
  // the face and body details: a spec value of 0.5 is neutral, either side pushes one way
  const pair = (incr: string, decr: string, v: number, k = 1) => {
    const x = (v - 0.5) * 2 * k;
    if (x > 0) w.set(incr, x);
    else if (x < 0) w.set(decr, -x);
  };
  pair('nose/nose-scale-horiz-incr', 'nose/nose-scale-horiz-decr', s.nose, 0.8);
  pair('nose/nose-scale-vert-incr', 'nose/nose-scale-vert-decr', s.nose, 0.6);
  pair('nose/nose-hump-incr', 'nose/nose-hump-decr', s.noseBridge, 0.9);
  pair('nose/nose-point-width-incr', 'nose/nose-point-width-decr', 1 - s.noseBridge, 0.6);
  pair('mouth/mouth-upperlip-volume-incr', 'mouth/mouth-upperlip-volume-decr', s.lips, 0.8);
  pair('mouth/mouth-lowerlip-volume-incr', 'mouth/mouth-lowerlip-volume-decr', s.lips, 0.8);
  pair('chin/chin-width-incr', 'chin/chin-width-decr', s.jaw, 0.8);
  pair('chin/chin-prominent-incr', 'chin/chin-prominent-decr', s.chin, 0.8);
  pair('cheek/cheek-bones-incr', 'cheek/cheek-bones-decr', s.cheeks, 0.8);
  pair('eyes/eye-scale-incr', 'eyes/eye-scale-decr', s.eyes, 0.6);
  pair('ears/ear-scale-incr', 'ears/ear-scale-decr', s.ears, 0.7);
  pair('head/head-scale-vert-incr', 'head/head-scale-vert-decr', s.faceLong, 0.6);
  pair('eyebrows/eyebrows-trans-forward', 'eyebrows/eyebrows-trans-up', s.brow, 0.4);
  // a face shape, and a few more small differences, from the seed (so no two are alike)
  const r = mulberry(s.seed * 7919 + 13);
  const shapes = ['head/head-oval', 'head/head-round', 'head/head-rectangular', 'head/head-square', 'head/head-triangular', 'head/head-diamond'];
  w.set(shapes[Math.floor(r() * shapes.length)], 0.3 + r() * 0.5);
  if (s.sex > 0.5) w.set('head/head-square', (w.get('head/head-square') ?? 0) + s.jaw * 0.4);
  pair('eyes/eye-bag-incr', 'eyes/eye-bag-decr', 0.5 + s.age * 0.4 + (r() - 0.5) * 0.3);
  pair('mouth/mouth-scale-horiz-incr', 'mouth/mouth-scale-horiz-decr', 0.5 + (r() - 0.5) * 0.6);
  pair('mouth/mouth-angles-up', 'mouth/mouth-angles-down', 0.5 + (r() - 0.5) * 0.5);
  pair('forehead/forehead-scale-vert-incr', 'forehead/forehead-scale-vert-decr', 0.5 + (r() - 0.5) * 0.6);
  pair('eyes/eye-epicanthus-in', 'eyes/eye-epicanthus-out', 0.5 + asian * 0.5);
  pair('cheek/cheek-volume-incr', 'cheek/cheek-volume-decr', 0.35 + s.fat * 0.5);
  pair('neck/neck-double-incr', 'neck/neck-scale-horiz-decr', 0.2 + s.fat * 0.7);
  pair('stomach/stomach-pregnant-incr', 'stomach/stomach-pregnant-decr', 0.4 + s.fat * 0.25);
  pair('torso/torso-muscle-pectoral-incr', 'torso/torso-muscle-pectoral-decr', s.muscle, 0.6);
  pair('torso/torso-vshape-incr', 'torso/torso-vshape-decr', s.shoulders, 0.6);
  pair('hip/hip-scale-horiz-incr', 'hip/hip-scale-horiz-decr', s.hips, 0.6);
  pair('head/head-age-incr', 'head/head-age-decr', 0.5 + s.age * 0.5);
  return w;
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Morph the base mesh: base + Σ weight × target. */
function morph(d: MHData, weights: Map<string, number>): Float32Array {
  const P = new Float32Array(f32(d, 'base'));
  const qt = d.meta.qt;
  for (const [name, wt] of weights) {
    if (!wt || Math.abs(wt) < 1e-3) continue;
    const li = d.meta.layout['ti:' + name], ld = d.meta.layout['td:' + name];
    if (!li) continue;
    const idx = new Uint16Array(d.buf, li.offset, li.count);
    const del = new Int16Array(d.buf, ld.offset, ld.count);
    const k = wt * qt;
    for (let i = 0; i < idx.length; i++) {
      const v = idx[i] * 3;
      P[v] += del[i * 3] * k;
      P[v + 1] += del[i * 3 + 1] * k;
      P[v + 2] += del[i * 3 + 2] * k;
    }
  }
  return P;
}

function jointAt(d: MHData, P: Float32Array, name: string): V3 {
  const ids = d.meta.joints[name];
  let x = 0, y = 0, z = 0;
  for (const i of ids) {
    x += P[i * 3];
    y += P[i * 3 + 1];
    z += P[i * 3 + 2];
  }
  return [x / ids.length, y / ids.length, z / ids.length];
}

const vsub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vlen = (a: V3) => Math.hypot(a[0], a[1], a[2]);

/**
 * A frame for one bone: origin at its head, Y along it, Z as near `fwd` as it
 * can be. Retargeting maps each MakeHuman bone's frame onto the game rig's
 * (with a stretch along the bone for any difference in length).
 */
function frame(head: V3, tail: V3, fwd: V3, stretch = 1): THREE.Matrix4 {
  const y = new THREE.Vector3(...vsub(tail, head)).normalize();
  const z = new THREE.Vector3(...fwd).addScaledVector(y, -new THREE.Vector3(...fwd).dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Matrix4().makeBasis(x, y.multiplyScalar(stretch), z).setPosition(head[0], head[1], head[2]);
}

export interface MHBuilt {
  parts: BuiltPart[];
  body: Body;
  angles: BindAngles;
  eyes: [V3, V3];
  eyeR: number;
  ms: number;
  tris: number;
}

/** A whole person, ready to skin to the game's rig (in its bind pose, at height scale 1). */
export function buildMH(d: MHData, s: HumanSpec): MHBuilt {
  const t0 = performance.now();
  const P = morph(d, targetWeights(d, s));
  const nv = d.meta.nv;
  // ── measure the MakeHuman body, and make the game's rig match it
  let minY = 1e9, maxY = -1e9;
  for (let i = 0; i < 13380; i++) {
    minY = Math.min(minY, P[i * 3 + 1]);
    maxY = Math.max(maxY, P[i * 3 + 1]);
  }
  const RIG_H = 1.716; // the rig's standing height at scale 1
  const height = (maxY - minY) / RIG_H;
  // into the rig's bind space: feet on the floor, height scale 1
  for (let i = 0; i < nv; i++) {
    P[i * 3] /= height;
    P[i * 3 + 1] = (P[i * 3 + 1] - minY) / height;
    P[i * 3 + 2] /= height;
  }
  const mj = (k: string) => jointAt(d, P, k);
  const M = {
    pelvis: mj('pelvis'), neck: mj('neck'), head: mj('head'), headTop: mj('headTop'),
    shL: mj('shL'), elL: mj('elL'), wrL: mj('wrL'), handL: mj('handL'), shR: mj('shR'), elR: mj('elR'), wrR: mj('wrR'), handR: mj('handR'),
    hipL: mj('hipL'), knL: mj('knL'), anL: mj('anL'), toeL: mj('toeL'), hipR: mj('hipR'), knR: mj('knR'), anR: mj('anR'), toeR: mj('toeR'),
  };
  const armLen = (vlen(vsub(M.elR, M.shR)) + vlen(vsub(M.wrR, M.elR))) / 0.53;
  const legLen = (vlen(vsub(M.knR, M.hipR)) + vlen(vsub(M.anR, M.knR))) / 0.85;
  const body: Body = {
    height,
    girth: 1,
    shoulders: Math.abs(M.shR[0]) / 0.186,
    hips: Math.abs(M.hipR[0]) / 0.088,
    head: 1,
    legLen,
    armLen,
    torsoLen: Math.max(0.8, Math.min(1.25, (M.neck[1] - M.pelvis[1] - 0.08) / 0.44)),
  };
  // the bind pose: arms and legs at MakeHuman's own angles
  const ua = vsub(M.elR, M.shR), fa = vsub(M.wrR, M.elR), th = vsub(M.knR, M.hipR);
  const shAb = Math.atan2(Math.abs(ua[0]), -ua[1]);
  const elBend = Math.acos(Math.max(-1, Math.min(1, (ua[0] * fa[0] + ua[1] * fa[1] + ua[2] * fa[2]) / (vlen(ua) * vlen(fa)))));
  const hipAb = Math.atan2(Math.abs(th[0]), -th[1]);
  const bind = bindPose(body, { shAb, elBend, hipAb });
  const j = bind.joints;
  // ── retarget: every MakeHuman bone frame onto the rig's
  const up: V3 = [0, 1, 0], fw: V3 = [0, 0, 1];
  const ourHead = headCentre(j);
  const ourTop: V3 = [ourHead[0], ourHead[1] + 0.118, ourHead[2]];
  const hand = (w: V3, h: Joints['handL']): V3 => [w[0] + h.along[0] * 0.1, w[1] + h.along[1] * 0.1, w[2] + h.along[2] * 0.1];
  const toe = (a: V3): V3 => [a[0], a[1] - 0.05, a[2] + 0.15];
  const pairs: [V3, V3, V3, V3, V3][] = [
    // our head, our tail, their head, their tail, the forward hint
    [j.pelvis, j.neck, M.pelvis, M.neck, fw], // pelvis
    [j.pelvis, j.neck, M.pelvis, M.neck, fw], // spine
    [j.pelvis, j.neck, M.pelvis, M.neck, fw], // chest
    [j.neck, ourTop, M.neck, M.headTop, fw], // neck + head
    [j.shL, j.elL, M.shL, M.elL, fw],
    [j.elL, j.wrL, M.elL, M.wrL, fw],
    [j.wrL, hand(j.wrL, j.handL), M.wrL, M.handL, fw],
    [j.shR, j.elR, M.shR, M.elR, fw],
    [j.elR, j.wrR, M.elR, M.wrR, fw],
    [j.wrR, hand(j.wrR, j.handR), M.wrR, M.handR, fw],
    [j.hipL, j.knL, M.hipL, M.knL, fw],
    [j.knL, j.anL, M.knL, M.anL, fw],
    [j.anL, toe(j.anL), M.anL, M.toeL, up],
    [j.hipR, j.knR, M.hipR, M.knR, fw],
    [j.knR, j.anR, M.knR, M.anR, fw],
    [j.anR, toe(j.anR), M.anR, M.toeR, up],
  ];
  const T = pairs.map(([oh, ot, mh, mt, f]) => {
    const stretch = vlen(vsub(ot, oh)) / Math.max(1e-4, vlen(vsub(mt, mh)));
    const ours = frame(oh, ot, f, 1);
    const theirs = frame(mh, mt, f, 1 / stretch);
    return ours.multiply(theirs.invert()).elements;
  });
  const si = new Uint8Array(d.buf, d.meta.layout.skinIndex.offset, d.meta.layout.skinIndex.count);
  const sw = f32(d, 'skinWeight');
  const Q = new Float32Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    let ox = 0, oy = 0, oz = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw[v * 4 + k];
      if (!w) continue;
      const e = T[si[v * 4 + k]];
      ox += w * (e[0] * x + e[4] * y + e[8] * z + e[12]);
      oy += w * (e[1] * x + e[5] * y + e[9] * z + e[13]);
      oz += w * (e[2] * x + e[6] * y + e[10] * z + e[14]);
    }
    Q[v * 3] = ox;
    Q[v * 3 + 1] = oy;
    Q[v * 3 + 2] = oz;
  }
  // smooth normals per position (so the uv seams don't show)
  const N = new Float32Array(nv * 3);
  const rvPos = u32(d, 'rvPos');
  const uv = f32(d, 'rvUv');
  const tri = (g: string) => u32(d, 'tris:' + g);
  for (const g of ['body', 'helper-tights', 'helper-skirt', 'helper-hair']) {
    const t = tri(g);
    for (let i = 0; i < t.length; i += 3) {
      const a = rvPos[t[i]], b = rvPos[t[i + 1]], c = rvPos[t[i + 2]];
      const ux = Q[b * 3] - Q[a * 3], uy = Q[b * 3 + 1] - Q[a * 3 + 1], uz = Q[b * 3 + 2] - Q[a * 3 + 2];
      const vx = Q[c * 3] - Q[a * 3], vy = Q[c * 3 + 1] - Q[a * 3 + 1], vz = Q[c * 3 + 2] - Q[a * 3 + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const p of [a, b, c]) {
        N[p * 3] += nx;
        N[p * 3 + 1] += ny;
        N[p * 3 + 2] += nz;
      }
    }
  }
  for (let v = 0; v < nv; v++) {
    const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1;
    N[v * 3] /= l;
    N[v * 3 + 1] /= l;
    N[v * 3 + 2] /= l;
  }
  const parts: BuiltPart[] = [];
  let tris = 0;
  /**
   * One part from a group's triangles: `keep(v)` picks the triangles (all three corners),
   * `push` moves vertices out along the normal (cloth over skin).
   */
  const part = (name: string, g: string, mat: MatKind, color: number, fabric: Fabric | undefined, keep: ((p: number) => boolean) | null, push: number | ((p: number) => number) = 0, post?: (pos: number[], idx: number[], nrm: number[], src: number[]) => void) => {
    const t = tri(g);
    const map = new Map<number, number>();
    const pos: number[] = [], nrm: number[] = [], uvs: number[] = [], sI: number[] = [], sW: number[] = [], idx: number[] = [], src: number[] = [];
    for (let i = 0; i < t.length; i += 3) {
      const r0 = t[i], r1 = t[i + 1], r2 = t[i + 2];
      if (keep && !(keep(rvPos[r0]) && keep(rvPos[r1]) && keep(rvPos[r2]))) continue;
      for (const r of [r0, r1, r2]) {
        let o = map.get(r);
        if (o == null) {
          o = pos.length / 3;
          map.set(r, o);
          const p = rvPos[r];
          src.push(p);
          const k = typeof push === 'number' ? push : push(p);
          pos.push(Q[p * 3] + N[p * 3] * k, Q[p * 3 + 1] + N[p * 3 + 1] * k, Q[p * 3 + 2] + N[p * 3 + 2] * k);
          nrm.push(N[p * 3], N[p * 3 + 1], N[p * 3 + 2]);
          uvs.push(uv[r * 2], uv[r * 2 + 1]);
          for (let q = 0; q < 4; q++) {
            sI.push(si[p * 4 + q]);
            sW.push(sw[p * 4 + q]);
          }
        }
        idx.push(o);
      }
    }
    if (!idx.length) return;
    if (post) post(pos, idx, nrm, src);
    tris += idx.length / 3;
    parts.push({
      name, mat, color, fabric,
      position: new Float32Array(pos), normal: new Float32Array(nrm), ao: new Float32Array(pos.length / 3).fill(1),
      index: new Uint32Array(idx), skinIndex: new Uint16Array(sI), skinWeight: new Float32Array(sW), uv: new Float32Array(uvs),
    });
  };
  /**
   * Cloth doesn't follow every hollow of the body: a few rounds of smoothing
   * let it bridge them (under the chest, the small of the back), and a cut
   * edge is pulled level (a hem, a waistband) so it doesn't zigzag.
   */
  const drape = (rounds: number, level?: { below: number; y: number }[]) => (pos: number[], idx: number[], nrm: number[], src: number[]) => {
    // work on the mesh's positions (render vertices split at uv seams share one), then copy back
    const ids = new Map<number, number>();
    const of: number[] = [];
    for (const p of src) {
      if (!ids.has(p)) ids.set(p, ids.size);
      of.push(ids.get(p)!);
    }
    const n = ids.size;
    const X = new Float32Array(n * 3), NN = new Float32Array(n * 3);
    for (let v = 0; v < src.length; v++) for (let k = 0; k < 3; k++) {
      X[of[v] * 3 + k] = pos[v * 3 + k];
      NN[of[v] * 3 + k] = nrm[v * 3 + k];
    }
    const nb: Set<number>[] = Array.from({ length: n }, () => new Set());
    for (let i = 0; i < idx.length; i += 3) for (let k = 0; k < 3; k++) {
      const a = of[idx[i + k]], b = of[idx[i + ((k + 1) % 3)]];
      nb[a].add(b);
      nb[b].add(a);
    }
    const T = new Float32Array(n * 3);
    for (let r = 0; r < rounds; r++) {
      for (let v = 0; v < n; v++) {
        let x = 0, y = 0, z = 0;
        for (const w of nb[v]) {
          x += X[w * 3];
          y += X[w * 3 + 1];
          z += X[w * 3 + 2];
        }
        const c = nb[v].size || 1;
        let dx = (x / c - X[v * 3]) * 0.5, dy = (y / c - X[v * 3 + 1]) * 0.5, dz = (z / c - X[v * 3 + 2]) * 0.5;
        // cloth bridges hollows but never sinks into the body: drop any inward part of the move
        const into = dx * NN[v * 3] + dy * NN[v * 3 + 1] + dz * NN[v * 3 + 2];
        if (into < 0) {
          dx -= into * NN[v * 3];
          dy -= into * NN[v * 3 + 1];
          dz -= into * NN[v * 3 + 2];
        }
        T[v * 3] = X[v * 3] + dx;
        T[v * 3 + 1] = X[v * 3 + 1] + dy;
        T[v * 3 + 2] = X[v * 3 + 2] + dz;
      }
      X.set(T);
    }
    for (let v = 0; v < src.length; v++) for (let k = 0; k < 3; k++) pos[v * 3 + k] = X[of[v] * 3 + k];
    // level the hems: edge vertices (few neighbours) below a line come up to it
    if (level) for (let v = 0; v < src.length; v++) {
      if (nb[of[v]].size >= 6) continue;
      for (const l of level) if (pos[v * 3 + 1] < l.y + 0.03 && pos[v * 3 + 1] > l.below) pos[v * 3 + 1] = Math.max(pos[v * 3 + 1], l.y);
    }
  };

  // where a vertex is, by the bone it mostly follows (for cutting clothes)
  const main = (p: number) => si[p * 4];
  const armBone = (b: number) => b === B.shL || b === B.shR || b === B.elL || b === B.elR || b === B.wrL || b === B.wrR;
  const legBone = (b: number) => b === B.hipL || b === B.hipR || b === B.knL || b === B.knR || b === B.anL || b === B.anR;
  const yOf = (p: number) => Q[p * 3 + 1];
  const pelvisY = j.pelvis[1], ankleY = j.anL[1];
  // ── skin
  const shoeTop = ankleY + (s.shoes.kind === 'boots' ? 0.12 : 0.03);
  part('body', 'body', 'skin', s.skin, undefined, (p) => yOf(p) > shoeTop - 0.06);
  // ── lashes and teeth
  // ── the top: tights from the hips up, sleeves by length
  const t = s.top;
  const long = t.kind !== 'tee' && t.kind !== 'tank' && t.kind !== 'armor';
  const topPush = t.kind === 'coat' || t.kind === 'duster' ? 0.018 : t.kind === 'jacket' || t.kind === 'hoodie' ? 0.013 : t.kind === 'sweater' ? 0.008 : 0.003;
  const topKeep = (p: number) => {
    const b = main(p);
    if (legBone(b)) return false;
    if (b === B.neck) return false;
    if (armBone(b)) {
      if (b === B.wrL || b === B.wrR) return false;
      if (!long) return (b === B.shL || b === B.shR) && (t.kind !== 'tank');
      return true;
    }
    return yOf(p) > pelvisY + (t.kind === 'jacket' || t.kind === 'coat' || t.kind === 'duster' ? -0.02 : 0.03) - 0.015;
  };
  const hemY = pelvisY + (t.kind === 'jacket' || t.kind === 'coat' || t.kind === 'duster' ? -0.02 : 0.03);
  part('top', 'helper-tights', t.fabric === 'leather' ? 'leather' : 'fabric', t.color, t.fabric, topKeep, topPush + 0.004, drape(4, [{ below: hemY - 0.05, y: hemY + 0.006 }]));
  // a coat's skirt, from the skirt helper
  if (t.kind === 'coat' || t.kind === 'duster') {
    const kneeY0 = (j.knL[1] + j.knR[1]) / 2;
    const coatHem = t.kind === 'duster' ? kneeY0 - 0.2 : kneeY0 - 0.03;
    part('coatSkirt', 'helper-skirt', t.fabric === 'leather' ? 'leather' : 'fabric', t.color, t.fabric, (p) => yOf(p) > coatHem - 0.02, topPush, drape(2, [{ below: coatHem - 0.08, y: coatHem }]));
  }
  // ── the bottom: tights from the waist down
  const b = s.bottom;
  const shorts = b.kind === 'shorts';
  const kneeY = (j.knL[1] + j.knR[1]) / 2;
  const botKeep = (p: number) => {
    const bn = main(p);
    const y = yOf(p);
    if (y > pelvisY + 0.13) return false;
    if (armBone(bn) || bn === B.chest || bn === B.neck) return false;
    if (bn === B.anL || bn === B.anR) return false;
    if (shorts && y < kneeY + 0.12) return false;
    return y > ankleY + 0.03;
  };
  if (b.kind === 'skirt') part('skirt', 'helper-skirt', 'fabric', b.color, b.fabric, null, 0.004);
  else part('bottom', 'helper-tights', b.fabric === 'leather' ? 'leather' : 'fabric', b.color, b.fabric, botKeep, (p) => (yOf(p) < pelvisY - 0.05 ? (b.kind === 'jeans' ? 0.004 : b.kind === 'cargo' ? 0.016 : 0.012) : 0.004), drape(3, [{ below: ankleY, y: ankleY + 0.035 }]));
  // ── shoes: sculpted over the rig's ankles (the feet are hidden inside)
  for (const sp of sdfShoes(s, j)) {
    const m = mesh(sp.shape, sp.min, sp.max, sp.cell * 0.9, 0.02);
    const n = m.position.length / 3;
    const sI = new Uint16Array(n * 4), sW = new Float32Array(n * 4);
    const [kn, an] = sp.bones;
    for (let v = 0; v < n; v++) {
      // the shaft follows the shin, the rest the foot
      const up = THREE.MathUtils.clamp((m.position[v * 3 + 1] - (ankleY + 0.02)) / 0.08, 0, 1);
      sI[v * 4] = an;
      sW[v * 4] = 1 - up;
      sI[v * 4 + 1] = kn;
      sW[v * 4 + 1] = up;
    }
    tris += m.index.length / 3;
    parts.push({ name: sp.name, mat: sp.mat, color: sp.color, fabric: sp.fabric, position: m.position, normal: m.normal, ao: m.ao, index: m.index, skinIndex: sI, skinWeight: sW });
  }
  void shoeTop;
  // scarf, belt, backpack, holster: sculpted over the rig's bind joints
  for (const sp of sdfExtras(s, j)) {
    const m = mesh(sp.shape, sp.min, sp.max, sp.cell, 0.02);
    const n = m.position.length / 3;
    const sI = new Uint16Array(n * 4), sW = new Float32Array(n * 4);
    for (let v = 0; v < n; v++) {
      // follow whichever of its bones is nearest in height
      const y = m.position[v * 3 + 1];
      const bs = sp.bones;
      const k = bs.length > 1 && y > j.chest[1] + 0.3 ? 1 : 0;
      sI[v * 4] = bs[k];
      sW[v * 4] = 1;
    }
    tris += m.index.length / 3;
    parts.push({ name: sp.name, mat: sp.mat, color: sp.color, fabric: sp.fabric, position: m.position, normal: m.normal, ao: m.ao, index: m.index, skinIndex: sI, skinWeight: sW });
  }
  // ── hair: grown from the scalp (short cuts), with volume for the longer ones
  if (s.hair !== 'bald') {
    const eyeY = (mj('eyeL')[1] + mj('eyeR')[1]) / 2, eyeZ = (mj('eyeL')[2] + mj('eyeR')[2]) / 2;
    const scalp = (p: number) => {
      if (main(p) !== B.neck) return false;
      const x = Q[p * 3], y = Q[p * 3 + 1], z = Q[p * 3 + 2];
      if (Math.abs(x) > 0.064 && y < eyeY + 0.035 && y > eyeY - 0.055 && z > eyeZ - 0.13) return false; // the ears
      if (y > eyeY + 0.058 + (z > eyeZ - 0.02 ? 0.006 : 0)) return true; // above the hairline
      if (z < eyeZ - 0.085 && y > eyeY - 0.075) return true; // the back of the head, down to the nape
      if (z < eyeZ - 0.045 && y > eyeY + 0.005 && Math.abs(x) > 0.05) return true; // temples, above the ears
      return false;
    };
    const vol = s.hair === 'buzz' ? 0.0022 : s.hair === 'curly' ? 0.02 : s.hair === 'short' ? 0.007 : s.hair === 'swept' ? 0.009 : 0.011;
    // thicker away from the hairline, thinning to nothing at it (so the edge sits into the scalp)
    const depth = (p: number) => {
      const y = Q[p * 3 + 1], z = Q[p * 3 + 2];
      const front = THREE.MathUtils.clamp((y - (eyeY + 0.058)) / 0.03, 0, 1);
      const back = THREE.MathUtils.clamp((eyeZ - 0.06 - z) / 0.04, 0, 1);
      return Math.max(front, back);
    };
    part('hair', 'body', 'hair', s.hairColor, undefined, scalp, (p) => 0.0008 + vol * (0.35 + 0.65 * depth(p)) * (s.hair === 'swept' && Q[p * 3 + 2] > eyeZ - 0.04 ? 1.8 : 1), drape(2));
  }
  // ── the eyes: MakeHuman's proxy, fitted into the sockets
  const fit = f32(d, 'eyeFit');
  const ePos = u32(d, 'eyePos'), eUv = f32(d, 'eyeUv'), eTri = u32(d, 'eyeTris');
  const scales = d.meta.eyeScales;
  // mhclo offsets scale with the distance between two reference vertices (then MakeHuman's decimetres → metres)
  const sc = (k: 'x' | 'y' | 'z') => {
    const [a, bb, den] = scales[k] ?? [0, 0, 1];
    const ax = k === 'x' ? 0 : k === 'y' ? 1 : 2;
    return Math.abs(Q[a * 3 + ax] - Q[bb * 3 + ax]) / (den * 0.1 || 1);
  };
  const sx = sc('x'), sy = sc('y'), sz = sc('z');
  const nE = fit.length / 9;
  const EP = new Float32Array(nE * 3);
  for (let i = 0; i < nE; i++) {
    const [a, bb, c, wa, wb, wc, dx, dy, dz] = fit.subarray(i * 9, i * 9 + 9);
    for (let k = 0; k < 3; k++) EP[i * 3 + k] = Q[a * 3 + k] * wa + Q[bb * 3 + k] * wb + Q[c * 3 + k] * wc;
    EP[i * 3] += dx * 0.1 * sx;
    EP[i * 3 + 1] += dy * 0.1 * sy;
    EP[i * 3 + 2] += dz * 0.1 * sz;
  }
  // two eyes: split by side, each gets its own centre (for the iris)
  const eyes: [V3, V3] = [[0, 0, 0], [0, 0, 0]];
  const cnt = [0, 0];
  for (let i = 0; i < nE; i++) {
    const side = EP[i * 3] < 0 ? 0 : 1;
    eyes[side][0] += EP[i * 3];
    eyes[side][1] += EP[i * 3 + 1];
    eyes[side][2] += EP[i * 3 + 2];
    cnt[side]++;
  }
  for (const k of [0, 1]) for (let c = 0; c < 3; c++) eyes[k][c] /= Math.max(1, cnt[k]);
  let eyeR = 0;
  for (let i = 0; i < nE; i++) {
    const e = eyes[EP[i * 3] < 0 ? 0 : 1];
    eyeR = Math.max(eyeR, Math.hypot(EP[i * 3] - e[0], EP[i * 3 + 1] - e[1], EP[i * 3 + 2] - e[2]));
  }
  {
    const pos: number[] = [], loc: number[] = [], idx: number[] = [];
    for (let r = 0; r < ePos.length; r++) {
      const p = ePos[r];
      const e = eyes[EP[p * 3] < 0 ? 0 : 1];
      pos.push(EP[p * 3], EP[p * 3 + 1], EP[p * 3 + 2]);
      loc.push(EP[p * 3] - e[0], EP[p * 3 + 1] - e[1], EP[p * 3 + 2] - e[2]);
    }
    for (let i = 0; i < eTri.length; i++) idx.push(eTri[i]);
    const n = pos.length / 3;
    const sI = new Uint16Array(n * 4), sW = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      sI[i * 4] = B.neck;
      sW[i * 4] = 1;
    }
    const nrm = new Float32Array(loc.length);
    for (let i = 0; i < n; i++) {
      const l = Math.hypot(loc[i * 3], loc[i * 3 + 1], loc[i * 3 + 2]) || 1;
      nrm[i * 3] = loc[i * 3] / l;
      nrm[i * 3 + 1] = loc[i * 3 + 1] / l;
      nrm[i * 3 + 2] = loc[i * 3 + 2] / l;
    }
    void eUv;
    parts.push({ name: 'eyes', mat: 'eye', color: s.eyeColor, position: new Float32Array(pos), normal: nrm, ao: new Float32Array(n).fill(1), index: new Uint32Array(idx), skinIndex: sI, skinWeight: sW, eyeLocal: new Float32Array(loc) });
    tris += idx.length / 3;
  }
  return { parts, body, angles: { shAb, elBend, hipAb }, eyes, eyeR: eyeR * 0.55, ms: performance.now() - t0, tris };
}
