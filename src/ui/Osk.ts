import { h, setOn } from './dom';
import type { Input } from '../core/Input';
import type { Nav } from './Nav';

/**
 * An on-screen keyboard for text fields when there's only a controller:
 * names, room links, sign-in. Opens over the field it's typing into.
 *
 * A types the focused key · X deletes · Y adds a space · LB/RB move the caret ·
 * L3 switches case · Menu (or Done) finishes · B cancels.
 */

const ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', "'"],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '?'],
  ['@', '-', '_', '/', ':', '!', '#', '&', '+', '='],
];

export class Osk {
  el: HTMLElement;
  private field: HTMLInputElement | HTMLTextAreaElement | null = null;
  private preview: HTMLElement;
  private label: HTMLElement;
  private keys: HTMLButtonElement[] = [];
  private upper = false;
  private original = '';

  constructor(root: HTMLElement) {
    this.preview = h('div', { class: 'osk__preview' });
    this.label = h('span', { class: 'meta' });
    const grid = h('div', { class: 'osk__grid' });
    for (const row of ROWS) {
      const r = h('div', { class: 'osk__row' });
      for (const k of row) {
        const b = h('button', { class: 'osk__key', type: 'button', 'data-k': k }, k) as HTMLButtonElement;
        b.addEventListener('click', () => this.type(this.upper ? k.toUpperCase() : k));
        this.keys.push(b);
        r.append(b);
      }
      grid.append(r);
    }
    const fn = (text: string, cls: string, go: () => void) => {
      const b = h('button', { class: `osk__key osk__key--wide ${cls}`, type: 'button' }, text) as HTMLButtonElement;
      b.addEventListener('click', go);
      return b;
    };
    grid.append(
      h(
        'div',
        { class: 'osk__row' },
        fn('Shift', 'osk__shift', () => this.shift()),
        fn('Space', 'osk__space', () => this.type(' ')),
        fn('Delete', '', () => this.del()),
        fn('Done', 'osk__done', () => this.close(true)),
      ),
    );
    this.el = h(
      'section',
      { class: 'osk', role: 'dialog', 'aria-label': 'On-screen keyboard', 'data-nav-scope': '' },
      h('div', { class: 'osk__head' }, this.label, this.preview),
      grid,
      h('p', { class: 'osk__help meta' }, 'A type · X delete · Y space · L3 caps · Menu done · B cancel'),
    );
    root.append(this.el);
  }

  get isOpen() {
    return this.el.classList.contains('is-on');
  }

  open(field: HTMLInputElement | HTMLTextAreaElement) {
    this.field = field;
    this.original = field.value;
    const lab = field.getAttribute('aria-label') ?? field.getAttribute('placeholder') ?? (field.labels?.[0]?.textContent ?? 'Type');
    this.label.textContent = lab;
    this.render();
    setOn(this.el, true);
    requestAnimationFrame(() => this.keys[10]?.focus({ preventScroll: true }));
  }

  close(commit: boolean) {
    const f = this.field;
    if (!f) return;
    if (!commit) f.value = this.original;
    f.dispatchEvent(new Event('input', { bubbles: true }));
    f.dispatchEvent(new Event('change', { bubbles: true }));
    setOn(this.el, false);
    this.field = null;
    f.focus({ preventScroll: true });
    // a single-line field that submits on Enter (chat, a code) gets its Enter
    if (commit && f instanceof HTMLInputElement) f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  }

  private type(s: string) {
    const f = this.field;
    if (!f) return;
    if (f.maxLength > 0 && f.value.length >= f.maxLength) return;
    f.value += s;
    if (this.upper && s.trim()) this.shift();
    this.render();
  }

  private del() {
    const f = this.field;
    if (!f) return;
    f.value = f.value.slice(0, -1);
    this.render();
  }

  private shift() {
    this.upper = !this.upper;
    for (const b of this.keys) b.textContent = this.upper ? b.dataset.k!.toUpperCase() : b.dataset.k!;
  }

  private render() {
    const f = this.field;
    const secret = f instanceof HTMLInputElement && f.type === 'password';
    const v = f?.value ?? '';
    this.preview.textContent = (secret ? '•'.repeat(v.length) : v) + '▏';
  }

  /** The pad inside the keyboard. */
  update(input: Input, dt: number, nav: Nav): boolean {
    const p = input.pad;
    if (!p) return false;
    const cur = document.activeElement as HTMLElement | null;
    if (!cur || !this.el.contains(cur)) this.keys[10]?.focus({ preventScroll: true });
    if (p.pressed('B')) {
      this.close(false);
      return true;
    }
    if (p.pressed('X')) this.del();
    if (p.pressed('Y')) this.type(' ');
    if (p.pressed('LS')) this.shift();
    if (p.pressed('Menu')) {
      this.close(true);
      return true;
    }
    if (p.pressed('A')) {
      (document.activeElement as HTMLElement | null)?.click();
      return true;
    }
    // movement: let the nav's spatial search do it within the keyboard
    const x = p.axes[0], y = p.axes[1];
    const dir = p.pressed('Up') || y < -0.7 ? 'up' : p.pressed('Down') || y > 0.7 ? 'down' : p.pressed('Left') || x < -0.7 ? 'left' : p.pressed('Right') || x > 0.7 ? 'right' : null;
    this.repeat -= dt;
    if (dir && (this.repeat <= 0 || dir !== this.lastDir)) {
      this.repeat = dir === this.lastDir ? 0.1 : 0.32;
      this.lastDir = dir;
      const next = nav.neighbour(this.el, (document.activeElement as HTMLElement) ?? this.keys[0], dir);
      next?.focus({ preventScroll: true });
    }
    if (!dir) this.lastDir = '';
    return true;
  }
  private repeat = 0;
  private lastDir = '';
}
