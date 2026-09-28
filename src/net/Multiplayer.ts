import { readJSON, writeJSON } from '../core/storage';
import { cleanLook, type Look } from '../entities/Look';
import { cleanChat } from '../ui/Chat';
import type { Ev, Hooks, Member, Transport, TransportKind } from './types';
import { roomsTransport } from './transports/rooms';

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY_ = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const ME_KEY = 'nightfall.me.v1';
const ROOM = /^[a-z0-9]{6,16}$/;

/** coats people can be told apart by, at night, at a distance */
export const COATS = [0x6b2b25, 0x2d4a6b, 0x5c5a2a, 0x3d5a45, 0x6b4a2a, 0x4a3560, 0x7a6a55, 0x2a5f63];

export type Mode = 'walk' | 'sit' | 'drive' | 'ride';

/** What each player tells the others, several times a second. Kept small. */
export interface PeerState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  mode: Mode;
  /** in a car: its paint, whether it's electric / a van, braking */
  car?: { color: number; screen: boolean; van: boolean; brake: boolean; v: number; idx: number };
  /** the emote playing (index in data/emotes + 1, 0 for none) and a toggle that flips each time one starts */
  emote?: number;
  eseq?: number;
}

export interface Peer {
  id: string;
  name: string;
  coat: number;
  look: Look | null;
  joined: number;
  /** two latest snapshots, with local receive times, for interpolation */
  a: PeerState | null;
  b: PeerState | null;
  ta: number;
  tb: number;
  seen: number;
}

type WireState = [number, number, number, number, number, number, number?, number?, number?, number?];
const MODES: Mode[] = ['walk', 'sit', 'drive', 'ride'];

const ROOMS_URL = import.meta.env.VITE_ROOM_SERVER as string | undefined;
const FIREBASE = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
};
const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string | undefined;

/** First choice first. Each backup is only downloaded if everything before it failed. */
const CHAIN: TransportKind[] = [
  ...(ROOMS_URL ? (['rooms'] as const) : []),
  ...(FIREBASE.apiKey && FIREBASE.databaseURL && FIREBASE.projectId ? (['firebase'] as const) : []),
  ...(CONVEX_URL ? (['convex'] as const) : []),
  ...(URL_ && KEY_ ? (['supabase'] as const) : []),
];

/**
 * Other people in the same night. Rooms are unguessable ids shared by link
 * (?room=…). Networks, in order: our own room server (server/, Cloudflare,
 * free plan) → Firebase Realtime Database → Convex → Supabase Realtime. If one
 * can't be reached (down, blocked, or out of its free allowance) the room moves
 * to the next. Nothing is stored beyond who's in a room right now.
 */
export class Multiplayer {
  readonly enabled = CHAIN.length > 0;
  /** our id in the room; the room server assigns it, Supabase uses this one */
  id = crypto.randomUUID().slice(0, 8);
  me: { name: string; coat: number; look?: Look };
  room: string | null = null;
  peers = new Map<string, Peer>();
  onJoin: ((p: Peer) => void) | null = null;
  onLeave: ((p: Peer) => void) | null = null;
  onHorn: ((x: number, z: number, on: boolean) => void) | null = null;
  onClock: ((minutes: number) => void) | null = null;
  /** someone parked shared car `idx` here */
  onPark: ((idx: number, x: number, z: number, yaw: number) => void) | null = null;
  /** the host's snapshot of the crowd and traffic (only accepted from the current host) */
  onCity: ((snap: Record<string, unknown>) => void) | null = null;
  /** someone asks the host about the taxi: board / stop / alight (host only) */
  onTaxi: ((action: string, from: string) => void) | null = null;
  onChange: (() => void) | null = null;
  /** someone fired: from (x,y,z) to (p,q,r); n = crowd index hit (-1 none), a = player id hit, m = damage */
  onShot: ((from: string, s: { x: number; y: number; z: number; p: number; q: number; r: number; n: number; a: string; m: number }) => void) | null = null;
  /** a staff action, verified by the room server (only ever arrives over our own server) */
  onAdmin: ((act: string, m: Record<string, unknown>, from: string) => void) | null = null;
  /** someone said something in chat */
  onChat: ((from: string, name: string, text: string) => void) | null = null;
  /** voice chat signalling (WebRTC offers/answers), addressed to us */
  onSignal: ((from: string, data: Record<string, unknown>) => void) | null = null;
  /** we were thrown out of the room */
  onKicked: ((reason: string) => void) | null = null;
  /** the signed-in account's access token (App keeps it fresh) */
  token: string | null = null;
  status: 'alone' | 'connecting' | 'connected' | 'error' = 'alone';
  private tx: Transport | null = null;
  /** position in CHAIN of the network we're on (or trying) */
  private step = -1;
  /** bumps on every (re)connect so late callbacks from an abandoned network are ignored */
  private generation = 0;
  private joined = Date.now();
  private sendT = 0;
  private clockT = 0;
  private last = '';

