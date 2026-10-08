import { C, type Pose } from './pose';

/**
 * Walking the way a body walks.
 *
 * Each foot has a place on the ground. While it carries weight it stays
 * exactly there (in the world), and the leg bends to reach it: that is what
 * stops people gliding. A step lifts the foot, carries it on a smooth arc to
 * where it needs to land (under the hip, half a stride on, given how fast
 * the body is actually moving), rolls heel to toe, and plants it again.
 *
 * Everything else follows from the feet: the pelvis rides up over a straight
 * stance leg and dips between steps (or, running, sinks into each stance and
 * flies between), shifts over the foot that holds it, drops on the swing side
 * and turns with the stride; the chest turns against it, the arms swing
 * against the legs on springs (so they lag, overshoot and settle), and the
 * head holds steady. Stopping finishes the step that was under way and brings
 * the feet together; turning on the spot takes little steps; a weight shift
 * at rest moves a foot for real.
 *
 * How someone walks — stride, cadence, bounce, sway, arm swing, lean, a limp,
 * restlessness — is a GaitStyle, made from who they are.
 */

/* ─────────────────────────── style ─────────────────────────── */

export interface GaitStyle {
  /** stride length scale */
  step: number;
  /** step rate scale */
  cadence: number;
  /** stance width scale */
  width: number;
  /** foot clearance scale (a shuffle is well under 1) */
  lift: number;
  /** knees that never quite straighten, 0..1 */
  knee: number;
  /** vertical bob scale */
  bounce: number;
  /** pelvis over the stance foot, scale */
  hipSway: number;
  /** pelvis drops on the swing side, radians at full stride */
  hipDrop: number;
  /** pelvis turns with the stride, scale */
  hipRot: number;
  /** shoulders turn against the hips, scale */
  torso: number;
  /** arm swing scale */
  arm: number;
  /** arms carried away from the body (bulk, attitude), radians */
  armOut: number;
  /** resting elbow bend, radians */
  elbow: number;
  /** forward lean, radians (negative leans back) */
  lean: number;
  /** head pitch bias, radians (negative: chin up) */
  chin: number;
  /** how well the head is held steady against the body, 0..1 */
  steady: number;
  /** -1..1: one leg steps shorter (a stiff knee, an old injury) */
  limp: number;
  /** -1..1: one arm swings more than the other */
  armAsym: number;
  /** heel strike strength */
  heel: number;
  /** restlessness at rest: small foot adjustments, sway, 0..1 */
  fidget: number;
  /** stillness, 0..1: moves only when it means to */
  still: number;
  /** postural sway amplitude at rest */
  sway: number;
  /** toes turned out, radians */
  toeOut: number;
}

export const DEFAULT_STYLE: GaitStyle = {
  step: 1, cadence: 1, width: 1, lift: 1, knee: 0.1, bounce: 1, hipSway: 1, hipDrop: 0.07, hipRot: 1, torso: 1,
  arm: 1, armOut: 0.08, elbow: 0.24, lean: 0.03, chin: 0, steady: 0.75, limp: 0, armAsym: 0, heel: 1, fidget: 0.3,
  still: 0, sway: 1, toeOut: 0.08,
};

export interface PersonaLike {
  energy: number;
  confidence: number;
  nervous: number;
  tired: number;
  age: number;
}

/**
 * A walk from who someone is. `rnd` adds the personal quirks (a longer left
 * stride, an arm that swings more) so no two people of the same kind match.
 */
