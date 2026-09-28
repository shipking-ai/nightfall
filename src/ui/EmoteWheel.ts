import { h, setOn } from './dom';
import { EMOTE_PAGES, PAGE_NAMES, type Emote } from '../data/emotes';
import { glyph } from '../input/glyphs';
import type { Input } from '../core/Input';

/**
 * The emote wheel: hold the emote button, point (right stick or mouse),
 * let go. Eight to a page; the shoulder buttons (or the mouse wheel) turn
 * the page. Small and to one side of the screen, so the world stays visible.
 */
export class EmoteWheel {
  el: HTMLElement;
  private slots: HTMLElement[] = [];
  private pageEl: HTMLElement;
  private label: HTMLElement;
  private page = 0;
  private sel = -1;
  private vx = 0;
  private vy = 0;
  isOpen = false;

  constructor(root: HTMLElement) {
    const ring = h('div', { class: 'wheel__ring' });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const s = h('div', { class: 'wheel__slot', style: `--x:${Math.cos(a).toFixed(3)};--y:${Math.sin(a).toFixed(3)}` }, h('span', { class: 'wheel__mark' }), h('span', { class: 'wheel__name' }));
      this.slots.push(s);
      ring.append(s);
    }
    this.label = h('span', { class: 'wheel__label' });
    this.pageEl = h('span', { class: 'meta wheel__page' });
    ring.append(h('div', { class: 'wheel__hub' }, this.label, this.pageEl));
    this.el = h(
      'section',
      { class: 'wheel', 'aria-label': 'Emotes', role: 'menu' },
      ring,
      h('div', { class: 'wheel__help' }, h('span', { class: 'hintrow' }, glyph('lookStick'), h('span', { class: 'meta' }, 'Choose')), h('span', { class: 'hintrow' }, glyph('tabPrev'), glyph('tabNext'), h('span', { class: 'meta hint-pad' }, 'Page'), h('span', { class: 'meta hint-kbm' }, 'Wheel · page'))),
    );
    root.append(this.el);
    this.render();
  }

  open() {
    this.isOpen = true;
    this.sel = -1;
    this.vx = this.vy = 0;
    this.render();
    setOn(this.el, true);
  }

  /** Close; returns the emote chosen, if any. */
  close(): Emote | null {
    this.isOpen = false;
    setOn(this.el, false);
    return this.sel >= 0 ? EMOTE_PAGES[this.page][this.sel] ?? null : null;
  }

  update(input: Input) {
    if (!this.isOpen) return;
    const pad = input.pad;
    let turn = 0;
    if (pad && input.isPad) {
      if (pad.pressed('LB')) turn = -1;
      if (pad.pressed('RB')) turn = 1;
      const x = pad.axes[input.look.southpaw ? 0 : 2], y = pad.axes[input.look.southpaw ? 1 : 3];
      if (Math.hypot(x, y) > 0.5) {
        this.vx = x;
        this.vy = y;
      }
    } else {
      if (input.wheel) turn = Math.sign(input.wheel);
      this.vx = Math.max(-120, Math.min(120, this.vx + input.lookX));
      this.vy = Math.max(-120, Math.min(120, this.vy + input.lookY));
    }
    if (turn) {
      this.page = (this.page + turn + EMOTE_PAGES.length) % EMOTE_PAGES.length;
      this.sel = -1;
      this.vx = this.vy = 0;
    }
    const r = Math.hypot(this.vx, this.vy);
    const min = input.isPad ? 0.5 : 30;
    if (r > min) {
      const a = Math.atan2(this.vy, this.vx) + Math.PI / 2;
      this.sel = ((Math.round((a / (Math.PI * 2)) * 8) % 8) + 8) % 8;
    }
    this.render();
  }

  private render() {
    const list = EMOTE_PAGES[this.page];
    this.slots.forEach((s, i) => {
      const e = list[i];
      s.classList.toggle('is-sel', i === this.sel);
      s.hidden = !e;
      (s.firstChild as HTMLElement).textContent = e?.mark ?? '';
      (s.lastChild as HTMLElement).textContent = e?.label ?? '';
    });
    this.label.textContent = this.sel >= 0 ? list[this.sel]?.label ?? '' : 'Emotes';
    this.pageEl.textContent = `${PAGE_NAMES[this.page] ?? ''} · ${this.page + 1} / ${EMOTE_PAGES.length}`;
  }
}
