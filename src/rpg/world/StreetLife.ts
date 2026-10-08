import * as THREE from 'three';
import type { WorldContext } from '../../world/WorldContext';
import { G, M } from '../../world/builders/props';
import type { Rng } from '../../world/rng';
import type { Poi, TownBlock, TownOut, TownPlan } from './Towns';

/**
 * What a street has on it besides the buildings: bins, hydrants and
 * bollards at the kerb, benches, planters, bike racks, newspaper boxes, a
 * bus shelter now and then, a phone box; striped awnings over the shops and
 * tables out in front of the diners and bars; market stalls in the squares.
 *
 * Everything is placed along a block's pavement (the 3 m between the facade
 * and the kerb) facing the street, clear of the lamp posts and the corners.
 */

type Side = 0 | 1 | 2 | 3;

/** A point on a side of a block, `d` metres out from the facade, facing the street. */
function at(b: TownBlock, side: Side, u: number, d: number) {
  switch (side) {
    case 0: return { x: u, z: b.z0 - d, yaw: Math.PI };
    case 2: return { x: u, z: b.z1 + d, yaw: 0 };
    case 1: return { x: b.x1 + d, z: u, yaw: Math.PI / 2 };
    default: return { x: b.x0 - d, z: u, yaw: -Math.PI / 2 };
  }
}

/** Local → world: (lx sideways, lz towards the street) from a point facing the street. */
function local(p: { x: number; z: number; yaw: number }, lx: number, lz: number) {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  return { x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c };
}

const CONE = new THREE.ConeGeometry(1, 1, 12, 1, true).translate(0, 0.5, 0);

const STRIPES: [number, number][] = [[0x7a1f1a, 0xd8cfbf], [0x1f3a5a, 0xd8cfbf], [0x2c4a2a, 0xd8cfbf], [0x8a6a1a, 0x2a2622], [0x5a2a4a, 0xd8cfbf]];

export function furnish(ctx: WorldContext, plan: TownPlan, b: TownBlock, r: Rng, out: TownOut, lampEvery: number) {
  const s = plan.s;
  if (s.kind === 'ruin' || s.kind === 'military') return;
  const Y = b.y + 0.15;
  const big = s.kind === 'city' || s.kind === 'town';
  const pois = plan.pois.filter((p) => p.x > b.x0 - 3 && p.x < b.x1 + 3 && p.z > b.z0 - 3 && p.z < b.z1 + 3);

  // ── shopfronts: an awning over each door, tables out in front of the places people sit
  for (const p of pois) awning(ctx, p, Y, r, pois.indexOf(p));
  for (const p of pois) if (p.kind === 'diner' || p.kind === 'bar' || p.kind === 'club' || p.kind === 'hotel') cafe(ctx, p, Y, r, out);

  // ── the kerb: a walk along each side, a thing every so often
  const lampU = (lo: number) => (u: number) => {
    const k = (u - (lo + lampEvery / 2)) / lampEvery;
    return Math.abs(k - Math.round(k)) * lampEvery < 1.4;
  };
  const nearDoor = (x: number, z: number) => pois.some((p) => Math.hypot(p.x - x, p.z - z) < 4.5);
  let shelter = big && r.chance(0.35);
  let phone = big && r.chance(0.25);
  for (const side of [0, 1, 2, 3] as Side[]) {
    const lo = side === 0 || side === 2 ? b.x0 : b.z0, hi = side === 0 || side === 2 ? b.x1 : b.z1;
    const nearLamp = lampU(lo);
    for (let u = lo + 4; u < hi - 4; u += r.range(5, 11)) {
      if (nearLamp(u)) continue;
      const kerb = at(b, side, u, 2.1), wall = at(b, side, u, 0.5);
      if (nearDoor(kerb.x, kerb.z)) continue;
      const pick = r.next();
      if (shelter && hi - u > 8 && pick < 0.25) {
        busShelter(ctx, at(b, side, u + 2, 1.7), Y, out);
        shelter = false;
        u += 5;
      } else if (phone && pick < 0.3) {
        phoneBox(ctx, at(b, side, u, 0.8), Y);
        phone = false;
      } else if (pick < 0.42) bin(ctx, kerb, Y);
      else if (pick < 0.52) hydrant(ctx, kerb, Y);
      else if (pick < 0.62 && big) bench(ctx, at(b, side, u, 1.2), Y, out, true);
      else if (pick < 0.7) planter(ctx, kerb, Y, out, r);
      else if (pick < 0.77 && big) bikeRack(ctx, kerb, Y, r);
      else if (pick < 0.84 && big) paperBox(ctx, wall, Y, r);
      else if (pick < 0.92) bollards(ctx, kerb, Y);
      else rubbish(ctx, wall, Y, r);
    }
  }
}

