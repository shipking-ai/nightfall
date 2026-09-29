import * as THREE from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import type { Collision } from '../world/Collision';
import type { Materials } from '../world/materials';
import { worldUniforms } from '../world/materials';
import type { Sky } from '../env/Sky';
import type { Lighting } from '../env/Lighting';
import type { Weather } from '../env/Weather';
import type { Player } from '../entities/Player';
import type { FollowCamera } from '../camera/FollowCamera';
import type { Outskirts } from '../world/Outskirts';
import type { Lamp } from '../world/WorldContext';
import { districtAt } from '../world/layout';
import { WorldGen, DISTRICT_03, type Settlement } from './world/WorldGen';
import { Streamer, CHUNK } from './world/Streamer';
import { doorMat, signMats } from './world/Signs';
import { BIOMES, CITY_STYLES, type BiomeId, type VehicleKind } from './world/biomes';
import type { Tune } from '../entities/Vehicles';
import { Atmosphere } from './env/Atmosphere';
import { Sea, createSeaMaterial } from './env/Sea';
import { Precip } from './env/Precip';
import { RpgHud } from './ui/RpgHud';
import { FarCities } from './world/FarCities';
import { RealHuman } from './people/RealHuman';
import type { HumanSpec } from './people/anatomy';
import { Life } from './Life';
import { Populace } from './sim/Populace';
import { RoadTraffic, vehicleMesh } from './sim/RoadTraffic';
import { Wildlife } from './sim/Wildlife';
import { GroundCover } from './world/GroundCover';
import { setWarmer } from './world/warm';
import { GoalMarker, type Goal } from './ui/GoalMarker';
import { terrainUniforms } from './world/Terrain';
import { Director } from './sim/Director';
import type { Vehicles, DrivableCar } from '../entities/Vehicles';
import type { Body, Outfit } from '../entities/Humanoid';

export interface RpgHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  collision: Collision;
  mats: Materials;
  sky: Sky;
  fog: THREE.FogExp2;
  lighting: Lighting;
  weather: Weather;
  player: Player;
  follow: FollowCamera;
  outskirts: Outskirts;
  /** District 03's own objects the wider world replaces or hides (the river sheet, the skyline ring) */
  cityRoot: THREE.Object3D;
  ui: HTMLElement;
  /** re-make the scene's environment map from sky colours */
  environment: (zenith: THREE.Color, horizon: THREE.Color, ground: THREE.Color) => THREE.Texture;
  /** a captured sky (HDR, equirectangular) made into an environment map */
  envFromEquirect: (tex: THREE.Texture) => THREE.Texture;
  /** compile an object's shaders in the background (so its first draw doesn't stall) */
  warm?: (obj: THREE.Object3D) => Promise<void>;
  thunder: (delay: number, strength: number) => void;
  say: (lines: string[], who: string) => void;
  vehicles: Vehicles;
  /** open or close the App's overlay for an RPG screen (menus take the controller, the game pauses) */
  panel: (open: boolean, from?: 'playing' | 'pause') => void;
  /** fade to black and back (sleeping, searching, travelling, loading) */
  curtain: (on: boolean) => Promise<void>;
  inVehicle: () => boolean;
  /** something hurt you (an animal, the cold) */
  hurt: (dmg: number, by: string) => void;
  rumble?: (k: number) => void;
  /** put you in the driver's seat of this car */
  enterCar: (car: DrivableCar) => void;
  /** River Road, where every life starts */
  spawn: { x: number; z: number; yaw: number };
}

/**
 * NIGHTFALL: RPG. The fifth way into the same world — and the biggest: the
 * night in District 03 finally ends, and the land beyond it opens up. The
 * same people, cars, weather, animation and city underneath; different rules
 * on top. This class owns the wider world (generator, streamer, the day and
 * its weather) and hands the rest of the game what it needs to live in it.
 */
