import { WEAPON, WEAPONS, isSecondary, type FireMode, type Look, type Weapon, type WeaponClass } from './arsenal';
import { ATTACH, MAX_ATTACHMENTS, fits, type AttachLook, type Mods, type OpticKind } from './attachments';
import { readJSON, writeJSON } from '../../core/storage';

/**
 * A gun as the match uses it: a weapon from the arsenal with its attachments
 * folded into the numbers. The match, the bots and the HUD only ever read a
 * Gun; the arsenal and attachments are where they come from.
 *
 * Spread is radians of cone; recoil is how far the view kicks per shot.
 */
export type GunId = string;

export interface Gun {
  id: GunId;
  name: string;
  cls: WeaponClass;
  mode: FireMode;
  burst: number;
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
  reloadEmpty: number;
  /** loads one round at a time (and can be interrupted) */
  single: boolean;
  /** metres before the damage starts to fall off, and where it's gone to the floor */
  range: [number, number];
  /** damage at the end of the range, as a fraction */
  falloff: number;
  hip: number;
  /** aimed spread */
  ads: number;
  /** seconds to bring the sights up */
  adsTime: number;
  sprintFire: number;
  /** per-shot bloom added to the spread (decays) */
  bloom: number;
  recoil: number;
  kickH: number;
  bias: number;
  recover: number;
  headshot: number;
  limb: number;
  /** how much it slows you */
  weight: number;
  /** field of view aiming down the sights */
  zoom: number;
  /** a long gun (held in both hands) or a pistol */
  long: boolean;
  sound: 'pistol' | 'smg' | 'cop';
  caliber: number;
  report: Weapon['report'];
  /** m/s, 0 = arrives at once */
  velocity: number;
  pen: number;
  blast: number;
  blastDmg: number;
  quiet: boolean;
  flashHide: boolean;
  laser: boolean;
  glint: boolean;
  /** what it looks like, attachments included */
  look: Look & { optic: OpticKind; muzzle?: [number, number]; under?: AttachLook['under']; magScale: number; laser: boolean };
  atts: string[];
}

const SOUND = (w: Weapon): Gun['sound'] => (w.cls === 'pistol' || w.cls === 'revolver' ? 'pistol' : w.cls === 'smg' || w.cls === 'pdw' ? 'smg' : 'cop');

/** The weapon with these attachments on (ones that don't fit, or past five, are ignored). */
export function compile(w: Weapon, atts: string[] = []): Gun {
  const m: Required<Pick<Mods, 'dmg' | 'range' | 'ads' | 'sprintFire' | 'move' | 'hip' | 'aim' | 'bloom' | 'kick' | 'kickH' | 'recover' | 'mag' | 'reload' | 'rpm' | 'velocity' | 'pen' | 'head'>> = {
    dmg: 1, range: 1, ads: 1, sprintFire: 1, move: 1, hip: 1, aim: 1, bloom: 1, kick: 1, kickH: 1, recover: 1, mag: 1, reload: 1, rpm: 1, velocity: 1, pen: 1, head: 1,
  };
  let zoom = w.zoom, quiet = false, flashHide = false, laser = false, glint = !!w.look.scope, slug = false;
  const look: Gun['look'] = { ...w.look, optic: w.look.scope ? 'scope' : 'irons', magScale: 1, laser: false };
  const used = new Set<string>();
  const on: string[] = [];
  for (const id of atts) {
    const a = ATTACH[id];
    if (!a || !fits(a, w.cls) || used.has(a.slot) || on.length >= MAX_ATTACHMENTS) continue;
    used.add(a.slot);
    on.push(id);
    for (const k of Object.keys(m) as (keyof typeof m)[]) if (typeof a.mods[k] === 'number') m[k] *= a.mods[k] as number;
    if (a.mods.zoom) zoom = a.mods.zoom;
    quiet ||= !!a.mods.quiet;
    flashHide ||= !!a.mods.flashHide;
    laser ||= !!a.mods.laser;
    glint ||= !!a.mods.glint;
    slug ||= !!a.mods.slug;
    const l = a.look;
    if (l) {
      if (l.muzzle) look.muzzle = l.muzzle;
      if (l.barrel) look.barrel = w.look.barrel * l.barrel;
      if (l.optic) look.optic = l.optic;
      if (l.under) look.under = l.under;
      if (l.mag) look.mag = l.mag;
      if (l.magScale) look.magScale = l.magScale;
      if (l.stock) look.stock = l.stock;
      if (l.laser) look.laser = true;
    }
  }
  const pellets = slug ? 1 : w.pellets;
  const dmg = (slug ? w.dmg * w.pellets * 0.6 : w.dmg) * m.dmg;
  const mag = w.mag ? Math.max(1, Math.round(w.mag * m.mag)) : 0;
  const rpm = w.rpm * m.rpm;
  return {
    id: w.id,
    name: w.name,
    cls: w.cls,
    mode: w.mode,
    burst: w.burst ?? 1,
    dmg,
    pellets,
    rate: 60 / rpm,
    auto: w.mode === 'auto',
    mag,
    reserve: Math.round(w.reserve * Math.max(1, m.mag)),
    reload: w.reload * m.reload,
    reloadEmpty: w.reloadEmpty * m.reload,
    single: !!w.single,
    range: [w.range[0] * m.range, w.range[1] * m.range],
    falloff: w.falloff,
    hip: w.hip * m.hip,
    ads: w.aim * m.aim,
    adsTime: w.ads * m.ads,
    sprintFire: w.sprintFire * m.sprintFire,
    bloom: w.bloom * m.bloom,
    recoil: w.kick * m.kick,
    kickH: w.kickH * m.kickH,
    bias: w.bias,
    recover: w.recover * m.recover,
    headshot: w.head * m.head,
    limb: w.limb,
    weight: w.move * m.move,
    zoom,
    long: !(w.cls === 'pistol' || w.cls === 'revolver' || w.cls === 'melee'),
    sound: SOUND(w),
    caliber: w.caliber,
    report: w.report,
    velocity: w.velocity * m.velocity,
    pen: Math.min(1, w.pen * m.pen),
    blast: w.blast ?? 0,
    blastDmg: w.blastDmg ?? 0,
    quiet,
    flashHide,
    laser,
    glint,
    look,
    atts: on,
  };
}

