import { C, CHANNELS, DISCRETE, MASKS, mirrorChannel, type Channel, type MaskName, type Pose } from './pose';

/**
 * Authored animation: keyframed clips, sampled with smooth (cubic Hermite)
 * interpolation and blended over the procedural base pose on layers that
 * fade in and out. A layer only moves the channels its clip keys (and its
 * mask allows), so a wave plays on the arm while the legs keep walking.
 */

export type Ease = 'smooth' | 'linear' | 'step' | 'in' | 'out';

export interface Key {
  t: number;
  p: Partial<Record<Channel, number>>;
  /** how the values arrive at this key (default 'smooth') */
  e?: Ease;
  /** a named moment (a footfall, a hit frame, a clap) */
  ev?: string;
}

export interface ClipDef {
  name: string;
  dur: number;
  loop?: boolean;
  keys: Key[];
  /** restrict the clip to part of the body when it plays over locomotion */
  mask?: MaskName;
  /** values are added to the pose instead of replacing it (a flinch, recoil) */
  additive?: boolean;
  /** props shown while it plays (the phone's glow, a cigarette, a cup) */
  props?: string[];
  /** stops the figure walking while it plays (a full-body action) */
  hold?: boolean;
}

interface Track {
  c: number;
  t: number[];
  v: number[];
  e: Ease[];
}

export class Clip {
  readonly tracks: Track[] = [];
  readonly events: { t: number; name: string }[] = [];
  constructor(public def: ClipDef) {
    const byCh = new Map<number, Track>();
    const keys = [...def.keys].sort((a, b) => a.t - b.t);
    for (const k of keys) {
      if (k.ev) this.events.push({ t: k.t, name: k.ev });
      for (const [name, v] of Object.entries(k.p) as [Channel, number][]) {
        const c = C[name];
        if (c === undefined) throw new Error(`clip ${def.name}: unknown channel ${name}`);
        let tr = byCh.get(c);
        if (!tr) byCh.set(c, (tr = { c, t: [], v: [], e: [] }));
        tr.t.push(k.t);
        tr.v.push(v);
        tr.e.push(DISCRETE.has(c) ? 'step' : k.e ?? 'smooth');
      }
    }
    const mask = def.mask ? new Set(MASKS[def.mask]) : null;
    for (const tr of byCh.values()) if (!mask || mask.has(tr.c)) this.tracks.push(tr);
  }

  get name() {
    return this.def.name;
  }

  /** Write every keyed channel's value at time `t` into `out` (and mark them in `set`). */
  sample(t: number, out: Float32Array, set: Uint8Array) {
    const dur = this.def.dur;
    if (this.def.loop) t = ((t % dur) + dur) % dur;
    else t = Math.max(0, Math.min(dur, t));
    for (const tr of this.tracks) {
      out[tr.c] = sampleTrack(tr, t, this.def.loop ? dur : 0);
      set[tr.c] = 1;
    }
  }
}

