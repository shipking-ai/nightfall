/**
 * WARZONE's guns. Each one is a trade: the carbine does everything well
 * enough, the SMG wins up close and loses at range, the marksman rifle
 * rewards a steady aim (and a head), the shotgun ends arguments inside a
 * container and starts none outside one. Everyone carries a pistol.
 *
 * Spread is radians of cone; recoil is how far the view kicks per shot
 * (pitch, and a random yaw either side). Aiming down the sights tightens
 * the spread and softens the kick.
 */
export type GunId = 'carbine' | 'smg' | 'marksman' | 'shotgun' | 'pistol';

export interface Gun {
  id: GunId;
  name: string;
  dmg: number;
  /** pellets per shot (shotgun) */
  pellets: number;
  /** seconds between shots */
  rate: number;
  auto: boolean;
  mag: number;
  /** spare rounds you spawn with */
  reserve: number;
  reload: number;
  /** metres before the damage starts to fall off, and where it's gone to the floor */
  range: [number, number];
  /** damage at the end of the range, as a fraction */
  falloff: number;
  hip: number;
  ads: number;
  /** per-shot bloom added to the spread (decays) */
  bloom: number;
  recoil: number;
  headshot: number;
  /** how much it slows you */
  weight: number;
  /** field of view aiming down the sights */
  zoom: number;
  /** a long gun (held in both hands) or a pistol */
  long: boolean;
  sound: 'pistol' | 'smg' | 'cop';
}

export const GUNS: Record<GunId, Gun> = {
  carbine: { id: 'carbine', name: 'Carbine', dmg: 25, pellets: 1, rate: 0.095, auto: true, mag: 30, reserve: 120, reload: 2.1, range: [30, 80], falloff: 0.7, hip: 0.035, ads: 0.004, bloom: 0.004, recoil: 0.011, headshot: 1.5, weight: 0.92, zoom: 46, long: true, sound: 'cop' },
  smg: { id: 'smg', name: 'SMG', dmg: 19, pellets: 1, rate: 0.068, auto: true, mag: 32, reserve: 128, reload: 1.8, range: [14, 40], falloff: 0.55, hip: 0.028, ads: 0.011, bloom: 0.003, recoil: 0.008, headshot: 1.35, weight: 1, zoom: 52, long: true, sound: 'smg' },
  marksman: { id: 'marksman', name: 'Marksman rifle', dmg: 58, pellets: 1, rate: 0.36, auto: false, mag: 10, reserve: 40, reload: 2.5, range: [60, 140], falloff: 0.8, hip: 0.06, ads: 0.0008, bloom: 0.012, recoil: 0.034, headshot: 2, weight: 0.86, zoom: 30, long: true, sound: 'cop' },
  shotgun: { id: 'shotgun', name: 'Shotgun', dmg: 15, pellets: 8, rate: 0.78, auto: false, mag: 6, reserve: 30, reload: 2.8, range: [8, 24], falloff: 0.2, hip: 0.075, ads: 0.055, bloom: 0, recoil: 0.05, headshot: 1.2, weight: 0.9, zoom: 54, long: true, sound: 'cop' },
  pistol: { id: 'pistol', name: 'Pistol', dmg: 26, pellets: 1, rate: 0.17, auto: false, mag: 12, reserve: 48, reload: 1.35, range: [18, 45], falloff: 0.6, hip: 0.022, ads: 0.007, bloom: 0.006, recoil: 0.018, headshot: 1.6, weight: 1.05, zoom: 52, long: false, sound: 'pistol' },
};

export interface Loadout {
  id: string;
  name: string;
  line: string;
  primary: GunId;
  secondary: GunId;
}

export const LOADOUTS: Loadout[] = [
  { id: 'assault', name: 'Assault', line: 'Carbine and pistol. Good at every range, best at none.', primary: 'carbine', secondary: 'pistol' },
  { id: 'close', name: 'Close quarters', line: 'SMG and pistol. Fast on your feet, fast to kill, inside the stacks.', primary: 'smg', secondary: 'pistol' },
  { id: 'marksman', name: 'Marksman', line: 'Marksman rifle and pistol. Hold an angle down a long lane.', primary: 'marksman', secondary: 'pistol' },
  { id: 'breacher', name: 'Breacher', line: 'Shotgun and pistol. Nothing survives a doorway.', primary: 'shotgun', secondary: 'pistol' },
];

/** Damage at a distance, after falloff. */
export function damageAt(g: Gun, dist: number) {
  const [a, b] = g.range;
  if (dist <= a) return g.dmg;
  const k = Math.min(1, (dist - a) / Math.max(1, b - a));
  return g.dmg * (1 - k * (1 - g.falloff));
}

/** Armor soaks this share of damage until it's gone. */
export const ARMOR_SOAK = 0.6;
export const MAX_ARMOR = 50;
