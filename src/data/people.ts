import type { Body, Garment, Outfit } from '../entities/Humanoid';
import { FACE_SHAPES, type FacialHair, type HairCut, type HatStyle } from '../entities/anatomy';

/**
 * Who lives here. Every person in the street is built from an archetype —
 * a recognisable kind of night-time inhabitant — and then varied: build,
 * face, hair, what they're wearing and how they carry themselves. The aim
 * is recognition, not detail: a courier reads as a courier from twenty
 * metres, and up close she's her own person.
 */

export type Rnd = { next(): number; range(a: number, b: number): number; pick<T>(a: readonly T[]): T; chance(p: number): boolean };

/** How someone moves and what they do when they're waiting. */
export interface Persona {
  /** 0 slow … 1 brisk */
  energy: number;
  /** upright and deliberate */
  confidence: number;
  /** looks around, fidgets */
  nervous: number;
  /** slumps, yawns */
  tired: number;
  /** 0 young … 1 old */
  age: number;
  /** some people wave with their left hand */
  leftHanded: boolean;
  /** idle behaviours they lean towards (clip name → weight) */
  idles: Record<string, number>;
}

export type ArchetypeId =
  | 'commuter' | 'office' | 'student' | 'courier' | 'market' | 'nurse' | 'elder' | 'worker'
  | 'drifter' | 'taxi' | 'police' | 'watcher' | 'clerk' | 'crook' | 'soldier' | 'fighter';

export interface Person {
  arche: ArchetypeId;
  body: Body;
  outfit: Outfit;
  persona: Persona;
}

export const SKIN = [0xe6c4ab, 0xd6b095, 0xc99a7c, 0xb8876a, 0xa8765a, 0x8a5c43, 0x6e4633, 0x533526, 0x3e281e];
const HAIRC = [0x0f0c0a, 0x1d1511, 0x2e2118, 0x4a3522, 0x6b5a48, 0x5a3a24, 0x7a4a2a, 0x2a2624, 0xb8a37a];
const GREY = [0x8f8a82, 0xa8a49c, 0xc4c0b8, 0x6a6660];
const EYES = [0x2a1c12, 0x3a2616, 0x4a3420, 0x1e1510, 0x3a4a5a, 0x4a5a42, 0x5a4a30];
const DARK = [0x1a1b1d, 0x22262b, 0x2b2824, 0x1d2228, 0x2e2e2c];
const WOOL = [0x4a4034, 0x5c5446, 0x3b3226, 0x6a6258, 0x39302a, 0x4b4f52, 0x6e5a44];
const MUTED = [0x2f3a44, 0x3d4a3c, 0x4a2c28, 0x55504a, 0x3a3f4a, 0x5a4a3a, 0x3c3440];
const RAIN = [0x6a6a3a, 0x2e3e4c, 0x3e4a3a, 0x7a6a50, 0x2a2e32, 0x5a2e2a, 0x8a6a2a];
const DENIM = [0x2b3444, 0x3a4658, 0x232a36, 0x4a5262, 0x1e2530];
const ACCENT = [0x7a3a30, 0x3a5060, 0x8a7a5a, 0x5a5a60, 0x6a5040, 0x2e4a3e, 0x9a8a70, 0x8a2e2e];
/** a few colours that carry at night: someone you can pick out across a street */
const BRIGHT = [0x8a2a24, 0x2a5a8a, 0xa0762a, 0x2a6a5a, 0x6a2a5a, 0xb0a890];

/* ─────────────────────────── bodies and faces ─────────────────────────── */

