import { defineClip, type Ease, type Key } from './Animator';
import type { Channel } from './pose';
import './actions';

/**
 * The animation library: every authored movement in the game.
 *
 * Clips key only the channels they move; the procedural base pose (walking,
 * standing, breathing) fills in the rest, and fades blend them in and out.
 * Keys are written the way an animator blocks a shot: anticipation, the
 * action, follow-through, settle. Times are seconds.
 *
 * Conventions are in pose.ts. Grip: 0 relaxed, 1 fist, 2 point, 3 thumb, 4 open.
 */

type P = Partial<Record<Channel, number>>;
const k = (t: number, p: P, e?: Ease, ev?: string): Key => ({ t, p, e, ev });

/** right arm: forward, out, elbow, forearm in/out, wrist, grip */
const R = (f: number, ab: number, el: number, tw = 0, wr = 0.08, grip?: number): P => ({ shRf: f, shRab: ab, elR: el, elRtw: tw, wrR: wr, ...(grip != null ? { gripR: grip } : {}) });
const L = (f: number, ab: number, el: number, tw = 0, wr = 0.08, grip?: number): P => ({ shLf: f, shLab: ab, elL: el, elLtw: tw, wrL: wr, ...(grip != null ? { gripL: grip } : {}) });
const B = (f: number, ab: number, el: number, tw = 0, wr = 0.08, grip?: number): P => ({ ...L(f, ab, el, tw, wr, grip), ...R(f, ab, el, tw, wr, grip) });
const RN = R(0, 0.18, 0.3, -0.35, 0.08, 0);
const LN = L(0, 0.18, 0.3, -0.35, 0.08, 0);
const HN: P = { nkRx: 0, nkRy: 0, nkRz: 0 };
const ALL_N: P = { ...RN, ...LN, ...HN, spRx: 0.04, spRy: 0, spRz: 0 };

/* ═══════════════════════════ idles ═══════════════════════════ */
// People doing nothing in particular. Picked by the IdleDirector, weighted
// by who they are and where they're standing.

defineClip({ name: 'idle.checkWatch', dur: 3.4, mask: 'upper', keys: [
  k(0, { ...LN, nkRx: 0, nkRy: 0 }),
  k(0.18, { shLf: 0.08, elL: 0.45 }),
  k(0.55, { ...L(0.62, 0.1, 1.75, -0.9, -0.25), nkRx: 0.28, nkRy: -0.12 }, 'out'),
  k(0.8, { nkRx: 0.5, nkRy: -0.2 }),
  k(1.95, { ...L(0.64, 0.1, 1.78, -0.92, -0.22), nkRx: 0.52, nkRy: -0.2 }),
  k(2.55, { ...LN, nkRx: 0.02, nkRy: 0.22 }),
  k(3.4, { nkRx: 0, nkRy: 0 }),
] });

defineClip({ name: 'idle.checkPhone', dur: 6.2, mask: 'upper', props: ['phone'], keys: [
  k(0, { ...RN, ...LN, nkRx: 0 }),
  k(0.65, { ...R(0.42, 0.08, 1.75, 0.35, -0.2), ...L(0.32, 0.1, 1.55, 0.62, 0), nkRx: 0.45 }, 'out'),
  k(1.3, { wrR: -0.12 }),
  k(1.55, { wrR: -0.26 }),
  k(2.5, { wrR: -0.12, nkRx: 0.48 }),
  k(2.75, { wrR: -0.24 }),
  k(3.9, { wrR: -0.16, nkRy: 0.05 }),
  k(4.9, { ...R(0.42, 0.08, 1.72, 0.35, -0.2), ...L(0.3, 0.1, 1.5, 0.6, 0), nkRx: 0.42, nkRy: 0 }),
  k(5.5, { ...RN, ...LN, nkRx: 0.05 }),
  k(6.2, { nkRx: 0 }),
] });

defineClip({ name: 'idle.lookStreet', dur: 4.6, mask: 'upper', keys: [
  k(0, { nkRy: 0, nkRx: 0, spRy: 0 }),
  k(1.1, { nkRy: 0.85, nkRx: -0.04, spRy: 0.18 }),
  k(2.7, { nkRy: 0.8, nkRx: -0.02, spRy: 0.16 }),
  k(3.4, { nkRy: 0.35, spRy: 0.06 }),
  k(4.6, { nkRy: 0, nkRx: 0, spRy: 0 }),
] });

defineClip({ name: 'idle.lookAround', dur: 5.2, mask: 'upper', keys: [
  k(0, { nkRy: 0, nkRx: 0, spRy: 0 }),
  k(0.9, { nkRy: 0.72, nkRx: -0.05, spRy: 0.15 }),
  k(1.9, { nkRy: 0.68, nkRx: 0.03 }),
  k(2.9, { nkRy: -0.78, nkRx: -0.03, spRy: -0.16 }),
  k(3.9, { nkRy: -0.72, nkRx: 0.02 }),
  k(5.2, { nkRy: 0, nkRx: 0, spRy: 0 }),
] });

defineClip({ name: 'idle.scan', dur: 6, mask: 'upper', keys: [
  k(0, { nkRy: 0, spRy: 0, nkRx: 0 }),
  k(1.2, { nkRy: -0.65, spRy: -0.2, nkRx: -0.03 }),
  k(2.4, { nkRy: -0.62, spRy: -0.2 }),
  k(3.8, { nkRy: 0.62, spRy: 0.2 }),
  k(4.8, { nkRy: 0.58, spRy: 0.18 }),
  k(6, { nkRy: 0, spRy: 0, nkRx: 0 }),
] });

defineClip({ name: 'idle.shift', dur: 3.2, mask: 'legs', keys: [
  k(0, { pelX: 0, pelRz: 0, knR: 0.05, knL: 0.05 }),
  k(1.1, { pelX: -0.035, pelRz: 0.04, knR: 0.28, knL: 0.02, hipRf: 0.08 }),
  k(2.2, { pelX: -0.032, pelRz: 0.035, knR: 0.26, knL: 0.03, hipRf: 0.07 }),
  k(3.2, { pelX: 0, pelRz: 0, knR: 0.05, knL: 0.05, hipRf: 0 }),
] });

defineClip({ name: 'idle.footTap', dur: 2.6, mask: 'legs', keys: [
  k(0, { anR: 0, knR: 0.05 }),
  k(0.2, { anR: 0.28, knR: 0.12 }), k(0.4, { anR: 0 }),
  k(0.6, { anR: 0.28 }), k(0.8, { anR: 0 }),
  k(1.0, { anR: 0.28 }), k(1.2, { anR: 0 }),
  k(1.4, { anR: 0.28 }), k(1.6, { anR: 0 }),
  k(2.6, { anR: 0, knR: 0.05 }),
] });

defineClip({ name: 'idle.adjust', dur: 2.3, mask: 'upper', keys: [
  k(0, { ...RN, ...LN }),
  k(0.45, { ...R(0.48, 0.1, 1.35, 0.85, 0, 1), ...L(0.48, 0.1, 1.35, 0.85, 0, 1), nkRx: 0.25 }, 'out'),
  k(0.75, { ...R(0.3, 0.12, 1.1, 0.75, 0.2, 1), ...L(0.3, 0.12, 1.1, 0.75, 0.2, 1), spRx: 0.08, shLup: 0.3, shRup: 0.3 }),
  k(1.05, { shLup: 0, shRup: 0, spRx: 0.02, nkRx: 0.05 }),
  k(1.5, { ...R(0.2, 0.15, 0.8, 0.2, 0.1, 0), ...L(0.2, 0.15, 0.8, 0.2, 0.1, 0) }),
  k(2.3, { ...RN, ...LN, nkRx: 0 }),
] });

