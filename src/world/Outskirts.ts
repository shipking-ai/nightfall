import * as THREE from 'three';
import { WorldContext } from './WorldContext';
import type { Materials } from './materials';
import type { Collision, Box } from './Collision';
import { facadeBox } from './builders/buildings';
import { M, G } from './builders/props';
import { mulberry32 } from './rng';
import { PAD_H } from './layout';
import type { InteractSpot, NpcSpot } from './WorldContext';
import { INTERACTIONS } from '../data/interactions';
import { buildLot, LOT_WIDTH, shopfront, billboard, shelter, hydrant, stashBag, type LotKind, type LotOut } from './builders/outskirtsLots';
import { tree, bin } from './builders/props';

/**
 * Past the district's east and west edges the streets keep going: Linden
 * Street, Harbor Lane and River Road run on forever between blocks nobody
 * has mapped. Built in 80 m slices around wherever you are and forgotten
 * behind you; each slice is the same every time (seeded by its index).
 *
 * Not empty any more: on the faces that front a road there are places
 * (builders/outskirtsLots.ts: a gas station, a diner, a motel, a park, a car
 * park, a building site, a night market), shops with their windows lit,
 * billboards, bus shelters, trees, and a stash or two to find. The people
 * standing about are lent from the crowd (Crowd.lend) and the traffic runs
 * out here too (Traffic.local). The lamps still glow without lighting the
 * street, so the light count never changes.
 */
const W = 80;
/** slices kept on each side of you */
const KEEP = 3;
/** the city ends at |x| = 150; slices start there */
const EDGE = 150;
/** the band the streets run in: from the north wall to the river */
const Z0 = -124, Z1 = 163.3;
/** blocks between the cross streets (Linden −40, Harbor 54, River Road 141) */
const BANDS: [number, number][] = [[-118, -48], [-32, 46], [62, 134]];

interface Slice {
  i: number;
  group: THREE.Group;
  boxes: Box[];
  /** things to press, added to the world's list while the slice stands */
  spots: InteractSpot[];
  people: (NpcSpot & { key: string })[];
}

/** which faces of which blocks front a road: [band, face (0 = north edge, 1 = south edge)] */
const ROAD_FACES: [number, 0 | 1][] = [[0, 1], [1, 0], [1, 1], [2, 0], [2, 1]];
const KINDS: LotKind[] = ['gas', 'diner', 'motel', 'park', 'carpark', 'site', 'market'];

export class Outskirts {
  group = new THREE.Group();
  private slices = new Map<number, Slice>();
  /** the city's ground and river planes, moved along under you so they never run out */
  private followers: THREE.Object3D[];
  /** RPG: the outskirts only run so far before the wider world takes over (slices each side) */
  limit = Infinity;
  /** RPG: the ground planes stay put (the terrain carries on past them) */
  follow = true;

