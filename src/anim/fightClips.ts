import { defineClip, type Ease, type Key } from './Animator';
import type { Channel } from './pose';

/**
 * FIGHT animations. Every attack is timed to its frame data (modes/fight/
 * moves.ts, 60 frames a second): a readable wind-up through startup, the
 * limb at full extension on the first active frame, and a recovery that
 * returns to the stance. Orthodox stance: left side forward.
 */

type P = Partial<Record<Channel, number>>;
const k = (t: number, p: P, e?: Ease, ev?: string): Key => ({ t, p, e, ev });
const f = (frames: number) => frames / 60;

/** the stance every move starts and ends in */
export const STANCE: P = {
  spRy: 0.42, spRx: 0.1, pelRy: 0.2, nkRy: -0.5, nkRx: 0.12,
  shLf: 0.95, shLab: 0.28, shLtw: 0.25, elL: 2.0, elLtw: 0.4, wrL: 0.1, gripL: 1,
  shRf: 0.78, shRab: 0.3, shRtw: 0.35, elR: 2.25, elRtw: 0.5, wrR: 0.1, gripR: 1,
  hipLf: 0.38, hipRf: -0.22, hipLab: 0.08, hipRab: 0.1, knL: 0.42, knR: 0.38, anR: 0.15,
};
const S = STANCE;
const arms = (o: P): P => ({ ...S, ...o });

defineClip({ name: 'f.stance', dur: 1.6, loop: true, keys: [
  k(0, { ...S, pelY: -0.02 }),
  k(0.4, { pelY: -0.045, spRy: 0.45, shLf: 0.98, knL: 0.48, knR: 0.44 }),
  k(0.8, { pelY: -0.02, spRy: 0.4, shLf: 0.93, knL: 0.42, knR: 0.38 }),
  k(1.2, { pelY: -0.045, spRy: 0.44, shRf: 0.82, knL: 0.48, knR: 0.44 }),
  k(1.6, { ...S, pelY: -0.02 }),
] });

// ── the light string: jab → cross → hook

defineClip({ name: 'f.jab', dur: f(17), keys: [
  k(0, S),
  k(f(3), arms({ shLf: 0.85, elL: 2.1, spRy: 0.38 })),
  k(f(5), arms({ shLf: 1.52, shLab: 0.06, shLtw: 0.1, elL: 0.08, elLtw: 0.1, wrL: 0, spRy: 0.62, nkRy: -0.66, pelRy: 0.28, rootZ: 0.12 }), 'out', 'hit'),
  k(f(8), arms({ shLf: 1.48, elL: 0.15, spRy: 0.6, rootZ: 0.12 })),
  k(f(17), { ...S, rootZ: 0 }),
] });

defineClip({ name: 'f.cross', dur: f(20), keys: [
  k(0, S),
  k(f(3), arms({ shRf: 0.7, elR: 2.35, spRy: 0.55 })),
  k(f(6), arms({ shRf: 1.55, shRab: 0.05, shRtw: 0.2, elR: 0.06, elRtw: 0.1, wrR: 0, spRy: -0.35, pelRy: -0.25, nkRy: 0.2, hipRf: -0.3, knR: 0.25, anR: 0.45, rootZ: 0.18 }), 'out', 'hit'),
  k(f(9), arms({ shRf: 1.5, elR: 0.12, spRy: -0.3, rootZ: 0.18 })),
  k(f(20), { ...S, rootZ: 0 }),
] });

defineClip({ name: 'f.hook', dur: f(28), keys: [
  k(0, S),
  k(f(4), arms({ spRy: 0.75, shLf: 1.0, shLab: 0.9, elL: 1.6, pelRy: 0.35 })),
  k(f(8), arms({ spRy: -0.3, shLf: 1.25, shLab: 1.15, shLtw: 1.35, elL: 1.5, elLtw: 0.3, pelRy: -0.1, nkRy: -0.1, knL: 0.55, rootZ: 0.1 }), 'out', 'hit'),
  k(f(12), arms({ spRy: -0.45, shLf: 1.15, shLtw: 1.5, rootZ: 0.1 })),
  k(f(28), { ...S, rootZ: 0 }),
] });

// ── launcher: dip, then everything up through the chin

