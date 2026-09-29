import { h, setOn } from '../../ui/dom';
import type { Choice, Node } from '../game/dialogue';

/**
 * A conversation: the speaker, what they say, and your answers as a list
 * you can move through with a stick or the arrow keys. Checks show their
 * odds on the right. Lines appear one after another, like someone talking.
 */
export class Talk {
  el: HTMLElement;
  private who: HTMLElement;
  private sub: HTMLElement;
  private lines: HTMLElement;
  private list: HTMLElement;
  private timers: number[] = [];
  onEnd: () => void = () => {};

  constructor(root: HTMLElement) {
    this.who = h('h2', { class: 'talk__who' });
    this.sub = h('span', { class: 'meta talk__sub' });
    this.lines = h('div', { class: 'talk__lines', 'aria-live': 'polite' });
    this.list = h('ol', { class: 'talk__choices' });
    this.el = h('section', { class: 'layer talk', role: 'dialog', 'aria-label': 'Conversation' }, h('div', { class: 'talk__card' }, h('header', { class: 'talk__head' }, this.who, this.sub), this.lines, this.list));
    root.append(this.el);
  }

  get isOpen() {
    return this.el.classList.contains('is-on');
  }

  show(n: Node | null | undefined) {
    if (n === undefined) return; // another screen took over
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (!n) {
      this.close();
      this.onEnd();
      return;
    }
    setOn(this.el, true);
    this.who.textContent = n.speaker;
    this.sub.textContent = n.sub ?? '';
    this.sub.hidden = !n.sub;
    this.lines.replaceChildren(
      ...n.lines.map((l, i) => {
        const p = h('p', { class: 'talk__line' }, l);
        p.style.animationDelay = `${i * 0.28}s`;
        return p;
      }),
    );
    this.list.replaceChildren(...n.choices.map((c, i) => this.choice(c, i)));
    // focus the first live answer (the Nav gives it the pad ring)
    const first = this.list.querySelector<HTMLButtonElement>('button:not([disabled])');
    this.timers.push(window.setTimeout(() => first?.focus({ preventScroll: true }), 30));
  }

  private choice(c: Choice, i: number) {
    const b = h(
      'button',
      { class: 'talk__choice', type: 'button', disabled: !!c.disabled },
      h('span', { class: 'talk__n meta' }, String(i + 1)),
      h('span', { class: 'talk__label' }, c.label),
      c.tag ? h('span', { class: 'talk__tag meta' }, c.tag) : null,
      c.disabled ? h('span', { class: 'talk__tag talk__tag--off meta' }, c.disabled) : null,
    );
    b.addEventListener('click', () => this.show(c.go()));
    return h('li', {}, b);
  }

  close() {
    setOn(this.el, false);
  }
}
