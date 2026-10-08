import { readJSON, writeJSON } from '../../core/storage';
import { WEAPONS } from './arsenal';
import { ATTACHMENTS } from './attachments';
import type { ModeId } from './modes';

/**
 * Your Warzone career: experience and levels earned by playing (never
 * bought), what each level opens up, your numbers, and challenges. All of it
 * lives in this browser.
 */

export interface Stats {
  matches: number;
  wins: number;
  kills: number;
  deaths: number;
  heads: number;
  caps: number;
  /** kills per weapon id */
  byGun: Record<string, number>;
  /** matches played per mode */
  byMode: Partial<Record<ModeId, number>>;
  bestStreak: number;
}

export interface Challenge {
  id: string;
  name: string;
  goal: number;
  xp: number;
  /** read the progress off the stats */
  of(s: Stats): number;
}

const kills = (cls: string[]) => (s: Stats) => WEAPONS.filter((w) => cls.includes(w.cls)).reduce((n, w) => n + (s.byGun[w.id] ?? 0), 0);

export const CHALLENGES: Challenge[] = [
  { id: 'first', name: 'First blood: 10 kills', goal: 10, xp: 500, of: (s) => s.kills },
  { id: 'hundred', name: 'A hundred down', goal: 100, xp: 3000, of: (s) => s.kills },
  { id: 'heads', name: '25 headshots', goal: 25, xp: 1500, of: (s) => s.heads },
  { id: 'rifles', name: '50 kills with assault or battle rifles', goal: 50, xp: 1500, of: kills(['ar', 'br']) },
  { id: 'close', name: '50 kills with SMGs or shotguns', goal: 50, xp: 1500, of: kills(['smg', 'pdw', 'shotgun']) },
  { id: 'long', name: '25 kills with sniper or marksman rifles', goal: 25, xp: 1500, of: kills(['sniper', 'dmr']) },
  { id: 'side', name: '20 kills with a sidearm', goal: 20, xp: 1000, of: kills(['pistol', 'revolver']) },
  { id: 'blade', name: '10 kills with a blade', goal: 10, xp: 1000, of: kills(['melee']) },
  { id: 'caps', name: '20 objectives (points, flags, tags)', goal: 20, xp: 1500, of: (s) => s.caps },
  { id: 'wins', name: 'Win 10 matches', goal: 10, xp: 3000, of: (s) => s.wins },
  { id: 'streak', name: 'Seven kills in one life', goal: 7, xp: 2000, of: (s) => s.bestStreak },
  { id: 'tour', name: 'Play every mode', goal: 8, xp: 2000, of: (s) => Object.keys(s.byMode).filter((m) => m !== 'range').length },
];

export const MAX_LEVEL = 40;
/** Experience needed to reach a level (level 1 is free). */
export const xpFor = (lv: number) => Math.round(800 * Math.pow(lv - 1, 1.35));

interface Saved {
  xp: number;
  stats: Stats;
  done: string[];
}

const KEY = 'nightfall.warzone.career.v1';
const blank = (): Saved => ({ xp: 0, stats: { matches: 0, wins: 0, kills: 0, deaths: 0, heads: 0, caps: 0, byGun: {}, byMode: {}, bestStreak: 0 }, done: [] });

export class Career {
  data: Saved;
  /** told about levels and challenges as they happen */
  onEvent?: (text: string) => void;

  constructor() {
    const s = readJSON<Saved>(KEY);
    this.data = s && s.stats ? { ...blank(), ...s, stats: { ...blank().stats, ...s.stats } } : blank();
  }

  get level() {
    let lv = 1;
    while (lv < MAX_LEVEL && this.data.xp >= xpFor(lv + 1)) lv++;
    return lv;
  }

  /** 0..1 of the way to the next level */
  get progress() {
    const lv = this.level;
    if (lv >= MAX_LEVEL) return 1;
    const a = xpFor(lv), b = xpFor(lv + 1);
    return (this.data.xp - a) / (b - a);
  }

  /** What opens at a level. */
  unlocksAt(lv: number) {
    return [...WEAPONS.filter((w) => w.level === lv).map((w) => w.name), ...ATTACHMENTS.filter((a) => a.level === lv).map((a) => a.name)];
  }

  xp(n: number) {
    const before = this.level;
    this.data.xp += n;
    const after = this.level;
    if (after > before) {
      const opens = this.unlocksAt(after);
      this.onEvent?.(`Level ${after}${opens.length ? ` · ${opens.slice(0, 3).join(', ')}${opens.length > 3 ? '…' : ''}` : ''}`);
    }
  }

  kill(gun: string, head: boolean, life: number) {
    const s = this.data.stats;
    s.kills++;
    if (head) s.heads++;
    s.byGun[gun] = (s.byGun[gun] ?? 0) + 1;
    s.bestStreak = Math.max(s.bestStreak, life);
    this.xp(100 + (head ? 50 : 0));
    this.check();
  }

  death() {
    this.data.stats.deaths++;
  }

  objective() {
    this.data.stats.caps++;
    this.xp(200);
    this.check();
  }

  match(mode: ModeId, won: boolean) {
    const s = this.data.stats;
    s.matches++;
    if (won) s.wins++;
    s.byMode[mode] = (s.byMode[mode] ?? 0) + 1;
    this.xp(won ? 1500 : 600);
    this.check();
    this.save();
  }

  private check() {
    for (const c of CHALLENGES) {
      if (this.data.done.includes(c.id) || c.of(this.data.stats) < c.goal) continue;
      this.data.done.push(c.id);
      this.onEvent?.(`Challenge: ${c.name} · +${c.xp} XP`);
      this.xp(c.xp);
    }
  }

  save() {
    writeJSON(KEY, this.data);
  }
}
