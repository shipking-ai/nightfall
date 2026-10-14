import { h, setOn } from '../../ui/dom';
import { ATTRS, ATTR_BASE, ATTR_MAX_START, ATTR_POINTS, BACKGROUNDS, type Attr, type Background } from '../game/character';
import type { BeardKind, HairKind, HumanSpec, TopKind } from '../people/anatomy';
import { SKIN_TONES, randomSpec, heroSpec } from '../people/kit';

/**
 * Who walks out of the night: a name, a past (the background), what you're
 * made of (ten points across six attributes), and a face. The figure in the
 * street rebuilds as you change it, and turns to face you.
 */

export interface Draft {
  name: string;
  bg: Background;
  attrs: Record<Attr, number>;
  spec: HumanSpec;
}

const HAIRS: [HairKind, string][] = [['swept', 'Swept'], ['short', 'Short'], ['buzz', 'Buzzed'], ['curly', 'Curly'], ['bob', 'Bob'], ['long', 'Long'], ['ponytail', 'Ponytail'], ['bun', 'Bun'], ['braids', 'Braids'], ['bald', 'Shaved']];
const BEARDS: [BeardKind, string][] = [['none', 'None'], ['stubble', 'Stubble'], ['moustache', 'Moustache'], ['goatee', 'Goatee'], ['beard', 'Beard'], ['fullBeard', 'Full beard']];
const TOPS: [TopKind, string][] = [['coat', 'Long coat'], ['jacket', 'Jacket'], ['duster', 'Duster'], ['hoodie', 'Hoodie'], ['sweater', 'Sweater'], ['shirt', 'Shirt']];
const HAIR_COLORS = [0x0f0b09, 0x1c140e, 0x3f2a1a, 0x5a3c22, 0x7a5430, 0x9a7446, 0xb89a68, 0x6a2c16, 0x8a8886, 0xc8c6c2];
const EYES = [0x3a2414, 0x4e3220, 0x5e4a2a, 0x4a5a3a, 0x3e5a70, 0x5a7a96];
const COATS = [0x2a2c30, 0x1a1c20, 0x3a3228, 0x4a3e30, 0x2e3a4a, 0x3e4430, 0x5a2a22, 0x6a6258];
const LEGS = [0x16171a, 0x2a2622, 0x3a3228, 0x28364e, 0x3e4430, 0x4a4a48];
const NAMES = ['Alex Marlowe', 'Sam Reyes', 'Jo Castell', 'Robin Vance', 'Charlie Okafor', 'Morgan Hale', 'Casey Novak', 'Rene Delacroix', 'Kit Farrow', 'Dana Sato'];

export class Creator {
  el: HTMLElement;
  private body: HTMLElement;
  private left: HTMLElement;
  d: Draft;
  onChange: (spec: HumanSpec) => void = () => {};
  onBegin: (d: Draft) => void = () => {};
  onTurn: (dir: number) => void = () => {};

  constructor(root: HTMLElement) {
    this.d = fresh();
    this.body = h('div', { class: 'cr__body' });
    this.left = h('span', { class: 'cr__left meta' });
    const begin = h('button', { class: 'cr__begin', type: 'button' }, 'Walk out into the morning');
    begin.addEventListener('click', () => this.onBegin(this.d));
    const shuffle = h('button', { class: 'cr__btn', type: 'button' }, 'Surprise me');
    shuffle.addEventListener('click', () => {
      const r = randomSpec(Math.floor(Math.random() * 1e9), {});
      this.d.spec = { ...r, top: { ...r.top, kind: pickTop(r.top.kind) }, extras: { ...r.extras, backpack: undefined, holster: false, bandolier: undefined } };
      this.d.name = NAMES[Math.floor(Math.random() * NAMES.length)];
      this.changed();
    });
    const turnL = h('button', { class: 'cr__btn', type: 'button', 'aria-label': 'Turn left' }, '← Turn');
    turnL.addEventListener('click', () => this.onTurn(-1));
    const turnR = h('button', { class: 'cr__btn', type: 'button', 'aria-label': 'Turn right' }, 'Turn →');
    turnR.addEventListener('click', () => this.onTurn(1));
    this.el = h('section', { class: 'layer cr', role: 'dialog', 'aria-label': 'Who are you?' },
      h('header', { class: 'cr__head' }, h('span', { class: 'meta' }, 'Nightfall · RPG'), h('h2', { class: 'cr__title' }, 'Who walked out of the night?')),
      this.body,
      h('footer', { class: 'cr__foot' }, h('div', { class: 'cr__row' }, turnL, turnR, shuffle), h('div', { class: 'cr__row' }, this.left, begin)),
    );
    root.append(this.el);
  }

