import { idleIntent, type Fighter, type Intent } from './Fighter';
import { PARRY_WINDOW } from './moves';

/**
 * The CPU opponent. It plays by the same rules as you: the same moves, the
 * same frame data, and a reaction time. It only knows an attack is coming
 * once it has been coming for `react` frames, so a fast jab gets through a
 * slow opponent and a slow overhand doesn't.
 *
 * It has a sense of spacing (it wants to stand just outside your jab), it
 * punishes what it blocks, it finishes the combos it starts, and on the
 * harder levels it parries and sidesteps. It doesn't read your inputs.
 */
export type Level = 'easy' | 'normal' | 'hard';

interface Style {
  /** frames before it sees an attack coming */
  react: number;
  block: number;
  parry: number;
  side: number;
  punish: number;
  /** how far into a string it goes */
  combo: number;
  /** how often it starts something in neutral */
  aggro: number;
  breaker: number;
}

const STYLES: Record<Level, Style> = {
  easy: { react: 24, block: 0.25, parry: 0, side: 0.05, punish: 0.2, combo: 0.3, aggro: 0.3, breaker: 0 },
  normal: { react: 15, block: 0.55, parry: 0.1, side: 0.15, punish: 0.55, combo: 0.65, aggro: 0.5, breaker: 0.35 },
  hard: { react: 10, block: 0.8, parry: 0.3, side: 0.3, punish: 0.9, combo: 0.95, aggro: 0.65, breaker: 0.8 },
};

type Press = 'light' | 'heavy' | 'special' | 'grab' | 'dodge' | 'jump';
interface Queued {
  p: Press;
  /** 'up' / 'down' on the stick, 'fwd' / 'back' along the fight */
  dir?: 'up' | 'down' | 'fwd' | 'back';
  at: number;
}

export const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

export class FightAI {
  private seen = 0;
  private block = 0;
  private queue: Queued[] = [];
  private f = 0;
  private walk = 0;
  private walkT = 0;
  private circle = 0;
  private think = 30;
  /** how often we've been blocked lately (grabs beat a turtle) */
  private turtle = 0;
  private breakerRoll = false;

  constructor(public level: Level = 'normal') {}

  reset() {
    this.queue.length = 0;
    this.block = this.walkT = 0;
    this.think = 40;
    this.seen = 0;
  }

