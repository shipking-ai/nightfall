import * as THREE from 'three';
import { readJSON, writeJSON } from '../core/storage';

export interface Station {
  id: string;
  name: string;
  url: string;
  /** a line under the name: genre, city */
  note: string;
  /** SomaFM channel id: enables "now playing" */
  soma?: string;
  /** Radio Browser uuid: we report a click when it's played, as their API asks */
  rb?: string;
}

const soma = (id: string, name: string, note: string, server = 1): Station => ({
  id: `soma-${id}`,
  name,
  note: `SomaFM · ${note}`,
  url: `https://ice${server}.somafm.com/${id}-128-mp3`,
  soma: id,
});

/**
 * Real, live, listener-supported internet radio. SomaFM (San Francisco,
 * commercial-free) fits the city at 3 a.m.; anything else can be found in
 * Settings through the Radio Browser directory and saved here.
 */
export const PRESETS: Station[] = [
  soma('dronezone', 'Drone Zone', 'ambient, atmospheric'),
  soma('deepspaceone', 'Deep Space One', 'deep ambient, space', 2),
  soma('darkzone', 'The Dark Zone', 'dark ambient'),
  soma('secretagent', 'Secret Agent', 'spy lounge, downtempo'),
  soma('sonicuniverse', 'Sonic Universe', 'nu jazz, avant-garde', 2),
  soma('groovesalad', 'Groove Salad', 'downtempo, chill', 4),
  soma('lush', 'Lush', 'mellow vocals, electronic'),
  soma('vaporwaves', 'Vaporwaves', 'vaporwave'),
  soma('defcon', 'DEF CON Radio', 'music for hacking'),
];

const FAV_KEY = 'nightfall.radio.v1';
const RB = 'https://de1.api.radio-browser.info/json';

export interface RadioResult {
  uuid: string;
  name: string;
  url: string;
  country: string;
  tags: string;
  bitrate: number;
}

/** Search the Radio Browser directory (community-run, 30k+ stations). https only: the game is served over https. */
export async function searchStations(q: string): Promise<RadioResult[]> {
  const run = async (field: 'name' | 'tag') => {
    const u = `${RB}/stations/search?${field}=${encodeURIComponent(q)}&limit=24&hidebroken=true&order=clickcount&reverse=true`;
    const res = await fetch(u);
    if (!res.ok) throw new Error('The station directory did not answer.');
    const rows = (await res.json()) as { stationuuid: string; name: string; url_resolved: string; country: string; tags: string; bitrate: number; codec: string }[];
    return rows
      .filter((r) => r.url_resolved?.startsWith('https://') && /mp3|aac/i.test(r.codec))
      .map((r) => ({ uuid: r.stationuuid, name: r.name.trim(), url: r.url_resolved, country: r.country, tags: r.tags, bitrate: r.bitrate }));
  };
  const byName = await run('name');
  if (byName.length >= 6) return byName.slice(0, 12);
  const byTag = await run('tag');
  const seen = new Set(byName.map((r) => r.uuid));
  return [...byName, ...byTag.filter((r) => !seen.has(r.uuid))].slice(0, 12);
}

/**
 * The car radio. One set, which lives in whichever car you last turned it on
 * in: inside, it's close and full; step out and it keeps playing from the car,
 * thin and far away, as you walk off.
 */
export class Radio {
  favourites: Station[] = readJSON<Station[]>(FAV_KEY) ?? [];
  /** index into `stations`, -1 = off */
  index = -1;
  nowPlaying = '';
  status: 'off' | 'tuning' | 'playing' | 'no-signal' = 'off';
  onChange: (() => void) | null = null;
  /** routed through Web Audio (filtered, positioned): needs the station to allow CORS */
  private el: HTMLAudioElement | null = null;
  /** fallback for stations without CORS: a plain element, level and distance done by hand */
  private plain: HTMLAudioElement | null = null;
  private usingPlain = false;
  private graph: { tone: BiquadFilterNode; gain: GainNode; panner: PannerNode } | null = null;
  private master = 0.8;
  private plainLevel = 1;
  private volume = 0.7;
  private inside = true;
  private pollTimer = 0;

  get stations(): Station[] {
    return [...PRESETS, ...this.favourites];
  }

  get station(): Station | null {
    return this.index >= 0 ? this.stations[this.index] ?? null : null;
  }

  addFavourite(r: RadioResult) {
    if (this.favourites.some((f) => f.rb === r.uuid)) return;
    this.favourites.push({ id: `rb-${r.uuid}`, name: r.name, url: r.url, note: [r.country, r.tags.split(',').slice(0, 2).join(', ')].filter(Boolean).join(' · '), rb: r.uuid });
    writeJSON(FAV_KEY, this.favourites);
  }

  removeFavourite(id: string) {
    const cur = this.station?.id;
    this.favourites = this.favourites.filter((f) => f.id !== id);
    writeJSON(FAV_KEY, this.favourites);
    if (cur === id) this.off();
    else if (cur) this.index = this.stations.findIndex((s) => s.id === cur);
  }

  setVolume(v: number) {
    this.volume = v;
    this.applyLevel();
  }

  /** Next station; after the last one, off. */
  next(ctx: AudioContext, out: AudioNode, dir = 1) {
    const n = this.stations.length;
    let i = this.index + dir;
    if (i >= n) i = -1;
    if (i < -1) i = n - 1;
    this.tune(ctx, out, i);
  }

