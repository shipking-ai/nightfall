import type { Ev, Hooks, Member, Transport } from '../types';
import { CONNECT_TIMEOUT } from '../types';

/**
 * Our own room server (server/, a Cloudflare Durable Object per room, free
 * plan). One WebSocket; the server relays and keeps the member list, and
 * assigns our id.
 */
export function roomsTransport(base: string, room: string, hooks: Hooks): Transport {
  const url = `${base.replace(/^http/, 'ws').replace(/\/$/, '')}/room/${room}`;
  let ws: WebSocket | null = null;
  let opened = false;
  let closed = false;
  let retries = 0;
  let timer = 0;
  const tx: Transport = {
    kind: 'rooms',
    send: (t, payload) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t, ...payload }));
    },
    rename: (me) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'me', name: me.name, coat: me.coat, look: me.look, tok: hooks.token?.() ?? undefined }));
    },
    close: () => {
      closed = true;
      clearTimeout(timer);
      ws?.close(1000);
    },
  };
  const giveUp = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    ws?.close();
    hooks.fail();
  };
  const dial = () => {
    ws = new WebSocket(url);
    timer = window.setTimeout(() => !opened && giveUp(), CONNECT_TIMEOUT);
    ws.onopen = () => {
      opened = true;
      retries = 0;
      clearTimeout(timer);
      const me = hooks.me();
      ws!.send(JSON.stringify({ t: 'hello', name: me.name, coat: me.coat, joined: me.joined, look: me.look, tok: hooks.token?.() ?? undefined }));
    };
    ws.onmessage = (e) => {
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (m.t === 'welcome' && typeof m.id === 'string') {
        hooks.ready(m.id);
        hooks.members(Array.isArray(m.peers) ? (m.peers as Member[]) : []);
      } else if (m.t === 'join' && m.p) hooks.join(m.p as Member);
      else if (m.t === 'leave' && typeof m.id === 'string') hooks.leave(m.id);
      else if (typeof m.t === 'string' && typeof m.i === 'string') hooks.receive(m.t as Ev, m, m.i);
    };
    ws.onclose = (e) => {
      if (closed) return;
      // 4001 kicked, 4003 banned: the server meant it, so don't go looking for another way in
      if (e.code === 4001 || e.code === 4003) {
        closed = true;
        clearTimeout(timer);
        return hooks.kicked?.(e.code === 4003 ? 'banned' : 'kicked');
      }
      // never got in, or kept dropping: hand over to the next network
      if (!opened || retries >= 3) return giveUp();
      retries++;
      setTimeout(() => !closed && dial(), 1500 * retries);
    };
  };
  dial();
  return tx;
}
