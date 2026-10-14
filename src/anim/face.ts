import { C, type Pose } from './pose';

/**
 * A face that is never frozen.
 *
 * Emotions are weights that ease in and out (a surprise is fast, sadness
 * settles slowly) and blend into a handful of expression channels (smile,
 * frown, brows up / in / uneven, squint, jaw). On top: speech (the jaw and
 * brows moving with syllables, not a flapping loop), eyes that fixate and
 * jump between fixations (saccades) the way eyes do, blinks that tend to come
 * with a big eye movement, and now and then a micro-expression — a flicker of
 * something the person didn't mean to show.
 *
 * Channels (pose.ts): browUp, browIn, browAsym, smile, frown, squint, jaw,
 * eyeX, eyeY (±1 is as far as the eyes turn), blink.
 */

export const EMOTIONS = ['happy', 'sad', 'angry', 'fear', 'surprise', 'disgust', 'pain', 'suspicion', 'focus', 'relief', 'confused'] as const;
export type Emotion = (typeof EMOTIONS)[number];

type Mix = Partial<Record<'browUp' | 'browIn' | 'browAsym' | 'smile' | 'frown' | 'squint' | 'jaw' | 'eyeY', number>>;
const LOOK: Record<Emotion, Mix> = {
  happy: { smile: 0.85, squint: 0.3, browUp: 0.12 },
  sad: { frown: 0.6, browIn: 0.35, browUp: 0.45, eyeY: -0.25, squint: 0.1 },
  angry: { browIn: 0.95, browUp: -0.45, frown: 0.35, squint: 0.45, jaw: 0.04 },
  fear: { browUp: 0.95, browIn: 0.45, jaw: 0.28, squint: -0.35 },
  surprise: { browUp: 1, jaw: 0.42, squint: -0.45 },
  disgust: { frown: 0.45, squint: 0.55, browIn: 0.4, browAsym: 0.3 },
  pain: { squint: 0.95, browIn: 0.85, jaw: 0.22, frown: 0.55, browUp: 0.2 },
  suspicion: { squint: 0.5, browAsym: 0.65, browIn: 0.3 },
  focus: { browIn: 0.45, squint: 0.25 },
  relief: { smile: 0.35, browUp: 0.25, jaw: 0.06 },
  confused: { browAsym: 0.75, browIn: 0.3, frown: 0.15 },
};
/** how fast each emotion arrives (per second) */
const ONSET: Record<Emotion, number> = { happy: 3, sad: 0.8, angry: 4, fear: 8, surprise: 12, disgust: 5, pain: 12, suspicion: 2, focus: 2, relief: 2, confused: 3 };

export interface FaceState {
  /** where each emotion is now, and where it's going */
  now: Float32Array;
  want: Float32Array;
  /** timed emotions: seconds left before the want falls back to the mood */
  hold: Float32Array;
  /** resting mood (a tired face, a nervous one) */
  mood: Float32Array;
  /** 0..1 speaking; syllable clock */
  talk: number;
  sy: number;
  syT: number;
  syV: number;
  /** eyes: where they are, where they're going (±1), what they're told to look at */
  ex: number;
  ey: number;
  tx: number;
  ty: number;
  fixT: number;
  /** a gaze target set from outside (a speaker, the player), relative to the head, ±1; NaN when free */
  gx: number;
  gy: number;
  /** how restless the eyes are (nervous people look about more) */
  restless: number;
  /** a flicker: which channel, how much, how long */
  microC: number;
  microA: number;
  microT: number;
  microWait: number;
  /** a blink the eyes asked for (after a big saccade) */
  blink: number;
  seed: number;
}

export function newFace(): FaceState {
  const n = EMOTIONS.length;
  return {
    now: new Float32Array(n), want: new Float32Array(n), hold: new Float32Array(n), mood: new Float32Array(n),
    talk: 0, sy: 0, syT: 0, syV: 0,
    ex: 0, ey: 0, tx: 0, ty: 0, fixT: Math.random() * 2, gx: NaN, gy: NaN, restless: 0.3,
    microC: 0, microA: 0, microT: 0, microWait: 4 + Math.random() * 14, blink: 0, seed: Math.random() * 100,
  };
}

const IDX = Object.fromEntries(EMOTIONS.map((e, i) => [e, i])) as Record<Emotion, number>;

/** Feel something: `amount` 0..1, for `secs` (then back to the mood), or until changed if secs is 0. */
export function feel(f: FaceState, e: Emotion, amount: number, secs = 0) {
  const i = IDX[e];
  f.want[i] = amount;
  f.hold[i] = secs > 0 ? secs : -1;
}

/** Let every emotion that isn't held fall back to the mood. */
export function calm(f: FaceState) {
  for (let i = 0; i < f.want.length; i++) {
    f.want[i] = f.mood[i];
    f.hold[i] = 0;
  }
}

export function setMood(f: FaceState, e: Emotion, amount: number) {
  const i = IDX[e];
  f.mood[i] = amount;
  if (f.hold[i] === 0) f.want[i] = amount;
}

/** Look at something (±1 of the eyes' range, relative to where the head points), or NaN to look freely. */
export function gaze(f: FaceState, x: number, y: number) {
  f.gx = x;
  f.gy = y;
}

const MICRO: (keyof Mix)[] = ['smile', 'browIn', 'frown', 'browAsym', 'browUp', 'squint'];

