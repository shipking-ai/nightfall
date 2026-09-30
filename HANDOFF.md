# HANDOFF — NIGHTFALL

Last updated: 2026-09-29 (RPG R1–R4d done, plus realism passes: faces, sky light, trees, grass, rocks, hair cards; R5 next). Read this first, then [README.md](README.md) for architecture and controls.

## State in one paragraph

The browser game builds and runs: `npm run dev` serves it at http://localhost:5317, and `npm run build` typechecks and bundles it (no external assets). Production is https://nightfall-sand.vercel.app, deployed from the `claude/sharp-shannon-6ogxul` branch after every fix. The title leads to a **mode select**, and there are **four modes on one city**: City, After Hours, Warzone and Fight (see the next section). Everything can be played **with only a controller**; the four-mode run was playtested that way (tools/playtest/). The older sections below still describe the City systems accurately.

## NIGHTFALL: RPG, the fifth mode (in progress, 2026-09-28)

The user's brief is a very large "fifth game" addendum: an endless streamed world, many cities and biomes, full RPG systems, and console-ready architecture. It's being built in stages (R1–R6). **After every "R" stage: commit, deploy to Vercel production, tell the user so they can test.**

### Done: R1, the world (commit 53487c3, deployed)
- **Mode:** `rpg` in `src/modes/rules.ts` (listed 05 in the mode select). `App.enter()` calls `rpg.start()` behind the intermission card; `App.leave()` calls `rpg.stop()`, which restores District 03's night: fog, sky uniforms, key light, env map, water, skyline.
- **`src/rpg/Rpg.ts`:** owns the generator, streamer, atmosphere, sea, precipitation, far cities and HUD. Hooks `Collision.base` (terrain and bridge decks) and `Player.waterAt` (open water anywhere; `undefined` inside District 03 keeps its river rules).
- **`src/rpg/world/WorldGen.ts`:** deterministic plan.
  - Climate, mountains and dunes.
  - One node per 3.2 km macro cell: city, town, village, ruin, military base or crossroads.
  - Graded roads with bridges, the home river continuing from District 03, noise rivers and lakes.
  - Merrow is the home city at (0, 260). District 03 is the handcrafted footprint `DISTRICT_03`; the interiors are `INTERIOR_BLOCK`.
- **`biomes.ts`:** ten biomes and ten city archetypes.
- **`Towns.ts`:** street grid, blocks, buildings (`raise()`), houses, landmarks, parks, lamps, shop POIs.
- **`Streamer.ts`:** 128 m chunks with a frame budget, 1 km far tiles, flora LOD.
- **`FarCities.ts`:** horizon silhouettes.
- **`Roads.ts`:** ribbons, bridges and decks.
- **`src/rpg/env/Atmosphere.ts`:** 24 h day, sun and moon, stars, drifting weather fronts, thunder, temperature, grip and visibility.
- **Shared engine changes:**
  - Facade shader: 5 new styles (stucco, adobe, timber, panel, siding) and `aTop.z` = base height.
  - `Collision.base` for terrain.
  - `Lighting.setKeyDirection` and `setExtraLamps`.
  - `Sky` gains `uDay`, `uSunDir`, `uStars`.
  - `Outskirts.limit` and `Outskirts.follow`.
- **Playtest:** `tools/playtest/rpg.mjs` selects RPG with the virtual pad, visits every biome and town type, drives out of District 03, and fails on errors.

### Done: realistic RPG people (the user's priority), commit 4c85461
- **MakeHuman (CC0 1.0, LICENSE.md section C):** `tools/mh/convert.py` packs the base mesh, macro and face targets, and the default skeleton's weights into `public/rpg/mh/mh.bin` plus `mh.json` (6.1 MB; credit in `public/rpg/mh/LICENSE.txt`). The source clone was `/home/user/makehumancommunity/makehuman`. The skins, hair and clothes packs weren't reachable (the host needs auth), so clothes and hair are grown from the body and its helper meshes in `mh.ts`.
- **`src/rpg/people/mh.ts`:** morphs a person from a `HumanSpec`, retargets bone-frame by bone-frame onto the game rig's bind pose, and cuts and drapes top, coat skirt, trousers and scalp hair. Shoes and extras stay SDF (`anatomy.ts`). The eye proxy is fitted from mhclo.
- **`RealHuman`:** a SkinnedMesh whose bones copy the shared rig's `J` after `solve()`. It's built in a worker. The far LOD is the SDF person.
- **Hero:** `heroSpec()` in `kit.ts` (charcoal wool coat, scarf, stubble). `Player.real` draws it in place of the city figure. It sits lower in car seats (the MH trunk is longer).
- **Viewer:** `dev/human.html?shot=full|face|walk&mh=0|1`.
- **To polish:** brows, better hair styles, NPC variety.

### Done: R2, the living world (commits d4e0937 and ba907d6)
- **`src/rpg/sim/Populace.ts`:** each town's residents have a name, job, home, workplace and daily schedule. Where someone is is a function of the time: commute, lunch, errands, evenings out, bed. Up to 12 within 110 m are embodied as `RealHuman`s (a pool of 28). Press interact to talk; the lines depend on their job, the weather and a rumour.
- **`src/rpg/sim/RoadTraffic.ts`:** vehicles on the road polylines, chosen by biome, in the right-hand lane. They slow for the car ahead and for you, and have headlights and brake lights. They spawn 160–520 m away along the road where it passes you (projected, by wall time, not capped dt) and drop past 700 m. `obstacles()` feeds App's collision circles.
- **Parked cars:** the `chunk.cars` spots within 160 m become real `DrivableCar`s via `Vehicles.spawn(spec, streamed=true)` / `despawn()` (`Rpg.park()`).
- **Playtest:** `tools/playtest/rpg-roads.mjs` covers highway traffic, a town's parked cars, and getting in and driving off. Note that `t.step()` switches the game to manual stepping, so after the first `step()`, advance time with `step()` rather than `wait()`.

