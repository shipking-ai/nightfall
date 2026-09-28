import type { Body, Garment, HairStyle, Outfit } from './Humanoid';
import { FACE_SHAPES, type FacialHair, type HatStyle } from './anatomy';
import { dressGarment } from '../data/people';
import { mulberry32 } from '../world/rng';

/**
 * A player's look: what the Wardrobe edits, what's saved (locally and on the
 * account), and what other players receive. Everything that comes from outside
 * goes through `cleanLook` first. Keys stay short and flat (the room server and
 * Firebase accept only that).
 */
export interface Look {
  garment: Garment;
  top: number;
  legs: number;
  skin: number;
  /** the haircut (older saves may hold a hat here too; `hairParts` sorts it out) */
  hair: HairStyle;
  hairColor: number;
  accent: number;
  scarf: boolean;
  bag: boolean;
  height: number;
  build: number;
  shoulders: number;
  /** headwear, or 'none' */
  hat: HatStyle | 'none';
  beard: FacialHair;
  glasses: boolean;
  /** a face: a seed for the face shapes (0 is the original face) */
  face: number;
  shoes: 'shoe' | 'sneaker' | 'boot';
}

export const GARMENTS: [Garment, string][] = [
  ['coat', 'Long coat'],
  ['raincoat', 'Raincoat'],
  ['jacket', 'Jacket'],
  ['puffer', 'Puffer'],
  ['hoodie', 'Hoodie'],
  ['suit', 'Suit'],
  ['knit', 'Knit'],
  ['shirt', 'Shirt'],
  ['tee', 'T-shirt'],
  ['skirt', 'Skirt'],
  ['workwear', 'Workwear'],
];

export const HAIRS: [HairStyle, string][] = [
  ['short', 'Short'],
  ['swept', 'Side part'],
  ['messy', 'Messy'],
  ['curly', 'Curls'],
  ['buzz', 'Buzz'],
  ['long', 'Long'],
  ['bob', 'Bob'],
  ['ponytail', 'Ponytail'],
  ['bun', 'Bun'],
  ['none', 'Shaved'],
];

export const HATS: [HatStyle | 'none', string][] = [
  ['none', 'None'],
  ['hood', 'Hood up'],
  ['beanie', 'Beanie'],
  ['cap', 'Cap'],
  ['flatcap', 'Flat cap'],
  ['trilby', 'Trilby'],
];

export const BEARDS: [FacialHair, string][] = [
  ['none', 'Clean'],
  ['stubble', 'Stubble'],
  ['moustache', 'Moustache'],
  ['goatee', 'Goatee'],
  ['beard', 'Beard'],
];

export const SHOES: [Look['shoes'], string][] = [
  ['shoe', 'Shoes'],
  ['sneaker', 'Trainers'],
  ['boot', 'Boots'],
];

/** night-muted, but with a few colours that let a friend spot you across a street */
export const TOPS = [0x2a2c30, 0x1b1d22, 0x4a4034, 0x6a6258, 0x39302a, 0x2f3a44, 0x3d4a3c, 0x4a2c28, 0x5a4a3a, 0x3c3440, 0x6a6a3a, 0x7a6a50, 0x6b2b25, 0x2d4a6b, 0x8a7440, 0x2a5f63, 0x8c8c86, 0xb8b2a6];
export const LEGS = [0x16171a, 0x1a1b1d, 0x22262b, 0x2b2824, 0x2b3444, 0x3a4658, 0x3a3432, 0x5a5236];
export const SKINS = [0xe6c4ab, 0xd6b095, 0xc99a7c, 0xb8876a, 0xa8765a, 0x8a5c43, 0x6e4633, 0x533526, 0x3e281e];
export const HAIR_COLORS = [0x0f0c0a, 0x1d1511, 0x2e2118, 0x4a3522, 0x6b5a48, 0x8f8a82, 0x5a3a24, 0xb8a37a];
export const ACCENTS = [0x6a5a48, 0x7a3a30, 0x3a5060, 0x8a7a5a, 0x5a5a60, 0x2e4a3e, 0x9a8a70, 0x8a2e2e];

