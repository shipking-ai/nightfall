import * as THREE from 'three';

/**
 * People talking, synthesised: a buzzing glottal source through three
 * formant filters that glide between vowels, one syllable at a time, with
 * a breath of noise for the consonants. The words aren't real; the rhythm,
 * pitch and mood are, so the subtitle reads as what was said.
 */

export interface VoiceSpec {
  /** fundamental in Hz (~95 deep … ~250 high) */
  pitch: number;
  /** vocal tract: formants × this (smaller people ~1.15, larger ~0.88) */
  tract: number;
  /** syllables per second */
  rate: number;
  /** 0 clear … 1 breathy/hoarse */
  breath: number;
}

export type Mood = 'calm' | 'annoyed' | 'scared' | 'warm' | 'odd' | 'murmur';

// [F1, F2, F3] for a handful of vowels (adult averages)
const VOWELS: [number, number, number][] = [
  [800, 1200, 2600], // a
  [500, 1750, 2600], // e
  [320, 2250, 2950], // i
  [480, 900, 2600], // o
  [360, 850, 2400], // u
  [620, 1400, 2500], // schwa-ish
];

export function randomVoice(rnd: () => number, height = 1): VoiceSpec {
  // two broad registers, and everything in between
  const low = rnd() < 0.5;
  const pitch = low ? 92 + rnd() * 50 : 165 + rnd() * 70;
  return {
    pitch,
    tract: (low ? 0.9 : 1.08) * (1.06 - (height - 1) * 0.6) * (0.95 + rnd() * 0.1),
    rate: 4.2 + rnd() * 2.2,
    breath: rnd() * 0.6,
  };
}

/**
 * Speak `text` from `pos` (null: in your head / right beside you).
 * Returns how long it takes, in seconds.
 */
export function speak(
  ctx: AudioContext,
  dest: AudioNode,
  noise: AudioBuffer,
  voice: VoiceSpec,
  text: string,
  mood: Mood,
  pos: THREE.Vector3 | null,
  gain = 1,
): number {
  const t0 = ctx.currentTime + 0.03;
  const words = text.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean);
  const sylls: { word: number; last: boolean }[] = [];
  words.forEach((w, i) => {
    const n = Math.max(1, Math.min(4, Math.round(w.replace(/[^aeiouy]/gi, '').length || 1)));
    for (let k = 0; k < n; k++) sylls.push({ word: i, last: k === n - 1 });
  });
  if (!sylls.length) sylls.push({ word: 0, last: true });
  if (sylls.length > 22) sylls.length = 22;

  const m = {
    calm: { rate: 1, pitch: 1, range: 0.12, vol: 0.9 },
    warm: { rate: 0.92, pitch: 1.02, range: 0.16, vol: 0.85 },
    annoyed: { rate: 1.15, pitch: 1.12, range: 0.22, vol: 1.15 },
    scared: { rate: 1.35, pitch: 1.3, range: 0.3, vol: 1.25 },
    odd: { rate: 0.7, pitch: 0.94, range: 0.02, vol: 0.8 },
    murmur: { rate: 1, pitch: 0.98, range: 0.1, vol: 0.4 },
  }[mood];
  const syl = 1 / (voice.rate * m.rate);
  const question = /\?\s*$/.test(text);
  const exclaim = /!\s*$/.test(text);

  // source: a sawtooth plus a little noise (breath), into three parallel formants
  const src = ctx.createOscillator();
  src.type = 'sawtooth';
  const f0 = voice.pitch * m.pitch;
  const vib = ctx.createOscillator();
  vib.frequency.value = 5 + Math.random();
  const vibG = ctx.createGain();
  vibG.gain.value = f0 * 0.012;
  vib.connect(vibG).connect(src.frequency);

  const air = ctx.createBufferSource();
  air.buffer = noise;
  air.loop = true;
  air.playbackRate.value = 0.9 + Math.random() * 0.2;
  const airHp = ctx.createBiquadFilter();
  airHp.type = 'highpass';
  airHp.frequency.value = 900;
  const airG = ctx.createGain();
  airG.gain.value = 0.05 + voice.breath * 0.16 + (mood === 'murmur' ? 0.08 : 0);

  const env = ctx.createGain(); // syllable envelope (voiced)
  env.gain.value = 0;
  const burst = ctx.createGain(); // consonant bursts
  burst.gain.value = 0;
  src.connect(env);
  air.connect(airHp);
  airHp.connect(airG).connect(env);
  airHp.connect(burst);

  const mix = ctx.createGain();
  mix.gain.value = 0.16 * m.vol * gain;
  const formants = [0, 1, 2].map((i) => {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = [7, 11, 14][i];
    const g = ctx.createGain();
    g.gain.value = [1, 0.55, 0.28][i] * 3.2;
    env.connect(f).connect(g).connect(mix);
    return f;
  });
  const hiss = ctx.createBiquadFilter();
  hiss.type = 'bandpass';
  hiss.frequency.value = 4200;
  hiss.Q.value = 1.2;
  burst.connect(hiss).connect(mix);

  // lip / chest colour, and a gentle top roll-off
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = mood === 'murmur' ? 2200 : 5200;
  let out: AudioNode = mix.connect(lp);
  if (pos) {
    const pan = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1.6, rolloffFactor: 1.3, maxDistance: 60 });
    pan.positionX.value = pos.x;
    pan.positionY.value = pos.y + 1.55;
    pan.positionZ.value = pos.z;
    out = out.connect(pan);
  }
  out.connect(dest);

  // schedule: pitch declines over the phrase, rises at the end of a question,
  // jumps on an exclamation; each syllable gets a vowel and a consonant onset
  let t = t0;
  const total = sylls.length;
  let prevWord = 0;
  sylls.forEach((s, i) => {
    if (s.word !== prevWord) {
      t += syl * (0.12 + Math.random() * 0.12); // a hair of space between words
      prevWord = s.word;
    }
    const k = i / Math.max(1, total - 1);
    let p = f0 * (1 + m.range * (Math.random() - 0.5)) * (1.06 - 0.14 * k);
    if (question && k > 0.7) p *= 1 + (k - 0.7) * 1.1;
    if (exclaim && i === 0) p *= 1.18;
    if (mood === 'odd') p = f0;
    const dur = syl * (s.last ? 1.08 : 0.94) * (0.85 + Math.random() * 0.3);
    src.frequency.setTargetAtTime(p, t, 0.025);
    const v = VOWELS[(Math.random() * VOWELS.length) | 0];
    formants.forEach((f, j) => f.frequency.setTargetAtTime(v[j] * voice.tract, t + 0.02, 0.03));
    // consonant: a short puff before the vowel, most syllables
    if (Math.random() < 0.7) {
      burst.gain.setValueAtTime(0, t);
      burst.gain.linearRampToValueAtTime(0.35 + Math.random() * 0.4, t + 0.012);
      burst.gain.exponentialRampToValueAtTime(0.001, t + 0.05 + Math.random() * 0.05);
    }
    const on = t + 0.03, peak = 0.75 + Math.random() * 0.25;
    env.gain.setValueAtTime(0, on - 0.01);
    env.gain.linearRampToValueAtTime(peak, on + 0.035);
    env.gain.setTargetAtTime(peak * 0.7, on + 0.05, dur * 0.4);
    env.gain.setTargetAtTime(0, on + dur * 0.78, 0.022);
    t += dur;
  });
  const end = t + 0.25;
  for (const n of [src, vib, air]) {
    n.start(t0);
    n.stop(end);
  }
  src.onended = () => {
    mix.disconnect();
    lp.disconnect();
  };
  return end - t0;
}
