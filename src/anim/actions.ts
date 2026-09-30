import { defineClip, type Ease, type Key } from './Animator';
import type { Channel } from './pose';

/**
 * Everything a body does to the world, and what the world does to a body.
 *
 * Doors (knock, unlock, push, close), things (put down, search low and high,
 * open a box, carry, drag, throw), phones (answer, dial, hang up, a
 * payphone), buying (a vending machine, paying at a counter), eating and
 * drinking, lying down, kneeling, first aid and helping someone up,
 * butchering, making a fire, casting and reeling a line, shoving, pulling a
 * driver out, a hug; and reactions: a horn, a near miss, an explosion, being
 * knocked down, shivering, a whisper; and the rare wrong ones.
 *
 * Blocked the way an animator blocks: anticipation, action, follow-through,
 * settle. Named events ('knock', 'grab', 'release', 'take', 'strike', …)
 * let the game time sounds and effects to the hand.
 */

type P = Partial<Record<Channel, number>>;
const k = (t: number, p: P, e?: Ease, ev?: string): Key => ({ t, p, e, ev });
const R = (f: number, ab: number, el: number, tw = 0, wr = 0.08, grip?: number): P => ({ shRf: f, shRab: ab, elR: el, elRtw: tw, wrR: wr, ...(grip != null ? { gripR: grip } : {}) });
const L = (f: number, ab: number, el: number, tw = 0, wr = 0.08, grip?: number): P => ({ shLf: f, shLab: ab, elL: el, elLtw: tw, wrL: wr, ...(grip != null ? { gripL: grip } : {}) });
const B = (f: number, ab: number, el: number, tw = 0, wr = 0.08, grip?: number): P => ({ ...L(f, ab, el, tw, wr, grip), ...R(f, ab, el, tw, wr, grip) });
const RN = R(0, 0.18, 0.3, -0.35, 0.08, 0);
const LN = L(0, 0.18, 0.3, -0.35, 0.08, 0);
/** standing legs (for full-body clips that start and end on their feet) */
const STAND: P = { hipLf: 0, knL: 0.05, hipRf: 0, knR: 0.05, anL: 0, anR: 0, spRx: 0.04 };
/** a crouch: hips back and down, knees forward */
const CROUCH: P = { hipLf: 1.35, knL: 2.2, hipRf: 1.1, knR: 2.0, anL: -0.3, anR: -0.2, spRx: 0.55 };
/** on one knee (right knee down) */
const KNEEL: P = { hipLf: 1.45, knL: 1.6, hipRf: 0.1, knR: 1.75, anL: -0.1, anR: 0.6, spRx: 0.3 };

/* ═══════════════════════════ doors and locks ═══════════════════════════ */

defineClip({ name: 'act.knock', dur: 1.6, mask: 'upper', keys: [
  k(0, { ...RN, spRx: 0.04, nkRx: 0 }),
  k(0.35, { ...R(1.0, 0.25, 1.9, 0.3, 0.1, 1), spRx: 0.08 }, 'out'),
  k(0.5, { ...R(1.2, 0.25, 1.55, 0.3, 0.1, 1) }, 'in', 'knock'),
  k(0.62, { ...R(1.0, 0.25, 1.9, 0.3, 0.1, 1) }),
  k(0.77, { ...R(1.2, 0.25, 1.55, 0.3, 0.1, 1) }, 'in', 'knock'),
  k(0.89, { ...R(1.0, 0.25, 1.9, 0.3, 0.1, 1) }),
  k(1.04, { ...R(1.2, 0.25, 1.55, 0.3, 0.1, 1), nkRx: 0.05 }, 'in', 'knock'),
  k(1.6, { ...RN, spRx: 0.04, nkRx: 0.02 }),
] });

defineClip({ name: 'act.unlock', dur: 1.6, mask: 'upper', keys: [
  k(0, { ...RN, spRx: 0.04, nkRx: 0 }),
  k(0.45, { ...R(0.95, 0.12, 1.1, 0.2, 0, 3), spRx: 0.18, nkRx: 0.35 }, 'out'),
  k(0.75, { ...R(0.98, 0.12, 1.05, 0.9, 0, 3) }, 'smooth', 'turn'),
  k(1.0, { ...R(0.98, 0.12, 1.05, 0.2, 0, 3) }),
  k(1.6, { ...RN, spRx: 0.04, nkRx: 0 }),
] });

