import * as THREE from 'three';
import type { WorldContext } from '../WorldContext';
import { G, M } from './props';
import { itex } from '../interiorTextures';

/**
 * The places you can walk into. Each is a small hand-built room, built with
 * the city but out past its edge (x ≥ 1000), where fog hides it; a door on
 * the real street fades you there and back. Lamps, collision, people and
 * multiplayer all just work, because it's the same world.
 */

export interface InteriorDef {
  id: string;
  name: string;
  code: string;
  /** where you stand in the street when you come back out, and which way you face */
  door: { x: number; z: number; yaw: number };
  /** where you appear inside */
  spawn: { x: number; y: number; z: number; yaw: number };
  /** x0, z0, x1, z1: "is this position inside?" */
  bounds: [number, number, number, number];
  /** an Archive entry found by stepping in, if any */
  unlock?: string;
  /** a line when you first step in */
  first?: string[];
}

export const INTERIORS: InteriorDef[] = [];

/** Street doors: an interaction spot outside each entrance ("enter:<id>"). */
const DOORS: { id: string; x: number; z: number; yaw: number }[] = [
  { id: 'hotel', x: 11.4, z: -8, yaw: -Math.PI / 2 },
  { id: 'launderette', x: -90.5, z: -4.4, yaw: Math.PI },
  { id: 'deli', x: -78.6, z: -4.4, yaw: Math.PI },
  { id: 'pharmacy', x: -11.4, z: 30, yaw: Math.PI / 2 },
  { id: 'stairwell', x: -52, z: -48.6, yaw: Math.PI },
];

/** Floor, four walls (a gap for the door on the south wall), ceiling. South is +z. */
function room(ctx: WorldContext, ox: number, oz: number, w: number, d: number, h: number, wall: number, floor: number, ceiling = 0x1c1a18) {
  const { mats } = ctx;
  ctx.solid(mats.vertex, ox, 0, oz, w + 0.6, 0.15, d + 0.6, { color: floor, cam: false });
  ctx.solid(mats.vertex, ox, h, oz, w + 0.6, 0.3, d + 0.6, { color: ceiling });
  const t = 0.3;
  ctx.solid(mats.vertex, ox, 0, oz - d / 2 - t / 2, w + 0.6, h, t, { color: wall }); // north
  ctx.solid(mats.vertex, ox - w / 2 - t / 2, 0, oz, t, h, d, { color: wall }); // west
  ctx.solid(mats.vertex, ox + w / 2 + t / 2, 0, oz, t, h, d, { color: wall }); // east
  // south wall with a door in the middle
  const side = (w - 1.4) / 2;
  ctx.solid(mats.vertex, ox - w / 2 + side / 2, 0, oz + d / 2 + t / 2, side, h, t, { color: wall });
  ctx.solid(mats.vertex, ox + w / 2 - side / 2, 0, oz + d / 2 + t / 2, side, h, t, { color: wall });
  ctx.solid(mats.vertex, ox, 2.4, oz + d / 2 + t / 2, 1.4, h - 2.4, t, { color: wall });
  // the door itself, shut behind you (dark, with a lit gap under it)
  ctx.solid(mats.wood, ox, 0.15, oz + d / 2 + t / 2 + 0.02, 1.4, 2.25, 0.08);
  ctx.decal(itex.doorSign('Exit'), ox, 2.55, oz + d / 2 - 0.01, 0.8, 0.3, Math.PI, { emissive: 0.8 });
}

function def(d: InteriorDef) {
  INTERIORS.push(d);
  return d;
}

