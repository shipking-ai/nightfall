import { mutation, query, internalMutation } from './_generated/server';
import { v } from 'convex/values';

const ROOM = /^[a-z0-9]{6,16}$/;
const PID = /^[a-z0-9]{8}$/;
const check = (room: string, pid?: string) => {
  if (!ROOM.test(room) || (pid !== undefined && !PID.test(pid))) throw new Error('bad room or player id');
};

/** Arrive (or rename). */
export const join = mutation({
  args: { room: v.string(), pid: v.string(), name: v.string(), coat: v.number(), joined: v.number(), look: v.optional(v.any()) },
  handler: async (ctx, a) => {
    check(a.room, a.pid);
    if (JSON.stringify(a.look ?? null).length > 600) throw new Error('look too big');
    const name = a.name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24) || 'Someone';
    const row = await ctx.db.query('members').withIndex('by_pid', (q) => q.eq('room', a.room).eq('pid', a.pid)).unique();
    const doc = { room: a.room, pid: a.pid, name, coat: a.coat, joined: a.joined, seen: Date.now(), look: a.look ?? undefined };
    if (row) await ctx.db.patch(row._id, doc);
    else await ctx.db.insert('members', doc);
  },
});

/** Position (also a heartbeat: people who stop sending are swept). */
export const state = mutation({
  args: { room: v.string(), pid: v.string(), s: v.array(v.number()) },
  handler: async (ctx, a) => {
    check(a.room, a.pid);
    if (a.s.length > 10) throw new Error('too long');
    const now = Date.now();
    const row = await ctx.db.query('states').withIndex('by_pid', (q) => q.eq('room', a.room).eq('pid', a.pid)).unique();
    if (row) await ctx.db.patch(row._id, { s: a.s, at: now });
    else await ctx.db.insert('states', { room: a.room, pid: a.pid, s: a.s, at: now });
    const m = await ctx.db.query('members').withIndex('by_pid', (q) => q.eq('room', a.room).eq('pid', a.pid)).unique();
    if (m) await ctx.db.patch(m._id, { seen: now });
  },
});

/** Horn / parked car / clock. */
export const event = mutation({
  args: { room: v.string(), pid: v.string(), t: v.string(), data: v.any() },
  handler: async (ctx, a) => {
    check(a.room, a.pid);
    if (!['hn', 'pk', 'ck', 'tx', 'sh', 'ch'].includes(a.t) || JSON.stringify(a.data ?? null).length > 300) throw new Error('bad event');
    await ctx.db.insert('events', { room: a.room, pid: a.pid, t: a.t, data: a.data, at: Date.now() });
  },
});

/** The host's city snapshot: overwrite this room's single row. */
export const city = mutation({
  args: { room: v.string(), pid: v.string(), data: v.any() },
  handler: async (ctx, a) => {
    check(a.room, a.pid);
    if (JSON.stringify(a.data ?? null).length > 4096) throw new Error('too big');
    const row = await ctx.db.query('cities').withIndex('by_room', (q) => q.eq('room', a.room)).unique();
    const doc = { room: a.room, pid: a.pid, data: a.data, at: Date.now() };
    if (row) await ctx.db.patch(row._id, doc);
    else await ctx.db.insert('cities', doc);
  },
});

export const leave = mutation({
  args: { room: v.string(), pid: v.string() },
  handler: async (ctx, a) => {
    check(a.room, a.pid);
    for (const table of ['members', 'states'] as const) {
      const row = await ctx.db.query(table).withIndex('by_pid', (q) => q.eq('room', a.room).eq('pid', a.pid)).unique();
      if (row) await ctx.db.delete(row._id);
    }
  },
});

/** Everything a client needs, as one live subscription. */
export const room = query({
  args: { room: v.string() },
  handler: async (ctx, a) => {
    check(a.room);
    const members = await ctx.db.query('members').withIndex('by_room', (q) => q.eq('room', a.room)).take(32);
    const states = await ctx.db.query('states').withIndex('by_room', (q) => q.eq('room', a.room)).take(32);
    const events = await ctx.db.query('events').withIndex('by_room', (q) => q.eq('room', a.room)).order('desc').take(20);
    const city = await ctx.db.query('cities').withIndex('by_room', (q) => q.eq('room', a.room)).unique();
    return {
      members: members.map((m) => ({ id: m.pid, name: m.name, coat: m.coat, joined: m.joined, look: m.look })),
      states: states.map((s) => ({ id: s.pid, s: s.s })),
      events: events.map((e) => ({ id: e._id, pid: e.pid, t: e.t, data: e.data, at: e.at })),
      city: city ? { pid: city.pid, data: city.data } : null,
    };
  },
});

/** Cron: sweep people who stopped sending (closed tab, lost connection) and old events. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    for (const m of await ctx.db.query('members').withIndex('by_seen', (q) => q.lt('seen', now - 25_000)).take(200)) {
      await ctx.db.delete(m._id);
      const s = await ctx.db.query('states').withIndex('by_pid', (q) => q.eq('room', m.room).eq('pid', m.pid)).unique();
      if (s) await ctx.db.delete(s._id);
    }
    for (const e of await ctx.db.query('events').withIndex('by_at', (q) => q.lt('at', now - 60_000)).take(500)) await ctx.db.delete(e._id);
    for (const c of await ctx.db.query('cities').withIndex('by_at', (q) => q.lt('at', now - 60_000)).take(100)) await ctx.db.delete(c._id);
  },
});