export function styleFor(p: PersonaLike, rnd: () => number, o: { arche?: string; bulk?: number; femme?: number; toeOut?: number } = {}): GaitStyle {
  const r = (a: number, b: number) => a + (b - a) * rnd();
  const conf = p.confidence, tired = p.tired, nerv = p.nervous, en = p.energy, age = p.age;
  const s: GaitStyle = {
    step: (0.92 + 0.14 * en + 0.08 * conf - 0.2 * age - 0.06 * tired) * r(0.95, 1.05),
    cadence: (0.94 + 0.14 * en + 0.08 * nerv - 0.1 * tired - 0.08 * age) * r(0.96, 1.04),
    width: (1 + 0.18 * conf + 0.25 * age - 0.1 * (o.femme ?? 0)) * r(0.9, 1.1),
    lift: (1 - 0.45 * age - 0.25 * tired + 0.1 * en) * r(0.9, 1.1),
    knee: 0.08 + 0.3 * age + 0.12 * tired + 0.08 * nerv,
    bounce: (0.85 + 0.35 * en - 0.3 * age) * r(0.8, 1.2),
    hipSway: (0.8 + 0.5 * (o.femme ?? 0.5) - 0.2 * conf + 0.2 * tired) * r(0.85, 1.15),
    hipDrop: (0.05 + 0.05 * (o.femme ?? 0.5) + 0.02 * tired) * r(0.8, 1.2),
    hipRot: (0.9 + 0.3 * (o.femme ?? 0.5) - 0.3 * age) * r(0.85, 1.15),
    torso: (0.9 + 0.3 * conf - 0.3 * age) * r(0.85, 1.15),
    arm: (0.65 + 0.55 * conf + 0.2 * en - 0.35 * age - 0.2 * tired) * r(0.85, 1.15),
    armOut: 0.07 + 0.08 * ((o.bulk ?? 1) - 1) + 0.05 * conf,
    elbow: 0.2 + 0.12 * en + 0.1 * nerv,
    lean: 0.02 + 0.08 * tired + 0.07 * age - 0.04 * conf + 0.03 * en,
    chin: -0.08 * conf + 0.1 * tired + 0.05 * nerv,
    steady: 0.7 + 0.2 * conf - 0.25 * age,
    limp: rnd() < 0.06 + 0.2 * age ? r(-0.5, 0.5) : r(-0.08, 0.08),
    armAsym: r(-0.25, 0.25),
    heel: 0.8 + 0.4 * conf + 0.2 * en - 0.3 * age,
    fidget: 0.15 + 0.7 * nerv + 0.15 * en,
    still: 0,
    sway: 0.8 + 0.4 * age + 0.3 * tired + 0.3 * nerv,
    toeOut: o.toeOut ?? r(0.03, 0.14),
  };
  switch (o.arche) {
    case 'police':
      s.width *= 1.15; s.arm *= 0.75; s.armOut += 0.06; s.lean -= 0.02; s.chin -= 0.04; s.steady = 0.9; s.fidget *= 0.5; s.step *= 1.04;
      break;
    case 'soldier':
      s.width *= 1.12; s.knee = 0.2; s.lean += 0.06; s.arm *= 0.5; s.steady = 0.95; s.bounce *= 0.7; s.fidget *= 0.4;
      break;
    case 'watcher':
      s.still = 0.9; s.arm *= 0.25; s.bounce *= 0.35; s.hipSway *= 0.3; s.torso *= 0.3; s.steady = 1; s.fidget = 0; s.sway *= 0.15; s.cadence *= 0.85; s.chin = 0.02;
      break;
    case 'elder':
      s.step *= 0.85; s.lift *= 0.7; s.knee = Math.max(s.knee, 0.3); s.lean += 0.05;
      break;
    case 'drifter':
      s.lean += 0.06; s.chin += 0.08; s.lift *= 0.8; s.arm *= 0.7; s.limp = s.limp || r(-0.3, 0.3);
      break;
    case 'courier':
    case 'student':
      s.bounce *= 1.15; s.cadence *= 1.05;
      break;
    case 'fighter':
      s.width *= 1.2; s.knee = 0.25; s.bounce *= 1.1; s.steady = 0.9;
      break;
  }
  return s;
}

/* ─────────────────────────── state ─────────────────────────── */

interface Foot {
  /** world position of the ankle's plant (stance) or where the swing started */
  x: number;
  z: number;
  y: number;
  yaw: number;
  /** where the swing started */
  sx: number;
  sz: number;
  sy: number;
  syaw: number;
  swing: boolean;
  /** where it is right now (world), for the pose */
  cx: number;
  cz: number;
  cy: number;
  cyaw: number;
  /** lift (world metres) and ankle angle at the moment */
  lift: number;
  an: number;
}