export function buildInteriors(ctx: WorldContext) {
  const { mats, batch } = ctx;

  // ── street side: a real door in each façade, and the spot to use it ──
  for (const d of DOORS) {
    ctx.point(`enter:${d.id}`, new THREE.Vector3(d.x, 0.15, d.z), 2.2);
  }
  // the stairwell's door on Linden Street (NQ1 south face)
  batch.add(mats.wood, G.box, M(-52, 0.15, -49.96, 1.3, 2.3, 0.08));
  ctx.decal(itex.doorSign('No. 7'), -52, 2.62, -49.9, 0.6, 0.22, 0, { emissive: 0.6 });

  /* ── Hotel Meridian: the lobby ──────────────────────────── */
  {
    const ox = 1000, oz = 1000, w = 14, d = 10, h = 4.4;
    room(ctx, ox, oz, w, d, h, 0x3a2a20, 0x8c8272, 0x2a2018);
    // wainscot and a runner to the desk
    batch.add(mats.wood, G.box, M(ox, 0.15, oz - d / 2 + 0.05, w, 1.1, 0.06));
    batch.add(mats.vertex, G.box, M(ox, 0.151, oz + 1, 2.2, 0.01, 7.5), { color: 0x5a1a18, cast: false });
    // the desk, the bell, the board of keys
    ctx.solid(mats.wood, ox, 0.15, oz - 2.8, 4.6, 1.05, 0.9);
    batch.add(mats.darkStone, G.box, M(ox, 1.2, oz - 2.8, 4.8, 0.06, 1.0));
    batch.add(mats.metal, G.cyl, M(ox + 1.2, 1.26, oz - 2.5, 0.08, 0.05, 0.08));
    batch.add(mats.metal, G.sphere, M(ox + 1.2, 1.32, oz - 2.5, 0.06, 0.04, 0.06));
    batch.add(mats.paint, G.box, M(ox - 1.3, 1.26, oz - 2.55, 0.5, 0.05, 0.35), { color: 0x5a1f1a }); // guest book
    ctx.decal(itex.reception(), ox, 2.9, oz - d / 2 + 0.02, 2.4, 0.6, 0, { emissive: 1.2 });
    ctx.decal(itex.keyBoard(), ox + 3.6, 1.9, oz - d / 2 + 0.02, 1.6, 1.0, 0);
    // two armchairs, a low table, a plant
    for (const s of [-1, 1]) {
      const cx = ox - 4.6, cz = oz + 1.6 + s * 1.3;
      ctx.solid(mats.vertex, cx, 0.15, cz, 0.9, 0.45, 0.9, { color: 0x4a2a24, cam: false });
      batch.add(mats.vertex, G.box, M(cx - 0.38, 0.6, cz, 0.14, 0.6, 0.9), { color: 0x4a2a24 });
    }
    ctx.solid(mats.wood, ox - 3.6, 0.15, oz + 1.6, 0.6, 0.4, 1.2, { cam: false });
    ctx.solid(mats.darkStone, ox + 5.8, 0.15, oz - 3.8, 0.6, 0.6, 0.6, { cam: false });
    batch.add(mats.vertex, G.sphere, M(ox + 5.8, 1.2, oz - 3.8, 0.55, 0.6, 0.55), { color: 0x243222 });
    // the lift, and its dial
    ctx.solid(mats.metal, ox + w / 2 - 0.05, 0.15, oz + 0.5, 0.1, 2.4, 1.6);
    batch.add(mats.iron, G.box, M(ox + w / 2 - 0.11, 0.15, oz + 0.5, 0.02, 2.4, 0.02));
    ctx.decal(itex.floorDial('13'), ox + w / 2 - 0.12, 2.9, oz + 0.5, 0.45, 0.45, -Math.PI / 2, { emissive: 1.4 });
    for (const [x, z] of [[ox - 3.5, oz - 1], [ox + 3.5, oz - 1], [ox, oz + 2.5]]) ctx.lamp(new THREE.Vector3(x, h - 1.0, z), 'interior', { intensity: 12, range: 11, cone: false, halo: 0, ground: 0.15, streak: 0 });
    batch.add(mats.lampWarm, G.sphere, M(ox, h - 0.5, oz + 2.5, 0.25, 0.18, 0.25), { cast: false });
    // the clerk, who has been looking at you since before you came in
    ctx.npcSpots.push({ pos: new THREE.Vector3(ox + 0.2, 0.15, oz - 3.7), yaw: 0, mode: 'stare' });
    ctx.sound('murmur', new THREE.Vector3(ox, 2, oz));
    ctx.point('hotel-bell', new THREE.Vector3(ox + 1.2, 0.15, oz - 1.9), 1.6);
    ctx.point('hotel-book', new THREE.Vector3(ox - 1.3, 0.15, oz - 1.9), 1.6);
    ctx.point('hotel-lift', new THREE.Vector3(ox + w / 2 - 1.2, 0.15, oz + 0.5), 1.8);
    ctx.point('exit:hotel', new THREE.Vector3(ox, 0.15, oz + d / 2 - 0.9), 1.6);
    def({
      id: 'hotel', name: 'Hotel Meridian', code: 'Lobby', door: { x: 10.6, z: -8, yaw: Math.PI / 2 },
      spawn: { x: ox, y: 0.15, z: oz + d / 2 - 2.4, yaw: Math.PI }, bounds: [ox - w / 2, oz - d / 2, ox + w / 2, oz + d / 2 + 0.4],
      unlock: 'night-clerk', first: ['The clerk is looking at you. You realise they have been, for some time.'],
    });
  }

  /* ── the launderette ────────────────────────────────────── */
  {
    const ox = 1080, oz = 1000, w = 8, d = 12, h = 3.2;
    room(ctx, ox, oz, w, d, h, 0x8e928b, 0x5f645f, 0x6a6d67);
    const washer = itex.washerDoor(), seven = itex.washerRed();
    for (let i = 0; i < 6; i++) {
      const z = oz - d / 2 + 1.2 + i * 1.5;
      ctx.solid(mats.vertex, ox - w / 2 + 0.45, 0.15, z, 0.8, 1.0, 0.8, { color: 0xd4d6d0, cam: false });
      ctx.decal(i === 3 ? seven : washer, ox - w / 2 + 0.86, 0.65, z, 0.72, 0.72, Math.PI / 2, { emissive: i === 3 ? 0.35 : 0.05 });
    }
    for (let i = 0; i < 5; i++) {
      const z = oz - d / 2 + 1.5 + i * 1.7;
      for (const y of [0.15, 1.15]) {
        ctx.solid(mats.vertex, ox + w / 2 - 0.45, y, z, 0.8, 0.95, 0.9, { color: 0xc8cac4, cam: false });
        ctx.decal(washer, ox + w / 2 - 0.86, y + 0.48, z, 0.62, 0.62, -Math.PI / 2, { emissive: 0.05 });
      }
    }
    ctx.solid(mats.wood, ox, 0.15, oz + 1, 0.5, 0.45, 3.2, { cam: false });
    ctx.solid(mats.vertex, ox, 0.15, oz - 3.5, 1.4, 0.9, 0.8, { color: 0xe0ddd2, cam: false });
    ctx.decal(itex.notice(['NO DYEING', 'Machines close', 'at 03:17', '', 'Found: one', 'red coat.', 'Ask inside.']), ox, 1.9, oz - d / 2 + 0.02, 0.8, 1.0, 0);
    for (const z of [oz - 3, oz + 2]) {
      const l = ctx.lamp(new THREE.Vector3(ox, h - 0.8, z), 'cold', { intensity: 7, range: 9, cone: false, halo: 0, ground: 0.15, streak: 0 });
      l.flicker = z > oz ? 4 : 0;
      batch.add(mats.lampCold, G.box, M(ox, h - 0.1, z, 0.25, 0.05, 1.6), { cast: false });
    }
    ctx.sound('machine', new THREE.Vector3(ox - w / 2 + 0.5, 0.7, oz - d / 2 + 1.2 + 3 * 1.5));
    ctx.sound('hum', new THREE.Vector3(ox, h - 0.3, oz));
    ctx.npcSpots.push({ pos: new THREE.Vector3(ox + 0.1, 0.15, oz + 2.0), yaw: -Math.PI / 2, mode: 'sit' });
    ctx.point('laundry-seven', new THREE.Vector3(ox - w / 2 + 1.6, 0.15, oz - d / 2 + 1.2 + 3 * 1.5), 1.6);
    ctx.point('laundry-notice', new THREE.Vector3(ox, 0.15, oz - d / 2 + 1.3), 1.6);
    ctx.point('exit:launderette', new THREE.Vector3(ox, 0.15, oz + d / 2 - 0.9), 1.6);
    def({
      id: 'launderette', name: 'Launderette', code: 'Kestrel Market', door: { x: -90.5, z: -3.6, yaw: 0 },
      spawn: { x: ox, y: 0.15, z: oz + d / 2 - 2.4, yaw: Math.PI }, bounds: [ox - w / 2, oz - d / 2, ox + w / 2, oz + d / 2 + 0.4],
    });
  }

  /* ── Kowalczyk & Sons, the deli ─────────────────────────── */
  {
    const ox = 1160, oz = 1000, w = 7, d = 9, h = 3.2;
    room(ctx, ox, oz, w, d, h, 0x5a5242, 0x3a3630, 0x2a2622);
    // checker floor
    for (let i = 0; i < 7; i++) for (let k = 0; k < 9; k++) if ((i + k) % 2) batch.add(mats.vertex, G.box, M(ox - 3 + i, 0.151, oz - 4 + k, 1, 0.005, 1), { color: 0xb3ab9c, cast: false });
    ctx.solid(mats.vertex, ox, 0.15, oz - 1.6, 5.2, 1.0, 0.8, { color: 0x6a5a44 });
    batch.add(mats.glass, G.box, M(ox, 1.15, oz - 1.4, 5.0, 0.45, 0.5), { cast: false });
    for (let i = 0; i < 9; i++) batch.add(mats.vertex, G.box, M(ox - 2 + i * 0.5, 1.2, oz - 1.4, 0.3, 0.12, 0.3), { color: [0x9a4a3a, 0xc9a86a, 0x7a3a2a][i % 3] });
    for (const y of [1.3, 1.9, 2.5]) {
      batch.add(mats.wood, G.box, M(ox, y, oz - d / 2 + 0.25, w - 0.4, 0.05, 0.45));
      ctx.decal(itex.shelfGoods(Math.round(y * 10)), ox, y + 0.28, oz - d / 2 + 0.02, w - 0.6, 0.5, 0);
    }
    for (let i = 0; i < 6; i++) batch.add(mats.vertex, G.cyl, M(ox - 2.2 + i * 0.35, 2.3, oz - 1.9, 0.04, 0.55, 0.04), { color: 0x6a2a1e });
    ctx.decal(itex.priceBoard(), ox + 2.2, 2.3, oz - d / 2 + 0.02, 1.6, 0.8, 0);
    ctx.decal(itex.clock317(), ox - 2.4, 2.4, oz - d / 2 + 0.02, 0.5, 0.5, 0);
    const l = ctx.lamp(new THREE.Vector3(ox, h - 0.8, oz - 1), 'interior', { intensity: 9, range: 9, cone: false, halo: 0, ground: 0.15, streak: 0 });
    l.flicker = 3;
    ctx.sound('radio', new THREE.Vector3(ox + 2.5, 1.4, oz - 1.6));
    ctx.point('deli-clock', new THREE.Vector3(ox - 2.4, 0.15, oz - 0.6), 1.6);
    ctx.point('deli-ledger', new THREE.Vector3(ox + 0.8, 0.15, oz - 0.7), 1.6);
    ctx.point('exit:deli', new THREE.Vector3(ox, 0.15, oz + d / 2 - 0.9), 1.6);
    def({
      id: 'deli', name: 'Kowalczyk & Sons', code: 'Delicatessen', door: { x: -78.6, z: -3.6, yaw: 0 },
      spawn: { x: ox, y: 0.15, z: oz + d / 2 - 2.4, yaw: Math.PI }, bounds: [ox - w / 2, oz - d / 2, ox + w / 2, oz + d / 2 + 0.4],
      first: ['The bread is warm.'],
    });
  }

  /* ── the pharmacy ───────────────────────────────────────── */
  {
    const ox = 1240, oz = 1000, w = 9, d = 12, h = 3.4;
    room(ctx, ox, oz, w, d, h, 0xa9ada9, 0x8d918d, 0x9a9d99);
    for (const x of [-2.2, 0, 2.2]) {
      ctx.solid(mats.vertex, ox + x, 0.15, oz + 1, 0.9, 1.7, 5.5, { color: 0x9ea19d });
      for (const s of [-1, 1]) for (const y of [0.55, 1.05, 1.55]) ctx.decal(itex.shelfGoods(Math.round((x + 5) * 10 + y * 7 + s)), ox + x + s * 0.46, y, oz + 1, 5.3, 0.42, s > 0 ? Math.PI / 2 : -Math.PI / 2);
    }
    ctx.solid(mats.vertex, ox, 0.15, oz - 4.2, 5.5, 1.05, 0.8, { color: 0xb4b6b2 });
    batch.add(mats.paint, G.box, M(ox + 1.5, 1.2, oz - 4.2, 0.3, 0.35, 0.18), { color: 0xc9b58a }); // a paper bag
    ctx.decal(itex.pharmacyCross(), ox, 2.5, oz - d / 2 + 0.02, 0.7, 0.7, 0, { emissive: 2.4 });
    // tubes over the aisles, not the shelves
    for (const [x, z] of [[ox, oz - 3], [ox - 1.1, oz + 1], [ox + 1.1, oz + 2.5]]) {
      ctx.lamp(new THREE.Vector3(x, h - 0.6, z), 'cold', { intensity: 7, range: 9, cone: false, halo: 0, ground: 0.15, streak: 0 });
      batch.add(mats.lampCold, G.box, M(x, h - 0.1, z, 0.25, 0.05, 1.8), { cast: false });
    }
    ctx.npcSpots.push({ pos: new THREE.Vector3(ox - 0.8, 0.15, oz - 5.0), yaw: 0, mode: 'look' });
    ctx.sound('hum', new THREE.Vector3(ox, h - 0.3, oz));
    ctx.point('pharmacy-bag', new THREE.Vector3(ox + 1.5, 0.15, oz - 3.3), 1.6);
    ctx.point('exit:pharmacy', new THREE.Vector3(ox, 0.15, oz + d / 2 - 0.9), 1.6);
    def({
      id: 'pharmacy', name: 'Pharmacy', code: 'Central Avenue', door: { x: -10.6, z: 30, yaw: -Math.PI / 2 },
      spawn: { x: ox, y: 0.15, z: oz + d / 2 - 2.4, yaw: Math.PI }, bounds: [ox - w / 2, oz - d / 2, ox + w / 2, oz + d / 2 + 0.4],
    });
  }

  /* ── No. 7, the stairwell (it never reaches the top) ───── */
  {
    const ox = 1320, oz = 1000, w = 6, d = 6, h = 14;
    room(ctx, ox, oz, w, d, h, 0x6a6052, 0x4a4238, 0x2a2622);
    ctx.decal(itex.mailboxes(), ox - w / 2 + 0.02, 1.4, oz + 1.2, 2.2, 1.1, Math.PI / 2);
    // two identical flights per storey (switchback): 16 steps of 0.18 m each flight
    const rise = 0.18, run = 0.28, steps = 16, storey = rise * steps * 2; // 5.76 m
    const x0 = ox - 2.2;
    for (let floor = 0; floor < 2; floor++) {
      const base = 0.15 + floor * storey;
      for (let i = 0; i < steps; i++) {
        // up along +x on the north side …
        ctx.solid(mats.concrete, x0 + i * run, base + i * rise, oz - 1.6, run, rise, 1.4, { cam: false });
        // … and back along -x on the south side
        ctx.solid(mats.concrete, x0 + (steps - 1 - i) * run, base + steps * rise + i * rise, oz + 0.2, run, rise, 1.4, { cam: false });
      }
      // half landing (east) and the storey landing (west)
      ctx.solid(mats.concrete, x0 + steps * run + 0.6, base + steps * rise - 0.1, oz - 0.7, 1.2, 0.1 + 0.001, 3.2, { cam: false });
      ctx.solid(mats.concrete, x0 - 0.8, base + storey - 0.1, oz - 0.7, 1.6, 0.1, 3.2, { cam: false });
    }
    // the storey landings look the same; the number on the wall does not
    const signs: THREE.Mesh[] = [];
    for (let floor = 1; floor <= 2; floor++) {
      const y = 0.15 + floor * storey;
      batch.add(mats.wood, G.box, M(ox - w / 2 + 0.05, y, oz - 0.7, 0.08, 2.2, 1.0)); // a flat door
      signs.push(ctx.decal(itex.floorNumber(String(floor + 1)), ox - w / 2 + 0.06, y + 2.6, oz + 0.4, 0.35, 0.35, Math.PI / 2));
    }
    for (let floor = 0; floor <= 2; floor++) {
      const l = ctx.lamp(new THREE.Vector3(ox, 0.15 + floor * storey + 3.2, oz), 'interior', { intensity: 12, range: 8, cone: false, halo: 0.6, ground: 0.15, streak: 0 });
      l.flicker = floor === 2 ? 3 : 0;
    }
    ctx.point('stair-mail', new THREE.Vector3(ox - w / 2 + 1, 0.15, oz + 1.2), 1.6);
    ctx.point('exit:stairwell', new THREE.Vector3(ox, 0.15, oz + d / 2 - 0.9), 1.6);
    const topY = 0.15 + 2 * storey;
    def({
      id: 'stairwell', name: 'No. 7', code: 'Linden Street', door: { x: -52, z: -48.4, yaw: 0 },
      spawn: { x: ox, y: 0.15, z: oz + d / 2 - 1.3, yaw: Math.PI }, bounds: [ox - w / 2, oz - d / 2, ox + w / 2, oz + d / 2 + 0.4],
      first: ['It smells of other people’s dinners.'],
    });
    STAIRWELL.landingX = x0 - 0.8;
    STAIRWELL.topY = topY;
    STAIRWELL.storey = storey;
    STAIRWELL.z = oz - 0.7;
    STAIRWELL.signs = signs;
  }

  /* ── the Station House holding cell (where the police bring you) ── */
  {
    const ox = 1400, oz = 1000, w = 5, d = 6, h = 3.2;
    room(ctx, ox, oz, w, d, h, 0x5d625e, 0x3c403e, 0x2a2d2c);
    // bars across the front of the cell, a gate in the middle
    for (let x = -w / 2 + 0.15; x <= w / 2 - 0.1; x += 0.22) ctx.solid(mats.iron, ox + x, 0.15, oz + d / 2 - 1.6, 0.05, h - 0.2, 0.05, { cam: false });
    for (const y of [1.0, h - 0.3]) batch.add(mats.iron, G.box, M(ox, 0.15 + y, oz + d / 2 - 1.6, w, 0.06, 0.08));
    // the gate itself doesn't block (you only leave through it when it's open)
    ctx.collision.add(ox - w / 2, 0, oz + d / 2 - 1.65, ox - 0.45, h, oz + d / 2 - 1.55);
    ctx.collision.add(ox + 0.45, 0, oz + d / 2 - 1.65, ox + w / 2, h, oz + d / 2 - 1.55);
    // a bench, a steel toilet, scratched tallies on the wall
    ctx.solid(mats.concrete, ox - w / 2 + 0.35, 0.15, oz - 0.6, 0.7, 0.45, 2.6, { cam: false });
    ctx.solid(mats.metal, ox + w / 2 - 0.4, 0.15, oz - d / 2 + 0.5, 0.45, 0.42, 0.55, { cam: false });
    ctx.decal(itex.notice(['||||  ||||  ||||', '||||  ||||  ||', '', 'IT WAS 3:17', 'WHEN THEY', 'BROUGHT ME IN', '', 'IT STILL IS']), ox - w / 2 + 0.02, 1.6, oz - 1.2, 0.8, 1.0, Math.PI / 2);
    const l = ctx.lamp(new THREE.Vector3(ox, h - 0.7, oz - 0.5), 'cold', { intensity: 6, range: 8, cone: false, halo: 0, ground: 0.15, streak: 0 });
    l.flicker = 2;
    batch.add(mats.lampCold, G.box, M(ox, h - 0.1, oz - 0.5, 0.25, 0.05, 1.2), { cast: false });
    ctx.sound('hum', new THREE.Vector3(ox, h - 0.3, oz));
    ctx.point('jail-wall', new THREE.Vector3(ox - w / 2 + 0.9, 0.15, oz - 1.2), 1.4);
    ctx.point('exit:jail', new THREE.Vector3(ox, 0.15, oz + d / 2 - 2.1), 1.3);
    def({
      id: 'jail', name: 'Holding Cell', code: 'Station House', door: { x: 5.6, z: -118, yaw: 0 },
      spawn: { x: ox, y: 0.15, z: oz - 1.2, yaw: 0 }, bounds: [ox - w / 2, oz - d / 2, ox + w / 2, oz + d / 2 + 0.4],
    });
  }
}

/** The stairwell's loop: reaching the top landing puts you back one storey down, one number higher. */
export const STAIRWELL = { landingX: 0, topY: 0, storey: 0, z: 0, signs: [] as THREE.Mesh[] };

export function interiorAt(x: number, z: number): InteriorDef | null {
  for (const d of INTERIORS) {
    const [x0, z0, x1, z1] = d.bounds;
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return d;
  }
  return null;
}

export const interiorById = (id: string) => INTERIORS.find((d) => d.id === id) ?? null;
