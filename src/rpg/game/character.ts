/**
 * Who you are, in numbers: six attributes you choose, twelve skills that grow
 * by doing, a level from everything you've done, and a perk each time you
 * rise. Backgrounds are a place to start, not a class: anyone can learn
 * anything, it just takes longer.
 */

export type Attr = 'grit' | 'reflex' | 'stamina' | 'wits' | 'nerve' | 'charm';
export type Skill = 'firearms' | 'melee' | 'driving' | 'stealth' | 'lockpicking' | 'speech' | 'barter' | 'medicine' | 'mechanics' | 'survival' | 'investigation' | 'athletics';

export const ATTRS: { id: Attr; name: string; body: boolean; desc: string }[] = [
  { id: 'grit', name: 'Grit', body: true, desc: 'Strength and stubbornness. Hits harder, carries more, stares people down.' },
  { id: 'reflex', name: 'Reflex', body: true, desc: 'Hands and feet. Steadier aim, quieter steps, quicker hands on a lock.' },
  { id: 'stamina', name: 'Stamina', body: true, desc: 'How long you last. More health, more breath, less need of sleep.' },
  { id: 'wits', name: 'Wits', body: false, desc: 'Noticing. Clues, engines, wounds, the thing that doesn’t fit.' },
  { id: 'nerve', name: 'Nerve', body: false, desc: 'Keeping it together. In a gunfight, in the dark, in front of the thing in the dark.' },
  { id: 'charm', name: 'Charm', body: false, desc: 'People. They tell you more, charge you less, forgive you faster.' },
];

export const SKILLS: { id: Skill; name: string; attr: Attr; desc: string }[] = [
  { id: 'firearms', name: 'Firearms', attr: 'nerve', desc: 'Aim, recoil, reloading under pressure.' },
  { id: 'melee', name: 'Melee', attr: 'grit', desc: 'Fists, bats, whatever’s to hand.' },
  { id: 'driving', name: 'Driving', attr: 'reflex', desc: 'Speed, grip, getting away.' },
  { id: 'stealth', name: 'Stealth', attr: 'reflex', desc: 'Not being seen, not being heard.' },
  { id: 'lockpicking', name: 'Lockpicking', attr: 'reflex', desc: 'Doors, safes, cars.' },
  { id: 'speech', name: 'Speech', attr: 'charm', desc: 'Persuading, lying, talking someone down.' },
  { id: 'barter', name: 'Barter', attr: 'charm', desc: 'Buying low, selling high.' },
  { id: 'medicine', name: 'Medicine', attr: 'wits', desc: 'Patching wounds, knowing what’s wrong.' },
  { id: 'mechanics', name: 'Mechanics', attr: 'wits', desc: 'Engines, wiring, fixing what’s broken.' },
  { id: 'survival', name: 'Survival', attr: 'stamina', desc: 'Weather, tracking, fishing, fire.' },
  { id: 'investigation', name: 'Investigation', attr: 'wits', desc: 'Clues, searching, reading a room.' },
  { id: 'athletics', name: 'Athletics', attr: 'stamina', desc: 'Running, climbing, swimming.' },
];

export const SKILL: Record<Skill, (typeof SKILLS)[number]> = Object.fromEntries(SKILLS.map((s) => [s.id, s])) as Record<Skill, (typeof SKILLS)[number]>;

export interface Perk {
  id: string;
  name: string;
  desc: string;
  need?: Partial<Record<Attr, number>>;
  level?: number;
  /** flat bonus to a skill's checks */
  bonus?: Partial<Record<Skill, number>>;
}

