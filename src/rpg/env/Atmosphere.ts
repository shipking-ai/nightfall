import * as THREE from 'three';
import type { Sky } from '../../env/Sky';
import type { Lighting } from '../../env/Lighting';
import type { Weather } from '../../env/Weather';
import { worldUniforms } from '../../world/materials';
import { terrainUniforms } from '../world/Terrain';
import { floraUniforms } from '../world/Flora';
import { Simplex, smooth, clamp01, lerp } from '../world/noise';
import { BIOMES, type BiomeId } from '../world/biomes';
import type { WorldGen } from '../world/WorldGen';

/**
 * Time and weather out in the wider world. In District 03 it's always a
 * night between 03:17 and 05:29; out here the loop is broken and days pass:
 * sunrise, noon, sunset, a moon, stars when it's clear.
 *
 * Weather comes in fronts: a slow noise field that drifts across the map on
 * the wind, so a storm you can see over the hills to the west will reach you,
 * and the next valley may be dry. What falls depends on where you are: rain
 * in the rain city, snow in the north and up high, dust storms in the desert,
 * morning fog in the swamps. It all feeds the gameplay: grip on the roads,
 * how far you can see and be seen, how cold you get.
 */

export type Sky24 = 'clear' | 'cloud' | 'rain' | 'storm' | 'fog' | 'snow' | 'dust';

export interface WeatherNow {
  kind: Sky24;
  /** 0..1 how much of it */
  amount: number;
  rain: number;
  snow: number;
  fog: number;
  dust: number;
  cloud: number;
  /** m/s, and the direction it blows towards */
  wind: number;
  windDir: number;
  /** °C where you stand */
  temp: number;
  /** road grip multiplier from the surface water/snow/ice (1 = dry tarmac) */
  grip: number;
  /** how far you can see, metres (stealth, AI sight) */
  visibility: number;
  lightning: number;
}

/** game minutes per real second */
export const RPG_RATE = 0.5;

const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const PAL = {
  night: { zen: C(0.004, 0.006, 0.014), hor: C(0.02, 0.025, 0.04), glow: C(0.02, 0.018, 0.02), fog: C(0.02, 0.024, 0.034) },
  dusk: { zen: C(0.05, 0.07, 0.16), hor: C(0.5, 0.26, 0.12), glow: C(0.6, 0.24, 0.06), fog: C(0.34, 0.24, 0.2) },
  day: { zen: C(0.1, 0.24, 0.6), hor: C(0.52, 0.64, 0.8), glow: C(0.2, 0.18, 0.12), fog: C(0.56, 0.64, 0.74) },
  overcast: { zen: C(0.3, 0.33, 0.37), hor: C(0.42, 0.44, 0.47), glow: C(0.05, 0.05, 0.05), fog: C(0.42, 0.44, 0.47) },
  dust: { zen: C(0.42, 0.3, 0.18), hor: C(0.6, 0.44, 0.28), glow: C(0.3, 0.16, 0.05), fog: C(0.58, 0.42, 0.26) },
};

export class Atmosphere {
  /** minutes since midnight; `day` counts whole days since the night ended */
  minutes = 5 * 60 + 30;
  day = 0;
  speed = 1;
  /** held (a menu, a cutscene) */
  held = false;
  now: WeatherNow = { kind: 'clear', amount: 0, rain: 0, snow: 0, fog: 0, dust: 0, cloud: 0.3, wind: 3, windDir: 0.6, temp: 12, grip: 1, visibility: 3000, lightning: 0 };
  /** 0 midnight … 1 full day (light level) */
  daylight = 0;
  sunDir = new THREE.Vector3();
  /** forced weather (story beats, the pause menu, admin) */
  override: Sky24 | null = null;
  onThunder: ((delay: number, strength: number) => void) | null = null;
  private fronts: Simplex;
  private t = 0;
  private flash = 0;
  private nextBolt = 8;
  private tmpC = new THREE.Color();
  private biomeW = new Map<BiomeId, number>();

  constructor(private gen: WorldGen, private sky: Sky, private fog: THREE.FogExp2, private lighting: Lighting, private weather: Weather, private scene: THREE.Scene) {
    this.fronts = new Simplex(gen.seed ^ 0x51a7);
  }

