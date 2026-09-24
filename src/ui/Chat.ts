import { h, setOn } from './dom';

/**
 * Text chat, bottom left. T (or Enter) to type, Enter to send, Esc to cancel.
 * Lines fade after a while; opening the chat shows the recent ones again.
 */
export class Chat {
  el: HTMLElement;
  private log: HTMLElement;
  private input: HTMLInputElement;
  private form: HTMLElement;
  isOpen = false;
  private lastSent = 0;

  constructor(root: HTMLElement, private on: { send(text: string): boolean; opened(): void; closed(): void }) {
    this.log = h('ol', { class: 'chat__log', 'aria-live': 'polite', 'aria-label': 'Chat' });
    this.input = h('input', { class: 'chat__input', type: 'text', maxlength: '140', placeholder: 'Say something…  (Enter to send, Esc to cancel)', 'aria-label': 'Chat message' }) as HTMLInputElement;
    this.form = h('div', { class: 'chat__form' }, this.input);
    this.el = h('section', { class: 'chat' }, this.log, this.form);
    root.append(this.el);
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = this.input.value.trim();
        if (text && performance.now() - this.lastSent > 900) {
          if (this.on.send(text)) this.lastSent = performance.now();
        }
        this.input.value = '';
        this.close();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.el.classList.add('is-open');
    setOn(this.form, true);
    this.on.opened();
    requestAnimationFrame(() => this.input.focus());
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.remove('is-open');
    setOn(this.form, false);
    this.input.blur();
    this.on.closed();
  }

  /** A line in the log. `who` null: a system note. */
  add(who: string | null, text: string, mine = false) {
    const li = h('li', { class: `chat__line${mine ? ' is-mine' : ''}${who ? '' : ' is-system'}` }, ...(who ? [h('b', {}, `${who}: `)] : []), text);
    this.log.append(li);
    while (this.log.children.length > 40) this.log.firstChild?.remove();
    setTimeout(() => li.classList.add('is-old'), 12000);
  }
}

/** Keep chat to plain, short, printable text. */
export function cleanChat(t: unknown): string | null {
  if (typeof t !== 'string') return null;
  const s = t.replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, '').trim().slice(0, 140);
  return s || null;
}