export const PERKS: Perk[] = [
  { id: 'silver', name: 'Silver Tongue', desc: '+15 to Speech checks.', need: { charm: 5 }, bonus: { speech: 15 } },
  { id: 'haggler', name: 'Haggler', desc: 'Shops charge 10% less and pay 10% more.', need: { charm: 4 } },
  { id: 'bloodhound', name: 'Bloodhound', desc: '+15 to Investigation. Searches take half the time.', need: { wits: 5 }, bonus: { investigation: 15 } },
  { id: 'locksmith', name: 'Locksmith', desc: '+20 to Lockpicking.', need: { reflex: 5 }, bonus: { lockpicking: 20 } },
  { id: 'softstep', name: 'Soft Step', desc: '+15 to Stealth. Witnesses take longer to notice you.', need: { reflex: 4 }, bonus: { stealth: 15 } },
  { id: 'brawler', name: 'Brawler', desc: '+15 to Melee. Fists hit like a bat.', need: { grit: 5 }, bonus: { melee: 15 } },
  { id: 'steady', name: 'Steady Hands', desc: '+15 to Firearms. Less sway.', need: { nerve: 5 }, bonus: { firearms: 15 } },
  { id: 'intimidating', name: 'Intimidating', desc: 'Threats use Grit as well as Speech, and people remember.', need: { grit: 6 } },
  { id: 'packmule', name: 'Pack Mule', desc: '+15 kg carry weight.', need: { grit: 4 } },
  { id: 'medic', name: 'Field Medic', desc: 'Medical items heal 50% more.', need: { wits: 4 }, bonus: { medicine: 10 } },
  { id: 'greasemonkey', name: 'Grease Monkey', desc: '+20 to Mechanics.', need: { wits: 4 }, bonus: { mechanics: 20 } },
  { id: 'leadfoot', name: 'Lead Foot', desc: '+15 to Driving. Cars go a little faster for you.', need: { reflex: 4 }, bonus: { driving: 15 } },
  { id: 'outdoorsman', name: 'Outdoorsman', desc: '+15 to Survival. The cold takes longer to get to you.', need: { stamina: 4 }, bonus: { survival: 15 } },
  { id: 'ironstomach', name: 'Iron Stomach', desc: 'Raw food feeds you like cooked.', need: { stamina: 3 } },
  { id: 'secondwind', name: 'Second Wind', desc: 'Stamina comes back twice as fast.', need: { stamina: 5 } },
  { id: 'nightowl', name: 'Night Owl', desc: 'You need less sleep, and see better after dark.', level: 3 },
  { id: 'coldblood', name: 'Cold Blooded', desc: 'Fear takes a lot longer to get hold of you.', need: { nerve: 6 } },
  { id: 'localhero', name: 'Local Hero', desc: 'Reputation you earn counts for a quarter more.', need: { charm: 4 }, level: 4 },
  { id: 'fixer', name: 'Fixer', desc: 'Jobs pay a fifth more.', need: { charm: 3, wits: 3 }, level: 3 },
  { id: 'runner', name: 'Marathon', desc: '+15 to Athletics. Sprint longer.', need: { stamina: 4 }, bonus: { athletics: 15 } },
  { id: 'hunch', name: 'Hunch', desc: 'Rumours point you at the right place more often, and you notice what’s out of place.', need: { wits: 6 }, level: 5 },
  { id: 'deadeye', name: 'Deadeye', desc: 'Aimed shots at a standstill do double damage.', need: { nerve: 7, reflex: 5 }, level: 6 },
  { id: 'unshakeable', name: 'Unshakeable', desc: 'Once a night, when fear or wounds would drop you, you get back up.', need: { nerve: 7, stamina: 5 }, level: 8 },
  { id: 'everyman', name: 'Everyman', desc: 'Every skill grows 10% faster.', level: 2 },
];

export const PERK: Record<string, Perk> = Object.fromEntries(PERKS.map((p) => [p.id, p]));

export interface Background {
  id: string;
  name: string;
  line: string;
  attrs: Partial<Record<Attr, number>>;
  skills: Partial<Record<Skill, number>>;
  items: [string, number][];
  money: number;
}

