import * as THREE from 'three';
import { Emitter } from '../core/Emitter';
import { worldUniforms } from '../world/materials';
import type { Sky } from './Sky';
import type { Lighting } from './Lighting';
import type { Weather } from './Weather';

export const LOOP_START = 3 * 60 + 17; // 03:17
export const LOOP_END = 5 * 60 + 29; // 05:29
/** game minutes per real second */
const RATE = 1 / 3;

const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const NIGHT = { zenith: C(0.008, 0.011, 0.02), horizon: C(0.04, 0.045, 0.058), glow: C(0.09, 0.052, 0.028), fog: C(0.042, 0.047, 0.058) };
const DAWN = { zenith: C(0.016, 0.026, 0.05), horizon: C(0.07, 0.085, 0.11), glow: C(0.07, 0.052, 0.04), fog: C(0.065, 0.075, 0.092) };

/**
 * The night runs from 03:17 to 05:29 and then — quietly, with a flicker of
 * every light in the district — it is 03:17 again.
 */
export class TimeOfDay extends Emitter<{ loop: void; minute: number }> {
  minutes = LOOP_START;
  private resetT = -1;
  private rainPhase = Math.random() * 100;
  speed = 1;
  /** admin: hold the rain at this (0..1) instead of letting it come and go */
  rainOverride: number | null = null;

  constructor(private sky: Sky, private fog: THREE.FogExp2, private lighting: Lighting, private weather: Weather) {
    super();
  }

  get label(): string {
    const m = Math.floor(this.minutes);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  get rainLabel(): string {
    const i = this.weather.intensity;
    return i > 0.8 ? 'HEAVY' : i > 0.5 ? 'MODERATE' : 'LIGHT';
  }

  update(dt: number, t: number, running: boolean) {
    if (running && this.resetT < 0) {
      const before = Math.floor(this.minutes);
      this.minutes += dt * RATE * this.speed;
      if (Math.floor(this.minutes) !== before) this.emit('minute', this.minutes);
      if (this.minutes >= LOOP_END) this.resetT = 0;
    }

    // the reset: lights stutter, the clock rolls back
    if (this.resetT >= 0) {
      this.resetT += dt;
      const k = this.resetT;
      worldUniforms.uEmit.value = k < 0.3 ? 0.15 : k < 0.45 ? 1 : k < 0.9 ? 0.05 : k < 1.1 ? 0.6 : k < 1.6 ? 0.02 : Math.min(1, (k - 1.6) * 1.2);
      if (k > 1.6 && this.minutes !== LOOP_START) {
        this.minutes = LOOP_START;
        this.emit('loop', undefined);
      }
      if (k > 2.6) {
        this.resetT = -1;
        worldUniforms.uEmit.value = 1;
      }
    }

    // sky and fog drift towards a dawn that never arrives
    const hours = this.minutes / 60;
    const dawn = smooth(4.2, 5.5, hours) * 0.75;
    const s = this.sky.uniforms;
    s.uZenith.value.lerpColors(NIGHT.zenith, DAWN.zenith, dawn);
    s.uHorizon.value.lerpColors(NIGHT.horizon, DAWN.horizon, dawn);
    s.uGlow.value.lerpColors(NIGHT.glow, DAWN.glow, dawn);
    s.uTime.value = t;
    this.fog.color.lerpColors(NIGHT.fog, DAWN.fog, dawn);
    this.lighting.fill.intensity = 0.95 + dawn * 0.5;
    this.lighting.moon.intensity = 0.6 + dawn * 0.25;
    worldUniforms.uLitScale.value = 1 - 0.45 * smooth(3.4, 5.4, hours);

    // rain comes and goes on a slow cycle
    const n = Math.sin(t * 0.021 + this.rainPhase) * 0.5 + Math.sin(t * 0.0077 + this.rainPhase * 2) * 0.5;
    this.weather.intensity = this.rainOverride ?? 0.62 + 0.3 * n;
    s.uCloud.value = 0.7 + 0.2 * n;
  }
}

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
