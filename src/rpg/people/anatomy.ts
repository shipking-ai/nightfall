import { Shape, Op, ellipsoid, cone, sphere, box, plane, torus, noise3, type Prim, type V3 } from './sdf';

/**
 * The RPG's people, sculpted: a head with a skull, cheekbones, a nose, lips,
 * ears and eye sockets; a torso with a ribcage, shoulders, chest and hips; arms
 * and legs with muscle; hands with fingers. Clothes are the same body grown
 * outwards and cut where a garment ends (a cuff, a hem, a collar), so they
 * fit whoever wears them. Everything is placed on the joints of the shared rig
 * in its bind pose, so the same animation drives it.
 *
 * Units are metres for a person of height scale 1 (about 1.72 m); the rig's
 * root scale makes them taller or shorter.
 */

export interface Joints {
  pelvis: V3;
  chest: V3;
  neck: V3;
  shL: V3;
  elL: V3;
  wrL: V3;
  shR: V3;
  elR: V3;
  wrR: V3;
  hipL: V3;
  knL: V3;
  anL: V3;
  hipR: V3;
  knR: V3;
  anR: V3;
  /** hand frames: along the fingers, towards the palm's facing, towards the thumb */
  handL: { along: V3; palm: V3; thumb: V3 };
  handR: { along: V3; palm: V3; thumb: V3 };
  /** head size (the rig's) */
  headScale: number;
}

export type TopKind = 'tee' | 'shirt' | 'sweater' | 'hoodie' | 'jacket' | 'coat' | 'duster' | 'tank' | 'armor';
export type BottomKind = 'trousers' | 'jeans' | 'cargo' | 'shorts' | 'skirt';
export type ShoeKind = 'boots' | 'shoes' | 'sneakers';
export type HairKind = 'bald' | 'buzz' | 'short' | 'swept' | 'curly' | 'bob' | 'long' | 'ponytail' | 'bun' | 'braids';
export type BeardKind = 'none' | 'stubble' | 'moustache' | 'goatee' | 'beard' | 'fullBeard';
export type Fabric = 'cotton' | 'denim' | 'wool' | 'leather' | 'canvas' | 'knit' | 'nylon' | 'silk';

export interface HumanSpec {
  /** 0 female … 1 male */
  sex: number;
  /** 0 young adult … 1 old */
  age: number;
  /** body: 0..1 each, 0.5 = average */
  muscle: number;
  fat: number;
  shoulders: number;
  hips: number;
  bust: number;
  /** face */
  jaw: number;
  cheeks: number;
  nose: number;
  noseBridge: number;
  lips: number;
  brow: number;
  chin: number;
  eyes: number;
  ears: number;
  faceLong: number;
  skin: number;
  eyeColor: number;
  hair: HairKind;
  hairColor: number;
  beard: BeardKind;
  top: { kind: TopKind; color: number; fabric: Fabric; open?: boolean };
  under?: { kind: 'tee' | 'shirt' | 'tank'; color: number } | null;
  bottom: { kind: BottomKind; color: number; fabric: Fabric };
  shoes: { kind: ShoeKind; color: number };
  extras: { scarf?: number; backpack?: number; belt?: number; gloves?: number; holster?: boolean; hood?: boolean; bandolier?: number };
  /** a small random seed for the folds and the skin */
  seed: number;
}

export type MatKind = 'skin' | 'fabric' | 'hair' | 'leather' | 'rubber' | 'metal' | 'lid' | 'eye';

export interface PartSpec {
  name: string;
  shape: Shape;
  min: V3;
  max: V3;
  cell: number;
  mat: MatKind;
  color: number;
  fabric?: Fabric;
  /** bones this part may be skinned to */
  bones: number[];
  /** multipliers on some bones' weights (a coat's skirt follows the pelvis more than the legs) */
  boneBias?: Record<number, number>;
  aoDist?: number;
}

/* ── bones (shared with the runtime) ─────────────────────────────── */

export const BONES = ['pelvis', 'spine', 'chest', 'neck', 'shL', 'elL', 'wrL', 'shR', 'elR', 'wrR', 'hipL', 'knL', 'anL', 'hipR', 'knR', 'anR'] as const;
export const B = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<(typeof BONES)[number], number>;
const TORSO = [B.pelvis, B.spine, B.chest];
const ARM_L = [B.chest, B.shL, B.elL, B.wrL];
const ARM_R = [B.chest, B.shR, B.elR, B.wrR];
const LEG_L = [B.pelvis, B.hipL, B.knL, B.anL];
const LEG_R = [B.pelvis, B.hipR, B.knR, B.anR];

/** Bone segments in bind space (for the skin weights). */
export function boneSegments(j: Joints, headC: V3): [V3, V3][] {
  const up = (p: V3, d: number): V3 => [p[0], p[1] + d, p[2]];
  const toe = (a: V3): V3 => [a[0], a[1] - 0.06, a[2] + 0.17];
  const fing = (w: V3, h: Joints['handL']): V3 => add(w, mul(h.along, 0.1));
  return [
    [up(j.pelvis, -0.06), up(j.pelvis, 0.08)],
    [up(j.pelvis, 0.12), up(j.chest, 0.16)],
    [up(j.chest, 0.2), up(j.neck, -0.03)],
    [up(j.neck, 0.0), up(headC, 0.06)],
    [j.shL, j.elL],
    [j.elL, j.wrL],
    [j.wrL, fing(j.wrL, j.handL)],
    [j.shR, j.elR],
    [j.elR, j.wrR],
    [j.wrR, fing(j.wrR, j.handR)],
    [j.hipL, j.knL],
    [j.knL, j.anL],
    [j.anL, toe(j.anL)],
    [j.hipR, j.knR],
    [j.knR, j.anR],
    [j.anR, toe(j.anR)],
  ];
}

