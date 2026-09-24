import * as THREE from 'three';
import type { SoundKind, SoundSpot } from '../world/WorldContext';
import { RainSound } from './Rain';
import { speak, type Mood, type VoiceSpec } from './Voice';

/**
 * Everything you hear is synthesised: rain, the city's low roar, wind,
 * electrical hum, water, machinery, a radio, footsteps, and a sparse score.
 * Web Audio only — no files to load.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private muffle!: BiquadFilterNode;
  private amb!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private reverb!: ConvolverNode;
  private reverbIn!: GainNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private rain!: RainSound;
  private trafficGain!: GainNode;
  private emitters: { kind: SoundKind; id?: string; panner: PannerNode; gain: GainNode; pos: THREE.Vector3 }[] = [];
  private phone: { gain: GainNode; ringing: boolean } | null = null;
  private volumes = { master: 0.8, ambience: 0.8, music: 0.5 };
  private musicTimer = 8;
  private musicPlaying = false;
  private landingMode = true;
  enabled = false;

  /** Must be called from a user gesture. */
  async start(spots: SoundSpot[]) {
    if (this.ctx) {
      await this.ctx.resume();
      this.enabled = true;
      return;
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 18000;
    this.master.connect(this.muffle).connect(ctx.destination);
    this.amb = ctx.createGain();
    this.sfx = ctx.createGain();
    this.music = ctx.createGain();
    this.amb.connect(this.master);
    this.sfx.connect(this.master);
    this.music.connect(this.master);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.4);
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 1;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverbIn.connect(this.reverb).connect(wet).connect(this.master);

    this.noise = this.makeNoise('white');
    this.brown = this.makeNoise('brown');
    this.applyVolumes();
    this.buildBed();
    for (const s of spots) this.emitter(s);
    this.enabled = true;
  }

  setVolumes(master: number, ambience: number, music: number) {
    this.volumes = { master, ambience, music };
    if (this.ctx) this.applyVolumes();
  }

  private applyVolumes() {
    const t = this.ctx!.currentTime;
    this.master.gain.setTargetAtTime(this.enabled || true ? this.volumes.master : 0, t, 0.1);
    this.amb.gain.setTargetAtTime(this.volumes.ambience, t, 0.1);
    this.sfx.gain.setTargetAtTime(Math.max(0.2, this.volumes.ambience), t, 0.1);
    this.music.gain.setTargetAtTime(this.volumes.music * 0.5, t, 0.1);
  }

  suspend() {
    this.ctx?.suspend();
    this.enabled = false;
  }

  /** 0 = open sky, 1 = under a roof or indoors. */
  setShelter(k: number) {
    this.rain?.setCover(k);
  }

  /** Menus and overlays pull the world behind glass. */
  setMuffled(on: boolean) {
    if (!this.ctx) return;
    this.muffle.frequency.setTargetAtTime(on ? 700 : 18000, this.ctx.currentTime, on ? 0.12 : 0.35);
  }

  setLanding(on: boolean) {
    this.landingMode = on;
    if (on) this.musicTimer = 1.5;
  }

  /* ── bed: rain, city roar, wind ───────────────────────────── */

  private buildBed() {
    const ctx = this.ctx!;
    const loop = (buf: AudioBuffer) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.loopStart = Math.random() * 2;
      s.start(0, Math.random() * buf.duration);
      return s;
    };
    // rain: drops, puddle plinks, wash, distant roar and runoff (audio/Rain.ts)
    this.rain = new RainSound(ctx, this.amb);
    // the city: a low roar with slow swells of distant traffic
    const c = loop(this.brown);
    const clp = ctx.createBiquadFilter();
    clp.type = 'lowpass';
    clp.frequency.value = 260;
    this.trafficGain = ctx.createGain();
    this.trafficGain.gain.value = 0.18;
    const swell = ctx.createOscillator();
    swell.frequency.value = 0.045;
    const swellAmt = ctx.createGain();
    swellAmt.gain.value = 0.08;
    swell.connect(swellAmt).connect(this.trafficGain.gain);
    swell.start();
    c.connect(clp).connect(this.trafficGain).connect(this.amb);
    // wind, moving between buildings
    const w = loop(this.noise);
    const wbp = ctx.createBiquadFilter();
    wbp.type = 'bandpass';
    wbp.frequency.value = 500;
    wbp.Q.value = 1.4;
    const wlfo = ctx.createOscillator();
    wlfo.frequency.value = 0.07;
    const wlfoAmt = ctx.createGain();
    wlfoAmt.gain.value = 260;
    wlfo.connect(wlfoAmt).connect(wbp.frequency);
    wlfo.start();
    const wg = ctx.createGain();
    wg.gain.value = 0.02;
    w.connect(wbp).connect(wg).connect(this.amb);
  }

  /* ── positional emitters ──────────────────────────────────── */

  private emitter(s: SoundSpot) {
    const ctx = this.ctx!;
    const panner = new PannerNode(ctx, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: s.kind === 'water' ? 10 : s.kind === 'machine' ? 8 : 2.5,
      maxDistance: 120,
      rolloffFactor: s.kind === 'water' ? 1.2 : 1.6,
      positionX: s.pos.x,
      positionY: s.pos.y,
      positionZ: s.pos.z,
    });
    const gain = ctx.createGain();
    gain.connect(panner).connect(this.amb);
    const send = ctx.createGain();
    send.gain.value = 0.25;
    panner.connect(send).connect(this.reverbIn);

    switch (s.kind) {
      case 'hum': {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = 100;
        const o2 = ctx.createOscillator();
        o2.type = 'sine';
        o2.frequency.value = 50;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 520;
        const og = ctx.createGain();
        og.gain.value = 0.35;
        o.connect(f).connect(gain);
        o2.connect(og).connect(gain);
        gain.gain.value = 0.045;
        o.start();
        o2.start();
        break;
      }
      case 'water': {
        const n = this.loopSource(this.noise);
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 520;
        f.Q.value = 0.8;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.23 + Math.random() * 0.1;
        const la = ctx.createGain();
        la.gain.value = 0.14;
        lfo.connect(la).connect(gain.gain);
        lfo.start();
        gain.gain.value = 0.22;
        n.connect(f).connect(gain);
        break;
      }
      case 'machine': {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = 43;
        const o2 = ctx.createOscillator();
        o2.type = 'square';
        o2.frequency.value = 86.6;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 180;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.6;
        const la = ctx.createGain();
        la.gain.value = 0.03;
        lfo.connect(la).connect(gain.gain);
        o.connect(f);
        o2.connect(f);
        f.connect(gain);
        gain.gain.value = 0.09;
        o.start();
        o2.start();
        lfo.start();
        break;
      }
      case 'murmur': {
        // voices, too far off to make out
        for (let k = 0; k < 3; k++) {
          const n = this.loopSource(this.noise);
          const f = ctx.createBiquadFilter();
          f.type = 'bandpass';
          f.frequency.value = 480 + k * 260;
          f.Q.value = 4;
          const g = ctx.createGain();
          g.gain.value = 0;
          const lfo = ctx.createOscillator();
          lfo.frequency.value = 2.6 + k * 1.3;
          const la = ctx.createGain();
          la.gain.value = 0.25;
          const lfo2 = ctx.createOscillator();
          lfo2.frequency.value = 0.21 + k * 0.13;
          const la2 = ctx.createGain();
          la2.gain.value = 0.25;
          lfo.connect(la).connect(g.gain);
          lfo2.connect(la2).connect(g.gain);
          lfo.start();
          lfo2.start();
          n.connect(f).connect(g).connect(gain);
        }
        gain.gain.value = 0.18;
        break;
      }
      case 'drips': {
        gain.gain.value = 0.5;
        const drip = () => {
          if (!this.ctx) return;
          const t = ctx.currentTime;
          const o = ctx.createOscillator();
          o.frequency.setValueAtTime(1400 + Math.random() * 1600, t);
          o.frequency.exponentialRampToValueAtTime(500, t + 0.08);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.25, t + 0.004);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
          o.connect(g).connect(gain);
          o.start(t);
          o.stop(t + 0.15);
          setTimeout(drip, 500 + Math.random() * 2600);
        };
        setTimeout(drip, Math.random() * 2000);
        break;
      }
      case 'radio': {
        this.radio(gain);
        break;
      }
      case 'phone': {
        gain.gain.value = 0;
        const o1 = ctx.createOscillator();
        o1.frequency.value = 440;
        const o2 = ctx.createOscillator();
        o2.frequency.value = 480;
        const am = ctx.createGain();
        am.gain.value = 0;
        // old double-ring cadence
        const pat = ctx.createOscillator();
        pat.type = 'square';
        pat.frequency.value = 20;
        const patG = ctx.createGain();
        patG.gain.value = 0.5;
        pat.connect(patG).connect(am.gain);
        o1.connect(am);
        o2.connect(am);
        const shape = ctx.createGain();
        shape.gain.value = 0.3;
        am.connect(shape).connect(gain);
        o1.start();
        o2.start();
        pat.start();
        this.phone = { gain, ringing: false };
        break;
      }
    }
    this.emitters.push({ kind: s.kind, id: s.id, panner, gain, pos: s.pos });
  }

  /** The payphone's cadence: on 2 s, off 4 s. */
  setPhoneRinging(on: boolean) {
    if (!this.ctx || !this.phone || this.phone.ringing === on) return;
    this.phone.ringing = on;
    const g = this.phone.gain.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0, t);
    if (on) {
      for (let k = 0; k < 12; k++) {
        const s = t + k * 3;
        g.setValueAtTime(0, s);
        g.linearRampToValueAtTime(0.35, s + 0.02);
        g.setValueAtTime(0.35, s + 0.4);
        g.linearRampToValueAtTime(0, s + 0.42);
        g.setValueAtTime(0, s + 0.6);
        g.linearRampToValueAtTime(0.35, s + 0.62);
        g.setValueAtTime(0.35, s + 1.0);
        g.linearRampToValueAtTime(0, s + 1.02);
      }
    }
  }

  private radio(out: GainNode) {
    const ctx = this.ctx!;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1100;
    band.Q.value = 0.9;
    band.connect(out);
    const hiss = this.loopSource(this.noise);
    const hg = ctx.createGain();
    hg.gain.value = 0.04;
    hiss.connect(hg).connect(band);
    out.gain.value = 0.55;
    // a slow waltz in a minor key, looping from the same bar
    const notes = [57, 60, 64, 62, 60, 57, 55, 57, 53, 57, 60, 59, 57];
    const chords = [[45, 52, 57], [41, 48, 53], [43, 50, 55], [40, 47, 52]];
    const beat = 0.62;
    const play = () => {
      if (!this.ctx) return;
      const t0 = ctx.currentTime + 0.1;
      notes.forEach((n, i) => this.tone(band, n, t0 + i * beat * 1.5, beat * 1.4, 0.05, 'triangle'));
      for (let b = 0; b < 7; b++) {
        const ch = chords[b % chords.length];
        ch.forEach((n) => this.tone(band, n, t0 + b * beat * 3, beat * 0.9, 0.018, 'sine'));
        ch.forEach((n) => this.tone(band, n + 12, t0 + b * beat * 3 + beat, beat * 0.5, 0.01, 'sine'));
        ch.forEach((n) => this.tone(band, n + 12, t0 + b * beat * 3 + beat * 2, beat * 0.5, 0.01, 'sine'));
      }
      setTimeout(play, notes.length * beat * 1.5 * 1000);
    };
    play();
  }

  private tone(dest: AudioNode, midi: number, t: number, dur: number, vol: number, type: OscillatorType) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /* ── cars ─────────────────────────────────────────────────── */

  carVoice(): { setPosition(p: THREE.Vector3, speed: number): void; mute(): void } | undefined {
    if (!this.ctx) return undefined;
    const ctx = this.ctx;
    const panner = new PannerNode(ctx, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 4, rolloffFactor: 1.4, maxDistance: 150 });
    const n = this.loopSource(this.brown);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 380;
    const hiss = this.loopSource(this.noise);
    const hf = ctx.createBiquadFilter();
    hf.type = 'bandpass';
    hf.frequency.value = 2400;
    hf.Q.value = 0.7;
    const hg = ctx.createGain();
    hg.gain.value = 0.06;
    const g = ctx.createGain();
    g.gain.value = 0;
    n.connect(f).connect(g);
    hiss.connect(hf).connect(hg).connect(g);
    g.connect(panner).connect(this.amb);
    return {
      setPosition: (p, speed) => {
        const t = ctx.currentTime;
        panner.positionX.setTargetAtTime(p.x, t, 0.05);
        panner.positionY.setTargetAtTime(0.5, t, 0.05);
        panner.positionZ.setTargetAtTime(p.z, t, 0.05);
        g.gain.setTargetAtTime(0.25 + speed * 0.05, t, 0.2);
        f.frequency.setTargetAtTime(200 + speed * 30, t, 0.2);
      },
      mute: () => g.gain.setTargetAtTime(0, ctx.currentTime, 0.3),
    };
  }

  /* ── one-shots ────────────────────────────────────────────── */

  footstep(intensity: number, wet = true) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900 + Math.random() * 700;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    const v = 0.14 * intensity * (0.8 + Math.random() * 0.4);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 3, 0.12);
    // heel thump
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.06);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.12 * intensity, t + 0.005);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(og).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.1);
    if (wet) {
      const s2 = ctx.createBufferSource();
      s2.buffer = this.noise;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3200;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.0001, t + 0.01);
      g2.gain.exponentialRampToValueAtTime(0.05 * intensity, t + 0.02);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      s2.connect(hp).connect(g2).connect(this.sfx);
      s2.start(t, Math.random() * 3, 0.2);
    }
  }

  land(v: number) {
    this.footstep(Math.min(1.6, v / 5));
  }

  /** Where outside audio (the car radio) joins the mix: after the volume, before the pause muffle. */
  get output(): AudioNode | null {
    return this.ctx ? this.master : null;
  }

  /** A metal-on-metal crunch for a car hitting something. */
  crash(strength: number) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900 + Math.random() * 600;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5 * strength + 0.15, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35 + strength * 0.4);
    src.connect(bp).connect(g).connect(this.sfx);
    g.connect(this.reverbIn);
    src.start(t, Math.random() * 2, 1);
    this.footstep(1.2 + strength, false);
  }

  /**
   * A car horn: two detuned reeds through a small box. `pos` places it in the
   * street (traffic); without it the horn is your own, right in front of you.
   */
  hornVoice(): { on(p?: THREE.Vector3): void; off(): void } | undefined {
    if (!this.ctx) return undefined;
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0;
    const shape = ctx.createBiquadFilter();
    shape.type = 'bandpass';
    shape.frequency.value = 1100;
    shape.Q.value = 0.6;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    for (const f of [405, 507]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f * (0.99 + Math.random() * 0.02);
      o.connect(shape);
      o.start();
    }
    const panner = new PannerNode(ctx, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 5, rolloffFactor: 1.2, maxDistance: 200 });
    shape.connect(lp).connect(g).connect(panner).connect(this.sfx);
    g.connect(this.reverbIn);
    return {
      on: (p) => {
        const t = ctx.currentTime;
        const lp2 = p ?? (ctx.listener.positionX ? new THREE.Vector3(ctx.listener.positionX.value, ctx.listener.positionY.value, ctx.listener.positionZ.value) : new THREE.Vector3());
        panner.positionX.setValueAtTime(lp2.x, t);
        panner.positionY.setValueAtTime(p ? 0.8 : lp2.y, t);
        panner.positionZ.setValueAtTime(lp2.z, t);
        g.gain.cancelScheduledValues(t);
        g.gain.setTargetAtTime(p ? 0.35 : 0.22, t, 0.012);
      },
      off: () => {
        const t = ctx.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setTargetAtTime(0, t, 0.03);
      },
    };
  }

  /** A gunshot: a hard crack, a chest thump, and the street throwing it back. null pos = yours. */
  gunshot(pos: THREE.Vector3 | null, kind: 'pistol' | 'smg' | 'cop' = 'pistol') {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = ctx.createGain();
    let dest: AudioNode = this.sfx;
    if (pos) {
      const pan = new PannerNode(ctx, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 6, rolloffFactor: 1.1, maxDistance: 400 });
      pan.positionX.value = pos.x;
      pan.positionY.value = pos.y + 1.4;
      pan.positionZ.value = pos.z;
      out.connect(pan).connect(this.sfx);
      dest = pan;
    } else out.connect(this.sfx);
    void dest;
    const vol = kind === 'smg' ? 0.55 : 0.8;
    // crack
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    n.playbackRate.value = 0.8 + Math.random() * 0.4;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = kind === 'smg' ? 1900 : 1300;
    bp.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(vol, t + 0.002);
    ng.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'smg' ? 0.09 : 0.16));
    n.connect(bp).connect(ng).connect(out);
    n.start(t, Math.random());
    n.stop(t + 0.3);
    // thump
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.12);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vol * 0.9, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 0.2);
    // the buildings answer
    const send = ctx.createGain();
    send.gain.value = 0.9;
    out.connect(send).connect(this.reverbIn);
  }

  /** A fist landing (or not). */
  punch(hit: boolean) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(hit ? 120 : 300, t);
    o.frequency.exponentialRampToValueAtTime(hit ? 50 : 180, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(hit ? 0.7 : 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.15);
  }

  private sirenNodes: { g: GainNode; o: OscillatorNode } | null = null;
  /** Police sirens somewhere nearby; 0 = none. */
  siren(level: number) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    if (!this.sirenNodes) {
      if (level <= 0) return;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 1.1;
      const lg = ctx.createGain();
      lg.gain.value = 170;
      o.frequency.value = 780;
      lfo.connect(lg).connect(o.frequency);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1600;
      const g = ctx.createGain();
      g.gain.value = 0;
      o.connect(lp).connect(g).connect(this.sfx);
      g.connect(this.reverbIn);
      o.start();
      lfo.start();
      this.sirenNodes = { g, o };
    }
    this.sirenNodes.g.gain.setTargetAtTime(Math.min(1, level) * 0.06, ctx.currentTime, 0.8);
  }

  private heliNodes: { g: GainNode; pan: PannerNode } | null = null;
  /** A helicopter's rotor chop from `pos` (null: silent). */
  heli(pos: THREE.Vector3 | null) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    if (!this.heliNodes) {
      if (!pos) return;
      const n = this.loopSource(this.brown);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 520;
      const chop = ctx.createGain();
      chop.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.type = 'sawtooth';
      lfo.frequency.value = 11.5;
      const depth = ctx.createGain();
      depth.gain.value = 0.5;
      lfo.connect(depth).connect(chop.gain);
      lfo.start();
      const g = ctx.createGain();
      g.gain.value = 0;
      const pan = new PannerNode(ctx, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 25, rolloffFactor: 1, maxDistance: 600 });
      n.connect(lp).connect(chop).connect(g).connect(pan).connect(this.sfx);
      this.heliNodes = { g, pan };
    }
    const t = ctx.currentTime;
    const { g, pan } = this.heliNodes;
    if (pos) {
      pan.positionX.setTargetAtTime(pos.x, t, 0.1);
      pan.positionY.setTargetAtTime(pos.y, t, 0.1);
      pan.positionZ.setTargetAtTime(pos.z, t, 0.1);
    }
    g.gain.setTargetAtTime(pos ? 1.1 : 0, t, 0.6);
  }

  /** Someone says something (audio/Voice.ts). Returns the seconds it takes, 0 if there's no sound. */
  say(voice: VoiceSpec, text: string, mood: Mood, pos: THREE.Vector3 | null, gain = 1): number {
    if (!this.ctx || !this.enabled) return 0;
    const d = speak(this.ctx, this.sfx, this.noise, voice, text, mood, pos, gain);
    return d;
  }

  /** Discovery: a single struck bell, left to ring out. */
  bell() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.05;
    const base = 392;
    [1, 2.76, 5.4, 8.9].forEach((ratio, i) => {
      const o = ctx.createOscillator();
      o.frequency.value = base * ratio;
      const g = ctx.createGain();
      const v = [0.09, 0.04, 0.02, 0.008][i];
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 5 - i);
      o.connect(g);
      g.connect(this.sfx);
      g.connect(this.reverbIn);
      o.start(t);
      o.stop(t + 5.2);
    });
  }

  /** The loop reset: the whole district's power sags. */
  sag() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 1.6);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    o.connect(f).connect(g).connect(this.sfx);
    g.connect(this.reverbIn);
    o.start(t);
    o.stop(t + 2.4);
    this.amb.gain.setValueAtTime(this.amb.gain.value, t);
    this.amb.gain.linearRampToValueAtTime(0.05, t + 0.3);
    this.amb.gain.linearRampToValueAtTime(this.volumes.ambience, t + 2.6);
  }

  uiTick() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.value = 2100;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.012, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.05);
  }

  /* ── score: sparse pads, mostly silence ───────────────────── */

  private phrase() {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.value = 1;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    out.connect(lp);
    lp.connect(this.music);
    lp.connect(this.reverbIn);
    const progression = [
      [50, 57, 62, 65],
      [46, 53, 58, 62],
      [48, 55, 60, 64],
      [45, 52, 57, 60],
    ];
    const len = 7.5;
    const t0 = ctx.currentTime + 0.2;
    progression.forEach((ch, i) => {
      ch.forEach((n, k) => {
        for (const det of [-6, 6]) {
          const o = ctx.createOscillator();
          o.type = 'triangle';
          o.frequency.value = 440 * Math.pow(2, (n - 69) / 12);
          o.detune.value = det + k;
          const g = ctx.createGain();
          const s = t0 + i * len;
          g.gain.setValueAtTime(0.0001, s);
          g.gain.exponentialRampToValueAtTime(0.022, s + 2.8);
          g.gain.setValueAtTime(0.022, s + len - 1.2);
          g.gain.exponentialRampToValueAtTime(0.0001, s + len + 2.2);
          o.connect(g).connect(out);
          o.start(s);
          o.stop(s + len + 2.4);
        }
      });
      // a single high note, sometimes
      if (i % 2 === 1) this.tone(out, progression[i][3] + 12, t0 + i * len + 2, 4.5, 0.012, 'sine');
    });
    return progression.length * len + 3;
  }

  update(dt: number, cam: THREE.Camera, rain: number) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const l = ctx.listener;
    const p = cam.position;
    const f = new THREE.Vector3();
    cam.getWorldDirection(f);
    const t = ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.03);
      l.positionY.setTargetAtTime(p.y, t, 0.03);
      l.positionZ.setTargetAtTime(p.z, t, 0.03);
      l.forwardX.setTargetAtTime(f.x, t, 0.03);
      l.forwardY.setTargetAtTime(f.y, t, 0.03);
      l.forwardZ.setTargetAtTime(f.z, t, 0.03);
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    }
    this.rain.setIntensity(rain);

    // music: a phrase, then a long silence. More present on the title screen.
    this.musicTimer -= dt;
    if (this.musicTimer <= 0) {
      if (!this.musicPlaying) {
        const d = this.phrase();
        this.musicPlaying = true;
        this.musicTimer = d;
      } else {
        this.musicPlaying = false;
        this.musicTimer = this.landingMode ? 4 : 70 + Math.random() * 60;
      }
    }
  }

  /* ── buffers ──────────────────────────────────────────────── */

  private loopSource(buf: AudioBuffer) {
    const s = this.ctx!.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start(0, Math.random() * buf.duration);
    return s;
  }

  private makeNoise(kind: 'white' | 'brown') {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'white') d[i] = w;
        else {
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.5;
        }
      }
    }
    return buf;
  }

  private impulse(seconds: number, decay: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
}
