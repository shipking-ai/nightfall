import { Shape, cone, ellipsoid, sphere, noise3, type V3 } from '../people/sdf';
import { mesh } from '../people/nets';

/**
 * The animals of the wider world, sculpted the same way as the people: in
 * signed distance fields, meshed smooth, coloured by where on the body a
 * point is (dark back, pale belly, a white tail, black stockings on a fox).
 * Each animal is a few rigid parts on pivots (body, head and neck, tail, the
 * upper and lower half of each leg) so it can walk, graze, look up, run and
 * fall. Plain numbers only: this runs in a worker.
 *
 * Frame: the animal faces +z, y is up, the origin is the ground under the
 * middle of its body.
 */

export type SpeciesId = 'deer' | 'elk' | 'boar' | 'wolf' | 'coyote' | 'fox' | 'bear' | 'rabbit' | 'hare' | 'crow' | 'gull';

export interface Species {
  id: SpeciesId;
  name: string;
  /** hip-to-shoulder distance */
  len: number;
  /** torso half-width and half-height */
  rx: number;
  ry: number;
  /** torso centre height */
  cy: number;
  /** leg joint heights (top of the leg) and the leg's thickness */
  legTop: number;
  legR: number;
  /** half the distance between left and right legs */
  legX: number;
  neck: { len: number; up: number; r: number };
  head: { len: number; r: number; snout: number; ears: 'point' | 'round' | 'long'; earLen: number; antlers?: 'deer' | 'elk'; tusks?: boolean };
  tail: { len: number; r: number; bushy: boolean };
  hump?: number;
  col: { back: number; belly: number; legs?: number; face?: number; tip?: number; under?: number };
  gait: 'quad' | 'hop' | 'fly';
  health: number;
  walk: number;
  run: number;
  /** prey runs; predators may come for you */
  kind: 'prey' | 'predator' | 'bird';
  /** how far away it notices you (walking, in daylight) */
  notice: number;
  yield: [string, number][];
}

