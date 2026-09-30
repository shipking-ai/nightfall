import * as THREE from 'three';
import { ANATOMY, EYE, HEAD, type FacialHair, type Grip, type HairCut, type HatStyle } from './anatomy';
import { C, newPose, type Pose } from '../anim/pose';
import type { Animator } from '../anim/Animator';
import { newFace, stepFace, facePose, type FaceState } from '../anim/face';
import { gaitPose, postureSway, newGait, advanceGait, DEFAULT_STYLE, type GaitState, type GaitStyle, type GaitOut } from '../anim/gait';

/**
 * Humanoid — the people of NIGHTFALL.
 *
 * A figure is a body (proportions, build, the small asymmetries that make
 * someone themselves), an outfit (what they wear, their hair, their face),
 * and a motion state (how fast they're going, where they're looking).
 *
 * Every frame: procedural locomotion writes a pose (walk, run, idle weight
 * shift, crouch, sit, jump), authored clips blend over it (Animator), then
 * look-at, breathing and blinking go on top, and the rig turns the pose into
 * part matrices. Nothing here allocates per frame, and nothing here knows
 * whether it's drawn instanced (Crowd) or for one figure (Player).
 *
 * Units: metres, feet on the origin, facing +z. A body of height 1 is ~1.76 m.
 */

export const PARTS = ANATOMY;

/* ─────────────────────────── body + outfit ─────────────────────────── */

export interface Body {
  height: number; // uniform scale (0.9–1.1)
  girth: number; // limb / torso thickness
  shoulders: number;
  hips: number;
  head: number;
  /** — everything below is optional; defaults are an average person — */
  /** torso morphs, 0..1 */
  bust?: number;
  belly?: number;
  broad?: number;
  slim?: number;
  /** relative lengths */
  legLen?: number;
  armLen?: number;
  torsoLen?: number;
  neckLen?: number;
  /** head width and depth (on top of `head`) */
  headW?: number;
  headD?: number;
  /** small asymmetries: one shoulder carried lower, a tilt of the head, feet turned out */
  shDrop?: number;
  tilt?: number;
  toeOut?: number;
  /** 0 young … 1 old: posture, cadence, face */
  age?: number;
  /** face shapes (anatomy.FACE_SHAPES order), 0..1 each */
  face?: number[];
}

export type Garment =
  | 'coat' | 'raincoat' | 'hoodie' | 'jacket' | 'suit' | 'skirt' | 'workwear' | 'knit'
  | 'shirt' | 'tee' | 'puffer' | 'uniform' | 'scrubs';

/** Kept for saved looks and the network: the old single "hair" field (cuts and headwear). */
export type HairStyle = 'short' | 'swept' | 'long' | 'bun' | 'beanie' | 'cap' | 'hood' | 'none' | HairCut | HatStyle;

export interface Outfit {
  garment: Garment;
  top: number;
  legs: number;
  shoes: number;
  skin: number;
  hair: HairStyle;
  hairColor: number;
  accent: number; // scarf / hood / bag / hat
  hem: boolean;
  skirt: boolean;
  hoodDown: boolean;
  scarf: boolean;
  bag: boolean;
  umbrella: boolean;
  /** sleeves and torso read bulkier in coats */
  bulk: number;
  /** — optional detail — */
  hat?: HatStyle | 'none';
  hatColor?: number;
  shoeKind?: 'shoe' | 'sneaker' | 'boot';
  soleColor?: number;
  sleeves?: 'long' | 'short';
  jacketHem?: boolean;
  lapels?: boolean;
  tie?: number | null;
  shirt?: number | null;
  pocket?: boolean;
  apron?: number | null;
  vest?: number | null;
  vestBand?: number;
  dutyBelt?: boolean;
  belt?: boolean;
  radio?: boolean;
  backpack?: number | null;
  gloves?: number | null;
  facialHair?: FacialHair;
  glasses?: boolean;
  eyeColor?: number;
  /** eyebrow thickness 0.6..1.6 */
  brows?: number;
}

const CUTS = ['buzz', 'short', 'swept', 'messy', 'curly', 'long', 'bob', 'ponytail', 'bun'];
const HATS = ['hood', 'beanie', 'cap', 'flatcap', 'peaked', 'trilby'];

