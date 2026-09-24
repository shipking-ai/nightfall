import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Humanoid — the people of NIGHTFALL.
 *
 * A small articulated rig (pelvis → spine → neck → head, shoulders → upper arm
 * → forearm → hand, hips → thigh → shin → foot) solved procedurally every frame,
 * rendered from a shared library of part geometries. Nothing here allocates per
 * frame, and nothing here knows whether it is drawn instanced (Crowd) or as
 * plain meshes (Player).
 *
 * Units: metres, feet on the origin, facing +z. A body of height 1 is ~1.76 m.
 */

/* ─────────────────────────── geometry library ─────────────────────────── */

function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let count = 0;
  for (const g of parts) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}

const lathe = (profile: [number, number][], seg = 14, depth = 0.7) => {
  // LatheGeometry faces outward only when the profile runs bottom → top
  const pts = profile[0][1] > profile[profile.length - 1][1] ? [...profile].reverse() : profile;
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  // LatheGeometry already has seam-aware normals; scale() transforms them correctly.
  // (Recomputing here would split the seam into a visible hard edge.)
  g.scale(1, 1, depth);
  return g;
};

/**
 * A limb segment hanging from its joint (origin) down to -len, shaped by a
 * radius profile (fractions along the length → radius) so thighs taper and
 * calves swell instead of reading as tubes. Ends are rounded so joints blend.
 */
const limb = (profile: [number, number][], len: number, depth = 0.9, seg = 12) => {
  const pts: [number, number][] = profile.map(([f, r]) => [r, -f * len]);
  const top = pts[0][0], bot = pts[pts.length - 1][0];
  const body = lathe([[0, top * 0.55], [top * 0.8, top * 0.45], ...pts, [bot * 0.75, -len - bot * 0.5], [0, -len - bot * 0.62]], seg, depth);
  body.rotateY(Math.PI);
  return body;
};

function sculptHead(detail: boolean): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.1, detail ? 24 : 12, detail ? 18 : 9);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    y *= 1.16;
    // jaw narrows towards the chin, the back of the skull stays full
    if (y < 0) {
      const k = Math.min(1, -y / 0.116);
      x *= 1 - 0.28 * k;
      if (z > 0) z *= 1 - 0.12 * k;
    }
    if (z < 0) z *= 1.08;
    // flatter face plane, a soft brow
    if (z > 0.06) z = 0.06 + (z - 0.06) * 0.6;
    if (z > 0.05 && y > 0.018 && y < 0.04) z += 0.006;
    p.setXYZ(i, x * 0.92, y, z);
  }
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const welded = mergeVertices(g, 1e-5); // smooth across the sphere seam
  welded.computeVertexNormals();
  g.copy(welded);
  if (!detail) return g.translate(0, 0.135, 0);
  const nose = new THREE.ConeGeometry(0.014, 0.045, 5).rotateX(Math.PI * 0.62).translate(0, 0.0, 0.074);
  const earL = new THREE.SphereGeometry(0.024, 8, 6).scale(0.45, 1.25, 0.9).translate(-0.088, 0.008, -0.005);
  const earR = earL.clone().translate(0.176, 0, 0);
  const lips = new THREE.BoxGeometry(0.036, 0.008, 0.012).translate(0, -0.046, 0.066);
  return merge([g, nose, earL, earR, lips]).translate(0, 0.135, 0);
}

const eyes = (() => {
  const l = new THREE.SphereGeometry(0.011, 8, 6).scale(1.2, 0.8, 0.6).translate(-0.031, 0.157, 0.078);
  const r = l.clone().translate(0.062, 0, 0);
  const browL = new THREE.BoxGeometry(0.03, 0.006, 0.01).rotateZ(0.08).translate(-0.031, 0.176, 0.081);
  const browR = new THREE.BoxGeometry(0.03, 0.006, 0.01).rotateZ(-0.08).translate(0.031, 0.176, 0.081);
  return merge([l, r, browL, browR]);
})();

const hairCap = (r: number, open = 0.56) =>
  // tilted back: the hairline sits high on the forehead, the back covers the nape
  new THREE.SphereGeometry(r, 18, 10, 0, Math.PI * 2, 0, Math.PI * open).scale(0.95, 1.1, 1.06).rotateX(-0.42);

