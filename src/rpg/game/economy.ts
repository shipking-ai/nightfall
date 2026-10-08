import { mulberry32 } from '../../world/rng';
import { hash3, hashStr } from '../world/noise';
import type { PoiKind } from '../world/Towns';

/**
 * What each kind of door sells, when it's open, and what it will buy. Stock
 * is made from the shop and the day (so it restocks overnight, and two
 * visits on one day find the same shelves minus what you bought).
 */

const SELLS: Partial<Record<PoiKind, [string, number, number][]>> = {
  // [item, chance it's in stock, how many]
  store: [['sandwich', 1, 6], ['beans', 1, 8], ['jerky', 0.9, 6], ['apple', 0.8, 10], ['water', 1, 10], ['coffee', 0.7, 4], ['bandage', 0.8, 5], ['painkillers', 0.7, 4], ['flashlight', 0.5, 1], ['lighter', 0.8, 3], ['rope', 0.4, 2], ['beanie', 0.4, 2], ['roadmap', 0.5, 1], ['whiskey', 0.5, 2]],
  gas: [['coffee', 1, 8], ['sandwich', 0.8, 4], ['jerky', 1, 6], ['water', 1, 8], ['fuel', 1, 4], ['roadmap', 0.8, 2], ['lighter', 0.8, 3], ['repairkit', 0.4, 1]],
  gunsmith: [['revolver', 0.6, 1], ['pistol', 0.5, 1], ['shotgun', 0.4, 1], ['rifle', 0.5, 1], ['r38', 1, 60], ['r9', 1, 60], ['shells', 1, 30], ['r308', 1, 30], ['knife', 0.8, 2], ['binoculars', 0.5, 1], ['boots', 0.5, 1], ['parka', 0.3, 1]],
  pawn: [['watch', 0.5, 1], ['ring', 0.4, 1], ['records', 0.4, 1], ['camera', 0.5, 1], ['bat', 0.6, 1], ['knuckles', 0.5, 1], ['revolver', 0.3, 1], ['lockpicks', 0.35, 1], ['binoculars', 0.4, 1], ['rod', 0.5, 1]],
  market: [['apple', 1, 20], ['fish', 0.8, 6], ['herbs', 0.8, 8], ['meat', 0.5, 3], ['sandwich', 0.8, 6], ['cloth', 0.7, 6], ['sunhat', 0.4, 2]],
  workshop: [['scrap', 1, 8], ['parts', 0.8, 3], ['repairkit', 0.8, 2], ['crowbar', 0.7, 1], ['rope', 0.8, 3], ['boots', 0.5, 2], ['flashlight', 0.6, 2]],
  garage: [['parts', 1, 4], ['repairkit', 1, 3], ['fuel', 1, 4], ['crowbar', 0.5, 1]],
  clinic: [['bandage', 1, 10], ['medkit', 0.9, 3], ['painkillers', 1, 8]],
  dock: [['rod', 0.9, 2], ['fish', 1, 8], ['rope', 0.9, 4], ['raincoat', 0.6, 2], ['fuel', 0.7, 3]],
};

/** What a shop will buy from you (kinds it deals in); pawn shops take anything that isn't evidence. */
const BUYS: Partial<Record<PoiKind, string[]>> = {
  store: ['food', 'drink', 'medical', 'tool'],
  gas: ['drink', 'food', 'tool'],
  gunsmith: ['weapon', 'ammo', 'material', 'clothing'],
  pawn: ['valuable', 'weapon', 'tool', 'clothing', 'material', 'medical', 'ammo'],
  market: ['food', 'material', 'drink'],
  workshop: ['material', 'tool'],
  garage: ['material', 'tool'],
  clinic: ['medical', 'material'],
  dock: ['food', 'tool', 'material'],
};

export function trades(kind: PoiKind) {
  return !!SELLS[kind];
}

export function buys(kind: PoiKind, itemKind: string) {
  return BUYS[kind]?.includes(itemKind) ?? false;
}

export interface StockLine {
  id: string;
  n: number;
}

/** Today's shelves (minus what you've already bought today, which the caller tracks in memory). */
export function stock(poiId: string, kind: PoiKind, day: number, bought: Record<string, number> = {}): StockLine[] {
  const r = mulberry32(hash3(hashStr(poiId), day, 5));
  const out: StockLine[] = [];
  for (const [id, p, n] of SELLS[kind] ?? []) {
    if (r.next() > p) continue;
    const have = Math.max(1, Math.round(n * r.range(0.5, 1))) - (bought[id] ?? 0);
    if (have > 0) out.push({ id, n: have });
  }
  return out;
}

/** Opening hours [open, close] in hours; close may pass midnight. Null means always. */
const HOURS: Partial<Record<PoiKind, [number, number]>> = {
  store: [7, 22], market: [6, 15], gunsmith: [9, 18], pawn: [10, 19], workshop: [8, 18], garage: [8, 19], diner: [6, 23],
  bar: [16, 3], club: [21, 4], bank: [9, 17], office: [8, 18], arcade: [12, 24], gym: [6, 22], dock: [6, 20], church: [7, 21],
};

export function openNow(kind: PoiKind, hour: number): boolean {
  const h = HOURS[kind];
  if (!h) return true;
  const [a, b] = h;
  return a < b ? hour >= a && hour < b : hour >= a || hour < b;
}

export function hoursLabel(kind: PoiKind): string {
  const h = HOURS[kind];
  if (!h) return 'Open all night';
  const f = (x: number) => `${String(x % 24).padStart(2, '0')}:00`;
  return `${f(h[0])}–${f(h[1])}`;
}