defineClip({ name: 'f.launcher', dur: f(34), keys: [
  k(0, S),
  k(f(6), arms({ knL: 0.95, knR: 0.9, pelY: -0.1, spRx: 0.35, shRf: 0.25, elR: 1.6, shRab: 0.2, spRy: 0.2 })),
  k(f(10), arms({ knL: 0.15, knR: 0.25, pelY: 0.04, spRx: -0.22, shRf: 2.55, shRab: 0.25, elR: 0.9, elRtw: 0.6, spRy: -0.2, nkRx: -0.15, anR: 0.4, anL: 0.2 }), 'out', 'hit'),
  k(f(16), arms({ shRf: 2.6, elR: 0.8, spRx: -0.25, pelY: 0.05 })),
  k(f(34), { ...S, pelY: 0 }),
] });

// ── heavy: an overhand right, wound back from the shoulder

defineClip({ name: 'f.heavy', dur: f(36), keys: [
  k(0, S),
  k(f(8), arms({ shRf: -0.35, shRab: 0.55, elR: 1.9, spRy: 0.75, pelRy: 0.35, spRx: -0.05, knR: 0.55 })),
  k(f(13), arms({ shRf: 1.75, shRab: 0.42, shRtw: 0.65, elR: 0.35, elRtw: 0.3, wrR: 0.2, spRy: -0.6, spRx: 0.32, pelRy: -0.35, hipRf: -0.4, knL: 0.6, anR: 0.5, rootZ: 0.28, nkRx: 0.25 }), 'out', 'hit'),
  k(f(17), arms({ shRf: 1.5, elR: 0.5, spRy: -0.7, spRx: 0.36, rootZ: 0.3 })),
  k(f(36), { ...S, rootZ: 0 }),
] });

// ── roundhouse: chamber, turn the hip over, snap, re-chamber

defineClip({ name: 'f.roundhouse', dur: f(40), keys: [
  k(0, S),
  k(f(8), arms({ hipRf: 1.1, hipRab: 0.45, knR: 2.0, pelRy: 0.35, spRz: 0.1 })),
  k(f(15), arms({ hipRf: 1.2, hipRab: 1.05, hipRtw: 0.6, knR: 0.18, anR: -0.6, pelRy: -0.95, spRy: 0.2, spRz: 0.32, knL: 0.35, hipLtw: 0.6, shRf: 0.3, shRab: 0.6, elR: 1.3 }), 'out', 'hit'),
  k(f(20), arms({ hipRf: 1.1, hipRab: 0.95, knR: 0.6, pelRy: -0.9, spRz: 0.3 })),
  k(f(28), arms({ hipRf: 0.9, hipRab: 0.4, knR: 1.8, pelRy: -0.3, spRz: 0.1 })),
  k(f(40), S),
] });

// ── sweep: drop, spin the back leg round at the ankles

defineClip({ name: 'f.sweep', dur: f(38), keys: [
  k(0, S),
  k(f(7), arms({ knL: 1.8, hipLf: 1.2, knR: 1.2, hipRf: 0.4, pelY: -0.05, spRx: 0.45, pelRy: 0.5 })),
  k(f(12), arms({ knL: 2.0, hipLf: 1.25, hipRab: 1.35, hipRf: 0.2, knR: 0.08, pelRy: -1.2, spRy: -0.2, spRx: 0.5, shLf: 0.2, shLab: 0.6, elL: 0.3, gripL: 4 }), 'out', 'hit'),
  k(f(20), arms({ knL: 1.9, hipLf: 1.2, hipRab: 1.0, knR: 0.3, pelRy: -1.6, spRx: 0.45 })),
  k(f(38), S),
] });

// ── in the air

defineClip({ name: 'f.airPunch', dur: f(22), keys: [
  k(0, arms({ hipLf: 0.8, knL: 1.4, hipRf: 0.4, knR: 1.0 })),
  k(f(6), arms({ shRf: 1.9, elR: 0.1, shRab: 0.1, spRx: 0.35, spRy: -0.3, nkRx: 0.3 }), 'out', 'hit'),
  k(f(12), arms({ shRf: 1.8, elR: 0.2, spRx: 0.3 })),
  k(f(22), arms({ hipLf: 0.8, knL: 1.4 })),
] });