  constructor() {
    const saved = readJSON<{ name: string; coat: number }>(ME_KEY);
    this.me = saved && typeof saved.name === 'string' ? saved : { name: `Passer-by ${Math.floor(10 + Math.random() * 89)}`, coat: COATS[Math.floor(Math.random() * COATS.length)] };
    writeJSON(ME_KEY, this.me);
    const r = new URLSearchParams(location.search).get('room');
    if (r && ROOM.test(r)) this.room = r;
  }

  /** which network carries the room right now (for Settings and debugging) */
  get via(): TransportKind | null {
    return this.tx?.kind ?? null;
  }

  /** the networks this build can use, in order */
  get networks(): TransportKind[] {
    return CHAIN;
  }

  get inviteUrl(): string {
    const u = new URL(location.href);
    const net = u.searchParams.get('net');
    u.search = '';
    u.hash = '';
    if (this.room) u.searchParams.set('room', this.room);
    if (net) u.searchParams.set('net', net);
    return u.toString();
  }

  /** Who runs the city and keeps the clock: the earliest arrival (ties by id). */
  get hostId(): string {
    let best = { id: this.id, joined: this.joined };
    for (const p of this.peers.values()) if (p.joined < best.joined || (p.joined === best.joined && p.id < best.id)) best = p;
    return best.id;
  }

  /** In a shared room and connected (otherwise the city is simply ours). */
  get shared(): boolean {
    return !!this.room && this.status === 'connected';
  }

  /** The city snapshot, twice a second (host only). */
  city(snap: Record<string, unknown>) {
    this.tx?.send('cy', snap);
  }

  /** Ask the host about the taxi. */
  taxi(action: 'board' | 'stop' | 'alight') {
    this.tx?.send('tx', { a: action });
  }

  /** The earliest arrival keeps the clock, so everyone reaches 05:29 together. */
  get isHost(): boolean {
    for (const p of this.peers.values()) if (p.joined < this.joined || (p.joined === this.joined && p.id < this.id)) return false;
    return true;
  }

  /** Change how you look to the others (and remember it). */
  setLook(look: Look) {
    this.me.look = look;
    this.me.coat = look.top;
    writeJSON(ME_KEY, this.me);
    this.tx?.rename(this.member());
    this.onChange?.();
  }

  setName(name: string) {
    const n = name.trim().slice(0, 24);
    if (!n) return;
    this.me.name = n;
    writeJSON(ME_KEY, this.me);
    this.tx?.rename(this.member());
    this.onChange?.();
  }

  /** Make a room if there isn't one, join it, and return the link to share. */
  async invite(): Promise<string> {
    if (!this.room) {
      this.room = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
      history.replaceState(null, '', this.inviteUrl);
    }
    this.connect();
    return this.inviteUrl;
  }

  connect() {
    if (!this.enabled || !this.room || this.tx || this.step >= 0) return;
    this.status = 'connecting';
    this.onChange?.();
    // testing aid: ?net=firebase|convex|supabase starts further down the chain
    const forced = new URLSearchParams(location.search).get('net') as TransportKind | null;
    this.step = forced && CHAIN.includes(forced) ? CHAIN.indexOf(forced) - 1 : -1;
    this.next();
  }