  tune(ctx: AudioContext, out: AudioNode, i: number) {
    this.index = i;
    const st = this.station;
    this.nowPlaying = '';
    if (!st) return this.off();
    this.ensure(ctx, out);
    this.status = 'tuning';
    this.usingPlain = false;
    this.plain!.pause();
    this.plain!.removeAttribute('src');
    const el = this.el!;
    el.src = st.url;
    el.play().catch(() => this.fallback());
    if (st.rb) fetch(`${RB}/url/${st.rb}`).catch(() => {});
    this.pollTimer = 0;
    this.onChange?.();
  }

  off() {
    this.index = -1;
    this.status = 'off';
    this.nowPlaying = '';
    for (const el of [this.el, this.plain]) {
      if (!el) continue;
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    this.usingPlain = false;
    this.onChange?.();
  }

  /** The station won't share its stream with Web Audio: play it directly instead. */
  private fallback() {
    const st = this.station;
    if (!st || !this.plain) return;
    if (this.usingPlain) {
      this.status = 'no-signal';
      this.onChange?.();
      return;
    }
    this.usingPlain = true;
    this.el!.pause();
    this.el!.removeAttribute('src');
    this.applyLevel();
    this.plain.src = st.url;
    this.plain.play().catch(() => {
      if (this.station !== st) return;
      this.status = 'no-signal';
      this.onChange?.();
    });
  }

  /** Suspend with the rest of the sound (sound off, tab hidden); resume where it was. */
  setAudible(on: boolean) {
    const el = this.usingPlain ? this.plain : this.el;
    if (!el || this.index < 0 || this.status === 'no-signal') return;
    if (on && el.paused) el.play().catch(() => {});
    if (!on && !el.paused) el.pause();
  }

  /** Every frame: where the set is, and whether you're sitting next to it. */
  update(dt: number, carPos: THREE.Vector3 | null, inside: boolean, listener?: THREE.Vector3, master = this.master, muffled = false) {
    if (!this.graph || !this.el) return;
    this.master = master;
    if (this.usingPlain && this.plain) {
      // no filters on a plain element: fall off with distance, duck behind menus
      const d = carPos && listener && !inside ? carPos.distanceTo(listener) : 0;
      const falloff = inside ? 0.9 : 0.5 * Math.min(1, 6 / Math.max(6, d)) * (d > 90 ? 0 : 1);
      const want = this.volume * master * falloff * (muffled ? 0.35 : 1);
      this.plainLevel += (want - this.plainLevel) * Math.min(1, dt * 4);
      this.plain.volume = Math.max(0, Math.min(1, this.plainLevel));
    }
    const ctx = this.graph.panner.context;
    const t = ctx.currentTime;
    if (carPos) {
      this.graph.panner.positionX.setTargetAtTime(carPos.x, t, 0.05);
      this.graph.panner.positionY.setTargetAtTime(carPos.y + 1, t, 0.05);
      this.graph.panner.positionZ.setTargetAtTime(carPos.z, t, 0.05);
    }
    if (inside !== this.inside) {
      this.inside = inside;
      // inside: full range, no distance falloff; outside: through glass and steel
      this.graph.tone.frequency.setTargetAtTime(inside ? 16000 : 1400, t, 0.15);
      this.graph.panner.rolloffFactor = inside ? 0 : 1.3;
      this.applyLevel();
    }
    if (this.station?.soma && this.status === 'playing') {
      this.pollTimer -= dt;
      if (this.pollTimer <= 0) {
        this.pollTimer = 30;
        this.fetchNowPlaying(this.station);
      }
    }
  }

  private applyLevel() {
    if (!this.graph) return;
    const ctx = this.graph.gain.context;
    this.graph.gain.gain.setTargetAtTime(this.volume * (this.inside ? 0.9 : 1.6), ctx.currentTime, 0.1);
  }

  private ensure(ctx: AudioContext, out: AudioNode) {
    if (this.el) return;
    const el = new Audio();
    el.crossOrigin = 'anonymous'; // needed to route a stream through Web Audio
    el.setAttribute('referrerpolicy', 'no-referrer'); // some stations refuse unknown referrers (SomaFM rejects localhost)
    el.preload = 'none';
    el.addEventListener('playing', () => {
      this.status = 'playing';
      this.onChange?.();
    });
    el.addEventListener('error', () => {
      if (this.index < 0 || this.usingPlain) return;
      this.fallback();
    });
    const plain = new Audio();
    plain.setAttribute('referrerpolicy', 'no-referrer');
    plain.preload = 'none';
    plain.addEventListener('playing', () => {
      this.status = 'playing';
      this.onChange?.();
    });
    plain.addEventListener('error', () => {
      if (this.index < 0 || !this.usingPlain) return;
      this.status = 'no-signal';
      this.onChange?.();
    });
    this.plain = plain;
    const src = ctx.createMediaElementSource(el);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 70;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 16000;
    const gain = ctx.createGain();
    gain.gain.value = this.volume;
    const panner = new PannerNode(ctx, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 3, rolloffFactor: 0, maxDistance: 120 });
    src.connect(hp).connect(tone).connect(gain).connect(panner).connect(out);
    this.el = el;
    this.graph = { tone, gain, panner };
    this.applyLevel();
  }

  private async fetchNowPlaying(st: Station) {
    try {
      const res = await fetch(`https://somafm.com/songs/${st.soma}.json`);
      const j = (await res.json()) as { songs?: { artist: string; title: string }[] };
      const s = j.songs?.[0];
      if (s && this.station === st) {
        const line = [s.artist, s.title].filter(Boolean).join(' — ');
        if (line !== this.nowPlaying) {
          this.nowPlaying = line;
          this.onChange?.();
        }
      }
    } catch {
      /* the song title is a nicety */
    }
  }
}
