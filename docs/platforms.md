# NIGHTFALL on other platforms

Where the game runs today, what a port needs, and how to get there through the platform holders' own programs. This covers how the code is organised. It doesn't describe any platform's SDK, fees or certification: those are the platform holders' to state, and they change. Check their current official documentation before planning around any of it.

## Today

- **Runs in:** the browser (desktop and mobile), built with Vite and deployed to Vercel.
- **Input:** fully playable with a controller only.
  - Menus navigate spatially (`ui/Nav.ts`).
  - Button glyphs follow the pad family (`input/glyphs.ts`: Xbox, PlayStation, generic), and bindings can be remapped.
  - Every screen has a controller path. The RPG's atlas pans with the stick and zooms with the triggers.
- **Screen:** the interface keeps to a TV-safe area (`styles/controller.css`) and scales for 10-foot viewing.
- **Money:** free, with no purchases of any kind.

## The platform layer (`src/platform/Platform.ts`)

The game talks to the machine only through this interface, so a port replaces one file rather than touching the game:

| Need | Interface | Web implementation | What a platform build would do |
|---|---|---|---|
| Save slots | `storage: SaveStore` (`read`/`write`/`remove`) | `localStorage` | the platform's save-data service |
| Milestones | `achievement(id)` | remembered locally; shown as a toast | the platform's trophy or achievement service, one entry per id in `ACHIEVEMENTS` |
| Presence | `presence(text)` | ignored | the platform's rich-presence line, if it has one |
| Suspend and resume | `onSuspend(fn)` | page visibility | the platform's lifecycle events |
| Account name | `userName()` | none (the game asks) | the signed-in user's display name |

Save data is a versioned envelope (`rpg/game/saves.ts`) with migrations and a `repair()` pass, so a save moved between versions or devices loads rather than failing. Every write is small, and the game never waits on one.

The milestone list is fixed and plain, so a port can map it one to one:
- `first-town`, `first-job`, `the-watcher`, `long-night`;
- `hunter`, `angler`, `cartographer`.

What's deliberately **not** here: any platform's SDK, API names, keys or credentials. Those are licensed to registered developers and belong in a native build made with that platform's official tools, never in this public web bundle.

## Routes, official programs first

1. **The web (now).** Nothing to add.
2. **PC stores.** The same build can be wrapped as a desktop app (for example Electron or Tauri) and submitted through each store's own developer program, such as Steamworks for Steam. Implement `Platform` against that store's SDK in the wrapper.
3. **Consoles.** Start with the platform holders' own developer programs:
   - Xbox: ID@Xbox;
   - PlayStation: PlayStation Partners;
   - Nintendo: the Nintendo Developer Portal.

   Each program sets its own terms: developer registration and agreements, access to development hardware and SDKs, technical requirements and certification, age ratings (for example through IARC, ESRB or PEGI), and any costs. This document makes no claim about any of them, including whether publishing costs anything; read the program's current documentation.

   Whether a console build can use web technology at all, and in what form, is also the platform holder's call. Plan for the likely answer: a native runtime or an engine port of the renderer. The game's structure helps whichever way it goes:
   - rules and state are plain TypeScript with no rendering in them (`rpg/game/`);
   - rendering is three.js;
   - input already goes through an action layer.

## What a port has to get right (in this codebase)

- **Input:** actions only, never raw keys (`input/actions.ts`). Swap the glyph set for the platform's button names and icons. Keep remapping.
- **Text:** all visible strings are in the UI and dialogue modules, ready for localisation. There is no text baked into textures.
- **Performance:** the heavy parts all have a knob.
  - Streamed chunks with a frame budget (`rpg/world/Streamer.ts`).
  - People built in a worker at three levels of detail (`rpg/people/`).
  - Grass carpet size (`world/GroundCover.ts`), real-tree distance (`Flora.ts` `REAL_NEAR`), hair card count (`people/hairCards.ts`).
  - Shadow and post settings.
- **Suspend:** on `onSuspend(true)`, pause the clock and audio. The RPG autosaves at safe points: sleeping, finishing a job, reaching a new town, and every 150 s.
- **Online:** the RPG is single-player and needs no network. The shared-city multiplayer in the original modes would need the platform's own networking and account rules.
- **Warzone:** matches are against bots, entirely on the device. Online squads or matchmaking would go through the platform's own networking, party and account services, with its own rules on voice and text chat. The career (`modes/warzone/career.ts`) is saved locally; a port moves it to the platform's save service with the rest.
- **Controller:** sensitivity (horizontal, vertical, aiming, scaled with scope zoom), look acceleration, response curve, dead zone, inversion, southpaw, aim assist (off, low, standard; controller only), hold or toggle for sprint, aim and crouch, vibration and trigger effects, and remapping are all in Settings. A port keeps these and adds whatever the platform's accessibility guidelines ask for.

## Free to play, fairly

The game is free, and there is nothing to buy. If that ever changes, these rules stand:
- **Never pay-to-win.** Nothing bought changes odds, stats, damage, prices, skills or story.
- **No loot boxes, and no random paid rewards of any kind.**
- **Cosmetic only, at a price shown up front**, in real money, with no premium currency.
- **No timers or nags built to push spending.** No purchase prompts during play.
- **Everything earnable by playing stays earnable by playing.**
- **Warzone's levels, weapons, attachments and streaks are earned by playing only.** Streaks come from kills in one life; nothing is bought.
- **Follow each platform's rules** on purchases, refunds, age ratings and disclosures, from their current official documentation.