/* ── vector helpers ─────────────────────────────── */

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => mul(a, 1 / (len(a) || 1));
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const L = (a: number, b: number, t: number) => a + (b - a) * t;

/** the centre of the head, from the neck joint */
export function headCentre(j: Joints): V3 {
  return [j.neck[0], j.neck[1] + 0.128 * j.headScale, j.neck[2]];
}

/* ── the body ─────────────────────────────── */

/**
 * The body's volumes. `grow` pushes everything outwards (clothes); `parts`
 * picks which regions to include.
 */
function body(s: HumanSpec, j: Joints, grow: number, parts: { torso?: boolean; neck?: boolean; armL?: number; armR?: number; legs?: number; head?: boolean }): Prim[] {
  const m = s.sex, fat = s.fat, mus = s.muscle;
  const g = grow;
  const P = j.pelvis, C = j.chest, N = j.neck;
  const hipW = L(1.08, 0.94, m) * L(0.9, 1.12, s.hips);
  const shW = L(0.9, 1.1, m) * L(0.92, 1.1, s.shoulders) * (1 + mus * 0.06);
  const waist = L(0.82, 0.94, m) * (1 + fat * 0.35);
  const out: Prim[] = [];
  const k = 0.035;
  if (parts.torso) {
    // pelvis and hips
    out.push(ellipsoid(add(P, [0, -0.03, -0.005]), [0.158 * hipW + g, 0.11 + g, 0.112 + g * 0.8 + fat * 0.012], Op.Union, k));
    // glutes
    for (const sd of [-1, 1]) out.push(ellipsoid(add(P, [sd * 0.062 * hipW, -0.06, -0.058]), [0.074 * hipW + g, 0.085 + g, 0.07 + g], Op.Union, k));
    // waist and belly
    out.push(ellipsoid(add(P, [0, 0.11, 0.005 + fat * 0.02]), [0.13 * waist + g, 0.12 + g, 0.092 + fat * 0.055 + g], Op.Union, k));
    // ribcage
    out.push(ellipsoid(add(C, [0, 0.19, -0.01]), [0.145 * shW + g, 0.19 + g, 0.1 + fat * 0.02 + g], Op.Union, k));
    // chest: pectorals, or breasts
    for (const sd of [-1, 1]) {
      if (m > 0.5) out.push(ellipsoid(add(C, [sd * 0.064 * shW, 0.29, 0.06 + mus * 0.01]), [0.068 * shW + g, 0.05 + g, 0.034 + mus * 0.012 + g], Op.Union, 0.035));
      else {
        const b = 0.4 + s.bust * 0.9;
        out.push(ellipsoid(add(C, [sd * 0.074, 0.238 - b * 0.012, 0.074 + b * 0.012]), [0.056 * b + 0.012 + g, 0.058 * b + 0.01 + g, 0.05 * b + 0.01 + g], Op.Union, 0.04));
      }
    }
    // upper back and the trapezius up to the neck
    out.push(ellipsoid(add(C, [0, 0.3, -0.045]), [0.13 * shW + g, 0.09 + g, 0.066 + g], Op.Union, k));
    for (const sd of [-1, 1]) out.push(cone(add(N, [sd * 0.02, -0.045, -0.028]), add(sd < 0 ? j.shL : j.shR, [-sd * 0.04, 0.012, -0.012]), 0.036 + g + mus * 0.008, 0.032 + g, Op.Union, 0.045));
    // shoulders (deltoids)
    for (const sh of [j.shL, j.shR]) out.push(ellipsoid(add(sh, [Math.sign(sh[0]) * 0.004, -0.022, 0]), [0.044 + mus * 0.008 + g, 0.055 + g, 0.046 + g], Op.Union, 0.035));
  }
  if (parts.neck) {
    out.push(cone(add(C, [0, 0.36, -0.012]), add(N, [0, 0.08 * j.headScale, -0.012]), L(0.052, 0.06, m) + g, L(0.043, 0.05, m) + g, Op.Union, 0.04));
  }
  if (parts.head) {
    const H = headCentre(j);
    out.push(ellipsoid(add(H, [0, 0.01, 0]), [0.078 + g, 0.106 + g, 0.1 + g], Op.Union, 0.03));
  }
  // arms: `armL/R` = how far down (0 shoulder … 1 elbow … 2 wrist … 3 fingertips)
  const arm = (sh: V3, el: V3, wr: V3, reach: number) => {
    if (reach <= 0) return;
    const u = sub(el, sh);
    const fw = norm(cross(cross(u, [0, 0, 1]), u)); // roughly the arm's front
    const tip = reach < 1 ? lerp(sh, el, reach) : el;
    out.push(cone(sh, tip, 0.045 + mus * 0.008 + fat * 0.008 + g, reach < 1 ? 0.042 + g : 0.037 + g, Op.Union, 0.012));
    if (reach >= 0.7) out.push(ellipsoid(add(lerp(sh, el, 0.52), mul(fw, -0.01)), [0.028 + mus * 0.01 + g, 0.065, 0.028 + mus * 0.01 + g], Op.Union, 0.02));
    if (reach > 1) {
      const t2 = Math.min(1, reach - 1);
      out.push(cone(el, lerp(el, wr, t2), 0.038 + mus * 0.005 + g, t2 < 1 ? 0.032 + g : 0.026 + g, Op.Union, 0.025));
      out.push(ellipsoid(lerp(el, wr, 0.28), [0.032 + mus * 0.007 + g, 0.06, 0.03 + g], Op.Union, 0.03));
    }
  };
  arm(j.shL, j.elL, j.wrL, parts.armL ?? 0);
  arm(j.shR, j.elR, j.wrR, parts.armR ?? 0);
  // legs: 0 hip … 1 knee … 2 ankle
  const leg = (hip: V3, kn: V3, an: V3, reach: number, sd: number) => {
    if (reach <= 0) return;
    const top: V3 = add(hip, [sd * 0.008, 0.02, 0]);
    const tip = reach < 1 ? lerp(top, kn, reach) : kn;
    out.push(cone(top, tip, L(0.092, 0.085, m) * (1 + fat * 0.18) * L(1.05, 0.96, m) + g, 0.056 + g, Op.Union, 0.04));
    out.push(ellipsoid(add(lerp(hip, kn, 0.45), [0, 0, 0.022]), [0.06 + mus * 0.012 + g, 0.13, 0.055 + mus * 0.01 + g], Op.Union, 0.04));
    if (reach > 1) {
      const t2 = Math.min(1, reach - 1);
      out.push(sphere(kn, 0.052 + g, Op.Union, 0.03));
      out.push(cone(kn, lerp(kn, an, t2), 0.052 + g, t2 < 1 ? 0.045 + g : 0.034 + g, Op.Union, 0.03));
      // the calf
      out.push(ellipsoid(add(lerp(kn, an, 0.3), [0, 0, -0.025]), [0.044 + mus * 0.008 + g, 0.09, 0.048 + mus * 0.008 + g], Op.Union, 0.035));
    }
  };
  leg(j.hipL, j.knL, j.anL, parts.legs ?? 0, -1);
  leg(j.hipR, j.knR, j.anR, parts.legs ?? 0, 1);
  return out;
}

