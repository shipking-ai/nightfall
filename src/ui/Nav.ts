import type { Input } from '../core/Input';
import { Osk } from './Osk';

/**
 * Menus with a controller (and arrow keys): spatial focus movement, confirm,
 * back, shoulder-button tabs, sliders nudged left and right, and an on-screen
 * keyboard for text fields. Every interface in the game is plain DOM, so this
 * one piece makes all of it usable from a couch.
 *
 * The scope is the top-most open layer (`.layer.is-on`, not passive) or
 * anything marked `data-nav-scope` that's showing. A scope can register what
 * "back" and "tab" mean for it; otherwise B/Esc falls through to the app.
 */

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ScopeHandlers {
  back?: () => void;
  tab?: (dir: -1 | 1) => void;
  /** a scope that wants the pad (or the keys) itself: the map pans with the stick. True if it used them. */
  pad?: (dt: number) => boolean;
}

export class Nav {
  private handlers = new WeakMap<HTMLElement, ScopeHandlers>();
  private repeatDir = '';
  private repeatT = 0;
  private current: HTMLElement | null = null;
  private currentScope: HTMLElement | null = null;
  private currentKey = '';
  private currentIndex = 0;
  osk: Osk;
  /** fired when the pad presses back and the scope has no handler of its own */
  fallbackBack?: () => void;
  tick?: () => void;
  /** menus are live (the app turns this off during play) */
  active = true;

  constructor(private root: HTMLElement, private input: Input) {
    this.osk = new Osk(root);
    // mouse users: drop the pad focus ring as soon as the mouse is used
    input.on('device', () => {
      if (!input.isPad) this.current?.classList.remove('nav-focus');
      else if (this.current) this.current.classList.add('nav-focus');
    });
  }

  /** What back / tab / stick mean inside a scope element. */
  scope(el: HTMLElement, h: ScopeHandlers) {
    el.dataset.navScope = el.dataset.navScope ?? '';
    this.handlers.set(el, { ...this.handlers.get(el), ...h });
  }

  /** The element that owns the controller right now, if any. */
  top(): HTMLElement | null {
    if (this.osk.isOpen) return this.osk.el;
    const cands = [...this.root.querySelectorAll<HTMLElement>('.layer.is-on:not(.is-passive), [data-nav-scope].is-on, [data-nav-scope].is-open')].filter((el) => visible(el) && el.querySelector(FOCUSABLE));
    if (!cands.length) return null;
    // the last one in the document that's stacked highest
    let best = cands[0], bz = zOf(best);
    for (const c of cands.slice(1)) {
      const z = zOf(c);
      if (z >= bz) (best = c), (bz = z);
    }
    return best;
  }

  focusables(scope: HTMLElement): HTMLElement[] {
    return [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => visible(el) && !el.closest('[data-nav-skip]'));
  }