export class Rpg {
  active = false;
  gen = new WorldGen();
  streamer: Streamer;
  atmos: Atmosphere;
  sea: Sea;
  precip = new Precip();
  far: FarCities;
  populace: Populace;
  traffic: RoadTraffic;
  hud: RpgHud;
  /** cars parked along the streets you're near (you can take them) */
  private parked = new Map<string, DrivableCar>();
  private parkT = 0;
  group = new THREE.Group();
  /** where you are, in words */
  /** where the tracked job (or your pin) wants you: shown in the world and on screen */
  goal: Goal | null = null;
  marker: GoalMarker;
  place = { name: 'District 03', region: 'Merrow', biome: 'temperate' as BiomeId, settlement: null as Settlement | null };
  private envT = 0;
  private envTex: THREE.Texture | null = null;
  private savedEnv: THREE.Texture | null = null;
  private savedFar = 0;
  private lastPlaceKey = '';
  private cityLamps: Lamp[] = [];
  private tmp = new THREE.Vector3();
  /** you, as the RPG draws you */
  private hero: RealHuman | null = null;
  /** a new look being built (it replaces the old one once it's ready) */
  private heroNext: RealHuman | null = null;
  private saved: { body: Body; outfit: Outfit } | null = null;
  /** the character, their things, the screens and the saves */
  life: Life;
  wildlife: Wildlife;
  /** grass and flowers underfoot */
  cover: GroundCover;
  /** dread after dark, and things by the road */
  director: Director;

  constructor(public host: RpgHost) {
    this.streamer = new Streamer(this.gen, host.collision, host.mats, createSeaMaterial(host.sky, host.fog));
    this.sea = new Sea(createSeaMaterial(host.sky, host.fog));
    this.atmos = new Atmosphere(this.gen, host.sky, host.fog, host.lighting, host.weather, host.scene);
    this.atmos.onThunder = (d, s) => host.thunder(d, s);
    this.hud = new RpgHud(host.ui);
    this.marker = new GoalMarker(host.ui);
    this.group.add(this.marker.group);
    this.far = new FarCities(this.gen, this.streamer.towns);
    this.populace = new Populace(this.gen, this.streamer.towns, host.collision);
    this.traffic = new RoadTraffic(this.gen, host.mats);
    this.life = new Life(this, host);
    this.wildlife = new Wildlife({
      gen: this.gen,
      heightAt: (x, z) => this.streamer.heightAt(x, z),
      waterAt: (x, z) => this.streamer.waterAt(x, z),
      player: () => {
        const pl = host.player, c = this.life.game?.c;
        return { pos: pl.pos, speed: pl.speed, crouch: pl.crouching, inCar: host.inVehicle(), stealth: c ? c.skills.stealth + c.attrs.reflex * 5 + (c.perks.includes('softstep') ? 15 : 0) : 0 };
      },
      daylight: () => this.atmos.daylight,
      visibility: () => this.atmos.now.visibility,
      bite: (dmg, by) => host.hurt(dmg, by),
    });
    this.director = new Director(this, host.ui);
    this.cover = new GroundCover(this.streamer);
    setWarmer(host.warm ?? null);
    this.group.add(this.streamer.group, this.sea.mesh, this.precip.points, this.far.mesh, this.populace.group, this.traffic.group, this.wildlife.group, this.director.group, this.cover.group);
    this.group.visible = false;
    host.scene.add(this.group);
    this.streamer.onLamps = (all) => {
      this.cityLamps = all;
      this.refreshLamps();
    };
  }