defineClip({ name: 'act.pushDoor', dur: 1.0, mask: 'upper', keys: [
  k(0, { ...RN, ...LN, spRx: 0.04 }),
  k(0.3, { ...R(1.35, 0.1, 0.5, 0, -0.9, 4), spRx: 0.12 }, 'out'),
  k(0.5, { ...R(1.4, 0.1, 0.15, 0, -1.0, 4), spRx: 0.2 }, 'in', 'door'),
  k(1.0, { ...RN, spRx: 0.04 }),
] });

defineClip({ name: 'act.closeDoor', dur: 1.1, mask: 'upper', keys: [
  k(0, { ...LN, spRx: 0.04, nkRy: 0 }),
  k(0.35, { ...L(0.6, 0.9, 0.4, 0, 0, 4), spRy: -0.25, nkRy: -0.5 }, 'out'),
  k(0.6, { ...L(0.8, 0.35, 0.9, 0, 0, 1), spRy: -0.05, nkRy: -0.2 }, 'smooth', 'door'),
  k(1.1, { ...LN, spRx: 0.04, spRy: 0, nkRy: 0 }),
] });

/* ═══════════════════════════ things ═══════════════════════════ */

defineClip({ name: 'act.putDown', dur: 1.7, hold: true, keys: [
  k(0, { ...STAND, ...R(0.3, 0.2, 1.2, 0.4, 0, 1) }),
  k(0.7, { hipLf: 1.0, knL: 1.9, hipRf: 0.6, knR: 1.3, spRx: 0.7, ...R(1.1, 0.12, 0.3, 0.2, 0, 1), nkRx: 0.4 }, 'out'),
  k(0.85, { gripR: 4 }, undefined, 'drop'),
  k(1.7, { ...STAND, ...RN, nkRx: 0 }),
] });

defineClip({ name: 'act.search', dur: 3.2, hold: true, keys: [
  k(0, { ...STAND, ...RN, ...LN, nkRx: 0 }),
  k(0.6, { ...CROUCH, ...R(1.0, 0.25, 0.6, 0.2, 0.3, 4), ...L(0.9, 0.3, 0.7, 0.2, 0.3, 4), nkRx: 0.45 }, 'out'),
  k(1.0, { ...R(1.15, 0.1, 0.4, 0.3, 0.5, 4), ...L(0.8, 0.45, 0.9, 0, 0.2, 4), nkRy: 0.2 }, 'smooth', 'rummage'),
  k(1.4, { ...R(0.9, 0.35, 0.8, 0, 0.2, 4), ...L(1.15, 0.12, 0.4, 0.3, 0.5, 4), nkRy: -0.15 }, 'smooth', 'rummage'),
  k(1.9, { ...R(1.2, 0.05, 0.35, 0.4, 0.6, 4), ...L(0.85, 0.4, 0.8, 0, 0.2, 4), nkRy: 0.1, nkRx: 0.55 }, 'smooth', 'rummage'),
  k(2.3, { ...R(0.8, 0.3, 1.0, 0.3, 0, 1), ...L(0.9, 0.3, 0.8), nkRx: 0.35, nkRy: 0 }, 'smooth', 'grab'),
  k(3.2, { ...STAND, ...RN, ...LN, nkRx: 0, nkRy: 0 }),
] });

defineClip({ name: 'act.searchHigh', dur: 2.6, mask: 'upper', keys: [
  k(0, { ...RN, ...LN, nkRx: 0, spRx: 0.04 }),
  k(0.6, { ...R(2.5, 0.3, 0.5, 0, 0.2, 4), ...L(1.2, 0.3, 0.8, 0, 0, 4), nkRx: -0.45, spRx: -0.1 }, 'out'),
  k(1.2, { ...R(2.55, 0.15, 0.6, 0.3, 0.4, 4), nkRy: 0.15 }, 'smooth', 'rummage'),
  k(1.7, { ...R(2.45, 0.35, 0.4, 0, 0.1, 1), nkRy: -0.1 }, 'smooth', 'grab'),
  k(2.6, { ...RN, ...LN, nkRx: 0, nkRy: 0, spRx: 0.04 }),
] });

defineClip({ name: 'act.openBox', dur: 1.8, hold: true, keys: [
  k(0, { ...STAND, ...RN, ...LN }),
  k(0.6, { ...CROUCH, ...B(1.0, 0.35, 0.5, 0, 0.2, 4), nkRx: 0.5 }, 'out'),
  k(1.1, { ...B(1.4, 0.35, 0.3, 0, -0.5, 1), spRx: 0.4, nkRx: 0.35 }, 'smooth', 'open'),
  k(1.8, { ...CROUCH, ...B(0.9, 0.3, 0.6, 0, 0.2, 4), nkRx: 0.55 }),
] });

