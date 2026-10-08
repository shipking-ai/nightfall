import * as THREE from 'three';
import type { WorldContext, Lamp } from '../../world/WorldContext';
import { STYLE_INDEX } from '../../world/materials';
import { G, M } from '../../world/builders/props';
import { mulberry32, type Rng } from '../../world/rng';
import { CITY_STYLES, type CityStyle, type FacadeStyle, type LandmarkKind, type Species } from './biomes';
import { D03_KEEP, DISTRICT_03, SEA_Y, newGround, type Settlement, type WorldGen } from './WorldGen';
import type { Plant } from './Flora';
import { furnish, market } from './StreetLife';

/**
 * Towns and cities. Each settlement has a plan — a street grid, blocks, what
 * each block is for, where its landmarks stand, which doors are shops — made
 * once from its seed and kept. Chunks then build only the blocks whose middle
 * falls inside them. Architecture, heights, street widths, lamps, roofs and
 * trees all come from the city's archetype (world/biomes.ts), so a desert
 * town and a northern city don't just differ in colour.
 */

export type BlockUse = 'build' | 'park' | 'plaza' | 'parking' | 'landmark' | 'yard' | 'houses';

export interface TownBlock {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y: number;
  use: BlockUse;
  /** 0 at the edge … 1 at the very centre */
  core: number;
  landmark?: LandmarkKind;
  seed: number;
}

export type PoiKind = 'diner' | 'bar' | 'store' | 'gas' | 'garage' | 'clinic' | 'hotel' | 'police' | 'gunsmith' | 'pawn' | 'arcade' | 'club' | 'gym' | 'church' | 'bank' | 'dock' | 'market' | 'office' | 'station' | 'motel' | 'workshop';

export interface Poi {
  id: string;
  kind: PoiKind;
  name: string;
  x: number;
  y: number;
  z: number;
  /** the way out of the door (towards the street) */
  yaw: number;
  town: string;
}

export interface TownPlan {
  s: Settlement;
  style: CityStyle;
  xs: number[];
  zs: number[];
  blocks: TownBlock[];
  pois: Poi[];
  /** walkable points on the pavements (block corners), for people */
  walk: { x: number; z: number; y: number }[];
}

export interface TownOut {
  plants: Plant[];
  lamps: Lamp[];
  pois: Poi[];
  /** where people can stand about */
  spots: { x: number; y: number; z: number; yaw: number }[];
  /** parked cars */
  cars: { x: number; y: number; z: number; yaw: number }[];
}

const _g = newGround();