defineClip({ name: 'idle.fixHair', dur: 2.7, mask: 'upper', keys: [
  k(0, { ...RN, nkRx: 0 }),
  k(0.2, { shRf: 0.15, elR: 0.6 }),
  k(0.7, { ...R(1.45, 0.72, 2.3, 0.9, 0.1, 4), nkRx: 0.08 }, 'out'),
  k(1.25, { ...R(1.2, 1.05, 2.1, 0.5, 0.35, 4), nkRx: -0.12 }),
  k(1.6, { ...R(1.15, 1.0, 2.0, 0.4, 0.3, 4) }),
  k(2.2, { ...R(0.2, 0.3, 0.7, -0.2, 0.08, 0), nkRx: 0 }),
  k(2.7, RN),
] });

defineClip({ name: 'idle.scratchHead', dur: 2.9, mask: 'upper', keys: [
  k(0, { ...RN, nkRz: 0, nkRx: 0 }),
  k(0.7, { ...R(1.3, 0.95, 2.4, 0.7, 0.1, 0), nkRz: 0.1, nkRx: 0.08 }, 'out'),
  k(0.9, { wrR: 0.3 }), k(1.08, { wrR: -0.1 }), k(1.26, { wrR: 0.3 }), k(1.44, { wrR: -0.1 }), k(1.62, { wrR: 0.25 }),
  k(2.2, { ...R(0.3, 0.4, 0.9, 0, 0.08, 0), nkRz: 0.04 }),
  k(2.9, { ...RN, nkRz: 0, nkRx: 0 }),
] });

defineClip({ name: 'idle.rubHands', dur: 3.4, mask: 'upper', keys: [
  k(0, { ...RN, ...LN }),
  k(0.5, { ...R(0.55, 0.08, 1.5, 0.95, 0, 4), ...L(0.55, 0.08, 1.5, 0.95, 0, 4), nkRx: 0.12 }, 'out'),
  k(0.7, { elR: 1.62, elL: 1.42, shRf: 0.6 }), k(0.9, { elR: 1.42, elL: 1.62, shRf: 0.52 }),
  k(1.1, { elR: 1.62, elL: 1.42, shRf: 0.6 }), k(1.3, { elR: 1.42, elL: 1.62, shRf: 0.52 }),
  k(1.5, { elR: 1.62, elL: 1.42 }), k(1.7, { elR: 1.45, elL: 1.6 }),
  // and a breath into them
  k(2.2, { ...R(0.95, 0.1, 2.15, 0.95, 0, 4), ...L(0.95, 0.1, 2.15, 0.95, 0, 4), nkRx: 0.2, shLup: 0.3, shRup: 0.3 }),
  k(2.7, { ...R(0.9, 0.1, 2.1, 0.95, 0, 4), ...L(0.9, 0.1, 2.1, 0.95, 0, 4), shLup: 0.1, shRup: 0.1 }),
  k(3.4, { ...RN, ...LN, nkRx: 0, shLup: 0, shRup: 0 }),
] });

defineClip({ name: 'idle.crossArms', dur: 6.5, mask: 'upper', keys: [
  k(0, { ...RN, ...LN, shLup: 0 }),
  k(0.6, { ...L(0.42, 0.3, 1.95, 1.2, 0.1), ...R(0.46, 0.33, 1.9, 1.28, 0.1), shLup: 0.15, shRup: 0.1, spRx: 0.0 }, 'out'),
  k(3.2, { ...L(0.44, 0.31, 1.97, 1.2, 0.12), ...R(0.47, 0.33, 1.92, 1.28, 0.12), shLup: 0.2, nkRz: 0.04 }),
  k(5.8, { ...L(0.42, 0.3, 1.95, 1.2, 0.1), ...R(0.46, 0.33, 1.9, 1.28, 0.1), shLup: 0.12, nkRz: 0 }),
  k(6.5, { ...RN, ...LN, shLup: 0, shRup: 0 }),
] });

defineClip({ name: 'idle.handsHips', dur: 5, mask: 'upper', keys: [
  k(0, { ...RN, ...LN, spRx: 0.04 }),
  k(0.55, { ...L(-0.15, 0.62, 1.55, -1.1, 0.45, 1), ...R(-0.15, 0.62, 1.55, -1.1, 0.45, 1), spRx: -0.04 }, 'out'),
  k(4.4, { ...L(-0.16, 0.6, 1.52, -1.1, 0.45, 1), ...R(-0.15, 0.63, 1.56, -1.1, 0.45, 1), spRx: -0.03, nkRy: 0.1 }),
  k(5, { ...RN, ...LN, spRx: 0.04, nkRy: 0 }),
] });

defineClip({ name: 'idle.stretch', dur: 4.2, mask: 'upper', keys: [
  k(0, { ...RN, ...LN, spRx: 0.04, nkRx: 0 }),
  k(0.3, { ...B(0.5, 0.2, 1.2, 0.4, 0, 1), spRx: 0.1 }),
  k(0.95, { ...B(2.85, 0.28, 0.35, 0.3, -0.2, 4), spRx: -0.2, nkRx: -0.32, shLup: 0.8, shRup: 0.8 }, 'out'),
  k(1.9, { ...B(2.95, 0.22, 0.25, 0.3, -0.25, 4), spRx: -0.24, nkRx: -0.36 }),
  k(2.5, { spRz: 0.12, spRx: -0.18 }),
  k(3.0, { ...B(1.2, 0.5, 1.0, 0, 0.1, 0), spRz: 0, spRx: 0.02, shLup: 0, shRup: 0, nkRx: 0.05 }, 'in'),
  k(4.2, { ...RN, ...LN, spRx: 0.04, nkRx: 0 }),
] });

defineClip({ name: 'idle.yawn', dur: 3.6, mask: 'upper', keys: [
  k(0, { ...RN, nkRx: 0, jaw: 0, blink: 0, shLup: 0, shRup: 0 }),
  k(0.55, { nkRx: -0.2, jaw: 0.6, shLup: 0.35, shRup: 0.35, blink: 0.6 }),
  k(0.85, { ...R(1.1, 0.2, 2.25, 0.85, -0.3, 1), nkRx: -0.28, jaw: 1, blink: 1 }, 'out'),
  k(2.0, { ...R(1.08, 0.2, 2.25, 0.85, -0.3, 1), nkRx: -0.24, jaw: 0.9, blink: 1 }),
  k(2.6, { ...R(0.4, 0.2, 1.0, 0, 0.08, 0), jaw: 0, blink: 0, nkRx: 0.05, shLup: 0, shRup: 0 }),
  k(3.6, { ...RN, nkRx: 0 }),
] });

defineClip({ name: 'idle.rubEyes', dur: 2.9, mask: 'upper', keys: [
  k(0, { ...RN, ...LN, nkRx: 0, blink: 0 }),
  k(0.6, { ...R(1.15, 0.28, 2.35, 0.95, 0.1, 1), ...L(1.12, 0.3, 2.35, 0.95, 0.1, 1), nkRx: 0.22, blink: 1 }, 'out'),
  k(0.8, { wrR: 0.3, wrL: -0.1 }), k(1.0, { wrR: -0.05, wrL: 0.25 }), k(1.2, { wrR: 0.3, wrL: -0.1 }), k(1.4, { wrR: 0.05, wrL: 0.2 }),
  k(2.0, { ...RN, ...LN, nkRx: 0.1, blink: 0 }),
  k(2.9, { nkRx: 0 }),
] });

