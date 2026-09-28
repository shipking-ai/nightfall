import { h, setOn } from './dom';
import { glyph, hintRow } from '../input/glyphs';
import { MAX_HP, type Fighter } from '../modes/fight/Fighter';
import type { Action } from '../input/actions';

/**
 * FIGHT's interface. Big where it has to be read mid-exchange (health, the
 * clock, a KO), quiet everywhere else. Health drains in two layers: the bar
 * drops at once, and a pale trail follows it down after a beat, so you can
 * see what the combo you just ate was worth.
 */

interface Side {
  root: HTMLElement;
  name: HTMLElement;
  fill: HTMLElement;
  trail: HTMLElement;
  guard: HTMLElement;
  meter: HTMLElement[];
  pips: HTMLElement[];
  combo: HTMLElement;
  comboN: HTMLElement;
  comboD: HTMLElement;
  tag: HTMLElement;
  trailV: number;
  trailWait: number;
  comboT: number;
  tagT: number;
}

export interface EndChoice {
  rematch(): void;
  level(): void;
  modes(): void;
  leave(): void;
}

const MOVES_LIST: [Action | 'moveStick', string][] = [
  ['moveStick', 'Move · ↑↓ step'],
  ['light', 'Light (×3 string)'],
  ['heavy', 'Heavy · ↑ launch · ↓ sweep · → kick'],
  ['block', 'Block (tap: parry)'],
  ['dodge', 'Dodge · ← backstep'],
  ['grab', 'Throw'],
  ['special', 'Special (bar: EX)'],
  ['jump', 'Jump'],
];

export class FightHud {
  el: HTMLElement;
  private sides: Side[];
  private clockEl: HTMLElement;
  private roundEl: HTMLElement;
  private callEl: HTMLElement;
  private callMain: HTMLElement;
  private callSub: HTMLElement;
  private callT = 0;
  private promptEl: HTMLElement;
  private hints: HTMLElement;
  private joinEl: HTMLElement;
  end: HTMLElement;
  private endTitle: HTMLElement;
  private endStats: HTMLElement;
  private levelBtn: HTMLElement;
  private shown = false;

  constructor(root: HTMLElement, choice: EndChoice) {
    const side = (i: 0 | 1): Side => {
      const fill = h('i', { class: 'fbar__fill' });
      const trail = h('i', { class: 'fbar__trail' });
      const guard = h('i');
      const meter = [0, 1, 2].map(() => h('i'));
      const pips = [0, 1].map(() => h('i'));
      const name = h('span', { class: 'fbar__name' });
      const comboN = h('b');
      const comboD = h('span');
      const combo = h('div', { class: `fcombo fcombo--${i ? 'r' : 'l'}` }, comboN, h('span', { class: 'fcombo__hits' }, 'hits'), comboD);
      const tag = h('div', { class: `ftag ftag--${i ? 'r' : 'l'}` });
      const rootEl = h(
        'div',
        { class: `fbar fbar--${i ? 'r' : 'l'}` },
        h('div', { class: 'fbar__head' }, name, h('span', { class: 'fbar__pips' }, ...pips)),
        h('div', { class: 'fbar__hp' }, trail, fill),
        h('div', { class: 'fbar__guard' }, guard),
        h('div', { class: 'fbar__meter' }, ...meter),
      );
      return { root: rootEl, name, fill, trail, guard, meter, pips, combo, comboN, comboD, tag, trailV: 1, trailWait: 0, comboT: 0, tagT: 0 };
    };
    this.sides = [side(0), side(1)];
    this.clockEl = h('div', { class: 'fclock' }, '60');
    this.roundEl = h('div', { class: 'fround meta' }, 'Round 1');
    this.callMain = h('div', { class: 'fcall__main' });
    this.callSub = h('div', { class: 'fcall__sub' });
    this.callEl = h('div', { class: 'fcall', 'aria-live': 'assertive' }, this.callMain, this.callSub);
    this.promptEl = h('div', { class: 'fprompt' }, glyph('special'), h('span', {}, 'Finish it'));
    this.hints = h('div', { class: 'fhints' }, ...MOVES_LIST.map(([a, t]) => hintRow(a, t)));
    this.joinEl = h('div', { class: 'fjoin meta' });

    this.endTitle = h('h2', { class: 'fend__title' });
    this.endStats = h('div', { class: 'fend__stats' });
    this.levelBtn = h('button', { class: 'fend__btn', onclick: () => choice.level() }, 'CPU: Normal');
    this.end = h(
      'section',
      { class: 'fend', 'aria-label': 'Match over', 'data-nav-scope': '' },
      this.endTitle,
      this.endStats,
      h(
        'div',
        { class: 'fend__menu' },
        h('button', { class: 'fend__btn', 'data-nav-first': '', onclick: () => choice.rematch() }, 'Rematch'),
        this.levelBtn,
        h('button', { class: 'fend__btn', onclick: () => choice.modes() }, 'Choose a mode'),
        h('button', { class: 'fend__btn', onclick: () => choice.leave() }, 'Leave to the title'),
      ),
    );

    this.el = h(
      'section',
      { class: 'fhud', 'aria-label': 'Fight' },
      h('div', { class: 'fhud__top' }, this.sides[0].root, h('div', { class: 'fhud__mid' }, this.clockEl, this.roundEl), this.sides[1].root),
      this.sides[0].combo,
      this.sides[1].combo,
      this.sides[0].tag,
      this.sides[1].tag,
      this.callEl,
      this.promptEl,
      this.hints,
      this.joinEl,
      this.end,
    );
    root.append(this.el);
  }