const ROOF_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05 });
const ROOF_GEO = (() => {
  // a gable along x, 1×1×1 (base at 0)
  const g = new THREE.BufferGeometry();
  const v = [
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 1, 0, -0.5, 0, -0.5, 0.5, 1, 0, -0.5, 1, 0,
    -0.5, 0, 0.5, -0.5, 1, 0, 0.5, 1, 0, -0.5, 0, 0.5, 0.5, 1, 0, 0.5, 0, 0.5,
    -0.5, 0, -0.5, -0.5, 1, 0, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 1, 0,
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
})();

/** The plan of a settlement (cached). */
export class Towns {
  private plans = new Map<string, TownPlan>();

  constructor(private gen: WorldGen) {}

  plan(s: Settlement): TownPlan {
    const hit = this.plans.get(s.id);
    if (hit) return hit;
    const p = this.makePlan(s);
    if (this.plans.size > 24) this.plans.delete(this.plans.keys().next().value!);
    this.plans.set(s.id, p);
    return p;
  }

  private makePlan(s: Settlement): TownPlan {
    const style = CITY_STYLES[s.archetype ?? 'historic'];
    const r = mulberry32(Math.floor(s.seed) >>> 0);
    const village = s.kind === 'village';
    const block = village ? 46 : s.kind === 'military' ? 90 : style.block * (s.kind === 'town' ? 0.85 : 1);
    const street = village ? 9 : style.street;
    const pitch = block + street;
    const R = s.radius;
    // street lines: Merrow keeps District 03's (Central Avenue at x = 0, Linden, Harbor, River Road)
    const line = (c: number, anchor: number, fixed?: number[]) => {
      const out: number[] = [];
      if (fixed) {
        out.push(...fixed);
        for (let v = fixed[0] - 90; v > c - R - pitch; v -= 90) out.unshift(v);
        for (let v = fixed[fixed.length - 1] + 90; v < c + R + pitch; v += 90) out.push(v);
      } else {
        const k0 = Math.floor((c - R - pitch - anchor) / pitch), k1 = Math.ceil((c + R + pitch - anchor) / pitch);
        for (let k = k0; k <= k1; k++) out.push(anchor + k * pitch);
      }
      return out;
    };
    const xs = s.home ? line(s.x, 0) : line(s.x, s.x + street / 2 - pitch / 2);
    const zs = s.home ? line(s.z, 0, [-40, 54, 141, 232]) : line(s.z, s.z + street / 2 - pitch / 2);
    const blocks: TownBlock[] = [];
    const walk: TownPlan['walk'] = [];
    const halfS = street / 2;
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
      const x0 = xs[i] + halfS, x1 = xs[i + 1] - halfS, z0 = zs[j] + halfS, z1 = zs[j + 1] - halfS;
      if (x1 - x0 < 14 || z1 - z0 < 14) continue;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const d = Math.hypot(cx - s.x, cz - s.z);
      // a ragged edge: some blocks at the fringe are left as fields
      const edgeNoise = this.gen.spot(cx, cz, 17) * 0.18;
      if (d > R * (0.92 - edgeNoise)) continue;
      if (village && d > R) continue;
      // District 03 and its surroundings are handcrafted
      if (s.home && x1 > D03_KEEP.x0 && x0 < D03_KEEP.x1 && z1 > D03_KEEP.z0 && z0 < D03_KEEP.z1) continue;
      if (inReserved(this.gen, x0, z0, x1, z1)) continue;
      // only on ground that stayed flat (not in a river, not on a road's embankment, not in the sea)
      let ok = true;
      for (const [px, pz] of [[cx, cz], [x0 + 2, z0 + 2], [x1 - 2, z1 - 2], [x0 + 2, z1 - 2], [x1 - 2, z0 + 2]]) {
        const g = this.gen.ground(px, pz, _g);
        if (g.water != null || Math.abs(g.h - s.y) > 0.9 || g.road > 0) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const core = 1 - Math.min(1, d / R);
      const seed = Math.floor(this.gen.spot(cx, cz, 5) * 1e6);
      let use: BlockUse = 'build';
      const u = this.gen.spot(cx, cz, 11);
      if (s.kind === 'military') use = 'yard';
      else if (village) use = u < 0.12 ? 'park' : 'houses';
      else if (style.id === 'suburban' && core < 0.7) use = u < 0.08 ? 'park' : u < 0.12 ? 'parking' : 'houses';
      else if (u < 0.07 + (1 - core) * 0.05) use = 'park';
      else if (u < 0.1 && core > 0.4) use = 'plaza';
      else if (u < 0.14) use = 'parking';
      else if (core < 0.25 && (style.roofs || s.kind === 'town') && u < 0.5) use = 'houses';
      blocks.push({ x0, z0, x1, z1, y: s.y, use, core, seed });
      walk.push({ x: x0 - 1.4, z: z0 - 1.4, y: s.y + 0.15 }, { x: x1 + 1.4, z: z0 - 1.4, y: s.y + 0.15 }, { x: x1 + 1.4, z: z1 + 1.4, y: s.y + 0.15 }, { x: x0 - 1.4, z: z1 + 1.4, y: s.y + 0.15 });
    }
    // landmarks on the blocks nearest the middle (cities and towns)
    if (s.kind === 'city' || s.kind === 'town') {
      const central = blocks.filter((b) => b.use === 'build' || b.use === 'plaza').sort((a, b) => b.core - a.core);
      const want = s.kind === 'city' ? style.landmarks.slice() : style.landmarks.slice(0, 1);
      let k = 0;
      for (const lm of want) {
        // not all next to each other: skip ahead a little each time
        const b = central[k * 3 + r.int(0, 2)];
        if (!b) break;
        b.use = 'landmark';
        b.landmark = lm;
        k++;
      }
    }
    const pois = this.makePois(s, style, blocks, r);
    return { s, style, xs, zs, blocks, pois, walk };
  }

  /** Which doors are shops, bars, a clinic, the police … */
  private makePois(s: Settlement, style: CityStyle, blocks: TownBlock[], r: Rng): Poi[] {
    const out: Poi[] = [];
    if (s.kind === 'ruin' || s.kind === 'junction') return out;
    const want: PoiKind[] =
      s.kind === 'city' ? ['diner', 'bar', 'store', 'gas', 'garage', 'clinic', 'hotel', 'police', 'gunsmith', 'pawn', 'arcade', 'club', 'gym', 'bank', 'market', 'office', 'station', 'bar', 'diner', 'store', 'church', 'workshop']
      : s.kind === 'town' ? ['diner', 'bar', 'store', 'gas', 'garage', 'clinic', 'police', 'motel', 'church', 'gunsmith', 'workshop', 'pawn']
      : s.kind === 'military' ? ['store', 'clinic', 'gunsmith']
      : ['store', 'bar', 'church', 'gas'];
    if (style.id === 'coastal' || style.id === 'port' || s.coastal) want.push('dock');
    const cands = blocks.filter((b) => b.use === 'build' || b.use === 'houses' || b.use === 'yard').sort((a, b) => b.core - a.core);
    if (!cands.length) return out;
    want.forEach((kind, i) => {
      const b = cands[(i * 7 + r.int(0, 3)) % cands.length];
      // on a random side of the block, at the pavement
      const side = r.int(0, 3);
      const t = r.range(0.25, 0.75);
      const x = side === 0 || side === 2 ? b.x0 + (b.x1 - b.x0) * t : side === 1 ? b.x1 + 0.6 : b.x0 - 0.6;
      const z = side === 1 || side === 3 ? b.z0 + (b.z1 - b.z0) * t : side === 0 ? b.z0 - 0.6 : b.z1 + 0.6;
      const yaw = side === 0 ? Math.PI : side === 1 ? Math.PI / 2 : side === 2 ? 0 : -Math.PI / 2;
      out.push({ id: `${s.id}:${kind}:${i}`, kind, name: poiName(kind, r, s.name), x, y: b.y + 0.15, z, yaw, town: s.id });
    });
    return out;
  }

  /**
   * Build whatever of every settlement falls in this chunk. Returns what the
   * rest of the world needs to know (plants, lamps, shop doors, places to stand).
   */
  build(ctx: WorldContext, x0: number, z0: number, size: number, out: TownOut) {
    for (const _ of this.buildSteps(ctx, x0, z0, size, out)) void _;
  }

  /** The same, a block at a time (the streamer spreads a town over a few frames). */
  *buildSteps(ctx: WorldContext, x0: number, z0: number, size: number, out: TownOut): Generator<void, void> {
    const cx = x0 + size / 2, cz = z0 + size / 2;
    for (const s of this.gen.settlementsNear(cx, cz, 1)) {
      if (Math.hypot(cx - s.x, cz - s.z) > s.radius + size) continue;
      const plan = this.plan(s);
      for (const b of plan.blocks) {
        const bx = (b.x0 + b.x1) / 2, bz = (b.z0 + b.z1) / 2;
        if (bx < x0 || bx >= x0 + size || bz < z0 || bz >= z0 + size) continue;
        this.buildBlock(ctx, plan, b, out);
        yield;
      }
      for (const p of plan.pois) if (p.x >= x0 && p.x < x0 + size && p.z >= z0 && p.z < z0 + size) out.pois.push(p);
      this.streets(ctx, plan, x0, z0, size, out);
      yield;
    }
  }

  /**
   * The streets between the blocks, their kerbs and lane dashes.
   *
   * The asphalt goes only on the street corridors — the gaps between blocks —
   * not over the whole town. Tiling it across the settlement's full radius made
   * every town one continuous slab with the block buildings stranded on it.
   */
  private streets(ctx: WorldContext, plan: TownPlan, x0: number, z0: number, size: number, out: TownOut) {
    const s = plan.s;
    const mats = ctx.mats;
    const street = s.kind === 'village' ? 9 : plan.style.street;
    const half = street / 2;
    const y = s.y + 0.03;
    const rough = s.kind === 'village' || s.kind === 'ruin' ? mats.yard : mats.asphalt;
    const inD03 = (x: number, z: number) => s.home && x > DISTRICT_03.x0 && x < DISTRICT_03.x1 && z > DISTRICT_03.z0 && z < DISTRICT_03.z1;
    const near = (x: number, z: number) => Math.hypot(x - s.x, z - s.z) <= s.radius * 0.95;

    // one slab per street corridor, run in strips along its length so the
    // chunk only pays for the part of it that falls inside
    const strip = (along: 'x' | 'z', line: number) => {
      // the cross extent runs over the whole town; the corridor's own extent
      const lo = along === 'x' ? s.x - s.radius * 0.95 : line - half;
      const hi = along === 'x' ? s.x + s.radius * 0.95 : line + half;
      if (hi < x0 || lo > x0 + size) return;
      const L = Math.hypot(
        along === 'x' ? s.radius * 0.95 : street,
        along === 'x' ? street : s.radius * 0.95,
      );
      const step = 16;
      const n = Math.ceil(L / step);
      for (let i = 0; i < n; i++) {
        const a = lo + (i / n) * L;
        const b = lo + ((i + 1) / n) * L;
        const c = (a + b) / 2;
        const px = along === 'x' ? c : line;
        const pz = along === 'x' ? line : c;
        if (px < x0 - 1 || px > x0 + size + 1 || pz < z0 - 1 || pz > z0 + size + 1) continue;
        if (!near(px, pz) || inD03(px, pz)) continue;
        const g = this.gen.ground(px, pz, _g);
        if (g.water != null || Math.abs(g.h - s.y) > 0.6) continue;
        const w = along === 'x' ? b - a : street;
        const d = along === 'x' ? street : b - a;
        ctx.batch.add(rough, G.box, M(px, y - 0.1, pz, w, 0.1, d), { cast: false });
        // a kerb either side, so the carriageway has an edge to end on
        if (street > 11) {
          const kw = along === 'x' ? w : 0.4;
          const kd = along === 'x' ? 0.4 : d;
          const off = half - 0.2;
          ctx.batch.add(mats.paving, G.box, M(along === 'x' ? px : line - off, y - 0.02, along === 'x' ? line - off : pz, kw, 0.14, kd), { cast: false });
          ctx.batch.add(mats.paving, G.box, M(along === 'x' ? px : line + off, y - 0.02, along === 'x' ? line + off : pz, kw, 0.14, kd), { cast: false });
        }
      }
    };
    for (const lx of plan.xs) strip('z', lx);
    for (const lz of plan.zs) strip('x', lz);
    if (s.kind === 'village' || s.kind === 'ruin' || s.kind === 'military') return;
    // dashes down the middle of each street line within the chunk
    const pitchLen = 9;
    for (const lx of plan.xs) {
      if (lx < x0 || lx >= x0 + size) continue;
      for (let z = z0; z < z0 + size; z += pitchLen) {
        if (Math.hypot(lx - s.x, z - s.z) > s.radius * 0.9) continue;
        if (plan.zs.some((l) => Math.abs(z - l) < plan.style.street / 2 + 2)) continue;
        if (!this.flat(lx, z, s.y)) continue;
        ctx.batch.add(mats.marking, G.box, M(lx, y, z, 0.16, 0.012, 4.2), { cast: false });
      }
    }
    for (const lz of plan.zs) {
      if (lz < z0 || lz >= z0 + size) continue;
      for (let x = x0; x < x0 + size; x += pitchLen) {
        if (Math.hypot(x - s.x, lz - s.z) > s.radius * 0.9) continue;
        if (plan.xs.some((l) => Math.abs(x - l) < plan.style.street / 2 + 2)) continue;
        if (!this.flat(x, lz, s.y)) continue;
        ctx.batch.add(mats.marking, G.box, M(x, y, lz, 4.2, 0.012, 0.16), { cast: false });
      }
    }
  }

  private flat(x: number, z: number, y: number) {
    if (x > DISTRICT_03.x0 && x < DISTRICT_03.x1 && z > DISTRICT_03.z0 && z < DISTRICT_03.z1) return false;
    const g = this.gen.ground(x, z, _g);
    return g.water == null && Math.abs(g.h - y) < 0.5;
  }

  private buildBlock(ctx: WorldContext, plan: TownPlan, b: TownBlock, out: TownOut) {
    const s = plan.s, st = plan.style;
    const r = mulberry32(b.seed);
    const y = b.y;
    const mats = ctx.mats;
    const ruin = s.kind === 'ruin';
    // the pavement: a kerbed pad round the whole block
    ctx.batch.add(mats.paving, G.box, M((b.x0 + b.x1) / 2, y - 0.2, (b.z0 + b.z1) / 2, b.x1 - b.x0 + 6, 0.35, b.z1 - b.z0 + 6), { cast: false });
    ctx.collision.add(b.x0 - 3, y - 0.2, b.z0 - 3, b.x1 + 3, y + 0.15, b.z1 + 3, false);
    const inner = { x0: b.x0 + 1, z0: b.z0 + 1, x1: b.x1 - 1, z1: b.z1 - 1 };
    const Y = y + 0.15;
    switch (b.use) {
      case 'park':
      case 'plaza': {
        const park = b.use === 'park';
        ctx.batch.add(park ? mats.vertex : mats.paving, G.box, M((b.x0 + b.x1) / 2, Y - 0.05, (b.z0 + b.z1) / 2, b.x1 - b.x0, 0.08, b.z1 - b.z0), { color: park ? 0x1c2a14 : 0xffffff, cast: false });
        const n = park ? Math.floor(((b.x1 - b.x0) * (b.z1 - b.z0)) / 90) : 4;
        const sp: Species = st.streetTrees === 'palm' ? 'palm' : st.streetTrees === 'pine' ? 'pine' : 'oak';
        for (let i = 0; i < n; i++) out.plants.push({ s: park && r.chance(0.25) ? 'bush' : sp, x: r.range(inner.x0 + 2, inner.x1 - 2), y: Y - 0.05, z: r.range(inner.z0 + 2, inner.z1 - 2), yaw: r.range(0, 6.28), scale: r.range(0.75, 1.15) });
        // benches, a fountain or a monument in the middle
        const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
        if (r.chance(0.6)) {
          ctx.batch.add(mats.stone, G.cyl, M(cx, Y, cz, 3, 0.6, 3));
          ctx.batch.add(mats.water, G.cyl, M(cx, Y + 0.45, cz, 2.6, 0.1, 2.6), { cast: false });
          ctx.collision.addCentered(cx, Y, cz, 5.6, 0.6, 5.6, false);
        }
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + 0.4;
          const bx = cx + Math.cos(a) * 7, bz = cz + Math.sin(a) * 7;
          ctx.batch.add(mats.wood, G.box, M(bx, Y + 0.42, bz, 1.8, 0.08, 0.5, -a + Math.PI / 2));
          ctx.batch.add(mats.iron, G.box, M(bx, Y, bz, 1.6, 0.42, 0.1, -a + Math.PI / 2));
          out.spots.push({ x: bx, y: Y, z: bz, yaw: -a + Math.PI / 2 });
        }
        break;
      }
      case 'parking': {
        ctx.batch.add(mats.asphalt, G.box, M((b.x0 + b.x1) / 2, Y - 0.06, (b.z0 + b.z1) / 2, b.x1 - b.x0, 0.08, b.z1 - b.z0), { cast: false });
        for (let x = inner.x0 + 3; x < inner.x1 - 2; x += 3) ctx.batch.add(mats.marking, G.box, M(x, Y, inner.z0 + 3, 0.12, 0.01, 5), { cast: false });
        for (let x = inner.x0 + 4.5; x < inner.x1 - 3; x += 3) if (r.chance(0.45)) out.cars.push({ x, y: Y, z: inner.z0 + 3, yaw: 0 });
        break;
      }
      case 'landmark':
        landmark(ctx, b, b.landmark!, r, out);
        break;
      case 'yard':
        this.militaryYard(ctx, b, r, out);
        break;
      case 'houses':
        this.houses(ctx, plan, b, r, out, ruin);
        break;
      default:
        this.buildings(ctx, plan, b, r, out, ruin);
    }
    // lamps round the kerb
    if (!ruin && b.use !== 'yard') {
      const every = s.kind === 'village' ? st.lampEvery * 2 : st.lampEvery;
      const kind = st.lamp;
      const place = (x: number, z: number) => {
        ctx.batch.add(mats.iron, G.cyl, M(x, Y, z, 0.08, 6.4, 0.08));
        ctx.batch.add(kind === 'cold' ? mats.lampCold : mats.lampWarm, G.box, M(x, Y + 6.3, z, 0.5, 0.16, 0.34), { cast: false });
        ctx.collision.addCentered(x, Y, z, 0.26, 6, 0.26, false);
        const l = ctx.lamp(new THREE.Vector3(x, Y + 6.2, z), kind, { intensity: 48, range: 24, ground: Y, cone: false, streak: 0.8 });
        out.lamps.push(l);
      };
      for (let x = b.x0 + every / 2; x < b.x1; x += every) {
        place(x, b.z0 - 2.4);
        place(x, b.z1 + 2.4);
      }
      for (let z = b.z0 + every / 2; z < b.z1; z += every) {
        place(b.x0 - 2.4, z);
        place(b.x1 + 2.4, z);
      }
      // street trees
      if (st.streetTrees !== 'none' && b.use !== 'plaza') {
        const sp: Species = st.streetTrees === 'palm' ? 'palm' : st.streetTrees === 'pine' ? 'pine' : 'oak';
        for (let x = b.x0 + every; x < b.x1 - 4; x += every) {
          out.plants.push({ s: sp, x, y: Y, z: b.z0 - 2, yaw: r.range(0, 6.28), scale: r.range(0.55, 0.8) });
          out.plants.push({ s: sp, x, y: Y, z: b.z1 + 2, yaw: r.range(0, 6.28), scale: r.range(0.55, 0.8) });
        }
      }
      // bins, benches, shelters, awnings, café tables; stalls in the squares
      if (b.use === 'build' || b.use === 'landmark') furnish(ctx, plan, b, r, out, every);
      if (b.use === 'plaza') market(ctx, b, r);
      // parked cars along one kerb
      if (r.chance(0.6)) for (let x = b.x0 + 4; x < b.x1 - 4; x += 7) if (r.chance(0.4)) out.cars.push({ x, y: y + 0.03, z: b.z0 - 4.6, yaw: Math.PI / 2 });
    }
    // corners are places where people wait
    out.spots.push({ x: b.x0 - 1.5, y: Y, z: b.z0 - 1.5, yaw: r.range(0, 6.28) }, { x: b.x1 + 1.5, y: Y, z: b.z1 + 1.5, yaw: r.range(0, 6.28) });
  }

  /** Rows of buildings, taller in the middle of town. */
  private buildings(ctx: WorldContext, plan: TownPlan, b: TownBlock, r: Rng, out: TownOut, ruin: boolean) {
    const st = plan.style;
    const Y = b.y + 0.15;
    const w = b.x1 - b.x0, d = b.z1 - b.z0;
    const alongX = w >= d;
    const depth = alongX ? d : w;
    const rows = depth > 40 ? 2 : 1;
    const hMin = lerpN(st.edge[0], st.core[0], b.core * b.core), hMax = lerpN(st.edge[1], st.core[1], b.core * b.core);
    for (let row = 0; row < rows; row++) {
      let s = alongX ? b.x0 : b.z0;
      const end = alongX ? b.x1 : b.z1;
      while (s < end - 4) {
        let len = r.range(10, 26);
        if (end - (s + len) < 8) len = end - s;
        const e = Math.min(end, s + len);
        const rowDepth = depth / rows;
        const a0 = (alongX ? b.z0 : b.x0) + row * rowDepth, a1 = a0 + rowDepth;
        const lot = alongX ? { x0: s, z0: a0, x1: e, z1: a1 } : { x0: a0, z0: s, x1: a1, z1: e };
        const style = weighted(r, st.styles);
        let h = r.range(hMin, hMax) * (r.chance(0.08) ? 1.5 : 1);
        if (ruin) h = Math.min(h, r.range(4, 12));
        const gap = r.chance(0.12) ? r.range(2, 5) : 0;
        if (gap) lot.x1 -= alongX ? gap : 0;
        raise(ctx, lot, Y, h, style, r.range(0, 100), ruin ? -1 : st.lit * (0.7 + b.core * 0.6), st.roofs && h < 18, r, ruin);
        s = e;
      }
    }
  }

  /** Detached houses on their plots: suburbs, villages, the edges of towns. */
  private houses(ctx: WorldContext, plan: TownPlan, b: TownBlock, r: Rng, out: TownOut, ruin: boolean) {
    const st = plan.style;
    const Y = b.y + 0.15;
    const plot = 20;
    const houseStyles: [FacadeStyle, number][] = st.id === 'desert' ? [['adobe', 5], ['stucco', 2]] : st.id === 'frozen' ? [['timber', 3], ['panel', 1], ['siding', 2]] : st.id === 'mountain' ? [['timber', 4], ['stone', 2]] : st.id === 'coastal' ? [['stucco', 4], ['siding', 2]] : st.id === 'historic' ? [['stone', 3], ['brick', 2], ['stucco', 1]] : [['siding', 4], ['brick', 2], ['stucco', 1]];
    const grass = new THREE.Color(0x1d2a14);
    ctx.batch.add(ctx.mats.vertex, G.box, M((b.x0 + b.x1) / 2, Y - 0.06, (b.z0 + b.z1) / 2, b.x1 - b.x0, 0.08, b.z1 - b.z0), { color: grass, cast: false });
    for (let x = b.x0 + plot / 2; x < b.x1 - plot / 2 + 1; x += plot) {
      for (const side of [0, 1]) {
        if (r.chance(ruin ? 0.35 : 0.12)) continue;
        const z = side ? b.z1 - 9 : b.z0 + 9;
        const hw = r.range(4, 6.5), hd = r.range(4, 6);
        const lot = { x0: x - hw, z0: z - hd, x1: x + hw, z1: z + hd };
        const h = ruin ? r.range(2.5, 4) : r.chance(0.5) ? 3.4 : 6.6;
        raise(ctx, lot, Y, h, weighted(r, houseStyles), r.range(0, 100), ruin ? -1 : 0.4, !ruin, r, ruin);
        // a driveway and a car
        if (!ruin && r.chance(0.45)) out.cars.push({ x: x + hw + 2.2, y: Y, z: side ? b.z1 - 3 : b.z0 + 3, yaw: side ? 0 : Math.PI });
        out.plants.push({ s: st.streetTrees === 'palm' ? 'palm' : st.streetTrees === 'pine' ? 'spruce' : r.chance(0.5) ? 'oak' : 'bush', x: x + r.range(-8, 8), y: Y, z: (b.z0 + b.z1) / 2 + r.range(-3, 3), yaw: r.range(0, 6), scale: r.range(0.6, 1) });
        // a porch light
        if (!ruin) out.lamps.push(ctx.lamp(new THREE.Vector3(x, Y + 2.4, side ? lot.z1 + 0.3 : lot.z0 - 0.3), 'warm', { pooled: false, intensity: 10, range: 8, ground: Y, cone: false, halo: 0.45, streak: 0.3 }));
      }
    }
  }

  private militaryYard(ctx: WorldContext, b: TownBlock, r: Rng, out: TownOut) {
    const Y = b.y + 0.15;
    const mats = ctx.mats;
    ctx.batch.add(mats.yard, G.box, M((b.x0 + b.x1) / 2, Y - 0.06, (b.z0 + b.z1) / 2, b.x1 - b.x0, 0.08, b.z1 - b.z0), { cast: false });
    // chain-link fence with a gap for the gate
    const fenceSide = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az);
      ctx.batch.add(mats.iron, G.box, M((ax + bx) / 2, Y, (az + bz) / 2, Math.abs(bx - ax) + 0.05, 2.8, Math.abs(bz - az) + 0.05), { cast: false });
      if (len > 0) ctx.collision.add(Math.min(ax, bx) - 0.05, Y, Math.min(az, bz) - 0.05, Math.max(ax, bx) + 0.05, Y + 3, Math.max(az, bz) + 0.05, false);
    };
    const mx = (b.x0 + b.x1) / 2;
    fenceSide(b.x0, b.z0, mx - 5, b.z0);
    fenceSide(mx + 5, b.z0, b.x1, b.z0);
    fenceSide(b.x0, b.z1, b.x1, b.z1);
    fenceSide(b.x0, b.z0, b.x0, b.z1);
    fenceSide(b.x1, b.z0, b.x1, b.z1);
    // a hangar, barracks, a tower
    const hw = (b.x1 - b.x0) * 0.35;
    raise(ctx, { x0: b.x0 + 6, z0: b.z0 + 10, x1: b.x0 + 6 + hw, z1: b.z0 + 10 + 24 }, Y, 11, 'metal', r.range(0, 100), -1, false, r, false);
    raise(ctx, { x0: b.x1 - 30, z0: b.z1 - 16, x1: b.x1 - 6, z1: b.z1 - 6 }, Y, 4, 'concrete', r.range(0, 100), 0.5, false, r, false);
    const tx = b.x1 - 8, tz = b.z0 + 8;
    for (const [ox, oz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) ctx.batch.add(mats.iron, G.box, M(tx + ox, Y, tz + oz, 0.2, 9, 0.2));
    ctx.batch.add(mats.wood, G.box, M(tx, Y + 9, tz, 3.4, 2.4, 3.4));
    const l = ctx.lamp(new THREE.Vector3(tx, Y + 11.6, tz), 'cold', { intensity: 70, range: 36, ground: Y, cone: true, streak: 0.4 });
    out.lamps.push(l);
    ctx.collision.addCentered(tx, Y, tz, 3, 12, 3, true);
    for (let i = 0; i < 3; i++) out.cars.push({ x: b.x0 + 12 + i * 5, y: Y, z: b.z1 - 24, yaw: 0 });
  }
}

