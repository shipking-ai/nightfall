import { mulberry32 } from '../../world/rng';
import type { BiomeId } from '../world/biomes';
import type { BottomKind, HairKind, HumanSpec, ShoeKind, TopKind, Fabric, BeardKind } from './anatomy';

/**
 * People for the RPG: who they are decides how they look. Skin, hair and
 * eyes from real human ranges; clothes from a muted, lived-in palette; what
 * they wear from where they live (parkas in the north, linen in the desert,
 * waxed jackets in the rain) and what they do.
 */

export const SKIN_TONES = [0xf1d3bf, 0xe8c0a4, 0xdcae8f, 0xca9674, 0xb58062, 0x9c6a4c, 0x80533a, 0x66412d, 0x4e3122, 0x3c2519];
const HAIR_COLORS = [0x0f0b09, 0x1c140e, 0x2c1e14, 0x3f2a1a, 0x5a3c22, 0x7a5430, 0x9a7446, 0xb89a68, 0x8a8886, 0xc8c6c2, 0x6a2c16];
const EYE_COLORS = [0x3a2414, 0x4e3220, 0x5e4a2a, 0x4a5a3a, 0x3e5a70, 0x5a7a96, 0x6a6a5e];
const CLOTH = {
  dark: [0x1c1d20, 0x24262a, 0x2e2c2a, 0x1a1e24, 0x302a24],
  earth: [0x5a4a36, 0x6a5a40, 0x4a4030, 0x7a6448, 0x3e3a2e, 0x5e5340],
  cool: [0x2e3a4a, 0x3a4652, 0x44505a, 0x28343e, 0x505a62],
  warm: [0x6a2a22, 0x7a3a28, 0x8a5a2a, 0x5a2e2e, 0x9a6a3a],
  light: [0xb8b2a4, 0xc8c2b4, 0xa8a698, 0xd4cec2, 0x9a9a94],
  olive: [0x4a4e36, 0x3e4430, 0x5a5a3e, 0x363a2c],
  denim: [0x2e3e58, 0x3a4c6a, 0x28364e, 0x4a5a74],
};

export interface Who {
  sex?: number;
  age?: number;
  biome?: BiomeId;
  job?: 'worker' | 'office' | 'police' | 'soldier' | 'farmer' | 'drifter' | 'fisher' | 'medic' | 'hunter' | 'rich' | 'mechanic' | 'bartender' | 'student';
}