/** Split the saved `hair` value into a cut and a hat. */
export function hairParts(o: Outfit): { cut: HairCut | 'none'; hat: HatStyle | 'none' } {
  const h = o.hair;
  const hat: HatStyle | 'none' = o.hat && o.hat !== 'none' ? o.hat : HATS.includes(h) ? (h as HatStyle) : 'none';
  const cut: HairCut | 'none' = h === 'none' ? 'none' : CUTS.includes(h) ? (h as HairCut) : 'short';
  return { cut, hat };
}

/* ─────────────────────────── motion state ─────────────────────────── */

export type ArmMode = 'free' | 'pockets' | 'phone' | 'umbrella' | 'smoke' | 'watch' | 'gesture' | 'rest' | 'aim' | 'punch' | 'guard' | 'hands' | 'rifle' | 'rifleAim' | 'wheel' | 'cross';

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
  /** direction of travel relative to facing (0 forward, ±π/2 sideways, π backwards) */
  moveDir: number;
  /** 0..1 crouched */
  crouch: number;
  /** 0..1 off the ground */
  air: number;
  /** a landing's knee dip, decaying */
  land: number;
  /** smoothed acceleration along the ground (m/s²): lean into starts, back into stops */
  accel: number;
  /** cadence multiplier (energetic people step quicker) */
  cadence: number;
  /** blinking */
  blinkT: number;
  blink: number;
  /** steering, for hands on a wheel (-1..1) */
  steer: number;
  /** hunched against the cold / rain, 0..1 */
  cold: number;
  /** how this person walks (anim/gait.ts); made from stride/armSwing/cadence if not set */
  style?: GaitStyle;
  /** planted feet, springs: the gait's memory */
  g: GaitState;
  /** ground height under a point (world), where it isn't flat */
  ground?: ((x: number, z: number) => number) | null;
  /** face: emotion and speech (anim/face.ts) */
  face: FaceState;
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
  moveDir: 0,
  crouch: 0,
  air: 0,
  land: 0,
  accel: 0,
  cadence: 1,
  blinkT: Math.random() * 4,
  blink: 0,
  steer: 0,
  cold: 0,
  g: newGait(),
  face: newFace(),
});

const _go: GaitOut = { armL: 0, armR: 0, elL: 0, elR: 0, run: 0, lean: 0 };
const _save = new Float32Array(64);
const _styles = new WeakMap<Motion, GaitStyle>();
/** A walk for someone nobody described: the old stride / arm swing / cadence knobs. */
function defaultStyle(m: Motion, b: Body): GaitStyle {
  let s = _styles.get(m);
  if (!s) _styles.set(m, (s = { ...DEFAULT_STYLE }));
  s.step = m.stride;
  s.arm = m.armSwing;
  s.cadence = m.cadence;
  s.toeOut = b.toeOut ?? 0.08;
  return s;
}

/* ─────────────────────────── the rig ─────────────────────────── */

export const PART_KEYS = [
  'pelvis', 'torso', 'neck', 'head', 'headFar', 'eyes', 'irises', 'brows', 'facial', 'glasses', 'hair', 'hat',
  'upperArmL', 'upperArmR', 'forearmL', 'forearmR', 'handL', 'handR',
  'thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR', 'soleL', 'soleR', 'shaftL', 'shaftR',
  'hem', 'jacketHem', 'skirt', 'lapels', 'tie', 'shirt', 'collar', 'crew', 'hoodDown', 'pocket', 'scarf', 'bag', 'backpack',
  'apronTop', 'apronSkirt', 'vest', 'vestBand', 'dutyBelt', 'belt', 'radio', 'umbrella', 'glow',
] as const;
export type PartKey = (typeof PART_KEYS)[number];
export type Rig = Record<PartKey, THREE.Matrix4> & { gripL: Grip; gripR: Grip; pose: Pose };

export const newRig = (): Rig => {
  const r = Object.fromEntries(PART_KEYS.map((k) => [k, new THREE.Matrix4()])) as unknown as Rig;
  r.gripL = 'relaxed';
  r.gripR = 'relaxed';
  r.pose = newPose();
  return r;
};

