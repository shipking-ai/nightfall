import { browserStore, type SaveStore } from '../rpg/game/saves';

/**
 * Everything the game needs from the machine it runs on, behind one small
 * interface: where saves go, milestones worth recording, a line for the
 * system's "what are they doing" display, and being told when the game is
 * sent to the background.
 *
 * Only the browser implementation exists. A console or store build replaces
 * it with one that calls that platform's own services, from a native shell
 * built with that platform's official SDK (which is licensed to registered
 * developers and is never bundled into this web build). Nothing here imitates
 * or guesses at those APIs; see docs/platforms.md.
 */
export interface Platform {
  readonly id: 'web' | string;
  /** where the RPG's save slots live */
  readonly storage: SaveStore;
  /** a milestone (trophies / achievements on a platform that has them). Idempotent. */
  achievement(id: AchievementId): void;
  /** what the player is doing, for a presence line ("In Old Yargate"). May be ignored. */
  presence(text: string | null): void;
  /** called with true when the game goes to the background (and false when it's back) */
  onSuspend(fn: (suspended: boolean) => void): void;
  /** the platform's account name, if it has one (the web has none: the game asks) */
  userName(): string | null;
}

/** The milestones: a fixed list, so a platform build can map each to its own service's entry. */
export const ACHIEVEMENTS = {
  'first-town': 'Reached the first town',
  'first-job': 'Finished a job',
  'the-watcher': 'Saw the watcher four times',
  'long-night': 'Finished The Long Night',
  'hunter': 'Butchered your first kill',
  'angler': 'Landed a fish',
  'cartographer': 'Charted 100 km² of the country',
} as const;
export type AchievementId = keyof typeof ACHIEVEMENTS;

const KEY = 'nightfall.achievements';

/** The browser: saves in local storage, milestones remembered locally (no network), the page's visibility. */
class WebPlatform implements Platform {
  readonly id = 'web';
  readonly storage = browserStore;
  private got = new Set<string>();

  constructor() {
    try {
      for (const a of JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]) this.got.add(a);
    } catch {
      /* private window: start empty */
    }
  }

  achievement(id: AchievementId) {
    if (this.got.has(id)) return;
    this.got.add(id);
    try {
      localStorage.setItem(KEY, JSON.stringify([...this.got]));
    } catch {
      /* not kept: fine */
    }
    for (const fn of this.listeners) fn(id);
  }

  /** the game shows its own toast for a milestone on the web */
  private listeners: ((id: AchievementId) => void)[] = [];
  onAchievement(fn: (id: AchievementId) => void) {
    this.listeners.push(fn);
  }

  has(id: AchievementId) {
    return this.got.has(id);
  }

  presence(_text: string | null) {
    // the web has no presence service
  }

  onSuspend(fn: (suspended: boolean) => void) {
    document.addEventListener('visibilitychange', () => fn(document.visibilityState === 'hidden'));
  }

  userName() {
    return null;
  }
}

export const web = new WebPlatform();

/** The platform this build runs on. */
export const platform: Platform & Partial<Pick<WebPlatform, 'onAchievement' | 'has'>> = web;