defineClip({ name: 'act.carry', dur: 2, loop: true, mask: 'arms', keys: [
  k(0, { ...B(0.55, 0.35, 1.45, 0.9, 0, 4) }),
  k(1, { ...B(0.57, 0.36, 1.45, 0.9, 0, 4) }),
  k(2, { ...B(0.55, 0.35, 1.45, 0.9, 0, 4) }),
] });

defineClip({ name: 'act.drag', dur: 1.4, loop: true, mask: 'upper', keys: [
  k(0, { ...B(0.7, 0.2, 0.2, 0, 0, 1), spRx: -0.2, nkRx: 0.25 }),
  k(0.7, { ...B(0.62, 0.22, 0.3, 0, 0, 1), spRx: -0.26, nkRx: 0.3 }),
  k(1.4, { ...B(0.7, 0.2, 0.2, 0, 0, 1), spRx: -0.2, nkRx: 0.25 }),
] });

defineClip({ name: 'act.throw', dur: 1.2, mask: 'upper', keys: [
  k(0, { ...RN, ...LN, spRy: 0, spRx: 0.04 }),
  k(0.4, { ...R(2.4, 0.5, 1.6, 0, -0.4, 1), ...L(1.0, 0.3, 0.4, 0, 0, 4), spRy: 0.45, spRx: -0.1 }, 'out'),
  k(0.58, { ...R(1.4, 0.2, 0.25, 0, 0.6, 4), ...L(-0.2, 0.3, 0.3), spRy: -0.35, spRx: 0.2 }, 'in', 'release'),
  k(1.2, { ...RN, ...LN, spRy: 0, spRx: 0.04 }),
] });

defineClip({ name: 'act.dropWeapon', dur: 0.9, mask: 'upper', keys: [
  k(0, { ...R(0.6, 0.15, 0.6, 0, 0, 1) }),
  k(0.3, { ...R(0.4, 0.3, 0.2, 0, 0.5, 4) }, 'out', 'drop'),
  k(0.9, { ...RN }),
] });

defineClip({ name: 'gun.inspect', dur: 3, mask: 'upper', keys: [
  k(0, { ...R(0.6, 0.15, 1.2, 0.3, 0, 1), ...L(0.7, 0.1, 1.3, 0.5, 0, 1), nkRx: 0.1 }),
  k(0.7, { ...R(0.9, 0.3, 1.9, 1.2, 0.3, 1), ...L(0.8, 0.1, 1.6, 0.6, 0, 4), nkRx: 0.3, nkRy: 0.2 }, 'out'),
  k(1.6, { ...R(0.9, 0.3, 1.9, -0.4, -0.3, 1), nkRy: 0.1 }, 'smooth', 'turn'),
  k(2.3, { ...R(0.8, 0.2, 1.7, 0.3, 0, 1), ...L(0.7, 0.1, 1.3, 0.5, 0, 1) }),
  k(3, { ...R(0.6, 0.15, 1.2, 0.3, 0, 1), nkRx: 0.1, nkRy: 0 }),
] });

/* ═══════════════════════════ phones ═══════════════════════════ */

defineClip({ name: 'act.answer', dur: 1.3, mask: 'upper', keys: [
  k(0, { ...RN, nkRz: 0 }),
  k(0.4, { ...R(-0.1, 0.25, 0.9, 0, 0.1, 4), nkRx: 0.2 }, 'out'),
  k(0.7, { ...R(0.5, 0.4, 1.6, 0.6, 0, 1), nkRx: 0.35 }),
  k(1.3, { ...R(0.62, 0.85, 2.45, 1.0, -0.1, 1), nkRz: 0.12, nkRx: 0.05 }, 'smooth', 'ear'),
] });

defineClip({ name: 'act.dial', dur: 2.6, mask: 'upper', keys: [
  k(0, { ...LN, ...RN, nkRx: 0 }),
  k(0.5, { ...L(0.5, 0.05, 1.75, 0.4, -0.2, 1), ...R(0.45, 0.1, 1.8, 0.7, 0.1, 2), nkRx: 0.45 }, 'out'),
  k(0.8, { wrR: 0.35 }, 'in', 'tap'), k(1.0, { wrR: 0.05 }),
  k(1.2, { wrR: 0.35, elRtw: 0.6 }, 'in', 'tap'), k(1.4, { wrR: 0.05 }),
  k(1.6, { wrR: 0.35, elRtw: 0.8 }, 'in', 'tap'), k(1.8, { wrR: 0.05 }),
  k(2.6, { ...L(0.62, 0.85, 2.45, 1.0, -0.1, 1), ...RN, nkRx: 0.05, nkRz: -0.12 }),
] });