/** The squares: stalls round the edge, with crates of whatever is in season. */
export function market(ctx: WorldContext, b: TownBlock, r: Rng) {
  const Y = b.y + 0.15;
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const R = Math.min(b.x1 - b.x0, b.z1 - b.z0) / 2 - 4;
  if (R < 11) return;
  const n = 3 + Math.floor(r.range(0, 4));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r.range(-0.2, 0.2);
    const p = { x: cx + Math.cos(a) * (R - 1), z: cz + Math.sin(a) * (R - 1), yaw: Math.atan2(Math.cos(a), Math.sin(a)) + Math.PI };
    stall(ctx, p, Y, r);
  }
}

function bin(ctx: WorldContext, p: { x: number; z: number }, Y: number) {
  ctx.batch.add(ctx.mats.paint, G.cyl, M(p.x, Y, p.z, 0.27, 0.86, 0.27), { color: 0x1f2a22 });
  ctx.batch.add(ctx.mats.iron, G.cyl, M(p.x, Y + 0.86, p.z, 0.29, 0.06, 0.29));
  ctx.collision.addCentered(p.x, Y, p.z, 0.55, 0.9, 0.55, false);
}

function hydrant(ctx: WorldContext, p: { x: number; z: number }, Y: number) {
  ctx.batch.add(ctx.mats.paint, G.cyl, M(p.x, Y, p.z, 0.13, 0.55, 0.13), { color: 0x7a1a14 });
  ctx.batch.add(ctx.mats.paint, G.sphere, M(p.x, Y + 0.56, p.z, 0.14, 0.09, 0.14), { color: 0x7a1a14 });
  ctx.batch.add(ctx.mats.paint, G.box, M(p.x, Y + 0.34, p.z, 0.36, 0.08, 0.08), { color: 0x6a1812 });
  ctx.collision.addCentered(p.x, Y, p.z, 0.3, 0.6, 0.3, false);
}

function bollards(ctx: WorldContext, p: { x: number; z: number; yaw: number }, Y: number) {
  for (const o of [-1.2, 0, 1.2]) {
    const q = local(p, o, 0);
    ctx.batch.add(ctx.mats.iron, G.cyl, M(q.x, Y, q.z, 0.09, 0.85, 0.09));
    ctx.batch.add(ctx.mats.iron, G.sphere, M(q.x, Y + 0.86, q.z, 0.1, 0.06, 0.1));
    ctx.collision.addCentered(q.x, Y, q.z, 0.2, 0.9, 0.2, false);
  }
}

function bench(ctx: WorldContext, p: { x: number; z: number; yaw: number }, Y: number, out: TownOut, facingStreet: boolean) {
  const yaw = facingStreet ? p.yaw : p.yaw + Math.PI;
  const back = local(p, 0, -0.22);
  ctx.batch.add(ctx.mats.wood, G.box, M(p.x, Y + 0.42, p.z, 1.8, 0.06, 0.46, yaw));
  ctx.batch.add(ctx.mats.wood, G.box, M(back.x, Y + 0.5, back.z, 1.8, 0.42, 0.05, yaw, -0.18));
  for (const o of [-0.75, 0.75]) {
    const q = local(p, o, 0);
    ctx.batch.add(ctx.mats.iron, G.box, M(q.x, Y, q.z, 0.06, 0.42, 0.44, yaw));
  }
  out.spots.push({ x: p.x, y: Y, z: p.z, yaw });
}

function planter(ctx: WorldContext, p: { x: number; z: number }, Y: number, out: TownOut, r: Rng) {
  ctx.batch.add(ctx.mats.concrete, G.box, M(p.x, Y, p.z, 1.1, 0.55, 1.1));
  ctx.batch.add(ctx.mats.vertex, G.box, M(p.x, Y + 0.5, p.z, 0.96, 0.06, 0.96), { color: 0x2a1f16, cast: false });
  out.plants.push({ s: 'bush', x: p.x, y: Y + 0.5, z: p.z, yaw: r.range(0, 6.28), scale: r.range(0.35, 0.5) });
  ctx.collision.addCentered(p.x, Y, p.z, 1.1, 0.6, 1.1, false);
}