defineClip({ name: 'idle.slump', dur: 7, mask: 'upper', keys: [
  k(0, { spRx: 0.04, nkRx: 0, shLup: 0, shRup: 0 }),
  // a sigh
  k(0.8, { shLup: 0.45, shRup: 0.45, spRx: -0.02, nkRx: -0.1 }),
  k(1.8, { shLup: 0, shRup: 0, spRx: 0.2, nkRx: 0.35, ...B(0.05, 0.14, 0.35, -0.2) }, 'out'),
  k(5.8, { spRx: 0.22, nkRx: 0.38 }),
  k(7, { spRx: 0.04, nkRx: 0, ...RN, ...LN }),
] });

defineClip({ name: 'idle.smoke', dur: 6.4, mask: 'upper', props: ['ember'], keys: [
  k(0, { ...RN, nkRx: 0 }),
  k(0.9, { ...R(0.62, -0.15, 2.35, 0.5, 0, 0), nkRx: 0.02 }, 'out'),
  k(1.9, { ...R(0.62, -0.15, 2.38, 0.52, 0, 0), nkRx: -0.03 }),
  k(2.6, { ...R(0.22, 0.12, 1.3, 0.3, 0.1, 0), nkRx: -0.18 }),
  // exhale, head back a little
  k(3.4, { nkRx: -0.22, nkRy: 0.2 }),
  k(4.6, { ...R(0.18, 0.12, 1.25, 0.3, 0.1, 0), nkRx: 0.02, nkRy: 0.1 }),
  k(6.4, { ...RN, nkRx: 0, nkRy: 0 }),
] });

defineClip({ name: 'idle.drink', dur: 4, mask: 'upper', props: ['cup'], keys: [
  k(0, { ...R(0.45, 0.12, 1.5, 0.4, -0.1, 1), nkRx: 0 }),
  k(0.9, { ...R(0.95, -0.05, 2.3, 0.55, -0.35, 1), nkRx: -0.2 }, 'out'),
  k(1.8, { ...R(0.95, -0.05, 2.35, 0.55, -0.4, 1), nkRx: -0.28 }),
  k(2.6, { ...R(0.45, 0.12, 1.5, 0.4, -0.1, 1), nkRx: 0 }),
  k(4, { ...R(0.45, 0.12, 1.5, 0.4, -0.1, 1) }),
] });

defineClip({ name: 'idle.lean', dur: 9, loop: true, hold: true, keys: [
  k(0, { rootRx: -0.09, rootZ: -0.05, hipRf: 0.45, knR: 1.35, anR: -0.25, hipRtw: 0.3, spRx: -0.06, nkRx: 0.05 }),
  k(4.5, { rootRx: -0.095, rootZ: -0.05, hipRf: 0.46, knR: 1.36, anR: -0.22, spRx: -0.05, nkRx: 0.02, nkRy: 0.25 }),
  k(9, { rootRx: -0.09, rootZ: -0.05, hipRf: 0.45, knR: 1.35, anR: -0.25, spRx: -0.06, nkRx: 0.05, nkRy: 0 }),
] });

defineClip({ name: 'idle.radio', dur: 3, mask: 'upper', keys: [
  k(0, { ...LN, nkRy: 0, nkRz: 0, jaw: 0 }),
  k(0.55, { ...L(0.72, 0.36, 2.2, 1.1, 0.1, 4), nkRy: -0.35, nkRz: -0.12 }, 'out'),
  k(0.8, { jaw: 0.4 }), k(1.0, { jaw: 0 }), k(1.2, { jaw: 0.5 }), k(1.45, { jaw: 0.1 }), k(1.7, { jaw: 0.4 }), k(1.9, { jaw: 0 }),
  k(2.3, { ...L(0.7, 0.36, 2.18, 1.1, 0.1, 4) }),
  k(3, { ...LN, nkRy: 0, nkRz: 0 }),
] });

defineClip({ name: 'idle.wipeFace', dur: 1.7, mask: 'upper', keys: [
  k(0, { ...RN, nkRx: 0 }),
  k(0.4, { ...R(1.3, 0.25, 2.4, 0.9, -0.3, 4), nkRx: 0.1, blink: 1 }, 'out'),
  k(0.8, { ...R(1.25, -0.05, 2.35, 1.1, 0.35, 4), nkRx: -0.08 }),
  k(1.1, { blink: 0 }),
  k(1.7, { ...RN, nkRx: 0 }),
] });

defineClip({ name: 'idle.hoodUp', dur: 1.9, mask: 'upper', keys: [
  k(0, { ...RN, ...LN, nkRx: 0 }),
  k(0.6, { ...B(1.85, 0.62, 2.2, 0.5, 0, 1), nkRx: 0.15 }, 'out'),
  k(1.2, { ...B(2.1, 0.45, 1.95, 0.7, 0.2, 1), nkRx: 0.2 }, undefined, 'hood'),
  k(1.9, { ...RN, ...LN, nkRx: 0.1 }),
] });

defineClip({ name: 'idle.window', dur: 6, mask: 'upper', keys: [
  k(0, { nkRy: 0, spRy: 0, spRx: 0.04, nkRx: 0 }),
  k(1.0, { nkRy: 0.95, spRy: 0.3, spRx: 0.12, nkRx: 0.1 }),
  k(4.8, { nkRy: 1.0, spRy: 0.32, spRx: 0.14, nkRx: 0.14 }),
  k(6, { nkRy: 0, spRy: 0, spRx: 0.04, nkRx: 0 }),
] });

defineClip({ name: 'idle.crosswalk', dur: 3.4, mask: 'upper', keys: [
  k(0, { nkRy: 0 }),
  k(0.6, { nkRy: -0.9, spRy: -0.15 }),
  k(1.3, { nkRy: -0.88 }),
  k(2.0, { nkRy: 0.9, spRy: 0.15 }),
  k(2.6, { nkRy: 0.85 }),
  k(3.4, { nkRy: 0, spRy: 0 }),
] });

/* ═══════════════════════════ emotes ═══════════════════════════ */
// Grounded, not memes: each has a wind-up, the gesture, and a way back down.

defineClip({ name: 'emote.wave', dur: 2.5, mask: 'upper', keys: [
  k(0, { ...RN, nkRy: 0, browUp: 0 }),
  k(0.14, { ...R(0.15, 0.3, 0.6, -0.3, 0.08, 4) }),
  k(0.4, { ...R(0.3, 1.45, 1.7, -0.4, 0, 4), nkRy: 0.08, browUp: 1 }, 'out'),
  k(0.62, { wrRz: 0.32, elRtw: -0.15 }),
  k(0.86, { wrRz: -0.26, elRtw: -0.5 }),
  k(1.1, { wrRz: 0.32, elRtw: -0.15 }),
  k(1.34, { wrRz: -0.26, elRtw: -0.5 }),
  k(1.58, { wrRz: 0.25, elRtw: -0.2 }),
  k(1.95, { ...R(0.1, 0.5, 1.0, -0.3, 0.08, 4), wrRz: 0, browUp: 0 }),
  k(2.5, { ...RN, nkRy: 0 }),
] });

defineClip({ name: 'emote.greet', dur: 1.6, mask: 'upper', keys: [
  k(0, { ...RN, browUp: 0, nkRx: 0 }),
  k(0.35, { ...R(0.55, 0.55, 1.9, 0.2, 0.1, 4), browUp: 1, nkRx: -0.05 }, 'out'),
  k(0.6, { wrRz: 0.25 }), k(0.85, { wrRz: -0.15 }),
  k(1.1, { ...R(0.3, 0.35, 1.2, 0, 0.08, 4), browUp: 0 }),
  k(1.6, { ...RN, nkRx: 0 }),
] });

