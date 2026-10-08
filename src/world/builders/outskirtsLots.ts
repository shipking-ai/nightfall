import * as THREE from 'three';
import type { WorldContext, NpcSpot } from '../WorldContext';
import type { InteractionDef } from '../../data/interactions';
import { M, G, bench, bin, tree, crate, barrel, pallet, fence, parkedCar, CAR_COLORS } from './props';
import { PAD_H } from '../layout';
import type { Rng } from '../rng';

/**
 * The places out past the district's edges: somewhere to stop, something to
 * look at, someone to talk to. A slice of the outskirts gets a few of these
 * on the faces that front a road, each built in its own little frame
 * (`u` along the street, `w` back from the kerb into the block), so the same
 * plan works on either side of a road.
 *
 * Gas station, diner, motel, pocket park, car park, building site, night
 * market. Some sell you something (coffee, a meal, a room), some hide
 * something (a till, a toolbox, a bag in an unlocked car), and most have
 * people in them.
 */

export type LotKind = 'gas' | 'diner' | 'motel' | 'park' | 'carpark' | 'site' | 'market';
export const LOT_WIDTH: Record<LotKind, number> = { gas: 36, diner: 30, motel: 40, park: 34, carpark: 34, site: 38, market: 32 };

/** What a slice's lots hand back: things to press, and people to stand there. */
export interface LotOut {
  spots: { id: string; pos: THREE.Vector3; radius: number; yaw?: number }[];
  defs: Record<string, InteractionDef>;
  people: NpcSpot[];
}

/* ── shared looks ──────────────────────────────────────────── */

/** a lit window seen from the street: warm, but not a lamp */
const glowWin = new THREE.MeshStandardMaterial({ color: 0x1a140d, roughness: 0.3, emissive: new THREE.Color(1, 0.74, 0.46), emissiveIntensity: 0.38 });
const glowCold = new THREE.MeshStandardMaterial({ color: 0x0d1114, roughness: 0.3, emissive: new THREE.Color(0.8, 0.9, 1), emissiveIntensity: 0.5 });
const NEON: THREE.MeshStandardMaterial[] = [
  [1, 0.2, 0.45],
  [0.25, 0.85, 1],
  [1, 0.55, 0.12],
  [0.55, 1, 0.4],
  [0.8, 0.35, 1],
].map(([r, g, b]) => new THREE.MeshStandardMaterial({ color: 0x050505, emissive: new THREE.Color(r, g, b), emissiveIntensity: 3 }));

const SANS = '"IBM Plex Sans", "Helvetica Neue", sans-serif';
const SERIF = '"Instrument Serif", "Times New Roman", serif';
const texCache = new Map<string, THREE.CanvasTexture>();
function sign(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void) {
  let t = texCache.get(key);
  if (t) return t;
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  draw(el.getContext('2d')!, w, h);
  t = new THREE.CanvasTexture(el);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

/** a one-line lit sign: letters on dark, in a colour */
export function wordSign(text: string, fg: string, bg = '#0b0a09', font = SANS) {
  return sign(`w:${text}:${fg}:${bg}`, 512, 128, (c, w, h) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = fg;
    c.globalAlpha = 0.35;
    c.lineWidth = 4;
    c.strokeRect(8, 8, w - 16, h - 16);
    c.globalAlpha = 1;
    c.fillStyle = fg;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    let size = 76;
    c.font = `600 ${size}px ${font}`;
    while (c.measureText(text).width > w - 50 && size > 20) c.font = `600 ${(size -= 4)}px ${font}`;
    c.shadowColor = fg;
    c.shadowBlur = 18;
    c.fillText(text, w / 2, h / 2 + 4);
  });
}

/** billboards for things that don't exist */
const ADS: [string, string, string, string][] = [
  ['KESTREL COLA', 'Still cold at 3:17.', '#e8402e', '#f4efe4'],
  ['MERROW SAVINGS', 'Your money never sleeps. Neither do we.', '#13202c', '#d8b878'],
  ['NIGHT LINE TAXIS', 'Call 555 0317. We are already outside.', '#f2c230', '#141414'],
  ['HARBOUR FERRY', 'Last sailing: always.', '#1d3a4a', '#e6eef0'],
  ['SLEEPWELL', 'You’ll wake up eventually.', '#2a1f3d', '#f0d9ff'],
  ['RADIO 03', 'All night. Every night. The same night.', '#0f0f10', '#ff5a8a'],
  ['DR. ACHTERBERG', 'Dentistry without the waiting.', '#e9ecef', '#2d6a8a'],
  ['ORBIT NOODLES', 'Hot. Fast. Open.', '#c4161c', '#fff3c4'],
];
export function adTexture(i: number) {
  const [brand, line, bg, fg] = ADS[i % ADS.length];
  return sign(`ad:${i % ADS.length}`, 1024, 400, (c, w, h) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    c.fillStyle = fg;
    c.globalAlpha = 0.12;
    for (let k = 0; k < 6; k++) c.fillRect(0, (h / 6) * k, w, 2);
    c.globalAlpha = 1;
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    c.font = `700 120px ${SANS}`;
    let size = 120;
    while (c.measureText(brand).width > w - 100 && size > 40) c.font = `700 ${(size -= 6)}px ${SANS}`;
    c.fillText(brand, 50, 190);
    c.font = `italic 52px ${SERIF}`;
    c.fillText(line, 54, 300);
  });
}