  /** Into the wider world (behind the intermission card): hook the ground up, build what's around. */
  async start(at: THREE.Vector3, progress: (k: number) => void) {
    const h = this.host;
    this.active = true;
    this.group.visible = true;
    h.collision.base = (x, z, y, step) => (inD03(x, z) ? 0 : this.streamer.surfaceAt(x, z, y, step));
    h.player.waterAt = (x, z) => (inD03(x, z) ? undefined : this.streamer.waterAt(x, z));
    h.player.canCrouch = true;
    h.outskirts.limit = 4;
    h.outskirts.follow = false;
    h.outskirts.update(at);
    // District 03's river sheet gives way to the sea (the same level), its painted skyline to real cities
    const water = h.cityRoot.getObjectByName('water');
    if (water) water.visible = false;
    for (const n of ['ground-north', 'ground-south']) {
      const g = h.cityRoot.getObjectByName(n);
      if (g) g.position.x = 0;
    }
    h.sky.skyline.visible = false;
    this.savedFar = h.camera.far;
    h.camera.far = Math.max(h.camera.far, 6000);
    h.camera.updateProjectionMatrix();
    this.savedEnv = h.scene.environment;
    // you: a real person, not the city's figure (built in a worker while the world loads).
    // A save puts you back where (and when, and who) you were; otherwise the mirror opens once the world is up.
    const pl = h.player;
    this.saved = { body: pl.body, outfit: pl.outfit };
    const spec = this.life.resume();
    this.setHero(spec, true);
    await this.streamer.preload(at, progress);
    // the real trees, the grass and their shaders: grown and compiled behind the card, not in the first minute of play
    // (capped, so a slow machine still gets in)
    await Promise.race([Promise.all([this.streamer.flora.realLoading, this.cover.prepare()]), new Promise((r) => setTimeout(r, 20000))]);
    this.locate(at);
    this.atmos.settle(at, this.place.biome);
    this.lastPlaceKey = '';
    this.envT = 0;
  }

  stop() {
    const h = this.host;
    this.goal = null;
    this.marker.clear();
    this.life.autosave();
    this.life.closeAll();
    this.life.creator.close();
    this.life.panel = null;
    this.active = false;
    this.group.visible = false;
    this.streamer.clear();
    this.far.clear();
    this.populace.clear();
    this.traffic.clear();
    this.wildlife.clear();
    this.director.clear();
    this.cover.clear();
    h.vehicles.grip = 1;
    h.player.canCrouch = false;
    for (const car of this.parked.values()) h.vehicles.despawn(car);
    this.parked.clear();
    h.player.real = null;
    h.player.hidden = false;
    if (this.hero) this.hero.group.visible = false;
    if (this.saved) {
      h.player.body = this.saved.body;
      h.player.outfit = this.saved.outfit;
      this.saved = null;
    }
    h.collision.base = null;
    h.player.waterAt = null;
    h.outskirts.limit = Infinity;
    h.outskirts.follow = true;
    const water = h.cityRoot.getObjectByName('water');
    if (water) water.visible = true;
    h.sky.skyline.visible = true;
    h.camera.far = this.savedFar || h.camera.far;
    h.camera.updateProjectionMatrix();
    // back to District 03's endless night
    const u = h.sky.uniforms;
    u.uDay.value = 0;
    u.uStars.value = 0;
    u.uMoonDir.value.set(-0.45, 0.55, 0.7).normalize();
    h.fog.density = 0.0078;
    h.lighting.setKeyDirection(new THREE.Vector3(-55, 85, 38), Math.hypot(55, 85, 38));
    h.lighting.moon.color.set(0x9aaed2);
    h.lighting.fill.color.set(0x4a5878);
    h.lighting.fill.groundColor.set(0x2a2420);
    h.lighting.setExtraLamps([]);
    h.scene.environmentIntensity = 0.85;
    if (this.savedEnv) h.scene.environment = this.savedEnv;
    this.envTex?.dispose();
    this.envTex = null;
    worldUniforms.uWet.value = 0.85;
    worldUniforms.uEmit.value = 1;
    (h.mats.lampWarm as THREE.MeshStandardMaterial).emissiveIntensity = 4.2;
    (h.mats.lampCold as THREE.MeshStandardMaterial).emissiveIntensity = 3.5;
    this.hud.show(false);
  }