  /** Try the next network in the chain (or give up if there isn't one). */
  private async next() {
    const gen = ++this.generation;
    for (const p of this.peers.values()) this.onLeave?.(p);
    this.peers.clear();
    this.tx = null;
    this.step++;
    const kind = CHAIN[this.step];
    const room = this.room;
    if (!kind || !room) {
      this.step = -1;
      this.status = 'error';
      this.onChange?.();
      return;
    }
    this.status = 'connecting';
    this.id = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const hooks = this.hooks(gen);
    try {
      let tx: Transport;
      if (kind === 'rooms') tx = roomsTransport(ROOMS_URL!, room, hooks);
      else if (kind === 'firebase') tx = await (await import('./transports/firebase')).firebaseTransport(FIREBASE as { apiKey: string; databaseURL: string; projectId: string }, room, this.id, hooks);
      else if (kind === 'convex') tx = await (await import('./transports/convex')).convexTransport(CONVEX_URL!, room, this.id, hooks);
      else tx = await (await import('./transports/supabase')).supabaseTransport(URL_!, KEY_!, room, this.id, hooks);
      if (gen !== this.generation) return tx.close(); // superseded while loading
      this.tx = tx;
    } catch {
      if (gen === this.generation) this.next(); // couldn't even load it
    }
  }

  /** Callbacks for one network; stale once we've moved on. */
  private hooks(gen: number): Hooks {
    const live = () => gen === this.generation;
    return {
      me: () => this.member(),
      ready: (id) => {
        if (!live()) return;
        if (id) this.id = id;
        this.status = 'connected';
        this.onChange?.();
      },
      fail: () => live() && this.next(),
      members: (list) => live() && this.syncMembers(list),
      join: (m) => live() && this.upsertMember(m),
      leave: (id) => live() && this.dropMember(id),
      receive: (t, m, from) => live() && this.receive(t, m, from),
      kicked: (reason) => {
        if (!live()) return;
        this.generation++;
        this.tx = null;
        this.step = -1;
        for (const p of this.peers.values()) this.onLeave?.(p);
        this.peers.clear();
        this.status = 'error';
        this.onChange?.();
        this.onKicked?.(reason);
      },
      token: () => this.token,
    };
  }

  /** Back to a night of your own. */
  leave() {
    this.generation++;
    this.step = -1;
    this.tx?.close();
    this.tx = null;
    for (const p of this.peers.values()) this.onLeave?.(p);
    this.peers.clear();
    this.room = null;
    this.status = 'alone';
    history.replaceState(null, '', this.inviteUrl);
    this.onChange?.();
  }

  /**
   * Every frame. Sends at 5 Hz while things change, ~1 Hz while still.
   * (On Supabase every delivery is billed, so a room costs about
   * 5 x players^2 messages a second while everyone moves.)
   */
  update(dt: number, state: PeerState | null, clock: number) {
    if (!this.tx || this.status !== 'connected') return;
    this.sendT -= dt;
    if (state && this.sendT <= 0) {
      const w = encode(state);
      const key = w.map((v) => (v ?? 0).toFixed(1)).join(',');
      if (key !== this.last || this.sendT < -1) {
        this.tx.send('st', { s: w });
        this.last = key;
        this.sendT = 0.2;
      }
    }
    this.clockT -= dt;
    if (this.clockT <= 0 && this.isHost && this.peers.size) {
      this.clockT = 4;
      this.tx.send('ck', { m: clock });
    }
    // anyone silent for a long time has closed the tab
    const now = performance.now();
    for (const p of this.peers.values()) if (p.b && now - p.seen > 15000) p.a = p.b = null;
  }

  park(idx: number, x: number, z: number, yaw: number) {
    this.tx?.send('pk', { n: idx, x, z, y: yaw });
  }

  /** Say something to the room. */
  chat(text: string) {
    const c = cleanChat(text);
    if (!c || !this.tx) return false;
    this.tx.send('ch', { c });
    return true;
  }

  /** Voice chat: a WebRTC message for one other player (only our own room server carries these). */
  signal(to: string, data: Record<string, unknown>) {
    if (this.tx?.kind !== 'rooms') return false;
    this.tx.send('rt', { to, d: data });
    return true;
  }

