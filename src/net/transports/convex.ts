import type { Ev, Hooks, Transport } from '../types';
import { CONNECT_TIMEOUT } from '../types';

/**
 * Convex (free plan, operations-metered): one live query per room
 * (`rooms:room`) plus small mutations. Server functions live in convex/.
 * Loaded only when needed.
 */
export async function convexTransport(url: string, room: string, id: string, hooks: Hooks): Promise<Transport> {
  const [{ ConvexClient }, { makeFunctionReference }] = await Promise.all([import('convex/browser'), import('convex/server')]);
  const client = new ConvexClient(url);
  const fn = {
    room: makeFunctionReference<'query'>('rooms:room'),
    join: makeFunctionReference<'mutation'>('rooms:join'),
    state: makeFunctionReference<'mutation'>('rooms:state'),
    event: makeFunctionReference<'mutation'>('rooms:event'),
    leave: makeFunctionReference<'mutation'>('rooms:leave'),
    city: makeFunctionReference<'mutation'>('rooms:city'),
  };
  let ready = false;
  let closed = false;
  let errors = 0;
  const seen = new Set<string>();

  const shutdown = async () => {
    closed = true;
    unsub();
    await client.mutation(fn.leave, { room, pid: id }).catch(() => {});
    await client.close();
  };
  const fail = () => {
    if (closed) return;
    shutdown();
    hooks.fail();
  };
  const timer = window.setTimeout(() => !ready && fail(), CONNECT_TIMEOUT);
  // a few failed writes in a row (out of free operations, or down) means move on
  const call = (ref: typeof fn.join, args: Record<string, unknown>) =>
    client.mutation(ref, args).then(
      () => (errors = 0),
      () => ++errors >= 3 && fail(),
    );

  const join = () => {
    const me = hooks.me();
    return call(fn.join, { room, pid: id, name: me.name, coat: me.coat, joined: me.joined, look: me.look ?? null });
  };

  type RoomView = {
    members: { id: string; name: string; coat: number; joined: number; look?: unknown }[];
    states: { id: string; s: number[] }[];
    events: { id: string; pid: string; t: string; data: Record<string, unknown>; at: number }[];
    city: { pid: string; data: Record<string, unknown> } | null;
  };
  const unsub = client.onUpdate(
    fn.room,
    { room },
    (view: RoomView) => {
      if (closed) return;
      if (!ready) {
        ready = true;
        clearTimeout(timer);
        for (const e of view.events) seen.add(e.id); // don't replay what happened before we arrived
        hooks.ready();
      }
      hooks.members(view.members.filter((m) => m.id !== id));
      for (const s of view.states) if (s.id !== id) hooks.receive('st', { s: s.s }, s.id);
      for (const e of [...view.events].reverse()) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        if (e.pid !== id && Date.now() - e.at < 4000) hooks.receive(e.t as Ev, e.data ?? {}, e.pid);
      }
      if (seen.size > 200) for (const k of [...seen].slice(0, 100)) seen.delete(k);
      if (view.city && view.city.pid !== id) hooks.receive('cy', view.city.data ?? {}, view.city.pid);
    },
    () => fail(),
  );
  join();

  return {
    kind: 'convex',
    send: (t, payload) => {
      if (!ready || closed) return;
      if (t === 'st') call(fn.state, { room, pid: id, s: payload.s as number[] });
      else if (t === 'cy') call(fn.city, { room, pid: id, data: payload });
      else call(fn.event, { room, pid: id, t, data: payload });
    },
    rename: () => {
      if (!closed) join();
    },
    close: () => {
      clearTimeout(timer);
      shutdown();
    },
  };
}
