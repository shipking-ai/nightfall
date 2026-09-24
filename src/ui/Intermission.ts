import { h, setOn, wait } from './dom';
import { LORE } from '../data/archive';

/**
 * Loading as an intermission: title, tagline, a few facts about tonight,
 * and a line of lore. The only progress indicator is a hairline.
 */
export class Intermission {
  el: HTMLElement;
  private lore: HTMLParagraphElement;
  private bar: HTMLSpanElement;
  private facts: HTMLElement;
  private loreIdx = Math.floor(Math.random() * LORE.length);
  private timer = 0;

  constructor(root: HTMLElement) {
    this.lore = h('p', { class: 'intermission__lore' }, LORE[this.loreIdx]);
    this.bar = h('span');
    this.facts = h('dl', { class: 'intermission__grid' });
    this.el = h(
      'section',
      { class: 'layer intermission is-on', 'aria-live': 'polite', 'aria-label': 'Loading' },
      h(
        'div',
        { class: 'intermission__inner' },
        h('div', {}, h('h2', { class: 'intermission__title' }, 'NIGHTFALL'), h('p', { class: 'intermission__tag' }, 'THE CITY REMEMBERS', h('br'), 'WHAT PEOPLE FORGET.')),
        this.facts,
        this.lore,
        h('div', { class: 'intermission__line' }, this.bar),
      ),
    );
    root.append(this.el);
    this.setFacts('District 03', 'Moderate', '03:17');
  }

  setFacts(district: string, rain: string, time: string) {
    this.facts.replaceChildren(
      h('div', {}, h('dt', {}, 'DISTRICT'), h('dd', {}, district.toUpperCase())),
      h('div', {}, h('dt', {}, 'RAINFALL'), h('dd', {}, rain.toUpperCase())),
      h('div', {}, h('dt', {}, 'LOCAL TIME'), h('dd', {}, time)),
    );
  }

  setProgress(k: number) {
    this.bar.style.transform = `scaleX(${Math.max(0, Math.min(1, k))})`;
  }

  async show(opts: { lore?: boolean } = {}) {
    this.setProgress(0);
    if (opts.lore !== false) this.nextLore(false);
    setOn(this.el, true);
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.nextLore(true), 5200);
  }

  async hide() {
    clearInterval(this.timer);
    setOn(this.el, false);
    await wait(450);
  }

  private async nextLore(fade: boolean) {
    if (fade) {
      this.lore.classList.add('is-out');
      await wait(900);
    }
    this.loreIdx = (this.loreIdx + 1) % LORE.length;
    this.lore.textContent = LORE[this.loreIdx];
    this.lore.classList.remove('is-out');
  }
}
