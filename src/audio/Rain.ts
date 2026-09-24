/**
 * Rain, built from what rain actually is rather than filtered static:
 *
 *  - drops:   thousands of separate impacts a second, each a tiny damped
 *             ring (1-8 kHz) with a power-law spread of sizes, scattered
 *             across the stereo field
 *  - plinks:  drops landing in puddles, where the trapped air bubble rings
 *             with a short rising chirp (the Minnaert resonance)
 *  - wash:    the diffuse sheet of everything too far to resolve (pink noise)
 *  - distant: the low roar of rain on a whole city
 *  - runoff:  water running in gutters and drains, gurgling
 *
 * Each layer is a seamless stereo loop rendered once at start-up; the mix
 * follows the rain's intensity, and everything but the wash dulls when you
 * are under cover.
 */
export class RainSound {
  private layers: { gain: GainNode; lo: number; hi: number; curve: number }[] = [];
  private cover: BiquadFilterNode;
  /** noise loops are crossfaded head-to-tail; they must loop just short of the tail */
  private seam = 0.05;

  constructor(
    private ctx: AudioContext,
    private out: AudioNode,
  ) {
    const sr = ctx.sampleRate;
    const seconds = 7;
    this.cover = ctx.createBiquadFilter();
    this.cover.type = 'lowpass';
    this.cover.frequency.value = 20000;
    this.cover.Q.value = 0.4;
    this.cover.connect(out);

    const drops = this.buffer(seconds, (L, R, n) => {
      const count = Math.floor(2600 * seconds);
      for (let i = 0; i < count; i++) {
        const at = Math.floor(Math.random() * n);
        const size = Math.pow(Math.random(), 3.2); // mostly small, a few heavy
        const amp = 0.02 + size * 0.55;
        const freq = 1300 + Math.random() * 6500 * (1 - size * 0.6); // bigger drops ring lower
        const tau = (0.00018 + Math.random() * 0.0006 + size * 0.0012) * sr;
        const pan = Math.random();
        const len = Math.floor(tau * 6);
        const w = (2 * Math.PI * freq) / sr;
        const phase = Math.random() * Math.PI * 2;
        for (let k = 0; k < len; k++) {
          const env = Math.exp(-k / tau);
          // ring plus a little noise at the moment of impact
          const v = amp * env * (Math.sin(w * k + phase) * 0.8 + (Math.random() * 2 - 1) * 0.35 * Math.exp(-k / (tau * 0.25)));
          const j = (at + k) % n;
          L[j] += v * (1 - pan * 0.8);
          R[j] += v * (0.2 + pan * 0.8);
        }
      }
    });

    const plinks = this.buffer(seconds, (L, R, n) => {
      const count = Math.floor(45 * seconds);
      for (let i = 0; i < count; i++) {
        const at = Math.floor(Math.random() * n);
        const f0 = 900 + Math.random() * 2600;
        const rise = 8 + Math.random() * 30; // the bubble's pitch climbs as it shrinks at the surface
        const tau = (0.004 + Math.random() * 0.01) * sr;
        const amp = 0.05 + Math.pow(Math.random(), 2) * 0.22;
        const pan = Math.random();
        const len = Math.floor(tau * 5);
        let ph = 0;
        for (let k = 0; k < len; k++) {
          const t = k / sr;
          ph += (2 * Math.PI * f0 * (1 + rise * t)) / sr;
          const v = amp * Math.exp(-k / tau) * Math.sin(ph) * Math.min(1, k / 12);
          const j = (at + k) % n;
          L[j] += v * (1 - pan * 0.7);
          R[j] += v * (0.3 + pan * 0.7);
        }
      }
    });

    const pink = this.buffer(seconds, (L, R, n) => {
      for (const ch of [L, R]) {
        // Paul Kellet's pink filter, a fresh generator per channel so the sheet is wide
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < n; i++) {
          const w = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + w * 0.0555179;
          b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856;
          b4 = 0.55 * b4 + w * 0.5329522;
          b5 = -0.7616 * b5 - w * 0.016898;
          ch[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
        }
      }
      crossfadeEnds(L, n, Math.floor(sr * this.seam));
      crossfadeEnds(R, n, Math.floor(sr * this.seam));
    });

    const runoff = this.buffer(seconds, (L, R, n) => {
      // brown-ish noise with a quick, irregular gurgle
      let last = 0, g = 0, gTarget = 0;
      for (let i = 0; i < n; i++) {
        if (i % 600 === 0) gTarget = Math.pow(Math.random(), 2);
        g += (gTarget - g) * 0.004;
        last = (last + 0.035 * (Math.random() * 2 - 1)) / 1.035;
        const v = last * 3.2 * (0.35 + g);
        L[i] = v;
        R[i] = v * 0.7 + (Math.random() * 2 - 1) * 0.002;
      }
      crossfadeEnds(L, n, Math.floor(sr * this.seam));
      crossfadeEnds(R, n, Math.floor(sr * this.seam));
    });

    // layer: buffer → filters → gain → cover; gain = lo + (hi - lo) * rain^curve
    this.layer(drops, [['highpass', 900, 0.5]], 0.05, 0.42, 1, true, 0, false);
    this.layer(plinks, [['highpass', 500, 0.5]], 0.02, 0.2, 1.2, true, 0, false);
    this.layer(pink, [['highpass', 350, 0.5], ['lowpass', 9000, 0.4]], 0.02, 0.16, 1, true, 0, true);
    this.layer(pink, [['lowpass', 700, 0.4]], 0.05, 0.22, 1.6, false, 1.7, true); // distant roar: heard indoors too
    this.layer(runoff, [['bandpass', 520, 0.7]], 0.01, 0.07, 0.8, true, 0, true);
  }

  /** 0..1 rain intensity. */
  setIntensity(rain: number) {
    const t = this.ctx.currentTime;
    for (const l of this.layers) l.gain.gain.setTargetAtTime(l.lo + (l.hi - l.lo) * Math.pow(Math.max(0, Math.min(1, rain)), l.curve), t, 0.6);
  }

  /** 0 = in the open, 1 = under a roof / indoors: the near detail goes, a dull roar stays. */
  setCover(k: number) {
    this.cover.frequency.setTargetAtTime(20000 - k * 19200, this.ctx.currentTime, 0.25);
  }

  private layer(buf: AudioBuffer, filters: [BiquadFilterType, number, number][], lo: number, hi: number, curve: number, covered: boolean, offset: number, seamed: boolean) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    if (seamed) src.loopEnd = buf.duration - this.seam;
    let node: AudioNode = src;
    for (const [type, f, q] of filters) {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      node = node.connect(b);
    }
    const gain = ctx.createGain();
    gain.gain.value = lo;
    node.connect(gain);
    gain.connect(covered ? this.cover : this.out);
    src.start(0, (Math.random() * buf.duration + offset) % buf.duration);
    this.layers.push({ gain, lo, hi, curve });
  }

  private buffer(seconds: number, fill: (L: Float32Array, R: Float32Array, n: number) => void) {
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(2, n, this.ctx.sampleRate);
    fill(buf.getChannelData(0), buf.getChannelData(1), n);
    return buf;
  }
}

/** Make a noise loop seamless by blending its tail into its head. */
function crossfadeEnds(d: Float32Array, n: number, m: number) {
  for (let i = 0; i < m; i++) {
    const k = i / m;
    d[i] = d[i] * k + d[n - m + i] * (1 - k);
  }
}