/* ── the head ─────────────────────────────── */

function head(s: HumanSpec, j: Joints): { shape: Shape; eyes: [V3, V3]; eyeR: number } {
  // Proportions from the real average (metres, centre of the head at mid-height): eyes on the midline,
  // the nose's base a third of the way down the face, the mouth a third of the way from there to the chin.
  const H = headCentre(j);
  const m = s.sex;
  const at = (x: number, y: number, z: number): V3 => [H[0] + x, H[1] + y, H[2] + z];
  const sh = new Shape();
  const long = L(0.97, 1.05, s.faceLong);
  const jawW = L(0.86, 1.12, s.jaw) * L(0.92, 1.04, m);
  const fk = 0.007;
  // skull and face
  sh.add(ellipsoid(at(0, 0.024, -0.016), [0.0735, 0.093, 0.097], Op.Union, 0));
  sh.add(ellipsoid(at(0, -0.03 * long, 0.033), [0.058 * L(0.95, 1.02, m), 0.07 * long, 0.058], Op.Union, 0.03));
  // the forehead, fuller and rounder in women
  sh.add(ellipsoid(at(0, 0.045, 0.045), [0.058, 0.045, 0.046 + (1 - m) * 0.004], Op.Union, 0.03));
  // cheekbones
  const ck = L(0.8, 1.2, s.cheeks);
  for (const sd of [-1, 1]) sh.add(ellipsoid(at(sd * 0.05, -0.006, 0.055), [0.02 * ck, 0.012, 0.02], Op.Union, 0.02));
  // the jawline, from below the ear to the chin
  for (const sd of [-1, 1]) sh.add(cone(at(sd * 0.047 * jawW, -0.068 * long, -0.006), at(sd * 0.012, -0.105 * long, 0.07), L(0.011, 0.014, m), 0.012, Op.Union, 0.02));
  const chin = L(0.85, 1.2, s.chin);
  sh.add(ellipsoid(at(0, -0.102 * long, 0.074), [0.017 * chin * L(0.9, 1.12, m), 0.014, 0.015 * chin], Op.Union, 0.015));
  // brow ridge (heavier in men), and the soft hollow under it
  const brow = L(0.6, 1.1, m) * L(0.75, 1.3, s.brow);
  for (const sd of [-1, 1]) sh.add(ellipsoid(at(sd * 0.03, 0.031, 0.083), [0.022, 0.0075 * brow, 0.0095 * brow], Op.Union, 0.012));
  // the eyes sit back in their sockets, behind lids
  const eyeR = 0.0118 * L(0.95, 1.06, s.eyes);
  const eyes: [V3, V3] = [at(-0.0315, 0.006, 0.07), at(0.0315, 0.006, 0.07)];
  for (const e of eyes) sh.add(ellipsoid(add(e, [0, 0.004, 0.022]), [0.019, 0.012, 0.011], Op.Sub, 0.012));
  for (const e of eyes) {
    // lids: skin over the eyeball, opened in an almond
    sh.add(sphere(e, eyeR + 0.0017, Op.Union, 0.005));
    sh.add(ellipsoid(add(e, [0, -0.0005, eyeR + 0.001]), [0.013 * L(0.95, 1.08, s.eyes), 0.0049 * L(0.9, 1.15, s.eyes), 0.0075], Op.Sub, 0.0015));
  }
  // nose: a narrow bridge, the tip, the wings, and the nostrils
  const nz = L(0.88, 1.15, s.nose), nb = L(0.8, 1.25, s.noseBridge);
  sh.add(cone(at(0, 0.016, 0.089), at(0, -0.02 * long, 0.113 + 0.005 * nz), 0.0052 * nb, 0.0078 * nz, Op.Union, fk));
  sh.add(ellipsoid(at(0, -0.027 * long, 0.113 + 0.005 * nz), [0.0092 * nz, 0.0082 * nz, 0.0085 * nz], Op.Union, fk));
  for (const sd of [-1, 1]) sh.add(ellipsoid(at(sd * 0.0112 * nz, -0.031 * long, 0.104), [0.0062 * nz, 0.0062 * nz, 0.0072], Op.Union, 0.006));
  for (const sd of [-1, 1]) sh.add(ellipsoid(at(sd * 0.0062, -0.0365 * long, 0.108), [0.0033, 0.0022, 0.004], Op.Sub, 0.002));
  // mouth: the lips, the line between, the groove above
  const lp = L(0.82, 1.2, s.lips) * L(1.08, 0.92, m);
  sh.add(ellipsoid(at(0, -0.053 * long, 0.1), [0.02, 0.0062 * lp, 0.0088], Op.Union, 0.007));
  sh.add(ellipsoid(at(0, -0.065 * long, 0.0975), [0.0178, 0.0072 * lp, 0.0092], Op.Union, 0.007));
  sh.add(ellipsoid(at(0, -0.0592 * long, 0.106), [0.0205, 0.0011, 0.0075], Op.Sub, 0.0015));
  sh.add(ellipsoid(at(0, -0.045 * long, 0.103), [0.0035, 0.0055, 0.0025], Op.Sub, 0.003));
  // ears
  const er = L(0.9, 1.12, s.ears);
  for (const sd of [-1, 1]) {
    sh.add(ellipsoid(at(sd * 0.073, 0.0, -0.006), [0.0085, 0.03 * er, 0.019 * er], Op.Union, 0.007));
    sh.add(ellipsoid(at(sd * 0.0805, 0.002, -0.004), [0.0045, 0.02 * er, 0.012 * er], Op.Sub, 0.004));
  }
  // the neck, down under the collar; the Adam's apple
  sh.add(cone(at(0, -0.058, -0.022), [j.neck[0], j.neck[1] - 0.05, j.neck[2] - 0.012], L(0.045, 0.053, m), L(0.05, 0.058, m), Op.Union, 0.03));
  if (m > 0.5) sh.add(ellipsoid([j.neck[0], j.neck[1] + 0.035, j.neck[2] + 0.04], [0.009, 0.013, 0.008], Op.Union, 0.012));
  sh.add(plane([0, j.neck[1] - 0.045, 0], [0, -1, 0], Op.Inter, 0.004));
  if (s.age > 0.5) sh.detail = (x, y, z) => (noise3(x * 90, y * 90, z * 90) - 0.5) * 0.0012 * (s.age - 0.5);
  return { shape: sh, eyes, eyeR };
}