const HAIR = {
  short: merge([hairCap(0.106, 0.5).translate(0, 0.148, -0.006)]),
  swept: merge([hairCap(0.109, 0.52).translate(0, 0.152, -0.006), new THREE.SphereGeometry(0.06, 10, 6).scale(1.5, 0.45, 1).rotateX(-0.25).translate(0.02, 0.248, 0.03)]),
  long: merge([
    hairCap(0.11, 0.56).translate(0, 0.148, -0.01),
    lathe([[0.0, 0.0], [0.09, 0.0], [0.1, -0.1], [0.085, -0.2], [0.0, -0.2]], 12, 0.6).translate(0, 0.15, -0.03),
  ]),
  bun: merge([hairCap(0.107, 0.5).translate(0, 0.148, -0.006), new THREE.SphereGeometry(0.04, 10, 8).translate(0, 0.21, -0.08)]),
  beanie: merge([hairCap(0.114, 0.52).translate(0, 0.152, -0.004), new THREE.TorusGeometry(0.1, 0.014, 6, 18).rotateX(Math.PI / 2).translate(0, 0.16, -0.004)]),
  cap: merge([
    hairCap(0.111, 0.48).translate(0, 0.155, 0),
    new THREE.CylinderGeometry(0.075, 0.075, 0.008, 14, 1, false, -Math.PI / 2, Math.PI).scale(1, 1, 1.1).translate(0, 0.19, 0.06),
  ]),
  hood: merge([
    new THREE.SphereGeometry(0.135, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62).scale(0.95, 1.08, 1.05).rotateX(-0.25).translate(0, 0.14, -0.018),
  ]),
};
export type HairStyle = keyof typeof HAIR | 'none';