defineClip({ name: 'act.hangUp', dur: 1.0, mask: 'upper', keys: [
  k(0, { ...R(0.62, 0.85, 2.45, 1.0, -0.1, 1), nkRz: 0.12 }),
  k(0.4, { ...R(0.5, 0.3, 1.7, 0.6, 0.2, 1), nkRx: 0.3, nkRz: 0 }, 'out', 'hangup'),
  k(1.0, { ...RN, nkRx: 0 }),
] });

defineClip({ name: 'act.payphone', dur: 4.5, mask: 'upper', keys: [
  k(0, { ...LN, ...RN, nkRx: 0 }),
  k(0.5, { ...L(1.1, 0.3, 1.2, 0, 0, 1), spRx: 0.08 }, 'out', 'lift'),
  k(1.0, { ...L(0.62, 0.85, 2.45, 1.0, -0.1, 1), nkRz: -0.14 }),
  k(1.3, { ...R(1.2, 0.05, 1.0, 0, 0, 2), nkRx: 0.2 }, 'out'),
  k(1.5, { ...R(1.25, 0.05, 0.95, 0, 0.2, 2) }, 'in', 'tap'), k(1.65, { ...R(1.2, 0.08, 1.0, 0, 0, 2) }),
  k(1.8, { ...R(1.22, 0.02, 0.95, 0, 0.2, 2) }, 'in', 'tap'), k(1.95, { ...R(1.18, 0.05, 1.0, 0, 0, 2) }),
  k(2.1, { ...R(1.25, 0.1, 0.95, 0, 0.2, 2) }, 'in', 'tap'),
  k(2.6, { ...RN, nkRx: 0.05 }),
  k(4.5, { ...L(0.62, 0.85, 2.45, 1.0, -0.1, 1), ...RN, nkRz: -0.1, nkRx: 0.08 }),
] });

/* ═══════════════════════════ buying, eating, drinking ═══════════════════════════ */

defineClip({ name: 'act.vend', dur: 3.4, hold: true, keys: [
  k(0, { ...STAND, ...RN, nkRx: 0 }),
  k(0.5, { ...R(1.3, 0.1, 0.6, 0.2, 0, 2), nkRx: 0.1 }, 'out', 'coin'),
  k(0.9, { ...R(1.25, 0.12, 0.7, 0, 0.2, 2) }, 'smooth', 'press'),
  k(1.1, { ...R(1.2, 0.12, 0.8, 0, 0, 2) }),
  k(1.9, { ...R(0.4, 0.2, 0.4), nkRx: 0.3 }, 'smooth', 'thunk'),
  k(2.5, { hipLf: 0.9, knL: 1.6, hipRf: 0.5, knR: 1.1, spRx: 0.6, ...R(0.9, 0.1, 0.3, 0, 0, 4), nkRx: 0.4 }, 'out'),
  k(2.7, { gripR: 1 }, undefined, 'take'),
  k(3.4, { ...STAND, ...R(0.3, 0.2, 1.3, 0.4, 0, 1), nkRx: 0 }),
] });

defineClip({ name: 'act.buy', dur: 2.2, mask: 'upper', keys: [
  k(0, { ...RN, nkRx: 0 }),
  k(0.5, { ...R(1.05, 0.1, 0.7, 0.4, 0, 4), nkRx: 0.2, spRx: 0.12 }, 'out', 'pay'),
  k(1.0, { ...R(1.0, 0.1, 0.8, 0.4, 0, 4), nkRx: 0.1 }),
  k(1.3, { ...R(1.05, 0.12, 0.7, 0.4, 0, 1) }, 'smooth', 'take'),
  k(2.2, { ...R(0.3, 0.2, 1.2, 0.4, 0, 1), nkRx: 0, spRx: 0.04 }),
] });

defineClip({ name: 'act.eat', dur: 3, mask: 'upper', keys: [
  k(0, { ...R(0.3, 0.2, 1.2, 0.4, 0, 1), jaw: 0 }),
  k(0.5, { ...R(0.55, 0.45, 2.35, 0.9, -0.2, 1), nkRx: 0.1, jaw: 0.35 }, 'out', 'bite'),
  k(0.8, { ...R(0.45, 0.35, 1.9, 0.7, 0, 1), jaw: 0.05 }),
  k(1.05, { jaw: 0.25 }), k(1.3, { jaw: 0.05 }), k(1.55, { jaw: 0.25 }),
  k(1.9, { ...R(0.55, 0.45, 2.35, 0.9, -0.2, 1), jaw: 0.35 }, 'out', 'bite'),
  k(2.2, { ...R(0.45, 0.35, 1.9, 0.7, 0, 1), jaw: 0.05 }),
  k(2.5, { jaw: 0.2 }),
  k(3, { ...R(0.3, 0.2, 1.2, 0.4, 0, 1), jaw: 0, nkRx: 0 }),
] });