defineClip({ name: 'emote.bye', dur: 2.2, mask: 'upper', keys: [
  k(0, { ...RN }),
  k(0.4, { ...R(0.6, 1.1, 1.8, -0.2, 0, 4) }, 'out'),
  k(0.65, { wrRz: 0.3 }), k(0.9, { wrRz: -0.25 }), k(1.15, { wrRz: 0.3 }), k(1.4, { wrRz: -0.2 }),
  k(1.8, { ...R(0.2, 0.4, 0.8, -0.2, 0.08, 4), wrRz: 0 }),
  k(2.2, RN),
] });

defineClip({ name: 'emote.point', dur: 2.1, mask: 'upper', keys: [
  k(0, { ...RN, spRy: 0, nkRx: 0 }),
  k(0.12, { ...R(0.3, 0.2, 1.0, 0, 0.08, 2), spRy: 0.05 }),
  k(0.34, { ...R(1.5, 0.04, 0.08, 0, 0, 2), spRy: -0.16, nkRx: -0.04 }, 'out'),
  k(0.48, { shRf: 1.44 }),
  k(1.5, { ...R(1.48, 0.05, 0.1, 0, 0, 2), spRy: -0.14 }),
  k(2.1, { ...RN, spRy: 0, nkRx: 0 }),
] });

defineClip({ name: 'emote.nod', dur: 1.3, mask: 'head', keys: [
  k(0, { nkRx: 0, browUp: 0 }),
  k(0.24, { nkRx: 0.3, browUp: 0.4 }),
  k(0.48, { nkRx: -0.04 }),
  k(0.72, { nkRx: 0.22 }),
  k(1.0, { nkRx: 0.02, browUp: 0 }),
  k(1.3, { nkRx: 0 }),
] });

defineClip({ name: 'emote.shake', dur: 1.5, mask: 'head', keys: [
  k(0, { nkRy: 0, browUp: 0 }),
  k(0.2, { nkRy: 0.34, browUp: -0.4 }),
  k(0.45, { nkRy: -0.34 }),
  k(0.7, { nkRy: 0.28 }),
  k(0.95, { nkRy: -0.22 }),
  k(1.2, { nkRy: 0.05, browUp: 0 }),
  k(1.5, { nkRy: 0 }),
] });

defineClip({ name: 'emote.thumbsUp', dur: 1.9, mask: 'upper', keys: [
  k(0, { ...RN, nkRx: 0 }),
  k(0.3, { ...R(0.82, 0.25, 1.62, 0.4, 0, 3) }, 'out'),
  k(0.5, { shRf: 0.95, nkRx: 0.12 }),
  k(0.66, { shRf: 0.84, nkRx: 0 }),
  k(1.4, { ...R(0.84, 0.26, 1.6, 0.42, 0, 3) }),
  k(1.9, { ...RN }),
] });

defineClip({ name: 'emote.thumbsDown', dur: 1.9, mask: 'upper', keys: [
  k(0, { ...RN, nkRx: 0, browUp: 0 }),
  k(0.35, { ...R(0.75, 0.3, 0.35, 3.0, 0, 3), browUp: -0.6 }, 'out'),
  k(0.55, { shRf: 0.62 }),
  k(0.75, { shRf: 0.72 }),
  k(1.4, { ...R(0.72, 0.3, 0.35, 3.0, 0, 3) }),
  k(1.9, { ...RN, browUp: 0 }),
] });

defineClip({ name: 'emote.shrug', dur: 1.7, mask: 'upper', keys: [
  k(0, { ...RN, ...LN, shLup: 0, shRup: 0, nkRz: 0, browUp: 0 }),
  k(0.4, { ...B(0.2, 0.38, 1.3, -0.95, 0.3, 4), shLup: 1, shRup: 1, nkRz: 0.14, browUp: 1 }, 'out'),
  k(1.0, { ...B(0.2, 0.36, 1.28, -0.95, 0.3, 4), shLup: 0.85, shRup: 0.85, nkRz: 0.12 }),
  k(1.7, { ...RN, ...LN, shLup: 0, shRup: 0, nkRz: 0, browUp: 0 }),
] });

defineClip({ name: 'emote.clap', dur: 2.6, mask: 'upper', keys: [
  k(0, { ...RN, ...LN }),
  k(0.4, { ...B(0.9, 0.12, 1.35, 0.8, 0, 4) }, 'out'),
  ...[0, 1, 2, 3, 4, 5].flatMap((i) => [
    k(0.55 + i * 0.28, { elLtw: 1.18, elRtw: 1.18 }, 'in', 'clap'),
    k(0.69 + i * 0.28, { elLtw: 0.82, elRtw: 0.82 }, 'out'),
  ]),
  k(2.6, { ...RN, ...LN }),
] });

defineClip({ name: 'emote.laugh', dur: 2.7, mask: 'upper', keys: [
  k(0, { ...LN, spRx: 0.04, nkRx: 0, jaw: 0, shLup: 0, shRup: 0 }),
  k(0.3, { spRx: -0.06, nkRx: -0.22, jaw: 0.7, ...L(0.35, 0.18, 1.6, 1.0, 0, 4) }),
  ...[0, 1, 2, 3, 4].flatMap((i) => [
    k(0.5 + i * 0.3, { shLup: 0.45, shRup: 0.45, spRx: 0.1, jaw: 0.8 }),
    k(0.65 + i * 0.3, { shLup: 0.1, shRup: 0.1, spRx: 0.02, jaw: 0.4 }),
  ]),
  k(2.2, { spRx: 0.08, nkRx: 0.08, jaw: 0.2 }),
  k(2.7, { ...LN, spRx: 0.04, nkRx: 0, jaw: 0, shLup: 0, shRup: 0 }),
] });

defineClip({ name: 'emote.cry', dur: 4.2, mask: 'upper', keys: [
  k(0, { ...RN, ...LN, spRx: 0.04, nkRx: 0 }),
  k(0.8, { ...B(1.1, 0.26, 2.35, 0.95, 0.1, 4), spRx: 0.22, nkRx: 0.5, blink: 1 }, 'out'),
  ...[0, 1, 2, 3].flatMap((i) => [k(1.1 + i * 0.6, { shLup: 0.45, shRup: 0.45 }), k(1.4 + i * 0.6, { shLup: 0.15, shRup: 0.15 })]),
  k(3.6, { ...B(1.05, 0.26, 2.3, 0.95, 0.1, 4), blink: 1 }),
  k(4.2, { ...RN, ...LN, spRx: 0.04, nkRx: 0, blink: 0, shLup: 0, shRup: 0 }),
] });

defineClip({ name: 'emote.angry', dur: 1.9, mask: 'upper', keys: [
  k(0, { ...RN, spRx: 0.04, browUp: 0, jaw: 0 }),
  k(0.3, { ...R(1.15, 0.4, 1.95, 0.3, 0, 1), spRx: 0.12, browUp: -1, jaw: 0.5, nkRx: -0.06 }, 'out'),
  k(0.45, { shRf: 1.3 }), k(0.6, { shRf: 1.08 }), k(0.75, { shRf: 1.3 }), k(0.9, { shRf: 1.1, jaw: 0.2 }), k(1.05, { shRf: 1.25, jaw: 0.5 }),
  k(1.4, { ...R(0.4, 0.3, 1.0, 0, 0.08, 1), jaw: 0 }),
  k(1.9, { ...RN, spRx: 0.04, browUp: 0, nkRx: 0 }),
] });

