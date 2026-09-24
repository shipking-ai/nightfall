/**
 * Messages every network carries: position, horn, parked car, clock,
 * the host's city snapshot (crowd + traffic), and taxi requests to the host.
 */
export type Ev = 'st' | 'hn' | 'pk' | 'ck' | 'cy' | 'tx' | 'sh' | 'ad' | 'ch' | 'rt';

export interface Member {
  id: string;
  name: string;
  coat: number;
  joined: number;
  /** Wardrobe look (entities/Look); validated with cleanLook on arrival */
  look?: unknown;
}

/** What a network hands back up to Multiplayer. */
export interface Hooks {
  /** our current identity (name/coat can change) */
  me(): Member;
  /** connected and in the room; the network may assign our id */
  ready(id?: string): void;
  /** can't reach it (down, blocked, out of free allowance): try the next network */
  fail(): void;
  /** a full list of who's here */
  members(list: Member[]): void;
  join(m: Member): void;
  leave(id: string): void;
  receive(t: Ev, msg: Record<string, unknown>, from: string): void;
  /** the room server threw us out (kicked or banned): don't fall back to another network */
  kicked?(reason: string): void;
  /** the signed-in account's access token, for the room server (never sent to other players) */
  token?(): string | null;
}

/** One way of reaching the others. */
export interface Transport {
  readonly kind: TransportKind;
  send(t: Ev, payload: Record<string, unknown>): void;
  rename(me: Member): void;
  close(): void;
}

export type TransportKind = 'rooms' | 'firebase' | 'convex' | 'supabase';

export const EVENTS: Ev[] = ['st', 'hn', 'pk', 'ck', 'cy', 'tx', 'sh', 'ch', 'rt'];

/** give up on a network that hasn't connected in this long */
export const CONNECT_TIMEOUT = 8000;