export const BACKGROUNDS: Background[] = [
  { id: 'investigator', name: 'Investigator', line: 'You used to do this for a living. Maybe you still do.', attrs: { wits: 2, nerve: 1 }, skills: { investigation: 30, speech: 15, firearms: 10 }, items: [['notebook', 1], ['camera', 1], ['flashlight', 1], ['coffee', 2]], money: 80 },
  { id: 'bruiser', name: 'Bruiser', line: 'You’ve settled more things with your hands than you’d like to count.', attrs: { grit: 2, stamina: 1 }, skills: { melee: 30, athletics: 20, speech: 5 }, items: [['knuckles', 1], ['bandage', 3], ['jerky', 2]], money: 45 },
  { id: 'wheelman', name: 'Wheelman', line: 'Every road in the county, and the back ones too.', attrs: { reflex: 2, nerve: 1 }, skills: { driving: 35, mechanics: 20, stealth: 5 }, items: [['repairkit', 1], ['roadmap', 1], ['coffee', 1]], money: 60 },
  { id: 'grifter', name: 'Grifter', line: 'People like you. That’s the problem, for them.', attrs: { charm: 2, wits: 1 }, skills: { speech: 30, barter: 25, lockpicking: 5 }, items: [['watch', 1], ['whiskey', 1]], money: 140 },
  { id: 'drifter', name: 'Drifter', line: 'You’ve slept under more skies than roofs.', attrs: { stamina: 2, grit: 1 }, skills: { survival: 35, athletics: 15, melee: 10 }, items: [['knife', 1], ['rope', 1], ['lighter', 1], ['rod', 1], ['beans', 2]], money: 20 },
  { id: 'ghost', name: 'Ghost', line: 'In and out, and nobody ever remembers your face.', attrs: { reflex: 2, wits: 1 }, skills: { stealth: 30, lockpicking: 25, athletics: 10 }, items: [['lockpicks', 1], ['flashlight', 1], ['jerky', 1]], money: 55 },
];

export interface CharacterState {
  name: string;
  background: string;
  attrs: Record<Attr, number>;
  /** 0–100 */
  skills: Record<Skill, number>;
  xp: number;
  level: number;
  perks: string[];
  /** unspent: a perk each level, an attribute point every other */
  perkPoints: number;
  attrPoints: number;
  health: number;
  /** 0–100: hunger (100 = full), rest (100 = fresh), warmth (100 = warm), stamina */
  fed: number;
  rest: number;
  warmth: number;
  stamina: number;
  money: number;
}

export const ATTR_BASE = 3;
export const ATTR_POINTS = 10;
export const ATTR_MAX_START = 8;
export const ATTR_MAX = 10;

export function newCharacter(name: string, bg: Background, attrs: Record<Attr, number>): CharacterState {
  const skills = Object.fromEntries(SKILLS.map((s) => [s.id, 5 + Math.round((attrs[s.attr] - ATTR_BASE) * 2)])) as Record<Skill, number>;
  for (const [k, v] of Object.entries(bg.skills)) skills[k as Skill] += v!;
  const c: CharacterState = {
    name, background: bg.id, attrs: { ...attrs }, skills, xp: 0, level: 1, perks: [], perkPoints: 0, attrPoints: 0,
    health: 0, fed: 70, rest: 60, warmth: 80, stamina: 100, money: bg.money,
  };
  c.health = maxHealth(c);
  return c;
}

export function maxHealth(c: CharacterState) {
  return 70 + c.attrs.stamina * 6 + c.attrs.grit * 2 + c.level * 3;
}

export function carryMax(c: CharacterState) {
  return 20 + c.attrs.grit * 4 + (c.perks.includes('packmule') ? 15 : 0);
}

/** Experience to reach the next level from this one. */
export function xpFor(level: number) {
  return Math.round(120 * Math.pow(level, 1.45));
}

/** What a skill counts for in a check: the skill, its attribute, and any perk. */
export function skillValue(c: CharacterState, s: Skill) {
  let v = c.skills[s] + c.attrs[SKILL[s].attr] * 5;
  for (const p of c.perks) v += PERK[p]?.bonus?.[s] ?? 0;
  // tired, hungry or frozen people make worse decisions
  if (c.rest < 15) v -= 10;
  if (c.fed < 10) v -= 8;
  if (c.warmth < 20) v -= 8;
  return v;
}

/** The chance of passing a check of this difficulty (shown to you before you try). */
export function chance(c: CharacterState, s: Skill, difficulty: number) {
  return Math.max(0.05, Math.min(0.95, 0.5 + (skillValue(c, s) - difficulty) / 80));
}

export function perkAvailable(c: CharacterState, p: Perk) {
  if (c.perks.includes(p.id)) return false;
  if (p.level && c.level < p.level) return false;
  for (const [a, n] of Object.entries(p.need ?? {})) if (c.attrs[a as Attr] < n!) return false;
  return true;
}