defineClip({ name: 'f.airKick', dur: f(30), keys: [
  k(0, arms({ hipLf: 0.8, knL: 1.4, hipRf: 0.9, knR: 1.6 })),
  k(f(9), arms({ hipRf: 1.4, knR: 0.1, anR: -0.4, hipLf: 0.4, knL: 1.6, spRx: -0.35, shLab: 0.7, shRab: 0.7, elL: 1.0, elR: 1.0 }), 'out', 'hit'),
  k(f(16), arms({ hipRf: 1.35, knR: 0.15, spRx: -0.3 })),
  k(f(30), arms({ hipRf: 0.6, knR: 1.3, spRx: 0 })),
] });

// ── the special: a full spin into a backfist, a step in behind it

defineClip({ name: 'f.special', dur: f(46), keys: [
  k(0, { ...S, rootRy: 0, rootZ: 0 }),
  k(f(8), arms({ rootRy: 0.4, spRy: 0.8, knL: 0.6, knR: 0.6, pelY: -0.05 })),
  k(f(16), arms({ rootRy: 3.4, rootZ: 0.35, shRf: 0.8, shRab: 1.4, elR: 0.4, spRy: 0.2 }), 'linear'),
  k(f(20), arms({ rootRy: 6.28, rootZ: 0.6, shRf: 1.2, shRab: 1.45, shRtw: -0.4, elR: 0.1, wrR: 0.2, spRy: 0.4, nkRy: -0.2 }), 'out', 'hit'),
  k(f(26), arms({ rootRy: 6.35, rootZ: 0.62, shRf: 1.1, shRab: 1.3, elR: 0.2 })),
  k(f(46), { ...S, rootRy: 6.283, rootZ: 0 }),
] });

// ── defence

defineClip({ name: 'f.block', dur: 1, loop: true, keys: [
  k(0, arms({ shLf: 1.12, shLab: 0.2, shLtw: 0.5, elL: 2.45, elLtw: 0.7, shRf: 1.1, shRab: 0.2, shRtw: 0.5, elR: 2.45, elRtw: 0.7, nkRx: 0.3, spRx: 0.2, spRy: 0.2, knL: 0.55, knR: 0.5 })),
  k(1, arms({ shLf: 1.12, shLab: 0.2, shLtw: 0.5, elL: 2.45, elLtw: 0.7, shRf: 1.1, shRab: 0.2, shRtw: 0.5, elR: 2.45, elRtw: 0.7, nkRx: 0.3, spRx: 0.2, spRy: 0.2, knL: 0.55, knR: 0.5 })),
] });

defineClip({ name: 'f.blockHit', dur: f(14), additive: true, keys: [
  k(0, { spRx: 0, rootZ: 0, nkRx: 0 }),
  k(f(3), { spRx: -0.2, rootZ: -0.12, nkRx: -0.12 }, 'out'),
  k(f(14), { spRx: 0, rootZ: 0, nkRx: 0 }),
] });

defineClip({ name: 'f.parry', dur: f(20), keys: [
  k(0, S),
  k(f(4), arms({ shLf: 1.25, shLab: 0.95, shLtw: -0.3, elL: 1.1, elLtw: -0.6, wrL: -0.4, gripL: 4, spRy: 0.7 }), 'out'),
  k(f(9), arms({ shLf: 1.1, shLab: 1.1, elL: 1.3, spRy: 0.6 })),
  k(f(20), S),
] });

defineClip({ name: 'f.dodgeBack', dur: f(24), keys: [
  k(0, S),
  k(f(5), arms({ spRx: -0.28, knL: 0.7, knR: 0.8, pelY: -0.06, nkRx: -0.05 }), 'out'),
  k(f(16), arms({ spRx: -0.1, knL: 0.5, knR: 0.5 })),
  k(f(24), S),
] });

defineClip({ name: 'f.dodgeSide', dur: f(24), keys: [
  k(0, S),
  k(f(5), arms({ spRz: 0.35, pelRz: 0.1, knL: 0.8, knR: 0.6, pelY: -0.08, spRx: 0.2 }), 'out'),
  k(f(16), arms({ spRz: 0.15, knL: 0.55 })),
  k(f(24), S),
] });

// ── grabs and throws

