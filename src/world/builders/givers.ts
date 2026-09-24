import * as THREE from 'three';
import type { WorldContext } from '../WorldContext';

/**
 * The people side quests end (or begin) with (data/quests.ts). They stand
 * where they always stand; the quest decides whether they have anything to say.
 */
export function buildGivers(ctx: WorldContext) {
  const giver = (id: string, x: number, y: number, z: number, yaw: number, mode: 'wait' | 'smoke') => {
    ctx.npcSpots.push({ pos: new THREE.Vector3(x, y, z), yaw, mode });
    // the spot sits a step in front of them
    ctx.point(`giver:${id}`, new THREE.Vector3(x + Math.sin(yaw) * 0.7, y, z + Math.cos(yaw) * 0.7), 2.0);
  };
  // platform 2, looking at the track where no train is due
  giver('platform', -6, 0.9, -178.2, Math.PI, 'wait');
  // under the departures board, on a break that has lasted a while
  giver('signalman', 7, 0.15, -157.2, 0, 'smoke');
  // outside the Hotel Meridian, in the rain, waiting for a car
  giver('fare', 12.7, 0.15, -12, -Math.PI / 2, 'wait');
}
