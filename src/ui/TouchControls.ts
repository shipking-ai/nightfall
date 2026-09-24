import { h } from './dom';
import type { Input } from '../core/Input';

/**
 * Phones and tablets: a thumbstick on the left, drag anywhere else to look,
 * and a cluster of buttons on the right that changes with what you're doing
 * (on foot / armed / driving). Buttons press the same keys a keyboard would,
 * so the game doesn't know the difference.
 */
export const isTouch = () =>
  typeof window !== 'undefined' && (matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints ?? 0) > 1) && !matchMedia('(pointer: fine)').matches;

type Mode = 'foot' | 'car';

export class TouchControls {
  el: HTMLElement;
  private stick: HTMLElement;
  private knob: HTMLElement;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private held = new Set<string>();
  private footBtns: HTMLElement;
  private carBtns: HTMLElement;
  private useBtn: HTMLElement;
  private mode: Mode | null = null;
  private visible = false;

  constructor(root: HTMLElement, private input: Input, private opts: { staff: () => boolean }) {
    document.body.classList.add('is-touch');
    this.knob = h('div', { class: 'tc__knob' });
    this.stick = h('div', { class: 'tc__stick', 'aria-hidden': 'true' }, this.knob);
    const pad = h('div', { class: 'tc__look', 'aria-hidden': 'true' });
    this.useBtn = this.btn('E', 'Use', 'KeyE', 'tc__use');
    this.footBtns = h(
      'div',
      { class: 'tc__cluster' },
      this.btn('◎', 'Fire', 'KeyF', 'tc__fire', true),
      this.btn('⌖', 'Aim', 'Mouse2', 'tc__aim', true),
      this.btn('↑', 'Jump', 'Space', 'tc__jump'),
      this.btn('↻', 'Weapon', 'KeyQ', 'tc__swap'),
      this.btn('R', 'Reload', 'KeyR', 'tc__reload'),
    );
    this.carBtns = h(
      'div',
      { class: 'tc__cluster tc__cluster--car' },
      this.btn('■', 'Brake', 'Space', 'tc__brake', true),
      this.btn('♫', 'Horn', 'KeyH', 'tc__horn', true),
      this.btn('⏭', 'Radio', 'KeyR', 'tc__radio'),
      this.btn('▭', 'Screen', 'KeyV', 'tc__screen'),
    );
    const top = h(
      'div',
      { class: 'tc__top' },
      this.btn('II', 'Pause', 'Escape', 'tc__small'),
      this.btn('▦', 'Map', 'KeyM', 'tc__small'),
      this.btn('✉', 'Chat', 'KeyT', 'tc__small'),
      this.btn('◉', 'Mic', 'KeyN', 'tc__small'),
      ...(opts.staff() ? [this.btn('⚙', 'Admin', 'F10', 'tc__small')] : []),
    );
    this.el = h('section', { class: 'tc', 'aria-label': 'Touch controls' }, pad, this.stick, this.useBtn, this.footBtns, this.carBtns, top);
    root.append(this.el);

    // the thumbstick: wherever your left thumb lands in the lower-left, it starts there
    const zone = h('div', { class: 'tc__stickzone', 'aria-hidden': 'true' });
    this.el.insertBefore(zone, this.stick);
    zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      e.preventDefault();
      this.stickId = e.pointerId;
      capture(zone, e.pointerId);
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stick.style.left = `${e.clientX}px`;
      this.stick.style.top = `${e.clientY}px`;
      this.stick.classList.add('is-on');
      this.moveStick(0, 0);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      this.moveStick(e.clientX - this.stickOrigin.x, e.clientY - this.stickOrigin.y);
    });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.stick.classList.remove('is-on');
      this.knob.style.transform = '';
      for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft']) this.key(k, false);
    };
    zone.addEventListener('pointerup', endStick);
    zone.addEventListener('pointercancel', endStick);

    // look: drag anywhere that isn't a control
    pad.addEventListener('pointerdown', (e) => {
      if (this.lookId !== null) return;
      e.preventDefault();
      this.lookId = e.pointerId;
      capture(pad, e.pointerId);
      this.lookLast = { x: e.clientX, y: e.clientY };
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      const k = 1.6;
      this.input.lookX += (e.clientX - this.lookLast.x) * k;
      this.input.lookY += (e.clientY - this.lookLast.y) * k;
      this.lookLast = { x: e.clientX, y: e.clientY };
    });
    const endLook = (e: PointerEvent) => {
      if (e.pointerId === this.lookId) this.lookId = null;
    };
    pad.addEventListener('pointerup', endLook);
    pad.addEventListener('pointercancel', endLook);
    // no pinch-zoom, no page scroll, no long-press menus while playing
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  /** Show for play; hide for menus. The cluster follows what you're doing. */
  update(show: boolean, mode: Mode, useLabel: string | null) {
    if (show !== this.visible) {
      this.visible = show;
      this.el.classList.toggle('is-on', show);
      if (!show) this.releaseAll();
    }
    if (mode !== this.mode) {
      this.mode = mode;
      this.footBtns.style.display = mode === 'foot' ? '' : 'none';
      this.carBtns.style.display = mode === 'car' ? '' : 'none';
      this.releaseAll();
    }
    this.useBtn.classList.toggle('is-ready', !!useLabel);
    const lab = this.useBtn.querySelector('small');
    if (lab && lab.textContent !== (useLabel ?? 'Use')) lab.textContent = useLabel ?? 'Use';
  }

  private moveStick(dx: number, dy: number) {
    const R = 56;
    const d = Math.hypot(dx, dy);
    const k = d > R ? R / d : 1;
    this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    const nx = dx / R, ny = dy / R;
    const dead = 0.28;
    this.key('KeyW', ny < -dead);
    this.key('KeyS', ny > dead);
    this.key('KeyA', nx < -dead);
    this.key('KeyD', nx > dead);
    // push all the way to run
    this.key('ShiftLeft', d > R * 1.25 && this.mode === 'foot');
  }

  private btn(glyph: string, label: string, code: string, cls: string, hold = false) {
    const b = h('button', { class: `tc__btn ${cls}`, 'aria-label': label, type: 'button' }, h('span', {}, glyph), h('small', {}, label));
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      capture(b, e.pointerId);
      b.classList.add('is-down');
      this.key(code, true);
      if (!hold) setTimeout(() => this.key(code, false), 60);
    });
    const up = () => {
      b.classList.remove('is-down');
      if (hold) this.key(code, false);
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    return b;
  }

  /** Press or release a key, exactly as the keyboard would (the game and the Input both hear it). */
  private key(code: string, down: boolean) {
    if (down === this.held.has(code)) return;
    if (down) this.held.add(code);
    else this.held.delete(code);
    if (code === 'Mouse2') {
      this.input.setVirtual(code, down);
      return;
    }
    dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code === 'Escape' ? 'Escape' : '', bubbles: true }));
  }

  private releaseAll() {
    for (const k of [...this.held]) this.key(k, false);
    this.stickId = this.lookId = null;
    this.stick.classList.remove('is-on');
    this.knob.style.transform = '';
  }
}

/** Keep a finger's moves coming to the control it started on (some browsers refuse; that's fine). */
function capture(el: Element, id: number) {
  try {
    el.setPointerCapture(id);
  } catch {
    /* not a live pointer */
  }
}