defineClip({ name: 'act.drinkBottle', dur: 2.6, mask: 'upper', keys: [
  k(0, { ...R(0.3, 0.2, 1.2, 0.4, 0, 1), nkRx: 0 }),
  k(0.6, { ...R(0.75, 0.5, 2.4, 1.0, -0.4, 1), nkRx: -0.35, spRx: -0.06 }, 'out', 'sip'),
  k(1.6, { ...R(0.85, 0.55, 2.4, 1.0, -0.7, 1), nkRx: -0.55, spRx: -0.1 }),
  k(2.0, { ...R(0.4, 0.25, 1.6, 0.5, 0, 1), nkRx: 0.05, spRx: 0.04 }),
  k(2.6, { ...R(0.3, 0.2, 1.2, 0.4, 0, 1), nkRx: 0 }),
] });

/* ═══════════════════════════ rest ═══════════════════════════ */

defineClip({ name: 'act.lieDown', dur: 2.6, hold: true, keys: [
  k(0, { ...STAND, rootRx: 0, rootY: 0, ...RN, ...LN, nkRx: 0 }),
  k(0.8, { ...KNEEL, ...B(0.3, 0.3, 0.5, 0, 0, 4), nkRx: 0.2 }, 'out'),
  k(1.5, { rootRx: -0.8, rootY: -0.55, hipLf: 1.1, knL: 1.8, hipRf: 0.9, knR: 1.6, spRx: 0.2, ...L(-0.4, 0.4, 0.3, 0, 0.5, 4), ...R(-0.4, 0.4, 0.3, 0, 0.5, 4) }),
  k(2.6, { rootRx: -1.57, rootY: -0.82, hipLf: 0.25, knL: 0.35, hipRf: 0.1, knR: 0.15, spRx: 0, ...L(0.35, 0.35, 1.3, 0.5, 0, 0), ...R(0.3, 0.3, 1.4, 0.5, 0, 0), nkRx: -0.1, nkRz: 0.2, blink: 1 }, 'smooth', 'down'),
] });

defineClip({ name: 'act.kneel', dur: 1.2, hold: true, keys: [
  k(0, { ...STAND }),
  k(1.2, { ...KNEEL, nkRx: 0.3 }, 'out'),
] });

defineClip({ name: 'act.stand', dur: 1.1, hold: true, keys: [
  k(0, { ...KNEEL, nkRx: 0.3 }),
  k(0.5, { hipLf: 1.0, knL: 1.3, hipRf: 0.4, knR: 0.9, spRx: 0.45 }, 'out'),
  k(1.1, { ...STAND, nkRx: 0 }),
] });

/* ═══════════════════════════ hands on other people ═══════════════════════════ */

defineClip({ name: 'act.hug', dur: 3, mask: 'upper', keys: [
  k(0, { ...RN, ...LN, spRx: 0.04 }),
  k(0.6, { ...B(1.3, -0.1, 1.2, 1.0, 0, 4), spRx: 0.15, nkRy: 0.4, nkRz: 0.1 }, 'out'),
  k(1.2, { ...B(1.35, -0.2, 1.5, 1.2, 0.2, 4), spRx: 0.18, nkRy: 0.45 }),
  k(2.3, { ...B(1.32, -0.18, 1.45, 1.15, 0.2, 4), nkRy: 0.4 }),
  k(3, { ...RN, ...LN, spRx: 0.04, nkRy: 0, nkRz: 0 }),
] });

defineClip({ name: 'act.shove', dur: 0.9, mask: 'upper', keys: [
  k(0, { ...RN, ...LN, spRx: 0.04 }),
  k(0.25, { ...B(0.9, 0.2, 1.6, 0.4, -0.8, 4), spRx: -0.05 }, 'out'),
  k(0.4, { ...B(1.45, 0.1, 0.15, 0, -1.1, 4), spRx: 0.25 }, 'in', 'hit'),
  k(0.9, { ...RN, ...LN, spRx: 0.04 }),
] });