defineClip({ name: 'emote.confused', dur: 2.3, mask: 'upper', keys: [
  k(0, { ...RN, nkRz: 0, browUp: 0 }),
  k(0.5, { ...R(1.25, 1.1, 2.4, 0.45, 0.1, 0), nkRz: 0.2, browUp: 0.9, nkRx: 0.05 }, 'out'),
  k(0.7, { wrR: 0.3 }), k(0.9, { wrR: -0.05 }), k(1.1, { wrR: 0.3 }),
  k(1.7, { ...R(1.2, 1.05, 2.35, 0.45, 0.1, 0), nkRz: 0.18 }),
  k(2.3, { ...RN, nkRz: 0, browUp: 0, nkRx: 0 }),
] });

defineClip({ name: 'emote.beckon', dur: 2.1, mask: 'upper', keys: [
  k(0, { ...RN }),
  k(0.35, { ...R(0.82, 0.22, 1.35, 0.3, -0.4, 4) }, 'out'),
  k(0.6, { elR: 1.95, gripR: 1 }), k(0.85, { elR: 1.4, gripR: 4 }),
  k(1.1, { elR: 1.95, gripR: 1 }), k(1.35, { elR: 1.4, gripR: 4 }),
  k(2.1, { ...RN }),
] });

defineClip({ name: 'emote.salute', dur: 2.1, mask: 'upper', keys: [
  k(0, { ...RN, spRx: 0.04, nkRx: 0 }),
  k(0.28, { ...R(0.52, 1.32, 2.55, 1.22, 0.1, 4), spRx: -0.05, nkRx: -0.05 }, 'out'),
  k(1.45, { ...R(0.52, 1.32, 2.55, 1.22, 0.1, 4) }),
  k(1.7, { ...R(0.25, 0.55, 1.1, 0, 0.08, 4) }, 'in'),
  k(2.1, { ...RN, spRx: 0.04, nkRx: 0 }),
] });

defineClip({ name: 'emote.facepalm', dur: 2.5, mask: 'upper', keys: [
  k(0, { ...RN, nkRx: 0 }),
  k(0.42, { ...R(1.18, 0.22, 2.45, 0.9, 0.35, 4), nkRx: 0.1 }, 'out'),
  k(0.6, { nkRx: 0.38, blink: 1 }),
  k(1.1, { nkRy: 0.12 }), k(1.4, { nkRy: -0.1 }), k(1.7, { nkRy: 0.05 }),
  k(2.0, { ...R(0.4, 0.3, 1.0, 0, 0.08, 4), nkRx: 0.15, nkRy: 0, blink: 0 }),
  k(2.5, { ...RN, nkRx: 0 }),
] });

defineClip({ name: 'emote.surrender', dur: 3.4, mask: 'upper', keys: [
  k(0, { ...RN, ...LN, spRx: 0.04 }),
  k(0.3, { ...B(0.2, 1.35, 1.6, 0, 0.1, 4), spRx: -0.04, shLup: 0.4, shRup: 0.4 }, 'out'),
  k(2.9, { ...B(0.22, 1.32, 1.58, 0, 0.1, 4), spRx: -0.03 }),
  k(3.4, { ...RN, ...LN, spRx: 0.04, shLup: 0, shRup: 0 }),
] });

defineClip({ name: 'emote.callOver', dur: 2.4, mask: 'upper', keys: [
  k(0, { ...LN, ...RN, jaw: 0 }),
  k(0.35, { ...L(1.12, 0.55, 2.4, 1.1, 0, 4), nkRx: -0.1, jaw: 1 }, 'out'),
  k(0.9, { jaw: 0.3 }),
  k(1.05, { ...R(0.5, 1.2, 0.8, -0.2, 0, 4), jaw: 1 }),
  k(1.35, { elR: 1.8, shRab: 0.8 }), k(1.6, { elR: 0.8, shRab: 1.15 }), k(1.85, { elR: 1.8, shRab: 0.8 }),
  k(2.4, { ...LN, ...RN, jaw: 0, nkRx: 0 }),
] });

defineClip({ name: 'emote.shoo', dur: 1.8, mask: 'upper', keys: [
  k(0, { ...RN, nkRy: 0 }),
  k(0.3, { ...R(0.7, 0.28, 1.55, 0.6, 0.5, 4), nkRy: -0.2 }, 'out'),
  k(0.5, { ...R(0.72, 0.62, 0.6, -0.2, -0.4, 4) }),
  k(0.7, { ...R(0.7, 0.3, 1.5, 0.6, 0.5, 4) }),
  k(0.9, { ...R(0.72, 0.62, 0.6, -0.2, -0.4, 4) }),
  k(1.8, { ...RN, nkRy: 0 }),
] });

defineClip({ name: 'emote.handshake', dur: 2.3, mask: 'upper', keys: [
  k(0, { ...RN }),
  k(0.45, { ...R(0.78, 0.05, 0.8, 0.45, 0, 0), spRx: 0.06, nkRx: 0.05 }, 'out'),
  k(0.7, { shRf: 0.68 }), k(0.95, { shRf: 0.84 }), k(1.2, { shRf: 0.7 }), k(1.45, { shRf: 0.8 }),
  k(2.3, { ...RN, spRx: 0.04, nkRx: 0 }),
] });

defineClip({ name: 'emote.highFive', dur: 1.5, mask: 'upper', keys: [
  k(0, { ...RN }),
  k(0.2, { ...R(1.2, 0.35, 1.9, 0, 0, 4) }),
  k(0.45, { ...R(2.35, 0.35, 0.45, 0, -0.2, 4) }, 'out', 'slap'),
  k(0.62, { ...R(1.9, 0.35, 0.8, 0, 0.1, 4) }),
  k(1.5, RN),
] });

defineClip({ name: 'emote.comfort', dur: 2.6, mask: 'upper', keys: [
  k(0, { ...RN }),
  k(0.5, { ...R(1.12, 0.18, 0.7, 0.2, 0.2, 4), spRx: 0.08, nkRx: 0.1 }, 'out'),
  k(0.8, { wrR: 0.4 }), k(1.05, { wrR: 0.1 }), k(1.3, { wrR: 0.4 }), k(1.55, { wrR: 0.15 }),
  k(2.6, { ...RN, spRx: 0.04, nkRx: 0 }),
] });

defineClip({ name: 'emote.talk', dur: 3.2, loop: true, mask: 'upper', keys: [
  k(0, { ...R(0.3, 0.14, 1.1, 0.4, 0, 4), jaw: 0.1, nkRy: 0 }),
  k(0.5, { ...R(0.45, 0.2, 1.35, 0.3, -0.2, 4), jaw: 0.45, browUp: 0.4 }),
  k(0.9, { jaw: 0.05 }),
  k(1.3, { ...R(0.35, 0.3, 1.0, 0.1, 0.2, 4), jaw: 0.4, nkRy: 0.1, browUp: 0 }),
  k(1.7, { jaw: 0 }),
  k(2.3, { ...R(0.5, 0.12, 1.4, 0.5, -0.1, 4), jaw: 0.35, nkRy: -0.05 }),
  k(2.8, { jaw: 0.05 }),
  k(3.2, { ...R(0.3, 0.14, 1.1, 0.4, 0, 4), jaw: 0.1, nkRy: 0 }),
] });