/* ── hands ─────────────────────────────── */

function hand(s: HumanSpec, w: V3, f: Joints['handL'], grow: number): Shape {
  const sh = new Shape();
  const sz = L(0.93, 1.06, s.sex);
  const A = f.along, T = f.thumb, Pm = f.palm;
  const S = norm(cross(A, Pm)); // across the knuckles
  const side = Math.sign(S[0] * T[0] + S[1] * T[1] + S[2] * T[2]) || 1; // which way the thumb is across the knuckles
  const pt = (u: number, v: number, n: number): V3 => add(w, add(mul(A, u * sz), add(mul(S, v * sz * side), mul(Pm, n * sz))));
  // the wrist and the palm
  sh.add(cone(pt(-0.03, 0, 0), pt(0.02, 0, 0), 0.028 + grow, 0.032 + grow, Op.Union, 0.015));
  sh.add(ellipsoid(pt(0.05, 0, -0.002), [0.02 + grow, 0.022 + grow, 0.012 + grow], Op.Union, 0.02));
  sh.add(box(pt(0.052, 0, 0), [0.04 + grow, 0.041 + grow, 0.013 + grow], 0.012, Op.Union, 0.015));
  // four fingers, curled a little
  const fingers: [number, number, number][] = [[0.026, 0.07, 0.0082], [0.0088, 0.078, 0.0086], [-0.0088, 0.073, 0.0082], [-0.025, 0.058, 0.0074]];
  fingers.forEach(([v, l, r], i) => {
    const curl = 0.18 + i * 0.05;
    let p0 = pt(0.09, v, 0);
    let dir = add(mul(A, Math.cos(curl * 0.4)), mul(Pm, Math.sin(curl * 0.4)));
    for (let seg = 0; seg < 3; seg++) {
      const segL = l * [0.42, 0.32, 0.26][seg] * sz;
      const p1 = add(p0, mul(norm(dir), segL));
      sh.add(cone(p0, p1, r + grow, (r - 0.0006 * (seg + 1)) + grow, Op.Union, 0.004));
      p0 = p1;
      dir = add(mul(norm(dir), Math.cos(curl)), mul(Pm, Math.sin(curl)));
    }
  });
  // the thumb, from the base of the palm, out and forward
  const tb = pt(0.02, 0.03, 0.006);
  const tm = add(tb, add(mul(A, 0.03 * sz), add(mul(S, 0.02 * sz * side), mul(Pm, 0.012 * sz))));
  const tt = add(tm, add(mul(A, 0.028 * sz), add(mul(S, 0.004 * sz * side), mul(Pm, 0.016 * sz))));
  sh.add(cone(tb, tm, 0.013 + grow, 0.0098 + grow, Op.Union, 0.012));
  sh.add(cone(tm, tt, 0.0098 + grow, 0.0088 + grow, Op.Union, 0.004));
  return sh;
}

/* ── clothes ─────────────────────────────── */

function fabricDetail(fabric: Fabric, seed: number, amp = 1) {
  const sc = fabric === 'knit' ? 160 : fabric === 'leather' ? 50 : 40;
  const a = (fabric === 'leather' ? 0.0012 : fabric === 'knit' ? 0.0008 : 0.0015) * amp;
  return (x: number, y: number, z: number) => {
    // soft, uneven drape: long low folds and a little crumple
    const drape = noise3(x * 14 + seed, y * 5, z * 14) - 0.5;
    const crumple = noise3(x * sc, y * sc * 0.6, z * sc) - 0.5;
    return (drape * 2 + crumple) * a;
  };
}