defineClip({ name: 'act.pullOut', dur: 1.6, hold: true, keys: [
  k(0, { ...STAND, ...RN, ...LN }),
  k(0.4, { ...R(1.25, 0.2, 0.35, 0, 0, 4), ...L(1.1, 0.3, 0.5, 0, 0, 4), spRx: 0.3 }, 'out'),
  k(0.6, { gripR: 1, gripL: 1 }, undefined, 'grab'),
  k(1.0, { ...R(0.2, 0.3, 1.6, 0, 0, 1), ...L(0.1, 0.3, 1.5, 0, 0, 1), spRx: -0.25, spRy: -0.4, hipLf: -0.2, knL: 0.3 }, 'in', 'yank'),
  k(1.6, { ...STAND, ...RN, ...LN, spRy: 0 }),
] });

defineClip({ name: 'act.helpUp', dur: 2.4, hold: true, keys: [
  k(0, { ...STAND, ...RN, ...LN }),
  k(0.7, { ...CROUCH, ...R(1.3, 0.1, 0.2, 0, 0, 4), nkRx: 0.4 }, 'out'),
  k(0.9, { gripR: 1 }, undefined, 'grab'),
  k(1.8, { hipLf: 0.5, knL: 0.8, hipRf: 0.3, knR: 0.6, spRx: -0.1, ...R(0.9, 0.1, 0.9, 0, 0, 1), nkRx: 0.1 }, 'smooth', 'lift'),
  k(2.4, { ...STAND, ...RN, nkRx: 0 }),
] });

defineClip({ name: 'act.firstAid', dur: 3.2, hold: true, keys: [
  k(0, { ...STAND, ...RN, ...LN }),
  k(0.7, { ...KNEEL, ...B(1.0, 0.2, 0.9, 0.3, 0.2, 4), nkRx: 0.55 }, 'out'),
  k(1.2, { ...R(1.1, 0.35, 1.2, 0.6, 0.4, 1), ...L(1.0, 0.1, 0.8, 0.3, 0, 4) }, 'smooth', 'wrap'),
  k(1.7, { ...R(0.9, 0.05, 0.9, -0.2, -0.3, 1) }, 'smooth', 'wrap'),
  k(2.2, { ...R(1.1, 0.35, 1.2, 0.6, 0.4, 1) }, 'smooth', 'wrap'),
  k(3.2, { ...STAND, ...RN, ...LN, nkRx: 0 }),
] });

/** bandaging your own arm (healing yourself) */
defineClip({ name: 'act.bandage', dur: 3, mask: 'upper', keys: [
  k(0, { ...RN, ...LN, nkRx: 0 }),
  k(0.5, { ...L(0.8, 0.15, 1.6, 0.9, 0, 4), ...R(0.6, 0.3, 1.9, 0.7, 0, 1), nkRx: 0.45 }, 'out'),
  k(1.0, { ...R(0.7, 0.05, 1.5, 0.2, 0.3, 1) }, 'smooth', 'wrap'),
  k(1.5, { ...R(0.5, 0.45, 2.1, 0.9, -0.3, 1) }, 'smooth', 'wrap'),
  k(2.0, { ...R(0.7, 0.05, 1.5, 0.2, 0.3, 1) }, 'smooth', 'wrap'),
  k(3, { ...RN, ...LN, nkRx: 0 }),
] });

/* ═══════════════════════════ out in the wild ═══════════════════════════ */

defineClip({ name: 'act.butcher', dur: 3.4, hold: true, keys: [
  k(0, { ...STAND, ...RN, ...LN }),
  k(0.8, { ...KNEEL, ...R(1.2, 0.2, 0.7, 0.2, 0.3, 1), ...L(1.0, 0.35, 0.6, 0, 0, 4), nkRx: 0.6 }, 'out'),
  k(1.2, { ...R(1.0, 0.15, 1.1, 0.2, -0.3, 1) }, 'smooth', 'cut'),
  k(1.6, { ...R(1.25, 0.2, 0.6, 0.2, 0.3, 1) }, 'smooth', 'cut'),
  k(2.0, { ...R(1.0, 0.15, 1.1, 0.2, -0.3, 1) }, 'smooth', 'cut'),
  k(2.4, { ...R(1.25, 0.2, 0.6, 0.2, 0.3, 1) }),
  k(3.4, { ...STAND, ...RN, ...LN, nkRx: 0 }),
] });