/** A face: two or three features that stand out, the rest faint. */
function face(r: Rnd, femme: number, age: number): number[] {
  const w = FACE_SHAPES.map(() => r.range(0, 0.22));
  const idx = (k: (typeof FACE_SHAPES)[number]) => FACE_SHAPES.indexOf(k);
  const strong = 2 + (r.chance(0.5) ? 1 : 0);
  for (let i = 0; i < strong; i++) w[r.next() * (w.length - 1) | 0] = r.range(0.55, 1);
  // presentation shifts the odds, never decides
  w[idx('jawWide')] *= 1.3 - femme * 0.8;
  w[idx('lipsFull')] = Math.min(1, w[idx('lipsFull')] + femme * r.range(0, 0.5));
  w[idx('browHeavy')] *= 1.2 - femme * 0.7;
  w[idx('aged')] = Math.min(1, age * r.range(0.6, 1.1));
  if (age > 0.6) w[idx('gaunt')] = Math.max(w[idx('gaunt')], r.range(0, 0.6));
  // opposites don't both win
  if (w[idx('gaunt')] > 0.5) w[idx('cheeksFull')] *= 0.2;
  if (w[idx('chinNarrow')] > 0.5) w[idx('jawWide')] *= 0.3;
  return w.map((v) => Math.max(0, Math.min(1, v)));
}

function body(r: Rnd, femme: number, age: number, o: { heavy?: number; athletic?: number; tall?: number } = {}): Body {
  const heavy = o.heavy ?? r.range(0, 1) * r.range(0, 1);
  const athletic = o.athletic ?? r.range(0, 0.6);
  const broad = Math.max(0, (1 - femme) * r.range(0.2, 0.9) + athletic * 0.4 - heavy * 0.1);
  return {
    height: (o.tall ?? r.range(0.93, 1.06)) - femme * 0.04 - age * 0.02,
    girth: 0.92 + heavy * 0.24 + athletic * 0.04 + r.range(-0.03, 0.03),
    shoulders: 1 + (1 - femme) * 0.07 - femme * 0.04 + athletic * 0.05 + r.range(-0.03, 0.03),
    hips: 1 + femme * 0.08 + heavy * 0.05 + r.range(-0.03, 0.03),
    head: r.range(0.96, 1.04),
    headW: r.range(0.94, 1.07),
    headD: r.range(0.95, 1.05),
    bust: femme * r.range(0.3, 0.9),
    belly: heavy * r.range(0.4, 1) + age * 0.25 * r.next(),
    broad,
    slim: Math.max(0, femme * 0.5 + athletic * 0.4 - heavy * 0.8) * r.range(0.4, 1),
    legLen: r.range(0.96, 1.05),
    armLen: r.range(0.97, 1.04),
    torsoLen: r.range(0.96, 1.04),
    neckLen: r.range(0.85, 1.15),
    shDrop: r.range(-0.12, 0.12),
    tilt: r.range(-0.05, 0.05),
    toeOut: r.range(0.02, 0.2),
    age,
    face: face(r, femme, age),
  };
}

function hairColor(r: Rnd, age: number) {
  return age > 0.62 || (age > 0.4 && r.chance(0.4)) ? r.pick(GREY) : r.pick(HAIRC);
}

function cut(r: Rnd, femme: number, age: number): HairCut | 'none' {
  if (age > 0.55 && femme < 0.5 && r.chance(0.3)) return 'none';
  const opts: [HairCut | 'none', number][] = [
    ['buzz', 1.2 - femme],
    ['short', 2],
    ['swept', 1.3],
    ['messy', 1 - age],
    ['curly', 0.9],
    ['long', femme * 2.2 + 0.3],
    ['bob', femme * 1.4],
    ['ponytail', femme * 1.4 + 0.1],
    ['bun', femme * 1.2 + 0.2 * age],
  ];
  return weighted(r, opts);
}

function facial(r: Rnd, femme: number): FacialHair {
  if (femme > 0.5) return 'none';
  return weighted<FacialHair>(r, [['none', 3], ['stubble', 2], ['moustache', 0.5], ['goatee', 0.6], ['beard', 1.2]]);
}

export function weighted<T>(r: Rnd, opts: [T, number][]): T {
  const total = opts.reduce((a, [, w]) => a + Math.max(0, w), 0);
  let x = r.next() * total;
  for (const [v, w] of opts) {
    x -= Math.max(0, w);
    if (x <= 0) return v;
  }
  return opts[opts.length - 1][0];
}

/* ─────────────────────────── outfits ─────────────────────────── */