defineClip({ name: 'f.grab', dur: f(30), keys: [
  k(0, S),
  k(f(4), arms({ shLf: 0.8, shRf: 0.8, elL: 1.8, elR: 1.8 })),
  k(f(7), arms({ shLf: 1.45, shLab: 0.15, shLtw: 0.45, elL: 0.5, gripL: 4, shRf: 1.45, shRab: 0.15, shRtw: 0.45, elR: 0.5, gripR: 4, spRy: 0.1, spRx: 0.25, rootZ: 0.25 }), 'out', 'hit'),
  k(f(12), arms({ shLf: 1.4, shRf: 1.4, rootZ: 0.25 })),
  k(f(30), { ...S, rootZ: 0 }),
] });

defineClip({ name: 'f.throw', dur: f(48), hold: true, keys: [
  k(0, arms({ shLf: 1.35, shRf: 1.35, elL: 0.8, elR: 0.8, gripL: 1, gripR: 1, spRy: 0 })),
  k(f(14), arms({ shLf: 1.0, shRf: 1.0, elL: 1.6, elR: 1.6, spRy: 0.6, rootRy: 0.8, knL: 0.8, knR: 0.8, spRx: 0.3 })),
  k(f(26), arms({ shLf: 1.3, shRf: 1.2, elL: 0.6, elR: 0.7, spRy: -0.6, rootRy: 2.4, spRx: 0.5, knL: 0.4 }), 'out', 'slam'),
  k(f(48), { ...S, rootRy: 3.14 }),
] });

defineClip({ name: 'f.thrown', dur: f(48), hold: true, keys: [
  k(0, arms({ spRx: 0.3, nkRx: 0.2, shLf: 0.4, shRf: 0.4, gripL: 4, gripR: 4 })),
  k(f(14), { rootRy: 0.8, rootY: 0.2, spRx: 0.5, knL: 0.6, knR: 0.6 }),
  k(f(26), { rootRy: 2.4, rootRx: -1.2, rootY: -0.3, spRx: -0.2, shLab: 1.2, shRab: 1.2, elL: 0.4, elR: 0.4 }, 'in'),
  k(f(30), { rootRy: 2.6, rootRx: -1.57, rootY: -0.8, spRx: 0, knL: 0.4, knR: 0.2 }),
  k(f(48), { rootRy: 2.8, rootRx: -1.57, rootY: -0.8, knL: 0.5, knR: 0.3, shLab: 1.0, shRab: 1.1, nkRz: 0.4 }),
] });

// ── being hit

defineClip({ name: 'f.hitLight', dur: f(16), keys: [
  k(0, S),
  k(f(2), arms({ nkRx: -0.45, nkRy: -0.1, spRx: -0.22, rootZ: -0.08, shLab: 0.5, shRab: 0.45, blink: 1 }), 'out'),
  k(f(16), { ...S, rootZ: 0, blink: 0 }),
] });

defineClip({ name: 'f.hitBody', dur: f(18), keys: [
  k(0, S),
  k(f(2), arms({ spRx: 0.45, nkRx: 0.25, rootZ: -0.1, shLf: 0.5, shRf: 0.6, elL: 1.6, elR: 1.6, knL: 0.6, blink: 1 }), 'out'),
  k(f(18), { ...S, rootZ: 0, blink: 0 }),
] });

defineClip({ name: 'f.hitHeavy', dur: f(26), keys: [
  k(0, S),
  k(f(3), { spRx: -0.45, nkRx: -0.55, nkRy: 0.3, rootZ: -0.25, shLf: 0.3, shLab: 0.9, shRf: 0.2, shRab: 0.9, elL: 0.6, elR: 0.6, gripL: 4, gripR: 4, knL: 0.2, knR: 0.6, hipRf: -0.4, blink: 1 }, 'out'),
  k(f(14), { spRx: -0.2, nkRx: -0.2, rootZ: -0.35, knR: 0.5 }),
  k(f(26), { ...S, rootZ: 0, blink: 0 }),
] });

defineClip({ name: 'f.guardBreak', dur: f(40), keys: [
  k(0, S),
  k(f(4), { spRx: -0.3, shLf: 0.6, shLab: 1.1, shRf: 0.6, shRab: 1.1, elL: 0.4, elR: 0.4, gripL: 4, gripR: 4, nkRx: -0.3, rootZ: -0.2 }, 'out'),
  k(f(28), { spRx: -0.15, shLab: 0.8, shRab: 0.8, nkRx: -0.1, rootZ: -0.25 }),
  k(f(40), { ...S, rootZ: 0 }),
] });