  constructor(private mats: Materials, private collision: Collision, root: THREE.Object3D, private interact: InteractSpot[] = []) {
    this.followers = ['ground-north', 'ground-south', 'water'].map((n) => root.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
  }

  /** Is (x,z) out in the endless part? */
  static contains(x: number, z: number) {
    return Math.abs(x) > EDGE && z > Z0 && z < Z1;
  }

  /** The places people stand out here, nearest first (for Crowd.lend). */
  people(pos: THREE.Vector3, max: number, within = 110): (NpcSpot & { key: string })[] {
    const all: { p: NpcSpot & { key: string }; d: number }[] = [];
    for (const s of this.slices.values())
      for (const p of s.people) {
        const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
        if (d < within) all.push({ p, d });
      }
    return all.sort((a, b) => a.d - b.d).slice(0, max).map((a) => a.p);
  }

  update(pos: THREE.Vector3) {
    const snap = Math.round(pos.x / 60) * 60;
    for (const f of this.followers) f.position.x = this.follow && Math.abs(snap) > 300 ? snap : 0;
    if (Math.abs(pos.z) > 900) return; // inside a building (they're built far off the map)
    const want = new Set<number>();
    const side = Math.sign(pos.x) || 1;
    const k = Math.floor((Math.abs(pos.x) - EDGE) / W);
    for (let d = -KEEP; d <= KEEP; d++) {
      const j = k + d;
      if (j >= 0 && j < this.limit) want.add(side * (j + 1));
    }
    // both edges are close to the middle of the district: keep a slice each side ready
    if (Math.abs(pos.x) < EDGE + W) {
      want.add(1);
      want.add(-1);
    }
    for (const i of want) if (!this.slices.has(i)) this.build(i);
    for (const [i, s] of this.slices) if (!want.has(i)) this.drop(s);
  }

  private build(i: number) {
    const side = Math.sign(i);
    const n = Math.abs(i) - 1;
    const xa = side * (EDGE + n * W), xb = side * (EDGE + (n + 1) * W);
    const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb);
    const rng = mulberry32(0x5eed + i * 7919);
    const ctx = new WorldContext(this.mats);
    ctx.batch.declare(this.mats.facade, [
      ['aBld', 4],
      ['aTop', 2],
    ]);
    const before = this.collision.boxes.length;
    ctx.collision = this.collision;
    const mats = this.mats;
    const slab = (mat: THREE.Material, ax: number, az: number, bx: number, bz: number, y0: number, y1: number) =>
      ctx.batch.add(mat, G.box, M((ax + bx) / 2, y0, (az + bz) / 2, bx - ax, y1 - y0, bz - az), { cast: false });

    // a cross street at the slice's inner edge (12 m), then blocks
    const road = 12;
    const bx0 = side > 0 ? x0 + road : x0, bx1 = side > 0 ? x1 : x1 - road;
    const out: LotOut = { spots: [], defs: {}, people: [] };
    // the places on this slice: a few of the road-facing block faces get one
    const lots = new Map<string, { kind: LotKind; a: number; b: number }>();
    const used = new Set<LotKind>();
    for (const [band, face] of ROAD_FACES) {
      if (!rng.chance(0.42)) continue;
      let kind = rng.pick(KINDS);
      for (let k = 0; k < 4 && used.has(kind); k++) kind = rng.pick(KINDS);
      if (used.has(kind)) continue;
      used.add(kind);
      const w = LOT_WIDTH[kind];
      const a = bx0 + rng.range(2, bx1 - bx0 - w - 2);
      lots.set(`${band}:${face}`, { kind, a, b: a + w });
    }
    let boards = 0;
    const gaps: { x: number; z: number; s: 1 | -1 }[] = [];
    BANDS.forEach(([za, zb], band) => {
      // pavement pad, kerbed
      slab(mats.paving, bx0, za - 4, bx1, zb + 4, -0.2, PAD_H);
      this.collision.add(bx0, -0.2, za - 4, bx1, PAD_H, zb + 4, false);
      // buildings along both street faces; a yard behind
      for (const face of [0, 1] as const) {
        const F = face === 0 ? za : zb;
        const s: 1 | -1 = face === 0 ? 1 : -1;
        const onRoad = ROAD_FACES.some(([b, f]) => b === band && f === face);
        const lot = lots.get(`${band}:${face}`);
        if (lot) buildLot(lot.kind, { ctx, rng, id: `osk${i}:${band}${face}`, x0: lot.a, F, s, out });
        let x = bx0 + rng.range(0, 3);
        while (x < bx1 - 6) {
          // leave the place's plot alone
          if (lot && x < lot.b && x + 9 > lot.a) {
            x = lot.b + 1;
            continue;
          }
          const w = Math.min(bx1 - x, lot && x < lot.a ? lot.a - x - 1 : Infinity, rng.range(9, 22));
          if (w < 6) {
            x += w + 1;
            continue;
          }
          const depth = rng.range(12, 22);
          const h = rng.range(9, rng.chance(0.15) ? 60 : 34);
          const style = rng.pick(['stone', 'brick', 'brick', 'concrete', 'glass'] as const);
          const zA = face === 0 ? za : zb - depth, zB = face === 0 ? za + depth : zb;
          facadeBox(ctx, x, 0.15, zA, x + w, h, zB, { style, seed: rng.range(0, 100), lit: rng.chance(0.2) ? -1 : rng.range(0.12, 0.35) });
          if (onRoad && w >= 8 && rng.chance(0.5)) {
            shopfront(ctx, rng, x + 0.5, x + w - 0.5, F, s);
            if (rng.chance(0.25)) out.people.push({ pos: new THREE.Vector3(x + rng.range(2, w - 2), PAD_H, F - s * 1.2), yaw: s > 0 ? Math.PI : 0, mode: rng.pick(['smoke', 'phone', 'look'] as const) });
          }
          if (onRoad && h < 26 && boards < 2 && w >= 11 && rng.chance(0.2)) {
            boards++;
            billboard(ctx, rng, x + w / 2, h, F + s * 3, s);
          }
          x += w;
          if (rng.chance(0.25)) {
            const g = rng.range(3, 7);
            gaps.push({ x: x + g / 2, z: F + s * 3, s });
            x += g;
          }
        }
        if (!onRoad) continue;
        // the pavement: trees between the lamps, a hydrant, a bin by a lamp
        const clear = (px: number) => !lot || px < lot.a - 1 || px > lot.b + 1;
        for (let px = bx0 + 17; px < bx1 - 3; px += 22) if (clear(px) && rng.chance(0.7)) tree(ctx, px, F - s * 2.9, rng, PAD_H, rng.range(0.8, 1.1));
        for (let px = bx0 + 7.3; px < bx1 - 3; px += 22) if (clear(px) && rng.chance(0.3)) bin(ctx, px, F - s * 3.3, PAD_H);
        const hx = bx0 + rng.range(4, bx1 - bx0 - 4);
        if (clear(hx) && Math.abs(((hx - bx0 - 6) % 22) - 11) < 8) hydrant(ctx, hx, F - s * 3.5);
      }
      // lamps along the kerb that glow but don't light (no light budget out here)
      for (let x = bx0 + 6; x < bx1 - 3; x += 22) {
        for (const z of [za - 3.4, zb + 3.4]) {
          ctx.batch.add(mats.metal, G.cyl, M(x, PAD_H, z, 0.08, 6.2, 0.08));
          ctx.batch.add(rng.chance(0.12) ? mats.metal : mats.lampWarm, G.box, M(x, 6.2, z, 0.5, 0.18, 0.3), { cast: false });
          this.collision.addCentered(x, PAD_H, z, 0.25, 6, 0.25, false);
        }
      }
    });
    // one bus stop per slice, on a road face clear of the places
    {
      const [band, face] = rng.pick(ROAD_FACES);
      const F = face === 0 ? BANDS[band][0] : BANDS[band][1];
      const s: 1 | -1 = face === 0 ? 1 : -1;
      const lot = lots.get(`${band}:${face}`);
      let sx = bx0 + 6 + 22 * rng.int(0, 2) + 11;
      if (lot && sx > lot.a - 4 && sx < lot.b + 4) sx = lot.a - 6 > bx0 + 4 ? lot.a - 6 : lot.b + 6;
      if (sx < bx1 - 4) shelter(ctx, rng, sx, F - s * 1.9, s, out, `osk${i}:bus`);
    }
    // somewhere in an alley, a bag someone meant to come back for
    if (gaps.length && rng.chance(0.6)) {
      const g = rng.pick(gaps);
      stashBag(ctx, g.x, g.z, rng.range(0, 3));
      out.spots.push({ id: `osk${i}:bag`, pos: new THREE.Vector3(g.x, PAD_H, g.z), radius: 1.6 });
      out.defs[`osk${i}:bag`] = { name: 'Holdall', verb: 'Search', lines: [], action: 'stash', cash: [60, 260], keep: true };
    }
    // the promenade strip by the river, the rail, and the north wall
    slab(mats.paving, x0, 146, x1, 163.3, -0.2, PAD_H);
    this.collision.add(x0, -0.2, 146, x1, PAD_H, 163.3, false);
    slab(mats.iron, x0, 163.3, x1, 163.5, PAD_H, 1.1);
    this.collision.add(x0, 0, 163.3, x1, 3, 164.4, false);
    ctx.batch.add(mats.darkStone, G.box, M((x0 + x1) / 2, 0, -124.6, x1 - x0, 5, 1.2));
    this.collision.add(x0, 0, -125.2, x1, 6, -124, true);
    // the river walls and the far bank
    slab(mats.darkStone, x0, 162, x1, 164.4, -5, 0.15);
    slab(mats.darkStone, x0, 199.6, x1, 206, -5, 0.3);
    let x = x0;
    while (x < x1) {
      const w = Math.min(x1 - x, rng.range(10, 28));
      facadeBox(ctx, x, 0, 206, x + w, rng.range(8, 26), 206 + rng.range(12, 30), { style: rng.pick(['brick', 'concrete', 'stone'] as const), seed: rng.range(0, 100), lit: 0.22, collide: false, cast: false });
      x += w + (rng.chance(0.25) ? rng.range(6, 14) : 0.5);
    }
    // silhouettes behind the north wall
    x = x0;
    while (x < x1) {
      const w = Math.min(x1 - x, rng.range(12, 26));
      facadeBox(ctx, x, 0, -150 - rng.range(0, 30), x + w, rng.range(14, 50), -128, { style: rng.pick(['stone', 'brick', 'concrete'] as const), seed: rng.range(0, 100), lit: 0.18, collide: false, cast: false });
      x += w + 1;
    }

    const group = new THREE.Group();
    ctx.batch.build(group);
    // signs and billboards are their own meshes
    group.add(ctx.root);
    group.updateMatrixWorld(true);
    this.group.add(group);
    Object.assign(INTERACTIONS, out.defs);
    const spots: InteractSpot[] = out.spots.map((p) => ({ id: p.id, pos: p.pos, radius: p.radius, yaw: p.yaw }));
    this.interact.push(...spots);
    const people = out.people.map((p, k) => ({ ...p, key: `osk${i}:${k}` }));
    this.slices.set(i, { i, group, boxes: this.collision.boxes.slice(before), spots, people });
  }

  private drop(s: Slice) {
    this.slices.delete(s.i);
    this.group.remove(s.group);
    s.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      // a sign shares its plane and its texture; only its material is its own
      if (m.userData.shared) (m.material as THREE.Material).dispose();
      else m.geometry.dispose();
    });
    this.collision.remove(s.boxes);
    for (const sp of s.spots) {
      const k = this.interact.indexOf(sp);
      if (k >= 0) this.interact.splice(k, 1);
    }
  }
}