function base(r: Rnd, garment: Garment): Outfit {
  return {
    garment,
    top: r.pick(MUTED),
    legs: r.pick(DARK),
    shoes: r.pick([0x0e0e0f, 0x1a1512, 0x241c16, 0x151719, 0x2a221c]),
    skin: r.pick(SKIN),
    hair: 'short',
    hairColor: r.pick(HAIRC),
    accent: r.pick(ACCENT),
    hem: false,
    skirt: false,
    hoodDown: false,
    scarf: false,
    bag: false,
    umbrella: false,
    bulk: 1,
    hat: 'none',
    shoeKind: 'shoe',
    eyeColor: r.pick(EYES),
    brows: r.range(0.8, 1.35),
  };
}

/** Garment details that follow from the garment (shared by the crowd and the Wardrobe). */
export function dressGarment(o: Outfit, r: Rnd | null) {
  const pick = <T>(a: readonly T[], d: T) => (r ? r.pick(a) : d);
  o.hem = o.jacketHem = o.lapels = o.pocket = o.belt = false;
  o.shirt = o.tie = null;
  o.skirt = o.garment === 'skirt';
  o.bulk = 1;
  o.sleeves = 'long';
  switch (o.garment) {
    case 'coat':
      o.hem = true;
      o.bulk = 1.12;
      o.lapels = !o.scarf;
      break;
    case 'raincoat':
      o.hem = true;
      o.bulk = 1.1;
      break;
    case 'hoodie':
      o.bulk = 1.07;
      o.pocket = true;
      o.jacketHem = true;
      break;
    case 'puffer':
      o.bulk = 1.2;
      o.jacketHem = true;
      break;
    case 'jacket':
      o.jacketHem = true;
      o.belt = true;
      o.shirt = pick([0x6a6660, 0x8a8478, 0x3a3e44], 0x6a6660);
      break;
    case 'suit':
      o.jacketHem = true;
      o.lapels = true;
      o.shirt = pick([0xb8b4aa, 0xa6aab0, 0xc0b8a8], 0xb8b4aa);
      o.tie = r && r.chance(0.35) ? null : pick([0x5a1e1e, 0x1e2a44, 0x2e2e30, 0x4a3a1e], 0x2e2e30);
      o.belt = true;
      break;
    case 'workwear':
      o.bulk = 1.1;
      o.jacketHem = true;
      o.belt = true;
      break;
    case 'uniform':
      o.bulk = 1.08;
      o.jacketHem = true;
      o.shirt = 0x1a2030;
      break;
    case 'knit':
      o.bulk = 1.05;
      o.belt = true;
      break;
    case 'shirt':
      o.sleeves = r && r.chance(0.5) ? 'short' : 'long';
      o.belt = true;
      break;
    case 'tee':
      o.sleeves = 'short';
      o.belt = r ? r.chance(0.4) : false;
      break;
    case 'scrubs':
      o.sleeves = 'short';
      break;
    case 'skirt':
      break;
  }
}

/* ─────────────────────────── archetypes ─────────────────────────── */

type Build = (r: Rnd) => Person;

const persona = (r: Rnd, p: Partial<Persona>, idles: Record<string, number>): Persona => ({
  energy: p.energy ?? r.range(0.35, 0.65),
  confidence: p.confidence ?? r.range(0.35, 0.65),
  nervous: p.nervous ?? r.range(0.1, 0.4),
  tired: p.tired ?? r.range(0.1, 0.5),
  age: p.age ?? 0.3,
  leftHanded: r.chance(0.11),
  idles,
});

