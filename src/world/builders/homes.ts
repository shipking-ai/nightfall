import * as THREE from 'three';
import type { WorldContext, NpcSpot } from '../WorldContext';
import { G, M } from './props';
import { itex } from '../interiorTextures';
import type { Rng } from '../rng';

/**
 * The inside of an ordinary building, laid out like a real one.
 *
 * You come in through the street door (south, +z) into the front room. A
 * partition with a doorway leads to the back, which splits into two rooms
 * with a doorway between them. A tall building has a stair hall along its
 * east wall, real treads you walk up, and a whole upper floor with its own
 * rooms. What the rooms are, and what's in them, depends on what the
 * building is: a home (living room, kitchen, bathroom; bedrooms upstairs),
 * a shop (the shop floor and counter, a storeroom, a back office; a flat
 * above), an office (reception, open-plan desks; private offices upstairs),
 * or a store (one big room of racking).
 *
 * Each room gets its own light, a window onto the night, and the right
 * furniture. Homes and shops have people in them; drawers, registers and
 * safes can be searched (it's a crime if someone's home); beds can be slept in.
 */

export type HomeKind = 'house' | 'flat' | 'shop' | 'office' | 'store';

export interface Search {
  id: string;
  pos: THREE.Vector3;
  name: string;
  /** how much cash it can hold */
  cash: [number, number];
}

export interface HomeOut {
  spawn: { x: number; y: number; z: number; yaw: number };
  exit: THREE.Vector3;
  bounds: [number, number, number, number];
  searches: Search[];
  beds: { id: string; pos: THREE.Vector3; yaw: number }[];
  residents: NpcSpot[];
  floors: number;
}

const H = 3.2;
const T = 0.22;

let tex: { win: THREE.Texture; shelf: THREE.Texture; art: THREE.Texture[]; tv: THREE.Texture } | null = null;
function textures() {
  return (tex ??= { win: itex.nightWindow(), shelf: itex.shelfGoods(3), art: [itex.painting(1), itex.painting(2), itex.painting(3)], tv: itex.tvGlow() });
}

const WALLS: Record<HomeKind, number[]> = {
  house: [0x6a5d4e, 0x5a6458, 0x6e5a52, 0x4f5a64],
  flat: [0x5e5a54, 0x4e5862, 0x645a4c],
  shop: [0x7a7468, 0x6a6e66],
  office: [0x8a8e90, 0x6c7276],
  store: [0x5a5a56],
};
const FLOORS: Record<HomeKind, number[]> = {
  house: [0x5a4232, 0x6a5038],
  flat: [0x4a3a2c, 0x6c6258],
  shop: [0x8a8478, 0x5a564e],
  office: [0x4a4e52, 0x5e5a54],
  store: [0x55534e],
};

/** A wall along x at z, from x0 to x1, floor y to y + h, with doorway gaps [centre, width]. */
function wallX(ctx: WorldContext, x0: number, x1: number, z: number, y: number, h: number, color: number, gaps: [number, number][] = []) {
  const cuts = gaps.map(([c, w]) => [c - w / 2, c + w / 2]).sort((a, b) => a[0] - b[0]);
  let at = x0;
  for (const [a, b] of [...cuts, [x1, x1]]) {
    if (a > at + 0.05) ctx.solid(ctx.mats.vertex, (at + a) / 2, y, z, a - at, h, T, { color });
    if (b < x1 && b > a) ctx.solid(ctx.mats.vertex, (a + b) / 2, y + 2.25, z, b - a, h - 2.25, T, { color }); // lintel
    at = Math.max(at, b);
  }
}