/** The long charcoal coat and scarf: the silhouette the game started with. */
export function defaultLook(): Look {
  return {
    garment: 'coat', top: 0x2a2c30, legs: 0x16171a, skin: 0xb8876a, hair: 'swept', hairColor: 0x1a1512, accent: 0x6a5a48, scarf: true, bag: false,
    height: 1, build: 1.02, shoulders: 1.04, hat: 'none', beard: 'stubble', glasses: false, face: 0, shoes: 'shoe',
  };
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
    hat: Math.random() < 0.3 ? pick(HATS)[0] : 'none',
    beard: pick(BEARDS)[0],
    glasses: Math.random() < 0.2,
    face: 1 + Math.floor(Math.random() * 9999),
    shoes: pick(SHOES)[0],
  };
}

/** Anything from storage or the network → a valid Look (unknown bits fall back to the default). */
export function cleanLook(raw: unknown): Look {
  const d = defaultLook();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const color = (v: unknown, fb: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffff ? (v as number) : fb);
  const range = (v: unknown, lo: number, hi: number, fb: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v as number)) : fb);
  const one = <T>(v: unknown, list: [T, string][], fb: T) => (list.some(([x]) => x === v) ? (v as T) : fb);
  // older saves kept hats in `hair`
  let hair = r.hair as string;
  let hat = one(r.hat, HATS, 'none' as HatStyle | 'none');
  if (hair === 'beanie' || hair === 'cap' || hair === 'hood') {
    if (hat === 'none') hat = hair as HatStyle;
    hair = 'short';
  }
  return {
    garment: one(r.garment, GARMENTS, d.garment),
    top: color(r.top, d.top),
    legs: color(r.legs, d.legs),
    skin: color(r.skin, d.skin),
    hair: one(hair, HAIRS, d.hair),
    hairColor: color(r.hairColor, d.hairColor),
    accent: color(r.accent, d.accent),
    scarf: typeof r.scarf === 'boolean' ? r.scarf : d.scarf,
    bag: typeof r.bag === 'boolean' ? r.bag : d.bag,
    height: range(r.height, 0.9, 1.1, d.height),
    build: range(r.build, 0.88, 1.14, d.build),
    shoulders: range(r.shoulders, 0.94, 1.12, d.shoulders),
    hat,
    beard: one(r.beard, BEARDS, d.beard),
    glasses: typeof r.glasses === 'boolean' ? r.glasses : d.glasses,
    face: Number.isInteger(r.face) && (r.face as number) >= 0 && (r.face as number) < 1e6 ? (r.face as number) : d.face,
    shoes: one(r.shoes, SHOES, d.shoes),
  };
}

/** Look → the Humanoid outfit (garment details follow the garment, as in the crowd). */
export function outfitFromLook(l: Look): Outfit {
  const o: Outfit = {
    garment: l.garment, top: l.top, legs: l.legs, shoes: l.shoes === 'sneaker' ? 0x1a1a1c : 0x0e0e0f, skin: l.skin, hair: l.hair, hairColor: l.hairColor,
    accent: l.accent, hem: false, skirt: false, hoodDown: false, scarf: l.scarf, bag: l.bag, umbrella: false, bulk: 1,
    hat: l.hat, hatColor: l.hat === 'hood' ? (l.garment === 'hoodie' || l.garment === 'raincoat' ? l.top : l.accent) : l.accent,
    facialHair: l.beard, glasses: l.glasses, shoeKind: l.shoes, soleColor: 0xd8d4cc, eyeColor: 0x3a2616, brows: 1.1,
  };
  dressGarment(o, null);
  if (l.garment === 'suit') o.legs = l.top;
  o.hoodDown = l.garment === 'hoodie' && l.hat !== 'hood';
  return o;
}

/** The player's face: 0 is the original; any other number is a face of its own. */
export function faceOf(seed: number): number[] {
  if (!seed) return FACE_SHAPES.map((k) => (k === 'browHeavy' ? 0.35 : k === 'jawWide' ? 0.4 : k === 'noseLong' ? 0.3 : k === 'gaunt' ? 0.25 : 0.05));
  const r = mulberry32(seed);
  const w = FACE_SHAPES.map(() => r.range(0, 0.25));
  for (let i = 0; i < 3; i++) w[Math.floor(r.next() * (w.length - 1))] = r.range(0.5, 1);
  w[FACE_SHAPES.indexOf('aged')] = r.range(0, 0.3);
  return w;
}

export function bodyFromLook(l: Look): Body {
  return {
    height: l.height, girth: l.build, shoulders: l.shoulders, hips: 1 + (l.build - 1) * 0.6, head: 1,
    broad: Math.max(0, (l.shoulders - 1) * 6), belly: Math.max(0, (l.build - 1.04) * 4), face: faceOf(l.face), shDrop: 0.04, toeOut: 0.1,
  };
}