  get transport() {
    return this.tx?.kind ?? null;
  }

  /** We fired (see onShot for the fields). */
  shot(s: { x: number; y: number; z: number; p: number; q: number; r: number; n: number; a: string; m: number }) {
    const r = (v: number) => Math.round(v * 100) / 100;
    this.tx?.send('sh', { x: r(s.x), y: r(s.y), z: r(s.z), p: r(s.p), q: r(s.q), r: r(s.r), n: s.n, a: s.a.slice(0, 8), m: Math.round(s.m) });
  }

  /** Staff: ask the room server to do something (it checks our account's role first). */
  admin(act: string, extra: Record<string, unknown> = {}) {
    if (this.tx?.kind !== 'rooms') return false;
    this.tx.send('ad', { act, tok: this.token ?? '', ...extra });
    return true;
  }

  /** Whether admin actions reach the room (only our own server can check who's staff). */
  get adminReady() {
    return this.tx?.kind === 'rooms' && this.status === 'connected';
  }

  horn(x: number, z: number, on: boolean) {
    this.tx?.send('hn', { x, z, on });
  }

  /** Where a peer is right now: 230 ms behind the latest news, interpolated. */
  sample(p: Peer, out: PeerState): boolean {
    if (!p.b) return false;
    if (!p.a) {
      Object.assign(out, p.b);
      return true;
    }
    const now = performance.now() - 230;
    const span = Math.max(1, p.tb - p.ta);
    const k = Math.min(1.25, Math.max(0, (now - p.ta) / span));
    const a = p.a, b = p.b;
    out.x = a.x + (b.x - a.x) * k;
    out.y = a.y + (b.y - a.y) * k;
    out.z = a.z + (b.z - a.z) * k;
    let dy = b.yaw - a.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    out.yaw = a.yaw + dy * Math.min(1, k);
    out.speed = b.speed;
    out.mode = b.mode;
    out.car = b.car;
    return true;
  }

  /* ─────────────── members and messages (any network) ─────────────── */

  private member(): Member {
    return { id: this.id, name: this.me.name, coat: this.me.coat, joined: this.joined, look: this.me.look };
  }

  /** A full list of who's here: add the new, update the known, drop the missing. */
  private syncMembers(list: Member[]) {
    const here = new Set<string>();
    for (const m of list) {
      if (!m || typeof m.id !== 'string' || m.id === this.id) continue;
      here.add(m.id);
      this.upsertMember(m, true);
    }
    for (const id of [...this.peers.keys()]) if (!here.has(id)) this.dropMember(id, true);
    this.onChange?.();
  }

  private upsertMember(m: Member, quiet = false) {
    if (!m || typeof m.id !== 'string' || m.id === this.id) return;
    const name = typeof m.name === 'string' && m.name.trim() ? m.name.slice(0, 24) : 'Someone';
    const look = m.look ? cleanLook(m.look) : null;
    const coat = look ? look.top : COATS.includes(m.coat) ? m.coat : COATS[0];
    const existing = this.peers.get(m.id);
    if (existing) {
      existing.name = name;
      existing.coat = coat;
      existing.look = look;
    } else {
      const p: Peer = { id: m.id, name, coat, look, joined: Number(m.joined) || Date.now(), a: null, b: null, ta: 0, tb: 0, seen: performance.now() };
      this.peers.set(m.id, p);
      this.onJoin?.(p);
    }
    if (!quiet) this.onChange?.();
  }

