import type { Body, Garment, HairStyle, Outfit } from './Humanoid';

/**
 * A player's look: what the Wardrobe edits, what's saved (locally and on the
 * account), and what other players receive. Everything that comes from outside
 * goes through `cleanLook` first.
 */
export interface Look {
  garment: Garment;
  top: number;
  legs: number;
  skin: number;
  hair: HairStyle;
  hairColor: number;
  accent: number;
  scarf: boolean;
  bag: boolean;
  height: number;
  build: number;
  shoulders: number;
}

export const GARMENTS: [Garment, string][] = [
  ['coat', 'Long coat'],
  ['raincoat', 'Raincoat'],
  ['hoodie', 'Hoodie'],
  ['jacket', 'Jacket'],
  ['suit', 'Suit'],
  ['skirt', 'Skirt'],
  ['knit', 'Knit'],
  ['workwear', 'Workwear'],
];

export const HAIRS: [HairStyle, string][] = [
  ['short', 'Short'],
  ['swept', 'Swept'],
  ['long', 'Long'],
  ['bun', 'Bun'],
  ['beanie', 'Beanie'],
  ['cap', 'Cap'],
  ['hood', 'Hood'],
  ['none', 'Shaved'],
];

/** night-muted, but with a few colours that let a friend spot you across a street */
export const TOPS = [0x2a2c30, 0x1b1d22, 0x4a4034, 0x6a6258, 0x39302a, 0x2f3a44, 0x3d4a3c, 0x4a2c28, 0x5a4a3a, 0x3c3440, 0x6a6a3a, 0x7a6a50, 0x6b2b25, 0x2d4a6b, 0x8a7440, 0x2a5f63, 0x8c8c86, 0xb8b2a6];
export const LEGS = [0x16171a, 0x1a1b1d, 0x22262b, 0x2b2824, 0x2b3444, 0x3a4658, 0x3a3432, 0x5a5236];
export const SKINS = [0xe0bfa6, 0xd1ae94, 0xc99a7c, 0xb8876a, 0xa8765a, 0x8a5c43, 0x6a4331, 0x4a2e22];
export const HAIR_COLORS = [0x0f0c0a, 0x1d1511, 0x2e2118, 0x4a3522, 0x6b5a48, 0x8f8a82, 0x5a3a24, 0xb8a37a];
export const ACCENTS = [0x6a5a48, 0x7a3a30, 0x3a5060, 0x8a7a5a, 0x5a5a60, 0x2e4a3e, 0x9a8a70, 0x8a2e2e];

/** The long charcoal coat and scarf: the silhouette the game started with. */
export function defaultLook(): Look {
  return { garment: 'coat', top: 0x2a2c30, legs: 0x16171a, skin: 0xb8876a, hair: 'swept', hairColor: 0x1a1512, accent: 0x6a5a48, scarf: true, bag: false, height: 1, build: 1.02, shoulders: 1.04 };
}

export function randomLook(): Look {
  const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  return {
    garment: pick(GARMENTS)[0],
    top: pick(TOPS),
    legs: pick(LEGS),
    skin: pick(SKINS),
    hair: pick(HAIRS)[0],
    hairColor: pick(HAIR_COLORS),
    accent: pick(ACCENTS),
    scarf: Math.random() < 0.4,
    bag: Math.random() < 0.3,
    height: 0.94 + Math.random() * 0.12,
    build: 0.92 + Math.random() * 0.18,
    shoulders: 0.96 + Math.random() * 0.12,
  };
}

/** Anything from storage or the network → a valid Look (unknown bits fall back to the default). */
export function cleanLook(raw: unknown): Look {
  const d = defaultLook();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const color = (v: unknown, fb: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffff ? (v as number) : fb);
  const range = (v: unknown, lo: number, hi: number, fb: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v as number)) : fb);
  return {
    garment: GARMENTS.some(([g]) => g === r.garment) ? (r.garment as Garment) : d.garment,
    top: color(r.top, d.top),
    legs: color(r.legs, d.legs),
    skin: color(r.skin, d.skin),
    hair: HAIRS.some(([h]) => h === r.hair) ? (r.hair as HairStyle) : d.hair,
    hairColor: color(r.hairColor, d.hairColor),
    accent: color(r.accent, d.accent),
    scarf: typeof r.scarf === 'boolean' ? r.scarf : d.scarf,
    bag: typeof r.bag === 'boolean' ? r.bag : d.bag,
    height: range(r.height, 0.9, 1.1, d.height),
    build: range(r.build, 0.88, 1.14, d.build),
    shoulders: range(r.shoulders, 0.94, 1.12, d.shoulders),
  };
}

/** Look → the Humanoid outfit (garment details follow the garment, as in the crowd). */
export function outfitFromLook(l: Look): Outfit {
  const o: Outfit = {
    garment: l.garment, top: l.top, legs: l.legs, shoes: 0x0e0e0f, skin: l.skin, hair: l.hair, hairColor: l.hairColor,
    accent: l.accent, hem: false, skirt: false, hoodDown: false, scarf: l.scarf, bag: l.bag, umbrella: false, bulk: 1,
  };
  switch (l.garment) {
    case 'coat':
      o.hem = true;
      o.bulk = 1.12;
      break;
    case 'raincoat':
      o.hem = true;
      o.bulk = 1.1;
      break;
    case 'hoodie':
      o.bulk = 1.06;
      o.hoodDown = l.hair !== 'hood';
      break;
    case 'suit':
      o.legs = l.top;
      break;
    case 'skirt':
      o.skirt = true;
      break;
    case 'knit':
      o.bulk = 1.05;
      break;
    case 'workwear':
      o.bulk = 1.1;
      break;
  }
  if (l.hair === 'hood') o.hairColor = l.garment === 'hoodie' || l.garment === 'raincoat' ? l.top : l.accent;
  if (l.hair === 'beanie' || l.hair === 'cap') o.hairColor = l.accent;
  return o;
}

export function bodyFromLook(l: Look): Body {
  return { height: l.height, girth: l.build, shoulders: l.shoulders, hips: 1 + (l.build - 1) * 0.6, head: 1 };
}