defineClip({ name: 'emote.argue', dur: 2.4, loop: true, mask: 'upper', keys: [
  k(0, { ...R(0.6, 0.35, 1.3, -0.4, 0, 4), ...L(0.4, 0.3, 1.1, -0.4, 0, 4), jaw: 0.2, spRx: 0.1, browUp: -1 }),
  k(0.4, { ...R(0.9, 0.5, 1.0, -0.6, -0.3, 4), jaw: 0.7 }),
  k(0.8, { ...R(0.5, 0.3, 1.5, -0.3, 0.1, 4), jaw: 0.1 }),
  k(1.2, { ...L(0.8, 0.5, 1.0, -0.6, -0.3, 4), jaw: 0.6, nkRy: 0.1 }),
  k(1.7, { ...L(0.4, 0.3, 1.2, -0.4, 0, 4), jaw: 0.2, nkRy: -0.05 }),
  k(2.4, { ...R(0.6, 0.35, 1.3, -0.4, 0, 4), ...L(0.4, 0.3, 1.1, -0.4, 0, 4), jaw: 0.2, spRx: 0.1 }),
] });

// sitting on the ground: down, then held
defineClip({ name: 'emote.sit', dur: 1.3, hold: true, keys: [
  k(0, { hipLf: 0, hipRf: 0, knL: 0, knR: 0, pelY: 0, spRx: 0.04, ...B(0, 0.18, 0.3) }),
  k(0.55, { hipLf: 1.05, hipRf: 1.05, knL: 1.9, knR: 1.9, pelY: -0.05, spRx: 0.35, ...B(0.6, 0.3, 0.5, 0, 0.1, 4) }),
  k(1.3, { hipLf: 1.45, hipRf: 1.45, hipLab: 0.62, hipRab: 0.62, hipLtw: 0.9, hipRtw: 0.9, knL: 2.55, knR: 2.55, pelY: -0.16, spRx: 0.14, ...B(0.55, 0.36, 0.95, 0.2, 0.1, 0) }),
] });
defineClip({ name: 'emote.sitHold', dur: 8, loop: true, hold: true, keys: [
  k(0, { hipLf: 1.45, hipRf: 1.45, hipLab: 0.62, hipRab: 0.62, hipLtw: 0.9, hipRtw: 0.9, knL: 2.55, knR: 2.55, pelY: -0.16, spRx: 0.14, ...B(0.55, 0.36, 0.95, 0.2, 0.1, 0), nkRy: 0 }),
  k(4, { spRx: 0.18, nkRy: 0.3, nkRx: 0.08 }),
  k(8, { hipLf: 1.45, hipRf: 1.45, hipLab: 0.62, hipRab: 0.62, hipLtw: 0.9, hipRtw: 0.9, knL: 2.55, knR: 2.55, pelY: -0.16, spRx: 0.14, ...B(0.55, 0.36, 0.95, 0.2, 0.1, 0), nkRy: 0, nkRx: 0 }),
] });

/* ═══════════════════════════ reactions ═══════════════════════════ */

defineClip({ name: 'react.flinch', dur: 0.75, additive: true, keys: [
  k(0, { spRx: 0, shLup: 0, shRup: 0, nkRx: 0, elL: 0, elR: 0, blink: 0 }),
  k(0.1, { spRx: -0.12, shLup: 0.65, shRup: 0.65, nkRx: -0.12, elL: 0.55, elR: 0.55, shLf: 0.25, shRf: 0.25, blink: 1 }, 'out'),
  k(0.75, { spRx: 0, shLup: 0, shRup: 0, nkRx: 0, elL: 0, elR: 0, shLf: 0, shRf: 0, blink: 0 }),
] });

defineClip({ name: 'react.startle', dur: 1.0, hold: true, keys: [
  k(0, { rootZ: 0, spRx: 0.04, ...B(0, 0.18, 0.3) }),
  k(0.14, { rootZ: -0.14, spRx: -0.18, shLup: 1, shRup: 1, ...B(0.62, 0.3, 1.25, 0.2, -0.3, 4), knL: 0.35, knR: 0.25, blink: 1 }, 'out'),
  k(0.5, { rootZ: -0.18, spRx: -0.06, shLup: 0.4, shRup: 0.4, blink: 0 }),
  k(1.0, { rootZ: -0.18, spRx: 0.04, shLup: 0, shRup: 0, ...B(0, 0.18, 0.3), knL: 0.05, knR: 0.05 }),
] });

defineClip({ name: 'react.stumble', dur: 1.3, hold: true, keys: [
  k(0, { pelX: 0, spRz: 0, ...B(0, 0.18, 0.3), hipRab: 0, knR: 0 }),
  k(0.18, { pelX: 0.07, spRz: 0.2, ...L(0.3, 1.0, 0.5, 0, 0, 4), ...R(0.3, 0.8, 0.5, 0, 0, 4), nkRz: -0.1 }, 'out'),
  k(0.38, { hipRab: 0.28, knR: 0.45, pelX: 0.1 }),
  k(0.6, { spRz: -0.08, hipRab: 0.1, knR: 0.15, pelX: 0.04, ...L(0.2, 0.6, 0.5, 0, 0, 4), ...R(0.2, 0.5, 0.5, 0, 0, 4) }),
  k(1.3, { pelX: 0, spRz: 0, ...B(0, 0.18, 0.3, -0.35, 0.08, 0), hipRab: 0, knR: 0.05, nkRz: 0 }),
] });

defineClip({ name: 'react.duck', dur: 2.4, hold: true, keys: [
  k(0, { hipLf: 0, knL: 0, hipRf: 0, knR: 0, spRx: 0.04, ...B(0, 0.18, 0.3), nkRx: 0 }),
  k(0.25, { hipLf: 1.1, knL: 2.0, hipRf: 0.95, knR: 1.85, spRx: 0.62, ...B(2.35, 0.42, 2.3, 1.2, 0, 4), nkRx: 0.5, blink: 1 }, 'out'),
  k(1.8, { hipLf: 1.08, knL: 1.98, hipRf: 0.95, knR: 1.85, spRx: 0.6, nkRx: 0.52, blink: 0 }),
  k(2.4, { hipLf: 0, knL: 0.05, hipRf: 0, knR: 0.05, spRx: 0.04, ...B(0, 0.18, 0.3, -0.35, 0.08, 0), nkRx: 0 }),
] });

defineClip({ name: 'react.uneasy', dur: 4.5, mask: 'upper', keys: [
  k(0, { nkRy: 0, spRx: 0.04, ...B(0, 0.18, 0.3) }),
  k(0.4, { nkRy: 0.5, spRx: -0.02 }),
  k(1.4, { nkRy: 0.52, nkRx: -0.06, ...L(0.3, 0.2, 1.3, 0.5, 0, 1), shLup: 0.3, shRup: 0.3 }),
  k(2.4, { nkRy: -0.4, nkRx: 0 }),
  k(3.2, { nkRy: 0.45 }),
  k(4.5, { nkRy: 0, spRx: 0.04, ...B(0, 0.18, 0.3, -0.35, 0.08, 0), shLup: 0, shRup: 0 }),
] });

defineClip({ name: 'react.backAway', dur: 1.6, hold: true, keys: [
  k(0, { rootZ: 0, ...B(0, 0.18, 0.3), spRx: 0.04 }),
  k(0.5, { rootZ: -0.35, hipLf: -0.3, knL: 0.3, ...B(0.4, 0.3, 1.1, 0.2, -0.3, 4), spRx: -0.1 }),
  k(1.0, { rootZ: -0.7, hipLf: 0, hipRf: -0.3, knR: 0.3 }),
  k(1.6, { rootZ: -0.8, hipRf: 0, knR: 0, ...B(0.2, 0.25, 0.8, 0, 0, 4), spRx: 0 }),
] });

