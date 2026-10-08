/**
 * NIGHTFALL: ragdolls.
 *
 * A body made of a handful of point masses joined by distance constraints,
 * integrated with Verlet and pulled to the ground each step. It exists for one
 * job: when something hits someone hard enough to kill them, they should fall
 * like a person and not like a dropped statue.
 *
 * Design notes:
 *   - Verlet with substeps, because a single 60 Hz step on a stiff chain is
 *     soft and explodes at 20 Hz. Two substeps per frame is enough.
 *   - Constraints are solved in alternating order (Gauss-Seidel), a few
 *     iterations, which converges fast enough for 14 bones and never blows up
 *     regardless of how hard it was hit.
 *   - The pelvis is pulled toward the ground with a spring and clamped above it,
 *     so a body settles and stays settled instead of sinking.
 *   - Collision is against the same box list the rest of the game uses, plus
 *     spheres for the limbs so a body drapes over kerbs instead of clipping.
 *
 * The bones are named for the rig they drive, so `Ragdoll` can hand its joint
 * positions straight to Humanoid's pose channels.
 */

import * as THREE from 'three';
import type { Collision } from '../world/Collision';
import { C, newPose, type Pose } from './pose';
import { J, type Body } from '../entities/Humanoid';

const _pose = newPose();

/** Bones a ragdoll has, in a fixed order so the pose arrays line up. */
export const BONES = [
  'hips', // 0: the pelvis — the root of the chain
  'chest',
  'neck',
  'headL',
  'shoulderL',
  'elbowL',
  'wristL',
  'shoulderR',
  'elbowR',
  'wristR',
  'hipL',
  'kneeL',
  'ankleL',
  'hipR',
  'kneeR',
  'ankleR',
] as const;
export type BoneName = (typeof BONES)[number];
export const BONE_N = BONES.length;

/** Which bone each constraint holds together, and how long it wants to be. */
const LINKS: [number, number, number][] = [
  // spine and head
  [0, 1, 0.08], // hips → chest
  [1, 2, 0.44], // chest → neck
  [2, 3, 0.13], // neck → head
  // arms (each side: shoulder, elbow)
  [1, 4, 0.19], // chest → shoulderL
  [4, 5, 0.28], // shoulderL → elbowL
  [5, 6, 0.25], // elbowL → wristL
  [1, 7, 0.19],
  [7, 8, 0.28],
  [8, 9, 0.25],
  // legs
  [0, 10, 0.02], // hips → hipL (the hip joint is nearly at the pelvis)
  [10, 11, 0.43], // hipL → kneeL
  [11, 12, 0.42], // kneeL → ankleL
  [0, 13, 0.02],
  [13, 14, 0.43],
  [14, 15, 0.42],
];

/** Bones that can't pass through the ground below a certain height. */
const FOOT_BONES = [12, 15];

const GRAVITY = -19;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
/** a body mass spread over its points, so impulses can be tuned in m/s */
const SUBSTEPS = 2;
const ITER = 6;
/** how hard the ground pushes back on a bone that is inside something */
const SKIN = 0.09;

/** What the ragdoll hands the pose solver: joint angles, not bone positions. */
export interface RagPose {
  /** [spine pitch, twist, roll] */
  spine: number[];
  /** [forward, abduction, twist] for each limb */
  legL: number[];
  legR: number[];
  armL: number[];
  armR: number[];
  kneeL: number[];
  kneeR: number[];
  elbowL: number[];
  elbowR: number[];
}

export const newRagPose = (): RagPose => ({
  spine: [0, 0, 0],
  legL: [0, 0, 0],
  legR: [0, 0, 0],
  armL: [0, 0, 0],
  armR: [0, 0, 0],
  kneeL: [0],
  kneeR: [0],
  elbowL: [0],
  elbowR: [0],
});