const ARCHETYPES: Record<ArchetypeId, Build> = {
  commuter: (r) => {
    const femme = r.range(0, 1) > 0.5 ? r.range(0.6, 1) : r.range(0, 0.35);
    const age = r.range(0.15, 0.6);
    const o = base(r, weighted<Garment>(r, [['coat', 3], ['raincoat', 2], ['jacket', 1.5], ['puffer', 1]]));
    o.top = o.garment === 'raincoat' ? r.pick(RAIN) : r.pick(WOOL.concat(DARK, r.chance(0.2) ? BRIGHT : []));
    o.scarf = r.chance(0.35);
    o.bag = r.chance(0.55);
    dressGarment(o, r);
    o.hair = cut(r, femme, age);
    o.hairColor = hairColor(r, age);
    o.facialHair = facial(r, femme);
    o.glasses = r.chance(0.2);
    o.hat = r.chance(0.12) ? 'beanie' : 'none';
    o.hatColor = o.accent;
    return { arche: 'commuter', body: body(r, femme, age), outfit: o, persona: persona(r, { age, energy: r.range(0.5, 0.8) }, { checkWatch: 3, checkPhone: 2, lookStreet: 2, adjust: 1, shift: 1 }) };
  },
  office: (r) => {
    const femme = r.chance(0.45) ? r.range(0.6, 1) : r.range(0, 0.3);
    const age = r.range(0.2, 0.55);
    const o = base(r, femme > 0.5 && r.chance(0.4) ? 'skirt' : 'suit');
    o.top = r.pick([0x1b1d22, 0x25272c, 0x2e2c2a, 0x1f2430, 0x3a3a3c]);
    o.legs = o.garment === 'suit' ? o.top : r.pick([0x141416, 0x2a2224]);
    dressGarment(o, r);
    o.bag = r.chance(0.6);
    o.hair = cut(r, femme, age);
    if (o.hair === 'messy' || o.hair === 'curly') o.hair = 'swept';
    o.hairColor = hairColor(r, age);
    o.facialHair = r.chance(0.3) ? facial(r, femme) : 'none';
    o.glasses = r.chance(0.35);
    return { arche: 'office', body: body(r, femme, age, { heavy: r.range(0, 0.4) }), outfit: o, persona: persona(r, { age, confidence: r.range(0.55, 0.9), energy: r.range(0.5, 0.8) }, { checkWatch: 4, checkPhone: 3, adjust: 2, lookStreet: 1 }) };
  },
  student: (r) => {
    const femme = r.chance(0.5) ? r.range(0.6, 1) : r.range(0, 0.3);
    const age = r.range(0, 0.12);
    const o = base(r, weighted<Garment>(r, [['hoodie', 4], ['puffer', 2], ['jacket', 1], ['tee', 0.6]]));
    o.top = r.chance(0.35) ? r.pick(BRIGHT) : r.pick(MUTED.concat([0x5a5a5e, 0x2a2a2e]));
    o.legs = r.pick(DENIM.concat(DARK));
    o.shoeKind = 'sneaker';
    o.soleColor = r.pick([0xd8d4cc, 0xe8e4dc, 0x2a2a2a]);
    dressGarment(o, r);
    o.hoodDown = o.garment === 'hoodie' && r.chance(0.7);
    o.hair = cut(r, femme, age);
    o.hairColor = r.pick(HAIRC);
    if (o.garment === 'hoodie' && !o.hoodDown) o.hat = 'hood';
    else o.hat = r.chance(0.2) ? 'cap' : r.chance(0.15) ? 'beanie' : 'none';
    o.hatColor = o.hat === 'hood' ? o.top : r.pick(ACCENT.concat(BRIGHT));
    o.backpack = r.chance(0.4) ? r.pick([0x2a2a2e, 0x3a2a24, 0x1e2a3a]) : null;
    o.facialHair = r.chance(0.3) ? 'stubble' : 'none';
    o.glasses = r.chance(0.15);
    return { arche: 'student', body: body(r, femme, age, { heavy: r.range(0, 0.3) }), outfit: o, persona: persona(r, { age, energy: r.range(0.6, 0.95), nervous: r.range(0.3, 0.7) }, { checkPhone: 6, lookAround: 2, footTap: 2, shift: 2, fixHair: 1 }) };
  },
  courier: (r) => {
    const femme = r.chance(0.3) ? r.range(0.6, 1) : r.range(0, 0.3);
    const age = r.range(0.05, 0.35);
    const o = base(r, r.chance(0.6) ? 'hoodie' : 'puffer');
    o.top = r.pick([0x1a1a1c, 0x2a2e36, 0x3a2a2a, 0x2a3a2e]);
    o.legs = r.pick([0x15161a, 0x1e2228]);
    o.shoeKind = 'sneaker';
    o.soleColor = 0xd8d4cc;
    dressGarment(o, r);
    o.hoodDown = true;
    // the box: the brand colours of a company that doesn't exist
    o.backpack = r.pick([0x2aa088, 0xd8742a, 0xc8b02a, 0x2a6ab0]);
    o.hat = r.chance(0.6) ? 'cap' : 'none';
    o.hatColor = r.pick([0x1a1a1c, o.backpack]);
    o.hair = cut(r, femme, age);
    o.hairColor = r.pick(HAIRC);
    o.facialHair = facial(r, femme);
    return { arche: 'courier', body: body(r, femme, age, { athletic: r.range(0.6, 1), heavy: 0 }), outfit: o, persona: persona(r, { age, energy: r.range(0.8, 1), confidence: r.range(0.5, 0.8) }, { checkPhone: 5, lookStreet: 3, shift: 2, stretch: 1 }) };
  },
  market: (r) => {
    const femme = r.chance(0.45) ? r.range(0.6, 1) : r.range(0, 0.3);
    const age = r.range(0.25, 0.75);
    const o = base(r, r.chance(0.5) ? 'shirt' : 'knit');
    o.top = r.pick([0x6a5a48, 0x3e4a52, 0x5a3a2a, 0x4a4a3a, 0x7a6a5a]);
    o.legs = r.pick([0x2a2e32, 0x3a3a36, 0x2b3444]);
    dressGarment(o, r);
    o.sleeves = 'short';
    o.apron = r.pick([0x6a6a60, 0x3a4a5a, 0x8a3a2a, 0xb0a890, 0x2a4a3a]);
    o.shoeKind = 'boot';
    o.hat = r.chance(0.35) ? 'flatcap' : r.chance(0.25) ? 'beanie' : 'none';
    o.hatColor = r.pick(WOOL);
    o.hair = cut(r, femme, age);
    o.hairColor = hairColor(r, age);
    o.facialHair = facial(r, femme);
    return { arche: 'market', body: body(r, femme, age, { heavy: r.range(0.3, 0.9) }), outfit: o, persona: persona(r, { age, energy: r.range(0.4, 0.7), confidence: r.range(0.5, 0.8) }, { adjust: 3, rubHands: 3, lookAround: 2, crossArms: 3, stretch: 1 }) };
  },
  nurse: (r) => {
    const femme = r.chance(0.65) ? r.range(0.6, 1) : r.range(0, 0.3);
    const age = r.range(0.15, 0.5);
    const o = base(r, 'scrubs');
    o.top = r.pick([0x3a6a78, 0x2a4a6a, 0x4a6a5a]);
    o.legs = o.top;
    o.shoeKind = 'sneaker';
    o.soleColor = 0xe8e4dc;
    dressGarment(o, r);
    o.hair = femme > 0.5 ? r.pick(['bun', 'ponytail', 'short'] as const) : cut(r, femme, age);
    o.hairColor = hairColor(r, age);
    o.bag = r.chance(0.5);
    o.facialHair = r.chance(0.2) ? facial(r, femme) : 'none';
    return { arche: 'nurse', body: body(r, femme, age), outfit: o, persona: persona(r, { age, tired: r.range(0.6, 1), energy: r.range(0.3, 0.55) }, { yawn: 3, stretch: 2, checkWatch: 2, rubEyes: 2, slump: 2 }) };
  },
  elder: (r) => {
    const femme = r.chance(0.5) ? r.range(0.6, 1) : r.range(0, 0.3);
    const age = r.range(0.7, 1);
    const o = base(r, r.chance(0.6) ? 'coat' : 'knit');
    o.top = r.pick(WOOL.concat([0x5a4a3a, 0x4a3a3a]));
    o.legs = r.pick([0x3a3432, 0x2b2824, 0x4a443a]);
    o.scarf = r.chance(0.5);
    dressGarment(o, r);
    o.hat = femme < 0.5 ? (r.chance(0.45) ? 'flatcap' : r.chance(0.2) ? 'trilby' : 'none') : 'none';
    o.hatColor = r.pick(WOOL);
    o.hair = femme > 0.5 ? r.pick(['bob', 'short', 'bun'] as const) : cut(r, femme, age);
    o.hairColor = r.pick(GREY);
    o.glasses = r.chance(0.55);
    o.facialHair = femme < 0.5 && r.chance(0.35) ? r.pick(['moustache', 'beard'] as const) : 'none';
    o.umbrella = r.chance(0.3);
    return { arche: 'elder', body: body(r, femme, age, { heavy: r.range(0.1, 0.6) }), outfit: o, persona: persona(r, { age, energy: r.range(0.1, 0.3), confidence: r.range(0.3, 0.6) }, { lookStreet: 3, adjust: 2, rubHands: 2, shift: 1 }) };
  },
  worker: (r) => {
    const femme = r.chance(0.15) ? r.range(0.6, 1) : r.range(0, 0.25);
    const age = r.range(0.2, 0.65);
    const o = base(r, 'workwear');
    o.top = r.pick([0x6a4a2a, 0x5a5236, 0x3e4a52, 0x2a3a4a]);
    o.legs = r.pick([0x2a2e32, 0x3a3a36]);
    dressGarment(o, r);
    o.vest = r.chance(0.7) ? r.pick([0xc8b02a, 0xd8742a]) : null;
    o.vestBand = 0xb8bcc0;
    o.shoeKind = 'boot';
    o.gloves = r.chance(0.3) ? 0x2a2622 : null;
    o.hat = r.chance(0.5) ? 'beanie' : r.chance(0.4) ? 'cap' : 'none';
    o.hatColor = r.pick([0x2a2a2e, 0x4a3a2a, 0x8a3a1e]);
    o.hair = cut(r, femme, age);
    o.hairColor = hairColor(r, age);
    o.facialHair = femme < 0.5 ? weighted<FacialHair>(r, [['stubble', 3], ['beard', 2], ['none', 1], ['moustache', 0.5]]) : 'none';
    return { arche: 'worker', body: body(r, femme, age, { heavy: r.range(0.2, 0.7), athletic: r.range(0.3, 0.8) }), outfit: o, persona: persona(r, { age, energy: r.range(0.4, 0.6), confidence: r.range(0.5, 0.8), tired: r.range(0.4, 0.8) }, { stretch: 3, rubHands: 2, crossArms: 2, lookAround: 1, shift: 2 }) };
  },
  drifter: (r) => {
    const femme = r.chance(0.35) ? r.range(0.6, 1) : r.range(0, 0.3);
    const age = r.range(0.2, 0.6);
    const o = base(r, r.chance(0.5) ? 'coat' : 'jacket');
    o.top = r.pick(DARK.concat([0x3a2e26, 0x2a2a2e, 0x4a2a24]));
    o.legs = r.pick(DENIM.concat(DARK));
    o.shoeKind = r.chance(0.5) ? 'boot' : 'shoe';
    dressGarment(o, r);
    o.hair = r.pick(['long', 'messy', 'curly', 'swept'] as const);
    o.hairColor = hairColor(r, age);
    o.facialHair = femme < 0.5 ? weighted<FacialHair>(r, [['beard', 2], ['stubble', 2], ['none', 1]]) : 'none';
    return { arche: 'drifter', body: body(r, femme, age, { heavy: r.range(0, 0.3), tall: r.range(0.98, 1.08) }), outfit: o, persona: persona(r, { age, energy: r.range(0.2, 0.5), confidence: r.range(0.2, 0.5), nervous: r.range(0.3, 0.6) }, { lookAround: 3, smoke: 3, lean: 3, shift: 2, crossArms: 1 }) };
  },
  taxi: (r) => {
    const age = r.range(0.55, 0.85);
    const o = base(r, 'jacket');
    o.top = r.pick([0x1c1e22, 0x2a2420, 0x2e2a26]);
    o.legs = 0x22262b;
    dressGarment(o, r);
    o.hat = 'flatcap';
    o.hatColor = r.pick([0x3a3228, 0x2a2622, 0x4a4238]);
    o.hair = 'short';
    o.hairColor = r.pick(GREY);
    o.facialHair = r.pick(['moustache', 'stubble', 'beard'] as const);
    o.glasses = r.chance(0.3);
    return { arche: 'taxi', body: body(r, 0.05, age, { heavy: r.range(0.4, 0.8) }), outfit: o, persona: persona(r, { age, energy: 0.25, tired: 0.8, confidence: 0.45 }, { rubEyes: 2, stretch: 1, lookStreet: 2 }) };
  },
  police: (r) => {
    const femme = r.chance(0.3) ? r.range(0.6, 1) : r.range(0, 0.25);
    const age = r.range(0.2, 0.5);
    const o = base(r, 'uniform');
    o.top = 0x18213a;
    o.legs = 0x12141c;
    o.shoes = 0x0b0b0c;
    dressGarment(o, r);
    o.vest = r.chance(0.5) ? 0xb8c02a : 0x16181c;
    o.vestBand = 0xc8ccd0;
    o.dutyBelt = true;
    o.radio = true;
    o.shoeKind = 'boot';
    o.hat = 'peaked';
    o.hatColor = 0x10131c;
    o.hair = femme > 0.5 ? r.pick(['bun', 'ponytail'] as const) : r.pick(['short', 'buzz'] as const);
    o.hairColor = r.pick(HAIRC);
    o.facialHair = femme < 0.5 && r.chance(0.3) ? 'stubble' : 'none';
    o.scarf = o.bag = o.umbrella = false;
    return { arche: 'police', body: body(r, femme, age, { athletic: r.range(0.5, 0.9), heavy: r.range(0, 0.4) }), outfit: o, persona: persona(r, { age, energy: 0.6, confidence: 0.9, nervous: 0.15 }, { scan: 5, radio: 3, handsHips: 2, shift: 1 }) };
  },
  watcher: (r) => {
    const o = base(r, 'raincoat');
    o.top = 0x8a8e8c;
    o.legs = 0x5a5e5c;
    o.skin = 0xd6c6b8;
    o.hat = 'hood';
    o.hatColor = 0x8a8e8c;
    o.hair = 'none';
    o.shoes = 0x3a3a3a;
    dressGarment(o, null);
    const b = body(r, 0.3, 0.3, { heavy: 0, tall: 1.1 });
    b.girth = 0.86;
    b.neckLen = 1.25;
    b.face = FACE_SHAPES.map((k) => (k === 'gaunt' ? 1 : k === 'chinLong' ? 0.8 : 0));
    return { arche: 'watcher', body: b, outfit: o, persona: persona(r, { energy: 0, confidence: 1, nervous: 0, tired: 0 }, {}) };
  },
  clerk: (r) => {
    const o = base(r, 'suit');
    o.top = 0x2a2226;
    o.legs = 0x1a1a1c;
    dressGarment(o, r);
    o.tie = 0x4a1e22;
    o.hair = 'swept';
    o.hairColor = 0x1d1511;
    o.glasses = true;
    o.facialHair = 'none';
    const b = body(r, 0.1, 0.45, { heavy: 0.1 });
    b.face = FACE_SHAPES.map((k) => (k === 'noseLong' ? 0.7 : k === 'gaunt' ? 0.6 : k === 'browHeavy' ? 0.5 : 0.1));
    return { arche: 'clerk', body: b, outfit: o, persona: persona(r, { energy: 0.1, confidence: 0.8, nervous: 0 }, {}) };
  },
  crook: (r) => {
    const femme = r.chance(0.15) ? r.range(0.6, 1) : r.range(0, 0.2);
    const age = r.range(0.1, 0.4);
    const o = base(r, 'hoodie');
    o.top = r.pick([0x1a1a1c, 0x2a2420, 0x1c2228, 0x3a1414]);
    o.legs = 0x15161a;
    o.shoeKind = 'sneaker';
    o.soleColor = 0x2a2a2a;
    dressGarment(o, r);
    o.hat = 'hood';
    o.hatColor = o.top;
    o.hoodDown = false;
    o.hair = 'short';
    o.facialHair = femme < 0.5 ? r.pick(['stubble', 'goatee', 'none'] as const) : 'none';
    return { arche: 'crook', body: body(r, femme, age, { athletic: r.range(0.4, 0.8) }), outfit: o, persona: persona(r, { age, energy: 0.8, nervous: 0.8, confidence: 0.6 }, { lookAround: 6, shift: 2 }) };
  },
  soldier: (r) => {
    const femme = r.chance(0.3) ? r.range(0.6, 1) : r.range(0, 0.25);
    const age = r.range(0.1, 0.45);
    const o = base(r, 'uniform');
    dressGarment(o, r);
    o.vest = 0x2a2e26;
    o.vestBand = 0x2a2e26;
    o.dutyBelt = true;
    o.shoeKind = 'boot';
    o.gloves = 0x1a1a1a;
    o.hair = femme > 0.5 ? 'bun' : r.pick(['buzz', 'short'] as const);
    o.hairColor = r.pick(HAIRC);
    o.facialHair = femme < 0.5 && r.chance(0.35) ? r.pick(['stubble', 'beard'] as const) : 'none';
    return { arche: 'soldier', body: body(r, femme, age, { athletic: r.range(0.5, 1), heavy: r.range(0, 0.3) }), outfit: o, persona: persona(r, { age, energy: 0.8, confidence: 0.85 }, { scan: 4, shift: 2 }) };
  },
  fighter: (r) => {
    const femme = r.chance(0.35) ? r.range(0.6, 1) : r.range(0, 0.2);
    const age = r.range(0.1, 0.4);
    const o = base(r, 'tee');
    dressGarment(o, r);
    o.shoeKind = 'sneaker';
    o.hair = cut(r, femme, age);
    o.hairColor = r.pick(HAIRC);
    o.facialHair = facial(r, femme);
    return { arche: 'fighter', body: body(r, femme, age, { athletic: r.range(0.7, 1), heavy: r.range(0, 0.25) }), outfit: o, persona: persona(r, { age, energy: 0.9, confidence: 0.9 }, {}) };
  },
};

