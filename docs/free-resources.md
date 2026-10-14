# Free and open-source resources for NIGHTFALL

A survey of the free (and mostly open-source) libraries, assets, tools and
programmes that a browser game like NIGHTFALL can use, and what we've done
with each one.

**Status key**
- ✅ **In the game**: shipping now.
- 🟡 **Candidate**: free, licence fine, worth adding; not in yet (the note says why).
- 🔧 **Tool**: used to make things, not shipped in the game.
- ⛔ **Not usable**: the licence forbids commercial use or redistribution, it needs an account or host we can't reach from the build environment, or it duplicates something already in the game.

**Why not literally everything**
1. **Duplicates fight each other.** A game has one physics engine, one audio engine and one renderer. Adding Rapier *and* cannon-es *and* Ammo gives three worlds that disagree.
2. **Licences.** CC BY-NC, the BBC's RemArc licence and "free for personal use" fonts can't go into a game that might ever charge money. CC BY is fine but must be credited (`public/licenses/README.txt`).
3. **Reach.** The build environment's network policy blocks kenney.nl, polyhaven.com, ambientcg.com, opengameart.org and quaternius.com. Only npm and GitHub are reachable, so assets from those sites come in through npm packages that mirror them (Poly Haven via `@pmndrs/assets`), or not at all. The project owner can allow those hosts in the cloud environment's network settings.
4. **Download size.** Every asset is bytes a player waits for. The game builds most things procedurally (cars, buildings, people's clothes, sounds) to stay small.

The full credits for what ships are in `public/licenses/README.txt`.

---

## 1. In the game now

| Resource | What it does in NIGHTFALL | Licence |
|---|---|---|
| [three.js](https://threejs.org) | The renderer, plus the examples kit: GTAO, bloom, DOF, EffectComposer, PMREM, RoundedBoxGeometry, BufferGeometryUtils, EXR loader | MIT ✅ |
| [EZ-Tree](https://github.com/dgreenheck/ez-tree) (Daniel Greenheck) | Procedural trees; grass, flower and rock models | MIT ✅ |
| [MakeHuman](http://www.makehumancommunity.org) / MPFB2 | Base body mesh, morph targets, skeleton weights, eye and region textures for RPG characters | CC0 ✅ |
| [Poly Haven](https://polyhaven.com) HDRIs, via [`@pmndrs/assets`](https://github.com/pmndrs/assets) | RPG skies and image-based light (city, dawn, forest, night, park, sky, sunrise, sunset) | CC0 ✅ |
| [emmelleppi normal maps](https://github.com/emmelleppi/normal-maps), via `@pmndrs/assets` | Detail normals: bark, cliff, cracked, crumple, grit, knit, leather, pores | CC0 ✅ |
| Poly Haven + [TextureCan](https://www.texturecan.com) bark | Tree bark | CC0 ✅ |
| [Draco](https://github.com/google/draco) | Mesh decompression for the RPG models | Apache-2.0 ✅ |
| [Fontsource](https://fontsource.org): IBM Plex Sans, IBM Plex Mono, Instrument Serif | All UI and in-world type (signs, plates, menus), **now self-hosted** (no Google Fonts request; works offline) | OFL-1.1 ✅ *new* |
| [ZzFX](https://github.com/KilledByAPixel/ZzFX) (Frank Force) | Small game sounds: paying, finding cash, a stash, being refused, played through our own mix | MIT ✅ *new* |
| [stats-gl](https://github.com/RenaudRohlinger/stats-gl) | `?stats` in the URL shows FPS, CPU and GPU frame time, for tuning on real hardware | MIT ✅ *new* |
| [Supabase JS](https://github.com/supabase/supabase-js), [Firebase JS](https://github.com/firebase/firebase-js-sdk), [Convex](https://github.com/get-convex/convex-js) | Accounts, cloud saves, multiplayer presence (free tiers; the SDKs are open source) | MIT / Apache-2.0 ✅ |
| [Playwright](https://playwright.dev) | The headless playtests in `tools/playtest` | Apache-2.0 🔧 |
| [Vite](https://vite.dev), [TypeScript](https://www.typescriptlang.org) | Build and typecheck | MIT / Apache-2.0 🔧 |

---

## 2. Libraries (npm, all reachable)

### Rendering and effects
| Resource | Use for NIGHTFALL | Licence | Status |
|---|---|---|---|
| [postprocessing](https://github.com/pmndrs/postprocessing) | Faster merged effect passes, SMAA, better bloom | Zlib | 🟡 Would replace our EffectComposer chain. A rewrite of `render/Renderer.ts`, so it's its own pass. |
| [N8AO](https://github.com/N8python/n8ao) | Higher-quality ambient occlusion than GTAO at a similar cost | ISC | 🟡 Drop-in replacement for the GTAO pass; needs a quality A/B on low-end devices. |
| [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer) | Path-traced stills for photo mode | MIT | 🟡 Great for photo mode only; too slow for play. |
| [three-custom-shader-material](https://github.com/FarazzShaikh/THREE-CustomShaderMaterial) | Extend standard materials with custom shader code | MIT | ⛔ We already patch materials with `onBeforeCompile` (vehicle wear, facades). |
| [troika-three-text](https://github.com/protectwise/troika) | Crisp SDF text in 3D (signs, plates at any distance) | MIT | 🟡 Our signs are canvas textures; SDF text would stay sharp up close. |
| [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | Fast raycasts against meshes | MIT | 🟡 Our collision is boxes. Useful if we raycast real meshes (bullet holes on cars). |
| [meshoptimizer](https://github.com/zeux/meshoptimizer) | Mesh simplification and compression | MIT | 🔧 For LODs of imported models. |
| [Basis Universal / KTX2](https://github.com/BinomialLLC/basis_universal) | GPU-compressed textures (less VRAM, faster loads) | Apache-2.0 | 🟡 Worth it once textures grow. |
| [three-nebula](https://github.com/creativelifeform/three-nebula) | Particle system | MIT | ⛔ We have our own rain, blood, sparks and smoke systems. |

### Physics
| Resource | Use | Licence | Status |
|---|---|---|---|
| [Rapier](https://rapier.rs) (`@dimforge/rapier3d-compat`) | Rigid bodies, joints, character controller | Apache-2.0 | ⛔ Duplicate. NIGHTFALL has its own vehicle dynamics, box collision and Verlet ragdolls tuned to the game. A candidate only if we ever want stacked, tumbling props. |
| [cannon-es](https://github.com/pmndrs/cannon-es) | Lightweight rigid bodies | MIT | ⛔ Duplicate, as above. |
| [Jolt Physics (JoltPhysics.js)](https://github.com/jrouwe/JoltPhysics.js) | AAA-grade physics in WASM | MIT | ⛔ Duplicate; heavy. |
| [ammo.js](https://github.com/kripken/ammo.js) | Bullet in WASM | zlib | ⛔ Duplicate; old. |

### AI and navigation
| Resource | Use | Licence | Status |
|---|---|---|---|
| [recast-navigation-js](https://github.com/isaac-mason/recast-navigation-js) | Navmeshes and crowds: people and police on foot routing round anything | MIT | 🟡 **Best next AI upgrade.** Our walkers follow hand-laid routes; a navmesh would let anyone go anywhere. |
| [Yuka](https://github.com/Mugen87/yuka) | Steering, state machines, goal-driven agents | MIT | ⛔ We have our own state machines (Crowd, Police, crooks). |
| [PathFinding.js](https://github.com/qiao/PathFinding.js) | Grid A* | MIT | ⛔ Our road grid router (`entities/pursuit.ts`) does this for cars. |

### Audio
| Resource | Use | Licence | Status |
|---|---|---|---|
| [ZzFX](https://github.com/KilledByAPixel/ZzFX) | Tiny procedural sound effects | MIT | ✅ *new* |
| [jsfxr](https://github.com/chr15m/jsfxr) | sfxr-style effects | Unlicense | ⛔ Same job as ZzFX. |
| [Tone.js](https://tonejs.github.io) | Synths and sequencing for procedural music | MIT | 🟡 Could drive a reactive score (wanted level, chases). Our engine is hand-built Web Audio. |
| [howler.js](https://howlerjs.com) | Playing audio files across browsers | MIT | ⛔ Duplicate of our AudioEngine. Useful only if we move to recorded audio. |

### UI, input, tooling
| Resource | Use | Licence | Status |
|---|---|---|---|
| [stats-gl](https://github.com/RenaudRohlinger/stats-gl) | Performance overlay | MIT | ✅ *new* (`?stats`) |
| [lil-gui](https://lil-gui.georgealways.com) / [Tweakpane](https://tweakpane.github.io/docs/) | Live tuning panels for developers | MIT | 🟡 Handy for car tuning; dev-only. |
| [nipplejs](https://github.com/yoannmoinet/nipplejs) | Touch joysticks | MIT | ⛔ We have our own touch controls. |
| [@tweenjs/tween.js](https://github.com/tweenjs/tween.js) | Tweens | MIT | ⛔ Our animation and cinematic systems do this. |
| [simplex-noise](https://github.com/jwagner/simplex-noise.js) | Noise | MIT | ⛔ We have our own noise. |
| [glTF-Transform](https://gltf-transform.dev) | Optimise and convert glTF assets | MIT | 🔧 For any imported model. |

### Multiplayer
| Resource | Use | Licence | Status |
|---|---|---|---|
| [PeerJS](https://peerjs.com) | Peer-to-peer WebRTC | MIT | 🟡 Could cut server cost for small sessions; see `docs/multiplayer-scaling.md`. |
| [Colyseus](https://colyseus.io) | Authoritative game server | MIT | 🟡 For a dedicated server if sessions grow. |
| [geckos.io](https://github.com/geckosio/geckos.io) | UDP-like WebRTC for real-time games | BSD-3 | 🟡 As above. |

---

## 3. Assets

### Models
| Source | What | Licence | Status |
|---|---|---|---|
| [Kenney](https://kenney.nl/assets) | Thousands of game-ready models: cars, city, furniture, weapons | CC0 | ⛔ Host blocked from the build environment. The style is also cartoon low-poly, which clashes with NIGHTFALL's look; our cars and buildings are procedural instead. |
| [Quaternius](https://quaternius.com) | Low-poly packs: cars, characters, animals, guns | CC0 | ⛔ Host blocked; same style clash. |
| [Poly Pizza](https://poly.pizza) | Searchable low-poly library | Mostly CC0 / CC BY | ⛔ Host blocked; per-model licences. |
| [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) | Reference models (materials, a toy car, a concept car) | Mixed (per model) | 🔧 Reachable on GitHub; for testing materials, not shipping. |
| [Smithsonian 3D](https://3d.si.edu) | Scanned objects | Many CC0 | ⛔ Host not reachable; heavy scans. |
| [Sketchfab](https://sketchfab.com) (CC filter) | Huge library | CC BY / CC0 per model | ⛔ Needs an account to download; per-model licences. |

### Textures and skies
| Source | What | Licence | Status |
|---|---|---|---|
| [Poly Haven](https://polyhaven.com) | HDRIs, PBR textures, models | CC0 | ✅ HDRIs (via npm). Textures 🟡 (host blocked; would need a mirror). |
| [ambientCG](https://ambientcg.com) | PBR materials | CC0 | ⛔ Host blocked. |
| [cgbookcase](https://www.cgbookcase.com), [ShareTextures](https://www.sharetextures.com), [3DTextures.me](https://3dtextures.me) | PBR materials | CC0 | ⛔ Not reachable. |
| [TextureCan](https://www.texturecan.com) | PBR materials | CC0 | ✅ Bark. |
| [`@pmndrs/assets`](https://github.com/pmndrs/assets) | HDRIs, normals, 280+ matcaps, fonts | CC0 | ✅ HDRIs and normals; matcaps 🟡 (cheap shading for distant crowds). |

### Animation and characters
| Source | What | Licence | Status |
|---|---|---|---|
| MakeHuman / MPFB2 | Bodies, morphs, skeleton | CC0 | ✅ |
| [CMU Motion Capture Database](http://mocap.cs.cmu.edu) | 2,500 mocap clips | Free, including in commercial products; the raw data may not be resold | 🟡 Could drive idles and fights; needs retargeting to our rig. Host not checked from the build environment. |
| [Mixamo](https://www.mixamo.com) | Rigged characters and animations | Free with an Adobe ID; can be used in games, not redistributed as raw files | ⛔ Account needed; terms limit raw redistribution. |
| Bandai Namco Research motion dataset | Stylised motions | CC BY-NC 4.0 | ⛔ Non-commercial. |

### Sound and music
| Source | What | Licence | Status |
|---|---|---|---|
| [Freesound](https://freesound.org) (CC0 filter) | Field recordings, foley | CC0 / CC BY per sound | ⛔ Needs an account and host access. Our sounds are synthesised instead (rain, engines, voices, guns). |
| [Kenney audio](https://kenney.nl/assets?q=audio) | UI, impacts, voice packs | CC0 | ⛔ Host blocked. |
| [Sonniss GDC bundles](https://sonniss.com/gameaudiogdc) | Pro sound libraries | Royalty-free; no raw redistribution | ⛔ Host and terms. |
| [Musopen](https://musopen.org) | Public-domain classical recordings | Public domain / CC0 | 🟡 Could feed the in-car radio. |
| [Incompetech](https://incompetech.com) (Kevin MacLeod) | Music | CC BY 4.0 | 🟡 Must credit. |
| BBC Sound Effects | 33,000 effects | RemArc (non-commercial) | ⛔ Non-commercial. |

### Fonts
| Source | Licence | Status |
|---|---|---|
| [Fontsource](https://fontsource.org) / Google Fonts | OFL / Apache | ✅ Plex Sans, Plex Mono, Instrument Serif (self-hosted). |

---

## 4. Free tools for making things (not shipped)

| Tool | For | Licence |
|---|---|---|
| [Blender](https://www.blender.org) | Modelling, rigging, animation, baking | GPL (what you make is yours) |
| [Krita](https://krita.org), [GIMP](https://www.gimp.org) | Painting and textures | GPL |
| [Inkscape](https://inkscape.org) | Vector UI art, logos | GPL |
| [Material Maker](https://www.materialmaker.org) | Procedural PBR materials | MIT |
| [MagicaVoxel](https://ephtracy.github.io) | Voxel models | Free |
| [Blockbench](https://www.blockbench.net) | Low-poly models | GPL |
| [Meshroom](https://alicevision.org) | Photogrammetry (photos → models) | MPL-2.0 |
| [MeshLab](https://www.meshlab.net), [Instant Meshes](https://github.com/wjakob/instant-meshes) | Cleanup, retopology | GPL / BSD |
| [Audacity](https://www.audacityteam.org) | Recording and editing sound | GPL |
| [LMMS](https://lmms.io), [Bosca Ceoil](https://boscaceoil.net) | Music | GPL / FreeBSD |
| [jsfxr](https://sfxr.me), [ChipTone](https://sfbgames.itch.io/chiptone) | Sound-effect design | Unlicense / free |
| [Tiled](https://www.mapeditor.org), [LDtk](https://ldtk.io) | Level layout | GPL / MIT |
| [FFmpeg](https://ffmpeg.org), [ImageMagick](https://imagemagick.org), [Squoosh](https://squoosh.app) | Media conversion and compression | LGPL / Apache |
| [glTF-Transform CLI](https://gltf-transform.dev/cli), [gltfpack](https://github.com/zeux/meshoptimizer) | Model optimisation | MIT |

## 5. Platforms and programmes (official first)

`docs/platforms.md` covers the official routes: ID@Xbox, PlayStation Partners and the Nintendo Developer Portal for consoles, and Steamworks for PC. [itch.io](https://itch.io) is a further option for free web releases. Applying is the developer's step; nothing here assumes acceptance.

---

## What came in this round, and what's next

**Added now:** self-hosted fonts (Fontsource), ZzFX game sounds, and the stats-gl overlay.

**Best next additions, in order:**
1. recast-navigation, so people and police on foot can walk anywhere.
2. N8AO instead of GTAO, behind a quality A/B.
3. troika-three-text for signs and plates that stay sharp up close.
4. CMU mocap for richer idles and fights.
5. Musopen recordings for the car radio.
6. KTX2 textures once texture weight grows.

To use Kenney, Quaternius, ambientCG or Freesound directly, allow their hosts in the cloud environment's network settings, then re-run this survey.