export class Ragdoll {
  /** current world position of each bone */
  readonly p: Float32Array;
  /** previous position: Verlet's velocity store */
  private q: Float32Array;
  /** metres, per bone */
  readonly len: Float32Array;
  /** what the pose should read: the same order as BONES */
  alive = false;
  /** counts down while the body comes to rest, then it is left where it lies */
  rest = 0;
  /** which way the body ended up lying, so the pose can be read in its frame */
  yaw = 0;
  private coll: Collision | null = null;
  /** shrink the pose over the body's own length (bodies vary in size) */
  private scale = 1;

  constructor(lenScale = 1) {
    this.p = new Float32Array(BONE_N * 3);
    this.q = new Float32Array(BONE_N * 3);
    this.len = new Float32Array(LINKS.length);
    for (let i = 0; i < LINKS.length; i++) this.len[i] = LINKS[i][2] * lenScale;
    this.scale = lenScale;
  }

  /**
   * Take the body's joint positions from a solved rig and hit it. `root` is the
   * figure's root matrix as the rig built it, so the ragdoll starts from exactly
   * the pose the figure was in.
   */
  launch(root: THREE.Matrix4, b: Body, from: THREE.Vector3, force: number) {
    const put = (n: number, m: THREE.Matrix4) => {
      const e = m.elements;
      this.p[n * 3] = e[12];
      this.p[n * 3 + 1] = e[13];
      this.p[n * 3 + 2] = e[14];
    };
    put(0, J.pelvis);
    put(1, J.chest);
    put(2, J.neck);
    put(3, J.neck);
    // the head sits above the neck joint, not on it
    this.p[3 * 3] += (J.neck.elements[8] - J.neck.elements[12]) * 0;
    this.p[3 * 3 + 1] = J.neck.elements[13] + 0.16 * (b.height ?? 1);
    this.p[3 * 3 + 2] = J.neck.elements[14];
    put(4, J.shL);
    put(5, J.elL);
    put(6, J.wrL);
    put(7, J.shR);
    put(8, J.elR);
    put(9, J.wrR);
    put(10, J.hipL);
    put(11, J.knL);
    put(12, J.anL);
    put(13, J.hipR);
    put(14, J.knR);
    put(15, J.anR);
    this.yaw = Math.atan2(root.elements[8], root.elements[10]);

    // the throw: away from whatever hit them, and up
    const ax = this.p[0], az = this.p[2];
    let ux = ax - from.x, uz = az - from.z;
    const ul = Math.hypot(ux, uz) || 1;
    ux /= ul;
    uz /= ul;
    const f = Math.min(1, force / 10);
    // Verlet stores velocity as a position delta, so this is speed × one frame
    const dt = 1 / 60;
    for (let i = 0; i < BONE_N; i++) {
      const j = i * 3;
      // the far end of the body whips further than the hips
      const lever = Math.hypot(this.p[j] - ax, this.p[j + 1] - this.p[1], this.p[j + 2] - az) * 0.55;
      const spinA = new THREE.Vector3(0.2 + Math.random() * 0.6, Math.random() * 0.5 - 0.25, 0.2 + Math.random() * 0.6).normalize();
      const arm = new THREE.Vector3(this.p[j] - ax, this.p[j + 1] - this.p[1], this.p[j + 2] - az);
      const tang = new THREE.Vector3().crossVectors(spinA, arm);
      this.q[j] = this.p[j] - (ux * (2 + f * 7) * dt + tang.x * f * 0.9 * dt * lever) * (0.5 + lever * 0.5);
      this.q[j + 1] = this.p[j + 1] - (1.4 + f * 4.5) * dt;
      this.q[j + 2] = this.p[j + 2] - (uz * (2 + f * 7) * dt + tang.z * f * 0.9 * dt * lever) * (0.5 + lever * 0.5);
    }
    this.alive = true;
    this.rest = 0;
  }

  /** Give the body a world it can hit: the city's boxes. */
  setCollision(c: Collision) {
    this.coll = c;
  }

