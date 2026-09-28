/**
 * FIGHT frame data, at 60 frames a second. Every number here is matched by
 * its animation in anim/fightClips.ts: the clip's `hit` key sits on the first
 * active frame, and startup + active + recovery is the clip's length. Change
 * one, change the other.
 *
 * Reading the table: a jab is 5 frames to come out, live for 3, 9 to recover.
 * On block it leaves the attacker 2 frames short (−2): safe. A heavy is −6 on
 * block, so a blocked heavy can be punished by a jab (5 frames). That's the
 * whole game in two lines: pressure with lights, punish the big swings.
 */
export type MoveId = 'jab' | 'cross' | 'hook' | 'heavy' | 'roundhouse' | 'launcher' | 'sweep' | 'airPunch' | 'airKick' | 'special' | 'grab';

/** what a clean hit does to the one it lands on */
export type Effect = 'stun' | 'launch' | 'knockdown';

export interface Move {
  id: MoveId;
  name: string;
  clip: string;
  startup: number;
  active: number;
  recovery: number;
  dmg: number;
  /** damage through a block */
  chip: number;
  /** guard it takes through a block (a guard at 0 breaks) */
  guard: number;
  hitstun: number;
  blockstun: number;
  /** the reaction clip on a hit */
  react: string;
  effect: Effect;
  /** pushback on hit (m/s, decays) */
  push: number;
  /** centre-to-centre distance it connects at */
  reach: number;
  /** half-angle it covers (radians): a sidestep gets out of the narrow ones */
  arc: number;
  /** frames the world stops for on contact */
  hitstop: number;
  /** metres the attacker steps in over startup */
  lunge: number;
  /** what it can be cancelled into once it has made contact */
  cancel: MoveId[];
  air?: boolean;
  /** meter it costs (a full bar is 100; the meter holds three) */
  cost?: number;
  /** vertical speed a launch gives */
  launch?: number;
}

const m = (d: Omit<Move, 'cancel'> & { cancel?: MoveId[] }): Move => ({ cancel: [], ...d });

export const MOVES: Record<MoveId, Move> = {
  // the light string: jab, cross, hook
  jab: m({ id: 'jab', name: 'Jab', clip: 'f.jab', startup: 5, active: 3, recovery: 9, dmg: 40, chip: 3, guard: 6, hitstun: 13, blockstun: 9, react: 'f.hitLight', effect: 'stun', push: 1.6, reach: 1.3, arc: 0.55, hitstop: 5, lunge: 0.05, cancel: ['cross', 'heavy', 'roundhouse', 'launcher', 'sweep', 'special'] }),
  cross: m({ id: 'cross', name: 'Cross', clip: 'f.cross', startup: 6, active: 3, recovery: 11, dmg: 55, chip: 4, guard: 8, hitstun: 15, blockstun: 11, react: 'f.hitBody', effect: 'stun', push: 1.9, reach: 1.4, arc: 0.55, hitstop: 6, lunge: 0.08, cancel: ['hook', 'heavy', 'roundhouse', 'launcher', 'sweep', 'special'] }),
  hook: m({ id: 'hook', name: 'Hook', clip: 'f.hook', startup: 8, active: 3, recovery: 17, dmg: 70, chip: 6, guard: 12, hitstun: 19, blockstun: 13, react: 'f.hitHeavy', effect: 'stun', push: 2.2, reach: 1.25, arc: 1.1, hitstop: 8, lunge: 0.05, cancel: ['launcher', 'heavy', 'roundhouse', 'special'] }),
  // heavies: an overhand, a roundhouse, a launcher, a sweep
  heavy: m({ id: 'heavy', name: 'Overhand', clip: 'f.heavy', startup: 13, active: 4, recovery: 19, dmg: 105, chip: 10, guard: 26, hitstun: 22, blockstun: 16, react: 'f.hitHeavy', effect: 'stun', push: 3.2, reach: 1.5, arc: 0.6, hitstop: 11, lunge: 0.15, cancel: ['special'] }),
  roundhouse: m({ id: 'roundhouse', name: 'Roundhouse', clip: 'f.roundhouse', startup: 15, active: 4, recovery: 21, dmg: 95, chip: 9, guard: 22, hitstun: 22, blockstun: 15, react: 'f.hitHeavy', effect: 'stun', push: 4.2, reach: 1.65, arc: 1.3, hitstop: 11, lunge: 0, cancel: ['special'] }),
  launcher: m({ id: 'launcher', name: 'Launcher', clip: 'f.launcher', startup: 10, active: 3, recovery: 21, dmg: 70, chip: 6, guard: 14, hitstun: 0, blockstun: 12, react: 'f.launched', effect: 'launch', push: 0.8, reach: 1.25, arc: 0.6, hitstop: 10, lunge: 0.06, launch: 8.2, cancel: ['special'] }),
  sweep: m({ id: 'sweep', name: 'Sweep', clip: 'f.sweep', startup: 12, active: 4, recovery: 22, dmg: 65, chip: 6, guard: 18, hitstun: 0, blockstun: 14, react: 'f.knockdown', effect: 'knockdown', push: 1.2, reach: 1.6, arc: 1.4, hitstop: 9, lunge: 0, cancel: ['special'] }),
  // in the air
  airPunch: m({ id: 'airPunch', name: 'Air punch', clip: 'f.airPunch', startup: 6, active: 4, recovery: 12, dmg: 50, chip: 4, guard: 10, hitstun: 15, blockstun: 10, react: 'f.hitLight', effect: 'stun', push: 1.4, reach: 1.35, arc: 0.7, hitstop: 6, lunge: 0, air: true, cancel: ['airKick'] }),
  airKick: m({ id: 'airKick', name: 'Air kick', clip: 'f.airKick', startup: 9, active: 5, recovery: 16, dmg: 65, chip: 6, guard: 12, hitstun: 18, blockstun: 11, react: 'f.hitHeavy', effect: 'stun', push: 2.4, reach: 1.55, arc: 0.8, hitstop: 8, lunge: 0, air: true }),
  // the special: a spinning backfist that steps in and knocks down; a bar of meter
  special: m({ id: 'special', name: 'Spinning backfist', clip: 'f.special', startup: 20, active: 4, recovery: 22, dmg: 130, chip: 14, guard: 30, hitstun: 0, blockstun: 18, react: 'f.knockdown', effect: 'knockdown', push: 5, reach: 1.7, arc: 1.6, hitstop: 14, lunge: 0.3, cost: 100 }),
  // a grab beats a block; any strike beats a grab
  grab: m({ id: 'grab', name: 'Throw', clip: 'f.grab', startup: 7, active: 2, recovery: 21, dmg: 110, chip: 0, guard: 0, hitstun: 0, blockstun: 0, react: 'f.thrown', effect: 'knockdown', push: 0, reach: 1.05, arc: 0.7, hitstop: 12, lunge: 0.1 }),
};

export const THROW_FRAMES = 48;
/** the throw's slam lands on this frame of the throw */
export const THROW_SLAM = 26;
/** a block pressed this recently before a hit arrives is a parry */
export const PARRY_WINDOW = 6;
/** the most hits a juggle can take before they fall out of it */
export const MAX_JUGGLE = 5;
/** the finisher's hits, in seconds into its animation */
export const FINISHER_HITS = [0.45, 0.95, 1.55];

/** Frame advantage on block (for the move list): positive is safe to keep pressing. */
export function onBlock(mv: Move) {
  return mv.blockstun - (mv.active - 1 + mv.recovery);
}