function top(s: HumanSpec, j: Joints): PartSpec[] {
  const t = s.top;
  const out: PartSpec[] = [];
  const thick = t.kind === 'coat' || t.kind === 'duster' ? 0.014 : t.kind === 'jacket' || t.kind === 'hoodie' ? 0.011 : t.kind === 'sweater' ? 0.008 : t.kind === 'armor' ? 0.022 : 0.004;
  const sleeve = t.kind === 'tee' ? 0.45 : t.kind === 'tank' ? 0 : t.kind === 'armor' ? 0.3 : 1.95;
  const sh = new Shape();
  sh.add(...body(s, j, thick, { torso: true, neck: t.kind !== 'tank' && t.kind !== 'tee', armL: sleeve, armR: sleeve }));
  const P = j.pelvis;
  let hem = P[1] - 0.08;
  if (t.kind === 'jacket') hem = P[1] - 0.14;
  if (t.kind === 'tee' || t.kind === 'tank' || t.kind === 'sweater' || t.kind === 'shirt') hem = P[1] - 0.1;
  if (t.kind === 'armor') hem = P[1] + 0.06;
  // coats: a skirt round both legs, flaring to the knee (and past it for a duster)
  if (t.kind === 'coat' || t.kind === 'duster') {
    const kneeY = (j.knL[1] + j.knR[1]) / 2;
    const bottom = t.kind === 'duster' ? kneeY - 0.22 : kneeY - 0.02;
    sh.add(cone(add(P, [0, 0.02, -0.01]), [P[0], bottom, P[2] - 0.02], 0.2 + thick, 0.235 + thick, Op.Union, 0.06));
    hem = bottom + 0.002;
  }
  sh.add(plane([0, hem, 0], [0, -1, 0], Op.Inter, 0.006));
  // the neckline: round for a tee, a collar standing up round the neck for coats and jackets
  const N = j.neck;
  if (t.kind === 'tee' || t.kind === 'tank' || t.kind === 'sweater' || t.kind === 'armor') sh.add(ellipsoid([N[0], N[1] - 0.02, N[2] + 0.03], [0.07, 0.05, 0.06], Op.Sub, 0.01));
  else sh.add(cone([N[0], N[1] - 0.06, N[2]], [N[0], N[1] + 0.2, N[2]], 0.054, 0.054, Op.Sub, 0.006));
  if (t.kind === 'coat' || t.kind === 'duster' || t.kind === 'jacket') {
    // a turned-up collar
    sh.add(cone([N[0], N[1] - 0.05, N[2] - 0.005], [N[0], N[1] + 0.035, N[2] - 0.01], 0.075, 0.07, Op.Union, 0.02));
    sh.add(cone([N[0], N[1] - 0.07, N[2]], [N[0], N[1] + 0.2, N[2]], 0.056, 0.06, Op.Sub, 0.004));
    // open front: a V down the chest
    if (t.open !== false) sh.add(box([N[0], N[1] - 0.2, N[2] + 0.2], [0.025, 0.16, 0.08], 0.02, Op.Sub, 0.02));
  }
  // cuffs: cut the sleeves square across the forearm
  if (sleeve > 1.5) {
    for (const [el, wr] of [[j.elL, j.wrL], [j.elR, j.wrR]] as [V3, V3][]) {
      // a big sphere just past the cuff takes the rest of the sleeve away (locally: nothing else is that close)
      const d = norm(sub(wr, el));
      const c = add(wr, mul(d, -0.02));
      sh.add(sphere(add(c, mul(d, 0.2)), 0.2, Op.Sub, 0.004));
    }
  }
  if (t.kind === 'hoodie' || s.extras.hood) {
    // the hood, down on the back of the neck
    sh.add(torus([N[0], N[1] + 0.01, N[2] - 0.05], 0.07, 0.03, Op.Union, 0.03));
  }
  sh.detail = fabricDetail(t.fabric, s.seed, t.kind === 'armor' ? 0.4 : 1);
  const b = sh.bounds(0.03);
  const coatSkirt = t.kind === 'coat' || t.kind === 'duster';
  out.push({ name: 'top', shape: sh, min: b.min, max: b.max, cell: 0.0135, mat: t.fabric === 'leather' ? 'leather' : 'fabric', color: t.color, fabric: t.fabric, bones: [...TORSO, B.neck, ...ARM_L.slice(1), ...ARM_R.slice(1), ...(coatSkirt ? [B.hipL, B.hipR] : [])], boneBias: coatSkirt ? { [B.pelvis]: 2.5 } : undefined });
  // armour: plates over a plate carrier
  if (t.kind === 'armor') {
    const pl = new Shape();
    const C = j.chest;
    pl.add(box(add(C, [0, 0.2, 0.1]), [0.13, 0.15, 0.025], 0.02, Op.Union, 0.01));
    pl.add(box(add(C, [0, 0.2, -0.12]), [0.13, 0.15, 0.025], 0.02, Op.Union, 0.01));
    for (let i = 0; i < 3; i++) pl.add(box(add(C, [-0.07 + i * 0.07, 0.07, 0.135]), [0.028, 0.045, 0.02], 0.008, Op.Union, 0.004));
    const bb = pl.bounds(0.02);
    out.push({ name: 'plates', shape: pl, min: bb.min, max: bb.max, cell: 0.009, mat: 'fabric', color: 0x3a3d33, fabric: 'nylon', bones: [B.spine, B.chest] });
  }
  return out;
}

