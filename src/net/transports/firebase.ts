import type { Ev, Hooks, Member, Transport } from '../types';
import { CONNECT_TIMEOUT } from '../types';

export interface FirebaseConfig {
  apiKey: string;
  databaseURL: string;
  projectId: string;
}

/**
 * Firebase Realtime Database (free Spark plan: 100 connections at once,
 * 10 GB downloaded a month). Loaded only when needed.
 *
 *   rooms/<room>/members/<id>  { name, coat, joined }    presence; removed on disconnect
 *   rooms/<room>/state/<id>    { s }                     latest position, overwritten (no growth)
 *   rooms/<room>/ev/<id>       { t, at, ...payload }     latest horn / park / clock / taxi event
 *   rooms/<room>/city          { i, at, n, c, r }        the host's snapshot of the crowd and traffic
 *
 * Every node for a player is removed server-side when their connection drops,
 * so rooms leave nothing behind. Rules: firebase/database.rules.json.
 */
export async function firebaseTransport(cfg: FirebaseConfig, room: string, id: string, hooks: Hooks): Promise<Transport> {
  const [{ initializeApp, deleteApp }, db] = await Promise.all([import('firebase/app'), import('firebase/database')]);
  const app = initializeApp(cfg, `nightfall-${id}`);
  const d = db.getDatabase(app);
  const base = `rooms/${room}`;
  const meRef = db.ref(d, `${base}/members/${id}`);
  const stateRef = db.ref(d, `${base}/state/${id}`);
  const evRef = db.ref(d, `${base}/ev/${id}`);
  const unsubs: (() => void)[] = [];
  let ready = false;
  let closed = false;

  const shutdown = async () => {
    closed = true;
    unsubs.forEach((u) => u());
    await Promise.allSettled([db.remove(meRef), db.remove(stateRef), db.remove(evRef)]);
    db.goOffline(d);
    await deleteApp(app).catch(() => {});
  };
  const fail = () => {
    if (closed) return;
    shutdown();
    hooks.fail();
  };
  const timer = window.setTimeout(() => !ready && fail(), CONNECT_TIMEOUT);

  const member = (m: Member) => ({ name: m.name, coat: m.coat, joined: m.joined, ...(m.look ? { look: m.look } : {}) });

  unsubs.push(
    db.onValue(db.ref(d, '.info/connected'), async (snap) => {
      if (snap.val() !== true || closed) return;
      try {
        // the server cleans up after us if the tab closes or the connection drops
        await Promise.all([db.onDisconnect(meRef).remove(), db.onDisconnect(stateRef).remove(), db.onDisconnect(evRef).remove()]);
        await db.set(meRef, member(hooks.me()));
      } catch {
        return fail(); // rules refused us, or quota
      }
      if (!ready) {
        ready = true;
        clearTimeout(timer);
        hooks.ready();
      }
    }),
  );
  unsubs.push(
    db.onValue(
      db.ref(d, `${base}/members`),
      (snap) => {
        const list: Member[] = [];
        snap.forEach((c) => {
          const v = c.val() ?? {};
          if (c.key && c.key !== id) list.push({ id: c.key, name: String(v.name ?? ''), coat: Number(v.coat), joined: Number(v.joined), look: v.look });
        });
        hooks.members(list);
      },
      () => fail(),
    ),
  );
  const onState = (c: { key: string | null; val(): { s?: unknown } | null }) => {
    if (c.key && c.key !== id) hooks.receive('st', { s: c.val()?.s }, c.key);
  };
  unsubs.push(db.onChildAdded(db.ref(d, `${base}/state`), onState), db.onChildChanged(db.ref(d, `${base}/state`), onState));
  const onEv = (c: { key: string | null; val(): Record<string, unknown> | null }) => {
    const v = c.val();
    // skip events that were already sitting there when we arrived
    if (!c.key || c.key === id || !v || typeof v.t !== 'string' || Date.now() - Number(v.at) > 4000) return;
    hooks.receive(v.t as Ev, v, c.key);
  };
  unsubs.push(db.onChildAdded(db.ref(d, `${base}/ev`), onEv), db.onChildChanged(db.ref(d, `${base}/ev`), onEv));
  unsubs.push(
    db.onValue(db.ref(d, `${base}/city`), (snap) => {
      const v = snap.val();
      if (v && typeof v.i === 'string' && v.i !== id) hooks.receive('cy', v, v.i);
    }),
  );

  return {
    kind: 'firebase',
    send: (t, payload) => {
      if (!ready || closed) return;
      if (t === 'st') db.set(stateRef, { s: payload.s }).catch(fail);
      else if (t === 'cy') db.set(db.ref(d, `${base}/city`), { ...payload, i: id, at: Date.now() }).catch(() => {});
      else db.set(evRef, { ...payload, t, at: Date.now() }).catch(() => {});
    },
    rename: (me) => {
      if (ready && !closed) db.set(meRef, member(me)).catch(() => {});
    },
    close: () => {
      clearTimeout(timer);
      shutdown();
    },
  };
}