defineClip({ name: 'f.dizzy', dur: 2, loop: true, keys: [
  k(0, { spRz: 0.12, nkRz: 0.2, nkRx: 0.25, spRx: 0.15, shLf: 0.2, shRf: 0.15, elL: 0.6, elR: 0.5, gripL: 0, gripR: 0, knL: 0.5, knR: 0.3, pelX: 0.03 }),
  k(0.5, { spRz: -0.05, nkRz: -0.1, nkRx: 0.35, pelX: -0.02 }),
  k(1.0, { spRz: -0.14, nkRz: -0.22, nkRx: 0.2, knL: 0.3, knR: 0.55, pelX: -0.03 }),
  k(1.5, { spRz: 0.04, nkRz: 0.08, nkRx: 0.32, pelX: 0.02 }),
  k(2, { spRz: 0.12, nkRz: 0.2, nkRx: 0.25, knL: 0.5, knR: 0.3, pelX: 0.03 }),
] });

// knocked down: thrown back, landing on the back; held on the ground
defineClip({ name: 'f.knockdown', dur: f(40), hold: true, keys: [
  k(0, { ...S, rootRx: 0, rootY: 0 }),
  k(f(6), { spRx: -0.4, nkRx: -0.4, rootRx: -0.4, rootY: 0.05, shLab: 1.0, shRab: 1.0, elL: 0.5, elR: 0.5, gripL: 4, gripR: 4, knL: 0.3, knR: 0.5 }, 'out'),
  k(f(18), { rootRx: -1.62, rootY: -0.8, spRx: 0, nkRx: -0.1, knL: 0.3, knR: 0.2 }, 'in', 'land'),
  k(f(22), { rootRx: -1.5, rootY: -0.76 }),
  k(f(40), { rootRx: -1.57, rootY: -0.8, knL: 0.5, knR: 0.25, shLab: 0.9, shRab: 1.1, elL: 0.6, elR: 0.3, nkRz: 0.3 }),
] });

// launched: up and over backwards (the fighter's own height is physics; this is the tumble)
defineClip({ name: 'f.launched', dur: f(50), hold: true, keys: [
  k(0, { ...S, rootRx: 0 }),
  k(f(8), { rootRx: -0.6, spRx: -0.5, nkRx: -0.5, shLab: 1.2, shRab: 1.2, elL: 0.3, elR: 0.3, gripL: 4, gripR: 4, knL: 0.8, knR: 0.5, hipLf: 0.6 }, 'out'),
  k(f(30), { rootRx: -1.3, knL: 1.0, knR: 0.6, hipLf: 0.8, hipRf: 0.4 }),
  k(f(50), { rootRx: -1.57, knL: 0.4, knR: 0.2, hipLf: 0.2, hipRf: 0.1 }),
] });

defineClip({ name: 'f.getup', dur: f(50), hold: true, keys: [
  k(0, { rootRx: -1.57, rootY: -0.8, knL: 0.5, knR: 0.25, shLab: 0.9, shRab: 1.1 }),
  k(f(14), { rootRx: -0.8, rootY: -0.6, knL: 1.9, knR: 1.6, hipLf: 1.3, hipRf: 1.0, shLf: -0.3, shRf: -0.3, elL: 0.3, elR: 0.3, gripL: 4, gripR: 4, spRx: 0.5 }),
  k(f(30), { rootRx: 0, rootY: -0.35, knL: 1.9, knR: 1.1, hipLf: 1.2, hipRf: 0.3, spRx: 0.4, shLf: 0.6, shRf: 0.6, elL: 1.4, elR: 1.4 }),
  k(f(50), { ...S, rootRx: 0, rootY: 0 }),
] });

defineClip({ name: 'f.ko', dur: f(70), hold: true, keys: [
  k(0, { ...S, rootRx: 0, rootY: 0 }),
  k(f(10), { spRx: -0.5, nkRx: -0.6, nkRy: 0.4, rootRx: -0.2, knL: 0.6, knR: 0.9, shLab: 0.7, shRab: 1.2, elL: 0.3, elR: 0.3, gripL: 0, gripR: 4, blink: 1 }, 'out'),
  k(f(30), { rootRx: -0.8, rootY: -0.35, knL: 1.3, knR: 1.1 }, 'in'),
  k(f(44), { rootRx: -1.6, rootY: -0.8, knL: 0.4, knR: 0.3, spRx: 0 }, 'in', 'land'),
  k(f(70), { rootRx: -1.57, rootY: -0.8, knL: 0.3, knR: 0.2, shLab: 1.0, shRab: 1.2, nkRz: 0.5, nkRx: 0, blink: 1 }),
] });