defineClip({ name: 'act.lightFire', dur: 3, hold: true, keys: [
  k(0, { ...STAND, ...RN, ...LN }),
  k(0.8, { ...CROUCH, ...B(1.2, 0.05, 1.0, 0.4, 0, 1), nkRx: 0.6 }, 'out'),
  k(1.3, { ...R(1.25, 0.05, 1.1, 0.4, -0.5, 3) }, 'in', 'strike'),
  k(1.5, { ...R(1.2, 0.05, 1.0, 0.4, 0, 1) }),
  k(1.9, { ...R(1.25, 0.05, 1.1, 0.4, -0.5, 3) }, 'in', 'strike'),
  k(2.2, { ...B(1.1, 0.2, 1.4, 0.6, 0, 4), nkRx: 0.5 }, 'smooth', 'lit'),
  k(3, { ...CROUCH, ...B(1.0, 0.2, 1.3, 0.6, 0, 4), nkRx: 0.4 }),
] });

defineClip({ name: 'act.cast', dur: 1.8, mask: 'upper', keys: [
  k(0, { ...R(0.7, 0.2, 1.2, 0.3, 0, 1), ...L(0.5, 0.1, 1.2, 0.3, 0, 1), spRy: 0 }),
  k(0.6, { ...R(2.5, 0.3, 1.3, 0, -0.3, 1), ...L(1.5, 0.1, 1.5, 0, 0, 1), spRy: 0.2, spRx: -0.12 }, 'out'),
  k(0.85, { ...R(1.0, 0.2, 0.5, 0, 0.4, 1), ...L(0.7, 0.1, 1.1, 0, 0, 1), spRy: -0.1, spRx: 0.15 }, 'in', 'release'),
  k(1.8, { ...R(0.8, 0.2, 1.0, 0.3, 0, 1), ...L(0.6, 0.1, 1.2, 0.3, 0, 1), spRy: 0, spRx: 0.06 }),
] });

defineClip({ name: 'act.reel', dur: 0.9, loop: true, mask: 'arms', keys: [
  k(0, { ...R(0.8, 0.2, 1.0, 0.3, 0, 1), ...L(0.75, 0.35, 1.4, 0.6, 0, 1), elLtw: 0.3 }),
  k(0.45, { elLtw: 0.9, shLab: 0.45, wrL: 0.3 }),
  k(0.9, { elLtw: 0.3, shLab: 0.35, wrL: 0.08 }),
] });

/* ═══════════════════════════ reactions ═══════════════════════════ */

// a horn behind you: a jolt, a look, and (for some) a gesture back
defineClip({ name: 'react.horn', dur: 1.4, mask: 'upper', keys: [
  k(0, { shLup: 0, shRup: 0, nkRy: 0, spRx: 0.04 }),
  k(0.1, { shLup: 0.55, shRup: 0.55, spRx: -0.06, blink: 1, browUp: 0.8 }, 'out'),
  k(0.45, { nkRy: 0.9, spRy: 0.3, shLup: 0.25, shRup: 0.25, blink: 0 }),
  k(1.0, { nkRy: 0.85, spRy: 0.28 }),
  k(1.4, { shLup: 0, shRup: 0, nkRy: 0, spRy: 0, spRx: 0.04, browUp: 0 }),
] });

defineClip({ name: 'react.annoyed', dur: 1.8, mask: 'upper', keys: [
  k(0, { ...RN, spRx: 0.04 }),
  k(0.4, { ...R(1.6, 0.5, 0.9, 0, 0.2, 4), spRx: -0.05, nkRx: -0.1, frown: 0.6, browIn: 0.8 }, 'out'),
  k(0.9, { ...R(1.4, 0.55, 1.1, 0, 0.3, 4) }),
  k(1.8, { ...RN, spRx: 0.04, nkRx: 0, frown: 0, browIn: 0 }),
] });

// a car too close: a jump back, arms up
defineClip({ name: 'react.nearMiss', dur: 1.3, hold: true, keys: [
  k(0, { ...STAND, ...RN, ...LN }),
  k(0.15, { hipLf: -0.3, knL: 0.5, hipRf: 0.35, knR: 0.3, spRx: -0.25, ...B(0.9, 0.5, 1.4, 0.5, 0, 4), nkRx: -0.15, blink: 1, browUp: 1 }, 'out'),
  k(0.6, { hipLf: -0.15, knL: 0.35, hipRf: 0.15, knR: 0.2, spRx: -0.1, ...B(0.5, 0.35, 1.0), blink: 0 }),
  k(1.3, { ...STAND, ...RN, ...LN, nkRx: 0, browUp: 0 }),
] });