/** A building on a lot at ground height Y: facade, cornice, a pitched roof or roof clutter. */
export function raise(ctx: WorldContext, lot: { x0: number; z0: number; x1: number; z1: number }, Y: number, h: number, style: FacadeStyle, seed: number, lit: number, roof: boolean, r: Rng, ruin: boolean) {
  const idx = STYLE_INDEX[style];
  // corrugated metal is for sheds and warehouses, not towers
  if (style === 'metal') h = Math.min(h, 15);
  const top = Y + h;
  const add = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, l: number, collide = true, cast = true) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), new THREE.Quaternion(), new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0));
    const floorH = style === 'glass' ? 3.8 : style === 'metal' ? 5 : style === 'stone' ? 4.1 : style === 'panel' ? 2.9 : 3.3;
    const winW = style === 'glass' ? 1.7 : style === 'adobe' ? 3.2 : style === 'concrete' || style === 'panel' ? 3.2 : 2.5;
    ctx.batch.add(ctx.mats.facade, G.box, m.multiply(new THREE.Matrix4().makeTranslation(0, -0.5, 0)), { cast, attrs: { aBld: [seed, floorH, winW, l], aTop: [top, idx, Y] } });
    if (collide) ctx.collision.add(x0, y0, z0, x1, y1, z1, true);
  };
  add(lot.x0, Y, lot.z0, lot.x1, top, lot.z1, lit);
  const w = lot.x1 - lot.x0, d = lot.z1 - lot.z0;
  if (ruin) {
    // broken walls: a jagged second storey on part of it
    if (r.chance(0.5)) add(lot.x0, top, lot.z0, lot.x0 + w * r.range(0.2, 0.5), top + r.range(1, 3), lot.z0 + 0.4, -1, false);
    return;
  }
  if (roof && Math.min(w, d) < 24) {
    const alongX = w >= d;
    const rh = Math.min(w, d) * 0.38;
    const col = style === 'adobe' ? 0x5a3422 : style === 'stucco' ? 0x7a3a24 : style === 'timber' ? 0x2a2622 : style === 'siding' ? 0x33302e : 0x2c2e32;
    const m = alongX ? M((lot.x0 + lot.x1) / 2, top, (lot.z0 + lot.z1) / 2, w + 0.6, rh, d + 0.8) : M((lot.x0 + lot.x1) / 2, top, (lot.z0 + lot.z1) / 2, d + 0.6, rh, w + 0.8, Math.PI / 2);
    ctx.batch.add(ROOF_MAT, ROOF_GEO, m, { color: col });
    // a chimney
    if (r.chance(0.5)) ctx.batch.add(ctx.mats.darkStone, G.box, M(lot.x0 + w * 0.25, top, lot.z0 + d * 0.3, 0.7, rh + 0.8, 0.7));
    return;
  }
  // cornice and roof clutter on flat roofs
  if (style !== 'glass' && style !== 'metal') add(lot.x0 - 0.3, top - 0.2, lot.z0 - 0.3, lot.x1 + 0.3, top + 0.5, lot.z1 + 0.3, -1, false, false);
  const n = r.int(0, 3);
  for (let i = 0; i < n; i++) ctx.batch.add(ctx.mats.concrete, G.box, M(r.range(lot.x0 + 2, lot.x1 - 2), top + 0.4, r.range(lot.z0 + 2, lot.z1 - 2), r.range(1.4, 3.6), r.range(1, 2.2), r.range(1.4, 3.2)));
  if (h > 60 && r.chance(0.5)) {
    const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
    ctx.batch.add(ctx.mats.iron, G.box, M(cx, top, cz, 0.18, 6, 0.18));
    const l = ctx.lamp(new THREE.Vector3(cx, top + 6.1, cz), 'red', { pooled: false, cone: false, streak: 0, halo: 1.1, ground: Y });
    l.flicker = 2;
  }
}

