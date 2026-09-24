import { h, setOn, wait } from './dom';

export interface LandingHandlers {
  enter(): void;
  explore(): void;
  archive(): void;
  settings(): void;
  wardrobe?(): void;
  toggleSound(): void;
}

/**
 * The title sequence overlay. The world is the hero; the interface is a
 * title, a line, one door in and three quiet ways around it.
 */
export class Landing {
  el: HTMLElement;
  private shot: HTMLElement;
  private time: HTMLElement;
  private rain: HTMLElement;
  private sound: HTMLButtonElement;
  private enterSub: HTMLElement;
  private block: HTMLElement;

  constructor(root: HTMLElement, private on: LandingHandlers) {
    this.shot = h('span', { class: 'meta landing__shot' }, 'Central Avenue');
    this.time = h('span', {}, '03:17');
    this.rain = h('span', {}, 'MODERATE');
    this.sound = h(
      'button',
      { class: 'sound-toggle meta', 'aria-pressed': 'false', onclick: () => this.on.toggleSound() },
      h('span', { class: 'sound-toggle__bars', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
      h('span', { class: 'sound-toggle__label' }, 'Sound off'),
    );
    this.enterSub = h('span', { class: 'enter__sub' });
    const enter = h(
      'button',
      { class: 'enter', onclick: () => this.on.enter() },
      h('span', { class: 'enter__line', 'aria-hidden': 'true' }),
      h('span', {}, h('span', {}, 'Enter world'), this.enterSub),
    );
    this.block = h(
      'div',
      { class: 'landing__block' },
      h('h1', { class: 'landing__title reveal' }, 'NIGHTFALL'),
      h('p', { class: 'landing__tag reveal' }, 'THE CITY REMEMBERS', h('br'), 'WHAT PEOPLE FORGET.'),
      h(
        'div',
        { class: 'landing__actions reveal' },
        enter,
        h(
          'nav',
          { class: 'landing__nav', 'aria-label': 'Secondary' },
          h('button', { class: 'navlink', onclick: () => this.on.explore() }, 'Explore'),
          h('button', { class: 'navlink', onclick: () => this.on.archive() }, 'Archive'),
          ...(this.on.wardrobe ? [h('button', { class: 'navlink', onclick: () => this.on.wardrobe!() }, 'Wardrobe')] : []),
          h('button', { class: 'navlink', onclick: () => this.on.settings() }, 'Settings'),
        ),
      ),
    );
    this.el = h(
      'section',
      { class: 'layer landing', 'aria-label': 'Nightfall' },
      h(
        'div',
        { class: 'landing__top reveal' },
        h('span', { class: 'meta' }, 'District 03 — File no. 0317'),
        h('span', { class: 'meta' }, 'Local time ', this.time, '   ·   Rainfall ', this.rain),
      ),
      this.block,
      h('div', { class: 'landing__bottom reveal' }, h('span', { class: 'meta' }, 'Best with headphones'), this.shot, this.sound),
    );
    root.append(this.el);
  }

  async show() {
    this.el.classList.remove('is-leaving', 'is-revealed');
    setOn(this.el, true);
    await wait(60);
    this.el.classList.add('is-revealed');
  }

  async leave() {
    this.el.classList.add('is-leaving');
    await wait(700);
    setOn(this.el, false);
    this.el.classList.remove('is-revealed');
  }

  hideInstant() {
    setOn(this.el, false);
  }

  setResume(place: string | null) {
    this.enterSub.textContent = place ? `Continue — ${place}` : 'District 03, 03:17';
  }

  setMeta(time: string, rain: string) {
    this.time.textContent = time;
    this.rain.textContent = rain;
  }

  async setShot(caption: string) {
    this.shot.classList.add('is-out');
    await wait(700);
    this.shot.textContent = caption;
    this.shot.classList.remove('is-out');
  }

  setSound(on: boolean) {
    this.sound.classList.toggle('is-on', on);
    this.sound.setAttribute('aria-pressed', String(on));
    this.sound.querySelector('.sound-toggle__label')!.textContent = on ? 'Sound on' : 'Sound off';
  }
}