  /** One frame. Returns true while the body is still moving. */
  step(dt: number, ground: (x: number, z: number) => number): boolean {
    if (!this.alive) return false;
    const h = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) this.sub(h, ground);
    // has it stopped?
    let e = 0;
    for (let i = 0; i < BONE_N; i++) {
      const j = i * 3;
      e += Math.abs(this.p[j] - this.q[j]) + Math.abs(this.p[j + 1] - this.q[j + 1]) + Math.abs(this.p[j + 2] - this.q[j + 2]);
    }
    if (e < 0.002) {
      this.rest += dt;
      if (this.rest > 0.6) {
        this.alive = false;
        return false;
      }
    } else this.rest = 0;
    return true;
  }

  private sub(dt: number, ground: (x: number, z: number) => number) {
    const p = this.p, q = this.q;
    // integrate
    for (let i = 0; i < BONE_N; i++) {
      const j = i * 3;
      for (let k = 0; k < 3; k++) {
        const c = j + k;
        const v = (p[c] - q[c]) * 0.995; // a little air drag
        q[c] = p[c];
        p[c] += v;
      }
      p[j + 1] += GRAVITY * dt * dt;
    }
    // constraints, alternating direction each iteration so it doesn't creep
    for (let it = 0; it < ITER; it++) {
      const back = (it & 1) === 1;
      for (let n = 0; n < LINKS.length; n++) {
        const ci = back ? LINKS.length - 1 - n : n;
        const [a, b, rest] = LINKS[ci];
        const ja = a * 3, jb = b * 3;
        const dx = p[jb] - p[ja], dy = p[jb + 1] - p[ja + 1], dz = p[jb + 2] - p[ja + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const want = this.len[ci];
        const diff = (d - want) / d;
        // the hips are the anchor and don't move
        const wa = a === 0 ? 0 : 0.5, wb = a === 0 ? 1 : 0.5;
        p[ja] += dx * diff * wa;
        p[ja + 1] += dy * diff * wa;
        p[ja + 2] += dz * diff * wa;
        p[jb] -= dx * diff * wb;
        p[jb + 1] -= dy * diff * wb;
        p[jb + 2] -= dz * diff * wb;
      }
      this.collide(p, ground);
    }
  }

  /** Push every bone out of the ground and out of the boxes. */
  private collide(p: Float32Array, ground: (x: number, z: number) => number) {
    for (let i = 0; i < BONE_N; i++) {
      const j = i * 3;
      // ground: the feet and knees can't go through, the rest can't sink far
      const g = ground(p[j], p[j + 2]);
      const floor = FOOT_BONES.includes(i) ? g + SKIN : g + SKIN * 0.5;
      if (p[j + 1] < floor) {
        p[j + 1] = floor;
        // friction against the ground, and kill the bounce
        const q = this.q;
        p[j] -= (p[j] - q[j]) * 0.35;
        p[j + 2] -= (p[j + 2] - q[j + 2]) * 0.35;
        q[j + 1] = p[j + 1];
      }
      // boxes
      if (!this.coll) continue;
      const t = _v.set(p[j], p[j + 1], p[j + 2]);
      const before = _b.set(p[j], p[j + 1], p[j + 2]);
      this.coll.resolve(t, SKIN, SKIN * 2, SKIN);
      if (before.distanceToSquared(t) > 1e-8) {
        p[j] = t.x;
        p[j + 2] = t.z;
        // a bone stopped by a wall loses its velocity into it
        this.q[j] = p[j] + (p[j] - this.q[j]) * 0.5;
        this.q[j + 2] = p[j + 2] + (p[j + 2] - this.q[j + 2]) * 0.5;
      }
    }
  }

  /**
   * A root matrix for the body, from its hips and the direction of its spine.
   * The rig is built around the pelvis, so this is what the pose is solved at.
   */
  root(out: THREE.Matrix4, yaw: number, scale: number): THREE.Matrix4 {
    return out.compose(_v.set(this.p[0], this.p[1], this.p[2]), _q.setFromAxisAngle(_up, yaw), _s.setScalar(scale));
  }

  /** Where the head ended up, for blood and for finding the body. */
  headPos(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.p[9], this.p[10], this.p[11]);
  }

  /**
   * The ragdoll's limbs as the rig's pose channels want them: two-bone IK from
   * each joint to where its bone actually ended up, expressed in the root's
   * frame. This is what makes a flung body sprawl instead of standing in the
   * pose the walk solver left behind.
   */
  pose(out: Pose, b: Body) {
    const legLen = b.legLen ?? 1, armLen = b.armLen ?? 1;
    const th = 0.43 * legLen, sh = 0.42 * legLen;
    const up = 0.28 * armLen, fo = 0.25 * armLen;
    const cy = Math.cos(-this.yaw), sy = Math.sin(-this.yaw);

    // spine: pitch and roll of the chest relative to the hips
    const fx = this.p[3] - this.p[0], fy = this.p[4] - this.p[1], fz = this.p[5] - this.p[2];
    out[C.spRx] = clamp(Math.atan2(fx * cy + fz * sy, -fy), -1.2, 1.2);
    out[C.spRz] = clamp(Math.atan2(-(fx * sy - fz * cy), -fy), -1.2, 1.2);

    const limb = (root: number, mid: number, tip: number, d1: number, d2: number, fwd: number, ab: number, tw: number, bend: number) => {
      const a = root * 3, b = mid * 3, c = tip * 3;
      // target relative to the joint, rotated into the root's frame
      const tx = this.p[c] - this.p[a], ty = this.p[c + 1] - this.p[a + 1], tz = this.p[c + 2] - this.p[a + 2];
      const x1 = tx * cy - tz * sy, z1 = tx * sy + tz * cy;
      let d = Math.hypot(x1, ty, z1);
      const abd = Math.asin(clamp(x1 / Math.max(1e-4, d), -0.95, 0.95));
      const phi = Math.atan2(z1, Math.max(1e-4, -ty));
      d = clamp(d, Math.abs(d1 - d2) + 0.02, (d1 + d2) * 0.999);
      out[bend] = Math.acos(clamp((d * d - d1 * d1 - d2 * d2) / (2 * d1 * d2), -1, 1));
      out[fwd] = phi + Math.acos(clamp((d1 * d1 + d * d - d2 * d2) / (2 * d1 * d), -1, 1));
      out[ab] = abd;
      // and the twist, so the sole or the palm isn't left pointing at the sky
      const ux = this.p[b] - this.p[a], uz = this.p[b + 2] - this.p[a + 2];
      out[tw] = Math.atan2(ux * sy - uz * cy, ux * cy + uz * sy);
    };
    limb(0, 10, 12, th, sh, C.hipLf, C.hipLab, C.hipLtw, C.knL);
    limb(0, 13, 15, th, sh, C.hipRf, C.hipRab, C.hipRtw, C.knR);
    limb(1, 4, 6, up, fo, C.shLf, C.shLab, C.shLtw, C.elL);
    limb(1, 7, 9, up, fo, C.shRf, C.shRab, C.shRtw, C.elR);
  }

  /**
   * The pose and body as plain arrays, for callers that hold their own pose
   * rather than a Float32Array of channels.
   */
  poseChannels(out: RagPose, legLen: number, armLen: number) {
    this.pose(_pose, { legLen, armLen, height: this.scale } as Body);
    out.spine[0] = _pose[C.spRx];
    out.spine[1] = _pose[C.spRy];
    out.spine[2] = _pose[C.spRz];
    out.legL[0] = _pose[C.hipLf];
    out.legL[1] = _pose[C.hipLab];
    out.legL[2] = _pose[C.hipLtw];
    out.legR[0] = _pose[C.hipRf];
    out.legR[1] = _pose[C.hipRab];
    out.legR[2] = _pose[C.hipRtw];
    out.armL[0] = _pose[C.shLf];
    out.armL[1] = _pose[C.shLab];
    out.armL[2] = _pose[C.shLtw];
    out.armR[0] = _pose[C.shRf];
    out.armR[1] = _pose[C.shRab];
    out.armR[2] = _pose[C.shRtw];
    out.kneeL[0] = _pose[C.knL];
    out.kneeR[0] = _pose[C.knR];
    out.elbowL[0] = _pose[C.elL];
    out.elbowR[0] = _pose[C.elR];
  }
  hipsPos(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.p[0], this.p[1], this.p[2]);
  }
}

const _v = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);