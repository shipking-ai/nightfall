import { mulberry32 } from '../../world/rng';
import { hash3, hashStr } from '../world/noise';
import type { Settlement, WorldGen } from '../world/WorldGen';
import type { Poi, PoiKind, Towns } from '../world/Towns';
import type { Resident } from '../sim/Populace';
import type { FactionId } from './factions';
import { item } from './items';
import type { Game } from './Game';

/**
 * Jobs and the story. People in every town have things that need doing, made
 * from who they are, where they live and what the land is like; each can be
 * done more than one way (talk, lean on someone, pay, sneak, or find a third
 * way), and the way you do it is remembered. The main story is the same
 * machinery with a script: a letter in your coat on the morning the night
 * finally ended.
 */

export type QuestKind = 'main' | 'delivery' | 'debt' | 'missing' | 'fetch' | 'case' | 'courier';

export interface Objective {
  text: string;
  done: boolean;
  /** where it happens (the compass and the map point here) */
  at?: { x: number; z: number; r: number; label: string };
  /** the person it's about (resident id) */
  who?: string;
  /** a door it's about (poi id) */
  poi?: string;
  /** a place to search (inside `at`) */
  search?: boolean;
  /** only after dark */
  night?: boolean;
}

export interface Quest {
  id: string;
  kind: QuestKind;
  title: string;
  summary: string;
  giver?: { id: string; name: string; town: string; townName: string };
  objectives: Objective[];
  reward: { money: number; xp: number; rep?: Partial<Record<FactionId, number>>; town?: number };
  state: 'active' | 'done' | 'failed';
  day: number;
  due?: number;
  data: Record<string, string | number | boolean>;
  log: string[];
}

export interface QuestWorld {
  gen: WorldGen;
  towns: Towns;
  residents(s: Settlement): Resident[];
}

/** An offer someone might make you (not yet taken). */
export interface Offer {
  quest: Quest;
  pitch: string[];
}

const CELL_RING = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];

/** A lived-in settlement near this one (for errands out of town). */
function neighbour(w: QuestWorld, s: Settlement, salt: number, kinds = ['town', 'city', 'village']): Settlement | null {
  const r = mulberry32(hash3(s.ci, s.cj, salt));
  const ring = CELL_RING.slice().sort(() => r.next() - 0.5);
  for (const [di, dj] of ring) {
    const n = w.gen.settlement(s.ci + di, s.cj + dj);
    if (kinds.includes(n.kind) && !n.home) return n;
  }
  for (const [di, dj] of ring) {
    const n = w.gen.settlement(s.ci + di * 2, s.cj + dj * 2);
    if (kinds.includes(n.kind)) return n;
  }
  return null;
}

/** Somewhere out of town to lose something in: a ruin nearby if there is one, else the edge of the woods. */
function lonelySpot(w: QuestWorld, s: Settlement, salt: number): { x: number; z: number; label: string } {
  const ruin = neighbour(w, s, salt, ['ruin']);
  if (ruin && Math.hypot(ruin.x - s.x, ruin.z - s.z) < 5200) return { x: ruin.x, z: ruin.z, label: `the ruins at ${ruin.name}` };
  const r = mulberry32(hash3(s.ci, s.cj, salt + 7));
  for (let k = 0; k < 24; k++) {
    const a = r.range(0, Math.PI * 2), d = s.radius + r.range(250, 700);
    const x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d;
    const g = w.gen.ground(x, z);
    if (g.water === null && g.h > 0 && g.road < 0.2 && g.urban < 0.1) {
      const what = g.forest > 0.4 ? 'the woods' : g.biome === 'desert' ? 'the dunes' : g.biome === 'swamp' ? 'the marsh' : g.biome === 'alpine' || g.biome === 'tundra' ? 'the snowfield' : 'the fields';
      const dir = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? (Math.cos(a) > 0 ? 'east' : 'west') : Math.sin(a) > 0 ? 'south' : 'north';
      return { x, z, label: `${what} ${dir} of ${s.name}` };
    }
  }
  return { x: s.x + s.radius + 300, z: s.z, label: `the edge of ${s.name}` };
}

function poiIn(w: QuestWorld, s: Settlement, kind: PoiKind): Poi | null {
  return w.towns.plan(s).pois.find((p) => p.kind === kind) ?? null;
}

const THINGS = [
  ['his late father’s watch', 'watch'], ['her mother’s ring', 'ring'], ['a tin of letters', 'letters'], ['the dog’s collar (and hopefully the dog)', 'collar'],
  ['a camera with the only photos of the wedding', 'camera'], ['a service medal', 'medal'], ['a sketchbook', 'sketchbook'], ['the deed to the house', 'deed'],
];

