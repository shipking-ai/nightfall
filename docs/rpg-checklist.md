# RPG playtest checklist (R6)

What "working" means for the fifth mode, and how each point is checked. Run everything with:

```
cd tools/playtest && node rpg-all.mjs            # every test, one at a time (about an hour with the soak)
SKIP=rpg-soak node rpg-all.mjs                    # without the hour-long soak
ONLY=rpg-map,rpg-pad node rpg-all.mjs             # just some
```

The runner needs the dev server (`npm run dev`, port 5317). A test passes when it exits cleanly, the page raised no errors, and it printed no `FAIL` or `✗` lines. These tests run headless on SwiftShader (software rendering). They check behaviour, not frame rate on a real GPU.

## World

| Check | Test |
|---|---|
| Entering from the mode select, with the loading card, and leaving back to District 03 intact | `rpg` |
| Every biome and every town type is reached; the world streams around you with no holes | `rpg`, `rpg-look` |
| Roads: drivable surface, embankments on dry land, bridges only over water and deep valleys | `rpg-look` (`PLACES=road,roadtown,bridge`) |
| Towns: streets, shops with signs and awnings, street furniture, lamps at night | `rpg-look` (`PLACES=town`) |
| Grass, flowers, real trees and rocks near you; stand-ins far off | `rpg-look` |
| Day and night, weather fronts, captured-sky lighting | `rpg`, `rpg-look` |

## Life

| Check | Test |
|---|---|
| The creator (a pad reaches every control; Begin starts) | `rpg-life`, `rpg-pad` |
| The story starts; the first town moves it on; the marker leads to each person and place | `rpg-life`, `rpg-ferry` |
| Talking, jobs, shops (buy with A), eating, a bed, trains | `rpg-life`, `rpg-pad` |
| Save, load, autosave; an old save loads (migrations and repair) | `rpg-life` |
| The Casefile: every tab reachable and usable with a pad, B closes | `rpg-pad` |
| The atlas: zoom, pan, pin; the compass follows the pin | `rpg-map` |

## The wild and the road

| Check | Test |
|---|---|
| Animals by biome; noticing you; hunting, butchering, fire, cooking, fishing | `rpg-wild` |
| Dread after dark, the watcher, roadside events | `rpg-dark` |
| Violence has consequences: witnesses, bounty, the Watch | `rpg-fight` |
| Traffic, parked cars, carjacking, each vehicle kind's handling | `rpg-roads`, `rpg-drive` |
| Cards at the bar | `rpg-drive` |

## Performance and stability

| Check | Test |
|---|---|
| No long stalls while travelling at driving speed (99th percentile of updates under ~25 ms, no multi-second gaps) | `rpg-perf` |
| An hour of play without errors or leaks (memory, GPU objects, collision boxes flat from one loop of the route to the next) | `rpg-soak` |

## Only a person can check

These need real hardware and a real player. The tests can't judge them.

- **Frame rate on a real GPU:** on a laptop and a desktop, in town at night in the rain (the heaviest scene).
- **Audio:** the mix, rain, radio, footsteps, thunder.
- **Feel:** driving, walking, and camera feel with a pad and with mouse and keyboard.
- **Text:** readability on a TV at couch distance (TV-safe area, text size).
- **Story:** whether it's clear where to go next without the marker (the marker can be relied on, but shouldn't have to be).