  /** Every frame in the RPG. */
  update(dt: number, live: boolean) {
    const h = this.host;
    const p = h.player.pos;
    this.streamer.update(p, live ? 4 : 8);
    // where are we? (a few times a second is plenty)
    this.locate(p);
    this.atmos.update(dt, p, this.place.biome, h.camera);
    const now = this.atmos.now;
    this.sea.update(h.camera.position, h.fog.density, now.wind, now.rain);
    this.precip.update(h.camera.position, now.snow, now.dust, now.windDir, now.wind, this.atmos.daylight);
    this.far.update(p, h.fog, h.sky.uniforms.uSunCol.value);
    this.populace.update(dt, performance.now() / 1000, this.atmos.minutes, p, h.camera, now.rain);
    h.vehicles.grip = this.atmos.now.grip;
    this.traffic.night = 1 - this.atmos.daylight;
    this.traffic.update(dt, p);
    if (!inD03(p.x, p.z)) {
      this.wildlife.update(dt, this.place.biome, h.camera);
      this.cover.update(p, terrainUniforms.uSnowCover.value);
    } else this.cover.clear();
    this.director.update(dt, live, h.camera);
    if (performance.now() >= this.parkT) {
      this.parkT = performance.now() + 800;
      this.park(p);
    }
    // lamps and lit windows come on as it gets dark
    const dark = 1 - THREE.MathUtils.smoothstep(this.atmos.daylight, 0.15, 0.55);
    worldUniforms.uEmit.value = 0.04 + 0.96 * dark;
    // the lamp heads themselves go dark by day
    const m = h.mats;
    (m.lampWarm as THREE.MeshStandardMaterial).emissiveIntensity = 0.15 + 4.05 * dark;
    (m.lampCold as THREE.MeshStandardMaterial).emissiveIntensity = 0.15 + 3.35 * dark;
    this.streamer.glow.uniforms.uNight.value = dark;
    for (const sm of signMats) sm.emissiveIntensity = 0.35 + 1.9 * dark;
    doorMat.emissiveIntensity = 0.04 + 1.4 * dark;
    for (const l of this.cityLamps) if (!l.flicker) l.gain = dark * this.director.dim;
    // the environment (reflections, ambient on shiny things): a real captured sky (Poly Haven HDRIs) for the
    // hour and the place, with a generated one standing in until it's loaded
    this.envT -= dt;
    if (this.envT <= 0) {
      this.envT = 4;
      const got = this.hdri.get(this.skyFor());
      if (got) {
        if (h.scene.environment !== got) {
          h.scene.environment = got;
          this.envTex?.dispose();
          this.envTex = null;
        }
      } else {
        this.loadHdri(this.skyFor());
        if (!this.envTex) {
          const u = h.sky.uniforms;
          this.envTex = h.environment(u.uZenith.value, u.uHorizon.value, new THREE.Color(0.12, 0.1, 0.08).multiplyScalar(0.3 + this.atmos.daylight));
          h.scene.environment = this.envTex;
        }
      }
      // captured skies carry their sun at full strength: each is scaled so the ambient matches the sky it replaces
      this.envGain = got ? HDRI_GAIN[this.skyFor()] ?? 0.4 : 1;
    }
    // (the atmosphere sets the day's ambient each frame; the sky's own strength scales it)
    h.scene.environmentIntensity *= this.envGain;
    this.life.update(dt, live);
    this.hud.update(dt, h.follow.yaw, this.atmos.label, this.atmos.describe(), this.place.name, this.place.region);
    this.marker.update(dt, performance.now() / 1000, this.goal, h.camera, h.player.pos, this.hud.shown && !this.life.panel);
  }

  /**
   * Dress the player in a realistic body made from this spec. The first
   * time (or `now`) it's worn as soon as it's built; a change keeps the old
   * body on until the new one is ready, then swaps.
   */
  setHero(spec: HumanSpec, now = false) {
    const pl = this.host.player;
    const body = this.saved?.body ?? pl.body;
    const next = new RealHuman(JSON.parse(JSON.stringify(spec)), body, { hero: true });
    next.group.visible = false;
    this.group.add(next.group);
    if (this.heroNext) this.drop(this.heroNext);
    this.heroNext = next;
    const wear = () => {
      if (this.heroNext !== next) return;
      this.heroNext = null;
      const old = this.hero;
      this.hero = next;
      if (old && old !== next) this.drop(old);
      if (!this.active) return;
      pl.body = { ...next.body };
      pl.outfit = { ...pl.outfit, bulk: 1 };
      pl.real = next;
      next.group.visible = true;
    };
    if (next.ready) wear();
    else next.onReady = wear;
    void now;
  }

  private drop(r: RealHuman) {
    this.group.remove(r.group);
    r.dispose();
  }