const FETCH_BY_BIOME: Record<string, string[]> = {
  coast: ['fish'], ocean: ['fish'], forest: ['hide', 'herbs', 'meat'], boreal: ['hide', 'meat'], tundra: ['hide', 'meat'], alpine: ['herbs', 'scrap'],
  desert: ['scrap', 'parts'], scrub: ['meat', 'scrap'], swamp: ['herbs', 'fish'], temperate: ['herbs', 'parts', 'scrap'],
};

/**
 * Does this person have work for you today? The same answer all day (the
 * offer's made from who they are and the date), a new chance every two days.
 */
export function offerFrom(w: QuestWorld, g: Game, r: Resident): Offer | null {
  const day = Math.floor(g.day / 2);
  const rnd = mulberry32(hash3(hashStr(r.id), day, 91));
  if (g.s.quests.some((q) => q.giver?.id === r.id && q.state === 'active')) return null;
  if (g.s.mem.flags[`offer:${r.id}:${day}`]) return null;
  const willing = r.friendly * 0.6 + ((g.s.mem.met[r.id]?.disp ?? 0) + 30) / 150;
  if (rnd.next() > 0.3 + willing * 0.35) return null;
  const s = r.town;
  const kinds: QuestKind[] = ['missing', 'debt', 'delivery', 'fetch'];
  if (r.job === 'shopkeeper' || r.job === 'bartender' || r.job === 'nurse' || r.job === 'mechanic') kinds.push('fetch', 'fetch');
  if (r.job === 'driver' || r.job === 'office' || r.job === 'worker') kinds.push('delivery');
  if (r.job === 'rich') kinds.push('debt', 'missing');
  const kind = rnd.pick(kinds);
  const id = `q:${r.id}:${day}`;
  const giver = { id: r.id, name: r.name, town: s.id, townName: s.name };
  const first = r.name.split(' ')[0];
  const base = { id, kind, giver, state: 'active' as const, day: g.day, data: {} as Quest['data'], log: [] as string[] };
  if (kind === 'missing') {
    const [thing, tag] = rnd.pick(THINGS);
    const spot = lonelySpot(w, s, hashStr(id) & 0xffff);
    const pay = 40 + Math.round(rnd.range(0, 50));
    return {
      pitch: [`I lost ${thing}. Out at ${spot.label}.`, 'I went back and looked. It’s getting dark earlier. I can’t go back out there.', `Find it and there’s $${pay} in it for you.`],
      quest: {
        ...base, title: `${first}’s ${tag}`, summary: `${r.name} of ${s.name} lost ${thing} out at ${spot.label}.`,
        objectives: [
          { text: `Search ${spot.label}`, done: false, at: { x: spot.x, z: spot.z, r: 45, label: spot.label }, search: true },
          { text: `Give it back to ${r.name} in ${s.name}`, done: false, who: r.id, at: { x: s.x, z: s.z, r: s.radius, label: s.name } },
        ],
        reward: { money: pay, xp: 70, town: 6 },
        data: { thing, tag },
      },
    };
  }
  if (kind === 'debt') {
    const people = w.residents(s).filter((o) => o.id !== r.id && o.job !== 'police');
    const debtor = rnd.pick(people);
    const owed = 60 + Math.round(rnd.range(0, 140) / 10) * 10;
    return {
      pitch: [`${debtor.name} owes me $${owed}. Has since spring.`, 'Every time I ask there’s a story.', 'Get it back and keep a third. How you get it is your business.'],
      quest: {
        ...base, title: `What ${debtor.name.split(' ')[0]} owes`, summary: `${debtor.name} owes ${r.name} $${owed}.`,
        objectives: [
          { text: `Get $${owed} out of ${debtor.name} (${s.name})`, done: false, who: debtor.id, at: { x: s.x, z: s.z, r: s.radius, label: s.name } },
          { text: `Bring the money to ${r.name}`, done: false, who: r.id, at: { x: s.x, z: s.z, r: s.radius, label: s.name } },
        ],
        reward: { money: Math.round(owed / 3), xp: 60, town: 2 },
        data: { debtor: debtor.id, debtorName: debtor.name, owed },
      },
    };
  }
  if (kind === 'delivery') {
    const to = neighbour(w, s, hashStr(id) & 0xffff) ?? s;
    const people = w.residents(to);
    const who = people[Math.floor(rnd.next() * people.length)];
    const pay = 30 + Math.round(Math.hypot(to.x - s.x, to.z - s.z) / 100);
    const contents = rnd.pick(['letters', 'money', 'contraband', 'contraband', 'medicine', 'photographs']);
    return {
      pitch: [`Take this to ${who.name} in ${to.name}.`, contents === 'contraband' ? 'Don’t open it. Don’t ask. Don’t get stopped.' : 'Hand to hand, not left on a step.', `$${pay} when it’s there.`],
      quest: {
        ...base, title: `A parcel for ${to.name}`, summary: `${r.name} asked you to take a parcel to ${who.name} in ${to.name}.`,
        objectives: [{ text: `Give the parcel to ${who.name} in ${to.name}`, done: false, who: who.id, at: { x: to.x, z: to.z, r: to.radius, label: to.name } }],
        reward: { money: pay, xp: 55, rep: contents === 'contraband' ? { syndicate: 6 } : { union: 3 }, town: 3 },
        data: { to: to.id, toName: to.name, who: who.id, whoName: who.name, contents, opened: false },
      },
    };
  }
  // fetch
  const want = rnd.pick(FETCH_BY_BIOME[s.biome] ?? FETCH_BY_BIOME.temperate);
  const n = want === 'hide' || want === 'parts' ? 2 : want === 'meat' ? 2 : 4;
  const pay = Math.round(item(want).v * n * 1.7);
  return {
    pitch: [`I need ${n} × ${item(want).name.toLowerCase()}. Nobody around here has the time.`, `$${pay} for the lot.`],
    quest: {
      ...base, title: `${n} × ${item(want).name.toLowerCase()}`, summary: `${r.name} in ${s.name} wants ${n} × ${item(want).name.toLowerCase()}.`,
      objectives: [{ text: `Bring ${n} × ${item(want).name.toLowerCase()} to ${r.name}`, done: false, who: r.id, at: { x: s.x, z: s.z, r: s.radius, label: s.name } }],
      reward: { money: pay, xp: 45, town: 3 },
      data: { want, n },
    },
  };
}