  get hours() {
    return this.minutes / 60;
  }

  get label(): string {
    const m = Math.floor(this.minutes);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  get partOfDay(): 'night' | 'dawn' | 'morning' | 'afternoon' | 'evening' | 'dusk' {
    const h = this.hours;
    return h < 5 ? 'night' : h < 7 ? 'dawn' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 20 ? 'evening' : h < 21.5 ? 'dusk' : 'night';
  }

  /** Skip time (sleeping, waiting): the weather jumps with it. */
  advance(minutes: number) {
    this.minutes += minutes;
    while (this.minutes >= 1440) {
      this.minutes -= 1440;
      this.day++;
    }
    this.t += minutes * 60 / RPG_RATE / 60;
  }

  /** Weather at a place and time: the drifting fronts, filtered by what the land allows. */
  sample(x: number, z: number, biome: BiomeId, altitude: number): WeatherNow {
    const b = BIOMES[biome];
    const w = b.weather;
    const total = w.clear + w.cloud + w.rain + w.storm + w.fog + w.snow + w.dust;
    // the fronts move east-north-east at a few metres a second (in game time)
    const gameSec = (this.day * 1440 + this.minutes) * 60;
    const wx = x - gameSec * 0.9, wz = z - gameSec * 0.35;
    const n = this.fronts.fbm(wx / 9000, wz / 9000, 3) * 0.5 + 0.5;
    const n2 = this.fronts.fbm(wx / 3000 + 50, wz / 3000, 2) * 0.5 + 0.5;
    const wet = (w.rain + w.storm * 1.3 + w.snow) / total;
    const cloud = clamp01(n * 1.2 - 0.25 + wet * 0.5);
    let precip = clamp01((n - (0.72 - wet * 0.55)) * 3.4);
    // temperature: the biome, the hour, altitude and cloud
    const h = this.hours;
    const diurnal = Math.cos(((h - 14.5) / 24) * Math.PI * 2);
    const temp = b.temp + diurnal * (biome === 'desert' ? 10 : 6) - altitude / 150 - cloud * 3;
    const snowy = temp < 1.5;
    const stormy = w.storm / total > 0.08 && n2 > 0.62;
    const out = this.now;
    out.cloud = cloud;
    out.temp = temp;
    out.wind = 2 + n2 * 9 + precip * 6 + (stormy ? 8 : 0);
    out.windDir = 0.37;
    // morning fog in the damp places; dust where it's dry and blowing
    const fogChance = w.fog / total;
    const morning = smooth(3.5, 5.5, h) * (1 - smooth(8, 10.5, h));
    out.fog = clamp01((n2 - 0.55) * 3 * fogChance * 3 + morning * fogChance * 2.4 * (1 - precip));
    out.dust = w.dust ? clamp01((out.wind - 9) / 6) * (w.dust / total) * 4 : 0;
    if (w.snow === 0 && snowy && precip > 0) precip *= 0.6;
    if (w.rain === 0 && w.snow === 0 && w.storm === 0) precip = 0;
    out.rain = snowy ? 0 : precip;
    out.snow = snowy ? precip : 0;
    out.kind = out.dust > 0.3 ? 'dust' : out.snow > 0.15 ? 'snow' : precip > 0.15 ? (stormy ? 'storm' : 'rain') : out.fog > 0.4 ? 'fog' : cloud > 0.6 ? 'cloud' : 'clear';
    return out;
  }

  private force(k: Sky24) {
    const o = this.now;
    o.kind = k;
    o.rain = k === 'rain' ? 0.65 : k === 'storm' ? 1 : 0;
    o.snow = k === 'snow' ? 0.8 : 0;
    o.fog = k === 'fog' ? 0.9 : 0;
    o.dust = k === 'dust' ? 0.9 : 0;
    o.cloud = k === 'clear' ? 0.15 : k === 'cloud' ? 0.8 : 0.9;
    if (k === 'storm') o.wind = 16;
    if (k === 'snow' && o.temp > 0) o.temp = -2;
  }

  update(dt: number, at: THREE.Vector3, biome: BiomeId, camera: THREE.Camera) {
    this.t += dt;
    if (!this.held) this.advance(dt * RPG_RATE * this.speed);
    const now = this.sample(at.x, at.z, biome, Math.max(0, at.y));
    if (this.override) this.force(this.override);
    // ease between samples so walking across a front isn't a switch
    const k = Math.min(1, dt * 0.5);
    const s = this.smoothed;
    s.rain += (now.rain - s.rain) * k;
    s.snow += (now.snow - s.snow) * k;
    s.fog += (now.fog - s.fog) * k;
    s.dust += (now.dust - s.dust) * k;
    s.cloud += (now.cloud - s.cloud) * k;
    now.rain = s.rain;
    now.snow = s.snow;
    now.fog = s.fog;
    now.dust = s.dust;
    now.cloud = s.cloud;
    now.amount = Math.max(now.rain, now.snow, now.fog, now.dust);

    // the sun: up at 06:00, down at 20:00, highest at 13:00, from the south
    const h = this.hours;
    const dayArc = (h - 6) / 14; // 0..1 while it's up
    const elev = Math.sin(clamp01(dayArc) * Math.PI) * 1.05 - (dayArc < 0 ? (0 - dayArc) * 2 : dayArc > 1 ? (dayArc - 1) * 2 : 0) * 0.5;
    const az = lerp(-1.9, 1.9, dayArc);
    this.sunDir.set(Math.sin(az) * Math.cos(Math.max(elev, -0.3)), Math.sin(elev), Math.cos(az) * Math.cos(Math.max(elev, -0.3)) * 0.8 + 0.35).normalize();
    const sunUp = smooth(-0.12, 0.25, this.sunDir.y);
    const golden = smooth(-0.1, 0.05, this.sunDir.y) * (1 - smooth(0.05, 0.45, this.sunDir.y));
    this.daylight = sunUp;
    const overcast = clamp01(now.cloud * 0.8 + now.rain * 0.4 + now.snow * 0.5 + now.fog * 0.4);
    const dusty = now.dust;

    // sky colours: night → dusk → day, greyed by cloud, browned by dust
    const u = this.sky.uniforms;
    const mixPal = (key: 'zen' | 'hor' | 'glow' | 'fog', out: THREE.Color) => {
      out.copy(PAL.night[key]).lerp(PAL.dusk[key], smooth(-0.15, 0.05, this.sunDir.y) * (1 - sunUp * 0.6));
      out.lerp(PAL.day[key], sunUp);
      out.lerp(this.tmpC.copy(PAL.overcast[key]).multiplyScalar(0.12 + 0.88 * sunUp), overcast * 0.85);
      out.lerp(this.tmpC.copy(PAL.dust[key]).multiplyScalar(0.15 + 0.85 * sunUp), dusty);
      if (golden > 0 && key !== 'zen') out.lerp(PAL.dusk[key], golden * (1 - overcast) * 0.8);
      return out;
    };
    mixPal('zen', u.uZenith.value);
    mixPal('hor', u.uHorizon.value);
    mixPal('glow', u.uGlow.value);
    u.uDay.value = sunUp;
    u.uSunDir.value.copy(this.sunDir);
    u.uSunCol.value.setRGB(1, 0.72 + 0.2 * sunUp, 0.45 + 0.4 * sunUp).multiplyScalar(1 - overcast * 0.85);
    u.uCloud.value = clamp01(now.cloud * 1.1);
    u.uStars.value = (1 - sunUp) * (1 - clamp01(now.cloud * 1.4)) * (1 - smooth(-0.2, -0.05, this.sunDir.y) * 0.7);
    u.uMoonDir.value.set(-this.sunDir.x, Math.abs(this.sunDir.y) * 0.6 + 0.35, -this.sunDir.z).normalize();
    u.uTime.value = this.t;

    // fog: far on a clear day, close in weather and in the dark
    mixPal('fog', this.fog.color);
    const haze = BIOMES[biome].haze;
    const vis = lerp(1600, 3400, sunUp) / haze / (1 + now.rain * 1.6 + now.snow * 3 + now.fog * 9 + now.dust * 7);
    this.fog.density = 1 / Math.max(90, vis);
    now.visibility = vis * (0.35 + 0.65 * sunUp);

    // light: the sun (or moon) is the key light, the sky the fill
    const L = this.lighting;
    const keyIsSun = this.sunDir.y > -0.05;
    L.setKeyDirection(keyIsSun ? this.sunDir : u.uMoonDir.value);
    const sunI = keyIsSun ? 3.6 * smooth(-0.05, 0.3, this.sunDir.y) * (1 - overcast * 0.78) * (1 - dusty * 0.6) : 0;
    const moonI = keyIsSun ? 0 : 0.45 * (1 - overcast * 0.7);
    L.moon.intensity = sunI + moonI;
    L.moon.color.copy(keyIsSun ? this.tmpC.setRGB(1, 0.78 + 0.18 * sunUp, 0.56 + 0.36 * sunUp) : this.tmpC.setRGB(0.6, 0.7, 0.95));
    L.fill.color.copy(u.uZenith.value).lerp(u.uHorizon.value, 0.5).multiplyScalar(1).addScalar(0.02);
    L.fill.groundColor.setRGB(0.18, 0.15, 0.12).multiplyScalar(0.2 + sunUp);
    L.fill.intensity = lerp(0.5, 1.5, sunUp) * (1 + overcast * 0.35 * sunUp) + this.flash * 6;
    this.scene.environmentIntensity = lerp(0.25, 1, sunUp);

    // lightning in storms
    this.flash = Math.max(0, this.flash - dt * 5);
    if (now.kind === 'storm' || (now.rain > 0.8 && this.override === 'storm')) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this.nextBolt = 5 + Math.random() * 16;
        const d = 200 + Math.random() * 2500;
        this.flash = d < 800 ? 1 : 0.5;
        this.onThunder?.(d / 340, d < 800 ? 1 : 0.5);
      }
    }
    now.lightning = this.flash;
    u.uGlow.value.addScalar(this.flash * 0.25);