function priceBoard() {
  return sign('prices', 256, 384, (c, w, h) => {
    c.fillStyle = '#101214';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#d9372c';
    c.fillRect(0, 0, w, 96);
    c.fillStyle = '#fff';
    c.font = `700 60px ${SANS}`;
    c.textAlign = 'center';
    c.fillText('NITE', w / 2, 70);
    c.font = `500 30px ${SANS}`;
    c.textAlign = 'left';
    const rows: [string, string][] = [['REG', '3.17'], ['PLUS', '3.17'], ['DIESEL', '3.17']];
    rows.forEach(([a, b], i) => {
      c.fillStyle = '#c9c9c9';
      c.fillText(a, 20, 160 + i * 80);
      c.fillStyle = '#ffb347';
      c.font = `600 44px ${SANS}`;
      c.fillText(b, 130, 162 + i * 80);
      c.font = `500 30px ${SANS}`;
    });
  });
}

/* ── the frame a lot is built in ───────────────────────────── */

export interface LotFrame {
  ctx: WorldContext;
  rng: Rng;
  /** a unique id for this lot (interaction ids hang off it) */
  id: string;
  /** where the lot starts along the street */
  x0: number;
  /** the building line (the pavement's back edge) */
  F: number;
  /** which way is into the block: +1 north-to-south (+z), −1 the other */
  s: 1 | -1;
  out: LotOut;
}

class Frame {
  constructor(readonly f: LotFrame) {}
  get ctx() { return this.f.ctx; }
  get rng() { return this.f.rng; }
  x(u: number) { return this.f.x0 + u; }
  z(w: number) { return this.f.F + this.f.s * w; }
  /** yaw that faces the road */
  get toRoad() { return this.f.s > 0 ? Math.PI : 0; }
  v(u: number, y: number, w: number) { return new THREE.Vector3(this.x(u), y, this.z(w)); }
  /** a visual box, base at y */
  box(mat: THREE.Material, u: number, w: number, y: number, su: number, sy: number, sw: number, color?: number, cast = true) {
    this.ctx.batch.add(mat, G.box, M(this.x(u), y, this.z(w), su, sy, sw), { color, cast });
  }
  /** and one you bump into */
  solid(mat: THREE.Material, u: number, w: number, y: number, su: number, sy: number, sw: number, color?: number, cam = false) {
    this.box(mat, u, w, y, su, sy, sw, color);
    this.ctx.collision.addCentered(this.x(u), y, this.z(w), su, sy, sw, cam);
  }
  cyl(mat: THREE.Material, u: number, w: number, y: number, r: number, h: number, color?: number, collide = true) {
    this.ctx.batch.add(mat, G.cyl, M(this.x(u), y, this.z(w), r, h, r), { color });
    if (collide) this.ctx.collision.addCentered(this.x(u), y, this.z(w), r * 2 + 0.1, h, r * 2 + 0.1, false);
  }
  /** a sign facing the street (w is where it hangs) */
  decal(t: THREE.Texture, u: number, y: number, w: number, su: number, sy: number, emissive = 1.4) {
    const m = this.ctx.decal(t, this.x(u), y, this.z(w), su, sy, this.toRoad, { emissive, rough: 0.5 });
    m.userData.shared = true;
    return m;
  }
  /** something to press, said in INTERACTIONS terms */
  point(key: string, u: number, w: number, def: InteractionDef, radius = 2, yaw?: number) {
    const id = `${this.f.id}:${key}`;
    this.f.out.spots.push({ id, pos: this.v(u, PAD_H, w), radius, yaw });
    this.f.out.defs[id] = def;
  }
  person(mode: NpcSpot['mode'], u: number, w: number, yaw = this.toRoad, pair?: string) {
    this.f.out.people.push({ pos: this.v(u, PAD_H, w), yaw, mode, pair } as NpcSpot);
  }
}

const y0 = PAD_H;

/* ── the lots ──────────────────────────────────────────────── */

export function buildLot(kind: LotKind, f: LotFrame) {
  const L = new Frame(f);
  ({ gas, diner, motel, park, carpark, site, market } as const)[kind](L);
}