/* ── the main story ──────────────────────────────────────── */

export const MAIN_ID = 'main:long-night';

/** The places the story runs through, fixed from the world's seed. */
export function mainPlaces(w: QuestWorld) {
  const home = w.gen.settlement(0, 0);
  const ring: Settlement[] = [];
  for (let r = 1; r <= 3; r++) for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) if (Math.max(Math.abs(i), Math.abs(j)) === r) ring.push(w.gen.settlement(i, j));
  const d = (s: Settlement) => Math.hypot(s.x - home.x, s.z - home.z);
  const byD = ring.slice().sort((a, b) => d(a) - d(b));
  const first = byD.find((s) => s.kind === 'town') ?? byD.find((s) => s.kind === 'city' || s.kind === 'village')!;
  const ruin = neighbour(w, first, 404, ['ruin']);
  const city = byD.find((s) => s.kind === 'city' && s.id !== first.id) ?? home;
  const cold = byD.find((s) => (s.kind === 'town' || s.kind === 'village' || s.kind === 'city') && (s.biome === 'boreal' || s.biome === 'tundra' || s.biome === 'alpine') && w.towns.plan(s).pois.some((p) => p.kind === 'church'))
    ?? byD.find((s) => s.id !== first.id && w.towns.plan(s).pois.some((p) => p.kind === 'church'))!;
  return { home, first, ruin, city, cold };
}

export function startMain(w: QuestWorld, g: Game) {
  const P = mainPlaces(w);
  g.give('letter', 1, { name: 'Letter signed M.', desc: `“If you’re reading this, the night finally ended. Come to ${P.first.name}. Ask for the ferryman. Don’t trust the Families. — M.”`, quest: MAIN_ID }, true);
  const q: Quest = {
    id: MAIN_ID, kind: 'main', title: 'The Long Night', state: 'active', day: g.day, data: { stage: 0 }, log: [],
    summary: 'The night that never ended in District 03 is over. There was a letter in your coat that you don’t remember putting there.',
    objectives: [{ text: `Go to ${P.first.name}`, done: false, at: { x: P.first.x, z: P.first.z, r: P.first.radius, label: P.first.name } }],
    reward: { money: 0, xp: 0 },
  };
  g.s.quests.unshift(q);
  g.s.track = MAIN_ID;
  g.note('Found a letter in my coat, signed M.');
}

/** Someone in town who'd know the ferryman: a talker (behind a counter, on the beat), not the ferryman themself. */
export function informant(w: QuestWorld, town: Settlement) {
  const people = w.residents(town);
  const ferry = people.find((p) => p.job === 'driver') ?? people.find((p) => p.job === 'retired') ?? people[0];
  const good = ['bartender', 'shopkeeper', 'police', 'mechanic', 'nurse', 'teacher'];
  return people.find((p) => p.id !== ferry?.id && good.includes(p.job)) ?? people.find((p) => p.id !== ferry?.id && p.job !== 'drifter') ?? null;
}