// hit reactions: a sharp snap, then recovery (mostly upper body, so they can run while hit)
const hit = (name: string, sp: P) =>
  defineClip({ name, dur: 0.55, additive: true, keys: [
    k(0, Object.fromEntries(Object.keys(sp).map((c) => [c, 0])) as P),
    k(0.07, sp, 'out'),
    k(0.55, Object.fromEntries(Object.keys(sp).map((c) => [c, 0])) as P),
  ] });
hit('react.hitFront', { spRx: -0.38, nkRx: -0.42, shLab: 0.3, shRab: 0.3, shLf: -0.2, shRf: -0.2, blink: 1, rootZ: -0.06 });
hit('react.hitBack', { spRx: 0.35, nkRx: 0.3, shLf: 0.3, shRf: 0.3, blink: 1, rootZ: 0.06 });
hit('react.hitLeft', { spRz: 0.3, nkRz: 0.35, spRy: 0.2, shLab: 0.4, blink: 1, rootX: 0.05 });
hit('react.hitRight', { spRz: -0.3, nkRz: -0.35, spRy: -0.2, shRab: 0.4, blink: 1, rootX: -0.05 });
hit('react.hitHead', { nkRx: -0.55, nkRy: 0.3, spRx: -0.15, blink: 1 });

// falls: end lying on the ground (the root pivots at hip height, 0.92)
defineClip({ name: 'react.deathBack', dur: 1.5, hold: true, keys: [
  k(0, { rootRx: 0, rootY: 0, knL: 0.05, knR: 0.05, spRx: 0.04, ...B(0, 0.18, 0.3), nkRx: 0, nkRz: 0 }),
  k(0.28, { knL: 0.7, knR: 0.55, spRx: -0.35, ...B(0.6, 0.7, 0.6, 0, 0, 4), nkRx: -0.4, blink: 1 }, 'out'),
  k(0.75, { rootRx: -0.9, rootY: -0.38, knL: 0.9, knR: 0.4, spRx: -0.15 }, 'in'),
  k(1.05, { rootRx: -1.62, rootY: -0.8, knL: 0.3, knR: 0.15, spRx: 0.05, ...L(0.6, 1.1, 0.4), ...R(0.3, 0.9, 0.5), nkRx: -0.1, nkRz: 0.35 }, 'in', 'land'),
  k(1.2, { rootRx: -1.5, rootY: -0.78 }),
  k(1.5, { rootRx: -1.57, rootY: -0.8, knL: 0.35, knR: 0.12, ...L(0.5, 1.15, 0.35), ...R(0.25, 0.95, 0.45), nkRz: 0.4, blink: 1 }),
] });
defineClip({ name: 'react.deathForward', dur: 1.5, hold: true, keys: [
  k(0, { rootRx: 0, rootY: 0, knL: 0.05, knR: 0.05, spRx: 0.04, ...B(0, 0.18, 0.3), nkRx: 0 }),
  k(0.3, { knL: 1.1, knR: 0.9, spRx: 0.4, ...B(0.5, 0.3, 0.6, 0, 0, 4), nkRx: 0.2, blink: 1 }, 'out'),
  k(0.8, { rootRx: 0.8, rootY: -0.42, knL: 1.3, knR: 1.1, spRx: 0.3, ...B(1.4, 0.4, 0.4, 0, 0, 4) }, 'in'),
  k(1.05, { rootRx: 1.6, rootY: -0.8, knL: 0.3, knR: 0.5, spRx: 0, ...L(2.4, 0.5, 0.5), ...R(1.8, 0.3, 0.8), nkRx: -0.4, nkRy: 0.8 }, 'in', 'land'),
  k(1.5, { rootRx: 1.57, rootY: -0.8, knL: 0.3, knR: 0.5, ...L(2.4, 0.5, 0.5), ...R(1.8, 0.3, 0.8), nkRx: -0.4, nkRy: 0.9 }),
] });
defineClip({ name: 'react.getUp', dur: 2.1, hold: true, keys: [
  k(0, { rootRx: -1.57, rootY: -0.8, knL: 0.35, knR: 0.12, ...L(0.5, 1.15, 0.35), ...R(0.25, 0.95, 0.45), nkRz: 0.4, spRx: 0 }),
  k(0.5, { rootRx: -0.9, rootY: -0.62, knL: 1.8, knR: 1.6, hipLf: 1.2, hipRf: 1.0, ...B(-0.3, 0.3, 0.3, 0, 0.4, 4), spRx: 0.5, nkRz: 0 }),
  k(1.1, { rootRx: -0.1, rootY: -0.45, knL: 2.1, knR: 1.4, hipLf: 1.2, hipRf: 0.4, ...B(0.3, 0.3, 0.6, 0, 0, 4), spRx: 0.4 }),
  k(1.6, { rootRx: 0, rootY: -0.12, knL: 0.8, knR: 0.5, hipLf: 0.5, hipRf: 0.2, spRx: 0.2, ...B(0.1, 0.25, 0.4) }),
  k(2.1, { rootRx: 0, rootY: 0, knL: 0.05, knR: 0.05, hipLf: 0, hipRf: 0, spRx: 0.04, ...B(0, 0.18, 0.3, -0.35, 0.08, 0), nkRz: 0 }),
] });

/* ═══════════════════════════ interactions ═══════════════════════════ */

defineClip({ name: 'act.press', dur: 1.3, mask: 'upper', keys: [
  k(0, { ...RN, spRx: 0.04 }),
  k(0.35, { ...R(1.1, 0.12, 0.7, 0.2, 0, 2), spRx: 0.1, nkRx: 0.12 }, 'out'),
  k(0.5, { shRf: 1.22, elR: 0.4 }, 'in', 'press'),
  k(0.7, { shRf: 1.1, elR: 0.7 }),
  k(1.3, { ...RN, spRx: 0.04, nkRx: 0 }),
] });

defineClip({ name: 'act.pickUp', dur: 1.9, hold: true, keys: [
  k(0, { hipLf: 0, knL: 0, hipRf: 0, knR: 0, spRx: 0.04, ...RN }),
  k(0.7, { hipLf: 1.0, knL: 1.9, hipRf: 0.6, knR: 1.3, spRx: 0.7, ...R(1.1, 0.12, 0.3, 0.2, 0, 4), nkRx: 0.4 }, 'out'),
  k(0.85, { gripR: 1 }, undefined, 'grab'),
  k(1.9, { hipLf: 0, knL: 0.05, hipRf: 0, knR: 0.05, spRx: 0.04, ...R(0.3, 0.2, 1.2, 0.4, 0, 1), nkRx: 0 }),
] });

defineClip({ name: 'act.inspect', dur: 2.6, mask: 'upper', keys: [
  k(0, { ...RN, spRx: 0.04, nkRx: 0 }),
  k(0.6, { ...R(0.9, 0.15, 2.3, 0.8, 0.3, 0), spRx: 0.16, nkRx: 0.25 }, 'out'),
  k(2.0, { ...R(0.92, 0.15, 2.32, 0.8, 0.3, 0), spRx: 0.18, nkRx: 0.3, nkRy: 0.08 }),
  k(2.6, { ...RN, spRx: 0.04, nkRx: 0, nkRy: 0 }),
] });

