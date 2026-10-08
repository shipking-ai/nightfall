import type { WeaponClass } from './arsenal';

/**
 * Attachments: every one is a trade. A suppressor keeps you off the
 * minimap and costs you aim speed; a long barrel carries damage further and
 * makes the gun heavier; an extended magazine is slower to reload. Five at
 * most on one gun, one per slot.
 *
 * Modifiers multiply the gun's own numbers (1 = unchanged), except where a
 * field says otherwise. "Better" is not always "bigger": a lower `kick` is
 * better, a lower `ads` (seconds) is better.
 */

export type Slot = 'muzzle' | 'barrel' | 'optic' | 'under' | 'mag' | 'stock' | 'rear' | 'laser' | 'ammo';

export const SLOTS: Slot[] = ['muzzle', 'barrel', 'optic', 'under', 'mag', 'stock', 'rear', 'laser', 'ammo'];
export const SLOT_NAMES: Record<Slot, string> = {
  muzzle: 'Muzzle', barrel: 'Barrel', optic: 'Optic', under: 'Underbarrel', mag: 'Magazine', stock: 'Stock', rear: 'Rear grip', laser: 'Laser', ammo: 'Ammunition',
};
export const MAX_ATTACHMENTS = 5;

export interface Mods {
  dmg?: number;
  range?: number;
  ads?: number;
  sprintFire?: number;
  move?: number;
  hip?: number;
  aim?: number;
  bloom?: number;
  kick?: number;
  kickH?: number;
  recover?: number;
  /** magazine size multiplier, and reserve with it */
  mag?: number;
  reload?: number;
  rpm?: number;
  velocity?: number;
  pen?: number;
  head?: number;
  /** replaces the aimed field of view (degrees) */
  zoom?: number;
  /** no muzzle flash, off the enemy's minimap when you fire, a quieter report */
  quiet?: boolean;
  flashHide?: boolean;
  /** a visible laser: better at the hip, but anyone looking at you sees it */
  laser?: boolean;
  /** a scope that glints at range */
  glint?: boolean;
  /** a shotgun fires one heavy slug instead of a spread */
  slug?: boolean;
}

export type OpticKind = 'irons' | 'dot' | 'holo' | 'prism' | 'acog' | 'scope' | 'thermal';

/** How an attachment changes the gun's model. */
export interface AttachLook {
  /** muzzle device length and radius */
  muzzle?: [len: number, r: number];
  barrel?: number;
  optic?: OpticKind;
  under?: 'vgrip' | 'angled' | 'bipod' | 'launcher' | 'shield';
  mag?: 'box' | 'curved' | 'drum' | 'tube' | 'top' | 'belt' | 'cylinder' | 'none' | 'grip';
  /** magazine length scale */
  magScale?: number;
  stock?: 'none' | 'fixed' | 'folding' | 'skeleton' | 'thumbhole' | 'wood';
  laser?: boolean;
}

export interface Attachment {
  id: string;
  name: string;
  slot: Slot;
  /** which classes take it ('all' firearms) */
  fits: WeaponClass[] | 'guns';
  mods: Mods;
  look?: AttachLook;
  level: number;
}

const LONG: WeaponClass[] = ['ar', 'br', 'smg', 'pdw', 'shotgun', 'sniper', 'dmr', 'lmg'];
const RIFLES: WeaponClass[] = ['ar', 'br', 'dmr', 'lmg', 'sniper'];
const AUTO: WeaponClass[] = ['ar', 'br', 'smg', 'pdw', 'lmg'];
const SIDE: WeaponClass[] = ['pistol', 'revolver'];
const A = (a: Attachment) => a;