export const SPECIES: Record<SpeciesId, Species> = {
  deer: {
    id: 'deer', name: 'White-tailed deer', len: 0.74, rx: 0.15, ry: 0.21, cy: 0.75, legTop: 0.76, legR: 0.03, legX: 0.09,
    neck: { len: 0.42, up: 0.95, r: 0.075 }, head: { len: 0.26, r: 0.075, snout: 0.05, ears: 'point', earLen: 0.14, antlers: 'deer' }, tail: { len: 0.16, r: 0.045, bushy: false },
    col: { back: 0x6a5238, belly: 0xd4c6ae, legs: 0x5e4630, face: 0x54402c, under: 0xf0eadc }, gait: 'quad', health: 60, walk: 1.2, run: 11, kind: 'prey', notice: 55, yield: [['meat', 2], ['hide', 1]],
  },
  elk: {
    id: 'elk', name: 'Elk', len: 1.08, rx: 0.22, ry: 0.31, cy: 1.14, legTop: 1.14, legR: 0.046, legX: 0.13,
    neck: { len: 0.6, up: 0.8, r: 0.12 }, head: { len: 0.4, r: 0.1, snout: 0.07, ears: 'point', earLen: 0.18, antlers: 'elk' }, tail: { len: 0.12, r: 0.05, bushy: false }, hump: 0.06,
    col: { back: 0x9a7a52, belly: 0x5a4028, legs: 0x3e2c1c, face: 0x4a3422, under: 0xd8c098 }, gait: 'quad', health: 120, walk: 1.3, run: 10, kind: 'prey', notice: 60, yield: [['meat', 3], ['hide', 1]],
  },
  boar: {
    id: 'boar', name: 'Wild boar', len: 0.6, rx: 0.2, ry: 0.25, cy: 0.55, legTop: 0.44, legR: 0.045, legX: 0.1,
    neck: { len: 0.16, up: 0.1, r: 0.17 }, head: { len: 0.38, r: 0.12, snout: 0.07, ears: 'point', earLen: 0.08, tusks: true }, tail: { len: 0.2, r: 0.02, bushy: false }, hump: 0.08,
    col: { back: 0x2e2620, belly: 0x4a3e32, legs: 0x221c18, face: 0x3a3028 }, gait: 'quad', health: 95, walk: 1.0, run: 7.5, kind: 'predator', notice: 35, yield: [['meat', 2], ['hide', 1]],
  },
  wolf: {
    id: 'wolf', name: 'Grey wolf', len: 0.6, rx: 0.12, ry: 0.17, cy: 0.62, legTop: 0.6, legR: 0.03, legX: 0.07,
    neck: { len: 0.24, up: 0.45, r: 0.09 }, head: { len: 0.26, r: 0.085, snout: 0.045, ears: 'point', earLen: 0.09 }, tail: { len: 0.44, r: 0.055, bushy: true },
    col: { back: 0x55524c, belly: 0xc8c2b6, legs: 0x8c877e, face: 0x9c968c, tip: 0x2a2826 }, gait: 'quad', health: 70, walk: 1.4, run: 11, kind: 'predator', notice: 70, yield: [['hide', 1]],
  },
  coyote: {
    id: 'coyote', name: 'Coyote', len: 0.48, rx: 0.09, ry: 0.135, cy: 0.47, legTop: 0.46, legR: 0.024, legX: 0.055,
    neck: { len: 0.2, up: 0.45, r: 0.07 }, head: { len: 0.21, r: 0.065, snout: 0.035, ears: 'point', earLen: 0.09 }, tail: { len: 0.34, r: 0.045, bushy: true },
    col: { back: 0x8a6c4c, belly: 0xd8c8aa, legs: 0xa88a64, face: 0xb89a74, tip: 0x2a2420 }, gait: 'quad', health: 45, walk: 1.3, run: 12, kind: 'predator', notice: 60, yield: [['hide', 1]],
  },
  fox: {
    id: 'fox', name: 'Red fox', len: 0.34, rx: 0.07, ry: 0.09, cy: 0.29, legTop: 0.28, legR: 0.016, legX: 0.04,
    neck: { len: 0.14, up: 0.5, r: 0.05 }, head: { len: 0.15, r: 0.05, snout: 0.022, ears: 'point', earLen: 0.07 }, tail: { len: 0.36, r: 0.05, bushy: true },
    col: { back: 0xb05a1c, belly: 0xf0e6d6, legs: 0x1c1612, face: 0xc0661e, tip: 0xf4efe6 }, gait: 'quad', health: 22, walk: 1.2, run: 9, kind: 'prey', notice: 45, yield: [['hide', 1]],
  },
  bear: {
    id: 'bear', name: 'Brown bear', len: 0.86, rx: 0.33, ry: 0.37, cy: 0.7, legTop: 0.66, legR: 0.09, legX: 0.18,
    neck: { len: 0.24, up: 0.25, r: 0.2 }, head: { len: 0.36, r: 0.17, snout: 0.075, ears: 'round', earLen: 0.07 }, tail: { len: 0.06, r: 0.04, bushy: false }, hump: 0.12,
    col: { back: 0x3a281a, belly: 0x2e2016, legs: 0x241810, face: 0x4a3422 }, gait: 'quad', health: 240, walk: 1.1, run: 9, kind: 'predator', notice: 40, yield: [['meat', 3], ['hide', 2]],
  },
  rabbit: {
    id: 'rabbit', name: 'Rabbit', len: 0.13, rx: 0.065, ry: 0.075, cy: 0.14, legTop: 0.1, legR: 0.018, legX: 0.04,
    neck: { len: 0.05, up: 0.6, r: 0.04 }, head: { len: 0.08, r: 0.042, snout: 0.02, ears: 'long', earLen: 0.1 }, tail: { len: 0.03, r: 0.025, bushy: true },
    col: { back: 0x7c6a54, belly: 0xd8ccb8, face: 0x8a7860, tip: 0xf2ede4 }, gait: 'hop', health: 8, walk: 0.8, run: 8, kind: 'prey', notice: 22, yield: [['meat', 1]],
  },
  hare: {
    id: 'hare', name: 'Hare', len: 0.18, rx: 0.075, ry: 0.085, cy: 0.19, legTop: 0.14, legR: 0.02, legX: 0.045,
    neck: { len: 0.06, up: 0.6, r: 0.045 }, head: { len: 0.1, r: 0.045, snout: 0.022, ears: 'long', earLen: 0.14 }, tail: { len: 0.04, r: 0.025, bushy: true },
    col: { back: 0x8e7a5c, belly: 0xe0d4c0, face: 0x98845e, tip: 0xf2ede4 }, gait: 'hop', health: 10, walk: 0.9, run: 11, kind: 'prey', notice: 30, yield: [['meat', 1]],
  },
  crow: {
    id: 'crow', name: 'Crow', len: 0.1, rx: 0.06, ry: 0.06, cy: 0, legTop: 0, legR: 0.01, legX: 0.02,
    neck: { len: 0.04, up: 0.2, r: 0.04 }, head: { len: 0.07, r: 0.038, snout: 0.012, ears: 'round', earLen: 0 }, tail: { len: 0.14, r: 0.035, bushy: false },
    col: { back: 0x14161a, belly: 0x1c1e22 }, gait: 'fly', health: 4, walk: 0.6, run: 11, kind: 'bird', notice: 30, yield: [],
  },
  gull: {
    id: 'gull', name: 'Gull', len: 0.12, rx: 0.07, ry: 0.07, cy: 0, legTop: 0, legR: 0.01, legX: 0.02,
    neck: { len: 0.05, up: 0.2, r: 0.045 }, head: { len: 0.08, r: 0.042, snout: 0.014, ears: 'round', earLen: 0 }, tail: { len: 0.12, r: 0.035, bushy: false },
    col: { back: 0x9aa0a6, belly: 0xf2f2ee, face: 0xf4f4f0, tip: 0x1a1a1a }, gait: 'fly', health: 4, walk: 0.6, run: 12, kind: 'bird', notice: 30, yield: [],
  },
};

