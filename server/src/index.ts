/**
 * NIGHTFALL room server — a Cloudflare Worker with one Durable Object per room.
 *
 * It is a relay, not a simulation: it keeps who's in the room, passes each
 * player's small updates to everyone else in that room, and says who arrived
 * and who left. It uses the WebSocket Hibernation API, so a quiet room costs
 * nothing between messages.
 *
 *   wss://<worker>/room/<room-id>
 *
 * Client → server (JSON):
 *   { t: 'hello', name, coat, joined }        first message, once
 *   { t: 'st' | 'hn' | 'pk' | 'ck' | 'cy' | 'tx', ... }  relayed to the others as-is, stamped with the sender's id
 *   { t: 'me', name, coat, tok? }             rename / recolour (tok: Supabase access token, checked, never relayed)
 *   { t: 'ad', act, tok, ... }                staff only: checked against the account's role in Supabase, then
 *                                             carried out (kick / ban) or passed on stamped ok:1 (mute, world, announce)
 * Server → client:
 *   { t: 'welcome', id, peers: [...] }        after hello
 *   { t: 'join', p } / { t: 'leave', id }
 *   { t: 'st' | 'hn' | 'pk' | 'ck', i, ... }  someone else's update
 */

import { DurableObject } from 'cloudflare:workers';

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  ALLOWED_ORIGINS: string;
  /** Supabase project: accounts, roles and bans (the key is the public publishable one) */
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
}

/** what the server knows about an account, briefly cached per token */
const accounts = new Map<string, { uid: string; staff: boolean; banned: boolean; at: number }>();

async function account(env: Env, tok: unknown) {
  if (typeof tok !== 'string' || tok.length < 20 || tok.length > 4000 || !env.SUPABASE_URL) return null;
  const hit = accounts.get(tok);
  if (hit && Date.now() - hit.at < 300_000) return hit;
  const h = { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${tok}` };
  try {
    const u = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: h });
    if (!u.ok) return null;
    const user = (await u.json()) as { id?: string };
    if (!user.id) return null;
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=role,banned`, { headers: h });
    const rows = r.ok ? ((await r.json()) as { role?: string; banned?: boolean }[]) : [];
    const p = rows[0] ?? {};
    const out = { uid: user.id, staff: !p.banned && (p.role === 'admin' || p.role === 'moderator'), banned: !!p.banned, at: Date.now() };
    if (accounts.size > 500) accounts.clear();
    accounts.set(tok, out);
    return out;
  } catch {
    return null;
  }
}

/** What staff can ask for, and what it passes on to everyone. */
const ADMIN_ACTS = new Set(['kick', 'ban', 'mute', 'unmute', 'time', 'rain', 'blackout', 'announce', 'unease', 'jail']);

const ROOM_ID = /^[a-z0-9]{6,16}$/;
const MAX_PLAYERS = 16;
/** city snapshots (36 people + 4 cars) are the biggest thing we relay */
const MAX_BYTES = 4096;
/** voice chat offers/answers carry a whole SDP */
const MAX_SIGNAL_BYTES = 12000;
const RELAYED = new Set(['st', 'hn', 'pk', 'ck', 'cy', 'tx', 'sh', 'ch', 'rt']);
const COATS = [0x6b2b25, 0x2d4a6b, 0x5c5a2a, 0x3d5a45, 0x6b4a2a, 0x4a3560, 0x7a6a55, 0x2a5f63];

interface Member {
  id: string;
  name: string;
  coat: number;
  joined: number;
  /** the Wardrobe look; the client validates it again (cleanLook) */
  look?: Record<string, string | number | boolean>;
  /** private: the account behind this player, if signed in (never sent to anyone) */
  uid?: string;
}