  /** Name the place: a town, a district of Merrow, or the open country and what it's like. */
  private locate(p: THREE.Vector3) {
    const g = this.gen;
    let name: string, region: string, key: string;
    const s = g.placeAt(p.x, p.z, 0);
    if (inD03(p.x, p.z)) {
      const d = districtAt(p.x, p.z);
      name = d && d.id !== 'outskirts' ? d.name : 'District 03';
      region = 'Merrow';
      key = 'd03';
      this.place.biome = 'temperate';
    } else {
      const gr = g.ground(p.x, p.z);
      this.place.biome = gr.biome;
      if (s) {
        name = s.name;
        region = s.kind === 'city' ? CITY_STYLES[s.archetype ?? 'historic'].name : s.kind === 'town' ? 'Town' : s.kind === 'village' ? 'Village' : s.kind === 'ruin' ? 'Abandoned' : s.kind === 'military' ? 'Restricted' : '';
        key = s.id;
      } else {
        const rd = gr.road > 0;
        name = rd ? 'On the road' : BIOMES[gr.biome].name;
        region = rd ? BIOMES[gr.biome].name : 'Open country';
        key = `wild:${gr.biome}`;
      }
    }
    this.place.name = name;
    this.place.region = region;
    this.place.settlement = s;
    if (key !== this.lastPlaceKey) {
      const first = this.lastPlaceKey === '';
      this.lastPlaceKey = key;
      if (!first && s && !inD03(p.x, p.z)) this.hud.arrive(s.name, `${region}${s.home ? '' : ` · ${BIOMES[s.biome].name}`}`);
      else if (!first && key.startsWith('wild:')) this.hud.arrive(BIOMES[this.place.biome].name, BIOMES[this.place.biome].blurb);
    }
  }