export interface GaitState {
  init: boolean;
  /** last root (world): position, yaw, scale */
  px: number;
  py: number;
  pz: number;
  yaw: number;
  h: number;
  t: number;
  /** smoothed measured ground velocity (world m/s) */
  vx: number;
  vz: number;
  feet: [Foot, Foot];
  /** a step is needed or under way (keeps the clock running at rest) */
  need: boolean;
  /** springs: arm swing angle + velocity, pelvis side shift, sway noise */
  aL: number;
  aLv: number;
  aR: number;
  aRv: number;
  sx: number;
  sxv: number;
  /** leg in stance (1) or swing (0), for tests and footfalls */
  stanceL: number;
  stanceR: number;
  /** a new foot went down this frame (for footstep sounds): -1 none, 0 left, 1 right */
  landed: number;
  /** the root isn't moving but the legs should (a treadmill: dev views) */
  treadmill: number;
  /** extra lateral stance per foot at rest (weight shift) */
  seed: number;
}

const foot = (): Foot => ({ x: 0, z: 0, y: 0, yaw: 0, sx: 0, sz: 0, sy: 0, syaw: 0, swing: false, cx: 0, cz: 0, cy: 0, cyaw: 0, lift: 0, an: 0 });

export const newGait = (): GaitState => ({
  init: false, px: 0, py: 0, pz: 0, yaw: 0, h: 1, t: 0, vx: 0, vz: 0, feet: [foot(), foot()], need: false,
  aL: 0, aLv: 0, aR: 0, aRv: 0, sx: 0, sxv: 0, stanceL: 1, stanceR: 1, landed: -1, treadmill: 0, seed: Math.random() * 100,
});