// ── the finisher: a pull into a knee, an elbow, a turning kick

defineClip({ name: 'f.finisher', dur: 2.2, hold: true, keys: [
  k(0, S),
  k(0.25, arms({ shLf: 1.5, shRf: 1.5, elL: 1.0, elR: 1.0, gripL: 1, gripR: 1, rootZ: 0.2 })),
  k(0.45, arms({ shLf: 1.1, shRf: 1.1, elL: 1.9, elR: 1.9, hipRf: 1.5, knR: 2.3, spRx: 0.2, rootZ: 0.3 }), 'out', 'hit1'),
  k(0.75, arms({ hipRf: 0, knR: 0.4, shRf: 0.4, shRab: 1.2, elR: 2.6, spRy: 0.9, rootZ: 0.3 })),
  k(0.95, arms({ shRf: 1.2, shRab: 0.6, shRtw: 1.4, elR: 2.6, spRy: -0.7, rootZ: 0.35 }), 'out', 'hit2'),
  k(1.3, arms({ spRy: 0.6, hipRf: 1.0, hipRab: 0.4, knR: 2.0, pelRy: 0.5, rootZ: 0.3 })),
  k(1.55, arms({ hipRf: 1.3, hipRab: 1.2, hipRtw: 0.6, knR: 0.1, anR: -0.6, pelRy: -1.0, spRz: 0.35, rootZ: 0.3 }), 'out', 'hit3'),
  k(2.2, { ...S, rootZ: 0 }),
] });

defineClip({ name: 'f.victory', dur: 2.6, hold: true, keys: [
  k(0, S),
  k(0.5, { spRy: 0, spRx: -0.1, pelRy: 0, nkRy: 0, nkRx: -0.2, shRf: 2.9, shRab: 0.2, elR: 0.3, gripR: 1, shLf: 0.1, shLab: 0.2, elL: 0.4, gripL: 1, hipLf: 0.05, hipRf: -0.05, knL: 0.05, knR: 0.05 }, 'out'),
  k(0.8, { shRf: 2.7, elR: 0.5 }),
  k(1.1, { shRf: 2.95, elR: 0.25 }),
  k(2.6, { shRf: 2.9, elR: 0.3, nkRx: -0.15 }),
] });

defineClip({ name: 'f.victory2', dur: 2.6, hold: true, keys: [
  k(0, S),
  k(0.6, { spRy: 0.1, spRx: -0.08, pelRy: 0, nkRy: 0.2, nkRx: 0.05, shLf: 0.45, shLab: 0.25, elL: 2.2, elLtw: 1.1, gripL: 1, shRf: 0.15, shRab: 0.3, elR: 0.5, hipLf: 0.1, hipRf: -0.05, knL: 0.08, knR: 0.05 }, 'out'),
  k(0.9, { shLf: 0.55 }), k(1.2, { shLf: 0.45 }),
  k(2.6, { nkRy: 0.35 }),
] });

defineClip({ name: 'f.defeat', dur: 2.4, hold: true, keys: [
  k(0, S),
  k(0.9, { spRy: 0, pelRy: 0, hipLf: 1.4, knL: 1.6, hipRf: -0.2, knR: 2.3, anR: 0.5, pelY: -0.02, spRx: 0.45, nkRx: 0.55, nkRy: 0, shLf: 0.4, shLab: 0.2, elL: 0.8, shRf: 0.2, elR: 0.4, gripL: 0, gripR: 0 }, 'in'),
  k(2.4, { spRx: 0.5, nkRx: 0.6 }),
] });

defineClip({ name: 'f.intro', dur: 2.2, keys: [
  k(0, { spRy: 0, pelRy: 0, nkRy: 0, shLf: 0, shRf: 0, elL: 0.3, elR: 0.3, hipLf: 0, hipRf: 0, knL: 0.05, knR: 0.05, shLab: 0.15, shRab: 0.15 }),
  k(0.6, { nkRz: 0.2 }), k(0.9, { nkRz: -0.2 }), k(1.1, { nkRz: 0 }),
  k(1.5, { ...S }),
  k(2.2, S),
] });