/** The things you navigate a city by. */
function landmark(ctx: WorldContext, b: TownBlock, kind: LandmarkKind, r: Rng, out: TownOut) {
  const Y = b.y + 0.15;
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const w = b.x1 - b.x0, d = b.z1 - b.z0;
  const m = ctx.mats;
  const lampRed = (x: number, y: number, z: number) => {
    const l = ctx.lamp(new THREE.Vector3(x, y, z), 'red', { pooled: false, cone: false, streak: 0, halo: 1.4, ground: Y });
    l.flicker = 2;
    out.lamps.push(l);
  };
  const plaza = () => ctx.batch.add(m.paving, G.box, M(cx, Y - 0.05, cz, w, 0.08, d), { cast: false });
  switch (kind) {
    case 'tower': {
      const hw = Math.min(w, d) * 0.32;
      raise(ctx, { x0: cx - hw, z0: cz - hw, x1: cx + hw, z1: cz + hw }, Y, 190 + r.range(0, 60), 'glass', r.range(0, 100), 0.5, false, r, false);
      const top = Y + 250;
      ctx.batch.add(m.metal, G.taper, M(cx, top - 60, cz, 1.2, 70, 1.2));
      lampRed(cx, top + 10, cz);
      break;
    }
    case 'twinTowers': {
      const hw = Math.min(w, d) * 0.18;
      for (const s of [-1, 1]) {
        const x = cx + s * hw * 1.5;
        raise(ctx, { x0: x - hw, z0: cz - hw, x1: x + hw, z1: cz + hw }, Y, 230, 'glass', r.range(0, 100), 0.55, false, r, false);
        lampRed(x, Y + 236, cz);
      }
      // a skybridge
      ctx.batch.add(m.darkGlass, G.box, M(cx, Y + 150, cz, hw * 1.2, 5, 6));
      break;
    }
    case 'cathedral': {
      plaza();
      raise(ctx, { x0: cx - 12, z0: cz - 26, x1: cx + 12, z1: cz + 22 }, Y, 26, 'stone', r.range(0, 100), 0.15, true, r, false);
      raise(ctx, { x0: cx - 6, z0: cz + 22, x1: cx + 6, z1: cz + 32 }, Y, 48, 'stone', r.range(0, 100), 0.1, false, r, false);
      ctx.batch.add(m.darkStone, G.taper, M(cx, Y + 48, cz + 27, 5.2, 34, 5.2));
      ctx.batch.add(m.metal, G.cyl, M(cx, Y + 82, cz + 27, 0.12, 4, 0.12));
      out.lamps.push(ctx.lamp(new THREE.Vector3(cx, Y + 3, cz + 33), 'amber', { intensity: 30, range: 18, ground: Y, cone: false }));
      break;
    }
    case 'clockTower': {
      plaza();
      raise(ctx, { x0: cx - 5, z0: cz - 5, x1: cx + 5, z1: cz + 5 }, Y, 44, 'stone', r.range(0, 100), -1, false, r, false);
      for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        ctx.batch.add(m.lampWarm, G.cyl, M(cx + nx * 5.05, Y + 38, cz + nz * 5.05, 2.4, 0.1, 2.4, 0, Math.PI / 2 * Math.abs(nz), Math.PI / 2 * Math.abs(nx)), { cast: false });
      }
      ctx.batch.add(m.darkStone, G.taper, M(cx, Y + 44, cz, 6, 12, 6));
      break;
    }
    case 'smokestacks': {
      for (let i = 0; i < 3; i++) {
        const x = cx - 14 + i * 14;
        ctx.batch.add(m.stone, G.taper, M(x, Y, cz, 3.2, 70 + i * 8, 3.2), { color: 0x6a3a2c });
        ctx.collision.addCentered(x, Y, cz, 6, 70, 6, true);
        lampRed(x, Y + 72 + i * 8, cz);
      }
      raise(ctx, { x0: b.x0 + 2, z0: cz + 6, x1: b.x1 - 2, z1: b.z1 - 2 }, Y, 18, 'brick', r.range(0, 100), 0.15, false, r, false);
      break;
    }
    case 'waterTower': {
      plaza();
      for (const [ox, oz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) ctx.batch.add(m.iron, G.box, M(cx + ox, Y, cz + oz, 0.4, 26, 0.4));
      ctx.batch.add(m.metal, G.cyl, M(cx, Y + 26, cz, 6, 9, 6), { color: 0x8a8a84 });
      ctx.batch.add(m.metal, G.taper, M(cx, Y + 35, cz, 6.2, 3, 6.2));
      ctx.collision.addCentered(cx, Y, cz, 7, 26, 7, false);
      lampRed(cx, Y + 38.5, cz);
      break;
    }
    case 'cranes': {
      for (let i = 0; i < 2; i++) {
        const x = cx - 14 + i * 28;
        for (const [ox, oz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) ctx.batch.add(m.paint, G.box, M(x + ox, Y, cz + oz, 0.9, 44, 0.9), { color: 0xa84a1c });
        ctx.batch.add(m.paint, G.box, M(x, Y + 44, cz, 12, 3, 60), { color: 0xa84a1c });
        ctx.collision.addCentered(x, Y, cz, 12, 44, 12, false);
        lampRed(x, Y + 48, cz + 29);
      }
      for (let i = 0; i < 6; i++) ctx.batch.add(m.paint, G.box, M(b.x0 + 6 + (i % 3) * 7, Y, b.z0 + 6 + Math.floor(i / 3) * 3, 6, 2.6, 2.5), { color: r.pick([0x8a2a1c, 0x1c4a6a, 0x3a5a2a, 0x7a6a2a]) });
      break;
    }
    case 'lighthouse': {
      ctx.batch.add(m.paint, G.taper, M(cx, Y, cz, 4, 34, 4), { color: 0xd8d4c8 });
      ctx.batch.add(m.paint, G.cyl, M(cx, Y + 12, cz, 3.3, 3, 3.3), { color: 0xa82a1c });
      ctx.batch.add(m.lampWarm, G.cyl, M(cx, Y + 34, cz, 1.6, 2.4, 1.6));
      ctx.collision.addCentered(cx, Y, cz, 6, 34, 6, true);
      out.lamps.push(ctx.lamp(new THREE.Vector3(cx, Y + 35, cz), 'warm', { pooled: false, cone: false, halo: 3.2, streak: 2, ground: Y }));
      break;
    }
    case 'radioMast':
    case 'dam': {
      plaza();
      for (let k = 0; k < 12; k++) ctx.batch.add(m.paint, G.box, M(cx, Y + k * 12, cz, 2.2 - k * 0.12, 12, 2.2 - k * 0.12), { color: k % 2 ? 0xc8c4bc : 0xb03a26 });
      ctx.collision.addCentered(cx, Y, cz, 2.4, 140, 2.4, true);
      for (const k of [4, 8, 12]) lampRed(cx, Y + k * 12, cz);
      break;
    }
    case 'coolingTowers': {
      for (let i = 0; i < 2; i++) {
        const x = cx - 16 + i * 32;
        const g = new THREE.CylinderGeometry(11, 16, 1, 18, 6, true).translate(0, 0.5, 0);
        const p = g.attributes.position;
        for (let v = 0; v < p.count; v++) {
          const y = p.getY(v);
          const k = 1 - 0.28 * Math.sin(y * Math.PI);
          p.setX(v, p.getX(v) * k);
          p.setZ(v, p.getZ(v) * k);
        }
        g.computeVertexNormals();
        ctx.batch.add(m.concrete, g, M(x, Y, cz, 1, 56, 1));
        ctx.collision.addCentered(x, Y, cz, 24, 56, 24, true);
      }
      break;
    }
    case 'stadium': {
      const g = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true).translate(0, 0.5, 0);
      ctx.batch.add(m.concrete, g, M(cx, Y, cz, w * 0.45, 20, d * 0.45));
      ctx.batch.add(m.concrete, new THREE.CylinderGeometry(1, 1, 1, 28, 1, true).translate(0, 0.5, 0), M(cx, Y + 20, cz, w * 0.48, 4, d * 0.48));
      ctx.batch.add(m.vertex, G.box, M(cx, Y, cz, w * 0.6, 0.1, d * 0.5), { color: 0x1c3a14, cast: false });
      ctx.collision.addCentered(cx, Y, cz, w * 0.9, 20, d * 0.9, true);
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const x = cx + ox * w * 0.42, z = cz + oz * d * 0.42;
        ctx.batch.add(m.iron, G.box, M(x, Y, z, 0.6, 34, 0.6));
        ctx.batch.add(m.lampCold, G.box, M(x, Y + 34, z, 4, 2, 0.4), { cast: false });
        out.lamps.push(ctx.lamp(new THREE.Vector3(x, Y + 34, z), 'cold', { intensity: 90, range: 60, ground: Y, cone: false, halo: 2.2 }));
      }
      break;
    }
    case 'ferrisWheel':
    case 'pier': {
      plaza();
      const R = 20;
      const g = new THREE.TorusGeometry(R, 0.4, 6, 40);
      ctx.batch.add(m.paint, g, M(cx, Y + R + 3, cz), { color: 0xd8d4cc });
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        ctx.batch.add(m.paint, G.box, M(cx, Y + R + 3, cz, 0.16, R, 0.16, 0, 0, a), { color: 0xd8d4cc });
        const lx = cx + Math.sin(a) * R, ly = Y + R + 3 + Math.cos(a) * R;
        ctx.batch.add(m.paint, G.box, M(lx, ly - 1.5, cz, 1.6, 1.6, 1.6), { color: r.pick([0xb83a2c, 0x2c6ab8, 0xd8b02c]) });
      }
      for (const s of [-1, 1]) ctx.batch.add(m.iron, G.box, M(cx, Y, cz + s * 1.2, 0.5, R + 3, 0.5, 0, 0, s * 0.3));
      out.lamps.push(ctx.lamp(new THREE.Vector3(cx, Y + R + 3, cz), 'warm', { pooled: false, cone: false, halo: 4, streak: 1.4, ground: Y }));
      break;
    }
    case 'domes':
    case 'observatory': {
      plaza();
      raise(ctx, { x0: cx - 14, z0: cz - 14, x1: cx + 14, z1: cz + 14 }, Y, 12, 'adobe', r.range(0, 100), 0.2, false, r, false);
      ctx.batch.add(m.paint, new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), M(cx, Y + 12, cz, 12, 10, 12), { color: kind === 'observatory' ? 0xd8d8d4 : 0x2c6a8a });
      ctx.batch.add(m.stone, G.cyl, M(cx + 16, Y, cz + 16, 2, 30, 2));
      break;
    }
    case 'mall': {
      raise(ctx, { x0: b.x0 + 4, z0: b.z0 + 4, x1: b.x1 - 4, z1: cz + 6 }, Y, 14, 'concrete', r.range(0, 100), 0.45, false, r, false);
      ctx.batch.add(m.asphalt, G.box, M(cx, Y - 0.06, (cz + 6 + b.z1) / 2, w, 0.08, b.z1 - cz - 6), { cast: false });
      for (let x = b.x0 + 6; x < b.x1 - 6; x += 7) if (r.chance(0.5)) out.cars.push({ x, y: Y, z: b.z1 - 8, yaw: 0 });
      out.lamps.push(ctx.lamp(new THREE.Vector3(cx, Y + 15, b.z1 - 12), 'cold', { intensity: 60, range: 40, ground: Y }));
      break;
    }
    case 'statue':
    default: {
      plaza();
      ctx.batch.add(m.stone, G.box, M(cx, Y, cz, 4, 4, 4));
      ctx.batch.add(m.metal, G.cyl, M(cx, Y + 4, cz, 0.6, 3.4, 0.6), { color: 0x3a5a4a });
      ctx.batch.add(m.metal, G.sphere, M(cx, Y + 7.8, cz, 0.45, 0.5, 0.45), { color: 0x3a5a4a });
      ctx.collision.addCentered(cx, Y, cz, 4, 4, 4, true);
      out.lamps.push(ctx.lamp(new THREE.Vector3(cx + 3, Y + 0.4, cz), 'warm', { pooled: true, intensity: 18, range: 12, ground: Y, cone: false, halo: 0.4 }));
    }
  }
  out.spots.push({ x: b.x0 - 1.2, y: Y, z: cz, yaw: -Math.PI / 2 });
}