function bottom(s: HumanSpec, j: Joints): PartSpec {
  const b = s.bottom;
  const P = j.pelvis;
  const sh = new Shape();
  const thick = b.kind === 'jeans' ? 0.004 : b.kind === 'cargo' ? 0.01 : 0.007;
  if (b.kind === 'skirt') {
    sh.add(...body(s, j, 0.008, { torso: true, legs: 0.2 }));
    const kneeY = (j.knL[1] + j.knR[1]) / 2;
    sh.add(cone(add(P, [0, 0.06, 0]), [P[0], kneeY + 0.02, P[2]], 0.17, 0.22, Op.Union, 0.05));
    sh.add(plane([0, kneeY + 0.02, 0], [0, -1, 0], Op.Inter, 0.004));
  } else {
    sh.add(...body(s, j, thick, { torso: true, legs: b.kind === 'shorts' ? 0.55 : 2 }));
    if (b.kind === 'trousers' || b.kind === 'cargo') for (const [hp, kn, an] of [[j.hipL, j.knL, j.anL], [j.hipR, j.knR, j.anR]] as [V3, V3, V3][]) {
      // cloth hangs straight from the thigh past the knee; it doesn't cling to the calf
      sh.add(cone(lerp(hp, kn, 0.4), kn, 0.075, 0.064, Op.Union, 0.03), cone(kn, add(an, [0, 0.02, 0]), 0.062, 0.056, Op.Union, 0.03));
    }
    if (b.kind === 'cargo') for (const hp of [j.hipL, j.hipR]) sh.add(box(add(lerp(hp, hp === j.hipL ? j.knL : j.knR, 0.5), [Math.sign(hp[0]) * 0.07, 0, 0]), [0.02, 0.05, 0.04], 0.01, Op.Union, 0.012));
    // hems at the ankles, turned a little
    if (b.kind !== 'shorts') sh.add(plane([0, Math.min(j.anL[1], j.anR[1]) + 0.025, 0], [0, -1, 0], Op.Inter, 0.004));
  }
  // the waistband, and nothing above it
  sh.add(plane([0, P[1] + 0.12, 0], [0, 1, 0], Op.Inter, 0.006));
  sh.detail = fabricDetail(b.fabric, s.seed + 3);
  const bb = sh.bounds(0.03);
  return { name: 'bottom', shape: sh, min: bb.min, max: bb.max, cell: 0.013, mat: b.fabric === 'leather' ? 'leather' : 'fabric', color: b.color, fabric: b.fabric, bones: [B.pelvis, B.spine, ...LEG_L.slice(1), ...LEG_R.slice(1)] };
}

export function shoes(s: HumanSpec, j: Joints): PartSpec[] {
  const out: PartSpec[] = [];
  for (const [an, kn, name, bones] of [[j.anL, j.knL, 'shoeL', [B.knL, B.anL]], [j.anR, j.knR, 'shoeR', [B.knR, B.anR]]] as [V3, V3, string, number[]][]) {
    const sh = new Shape();
    const k = s.shoes.kind;
    const y0 = an[1] - 0.08;
    const len = L(0.24, 0.27, s.sex);
    // sole, toe box, heel counter, and a shaft up the shin for boots
    sh.add(box([an[0], y0 + 0.012, an[2] + len * 0.28], [0.046, 0.012, len / 2], 0.01, Op.Union, 0.004));
    sh.add(ellipsoid([an[0], y0 + 0.042, an[2] + len * 0.52], [0.043, 0.032, 0.07], Op.Union, 0.02));
    sh.add(ellipsoid([an[0], y0 + 0.05, an[2] + len * 0.2], [0.046, 0.045, 0.1], Op.Union, 0.025));
    sh.add(ellipsoid([an[0], y0 + 0.05, an[2] - 0.05], [0.04, 0.05, 0.045], Op.Union, 0.02));
    if (k === 'boots') sh.add(cone([an[0], y0 + 0.05, an[2] - 0.01], lerp(an, kn, 0.42), 0.052, 0.05, Op.Union, 0.03));
    else sh.add(cone([an[0], y0 + 0.05, an[2] - 0.01], lerp(an, kn, 0.13), 0.047, 0.04, Op.Union, 0.02));
    sh.detail = k === 'sneakers' ? null : fabricDetail('leather', s.seed + 7, 0.6);
    const bb = sh.bounds(0.02);
    out.push({ name, shape: sh, min: bb.min, max: bb.max, cell: 0.0095, mat: k === 'sneakers' ? 'fabric' : 'leather', color: s.shoes.color, fabric: k === 'sneakers' ? 'canvas' : 'leather', bones });
  }
  return out;
}