defineClip({ name: 'act.phoneEar', dur: 5, loop: true, mask: 'upper', keys: [
  k(0, { ...R(0.62, 0.85, 2.45, 1.0, -0.1, 1), nkRz: 0.12, nkRx: 0.05 }),
  k(2.5, { ...R(0.64, 0.86, 2.45, 1.0, -0.1, 1), nkRz: 0.14, nkRx: 0.1, nkRy: 0.1 }),
  k(5, { ...R(0.62, 0.85, 2.45, 1.0, -0.1, 1), nkRz: 0.12, nkRx: 0.05, nkRy: 0 }),
] });

defineClip({ name: 'act.openDoor', dur: 1.0, mask: 'upper', keys: [
  k(0, { ...RN, spRx: 0.04 }),
  k(0.35, { ...R(1.25, 0.25, 0.5, 0.1, -0.2, 4), spRx: 0.12 }, 'out', 'door'),
  k(0.6, { ...R(1.1, 0.35, 0.3, 0, -0.3, 4), spRx: 0.08 }),
  k(1.0, { ...RN, spRx: 0.04 }),
] });

defineClip({ name: 'act.sitDown', dur: 1.1, mask: 'upper', keys: [
  k(0, { spRx: 0.04, ...LN }),
  k(0.45, { spRx: 0.32, ...L(-0.25, 0.35, 0.35, 0, 0.3, 4), nkRx: 0.2 }),
  k(1.1, { spRx: 0.0, ...L(0.5, 0.12, 0.75), nkRx: 0 }),
] });

defineClip({ name: 'act.standUp', dur: 1.0, mask: 'upper', keys: [
  k(0, { spRx: 0.0, ...B(0.5, 0.12, 0.75) }),
  k(0.3, { spRx: 0.42, ...B(0.75, 0.2, 0.55, 0.3, 0.3, 4), nkRx: -0.05 }),
  k(1.0, { spRx: 0.04, ...B(0, 0.18, 0.3, -0.35, 0.08, 0), nkRx: 0 }),
] });

defineClip({ name: 'act.enterCar', dur: 1.1, hold: true, keys: [
  k(0, { spRx: 0.04, nkRx: 0, ...LN, hipRf: 0, knR: 0 }),
  k(0.35, { ...L(1.55, 0.55, 0.9, 0.2, 0, 4), spRx: 0.2 }),
  k(0.6, { spRx: 0.5, nkRx: 0.25, hipRf: 0.65, knR: 1.0 }, undefined, 'door'),
  k(1.1, { spRx: 0.2, nkRx: 0.1, hipRf: 1.2, knR: 1.3, ...L(0.9, 0.2, 0.9, 0.2, 0.1, 1) }),
] });

defineClip({ name: 'act.exitCar', dur: 1.0, hold: true, keys: [
  k(0, { spRx: 0.2, hipLf: 1.2, knL: 1.3, ...L(1.2, 0.5, 0.8, 0, 0, 4) }),
  k(0.45, { spRx: 0.45, hipLf: 0.6, knL: 0.9, nkRx: 0.2 }),
  k(1.0, { spRx: 0.04, hipLf: 0, knL: 0.05, nkRx: 0, ...LN }),
] });

defineClip({ name: 'act.boardBoat', dur: 1.0, hold: true, keys: [
  k(0, { spRx: 0.04, hipRf: 0, knR: 0, ...B(0, 0.18, 0.3) }),
  k(0.4, { spRx: 0.25, hipRf: 0.55, knR: 0.7, ...B(0.3, 0.7, 0.4, 0, 0, 4) }),
  k(1.0, { spRx: 0.04, hipRf: 0, knR: 0.05, ...B(0, 0.18, 0.3, -0.35, 0.08, 0) }),
] });

defineClip({ name: 'act.climb', dur: 1.3, hold: true, keys: [
  k(0, { ...B(2.6, 0.3, 0.4, 0, 0, 1), spRx: 0.1, hipLf: 0, knL: 0 }),
  k(0.5, { ...B(1.4, 0.4, 1.8, 0, 0, 1), spRx: 0.5, hipLf: 1.3, knL: 2.1 }),
  k(1.3, { ...B(0, 0.18, 0.3, -0.35, 0.08, 0), spRx: 0.04, hipLf: 0, knL: 0.05 }),
] });

defineClip({ name: 'act.lookBack', dur: 2.2, mask: 'upper', keys: [
  k(0, { nkRy: 0, spRy: 0 }),
  k(0.5, { nkRy: 1.1, spRy: 0.5 }),
  k(1.6, { nkRy: 1.05, spRy: 0.48 }),
  k(2.2, { nkRy: 0, spRy: 0 }),
] });

/* ═══════════════════════════ weapons ═══════════════════════════ */
// The long-gun holds themselves are arm modes ('rifle', 'rifleAim') so they
// track the camera; these are the actions on top.

defineClip({ name: 'gun.reload', dur: 2.2, mask: 'upper', keys: [
  k(0, { nkRx: 0.05 }),
  k(0.35, { ...L(0.5, 0.32, 1.45, 0.9, 0.2, 1), nkRx: 0.22 }, 'out'),
  k(0.45, { shLf: 0.44 }, undefined, 'magOut'),
  k(0.9, { ...L(0.05, 0.35, 0.8, 0.2, 0.2, 4) }),
  k(1.15, { ...L(0.05, 0.33, 0.85, 0.2, 0.2, 1) }),
  k(1.45, { ...L(0.5, 0.32, 1.45, 0.9, 0.2, 1) }, 'out', 'magIn'),
  k(1.58, { shLf: 0.58 }),
  k(1.85, { ...R(1.15, 0.55, 1.95, 0.6, 0.3, 1) }, undefined, 'charge'),
  k(2.2, { nkRx: 0.02 }, undefined, 'ready'),
] });

defineClip({ name: 'gun.switch', dur: 0.6, additive: true, keys: [
  k(0, { shRf: 0, shLf: 0, elR: 0, spRx: 0 }),
  k(0.28, { shRf: -0.55, shLf: -0.5, elR: -0.3, spRx: 0.06 }),
  k(0.6, { shRf: 0, shLf: 0, elR: 0, spRx: 0 }),
] });

defineClip({ name: 'gun.recoil', dur: 0.18, additive: true, keys: [
  k(0, { shRf: 0, shLf: 0, spRx: 0, shRup: 0, nkRx: 0 }),
  k(0.03, { shRf: 0.12, shLf: 0.1, spRx: -0.045, shRup: 0.2, nkRx: -0.02 }, 'out'),
  k(0.18, { shRf: 0, shLf: 0, spRx: 0, shRup: 0, nkRx: 0 }),
] });

defineClip({ name: 'gun.melee', dur: 0.65, mask: 'upper', keys: [
  k(0, { spRy: 0 }),
  k(0.14, { spRy: 0.45, ...R(0.9, 0.6, 1.6, 0.5, 0, 1), ...L(1.2, 0.2, 1.0, 0.8, 0, 1) }),
  k(0.28, { spRy: -0.45, ...R(1.35, 0.25, 1.1, 0.8, 0, 1), ...L(1.5, 0.0, 0.6, 0.9, 0, 1) }, 'out', 'hit'),
  k(0.65, { spRy: 0 }),
] });

defineClip({ name: 'gun.pistolAim', dur: 1, loop: true, mask: 'upper', keys: [
  k(0, { ...R(1.45, -0.05, 0.12, 0.2, 0, 1), ...L(1.25, -0.1, 0.5, 0.95, 0, 1), spRy: -0.12 }),
  k(1, { ...R(1.45, -0.05, 0.12, 0.2, 0, 1), ...L(1.25, -0.1, 0.5, 0.95, 0, 1), spRy: -0.12 }),
] });

/* ═══════════════════════════ shared poses ═══════════════════════════ */

export const NEUTRAL = ALL_N;