/** Move the story on a stage: new objectives, a line in the journal. */
export function advanceMain(w: QuestWorld, g: Game, q: Quest, stage: number, extra: Record<string, string | number> = {}) {
  const P = mainPlaces(w);
  for (const o of q.objectives) o.done = true;
  q.data = { ...q.data, ...extra, stage };
  const at = (s: Settlement) => ({ x: s.x, z: s.z, r: s.radius, label: s.name });
  if (stage === 1) {
    const who = informant(w, P.first);
    if (who) q.data = { ...q.data, informant: who.id, informantName: who.name };
    q.objectives.push(who
      ? { text: `Ask ${who.name} about “the ferryman”`, done: false, who: who.id, at: at(P.first) }
      : { text: `Ask around ${P.first.name} for “the ferryman”`, done: false, at: at(P.first) });
    g.note(`${P.first.name}. Now to find whoever “the ferryman” is.${who ? ` ${who.name} might know.` : ''}`);
  } else if (stage === 2) {
    q.objectives.push({ text: `Talk to ${q.data.ferryName}`, done: false, who: String(q.data.ferry), at: at(P.first) });
  } else if (stage === 3) {
    const spot = P.ruin && Math.hypot(P.ruin.x - P.first.x, P.ruin.z - P.first.z) < 6000 ? { x: P.ruin.x, z: P.ruin.z, label: `the ruins at ${P.ruin.name}` } : lonelySpot(w, P.first, 404);
    q.objectives.push({ text: `Search ${spot.label}, after dark`, done: false, at: { x: spot.x, z: spot.z, r: 50, label: spot.label }, search: true, night: true });
    g.note(`The ferryman says M. left something at ${spot.label}. Only after dark, apparently.`);
  } else if (stage === 4) {
    const bank = poiIn(w, P.city, 'bank') ?? poiIn(w, P.city, 'office');
    q.data.bank = bank?.id ?? '';
    q.data.bankName = bank?.name ?? P.city.name;
    q.objectives.push({ text: `Find out about the photograph at ${bank?.name ?? 'the bank'}, ${P.city.name}`, done: false, poi: bank?.id, at: bank ? { x: bank.x, z: bank.z, r: 6, label: bank.name } : at(P.city) });
    g.note(`A photograph of me outside ${bank?.name ?? 'a bank'} in ${P.city.name}. The date on the back is forty years ago. I haven’t aged a day.`);
  } else if (stage === 5) {
    const church = poiIn(w, P.cold, 'church')!;
    q.data.church = church.id;
    q.objectives.push({ text: `Go to ${church.name}, ${P.cold.name}, between 23:00 and 03:00`, done: false, poi: church.id, night: true, at: { x: church.x, z: church.z, r: 6, label: church.name } });
    g.note(`Box 314 held one thing: a card from ${church.name} in ${P.cold.name}. “We meet when the night is deepest.”`);
  } else if (stage === 6) {
    q.state = 'done';
    g.note('Chapter one of the long night is closed. Whatever kept District 03 dark is still out here.');
  }
  g.s.track = MAIN_ID;
}

/** Take a job: it goes in the casefile, the giver's things go in your pockets. */
export function accept(g: Game, o: Offer) {
  const q = o.quest;
  g.s.quests.push(q);
  g.s.track = q.id;
  if (q.giver) g.s.mem.flags[`offer:${q.giver.id}:${Math.floor(g.day / 2)}`] = true;
  if (q.kind === 'delivery') g.give('parcel', 1, { name: `Parcel for ${q.data.whoName}`, desc: `Brown paper and string. “${q.data.whoName}, ${q.data.toName}.”`, quest: q.id });
  g.note(`Took a job from ${q.giver?.name ?? 'someone'}: ${q.title}.`);
}

/** Done: paid, remembered, and the next thing tracked. */
export function complete(g: Game, q: Quest, how: string, cut = 1) {
  q.state = 'done';
  for (const o of q.objectives) o.done = true;
  q.log.push(how);
  const fixer = g.c.perks.includes('fixer') ? 1.2 : 1;
  if (q.reward.money) g.earn(q.reward.money * cut * fixer, q.title);
  if (q.reward.xp) g.xp(q.reward.xp, 'job done');
  for (const [f, v] of Object.entries(q.reward.rep ?? {})) g.rep(f as FactionId, v!);
  if (q.giver && q.reward.town) g.townRep(q.giver.town, q.reward.town);
  if (q.giver) g.feel(q.giver.id, 15);
  g.s.stats.jobs++;
  g.note(`${q.title}: ${how}`);
  if (g.s.track === q.id) g.s.track = g.s.quests.find((x) => x.state === 'active')?.id ?? null;
}

export function fail(g: Game, q: Quest, why: string) {
  q.state = 'failed';
  q.log.push(why);
  if (q.giver) g.feel(q.giver.id, -20);
  g.note(`${q.title}: ${why}`);
  if (g.s.track === q.id) g.s.track = g.s.quests.find((x) => x.state === 'active')?.id ?? null;
}

/** The objective the compass should point at for a job. */
export function current(q: Quest): Objective | null {
  return q.objectives.find((o) => !o.done) ?? null;
}
