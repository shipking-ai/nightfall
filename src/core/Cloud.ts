import { readJSON, writeJSON } from './storage';
import type { SaveData } from './SaveState';

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY_ = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const TOKEN_KEY = 'nightfall.cloud.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Optional Supabase backing (see supabase/ and HANDOFF.md):
 *  - a copy of the save, keyed by a random per-browser token (the "save code"),
 *  - how many other people have recorded each archive entry.
 * The browser can only call four RPCs; the tables themselves are closed.
 * Without the env vars, or offline, every call quietly does nothing and the
 * game runs on localStorage alone.
 */
export class Cloud {
  readonly enabled = !!(URL_ && KEY_);
  /** entry id → number of players who have recorded it (including this one) */
  counts: Record<string, number> = {};
  private token: string;
  private pushTimer = 0;
  private pending: SaveData | null = null;

  constructor() {
    const t = readJSON<string>(TOKEN_KEY);
    this.token = t && UUID.test(t) ? t : crypto.randomUUID();
    if (t !== this.token) writeJSON(TOKEN_KEY, this.token);
  }

  /** the save code shown in Settings: enter it on another device to continue there */
  get code(): string {
    return this.token;
  }

  /** switch this browser to an existing save code and fetch that save */
  async adopt(code: string): Promise<SaveData> {
    const c = code.trim().toLowerCase();
    if (!UUID.test(c)) throw new Error('That is not a save code.');
    const data = await this.rpc<SaveData | null>('nf_save_get', { p_token: c });
    if (!data) throw new Error('No save found for that code.');
    this.token = c;
    writeJSON(TOKEN_KEY, c);
    return data;
  }

  async pull(): Promise<SaveData | null> {
    if (!this.enabled) return null;
    try {
      return await this.rpc<SaveData | null>('nf_save_get', { p_token: this.token });
    } catch {
      return null;
    }
  }

  /** debounced: the save flushes often, the network hears about it every few seconds */
  push(data: SaveData, now = false) {
    if (!this.enabled) return;
    this.pending = data;
    clearTimeout(this.pushTimer);
    const send = () => {
      const d = this.pending;
      this.pending = null;
      if (d) this.rpc('nf_save_put', { p_token: this.token, p_data: d }, now).catch(() => {});
    };
    if (now) send();
    else this.pushTimer = window.setTimeout(send, 4000);
  }

  async sight(entry: string): Promise<void> {
    if (!this.enabled) return;
    try {
      this.counts[entry] = await this.rpc<number>('nf_sight', { p_token: this.token, p_entry: entry });
    } catch {
      /* offline: the count just stays stale */
    }
  }

  async refreshCounts(): Promise<void> {
    if (!this.enabled) return;
    try {
      const rows = await this.rpc<{ entry_id: string; n: number }[]>('nf_sighting_counts', {});
      for (const r of rows) this.counts[r.entry_id] = Number(r.n);
    } catch {
      /* ignore */
    }
  }

  private async rpc<T>(fn: string, args: object, keepalive = false): Promise<T> {
    const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: KEY_!, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      keepalive,
    });
    if (!res.ok) throw new Error(`${fn}: ${res.status}`);
    return (await res.json()) as T;
  }
}
