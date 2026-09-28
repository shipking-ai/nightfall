import type { Pad } from './Gamepads';

/**
 * Controller feedback that means something: a crash, a shot, a blocked punch,
 * thunder, the moment something is wrong. Never a constant buzz.
 *
 * Uses the Gamepad `vibrationActuator` ("dual-rumble", and "trigger-rumble"
 * where the browser supports impulse triggers). Anything else — a native
 * console runtime — only has to replace `play`.
 */
export type HapticEvent =
  | 'crash' | 'bump' | 'engine' | 'rough'
  | 'gunshot' | 'smg' | 'explosion' | 'hurt' | 'reload' | 'reloadDone' | 'hitmarker' | 'kill'
  | 'punch' | 'punchHeavy' | 'block' | 'parry' | 'knockdown' | 'ko'
  | 'thunder' | 'uneasy' | 'land' | 'ui';

interface Shape {
  ms: number;
  strong: number;
  weak: number;
  /** impulse triggers (left, right), 0..1 */
  lt?: number;
  rt?: number;
}

const SHAPES: Record<HapticEvent, Shape> = {
  crash: { ms: 260, strong: 0.9, weak: 0.6 },
  bump: { ms: 90, strong: 0.35, weak: 0.2 },
  engine: { ms: 60, strong: 0.0, weak: 0.08 },
  rough: { ms: 70, strong: 0.12, weak: 0.18 },
  gunshot: { ms: 70, strong: 0.45, weak: 0.35, rt: 0.6 },
  smg: { ms: 45, strong: 0.22, weak: 0.3, rt: 0.35 },
  explosion: { ms: 520, strong: 1, weak: 0.8 },
  hurt: { ms: 140, strong: 0.55, weak: 0.25 },
  reload: { ms: 40, strong: 0.05, weak: 0.25, lt: 0.2 },
  reloadDone: { ms: 50, strong: 0.2, weak: 0.3 },
  hitmarker: { ms: 30, strong: 0, weak: 0.35 },
  kill: { ms: 90, strong: 0.25, weak: 0.5 },
  punch: { ms: 70, strong: 0.35, weak: 0.4 },
  punchHeavy: { ms: 150, strong: 0.8, weak: 0.5 },
  block: { ms: 60, strong: 0.15, weak: 0.45, lt: 0.4 },
  parry: { ms: 110, strong: 0.2, weak: 0.9 },
  knockdown: { ms: 320, strong: 0.85, weak: 0.4 },
  ko: { ms: 700, strong: 1, weak: 0.7 },
  thunder: { ms: 900, strong: 0.35, weak: 0.15 },
  uneasy: { ms: 1400, strong: 0.08, weak: 0.0 },
  land: { ms: 80, strong: 0.3, weak: 0.1 },
  ui: { ms: 18, strong: 0, weak: 0.12 },
};

type Actuator = {
  playEffect?: (type: string, params: Record<string, number>) => Promise<unknown>;
  effects?: string[];
};

export class Haptics {
  enabled = true;
  strength = 1;
  triggers = true;
  /** don't stack a dozen shakes on top of each other */
  private busyUntil = 0;

  play(pad: Pad | null, e: HapticEvent, scale = 1) {
    if (!this.enabled || !pad?.raw || this.strength <= 0) return;
    const now = performance.now();
    const s = SHAPES[e];
    const heavy = s.strong > 0.5;
    if (!heavy && now < this.busyUntil) return;
    const act = (pad.raw as unknown as { vibrationActuator?: Actuator }).vibrationActuator;
    if (!act?.playEffect) return;
    const k = Math.max(0, Math.min(1, this.strength * scale));
    const trig = this.triggers && (s.lt || s.rt) && (act.effects?.includes('trigger-rumble') ?? false);
    const params: Record<string, number> = {
      duration: s.ms,
      startDelay: 0,
      strongMagnitude: Math.min(1, s.strong * k),
      weakMagnitude: Math.min(1, s.weak * k),
    };
    if (trig) {
      params.leftTrigger = (s.lt ?? 0) * k;
      params.rightTrigger = (s.rt ?? 0) * k;
    }
    this.busyUntil = now + s.ms * 0.6;
    act.playEffect(trig ? 'trigger-rumble' : 'dual-rumble', params).catch(() => {
      // trigger-rumble unsupported on this pad after all: fall back to ordinary rumble
      if (trig) act.playEffect!('dual-rumble', { duration: s.ms, startDelay: 0, strongMagnitude: params.strongMagnitude, weakMagnitude: params.weakMagnitude }).catch(() => {});
    });
  }
}
