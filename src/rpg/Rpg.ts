import * as THREE from 'three';
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
import { BIOMES, CITY_STYLES, type BiomeId } from './world/biomes';
import { Atmosphere } from './env/Atmosphere';
import { Sea, createSeaMaterial } from './env/Sea';
import { Precip } from './env/Precip';
import { RpgHud } from './ui/RpgHud';
import { FarCities } from './world/FarCities';
import { RealHuman } from './people/RealHuman';
import { heroSpec } from './people/kit';
import { Populace } from './sim/Populace';
import { RoadTraffic } from './sim/RoadTraffic';
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
  thunder: (delay: number, strength: number) => void;
  say: (lines: string[], who: string) => void;
  vehicles: Vehicles;
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
  private saved: { body: Body; outfit: Outfit } | null = null;

  constructor(private host: RpgHost) {
    this.streamer = new Streamer(this.gen, host.collision, host.mats, createSeaMaterial(host.sky, host.fog));
    this.sea = new Sea(createSeaMaterial(host.sky, host.fog));
    this.atmos = new Atmosphere(this.gen, host.sky, host.fog, host.lighting, host.weather, host.scene);
    this.atmos.onThunder = (d, s) => host.thunder(d, s);
    this.hud = new RpgHud(host.ui);
    this.far = new FarCities(this.gen, this.streamer.towns);
    this.populace = new Populace(this.gen, this.streamer.towns, host.collision);
    this.traffic = new RoadTraffic(this.gen, host.mats);
    this.group.add(this.streamer.group, this.sea.mesh, this.precip.points, this.far.mesh, this.populace.group, this.traffic.group);
    this.group.visible = false;
    host.scene.add(this.group);
    this.streamer.onLamps = (all) => {
      this.cityLamps = all;
      host.lighting.setExtraLamps(all);
    };
  }

  /** Into the wider world (behind the intermission card): hook the ground up, build what's around. */
  async start(at: THREE.Vector3, progress: (k: number) => void) {
    const h = this.host;
    this.active = true;
    this.group.visible = true;
    h.collision.base = (x, z, y, step) => (inD03(x, z) ? 0 : this.streamer.surfaceAt(x, z, y, step));
    h.player.waterAt = (x, z) => (inD03(x, z) ? undefined : this.streamer.waterAt(x, z));
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
    // you: a real person, not the city's figure (built in a worker while the world loads)
    const pl = h.player;
    this.saved = { body: pl.body, outfit: pl.outfit };
    if (!this.hero) {
      this.hero = new RealHuman(heroSpec(0.9, 7), pl.body, { hero: true });
      this.group.add(this.hero.group);
    }
    const hero = this.hero;
    const wear = () => {
      pl.body = { ...hero.body };
      pl.outfit = { ...pl.outfit, bulk: 1 };
      pl.real = hero;
      hero.group.visible = true;
    };
    if (hero.ready) wear();
    else hero.onReady = () => {
      if (this.active) wear();
    };
    await this.streamer.preload(at, progress);
    this.locate(at);
    this.atmos.settle(at, this.place.biome);
    this.lastPlaceKey = '';
    this.envT = 0;
  }

  stop() {
    const h = this.host;
    this.active = false;
    this.group.visible = false;
    this.streamer.clear();
    this.far.clear();
    this.populace.clear();
    this.traffic.clear();
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
    this.traffic.night = 1 - this.atmos.daylight;
    this.traffic.update(dt, p);
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
    for (const l of this.cityLamps) if (!l.flicker) l.gain = dark;
    // the environment (reflections, ambient on shiny things) follows the sky every so often
    this.envT -= dt;
    if (this.envT <= 0) {
      this.envT = 6;
      const u = h.sky.uniforms;
      const tex = h.environment(u.uZenith.value, u.uHorizon.value, new THREE.Color(0.12, 0.1, 0.08).multiplyScalar(0.3 + this.atmos.daylight));
      this.envTex?.dispose();
      this.envTex = tex;
      h.scene.environment = tex;
    }
    this.hud.update(dt, h.follow.yaw, this.atmos.label, this.atmos.describe(), this.place.name, this.place.region);
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
    const colors = [0x7a1c16, 0x1c2a44, 0x2c2c2e, 0xb8b4ac, 0x3a4a2a, 0x5a4a36, 0x8a8a86, 0x6a5a2a];
    for (const s of spots.slice(0, 10)) {
      if (this.parked.has(s.key)) continue;
      const k = Math.abs(Math.floor(s.x * 7 + s.z * 13));
      const car = this.host.vehicles.spawn({ pos: new THREE.Vector3(s.x, s.y, s.z), yaw: s.yaw, color: colors[k % colors.length], van: k % 7 === 0, screen: false }, true);
      this.parked.set(s.key, car);
    }
  }

  /** Something to do with what's in front of you (a resident to talk to), for the interact prompt. */
  interaction(pos: THREE.Vector3, fwd: THREE.Vector3): { name: string; verb: string; go: () => void } | null {
    const w = this.populace.nearest(pos, fwd);
    if (!w) return null;
    return {
      name: w.r.met ? w.r.name : 'Stranger',
      verb: 'Talk',
      go: () => {
        const lines = this.populace.talk(w, { hour: this.atmos.hours, weather: this.atmos.describe(), place: this.place.name, rumour: this.rumour(pos) });
        this.host.say(lines, w.r.name);
      },
    };
  }

  /** What people say about the places around here: true things, if you go and look. */
  private rumour(p: THREE.Vector3): string | null {
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
