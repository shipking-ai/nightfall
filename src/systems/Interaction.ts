import * as THREE from 'three';
import { INTERACTIONS, type InteractionDef } from '../data/interactions';
import type { InteractSpot } from '../world/WorldContext';

/**
 * Finds the one thing worth pointing at. Nearest spot in range, roughly in
 * front of the camera, within a sensible height band.
 */
export class Interaction {
  current: { spot: InteractSpot; def: InteractionDef } | null = null;
  private seen = new Set<string>();

  constructor(private spots: InteractSpot[]) {}

  update(player: THREE.Vector3, camForward: THREE.Vector3, disabled: boolean) {
    this.current = null;
    if (disabled) return;
    let best = Infinity;
    const fx = camForward.x, fz = camForward.z;
    const fl = Math.hypot(fx, fz) || 1;
    for (const s of this.spots) {
      const dx = s.pos.x - player.x, dz = s.pos.z - player.z;
      const d = Math.hypot(dx, dz);
      if (d > s.radius || Math.abs(s.pos.y - player.y) > 1.4) continue;
      const facing = d < 0.9 ? 1 : (dx * fx + dz * fz) / (d * fl);
      if (facing < 0.25) continue;
      const score = d - facing * 0.6;
      if (score < best) {
        const def = INTERACTIONS[s.id];
        if (!def) continue;
        best = score;
        this.current = { spot: s, def };
      }
    }
  }

  /** Lines to show for this interaction; repeat visits may say less. */
  linesFor(id: string, def: InteractionDef, override?: string[]): string[] {
    if (override) return override;
    const again = this.seen.has(id) && def.again;
    this.seen.add(id);
    return again ? def.again! : def.lines;
  }
}
