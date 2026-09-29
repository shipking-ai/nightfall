/**
 * The powers in the county, and what they think of you. Standing runs from
 * −100 to 100; helping one can cost you with its rivals. Towns keep their own
 * opinion as well (in world memory), which is what shopkeepers and neighbours
 * go by.
 */

export type FactionId = 'watch' | 'syndicate' | 'union' | 'families' | 'chapel' | 'drifters' | 'garrison';

export interface Faction {
  id: FactionId;
  name: string;
  short: string;
  desc: string;
  /** who they can't stand: what pleases them displeases these (by this fraction) */
  rivals: Partial<Record<FactionId, number>>;
}

export const FACTIONS: Faction[] = [
  { id: 'watch', name: 'The County Watch', short: 'Watch', desc: 'Police and sheriffs from Merrow to the coast. Underpaid, overstretched, and not all of them honest.', rivals: { syndicate: 0.6, drifters: 0.2 } },
  { id: 'syndicate', name: 'The Tidewater Syndicate', short: 'Syndicate', desc: 'What comes in on the boats, and who gets paid for it. Polite, until they aren’t.', rivals: { watch: 0.5, union: 0.3 } },
  { id: 'union', name: 'The Roadmen’s Union', short: 'Union', desc: 'Drivers, dockers, mechanics and the yards. They keep the county moving and want it known.', rivals: { families: 0.4, syndicate: 0.2 } },
  { id: 'families', name: 'The Old Families', short: 'Families', desc: 'Four surnames on every bank, bridge and board in the county. Old money, older secrets.', rivals: { union: 0.4, chapel: 0.3 } },
  { id: 'chapel', name: 'The Quiet Chapel', short: 'Chapel', desc: 'A congregation that meets after dark and doesn’t sing. They say they’re keeping something out.', rivals: { families: 0.3, watch: 0.1 } },
  { id: 'drifters', name: 'The Long Road', short: 'Drifters', desc: 'People who don’t stay. They see everything on the roads between towns, and trade in it.', rivals: { watch: 0.2 } },
  { id: 'garrison', name: 'The Frontier Garrison', short: 'Garrison', desc: 'The bases up north. Fences, floodlights, and questions nobody answers.', rivals: { drifters: 0.2 } },
];

export const FACTION: Record<FactionId, Faction> = Object.fromEntries(FACTIONS.map((f) => [f.id, f])) as Record<FactionId, Faction>;

export function standing(v: number): string {
  return v <= -60 ? 'Hated' : v <= -25 ? 'Hostile' : v < -5 ? 'Wary' : v < 20 ? 'Neutral' : v < 50 ? 'Liked' : v < 80 ? 'Trusted' : 'Revered';
}

/** Which faction a resident's job ties them to, if any. */
export function factionOfJob(job: string): FactionId | null {
  return job === 'police' ? 'watch' : job === 'rich' ? 'families' : job === 'driver' || job === 'mechanic' || job === 'worker' ? 'union' : job === 'drifter' ? 'drifters' : job === 'soldier' ? 'garrison' : null;
}