/* ─────────────────────────── timing ─────────────────────────── */

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const clamp01 = (x: number) => clamp(x, 0, 1);
const smooth = (a: number, b: number, x: number) => {
  const u = clamp01((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};
const minJerk = (u: number) => u * u * u * (10 - 15 * u + 6 * u * u);
const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const TAU = Math.PI * 2;

/**
 * Integrate a critically-ish damped spring in fixed substeps. Explicit Euler on
 * a stiff spring (k = 60..150 here) diverges once dt passes 2/√k, which a
 * single long frame can do; capping the step keeps it stable and only costs a
 * little accuracy on the frame that actually was long.
 */
export function springStep(dt: number, x: number, v: number, target: number, k: number, d: number, put: (x: number, v: number) => void) {
  const max = 1 / 90;
  let left = dt;
  let guard = 0;
  while (left > 1e-5 && guard++ < 24) {
    const h = Math.min(max, left);
    v += (k * (target - x) - d * v) * h;
    x += v * h;
    left -= h;
  }
  put(x, v);
}

/** Steps per second at a ground speed (m/s), for someone of average height. */
export function stepRate(v: number) {
  v = Math.min(8, v);
  return 1.1 + 0.62 * v - 0.035 * v * v;
}

/** Fraction of the cycle a foot is on the ground: walking 0.62, sprinting 0.34. */
export function duty(v: number) {
  return 0.62 - 0.27 * smooth(1.9, 3.4, v) - 0.03 * smooth(4.5, 7, v);
}

/**
 * Advance the gait clock. One cycle (2π) is two steps. At rest the clock
 * only runs while a step is needed or finishing.
 */
export function advanceGait(phase: number, v: number, dt: number, g: GaitState | undefined, cadence: number, legScale: number): number {
  let rate = gaitRate(v, g, cadence, legScale);
  return phase + dt * rate * Math.PI; // steps/s × π = radians/s (2π per two steps)
}

/**
 * Steps per second. The pose needs the same number to work out where a foot
 * will land as the clock does to get there — computing the two separately (one
 * with a leg-length scale and a speed floor, the other without) made a foot
 * land short of where it was aimed, which shows as sliding feet at speed.
 */
export function gaitRate(v: number, g: GaitState | undefined, cadence: number, legScale: number): number {
  let rate = 0;
  if (v > 0.12) rate = (stepRate(v) * cadence) / Math.sqrt(Math.max(0.6, legScale));
  if (g && g.need) rate = Math.max(rate, 1.75 * cadence);
  return rate;
}

/* ─────────────────────────── the pose ─────────────────────────── */

export interface GaitIn {
  /** the root matrix elements (world): position, yaw and uniform scale are read from it */
  root: ArrayLike<number>;
  t: number;
  speed: number;
  moveDir: number;
  phase: number;
  crouch: number;
  land: number;
  weight: number;
  legLen: number;
  hips: number;
  style: GaitStyle;
  /** leaning into a turn (pelvis roll, radians) */
  bank: number;
  /** ground height (world) under a point, if the ground isn't flat */
  ground?: (x: number, z: number) => number;
}

export interface GaitOut {
  /** arm swing (radians forward) for each arm, and extra elbow bend */
  armL: number;
  armR: number;
  elL: number;
  elR: number;
  /** 0 walking … 1 running */
  run: number;
  /** body lean from the gait (radians) */
  lean: number;
}

const THIGH = 0.43, SHIN = 0.42, ANKLE = 0.08, BALL = 0.13;

export function legHeight(f: number, k: number, ab: number, th: number, sh: number) {
  return 0.02 + (th * Math.cos(f) + sh * Math.cos(f - k)) * Math.cos(ab) + ANKLE;
}

/**
 * Write the legs, pelvis and the spine's gait motion into `p`, and return
 * the arm swing. Needs the root (to keep planted feet where they are in the
 * world), so it runs inside solve().
 */
export function gaitPose(p: Pose, g: GaitState, i: GaitIn, out: GaitOut) {
  const R = i.root;
  const px = R[12], py = R[13], pz = R[14];
  const h = Math.hypot(R[0], R[1], R[2]) || 1;
  const yaw = Math.atan2(R[8], R[10]);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const st = i.style;
  const th = THIGH * i.legLen, sh = SHIN * i.legLen, reach = th + sh;
  const standP = 0.02 + reach + ANKLE;

  // time and the body's actual motion
  let dt = i.t - g.t;
  const jump = Math.hypot(px - g.px, pz - g.pz);
  const fresh = !g.init || dt <= 0 || dt > 0.6 || jump > 2.5 || Math.abs(h - g.h) > 0.05;
  if (fresh) dt = 1 / 60;
  const mvx = fresh ? 0 : (px - g.px) / dt, mvz = fresh ? 0 : (pz - g.pz) / dt;
  const k = Math.min(1, dt * 10);
  g.vx += (mvx - g.vx) * k;
  g.vz += (mvz - g.vz) * k;
  // intended velocity (what the legs should be doing)
  const dir = yaw + i.moveDir;
  const ivx = Math.sin(dir) * i.speed, ivz = Math.cos(dir) * i.speed;
  // a body that should be moving but isn't (a treadmill; a dev view): the ground moves instead
  const measured = Math.hypot(g.vx, g.vz);
  g.treadmill += ((i.speed > 0.4 && measured < 0.15 * i.speed ? 1 : 0) - g.treadmill) * Math.min(1, dt * 4);
  const tread = g.treadmill > 0.5;
  const vx = tread ? ivx : g.vx, vz = tread ? ivz : g.vz;
  const v = Math.hypot(vx, vz);
  g.t = i.t;
  g.px = px;
  g.py = py;
  g.pz = pz;
  g.yaw = yaw;
  g.h = h;

  const run = smooth(1.9, 3.4, i.speed);
  const D = duty(i.speed);
  // the same rate the clock advances by, or a foot lands somewhere other than
  // where it was aimed and the walk slides
  const rate = gaitRate(i.speed, g.need ? g : undefined, st.cadence, st.step);
  const cycle = 2 / Math.max(0.5, rate); // seconds for two steps
  const ground = (x: number, z: number) => (i.ground ? i.ground(x, z) : py);

  // where each foot would stand, in the root frame (rig units)
  const width = 0.1 * i.hips * st.width * (1 + 0.25 * i.crouch);
  const w = i.weight;
  const restL = { x: -width - 0.015 * Math.max(0, w), z: 0.05 * Math.max(0, w) - 0.02 * Math.max(0, -w) };
  const restR = { x: width + 0.015 * Math.max(0, -w), z: 0.05 * Math.max(0, -w) - 0.02 * Math.max(0, w) };
  const toWorld = (lx: number, lz: number, o: { x: number; z: number }) => {
    o.x = px + (lx * cy + lz * sy) * h;
    o.z = pz + (-lx * sy + lz * cy) * h;
    return o;
  };
  const tmp = { x: 0, z: 0 };

  if (fresh) {
    for (let s = 0; s < 2; s++) {
      const f = g.feet[s], r = s === 0 ? restL : restR;
      toWorld(r.x, r.z, tmp);
      f.x = f.cx = f.sx = tmp.x;
      f.z = f.cz = f.sz = tmp.z;
      f.y = f.cy = f.sy = ground(tmp.x, tmp.z);
      f.yaw = f.cyaw = f.syaw = yaw + (s === 0 ? -1 : 1) * st.toeOut;
      f.swing = false;
      f.lift = 0;
      f.an = 0;
    }
    g.aL = g.aR = g.aLv = g.aRv = 0;
    g.init = true;
  }

  g.landed = -1;
  let anyFar = false;
  const u0 = (((i.phase / TAU) % 1) + 1) % 1;
  for (let s = 0; s < 2; s++) {
    const f = g.feet[s];
    const side = s === 0 ? -1 : 1;
    const r = s === 0 ? restL : restR;
    // a limp: one leg's stance is shorter
    const lim = 1 - 0.35 * Math.max(0, side * st.limp);
    const Ds = D * lim + (1 - lim) * 0.45;
    const u = (u0 + (s === 0 ? 0 : 0.5)) % 1;
    const swing = u >= Ds;
    const us = swing ? (u - Ds) / (1 - Ds) : 0;
    if (swing && !f.swing) {
      // lift off: the swing starts where the foot was
      f.sx = f.x;
      f.sz = f.z;
      f.sy = f.y;
      f.syaw = f.yaw;
    }
    // the landing spot: under the hip half a stance on, at the speed the body is really going
    const remain = (1 - us) * (1 - Ds) * cycle + Ds * cycle * 0.5;
    const look = Math.min(remain, 0.9);
    toWorld(r.x, r.z, tmp);
    let tx = tmp.x + vx * look, tz = tmp.z + vz * look;
    const tyaw = yaw + side * st.toeOut;
    if (swing) {
      // don't cross the other foot (sideways steps)
      const o = g.feet[1 - s];
      const olx = ((o.x - px) * cy - (o.z - pz) * sy) / h;
      let tlx = ((tx - px) * cy - (tz - pz) * sy) / h;
      const tlz = ((tx - px) * sy + (tz - pz) * cy) / h;
      if (side < 0 && tlx > olx - 0.09) tlx = olx - 0.09;
      if (side > 0 && tlx < olx + 0.09) tlx = olx + 0.09;
      toWorld(tlx, tlz, tmp);
      tx = tmp.x;
      tz = tmp.z;
      const e = minJerk(us);
      f.cx = f.sx + (tx - f.sx) * e;
      f.cz = f.sz + (tz - f.sz) * e;
      f.cyaw = f.syaw + wrapA(tyaw - f.syaw) * e;
      const gy = ground(f.cx, f.cz);
      const ty = ground(tx, tz);
      const base = f.sy + (ty - f.sy) * e;
      // clearance: a walk barely clears the ground; a run kicks the heel up behind
      const stepLen = Math.hypot(tx - f.sx, tz - f.sz);
      const lift = (0.07 + 0.05 * clamp01(stepLen / 0.8) + 0.3 * run) * st.lift * h * (i.speed > 0.12 || stepLen > 0.05 ? 1 : 0.5);
      const arc = Math.sin(Math.PI * Math.pow(us, 0.75));
      f.lift = lift * arc;
      f.cy = Math.max(gy, base) + f.lift;
      // the toe leaves pointed, comes level, then the heel reaches for the ground
      const push = 0.4 + 0.35 * run;
      const reachHeel = -0.22 * st.heel * (1 - 0.8 * smooth(4, 7, i.speed)) * clamp01(stepLen / 0.3);
      f.an = us < 0.35 ? push * (1 - us / 0.35) : reachHeel * smooth(0.45, 1, us);
      f.swing = true;
      f.x = tx;
      f.z = tz;
      f.y = ty;
      f.yaw = tyaw;
    } else {
      if (f.swing) {
        // touch down
        f.swing = false;
        g.landed = s;
      }
      // the foot stays where it is in the world; a treadmill moves the ground under it
      if (tread) {
        f.x -= ivx * dt;
        f.z -= ivz * dt;
      }
      // never stretched past the leg: if the body is carried off (a shove), the foot drags
      const lx = ((f.x - px) * cy - (f.z - pz) * sy) / h, lz = ((f.x - px) * sy + (f.z - pz) * cy) / h;
      const lim2 = reach * 0.8;
      const dl = Math.hypot(lx - side * width, lz);
      if (dl > lim2) {
        const kk = lim2 / dl;
        toWorld(side * width + (lx - side * width) * kk, lz * kk, tmp);
        f.x = tmp.x;
        f.z = tmp.z;
        // Dragging the foot back has to bring its height with it: pulling only
        // the horizontal left the sole at the unreachable terrain height it had
        // been aimed at, which on a slope put the ankle through the ground (or
        // in the air) and dragged the pelvis down after it.
        f.y = ground(f.x, f.z);
      }
      // heel to toe: flat after the strike, then the heel comes up over the ball
      const ust = u / Ds;
      const push = (0.35 + 0.3 * run) * (i.speed > 0.2 ? 1 : 0);
      f.an = ust < 0.12 ? -0.2 * st.heel * (1 - ust / 0.12) * clamp01(i.speed) : ust > 0.6 ? push * smooth(0.6, 1, ust) : 0;
      f.cx = f.x;
      f.cz = f.z;
      f.cy = f.y;
      f.cyaw = f.yaw;
      f.lift = 0;
      // is it where it should be? (at rest: stepping to keep up with a turn or a shift of weight)
      toWorld(r.x, r.z, tmp);
      const off = Math.hypot(tmp.x - f.x, tmp.z - f.z) / h;
      // A foot whose heading lags the body's (every turn) is not "far" — it's
      // just turning. Testing that made everyone take a corrective step on every
      // corner, which is what a fleet of tiny shuffling steps looks like.
      const tol = 0.13 - 0.05 * st.fidget;
      if (off > tol) anyFar = true;
    }
    if (s === 0) g.stanceL = swing ? 0 : 1;
    else g.stanceR = swing ? 0 : 1;
  }
  g.need = anyFar || g.feet[0].swing || g.feet[1].swing;

  /* ── pelvis height: stand as tall as the planted feet allow ── */
  const loc = (f: Foot) => {
    const dx = f.cx - px, dz = f.cz - pz;
    return { x: (dx * cy - dz * sy) / h, z: (dx * sy + dz * cy) / h, y: (f.cy - py) / h };
  };
  const L = loc(g.feet[0]), Rf = loc(g.feet[1]);
  // heel-toe: the ankle rises (and comes forward a touch) as the foot rolls onto the ball
  const ankleUp = (f: Foot) => (f.an > 0 ? BALL * Math.sin(f.an) : 0.06 * Math.sin(-f.an));
  const aL = { x: L.x, y: L.y + ANKLE + ankleUp(g.feet[0]), z: L.z + (g.feet[0].an > 0 ? BALL * (1 - Math.cos(g.feet[0].an)) : 0) };
  const aR = { x: Rf.x, y: Rf.y + ANKLE + ankleUp(g.feet[1]), z: Rf.z + (g.feet[1].an > 0 ? BALL * (1 - Math.cos(g.feet[1].an)) : 0) };

  // spring the pelvis sideways over whichever foot holds the weight
  const both = g.stanceL && g.stanceR;
  const wantX = both
    ? (i.speed < 0.2 ? (w > 0 ? aL.x : aR.x) * 0.25 * Math.abs(w) : 0)
    : (g.stanceL ? aL.x : aR.x) * 0.28 * st.hipSway * (1 - 0.6 * run);
  const kS = 60, dS = 2 * Math.sqrt(kS) * 0.8;
  // Explicit Euler on a stiff spring goes unstable on a long frame: a hitch of
  // 0.2 s is past the stability limit here (2/√k) and the hip snaps or rings.
  // Take fixed steps instead, so a dropped frame costs accuracy rather than
  // throwing the figure.
  springStep(dt, g.sx, g.sxv, wantX, kS, dS, (x, v) => {
    g.sx = x;
    g.sxv = v;
  });
  g.sx = clamp(g.sx, -0.05, 0.05);
  const pelX = g.sx;

  // standing knees are nearly straight; soft-kneed people and runners carry a bend
  const kneeBend = 0.05 + 0.3 * st.knee + 0.22 * run;
  const kneeSoft = Math.cos(kneeBend / 2);
  const hipH = (a: { x: number; y: number; z: number }, side: number) => {
    const hx = side * 0.088 * i.hips + pelX;
    const dh = Math.hypot(a.x - hx, a.z);
    const r = reach * kneeSoft;
    return a.y + Math.sqrt(Math.max(0.01, r * r - dh * dh)) + 0.02;
  };
  let P = Math.min(hipH(aL, -1), hipH(aR, 1), standP - 0.02 * st.knee);
  // running: sink into each stance, fly between
  if (run > 0) {
    let comp = 0;
    for (let s = 0; s < 2; s++) {
      const us = (u0 + (s === 0 ? 0 : 0.5)) % 1;
      if (us < D) comp = Math.max(comp, Math.sin((Math.PI * us) / D));
    }
    P -= (0.035 + 0.02 * run) * comp * run * st.bounce;
  }
  P -= 0.34 * i.crouch + 0.12 * i.land;

  /* ── the pelvis turns with the stride, drops on the swing side, banks into turns ── */
  const zDiff = aL.z - aR.z; // left foot ahead: +
  const moving = smooth(0.1, 0.6, i.speed);
  const liftK = (f: Foot) => (f.swing ? Math.min(1, f.lift / (0.1 * h)) : 0);
  const pelRy = 0.3 * zDiff * st.hipRot * (1 - 0.3 * run);
  const pelRz = st.hipDrop * (liftK(g.feet[0]) - liftK(g.feet[1])) * (1 - 0.4 * run) + 0.03 * (pelX / 0.05) * (1 - moving) + i.bank;
  const pelRx = 0.05 * run + 0.02 * moving;
  const pelZ = -0.06 * i.crouch;
  // the pelvis frame (YXZ, as the rig builds it), to aim the legs from where the hips really are
  const cY = Math.cos(pelRy), sY = Math.sin(pelRy), cX = Math.cos(pelRx), sX = Math.sin(pelRx), cZ = Math.cos(pelRz), sZ = Math.sin(pelRz);
  const toPelvis = (a: { x: number; y: number; z: number }) => {
    let x = a.x - pelX, y = a.y - P, z = a.z - pelZ;
    // Ry^T
    let x1 = x * cY - z * sY, z1 = x * sY + z * cY;
    x = x1;
    z = z1;
    // Rx^T
    const y1 = y * cX + z * sX;
    z1 = -y * sX + z * cX;
    y = y1;
    z = z1;
    // Rz^T
    x1 = x * cZ + y * sZ;
    const y2 = -x * sZ + y * cZ;
    return { x: x1, y: y2, z };
  };

  /* ── legs: reach each ankle ── */
  const leg = (a: { x: number; y: number; z: number }, side: -1 | 1, an: number, fyaw: number) => {
    const q = toPelvis(a);
    // from the hip; the leg's twist turns the whole leg, so aim from the untwisted frame
    let qx = q.x - side * 0.088 * i.hips, qy = q.y + 0.02, qz = q.z;
    const ry = wrapA(fyaw - yaw) - pelRy;
    const c = Math.cos(-ry), sn = Math.sin(-ry);
    const tx = qx * c + qz * sn, tz = -qx * sn + qz * c;
    qx = tx;
    qz = tz;
    let d = Math.hypot(qx, qy, qz);
    const A = Math.asin(clamp(qx / Math.max(1e-4, d), -0.9, 0.9));
    const phi = Math.atan2(qz, Math.max(1e-4, -qy));
    d = clamp(d, 0.25, reach * 0.9995);
    const ck = clamp((d * d - th * th - sh * sh) / (2 * th * sh), -1, 1);
    const kn = Math.acos(ck);
    const ca = clamp((th * th + d * d - sh * sh) / (2 * th * d), -1, 1);
    const f = phi + Math.acos(ca);
    const Ls = side < 0;
    p[Ls ? C.hipLf : C.hipRf] = f;
    p[Ls ? C.knL : C.knR] = kn;
    p[Ls ? C.hipLab : C.hipRab] = side * A - 0.02;
    p[Ls ? C.hipLtw : C.hipRtw] = side * ry;
    p[Ls ? C.anL : C.anR] = an;
  };
  leg(aL, -1, g.feet[0].an, g.feet[0].cyaw);
  leg(aR, 1, g.feet[1].an, g.feet[1].cyaw);
  // make the rig's pelvis land exactly at P (it stands on the longer leg)
  const hL = legHeight(p[C.hipLf], p[C.knL], p[C.hipLab], th, sh), hR = legHeight(p[C.hipRf], p[C.knR], p[C.hipRab], th, sh);
  p[C.pelY] = P - Math.max(hL, hR);
  p[C.pelX] = pelX;
  p[C.pelZ] = pelZ;
  p[C.pelRy] = pelRy;
  p[C.pelRz] = pelRz;
  p[C.pelRx] = pelRx;

  /* ── the body over the legs ── */
  const counter = -pelRy * (1.35 + 0.4 * run) * st.torso;
  p[C.spRy] = counter;
  p[C.spRz] = -(pelRz - i.bank) * 0.55;
  out.run = run;
  out.lean = st.lean * (0.5 + 0.5 * moving) + (0.16 + 0.06 * smooth(4.5, 7, i.speed)) * run * Math.cos(i.moveDir) - pelRx * 0.6;

  // the head held steady against all that
  const steady = st.steady;
  p[C.nkRy] -= (p[C.pelRy] + p[C.spRy]) * steady;
  p[C.nkRz] -= (p[C.pelRz] + p[C.spRz]) * steady * 0.8;

  /* ── arms: against the legs, on springs ── */
  const gain = (0.6 + 1.1 * run) * st.arm * moving;
  const tL = -zDiff * gain * (1 + 0.25 * st.armAsym), tR = zDiff * gain * (1 - 0.25 * st.armAsym);
  const kA = 90 + 60 * run, dA = 2 * Math.sqrt(kA) * 0.55;
  springStep(dt, g.aL, g.aLv, tL, kA, dA, (x, vv) => {
    g.aL = x;
    g.aLv = vv;
  });
  springStep(dt, g.aR, g.aRv, tR, kA, dA, (x, vv) => {
    g.aR = x;
    g.aRv = vv;
  });
  out.armL = clamp(g.aL, -1.1, 1.4);
  out.armR = clamp(g.aR, -1.1, 1.4);
  // the elbow folds more on the forward swing, and a lot when running
  out.elL = 0.25 * Math.max(0, out.armL) + 0.05 * Math.abs(g.aLv) * 0.1;
  out.elR = 0.25 * Math.max(0, out.armR) + 0.05 * Math.abs(g.aRv) * 0.1;
  void v;
}

/**
 * Standing still is never frozen: the body sways a centimetre or two over its
 * feet, the head drifts and settles, more for the tired and the old, much
 * less for someone who means to be still.
 */
export function postureSway(p: Pose, g: GaitState, t: number, st: GaitStyle, rest: number) {
  if (rest <= 0) return;
  const s = g.seed;
  const n = (f: number, o: number) => Math.sin(t * f + s * o) * 0.6 + Math.sin(t * f * 2.31 + s * o * 1.7) * 0.3 + Math.sin(t * f * 0.43 + s * o * 0.3) * 0.4;
  const a = st.sway * (1 - 0.85 * st.still) * rest;
  p[C.pelX] += 0.006 * a * n(0.37, 1);
  p[C.pelZ] += 0.005 * a * n(0.29, 2);
  p[C.spRx] += 0.012 * a * n(0.23, 3);
  p[C.spRz] += 0.01 * a * n(0.31, 4);
  p[C.nkRx] += 0.02 * a * n(0.41, 5);
  p[C.nkRy] += 0.03 * a * n(0.19, 6) * (0.5 + st.fidget);
  p[C.nkRz] += 0.015 * a * n(0.27, 7);
}

/* ─────────────────────────── momentum ─────────────────────────── */

/** A speed that changes the way a body's does: limited acceleration, quicker to brake. */
export function approach(v: number, want: number, dt: number, accel = 2.6, decel = 4.5) {
  const a = want > v ? accel : decel;
  const d = want - v;
  const step = a * dt;
  return Math.abs(d) <= step ? want : v + Math.sign(d) * step;
}

/**
 * How far to turn this frame toward `want`: quick at a standstill (a pivot on
 * the spot), wider arcs the faster someone goes, eased at the end so it
 * doesn't stop dead.
 */
export function turnToward(yaw: number, want: number, v: number, dt: number) {
  const d = Math.atan2(Math.sin(want - yaw), Math.cos(want - yaw));
  const max = (v < 0.5 ? 5.5 : 4.2 - Math.min(2.6, v * 0.45)) * dt;
  const eased = d * Math.min(1, dt * 7);
  return Math.abs(eased) < max ? eased : Math.sign(d) * max;
}