function bikeRack(ctx: WorldContext, p: { x: number; z: number; yaw: number }, Y: number, r: Rng) {
  for (let i = 0; i < 3; i++) {
    const q = local(p, (i - 1) * 0.7, 0);
    // an inverted U, and now and then a bike locked to it
    ctx.batch.add(ctx.mats.metal, G.box, M(q.x, Y, q.z, 0.05, 0.8, 0.05, p.yaw, 0, 0));
    const q2 = local(p, (i - 1) * 0.7, 0.55);
    ctx.batch.add(ctx.mats.metal, G.box, M(q2.x, Y, q2.z, 0.05, 0.8, 0.05, p.yaw));
    const qm = local(p, (i - 1) * 0.7, 0.275);
    ctx.batch.add(ctx.mats.metal, G.box, M(qm.x, Y + 0.78, qm.z, 0.05, 0.05, 0.6, p.yaw));
    if (r.chance(0.4)) {
      const bq = local(p, (i - 1) * 0.7 + 0.12, 0.275);
      const col = [0x1a2a4a, 0x5a1a1a, 0x1a1a1a, 0x2a4a2a][r.int(0, 3)];
      for (const w of [-0.5, 0.5]) {
        const wq = local({ ...bq, yaw: p.yaw }, 0, w);
        ctx.batch.add(ctx.mats.rubber, G.wheel, M(wq.x, Y + 0.34, wq.z, 0.04, 0.34, 0.34, p.yaw));
      }
      ctx.batch.add(ctx.mats.paint, G.box, M(bq.x, Y + 0.48, bq.z, 0.04, 0.05, 0.95, p.yaw, 0.35), { color: col });
      ctx.batch.add(ctx.mats.paint, G.box, M(bq.x, Y + 0.62, bq.z, 0.04, 0.05, 0.7, p.yaw), { color: col });
    }
  }
}

function paperBox(ctx: WorldContext, p: { x: number; z: number; yaw: number }, Y: number, r: Rng) {
  const col = [0x1f3a6a, 0x8a1a14, 0xb08a1a, 0x2a2a2a][r.int(0, 3)];
  ctx.batch.add(ctx.mats.paint, G.box, M(p.x, Y + 0.3, p.z, 0.46, 0.7, 0.4, p.yaw), { color: col });
  const g = local(p, 0, 0.205);
  ctx.batch.add(ctx.mats.glass, G.box, M(g.x, Y + 0.6, g.z, 0.36, 0.26, 0.01, p.yaw), { cast: false });
  for (const o of [-0.18, 0.18]) {
    const q = local(p, o, 0);
    ctx.batch.add(ctx.mats.iron, G.box, M(q.x, Y, q.z, 0.04, 0.3, 0.36, p.yaw));
  }
}

function rubbish(ctx: WorldContext, p: { x: number; z: number; yaw: number }, Y: number, r: Rng) {
  const n = 2 + r.int(0, 3);
  for (let i = 0; i < n; i++) {
    const q = local(p, r.range(-0.7, 0.7), r.range(-0.2, 0.3));
    if (r.chance(0.6)) ctx.batch.add(ctx.mats.rubber, G.sphere, M(q.x, Y + 0.22, q.z, r.range(0.25, 0.35), r.range(0.22, 0.3), r.range(0.25, 0.32), r.range(0, 6)));
    else ctx.batch.add(ctx.mats.wood, G.box, M(q.x, Y, q.z, 0.55, 0.4, 0.45, r.range(0, 6)), { color: 0x8a7a60 });
  }
}