  /** Cars parked on the streets near you, ready to take; forgotten once you're well away (unless you're in one). */
  private park(p: THREE.Vector3) {
    const spots: { key: string; x: number; y: number; z: number; yaw: number; d: number }[] = [];
    for (const c of this.streamer.chunks.values()) for (const s of c.cars) {
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < 160) spots.push({ key: `${s.x.toFixed(1)},${s.z.toFixed(1)}`, ...s, d });
    }
    spots.sort((a, b) => a.d - b.d);
    const want = new Set(spots.slice(0, 10).map((s) => s.key));
    for (const [k, car] of this.parked) {
      if (want.has(k) || car.occupied) continue;
      if (car.pos.distanceTo(p) < 200) continue;
      this.host.vehicles.despawn(car);
      this.parked.delete(k);
    }
    for (const s of spots.slice(0, 10)) {
      if (this.parked.has(s.key)) continue;
      const k = Math.abs(Math.floor(s.x * 7 + s.z * 13));
      const car = this.parkCar(s, k);
      this.parked.set(s.key, car);
    }
  }

  /** A car parked here: what the region drives (pickups in farm country, off-roaders in the hills). */
  private parkCar(s: { x: number; y: number; z: number; yaw: number }, k: number): DrivableCar {
    const colors = [0x7a1c16, 0x1c2a44, 0x2c2c2e, 0xb8b4ac, 0x3a4a2a, 0x5a4a36, 0x8a8a86, 0x6a5a2a];
    const biome = this.gen.ground(s.x, s.z).biome;
    const list = BIOMES[biome].vehicles.filter(([v]) => v !== 'bus' && v !== 'moto' && v !== 'taxi' && v !== 'police' && v !== 'ambulance');
    let kind: VehicleKind = 'sedan';
    if (list.length) {
      let sum = 0;
      for (const [, w] of list) sum += w;
      let r = ((k * 2654435761) >>> 0) / 4294967296 * sum;
      for (const [v, w] of list) if ((r -= w) <= 0) {
        kind = v;
        break;
      }
    }
    return this.spawnCar(kind, new THREE.Vector3(s.x, s.y, s.z), s.yaw, colors[k % colors.length], k);
  }

  /** A drivable car of this kind: the city's own model for cars and vans, the road's for the rest. */
  spawnCar(kind: VehicleKind, pos: THREE.Vector3, yaw: number, color: number, k = 0, mesh?: { mesh: THREE.Group; tails: THREE.MeshStandardMaterial }): DrivableCar {
    const t = TUNES[kind] ?? TUNES.sedan;
    const own = kind === 'sedan' || kind === 'hatch' || kind === 'van';
    const m = own ? null : mesh ?? vehicleMesh(kind, this.host.mats);
    const car = this.host.vehicles.spawn({ pos, yaw, color, van: kind === 'van', screen: false, mesh: m?.mesh, tails: m?.tails, kind, tune: t!.tune, seat: t!.seat, reach: t!.reach }, true);
    car.surface = (x, z) => {
      const g = this.gen.ground(x, z);
      return g.road > 0 || g.urban > 0.3 ? 1 : 0;
    };
    void k;
    return car;
  }

  /** Pull the driver out of a stopped car and take it. */
  carjack(p: THREE.Vector3): DrivableCar | null {
    const got = this.traffic.take(p);
    if (!got) return null;
    const car = this.spawnCar(got.kind, got.pos, got.yaw, 0x444444, 0, got);
    this.parked.set(`jack:${Date.now()}`, car);
    return car;
  }

  /** Any street lamp within r of p (for the lights to stutter). */
  nearLamps(p: THREE.Vector3, r: number) {
    return this.cityLamps.some((l) => l.pos.distanceTo(p) < r);
  }

  inD03(p: THREE.Vector3) {
    return inD03(p.x, p.z);
  }

  /** Which captured sky suits the hour and the place. */
  private skyFor(): string {
    const hr = this.atmos.hours, d = this.atmos.daylight;
    if (d < 0.12) return 'night';
    if (hr < 6.5) return 'dawn';
    if (hr < 8) return 'sunrise';
    if (hr > 17.5) return 'sunset';
    const s = this.place.settlement;
    if (s && s.kind === 'city') return 'city';
    const b = this.place.biome;
    if (b === 'forest' || b === 'boreal' || b === 'swamp') return 'forest';
    if (b === 'temperate' || b === 'coast') return 'park';
    return 'sky';
  }

  private envGain = 1;
  private hdri = new Map<string, THREE.Texture>();
  private hdriLoading = new Set<string>();
  private loadHdri(name: string) {
    if (this.hdriLoading.has(name)) return;
    this.hdriLoading.add(name);
    new EXRLoader().load(
      `${import.meta.env.BASE_URL ?? '/'}rpg/env/${name}.exr`,
      (tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        this.hdri.set(name, this.host.envFromEquirect(tex));
        tex.dispose();
        this.envT = 0;
      },
      undefined,
      () => this.hdriLoading.delete(name),
    );
  }

  /** Lamps beyond the city's own: the streets you're near, and your campfire. */
  extraLamps: Lamp[] = [];
  refreshLamps() {
    this.host.lighting.setExtraLamps(this.cityLamps.concat(this.extraLamps));
  }

  /** A shot or a punch through the wider world: the nearest animal it would hit, and what hitting it does. */
  hitTest(o: THREE.Vector3, dir: THREE.Vector3, maxT: number): { t: number; apply: (dmg: number) => boolean; what: string } | null {
    const hit = this.wildlife.hitTest(o, dir, maxT);
    const man = this.populace.hitTest(o, dir, hit ? hit.t : maxT);
    if (man) {
      return {
        t: man.t,
        what: man.w.r.name,
        apply: (dmg) => {
          const killed = this.populace.damage(man.w, dmg * (man.head ? 2.2 : 1), this.host.player.pos);
          this.life.violence(man.w, killed);
          return killed;
        },
      };
    }
    if (!hit) return null;
    return {
      t: hit.t,
      what: hit.a.sp.name,
      apply: (dmg) => {
        const killed = this.wildlife.damage(hit.a, dmg * (hit.head ? 2 : 1), this.host.player.pos);
        if (killed) this.life.killed(hit.a);
        return killed;
      },
    };
  }

  /** Something loud happened here (a gunshot): the animals scatter. */
  alarm(at: THREE.Vector3, r: number) {
    this.wildlife.alarm(at, r);
    this.populace.scatter(at, Math.min(r, 70));
    this.life.gunfire(at);
  }

  /** Something to do with what's in front of you (a person, a door, a place to search), for the interact prompt. */
  interaction(pos: THREE.Vector3, fwd: THREE.Vector3): { name: string; verb: string; go: () => void } | null {
    return this.life.interaction(pos, fwd);
  }

  /** What people say about the places around here: true things, if you go and look. */
  rumourAt(p: THREE.Vector3): string | null {
    const r = Math.random();
    const near = this.gen.settlementsNear(p.x, p.z, 2).filter((s) => s.id !== this.place.settlement?.id && s.kind !== 'junction');
    if (!near.length) return null;
    const s = near[Math.floor(Math.random() * near.length)];
    const dir = compass(s.x - p.x, s.z - p.z);
    const km = Math.round(Math.hypot(s.x - p.x, s.z - p.z) / 100) / 10;
    if (s.kind === 'ruin') return `There's a town ${dir} of here, ${km} km. Empty. Nobody says why.`;
    if (s.kind === 'military') return `Stay away from ${s.name}, ${dir}. They don't like visitors.`;
    if (r < 0.5) return `${s.name}'s ${km} km ${dir}. ${s.kind === 'city' ? 'Big place. Too big.' : 'Nice enough.'}`;
    const pois = this.streamer.poisNear(p.x, p.z, 400);
    if (pois.length) {
      const poi = pois[Math.floor(Math.random() * pois.length)];
      return `${poi.name}. Good people there. Mostly.`;
    }
    return null;
  }

  get debug() {
    const s = this.streamer.stats;
    return { people: this.populace.count, about: this.populace.about, traffic: this.traffic.count, parked: this.parked.size, chunks: this.streamer.chunks.size, tiles: s.tiles, built: s.built, dropped: s.dropped, ms: +s.lastMs.toFixed(1), plants: this.streamer.flora.total, lamps: this.cityLamps.length, chunkSize: CHUNK };
  }
}

