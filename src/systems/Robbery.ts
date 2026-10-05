import * as THREE from 'three';

/**
 * NIGHTFALL: robbing the bank.
 *
 * Opening the vault is not a button that hands you money. It starts a hold: you
 * are at the wheel, turning it, for as long as it takes — and the whole street
 * hears it. There is a timer, an alarm that goes at a point you cannot take
 * back, and a get-out distance. It is the one thing in District 03 that is
 * genuinely dangerous to attempt, which is what makes it worth doing.
 *
 * Rules, in one place:
 *   - the hold takes a while, and progress survives leaving and coming back,
 *     but only for so long;
 *   - the alarm is a real line in the city: cross it and the response is
 *     immediate and larger than anything else you can attract;
 *   - heat lands the moment you take the money, not when you leave;
 *   - walking out with it is the whole game, and the city keeps escalating
 *     while you do.
 */

export type RobStage = 'idle' | 'turning' | 'taken' | 'escaping';

export interface RobState {
  stage: RobStage;
  /** 0..1 through the wheel */
  progress: number;
  /** seconds the alarm has been going */
  alarmT: number;
  /** how long the hold has been left alone before it slips */
  coldT: number;
  /** metres you have got from the vault */
  distance: number;
  /** how long you have been clear of the bank and out of sight */
  settledT: number;
  /** the take, once taken */
  haul: number;
}

export const VAULT = { x: 31.6, z: -67.4 };
/** how long the wheel takes, in seconds, if you never let go */
const HOLD = 11;
/** letting go for longer than this loses ground */
const SLIP_AFTER = 4;
/** the alarm goes at this point and cannot be un-rung */
const ALARM_AT = 0.55;
/** you have this long after the alarm before the response is unavoidable */
const RESPONSE_DELAY = 6;
/** metres from the vault that count as clear of the scene */
export const ESCAPE_R = 46;

/** what the vault holds, and what it's worth in heat */
export const HAUL = 41800;

export function newRob(): RobState {
  return { stage: 'idle', progress: 0, alarmT: 0, coldT: 0, distance: 0, settledT: 0, haul: 0 };
}

/** The city doesn't use pounds. It uses a number with too many digits. */
export const fmtMoney = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

/**
 * One frame of the robbery. Returns true on the frames something happens, so
 * the caller can fire sound, alarm and HUD once rather than every frame.
 */
export function stepRob(s: RobState, dt: number, atVault: boolean, playerPos: THREE.Vector3): { took: boolean; alarmed: boolean; slipped: boolean } {
  let took = false, alarmed = false, slipped = false;
  s.distance = Math.hypot(playerPos.x - VAULT.x, playerPos.z - VAULT.z);
  // time spent well clear of the bank, which is what finally shakes them off
  s.settledT = s.stage === 'taken' && s.distance > ESCAPE_R * 0.7 ? s.settledT + dt : 0;

  if (s.stage === 'turning') {
    if (atVault) {
      s.coldT = 0;
      s.progress = Math.min(1, s.progress + dt / HOLD);
      if (s.progress >= ALARM_AT && s.alarmT === 0) {
        s.alarmT = 1;
        alarmed = true;
      }
      if (s.progress >= 1) {
        s.stage = 'taken';
        s.haul = HAUL;
        took = true;
      }
    } else {
      // you let go of the wheel
      s.coldT += dt;
      if (s.coldT > SLIP_AFTER) {
        s.progress = Math.max(0, s.progress - dt * 0.06);
        slipped = true;
      }
    }
  }

  // Once the bell has rung it does not stop. Letting go of the wheel used to
  // un-ring it, which meant the alarm was a thing you could talk your way out of
  // by taking your hand off — the opposite of what it is for.
  if (s.alarmT > 0) s.alarmT += dt;
  return { took, alarmed, slipped };
}

/** How hot the city is because of this, in heat points. */
export function robHeat(s: RobState): number {
  if (s.stage === 'taken') return 2.6;
  if (s.alarmT > 0) return 1.9;
  if (s.stage === 'turning') return 1.1;
  return 0;
}

/**
 * What the police should be bringing. It escalates while the robbery is going
 * and while you're carrying it, but it also comes back down if you get away
 * from it — otherwise the response only ever ratchets upward, and 46 m from a
 * bank is an unreachable place to stop being chased.
 */
export function robWanted(s: RobState, distance = 0): number {
  if (s.stage !== 'taken' && s.alarmT === 0) return 0;
  const base = s.stage === 'taken' ? 3 : 2;
  // the ramp saturates: the response escalates to its ceiling and stays there
  // while you're in it, rather than growing forever
  const ramp = Math.min(2, Math.floor(s.alarmT / RESPONSE_DELAY));
  let w = base + ramp;
  // …and sustained time well clear knocks it back down, so escaping is
  // something you can actually do rather than a thing that never ends
  if (s.stage === 'taken' && distance > ESCAPE_R * 0.7) {
    const drop = s.settledT > 10 ? 3 : s.settledT > 5 ? 2 : s.settledT > 0 ? 1 : 0;
    w -= drop;
  }
  return Math.min(5, Math.max(0, w));
}

/** What to say, and how loudly. */
export function robAlarmStage(s: RobState): string | null {
  if (s.alarmT === 0) return null;
  if (s.alarmT < 2.5) return 'The alarm starts.';
  if (s.alarmT < 7) return 'Somewhere in the district, a bell.';
  if (s.alarmT < 15) return 'Sirens. More than one.';
  if (s.alarmT < 26) return 'A helicopter. It has found the street you are on.';
  return 'Everything they have.';
}