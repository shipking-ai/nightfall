/**
 * The ways to play a match in Pier 9 Yard. Every mode is the same yard, the
 * same guns and the same bots; what changes is what scores and how you come
 * back. Names are plain and our own.
 */

export type ModeId = 'dom' | 'tdm' | 'ffa' | 'hotspot' | 'tagged' | 'ctf' | 'ladder' | 'charge' | 'range';

export interface ModeDef {
  id: ModeId;
  name: string;
  line: string;
  /** score to win (points, kills, tags, captures, ladder rungs, rounds) */
  limit: number;
  /** seconds on the clock (a round, for Last Charge) */
  time: number;
  /** seconds before you come back (0: not until the round's over) */
  respawn: number;
  /** everyone for themselves */
  ffa: boolean;
  /** what the score counts, for the HUD */
  unit: string;
}

export const MODES: ModeDef[] = [
  { id: 'dom', name: 'Domination', line: 'Three points. Hold them to score; hold more to score faster.', limit: 150, time: 6 * 60, respawn: 5, ffa: false, unit: 'points' },
  { id: 'tdm', name: 'Team Deathmatch', line: 'Six against six. First side to 60 kills.', limit: 60, time: 8 * 60, respawn: 4, ffa: false, unit: 'kills' },
  { id: 'ffa', name: 'Free-for-all', line: 'Everyone else is the enemy. First to 25.', limit: 25, time: 8 * 60, respawn: 2.5, ffa: true, unit: 'kills' },
  { id: 'hotspot', name: 'Hotspot', line: 'One zone at a time, and it moves every minute. Stand in it alone to score.', limit: 180, time: 8 * 60, respawn: 5, ffa: false, unit: 'seconds held' },
  { id: 'tagged', name: 'Tagged', line: 'A kill only counts when someone picks up the tag it drops. Deny theirs.', limit: 50, time: 8 * 60, respawn: 4, ffa: false, unit: 'tags' },
  { id: 'ctf', name: 'Capture the Flag', line: 'Take theirs home while yours is still there. First to three.', limit: 3, time: 10 * 60, respawn: 6, ffa: false, unit: 'captures' },
  { id: 'ladder', name: 'Gun Ladder', line: 'Every kill hands you the next gun. The last rung is a knife.', limit: 0, time: 10 * 60, respawn: 2, ffa: true, unit: 'rung' },
  { id: 'charge', name: 'Last Charge', line: 'One life a round. Attackers plant the charge at A or C; defenders stop them or defuse it. First to four rounds.', limit: 4, time: 100, respawn: 0, ffa: false, unit: 'rounds' },
  { id: 'range', name: 'Firing range', line: 'Targets at 10, 25, 50 and 80 metres that stand back up. Try a build before you take it in.', limit: 0, time: 0, respawn: 0, ffa: false, unit: '' },
];
export const MODE = Object.fromEntries(MODES.map((m) => [m.id, m])) as Record<ModeId, ModeDef>;

/** Gun Ladder's rungs, in order: every kind of gun, ending on the blade. */
export const LADDER = ['carbine', 'smg', 'shotgun', 'halden', 'keel', 'marksman', 'tern', 'bulwark', 'twinbore', 'longmere', 'magnet', 'brute', 'knife'];

/** Hardline: one more rule set on top of any mode. Less health, no crosshair, no markers, no regeneration. */
export interface Ruleset {
  hardline: boolean;
}
