import * as THREE from 'three';
import { BLOCKS, type Block, type Rect, type Style, r } from '../layout';
import { STYLE_INDEX } from '../materials';
import type { WorldContext } from '../WorldContext';
import { mulberry32, type Rng } from '../rng';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 14, 1);

const STYLE_PARAMS: Record<Style, { floorH: number; winW: number }> = {
  stone: { floorH: 4.1, winW: 2.9 },
  brick: { floorH: 3.4, winW: 2.3 },
  concrete: { floorH: 3.6, winW: 3.3 },
  glass: { floorH: 3.8, winW: 1.7 },
  plain: { floorH: 4, winW: 3 },
  metal: { floorH: 5, winW: 4 },
};

export interface FacadeOpts {
  style: Style;
  seed: number;
  lit: number; // < 0 = blank wall
  floorH?: number;
  winW?: number;
  roofY?: number;
  collide?: boolean;
  cast?: boolean;
}

/** A box rendered with the procedural facade shader. */
export function facadeBox(ctx: WorldContext, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, o: FacadeOpts) {
  const p = STYLE_PARAMS[o.style];
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2),
    new THREE.Quaternion(),
    new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0),
  );
  ctx.batch.add(ctx.mats.facade, BOX, m, {
    cast: o.cast ?? true,
    attrs: {
      aBld: [o.seed, o.floorH ?? p.floorH, o.winW ?? p.winW, o.lit],
      aTop: [o.roofY ?? y1, STYLE_INDEX[o.style]],
    },
  });
  if (o.collide !== false) ctx.collision.add(x0, y0, z0, x1, y1, z1, true);
}

/** One building on a lot: body, optional setback, cornice, roof clutter. */
export function building(ctx: WorldContext, lot: Rect, height: number, style: Style, rng: Rng, lit: number) {
  const seed = rng.range(0, 100);
  const tall = height > 24;
  facadeBox(ctx, lot.x0, 0, lot.z0, lot.x1, height, lot.z1, { style, seed, lit });

  // cornice / parapet
  if (style !== 'glass' && style !== 'metal') {
    const o = 0.35;
    facadeBox(ctx, lot.x0 - o, height - 0.2, lot.z0 - o, lot.x1 + o, height + 0.55, lot.z1 + o, { style, seed, lit: -1, collide: false });
    if (style === 'stone') {
      // string course above the ground floor
      const gh = STYLE_PARAMS.stone.floorH * 1.3;
      facadeBox(ctx, lot.x0 - 0.18, gh - 0.1, lot.z0 - 0.18, lot.x1 + 0.18, gh + 0.35, lot.z1 + 0.18, { style, seed, lit: -1, collide: false, cast: false });
    }
  }

  // setback tower
  const w = lot.x1 - lot.x0, d = lot.z1 - lot.z0;
  if (tall && rng.chance(0.55) && w > 10 && d > 10) {
    const inset = rng.range(2, 4);
    const extra = rng.range(6, 16);
    facadeBox(ctx, lot.x0 + inset, height, lot.z0 + inset, lot.x1 - inset, height + extra, lot.z1 - inset, { style, seed: seed + 1, lit, collide: false });
    height += extra;
    if (rng.chance(0.35)) {
      // aviation light on the tallest
      const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
      ctx.box(ctx.mats.iron, cx, height, cz, 0.15, 5, 0.15);
      const l = ctx.lamp(new THREE.Vector3(cx, height + 5.1, cz), 'red', { pooled: false, cone: false, streak: 0, halo: 0.9 });
      l.flicker = 2; // slow blink
    }
  }

  // roof clutter
  const rx = () => rng.range(lot.x0 + 2, lot.x1 - 2);
  const rz = () => rng.range(lot.z0 + 2, lot.z1 - 2);
  const n = rng.int(1, 3);
  for (let i = 0; i < n; i++) {
    const bw = rng.range(1.5, 4), bd = rng.range(1.5, 3.5), bh = rng.range(1, 2.4);
    ctx.box(ctx.mats.concrete, rx(), height + 0.5, rz(), bw, bh, bd);
  }
  if (!tall && style === 'brick' && rng.chance(0.5)) {
    // water tank on legs
    const x = rx(), z = rz();
    ctx.batch.add(ctx.mats.wood, CYL, mat(x, height + 3.6, z, 1.5, 2.6, 1.5));
    ctx.batch.add(ctx.mats.iron, CYL, mat(x, height + 4.95, z, 1.6, 0.25, 1.6));
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) ctx.box(ctx.mats.iron, x + ox, height + 0.5, z + oz, 0.12, 2, 0.12);
  }
  return height;
}