// a blast: turn from it, arms round the head, crouch
defineClip({ name: 'react.shield', dur: 1.8, hold: true, keys: [
  k(0, { ...STAND, ...RN, ...LN, spRy: 0 }),
  k(0.15, { hipLf: 0.8, knL: 1.3, hipRf: 0.6, knR: 1.1, spRx: 0.55, spRy: 0.4, ...B(2.2, 0.3, 2.3, 1.0, 0, 1), nkRx: 0.5, blink: 1 }, 'out'),
  k(1.1, { hipLf: 0.7, knL: 1.2, hipRf: 0.5, knR: 1.0, spRx: 0.5 }),
  k(1.8, { ...STAND, ...RN, ...LN, spRy: 0, nkRx: 0, blink: 0 }),
] });

// hit by a car: thrown, down, and stays down (react.getUp brings them back)
defineClip({ name: 'react.knockdown', dur: 1.2, hold: true, keys: [
  k(0, { ...STAND, rootRx: 0, rootY: 0, ...RN, ...LN }),
  k(0.18, { rootRx: -0.5, rootY: 0.1, knL: 0.9, knR: 0.3, spRx: -0.4, ...B(1.2, 1.0, 0.4, 0, 0, 4), nkRx: -0.5, blink: 1 }, 'out'),
  k(0.7, { rootRx: -1.5, rootY: -0.7, knL: 0.6, knR: 0.9, spRx: 0.1, nkRx: 0.2 }, 'in', 'land'),
  k(0.9, { rootRx: -1.45, rootY: -0.76 }),
  k(1.2, { rootRx: -1.57, rootY: -0.8, knL: 0.35, knR: 0.12, ...L(0.5, 1.15, 0.35), ...R(0.25, 0.95, 0.45), nkRz: 0.4, blink: 0 }),
] });

defineClip({ name: 'react.shiver', dur: 1.2, loop: true, mask: 'upper', additive: true, keys: [
  k(0, { shLup: 0, shRup: 0, spRz: 0 }),
  k(0.1, { shLup: 0.06, shRup: 0.07, spRz: 0.01 }), k(0.2, { shLup: 0, shRup: 0.01, spRz: -0.01 }),
  k(0.3, { shLup: 0.07, shRup: 0.05, spRz: 0.012 }), k(0.4, { shLup: 0, shRup: 0, spRz: 0 }),
  k(1.2, { shLup: 0, shRup: 0, spRz: 0 }),
] });

defineClip({ name: 'react.whisper', dur: 2.6, mask: 'upper', keys: [
  k(0, { ...RN, spRx: 0.04, spRy: 0, nkRy: 0 }),
  k(0.5, { ...R(0.6, 0.5, 2.3, 0.9, -0.2, 4), spRx: 0.15, spRy: 0.25, nkRy: 0.35, nkRx: 0.1 }, 'out'),
  k(2.0, { ...R(0.6, 0.5, 2.3, 0.9, -0.2, 4), spRy: 0.25, nkRy: 0.4 }),
  k(2.6, { ...RN, spRx: 0.04, spRy: 0, nkRy: 0, nkRx: 0 }),
] });

/* ═══════════════════════════ the rare, wrong ones ═══════════════════════════ */
// Almost ordinary. Played by the unease system, never often.

// a head that keeps turning after the body has stopped
defineClip({ name: 'horror.turn', dur: 5, mask: 'head', keys: [
  k(0, { nkRy: 0, nkRx: 0 }),
  k(2.4, { nkRy: 1.2, nkRx: 0.05 }, 'linear'),
  k(3.8, { nkRy: 1.25, nkRx: 0.08, blink: 0 }, 'linear'),
  k(5, { nkRy: 0, nkRx: 0 }, 'in'),
] });

// a wave that's a beat too slow and doesn't end
defineClip({ name: 'horror.wave', dur: 6, mask: 'armR', keys: [
  k(0, { ...RN }),
  k(1.6, { ...R(1.3, 0.95, 2.4, 0.7, 0.1, 4) }, 'linear'),
  k(2.6, { wrR: 0.3 }, 'linear'), k(3.6, { wrR: -0.1 }, 'linear'), k(4.6, { wrR: 0.3 }, 'linear'),
  k(6, { ...R(1.3, 0.95, 2.4, 0.7, 0.1, 4) }),
] });

// a smile held a second too long
defineClip({ name: 'horror.smile', dur: 5, mask: 'face', keys: [
  k(0, { smile: 0, blink: 0 }),
  k(0.3, { smile: 0.9, squint: 0.1 }, 'out'),
  k(4.4, { smile: 0.95, squint: 0.1, blink: 0 }),
  k(5, { smile: 0, squint: 0 }, 'in'),
] });