/** All-night gas station: a canopy lit cold, pumps, a kiosk with a window you can buy through, and a till. */
function gas(L: Frame) {
  const { ctx } = L;
  const m = ctx.mats;
  // the canopy
  L.box(m.paint, 14, 8, 5.2, 20, 0.7, 10, 0xd9d6cc);
  L.box(m.paint, 14, 3, 5.25, 20.2, 0.5, 0.2, 0xb02222, false);
  L.box(m.paint, 14, 13, 5.25, 20.2, 0.5, 0.2, 0xb02222, false);
  L.box(glowCold, 14, 8, 5.12, 18, 0.06, 8.4, undefined, false);
  for (const [u, w] of [[5, 4.5], [23, 4.5], [5, 11.5], [23, 11.5]]) L.cyl(m.metal, u, w, y0, 0.16, 5.1);
  // pumps on islands
  for (const u of [10, 18]) {
    L.solid(m.concrete, u, 8, y0, 1.4, 0.2, 5);
    for (const w of [6.6, 9.4]) {
      L.box(m.paint, u, w, y0 + 0.2, 0.8, 1.7, 0.55, 0x23262b);
      L.box(glowCold, u, w - 0.29, y0 + 1.25, 0.5, 0.3, 0.02, undefined, false);
      L.box(m.rubber, u + 0.45, w, y0 + 0.6, 0.06, 0.9, 0.06);
    }
  }
  // someone filling up, someone just left
  parkedCar(ctx, L.x(14), L.z(8), Math.PI / 2, L.rng.pick(CAR_COLORS));
  if (L.rng.chance(0.5)) parkedCar(ctx, L.x(6.5), L.z(14.5), Math.PI / 2, L.rng.pick(CAR_COLORS));
  // the kiosk
  L.solid(m.concrete, 30.5, 13, y0, 9, 3.6, 12, 0xbab4a8, true);
  L.box(glowWin, 30.5, 6.97, y0 + 0.5, 7.6, 2.3, 0.06, undefined, false);
  L.box(m.glass, 30.5, 6.9, y0 + 0.45, 7.8, 2.4, 0.04, undefined, false);
  L.box(m.paint, 30.5, 6.9, y0 + 3.0, 9.1, 0.6, 0.2, 0xb02222, false);
  L.decal(wordSign('NITE FUEL · OPEN', '#ffffff', '#b02222'), 30.5, y0 + 3.3, 6.75, 7, 1.6, 1.6);
  // the price pylon
  L.cyl(m.metal, 1.5, 1.2, y0, 0.18, 4.5);
  L.box(m.paint, 1.5, 1.2, y0 + 4.5, 2.3, 3.3, 0.35, 0x111214);
  L.decal(priceBoard(), 1.5, y0 + 6.15, 1.0, 2.1, 3.1, 1.5);
  bin(ctx, L.x(26), L.z(5));
  // what's here
  L.point('coffee', 29, 5.6, { name: 'Kiosk window', verb: 'Use', lines: ['A coffee in a paper cup, burnt and hot.', 'The clerk takes your money without looking up.'], action: 'buy', price: 4, heal: 20 });
  L.point('snacks', 32.5, 5.6, { name: 'Snack rack', verb: 'Use', lines: ['A sandwich in a wedge of plastic. Best before tomorrow, which is a joke.'], action: 'buy', price: 6, heal: 35 });
  L.point('till', 34, 6.2, { name: 'Till', verb: 'Search', lines: [], action: 'stash', cash: [40, 160], crime: 1.1, keep: false }, 1.6);
  L.person('look', 31, 8.5);
  L.person('smoke', 25.5, 15, L.toRoad + 0.6);
  if (L.rng.chance(0.6)) L.person('phone', 7, 13.5, L.toRoad - 0.4);
}

