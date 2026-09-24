# Multiplayer at scale: Supabase and the alternatives

Researched 2026-09-23. Prices change, so check the linked pages before deciding.

## What NIGHTFALL sends

- Each player sends a position update **5 times a second** while moving, and about once a second while still (`src/net/Multiplayer.ts`).
- Updates go to everyone in the same room, and rooms are small: friends who shared a link.
- All networking lives in `src/net/Multiplayer.ts` (channel, presence, broadcast). Swapping providers means rewriting that one file. `Remotes.ts` and `App.ts` only use its `peers`, `sample()`, `horn()`, `park()` and `onJoin`/`onLeave`/`onHorn`/`onClock`/`onPark`.

## Why Supabase Realtime tops out early

**It bills every delivery.** Supabase counts "one message sent plus one message per subscribed client that receives it" ([docs](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages)). In a room of *P* players each sending 5 a second, that's about **5 × P² messages/second**.

| Room size | Messages / s while everyone moves |
|---|---|
| 2 | 20 |
| 3 | 45 |
| 4 | 80 |
| 6 | 180 |

**Its caps apply to the whole project, not per room** ([limits](https://supabase.com/docs/guides/realtime/limits)):

| Plan | Price | Messages / s | Concurrent connections | Messages / month included |
|---|---|---|---|---|
| Free | $0 | 100 | 200 | 2M |
| Pro | $25 | 500 (2,500 with no spend cap) | 500 (10,000 with no spend cap) | 5M, then $2.50 per million |
| Team | $599 | 2,500 | 10,000 | 5M, then $2.50 per million |

What that means in practice:

- **Free:** about one room of 4 moving at a time across the whole game, and about 7 hours of 4-player play a month before the 2M messages run out.
- **Pro:** about 6 rooms of 4, or ~125 moving players with no spend cap. That's roughly **$0.18 per player-hour**: each player generates about 72,000 billable messages an hour in a room of 4.
- **At 2M users:** if each played one hour a month, that's about 2M player-hours, or **around $360k a month in Supabase Realtime messages**. You'd also be far past the 2,500 messages/second ceiling, which is Enterprise-contract territory.

**Conclusion.** Keep Supabase for what it's good at: the database (cloud saves, "also recorded by N others") and small-scale presence. Movement relay at scale needs something billed by connection or compute, not by message.

## The alternatives

| Option | How it bills | Rough cost / player-hour (rooms of 4) | Fit |
|---|---|---|---|
| **Cloudflare Durable Objects** (one object per room, WebSockets; [PartyServer / PartyKit](https://github.com/cloudflare/partykit) is Cloudflare's helper for this) | Requests at $0.15 per million, with **incoming WebSocket messages counted at 20:1**; duration $12.50 per million GB-s; outgoing messages aren't requests ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)) | about **$0.002** (mostly the duration of each room's 128 MB object) | **Best next step.** Serverless, so no servers to run; a room is a natural unit; it scales to millions and is ~100× cheaper than per-message billing. The Vercel front end can stay as it is. |
| **Colyseus** (open source Node game server; [Colyseus Cloud](https://colyseus.io/pricing/) from $15/mo, flat compute, no per-player charge) | Per server | Depends on how many players a box holds. It's flat, so it gets cheap at high use | Best if you later want **authoritative** shared state: the same traffic, NPCs and taxi for everyone. Needs server code and some operations work. |
| **Nakama** (Heroic Labs, open source) | Self-host, or their managed cloud | Per server | A full game backend (accounts, matchmaking, chat, leaderboards). More than NIGHTFALL needs today. |
| **Ably** ([pricing](https://ably.com/pricing)) | $2.50 per million messages (down to $0.50 at volume) plus connection minutes | about $0.04–0.18 | Easiest drop-in, but per-message billing like Supabase; costly at 5 Hz. |
| ~~Hathora~~ | n/a | n/a | **Shut down May 2026** (acquired by Fireworks AI; customers moved to Nitrado GameFabric). Don't build on it. |

The per-player-hour figures are estimates for rooms of 4 with everyone moving the whole time (the worst case). The Durable Objects figure assumes 128 MB per room object, active the whole hour.

## What we did (2026-09-23)

We built **our own room server on Cloudflare's free Workers plan** (`server/`, one Durable Object per room). It's now the primary network, with Supabase Realtime as the automatic fallback.
- **Cost:** free, up to about 29 busy room-hours a day.
- **If it outgrows the free plan:** the paid Workers plan ($5 a month) uses the per-player-hour pricing above.

## Recommendation (original)

1. **Now:** stay on Supabase. A handful of friends per room is well within Free, and moving to **Pro ($25)** raises the ceiling to about 500–2,500 messages a second.
2. **Beyond ~100 people online at once:** move `Multiplayer.ts` onto **Cloudflare Durable Objects** (one per room). Keep Supabase for saves and sightings. This is a contained rewrite of one file plus a small Worker.
3. **If shared traffic, NPCs and taxis become a goal:** that needs one authority per room. It can be the Durable Object running a small simulation, or a **Colyseus** server.