export const PARTS = {
  pelvis: lathe([[0.0, -0.1], [0.1, -0.1], [0.138, -0.04], [0.14, 0.04], [0.132, 0.1], [0.0, 0.1]], 14, 0.7),
  torso: merge([
    lathe([[0.0, 0.0], [0.138, 0.0], [0.142, 0.1], [0.165, 0.22], [0.186, 0.31], [0.19, 0.36], [0.165, 0.415], [0.07, 0.448], [0.0, 0.448]], 18, 0.66),
    // deltoids and a trapezius slope into the neck
    new THREE.SphereGeometry(0.06, 12, 8).scale(1.1, 0.85, 1).translate(-0.168, 0.378, 0),
    new THREE.SphereGeometry(0.06, 12, 8).scale(1.1, 0.85, 1).translate(0.168, 0.378, 0),
    new THREE.SphereGeometry(0.07, 12, 8).scale(1.7, 0.55, 0.8).translate(0, 0.43, -0.01),
    new THREE.CylinderGeometry(0.045, 0.052, 0.12, 10).translate(0, 0.49, 0.005),
  ]),
  head: sculptHead(true),
  headFar: sculptHead(false),
  eyes,
  upperArm: limb([[0, 0.058], [0.3, 0.056], [0.7, 0.046], [1, 0.041]], 0.28),
  forearm: limb([[0, 0.043], [0.22, 0.046], [0.65, 0.036], [1, 0.029]], 0.25),
  // a palm, four fingers curled a little, and a thumb
  hand: merge([
    new THREE.CapsuleGeometry(0.028, 0.04, 3, 8).scale(1.15, 1, 0.55).translate(0, -0.042, 0),
    ...[-0.021, -0.007, 0.007, 0.021].map((x, i) =>
      new THREE.CapsuleGeometry(0.0085, [0.034, 0.042, 0.04, 0.032][i], 2, 5).rotateX(0.35).translate(x, -0.1 + (i === 0 || i === 3 ? 0.006 : 0), 0.008),
    ),
    new THREE.CapsuleGeometry(0.01, 0.03, 2, 5).rotateZ(0.7).rotateX(0.3).translate(0.034, -0.045, 0.014),
  ]),
  thigh: limb([[0, 0.09], [0.2, 0.088], [0.6, 0.071], [1, 0.054]], 0.43, 0.95),
  shin: limb([[0, 0.054], [0.28, 0.062], [0.6, 0.049], [1, 0.036]], 0.42, 0.95),
  /** coat / jacket collar, turned up */
  collar: merge([lathe([[0.07, 0.39], [0.082, 0.43], [0.102, 0.455]], 14, 0.9).translate(0, 0, 0.004), new THREE.BoxGeometry(0.05, 0.16, 0.012).rotateZ(0.35).rotateX(-0.12).translate(-0.045, 0.34, 0.104), new THREE.BoxGeometry(0.05, 0.16, 0.012).rotateZ(-0.35).rotateX(-0.12).translate(0.045, 0.34, 0.104)]),
  /** crew neck on a knit or a hoodie */
  crew: new THREE.TorusGeometry(0.066, 0.016, 6, 16).rotateX(Math.PI / 2).translate(0, 0.435, 0.004),
  /** shirt front showing under a jacket */
  shirt: (() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.05, 0.43, 0.1, 0.05, 0.43, 0.1, 0, 0.25, 0.108], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0.2, 1, 0, 0.2, 1, 0, 0.2, 1], 3));
    return g;
  })(),
  foot: merge([new THREE.CapsuleGeometry(0.042, 0.17, 4, 10).rotateX(Math.PI / 2).scale(1, 0.85, 1).translate(0, -0.042, 0.06), new THREE.BoxGeometry(0.08, 0.02, 0.24).translate(0, -0.075, 0.06)]),
  /** long coat skirt from the waist to below the knee */
  hem: lathe([[0.15, 0.02], [0.17, -0.12], [0.205, -0.35], [0.235, -0.62]], 16, 0.78),
  /** short skirt */
  skirt: lathe([[0.145, 0.02], [0.17, -0.12], [0.215, -0.4]], 16, 0.8),
  /** a hood lying down at the back of the neck, or a scarf */
  hoodDown: merge([new THREE.TorusGeometry(0.09, 0.035, 8, 16, Math.PI * 1.4).rotateX(Math.PI / 2).rotateY(Math.PI * 0.8).scale(1, 1, 1.15).translate(0, 0.44, -0.035)]),
  scarf: merge([new THREE.TorusGeometry(0.068, 0.03, 8, 16).rotateX(Math.PI / 2).translate(0, 0.45, 0.005), new THREE.BoxGeometry(0.06, 0.2, 0.02).translate(0.03, 0.34, 0.1)]),
  bag: merge([new THREE.BoxGeometry(0.07, 0.22, 0.28).translate(0.2, -0.08, 0.02), new THREE.BoxGeometry(0.02, 0.62, 0.03).rotateZ(-0.62).translate(0.03, 0.2, 0.095)]),
  umbrella: merge([new THREE.ConeGeometry(0.56, 0.24, 14, 1, true).translate(0, 0.94, 0), new THREE.CylinderGeometry(0.008, 0.008, 0.95, 5).translate(0, 0.46, 0)]),
  glow: new THREE.BoxGeometry(0.055, 0.09, 0.008),
  ...Object.fromEntries(Object.entries(HAIR).map(([k, v]) => [`hair_${k}`, v])),
} as Record<string, THREE.BufferGeometry>;

/* ─────────────────────────── body + outfit ─────────────────────────── */

export interface Body {
  height: number; // uniform scale (0.9–1.1)
  girth: number; // limb / torso thickness
  shoulders: number;
  hips: number;
  head: number;
}

export type Garment = 'coat' | 'raincoat' | 'hoodie' | 'jacket' | 'suit' | 'skirt' | 'workwear' | 'knit';

export interface Outfit {
  garment: Garment;
  top: number;
  legs: number;
  shoes: number;
  skin: number;
  hair: HairStyle;
  hairColor: number;
  accent: number; // scarf / hood / bag / beanie
  hem: boolean;
  skirt: boolean;
  hoodDown: boolean;
  scarf: boolean;
  bag: boolean;
  umbrella: boolean;
  /** sleeves and torso read bulkier in coats */
  bulk: number;
}

/* ─────────────────────────── motion state ─────────────────────────── */

