import { Emitter } from './Emitter';
import { readJSON, writeJSON } from './storage';

export type Quality = 'low' | 'medium' | 'high';

export interface SettingsData {
  quality: Quality;
  shadows: boolean;
  postfx: boolean;
  atmosphere: boolean;
  fov: number;
  master: number;
  ambience: number;
  music: number;
  /** the car radio (live internet radio) */
  radio: number;
  sensitivity: number;
  invertY: boolean;
  reducedMotion: boolean;
  /** combat: blood sprays and pools */
  blood: boolean;

  // ── controller
  padSensX: number;
  padSensY: number;
  /** look speed while aiming, as a fraction */
  padAimSens: number;
  /** extra turn speed at the edge of the stick, 0..1 */
  padAccel: number;
  padDeadzone: number;
  padCurve: 'linear' | 'classic' | 'dynamic';
  padInvertX: boolean;
  padInvertY: boolean;
  southpaw: boolean;
  vibration: boolean;
  vibrationStrength: number;
  /** impulse triggers (Xbox) where the browser supports them */
  triggerEffects: boolean;
  aimAssist: 'off' | 'low' | 'standard';
  sprintMode: 'hold' | 'toggle';
  aimMode: 'hold' | 'toggle';
  crouchMode: 'hold' | 'toggle';

  // ── interface
  /** 'auto' grows the interface for the television when a controller is in use */
  uiSize: 'auto' | 'standard' | 'large';
  /** which button names to show; 'auto' follows the device in your hands */
  prompts: 'auto' | 'keyboard' | 'xbox' | 'playstation';

  // ── performance
  /** people and traffic in the streets */
  population: 'low' | 'medium' | 'high';
  drawDistance: 'near' | 'medium' | 'far';

  /** the last way of playing you picked */
  lastMode: 'city' | 'afterhours' | 'warzone' | 'fight' | 'rpg';
}

const KEY = 'nightfall.settings.v1';

function defaults(): SettingsData {
  const prefersReduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // phones and tablets start on the light settings (they can turn things up in Settings)
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const weak = (navigator.hardwareConcurrency ?? 8) <= 4 || touch;
  return {
    quality: weak ? 'low' : 'medium',
    shadows: !weak,
    postfx: true,
    atmosphere: true,
    fov: 62,
    master: 0.8,
    ambience: 0.8,
    music: 0.5,
    radio: 0.7,
    sensitivity: 1,
    invertY: false,
    reducedMotion: prefersReduced,
    blood: true,
    padSensX: 1,
    padSensY: 1,
    padAimSens: 0.6,
    padAccel: 0.5,
    padDeadzone: 0.14,
    padCurve: 'dynamic',
    padInvertX: false,
    padInvertY: false,
    southpaw: false,
    vibration: true,
    vibrationStrength: 0.8,
    triggerEffects: true,
    aimAssist: 'low',
    sprintMode: 'hold',
    aimMode: 'hold',
    crouchMode: 'toggle',
    uiSize: 'auto',
    prompts: 'auto',
    population: weak ? 'low' : 'medium',
    drawDistance: weak ? 'near' : 'medium',
    lastMode: 'city',
  };
}

/** How much of the city to keep alive (people and cars) per population setting. */
export function populationShare(p: SettingsData['population']) {
  return p === 'low' ? { people: 0.55, traffic: 0.5 } : p === 'medium' ? { people: 0.8, traffic: 0.75 } : { people: 1, traffic: 1 };
}

/** Camera far plane and the character detail ranges per draw distance. */
export function distanceBudget(d: SettingsData['drawDistance']) {
  return d === 'near' ? { far: 900, lodNear: 26, lodMid: 60 } : d === 'medium' ? { far: 1600, lodNear: 34, lodMid: 80 } : { far: 2500, lodNear: 42, lodMid: 110 };
}

/** Quality preset → concrete renderer budgets. */
export function budget(q: Quality) {
  switch (q) {
    case 'low':
      return { pixelRatio: Math.min(devicePixelRatio, 1) * 0.8, rain: 3500, pointLights: 4, shadowSize: 512, msaa: 0 };
    case 'medium':
      return { pixelRatio: Math.min(devicePixelRatio, 1.25), rain: 7000, pointLights: 6, shadowSize: 1024, msaa: 0 };
    case 'high':
      return { pixelRatio: Math.min(devicePixelRatio, 1.75), rain: 11000, pointLights: 8, shadowSize: 2048, msaa: 4 };
  }
}

export class Settings extends Emitter<{ change: { key: keyof SettingsData; data: SettingsData } }> {
  data: SettingsData;

  constructor() {
    super();
    this.data = { ...defaults(), ...(readJSON<Partial<SettingsData>>(KEY) ?? {}) };
    this.applyDocument();
  }

  set<K extends keyof SettingsData>(key: K, value: SettingsData[K]): void {
    if (this.data[key] === value) return;
    this.data[key] = value;
    writeJSON(KEY, this.data);
    this.applyDocument();
    this.emit('change', { key, data: this.data });
  }

  private applyDocument(): void {
    document.documentElement.classList.toggle('reduce-motion', this.data.reducedMotion);
  }
}