  /** Focus something (with the pad focus ring). */
  focus(el: HTMLElement | null) {
    if (!el) return;
    this.current?.classList.remove('nav-focus');
    this.current = el;
    if (this.input.isPad) el.classList.add('nav-focus');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** Per frame, while any menu might be open. Returns true if it used the input. */
  update(dt: number): boolean {
    if (!this.active) return false;
    const pad = this.input.isPad;
    const scope = this.top();
    if (!scope) return false;
    if (this.osk.isOpen) return this.osk.update(this.input, dt, this);
    const h = this.handlers.get(scope);
    // (a scope that wants the controls itself: the pad, or keys when it has them)
    if (h?.pad?.(dt)) return true;

    const act = document.activeElement as HTMLElement | null;
    let cur = act && scope.contains(act) && act !== scope ? act : null;
    if (pad && !cur) {
      // the menu re-drew itself under the focus: find the same control again
      const all = this.focusables(scope);
      let next: HTMLElement | null = null;
      if (this.current && !this.current.isConnected && this.currentScope === scope) {
        next = all.find((el) => keyOf(el) === this.currentKey) ?? all[Math.min(this.currentIndex, all.length - 1)] ?? null;
      }
      // arriving in a menu with a pad: something is always focused
      next ??= scope.querySelector<HTMLElement>('[autofocus], [data-nav-first]') ?? all[0] ?? null;
      if (next && visible(next)) this.focus(next);
      cur = next;
    } else if (cur && cur !== this.current) {
      this.current?.classList.remove('nav-focus');
      this.current = cur;
      if (pad) cur.classList.add('nav-focus');
    }
    if (cur) {
      this.currentScope = scope;
      this.currentKey = keyOf(cur);
      this.currentIndex = Math.max(0, this.focusables(scope).indexOf(cur));
    }

    const typing = !!act && (act.tagName === 'TEXTAREA' || (act.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((act as HTMLInputElement).type)));
    // pad only below here, plus arrow keys when not typing
    // keyboard: native behaviour wins on sliders, selects and text
    const native = !pad && !!cur && (typing || cur instanceof HTMLSelectElement || (cur instanceof HTMLInputElement && cur.type === 'range'));
    const dir = this.direction(dt, pad, native);
    if (dir && cur) {
      if (cur instanceof HTMLInputElement && cur.type === 'range' && (dir === 'left' || dir === 'right')) {
        nudge(cur, dir === 'right' ? 1 : -1);
        this.tick?.();
        return true;
      }
      if (cur instanceof HTMLSelectElement && (dir === 'left' || dir === 'right')) {
        cycle(cur, dir === 'right' ? 1 : -1);
        this.tick?.();
        return true;
      }
      const next = this.neighbour(scope, cur, dir);
      if (next) {
        this.focus(next);
        this.tick?.();
      }
      return true;
    }
    if (!pad) return false;
    const p = this.input.pad;
    if (!p) return false;
    if (p.pressed('A') && cur) {
      if (cur instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button', 'submit'].includes(cur.type)) this.osk.open(cur);
      else if (cur instanceof HTMLTextAreaElement) this.osk.open(cur);
      else if (cur instanceof HTMLSelectElement) cycle(cur, 1);
      else cur.click();
      return true;
    }
    if (p.pressed('B')) {
      if (h?.back) h.back();
      else this.fallbackBack?.();
      return true;
    }
    for (const [btn, d] of [['LB', -1], ['RB', 1]] as const) {
      if (!p.pressed(btn)) continue;
      if (h?.tab) h.tab(d);
      else scope.querySelector<HTMLElement>(`[data-nav-tab="${d < 0 ? 'prev' : 'next'}"]`)?.click();
      this.tick?.();
      return true;
    }
    // right stick scrolls whatever the focus sits in
    const ry = p.axes[3];
    if (Math.abs(ry) > 0.25 && cur) {
      const sc = scrollParent(cur) ?? scope;
      sc.scrollTop += ry * 900 * dt;
    }
    return false;
  }

  private direction(dt: number, pad: boolean, typing: boolean): 'up' | 'down' | 'left' | 'right' | null {
    const i = this.input;
    let dir = '';
    if (pad) {
      const p = i.pad!;
      const x = p?.axes[0] ?? 0, y = p?.axes[1] ?? 0;
      if (p?.held('Up') || y < -0.6) dir = 'up';
      else if (p?.held('Down') || y > 0.6) dir = 'down';
      else if (p?.held('Left') || x < -0.6) dir = 'left';
      else if (p?.held('Right') || x > 0.6) dir = 'right';
    } else if (!typing) {
      if (i.isDown('ArrowUp')) dir = 'up';
      else if (i.isDown('ArrowDown')) dir = 'down';
      else if (i.isDown('ArrowLeft')) dir = 'left';
      else if (i.isDown('ArrowRight')) dir = 'right';
    }
    if (!dir) {
      this.repeatDir = '';
      return null;
    }
    if (dir !== this.repeatDir) {
      this.repeatDir = dir;
      this.repeatT = 0.38;
      return dir as 'up';
    }
    this.repeatT -= dt;
    if (this.repeatT <= 0) {
      this.repeatT = 0.11;
      return dir as 'up';
    }
    return null;
  }

  /** The nearest focusable in a direction, preferring things lined up with the current one. */
  neighbour(scope: HTMLElement, from: HTMLElement, dir: 'up' | 'down' | 'left' | 'right'): HTMLElement | null {
    const a = from.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best: HTMLElement | null = null, bs = Infinity;
    for (const el of this.focusables(scope)) {
      if (el === from || el.contains(from) || from.contains(el)) continue;
      const b = el.getBoundingClientRect();
      if (!b.width && !b.height) continue;
      const bx = b.left + b.width / 2, by = b.top + b.height / 2;
      let main: number, ortho: number, overlap: boolean;
      if (dir === 'left' || dir === 'right') {
        main = dir === 'right' ? b.left - a.right : a.left - b.right;
        if ((dir === 'right' ? bx - ax : ax - bx) <= 2) continue;
        overlap = b.bottom > a.top + 2 && b.top < a.bottom - 2;
        ortho = overlap ? 0 : Math.abs(by - ay);
      } else {
        main = dir === 'down' ? b.top - a.bottom : a.top - b.bottom;
        if ((dir === 'down' ? by - ay : ay - by) <= 2) continue;
        overlap = b.right > a.left + 2 && b.left < a.right - 2;
        ortho = overlap ? 0 : Math.abs(bx - ax);
      }
      const score = Math.max(0, main) + ortho * 2.2 + (overlap ? 0 : 40);
      if (score < bs) (bs = score), (best = el);
    }
    return best;
  }
}

/** Enough to recognise a control after its menu is rebuilt. */
function keyOf(el: HTMLElement): string {
  return `${el.tagName}|${el.dataset.navId ?? ''}|${el.getAttribute('aria-label') ?? ''}|${(el.textContent ?? '').trim().slice(0, 60)}`;
}

function visible(el: HTMLElement): boolean {
  if (el.hidden) return false;
  const c = el as HTMLElement & { checkVisibility?: (o?: object) => boolean };
  if (c.checkVisibility) return c.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

function zOf(el: HTMLElement): number {
  let z = 0, n: HTMLElement | null = el;
  while (n && n !== document.body) {
    const v = parseInt(getComputedStyle(n).zIndex, 10);
    if (Number.isFinite(v)) z = Math.max(z, v);
    n = n.parentElement;
  }
  return z;
}

function nudge(r: HTMLInputElement, d: number) {
  const step = Number(r.step) > 0 ? Number(r.step) : (Number(r.max) - Number(r.min)) / 20;
  const v = Math.min(Number(r.max), Math.max(Number(r.min), Number(r.value) + d * step));
  r.value = String(v);
  r.dispatchEvent(new Event('input', { bubbles: true }));
  r.dispatchEvent(new Event('change', { bubbles: true }));
}

function cycle(s: HTMLSelectElement, d: number) {
  const n = s.options.length;
  if (!n) return;
  s.selectedIndex = (s.selectedIndex + d + n) % n;
  s.dispatchEvent(new Event('change', { bubbles: true }));
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  let n = el.parentElement;
  while (n && n !== document.body) {
    const s = getComputedStyle(n);
    if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 4) return n;
    n = n.parentElement;
  }
  return null;
}