export function stepFace(f: FaceState, dt: number) {
  for (let i = 0; i < f.now.length; i++) {
    if (f.hold[i] > 0) {
      f.hold[i] -= dt;
      if (f.hold[i] <= 0) {
        f.hold[i] = 0;
        f.want[i] = f.mood[i];
      }
    }
    const up = f.want[i] > f.now[i];
    const r = up ? ONSET[EMOTIONS[i]] : ONSET[EMOTIONS[i]] * 0.35;
    f.now[i] += (f.want[i] - f.now[i]) * Math.min(1, dt * r);
  }
  // syllables: a new target every 80–220 ms while talking, the jaw chasing it
  f.syT -= dt;
  if (f.syT <= 0) {
    f.syT = 0.08 + Math.random() * 0.14;
    f.sy = f.talk > 0.05 ? (Math.random() < 0.18 ? 0.05 : 0.3 + Math.random() * 0.7) : 0;
  }
  f.syV += (f.sy - f.syV) * Math.min(1, dt * 22);
  // eyes: hold a fixation, then jump
  f.fixT -= dt;
  if (f.fixT <= 0) {
    const free = Number.isNaN(f.gx);
    const spread = free ? 0.25 + 0.5 * f.restless : 0.06 + 0.12 * f.restless;
    const bx = free ? 0 : f.gx, by = free ? -0.05 : f.gy;
    const nx = Math.max(-1, Math.min(1, bx + (Math.random() * 2 - 1) * spread));
    const ny = Math.max(-0.8, Math.min(0.8, by + (Math.random() * 2 - 1) * spread * 0.5));
    if (Math.hypot(nx - f.tx, ny - f.ty) > 0.45 && Math.random() < 0.35) f.blink = 0.14;
    f.tx = nx;
    f.ty = ny;
    f.fixT = (free ? 0.5 + Math.random() * 2.2 : 0.35 + Math.random() * 1.3) * (1.2 - 0.6 * f.restless);
  }
  // a saccade takes ~40 ms
  f.ex += (f.tx - f.ex) * Math.min(1, dt * 28);
  f.ey += (f.ty - f.ey) * Math.min(1, dt * 28);
  if (f.blink > 0) f.blink = Math.max(0, f.blink - dt);
  // micro-expressions
  f.microWait -= dt;
  if (f.microWait <= 0) {
    f.microWait = 5 + Math.random() * 16;
    f.microC = Math.floor(Math.random() * MICRO.length);
    f.microA = 0.18 + Math.random() * 0.22;
    f.microT = 0.25 + Math.random() * 0.4;
  }
  if (f.microT > 0) f.microT -= dt;
}

/** Write the face channels (added to whatever the clips set). */
export function facePose(p: Pose, f: FaceState, t: number) {
  let browUp = 0, browIn = 0, browAsym = 0, smile = 0, frown = 0, squint = 0, jaw = 0, eyeY = 0;
  for (let i = 0; i < f.now.length; i++) {
    const w = f.now[i];
    if (w < 0.002) continue;
    const m = LOOK[EMOTIONS[i]];
    browUp += (m.browUp ?? 0) * w;
    browIn += (m.browIn ?? 0) * w;
    browAsym += (m.browAsym ?? 0) * w;
    smile += (m.smile ?? 0) * w;
    frown += (m.frown ?? 0) * w;
    squint += (m.squint ?? 0) * w;
    jaw += (m.jaw ?? 0) * w;
    eyeY += (m.eyeY ?? 0) * w;
  }
  // speech: the jaw with the syllables, brows lifting on the stressed ones
  if (f.talk > 0.02) {
    const s = f.syV * f.talk;
    jaw += 0.08 + 0.26 * s;
    browUp += 0.18 * Math.max(0, Math.sin(t * 2.1 + f.seed)) * f.talk * (s > 0.6 ? 1 : 0.4);
    smile += 0.05 * Math.sin(t * 0.7 + f.seed) * f.talk;
  }
  // the flicker
  if (f.microT > 0) {
    const env = Math.sin(Math.PI * Math.min(1, f.microT / 0.5));
    const a = f.microA * env;
    switch (MICRO[f.microC]) {
      case 'smile': smile += a; break;
      case 'browIn': browIn += a; break;
      case 'frown': frown += a; break;
      case 'browAsym': browAsym += a * (f.seed % 2 < 1 ? 1 : -1); break;
      case 'browUp': browUp += a; break;
      case 'squint': squint += a; break;
    }
  }
  // faces are never quite symmetric
  browAsym += 0.06 * Math.sin(f.seed);
  p[C.browUp] += browUp;
  p[C.browIn] += browIn;
  p[C.browAsym] += browAsym;
  p[C.smile] += smile;
  p[C.frown] += frown;
  p[C.squint] += squint;
  p[C.jaw] += jaw;
  p[C.eyeX] += f.ex;
  p[C.eyeY] += f.ey + eyeY;
  p[C.blink] = Math.max(p[C.blink], f.blink > 0 ? 1 : 0, squint > 0.9 ? 0.5 : 0);
}

/** The face someone wears when nothing's happening, from who they are. */
export function moodFor(f: FaceState, p: { energy: number; confidence: number; nervous: number; tired: number; age: number }, arche?: string) {
  setMood(f, 'sad', 0.12 * p.tired + 0.06 * p.age);
  setMood(f, 'happy', Math.max(0, 0.18 * p.energy + 0.1 * p.confidence - 0.12 * p.tired - 0.08));
  setMood(f, 'focus', 0.08 + (arche === 'police' || arche === 'soldier' ? 0.35 : 0));
  setMood(f, 'suspicion', arche === 'crook' ? 0.35 : arche === 'watcher' ? 0 : 0.05 * p.nervous);
  f.restless = Math.min(1, 0.15 + 0.8 * p.nervous);
  if (arche === 'watcher') f.restless = 0;
}