/** How strongly each captured sky lights the world (they differ by stops: an open noon sky is blinding). */
const HDRI_GAIN: Record<string, number> = { sky: 0.18, park: 0.3, forest: 0.45, city: 0.4, sunset: 0.45, sunrise: 0.4, dawn: 0.6, night: 1.4 };

/** How each kind handles, where you sit in it, and how long it is (half, from the middle to the axle circles). */
const TUNES: Partial<Record<VehicleKind, { tune: Tune; seat?: { x: number; y: number; z: number }; reach?: number }>> = {
  sedan: { tune: { accel: 1, vmax: 1, steer: 1, offroad: 0.55 } },
  hatch: { tune: { accel: 1.05, vmax: 0.95, steer: 1.08, offroad: 0.5 } },
  van: { tune: { accel: 0.85, vmax: 0.9, steer: 0.9, offroad: 0.5 } },
  sports: { tune: { accel: 1.55, vmax: 1.35, steer: 1.1, offroad: 0.35 }, seat: { x: -0.4, y: 0.34, z: -0.2 } },
  pickup: { tune: { accel: 1, vmax: 0.95, steer: 0.9, offroad: 0.82 }, seat: { x: -0.42, y: 0.72, z: 0.45 }, reach: 1.9 },
  offroad: { tune: { accel: 1.05, vmax: 0.9, steer: 0.95, offroad: 1 }, seat: { x: -0.42, y: 0.66, z: 0.05 }, reach: 1.6 },
  truck: { tune: { accel: 0.55, vmax: 0.75, steer: 0.7, offroad: 0.6 }, seat: { x: -0.55, y: 1.25, z: 3.0 }, reach: 3.4 },
};

export function inD03(x: number, z: number) {
  const d = DISTRICT_03;
  return x > d.x0 && x < d.x1 && z > d.z0 && z < d.z1;
}

function compass(dx: number, dz: number) {
  // north is −z
  const a = (Math.atan2(dx, -dz) * 180) / Math.PI;
  const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return dirs[Math.round(((a + 360) % 360) / 45) % 8];
}