/** World-space joints of the last figure solved (a weapon in the hand, the camera at the eyes). */
export const J = {
  root: new THREE.Matrix4(),
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
const _m2 = new THREE.Matrix4();
const _s = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _sc = new THREE.Vector3();
const _qTilt = new THREE.Quaternion();

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
/** scale about a local point (closing the eyes about their centre line) */
function partAbout(out: THREE.Matrix4, j: THREE.Matrix4, px: number, py: number, pz: number, sx: number, sy: number, sz: number) {
  _m2.makeTranslation(px, py, pz);
  _s.makeScale(sx, sy, sz);
  _m2.multiply(_s);
  _s.makeTranslation(-px, -py, -pz);
  _m2.multiply(_s);
  out.multiplyMatrices(j, _m2);
}

const THIGH = 0.43, SHIN = 0.42, ANKLE = 0.08, UPPER = 0.28, FORE = 0.25;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const GRIPS: Grip[] = ['relaxed', 'fist', 'point', 'thumb', 'open'];

/* ─────────────────────────── 1. the procedural base pose ─────────────────────────── */

/**
 * Locomotion and posture: walking and running (forwards, sideways,
 * backwards), idle weight shifts, turning, crouching, sitting, jumping and
 * landing, plus the arm modes the crowd uses for what it's holding.
 */
export function basePose(p: Pose, b: Body, o: Outfit, m: Motion, t: number, root?: THREE.Matrix4) {
  p.fill(0);
  const age = b.age ?? 0;
  const st = m.style ?? defaultStyle(m, b);
  const sit = m.sit;
  const crouch = m.crouch;
  const air = m.air;
  const fwdK = Math.cos(m.moveDir);
  const walk = clamp01(m.speed / 1.1);
  const moving = walk > 0.02;

  // ── the legs: planted feet and the body over them (anim/gait.ts)
  const off = Math.max(sit, air);
  const go = _go;
  if (root && off < 0.999) {
    gaitPose(p, m.g, {
      root: root.elements, t, speed: m.speed, moveDir: m.moveDir, phase: m.phase, crouch, land: m.land,
      weight: m.weight, legLen: b.legLen ?? 1, hips: b.hips, style: st, ground: m.ground ?? undefined, bank: -m.turn * 0.04,
    }, go);
  } else {
    go.armL = go.armR = go.elL = go.elR = 0;
    go.run = clamp01((m.speed - 2.6) / 2.4);
    go.lean = st.lean;
  }
  // sitting, or in the air: the body decides where the feet go (and they're planted afresh after)
  if (off > 0.5) m.g.init = false;
  if (off > 0.001) {
    const legs = [C.hipLf, C.hipLab, C.hipLtw, C.knL, C.anL, C.hipRf, C.hipRab, C.hipRtw, C.knR, C.anR, C.pelY, C.pelX, C.pelRy, C.pelRz, C.pelRx];
    for (const c of legs) _save[c] = p[c];
    const toe = st.toeOut;
    let Lf = 0, Lk = 0.08, Rf = 0, Rk = 0.08;
    if (air > 0) {
      Lf += 0.35 * air + 0.25 * Math.sin(m.phase) * (1 - sit);
      Lk += 0.75 * air;
      Rf += 0.1 * air - 0.25 * Math.sin(m.phase) * (1 - sit);
      Rk += 0.35 * air;
    }
    const sitF = 1.5, sitK = 1.45;
    const ks = sit / Math.max(1e-3, off);
    Lf = Lf * (1 - ks) + sitF * ks;
    Lk = Lk * (1 - ks) + sitK * ks;
    Rf = Rf * (1 - ks) + sitF * ks;
    Rk = Rk * (1 - ks) + sitK * ks;
    const special = [Lf, 0.02, toe, Lk, 0, Rf, 0.02, toe, Rk, 0, -0.08 * sit, 0, 0, 0, 0];
    for (let i = 0; i < legs.length; i++) p[legs[i]] = _save[legs[i]] * (1 - off) + special[i] * off;
  }

  const run = go.run;
  const breathe = Math.sin(m.breath) * 0.006 * (1 - run);
  // posture: slouch, age, the gait's lean, leaning into acceleration, sitting back, crouched over
  const accLean = Math.max(-0.1, Math.min(0.14, m.accel * 0.022));
  const lean = m.slouch + 0.07 * age + go.lean * (1 - sit) - 0.08 * sit + 0.28 * crouch + 0.12 * m.land + accLean * (1 - st.still) + 0.06 * air;
  const bank = -m.turn * 0.04;
  if (off > 0.001) p[C.pelRz] += bank * off;
  p[C.spRx] += lean + breathe * 2;
  p[C.spRz] += -bank * 0.5;

  // head: where they're looking, holding the eyes level against the lean
  p[C.nkRx] += m.lookPitch - lean * 0.6 + 0.06 * age + st.chin;
  p[C.nkRy] += m.lookYaw;
  p[C.nkRz] += b.tilt ?? 0;
  // standing: never quite still
  postureSway(p, m.g, t, st, (1 - walk) * (1 - sit * 0.6));
  const armAmp = 1;
  const phL = m.phase, phR = m.phase + Math.PI;
  // arms
  const arm = (side: -1 | 1, mode: ArmMode, ph: number) => {
    const sw = side < 0 ? go.armL : go.armR;
    let f = armAmp * sw * (1 - sit) * (fwdK >= 0 ? 1 : 0.7) * (1 - 0.3 * crouch) + 0.04 * run;
    void ph;
    // arms hang close, a little in front of the thighs (not a mannequin's A)
    let ab = st.armOut + 0.07 * (o.bulk - 1) + 0.05 * run + 0.18 * air + 0.1 * crouch;
    let bend = st.elbow + (side < 0 ? go.elL : go.elR) * (1 - run) + 1.25 * run + 0.35 * crouch;
    let tw = -0.35;
    let wr = 0.08;
    let grip = 0;
    let up = 0;
    switch (mode) {
      case 'pockets':
        f = 0.12 * sw * walk - 0.08;
        ab = 0.16 + 0.05 * o.bulk;
        bend = 0.55;
        tw = -0.25;
        break;
      case 'phone':
        f = 0.42;
        ab = 0.08;
        bend = 1.75;
        tw = 0.35;
        wr = -0.2;
        break;
      case 'umbrella':
        f = 0.5;
        ab = -0.05;
        bend = 1.5;
        grip = 1;
        break;
      case 'smoke': {
        const k = m.smokeT;
        f = 0.15 + 0.45 * k;
        ab = 0.1 - 0.25 * k;
        bend = 0.4 + 1.95 * k;
        tw = 0.5 * k;
        break;
      }
      case 'watch':
        f = 0.55;
        ab = 0.05;
        bend = 1.7;
        tw = -0.8;
        break;
      case 'gesture':
        f = 0.35 + 0.15 * Math.sin(t * 3.1);
        ab = 0.14;
        bend = 1.1 + 0.25 * Math.sin(t * 2.3 + side);
        tw = 0.4;
        grip = 4;
        break;
      case 'rest':
        f = 0.55;
        ab = 0.12;
        bend = 0.75;
        break;
      case 'aim': // arm out straight, level with the eye line
        f = 1.5;
        ab = -0.12;
        bend = 0.06;
        tw = 0;
        grip = 1;
        break;
      case 'punch':
        f = 1.45;
        ab = -0.05;
        bend = 0.12;
        grip = 1;
        break;
      case 'guard': // fists up
        f = 0.75;
        ab = 0.1;
        bend = 2.0;
        tw = 0.3;
        grip = 1;
        break;
      case 'hands': // hands up, don't shoot
        f = 0.2;
        ab = 1.35;
        bend = 1.6;
        grip = 4;
        break;
      case 'cross':
        f = 0.42;
        ab = 0.3;
        bend = 1.95;
        tw = 1.2;
        up = 0.15;
        break;
      case 'wheel': {
        // hands on a steering wheel in front of the chest: turning moves them round it
        const s = m.steer * side;
        f = 0.95 + 0.14 * s;
        ab = 0.18 - 0.05 * s;
        bend = 0.95 - 0.12 * s;
        tw = 0.15;
        wr = 0.1;
        grip = 1;
        break;
      }
      case 'rifle':
        // a long gun held low across the body
        if (side > 0) (f = 0.35), (ab = 0.25), (bend = 1.25), (tw = 0.35), (grip = 1);
        else (f = 0.75), (ab = 0.15), (bend = 1.15), (tw = 0.75), (grip = 1);
        break;
      case 'rifleAim':
        // shouldered: the right hand at the grip under the cheek, the left out on the foregrip
        if (side > 0) (f = 1.05), (ab = 0.55), (bend = 1.75), (tw = 0.55), (wr = -0.1), (grip = 1);
        else (f = 1.38), (ab = -0.05), (bend = 0.55), (tw = 0.62), (grip = 1);
        break;
    }
    if (sit > 0 && mode === 'free') {
      f = f * (1 - sit) + 0.5 * sit;
      bend = bend * (1 - sit) + 0.75 * sit;
    }
    const Ls = side < 0;
    p[Ls ? C.shLf : C.shRf] = f;
    p[Ls ? C.shLab : C.shRab] = ab;
    p[Ls ? C.elL : C.elR] = bend;
    p[Ls ? C.elLtw : C.elRtw] = tw;
    p[Ls ? C.wrL : C.wrR] = wr;
    p[Ls ? C.gripL : C.gripR] = grip;
    p[Ls ? C.shLup : C.shRup] = up;
  };
  arm(-1, m.armL, phL);
  arm(1, m.armR, phR);
  // one shoulder carried lower than the other
  const drop = b.shDrop ?? 0;
  p[C.shLup] += Math.max(0, drop);
  p[C.shRup] += Math.max(0, -drop);
  // hunched against the cold
  if (m.cold > 0) {
    p[C.shLup] += 0.5 * m.cold;
    p[C.shRup] += 0.5 * m.cold;
    p[C.spRx] += 0.08 * m.cold;
    p[C.nkRx] += 0.1 * m.cold;
  }
}

/* ─────────────────────────── 2. on top of the clips ─────────────────────────── */

/** Breathing, blinking, a shiver, and — rarely — something wrong with the neck. */
export function finishPose(p: Pose, m: Motion, t: number) {
  // shoulders rise with the breath
  const br = (Math.sin(m.breath) * 0.5 + 0.5) * clamp01(1 - m.speed / 3);
  p[C.shLup] += br * 0.06;
  p[C.shRup] += br * 0.06;
  if (m.cold > 0) p[C.spRz] += Math.sin(t * 38) * 0.006 * m.cold;
  p[C.blink] = Math.max(p[C.blink], m.blink);
  facePose(p, m.face, t);
  // looking far round: the chest helps the neck
  const ny = p[C.nkRy];
  if (Math.abs(ny) > 0.9 && m.glitch === 0) {
    const extra = (Math.abs(ny) - 0.9) * Math.sign(ny);
    p[C.spRy] += extra * 0.6;
    p[C.nkRy] = ny - extra * 0.6;
  }
  if (m.glitch > 0) {
    if (m.glitchKind === 0) p[C.nkRy] += 1.7 * m.glitch; // turns past where a neck should stop
    else if (m.glitchKind === 1) p[C.nkRx] -= 0.9 * m.glitch; // head drops back
    else p[C.nkRy] += Math.sin(t * 60) * 0.08 * m.glitch; // a tremor
  }
}

/** Advance blinking (call once per frame per figure). */
export function stepBlink(m: Motion, dt: number) {
  m.blinkT -= dt;
  if (m.blinkT < 0) {
    m.blink = 1;
    if (m.blinkT < -0.13) {
      m.blink = 0;
      m.blinkT = 1.8 + Math.random() * 4.5;
    }
  }
}

/* ─────────────────────────── 3. pose → matrices ─────────────────────────── */

const legH = (f: number, k: number, ab: number, th: number, sh: number) => 0.02 + (th * Math.cos(f) + sh * Math.cos(f - k)) * Math.cos(ab) + ANKLE;

export function buildRig(out: Rig, root: THREE.Matrix4, b: Body, o: Outfit, p: Pose) {
  const legLen = b.legLen ?? 1, armLen = b.armLen ?? 1, torsoLen = b.torsoLen ?? 1;
  const th = THIGH * legLen, sh = SHIN * legLen;

  // whole-body offset and rotation (about hip height)
  const pivot = 0.92;
  _e.set(p[C.rootRx], p[C.rootRy], p[C.rootRz], 'YXZ');
  _q.setFromEuler(_e);
  _m.compose(_v.set(p[C.rootX], p[C.rootY] + pivot, p[C.rootZ]), _q, _one);
  J.root.multiplyMatrices(root, _m);
  _m.makeTranslation(0, -pivot, 0);
  J.root.multiply(_m);

  // the pelvis stands on whichever leg is longer (the stance leg)
  const hL = legH(p[C.hipLf], p[C.knL], p[C.hipLab], th, sh), hR = legH(p[C.hipRf], p[C.knR], p[C.hipRab], th, sh);
  const pelvisY = Math.max(hL, hR) + p[C.pelY];

  // ── spine
  joint(J.pelvis, J.root, p[C.pelX], pelvisY, p[C.pelZ], p[C.pelRx], p[C.pelRy], p[C.pelRz]);
  joint(J.chest, J.pelvis, 0, 0.08 * torsoLen, 0, p[C.spRx], p[C.spRy], p[C.spRz]);
  part(out.pelvis, J.pelvis, b.hips * b.girth, 1, b.girth);
  const tb = o.bulk;
  part(out.torso, J.chest, b.shoulders * b.girth * tb, torsoLen, b.girth * tb);

  // ── head
  const nl = b.neckLen ?? 1;
  joint(J.neck, J.chest, 0, 0.44 * torsoLen + 0.012 * (nl - 1), 0.005, p[C.nkRx], p[C.nkRy], p[C.nkRz]);
  const hs = b.head, hw = hs * (b.headW ?? 1), hd = hs * (b.headD ?? 1);
  part(out.head, J.neck, hw, hs, hd);
  out.headFar.copy(out.head);
  out.facial.copy(out.head);
  out.glasses.copy(out.head);
  out.hair.copy(out.head);
  out.hat.copy(out.head);
  part(out.neck, J.neck, b.girth * (0.9 + 0.1 * tb), nl, b.girth * (0.9 + 0.1 * tb));
  // eyes close about their centre line; brows lift
  const bl = clamp01(Math.max(p[C.blink], 0.35 * p[C.squint]));
  partAbout(out.eyes, out.head, 0, EYE.y, EYE.z, 1, 1 - 0.88 * bl, 1);
  // the irises follow the gaze across the eye
  _m.makeTranslation(0.0045 * Math.max(-1, Math.min(1, p[C.eyeX])), 0.003 * Math.max(-1, Math.min(1, p[C.eyeY])), 0);
  out.irises.multiplyMatrices(out.eyes, _m);
  // brows lift, draw together (down and in), and not always evenly
  const bIn = clamp01(p[C.browIn]);
  _m.makeTranslation(0, 0.004 * p[C.browUp] - 0.002 * bl - 0.0025 * bIn, 0.0008 * bIn);
  _m2.makeRotationZ(0.06 * p[C.browAsym]);
  _m.multiply(_m2);
  out.brows.multiplyMatrices(out.head, _m);
  if (o.brows && o.brows !== 1) {
    _m.copy(out.brows);
    partAbout(out.brows, _m, 0, HEAD.cy + 0.035, EYE.z, 1, o.brows, 1);
  }

  // ── arms
  const shoulderX = 0.186 * b.shoulders * b.girth * tb;
  const arm = (side: -1 | 1, sj: THREE.Matrix4, ej: THREE.Matrix4, wj: THREE.Matrix4) => {
    const Ls = side < 0;
    const f = p[Ls ? C.shLf : C.shRf], ab = p[Ls ? C.shLab : C.shRab], tw = p[Ls ? C.shLtw : C.shRtw], up = p[Ls ? C.shLup : C.shRup];
    const bend = p[Ls ? C.elL : C.elR], etw = p[Ls ? C.elLtw : C.elRtw];
    joint(sj, J.chest, side * shoulderX * (1 - 0.04 * up), 0.375 * torsoLen + 0.028 * up, 0, -f, -side * tw, side * ab);
    joint(ej, sj, 0, -UPPER * armLen, 0, -bend, -side * etw, 0);
    joint(wj, ej, 0, -FORE * armLen, 0, p[Ls ? C.wrL : C.wrR], 0, side * p[Ls ? C.wrLz : C.wrRz]);
  };
  arm(-1, J.shL, J.elL, J.wrL);
  arm(1, J.shR, J.elR, J.wrR);
  const ag = b.girth * (0.85 + 0.25 * tb);
  part(out.upperArmL, J.shL, ag, armLen, ag);
  part(out.upperArmR, J.shR, ag, armLen, ag);
  part(out.forearmL, J.elL, ag, armLen, ag);
  part(out.forearmR, J.elR, ag, armLen, ag);
  const hsz = 0.95 + 0.1 * b.girth;
  part(out.handL, J.wrL, hsz, hsz, hsz);
  part(out.handR, J.wrR, hsz, hsz, hsz);
  out.gripL = GRIPS[Math.max(0, Math.min(4, Math.round(p[C.gripL])))];
  out.gripR = GRIPS[Math.max(0, Math.min(4, Math.round(p[C.gripR])))];

  // ── legs
  const hipX = 0.088 * b.hips;
  const legj = (side: -1 | 1, hip: THREE.Matrix4, kn: THREE.Matrix4, an: THREE.Matrix4) => {
    const Ls = side < 0;
    const f = p[Ls ? C.hipLf : C.hipRf], ab = p[Ls ? C.hipLab : C.hipRab], tw = p[Ls ? C.hipLtw : C.hipRtw], k = p[Ls ? C.knL : C.knR];
    joint(hip, J.pelvis, side * hipX, -0.02, 0, -f, side * tw, side * (0.02 + ab));
    joint(kn, hip, 0, -th, 0, k, 0, 0);
    // keep the sole level: undo the thigh, the knee and the splay; then the ankle's own angle
    joint(an, kn, 0, -sh, 0, f - k - p[Ls ? C.anL : C.anR], 0, -side * (0.02 + ab));
  };
  legj(-1, J.hipL, J.knL, J.anL);
  legj(1, J.hipR, J.knR, J.anR);
  const lg = b.girth;
  part(out.thighL, J.hipL, lg, legLen, lg);
  part(out.thighR, J.hipR, lg, legLen, lg);
  part(out.shinL, J.knL, lg, legLen, lg);
  part(out.shinR, J.knR, lg, legLen, lg);
  out.shaftL.copy(out.shinL);
  out.shaftR.copy(out.shinR);
  out.footL.copy(J.anL);
  out.footR.copy(J.anR);
  out.soleL.copy(J.anL);
  out.soleR.copy(J.anR);

  // ── garments & accessories
  const legSpread = Math.max(Math.abs(p[C.hipLf] - p[C.hipRf]) * 0.5, Math.abs(p[C.hipLab]) + Math.abs(p[C.hipRab]));
  const flare = 1 + 0.35 * Math.min(0.8, legSpread) + 0.15 * clamp01(legSpread - 0.4);
  const sitting = clamp01((Math.min(p[C.hipLf], p[C.hipRf]) - 0.6) / 0.8);
  part(out.hem, J.pelvis, b.hips * b.girth * flare, 1 - 0.35 * sitting, b.girth * flare * (1 + 0.6 * sitting));
  part(out.jacketHem, J.pelvis, b.hips * b.girth * (1 + 0.5 * (flare - 1)), 1, b.girth * (1 + 0.5 * (flare - 1)));
  part(out.skirt, J.pelvis, b.hips * b.girth * flare, 1, b.girth * flare);
  part(out.apronSkirt, J.pelvis, b.hips * b.girth * (0.9 + 0.1 * flare), 1 - 0.3 * sitting, b.girth);
  const cs = b.shoulders * b.girth * tb, cd = b.girth * tb;
  part(out.hoodDown, J.chest, cs, torsoLen, cd);
  part(out.scarf, J.chest, b.girth * tb, torsoLen, cd);
  part(out.collar, J.chest, cs, torsoLen, cd);
  out.crew.copy(out.collar);
  out.shirt.copy(out.collar);
  out.lapels.copy(out.collar);
  out.tie.copy(out.collar);
  out.pocket.copy(out.collar);
  out.apronTop.copy(out.collar);
  out.radio.copy(out.collar);
  out.backpack.copy(out.collar);
  part(out.vest, J.chest, cs * 1.02, torsoLen, cd * 1.04);
  out.vestBand.copy(out.vest);
  part(out.bag, J.pelvis, b.hips * b.girth, 1, b.girth);
  part(out.belt, J.pelvis, b.hips * b.girth, 1, b.girth);
  part(out.dutyBelt, J.pelvis, b.hips * b.girth * 1.02, 1, b.girth * 1.04);

  // umbrella: follows the right hand but stays upright
  _v.setFromMatrixPosition(J.wrR);
  _sc.setFromMatrixScale(root);
  _q.setFromRotationMatrix(_m.extractRotation(root));
  _e.set(-0.08, 0, 0.05);
  _qTilt.setFromEuler(_e);
  _q.multiply(_qTilt);
  out.umbrella.compose(_v.setY(_v.y + 0.02), _q, _sc);

  // phone screen in the hand, or the ember at the lips
  joint(out.glow, J.wrR, 0, -0.07, 0.03, -0.5, 0, 0);
}

/** Everything for one figure, one frame. `anim` blends its clips over the procedural pose. */
/** The pose of the figure solved last (with J): a skinned body copies its face from it. */
export const LAST = { pose: newPose() };

export function solve(out: Rig, root: THREE.Matrix4, b: Body, o: Outfit, m: Motion, t: number, anim?: Animator | null) {
  const p = out.pose;
  LAST.pose = p;
  basePose(p, b, o, m, t, root);
  const gaitPelY = p[C.pelY];
  anim?.apply(p);
  // a clip that bends the legs stands the body on them (the gait's own height no longer applies)
  if (anim) {
    const lg = anim.legs();
    if (lg.w > 0 && !lg.pelvis) p[C.pelY] -= gaitPelY * lg.w;
  }
  finishPose(p, m, t);
  buildRig(out, root, b, o, p);
}

/* ─────────────────────────── gait helpers ─────────────────────────── */

/** Advance gait phase from ground speed; stride frequency rises with speed. */
export function stepPhase(m: Motion, dt: number) {
  const st = m.style;
  const before = Math.floor(m.phase / Math.PI);
  m.phase = advanceGait(m.phase, m.speed, dt, m.g, (st ? st.cadence : m.cadence), st ? st.step : m.stride);
  m.breath += dt * (1.2 + Math.min(1.5, m.speed * 0.3));
  stepBlink(m, dt);
  stepFace(m.face, dt);
  if (m.land > 0) m.land = Math.max(0, m.land - dt * 3.2);
  return Math.floor(m.phase / Math.PI) !== before && (m.speed > 0.6 || m.g.need); // footfall
}

/** Detail distances (metres): full faces and hands inside `near`, garments inside `mid`, silhouettes beyond. */
export const LOD = { near: 34, mid: 80 };

/** Which rig parts a given outfit and distance actually shows. */
export function visibleParts(o: Outfit, dist: number): Set<PartKey> {
  const s = new Set<PartKey>(['pelvis', 'torso', 'neck', 'upperArmL', 'upperArmR', 'forearmL', 'forearmR', 'thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR']);
  const near = dist < LOD.near;
  const close = dist < LOD.near * 0.55;
  const { cut, hat } = hairParts(o);
  if (near) {
    s.add('head').add('eyes').add('handL').add('handR').add('brows');
    if (close) s.add('irises');
    if (o.facialHair && o.facialHair !== 'none' && (o.facialHair !== 'stubble' || close)) s.add('facial');
    if (o.glasses) s.add('glasses');
  } else s.add('headFar');
  if (dist < LOD.mid) {
    if (cut !== 'none') s.add('hair');
    if (hat !== 'none') s.add('hat');
    if (o.hem) s.add('hem');
    if (o.skirt) s.add('skirt');
    if (o.jacketHem && !o.hem) s.add('jacketHem');
    if (o.hoodDown && hat !== 'hood') s.add('hoodDown');
    if (o.scarf) s.add('scarf');
    if (o.vest != null) s.add('vest').add('vestBand');
    if (o.apron != null) s.add('apronTop').add('apronSkirt');
    if (o.backpack != null) s.add('backpack');
    if (near) {
      if (o.bag) s.add('bag');
      if (['coat', 'raincoat', 'jacket', 'suit', 'workwear', 'uniform', 'puffer'].includes(o.garment) && !o.scarf && !o.hoodDown && hat !== 'hood') s.add('collar');
      if ((o.garment === 'knit' || o.garment === 'tee' || o.garment === 'hoodie' || o.garment === 'scrubs') && !o.scarf) s.add('crew');
      if (o.shirt != null) s.add('shirt');
      if (o.lapels) s.add('lapels');
      if (o.tie != null) s.add('tie');
      if (o.pocket) s.add('pocket');
      if (o.belt) s.add('belt');
      if (o.dutyBelt) s.add('dutyBelt');
      if (o.radio) s.add('radio');
      if (o.shoeKind === 'sneaker') s.add('soleL').add('soleR');
      if (o.shoeKind === 'boot') s.add('shaftL').add('shaftR');
    }
  } else {
    if (hat !== 'none') s.add('hat');
    else if (cut === 'long' || cut === 'curly' || cut === 'bob') s.add('hair');
    if (o.hem) s.add('hem');
    if (o.skirt) s.add('skirt');
    if (o.backpack != null) s.add('backpack');
  }
  if (o.umbrella) s.add('umbrella');
  return s;
}