function busShelter(ctx: WorldContext, p: { x: number; z: number; yaw: number }, Y: number, out: TownOut) {
  const m = ctx.mats;
  // posts, a roof, a glass back and ends, a bench, a lit advert at one end
  for (const o of [-1.9, 1.9]) for (const d of [-0.6, 0.6]) {
    const q = local(p, o, d);
    ctx.batch.add(m.metal, G.box, M(q.x, Y, q.z, 0.07, 2.4, 0.07, p.yaw));
  }
  ctx.batch.add(m.metal, G.box, M(p.x, Y + 2.4, p.z, 4.1, 0.08, 1.5, p.yaw), { cast: true });
  const back = local(p, 0, -0.62);
  ctx.batch.add(m.glass, G.box, M(back.x, Y + 0.15, back.z, 3.8, 2.1, 0.02, p.yaw), { cast: false });
  const ad = local(p, 1.9, 0);
  ctx.batch.add(m.lampCold, G.box, M(ad.x, Y + 0.3, ad.z, 0.05, 1.7, 1.1, p.yaw), { cast: false });
  const end = local(p, -1.9, 0);
  ctx.batch.add(m.glass, G.box, M(end.x, Y + 0.15, end.z, 0.02, 2.1, 1.1, p.yaw), { cast: false });
  const seat = local(p, 0, -0.35);
  ctx.batch.add(m.metal, G.box, M(seat.x, Y + 0.45, seat.z, 2.4, 0.05, 0.4, p.yaw));
  const sign = local(p, 2.3, 0.8);
  ctx.batch.add(m.metal, G.cyl, M(sign.x, Y, sign.z, 0.04, 2.6, 0.04));
  ctx.batch.add(m.paint, G.box, M(sign.x, Y + 2.3, sign.z, 0.45, 0.45, 0.03, p.yaw), { color: 0x1f3a6a });
  const c = local(p, 0, -0.62);
  ctx.collision.addCentered(c.x, Y, c.z, Math.abs(Math.cos(p.yaw)) * 3.8 + 0.2, 2.3, Math.abs(Math.sin(p.yaw)) * 3.8 + 0.2, false);
  out.spots.push({ x: seat.x, y: Y, z: seat.z, yaw: p.yaw }, { x: local(p, 0.9, 0.1).x, y: Y, z: local(p, 0.9, 0.1).z, yaw: p.yaw });
}

function phoneBox(ctx: WorldContext, p: { x: number; z: number; yaw: number }, Y: number) {
  const m = ctx.mats;
  ctx.batch.add(m.paint, G.box, M(p.x, Y, p.z, 0.95, 0.12, 0.95, p.yaw), { color: 0x7a1a14 });
  for (const [ox, oz] of [[-0.44, -0.44], [0.44, -0.44], [-0.44, 0.44], [0.44, 0.44]]) {
    const q = local(p, ox, oz);
    ctx.batch.add(m.paint, G.box, M(q.x, Y, q.z, 0.08, 2.4, 0.08, p.yaw), { color: 0x7a1a14 });
  }
  ctx.batch.add(m.paint, G.box, M(p.x, Y + 2.35, p.z, 1.0, 0.22, 1.0, p.yaw), { color: 0x7a1a14 });
  ctx.batch.add(m.lampWarm, G.box, M(p.x, Y + 2.38, p.z, 0.7, 0.12, 1.02, p.yaw), { cast: false });
  ctx.batch.add(m.glass, G.box, M(p.x, Y + 0.12, p.z, 0.82, 2.1, 0.82, p.yaw), { cast: false });
  ctx.collision.addCentered(p.x, Y, p.z, 1, 2.5, 1, false);
}

/** A striped awning over a door: sloping out from the wall. */
function awning(ctx: WorldContext, p: Poi, Y: number, r: Rng, i: number) {
  const [a, b] = STRIPES[(i + Math.floor(r.range(0, 5))) % STRIPES.length];
  const base = { x: p.x, z: p.z, yaw: p.yaw };
  const w = 4.2, n = 7;
  // (the door is 0.6 m out from the wall: the awning starts at the wall)
  for (let k = 0; k < n; k++) {
    const q = local(base, -w / 2 + (k + 0.5) * (w / n), 0.1);
    ctx.batch.add(ctx.mats.cloth, G.box, M(q.x, Y + 2.9, q.z, w / n + 0.002, 0.03, 1.5, p.yaw, 0.32), { color: k % 2 ? a : b });
  }
  // the valance along its front edge
  const f = local(base, 0, 0.8);
  for (let k = 0; k < n; k++) {
    const q = local({ ...f, yaw: p.yaw }, -w / 2 + (k + 0.5) * (w / n), 0);
    ctx.batch.add(ctx.mats.cloth, G.box, M(q.x, Y + 2.35, q.z, w / n + 0.002, 0.28, 0.02, p.yaw), { color: k % 2 ? a : b, cast: false });
  }
}