function hair(s: HumanSpec, j: Joints): PartSpec[] {
  const out: PartSpec[] = [];
  const H = headCentre(j);
  const at = (x: number, y: number, z: number): V3 => [H[0] + x, H[1] + y, H[2] + z];
  const k = s.hair;
  const cut = (sh: Shape) => {
    // the hairline: an arc over the forehead, receding at the temples; sideburns in front of the ears; down to the nape
    sh.add(ellipsoid(at(0, -0.03, 0.092), [0.06, 0.1 - (1 - s.sex) * 0.004 + s.age * 0.012, 0.07], Op.Sub, 0.01));
    if (k !== 'long' && k !== 'bob' && k !== 'braids') sh.add(plane(at(0, -0.035, 0), norm([0, -1, 0.42]), Op.Inter, 0.012));
    for (const sd of [-1, 1]) sh.add(ellipsoid(at(sd * 0.078, -0.012, 0.0), [0.018, 0.03, 0.026], Op.Sub, 0.008));
  };
  if (k !== 'bald') {
    const sh = new Shape();
    const vol = k === 'buzz' ? 0.0025 : k === 'curly' ? 0.02 : k === 'short' ? 0.007 : 0.011;
    // the skull and forehead, grown by the hair's volume (so it sits on this head, whatever its shape)
    sh.add(ellipsoid(at(0, 0.024, -0.016), [0.0735 + vol, 0.093 + vol, 0.097 + vol], Op.Union, 0));
    sh.add(ellipsoid(at(0, 0.045, 0.045), [0.058 + vol, 0.045 + vol, 0.046 + (1 - s.sex) * 0.004 + vol], Op.Union, 0.03));
    if (k === 'swept') sh.add(ellipsoid(at(0, 0.09, 0.045), [0.05, 0.028, 0.045], Op.Union, 0.03));
    if (k === 'long' || k === 'braids') sh.add(ellipsoid(at(0, -0.1, -0.075), [0.085, 0.16, 0.05], Op.Union, 0.05), cone(at(-0.07, -0.02, 0.0), at(-0.075, -0.16, -0.02), 0.022, 0.016, Op.Union, 0.03), cone(at(0.07, -0.02, 0.0), at(0.075, -0.16, -0.02), 0.022, 0.016, Op.Union, 0.03));
    if (k === 'bob') sh.add(ellipsoid(at(0, -0.035, -0.02), [0.09, 0.075, 0.1], Op.Union, 0.04));
    if (k === 'ponytail') sh.add(sphere(at(0, 0.02, -0.105), 0.025, Op.Union, 0.02), cone(at(0, 0.01, -0.12), at(0, -0.16, -0.14), 0.024, 0.014, Op.Union, 0.03));
    if (k === 'bun') sh.add(sphere(at(0, 0.06, -0.1), 0.038, Op.Union, 0.025));
    cut(sh);
    const seed = s.seed;
    sh.detail = k === 'curly' ? (x, y, z) => (noise3(x * 140 + seed, y * 140, z * 140) - 0.5) * 0.012 : (x, y, z) => (noise3(x * 30 + seed, y * 220, z * 30) - 0.5) * 0.0025;
    const bb = sh.bounds(0.02);
    out.push({ name: 'hair', shape: sh, min: bb.min, max: bb.max, cell: 0.0058, mat: 'hair', color: s.hairColor, bones: [B.neck, ...(k === 'long' || k === 'braids' ? [B.chest] : [])], aoDist: 0.015 });
  }
  // brows
  const bw = new Shape();
  for (const sd of [-1, 1]) {
    const t = L(0.75, 1.25, s.brow) * L(0.8, 1.1, s.sex);
    bw.add(ellipsoid(at(sd * 0.022, 0.0342, 0.0905), [0.009, 0.0024 * t, 0.0035], Op.Union, 0.004), ellipsoid(at(sd * 0.036, 0.0352, 0.0875), [0.011, 0.002 * t, 0.0035], Op.Union, 0.004), ellipsoid(at(sd * 0.049, 0.0318, 0.079), [0.007, 0.0016 * t, 0.0035], Op.Union, 0.004));
  }
  const bb2 = bw.bounds(0.01);
  out.push({ name: 'brows', shape: bw, min: bb2.min, max: bb2.max, cell: 0.0025, mat: 'hair', color: s.hairColor, bones: [B.neck] });
  // facial hair
  if (s.beard !== 'none' && s.beard !== 'stubble') {
    const bd = new Shape();
    if (s.beard === 'moustache' || s.beard === 'goatee' || s.beard === 'fullBeard') bd.add(ellipsoid(at(0, -0.048, 0.108), [0.024, 0.006, 0.01], Op.Union, 0.006));
    if (s.beard === 'goatee') bd.add(ellipsoid(at(0, -0.09, 0.083), [0.02, 0.022, 0.018], Op.Union, 0.01));
    if (s.beard === 'beard' || s.beard === 'fullBeard') {
      const long = s.beard === 'fullBeard' ? 1.35 : 1;
      bd.add(ellipsoid(at(0, -0.06, 0.035), [0.07, 0.07 * long, 0.075], Op.Union, 0.02));
      bd.add(ellipsoid(at(0, -0.04, 0.02), [0.066, 0.065, 0.1], Op.Sub, 0.02));
      bd.add(ellipsoid(at(0, -0.06, 0.1), [0.022, 0.013, 0.02], Op.Sub, 0.006));
      bd.add(plane(at(0, -0.018, 0), [0, 1, 0], Op.Inter, 0.01));
    }
    bd.detail = (x, y, z) => (noise3(x * 300, y * 300, z * 300) - 0.5) * 0.002;
    const bb3 = bd.bounds(0.02);
    out.push({ name: 'beard', shape: bd, min: bb3.min, max: bb3.max, cell: 0.0035, mat: 'hair', color: s.hairColor, bones: [B.neck] });
  }
  return out;
}