  intent(me: Fighter, opp: Fighter): Intent {
    const i = idleIntent();
    const s = STYLES[this.level];
    this.f++;
    const d = me.distance();
    const ux = (opp.pos.x - me.pos.x) / Math.max(d, 1e-3), uz = (opp.pos.z - me.pos.z) / Math.max(d, 1e-3);
    const along = (k: number) => {
      i.wx = ux * k;
      i.wz = uz * k;
    };
    const free = me.state === 'idle' || me.state === 'block';

    // the finisher: walk up to them and take it
    if (opp.state === 'dizzy') {
      if (d > 1.4) along(1);
      else if (this.f % 20 === 0) i.special = true;
      return i;
    }
    if (me.state === 'dizzy' || me.state === 'ko' || me.state === 'win' || me.state === 'lose') return i;

    // queued presses (the rest of a combo)
    const q = this.queue[0];
    if (q && this.f >= q.at) {
      this.queue.shift();
      this.press(i, q.p, q.dir, ux, uz);
    }

    // they're coming at us: block, parry, sidestep, or eat it
    const mv = opp.move;
    const coming = opp.state === 'attack' && mv && !opp.hitDone && opp.f < mv.startup + mv.active;
    this.seen = coming ? this.seen + 1 : 0;
    if (coming && this.seen === s.react && free && d < mv.reach + 0.6 && mv.id !== 'grab') {
      const left = mv.startup - opp.f;
      const r = Math.random();
      if (left <= PARRY_WINDOW) {
        if (r < s.parry) this.block = left + 6;
      } else if (r < s.block) this.block = mv.startup + mv.active + 4 - opp.f;
      else if (r < s.block + s.side && mv.arc < 1) this.press(i, 'dodge', undefined, ux, uz);
    }
    // a grab coming: the hard CPU steps back from it
    if (coming && mv.id === 'grab' && this.seen === s.react && Math.random() < s.side * 1.5) this.press(i, 'dodge', 'back', ux, uz);

    if (this.block > 0) {
      this.block--;
      i.block = true;
      if (me.state === 'blockstun') this.block = Math.max(this.block, 3);
      return i;
    }

    // stuck in a combo with a bar of meter: break out
    if (me.state === 'hitstun' || me.state === 'juggle') {
      if (me.combo >= 2 && me.meter >= 100 && !this.breakerRoll) {
        this.breakerRoll = true;
        if (Math.random() < s.breaker) i.dodge = true;
      }
      return i;
    }
    this.breakerRoll = false;

    // a whiffed or blocked attack in front of us: punish it
    const open = (opp.state === 'attack' && mv && opp.f >= mv.startup + mv.active && !opp.contact) || opp.state === 'land' || opp.state === 'guardBreak' || (opp.state === 'hitstun' && opp.len > 25);
    if (open && free && d < 1.45 && !this.queue.length && Math.random() < s.punish) {
      this.combo(Math.random() < s.combo * 0.6 ? 'launch' : 'string');
      return i;
    }
    // they're in the air after our launcher: follow them up
    if (opp.state === 'juggle' && free && !this.queue.length && d < 2.4) {
      if (d > 1.2) along(1);
      else if (opp.pos.y - opp.ground < 1.5 && Math.random() < s.combo) this.combo('string');
      return i;
    }
    if (opp.state === 'down' || opp.state === 'getup') {
      // give them room to get up, like a person would
      if (d < 1.7) along(-1);
      return i;
    }
    if (!free || this.queue.length) return i;

    // neutral: close in, keep a little outside their reach, then start something
    if (--this.think <= 0) {
      this.think = 10 + Math.floor(Math.random() * 22);
      const r = Math.random();
      if (d > 2.3) {
        if (r < 0.12) this.press(i, 'dodge', 'fwd', ux, uz);
        else if (r < 0.18 && d < 3.2) this.press(i, 'jump', 'fwd', ux, uz);
        this.walk = 1;
        this.walkT = 20 + Math.random() * 30;
      } else if (d > 1.55) {
        if (r < s.aggro * 0.35) this.queue.push({ p: 'heavy', dir: d < 1.62 ? 'down' : 'fwd', at: this.f });
        else if (r < 0.5) {
          this.walk = 1;
          this.walkT = 8 + Math.random() * 14;
        } else if (r < 0.62) {
          this.circle = Math.random() < 0.5 ? -1 : 1;
          this.walkT = 18;
          this.walk = 0;
        } else {
          this.walk = 0;
          this.walkT = 10;
        }
      } else if (r < s.aggro) {
        // in range: something to open them up
        const x = Math.random();
        if (this.turtle > 2 && x < 0.4) {
          this.turtle = 0;
          this.queue.push({ p: 'grab', at: this.f });
        } else if (me.meter >= 100 && x < 0.2) this.queue.push({ p: 'special', at: this.f });
        else if (x < 0.55) this.combo('string');
        else if (x < 0.7) this.queue.push({ p: 'heavy', at: this.f });
        else if (x < 0.8) this.queue.push({ p: 'heavy', dir: 'down', at: this.f });
        else if (x < 0.88) this.queue.push({ p: 'grab', at: this.f });
        else this.queue.push({ p: 'heavy', dir: 'up', at: this.f });
      } else if (r < s.aggro + 0.2) {
        this.walk = -1;
        this.walkT = 10 + Math.random() * 12;
      } else {
        this.block = 12 + Math.floor(Math.random() * 20);
      }
    }
    if (this.walkT > 0) {
      this.walkT--;
      along(this.walk);
      if (this.circle && !this.walk) {
        i.wx = -uz * this.circle;
        i.wz = ux * this.circle;
      }
    } else this.circle = 0;
    return i;
  }

  /** Told by the match when our attack was blocked (a turtle gets grabbed). */
  blocked() {
    this.turtle++;
  }

  private combo(kind: 'string' | 'launch') {
    const s = STYLES[this.level];
    const at = this.f;
    this.queue.push({ p: 'light', at });
    if (Math.random() < s.combo) this.queue.push({ p: 'light', at: at + 7 });
    if (Math.random() < s.combo) this.queue.push({ p: 'light', at: at + 15 });
    if (kind === 'launch') {
      this.queue.push({ p: 'heavy', dir: 'up', at: at + 24 });
      if (Math.random() < s.combo) {
        this.queue.push({ p: 'jump', at: at + 36 });
        this.queue.push({ p: 'light', at: at + 44 });
        this.queue.push({ p: 'heavy', at: at + 52 });
      }
    } else if (Math.random() < s.combo * 0.5) this.queue.push({ p: 'special', at: at + 24 });
  }

  private press(i: Intent, p: Press, dir: Queued['dir'], ux: number, uz: number) {
    i[p] = true;
    i.any = true;
    if (dir === 'up') i.sy = 1;
    else if (dir === 'down') i.sy = -1;
    else if (dir === 'fwd') {
      i.wx = ux;
      i.wz = uz;
    } else if (dir === 'back') {
      i.wx = -ux;
      i.wz = -uz;
    }
  }
}