### Done: R3, a life (commit fdeee63)
- **`src/rpg/game/`:** plain-data rules, no three.js.
  - `character.ts`: 6 attributes, 12 skills that grow by use, levels (`xpFor`), 24 perks, 6 backgrounds. `chance()` is the odds shown on every check.
  - `items.ts`: about 57 item definitions. Stacks can carry a one-off `name`, `desc` and `quest`.
  - `factions.ts`: 7 factions with rivals; `standing()` gives the words.
  - `Game.ts`: `GameState` (serialisable) and the `Game` rules: inventory, XP, practice/check, money, prices, reputation, memory (visited, met, pois, flags, bounty), needs `tick()` against the weather and your clothes, `sleep()`.
  - `quests.ts`: `offerFrom(resident)` makes jobs deterministically per resident every two days: missing (search a spot), debt, delivery, fetch. The main story is `startMain`/`advanceMain` (stages 0–6) over `mainPlaces()` (first town, a ruin, a city bank, a cold town's church).
  - `dialogue.ts`: node trees. `residentTalk`, `poiTalk` (services by door kind) and `staffOf(poi)`. A choice's `go()` returns a node, `null` (end) or `undefined` (handed off to the shop).
  - `economy.ts`: stock per door kind and day, what each buys, opening hours.
  - `saves.ts`: slots auto/1/2/3, a versioned envelope, `MIGRATIONS`, `repair()`, and the `SaveStore` interface (the platform layer swaps in console storage).
- **`src/rpg/Life.ts`:** owns the Game and the screens.
  - `resume()` loads the latest save before the world preloads, else sets `pendingCreator`.
  - Also: interactions (search, talk, go in), sleep, trains, autosave (150 s, new town, sleeping, searching), and the compass goal.
- **UI (`src/rpg/ui/`):**
  - `Creator` (live MH rebuild via `Rpg.setHero`, debounced), `Talk`, `Casefile` (tabs, LB/RB), `Shop`.
  - HUD: toasts, a goal marker and line, condition words.
  - Signs: `world/Signs.ts` puts enamel signs and lit doors on every POI (their own group per chunk, disposed on drop).
- **App:** overlay `'rpg'` (`host.panel(open, from)`). In RPG, map/archive open the Casefile. The creator uses the wardrobe's fitting camera and blocks back/Menu. The RPG clock pauses under any overlay. The controls strip has an `rpg` set.
- **Playtest:** `tools/playtest/rpg-life.mjs`. After a page reload the title focuses "Sound on", so the test moves to Enter, and waits 2 s on the mode select before confirming.

### Done: R4a, the wild (commit 4c69c5c)
- **`src/rpg/sim/animals.ts` + `animal.worker.ts`:** 11 species sculpted as SDF parts (body; head and neck; tail; upper and lower legs; wings for birds), meshed in a worker and coloured per vertex (back, belly, legs, face, tail tip, hooves). Proportions come from withers height, body length and chest depth. `SPECIES` also holds behaviour: notice distance, speeds, predator or prey, yield.
- **`sim/Wildlife.ts`:**
  - Spawns herds by biome (from `BIOMES[].wildlife`), 130–230 m out and not in towns; drops them past 330 m.
  - States: graze, walk, alert, flee, stalk, attack, dead, fly. Noticing you depends on speed, crouch (enabled in RPG), daylight, visibility and Stealth. Predators are bold at night or when hurt.
  - `alarm()` is called on gunshots; `hitTest()` and `damage()` handle hits; `carcass()` finds bodies to butcher.
  - Dev viewer: `/dev/animals.html?only=deer&walk=1`, captured by `tools/playtest/animals.mjs`.
- **Hunting and combat hooks:**
  - `Rpg.hitTest()` feeds App's `fire()` (fists and guns). The weapon in the RPG is `Life.weapon()`, the equipped item.
  - Guns need rounds from your pockets (`spendRound`). Weapon buttons holster or unholster (`App.rpgHolstered`).
  - `host.hurt` is where bites land. `App.die()` has an RPG branch, `Life.onDeath()`: you wake at the nearest clinic.
- **Life:** butcher (needs a knife; Survival check), a campfire (lighter → Casefile → "Make a fire"; `sim/Camp.ts` is a pooled `Lamp` via `Rpg.extraLamps`, with a cook/craft/rest menu), and fishing (`ui/Fishing.ts`: wait, strike, reel; catches by biome).
- **Playtest:** `tools/playtest/rpg-wild.mjs`.

### Done: R4b, dread and the road (commit 557ca7a)
- **`sim/Director.ts`:**
  - Dread (0–1) builds from night, the hour, being out of town, ruins, biome and story stage. It drops by a fire, in a car, and with Nerve or the Cold Blooded perk. It drives the `.dread` vignette (with a pulse above 0.72).
  - Scares:
    - the watcher (a pale, very tall `Figures` person, faintly emissive, who vanishes when looked at or approached);
    - lights (`director.dim` multiplies lamp gain);
    - whisper, footsteps, silence, radio.
  - First sightings go in the journal; four distinct ones reveal the "the-watcher" secret.
  - Roadside events: breakdown (a static `vehicleMesh` with hazard lights), wounded (wolves spawn at dusk), lost hiker, and an ammo box with lore notes. `interaction()` is checked first in `Life.interaction`.
- **`sim/Figures.ts`:** standalone RealHumans on the rig with looping clips, sitting and watching.
- **Playtest:** `tools/playtest/rpg-dark.mjs`.

### Done: R4c, violence (commit 25306e1)
- **`Populace`:** residents have hp; they flee, die, or chase. `hitTest`, `damage`, `scatter`, `witnesses`, `standDown`, plus `gone`, `wanted` and `onCatch`.
- **`Life`:** `violence()` (witnesses report once, via a `reported` set, costing Watch standing and adding a bounty), `gunfire()`, and `arrest()`.
- **Playtest:** `tools/playtest/rpg-fight.mjs`.

### Done: R4d, vehicles and cards (commit 7d92b73)
- **`Vehicles.ts`:** a `Tune` per vehicle (accel, vmax, steer, offroad), seat, reach, surface grip. `spawn(spec)` takes a mesh, tail lights, kind, tune and seat.
- **`Rpg`:** `parkCar`, `spawnCar`, and `carjack` (from `RoadTraffic.stoppedNear` and `take`), with a `TUNES` table. App's `carName()` and seat override.
- **Blackjack** at bars (in `dialogue.ts`).
- **Playtest:** `tools/playtest/rpg-drive.mjs`.

### Done: realism passes (the user's priority: "as realistic and epic as possible")
- **Faces (a1179d7):**
  - `tools/mh/textures.py` builds `public/rpg/mh/eye.png` (MakeHuman's eye, CC0) and `regions.png` (lips, lids, nails and thickness masks, from MPFB2, CC0).
  - Skin: pore normal map, regions, and thin-skin light transmission.
  - Brows are drawn in the skin shader (`BROW_FN`).
  - Eye: a real iris texture; the cornea is discarded.
- **Cloth:** weave, knit and leather normal maps (`normalTex`, `FABRIC_NORMAL`).
- **Sky light:** Poly Haven HDRIs via `@pmndrs/assets` (CC0), unpacked by `tools/assets/pmndrs.py` into `public/rpg/env/*.exr`. `Rpg.skyFor()` picks one by biome and hour, and `HDRI_GAIN` scales it every frame after the atmosphere.
- **Terrain micro-normals:** grit, cracked and rock maps in `Terrain.ts`, near material only.
- **Trees (bc6f694):** `world/RealTrees.ts` grows EZ-Tree trees (`@dgreenheck/ez-tree`, MIT) per kind within 75 m; the stand-ins take over beyond.
- **Ground cover and rocks (ee289d0):**
  - `world/GroundCover.ts` lays up to 46k grass blades on a ground-fixed grid within 28 m, with wildflowers. Its models come from the EZ-Tree demo, in `public/rpg/models`.
  - Scanned rocks replace rocks and boulders within 75 m (`RealTrees.loadRocks`).
  - `world/gltf.ts` is a shared Draco loader, with the decoder in `public/rpg/draco` (Apache-2.0).
- **Hair cards (in progress):**
  - `people/hairCards.ts` grows about 2,000 tapered cards per head from scalp roots, per cut. The ellipsoids are the neck and torso; the head itself uses its real surface via `onHead`. Short cuts hug the scalp; ponytail, bun and braids gather to ties.
  - `hairCardMaterial` uses a canvas strand texture. The old scalp shell remains as a darker, matte `hairCap` under the cards (still the whole cut for `buzz`).
  - Test with `SHOTS_LIST=face HAIR=long VIEW=front|side|back|top node tools/playtest/people.mjs`.
- **Necklines:** tops are cut along a smooth collar curve round the neck (`collarY`/`nearNeck` in `mh.ts`), and the edge is snapped onto it.
- **Credits:** everything is listed in `public/licenses/README.txt`.
- **Not reachable from the build container:** api.polyhaven.com, ambientcg.com and MakeHuman's asset servers (hair and clothes packs), so hair and clothes are grown in code.

### R5 (in progress)
- **Atlas (the Casefile's Map tab, and the map key in the RPG):** `rpg/ui/Atlas.ts`.
  - Land tiles are drawn in a worker (`atlas.worker.ts` + `atlasTile.ts`) straight from `WorldGen`: relief, water, forest, sand, rock, snow and towns. Cached per zoom, filled from the middle out.
  - Roads are drawn as vector lines on top. Settlements show once you've seen them and are named once you've been there.
  - Unexplored land is veiled. `mem.seen` holds the 400 m cells within one cell of wherever you've been (`Life.chart`).
  - Markers: jobs (diamonds), the story (a star), you (an arrow), and a pin.
  - The pin (`Life.waypoint`, saved in `mem.flags.wp`) takes over the compass until you're within 25 m.
  - Controls: stick, d-pad, drag or arrows to pan; LT/RT, wheel or +/− to zoom; A, click or Enter to pin; X to clear; Y or C to recentre.
  - The input arrives through the Nav scope's `pad` hook, which now runs for keys too.
- **Platform layer:** `src/platform/Platform.ts` with a web implementation only.
  - Save storage, milestones (`ACHIEVEMENTS`, toasts on the web), presence, suspend, and the account name.
  - `docs/platforms.md` covers the port plan through the official programs (no invented SDKs or costs) and the free-to-play fairness rules.
- **Playtest:** `tools/playtest/rpg-map.mjs`. Under SwiftShader the RPG draws about 1 fps, so the test holds buttons for seconds rather than tapping. `__stick` takes a stick number (0 or 1).
- **Controller pass:** `tools/playtest/rpg-pad.mjs` drives every RPG screen with the virtual pad alone (creator, all Casefile tabs, pockets, a conversation, a shop, the pause menu and Archive). It checks for focus with the ring, that the d-pad moves, that A acts and that B gets out.
  - **Found and fixed:** the Nav ignored a layer while it faded in (`checkVisibility` with opacity), so an A pressed during the fade was lost. That's why "Let's trade" did nothing on the pad. Screens now take the pad from their first frame.
  - The Casefile's You and People rows are focusable. Places rows are buttons: A pins the place and the compass follows it.
- **Freezes (see the "Fix freezes" commit):** `tools/playtest/rpg-perf.mjs` profiles travel (updates only, long tasks, CPU profile, mid-trip shader compiles). Set `RENDER_EVERY=45` to also catch compiles.
  - Terrain fields are sampled in workers (`field.worker.ts`).
  - Chunks are built a block at a time.
  - GeoBatch appends into arrays.
  - Grass is tiled and cached.
  - Trees, rocks and grass are compiled with `compileAsync` and prepared behind the loading card.
  - Journal plates use an async readback and are encoded in `plate.worker.ts`.
- **Finding the way (the user couldn't find the ferryman):** `rpg/ui/GoalMarker.ts` is a world-space marker for the tracked job. It's a light column over a place or a diamond over a person, with a screen label clamped to the edge.
  - `Life.goal()` follows a person by their hours even when they aren't embodied (`whereIs`).
  - `Populace.pinned` keeps quest people out of doors.
  - Main-story stage 1 names an informant (`quests.informant`).
  - Test: `tools/playtest/rpg-ferry.mjs`.
- **Roads:** dry dips get embankments (bridges only over water or valleys deeper than 30 m, and no short runs). The ground is sunk 0.55 m under the carriageway. The road surface is a deck you stand on.

### R6: checklist and soak
- `docs/rpg-checklist.md` maps every system to its test.
- `tools/playtest/rpg-all.mjs` runs them all, one browser at a time. Running them together ran out of memory. Use `SKIP=rpg-soak` for a quick pass.
- `tools/playtest/rpg-soak.mjs` simulates MINUTES (default 60) of play: a loop between the story's towns at driving speed, walks, and the Casefile and map. It samples heap, GPU objects, programs, chunks, collision, people and traffic every minute. It compares the 2nd and 3rd loops of the route for leaks.
- `enterRpg(t)` in `tools/playtest/lib.mjs` enters the RPG and checks that it started. Use it in new tests.

### Still to build (the addendum's list)
- **R2 leftovers:** more landmark kinds.
- **R3 leftovers:** combat-based jobs (bounties), owned vehicles in saves, the Places tab becomes the atlas in R5.
- **R4 remaining:** boats outside District 03, parkour, more minigames (arcade), more secrets.
- **Realism next:** looser clothes (the tops and trousers are still close to the body), far trees, town street detail.
- **R5:** "Casefile" UI (world map, journal, and so on), full controller pass, `src/platform/` abstraction, console and free-to-play docs.
- **R6:** the full playtest checklist and a 60-minute soak.

## Four modes, controllers, people (2026-09-24 → 2026-09-28)

### The mode architecture
- `src/modes/rules.ts`: one `ModeRules` record per mode (crowd, traffic, police, crime, quests, unease rate, combat kind, emotes, photo, shared city, the title-shot preview). `App.applyRules()` applies them to the same simulation. There are no separate games. `App.applyRulesFor('city')` puts the ordinary city back behind the title after a match.
- The mode select (`ui/ModeSelect.ts`) cuts the title camera to where each mode happens as you move between them (shots 5 and 6 in `CinematicCamera`).
- Per mode, the lighting gets a sky-fill boost and a character readability fill (`TimeOfDay.fillBoost`, `charFill` in `FigureBatch`): Warzone 1.9, Fight 1.35, City 1.12.
- `App.warmUp()` compiles **and draws once** everything a match will show (tracers, blood, pickups), behind the intermission card. It compiles into the composer's HDR target, because compiling for the screen produces a different program. Without it, the first shot stalls the GPU.

### FIGHT (`modes/Fight.ts`, `modes/fight/*`, `anim/fightClips.ts`, `ui/FightHud.ts`, `styles/fight.css`)
- The arena is the crossing at (0, 54), radius 6.2. `Traffic.hold()` parks the four pooled cars at the lights with their drivers watching, and 18 spectators stand in a ring (they hide when they'd block the camera).
- Frame data runs at a fixed 60 Hz in `moves.ts` and **must match the clips** (the `hit` key is the first active frame). Hitstop freezes both fighters' animation clocks (`Fighter.tick()` runs inside the fixed step).
- Moves: light string (jab → cross → hook), heavy (neutral overhand, → roundhouse, ↑ launcher, ↓ sweep), air punch and kick, special (EX with a bar of meter), throw and throw tech, block, parry (a block pressed ≤ 6 frames before the hit), guard meter and guard break, sidestep (beats narrow arcs), backstep, juggles with decay, knockdown and get-up, combo scaling, and a breaker (dodge in a combo, costs a bar).
- Rounds are best of three with a 60 s clock. A KO triggers slow motion; the deciding round offers "Finish it" and a three-hit finisher (the special near a dizzy opponent).
- The CPU (`FightAI.ts`) has a reaction time, spacing, punishes, combos and three levels. For local versus, **hold A on a second pad**. Player one is keyboard plus *their* pad (`Input.controlsWith`), so the second player's presses never drive them.

### WARZONE (`modes/Warzone.ts`, `modes/warzone/*`, `ui/WarzoneHud.ts`, `styles/warzone.css`)
- Domination in Pier 9 Yard. The bounds (x 40–101.5, z −28–60.5) are invisible collision walls added on start and removed on stop. The points are A (92, −20), B (68.5, 9) in the middle gap, and C (46, 44). Blue spawns south-west and Red north-east. The first team to 150 wins (1 point per held point every 2 s), with a 6-minute clock.
- The bots (`Soldier.ts`) move on a 0.5 m `NavGrid` (A* with string-pulling) built from the yard's collision. Each one leans towards a point, needs line of sight plus a reaction time before firing, strafes, crouches at range, bursts, reloads, falls back when hurt, and turns on whoever shot it. Accuracy against the player scales with the difficulty (Recruit / Regular / Veteran).
- Guns (`weapons.ts`): carbine, SMG, marksman rifle, shotgun and pistol, in four loadouts. Each has damage falloff, headshots, hip and ADS spread, bloom and recoil (the camera kicks and mostly settles). Armor soaks 60 % until it's gone, health regenerates out of the fight, and there are ammo and armor stations plus drops from the dead.
- **First person by default** (`Viewmodel.ts`): the gun and gloved forearms ride the camera with sway, bob, kick, reload dip and swap. Aiming lines the sight up just under a dot. D-pad ↑ / V switches to over the shoulder, and death always uses the third-person camera. The first-person pitch range is ±1.3 (`FollowCamera.pitchMin/Max`).
- Aim assist is pad only: slowdown over a visible enemy, plus a settle onto one when the sights come up.

### CITY and AFTER HOURS
- After Hours adds headphones (radio on foot, D-pad ←/→), plus pause-menu switches for the weather and for holding the hour (reset when you leave the mode), and photo mode. The City keeps everything it had.
- Photos: `core/photos.ts` (IndexedDB, newest 48). They appear in the Archive under **Your photographs**, with a delete option.

### Controllers and the interface (`input/*`, `ui/Nav.ts`, `ui/Osk.ts`, `styles/controller.css`)
- Actions and bindings are remappable per device (localStorage `nightfall.bindings.v1`). `glyphs.ts` shows the right Xbox or PlayStation button everywhere and follows the last-used device.
- `Nav` gives every menu spatial controller navigation: LB/RB tabs, B back, sliders and selects on the D-pad, and an on-screen keyboard for text. The pause menu is mode-aware: in a match it hides the map and wardrobe and offers Leave the match; it has the After Hours switches and Microphone in a room, and it fits 540p at TV size.
- The emote wheel (hold ↓) has 4 pages: 3 of emotes, plus **Say**, which is quick chat with a gesture. Its last slot, Type…, opens chat with the on-screen keyboard. Gestures sync to other players (`WIRE_EMOTES`).
- Rooms have a readable code (abcde-fghij). Invite shows it, and the title's **Join a friend** takes it through the on-screen keyboard (it only appears when multiplayer is configured, i.e. on Vercel).

### People and animation
- `entities/anatomy.ts`: sculpted heads with 14 face morphs, hair and hats, facial hair, hands in grips, shoes, and garments with morphing torsos. `data/people.ts` defines 16 archetypes (commuter, courier, nurse, taxi, police, soldier, fighter…) with personas.
- `anim/*`: pose channels, the `Animator` (layers, fades, masks, additive, mirroring, events, `stay`), clips, and `IdleDirector`. `stay` clips hold their last frame and **never** fade on their own; this was a bug that stood the dead back up.

### Playtests (headless Chromium + SwiftShader, a virtual pad)
- `tools/playtest/*.mjs`: `menus`, `characters`, `city`, `fight`, `fight-exit`, `fight-pause`, `warzone`, `afterhours`, `modes` (all four, controller only, real time), and `tour` (lighting tour). Run them with the dev server up: `node tools/playtest/fight.mjs`. Screenshots go to `captures/playtest/`.
- They step on game time with `nf.devStep(frames)`. CSS transitions don't advance while the render loop is stopped, so wait in real time (or call `nf.realtime()`) before pressing into a menu that fades in. SwiftShader can take tens of seconds on the first draw of something new, so screenshots have a 240 s timeout.

### Open items
- The yard is still dark between the stacks, even with the boost. It could use a few more floods on the gantry legs.
- The Warzone bots don't use grenades or cover points; they strafe in the open.
- Fight mode has no move list screen (the controls strip shows the inputs for the first 14 s).
- Teammate name tags overlap at spawn.
- The GitHub repository's social preview has to be uploaded by hand: Settings → General → Social preview → `docs/media/social-preview.jpg`.

## Vehicles (2026-09-23)

**Drive.** Four parked cars are drivable: avenue (-7.4,-64), (-7.4,22) and (7.4,92), plus market (-76,49.3). They're marked `{ drive: true }` in the builders.
- `parkedCar(..., { drive })` skips the merged mesh and static collider, and pushes to `ctx.cars` instead. `entities/Vehicles.ts` simulates them:
  - A bicycle model with speed-sensitive steering. VMAX is 21 m/s (about 75 km/h) and reverse 6 m/s.
  - Three collision circles against the city boxes. Kerbs are climbable (step 0.35). People and traffic count as hard obstacles.
  - An impact above 3 m/s shakes the camera and thumps via `audio.land`.
  - Headlights and tail lights are on only while occupied.
- [E] within 1.4 m gets in, and [E] gets out. At speed, the car brakes to a stop first (`leaving`).
- Cars stay wherever you leave them. That isn't saved; they reset on reload.

**Ride.** `Traffic` car 0 is an amber taxi with a lit roof sign.
- **Hailing:** stand still at the kerb 1.8–8 m to the side of its lane, up to 35 m ahead, and it pulls in beside you. It waits 10 s, then leaves with a 25 s cooldown.
- **Riding:** [E] gets in, and the chase camera follows it along its route. [E] again means "stop here". It also stops on its own 40 m before its route leaves the district.
- **Stepping out:** you're set down 2 m out on the kerb side. Closer than 1.8 m and the taxi won't drive off, because it brakes for you.
- **Camera:** `FollowCamera.updateVehicle` is a chase camera. Mouse look still orbits, and it swings back behind the car 1.2 s after the mouse stops.
- **While you're inside:** the player's figure is hidden (`Player.hidden`) and `player.pos` tracks the car, so discovery, lighting, the map and saves all keep working.
- **Verified by stepping frames in the browser:**
  - Entering, then 8 s of throttle takes you 0 → 19.8 m/s down the avenue.
  - A crash into a building stops the car. On exit you land on clear pavement.
  - Hail → the taxi stops beside you at 4 m → ride 43 m → "stop here" → it stops within about 1.5 s → you step out on the kerb side → the taxi drives on.
- **Reactions (Crowd.threat / hear):** a car bearing down on someone makes them flinch, step about 1.5 m out of its line (once per scare), stop, and turn to watch it go for about 4 s. A horn turns heads within 26–30 m. The `stare` figures, the watcher and the frozen never react. Passing traffic also counts as a threat at 60% of its speed.
- **Traffic.** It brakes for you, your car, **and any drivable car left in its lane** (`blockers`). If it's held up for more than 2.2 s it honks (one long blast or two short ones), then again every 4–8 s. The passing cars are solid to you on foot.
- **Brake lights:** each traffic car and drivable car has its own tail-light material. It glows 4 normally and 11 when braking, and the tail lamps' light gain is 2.6× when braking.
- **Horn:** **H** while driving (`audio.hornVoice`, two detuned saws). A crash plays `audio.crash`, a burst of noise plus a thump.
- **Verified by stepping frames:**
  - The flinch, the step-aside and the settling afterwards.
  - Horn listeners turn, and the stare figures ignore it.
  - A traffic car stops 5.2 m behind a car left in its lane, with brake lights at 11, honks after about 2.2 s, and drives off (brake lights back to 4) once the lane is clear.

## Car radio (2026-09-23)

**R** in any car or taxi goes to the next station, **Shift+R** the previous one, and past the last station it turns off. See `audio/Radio.ts`.
- **Presets:** nine SomaFM channels (commercial-free, listener-supported; they allow CORS). Now-playing comes from `somafm.com/songs/<id>.json` every 30 s and shows in the HUD hint.
- **Settings → Car radio:** a volume slider (`settings.radio`), plus a search of the **Radio Browser** directory (`de1.api.radio-browser.info`, https MP3/AAC only). Search by name first, then by tag. Saved stations go in `localStorage` `nightfall.radio.v1` and join the dial. Playing one reports a click to Radio Browser, as their API asks.
- **The set lives in the car** you turned it on in. It keeps playing there after you get out: filtered and positioned at the car, falling off with distance. It goes off when that taxi leaves the district, or when you leave the world.
- **Two playback paths:**
  - Stations that allow CORS are routed through Web Audio: filtered, positioned, and muffled by the pause menu.
  - Stations without CORS fall back to a plain `<audio>` element, with level and distance done by hand. Many directory stations are like this.
- **Verified:**
  - Web Audio path, using Radio Paradise: a real signal (RMS 0.17) through the graph.
  - Fallback path, using a US jazz station from the directory: it plays, and the volume falls to 0.07 at 30 m.
  - Search for "jazz" and "tokyo" returns real stations; Add and Remove work.
- **SomaFM quirks:** SomaFM **returns 403 to the in-app Claude browser** (its user agent contains `Claude/`) **and to requests with a `localhost` referrer**. The audio elements send `referrerpolicy=no-referrer`, and normal Chrome, Edge and Firefox get 200, but the presets can't be heard in the in-app preview pane.
- **Not integrated:**
  - **Spotify** needs every player to have Premium and sign in with Spotify, and the owner to register a Spotify developer app (client ID).
  - **YouTube** requires the player to stay visible, so it can't be a hidden car radio.
  - **SoundCloud** plays through its visible widget, and new API access needs an approved app.

## Electric cars with a screen (2026-09-23)

Two of the drivable cars are **electric**: pearl white, and marked `{ drive: true, screen: true }` (avenue (-7.4,22) and market (-76,49.3)). The prompt calls them "Electric car".
- **The screen** (`ui/CarScreen.ts`): a real **YouTube IFrame player** (youtube-nocookie host) on the dash.
  - It's shown small in the bottom-left corner while a video is loaded and you're in that car. YouTube's rule is that embeds stay visible and at least 200 × 200, so it never shrinks below 356 × 200, even on phones.
  - **V** opens it big. That releases the mouse (`intentionalUnlock`, so it isn't treated as a pause) and stops the car taking input.
  - Paste any watch, share, shorts, live or embed link, a playlist, or a bare video id (`parseYouTube`). There are two quick picks, Lofi Girl's lofi and synthwave radios.
  - **V**, **Esc**, "Back to the road", or clicking the view closes it.
- **Behaviour:**
  - Volume follows Settings → Radio × Master, ducked to 30% under menus.
  - It pauses when you get out and resumes when you get back in.
  - Starting a video turns the radio off, and **R** pauses the video.
  - Error codes are shown in words (`ERRORS`).
- **Verified in the browser:**
  - The prompt reads "Electric car".
  - E, then V, opens the screen. A pasted link loads and plays a real YouTube video. It collapses to the corner while you drive, and hides when you get out.
  - V does nothing in ordinary cars.
  - The in-car prompt no longer shows through the open screen.
- **Unverified:** Lofi Girl's streams return **error 150** in the in-app preview browser, although YouTube's oEmbed says they can be embedded. It's probably the preview browser; check on the published site in a normal browser. Other videos play.

## Repository (2026-09-24)

- GitHub: https://github.com/shipking-ai/nightfall (**private**; `gh repo edit shipking-ai/nightfall --visibility public --accept-visibility-change-consequences` makes it public). The branch is `main`, and git is set up in this folder.
- The README's banner and gallery live in `docs/media/`. They're made from dev captures (`/__capture` in vite.config.ts writes to `captures/`, which is gitignored) by a PIL script: crop and darken the hero shot, set NIGHTFALL in Georgia, and resize the screenshots to 1600 px wide.
- Ignored: `.env.local`, `.vercel`, `captures/`, `screenshots/` (old logs and PowerShell scripts), `.claude/`. The only key committed is Supabase's publishable key in `server/wrangler.jsonc`, which is public by design.
- There is no LICENSE yet (all rights reserved by default); that's the owner's choice.

## Roadmap (owner's list, 2026-09-23), in build order

1. ~~Realistic rain~~ and ~~shared traffic and NPCs~~: **done** (below).
2. ~~Accounts~~: **done** (below). Owner TODO: dashboard URL settings and Google client.
3. ~~Character customization~~: **done** (below).
4. ~~Interiors~~: **done** (below). There are five rooms; more can be added with the same pattern.
5. ~~NPC voices and reactions~~: **done** (below).
6. ~~Side quests~~: **done**.
   - Code: `data/quests.ts` (the 4 quests), `systems/Quests.ts` (the logic; progress is kept as `q:*` save flags), `world/builders/givers.ts` (quest givers), `fx/QuestMarker.ts` (the marker), and `Hud.objective` (the tracker).
   - Verified: all 4 quests, including the timed fail and restart.
7. ~~Combat~~: **done**.
   - `systems/Combat.ts` has fists, pistol and SMG, plus health and heat 0–5.
   - Crowd: `hitTest`, `damage`, `scatter` (panic), dead bodies that revive after 45 s, and 6 foot police (`mode 'cop'`, left out of city snapshots).
   - Visuals: `fx/Tracers.ts` for shots; `fx/Blood.ts` for sprays and pools (the Settings "Blood" toggle).
   - Death respawns you at the pharmacy. **Jail:** a cop within 1.7 m while you're slow for 1.1 s busts you into the `jail` interior at x 1400. The sentence is 30–90 s; `App.arrest`/`serveTime` handle it, and the gate is locked until it's done.
   - PvP travels as `sh` events.
8. ~~Admin~~: **done**.
   - Open with ` or F10, or Esc → Admin tools. Staff only (profiles.role; the owner's account is admin), and any dev build.
   - `ui/AdminPanel.ts` has the You, World, Players, Stats and Content tabs.
   - Room-wide actions go through the room server, which verifies the Supabase token/role (`ADMIN_ACTS`, including `jail`). Kick closes the socket with 4001; ban uses 4003 plus the `nf_admin_ban` RPC.
   - Migration `20260923200000_nightfall_admin.sql` (bans, find, stats, world_notes).
9. ~~Chat~~ and ~~mics~~: **done**.
   - Chat: `ui/Chat.ts` (T/Enter). It travels as `ch` events (rooms, Firebase, Convex, Supabase).
   - Voice: `net/VoiceChat.ts` sets up a WebRTC mesh; the lower id offers, and ICE is not trickled. The signal travels as `rt` over the rooms server only (MAX_SIGNAL_BYTES 12000). Voices are positional (HRTF, up to 45 m); N toggles your mic; a speaking player's name lights up. It uses STUN only, no TURN. **Not yet verified with two real mics.**
10. ~~Infinite world~~: **done**. `world/Outskirts.ts` builds endless streets east and west past |x| = 150, in 80 m seeded slices (±3 kept; `Collision.remove` drops them). The ground and water planes follow you. The district is "The Outskirts" (unmapped). There's no traffic or crowd out there, and the lamps give no light, by design.
11. Figures: fuller torso and shoulders, thicker limbs, fingers and a thumb, a rounded shoe, and relaxed arms (`Humanoid.ts`).
12. The car screen picks are embeddable lofi streams (Lofi Girl's jfKfPfyJRdk refuses embeds, error 150).
13. **Phones and tablets**:
   - Controls: `ui/TouchControls.ts` shows on touch-only devices (`isTouch()`: a coarse pointer and no fine one). The left thumbstick drives WASD, and pushing past its edge runs. Drag anywhere else to look. The right-hand cluster switches between on foot (Fire, Aim, Jump, Weapon, Reload) and in a car (Brake, Horn, Radio, Screen). Use (E) is labelled with the current prompt. The top row has Pause, Map, Chat, Mic and Admin. Buttons send synthetic KeyboardEvents, so the game code is unchanged.
   - `Input.touch` means there is no pointer lock (`locked` is always true).
   - **Gotcha:** `#ui` has `pointer-events: none`, so `.tc.is-on` must set `pointer-events: auto`.
   - Touch devices default to Low quality with shadows off.
   - The HUD moves off the thumbs (`.is-touch` rules), and the pause menu stacks on small or short screens.
   - Verified in mobile and tablet emulation: stick, sprint, look, fire, weapon swap, pause, settings, and hit-testing. **Not yet verified on a real phone.**
14. **River**:
   - `entities/Boats.ts`: 3 moored launches. "Step aboard" works from the promenade (z 160.5–163.3). WASD drives, Space brakes, E steps off (onto the quay if alongside, otherwise into the water). App's `boat` state works like a vehicle.
   - Swimming lives in `Player.update`: `inRiver()` at y < -0.5. You float at the water level minus 1.32; Space near the quay wall climbs out.
   - "Dive in" at the rail (not on the bridge).
15. **Police escalation**:
   - `entities/Police.ts`: 2+ stars sends 1 patrol car (4+ stars sends 2). Cars drive down the nearest road line (`roadFor`), park 9 m short, and deploy 2 officers each (`Crowd.deployCop`).
   - 3+ stars brings a helicopter that orbits at 36 m with a SpotLight (always in the scene; intensity 140 when on) and a beam cone. At 4+ stars it fires. It can be shot down (260 hp), with a 60 s cooldown.
   - Sound: `AudioEngine.heli()`.
16. **Criminals**:
   - 4 `crook` NPCs sit after the police in `Crowd.npcs` (`crooksFrom`), and are left out of snapshots.
   - Every 55–105 s (only when you're not wanted), `crooksUpdate` starts a mugging (walk up, grab, the victim shouts `robbed`, then flee) or a 2-person gang (loiter; turns hostile within 11 m).
   - Catching up or shooting makes them hostile, and they shoot back (`onCrookShot`).
   - Hitting criminals is no crime; stopping one takes -1 heat.
   - Verified in the browser.

## NPC voices and reactions (2026-09-23)

- **Voice synthesis:** `src/audio/Voice.ts`. Each person's voice is procedural: a sawtooth plus breath noise goes through three formant band-passes that glide between vowels, one syllable at a time, with consonant noise bursts. Syllables come from the text. A question rises at the end; an exclamation jumps.
  - Moods: calm, warm, annoyed, scared, odd, murmur.
  - `randomVoice(rnd, height)` gives each NPC a pitch, tract, rate and breath, drawn from a **separate** RNG (`Crowd.voiceRng`), so adding voices didn't change anyone's outfit.
  - Played through `AudioEngine.say(voice, text, mood, pos)`, which uses an HRTF panner at head height.
  - Measured offline: peaks between -14 and -23 dBFS, no NaNs.
- **Lines:** `src/data/barks.ts`. Kinds are bump, nearMiss, honked, stared, crash, talk (varies by NPC mode; replies get shorter the more you talk to someone; a rain line when it's wet), and chatter (murmured, never subtitled).
- **Triggers (`Crowd`):**
  - `listen()`, every frame, local to each client:
    - walking into someone at speed → bump, with a small shove;
    - looking straight at someone within 5 m for 3.2 s → stared;
    - pairs in `talk` mode murmur when you're within 10 m.
  - `threat(…, byPlayer)` → nearMiss, only for your car.
  - `hear(…, byPlayer)` → one nearby person answers your horn.
  - `shock(x,z)` on hard impacts → crash.
  - Per-NPC cooldown `sayCd`, plus a global `hush`, so the whole street doesn't talk at once.
- **Talking:** `Crowd.nearestTalker()` (within 2.1 m, in front of you) shows the prompt "Someone/Stranger · E Talk" when no interaction spot wins. `Crowd.talk()` makes them turn to you. The hotel clerk (`stare`) and the watcher have their own lines.
- **Subtitles:** `Hud.bark(text, who?)` is a separate quiet line above the main caption. It never interrupts interaction text.
- **Verified in the browser:** talk (including escalation), bump, stare, horn answer, the prompt, and the subtitle layout.
- **Multiplayer:** barks are per client. The host shares NPC positions, but what they say to *you* is computed locally. Not synced, by design.

## Interiors (2026-09-23)

- **Where:** `src/world/builders/interiors.ts` (rooms, doors, `INTERIORS`, `interiorAt()`, `interiorById()`, `STAIRWELL`) and `src/world/interiorTextures.ts` (canvas signs and boards). The build step runs at 0.92 in `City.ts`.
- **How it works:** each room is built far off the map, at x ≥ 1000 (hotel 1000, launderette 1080, deli 1160, pharmacy 1240, stairwell 1320; z 1000). The street door is an interaction spot `enter:<id>`, and inside there is `exit:<id>`. `App.goInside`/`goOutside` fade to black and teleport you. `setInside()` hides the rain group, switches the renderer to indoor bloom/exposure (`Renderer.setIndoor`), and the HUD shows the room's name. Discovery district updates are skipped while you're inside, and `forgetDistrict()` makes the street name show again when you leave.
- **Rooms:**
  - Hotel Meridian lobby: the clerk stares; the bell rings; guest book; lift stuck on 13. Unlocks `night-clerk`.
  - Launderette: machine 7 always has 12 minutes left; a notice.
  - Kowalczyk & Sons deli: a clock stuck at 3:17; the order book.
  - Pharmacy: a bag with your name on it.
  - No. 7 stairwell: climbing past the top landing quietly drops you one storey, and the floor numbers keep counting up. `App.stairwell()` handles this, and it resets when you leave.
- **Saving:** a save made indoors restores you indoors, because `interiorAt()` runs on load and every frame.
- **Lighting rules learned the hard way:**
  - Keep point lights at least 0.6 m below the ceiling, or the ceiling blows out.
  - Use `halo: 0` and `streak: 0` indoors.
  - Walls should stay mid-grey or darker.
  - `FollowCamera.snap(player, collision)` must get the collision, or the camera spawns outside the room behind the door wall.
- **Verified in the browser:** all five doors work in and out; rain is hidden indoors; stairwell climb and loop work; the HUD labels are right; each room was screenshotted after the lighting pass.
- **Adding a room:** copy one block in `buildInteriors`: call `room()`, add props, lamps, and `ctx.point` spots, then `def({...})`. Add it to `DOORS` and add the `enter:`/`exit:` entries to `src/data/interactions.ts`.

## Character customization (2026-09-23)

**Wardrobe** (`src/ui/WardrobeView.ts`, with `src/entities/Look.ts`). Open it from **Pause → Wardrobe** or **Title → Wardrobe** (from the title, the figure is brought out at SPAWN for the fitting).
- **Options:** 8 garments, 8 hair styles (including hood and shaved), 18 coat colours, 8 trousers, 8 hair colours, 8 skin tones, 8 accents (scarf / hat / bag), scarf and bag toggles, and sliders for height, build and shoulders. There's also "Surprise me".
- **Live preview:** each change is worn at once. The portrait camera faces the figure, framed left of the panel (on phones the panel sits at the bottom and the figure is framed high). A soft `fitLight` by the camera lights the face; it's always in the scene with intensity 0 otherwise, so the shader's light count never changes.
- **Saving:** Done wears the look (`App.wearLook`), which updates the player, `mp.setLook` (in `nightfall.me.v1`) and the account's `profiles.look`. Cancel or Esc puts the old look back. At sign-in the account's look wins, and a guest's look is uploaded the first time.
- **`Look.ts`:**
  - `cleanLook()` validates everything that comes from outside: enums, 24-bit colours, clamped ranges.
  - `outfitFromLook` and `bodyFromLook` map a look onto the Humanoid.
  - `defaultLook()` is the original charcoal coat.
  - Body height is now applied to the player's root scale (it was ignored before).
- **Multiplayer:** members carry `look`. The room server keeps only flat, short keys (`cleanLook` in `server/src/index.ts`); a live test showed the look relayed intact with junk fields dropped (`server/test/look.mjs`). Firebase rules have a `members/$id/look` node, and Convex `members.look` is limited to 600 chars. `Remotes` re-dresses other players when their look changes, including their build and height.
- **Verified in the browser (desktop viewport):**
  - Raincoat/hood and jacket/beanie render on the figure, with the face lit.
  - Done saved to localStorage and multiplayer, and returned to the title with the letterbox back.

## Accounts (2026-09-23)

Supabase Auth, optional: **guests play exactly as before**. Code in `src/net/Account.ts`. `@supabase/supabase-js` is lazy-loaded, only when there's a stored session (`nightfall.auth`), a sign-in link or Google return in the URL, or the form is used.
- **Ways to sign in:** email and password (`signUp` / `signIn`), a magic link (`signInWithOtp`), and Google (`signInWithOAuth`). All use PKCE. `?code=` is exchanged at boot and removed from the URL; `?room=` is kept.
- **UI:** Settings → **Account**, the first section. Supabase error messages are reworded in the game's voice (`friendly()`).
- **Database** (migration `supabase/migrations/20260923140900_nightfall_accounts.sql`):
  - `profiles`: id, name, look (jsonb), role (player / moderator / admin), banned. It's created by a trigger on signup.
  - `account_saves`: one row per user.
  - `nf_is_staff()`.
  - RLS: you read and update only your own profile, and only `name`/`look` are grantable; staff can read all profiles.
- **Verified:**
  - As a fake user in a rolled-back transaction: 11 checks, including that you can't make yourself admin, can't rename others, can't write others' saves, and that a default name is used when none is given.
  - The real sign-in with a wrong password shows the friendly message.
  - A real signup wasn't tested, because it would send a real email.
- **Signed in:** the profile name becomes your multiplayer name, and renaming in Together also updates the profile. The account save is merged at sign-in and written 5 s after changes. A banned profile is signed out with a message.
- **Make someone an admin:** `update profiles set role = 'admin' where id = (select id from auth.users where email = '…');`
- **OWNER TODO (Supabase dashboard; there's no API access for this here):**
  1. **Authentication → URL Configuration.** Site URL: `https://nightfall-sand.vercel.app`. Redirect URLs: `https://nightfall-sand.vercel.app/**`, `https://*-matt-smiths-projects-4e410eda.vercel.app/**`, `http://localhost:5317/**`, `http://localhost:5329/**`. Without these, confirmation and magic-link emails point at localhost:3000.
  2. **Google:** in Google Cloud Console, create an OAuth client (Web) with the redirect URI `https://ueypttzxedsbnbrsmena.supabase.co/auth/v1/callback`. Then enable Authentication → Providers → Google in Supabase with that client ID and secret.
  3. Optional: custom SMTP (Authentication → Emails). Supabase's built-in sender only sends a few emails an hour.

## Rain audio (2026-09-23)

`src/audio/Rain.ts` replaces the two filtered-noise layers. There are five loops, rendered once when sound starts (about 0.4 s):
- **drops:** about 2,600 impacts a second, each a tiny damped ring from 1 to 8 kHz, with power-law sizes and stereo scatter.
- **plinks:** puddle bubbles, a rising Minnaert chirp.
- **wash:** pink noise.
- **distant roar:** low-passed pink noise.
- **runoff:** gurgling gutters.

Levels follow rain intensity. `AudioEngine.setShelter(0..1)` low-passes everything except the distant roar. App sets it from an upward raycast from the player's head (any roof within 14 m).

Measured offline: drizzle −36 dB RMS, moderate −28, downpour −24, no clipping. Under a roof the brightness drops from ~2.9 kHz to ~530 Hz. **Not listened to by a human yet.**

## Shared city (2026-09-23)

In a shared room the **host** (the earliest arrival, `mp.hostId`) runs the crowd and traffic and sends a `cy` snapshot every 0.5 s: `{ n: Crowd.snapshot(), c, r: Traffic.snapshot() }`.
- **Crowd snapshot:** walkers as `[s, dir, lateral, v, flags, wrongYaw]` along their route, everyone else as `[x, z, yaw, 0, flags, wrongYaw]`. The flags are visible, frozen and glitch.
- **Traffic snapshot:** `[route, s, v, taxi flags]`, plus the rider ids.
- **Followers** (`puppet = true` while snapshots are under 3 s old) run `Crowd.follow` and `Traffic.follow`: they dead-reckon along routes and ease into each snapshot. If the host goes quiet, a follower runs its own city.
- **Host migration:** a new host continues from the snapshot state, which is why walkers carry `s/dir/lateral` rather than just coordinates.
- **What the host does for everyone:** it brakes for and hails the taxi for every player (`remotes.walkers()`), and treats every remote driver as a threat to the crowd and a blocker for traffic.
- **Taxi:** it's shared. A follower's board, stop and alight go to the host as `tx`; `TaxiState.riderId` says who's riding, and a remote rider's figure is hidden inside it (`Remotes`).
- **Networks:** new events `cy` and `tx` on all four networks. The room server's `MAX_BYTES` is now 4096. Firebase has a `rooms/<room>/city` node with rules, and `tx` is allowed in `ev`. Convex has a `cities` table, the `rooms:city` mutation, and `city` in the `rooms:room` query, swept by the cron.
- **Verified with two tabs on the room server:**
  - Applying the host's exact sent snapshot put **36/36 people within 0.32 m** and **4/4 cars within 0.15 m** of the host's positions.
  - Live delivery arrived within about 0.45 s.
  - The host's taxi pulled in for the follower. The follower boarded (the host's `riderId` equals the follower's id), rode it, asked to stop, got out 1.2 s later, and the taxi drove on with no rider.
  - Test harness note: background tabs barely tick, so both tabs were driven with `setInterval`.

## Multiplayer (2026-09-23)

Friends can share a night. See `src/net/Multiplayer.ts` and `src/entities/Remotes.ts`.

**Our own room server (primary)**, in `server/`: a Cloudflare Worker with **one Durable Object per room** (SQLite-backed, so it runs on the **free Workers plan**). It uses the WebSocket Hibernation API.
- **Deployed:** https://nightfall-rooms.nightfall-rooms.workers.dev (the owner's Cloudflare account; Wrangler is logged in on the dev machine). `/health` returns `ok`.
- **What it does:** it relays only `st`/`hn`/`pk`/`ck`, and stamps each with the sender's server-assigned id, so nobody can pose as someone else. It sends `welcome`, `join` and `leave` itself.
- **Limits:** 1 KB per message, 15 messages a second per player (bursts of 30), 16 players per room. Names are cleaned. Only allowed origins can connect (`ALLOWED_ORIGINS` in `server/wrangler.jsonc`: the production site, this project's Vercel previews, and localhost 5317/5329/4173).
- **Commands:** deploy with `cd server && npx wrangler deploy`. `node server/test/relay.mjs` runs 10 live checks (all passed 2026-09-23): welcome, join, relay with the true sender id, name cleaning, no echo, unknown types dropped, a flood capped to 30 of 80, leave, foreign origin refused.
- **Client:** the client uses it when `VITE_ROOM_SERVER` is set (`.env.local` and the Vercel env).
- **Free-plan budget:** 100k requests a day and 13,000 GB-s a day. A busy room uses about 450 GB-s an hour, so roughly **29 room-hours a day free**. It resets at 00:00 UTC.

**Backup chain (2026-09-23):** the order is **rooms (Cloudflare) → Firebase Realtime Database → Convex → Supabase Realtime**. Each network sits behind one interface (`src/net/types.ts`), with one file per network in `src/net/transports/`.
- A network is used only if its env vars are set (`CHAIN` in `Multiplayer.ts`). The backups are code-split: they're downloaded only when reached, so the main bundle got smaller (242 → 227 KB gzip).
- **Moving on:** a network is skipped if it hasn't connected within 8 s, its WebSocket keeps dropping, or 3 writes in a row fail. Late callbacks from an abandoned network are ignored (`generation`).
- **Firebase:** code in `transports/firebase.ts`. Rules are in `firebase/database.rules.json`: rooms only, a strict shape, and every node removed on disconnect. Env: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_DATABASE_URL`, `VITE_FIREBASE_PROJECT_ID`.
- **Convex:** code in `transports/convex.ts`. The server functions are in `convex/` (`rooms.ts`, `schema.ts`, and `crons.ts`, which sweeps anyone silent for more than 25 s and events older than 60 s). Env: `VITE_CONVEX_URL`.
- **STATUS: all four are live and tested (2026-09-23).**
  - **Firebase:**
    - Project `nightfall-mp-ybq89` (the owner's Google account), database `https://nightfall-mp-ybq89-default-rtdb.firebaseio.com` (us-central1), and web app `nightfall-web`.
    - It was created through the Firebase Management API using firebase-tools' own stored login, because `firebase init database` is interactive only.
    - Rules deployed with `cd firebase && npx firebase-tools deploy --only database --project nightfall-mp-ybq89`. 12 checks against the live database (curl) passed: rooms are readable, and anything outside rooms, extra fields, long names, bad event types, bad room ids and non-numbers are refused.
  - **Convex:**
    - Team `matt-smith-61895`, project `nightfall-mp`.
    - Dev deployment `dazzling-canary-278` (in `.env.local`). Prod is `https://polished-porpoise-877.convex.cloud` (in the Vercel env).
    - After changing `convex/`, run `npx convex deploy -y` for prod (`npx convex dev --once` for dev). `convex/_generated` is committed code, so keep it.
  - **Two-tab tests:**
    - Firebase: presence, positions both ways, and the shared parked car. Closing the tab gave "is gone" in 2.8 s, and the room's data was `null` once both left.
    - Convex: presence, positions, and the parked car. A tab closed without a clean goodbye was swept by the cron.
  - **Testing aid:** `?net=firebase|convex|supabase` in the URL starts the chain at that network, and the invite link keeps it.
- **Not used as backups:** PocketBase and Colyseus. They need an always-on host, free hosts sleep, and a sleeping backup can't help.

**Fallback: Supabase Realtime.** If the room server can't be reached (never opens, or 3 reconnects fail), the room switches to a Supabase channel (`nightfall:<room>`): presence for who's here, broadcast for positions. `mp.via` says which network carries the room (`'rooms'` or `'supabase'`). Forcing the room server to be unreachable gave `via: 'supabase'`, connected.

Neither network stores anything.
- **Rooms:** an unguessable 10-character id in the URL (`?room=…`). "Invite someone" (the pause menu, or Settings → Together) makes one and copies the link. Opening a link joins that room. "Play alone" in Settings leaves it. With no room there's no connection at all.
- **What's shared:**
  - Position, facing, speed and mode (walk / sit / drive / ride) at 5 Hz while moving and about 1 Hz while still, interpolated 230 ms behind.
  - Horn on/off. The earliest arrival's clock is broadcast every 4 s, and others snap if they're more than 0.5 game-minutes off.
  - Name (Settings → Together, stored in `nightfall.me.v1`) and coat colour. Your own figure wears the coat the others see.
- **Others are drawn** as the player silhouette in their coat, with a name label within 70 m. When they drive, you see their car (colour, electric/van, brake lights); when they ride, you see a taxi. They're solid to you and your car.
- **The four parked cars are shared.**
  - While someone else drives car *i*, your copy is hidden (`Vehicles.taken`) and can't be entered.
  - When they get out, a `pk` broadcast moves your copy to where they left it.
  - Latecomers don't learn earlier moves.
- **Join/leave captions:** "X has come into the district." / "X is gone."
- **Not shared:** traffic, the crowd, the taxi's route, the eerie moments, the radio or screen, and discoveries. Each player's world is still their own. Wire payloads are validated (`decode`).
- **Verified with two tabs in one room** (first on Supabase, then again on the room server, with the same results):
  - A hosts and B joins, and presence shows each to the other.
  - B's position arrives at A. A drives the electric car: B sees a white car at the right spot, B's own copy is hidden, and the label reads "Tester A".
  - B hears A's horn on and off. A parks: B's copy moves to (-3.0, 21.9) and reappears.
  - B closes the tab: A gets "Tester B is gone." Clocks match.
- **Limits:** Supabase bills 1 + N per broadcast, so a room costs about 5 × players² messages a second. Free is 100/s **project-wide** (about one room of 4), with 2M messages a month. See **docs/multiplayer-scaling.md** for the numbers and the plan: Pro now, Cloudflare Durable Objects beyond about 100 players online at once.
- **Vercel Deployment Protection is OFF** (set 2026-09-23 at the owner's request). The site is public.

## Backend & deploy (2026-09-23)

**Supabase:** project `nightfall`, ref `ueypttzxedsbnbrsmena`, org "Other Projects", us-east-1, free tier.
- The schema is `supabase/migrations/20260923013002_nightfall_saves_and_sightings.sql`, already applied.
- **No Supabase Auth.** Each browser makes a random UUID token, the *save code* (`localStorage` key `nightfall.cloud.v1`). The database stores only its SHA-256.
- The tables `saves` and `sightings` are closed: RLS is on, with no policies and no grants. The browser can only call four RPCs: `nf_save_get`, `nf_save_put` (max 32 KB), `nf_sight` and `nf_sighting_counts`.
- The security advisor flags those four as "anon can execute SECURITY DEFINER". That's intended; they are the whole API. The "RLS enabled, no policy" INFO is also intended.
- Verified as `anon`: the round trip works, a different token can't read the save, sightings de-duplicate, and a direct `select` on the tables is refused.
- **Client:** `src/core/Cloud.ts` (plain `fetch`, no SDK).
  - `SaveState.onFlush` → a push debounced to 4 s. On hide or unload it pushes immediately with `keepalive`.
  - On boot it pulls and runs `SaveState.merge`. Discoveries, flags and unread are unioned. Position, clock and last place come from the newer `savedAt`, never while the player is in the world (`App.inWorld`).
  - Each discovery calls `nf_sight`. The archive shows "Also recorded by N others" when N ≥ 1.
  - Settings → Data shows the save code (Copy) and "Continue from another device" (paste code → Restore). Both were verified in the browser, including the error messages for a malformed code and an unknown code.
- **Env:** `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are in `.env.local` (gitignored); see `.env.example`. Without them `Cloud.enabled` is false and everything is localStorage-only. The publishable key is meant to be public.
- **Known limits:**
  - Anyone can inflate sighting counts by minting tokens. That's acceptable for flavour text.
  - "Erase archive" pushes an empty save, but another device holding the same code still has the old discoveries, and merges them back.
  - The dev session on 2026-09-23 recorded one real sighting of `old-station`.

**Vercel:** project `nightfall` (`prj_ysUaP4M8ml8D9hscT7O5XO3OIGSk`) in the team "Matt Smith's projects".
- Framework vite, `npm run build` → `dist`, and both `VITE_SUPABASE_*` env vars are set for all targets. The folder is linked (`.vercel/project.json`). `vercel.json` sets immutable caching on `/assets/*`, and `.vercelignore` keeps `node_modules`, `dist`, captures and `.env.local` out of the upload.
- **Deployed to production 2026-09-23:** https://nightfall-sand.vercel.app (status Ready). Redeploy with `npx vercel deploy --prod` from the repo root (the CLI is logged in on this machine).
- **Vercel Authentication:** turned **off** on 2026-09-23 at the owner's request. The site is public.
- There's no git repo yet, so there are no automatic deploys. `git init` plus GitHub, then connect it in Vercel, if wanted.

## Latest pass — visibility + people (2026-09-22 evening)

The owner's notes, in short: the world was too dark, and the NPCs read as placeholders. Both are addressed:

- **Visibility (dark, but readable).** The moon is now the key light (`Lighting.ts`: 0.6, cool, casting shadows that follow the viewer across a 140 m window, snapped to 1 m so they don't crawl). The street is lit, while the space between buildings stays genuinely dark.
  - Hemisphere fill 0.95 (was 0.2), `environmentIntensity` 0.85 (was 0.3) with a brighter environment gradient.
  - Lighter night haze and fog (`TimeOfDay.ts` NIGHT / DAWN palettes), lamp gain 3.0, lamp reach ×1.3.
  - Asphalt albedo raised, a slightly stronger shadow lift in the grade, vignette 0.65. **Exposure is unchanged at 1.0.**
  - Lit windows toned down so they don't blow out against the brighter walls.
- **Humanoids.** `entities/Humanoid.ts` replaces the old `Figure.ts` (deleted):
  - An articulated rig: pelvis, spine, neck and head; shoulders, upper arm, forearm and hand; hips, thigh, shin and foot.
  - Sculpted heads (jaw, brow, nose, ears, lips), with separate eyes and brows.
  - Seven hair styles, including hood, beanie and cap.
  - Outfits: coat, raincoat, hoodie, jacket, suit, skirt, knit and workwear, plus collar, lapels, crew neck, shirt front, scarf, bag and umbrella.
  - Per-person body proportions (height, girth, shoulders, hips, head).
- **Animation.** Real gait: stance-leg pelvis height, so feet stay on the ground (verified numerically: sole height 0.000 through the walk, head bob about 5 cm). Knee bend in the swing phase, arms swinging opposite the legs, pelvis and chest counter-twist, leaning into turns, and a walk-to-run blend. Idle has breathing and weight shift. There are poses for sitting, phone, smoking, checking a watch, talking with gestures, and hands in pockets. Timing, stride, arm swing and posture vary per person.
- **Rendering.** `entities/FigureBatch.ts` uses one `InstancedMesh` per part geometry (~30 draws for the whole crowd). The player uses the same batch with capacity 1.
  - Character materials add a cool rim light (silhouettes read against the dark) and a per-person woven or striped fabric pattern.
  - LOD: under 38 m, the full head with eyes and hands; 38–90 m, a simple head with garments; over 90 m, the silhouette only.
- **Unease** (`Crowd.direct`, one event every 110–220 s, never overlapping):
  - **The watcher:** a pale hooded figure appears under a lamp 30–60 m ahead of you. It vanishes if you get within 14 m, or once it has been seen and you look away. Its lamp stutters. Verified in the browser.
  - **Freeze:** someone nearby stops dead for 45–90 s, not breathing, facing a wall or facing you.
  - **Glitch:** for about 0.9 s a visible person's head turns past human range, drops back, or trembles.
  - **Never emerge:** about 15% of people who "go inside" stay gone for 2–4 minutes, and nobody reappears while you watch the door.
  - The two authored "stare" figures still never react to you.
- **Draw calls** are about 590 on the avenue (the moon shadow pass is the main addition), with about 4.7 ms CPU submit. Shadows can be turned off in Settings.

### Visual checks: done (2026-09-23)
Reviewed against real captures in `captures/`:
- Front-lit faces (`face-*.jpg`), glitch and freeze (`glitch-*.jpg`, `freeze-wall.jpg`), the wardrobe line-up, the crowd in the square, and a gameplay frame.
- Fixes that came out of the review:
  - Coat collars were covering the chin; they now fold below it.
  - Hair caps were wrapping the forehead like a helmet; they now tilt back.
  - The pelvis read as a diaper; it's slimmer now.
  - A lathe normal seam put a hard vertical split down every torso. `lathe()` no longer recomputes normals; the heads are welded with `mergeVertices`.
  - Shoes read as grey blocks. They now have their own rimless `shoe` material, and the cloth rim is lowered to 0.09.
  - The smoker's ember was a white box that was always on. It's now a tiny unlit ember, shown only at the lips.
  - Run bob 13 → 9 cm. Manholes sit flush with the road. The station floodlight glare halo is removed.
- **Moon shadow shimmer: fixed and measured (2026-09-23).**
  - **Before:** the old 1 m world snap popped 29–36 edge pixels per metre walked.
  - **Fix:** `Lighting.update` now snaps the focus to whole shadow texels in the light's own view plane, with the depth axis in 16 m steps.
  - **Check:** the shadow-UV fraction of a fixed world point stays constant across steps, and a near view (within ~25 m) changes 0 pixels over a 3 m walk.
  - **What still moves:** the far edge of the 140 m shadow window, about 70 m out in fog.

### Review tooling
- The dev server has a capture endpoint (`vite.config.ts`, dev only): POST a canvas data URL to `/__capture?name=x` and it's written to `captures/x.jpg` (gitignored).
- `.claude/launch.json` has a second preview config, `nightfall-review`, on port 5329. It's there because other `vite` instances were already holding 5317 and 5318 without the plugin.
- In the page, with `nf` exposed in dev:

  ```js
  nf.frame(t); // render one frame
  await fetch('/__capture?name=x', { method: 'POST', body: nf.renderer.canvas.toDataURL('image/jpeg', 0.9) });
  ```

  Call `frame` and `toDataURL` in the same task, or the canvas comes back blank.

## Done and verified in the browser

- **Title sequence:** the landing and its five shots, cut through black and letterboxed, with live local time and rainfall.
- **Enter World:** the push-in, then black, the intermission card, black again, and the camera settles behind the player. The HUD appears only after control.
- **Movement:** walking, kerb steps, station platform steps (0.15 → 0.58 → 0.89 m), and collision with props and buildings.
- **Interaction:** the E prompt and captions (tested at the departures board).
- **Discovery:** the notification appears and the archive entry unlocks.
- **Pause menu, map, settings:** checked on screen; every settings control is wired up.
- **Archive:** places get real photographic plates rendered from the world. Plates missing when the archive opens are captured then.
- **Render budget:** about 150–470 draw calls and 1–5 ms CPU submit per frame. Frame rate itself is unmeasured (see below).

## Fixed during testing (don't reintroduce)

- **Facade window noise:** per-building shader varyings must be `flat` (`materials.ts`, `Sky.ts`). If they are interpolated, the window hash turns tiny per-pixel error into noise.
- **NaN from `pow()`:** never call `pow()` on a possibly negative base in the additive shaders. Clamp first (`Traffic.ts` beams, `LightFX.ts` cones). NaN in the half-float target renders as black and white blobs.
- **Frame dt:** clamped to `[0, 0.05]` in `App.frame`, because a negative dt made the camera diverge.
- **City build:** yields with a `setTimeout` fallback, because hidden tabs pause `requestAnimationFrame` (`City.ts`).
- **Plates storage key:** bumped to `nightfall.plates.v2`, which discards plates captured with the old bugs.
- **File encoding:** Python edits on Windows default to cp1252 with CRLF line endings. Always pass `encoding='utf-8'`; all `src` files are now LF.

## Not yet verified (next person: check these first)

- [ ] **Visual pass after the last tweaks.** The preview pane was hidden, which freezes rAF and CSS transitions. Screens to check:
  - [ ] station façade floodlights (`builders/station.ts`, 4 lamps at y 1.6)
  - [ ] toned-down storefronts
  - [ ] soft headlight beams
- [ ] **Audio.** It's all procedural and has never been listened to. Check the levels: rain, city bed, footsteps, payphone ring, radio, and the loop "sag".
- [ ] **The loop reset at 05:29 → 03:17** (about 6.6 real minutes). Check the flicker, the audio, and the `the-loop` archive unlock.
- [ ] **Title screen on phone widths** (`@media (max-width: 720px)` in `main.css`).
- [ ] **Real frame rate** on a gaming laptop at Medium and High.
- [ ] **Pointer lock:** capture, Esc to pause, the resume hint ("Click to continue"), and the 300 ms Esc debounce.
- [ ] **Sitting** on a bench or the garden chair: time runs ×8, and moving stands you up.

## Known rough edges / backlog (in priority order)

1. ~~Map player arrow~~, ~~rain in plates~~, ~~car corner radius~~: done by an earlier parallel pass (`MapView` pulse ring, `Photographer` hides weather, angle-aware radius of at most 6 m in `Traffic.roundPath`).
2. ~~The Station shed interior is dark~~: a visual pass on 2026-09-28 found it well lit (tools/playtest/tour.mjs).
3. **Draw calls are about 590 on the avenue** with moon shadows. Candidates: a texture atlas for decals, turning `castShadow` off on the character limbs at Medium, or updating the moon shadow every other frame.
4. **Running head bob is about 13 cm.** It may want softening.
5. **NPCs pop when they "go inside"** at route ends. This only happens when the player is more than 18 m away.

## Design canvas (separate from the game)

- Canvas "Nightfall": https://claude.ai/artifact/HfPv3USpKPcRpPGikVZQXa (private, owner only). Published at version 3 with five boards:

  | Board | Contents |
  |---|---|
  | Title sequence | The landing over a real Central Avenue frame |
  | Title stills | The 5 title shots |
  | Interface system | Type, colour and motion tokens |
  | HUD, discovery, pause, archive | Over a gameplay frame |
  | People | Wardrobe line-up, close and mid frames, rig / wardrobe / motion / unease notes |

- Images are canvas assets uploaded from `captures/`. The board sources live in the session scratchpad (`nightfall-canvas/project/`), **not in the repo**. To edit, read the files back from the artifact.
- If the UI or the look changes, recapture and re-upload so the canvas stays honest.

## Dev tips

- In dev, the app is exposed as `window.nf`. Useful calls:
  - `nf.enter()`
  - `nf.openOverlay('archive', 'pause')`
  - `nf.discovery.unlock('<entry id>')`
  - `nf.player.place(x, y, z, yaw)`
  - `nf.frame(t)`, to step manually while the tab is hidden
- Save state lives in `localStorage`, under `nightfall.save.v1`, `nightfall.settings.v1` and `nightfall.plates.v2`. Settings → Data → **Erase archive** clears progress.
- The city plan (roads, blocks, districts, routes, spawn) is all in `src/world/layout.ts`. Change it there, and the map and zones follow.
- **Brand:** `public/favicon.svg` (the city's mark: amber ring, pale vertical stroke, lamp dot) and `public/logo.svg` (mark + NIGHTFALL wordmark + tagline). Linked from `index.html`.