function weighted<T>(r: Rng, opts: [T, number][]): T {
  let sum = 0;
  for (const [, w] of opts) sum += w;
  let k = r.next() * sum;
  for (const [v, w] of opts) if ((k -= w) <= 0) return v;
  return opts[0][0];
}

function lerpN(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function inReserved(gen: WorldGen, x0: number, z0: number, x1: number, z1: number) {
  return gen.reserved.some((rv) => x1 > rv.x0 && x0 < rv.x1 && z1 > rv.z0 && z0 < rv.z1);
}

const NAMES: Record<PoiKind, string[]> = {
  diner: ['{t} Diner', 'Night Owl Diner', 'The Blue Plate', 'Moonlight Grill', 'Rosie’s', 'The Lamplight Café'],
  bar: ['The Anchor', 'Last Call', 'The Drowned Man', 'Hollow Bell', 'The Low Tide', 'Crow & Crown', 'Nine Lives'],
  store: ['{t} General Store', 'Corner Market', 'Kwik Stop', 'Night & Day', 'Harlan’s Supply'],
  gas: ['{t} Fuel', 'Last Chance Gas', 'Sunrise Petroleum', 'Route Stop'],
  garage: ['{t} Motors', 'Iron Works Garage', 'Kowalski Auto', 'Twin Pistons'],
  clinic: ['{t} Clinic', 'St. Agnes Medical', 'Mercy Clinic'],
  hotel: ['The Grand {t}', 'Hotel Meridian', 'The Carlyle', 'Hotel Esperanza'],
  police: ['{t} Police', '{t} Sheriff'],
  gunsmith: ['Ridgeline Arms', '{t} Sporting Goods', 'Hawk & Barrel'],
  pawn: ['Honest Abe’s Pawn', 'Second Chance Pawn', '{t} Exchange'],
  arcade: ['Pixel Palace', 'Starlight Arcade', 'Level 9'],
  club: ['Velvet', 'The Undertow', 'Neon Saint', 'Basement'],
  gym: ['Iron Temple', '{t} Boxing Club', 'Southpaw Gym'],
  church: ['St. Brendan’s', 'First Church of {t}', 'Our Lady of the Sea'],
  bank: ['{t} Savings & Loan', 'Meridian Trust'],
  dock: ['{t} Marina', 'Pier 3 Boat Hire'],
  market: ['{t} Market Hall', 'The Night Market'],
  office: ['Halvorsen Logistics', 'Castellan Holdings', 'Orrery Systems'],
  station: ['{t} Station', '{t} Central'],
  motel: ['Starlite Motel', 'The Pines Motor Inn', 'Desert Rose Motel'],
  workshop: ['{t} Workshop', 'Tinker & Sons', 'The Salvage Yard'],
};

function poiName(kind: PoiKind, r: Rng, town: string) {
  return r.pick(NAMES[kind]).replace('{t}', town.replace(/^(North|Upper|Old|Saint) /, ''));
}

export { SEA_Y };
