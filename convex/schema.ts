import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * NIGHTFALL multiplayer, Convex backup network (see src/net/transports/convex.ts).
 * Nothing here is kept: rows belong to people currently in a room, and the
 * cron in crons.ts sweeps anyone who stopped sending.
 */
export default defineSchema({
  members: defineTable({ room: v.string(), pid: v.string(), name: v.string(), coat: v.number(), joined: v.number(), seen: v.number(), look: v.optional(v.any()) })
    .index('by_room', ['room'])
    .index('by_pid', ['room', 'pid'])
    .index('by_seen', ['seen']),
  states: defineTable({ room: v.string(), pid: v.string(), s: v.array(v.number()), at: v.number() })
    .index('by_room', ['room'])
    .index('by_pid', ['room', 'pid']),
  events: defineTable({ room: v.string(), pid: v.string(), t: v.string(), data: v.any(), at: v.number() })
    .index('by_room', ['room', 'at'])
    .index('by_at', ['at']),
  /** the host's latest crowd + traffic snapshot, one row per room */
  cities: defineTable({ room: v.string(), pid: v.string(), data: v.any(), at: v.number() })
    .index('by_room', ['room'])
    .index('by_at', ['at']),
});
