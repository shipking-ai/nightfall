import { h, setOn } from './dom';
import { ACCENTS, BEARDS, GARMENTS, HAIRS, HATS, HAIR_COLORS, LEGS, SHOES, SKINS, TOPS, cleanLook, randomLook, type Look } from '../entities/Look';

/**
 * The Wardrobe: change what you wear and how you're built. Every change is
 * worn at once (the camera turns to face you); Done keeps it, and it's saved
 * locally, on your account if you have one, and shown to the other players.
 */
export class WardrobeView {
  el: HTMLElement;
  private body: HTMLElement;
  private look: Look = cleanLook(null);
  private before: Look = cleanLook(null);

  constructor(
    root: HTMLElement,
    private on: { change(l: Look): void; done(l: Look): void; cancel(l: Look): void; turn(dir: number): void; tick(): void },
  ) {
    this.body = h('div', { class: 'wardrobe__body' });
    const done = h('button', { class: 'wardrobe__done' }, 'Done');
    done.addEventListener('click', () => this.on.done(this.look));
    const cancel = h('button', { class: 'wardrobe__btn' }, 'Cancel');
    cancel.addEventListener('click', () => this.on.cancel(this.before));
    const shuffle = h('button', { class: 'wardrobe__btn' }, 'Surprise me');
    shuffle.addEventListener('click', () => this.set(randomLook()));
    const left = h('button', { class: 'wardrobe__btn', 'aria-label': 'Turn left' }, '← Turn');
    left.addEventListener('click', () => this.on.turn(-1));
    const right = h('button', { class: 'wardrobe__btn', 'aria-label': 'Turn right' }, 'Turn →');
    right.addEventListener('click', () => this.on.turn(1));
    this.el = h(
      'section',
      { class: 'layer wardrobe', role: 'dialog', 'aria-label': 'Wardrobe' },
      h('header', { class: 'wardrobe__head' }, h('span', { class: 'meta' }, 'Nightfall'), h('h2', { class: 'panel__title' }, 'Wardrobe')),
      this.body,
      h('footer', { class: 'wardrobe__foot' }, h('div', { class: 'wardrobe__row' }, left, right, shuffle), h('div', { class: 'wardrobe__row' }, cancel, done)),
    );
    root.append(this.el);
  }

  open(current: Look) {
    this.before = { ...current };
    this.look = { ...current };
    this.render();
    setOn(this.el, true);
  }

  close() {
    setOn(this.el, false);
  }

  private set(next: Look) {
    this.look = cleanLook(next);
    this.on.change(this.look);
    this.on.tick();
    this.render();
  }

  private patch(p: Partial<Look>) {
    this.set({ ...this.look, ...p });
  }

  private render() {
    const l = this.look;
    const chips = <K extends 'garment' | 'hair' | 'hat' | 'beard' | 'shoes'>(key: K, opts: [Look[K], string][]) =>
      h(
        'div',
        { class: 'chips', role: 'group' },
        ...opts.map(([v, label]) => {
          const b = h('button', { 'aria-pressed': String(l[key] === v) }, label);
          b.addEventListener('click', () => this.patch({ [key]: v } as Partial<Look>));
          return b;
        }),
      );
    const swatches = (key: 'top' | 'legs' | 'skin' | 'hairColor' | 'accent', colors: number[], label: string) =>
      h(
        'div',
        { class: 'swatches', role: 'group', 'aria-label': label },
        ...colors.map((c) => {
          const b = h('button', { class: 'swatch', 'aria-pressed': String(l[key] === c), 'aria-label': `${label} #${c.toString(16).padStart(6, '0')}`, style: `--c: #${c.toString(16).padStart(6, '0')}` });
          b.addEventListener('click', () => this.patch({ [key]: c } as Partial<Look>));
          return b;
        }),
      );
    const toggle = (key: 'scarf' | 'bag' | 'glasses', label: string) => {
      const b = h('button', { 'aria-pressed': String(l[key]) }, label);
      b.addEventListener('click', () => this.patch({ [key]: !l[key] } as Partial<Look>));
      return b;
    };
    const slider = (key: 'height' | 'build' | 'shoulders', label: string, min: number, max: number) => {
      const i = h('input', { type: 'range', min, max, step: 0.01, value: l[key], 'aria-label': label }) as HTMLInputElement;
      i.addEventListener('input', () => {
        this.look = cleanLook({ ...this.look, [key]: Number(i.value) });
        this.on.change(this.look);
      });
      return h('label', { class: 'wardrobe__slider' }, h('span', { class: 'meta' }, label), i);
    };
    const faceBtn = (label: string, seed: number) => {
      const b = h('button', { 'aria-pressed': String(seed === 0 && l.face === 0) }, label);
      b.addEventListener('click', () => this.patch({ face: seed }));
      return b;
    };
    const group = (title: string, ...kids: (HTMLElement | null)[]) => h('div', { class: 'wardrobe__group' }, h('span', { class: 'meta' }, title), ...kids);
    this.body.replaceChildren(
      group('Clothes', chips('garment', GARMENTS), swatches('top', TOPS, 'Colour'), swatches('legs', LEGS, 'Trousers')),
      group('Hair', chips('hair', HAIRS), swatches('hairColor', HAIR_COLORS, 'Hair colour')),
      group('Face', h('div', { class: 'chips' }, faceBtn('Another face', 1 + Math.floor(Math.random() * 99999)), faceBtn('Original', 0), toggle('glasses', 'Glasses')), chips('beard', BEARDS), swatches('skin', SKINS, 'Skin tone')),
      group('Headwear', chips('hat', HATS)),
      group('Extras', h('div', { class: 'chips' }, toggle('scarf', 'Scarf'), toggle('bag', 'Bag')), chips('shoes', SHOES), swatches('accent', ACCENTS, 'Scarf, hat and bag colour')),
      group('Build', slider('height', 'Height', 0.9, 1.1), slider('build', 'Build', 0.88, 1.14), slider('shoulders', 'Shoulders', 0.94, 1.12)),
    );
  }
}
