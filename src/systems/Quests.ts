import * as THREE from 'three';
import type { SaveState } from '../core/SaveState';
import { QUESTS, type Quest, type Step } from '../data/quests';

export type QuestEvent =
  | { type: 'start'; quest: Quest; lines: string[] }
  | { type: 'step'; quest: Quest; lines: string[] }
  | { type: 'done'; quest: Quest; lines: string[] }
  | { type: 'fail'; quest: Quest; lines: string[] };

/** What the world looks like to a quest this frame. */
export interface QuestWorld {
  pos: THREE.Vector3;
  driving: boolean;
  inside: string | null;
  stairLoops: number;
}

/**
 * Runs the side quests in data/quests.ts. Progress is kept as save flags, so
 * it only ever moves forward; a timed step's clock is not saved — after a
 * reload (or running out) you go back to its restart spot to try again.
 */
export class Quests {
  onEvent: ((e: QuestEvent) => void) | null = null;
  /** seconds left on the tracked quest's timed step, while it runs */
  timer: { quest: string; left: number } | null = null;
  /** a fail happened: the step waits at its restart spot */
  private waiting = new Set<string>();
  /** the quest the tracker shows (the last one touched) */
  private tracked: string | null = null;

  constructor(private save: SaveState, private spots: Map<string, THREE.Vector3>) {
    // a timed step can't survive a reload: it waits to be restarted
    for (const q of QUESTS) if (this.started(q) && !this.done(q) && this.step(q)?.limit) this.waiting.add(q.id);
    this.tracked = [...QUESTS].reverse().find((q) => this.started(q) && !this.done(q))?.id ?? null;
  }

  started(q: Quest) {
    return this.save.hasFlag(`q:${q.id}`);
  }

  done(q: Quest) {
    return this.save.hasFlag(`q:${q.id}:done`);
  }

  /** How many steps are done. */
  progress(q: Quest) {
    let n = 0;
    while (n < q.steps.length && this.save.hasFlag(`q:${q.id}:${n}`)) n++;
    return n;
  }

  step(q: Quest): Step | null {
    return this.done(q) ? null : q.steps[this.progress(q)] ?? null;
  }

  get active(): Quest[] {
    return QUESTS.filter((q) => this.started(q) && !this.done(q));
  }

  get finished(): number {
    return QUESTS.filter((q) => this.done(q)).length;
  }

  /** The one on screen: what it is, what to do next, how long is left, and where. */
  get current(): { quest: Quest; text: string; left: number | null; target: THREE.Vector3 | null } | null {
    const q = QUESTS.find((x) => x.id === this.tracked && this.started(x) && !this.done(x)) ?? this.active[0];
    if (!q) return null;
    const s = this.step(q);
    if (!s) return null;
    const wait = this.waiting.has(q.id) && s.restart;
    const text = wait ? s.restart!.text : s.text;
    const left = this.timer?.quest === q.id ? this.timer.left : null;
    return { quest: q, text, left, target: this.targetOf(q, s, !!wait) };
  }

  private targetOf(q: Quest, s: Step, waiting: boolean): THREE.Vector3 | null {
    if (waiting && s.restart) return this.spots.get(s.restart.spot) ?? null;
    const g = s.goal;
    if (g.kind === 'use') return this.spots.get(g.spot) ?? null;
    if (g.kind === 'reach' || g.kind === 'drive') return new THREE.Vector3(g.x, 0.15, g.z);
    if (g.kind === 'climb') return this.spots.get('enter:stairwell') ?? null;
    void q;
    return null;
  }

  /**
   * You pressed E at `spot`. Returns the lines to show instead of the spot's own,
   * or null to let the spot speak for itself.
   */
  use(spot: string): string[] | null {
    // steps waiting on this spot
    for (const q of this.active) {
      const s = this.step(q)!;
      if (this.waiting.has(q.id) && s.restart?.spot === spot) {
        this.waiting.delete(q.id);
        this.tracked = q.id;
        this.timer = s.limit ? { quest: q.id, left: s.limit } : null;
        const lines = q.intro;
        this.onEvent?.({ type: 'start', quest: q, lines });
        return lines;
      }
      if (!this.waiting.has(q.id) && s.goal.kind === 'use' && s.goal.spot === spot) return this.advance(q);
    }
    // a quest that starts here
    const q = QUESTS.find((x) => x.start === spot && !this.started(x));
    if (q) {
      this.save.flag(`q:${q.id}`);
      this.tracked = q.id;
      this.beginStep(q);
      this.onEvent?.({ type: 'start', quest: q, lines: q.intro });
      return q.intro;
    }
    return null;
  }

  private beginStep(q: Quest) {
    const s = this.step(q);
    this.timer = s?.limit ? { quest: q.id, left: s.limit } : this.timer?.quest === q.id ? null : this.timer;
  }

  private advance(q: Quest): string[] {
    const s = this.step(q)!;
    this.save.flag(`q:${q.id}:${this.progress(q)}`);
    const lines = s.lines ?? [];
    if (this.progress(q) >= q.steps.length) {
      this.save.flag(`q:${q.id}:done`);
      if (this.timer?.quest === q.id) this.timer = null;
      this.onEvent?.({ type: 'done', quest: q, lines });
    } else {
      this.tracked = q.id;
      this.beginStep(q);
      this.onEvent?.({ type: 'step', quest: q, lines });
    }
    return lines;
  }

  update(dt: number, w: QuestWorld) {
    if (this.timer) {
      this.timer.left -= dt;
      if (this.timer.left <= 0) {
        const q = QUESTS.find((x) => x.id === this.timer!.quest)!;
        this.timer = null;
        const s = this.step(q);
        if (s?.restart) {
          this.waiting.add(q.id);
          this.onEvent?.({ type: 'fail', quest: q, lines: s.restart.fail });
        }
      }
    }
    for (const q of this.active) {
      if (this.waiting.has(q.id)) continue;
      const g = this.step(q)!.goal;
      const near = (x: number, z: number, r: number) => !w.inside && Math.hypot(w.pos.x - x, w.pos.z - z) < r;
      if (
        (g.kind === 'reach' && near(g.x, g.z, g.r)) ||
        (g.kind === 'drive' && w.driving && near(g.x, g.z, g.r)) ||
        (g.kind === 'car' && w.driving) ||
        (g.kind === 'climb' && w.inside === 'stairwell' && w.stairLoops >= g.loops)
      )
        this.advance(q);
    }
  }

  /** Admin/dev: forget all quest progress. */
  reset() {
    this.save.data.flags = this.save.data.flags.filter((f) => !f.startsWith('q:'));
    this.save.flush();
    this.waiting.clear();
    this.timer = null;
    this.tracked = null;
  }
}