/** Build someone of a given kind (or a likely one for where they are). */
export function makePerson(r: Rnd, arche?: ArchetypeId): Person {
  const a = arche ?? weighted<ArchetypeId>(r, [['commuter', 5], ['office', 2], ['student', 3], ['courier', 1.5], ['nurse', 1], ['elder', 1.5], ['worker', 1], ['drifter', 1.5], ['market', 0.6]]);
  const p = ARCHETYPES[a](r);
  if (p.outfit.hat && p.outfit.hat !== 'none' && p.outfit.hatColor === undefined) p.outfit.hatColor = p.outfit.accent;
  return p;
}

/** Who you'd expect on a given route or at a given spot. */
export function archetypeFor(r: Rnd, where: string): ArchetypeId | undefined {
  switch (where) {
    case 'yard':
      return weighted<ArchetypeId>(r, [['worker', 5], ['drifter', 1]]);
    case 'square':
    case 'alleyM':
      return weighted<ArchetypeId>(r, [['market', 4], ['elder', 1], ['student', 1], ['commuter', 1]]);
    case 'prom':
    case 'prom2':
      return weighted<ArchetypeId>(r, [['commuter', 2], ['elder', 2], ['drifter', 2], ['student', 1]]);
    case 'avW':
    case 'avE':
      return weighted<ArchetypeId>(r, [['commuter', 4], ['office', 3], ['courier', 2], ['student', 2], ['nurse', 1]]);
    case 'smoke':
      return weighted<ArchetypeId>(r, [['drifter', 2], ['worker', 1], ['nurse', 1], ['office', 1]]);
    case 'phone':
      return weighted<ArchetypeId>(r, [['student', 3], ['office', 1], ['courier', 1]]);
    case 'sit':
      return weighted<ArchetypeId>(r, [['elder', 3], ['drifter', 2], ['student', 1]]);
    case 'wait':
      return weighted<ArchetypeId>(r, [['commuter', 3], ['office', 2], ['nurse', 1]]);
    default:
      return undefined;
  }
}