/** A chrome diner, every window lit, and a counter you can eat at. */
function diner(L: Frame) {
  const { ctx } = L;
  const m = ctx.mats;
  L.solid(m.paint, 15, 10, y0, 24, 4.6, 12, 0x8d9a9c, true);
  L.box(m.metal, 15, 3.95, y0 + 0.9, 24.1, 0.18, 0.12, undefined, false);
  L.box(m.metal, 15, 3.95, y0 + 3.4, 24.1, 0.18, 0.12, undefined, false);
  L.box(glowWin, 15, 3.97, y0 + 1.1, 22, 2.2, 0.05, undefined, false);
  for (let u = 4; u <= 26; u += 2.4) L.box(m.metal, u, 3.92, y0 + 1.05, 0.1, 2.3, 0.06, undefined, false);
  L.box(m.darkGlass, 15, 3.9, y0, 1.8, 2.6, 0.08, undefined, false);
  // the roof sign on its frame
  for (const u of [10.5, 19.5]) L.box(m.iron, u, 5, y0 + 4.6, 0.15, 2.2, 0.15);
  L.decal(wordSign('DINER', '#ff5a8a', '#0a0709', SERIF), 15, y0 + 6.1, 4.85, 9, 2.25, 2.2);
  L.decal(wordSign('OPEN 24 HRS', '#7ff0ff'), 24, y0 + 4.0, 3.85, 3.2, 0.8, 2);
  bench(ctx, L.x(6), L.z(1.4), L.toRoad + Math.PI);
  bin(ctx, L.x(2.6), L.z(1.2));
  L.point('meal', 15, 3, { name: 'Diner counter', verb: 'Use', lines: ['Eggs, toast, coffee refilled without asking.', 'The waitress says “same as last night?” You’ve never been here.'], action: 'buy', price: 9, heal: 60 });
  L.point('menu', 22, 3, { name: 'Menu board', verb: 'Read', lines: ['Breakfast served all night. Lunch served all night. Dinner served all night.', 'At the bottom, in pen: “We close at 3:18.”'] });
  L.point('bench', 6, 1.4, { name: 'Bench', verb: 'Sit', lines: [], action: 'sit' }, 1.6, L.toRoad);
  L.person('talk', 9, 2, L.toRoad + Math.PI / 2, 'diner');
  L.person('talk', 10.2, 2, L.toRoad - Math.PI / 2, 'diner');
  L.person('smoke', 25.5, 2.3, L.toRoad + 0.4);
}

/** Two storeys of doors along a walkway, a sign that says VACANCY, a room for the night. */
function motel(L: Frame) {
  const { ctx, rng } = L;
  const m = ctx.mats;
  L.solid(m.paint, 20, 17.5, y0, 36, 6.4, 9, 0x7d5f45, true);
  // the upstairs walkway, its rail, its posts
  L.box(m.concrete, 20, 12, y0 + 3.15, 36, 0.25, 2);
  L.box(m.iron, 20, 11.05, y0 + 3.4, 36, 0.06, 0.06, undefined, false);
  L.box(m.iron, 20, 11.05, y0 + 4.3, 36, 0.06, 0.06, undefined, false);
  for (let u = 2.5; u <= 37.5; u += 5) L.cyl(m.iron, u, 11.1, y0, 0.08, 4.3);
  let room = 1;
  for (const y of [y0, y0 + 3.4])
    for (let u = 4; u < 37; u += 3.8, room++) {
      L.box(m.paint, u, 12.97, y, 1.0, 2.1, 0.06, rng.chance(0.15) ? 0x2b3b52 : 0x5a1d1d, false);
      L.box(rng.chance(0.3) ? glowWin : m.darkGlass, u + 1.5, 12.97, y + 1.0, 1.2, 0.9, 0.05, undefined, false);
      L.box(m.lampWarm, u, 12.9, y + 2.35, 0.25, 0.12, 0.1, undefined, false);
    }
  // the office, with its light on
  L.box(glowWin, 36, 12.96, y0 + 0.6, 2.4, 1.7, 0.05, undefined, false);
  L.decal(wordSign('OFFICE', '#ffd9a0'), 36, y0 + 2.6, 12.9, 2.4, 0.6, 1.6);
  // the sign on its pole
  L.cyl(m.metal, 1.5, 1.5, y0, 0.2, 7);
  L.decal(wordSign('MOTEL', '#7ff0ff', '#09141a', SERIF), 1.5, y0 + 8.2, 1.25, 5, 1.6, 2.2);
  L.decal(wordSign('VACANCY', '#ff3b2f'), 1.5, y0 + 6.9, 1.25, 3.2, 0.8, 2.4);
  L.box(m.iron, 1.5, 1.5, y0 + 7, 5.2, 2.6, 0.4);
  // cars nosed in
  for (let u = 6; u < 36; u += 6.5) if (rng.chance(0.55)) parkedCar(ctx, L.x(u), L.z(8.5), L.toRoad, rng.pick(CAR_COLORS), { van: rng.chance(0.15) });
  L.box(m.paint, 31, 12.4, y0, 0.8, 1.7, 0.7, 0x9fb4c0);
  L.point('room', 36, 11.6, { name: 'Motel office', verb: 'Use', lines: [], action: 'sleep', price: 15 }, 1.8);
  L.point('ice', 31, 11.4, { name: 'Ice machine', verb: 'Use', lines: ['It hums and gives you nothing.', 'Then, much later, one cube.'] }, 1.6);
  L.person('smoke', 12, 11.5, L.toRoad + 0.3);
  if (rng.chance(0.6)) L.person('phone', 22, 11.3, L.toRoad - 0.5);
}

