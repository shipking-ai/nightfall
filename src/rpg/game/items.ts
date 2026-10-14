/**
 * Everything you can carry. Definitions live here once; what you carry is a
 * list of stacks ({ id, n }) with an optional name and data for one-off things
 * (a letter, a photograph, a key to a particular door).
 */

export type ItemKind = 'food' | 'drink' | 'medical' | 'tool' | 'weapon' | 'ammo' | 'clothing' | 'valuable' | 'material' | 'evidence' | 'key' | 'parcel';

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  /** kilograms */
  w: number;
  /** base price in dollars (what a shop asks, before the region and your haggling) */
  v: number;
  desc: string;
  /** can't be sold or dropped (letters, keys, evidence for a case) */
  quest?: boolean;
  /** what using it does */
  use?: { fed?: number; rest?: number; warmth?: number; heal?: number; stamina?: number; label?: string };
  /** worn: how much it keeps out the cold (0–1) and the rain */
  wear?: { warm?: number; dry?: number; slot: 'coat' | 'hat' | 'boots' };
  /** a weapon's reach: 'melee' or a calibre it takes */
  weapon?: { dmg: number; ammo?: string; skill: 'melee' | 'firearms' };
}

const D: ItemDef[] = [
  // food and drink
  { id: 'coffee', name: 'Coffee, black', kind: 'drink', w: 0.3, v: 3, desc: 'From a pot that’s been on since midnight. It works.', use: { rest: 18, stamina: 30, warmth: 10, label: 'Drink' } },
  { id: 'water', name: 'Bottled water', kind: 'drink', w: 0.5, v: 2, desc: 'Clear, cold, and from somewhere else.', use: { stamina: 15, label: 'Drink' } },
  { id: 'whiskey', name: 'Half-bottle of whiskey', kind: 'drink', w: 0.4, v: 14, desc: 'Warms you up. Slows you down.', use: { warmth: 25, rest: -5, label: 'Drink' } },
  { id: 'sandwich', name: 'Wrapped sandwich', kind: 'food', w: 0.3, v: 6, desc: 'Ham and something. The label says today.', use: { fed: 35, label: 'Eat' } },
  { id: 'jerky', name: 'Beef jerky', kind: 'food', w: 0.1, v: 4, desc: 'Keeps forever. Tastes like it.', use: { fed: 15, label: 'Eat' } },
  { id: 'beans', name: 'Can of beans', kind: 'food', w: 0.45, v: 3, desc: 'Better hot. Fine cold.', use: { fed: 30, label: 'Eat' } },
  { id: 'apple', name: 'Apple', kind: 'food', w: 0.2, v: 1, desc: 'A little bruised.', use: { fed: 10, stamina: 5, label: 'Eat' } },
  { id: 'stew', name: 'Stew in a tin mug', kind: 'food', w: 0.6, v: 9, desc: 'Cooked over a fire. The best thing you’ve eaten all week.', use: { fed: 60, warmth: 20, label: 'Eat' } },
  { id: 'fish', name: 'Fresh fish', kind: 'food', w: 1.1, v: 8, desc: 'Caught today. Cook it or sell it.', use: { fed: 12, label: 'Eat raw' } },
  { id: 'meat', name: 'Raw venison', kind: 'food', w: 1.5, v: 12, desc: 'Needs a fire.', use: { fed: 10, label: 'Eat raw' } },
  { id: 'grilledfish', name: 'Grilled fish', kind: 'food', w: 0.5, v: 10, desc: 'Charred skin, white flakes, a pinch of ash.', use: { fed: 45, warmth: 10, label: 'Eat' } },
  { id: 'venison', name: 'Roast venison', kind: 'food', w: 0.8, v: 16, desc: 'Cooked over coals. Worth the trouble.', use: { fed: 60, warmth: 12, label: 'Eat' } },
  { id: 'tea', name: 'Herbal tea', kind: 'drink', w: 0.3, v: 5, desc: 'Bitter, hot, and it does something for the aches.', use: { heal: 15, warmth: 20, rest: 5, label: 'Drink' } },
  { id: 'herbs', name: 'Wild herbs', kind: 'material', w: 0.1, v: 3, desc: 'Yarrow and something bitter. Good for a wound.', use: { heal: 6, label: 'Chew' } },
  // medical
  { id: 'bandage', name: 'Bandage', kind: 'medical', w: 0.1, v: 5, desc: 'Stops the bleeding.', use: { heal: 20, label: 'Apply' } },
  { id: 'medkit', name: 'First-aid kit', kind: 'medical', w: 0.8, v: 28, desc: 'Everything a clinic would do, badly, in a tin.', use: { heal: 60, label: 'Use' } },
  { id: 'painkillers', name: 'Painkillers', kind: 'medical', w: 0.05, v: 8, desc: 'Take two.', use: { heal: 12, stamina: 10, label: 'Take' } },
  // tools
  { id: 'flashlight', name: 'Flashlight', kind: 'tool', w: 0.4, v: 15, desc: 'A long steel torch. Also a club, at a pinch.' },
  { id: 'lockpicks', name: 'Lockpicks', kind: 'tool', w: 0.05, v: 22, desc: 'A tension wrench and five picks in a leather roll.' },
  { id: 'camera', name: 'Camera', kind: 'tool', w: 0.6, v: 40, desc: 'For evidence. For the record.' },
  { id: 'notebook', name: 'Notebook', kind: 'tool', w: 0.1, v: 2, desc: 'Half full already. Your handwriting, mostly.' },
  { id: 'lighter', name: 'Lighter', kind: 'tool', w: 0.05, v: 3, desc: 'Brass. Someone’s initials, not yours.' },
  { id: 'rope', name: 'Rope', kind: 'tool', w: 1.2, v: 8, desc: 'Twenty metres of it.' },
  { id: 'crowbar', name: 'Crowbar', kind: 'tool', w: 2.2, v: 12, desc: 'Opens most things. Loudly.', weapon: { dmg: 22, skill: 'melee' } },
  { id: 'rod', name: 'Fishing rod', kind: 'tool', w: 1.0, v: 25, desc: 'Telescopic, with a reel that sticks.' },
  { id: 'binoculars', name: 'Binoculars', kind: 'tool', w: 0.7, v: 30, desc: 'See it before it sees you.' },
  { id: 'fuel', name: 'Can of fuel', kind: 'tool', w: 5, v: 18, desc: 'Ten litres.' },
  { id: 'repairkit', name: 'Repair kit', kind: 'tool', w: 2, v: 30, desc: 'Wrenches, tape, wire, a prayer.' },
  { id: 'roadmap', name: 'Road atlas', kind: 'tool', w: 0.5, v: 10, desc: 'Every road in the county. Some that aren’t there any more.' },
  // weapons and rounds
  { id: 'knife', name: 'Folding knife', kind: 'weapon', w: 0.2, v: 12, desc: 'Sharp enough.', weapon: { dmg: 18, skill: 'melee' } },
  { id: 'knuckles', name: 'Brass knuckles', kind: 'weapon', w: 0.3, v: 15, desc: 'Makes a point.', weapon: { dmg: 14, skill: 'melee' } },
  { id: 'bat', name: 'Baseball bat', kind: 'weapon', w: 1.0, v: 18, desc: 'Ash. Signed by nobody.', weapon: { dmg: 26, skill: 'melee' } },
  { id: 'revolver', name: '.38 revolver', kind: 'weapon', w: 0.9, v: 180, desc: 'Six shots, and you count them.', weapon: { dmg: 40, ammo: 'r38', skill: 'firearms' } },
  { id: 'pistol', name: '9mm pistol', kind: 'weapon', w: 0.8, v: 240, desc: 'Fifteen in the magazine.', weapon: { dmg: 32, ammo: 'r9', skill: 'firearms' } },
  { id: 'shotgun', name: 'Pump shotgun', kind: 'weapon', w: 3.4, v: 320, desc: 'Close. Final.', weapon: { dmg: 80, ammo: 'shells', skill: 'firearms' } },
  { id: 'rifle', name: 'Hunting rifle', kind: 'weapon', w: 3.8, v: 380, desc: 'Bolt action, a good scope.', weapon: { dmg: 90, ammo: 'r308', skill: 'firearms' } },
  { id: 'r38', name: '.38 rounds', kind: 'ammo', w: 0.01, v: 1, desc: 'For the revolver.' },
  { id: 'r9', name: '9mm rounds', kind: 'ammo', w: 0.01, v: 1, desc: 'For the pistol.' },
  { id: 'shells', name: 'Shotgun shells', kind: 'ammo', w: 0.03, v: 2, desc: 'Buckshot.' },
  { id: 'r308', name: '.308 rounds', kind: 'ammo', w: 0.025, v: 3, desc: 'For the rifle.' },
  // clothing
  { id: 'parka', name: 'Down parka', kind: 'clothing', w: 1.8, v: 120, desc: 'For the north. Nothing gets through it.', wear: { warm: 0.8, dry: 0.5, slot: 'coat' } },
  { id: 'raincoat', name: 'Waxed raincoat', kind: 'clothing', w: 1.2, v: 70, desc: 'The rain runs off it.', wear: { warm: 0.3, dry: 0.9, slot: 'coat' } },
  { id: 'beanie', name: 'Wool beanie', kind: 'clothing', w: 0.1, v: 12, desc: 'Keeps your ears on.', wear: { warm: 0.15, slot: 'hat' } },
  { id: 'sunhat', name: 'Wide-brim hat', kind: 'clothing', w: 0.2, v: 18, desc: 'For the desert.', wear: { warm: -0.15, slot: 'hat' } },
  { id: 'boots', name: 'Work boots', kind: 'clothing', w: 1.4, v: 45, desc: 'Steel toes, good tread.', wear: { warm: 0.1, dry: 0.3, slot: 'boots' } },
  // valuables and materials
  { id: 'watch', name: 'Pocket watch', kind: 'valuable', w: 0.1, v: 60, desc: 'Stopped at 3:12.' },
  { id: 'ring', name: 'Gold ring', kind: 'valuable', w: 0.01, v: 90, desc: 'An inscription worn smooth.' },
  { id: 'coin', name: 'Old coin', kind: 'valuable', w: 0.01, v: 25, desc: 'A face you don’t recognise, a date that can’t be right.' },
  { id: 'records', name: 'Box of records', kind: 'valuable', w: 3, v: 45, desc: 'Jazz, mostly. Someone loved these.' },
  { id: 'scrap', name: 'Scrap metal', kind: 'material', w: 1.5, v: 4, desc: 'Worth something to someone.' },
  { id: 'cloth', name: 'Cloth', kind: 'material', w: 0.3, v: 2, desc: 'Rags, clean-ish.' },
  { id: 'hide', name: 'Deer hide', kind: 'material', w: 3, v: 22, desc: 'Needs tanning.' },
  { id: 'parts', name: 'Engine parts', kind: 'material', w: 2.5, v: 30, desc: 'A distributor cap, plugs, a belt.' },
  // story and cases (named per instance)
  { id: 'letter', name: 'Letter', kind: 'evidence', w: 0.01, v: 0, desc: 'Folded twice.', quest: true },
  { id: 'photo', name: 'Photograph', kind: 'evidence', w: 0.01, v: 0, desc: 'Creased and old.', quest: true },
  { id: 'note', name: 'Note', kind: 'evidence', w: 0.01, v: 0, desc: 'A scrap of paper.', quest: true },
  { id: 'key', name: 'Key', kind: 'key', w: 0.02, v: 0, desc: 'For a particular door.', quest: true },
  { id: 'parcel', name: 'Parcel', kind: 'parcel', w: 1.5, v: 0, desc: 'Brown paper, string, a name.', quest: true },
  { id: 'keepsake', name: 'Keepsake', kind: 'evidence', w: 0.1, v: 0, desc: 'Somebody wants this back.', quest: true },
];

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(D.map((d) => [d.id, d]));

export function item(id: string): ItemDef {
  return ITEMS[id] ?? { id, name: id, kind: 'material', w: 0, v: 0, desc: '' };
}

export const KIND_LABEL: Record<ItemKind, string> = {
  food: 'Food', drink: 'Drink', medical: 'Medical', tool: 'Tools', weapon: 'Weapons', ammo: 'Rounds', clothing: 'Clothing',
  valuable: 'Valuables', material: 'Materials', evidence: 'Evidence', key: 'Keys', parcel: 'Parcels',
};