/** A wall along z at x. */
function wallZ(ctx: WorldContext, z0: number, z1: number, x: number, y: number, h: number, color: number, gaps: [number, number][] = []) {
  const cuts = gaps.map(([c, w]) => [c - w / 2, c + w / 2]).sort((a, b) => a[0] - b[0]);
  let at = z0;
  for (const [a, b] of [...cuts, [z1, z1]]) {
    if (a > at + 0.05) ctx.solid(ctx.mats.vertex, x, y, (at + a) / 2, T, h, a - at, { color });
    if (b < z1 && b > a) ctx.solid(ctx.mats.vertex, x, y + 2.25, (a + b) / 2, T, h - 2.25, b - a, { color });
    at = Math.max(at, b);
  }
}

interface Room {
  name: string;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y: number;
}

export function buildHome(ctx: WorldContext, id: string, ox: number, oz: number, lotW: number, lotD: number, lotH: number, kind: HomeKind, rng: Rng): HomeOut {
  const W = THREE.MathUtils.clamp(lotW * 0.8, 7.5, 15), D = THREE.MathUtils.clamp(lotD * 0.8, 7.5, 13);
  const tall = lotH > 7 && kind !== 'store';
  const floors = tall ? 2 : 1;
  const wall = rng.pick(WALLS[kind]), floor = rng.pick(FLOORS[kind]);
  const X0 = ox - W / 2, X1 = ox + W / 2, Z0 = oz - D / 2, Z1 = oz + D / 2;
  // a stair hall along the east wall, if there's an upper floor
  const hallW = tall ? 1.3 : 0;
  const RX1 = X1 - hallW;
  const out: HomeOut = { spawn: { x: ox, y: 0.15, z: Z1 - 1.2, yaw: Math.PI }, exit: new THREE.Vector3(ox, 0.15, Z1 - 0.7), bounds: [X0 - 1, Z0 - 1, X1 + 1, Z1 + 1], searches: [], beds: [], residents: [], floors };
  const { mats, batch } = ctx;

  // the shell: floor, outer walls (full height), the street door, the roof
  ctx.solid(mats.vertex, ox, 0, oz, W + 0.5, 0.15, D + 0.5, { color: floor, cam: false });
  const top = H * floors;
  wallX(ctx, X0 - T / 2, X1 + T / 2, Z0 - T / 2, 0, top, wall);
  wallZ(ctx, Z0, Z1, X0 - T / 2, 0, top, wall);
  wallZ(ctx, Z0, Z1, X1 + T / 2, 0, top, wall);
  wallX(ctx, X0 - T / 2, X1 + T / 2, Z1 + T / 2, 0, top, wall, [[ox, 1.3]]);
  ctx.solid(mats.wood, ox, 0.15, Z1 + T / 2 + 0.03, 1.3, 2.1, 0.07);
  ctx.decal(itex.doorSign('Exit'), ox, 2.42, Z1 - 0.01, 0.7, 0.26, Math.PI, { emissive: 0.7 });
  ctx.solid(mats.vertex, ox, top, oz, W + 0.5, 0.25, D + 0.5, { color: 0x1c1a18 });

  // the ground floor: a front room across the width, two rooms behind it
  const zs = Z0 + D * (kind === 'office' ? 0.55 : 0.48);
  const xs = X0 + (RX1 - X0) * (kind === 'shop' ? 0.62 : 0.55);
  const frontGap = (X0 + RX1) / 2;
  if (kind !== 'store') {
    wallX(ctx, X0, RX1, zs, 0.15, H - 0.15, wall, [[kind === 'office' ? frontGap : (X0 + xs) / 2, 1.0], ...(kind === 'office' ? [] : ([[(xs + RX1) / 2, 1.0]] as [number, number][]))]);
    if (kind !== 'office') wallZ(ctx, Z0, zs, xs, 0.15, H - 0.15, wall, [[(Z0 + zs) / 2, 0.95]]);
  }
  if (tall) wallZ(ctx, Z0, Z1, RX1, 0.15, H - 0.15, wall, [[Z1 - 1.0, 1.0], [Z0 + 1.0, 1.0]]);
  const front: Room = { name: 'front', x0: X0, z0: kind === 'store' ? Z0 : zs, x1: RX1, z1: Z1, y: 0.15 };
  const backL: Room = { name: 'backL', x0: X0, z0: Z0, x1: kind === 'office' ? RX1 : xs, z1: zs, y: 0.15 };
  const backR: Room = { name: 'backR', x0: xs, z0: Z0, x1: RX1, z1: zs, y: 0.15 };

  // the stair: treads you can walk up, along the hall from the front to the back
  if (tall) {
    const steps = 13, rise = (H - 0.15) / steps, run = 0.3;
    const sx = RX1 + hallW / 2, z0 = Z1 - 1.8;
    for (let i = 0; i < steps; i++) ctx.solid(mats.wood, sx, 0.15, z0 - i * run, hallW - 0.1, rise * (i + 1), run, { color: 0x4a3524, cam: false });
    // a handrail on the open side
    batch.add(mats.iron, G.box, M(RX1 + 0.08, 1.0 + (H * 0.5) / 2, z0 - (steps * run) / 2, 0.05, 0.05, steps * run + 0.4), { cast: false });
    // the upper floor: slab over the rooms, and over the hall except the stairwell
    const stairTop = z0 - steps * run;
    ctx.solid(mats.vertex, (X0 + RX1) / 2, H - 0.1, oz, RX1 - X0, 0.25, D, { color: floor, cam: false });
    ctx.solid(mats.vertex, sx, H - 0.1, (Z0 + stairTop + 0.15) / 2, hallW, 0.25, stairTop + 0.15 - Z0, { color: floor, cam: false });
    ctx.solid(mats.vertex, sx, H - 0.1, (z0 + 0.15 + Z1) / 2, hallW, 0.25, Z1 - z0 - 0.15, { color: floor, cam: false });
    // upstairs: a hall wall with a door off the landing, and two rooms
    const y1 = H + 0.15;
    wallZ(ctx, Z0, Z1, RX1, y1, H - 0.15, wall, [[Z0 + 1.0, 1.0]]);
    const zu = (Z0 + Z1) / 2;
    wallX(ctx, X0, RX1, zu, y1, H - 0.15, wall, [[RX1 - 1.0, 1.0]]);
    const up1: Room = { name: 'up1', x0: X0, z0: Z0, x1: RX1, z1: zu, y: y1 };
    const up2: Room = { name: 'up2', x0: X0, z0: zu, x1: RX1, z1: Z1, y: y1 };
    for (const r of [up1, up2]) dress(ctx, id, kind, r, kind === 'office' ? 'office' : 'bedroom', rng, out);
    // the guard rail round the stairwell on the landing
    batch.add(mats.iron, G.box, M(sx - hallW / 2 + 0.05, y1 + 0.9, (stairTop + z0) / 2, 0.05, 0.05, z0 - stairTop), { cast: false });
    ctx.lamp(new THREE.Vector3(sx, y1 + H - 0.6, (Z0 + Z1) / 2), 'interior', { intensity: 8, range: 6, cone: false, halo: 0.3, ground: 0 });
  }

  const roles: Record<HomeKind, [string, string, string]> = {
    house: ['living', 'kitchen', 'bath'],
    flat: ['living', 'kitchen', tall ? 'bath' : 'bedroom'],
    shop: ['shop', 'storeroom', 'backoffice'],
    office: ['reception', 'openplan', 'openplan'],
    store: ['racking', 'racking', 'racking'],
  };
  const [rf, rl, rr] = roles[kind];
  dress(ctx, id, kind, front, rf, rng, out);
  if (kind !== 'store') {
    dress(ctx, id, kind, backL, rl, rng, out);
    if (kind !== 'office') dress(ctx, id, kind, backR, rr, rng, out);
  }
  return out;
}