export interface AnimalPart {
  name: 'body' | 'head' | 'tail' | 'legFU' | 'legFL' | 'legBU' | 'legBL' | 'wing';
  /** the joint it turns about, in the animal's frame */
  pivot: V3;
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  index: Uint32Array;
}

export interface AnimalBuild {
  id: SpeciesId;
  male: boolean;
  parts: AnimalPart[];
  /** joints for the legs (front and back; left/right mirror in x) */
  hipF: V3;
  hipB: V3;
  kneeF: V3;
  kneeB: V3;
}

function rgb(c: number): V3 {
  const f = (v: number) => Math.pow(v / 255, 2.2);
  return [f((c >> 16) & 255), f((c >> 8) & 255), f(c & 255)];
}

/** Sculpt one animal: its parts as meshes about their pivots. */
export function buildAnimal(id: SpeciesId, male: boolean): AnimalBuild {
  const s = SPECIES[id];
  const cell = Math.max(0.006, Math.min(0.03, s.len * 0.028));
  const hz = s.len / 2; // shoulders at +hz, hips at −hz
  const fly = s.gait === 'fly';
  // joints
  const hipF: V3 = [0, s.legTop, hz * 0.92];
  const hipB: V3 = [0, s.legTop, -hz * 0.92];
  const kneeF: V3 = [0, s.legTop * 0.44, hz * 0.92 + s.legTop * 0.02];
  // the hind leg's hock sits well behind the hip
  const kneeB: V3 = [0, s.legTop * 0.4, -hz * 0.92 - s.legTop * 0.2];
  const neckBase: V3 = [0, s.cy + s.ry * 0.45, hz + s.rx * 0.3];

  const parts: AnimalPart[] = [];
  const colourer = (p: V3, n: V3): V3 => shade(s, p, n, male);

  // body: torso (two blended ellipsoids, chest and rump), a hump, the root of the neck
  const body = new Shape();
  body.add(
    ellipsoid([0, s.cy, hz * 0.35], [s.rx, s.ry, hz * 0.95 + s.rx * 0.4], 0, 0.06 * s.len + 0.01),
    ellipsoid([0, s.cy + s.ry * 0.05, -hz * 0.55], [s.rx * 0.96, s.ry * 0.92, hz * 0.75], 0, 0.06 * s.len + 0.01),
  );
  if (s.hump) body.add(ellipsoid([0, s.cy + s.ry * 0.55, hz * 0.55], [s.rx * 0.8, s.ry * 0.5 + s.hump, hz * 0.5], 0, 0.05));
  if (!fly) {
    // a deep chest in front, the belly tucked up behind it
    body.add(ellipsoid([0, s.cy - s.ry * 0.25, hz * 0.75], [s.rx * 0.85, s.ry * 0.85, s.rx * 1.1], 0, 0.05));
    // the tops of the legs fill out into shoulders and haunches
    for (const x of [-s.legX, s.legX]) {
      body.add(ellipsoid([x * 1.05, s.cy - s.ry * 0.35, hz * 0.9], [s.rx * 0.42, s.ry * 0.95, s.rx * 0.62], 0, 0.05));
      body.add(ellipsoid([x * 1.05, s.cy - s.ry * 0.3, -hz * 0.86], [s.rx * 0.5, s.ry * 1.05, s.rx * 0.82], 0, 0.05));
    }
  }
  body.detail = (x, y, z) => noise3(x * 40, y * 40, z * 40) * 0.0025 * (s.len > 0.3 ? 1 : 0.3);
  parts.push(part('body', [0, 0, 0], body, cell, colourer));

  // head and neck, turning at the base of the neck
  const head = new Shape();
  const up = s.neck.up;
  const nTop: V3 = [0, neckBase[1] + Math.sin(up) * s.neck.len, neckBase[2] + Math.cos(up) * s.neck.len];
  head.add(cone(neckBase, nTop, s.neck.r, s.neck.r * 0.8, 0, 0.03));
  const hc: V3 = [0, nTop[1] + s.head.r * 0.2, nTop[2] + s.head.len * 0.3];
  head.add(ellipsoid(hc, [s.head.r * 0.95, s.head.r, s.head.len * 0.45], 0, 0.03));
  // muzzle
  const tip: V3 = [0, hc[1] - s.head.r * 0.35, hc[2] + s.head.len * 0.55];
  head.add(cone([0, hc[1] - s.head.r * 0.1, hc[2] + s.head.len * 0.1], tip, s.head.r * 0.72, s.head.snout, 0, 0.03));
  if (s.head.tusks) for (const x of [-1, 1]) head.add(cone([x * s.head.r * 0.5, tip[1] - 0.01, tip[2] - 0.05], [x * s.head.r * 0.8, tip[1] + 0.05, tip[2] - 0.02], 0.012, 0.004, 0, 0.005));
  // eyes (small bulges, darkened by the colourer)
  for (const x of [-1, 1]) head.add(sphere([x * s.head.r * 0.78, hc[1] + s.head.r * 0.25, hc[2] + s.head.len * 0.12], s.head.r * 0.16, 0, 0.004));
  // ears
  if (s.head.earLen > 0) for (const x of [-1, 1]) {
    const base: V3 = [x * s.head.r * 0.55, hc[1] + s.head.r * 0.75, hc[2] - s.head.len * 0.12];
    if (s.head.ears === 'round') head.add(ellipsoid([base[0] * 1.1, base[1] + s.head.earLen * 0.3, base[2]], [s.head.earLen * 0.55, s.head.earLen * 0.5, s.head.earLen * 0.25], 0, 0.02));
    else {
      const lean = s.head.ears === 'long' ? 0.25 : 0.55;
      const e2: V3 = [base[0] + x * s.head.earLen * lean, base[1] + s.head.earLen, base[2] - s.head.earLen * 0.2];
      head.add(cone(base, e2, s.head.earLen * (s.head.ears === 'long' ? 0.2 : 0.3), s.head.earLen * 0.06, 0, 0.012));
    }
  }
  // antlers: a main beam curving back and up, tines off it
  if (s.head.antlers && male) {
    const big = s.head.antlers === 'elk';
    const k = big ? 1.5 : 1;
    for (const x of [-1, 1]) {
      // the main beam: out, back, then sweeping forward (a deer's) or up and back (an elk's)
      const pts: V3[] = [[x * s.head.r * 0.45, hc[1] + s.head.r * 0.85, hc[2] - s.head.len * 0.08]];
      const path = big ? [[0.05, 0.12, -0.08], [0.06, 0.14, -0.1], [0.04, 0.14, -0.06], [0.02, 0.12, 0.0], [0.0, 0.1, 0.04]] : [[0.05, 0.07, -0.05], [0.06, 0.05, 0.0], [0.03, 0.03, 0.06], [0.0, 0.02, 0.08]];
      for (const [dx, dy, dz] of path) {
        const q = pts[pts.length - 1];
        pts.push([q[0] + x * dx * k, q[1] + dy * k, q[2] + dz * k]);
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const r = (big ? 0.028 : 0.02) * (1 - i / pts.length * 0.55);
        head.add(cone(pts[i], pts[i + 1], r, r * 0.85, 0, 0.006));
        // tines rise off the beam
        if (i > 0) head.add(cone(pts[i], [pts[i][0] + x * 0.01, pts[i][1] + (big ? 0.16 : 0.09), pts[i][2] + 0.02], r * 0.7, 0.003, 0, 0.005));
      }
    }
  }
  parts.push(part('head', neckBase, head, cell * 0.8, colourer));

  // tail, hanging (or streaming) from the rump
  const rump: V3 = [0, s.cy + s.ry * (fly ? 0 : 0.55), -hz - s.rx * 0.45];
  const tail = new Shape();
  const tEnd: V3 = fly ? [0, rump[1], rump[2] - s.tail.len] : [0, rump[1] - s.tail.len * 0.75, rump[2] - s.tail.len * 0.6];
  if (s.tail.bushy) tail.add(ellipsoid([(rump[0] + tEnd[0]) / 2, (rump[1] + tEnd[1]) / 2, (rump[2] + tEnd[2]) / 2], [s.tail.r, s.tail.r, s.tail.len * 0.55], 0, 0.02));
  else tail.add(cone(rump, tEnd, s.tail.r, s.tail.r * (fly ? 1.2 : 0.5), 0, 0.02));
  if (fly) tail.add(ellipsoid([0, rump[1], rump[2] - s.tail.len * 0.6], [s.rx * 0.9, 0.006, s.tail.len * 0.5], 0, 0.01));
  parts.push(part('tail', rump, tail, cell * 0.8, colourer));

  if (fly) {
    // one wing (the other is its mirror), pivoting at the shoulder
    const wing = new Shape();
    const span = s.len * 3.2;
    wing.add(ellipsoid([s.rx * 0.6 + span * 0.5, s.cy, hz * 0.2], [span * 0.5, 0.008, s.len * 0.55], 0, 0.02));
    parts.push(part('wing', [s.rx * 0.6, s.cy, hz * 0.2], wing, cell * 0.7, colourer));
  } else {
    // legs: an upper (thigh/upper arm) and a lower (shin/cannon and hoof or paw), front and back
    const foot = s.gait === 'hop' ? 1.8 : 1;
    const leg = (name: 'legFU' | 'legFL' | 'legBU' | 'legBL', a: V3, b: V3, r1: number, r2: number, hoof: boolean) => {
      const sh = new Shape();
      sh.add(cone(a, b, r1, r2, 0, 0.02));
      if (hoof) sh.add(ellipsoid([0, s.legR * 0.8, b[2] + s.legR * 0.8 * foot], [s.legR * 1.1, s.legR * 0.8, s.legR * 1.5 * foot], 0, 0.01));
      parts.push(part(name, a, sh, cell * 0.7, colourer));
    };
    leg('legFU', [0, hipF[1] - s.ry * 0.3, hipF[2]], kneeF, Math.max(s.legR * 1.9, s.rx * 0.36), s.legR * 1.2, false);
    leg('legFL', kneeF, [0, s.legR * 0.8, kneeF[2] + 0.01], s.legR * 1.15, s.legR * 0.8, true);
    leg('legBU', [0, hipB[1] - s.ry * 0.3, hipB[2]], kneeB, Math.max(s.legR * 2.3, s.rx * 0.46), s.legR * 1.1, false);
    leg('legBL', kneeB, [0, s.legR * 0.8, hipB[2] - s.legTop * 0.04], s.legR * 1.1, s.legR * 0.8, true);
  }
  return { id, male, parts, hipF, hipB, kneeF, kneeB };
}