/** A pocket park: grass, a dry fountain, benches, a statue of someone nobody remembers. */
function park(L: Frame) {
  const { ctx, rng } = L;
  const m = ctx.mats;
  L.box(m.paint, 17, 10.5, y0, 32, 0.04, 19, 0x1c2a1b, false);
  L.box(m.paving, 17, 10.5, y0 + 0.01, 2.4, 0.04, 19, undefined, false);
  L.box(m.paving, 17, 10.5, y0 + 0.01, 32, 0.04, 2.4, undefined, false);
  // low railings round it, open at the paths
  for (const [a, b] of [[1, 15.6], [18.4, 33]])
    for (const w of [1, 20]) {
      L.box(m.iron, (a + b) / 2, w, y0 + 0.7, b - a, 0.05, 0.05, undefined, false);
      for (let u = a; u <= b; u += 0.6) L.box(m.iron, u, w, y0, 0.03, 0.7, 0.03, undefined, false);
    }
  // the fountain, dry
  L.cyl(m.stone, 17, 10.5, y0, 2.6, 0.6);
  L.cyl(m.water, 17, 10.5, y0 + 0.55, 2.3, 0.06, undefined, false);
  L.cyl(m.stone, 17, 10.5, y0, 0.35, 2.2, undefined, false);
  L.cyl(m.stone, 17, 10.5, y0 + 2.2, 0.9, 0.18, undefined, false);
  for (const [u, w] of [[5, 5], [29, 5], [5, 16], [29, 16], [11, 18.5], [23, 3]]) tree(ctx, L.x(u), L.z(w), rng, y0, rng.range(1, 1.35));
  // the statue
  L.solid(m.darkStone, 26, 14, y0, 1.6, 1.4, 1.6);
  L.box(m.metal, 26, 14, y0 + 1.4, 0.55, 1.1, 0.4);
  L.box(m.metal, 26, 14, y0 + 2.5, 0.7, 0.7, 0.45);
  L.box(m.metal, 26, 14, y0 + 3.2, 0.32, 0.36, 0.32);
  L.point('statue', 26, 12.6, { name: 'Plaque', verb: 'Read', lines: ['“To the Night Watch of District 03, who kept the lamps.”', 'The name underneath has been rubbed smooth by hands.'] }, 1.8);
  // benches, facing the fountain
  const seats: [number, number][] = [[9, 10.5], [25, 10.5], [17, 5], [17, 16]];
  // whoever sits faces the fountain
  const facing = (u: number, w: number) => Math.atan2(L.x(17) - L.x(u), L.z(10.5) - L.z(w));
  seats.forEach(([u, w], k) => {
    const yaw = facing(u, w);
    bench(ctx, L.x(u), L.z(w), yaw + Math.PI);
    L.point(`bench${k}`, u, w, { name: 'Bench', verb: 'Sit', lines: [], action: 'sit' }, 1.5, yaw);
  });
  L.person('sit', 25, 10.5, facing(25, 10.5));
  L.person('talk', 13, 7, Math.PI / 2, 'park');
  L.person('talk', 14.2, 7, -Math.PI / 2, 'park');
  L.person('look', 17, 13.6, L.toRoad + Math.PI);
}

/** A car park and its booth. One of these cars isn't locked. */
function carpark(L: Frame) {
  const { ctx, rng } = L;
  const m = ctx.mats;
  L.box(m.asphalt, 17, 10.5, y0, 32, 0.03, 19, undefined, false);
  for (let u = 3; u <= 31; u += 3) {
    L.box(m.marking, u, 6, y0 + 0.035, 0.12, 0.01, 5, undefined, false);
    L.box(m.marking, u, 16, y0 + 0.035, 0.12, 0.01, 5, undefined, false);
  }
  const bays: [number, number][] = [];
  for (let u = 4.5; u < 31; u += 3) bays.push([u, 6], [u, 16]);
  let stash: [number, number] | null = null;
  for (const [u, w] of bays) {
    if (!rng.chance(0.5)) continue;
    const back = w > 10;
    parkedCar(ctx, L.x(u), L.z(w), back ? L.toRoad : L.toRoad + Math.PI, rng.pick(CAR_COLORS), { van: rng.chance(0.12) });
    if (!stash && rng.chance(0.4)) stash = [u + 1.4, w];
  }
  // the booth and its barrier
  L.solid(m.paint, 1.8, 2.2, y0, 2.2, 2.6, 2.2, 0x46505a, true);
  L.box(glowWin, 1.8, 1.08, y0 + 1.1, 1.8, 1.0, 0.04, undefined, false);
  L.box(m.paint, 5.5, 2, y0 + 1.0, 5, 0.12, 0.12, 0xd8d0b0, false);
  L.decal(wordSign('PARKING · ALL NIGHT', '#ffffff', '#1d4f8a'), 8, y0 + 4.2, 0.6, 5.5, 1.4, 1.2);
  L.cyl(m.metal, 8, 0.8, y0, 0.12, 3.5);
  if (stash) L.point('glovebox', stash[0], stash[1], { name: 'Unlocked car', verb: 'Search', lines: [], action: 'stash', cash: [25, 140], keep: true }, 1.6);
  L.person('look', 1.8, 2.8, L.toRoad);
  if (rng.chance(0.5)) L.person('wait', 20, 11, L.toRoad + 0.8);
}

