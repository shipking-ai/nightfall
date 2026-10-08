import type { HumanSpec } from '../people/anatomy';
import { BIOMES, type BiomeId, type Good } from '../world/biomes';
import {
  ATTRS, PERK, SKILL, SKILLS, carryMax, chance, maxHealth, newCharacter, xpFor,
  type Attr, type Background, type CharacterState, type Skill,
} from './character';
import { FACTION, FACTIONS, standing, type FactionId } from './factions';
import { item, type ItemDef } from './items';

/**
 * The state of one life in the RPG: who you are, what you carry, who you've
 * met and what they think of you, what you've found, and what you're in the
 * middle of. Plain data, so it saves as it is; this class is the rules that
 * change it, and it tells the HUD when something worth a line happens.
 */

export interface Stack {
  id: string;
  n: number;
  /** one-off things: "Letter from M.", "Key to 14 Salt Lane" */
  name?: string;
  desc?: string;
  /** which case it belongs to */
  quest?: string;
}

export interface Memory {
  /** settlements you've been to */
  visited: Record<string, { first: number; n: number; name: string; x: number; z: number; kind: string; biome: string }>;
  /** people you've spoken to: how many times, and how they feel about you (−100…100) */
  met: Record<string, { n: number; disp: number; name: string; town: string; job: string; last: number; notes?: string[] }>;
  /** people who are gone for good */
  gone: string[];
  /** places searched (and on which day), so they stay searched */
  searched: Record<string, number>;
  /** doors you've been through */
  pois: Record<string, { n: number; name: string; kind: string; town: string; x: number; z: number }>;
  flags: Record<string, number | string | boolean>;
  secrets: string[];
  /** the atlas: 400 m cells you've been near ("i,j") */
  seen: Record<string, 1>;
  /** unpaid fines, by settlement */
  bounty: Record<string, number>;
}

export interface JournalLine {
  day: number;
  time: string;
  text: string;
}

export interface GameState {
  v: number;
  created: number;
  /** real seconds played */
  playtime: number;
  clock: { minutes: number; day: number };
  pos: { x: number; y: number; z: number; yaw: number };
  hero: HumanSpec;
  char: CharacterState;
  inv: Stack[];
  worn: { coat?: string; hat?: string; boots?: string };
  equipped: string | null;
  rep: Record<FactionId, number>;
  /** each town's opinion of you */
  towns: Record<string, number>;
  mem: Memory;
  quests: import('./quests').Quest[];
  track: string | null;
  journal: JournalLine[];
  stats: { walked: number; driven: number; talked: number; bought: number; sold: number; jobs: number; searched: number; days: number };
}

export const STATE_VERSION = 1;

export type Tone = 'info' | 'good' | 'bad' | 'xp' | 'item' | 'rep' | 'quest';

export interface GameEvents {
  toast(text: string, tone: Tone): void;
  levelUp(level: number): void;
  /** something was used (eaten, drunk, applied): the body shows it */
  used?(kind: string, id: string): void;
}

export function newState(name: string, bg: Background, attrs: Record<Attr, number>, hero: HumanSpec, pos: GameState['pos']): GameState {
  const char = newCharacter(name, bg, attrs);
  const rep = Object.fromEntries(FACTIONS.map((f) => [f.id, 0])) as Record<FactionId, number>;
  return {
    v: STATE_VERSION,
    created: Date.now(),
    playtime: 0,
    clock: { minutes: 5 * 60 + 29, day: 0 },
    pos,
    hero,
    char,
    inv: bg.items.map(([id, n]) => ({ id, n })),
    worn: {},
    equipped: bg.items.find(([id]) => item(id).weapon)?.[0] ?? null,
    rep,
    towns: {},
    mem: { visited: {}, met: {}, gone: [], searched: {}, pois: {}, flags: {}, secrets: [], bounty: {}, seen: {} },
    quests: [],
    track: null,
    journal: [],
    stats: { walked: 0, driven: 0, talked: 0, bought: 0, sold: 0, jobs: 0, searched: 0, days: 0 },
  };
}

const GOOD_OF: Partial<Record<string, Good>> = { water: 'water', fuel: 'fuel', fish: 'fish', hide: 'fur', meat: 'food', scrap: 'ore', parts: 'tools', repairkit: 'tools' };

export class Game {
  constructor(public s: GameState, private ev: GameEvents) {}

  get c() {
    return this.s.char;
  }