/** Tables and chairs out front, under umbrellas. */
function cafe(ctx: WorldContext, p: Poi, Y: number, r: Rng, out: TownOut) {
  const m = ctx.mats;
  const col = STRIPES[r.int(0, STRIPES.length - 1)][0];
  for (const o of [-2.6, 2.6]) {
    const t = local({ x: p.x, z: p.z, yaw: p.yaw }, o, 0.9);
    ctx.batch.add(m.iron, G.cyl, M(t.x, Y, t.z, 0.04, 0.72, 0.04));
    ctx.batch.add(m.metal, G.cyl, M(t.x, Y + 0.72, t.z, 0.36, 0.03, 0.36));
    // the umbrella
    ctx.batch.add(m.wood, G.cyl, M(t.x, Y, t.z, 0.025, 2.3, 0.025));
    ctx.batch.add(m.cloth, CONE, M(t.x, Y + 1.95, t.z, 1.3, 0.4, 1.3), { color: col });
    for (const c of [0, 1, 2]) {
      const a = c * 2.1 + r.range(-0.3, 0.3);
      const cx = t.x + Math.cos(a) * 0.62, cz = t.z + Math.sin(a) * 0.62;
      const yaw = Math.atan2(t.x - cx, t.z - cz);
      ctx.batch.add(m.metal, G.box, M(cx, Y + 0.44, cz, 0.4, 0.04, 0.4, yaw));
      const bk = { x: cx - Math.sin(yaw) * 0.19, z: cz - Math.cos(yaw) * 0.19 };
      ctx.batch.add(m.metal, G.box, M(bk.x, Y + 0.46, bk.z, 0.4, 0.42, 0.03, yaw));
      for (const [lx, lz] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) {
        const q = local({ x: cx, z: cz, yaw }, lx, lz);
        ctx.batch.add(m.iron, G.box, M(q.x, Y, q.z, 0.025, 0.44, 0.025));
      }
      if (c === 0) out.spots.push({ x: cx, y: Y, z: cz, yaw });
    }
    ctx.collision.addCentered(t.x, Y, t.z, 1.4, 0.9, 1.4, false);
  }
}

/** A market stall: a counter, posts, a striped roof and crates of produce. */
function stall(ctx: WorldContext, p: { x: number; z: number; yaw: number }, Y: number, r: Rng) {
  const m = ctx.mats;
  const [a, b] = STRIPES[r.int(0, STRIPES.length - 1)];
  for (const [ox, oz] of [[-1.4, -0.9], [1.4, -0.9], [-1.4, 0.9], [1.4, 0.9]]) {
    const q = local(p, ox, oz);
    ctx.batch.add(m.wood, G.box, M(q.x, Y, q.z, 0.08, 2.3, 0.08, p.yaw));
  }
  for (let k = 0; k < 6; k++) {
    const q = local(p, -1.5 + (k + 0.5) * 0.5, 0);
    ctx.batch.add(m.cloth, G.box, M(q.x, Y + 2.3, q.z, 0.502, 0.03, 2.2, p.yaw, 0.12), { color: k % 2 ? a : b });
  }
  const ct = local(p, 0, 0.6);
  ctx.batch.add(m.wood, G.box, M(ct.x, Y, ct.z, 2.9, 0.85, 0.6, p.yaw), { color: 0x6a5238 });
  const produce = [0x8a2a1a, 0x9a7a1a, 0x3a5a1a, 0x6a3a5a, 0xa05a1a];
  for (let k = 0; k < 4; k++) {
    const q = local(p, -1.05 + k * 0.7, 0.6);
    ctx.batch.add(m.wood, G.box, M(q.x, Y + 0.85, q.z, 0.6, 0.14, 0.5, p.yaw), { color: 0x8a7050 });
    ctx.batch.add(m.vertex, G.box, M(q.x, Y + 0.97, q.z, 0.54, 0.07, 0.44, p.yaw), { color: produce[r.int(0, produce.length - 1)] });
  }
  for (let k = 0; k < 3; k++) {
    const q = local(p, r.range(-1.2, 1.2), r.range(-0.7, -0.2));
    ctx.batch.add(m.wood, G.box, M(q.x, Y, q.z, 0.5, 0.35, 0.4, p.yaw + r.range(-0.3, 0.3)), { color: 0x8a7050 });
  }
  ctx.collision.addCentered(p.x, Y, p.z, 3, 1, 2.2, false);
}