/** A building site behind a fence: a crane, a frame of floors, a watchman, a toolbox. */
function site(L: Frame) {
  const { ctx, rng } = L;
  const m = ctx.mats;
  const X = L.x.bind(L), Z = L.z.bind(L);
  // the hoarding along the street, with a gate
  fence(ctx, X(0.5), Z(1), X(15), Z(1));
  fence(ctx, X(21), Z(1), X(37.5), Z(1));
  fence(ctx, X(0.5), Z(1), X(0.5), Z(21));
  fence(ctx, X(37.5), Z(1), X(37.5), Z(21));
  L.decal(adTexture(rng.int(0, 7)), 8, y0 + 1.4, 0.94, 8, 3.1, 0.9);
  L.decal(wordSign('KEEP OUT · SITE 03', '#ffd23f', '#191714'), 29, y0 + 1.4, 0.94, 6, 1.4, 0.9);
  // the frame of something that'll never be finished
  const floors = rng.int(3, 6);
  for (let k = 1; k <= floors; k++) L.box(m.concrete, 13, 13, y0 + k * 3.4 - 0.3, 18, 0.3, 11);
  for (const u of [4.5, 13, 21.5]) for (const w of [8, 18]) L.solid(m.concrete, u, w, y0, 0.5, floors * 3.4, 0.5);
  for (let k = 1; k < floors; k++) L.box(m.metal, 13, 7.4, y0 + k * 3.4 + 0.9, 18, 0.06, 0.06, undefined, false);
  // the crane
  const H = 30 + floors * 2;
  L.solid(m.paint, 30, 15, y0, 1.6, H, 1.6, 0xc9a227);
  L.box(m.paint, 30, 15, y0 + H, 26, 0.9, 0.9, 0xc9a227);
  L.box(m.paint, 30, 15, y0 + H - 2.4, 2.4, 2.2, 2.4, 0xb18d1f);
  L.box(m.concrete, 36, 15, y0 + H - 1.2, 3, 1.4, 1.4);
  L.box(m.lampRed, 30, 15, y0 + H + 1.6, 0.3, 0.3, 0.3, undefined, false);
  L.box(m.lampRed, 18, 15, y0 + H + 0.9, 0.25, 0.25, 0.25, undefined, false);
  L.box(m.metal, 22, 15, y0 + H - 10, 0.05, 10, 0.05, undefined, false);
  // the yard
  for (let k = 0; k < 6; k++) pallet(ctx, X(rng.range(4, 24)), Z(rng.range(3, 6)), rng.range(0, 3), rng.int(1, 4));
  for (let k = 0; k < 4; k++) barrel(ctx, X(rng.range(25, 35)), Z(rng.range(3, 8)), rng.pick([0x2e4a6a, 0x8a3a1a, 0x3a5a2a]), y0);
  crate(ctx, X(33), y0 + 0.6, Z(19), 1.4, 0.2);
  // the cabin, lit
  L.solid(m.paint, 31, 6.5, y0, 6, 2.7, 2.6, 0x6b7b5c, true);
  L.box(glowWin, 30, 5.18, y0 + 1.2, 1.8, 0.9, 0.04, undefined, false);
  L.point('toolbox', 33, 17.5, { name: 'Toolbox', verb: 'Search', lines: [], action: 'stash', cash: [20, 90], keep: true }, 1.6);
  L.point('board', 18, 0.2, { name: 'Planning notice', verb: 'Read', lines: ['Proposed: eleven storeys of residential. Expected completion: 3:17.', 'Someone has written underneath: “which one?”'] }, 1.8);
  L.person('smoke', 28, 5, L.toRoad + 0.4);
}