  private dropMember(id: string, quiet = false) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    this.onLeave?.(p);
    if (!quiet) this.onChange?.();
  }

  private receive(t: Ev, m: Record<string, unknown>, from: string) {
    const p = this.peers.get(from);
    if (t === 'st') {
      const st = decode(m.s as WireState);
      if (!p || !st) return;
      const now = performance.now();
      p.a = p.b;
      p.ta = p.tb;
      p.b = st;
      p.tb = now;
      p.seen = now;
    } else if (t === 'hn') {
      const { x, z, on } = m as { x: number; z: number; on: boolean };
      if (Number.isFinite(x) && Number.isFinite(z)) this.onHorn?.(x, z, !!on);
    } else if (t === 'pk') {
      const { n, x, z, y } = m as { n: number; x: number; z: number; y: number };
      if (Number.isInteger(n) && n >= 0 && n < 64 && [x, z, y].every((v) => Number.isFinite(v))) this.onPark?.(n, x, z, y);
    } else if (t === 'cy') {
      if (from === this.hostId) this.onCity?.(m);
    } else if (t === 'tx') {
      const a = (m as { a?: unknown }).a;
      if (typeof a === 'string' && this.isHost && this.peers.has(from)) this.onTaxi?.(a, from);
    } else if (t === 'sh') {
      const s = m as { x: number; y: number; z: number; p: number; q: number; r: number; n: number; a: unknown; m: number };
      if (![s.x, s.y, s.z, s.p, s.q, s.r, s.n, s.m].every((v) => Number.isFinite(v))) return;
      if (!p || s.m < 0 || s.m > 60 || !Number.isInteger(s.n) || s.n < -1 || s.n > 99) return;
      // shots only travel so far: ignore anything claiming to come from across the map
      if (Math.hypot(s.p - s.x, s.r - s.z) > 100) return;
      this.onShot?.(from, { ...s, a: typeof s.a === 'string' ? s.a : '' });
    } else if (t === 'ch') {
      const c = cleanChat((m as { c?: unknown }).c);
      if (c && p) this.onChat?.(from, p.name, c);
    } else if (t === 'rt') {
      const { to, d } = m as { to?: unknown; d?: unknown };
      if (to === this.id && p && d && typeof d === 'object') this.onSignal?.(from, d as Record<string, unknown>);
    } else if (t === 'ad') {
      // only our own server can vouch for staff; it stamps ok:1 after checking the sender's account
      if (this.tx?.kind !== 'rooms' || (m as { ok?: unknown }).ok !== 1) return;
      const act = (m as { act?: unknown }).act;
      if (typeof act === 'string') this.onAdmin?.(act, m, from);
    } else if (t === 'ck') {
      const mm = (m as { m: number }).m;
      if (Number.isFinite(mm) && !this.isHost) this.onClock?.(mm);
    }
  }
}

function encode(s: PeerState): WireState {
  const r = (v: number, k = 100) => Math.round(v * k) / k;
  // the emote rides in the mode field (older clients read mode % 8 as before... and ignore the rest)
  const e = s.emote ? Math.min(63, s.emote) * 2 + ((s.eseq ?? 0) & 1) : 0;
  const w: WireState = [r(s.x), r(s.y), r(s.z), r(s.yaw), r(s.speed, 10), MODES.indexOf(s.mode) + 8 * e];
  if (s.car) w.push(s.car.color, (s.car.screen ? 1 : 0) | (s.car.van ? 2 : 0) | (s.car.brake ? 4 : 0), r(s.car.v, 10), s.car.idx);
  return w;
}

/** Other people's numbers are untrusted: check every field. */
function decode(w: WireState): PeerState | null {
  if (!Array.isArray(w) || w.length < 6) return null;
  const [x, y, z, yaw, speed, m, color, flags, v, idx] = w;
  if (![x, y, z, yaw, speed].every((n) => Number.isFinite(n))) return null;
  if (Math.abs(x) > 2000 || Math.abs(z) > 2000 || Math.abs(y) > 200) return null;
  const mi = Number.isInteger(m) && m >= 0 ? m : 0;
  const mode = MODES[mi % 8] ?? 'walk';
  const code = Math.floor(mi / 8);
  const s: PeerState = { x, y, z, yaw, speed: Math.min(40, Math.abs(speed)), mode, emote: Math.min(63, code >> 1), eseq: code & 1 };
  if ((mode === 'drive' || mode === 'ride') && Number.isFinite(color) && Number.isFinite(flags)) {
    s.car = { color: (color as number) & 0xffffff, screen: !!((flags as number) & 1), van: !!((flags as number) & 2), brake: !!((flags as number) & 4), v: Number(v) || 0, idx: Number.isInteger(idx) ? (idx as number) : -1 };
  }
  return s;
}