function part(name: AnimalPart['name'], pivot: V3, sh: Shape, cell: number, col: (p: V3, n: V3) => V3): AnimalPart {
  const b = sh.bounds(cell * 3);
  const m = mesh(sh, b.min, b.max, cell, cell * 2);
  const vc = m.position.length / 3;
  const color = new Float32Array(vc * 3);
  for (let v = 0; v < vc; v++) {
    const p: V3 = [m.position[v * 3], m.position[v * 3 + 1], m.position[v * 3 + 2]];
    const c = col(p, [m.normal[v * 3], m.normal[v * 3 + 1], m.normal[v * 3 + 2]]);
    const ao = m.ao[v];
    color[v * 3] = c[0] * ao;
    color[v * 3 + 1] = c[1] * ao;
    color[v * 3 + 2] = c[2] * ao;
    // positions about the pivot
    m.position[v * 3] -= pivot[0];
    m.position[v * 3 + 1] -= pivot[1];
    m.position[v * 3 + 2] -= pivot[2];
  }
  return { name, pivot, position: m.position, normal: m.normal, color, index: m.index };
}

/** Coat colour by where on the body: back, belly, legs, face, tail tip, markings, a little variation. */
function shade(s: Species, p: V3, n: V3, male: boolean): V3 {
  const back = rgb(s.col.back), belly = rgb(s.col.belly);
  const legs = rgb(s.col.legs ?? s.col.back), face = rgb(s.col.face ?? s.col.back);
  const hz = s.len / 2;
  // up-facing is back, down-facing is belly (with a soft line along the flank)
  const t = Math.max(0, Math.min(1, 0.5 - n[1] * 0.9 + (s.cy - p[1]) / (s.ry * 3)));
  let c: V3 = mix(back, belly, smooth(0.45, 0.75, t));
  // legs below the body
  if (s.gait !== 'fly') {
    const below = s.cy - s.ry * 0.9;
    if (p[1] < below) c = mix(c, s.col.legs ? legs : mix(back, belly, 0.3), smooth(below, below - s.legTop * 0.2, p[1]));
    if (p[1] < s.legR * 1.9 && s.gait === 'quad') c = mix(c, [0.02, 0.018, 0.016], s.id === 'bear' || s.kind === 'predator' ? 0.4 : 0.85);
  }
  // the head
  if (p[2] > hz + s.rx * 0.5) c = mix(c, face, 0.6);
  // a white rump and tail underside (deer), a pale tail tip (fox), dark tail tip (wolf)
  if (s.col.under && p[2] < -hz && n[1] < 0.2 && p[1] > s.legTop * 0.8) c = mix(c, rgb(s.col.under), 0.8);
  if (s.col.tip && p[2] < -hz - s.tail.len * 0.5) c = mix(c, rgb(s.col.tip), 0.85);
  // eyes and nose: near-black
  const eye = Math.abs(Math.abs(p[0]) - s.head.r * 0.78) < s.head.r * 0.18 && p[2] > hz + s.neck.len * 0.3 && s.gait !== 'fly';
  if (eye && p[1] > s.cy) c = mix(c, [0.01, 0.008, 0.006], 0.85);
  // bulls are darker about the neck
  if (male && s.id === 'elk' && p[2] > hz * 0.5) c = mix(c, rgb(0x3a281a), 0.5);
  // fur variation
  const v = 0.9 + noise3(p[0] * 30, p[1] * 30, p[2] * 30) * 0.18;
  return [c[0] * v, c[1] * v, c[2] * v];
}

function mix(a: V3, b: V3, t: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function smooth(a: number, b: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
