import { h, setOn, svg, wait } from './dom';
import { MODES, MODE_ORDER, type ModeId } from '../modes/rules';
import { glyph } from '../input/glyphs';

export interface ModeSelectHandlers {
  /** focus moved to a mode: the title camera cuts to its place */
  preview(id: ModeId): void;
  choose(id: ModeId): void;
  back(): void;
  tick(): void;
}

/**
 * Choosing how to spend the night. Four ways into the same city, set over the
 * title sequence: as focus moves, the camera cuts to where that mode happens,
 * so the background is the preview.
 */
export class ModeSelect {
  el: HTMLElement;
  private items = new Map<ModeId, HTMLButtonElement>();
  private detail: HTMLElement;
  private focused: ModeId = 'city';

  constructor(root: HTMLElement, private on: ModeSelectHandlers) {
    const list = h('nav', { class: 'modes__list', 'aria-label': 'Ways to play' });
    MODE_ORDER.forEach((id, i) => {
      const m = MODES[id];
      const b = h(
        'button',
        { class: `modes__item modes__item--${id}`, 'data-mode': id, type: 'button' },
        h('span', { class: 'modes__no meta' }, String(i + 1).padStart(2, '0')),
        h('span', { class: 'modes__name' }, h('small', { class: 'meta' }, 'Nightfall'), m.title),
        h('span', { class: 'modes__line' }, m.line),
        motif(id),
      ) as HTMLButtonElement;
      b.addEventListener('focus', () => this.setFocus(id));
      b.addEventListener('mouseenter', () => b.focus({ preventScroll: true }));
      b.addEventListener('click', () => this.on.choose(id));
      this.items.set(id, b);
      list.append(b);
    });
    this.detail = h('aside', { class: 'modes__detail', 'aria-live': 'polite' });
    const back = h('button', { class: 'modes__back', type: 'button', onclick: () => this.on.back() }, glyph('cancel'), h('span', { class: 'meta' }, 'Back'));
    this.el = h(
      'section',
      { class: 'layer modes', 'aria-label': 'Choose a way to play' },
      h('header', { class: 'modes__head' }, h('span', { class: 'meta' }, 'District 03 · One city'), h('h2', { class: 'modes__title' }, 'How do you want to spend the night?')),
      list,
      this.detail,
      h('footer', { class: 'modes__foot' }, h('span', { class: 'hintrow' }, glyph('confirm'), h('span', { class: 'meta' }, 'Choose')), back),
    );
    root.append(this.el);
  }

  get isOpen() {
    return this.el.classList.contains('is-on');
  }

  async open(start: ModeId) {
    this.focused = start;
    setOn(this.el, true);
    this.el.classList.remove('is-revealed');
    await wait(40);
    this.el.classList.add('is-revealed');
    this.items.get(start)?.focus({ preventScroll: true });
    this.setFocus(start, true);
  }

  async close() {
    this.el.classList.remove('is-revealed');
    await wait(360);
    setOn(this.el, false);
  }

  private setFocus(id: ModeId, force = false) {
    if (id === this.focused && !force) return;
    this.focused = id;
    for (const [k, b] of this.items) b.classList.toggle('is-focus', k === id);
    this.el.dataset.mode = id;
    const m = MODES[id];
    this.detail.replaceChildren(
      h('span', { class: 'meta modes__kicker' }, m.title),
      h('p', { class: 'modes__desc' }, m.detail),
      h('dl', {}, h('div', {}, h('dt', { class: 'meta' }, 'Best with'), h('dd', {}, m.input)), h('div', {}, h('dt', { class: 'meta' }, 'Where'), h('dd', {}, WHERE[id]))),
    );
    this.on.tick();
    this.on.preview(id);
  }
}

const WHERE: Record<ModeId, string> = {
  warzone: 'Pier 9 Yard',
  fight: 'Harbor Lane crossing',
  city: 'All of District 03',
  afterhours: 'All of District 03',
  rpg: 'District 03, Merrow, and everything past it',
};

/** A small moving mark per mode: the thing its world is made of. */
function motif(id: ModeId): SVGElement {
  const s = svg('svg', { class: `modes__motif modes__motif--${id}`, viewBox: '0 0 120 24', 'aria-hidden': 'true' });
  if (id === 'warzone') {
    // a tracer crossing, and range ticks
    for (let i = 0; i < 9; i++) s.append(svg('line', { x1: 8 + i * 13, y1: 18, x2: 8 + i * 13, y2: i % 4 === 0 ? 10 : 14 }));
    s.append(svg('line', { class: 'm-tracer', x1: 0, y1: 6, x2: 34, y2: 6 }));
  } else if (id === 'fight') {
    // two stances facing each other, a beat between them
    s.append(svg('path', { d: 'M20 20 L32 6 L44 20' }), svg('path', { d: 'M76 20 L88 6 L100 20' }), svg('circle', { class: 'm-beat', cx: 60, cy: 13, r: 2.2 }));
  } else if (id === 'city') {
    // a skyline with one window on
    s.append(svg('path', { d: 'M0 22 H10 V12 H18 V16 H26 V6 H34 V14 H44 V10 H52 V22 H62 V8 H70 V18 H80 V12 H90 V22 H120' }), svg('rect', { class: 'm-window', x: 28, y: 9, width: 3, height: 3 }));
  } else if (id === 'rpg') {
    // a road over hills to a sun on the horizon
    s.append(svg('path', { d: 'M0 20 Q18 10 34 16 T66 12 T96 17 T120 13' }), svg('path', { class: 'm-road', d: 'M52 24 L60 14 L68 24' }), svg('circle', { class: 'm-sun', cx: 92, cy: 9, r: 3.2 }));
  } else {
    // rain on the river
    s.append(svg('path', { class: 'm-wave', d: 'M0 16 Q10 12 20 16 T40 16 T60 16 T80 16 T100 16 T120 16' }));
    for (let i = 0; i < 6; i++) s.append(svg('line', { class: 'm-drop', x1: 10 + i * 19, y1: 0, x2: 8 + i * 19, y2: 6, style: `animation-delay:${i * 0.37}s` }));
  }
  return s;
}
