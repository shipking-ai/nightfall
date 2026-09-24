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
  };
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