/** A member as other players see them. */
function pub(m: Member): Member {
  const { uid: _uid, ...rest } = m;
  return rest;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/health') return new Response('ok');
    const m = url.pathname.match(/^\/room\/([a-z0-9]{6,16})$/);
    if (!m || !ROOM_ID.test(m[1])) return new Response('not found', { status: 404 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
    if (!originAllowed(req.headers.get('Origin'), env.ALLOWED_ORIGINS)) return new Response('origin not allowed', { status: 403 });
    const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
    return stub.fetch(req);
  },
} satisfies ExportedHandler<Env>;

/** Exact origins, plus `*.suffix` wildcards (e.g. *.vercel.app previews of this project). */
function originAllowed(origin: string | null, list: string): boolean {
  if (!origin) return false;
  for (const rule of list.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (rule === origin) return true;
    if (rule.startsWith('*') && origin.endsWith(rule.slice(1))) return true;
  }
  return false;
}

export class Room extends DurableObject<Env> {
  /** per-socket token buckets; reset if the object hibernates, which only happens when quiet anyway */
  private buckets = new Map<WebSocket, { tokens: number; at: number }>();

  async fetch(req: Request): Promise<Response> {
    if (this.members().length >= MAX_PLAYERS) return new Response('room full', { status: 409 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(null); // not a member until it says hello
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > (raw.startsWith('{"t":"rt"') ? MAX_SIGNAL_BYTES : MAX_BYTES) || !this.allow(ws)) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    const me = ws.deserializeAttachment() as Member | null;

    if (msg.t === 'hello' && !me) {
      const acct = await account(this.env, msg.tok);
      if (acct?.banned) return ws.close(4003, 'banned');
      const m: Member = { id: crypto.randomUUID().slice(0, 8), ...clean(msg), ...(acct ? { uid: acct.uid } : {}) };
      ws.serializeAttachment(m);
      ws.send(JSON.stringify({ t: 'welcome', id: m.id, peers: this.members().filter((p) => p.id !== m.id).map(pub) }));
      this.broadcast(ws, { t: 'join', p: pub(m) });
      return;
    }
    if (me && msg.t === 'ad') return this.admin(ws, me, msg);
    if (!me) return;
    if (msg.t === 'me') {
      const acct = msg.tok ? await account(this.env, msg.tok) : null;
      if (acct?.banned) return ws.close(4003, 'banned');
      const next: Member = { ...me, ...clean({ ...msg, joined: me.joined }), ...(acct ? { uid: acct.uid } : {}) };
      ws.serializeAttachment(next);
      this.broadcast(ws, { t: 'join', p: pub(next) });
      return;
    }
    if (typeof msg.t === 'string' && RELAYED.has(msg.t)) this.broadcast(ws, { ...msg, i: me.id });
  }

  /** Staff actions: only after the sender's account checks out as admin/moderator. */
  private async admin(ws: WebSocket, me: Member, msg: Record<string, unknown>) {
    const act = msg.act;
    if (typeof act !== 'string' || !ADMIN_ACTS.has(act)) return;
    const acct = await account(this.env, msg.tok);
    if (!acct?.staff) return ws.send(JSON.stringify({ t: 'ad', act: 'denied', ok: 1, i: me.id }));
    const target = typeof msg.a === 'string' ? msg.a : '';
    const out: Record<string, unknown> = { t: 'ad', act, ok: 1, i: me.id, a: target };
    for (const k of ['m', 'v'] as const) if (typeof msg[k] === 'number' && Number.isFinite(msg[k])) out[k] = msg[k];
    if (typeof msg.text === 'string') out.text = msg.text.slice(0, 140);
    if (act === 'kick' || act === 'ban') {
      for (const s of this.ctx.getWebSockets()) {
        const m = s.deserializeAttachment() as Member | null;
        if (!m || m.id !== target) continue;
        if (act === 'ban' && m.uid) {
          // the ban itself lives in Supabase, done as the admin (the function checks their role again)
          await fetch(`${this.env.SUPABASE_URL}/rest/v1/rpc/nf_admin_ban`, {
            method: 'POST',
            headers: { apikey: this.env.SUPABASE_KEY, Authorization: `Bearer ${msg.tok}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ target: m.uid, on: true }),
          }).catch(() => {});
        }
        try {
          s.send(JSON.stringify(out));
          s.close(act === 'ban' ? 4003 : 4001, act === 'ban' ? 'banned' : 'kicked');
        } catch {
          /* gone already */
        }
        this.gone(s);
      }
      ws.send(JSON.stringify({ ...out, act: `${act}ed` }));
      return;
    }
    // everything else goes to everyone, the sender included
    const s = JSON.stringify(out);
    for (const w of this.ctx.getWebSockets()) if (w.deserializeAttachment()) w.send(s);
  }

  async webSocketClose(ws: WebSocket) {
    this.gone(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.gone(ws);
  }

  private gone(ws: WebSocket) {
    this.buckets.delete(ws);
    const me = ws.deserializeAttachment() as Member | null;
    try {
      ws.close(1000, 'bye');
    } catch {
      /* already closed */
    }
    if (me) this.broadcast(ws, { t: 'leave', id: me.id });
  }

  private members(): Member[] {
    const out: Member[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const m = ws.deserializeAttachment() as Member | null;
      if (m) out.push(m);
    }
    return out;
  }

  private broadcast(from: WebSocket, msg: object) {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === from || !ws.deserializeAttachment()) continue;
      try {
        ws.send(s);
      } catch {
        /* closing */
      }
    }
  }

  /** At most ~15 messages a second per player (5 Hz positions plus horns and the odd extra). */
  private allow(ws: WebSocket): boolean {
    const now = Date.now();
    const b = this.buckets.get(ws) ?? { tokens: 30, at: now };
    b.tokens = Math.min(30, b.tokens + ((now - b.at) / 1000) * 15);
    b.at = now;
    this.buckets.set(ws, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}

function clean(msg: Record<string, unknown>): Omit<Member, 'id'> {
  const name = typeof msg.name === 'string' ? msg.name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24) || 'Someone' : 'Someone';
  const coat = Number.isInteger(msg.coat) && (msg.coat as number) >= 0 && (msg.coat as number) <= 0xffffff ? (msg.coat as number) : COATS[0];
  const joined = Number.isFinite(msg.joined) ? Number(msg.joined) : Date.now();
  return { name, coat, joined, look: cleanLook(msg.look) };
}

/** Only flat, small looks: short keys, and strings, finite numbers or booleans. */
function cleanLook(raw: unknown): Member['look'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string | number | boolean> = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (++n > 16 || !/^[a-zA-Z]{1,12}$/.test(k)) continue;
    if (typeof v === 'string' && v.length <= 12) out[k] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}