function sampleTrack(tr: Track, t: number, loopDur: number): number {
  const T = tr.t, V = tr.v, n = T.length;
  if (n === 1) return V[0];
  // extended key list: loops wrap round, one-shots hold their ends
  const kt = (i: number) => (i < 0 ? T[n + i] - loopDur : i >= n ? T[i - n] + loopDur : T[i]);
  const kv = (i: number) => (i < 0 ? V[n + i] : i >= n ? V[i - n] : V[i]);
  let i: number;
  if (loopDur) {
    while (t < T[0]) t += loopDur;
    while (t >= T[0] + loopDur) t -= loopDur;
    i = n - 1;
    for (let k = 0; k < n - 1; k++) if (t < T[k + 1]) {
      i = k;
      break;
    }
  } else {
    if (t <= T[0]) return V[0];
    if (t >= T[n - 1]) return V[n - 1];
    i = 0;
    while (i < n - 2 && t >= T[i + 1]) i++;
  }
  const t0 = kt(i), t1 = kt(i + 1), v0 = kv(i), v1 = kv(i + 1);
  const span = Math.max(1e-5, t1 - t0);
  const u = Math.max(0, Math.min(1, (t - t0) / span));
  const e = tr.e[(i + 1) % n];
  if (e === 'step') return u < 1 ? v0 : v1;
  if (e === 'linear') return v0 + (v1 - v0) * u;
  if (e === 'in') return v0 + (v1 - v0) * u * u * u;
  if (e === 'out') return v0 + (v1 - v0) * (1 - Math.pow(1 - u, 3));
  // Catmull-Rom tangents from the neighbours; flat at the ends of a one-shot
  const hasPrev = loopDur || i > 0, hasNext = loopDur || i + 2 < n;
  const m0 = hasPrev ? ((v1 - kv(i - 1)) / Math.max(1e-5, t1 - kt(i - 1))) * span : 0;
  const m1 = hasNext ? ((kv(i + 2) - v0) / Math.max(1e-5, kt(i + 2) - t0)) * span : 0;
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * v0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * v1 + (u3 - u2) * m1;
}

/* ─────────────────────────── the registry ─────────────────────────── */

const LIB = new Map<string, Clip>();

export function defineClip(def: ClipDef): Clip {
  const c = new Clip(def);
  LIB.set(def.name, c);
  return c;
}

/** The same clip with left and right swapped (left-handed people, the other side). */
export function mirrored(name: string): Clip {
  const key = `${name}~m`;
  const have = LIB.get(key);
  if (have) return have;
  const src = clip(name).def;
  const keys = src.keys.map((k) => {
    const p: Partial<Record<Channel, number>> = {};
    for (const [ch, v] of Object.entries(k.p) as [Channel, number][]) {
      const m = mirrorChannel(ch);
      p[m.to] = m.neg ? -v : v;
    }
    return { ...k, p };
  });
  const mask = src.mask === 'armR' ? 'armL' : src.mask === 'armL' ? 'armR' : src.mask;
  return defineClip({ ...src, name: key, keys, mask });
}

export function clip(name: string): Clip {
  const c = LIB.get(name);
  if (!c) throw new Error(`no clip ${name}`);
  return c;
}

export function hasClip(name: string) {
  return LIB.has(name);
}

/* ─────────────────────────── the animator ─────────────────────────── */

export interface PlayOpts {
  fadeIn?: number;
  fadeOut?: number;
  speed?: number;
  loop?: boolean;
  /** start part-way through */
  at?: number;
  /** blend weight at full strength (0..1) */
  weight?: number;
  /** a mask applied on top of the clip's own */
  mask?: MaskName;
  /** layers of the same group replace each other (an idle replaces an idle, not a wave) */
  group?: string;
  mirror?: boolean;
  /** a one-shot that holds its last frame until stopped (lying where they fell) */
  stay?: boolean;
  onEnd?: () => void;
  onEvent?: (name: string) => void;
}

interface Layer {
  clip: Clip;
  t: number;
  speed: number;
  w: number;
  max: number;
  fadeIn: number;
  fadeOut: number;
  loop: boolean;
  out: boolean;
  mask: Set<number> | null;
  group: string;
  stay: boolean;
  onEnd?: () => void;
  onEvent?: (name: string) => void;
}

const tmp = new Float32Array(CHANNELS.length);
const tmpSet = new Uint8Array(CHANNELS.length);

/**
 * One per character. Layers are applied in the order they were started;
 * the newest action wins. Fades use a smoothstep so nothing snaps.
 */
export class Animator {
  layers: Layer[] = [];

