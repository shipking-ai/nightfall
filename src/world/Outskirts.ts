import * as THREE from 'three';
import { WorldContext } from './WorldContext';
import type { Materials } from './materials';
import type { Collision, Box } from './Collision';
import { facadeBox } from './builders/buildings';
import { M, G } from './builders/props';
import { mulberry32 } from './rng';
import { PAD_H } from './layout';

/**
 * Past the district's east and west edges the streets keep going: Linden
 * Street, Harbor Lane and River Road run on forever between blocks nobody
 * has mapped. Built in 80 m slices around wherever you are and forgotten
 * behind you; each slice is the same every time (seeded by its index).
 *
 * The outskirts are quiet on purpose: no traffic, no people, and lamps
 * that glow without lighting the street (the light count never changes).
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
}

export class Outskirts {
  group = new THREE.Group();
  private slices = new Map<number, Slice>();
  /** the city's ground and river planes, moved along under you so they never run out */
  private followers: THREE.Object3D[];
  /** RPG: the outskirts only run so far before the wider world takes over (slices each side) */
  limit = Infinity;
  /** RPG: the ground planes stay put (the terrain carries on past them) */
  follow = true;

  constructor(private mats: Materials, private collision: Collision, root: THREE.Object3D) {
    this.followers = ['ground-north', 'ground-south', 'water'].map((n) => root.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
  }

  /** Is (x,z) out in the endless part? */
  static contains(x: number, z: number) {
    return Math.abs(x) > EDGE && z > Z0 && z < Z1;
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
    for (const [za, zb] of BANDS) {
      // pavement pad, kerbed
      slab(mats.paving, bx0, za - 4, bx1, zb + 4, -0.2, PAD_H);
      this.collision.add(bx0, -0.2, za - 4, bx1, PAD_H, zb + 4, false);
      // buildings along both street faces; a yard behind
      for (const face of [za, zb] as const) {
        let x = bx0 + rng.range(0, 3);
        while (x < bx1 - 6) {
          const w = Math.min(bx1 - x, rng.range(9, 22));
          const depth = rng.range(12, 22);
          const h = rng.range(9, rng.chance(0.15) ? 60 : 34);
          const style = rng.pick(['stone', 'brick', 'brick', 'concrete', 'glass'] as const);
          const zA = face === za ? za : zb - depth, zB = face === za ? za + depth : zb;
          facadeBox(ctx, x, 0.15, zA, x + w, h, zB, { style, seed: rng.range(0, 100), lit: rng.chance(0.2) ? -1 : rng.range(0.12, 0.35) });
          x += w + (rng.chance(0.25) ? rng.range(3, 7) : 0);
        }
      }
      // lamps along the kerb that glow but don't light (no light budget out here)
      for (let x = bx0 + 6; x < bx1 - 3; x += 22) {
        for (const z of [za - 3.4, zb + 3.4]) {
          ctx.batch.add(mats.metal, G.cyl, M(x, PAD_H, z, 0.08, 6.2, 0.08));
          ctx.batch.add(rng.chance(0.12) ? mats.metal : mats.lampWarm, G.box, M(x, 6.2, z, 0.5, 0.18, 0.3), { cast: false });
          this.collision.addCentered(x, PAD_H, z, 0.25, 6, 0.25, false);
        }
      }
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
    group.updateMatrixWorld(true);
    this.group.add(group);
    this.slices.set(i, { i, group, boxes: this.collision.boxes.slice(before) });
  }

  private drop(s: Slice) {
    this.slices.delete(s.i);
    this.group.remove(s.group);
    s.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
    });
    this.collision.remove(s.boxes);
  }
}