function mat(x: number, y: number, z: number, sx: number, sy: number, sz: number) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
}

/** Split a block into lots and raise buildings. Returns lots for later dressing. */
export function fillBlock(ctx: WorldContext, b: Block, rng: Rng): { rect: Rect; h: number; style: Style }[] {
  const out: { rect: Rect; h: number; style: Style }[] = [];
  const { rect } = b;
  const alongZ = rect.z1 - rect.z0 >= rect.x1 - rect.x0;
  const start = alongZ ? rect.z0 : rect.x0;
  const end = alongZ ? rect.z1 : rect.x1;
  let s = start;
  while (s < end - 0.5) {
    let len = rng.range(b.lot[0], b.lot[1]);
    if (end - (s + len) < b.lot[0] * 0.6) len = end - s;
    let e = Math.min(end, s + len);
    // respect alley gaps
    const gap = b.gaps?.find(([g0, g1]) => start + g0 < e && start + g1 > s);
    if (gap) {
      const g0 = start + gap[0], g1 = start + gap[1];
      if (s < g0 - 0.5) e = g0;
      else {
        s = g1;
        continue;
      }
    }
    const lot = alongZ ? r(rect.x0, s, rect.x1, e) : r(s, rect.z0, e, rect.z1);
    const style = rng.pick(b.styles);
    let h = rng.range(b.h[0], b.h[1]);
    // quantise to whole storeys so windows land cleanly under the cornice
    const fh = STYLE_PARAMS[style].floorH;
    h = Math.max(fh * 2.3, Math.round((h - fh * 1.3) / fh) * fh + fh * 1.3 + 0.9);
    const lit = b.lit ?? 0.26;
    const finalH = building(ctx, lot, h, style, rng, lit);
    out.push({ rect: lot, h: finalH, style });
    s = e;
  }
  return out;
}

export function buildBlocks(ctx: WorldContext) {
  const rng = mulberry32(0x0317);
  const lots = new Map<string, { rect: Rect; h: number; style: Style }[]>();
  for (const b of BLOCKS) {
    if (b.district === 'yard') continue; // warehouses are built by the yard builder
    lots.set(b.id, fillBlock(ctx, b, rng));
  }
  return lots;
}

/** Silhouettes beyond the walkable edge so streets never end in a void. */
export function buildOutskirts(ctx: WorldContext) {
  const rng = mulberry32(911);
  const rows: Rect[] = [];
  // (east and west are the endless outskirts now: world/Outskirts.ts)
  rows.push(r(-150, -290, 150, -212)); // behind the station
  rows.push(r(-230, -212, -60, -128)); // north-west, behind the quarter wall
  rows.push(r(60, -212, 230, -128));
  for (const row of rows) {
    const alongX = row.x1 - row.x0 > row.z1 - row.z0;
    let s = alongX ? row.x0 : row.z0;
    const end = alongX ? row.x1 : row.z1;
    while (s < end) {
      const len = rng.range(12, 26);
      const e = Math.min(end, s + len);
      const lot = alongX ? r(s, row.z0, e, row.z1) : r(row.x0, s, row.x1, e);
      const style = rng.pick(['stone', 'brick', 'concrete', 'glass'] as const);
      const h = rng.range(14, 52);
      facadeBox(ctx, lot.x0, 0, lot.z0, lot.x1, h, lot.z1, { style, seed: rng.range(0, 100), lit: 0.2, collide: false, cast: false });
      s = e + (rng.chance(0.3) ? rng.range(4, 9) : 0);
    }
  }

  // far bank of the river: low warehouses and terraces, some lit
  let x = -300;
  while (x < 300) {
    const w = rng.range(10, 28);
    const h = rng.range(8, 26);
    const style = rng.pick(['brick', 'concrete', 'stone', 'metal'] as const);
    facadeBox(ctx, x, 0, 206, x + w, h, 206 + rng.range(12, 30), { style, seed: rng.range(0, 100), lit: style === 'metal' ? -1 : 0.22, collide: false, cast: false });
    x += w + (rng.chance(0.25) ? rng.range(6, 14) : 0.5);
  }
}
