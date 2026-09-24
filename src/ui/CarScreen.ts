import { h, setOn } from './dom';

/* The bits of the YouTube IFrame Player API we use. */
interface YTPlayer {
  loadVideoById(id: string): void;
  loadPlaylist(o: { listType: 'playlist'; list: string }): void;
  playVideo(): void;
  pauseVideo(): void;
  setVolume(v: number): void;
  getPlayerState(): number;
  getVideoData?(): { title?: string; author?: string };
}
interface YTNamespace {
  Player: new (el: HTMLElement, o: object) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiReady: Promise<YTNamespace> | null = null;
function loadApi(): Promise<YTNamespace> {
  if (apiReady) return apiReady;
  apiReady = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    window.onYouTubeIframeAPIReady = () => resolve(window.YT!);
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => {
      apiReady = null;
      reject(new Error('YouTube could not be reached.'));
    };
    document.head.append(s);
  });
  return apiReady;
}

/** Anything a person might paste: watch/share/shorts/live/embed links, a playlist, or a bare id. */
export function parseYouTube(input: string): { video?: string; list?: string } | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return { video: s };
  let u: URL;
  try {
    u = new URL(s.startsWith('http') ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (!/(^|\.)youtube(-nocookie)?\.com$|(^|\.)youtu\.be$/.test(u.hostname)) return null;
  const list = u.searchParams.get('list') ?? undefined;
  let video = u.searchParams.get('v') ?? undefined;
  if (!video) {
    const m = u.pathname.match(/^\/(?:embed\/|shorts\/|live\/|v\/)?([\w-]{11})/);
    if (m && (u.hostname.endsWith('youtu.be') || /^\/(embed|shorts|live|v)\//.test(u.pathname))) video = m[1];
  }
  if (!video && !list) return null;
  return { video, list };
}

/** YouTube IFrame API error codes, in words. */
const ERRORS: Record<number, string> = {
  2: 'That link doesn’t point at a video.',
  5: 'This browser can’t play that video.',
  100: 'That video has been removed or made private.',
  101: 'Its owner doesn’t allow it to play outside YouTube. Try another.',
  150: 'Its owner doesn’t allow it to play outside YouTube. Try another.',
  153: 'YouTube refused this page. Try again from the published site.',
};

// all checked to play when embedded (Lofi Girl's main stream, jfKfPfyJRdk, refuses embeds: error 150)
const PICKS: { label: string; id: string }[] = [
  { label: 'lofi hip hop radio', id: '7NOSDKb0HlU' },
  { label: 'Chillhop radio', id: '5yx6BWlEVcY' },
  { label: 'synthwave radio', id: '4xDzrJKXOOY' },
  { label: 'dark ambient radio', id: 'S_MOd40zlYU' },
  { label: '1 A.M. study session', id: 'lTRiuFIWV54' },
  { label: 'lofi jazz', id: 'CfPxlb8-ZQ0' },
];

/**
 * The centre screen in the electric cars: a real YouTube player on the
 * dashboard. Small and always visible while it plays (YouTube's embeds must
 * stay on screen); V opens it big, releases the mouse, and takes a link.
 */
export class CarScreen {
  el: HTMLElement;
  isOpen = false;
  onOpenChange: ((open: boolean) => void) | null = null;
  /** the screen turned something on: the car radio should go quiet */
  onPlay: (() => void) | null = null;
  private frame: HTMLElement;
  private mount: HTMLElement;
  private empty: HTMLElement;
  private input: HTMLInputElement;
  private status: HTMLElement;
  private player: YTPlayer | null = null;
  private creating: Promise<YTPlayer> | null = null;
  private loaded = false;
  private shown = false;
  private volume = 60;

  constructor(root: HTMLElement) {
    this.mount = h('div', { class: 'carscreen__mount' });
    this.empty = h(
      'div',
      { class: 'carscreen__empty' },
      h('span', { class: 'meta' }, 'Screen'),
      h('p', {}, 'Paste a YouTube link, or pick something below.'),
    );
    this.frame = h('div', { class: 'carscreen__frame' }, this.mount, this.empty);
    this.input = h('input', { type: 'text', class: 'settings__code-input', placeholder: 'Paste a YouTube link', 'aria-label': 'YouTube link', spellcheck: 'false' }) as HTMLInputElement;
    this.status = h('span', { class: 'setting__desc', 'aria-live': 'polite' });
    const play = h('button', { class: 'carscreen__btn' }, 'Play');
    play.addEventListener('click', () => this.submit());
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.submit();
      if (e.key === 'Escape') this.close();
    });
    const picks = h(
      'div',
      { class: 'carscreen__picks' },
      ...PICKS.map((p) => {
        const b = h('button', { class: 'carscreen__btn' }, p.label);
        b.addEventListener('click', () => this.play({ video: p.id }));
        return b;
      }),
    );
    const close = h('button', { class: 'carscreen__btn' }, 'Back to the road', h('span', { class: 'key' }, 'V'));
    close.addEventListener('click', () => this.close());
    this.el = h(
      'section',
      { class: 'layer carscreen', role: 'region', 'aria-label': 'Car screen' },
      this.frame,
      h('div', { class: 'carscreen__bar' }, h('div', { class: 'settings__code' }, this.input, play), picks, h('div', { class: 'carscreen__foot' }, this.status, close)),
    );
    root.append(this.el);
    // capture phase: while open, V and Esc belong to the screen, not the game
    addEventListener(
      'keydown',
      (e) => {
        if (!this.isOpen || e.repeat) return;
        if (e.code === 'KeyV' || e.code === 'Escape') {
          e.stopImmediatePropagation();
          e.preventDefault();
          this.close();
        }
      },
      true,
    );
  }

  /** In a car with a screen: show it (small), or hide it when you get out. */
  show(on: boolean) {
    if (on === this.shown) return;
    this.shown = on;
    if (!on) {
      this.close();
      this.player?.pauseVideo();
    } else if (this.loaded) this.player?.playVideo();
    this.render();
  }

  open() {
    if (!this.shown || this.isOpen) return;
    this.isOpen = true;
    this.render();
    this.onOpenChange?.(true);
    setTimeout(() => this.input.focus(), 50);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.input.blur();
    this.render();
    this.onOpenChange?.(false);
  }

  /** The car radio came on: the screen goes quiet. */
  pause() {
    this.player?.pauseVideo();
  }

  setVolume(v01: number) {
    const v = Math.round(Math.max(0, Math.min(1, v01)) * 100);
    if (v === this.volume) return;
    this.volume = v;
    this.player?.setVolume(v);
  }

  private render() {
    setOn(this.el, this.shown && (this.isOpen || this.loaded));
    this.el.classList.toggle('is-open', this.isOpen);
    this.empty.hidden = this.loaded;
  }

  private submit() {
    const parsed = parseYouTube(this.input.value);
    if (!parsed) {
      this.status.textContent = 'That doesn’t look like a YouTube link.';
      return;
    }
    this.play(parsed);
  }

  private async play(p: { video?: string; list?: string }) {
    this.status.textContent = 'Loading…';
    try {
      const player = await this.ensure();
      if (p.list && !p.video) player.loadPlaylist({ listType: 'playlist', list: p.list });
      else player.loadVideoById(p.video!);
      player.setVolume(this.volume);
      this.loaded = true;
      this.input.value = '';
      this.status.textContent = '';
      this.onPlay?.();
      this.render();
    } catch (err) {
      this.status.textContent = (err as Error).message;
    }
  }

  private ensure(): Promise<YTPlayer> {
    if (this.player) return Promise.resolve(this.player);
    if (this.creating) return this.creating;
    this.creating = loadApi().then(
      (YT) =>
        new Promise<YTPlayer>((resolve) => {
          const target = h('div');
          this.mount.append(target);
          const player: YTPlayer = new YT.Player(target, {
            host: 'https://www.youtube-nocookie.com',
            width: '100%',
            height: '100%',
            playerVars: { playsinline: 1, rel: 0, modestbranding: 1, autoplay: 1 },
            events: {
              onReady: () => {
                this.player = player;
                resolve(player);
              },
              onError: (e: { data: number }) => (this.status.textContent = ERRORS[e.data] ?? 'YouTube couldn’t play that one.'),
            },
          });
        }),
    );
    return this.creating;
  }
}