export type ArmMode = 'free' | 'pockets' | 'phone' | 'umbrella' | 'smoke' | 'watch' | 'gesture' | 'rest' | 'aim' | 'punch' | 'guard' | 'hands';

export interface Motion {
  speed: number; // m/s along the ground
  phase: number; // gait phase (radians)
  sit: number; // 0..1
  lookYaw: number;
  lookPitch: number;
  slouch: number; // posture, radians forward
  stride: number; // personal stride amplitude multiplier
  armSwing: number; // personal arm swing multiplier
  armR: ArmMode;
  armL: ArmMode;
  smokeT: number; // 0..1 hand-to-mouth progress
  gestureT: number; // 0..1
  weight: number; // -1..1 weight shift (idle)
  breath: number; // breathing phase
  turn: number; // angular velocity (rad/s) — the upper body leans into turns
  glitch: number; // 0..1 something is wrong
  glitchKind: number;
}

export const newMotion = (): Motion => ({
  speed: 0,
  phase: Math.random() * 10,
  sit: 0,
  lookYaw: 0,
  lookPitch: 0,
  slouch: 0,
  stride: 1,
  armSwing: 1,
  armR: 'free',
  armL: 'free',
  smokeT: 0,
  gestureT: 0,
  weight: 0,
  breath: Math.random() * 10,
  turn: 0,
  glitch: 0,
  glitchKind: 0,
});

/* ─────────────────────────── the solver ─────────────────────────── */

export const PART_KEYS = [
  'pelvis', 'torso', 'head', 'headFar', 'eyes', 'hair',
  'upperArmL', 'upperArmR', 'forearmL', 'forearmR', 'handL', 'handR',
  'thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR',
  'hem', 'skirt', 'hoodDown', 'scarf', 'bag', 'umbrella', 'glow', 'collar', 'crew', 'shirt',
] as const;
export type PartKey = (typeof PART_KEYS)[number];
export type Rig = Record<PartKey, THREE.Matrix4>;

export const newRig = (): Rig => Object.fromEntries(PART_KEYS.map((k) => [k, new THREE.Matrix4()])) as Rig;

const J = {
  pelvis: new THREE.Matrix4(),
  chest: new THREE.Matrix4(),
  neck: new THREE.Matrix4(),
  shL: new THREE.Matrix4(),
  shR: new THREE.Matrix4(),
  elL: new THREE.Matrix4(),
  elR: new THREE.Matrix4(),
  wrL: new THREE.Matrix4(),
  wrR: new THREE.Matrix4(),
  hipL: new THREE.Matrix4(),
  hipR: new THREE.Matrix4(),
  knL: new THREE.Matrix4(),
  knR: new THREE.Matrix4(),
  anL: new THREE.Matrix4(),
  anR: new THREE.Matrix4(),
};
const _m = new THREE.Matrix4();
const _s = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _sc = new THREE.Vector3();

function joint(out: THREE.Matrix4, parent: THREE.Matrix4, x: number, y: number, z: number, rx: number, ry: number, rz: number) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _m.compose(_v.set(x, y, z), _q, _one);
  out.multiplyMatrices(parent, _m);
}
function part(out: THREE.Matrix4, j: THREE.Matrix4, sx: number, sy: number, sz: number) {
  _s.makeScale(sx, sy, sz);
  out.multiplyMatrices(j, _s);
}

const THIGH = 0.43, SHIN = 0.42, ANKLE = 0.08, UPPER = 0.28, FORE = 0.25;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Solve every part matrix for one figure.
 * `root` places the feet (position + yaw + height scale); the solver adds
 * gait, posture, breathing, gestures and sitting.
 */