/** Every weapon as it comes, no attachments: what the bots carry and the kill feed names. */
export const GUNS: Record<GunId, Gun> = Object.fromEntries(WEAPONS.map((w) => [w.id, compile(w)]));

export const PRIMARIES = WEAPONS.filter((w) => !isSecondary(w));
export const SECONDARIES = WEAPONS.filter((w) => isSecondary(w));

export type Lethal = 'frag' | 'semtex' | 'molotov' | 'claymore' | 'throwknife' | 'c4';
export type Tactical = 'smoke' | 'flash' | 'stun' | 'decoy' | 'sensor' | 'stim';

export interface Loadout {
  id: string;
  name: string;
  line: string;
  primary: GunId;
  secondary: GunId;
  /** attachments on each */
  pa: string[];
  sa: string[];
  lethal: Lethal;
  tactical: Tactical;
  /** one of yours (editable), or a preset */
  custom?: boolean;
}

export const PRESETS: Loadout[] = [
  { id: 'assault', name: 'Assault', line: 'Vanta rifle with a dot and a grip, pistol. Good at every range, best at none.', primary: 'carbine', secondary: 'pistol', pa: ['dot', 'vgrip', 'comp'], sa: [], lethal: 'frag', tactical: 'flash' },
  { id: 'close', name: 'Close quarters', line: 'SMG, no stock, quick grip. Fast on your feet, fast to kill, inside the stacks.', primary: 'smg', secondary: 'pistol', pa: ['nostock', 'laser', 'quickgrip'], sa: [], lethal: 'semtex', tactical: 'stun' },
  { id: 'marksman', name: 'Marksman', line: 'Marksman rifle on a 4× with a bipod. Hold an angle down a long lane.', primary: 'marksman', secondary: 'pistol', pa: ['acog', 'bipod', 'cheekrest'], sa: [], lethal: 'claymore', tactical: 'sensor' },
  { id: 'breacher', name: 'Breacher', line: 'Pump shotgun with a choke. Nothing survives a doorway.', primary: 'shotgun', secondary: 'pistol', pa: ['choke', 'laser'], sa: [], lethal: 'molotov', tactical: 'smoke' },
  { id: 'sniper', name: 'Recon', line: 'Bolt-action on an 8× and a suppressed sidearm. One shot, then move.', primary: 'longmere', secondary: 'pistol', pa: ['scope8', 'cheekrest', 'longcan'], sa: ['pistolcan'], lethal: 'claymore', tactical: 'decoy' },
  { id: 'support', name: 'Support', line: 'Belt-fed machine gun on a bipod, and a launcher for the turret.', primary: 'bulwark', secondary: 'thresher', pa: ['bipod', 'holo'], sa: [], lethal: 'frag', tactical: 'smoke' },
].filter((l) => WEAPON[l.primary] && WEAPON[l.secondary]) as Loadout[];

const KEY = 'nightfall.warzone.loadouts.v1';
export const CUSTOM_SLOTS = 5;

/** Your five custom loadouts (starting as copies of the presets). */
export function customLoadouts(): Loadout[] {
  const saved = readJSON<Loadout[]>(KEY);
  const out: Loadout[] = [];
  for (let i = 0; i < CUSTOM_SLOTS; i++) {
    const s = saved?.[i];
    const base = PRESETS[i % PRESETS.length];
    const ok = s && WEAPON[s.primary] && WEAPON[s.secondary];
    out.push(ok ? { ...base, ...s, id: `custom${i}`, custom: true } : { ...base, id: `custom${i}`, name: `Custom ${i + 1}`, custom: true });
  }
  return out;
}

export function saveCustom(list: Loadout[]) {
  writeJSON(KEY, list.filter((l) => l.custom));
}

/** The presets and yours, in the order the loadout screen shows them. */
export function allLoadouts(): Loadout[] {
  return [...PRESETS, ...customLoadouts()];
}

/** The two guns a loadout puts in your hands. */
export function loadoutGuns(l: Loadout): [Gun, Gun] {
  return [compile(WEAPON[l.primary] ?? WEAPON.carbine, l.pa), compile(WEAPON[l.secondary] ?? WEAPON.pistol, l.sa)];
}

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

/** What a bot might carry: every firearm primary, weighted towards the common ones. */
export const BOT_PRIMARIES = PRIMARIES.map((w) => w.id);