export const ATTACHMENTS: Attachment[] = [
  /* ── muzzle ── */
  A({ id: 'suppressor', name: 'Hush-9 suppressor', slot: 'muzzle', fits: 'guns', mods: { quiet: true, flashHide: true, ads: 1.08, range: 0.95 }, look: { muzzle: [0.16, 0.019] }, level: 3 }),
  A({ id: 'longcan', name: 'Longwall suppressor', slot: 'muzzle', fits: RIFLES, mods: { quiet: true, flashHide: true, range: 1.1, velocity: 1.1, ads: 1.14, move: 0.98 }, look: { muzzle: [0.24, 0.021] }, level: 14 }),
  A({ id: 'comp', name: 'Steppe compensator', slot: 'muzzle', fits: AUTO, mods: { kick: 0.84, kickH: 1.12, ads: 1.03 }, look: { muzzle: [0.06, 0.016] }, level: 5 }),
  A({ id: 'brake', name: 'Tusk muzzle brake', slot: 'muzzle', fits: LONG, mods: { kickH: 0.78, kick: 0.95, ads: 1.04 }, look: { muzzle: [0.07, 0.018] }, level: 8 }),
  A({ id: 'flashhider', name: 'Birdcage flash hider', slot: 'muzzle', fits: 'guns', mods: { flashHide: true, kick: 0.96 }, look: { muzzle: [0.05, 0.013] }, level: 2 }),
  A({ id: 'choke', name: 'Full choke', slot: 'muzzle', fits: ['shotgun'], mods: { hip: 0.72, aim: 0.7, range: 1.15, ads: 1.04 }, look: { muzzle: [0.04, 0.02] }, level: 6 }),
  A({ id: 'duckbill', name: 'Spreader', slot: 'muzzle', fits: ['shotgun'], mods: { hip: 1.25, range: 0.85, kick: 0.9 }, look: { muzzle: [0.05, 0.024] }, level: 11 }),
  A({ id: 'pistolcan', name: 'Whisper can', slot: 'muzzle', fits: SIDE, mods: { quiet: true, flashHide: true, ads: 1.1, range: 0.92 }, look: { muzzle: [0.13, 0.016] }, level: 7 }),
  /* ── barrel ── */
  A({ id: 'longbarrel', name: 'Long barrel', slot: 'barrel', fits: LONG, mods: { range: 1.22, velocity: 1.2, ads: 1.1, move: 0.98, hip: 1.05 }, look: { barrel: 1.35 }, level: 4 }),
  A({ id: 'heavybarrel', name: 'Heavy fluted barrel', slot: 'barrel', fits: RIFLES, mods: { kick: 0.88, range: 1.12, ads: 1.12, move: 0.97, sprintFire: 1.1 }, look: { barrel: 1.2 }, level: 10 }),
  A({ id: 'shortbarrel', name: 'Short barrel', slot: 'barrel', fits: LONG, mods: { ads: 0.88, move: 1.02, hip: 0.88, range: 0.82, kick: 1.08 }, look: { barrel: 0.7 }, level: 6 }),
  A({ id: 'ratebarrel', name: 'Lightweight gas barrel', slot: 'barrel', fits: AUTO, mods: { rpm: 1.1, kick: 1.12, range: 0.95 }, look: { barrel: 1.0 }, level: 16 }),
  A({ id: 'compactslide', name: 'Compensated slide', slot: 'barrel', fits: SIDE, mods: { kick: 0.82, ads: 1.05, range: 1.05 }, look: { barrel: 1.15 }, level: 9 }),
  /* ── optic ── */
  A({ id: 'dot', name: 'Pinpoint red dot', slot: 'optic', fits: 'guns', mods: { ads: 1.02, zoom: 50 }, look: { optic: 'dot' }, level: 1 }),
  A({ id: 'holo', name: 'Halo holographic', slot: 'optic', fits: LONG, mods: { ads: 1.04, zoom: 48 }, look: { optic: 'holo' }, level: 3 }),
  A({ id: 'prism', name: 'Prism 2.5×', slot: 'optic', fits: LONG, mods: { ads: 1.1, zoom: 34, aim: 0.85 }, look: { optic: 'prism' }, level: 8 }),
  A({ id: 'acog', name: 'Fieldglass 4×', slot: 'optic', fits: RIFLES, mods: { ads: 1.16, zoom: 22, aim: 0.75, glint: true }, look: { optic: 'acog' }, level: 12 }),
  A({ id: 'scope8', name: 'Longeye 8×', slot: 'optic', fits: ['sniper', 'dmr', 'br'], mods: { ads: 1.22, zoom: 12, aim: 0.6, glint: true }, look: { optic: 'scope' }, level: 15 }),
  A({ id: 'thermal', name: 'Ember thermal', slot: 'optic', fits: RIFLES, mods: { ads: 1.25, zoom: 28, move: 0.98 }, look: { optic: 'thermal' }, level: 24 }),
  A({ id: 'pistoldot', name: 'Slide dot', slot: 'optic', fits: SIDE, mods: { ads: 1.04, zoom: 50 }, look: { optic: 'dot' }, level: 5 }),
  /* ── underbarrel ── */
  A({ id: 'vgrip', name: 'Vertical grip', slot: 'under', fits: LONG, mods: { kick: 0.9, kickH: 0.9, ads: 1.04 }, look: { under: 'vgrip' }, level: 2 }),
  A({ id: 'angled', name: 'Angled grip', slot: 'under', fits: LONG, mods: { ads: 0.92, kick: 0.96, recover: 1.1 }, look: { under: 'angled' }, level: 5 }),
  A({ id: 'bipod', name: 'Bipod', slot: 'under', fits: ['lmg', 'sniper', 'dmr', 'ar', 'br'], mods: { kick: 0.85, hip: 0.9, ads: 1.08, move: 0.97 }, look: { under: 'bipod' }, level: 13 }),
  A({ id: 'stabgrip', name: 'Stabiliser grip', slot: 'under', fits: AUTO, mods: { kickH: 0.75, ads: 1.07, sprintFire: 1.08 }, look: { under: 'vgrip' }, level: 18 }),
  /* ── magazine ── */
  A({ id: 'extmag', name: 'Extended magazine', slot: 'mag', fits: [...AUTO, 'dmr', 'sniper', 'shotgun'], mods: { mag: 1.5, reload: 1.12, ads: 1.05, move: 0.99 }, look: { magScale: 1.45 }, level: 4 }),
  A({ id: 'drummag', name: 'Drum', slot: 'mag', fits: ['ar', 'smg', 'lmg', 'shotgun'], mods: { mag: 2.2, reload: 1.35, ads: 1.12, move: 0.96, sprintFire: 1.12 }, look: { mag: 'drum' }, level: 17 }),
  A({ id: 'fastmag', name: 'Taped magazines', slot: 'mag', fits: [...AUTO, 'dmr'], mods: { reload: 0.78, mag: 1 }, look: { magScale: 1.05 }, level: 7 }),
  A({ id: 'pistolext', name: 'Extended pistol mag', slot: 'mag', fits: ['pistol'], mods: { mag: 1.6, reload: 1.1, ads: 1.04 }, look: { magScale: 1.6 }, level: 6 }),
  A({ id: 'speedloader', name: 'Speed loader', slot: 'mag', fits: ['revolver'], mods: { reload: 0.62 }, level: 8 }),
  /* ── stock ── */
  A({ id: 'nostock', name: 'No stock', slot: 'stock', fits: ['smg', 'pdw', 'ar', 'shotgun'], mods: { ads: 0.86, move: 1.04, sprintFire: 0.9, kick: 1.2, hip: 1.05 }, look: { stock: 'none' }, level: 9 }),
  A({ id: 'heavystock', name: 'Padded stock', slot: 'stock', fits: LONG, mods: { kick: 0.88, ads: 1.08, move: 0.98 }, look: { stock: 'fixed' }, level: 6 }),
  A({ id: 'lightstock', name: 'Skeleton stock', slot: 'stock', fits: LONG, mods: { ads: 0.93, move: 1.02, kick: 1.06 }, look: { stock: 'skeleton' }, level: 3 }),
  A({ id: 'cheekrest', name: 'Cheek rest', slot: 'stock', fits: ['sniper', 'dmr'], mods: { aim: 0.8, ads: 1.04, recover: 1.15 }, look: { stock: 'thumbhole' }, level: 12 }),
  /* ── rear grip ── */
  A({ id: 'stipple', name: 'Stippled grip', slot: 'rear', fits: 'guns', mods: { ads: 0.95, kick: 0.97 }, level: 2 }),
  A({ id: 'quickgrip', name: 'Quickdraw grip', slot: 'rear', fits: 'guns', mods: { ads: 0.88, sprintFire: 0.92, kick: 1.05 }, level: 10 }),
  A({ id: 'rubbergrip', name: 'Rubber wrap', slot: 'rear', fits: 'guns', mods: { kick: 0.93, recover: 1.1, ads: 1.03 }, level: 14 }),
  /* ── laser ── */
  A({ id: 'laser', name: 'Tac laser', slot: 'laser', fits: 'guns', mods: { hip: 0.78, sprintFire: 0.9, laser: true }, look: { laser: true }, level: 5 }),
  A({ id: 'irlaser', name: 'IR laser (no beam)', slot: 'laser', fits: 'guns', mods: { hip: 0.88, ads: 0.97 }, look: { laser: true }, level: 19 }),
  /* ── ammunition ── */
  A({ id: 'hollow', name: 'Hollow point', slot: 'ammo', fits: 'guns', mods: { dmg: 1.08, pen: 0.3, range: 0.9 }, level: 11 }),
  A({ id: 'ap', name: 'Armour piercing', slot: 'ammo', fits: [...RIFLES, 'smg', 'pistol', 'revolver'], mods: { pen: 2, dmg: 0.96, velocity: 1.1 }, level: 15 }),
  A({ id: 'subsonic', name: 'Subsonic', slot: 'ammo', fits: [...LONG, ...SIDE], mods: { quiet: true, velocity: 0.7, range: 0.9 }, level: 13 }),
  A({ id: 'slug', name: 'Slugs', slot: 'ammo', fits: ['shotgun'], mods: { range: 2.4, hip: 0.6, aim: 0.15, kick: 1.2, slug: true }, level: 14 }),
  A({ id: 'dragonbreath', name: 'Incendiary shells', slot: 'ammo', fits: ['shotgun'], mods: { dmg: 1.12, range: 0.8 }, level: 21 }),
];

