import * as THREE from 'three';
import { BLOCKS, PADS, PAD_H, ROADS, YARD, expand, r, type Rect } from '../layout';
import type { WorldContext } from '../WorldContext';

const BOX = new THREE.BoxGeometry(1, 1, 1);

function slab(ctx: WorldContext, mat: THREE.Material, a: Rect, y0: number, y1: number, cast = false) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3((a.x0 + a.x1) / 2, (y0 + y1) / 2, (a.z0 + a.z1) / 2),
    new THREE.Quaternion(),
    new THREE.Vector3(a.x1 - a.x0, y1 - y0, a.z1 - a.z0),
  );
  ctx.batch.add(mat, BOX, m, { cast });
}

export function buildGround(ctx: WorldContext) {
  const { mats } = ctx;

  // asphalt: everything north of the river, and the far bank
  const north = new THREE.Mesh(new THREE.PlaneGeometry(900, 520).rotateX(-Math.PI / 2).translate(0, 0, -96), mats.asphalt);
  north.receiveShadow = true;
  north.name = 'ground-north';
  const south = new THREE.Mesh(new THREE.PlaneGeometry(900, 300).rotateX(-Math.PI / 2).translate(0, 0, 350), mats.asphalt);
  south.receiveShadow = true;
  south.name = 'ground-south';
  ctx.root.add(north, south);

  // yard concrete (flush with the road)
  const yard = new THREE.Mesh(
    new THREE.PlaneGeometry(YARD.x1 - YARD.x0, YARD.z1 - YARD.z0).rotateX(-Math.PI / 2).translate((YARD.x0 + YARD.x1) / 2, 0.012, (YARD.z0 + YARD.z1) / 2),
    mats.yard,
  );
  yard.receiveShadow = true;
  ctx.root.add(yard);

  // pavements: every block gets a 4 m kerbed pad; plus plazas
  const pads: Rect[] = BLOCKS.filter((b) => b.district !== 'yard').map((b) => expand(b.rect, 4));
  pads.push(...PADS);
  for (const b of BLOCKS.filter((b) => b.district === 'yard')) pads.push(expand(b.rect, 2));
  for (const p of pads) {
    slab(ctx, mats.paving, p, -0.2, PAD_H);
    ctx.collision.add(p.x0, -0.2, p.z0, p.x1, PAD_H, p.z1, false);
  }

  // road markings
  for (const road of ROADS) {
    const a = road.rect;
    if (road.axis === 'z') {
      for (let z = a.z0 + 2; z < a.z1 - 2; z += 9) if (!crossing(0, z)) slab(ctx, mats.marking, r(-0.08, z, 0.08, z + 4.5), 0.005, 0.012);
      for (const ex of [-8.6, 8.6]) slab(ctx, mats.marking, r(ex - 0.07, a.z0, ex + 0.07, a.z1), 0.005, 0.011);
    } else {
      const cz = (a.z0 + a.z1) / 2;
      for (let x = a.x0; x < a.x1; x += 9) if (!crossing(x, cz)) slab(ctx, mats.marking, r(x, cz - 0.08, x + 4.5, cz + 0.08), 0.005, 0.012);
    }
  }
  // zebra crossings at the avenue junctions
  for (const cz of [-46, -34, 48, 60, 136]) {
    const dir = cz === -46 || cz === 48 ? -1 : 1;
    for (let x = -8; x < 8; x += 1.2) slab(ctx, mats.marking, r(x, cz + dir * 0.6, x + 0.6, cz + dir * 3.6), 0.005, 0.012);
  }

  // river channel: water well below the quay, embankment walls
  const water = new THREE.Mesh(new THREE.PlaneGeometry(900, 36).rotateX(-Math.PI / 2).translate(0, -2.6, 182), mats.water);
  water.name = 'water';
  ctx.root.add(water);
  slab(ctx, mats.darkStone, r(-450, 162, 450, 164.4), -5, 0.15, false);
  slab(ctx, mats.darkStone, r(-450, 199.6, 450, 206), -5, 0.3, false);
}

function crossing(x: number, z: number) {
  const nearAvenue = Math.abs(x) < 11;
  const nearCross = [-40, 54, 141].some((c) => Math.abs(z - c) < 9);
  return nearAvenue && nearCross;
}

/** Invisible and visible limits of the walkable district. */
export function buildBounds(ctx: WorldContext) {
  const c = ctx.collision;
  const H = 30;
  // east / west: open. The streets run on forever (world/Outskirts.ts).
  void H;
  // north wall behind the quarter and the yard — a real, old wall
  for (const [x0, x1] of [[-150, -44], [44, 150]] as const) {
    slabWall(ctx, x0, x1);
    c.add(x0, 0, -125.2, x1, 6, -124, true);
  }
  // forecourt sides
  c.add(-45, 0, -152, -44, 6, -124);
  c.add(44, 0, -152, 45, 6, -124);
  // river rail and bridge
  c.add(-150, 0, 163.3, -10, 3, 164.4, false);
  c.add(10, 0, 163.3, 150, 3, 164.4, false);
  c.add(-10.6, 0, 164, -9.4, 3, 196, false);
  c.add(9.4, 0, 164, 10.6, 3, 196, false);
}

function slabWall(ctx: WorldContext, x0: number, x1: number) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3((x0 + x1) / 2, 2.5, -124.6), new THREE.Quaternion(), new THREE.Vector3(x1 - x0, 5, 1.2));
  ctx.batch.add(ctx.mats.facade, BOX, m, { attrs: { aBld: [7, 4, 3, -1], aTop: [5, 1] } });
  const cap = new THREE.Matrix4().compose(new THREE.Vector3((x0 + x1) / 2, 5.1, -124.6), new THREE.Quaternion(), new THREE.Vector3(x1 - x0, 0.25, 1.5));
  ctx.batch.add(ctx.mats.darkStone, BOX, cap);
}