  play(name: string, o: PlayOpts = {}): Layer {
    const c = o.mirror ? mirrored(name) : clip(name);
    const group = o.group ?? c.name;
    // same group: the old one fades out as the new one fades in
    for (const l of this.layers) if (l.group === group && !l.out) this.release(l, o.fadeIn ?? 0.25);
    const l: Layer = {
      clip: c,
      t: o.at ?? 0,
      speed: o.speed ?? 1,
      w: 0,
      max: o.weight ?? 1,
      fadeIn: Math.max(0.001, o.fadeIn ?? 0.25),
      fadeOut: Math.max(0.001, o.fadeOut ?? 0.3),
      loop: o.loop ?? !!c.def.loop,
      out: false,
      mask: o.mask ? new Set(MASKS[o.mask]) : null,
      group,
      stay: !!o.stay,
      onEnd: o.onEnd,
      onEvent: o.onEvent,
    };
    this.layers.push(l);
    return l;
  }

  /** Fade a layer (by group or clip name, or everything) out. */
  stop(which?: string, fade = 0.3) {
    for (const l of this.layers) if (!which || l.group === which || l.clip.name === which || l.clip.name === `${which}~m`) this.release(l, fade);
  }

  private release(l: Layer, fade: number) {
    if (l.out) return;
    l.out = true;
    l.fadeOut = Math.max(0.001, fade);
  }

  playing(name: string) {
    return this.layers.some((l) => !l.out && (l.clip.name === name || l.clip.name === `${name}~m` || l.group === name));
  }

  /** The newest live layer in a group (to read or drive its time). */
  layer(group: string): Layer | undefined {
    for (let i = this.layers.length - 1; i >= 0; i--) if (this.layers[i].group === group && !this.layers[i].out) return this.layers[i];
    return undefined;
  }

  /** A full-body action that stops walking is in progress. */
  get holding() {
    return this.layers.some((l) => !l.out && l.clip.def.hold && l.w > 0.2);
  }

  /** Props from clips that are showing. */
  hasProp(p: string) {
    return this.layers.some((l) => l.w > 0.5 && l.clip.def.props?.includes(p));
  }

  get idle() {
    return this.layers.length === 0;
  }

  update(dt: number) {
    for (let i = 0; i < this.layers.length; i++) {
      const l = this.layers[i];
      const before = l.t;
      l.t += dt * l.speed;
      const dur = l.clip.def.dur;
      // events crossed this frame
      if (l.onEvent && l.clip.events.length) {
        for (const e of l.clip.events) {
          if (l.loop) {
            const a = before % dur, b = l.t % dur;
            if ((a <= e.t && e.t < b) || (b < a && (e.t >= a || e.t < b))) l.onEvent(e.name);
          } else if (before <= e.t && e.t < l.t) l.onEvent(e.name);
        }
      }
      // a clip that stays holds its last frame (and never fades on its own)
      if (l.stay) {
        if (l.t > dur) l.t = dur;
      } else if (!l.loop && !l.out && l.t >= dur - l.fadeOut * l.speed) this.release(l, l.fadeOut);
      const target = l.out ? 0 : l.max;
      const rate = dt / (l.out ? l.fadeOut : l.fadeIn);
      l.w = l.w < target ? Math.min(target, l.w + rate * l.max) : Math.max(target, l.w - rate * l.max);
      if (l.out && l.w <= 0) {
        this.layers.splice(i--, 1);
        l.onEnd?.();
      }
    }
  }

  /** Blend every layer over `pose`. */
  apply(pose: Pose) {
    for (const l of this.layers) {
      if (l.w <= 0) continue;
      const w = l.w * l.w * (3 - 2 * l.w); // eased weight
      tmpSet.fill(0);
      l.clip.sample(l.t, tmp, tmpSet);
      const add = !!l.clip.def.additive;
      for (const tr of l.clip.tracks) {
        const c = tr.c;
        if (l.mask && !l.mask.has(c)) continue;
        if (DISCRETE.has(c)) {
          if (w > 0.5) pose[c] = tmp[c];
        } else if (add) pose[c] += tmp[c] * w;
        else pose[c] += (tmp[c] - pose[c]) * w;
      }
    }
  }

  clear() {
    this.layers.length = 0;
  }
}