export function extras(s: HumanSpec, j: Joints): PartSpec[] {
  const out: PartSpec[] = [];
  const C = j.chest, N = j.neck, P = j.pelvis;
  const e = s.extras;
  if (e.scarf != null) {
    const sh = new Shape();
    sh.add(torus([N[0], N[1] - 0.035, N[2] + 0.005], 0.07, 0.025, Op.Union, 0.02), cone([N[0] + 0.035, N[1] - 0.05, N[2] + 0.07], [C[0] + 0.05, C[1] + 0.12, C[2] + 0.12], 0.024, 0.02, Op.Union, 0.03));
    sh.detail = fabricDetail('knit', s.seed + 11);
    const b = sh.bounds(0.02);
    out.push({ name: 'scarf', shape: sh, min: b.min, max: b.max, cell: 0.008, mat: 'fabric', color: e.scarf, fabric: 'knit', bones: [B.chest, B.neck] });
  }
  if (e.backpack != null) {
    const sh = new Shape();
    sh.add(box(add(C, [0, 0.18, -0.19]), [0.13, 0.19, 0.07], 0.04, Op.Union, 0.02), box(add(C, [0, 0.06, -0.26]), [0.1, 0.07, 0.03], 0.02, Op.Union, 0.02));
    for (const sd of [-1, 1]) sh.add(cone(add(C, [sd * 0.08, 0.34, -0.12]), add(C, [sd * 0.09, 0.4, 0.06]), 0.018, 0.018, Op.Union, 0.01), cone(add(C, [sd * 0.09, 0.4, 0.06]), add(C, [sd * 0.1, 0.08, 0.12]), 0.016, 0.016, Op.Union, 0.01));
    sh.detail = fabricDetail('canvas', s.seed + 13, 0.8);
    const b = sh.bounds(0.02);
    out.push({ name: 'backpack', shape: sh, min: b.min, max: b.max, cell: 0.01, mat: 'fabric', color: e.backpack, fabric: 'canvas', bones: [B.chest, B.spine] });
  }
  if (e.belt != null) {
    const sh = new Shape();
    const hipW = L(1.08, 0.94, s.sex) * L(0.9, 1.12, s.hips);
    sh.add(torus([P[0], P[1] + 0.09, P[2] + 0.004], 0.132 * hipW + 0.004, 0.012, Op.Union, 0.005), box(add(P, [0, 0.09, 0.118]), [0.024, 0.017, 0.008], 0.004, Op.Union, 0.003));
    if (e.holster) sh.add(box(add(P, [0.17, 0.0, 0.02]), [0.022, 0.08, 0.045], 0.012, Op.Union, 0.01));
    const b = sh.bounds(0.02);
    out.push({ name: 'belt', shape: sh, min: b.min, max: b.max, cell: 0.007, mat: 'leather', color: e.belt, fabric: 'leather', bones: [B.pelvis, B.spine] });
  }
  if (e.bandolier != null) {
    const sh = new Shape();
    sh.add(cone(add(j.shL, [0.03, 0.02, 0.08]), add(P, [0.13, 0.1, 0.1]), 0.022, 0.022, Op.Union, 0.01), cone(add(j.shL, [0.03, 0.02, -0.1]), add(P, [0.13, 0.1, -0.1]), 0.022, 0.022, Op.Union, 0.01));
    const b = sh.bounds(0.02);
    out.push({ name: 'bandolier', shape: sh, min: b.min, max: b.max, cell: 0.008, mat: 'leather', color: e.bandolier, fabric: 'leather', bones: [B.chest, B.spine] });
  }
  return out;
}

/** Every part to be meshed for one person. `lo` = the far version (coarser, no small detail). */
/** Detail levels: 0 the player (close-ups), 1 people near you, 2 people further off. */
export const LOD_CELL = [1, 1.7, 3.4];

export function partsFor(s: HumanSpec, j: Joints, lod: number): { parts: PartSpec[]; eyes: [V3, V3]; eyeR: number } {
  const parts: PartSpec[] = [];
  const hd = head(s, j);
  const hb = hd.shape.bounds(0.01);
  parts.push({ name: 'head', shape: hd.shape, min: hb.min, max: hb.max, cell: 0.0042, mat: 'skin', color: s.skin, bones: [B.chest, B.neck], aoDist: 0.012 });
  // bare skin wherever the clothes stop: hands always, arms and legs for short sleeves and shorts
  for (const [w, f, name, bones] of [[j.wrL, j.handL, 'handL', [B.elL, B.wrL]], [j.wrR, j.handR, 'handR', [B.elR, B.wrR]]] as [V3, Joints['handL'], string, number[]][]) {
    const gl = s.extras.gloves != null;
    const sh = hand(s, w, f, gl ? 0.003 : 0);
    const b = sh.bounds(0.01);
    parts.push({ name, shape: sh, min: b.min, max: b.max, cell: 0.0048, mat: gl ? 'leather' : 'skin', color: gl ? s.extras.gloves! : s.skin, fabric: 'leather', bones, aoDist: 0.01 });
  }
  const sleeve = s.top.kind === 'tee' ? 0.45 : s.top.kind === 'tank' ? 0 : s.top.kind === 'armor' ? 0.3 : 2;
  if (sleeve < 1.9) {
    const sh = new Shape();
    sh.add(...body(s, j, 0, { armL: 2, armR: 2 }));
    const b = sh.bounds(0.02);
    parts.push({ name: 'arms', shape: sh, min: b.min, max: b.max, cell: 0.009, mat: 'skin', color: s.skin, bones: [B.chest, ...ARM_L.slice(1), ...ARM_R.slice(1)] });
  }
  if (s.top.kind === 'tank' || s.top.kind === 'tee' || s.top.kind === 'armor') {
    // the neck and upper chest under a low neckline
    const sh = new Shape();
    sh.add(...body(s, j, 0, { torso: true, neck: true }));
    sh.add(plane([0, j.chest[1] + 0.16, 0], [0, -1, 0], Op.Inter, 0.01));
    const b = sh.bounds(0.02);
    parts.push({ name: 'chestSkin', shape: sh, min: b.min, max: b.max, cell: 0.009, mat: 'skin', color: s.skin, bones: [B.spine, B.chest, B.neck, B.shL, B.shR] });
  }
  if (s.bottom.kind === 'shorts' || s.bottom.kind === 'skirt') {
    const sh = new Shape();
    sh.add(...body(s, j, 0, { legs: 2 }));
    sh.add(plane([0, j.pelvis[1] - 0.1, 0], [0, 1, 0], Op.Inter, 0.01));
    const b = sh.bounds(0.02);
    parts.push({ name: 'legs', shape: sh, min: b.min, max: b.max, cell: 0.01, mat: 'skin', color: s.skin, bones: [B.pelvis, ...LEG_L.slice(1), ...LEG_R.slice(1)] });
  }
  parts.push(...top(s, j), bottom(s, j), ...shoes(s, j), ...hair(s, j), ...extras(s, j));
  const k = LOD_CELL[lod] ?? 1;
  for (const p of parts) {
    p.cell *= k;
    if (lod >= 2) p.shape.detail = null;
  }
  return { parts: lod >= 2 ? parts.filter((p) => p.name !== 'brows') : parts, eyes: hd.eyes, eyeR: hd.eyeR };
}