/** Stalls under string lights, the last market still trading. */
function market(L: Frame) {
  const { ctx, rng } = L;
  const m = ctx.mats;
  const cols = [0x8a2b2b, 0x2b5a8a, 0x2f6b3b, 0xa0782a, 0x6a2f6b];
  const stalls: [number, number][] = [[4, 4], [12, 4], [20, 4], [28, 4], [8, 12], [24, 12]];
  stalls.forEach(([u, w], k) => {
    const c = rng.pick(cols);
    for (const [du, dw] of [[-2.6, -1.4], [2.6, -1.4], [-2.6, 1.4], [2.6, 1.4]]) L.box(m.metal, u + du, w + dw, y0, 0.07, 2.5, 0.07, undefined, false);
    L.box(m.cloth, u, w, y0 + 2.5, 5.8, 0.06, 3.4, c, false);
    L.box(m.cloth, u, w - 1.72, y0 + 2.2, 5.8, 0.36, 0.04, c, false);
    L.solid(m.wood, u, w - 0.6, y0, 5, 0.95, 1.1);
    for (let i = 0; i < 6; i++) ctx.batch.add(m.paint, G.sphere, M(L.x(u - 2 + i * 0.8), y0 + 1.0, L.z(w - 0.6), 0.22, 0.2, 0.22), { color: rng.pick([0xc23b22, 0xe8a21a, 0x5aa02c, 0xd9d14a, 0x7a2a6a]) });
    L.person('look', u + rng.range(-1.5, 1.5), w + 0.7, L.toRoad);
    if (k === 1) L.point('fruit', u, w - 1.6, { name: 'Fruit stall', verb: 'Use', lines: ['An apple, polished on a sleeve, handed over with change.'], action: 'buy', price: 3, heal: 10 }, 1.7);
    if (k === 2) L.point('noodles', u, w - 1.6, { name: 'Noodle stall', verb: 'Use', lines: ['Noodles in a paper box, too hot to eat and you eat them anyway.'], action: 'buy', price: 6, heal: 30 }, 1.7);
    if (k === 4) L.point('trinkets', u, w - 1.6, { name: 'Trinket stall', verb: 'Inspect', lines: ['Watches, dozens of them, all stopped at 3:17.', '“They’re right twice a day,” says the man. “Well. Once.”'] }, 1.7);
  });
  // string lights zig-zagging over the aisle
  for (let u = 0.5; u < 32; u += 1.1) {
    const w = 8 + Math.sin(u * 0.9) * 0.6;
    ctx.batch.add(m.lampWarm, G.sphere, M(L.x(u), y0 + 3.2 + Math.cos(u * 1.7) * 0.15, L.z(w), 0.07, 0.07, 0.07), { cast: false });
  }
  for (const u of [0.5, 31.5]) L.cyl(m.metal, u, 8, y0, 0.06, 3.4);
  L.box(m.iron, 16, 8, y0 + 3.36, 31, 0.02, 0.02, undefined, false);
  L.decal(wordSign('NIGHT MARKET', '#ffd9a0', '#1a0f0a', SERIF), 16, y0 + 4.2, 0.8, 7, 1.75, 1.8);
  for (const u of [12.4, 19.6]) L.cyl(m.wood, u, 0.8, y0, 0.1, 4.2);
  L.person('talk', 15, 8, Math.PI / 2, 'mkt');
  L.person('talk', 16.2, 8, -Math.PI / 2, 'mkt');
}

/* ── the street itself ─────────────────────────────────────── */

const SHOPS = ['LAUNDRY', 'PAWN', 'LIQUOR', 'NOODLES', 'TAILOR', 'KEYS CUT', 'VIDEO', 'BARBER', 'CHEMIST', 'BOOKS', 'ARCADE', 'BAR', 'KEBAB', 'PHONES', 'HARDWARE', 'FLORIST'];
const SHOP_FG = ['#ff5a8a', '#7ff0ff', '#ffb347', '#a8ff7a', '#e3a8ff', '#ffffff'];

/** Ground floors that are shops: a lit window, an awning, a sign. */
export function shopfront(ctx: WorldContext, rng: Rng, xa: number, xb: number, F: number, s: 1 | -1) {
  const m = ctx.mats;
  const w = xb - xa, cx = (xa + xb) / 2, z = F - s * 0.04;
  const ry = s > 0 ? Math.PI : 0;
  ctx.batch.add(rng.chance(0.75) ? glowWin : glowCold, G.box, M(cx, PAD_H + 0.35, z, w - 2, 2.3, 0.05), { cast: false });
  ctx.batch.add(m.darkGlass, G.box, M(cx - w / 2 + 1.6, PAD_H, z - s * 0.01, 1.1, 2.5, 0.05), { cast: false });
  if (rng.chance(0.6)) ctx.batch.add(m.cloth, G.box, M(cx, PAD_H + 2.85, F - s * 0.7, w - 1.2, 0.08, 1.4, 0, s * 0.25), { color: rng.pick([0x7a1f1f, 0x1f3f6a, 0x2a5a2a, 0x5a4a2a, 0x3a3a3a]), cast: false });
  if (rng.chance(0.7)) {
    const name = rng.pick(SHOPS);
    const t = wordSign(name, rng.pick(SHOP_FG));
    const mesh = ctx.decal(t, cx, PAD_H + 3.6, F - s * 0.06, Math.min(w - 2, 4.8), Math.min(w - 2, 4.8) / 4, ry, { emissive: 1.8, rough: 0.5 });
    mesh.userData.shared = true;
  } else ctx.batch.add(rng.pick(NEON), G.box, M(cx, PAD_H + 3.5, F - s * 0.08, Math.min(w - 2, 5), 0.12, 0.06), { cast: false });
}

