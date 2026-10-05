import { readJSON, writeJSON, removeKey } from './storage';

export interface SaveData {
  version: 1;
  discovered: string[];
  unread: string[];
  /** hidden progress flags (marks found, phone answered …) */
  flags: string[];
  player: { x: number; y: number; z: number; yaw: number } | null;
  clock: number;
  lastPlace: string | null;
  /** money you've found (or taken) in the city */
  cash?: number;
  /** ms since epoch of the last flush; decides whose position wins in a merge */
  savedAt?: number;
}

const KEY = 'nightfall.save.v1';

function empty(): SaveData {
  return { version: 1, discovered: [], unread: [], flags: [], player: null, clock: 3 * 60 + 17, lastPlace: null };
}

/** Persistent progress: discoveries, last position, world clock. */
export class SaveState {
  data: SaveData;
  /** called after every write (the cloud copy listens here) */
  onFlush: ((d: SaveData) => void) | null = null;

  constructor() {
    const loaded = readJSON<SaveData>(KEY);
    this.data = loaded && loaded.version === 1 ? { ...empty(), ...loaded } : empty();
  }

  get hasProgress(): boolean {
    return this.data.player !== null;
  }

  has(id: string): boolean {
    return this.data.discovered.includes(id);
  }

  add(id: string): boolean {
    if (this.has(id)) return false;
    this.data.discovered.push(id);
    this.data.unread.push(id);
    this.flush();
    return true;
  }

  flag(id: string): boolean {
    if (this.data.flags.includes(id)) return false;
    this.data.flags.push(id);
    this.flush();
    return true;
  }

  hasFlag(id: string): boolean {
    return this.data.flags.includes(id);
  }

  markRead(id: string): void {
    const i = this.data.unread.indexOf(id);
    if (i >= 0) {
      this.data.unread.splice(i, 1);
      this.flush();
    }
  }

  flush(): void {
    this.data.savedAt = Date.now();
    writeJSON(KEY, this.data);
    this.onFlush?.(this.data);
  }

  /**
   * Fold in a save from elsewhere (the cloud copy, or another device).
   * Discoveries and flags are never lost; position and clock come from
   * whichever save is newer, unless `keepPlace` (the player is already out
   * in the world).
   */
  merge(other: SaveData, keepPlace = false): void {
    if (!other || other.version !== 1) return;
    const d = this.data;
    const fresh = (other.discovered ?? []).filter((id) => !d.discovered.includes(id));
    d.discovered.push(...fresh);
    for (const id of other.unread ?? []) if (!d.unread.includes(id)) d.unread.push(id);
    for (const id of fresh) if (!d.unread.includes(id)) d.unread.push(id);
    for (const f of other.flags ?? []) if (!d.flags.includes(f)) d.flags.push(f);
    if (!keepPlace && (other.savedAt ?? 0) > (d.savedAt ?? 0)) {
      d.player = other.player ?? d.player;
      d.clock = other.clock ?? d.clock;
      d.lastPlace = other.lastPlace ?? d.lastPlace;
    }
    this.flush();
  }

  reset(): void {
    removeKey(KEY);
    this.data = empty();
    this.data.savedAt = Date.now();
    this.onFlush?.(this.data);
  }
}