  show(on: boolean) {
    this.shown = on;
    setOn(this.el, on);
    if (!on) this.showEnd(null);
  }

  names(a: string, b: string) {
    this.sides[0].name.textContent = a;
    this.sides[1].name.textContent = b;
  }

  level(name: string) {
    this.levelBtn.textContent = `CPU: ${name}`;
  }

  join(text: string | null) {
    this.joinEl.textContent = text ?? '';
    setOn(this.joinEl, !!text);
  }

  showHints(on: boolean) {
    setOn(this.hints, on);
  }

  round(n: number, final: boolean) {
    this.roundEl.textContent = final ? 'Final round' : `Round ${n}`;
  }

  clock(sec: number) {
    const s = Math.max(0, Math.ceil(sec));
    this.clockEl.textContent = String(s);
    this.clockEl.classList.toggle('is-low', s <= 10);
  }

  /** A big line in the middle (ROUND 1, FIGHT, KO); `ms` 0 keeps it up. */
  call(main: string | null, sub = '', ms = 1400, kind = '') {
    this.callMain.textContent = main ?? '';
    this.callSub.textContent = sub;
    this.callEl.className = `fcall ${kind ? `fcall--${kind}` : ''}`;
    setOn(this.callEl, !!main);
    // restart the entrance animation
    void this.callEl.offsetWidth;
    this.callT = ms ? ms / 1000 : Infinity;
  }

  prompt(on: boolean) {
    setOn(this.promptEl, on);
  }

  /** COUNTER, PARRY, GUARD BREAK… by the side it happened to. */
  tag(side: 0 | 1, text: string) {
    const s = this.sides[side];
    s.tag.textContent = text;
    s.tag.classList.remove('is-on');
    void s.tag.offsetWidth;
    s.tag.classList.add('is-on');
    s.tagT = 0.9;
  }

  /** A combo on `side`'s opponent, shown by the one doing it. */
  combo(side: 0 | 1, hits: number, dmg: number) {
    const s = this.sides[side];
    if (hits < 2) return;
    s.comboN.textContent = String(hits);
    s.comboD.textContent = `${dmg} damage`;
    s.combo.classList.add('is-on');
    s.combo.classList.remove('is-pop');
    void s.combo.offsetWidth;
    s.combo.classList.add('is-pop');
    s.comboT = 1.6;
  }

  update(dt: number, f: [Fighter, Fighter]) {
    if (!this.shown) return;
    f.forEach((x, i) => {
      const s = this.sides[i];
      const hp = x.hp / MAX_HP;
      s.fill.style.transform = `scaleX(${hp.toFixed(4)})`;
      s.fill.classList.toggle('is-low', hp < 0.25);
      if (hp < s.trailV) {
        s.trailWait -= dt;
        if (x.combo === 0 && s.trailWait <= 0) s.trailV = Math.max(hp, s.trailV - dt * 0.6);
      } else {
        s.trailV = hp;
        s.trailWait = 0.5;
      }
      if (x.combo > 0) s.trailWait = 0.5;
      s.trail.style.transform = `scaleX(${s.trailV.toFixed(4)})`;
      s.guard.style.transform = `scaleX(${(x.guard / 100).toFixed(3)})`;
      s.guard.parentElement!.classList.toggle('is-low', x.guard < 30);
      s.meter.forEach((m, k) => {
        const v = Math.max(0, Math.min(1, (x.meter - k * 100) / 100));
        m.style.setProperty('--v', v.toFixed(3));
        m.classList.toggle('is-full', v >= 1);
      });
      s.pips.forEach((p, k) => p.classList.toggle('is-won', k < x.wins));
      if (s.comboT > 0 && (s.comboT -= dt) <= 0) s.combo.classList.remove('is-on');
      if (s.tagT > 0 && (s.tagT -= dt) <= 0) s.tag.classList.remove('is-on');
    });
    if (this.callT !== Infinity && this.callT > 0 && (this.callT -= dt) <= 0) setOn(this.callEl, false);
  }

  /** The end of a match: who won, a few numbers, and what next. */
  showEnd(r: { title: string; lines: string[] } | null) {
    this.end.classList.toggle('is-on', !!r);
    if (!r) return;
    this.endTitle.textContent = r.title;
    this.endStats.replaceChildren(...r.lines.map((l) => h('p', { class: 'meta' }, l)));
  }

  get endOpen() {
    return this.end.classList.contains('is-on');
  }
}