export function solve(out: Rig, root: THREE.Matrix4, b: Body, o: Outfit, m: Motion, t: number) {
  const run = clamp01((m.speed - 2.6) / 2.4);
  const walk = clamp01(m.speed / 1.1);
  const moving = walk > 0.02;
  const sit = m.sit;

  // gait amplitudes
  const legAmp = (0.38 * walk * (1 - run) + 0.68 * run) * m.stride;
  const kneeAmp = 0.62 * (1 - run) + 1.45 * run;
  const armAmp = (0.34 * walk * (1 - run) + 0.62 * run) * m.armSwing;
  const phL = m.phase, phR = m.phase + Math.PI;

  // per leg: forward thigh angle and knee bend
  const leg = (ph: number) => {
    const f = legAmp * Math.sin(ph);
    const swing = Math.max(0, Math.cos(ph));
    const k = moving ? 0.06 + kneeAmp * Math.pow(swing, 1.3) * walk : 0;
    return { f, k };
  };
  let L = leg(phL), R = leg(phR);

  // idle: weight onto one leg, the other knee softens
  const idle = 1 - walk;
  const shift = m.weight * idle;
  if (idle > 0) {
    L = { f: L.f + 0.03 * Math.max(0, -shift) * idle, k: L.k + 0.14 * Math.max(0, -shift) };
    R = { f: R.f + 0.03 * Math.max(0, shift) * idle, k: R.k + 0.14 * Math.max(0, shift) };
  }

  // pelvis height from the stance leg so feet stay on the ground
  const stance = Math.cos(phL) <= 0 ? L : R;
  // hip joint sits 2 cm under the pelvis origin; the sole is ANKLE below the ankle joint
  const legH = (l: { f: number; k: number }) => 0.02 + THIGH * Math.cos(l.f) + SHIN * Math.cos(l.f - l.k) + ANKLE;
  let pelvisY = Math.max(legH(L), legH(R));
  if (run > 0) pelvisY += run * 0.02 * Math.abs(Math.sin(m.phase)); // a moment in the air each stride
  void stance;
  const breathe = Math.sin(m.breath) * 0.006 * (1 - run);

  // sitting overrides the legs
  const sitF = 1.5, sitK = 1.45;
  L = { f: L.f * (1 - sit) + sitF * sit, k: L.k * (1 - sit) + sitK * sit };
  R = { f: R.f * (1 - sit) + sitF * sit, k: R.k * (1 - sit) + sitK * sit };
  pelvisY = pelvisY * (1 - sit) + 0.47 * sit;

  const sway = moving ? 0.022 * Math.sin(m.phase) * (1 - run) : 0.018 * shift;
  const twist = moving ? 0.1 * Math.sin(m.phase) * walk : 0;
  const lean = m.slouch + 0.2 * run + 0.04 * walk * (1 - run) - 0.08 * sit;
  const bank = -m.turn * 0.04;

  // ── spine
  joint(J.pelvis, root, sway, pelvisY, 0, 0, twist, bank + shift * 0.03);
  const chestBend = lean + breathe * 2;
  joint(J.chest, J.pelvis, 0, 0.08, 0, chestBend, -twist * 1.8, -bank * 0.5 - shift * 0.04);
  part(out.pelvis, J.pelvis, b.hips * b.girth, 1, b.girth);
  part(out.torso, J.chest, b.shoulders * b.girth * o.bulk, 1 + breathe, b.girth * o.bulk);

  // ── head: looks, then — if something is wrong — keeps turning
  let hy = m.lookYaw, hp = m.lookPitch - lean * 0.6;
  if (m.glitch > 0) {
    if (m.glitchKind === 0) hy += 1.7 * m.glitch; // turns past where a neck should stop
    else if (m.glitchKind === 1) hp -= 0.9 * m.glitch; // head drops back
    else hy += Math.sin(t * 60) * 0.08 * m.glitch; // a tremor
  }
  joint(J.neck, J.chest, 0, 0.44, 0.005, hp, hy, 0);
  part(out.head, J.neck, b.head, b.head, b.head);
  out.headFar.copy(out.head);
  out.eyes.copy(out.head);
  out.hair.copy(out.head);

  // ── arms
  const shoulderX = 0.186 * b.shoulders * b.girth * o.bulk;
  const arm = (side: -1 | 1, mode: ArmMode, sh: THREE.Matrix4, el: THREE.Matrix4, wr: THREE.Matrix4, ph: number) => {
    // forward angle, abduction, elbow bend, wrist
    let f = -armAmp * Math.sin(ph) * (1 - sit);
    let ab = 0.12 + 0.06 * o.bulk + 0.04 * run;
    let bend = 0.3 + 0.3 * Math.max(0, -Math.sin(ph)) * walk + 1.25 * run;
    let tw = side * 0.35;
    switch (mode) {
      case 'pockets':
        f = 0.12 * Math.sin(ph) * walk - 0.08;
        ab = 0.16 + 0.05 * o.bulk;
        bend = 0.55;
        tw = side * 0.25;
        break;
      case 'phone':
        f = 0.42;
        ab = 0.08;
        bend = 1.75;
        tw = -side * 0.35;
        break;
      case 'umbrella':
        f = 0.5;
        ab = -0.05;
        bend = 1.5;
        break;
      case 'smoke': {
        const k = m.smokeT;
        f = 0.15 + 0.45 * k;
        ab = 0.1 - 0.25 * k;
        bend = 0.4 + 1.95 * k;
        tw = -side * 0.5 * k;
        break;
      }
      case 'watch':
        f = 0.55;
        ab = 0.05;
        bend = 1.7;
        tw = side * 0.8;
        break;
      case 'gesture':
        f = 0.35 + 0.15 * Math.sin(t * 3.1);
        ab = 0.14;
        bend = 1.1 + 0.25 * Math.sin(t * 2.3 + side);
        tw = -side * 0.4;
        break;
      case 'rest':
        f = 0.55;
        ab = 0.12;
        bend = 0.75;
        break;
      case 'aim': // arm out straight, level with the eye line
        f = 1.5;
        ab = -0.12 * side;
        bend = 0.06;
        break;
      case 'punch':
        f = 1.45;
        ab = -0.05;
        bend = 0.12;
        break;
      case 'guard': // fists up
        f = 0.75;
        ab = 0.1;
        bend = 2.0;
        tw = -side * 0.3;
        break;
      case 'hands': // hands up, don't shoot
        f = 0.2;
        ab = 1.35;
        bend = 1.6;
        break;
    }
    if (sit > 0 && mode === 'free') {
      f = f * (1 - sit) + 0.5 * sit;
      bend = bend * (1 - sit) + 0.75 * sit;
    }
    joint(sh, J.chest, side * shoulderX, 0.375, 0, -f, 0, side * ab);
    joint(el, sh, 0, -UPPER, 0, -bend, tw, 0);
    joint(wr, el, 0, -FORE, 0, mode === 'phone' ? -0.2 : 0.08, 0, 0);
  };
  arm(-1, m.armL, J.shL, J.elL, J.wrL, phL);
  arm(1, m.armR, J.shR, J.elR, J.wrR, phR);
  const ag = b.girth * (0.85 + 0.25 * o.bulk);
  part(out.upperArmL, J.shL, ag, 1, ag);
  part(out.upperArmR, J.shR, ag, 1, ag);
  part(out.forearmL, J.elL, ag, 1, ag);
  part(out.forearmR, J.elR, ag, 1, ag);
  out.handL.copy(J.wrL);
  out.handR.copy(J.wrR);

  // ── legs
  const hipX = 0.088 * b.hips;
  const legj = (side: -1 | 1, l: { f: number; k: number }, hip: THREE.Matrix4, kn: THREE.Matrix4, an: THREE.Matrix4) => {
    joint(hip, J.pelvis, side * hipX, -0.02, 0, -l.f, 0, side * 0.02);
    joint(kn, hip, 0, -THIGH, 0, l.k, 0, 0);
    // keep the sole level: undo the thigh and knee, then roll through the step
    const roll = moving ? 0.25 * Math.sin(l === L ? phL : phR) * walk : 0;
    joint(an, kn, 0, -SHIN, 0, l.f - l.k - roll * (1 - sit), 0, 0);
  };
  legj(-1, L, J.hipL, J.knL, J.anL);
  legj(1, R, J.hipR, J.knR, J.anR);
  const lg = b.girth;
  part(out.thighL, J.hipL, lg, 1, lg);
  part(out.thighR, J.hipR, lg, 1, lg);
  part(out.shinL, J.knL, lg, 1, lg);
  part(out.shinR, J.knR, lg, 1, lg);
  out.footL.copy(J.anL);
  out.footR.copy(J.anR);

  // ── garments & accessories
  const flare = 1 + 0.35 * Math.abs(legAmp * Math.sin(m.phase)) + 0.15 * run;
  part(out.hem, J.pelvis, b.hips * b.girth * flare, 1 - 0.35 * sit, b.girth * flare * (1 + 0.6 * sit));
  part(out.skirt, J.pelvis, b.hips * b.girth * flare, 1, b.girth * flare);
  part(out.hoodDown, J.chest, b.shoulders * b.girth * o.bulk, 1, b.girth * o.bulk);
  part(out.scarf, J.chest, b.girth * o.bulk, 1, b.girth * o.bulk);
  part(out.bag, J.pelvis, b.hips * b.girth, 1, b.girth);
  part(out.collar, J.chest, b.shoulders * b.girth * o.bulk, 1, b.girth * o.bulk);
  out.crew.copy(out.collar);
  out.shirt.copy(out.collar);

  // umbrella: follows the right hand but stays upright
  _v.setFromMatrixPosition(J.wrR);
  _sc.setFromMatrixScale(root);
  _q.setFromRotationMatrix(_m.extractRotation(root));
  _e.set(-0.08, 0, 0.05);
  const qTilt = new THREE.Quaternion().setFromEuler(_e);
  _q.multiply(qTilt);
  out.umbrella.compose(_v.add(new THREE.Vector3(0, 0.02, 0)), _q, _sc);

  // phone screen in the hand, or the ember at the lips
  joint(out.glow, J.wrR, 0, -0.07, 0.03, -0.5, 0, 0);
  if (m.armR === 'smoke') {
    _s.makeScale(0.2, 0.12, 1.2);
    out.glow.multiply(_s);
  }
}