export const ATTACH: Record<string, Attachment> = Object.fromEntries(ATTACHMENTS.map((a) => [a.id, a]));

export function fits(a: Attachment, cls: WeaponClass) {
  if (cls === 'melee' || cls === 'launcher') return false;
  return a.fits === 'guns' || a.fits.includes(cls);
}

export function attachmentsFor(cls: WeaponClass, slot: Slot) {
  return ATTACHMENTS.filter((a) => a.slot === slot && fits(a, cls));
}

/** A modifier as the gunsmith shows it: what it touches, by how much, and whether that's good. */
export function describe(m: Mods): { label: string; good: boolean }[] {
  const out: { label: string; good: boolean }[] = [];
  const pct = (v: number) => `${v > 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`;
  // [field, label, bigger is better]
  const rows: [keyof Mods, string, boolean][] = [
    ['dmg', 'Damage', true], ['range', 'Range', true], ['rpm', 'Fire rate', true], ['velocity', 'Bullet speed', true], ['pen', 'Penetration', true],
    ['kick', 'Vertical recoil', false], ['kickH', 'Horizontal recoil', false], ['recover', 'Recoil recovery', true], ['hip', 'Hip spread', false], ['aim', 'Aimed spread', false],
    ['ads', 'Aim time', false], ['sprintFire', 'Sprint to fire', false], ['move', 'Move speed', true], ['mag', 'Magazine', true], ['reload', 'Reload time', false],
  ];
  for (const [k, label, up] of rows) {
    const v = m[k] as number | undefined;
    if (v == null || v === 1) continue;
    out.push({ label: `${label} ${pct(v)}`, good: up ? v > 1 : v < 1 });
  }
  if (m.zoom) out.push({ label: `Zoom ${m.zoom <= 14 ? '8×' : m.zoom <= 24 ? '4×' : m.zoom <= 36 ? '2.5×' : '1×'}`, good: true });
  if (m.quiet) out.push({ label: 'Off the minimap when firing', good: true });
  if (m.flashHide) out.push({ label: 'No muzzle flash', good: true });
  if (m.laser) out.push({ label: 'Visible beam', good: false });
  if (m.slug) out.push({ label: 'One heavy slug, not a spread', good: true });
  if (m.glint) out.push({ label: 'Lens glint at range', good: false });
  return out;
}