/** Furnish one room for what it's for, light it, give it a window, and its people and things to search. */
function dress(ctx: WorldContext, id: string, kind: HomeKind, r: Room, role: string, rng: Rng, out: HomeOut) {
  const { mats, batch } = ctx;
  const T = textures();
  const w = r.x1 - r.x0, d = r.z1 - r.z0, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, y = r.y;
  const search = (name: string, x: number, z: number, cash: [number, number]) => {
    const sid = `search:${id}:${out.searches.length}`;
    const pos = new THREE.Vector3(x, y, z);
    out.searches.push({ id: sid, pos, name, cash });
    ctx.point(sid, pos, 1.3);
  };
  const solid = (x: number, yy: number, z: number, sw: number, sh: number, sd: number, color: number, m: THREE.Material = mats.vertex) => ctx.solid(m, x, y + yy, z, sw, sh, sd, { color, cam: false });
  const look = (x: number, yy: number, z: number, sw: number, sh: number, sd: number, color: number, m: THREE.Material = mats.vertex) => batch.add(m, G.box, M(x, y + yy, z, sw, sh, sd), { color, cast: false });
  // a window on the outside wall (north, or the side): the city at night through rain
  if (r.z0 <= out.bounds[1] + 1.3) ctx.decal(T.win, cx, y + 1.0, r.z0 + 0.13, Math.min(2.2, w * 0.4), 1.4, 0, { emissive: 0.55 });
  else if (r.x0 <= out.bounds[0] + 1.3) ctx.decal(T.win, r.x0 + 0.13, y + 1.0, cz, Math.min(2.0, d * 0.4), 1.4, Math.PI / 2, { emissive: 0.55 });
  // every room is lit
  ctx.lamp(new THREE.Vector3(cx, y + H - 0.55, cz), 'interior', { intensity: role === 'storeroom' || role === 'racking' ? 9 : 14, range: Math.max(6, Math.max(w, d) * 1.2), cone: false, halo: 0.4, ground: 0 });
  batch.add(mats.lampWarm, G.sphere, M(cx, y + H - 0.3, cz, 0.22, 0.12, 0.22), { cast: false });
  switch (role) {
    case 'living': {
      // a rug, a sofa facing a television, an armchair, a low table, a shelf of books, a picture
      look(cx, 0.005, cz, w * 0.55, 0.01, d * 0.5, rng.pick([0x5a2a24, 0x2a3a4a, 0x4a4030]));
      const sz = cz + d * 0.22;
      solid(cx, 0, sz, 2.0, 0.42, 0.85, 0x3e3430);
      look(cx, 0.42, sz + 0.36, 2.0, 0.45, 0.16, 0x3e3430);
      solid(cx, 0, cz - 0.1, 1.0, 0.38, 0.55, 0x4a3524, mats.wood);
      solid(cx, 0, r.z0 + 0.35, 1.4, 0.55, 0.4, 0x2a2420, mats.wood);
      ctx.decal(T.tv, cx, y + 0.95, r.z0 + 0.3, 1.1, 0.62, 0, { emissive: 0.9 });
      solid(r.x0 + 0.6, 0, cz, 0.85, 0.42, 0.85, 0x4a3a2a);
      solid(r.x1 - 0.25, 0, cz, 0.35, 1.8, 1.2, 0x3a2a1e, mats.wood);
      ctx.decal(T.art[rng.int(0, 2)], r.x0 + 0.13, y + 1.6, cz + d * 0.15, 0.8, 0.6, Math.PI / 2, {});
      search('Sideboard drawers', r.x1 - 0.8, cz, [5, 60]);
      out.residents.push({ pos: new THREE.Vector3(cx, y, sz - 0.1), yaw: Math.PI, mode: 'sit' });
      break;
    }
    case 'kitchen': {
      // counters along the north wall, a stove, a fridge, a table and chairs
      solid(cx, 0, r.z0 + 0.35, w - 0.6, 0.9, 0.6, 0xd8d4c8);
      look(cx, 0.9, r.z0 + 0.35, w - 0.6, 0.04, 0.62, 0x3a3a3a);
      look(cx - w * 0.2, 0.95, r.z0 + 0.3, 0.6, 0.02, 0.5, 0x111111);
      solid(r.x1 - 0.45, 0, r.z0 + 0.4, 0.7, 1.8, 0.7, 0xe8e8e2);
      solid(cx, 0, cz + 0.3, 1.1, 0.74, 0.8, 0x6a4a30, mats.wood);
      for (const s of [-1, 1]) solid(cx + s * 0.75, 0, cz + 0.3, 0.42, 0.45, 0.42, 0x4a3524, mats.wood);
      search('Kitchen cupboard', cx + w * 0.2, r.z0 + 0.9, [0, 25]);
      if (rng.chance(0.5)) out.residents.push({ pos: new THREE.Vector3(cx - w * 0.15, y, r.z0 + 1.0), yaw: Math.PI, mode: 'look' });
      break;
    }
    case 'bath': {
      solid(r.x0 + 0.45, 0, cz, 0.75, 0.55, Math.min(1.7, d - 0.4), 0xe6e6e0);
      solid(r.x1 - 0.35, 0, r.z0 + 0.4, 0.45, 0.45, 0.6, 0xf0f0ea);
      solid(cx, 0, r.z0 + 0.3, 0.55, 0.85, 0.42, 0xf0f0ea);
      look(cx, 1.4, r.z0 + 0.13, 0.5, 0.7, 0.02, 0x8a9aa8);
      search('Bathroom cabinet', cx, r.z0 + 0.7, [0, 10]);
      break;
    }
    case 'bedroom': {
      const by = rng.chance(0.5) ? r.x0 + 1.1 : r.x1 - 1.1;
      solid(by, 0, cz, 1.5, 0.5, 2.0, 0x8a8478);
      look(by, 0.5, cz - 0.75, 1.4, 0.12, 0.4, 0xe0dcd2);
      look(by, 0.5, cz + 0.3, 1.5, 0.08, 1.3, rng.pick([0x5a3a3a, 0x3a4a5a, 0x5a5a3a]));
      solid(by, 0, cz - 1.15, 1.5, 1.0, 0.1, 0x3a2a1e, mats.wood);
      solid(r.x0 + w / 2, 0, r.z0 + 0.35, 1.2, 2.0, 0.6, 0x4a3524, mats.wood);
      solid(by + (by < cx ? 1.0 : -1.0), 0, cz - 0.8, 0.45, 0.5, 0.4, 0x4a3524, mats.wood);
      search('Wardrobe', r.x0 + w / 2, r.z0 + 0.9, [10, 120]);
      search('Bedside drawer', by + (by < cx ? 1.0 : -1.0), cz - 0.3, [0, 40]);
      const bid = `sleep:${id}:${out.beds.length}`;
      out.beds.push({ id: bid, pos: new THREE.Vector3(by, y, cz + 1.2), yaw: 0 });
      ctx.point(bid, new THREE.Vector3(by + (by < cx ? 1.0 : -1.0), y, cz + 0.4), 1.2);
      break;
    }
    case 'shop': {
      // the counter by the door, the till on it, shelving down the walls, a fridge
      solid(cx + w * 0.22, 0, r.z1 - 1.6, 1.8, 1.0, 0.7, 0x5a4430, mats.wood);
      look(cx + w * 0.22, 1.0, r.z1 - 1.6, 0.5, 0.25, 0.4, 0x1a1a1a);
      for (const s of [-1, 1]) {
        const x = s < 0 ? r.x0 + 0.35 : r.x1 - 0.35;
        solid(x, 0, cz - 0.4, 0.55, 1.9, d - 2.6, 0x6a5a48, mats.wood);
        ctx.decal(T.shelf, x - s * 0.29, y + 1.2, cz - 0.4, d - 2.8, 0.55, s < 0 ? Math.PI / 2 : -Math.PI / 2, { emissive: 0.1 });
      }
      solid(cx - w * 0.1, 0, cz - 0.3, 0.8, 1.4, 2.4, 0x6a5a48, mats.wood);
      ctx.decal(T.shelf, cx - w * 0.1 + 0.41, y + 0.9, cz - 0.3, 2.3, 0.5, Math.PI / 2, { emissive: 0.1 });
      solid(r.x0 + 1.3, 0, r.z0 + 0.4, 1.8, 2.0, 0.7, 0xd0d6da);
      search('Till', cx + w * 0.22, r.z1 - 1.0, [40, 320]);
      out.residents.push({ pos: new THREE.Vector3(cx + w * 0.22, y, r.z1 - 2.3), yaw: 0, mode: 'stare' });
      break;
    }
    case 'storeroom':
    case 'racking': {
      const n = Math.max(1, Math.floor((w - 1) / 1.6));
      for (let i = 0; i < n; i++) {
        const x = r.x0 + 0.9 + i * 1.6;
        solid(x, 0, r.z0 + 0.5, 0.9, 2.2, 0.7, 0x4a5058, mats.metal);
        for (let k = 0; k < 3; k++) look(x, 0.3 + k * 0.7, r.z0 + 0.5, 0.8, 0.4, 0.55, rng.pick([0x8a7050, 0x6a5a40, 0x9a8a6a]));
      }
      for (let k = 0; k < 4; k++) solid(r.x0 + 0.8 + rng.next() * (w - 1.6), 0, cz + rng.next() * d * 0.3, 0.6, 0.5 + rng.next() * 0.4, 0.6, 0x8a7050, mats.wood);
      search('Crates', cx, cz, [0, 30]);
      break;
    }
    case 'backoffice': {
      solid(cx, 0, cz, 1.3, 0.75, 0.7, 0x4a3524, mats.wood);
      solid(r.x1 - 0.4, 0, r.z0 + 0.4, 0.6, 0.9, 0.6, 0x3a3e42, mats.metal);
      search('Safe', r.x1 - 0.4, r.z0 + 0.9, [150, 900]);
      search('Desk drawer', cx, cz + 0.6, [0, 60]);
      break;
    }
    case 'reception': {
      solid(cx, 0, cz - 0.6, 2.4, 1.05, 0.8, 0x2a2a2e, mats.wood);
      for (const s of [-1, 1]) solid(cx + s * (w / 2 - 0.6), 0, cz + 0.6, 0.8, 0.45, 1.8, 0x3a3e46);
      ctx.decal(T.art[rng.int(0, 2)], cx, y + 1.7, r.z0 + 0.13, 1.2, 0.8, 0, {});
      out.residents.push({ pos: new THREE.Vector3(cx, y, cz - 1.3), yaw: 0, mode: 'stare' });
      search('Reception drawer', cx, cz - 0.1, [0, 50]);
      break;
    }
    case 'openplan':
    case 'office': {
      const cols = Math.max(1, Math.floor((w - 1) / 2.2)), rows = Math.max(1, Math.floor((d - 1) / 2.0));
      for (let i = 0; i < cols; i++)
        for (let j = 0; j < rows; j++) {
          const x = r.x0 + 1.2 + i * 2.2, z = r.z0 + 1.1 + j * 2.0;
          solid(x, 0, z, 1.5, 0.74, 0.75, 0x6a6a66, mats.wood);
          look(x, 0.74, z - 0.2, 0.55, 0.36, 0.04, 0x101216);
          look(x, 0.0, z + 0.65, 0.5, 0.5, 0.5, 0x2a2a30);
        }
      solid(r.x1 - 0.35, 0, cz, 0.5, 1.3, 0.6, 0x5a5e62, mats.metal);
      search('Filing cabinet', r.x1 - 0.8, cz, [0, 20]);
      if (rng.chance(0.4)) out.residents.push({ pos: new THREE.Vector3(r.x0 + 1.2, y, r.z0 + 1.75), yaw: Math.PI, mode: 'sit' });
      break;
    }
  }
}