/* ─────────────────────────── gait helpers ─────────────────────────── */

/** Advance gait phase from ground speed; stride frequency rises with speed. */
export function stepPhase(m: Motion, dt: number) {
  const cadence = m.speed < 0.05 ? 0 : 2.6 + m.speed * 0.95;
  const before = Math.sin(m.phase);
  m.phase += dt * cadence * (1 / Math.max(0.75, m.stride));
  m.breath += dt * (1.2 + Math.min(1.5, m.speed * 0.3));
  return Math.sign(before) !== Math.sign(Math.sin(m.phase)) && m.speed > 0.6; // footfall
}

/** Which rig parts a given outfit and distance actually shows. */
export function visibleParts(o: Outfit, dist: number): Set<PartKey> {
  const s = new Set<PartKey>(['pelvis', 'torso', 'upperArmL', 'upperArmR', 'forearmL', 'forearmR', 'thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR']);
  const near = dist < 38;
  if (near) s.add('head').add('eyes').add('handL').add('handR');
  else s.add('headFar');
  if (dist < 90) {
    if (o.hair !== 'none') s.add('hair');
    if (o.hem) s.add('hem');
    if (o.skirt) s.add('skirt');
    if (o.hoodDown) s.add('hoodDown');
    if (o.scarf) s.add('scarf');
    if (o.bag && near) s.add('bag');
    if (['coat', 'raincoat', 'jacket', 'suit', 'workwear'].includes(o.garment) && !o.scarf && !o.hoodDown) s.add('collar');
    if (o.garment === 'knit' && !o.scarf) s.add('crew');
    if ((o.garment === 'suit' || o.garment === 'jacket') && near) s.add('shirt');
  } else {
    if (o.hem) s.add('hem');
    if (o.skirt) s.add('skirt');
  }
  if (o.umbrella) s.add('umbrella');
  return s;
}

