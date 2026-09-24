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
import { buildInteriors } from './builders/interiors';
import { buildGivers } from './builders/givers';

/**
 * Builds District 03. Each district builder is independent and writes into
 * the shared WorldContext; static geometry is merged once at the end.
 * `onProgress` lets the intermission screen breathe between steps.
 */
export async function buildCity(onProgress: (k: number) => void): Promise<WorldContext> {
  const mats = createMaterials();
  const ctx = new WorldContext(mats);
  ctx.batch.declare(mats.facade, [
    ['aBld', 4],
    ['aTop', 2],
  ]);

  const steps: [number, () => void][] = [
    [0.1, () => buildGround(ctx)],
    [0.15, () => buildBounds(ctx)],
    [0.35, () => buildBlocks(ctx)],
    [0.45, () => buildOutskirts(ctx)],
    [0.55, () => buildAvenue(ctx)],
    [0.62, () => buildStation(ctx)],
    [0.7, () => buildMarket(ctx)],
    [0.76, () => buildRiverside(ctx)],
    [0.82, () => buildYard(ctx)],
    [0.88, () => buildQuarter(ctx)],
    [0.92, () => buildInteriors(ctx)],
    [0.93, () => buildGivers(ctx)],
    [0.95, () => ctx.batch.build(ctx.root)],
  ];
  for (const [k, fn] of steps) {
    fn();
    onProgress(k);
    await frame();
  }
  ctx.root.updateMatrixWorld(true);
  return ctx;
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