    // the world's shared uniforms: windows lit at night, wet ground, snow cover, wind
    worldUniforms.uLitScale.value = lerp(1, 0.06, sunUp);
    worldUniforms.uWet.value = clamp01(0.15 + now.rain * 1.1 + (biome === 'swamp' ? 0.4 : 0));
    const cold = clamp01((1 - now.temp) / 6);
    terrainUniforms.uSnowCover.value += (clamp01(now.snow * 1.4 * cold + cold * 0.3) - terrainUniforms.uSnowCover.value) * Math.min(1, dt * 0.02);
    terrainUniforms.uDay.value = sunUp;
    floraUniforms.uWind.value = clamp01(now.wind / 14);
    floraUniforms.uSnowOn.value = terrainUniforms.uSnowCover.value;
    // District 03's rain renderer, driven by the real rain
    this.weather.intensity = now.rain;
    // grip for the roads
    now.grip = 1 - now.rain * 0.28 - terrainUniforms.uSnowCover.value * 0.45 - (now.temp < 0 && now.rain > 0.1 ? 0.25 : 0);
    void camera;
  }

  private smoothed = { rain: 0, snow: 0, fog: 0, dust: 0, cloud: 0.3 };

  /** Settle the weather instantly (arriving, loading a save). */
  settle(at: THREE.Vector3, biome: BiomeId) {
    const n = this.sample(at.x, at.z, biome, Math.max(0, at.y));
    Object.assign(this.smoothed, { rain: n.rain, snow: n.snow, fog: n.fog, dust: n.dust, cloud: n.cloud });
    terrainUniforms.uSnowCover.value = clamp01(n.snow * 1.4 * clamp01((1 - n.temp) / 6) + clamp01((1 - n.temp) / 6) * 0.3);
  }

  /** The words for it, for the HUD and the journal. */
  describe(): string {
    const n = this.now;
    const t = `${Math.round(n.temp)}°C`;
    const k = n.kind === 'clear' ? (this.daylight > 0.3 ? 'Clear' : 'Clear night') : n.kind === 'cloud' ? 'Overcast' : n.kind === 'rain' ? (n.rain > 0.6 ? 'Heavy rain' : 'Rain') : n.kind === 'storm' ? 'Thunderstorm' : n.kind === 'fog' ? 'Fog' : n.kind === 'snow' ? (n.snow > 0.6 ? 'Blizzard' : 'Snow') : 'Dust storm';
    return `${k} · ${t}`;
  }

  /** biome weights (unused for now: a single biome under the player is enough) */
  get weights() {
    return this.biomeW;
  }
}
