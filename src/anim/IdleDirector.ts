import type { Animator } from './Animator';
import type { Persona } from '../data/people';

/**
 * What someone does when they have nothing to do. Not a random loop every
 * few seconds: a weighted choice from what this person tends to do, shaped
 * by where they are and what the night is doing (rain, cold, a police car
 * going past), with gaps of plain breathing and weight-shifting in between,
 * and never the same thing twice in a row.
 */

export interface IdleContext {
  /** standing still (not walking) */
  still: boolean;
  raining: boolean;
  /** cold enough to show it */
  cold: boolean;
  /** waiting for something (a bus, a taxi, a crossing) */
  waiting: boolean;
  /** what they're already doing with their hands ('phone', 'smoke', 'pockets', …) */
  hands: string;
  /** wearing a hood that's down, in the rain */
  hoodable: boolean;
  /** police on patrol */
  police: boolean;
  /** leaning spot (a wall behind them) */
  wall: boolean;
}

/** clip for each idle name used in personas */
const CLIPS: Record<string, string> = {
  checkWatch: 'idle.checkWatch',
  checkPhone: 'idle.checkPhone',
  lookStreet: 'idle.lookStreet',
  lookAround: 'idle.lookAround',
  scan: 'idle.scan',
  shift: 'idle.shift',
  footTap: 'idle.footTap',
  adjust: 'idle.adjust',
  fixHair: 'idle.fixHair',
  scratchHead: 'idle.scratchHead',
  rubHands: 'idle.rubHands',
  crossArms: 'idle.crossArms',
  handsHips: 'idle.handsHips',
  stretch: 'idle.stretch',
  yawn: 'idle.yawn',
  rubEyes: 'idle.rubEyes',
  slump: 'idle.slump',
  smoke: 'idle.smoke',
  radio: 'idle.radio',
  wipeFace: 'idle.wipeFace',
  hoodUp: 'idle.hoodUp',
  crosswalk: 'idle.crosswalk',
  window: 'idle.window',
};

export class IdleDirector {
  private wait: number;
  private last = '';
  private cool = new Map<string, number>();
  /** set when an idle wants the outfit changed (the hood goes up) */
  onEvent?: (name: string) => void;

  constructor(private persona: Persona, private rnd: () => number = Math.random) {
    this.wait = 1 + rnd() * 6;
  }

  /** Call every frame for someone who is idle; it decides when to do something. */
  update(dt: number, anim: Animator, ctx: IdleContext) {
    for (const [k, v] of this.cool) this.cool.set(k, v - dt);
    if (!ctx.still) {
      this.wait = Math.min(this.wait, 2 + this.rnd() * 3);
      return;
    }
    if (anim.playing('idle')) return;
    this.wait -= dt;
    if (this.wait > 0) return;
    const p = this.persona;
    // the nervous and the energetic fidget more often
    this.wait = (4 + this.rnd() * 7) * (1.25 - 0.45 * p.nervous - 0.25 * p.energy);
    const w: Record<string, number> = { shift: 1.2, lookAround: 0.6 + p.nervous * 2, lookStreet: 0.5, scratchHead: 0.2, adjust: 0.4, fixHair: 0.2 };
    for (const [k, v] of Object.entries(p.idles)) w[k] = (w[k] ?? 0) + v;
    if (p.tired > 0.5) (w.yawn = (w.yawn ?? 0) + p.tired * 1.5), (w.slump = (w.slump ?? 0) + p.tired);
    if (ctx.waiting) (w.checkWatch = (w.checkWatch ?? 0) + 1.5), (w.lookStreet = (w.lookStreet ?? 0) + 2), (w.footTap = (w.footTap ?? 0) + 0.8 * p.energy);
    if (ctx.raining) (w.wipeFace = 1.2), (w.hoodUp = ctx.hoodable ? 4 : 0);
    if (ctx.cold) w.rubHands = (w.rubHands ?? 0) + 2.5;
    if (ctx.police) (w.scan = (w.scan ?? 0) + 3), (w.radio = (w.radio ?? 0) + 1);
    // what the hands are already busy with rules some things out
    if (ctx.hands === 'phone') for (const k of ['checkPhone', 'rubHands', 'crossArms', 'handsHips', 'adjust', 'fixHair', 'scratchHead', 'wipeFace', 'stretch']) w[k] = 0;
    if (ctx.hands === 'umbrella') for (const k of ['rubHands', 'crossArms', 'handsHips', 'stretch', 'hoodUp', 'wipeFace']) w[k] = 0;
    if (ctx.hands === 'smoke') w.smoke = (w.smoke ?? 0) + 5;
    else w.smoke = 0;
    if (this.last) w[this.last] = 0;
    for (const [k, v] of this.cool) if (v > 0) w[k] = 0;
    const total = Object.values(w).reduce((a, b) => a + Math.max(0, b), 0);
    if (total <= 0) return;
    let x = this.rnd() * total;
    let pick = '';
    for (const [k, v] of Object.entries(w)) {
      x -= Math.max(0, v);
      if (x <= 0) {
        pick = k;
        break;
      }
    }
    const clip = CLIPS[pick];
    if (!clip) return;
    this.last = pick;
    this.cool.set(pick, 25 + this.rnd() * 30);
    // older and tired people move a little slower
    const speed = (0.85 + 0.3 * p.energy) * (1 - 0.15 * p.age);
    anim.play(clip, { group: 'idle', fadeIn: 0.45, fadeOut: 0.5, speed, mirror: p.leftHanded && this.rnd() < 0.8, onEvent: (e) => this.onEvent?.(e) });
  }

  /** Something happened: whatever idle was playing stops (the reaction takes over). */
  interrupt(anim: Animator) {
    anim.stop('idle', 0.2);
    this.wait = 2 + this.rnd() * 3;
  }
}