export function randomSpec(seed: number, who: Who = {}): HumanSpec {
  const r = mulberry32(seed >>> 0);
  const rr = (a = 0, b = 1) => r.range(a, b);
  const pick = <T>(a: readonly T[]) => r.pick(a);
  const sex = who.sex ?? (r.chance(0.5) ? r.range(0.8, 1) : r.range(0, 0.2));
  const male = sex > 0.5;
  const age = who.age ?? Math.pow(r.next(), 1.4);
  const biome = who.biome ?? 'temperate';
  const cold = biome === 'tundra' || biome === 'boreal' || biome === 'alpine';
  const hot = biome === 'desert' || biome === 'scrub' || biome === 'coast' || biome === 'swamp';
  const job = who.job ?? pick(['worker', 'office', 'drifter', 'student', 'worker', 'mechanic', 'bartender', 'rich'] as const);
  const skinI = Math.min(SKIN_TONES.length - 1, Math.max(0, Math.round(r.range(0, SKIN_TONES.length - 1) + (hot ? 1.5 : cold ? -1.5 : 0))));
  const hairC = age > 0.75 && r.chance(0.7) ? pick([0x8a8886, 0xc8c6c2, 0xa8a6a2]) : pick(HAIR_COLORS.slice(0, skinI > 5 ? 3 : 9));
  const hair: HairKind = male ? pick(['short', 'buzz', 'swept', 'short', 'curly', age > 0.7 ? 'bald' : 'short'] as const) : pick(['long', 'bob', 'ponytail', 'bun', 'long', 'curly', 'short', 'braids'] as const);
  const beard: BeardKind = male ? pick(['none', 'stubble', 'stubble', 'beard', 'moustache', 'goatee', cold ? 'fullBeard' : 'stubble'] as const) : 'none';
  // clothes: by climate and job
  let top: TopKind, topFabric: Fabric, bottom: BottomKind, bottomFabric: Fabric, shoes: ShoeKind;
  if (cold) {
    top = pick(['coat', 'jacket', 'coat', 'hoodie'] as const);
    topFabric = top === 'coat' ? pick(['wool', 'nylon'] as const) : pick(['canvas', 'nylon', 'leather'] as const);
  } else if (hot) {
    top = pick(['tee', 'shirt', 'tank', 'tee'] as const);
    topFabric = pick(['cotton', 'cotton', 'silk'] as const);
  } else {
    top = pick(['jacket', 'coat', 'shirt', 'hoodie', 'sweater', 'tee', 'jacket'] as const);
    topFabric = top === 'sweater' ? 'knit' : top === 'coat' ? 'wool' : top === 'jacket' ? pick(['leather', 'canvas', 'denim', 'nylon'] as const) : 'cotton';
  }
  if (job === 'police' || job === 'soldier') {
    top = job === 'soldier' ? 'armor' : 'jacket';
    topFabric = 'nylon';
  }
  if (job === 'rich' && !hot) {
    top = 'coat';
    topFabric = 'wool';
  }
  bottom = !male && r.chance(0.2) && !cold ? 'skirt' : hot && r.chance(0.35) ? 'shorts' : pick(['trousers', 'jeans', 'jeans', 'cargo'] as const);
  bottomFabric = bottom === 'jeans' ? 'denim' : bottom === 'cargo' ? 'canvas' : 'cotton';
  shoes = cold || job === 'soldier' || job === 'worker' || job === 'farmer' ? 'boots' : pick(['shoes', 'sneakers', 'boots'] as const);
  const palette = job === 'soldier' ? CLOTH.olive : job === 'rich' ? CLOTH.dark : pick([CLOTH.dark, CLOTH.earth, CLOTH.cool, CLOTH.warm, CLOTH.light, CLOTH.olive]);
  const topC = job === 'police' ? 0x1a2230 : pick(palette);
  const botC = bottom === 'jeans' ? pick(CLOTH.denim) : pick(r.chance(0.5) ? CLOTH.dark : CLOTH.earth);
  return {
    sex, age,
    muscle: rr(0.2, 0.8) * (job === 'soldier' || job === 'worker' ? 1.3 : 1),
    fat: Math.pow(r.next(), 2) * 0.9 + age * 0.15,
    shoulders: rr(0.3, 0.8), hips: rr(0.3, 0.8), bust: rr(0.2, 0.9),
    jaw: rr(), cheeks: rr(), nose: rr(), noseBridge: rr(), lips: rr(), brow: rr(), chin: rr(), eyes: rr(), ears: rr(), faceLong: rr(),
    skin: SKIN_TONES[skinI], eyeColor: pick(EYE_COLORS.slice(0, skinI > 5 ? 3 : 7)),
    hair, hairColor: hairC, beard,
    top: { kind: top, color: topC, fabric: topFabric },
    bottom: { kind: bottom, color: botC, fabric: bottomFabric },
    shoes: { kind: shoes, color: pick([0x1a1410, 0x2a1c12, 0x3a2a1c, 0x1c1c1e, 0xd8d4cc]) },
    extras: {
      scarf: cold || (top === 'coat' && r.chance(0.4)) ? pick([...CLOTH.warm, ...CLOTH.cool]) : undefined,
      backpack: job === 'student' || job === 'drifter' || job === 'hunter' ? pick(CLOTH.earth) : undefined,
      belt: bottom !== 'skirt' && r.chance(0.6) ? pick([0x2a1a10, 0x1a1410, 0x3a2414]) : undefined,
      gloves: cold && r.chance(0.5) ? pick([0x1a1410, 0x2a2622]) : undefined,
      holster: job === 'police' || job === 'soldier',
      bandolier: job === 'hunter' ? 0x3a2414 : undefined,
    },
    seed: r.int(0, 9999),
  };
}

/** The one the story starts with: a long charcoal coat and a turned-up scarf (the figure District 03 knows). */
export function heroSpec(sex = 0.9, seed = 7): HumanSpec {
  const s = randomSpec(seed, { sex, age: 0.35, biome: 'temperate' });
  s.top = { kind: 'coat', color: 0x2a2c30, fabric: 'wool' };
  s.bottom = { kind: 'trousers', color: 0x16171a, fabric: 'cotton' };
  s.shoes = { kind: 'boots', color: 0x17120e };
  s.extras = { scarf: 0x6a5a48, belt: 0x1a1410 };
  s.hair = 'swept';
  s.hairColor = 0x1c140e;
  s.beard = 'stubble';
  s.skin = 0xc99a7c;
  s.eyeColor = 0x4e3220;
  return s;
}