/* ─────────────────────────── wardrobe ─────────────────────────── */

type Rnd = { next(): number; range(a: number, b: number): number; pick<T>(a: readonly T[]): T; chance(p: number): boolean };

const SKIN = [0xe0bfa6, 0xc99a7c, 0xa8765a, 0x8a5c43, 0x6a4331, 0x4a2e22, 0xd1ae94, 0xb8876a];
const HAIRC = [0x0f0c0a, 0x1d1511, 0x2e2118, 0x4a3522, 0x6b5a48, 0x8f8a82, 0x2a2624, 0x5a3a24];
const DARK = [0x1a1b1d, 0x22262b, 0x2b2824, 0x1d2228, 0x2e2e2c];
const WOOL = [0x4a4034, 0x5c5446, 0x3b3226, 0x6a6258, 0x39302a, 0x4b4f52];
const MUTED = [0x2f3a44, 0x3d4a3c, 0x4a2c28, 0x55504a, 0x3a3f4a, 0x5a4a3a, 0x3c3440];
const RAIN = [0x6a6a3a, 0x2e3e4c, 0x3e4a3a, 0x7a6a50, 0x2a2e32, 0x5a2e2a];
const DENIM = [0x2b3444, 0x3a4658, 0x232a36, 0x4a5262];
const ACCENT = [0x7a3a30, 0x3a5060, 0x8a7a5a, 0x5a5a60, 0x6a5040, 0x2e4a3e, 0x9a8a70];