  get isOpen() {
    return this.el.classList.contains('is-on');
  }

  open() {
    this.d = fresh();
    setOn(this.el, true);
    this.render();
    this.onChange(this.d.spec);
    requestAnimationFrame(() => this.body.querySelector<HTMLElement>('input, button')?.focus({ preventScroll: true }));
  }

  close() {
    setOn(this.el, false);
  }

  private changed(rebuild = true) {
    const y = this.body.scrollTop;
    this.render();
    this.body.scrollTop = y;
    if (rebuild) this.onChange(this.d.spec);
  }

  private spent() {
    return ATTRS.reduce((a, x) => a + this.d.attrs[x.id] - ATTR_BASE, 0);
  }

  private render() {
    const d = this.d, s = d.spec;
    const left = ATTR_POINTS - this.spent();
    this.left.textContent = left ? `${left} attribute point${left > 1 ? 's' : ''} left` : 'Ready';
    const group = (title: string, ...kids: (HTMLElement | null)[]) => h('div', { class: 'cr__group' }, h('h3', { class: 'cr__h meta' }, title), ...kids);
    const chips = <T,>(opts: [T, string][], cur: T, set: (v: T) => void) =>
      h('div', { class: 'chips', role: 'group' }, ...opts.map(([v, label]) => {
        const b = h('button', { type: 'button', 'aria-pressed': String(v === cur) }, label);
        b.addEventListener('click', () => {
          set(v);
          this.changed();
        });
        return b;
      }));
    const swatches = (colors: number[], cur: number, label: string, set: (c: number) => void) =>
      h('div', { class: 'swatches', role: 'group', 'aria-label': label }, ...colors.map((c) => {
        const hex = `#${c.toString(16).padStart(6, '0')}`;
        const b = h('button', { type: 'button', class: 'swatch', 'aria-pressed': String(c === cur), 'aria-label': `${label} ${hex}`, style: `--c: ${hex}` });
        b.addEventListener('click', () => {
          set(c);
          this.changed();
        });
        return b;
      }));
    const slider = (label: string, key: keyof HumanSpec, lo = 0, hi = 1) => {
      const i = h('input', { type: 'range', min: lo, max: hi, step: 0.01, value: Number(s[key]), 'aria-label': label }) as HTMLInputElement;
      i.addEventListener('input', () => {
        (s as unknown as Record<string, number>)[key as string] = Number(i.value);
        this.onChange(s);
      });
      return h('label', { class: 'cr__slider' }, h('span', { class: 'meta' }, label), i);
    };
    const name = h('input', { class: 'cr__name', type: 'text', value: d.name, maxlength: 28, 'aria-label': 'Name', spellcheck: 'false' }) as HTMLInputElement;
    name.addEventListener('input', () => (d.name = name.value.trim() || 'Nobody'));
    const bgs = h('div', { class: 'cr__bgs' }, ...BACKGROUNDS.map((b) => {
      const btn = h('button', { type: 'button', class: 'cr__bg', 'aria-pressed': String(b.id === d.bg.id) }, h('span', { class: 'cr__bg-name' }, b.name), h('small', {}, b.line));
      btn.addEventListener('click', () => {
        d.bg = b;
        this.changed(false);
      });
      return btn;
    }));
    const attrs = h('div', { class: 'cr__attrs' }, ...ATTRS.map((a) => {
      const bonus = d.bg.attrs[a.id] ?? 0;
      const minus = h('button', { type: 'button', class: 'cr__step', 'aria-label': `Lower ${a.name}`, disabled: d.attrs[a.id] <= 1 }, '−');
      const plus = h('button', { type: 'button', class: 'cr__step', 'aria-label': `Raise ${a.name}`, disabled: left <= 0 || d.attrs[a.id] >= ATTR_MAX_START }, '+');
      minus.addEventListener('click', () => {
        d.attrs[a.id]--;
        this.changed(false);
      });
      plus.addEventListener('click', () => {
        d.attrs[a.id]++;
        this.changed(false);
      });
      return h('div', { class: 'cr__attr' }, h('span', { class: 'cr__attr-name' }, a.name, h('small', {}, a.desc)), minus, h('span', { class: 'cr__attr-n' }, String(d.attrs[a.id] + bonus), bonus ? h('small', {}, `+${bonus}`) : null), plus);
    }));
    this.body.replaceChildren(
      group('Name', name),
      group('Before the night', bgs),
      group('What you’re made of', h('p', { class: 'cr__hint' }, `Every attribute starts at ${ATTR_BASE}. Your background adds its own on top.`), attrs),
      group('Body', slider('Feminine · masculine', 'sex'), slider('Age', 'age', 0, 0.85), slider('Muscle', 'muscle'), slider('Weight', 'fat'), slider('Shoulders', 'shoulders')),
      group('Face', slider('Jaw', 'jaw'), slider('Cheeks', 'cheeks'), slider('Nose', 'nose'), slider('Lips', 'lips'), slider('Brow', 'brow'), slider('Chin', 'chin'), slider('Long face', 'faceLong'), swatches(SKIN_TONES, s.skin, 'Skin', (c) => (s.skin = c)), swatches(EYES, s.eyeColor, 'Eyes', (c) => (s.eyeColor = c))),
      group('Hair', chips(HAIRS, s.hair, (v) => (s.hair = v)), swatches(HAIR_COLORS, s.hairColor, 'Hair colour', (c) => (s.hairColor = c)), chips(BEARDS, s.beard, (v) => (s.beard = v))),
      group('Clothes', chips(TOPS, s.top.kind, (v) => (s.top = { ...s.top, kind: v, fabric: v === 'coat' || v === 'sweater' ? (v === 'coat' ? 'wool' : 'knit') : v === 'jacket' || v === 'duster' ? 'leather' : 'cotton' })), swatches(COATS, s.top.color, 'Top', (c) => (s.top = { ...s.top, color: c })), swatches(LEGS, s.bottom.color, 'Trousers', (c) => (s.bottom = { ...s.bottom, color: c })),
        chips([[true, 'Scarf'], [false, 'No scarf']] as [boolean, string][], !!s.extras.scarf, (v) => (s.extras = { ...s.extras, scarf: v ? 0x6a5a48 : undefined }))),
    );
  }
}

function fresh(): Draft {
  const attrs = Object.fromEntries(ATTRS.map((a) => [a.id, ATTR_BASE])) as Record<Attr, number>;
  // a sensible start: ten points spread, so "Begin" works straight away
  attrs.wits += 2;
  attrs.nerve += 2;
  attrs.reflex += 2;
  attrs.grit += 1;
  attrs.stamina += 2;
  attrs.charm += 1;
  return { name: 'Alex Marlowe', bg: BACKGROUNDS[0], attrs, spec: heroSpec(0.9, 7) };
}

function pickTop(k: TopKind): TopKind {
  return TOPS.some(([t]) => t === k) ? k : 'jacket';
}
