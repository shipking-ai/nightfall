import { STATE_VERSION, type GameState } from './Game';

/**
 * Save slots for the RPG: an autosave and three by hand. Each is a versioned
 * envelope (schema version, when, where, a one-line label) so an older save
 * is brought up to date by the migrations below rather than thrown away, and
 * a damaged one is refused without taking the others with it.
 *
 * Storage is the browser's (per device). The platform layer (R5) swaps this
 * for a console's save-data API without the game noticing: everything goes
 * through `SaveStore`.
 */

export type SlotId = 'auto' | '1' | '2' | '3';
export const SLOTS: SlotId[] = ['auto', '1', '2', '3'];

export interface SaveEnvelope {
  v: number;
  at: number;
  label: string;
  place: string;
  level: number;
  playtime: number;
  state: GameState;
}

export interface SaveStore {
  read(key: string): string | null;
  write(key: string, value: string): boolean;
  remove(key: string): void;
}

export const browserStore: SaveStore = {
  read(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* private window: nothing to remove */
    }
  },
};

const KEY = (slot: SlotId) => `nightfall.rpg.save.${slot}`;

/** Version n → n+1. Add one each time GameState changes shape. */
const MIGRATIONS: Record<number, (s: Record<string, unknown>) => Record<string, unknown>> = {
  // 1 → 2 goes here when it's needed
};

export function migrate(state: Record<string, unknown>, from: number): GameState | null {
  let s = state;
  for (let v = from; v < STATE_VERSION; v++) {
    const m = MIGRATIONS[v];
    if (!m) return null;
    s = m(s);
    s.v = v + 1;
  }
  return s as unknown as GameState;
}

export class Saves {
  constructor(private store: SaveStore = browserStore) {}

  write(slot: SlotId, state: GameState, place: string): boolean {
    const env: SaveEnvelope = {
      v: STATE_VERSION,
      at: Date.now(),
      label: `${state.char.name} · level ${state.char.level}`,
      place,
      level: state.char.level,
      playtime: state.playtime,
      state,
    };
    return this.store.write(KEY(slot), JSON.stringify(env));
  }

  /** The envelope only (for the slot list), or null if empty or unreadable. */
  peek(slot: SlotId): SaveEnvelope | null {
    const raw = this.store.read(KEY(slot));
    if (!raw) return null;
    try {
      const env = JSON.parse(raw) as SaveEnvelope;
      if (!env || typeof env.v !== 'number' || !env.state?.char) return null;
      return env;
    } catch {
      return null;
    }
  }

  load(slot: SlotId): GameState | null {
    const env = this.peek(slot);
    if (!env) return null;
    if (env.v > STATE_VERSION) return null; // from a newer build
    const st = env.v === STATE_VERSION ? env.state : migrate(env.state as unknown as Record<string, unknown>, env.v);
    return st ? repair(st) : null;
  }

  remove(slot: SlotId) {
    this.store.remove(KEY(slot));
  }

  /** The most recent save of any slot (for Continue). */
  latest(): SlotId | null {
    let best: SlotId | null = null, at = 0;
    for (const s of SLOTS) {
      const e = this.peek(s);
      if (e && e.at > at) (best = s), (at = e.at);
    }
    return best;
  }
}

/** Fill anything a save is missing (a field added without a version bump), so a load never crashes. */
function repair(s: GameState): GameState {
  s.mem ??= { visited: {}, met: {}, gone: [], searched: {}, pois: {}, flags: {}, secrets: [], bounty: {}, seen: {} };
  s.mem.seen ??= {};
  s.mem.visited ??= {};
  s.mem.met ??= {};
  s.mem.gone ??= [];
  s.mem.searched ??= {};
  s.mem.pois ??= {};
  s.mem.flags ??= {};
  s.mem.secrets ??= [];
  s.mem.bounty ??= {};
  s.quests ??= [];
  s.journal ??= [];
  s.inv ??= [];
  s.worn ??= {};
  s.towns ??= {};
  s.stats ??= { walked: 0, driven: 0, talked: 0, bought: 0, sold: 0, jobs: 0, searched: 0, days: 0 };
  return s;
}
