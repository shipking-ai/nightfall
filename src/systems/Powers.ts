import * as THREE from 'three';

/**
 * NIGHTFALL: powers.
 *
 * You do not choose these and you do not buy them. The city has been doing
 * something to District 03 all night — the wrong watchers, the figures that move
 * wrong, the archive entries that are about you specifically — and if you are
 * standing in the wrong place at 03:17 when it happens, you come out of it
 * changed. That is the only way in.
 *
 * Each power has a discovery (an encounter that grants it), a charge cost, and a
 * consequence. The consequence is the point: a power used on a wall is a tool,
 * a power used on a person is a crime, and the city counts it as one. Enough of
 * that and the military come, which is a different order of problem entirely.
 */

export type PowerId = 'lift' | 'still' | 'burn' | 'pale' | 'hook';

export interface PowerDef {
  id: PowerId;
  name: string;
  /** what the archive calls it */
  epithet: string;
  /** what it does, in one line */
  line: string;
  /** what you have to see happen to get it */
  discovery: string;
  /** charges, and how long each takes to come back */
  max: number;
  recharge: number;
  /** key hint */
  keys: string;
  /** the activation clip */
  clip: string;
  /** the clip while it does its work */
  useClip: string;
  /** heat it costs you if you use it on a person; 0 if it can't be misused */
  crime: number;
}

export const POWERS: Record<PowerId, PowerDef> = {
  lift: {
    id: 'lift',
    name: 'Lift',
    epithet: 'Not weight, exactly',
    line: 'Everything loose rises. Including you.',
    discovery: 'You have to be standing under something that is already falling.',
    max: 3,
    recharge: 14,
    keys: 'V',
    clip: 'power.lift',
    useClip: 'power.liftUse',
    crime: 0,
  },
  still: {
    id: 'still',
    name: 'Still',
    epithet: 'The pause between two heartbeats',
    line: 'A moment where the district holds its breath. So do you.',
    discovery: 'You have to be somewhere at the moment the wrongness happens.',
    max: 2,
    recharge: 30,
    keys: 'V',
    clip: 'power.still',
    useClip: 'power.stillUse',
    crime: 0,
  },
  burn: {
    id: 'burn',
    name: 'Burn',
    epithet: 'The lamp that was never decommissioned',
    line: 'Light that answers. It does not ask who you are.',
    discovery: 'You have to be looking at one of the lamps that should be off.',
    max: 4,
    recharge: 10,
    keys: 'V',
    clip: 'power.burn',
    useClip: 'power.burnUse',
    crime: 1.4,
  },
  pale: {
    id: 'pale',
    name: 'Pale',
    epithet: 'You were already on the list',
    line: 'The district forgets to look at you, for a while.',
    discovery: 'You have to be on your own, and far enough out.',
    max: 1,
    recharge: 45,
    keys: 'V',
    clip: 'power.pale',
    useClip: 'power.paleUse',
    crime: 0,
  },
  hook: {
    id: 'hook',
    name: 'Hook',
    epithet: 'Something took an interest',
    line: 'It reaches for one thing, wherever it is, and brings it.',
    discovery: 'You have to be the one it reached for.',
    max: 3,
    recharge: 12,
    keys: 'V',
    clip: 'power.hook',
    useClip: 'power.hookUse',
    crime: 0.8,
  },
};

export const POWER_ORDER: PowerId[] = ['lift', 'still', 'burn', 'pale', 'hook'];

export interface PowerState {
  /** how many charges of each you have left */
  left: Record<PowerId, number>;
  /** seconds until each comes back */
  cool: Record<PowerId, number>;
  /** powers you have found, in the order you found them */
  found: PowerId[];
  /** which one is selected */
  sel: PowerId;
  /** seconds of effect remaining on the ones that persist */
  paleT: number;
  stillT: number;
  /** true once the district has noticed what you are doing with these */
  marked: boolean;
}

export function newPowers(): PowerState {
  const left = {} as Record<PowerId, number>;
  const cool = {} as Record<PowerId, number>;
  for (const id of POWER_ORDER) {
    left[id] = 0;
    cool[id] = 0;
  }
  return { left, cool, found: [], sel: 'lift', paleT: 0, stillT: 0, marked: false };
}

/** You found it. */
export function grant(s: PowerState, id: PowerId): boolean {
  if (s.found.includes(id)) return false;
  const d = POWERS[id];
  s.found.push(id);
  s.left[id] = d.max;
  s.cool[id] = 0;
  s.sel = id;
  return true;
}

export function has(s: PowerState, id: PowerId) {
  return s.found.includes(id);
}

/** Can it go off right now? */
export function ready(s: PowerState, id: PowerId): boolean {
  return has(s, id) && s.left[id] > 0 && s.cool[id] <= 0;
}

/** Spend a charge. Returns false if it couldn't. */
export function spend(s: PowerState, id: PowerId): boolean {
  if (!ready(s, id)) return false;
  s.left[id]--;
  s.cool[id] = POWERS[id].recharge;
  return true;
}

/** Cycle the selected power, only ever through the ones you have. */
export function cycle(s: PowerState, dir: number): PowerId {
  if (!s.found.length) return s.sel;
  const i = s.found.indexOf(s.sel);
  const n = s.found.length;
  s.sel = s.found[(i + dir + n * 2) % n];
  return s.sel;
}

export function tickPowers(s: PowerState, dt: number) {
  for (const id of s.found) {
    if (s.cool[id] > 0) {
      s.cool[id] -= dt;
      // charges come back one at a time, not all at once
      if (s.cool[id] <= 0 && s.left[id] < POWERS[id].max) {
        s.left[id]++;
        if (s.left[id] < POWERS[id].max) s.cool[id] = POWERS[id].recharge;
      }
    }
  }
  if (s.paleT > 0) s.paleT -= dt;
  if (s.stillT > 0) s.stillT -= dt;
}

/**
 * How far into the wrong end of this you are, 0..1. This is what eventually
 * brings the military: not one bad act, but a habit.
 */
export function corruption(s: PowerState, heat: number): number {
  const misuse = heat / 8;
  const carried = s.found.length / POWER_ORDER.length;
  return Math.max(0, Math.min(1, misuse * 0.7 + (s.marked ? 0.2 : 0) + carried * 0.1));
}

/** What the military tier wants called. */
export function militaryGrade(s: PowerState, heat: number): string | null {
  if (heat < 6) return null;
  if (heat < 7) return 'Military is on the street.';
  if (heat < 8) return 'Something with a rotor is coming.';
  return 'They have stopped sending police.';
}