/** A billboard on a roof, facing the street. */
export function billboard(ctx: WorldContext, rng: Rng, x: number, roofY: number, z: number, s: 1 | -1) {
  const m = ctx.mats;
  const ry = s > 0 ? Math.PI : 0;
  for (const dx of [-3.5, 3.5]) ctx.batch.add(m.iron, G.box, M(x + dx, roofY, z, 0.2, 3.2, 0.2));
  ctx.batch.add(m.iron, G.box, M(x, roofY + 3, z + s * 0.12, 10.4, 4.4, 0.15));
  const mesh = ctx.decal(adTexture(rng.int(0, 99)), x, roofY + 5.2, z - s * 0.02, 10, 4, ry, { emissive: 0.9, rough: 0.6 });
  mesh.userData.shared = true;
  for (const dx of [-3, 0, 3]) ctx.batch.add(m.lampWarm, G.box, M(x + dx, roofY + 7.45, z - s * 0.5, 0.4, 0.1, 0.25), { cast: false });
}

/** A bus shelter: roof, glass, a bench, an advert lit from inside, people waiting. */
export function shelter(ctx: WorldContext, rng: Rng, x: number, z: number, s: 1 | -1, out: LotOut, id: string) {
  const m = ctx.mats;
  const ry = s > 0 ? Math.PI : 0;
  // the shelter's back is to the buildings; it faces the road
  ctx.batch.add(m.metal, G.box, M(x, PAD_H + 2.5, z, 4.2, 0.12, 1.7));
  ctx.batch.add(m.glass, G.box, M(x, PAD_H + 0.1, z + s * 0.8, 4, 2.3, 0.04), { cast: false });
  for (const dx of [-2.05, 2.05]) ctx.batch.add(m.metal, G.box, M(x + dx, PAD_H, z, 0.08, 2.5, 1.7));
  ctx.collision.add(x - 2.1, 0, z + s * 0.8 - 0.1, x + 2.1, 2.6, z + s * 0.8 + 0.1, false);
  const ad = ctx.decal(adTexture(rng.int(0, 99)), x + 1.2, PAD_H + 1.3, z + s * 0.76, 1.6, 0.64 * 1.6, ry, { emissive: 1.2 });
  ad.userData.shared = true;
  bench(ctx, x - 0.6, z + s * 0.45, ry + Math.PI);
  out.spots.push({ id: `${id}:sit`, pos: new THREE.Vector3(x - 0.6, PAD_H, z + s * 0.45), radius: 1.5, yaw: ry });
  out.defs[`${id}:sit`] = { name: 'Bus shelter', verb: 'Sit', lines: [], action: 'sit' };
  out.spots.push({ id: `${id}:times`, pos: new THREE.Vector3(x + 1.2, PAD_H, z), radius: 1.6 });
  out.defs[`${id}:times`] = { name: 'Timetable', verb: 'Read', lines: ['N3 Night Bus. Every 20 minutes.', 'The next one is at 3:17. So was the last one.'] };
  out.people.push({ pos: new THREE.Vector3(x + 1.6, PAD_H, z - s * 0.2), yaw: ry, mode: 'wait' } as NpcSpot);
  if (rng.chance(0.5)) out.people.push({ pos: new THREE.Vector3(x - 0.6, PAD_H, z + s * 0.45), yaw: ry, mode: 'sit' } as NpcSpot);
}

/** A hydrant: a stub of red at the kerb. */
export function hydrant(ctx: WorldContext, x: number, z: number) {
  ctx.batch.add(ctx.mats.paint, G.cyl, M(x, PAD_H, z, 0.17, 0.7, 0.17), { color: 0x8a1c14 });
  ctx.batch.add(ctx.mats.paint, G.sphere, M(x, PAD_H + 0.7, z, 0.18, 0.14, 0.18), { color: 0x8a1c14 });
  ctx.collision.addCentered(x, PAD_H, z, 0.4, 0.9, 0.4, false);
}

/** A bag someone left: a stash to find, once. */
export function stashBag(ctx: WorldContext, x: number, z: number, ry: number) {
  ctx.batch.add(ctx.mats.paint, G.box, M(x, PAD_H, z, 0.75, 0.32, 0.35, ry), { color: 0x1e2a1e });
  ctx.batch.add(ctx.mats.rubber, G.box, M(x, PAD_H + 0.32, z, 0.4, 0.06, 0.06, ry));
}
