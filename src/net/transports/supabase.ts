import type { Hooks, Member, Transport } from '../types';
import { CONNECT_TIMEOUT, EVENTS } from '../types';

/**
 * Supabase Realtime: presence for who's here, broadcast for everything else.
 * Billed per delivery, so it's the last resort. Loaded only when needed.
 */
export async function supabaseTransport(url: string, key: string, room: string, id: string, hooks: Hooks): Promise<Transport> {
  const { RealtimeClient } = await import('@supabase/realtime-js');
  const client = new RealtimeClient(`${url.replace(/^http/, 'ws')}/realtime/v1`, { params: { apikey: key, eventsPerSecond: 20 } });
  const ch = client.channel(`nightfall:${room}`, { config: { broadcast: { self: false }, presence: { key: id } } });
  let ready = false;
  let closed = false;
  const close = () => {
    closed = true;
    ch.unsubscribe();
    client.disconnect();
  };
  const timer = window.setTimeout(() => {
    if (ready || closed) return;
    close();
    hooks.fail();
  }, CONNECT_TIMEOUT);
  ch.on('presence', { event: 'sync' }, () => {
    const state = ch.presenceState() as Record<string, { name?: string; coat?: number; joined?: number; look?: unknown }[]>;
    const list: Member[] = [];
    for (const [k, metas] of Object.entries(state)) {
      const m = metas[0];
      if (m && k !== id) list.push({ id: k, name: String(m.name ?? ''), coat: Number(m.coat), joined: Number(m.joined), look: m.look });
    }
    hooks.members(list);
  });
  for (const t of EVENTS) {
    ch.on('broadcast', { event: t }, ({ payload }) => {
      if (payload && typeof payload.i === 'string') hooks.receive(t, payload, payload.i);
    });
  }
  ch.subscribe((s) => {
    if (s === 'SUBSCRIBED' && !ready) {
      ready = true;
      clearTimeout(timer);
      hooks.ready();
      ch.track(hooks.me());
    }
  });
  return {
    kind: 'supabase',
    send: (t, payload) => ch.send({ type: 'broadcast', event: t, payload: { ...payload, i: id } }),
    rename: (me) => ch.track(me),
    close: () => {
      clearTimeout(timer);
      close();
    },
  };
}
