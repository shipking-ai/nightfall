import * as THREE from 'three';
import { createMaterials } from './materials';
import { WorldContext } from './WorldContext';
import { buildGround, buildBounds } from './builders/ground';
import { buildBlocks, buildOutskirts } from './builders/buildings';
import { buildAvenue } from './builders/avenue';
import { buildStation } from './builders/station';
import { buildMarket } from './builders/market';
import { buildRiverside } from './builders/riverside';
import { buildYard } from './builders/yard';
import { buildQuarter } from './builders/quarter';
import { buildInteriors, buildAllInteriors } from './builders/interiors';
import { buildGivers } from './builders/givers';
import { buildBank } from './builders/bank';
import { mulberry32 } from './rng';
import { ROADS } from './layout';

/**
 * Builds District 03. Each district builder is independent and writes into
 * the shared WorldContext; static geometry is merged once at the end.
 * `onProgress` lets the intermission screen breathe between steps.
 */
export async function buildCity(onProgress: (k: number) => void): Promise<WorldContext> {
  const mats = createMaterials();
  const ctx = new WorldContext(mats);
  // every lot buildBlocks raises, so each one can be given an interior
  let lots: Map<string, { rect: { x0: number; z0: number; x1: number; z1: number }; h: number; style: string }[]> = new Map();
  ctx.batch.declare(mats.facade, [
    ['aBld', 4],
    ['aTop', 2],
  ]);

  const steps: [number, () => void][] = [
    [0.1, () => buildGround(ctx)],
    [0.15, () => buildBounds(ctx)],
    // buildBlocks hands back every lot it raised; we need that list, because a
    // door in each street face is what makes the buildings enterable
    [0.35, () => (lots = buildBlocks(ctx))],
    [0.45, () => buildOutskirts(ctx)],
    [0.55, () => buildAvenue(ctx)],
    // the bank is a real building with a doorway, in the lot AE1 leaves open
    [0.58, () => buildBank(ctx, mulberry32(0x8a17))],
    [0.62, () => buildStation(ctx)],
    [0.7, () => buildMarket(ctx)],
    [0.76, () => buildRiverside(ctx)],
    [0.82, () => buildYard(ctx)],
    [0.88, () => buildQuarter(ctx)],
    [0.92, () => buildInteriors(ctx)],
    // and then one interior for every building in the city, laid out from its
    // own footprint. This is what turns the blocks from shells into places.
    [0.94, () => buildAllInteriors(ctx, lots)],
    [0.945, () => buildGivers(ctx)],
    [0.95, () => ctx.batch.build(ctx.root)],
  ];
  for (const [k, fn] of steps) {
    fn();
    onProgress(k);
    await frame();
  }
  ctx.root.updateMatrixWorld(true);
  if (import.meta.env.DEV) reportRoadIntrusions(ctx);
  return ctx;
}

/**
 * Dev check: a building standing in the carriageway is a bug, and it is much
 * easier to find by measuring it than by looking for it. Anything whose
 * footprint crosses a road's rectangle by more than the pavement allowance is
 * named on the console.
 */
function reportRoadIntrusions(ctx: WorldContext) {
  const hits: string[] = [];
  for (const b of ctx.collision.boxes) {
    // only things tall enough to read as a building, and not flat paving
    if (b.maxY - b.minY < 3) continue;
    for (const road of ROADS) {
      const ox = Math.min(b.maxX, road.rect.x1) - Math.max(b.minX, road.rect.x0);
      const oz = Math.min(b.maxZ, road.rect.z1) - Math.max(b.minZ, road.rect.z0);
      if (ox > 0.5 && oz > 0.5) {
        hits.push(`${road.name}: box ${b.minX.toFixed(1)},${b.minZ.toFixed(1)} → ${b.maxX.toFixed(1)},${b.maxZ.toFixed(1)} overlaps ${ox.toFixed(1)}×${oz.toFixed(1)} m`);
        break;
      }
    }
  }
  if (hits.length) console.warn(`[city] ${hits.length} building(s) standing in a road:\n  ` + hits.join('\n  '));
  else console.log('[city] no buildings intrude on any road');
}

/** Yield so the intermission can paint; never stalls in a background tab. */
const frame = () =>
  new Promise<void>((r) => {
    const done = () => r();
    requestAnimationFrame(done);
    setTimeout(done, 40);
  });

export type { WorldContext };
export { THREE };