  /* ── time ─────────────────────────────────────────────── */

  get day() {
    return this.s.clock.day;
  }

  clockLabel() {
    const m = Math.floor(this.s.clock.minutes);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  note(text: string) {
    this.s.journal.push({ day: this.day, time: this.clockLabel(), text });
    if (this.s.journal.length > 160) this.s.journal.splice(0, this.s.journal.length - 160);
  }

  /* ── what you carry ───────────────────────────────────── */

  count(id: string) {
    let n = 0;
    for (const st of this.s.inv) if (st.id === id) n += st.n;
    return n;
  }

  weight() {
    let w = 0;
    for (const st of this.s.inv) w += item(st.id).w * st.n;
    return w;
  }

  get carry() {
    return carryMax(this.c);
  }

  give(id: string, n = 1, one?: { name?: string; desc?: string; quest?: string }, quiet = false) {
    const d = item(id);
    if (one || d.quest) this.s.inv.push({ id, n, ...one });
    else {
      const st = this.s.inv.find((x) => x.id === id && !x.name);
      if (st) st.n += n;
      else this.s.inv.push({ id, n });
    }
    if (!quiet) this.ev.toast(`${one?.name ?? d.name}${n > 1 ? ` ×${n}` : ''}`, 'item');
  }

  /** Take n of something (or one particular stack); false if you haven't got it. */
  take(id: string, n = 1, quest?: string): boolean {
    if (this.count(id) < n) return false;
    for (let i = this.s.inv.length - 1; i >= 0 && n > 0; i--) {
      const st = this.s.inv[i];
      if (st.id !== id || (quest && st.quest !== quest)) continue;
      const k = Math.min(n, st.n);
      st.n -= k;
      n -= k;
      if (st.n <= 0) this.s.inv.splice(i, 1);
    }
    if (this.s.equipped === id && !this.count(id)) this.s.equipped = null;
    for (const slot of ['coat', 'hat', 'boots'] as const) if (this.s.worn[slot] === id && !this.count(id)) delete this.s.worn[slot];
    return n <= 0;
  }

  hasQuestItem(quest: string) {
    return this.s.inv.some((st) => st.quest === quest);
  }

  /** Eat it, drink it, wear it, hold it. Returns what happened, for the list. */
  use(st: Stack): string {
    const d = item(st.id);
    const c = this.c;
    if (d.wear) {
      const slot = d.wear.slot;
      if (this.s.worn[slot] === d.id) {
        delete this.s.worn[slot];
        return `Took off the ${d.name.toLowerCase()}.`;
      }
      this.s.worn[slot] = d.id;
      return `Put on the ${d.name.toLowerCase()}.`;
    }
    if (d.weapon) {
      this.s.equipped = this.s.equipped === d.id ? null : d.id;
      return this.s.equipped ? `${d.name} in hand.` : `Put the ${d.name.toLowerCase()} away.`;
    }
    if (!d.use) return d.desc;
    const u = d.use;
    this.ev.used?.(d.kind, d.id);
    const raw = (d.id === 'fish' || d.id === 'meat') && !c.perks.includes('ironstomach');
    const heal = (u.heal ?? 0) * (c.perks.includes('medic') && d.kind === 'medical' ? 1.5 : 1) * (1 + c.skills.medicine / 200);
    c.fed = clamp(c.fed + (u.fed ?? 0) * (raw ? 1 : d.id === 'fish' || d.id === 'meat' ? 3 : 1));
    c.rest = clamp(c.rest + (u.rest ?? 0));
    c.warmth = clamp(c.warmth + (u.warmth ?? 0));
    c.stamina = clamp(c.stamina + (u.stamina ?? 0));
    c.health = Math.min(maxHealth(c), c.health + heal);
    if (d.kind === 'medical') this.practice('medicine', 1.5);
    this.take(st.id, 1);
    if (raw && Math.random() < 0.3) {
      c.health = Math.max(1, c.health - 8);
      return `${u.label ?? 'Used'}: ${d.name.toLowerCase()}. Your stomach disagrees.`;
    }
    return `${u.label ?? 'Used'}: ${d.name.toLowerCase()}.`;
  }

  /** How warm your clothes keep you (0 bare … 1+ well wrapped) and how dry. */
  clothing() {
    let warm = 0.25, dry = 0.2; // the coat you're wearing anyway
    for (const id of Object.values(this.s.worn)) {
      const w = id ? item(id).wear : undefined;
      if (w) {
        warm += w.warm ?? 0;
        dry += w.dry ?? 0;
      }
    }
    return { warm, dry: Math.min(1, dry) };
  }

  /* ── getting better ───────────────────────────────────── */

  xp(n: number, why?: string) {
    const c = this.c;
    n = Math.round(n);
    c.xp += n;
    this.ev.toast(`+${n} XP${why ? ` · ${why}` : ''}`, 'xp');
    while (c.xp >= xpFor(c.level)) {
      c.xp -= xpFor(c.level);
      c.level++;
      c.perkPoints++;
      if (c.level % 2 === 0) c.attrPoints++;
      c.health = maxHealth(c);
      this.note(`Reached level ${c.level}.`);
      this.ev.levelUp(c.level);
    }
  }

  /** Skills grow by use, slower the better you are. */
  practice(s: Skill, amount: number) {
    const c = this.c;
    const before = Math.floor(c.skills[s]);
    const k = (c.perks.includes('everyman') ? 1.1 : 1) * (1 - c.skills[s] / 115);
    c.skills[s] = Math.min(100, c.skills[s] + amount * k * 0.6);
    const after = Math.floor(c.skills[s]);
    if (after > before && after % 5 === 0) this.ev.toast(`${SKILL[s].name} ${after}`, 'xp');
  }

  /** Try something: returns whether it worked. Trying teaches you something either way. */
  check(s: Skill, difficulty: number): boolean {
    const p = chance(this.c, s, difficulty);
    const ok = Math.random() < p;
    this.practice(s, ok ? 2 + difficulty / 25 : 1);
    return ok;
  }

  chance(s: Skill, difficulty: number) {
    return chance(this.c, s, difficulty);
  }

  takePerk(id: string) {
    const c = this.c;
    if (c.perkPoints <= 0 || c.perks.includes(id)) return false;
    c.perks.push(id);
    c.perkPoints--;
    this.note(`Learned ${PERK[id]?.name ?? id}.`);
    return true;
  }

  raise(a: Attr) {
    const c = this.c;
    if (c.attrPoints <= 0 || c.attrs[a] >= 10) return false;
    c.attrs[a]++;
    c.attrPoints--;
    c.health = Math.min(maxHealth(c), c.health + 6);
    this.note(`${ATTRS.find((x) => x.id === a)!.name} rose to ${c.attrs[a]}.`);
    return true;
  }

  /* ── money ────────────────────────────────────────────── */

  pay(n: number): boolean {
    if (this.c.money < n) return false;
    this.c.money -= n;
    return true;
  }

  earn(n: number, why?: string) {
    this.c.money += Math.round(n);
    this.ev.toast(`+$${Math.round(n)}${why ? ` · ${why}` : ''}`, 'good');
  }

  /** What a shop asks for something here (buying), or offers (selling). */
  price(id: string, biome: BiomeId, selling: boolean, townRep = 0) {
    const d: ItemDef = item(id);
    const good: Good | undefined = GOOD_OF[id] ?? (d.kind === 'food' || d.kind === 'drink' ? 'food' : d.kind === 'medical' ? 'medicine' : d.kind === 'ammo' ? 'ammo' : d.kind === 'clothing' ? 'clothing' : d.kind === 'tool' ? 'tools' : undefined);
    const region = good ? BIOMES[biome].prices[good] ?? 1 : 1;
    const barter = this.c.skills.barter + this.c.attrs.charm * 4 + (this.c.perks.includes('haggler') ? 12 : 0) + townRep * 0.15;
    const k = selling ? 0.35 + Math.min(0.35, barter / 260) : 1.25 - Math.min(0.35, barter / 260);
    return Math.max(selling ? 0 : 1, Math.round(d.v * region * k));
  }

  /* ── standing ─────────────────────────────────────────── */

  rep(f: FactionId, delta: number, quiet = false) {
    if (!delta) return;
    const k = delta > 0 && this.c.perks.includes('localhero') ? 1.25 : 1;
    const before = standing(this.s.rep[f]);
    this.s.rep[f] = clamp(this.s.rep[f] + delta * k, -100, 100);
    for (const [r, frac] of Object.entries(FACTION[f].rivals)) this.s.rep[r as FactionId] = clamp(this.s.rep[r as FactionId] - delta * frac!, -100, 100);
    const after = standing(this.s.rep[f]);
    if (!quiet) this.ev.toast(`${FACTION[f].short} ${delta > 0 ? '▲' : '▼'}${after !== before ? ` · ${after}` : ''}`, 'rep');
  }

  townRep(town: string, delta: number) {
    const k = delta > 0 && this.c.perks.includes('localhero') ? 1.25 : 1;
    this.s.towns[town] = clamp((this.s.towns[town] ?? 0) + delta * k, -100, 100);
  }

  /* ── memory ───────────────────────────────────────────── */

  visit(s: { id: string; name: string; x: number; z: number; kind: string; biome: string }): boolean {
    const v = this.s.mem.visited[s.id];
    if (v) {
      v.n++;
      return false;
    }
    this.s.mem.visited[s.id] = { first: this.day, n: 1, name: s.name, x: s.x, z: s.z, kind: s.kind, biome: s.biome };
    this.note(`Arrived in ${s.name} for the first time.`);
    this.xp(s.kind === 'city' ? 60 : s.kind === 'town' ? 35 : 20, `found ${s.name}`);
    return true;
  }

  meet(r: { id: string; name: string; town: { id: string }; job: string; friendly: number }) {
    let m = this.s.mem.met[r.id];
    if (!m) m = this.s.mem.met[r.id] = { n: 0, disp: Math.round((r.friendly - 0.5) * 30 + (this.s.towns[r.town.id] ?? 0) * 0.3), name: r.name, town: r.town.id, job: r.job, last: this.day };
    m.n++;
    m.last = this.day;
    this.s.stats.talked++;
    return m;
  }

  feel(id: string, delta: number) {
    const m = this.s.mem.met[id];
    if (m) m.disp = clamp(m.disp + delta, -100, 100);
  }

  /* ── the body ─────────────────────────────────────────── */

  /**
   * Game minutes pass: you get hungry and tired, warm or cold with the
   * weather and what you're wearing; health comes back slowly if you're
   * looked after.
   */
  tick(minutes: number, ctx: { temp: number; rain: number; wind: number; sheltered: boolean; exertion: number; night: boolean }) {
    const c = this.c;
    const per = minutes / 60;
    c.fed = clamp(c.fed - per * (2.4 + ctx.exertion * 2));
    c.rest = clamp(c.rest - per * (2.2 + ctx.exertion) * (c.perks.includes('nightowl') ? 0.75 : 1) * (1 - c.attrs.stamina * 0.03));
    // how warm you'd settle at: the air, the wind, the wet, and your clothes
    const cl = this.clothing();
    const outdoor = ctx.sheltered ? 18 : ctx.temp - ctx.wind * 0.6 - ctx.rain * 8 * (1 - cl.dry);
    const target = clamp(55 + (outdoor - 8) * 3 + cl.warm * 45 + (c.perks.includes('outdoorsman') ? 10 : 0));
    c.warmth += (target - c.warmth) * Math.min(1, per * 0.9);
    // hurting: freezing, starving; mending: fed, rested, warm
    const hp = maxHealth(c);
    if (c.warmth < 12) c.health -= per * 6;
    if (c.fed < 3) c.health -= per * 3;
    if (c.fed > 30 && c.rest > 20 && c.warmth > 30) c.health = Math.min(hp, c.health + per * (2 + c.attrs.stamina * 0.4));
    c.health = Math.max(1, Math.min(hp, c.health));
  }

  /** A night (or an afternoon) in a bed. */
  sleep(hours: number) {
    const c = this.c;
    c.rest = clamp(c.rest + hours * 13);
    c.health = Math.min(maxHealth(c), c.health + hours * 6);
    c.fed = clamp(c.fed - hours * 1.5);
    c.warmth = Math.max(c.warmth, 70);
  }

  statusLine(): string[] {
    const c = this.c;
    const out: string[] = [];
    if (c.fed < 20) out.push(c.fed < 8 ? 'Starving' : 'Hungry');
    if (c.rest < 20) out.push(c.rest < 8 ? 'Exhausted' : 'Tired');
    if (c.warmth < 30) out.push(c.warmth < 12 ? 'Freezing' : 'Cold');
    if (c.warmth > 92) out.push('Hot');
    if (c.health < maxHealth(c) * 0.3) out.push('Hurt');
    return out;
  }
}

export function clamp(v: number, a = 0, b = 100) {
  return v < a ? a : v > b ? b : v;
}

export { SKILLS, ATTRS };
