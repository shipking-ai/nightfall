import type { Quality } from '../core/Settings';
import { tierAt, tierIndex } from './Capability';

/**
 * Keeps the frame rate where it should be by moving between quality tiers.
 *
 * The rule that matters here is that it must never oscillate. A tier change
 * reallocates rain buffers, shadow maps and post passes, which costs a visible
 * hitch, so stepping down and straight back up would be far worse than sitting
 * one tier too low. Hence: step down quickly (the player is already suffering),
 * step up slowly and only when there is real headroom, and require a long
 * settled period at the new tier before considering it again at all.
 */

export interface GovernorTuning {
  /** never go above this, whatever the measurement says */
  ceiling: Quality;
  /** never go below this */
  floor: Quality;
  /** frame rate we're aiming for */
  targetFps: number;
  /** below this, we are genuinely struggling and should step down at once */
  floorFps: number;
}

export const TUNING: GovernorTuning = {
  ceiling: 'cinematic',
  floor: 'low',
  targetFps: 58,
  // 58 on a 60Hz panel is the usual target; the extra headroom is deliberate so
  // a dip below doesn't read as stutter. Anything under 45 is visible.
  floorFps: 45,
};

export class Governor {
  /** what we're currently running at */
  tier: Quality;
  /** the smoothed frame rate the player is actually getting */
  fps = 60;
  /** has it moved on its own? the settings screen says so */
  moved = false;
  /** set when the tier changes, cleared by whoever applies it */
  pending: Quality | null = null;

  private sinceChange = 0;
  private lowFor = 0;
  private highFor = 0;

  constructor(start: Quality, private tuning: GovernorTuning = TUNING) {
    this.tier = start;
  }

  /** True while the governor is allowed to move at all. */
  get enabled() {
    return this.tuning.ceiling !== this.tuning.floor;
  }

  /**
   * Feed it a frame time (seconds). Returns true when the tier changed.
   */
  step(dt: number): boolean {
    const fps = 1 / Math.max(1e-3, dt);
    // heavy smoothing: a single hitchy frame must not move anything
    this.fps += (fps - this.fps) * 0.06;

    this.sinceChange += dt;
    // ignore the first moment after a change, while the new buffers fill
    if (this.sinceChange < 1.5) return false;

    const i = tierIndex(this.tier);
    const atCeiling = i >= tierIndex(this.tuning.ceiling);
    const atFloor = i <= tierIndex(this.tuning.floor);

    if (this.fps < this.tuning.floorFps) {
      this.lowFor += dt;
      this.highFor = 0;
    } else if (this.fps > this.tuning.targetFps + 6) {
      this.highFor += dt;
      this.lowFor = 0;
    } else {
      // comfortably in the band, or just under target: hold still
      this.lowFor = Math.max(0, this.lowFor - dt * 0.5);
      this.highFor = 0;
    }

    // down after 1.2s of being under the floor, unless we're already at the bottom
    if (this.lowFor > 1.2 && !atFloor) return this.set(tierAt(i - 1), true);
    // up only after 8s of real headroom, and never in the first half minute
    if (this.highFor > 8 && !atCeiling && this.sinceChange > 30) return this.set(tierAt(i + 1), false);

    return false;
  }

  private set(next: Quality, down: boolean): boolean {
    if (next === this.tier) return false;
    this.tier = next;
    this.pending = next;
    this.moved = true;
    this.sinceChange = 0;
    this.lowFor = 0;
    this.highFor = 0;
    // a step down is the urgent one; a step up should not come straight back
    this.tuning = { ...this.tuning, floorFps: down ? 45 : this.tuning.floorFps };
    return true;
  }
}