export function randomBody(r: Rnd): Body {
  const broad = r.range(-1, 1);
  return {
    height: r.range(0.9, 1.08),
    girth: r.range(0.88, 1.2),
    shoulders: 1 + broad * 0.09 + r.range(-0.03, 0.03),
    hips: 1 - broad * 0.07 + r.range(-0.03, 0.05),
    head: r.range(0.95, 1.04),
  };
}

export function randomOutfit(r: Rnd, bias?: Garment): Outfit {
  const garment: Garment = bias ?? r.pick(['coat', 'coat', 'raincoat', 'hoodie', 'jacket', 'suit', 'skirt', 'knit'] as const);
  const o: Outfit = {
    garment,
    top: r.pick(MUTED),
    legs: r.pick(DARK),
    shoes: r.pick([0x0e0e0f, 0x1a1512, 0x241c16, 0x151719]),
    skin: r.pick(SKIN),
    hair: r.pick(['short', 'short', 'swept', 'long', 'bun', 'beanie', 'cap', 'none'] as const),
    hairColor: r.pick(HAIRC),
    accent: r.pick(ACCENT),
    hem: false,
    skirt: false,
    hoodDown: false,
    scarf: r.chance(0.25),
    bag: r.chance(0.3),
    umbrella: false,
    bulk: 1,
  };
  switch (garment) {
    case 'coat':
      o.top = r.pick(WOOL.concat(DARK));
      o.hem = true;
      o.bulk = 1.12;
      break;
    case 'raincoat':
      o.top = r.pick(RAIN);
      o.hem = true;
      o.bulk = 1.1;
      if (r.chance(0.5)) o.hair = 'hood';
      break;
    case 'hoodie':
      o.top = r.pick(MUTED.concat([0x5a5a5e, 0x2a2a2e]));
      o.legs = r.pick(DENIM);
      o.bulk = 1.06;
      if (r.chance(0.6)) o.hoodDown = true;
      else o.hair = 'hood';
      o.accent = o.top;
      break;
    case 'jacket':
      o.top = r.pick([0x2a2420, 0x1c1e22, 0x4a3a2a, 0x3a3e44]);
      o.legs = r.pick(DENIM.concat(DARK));
      break;
    case 'suit':
      o.top = r.pick([0x1b1d22, 0x25272c, 0x2e2c2a, 0x1f2430]);
      o.legs = o.top;
      o.scarf = false;
      break;
    case 'skirt':
      o.top = r.pick(WOOL.concat(MUTED));
      o.legs = r.pick([0x141416, 0x2a2224, 0x3a3432]);
      o.skirt = true;
      if (o.hair === 'short' && r.chance(0.6)) o.hair = r.pick(['long', 'bun'] as const);
      break;
    case 'knit':
      o.top = r.pick([0x3e4a3a, 0x2e3440, 0x4a2a2a, 0x3a3a3e, 0x5a6066, 0x2a3a3a]);
      o.bulk = 1.05;
      break;
    case 'workwear':
      o.top = r.pick([0x6a4a2a, 0x5a5236, 0x3e4a52]);
      o.legs = r.pick([0x2a2e32, 0x3a3a36]);
      o.hair = r.pick(['beanie', 'cap', 'short'] as const);
      o.bulk = 1.1;
      break;
  }
  if (o.hair === 'beanie' || o.hair === 'cap') o.hairColor = o.accent;
  if (o.hair === 'hood') o.hairColor = o.top;
  return o;
}
