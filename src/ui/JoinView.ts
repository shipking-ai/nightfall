import { h, setOn } from './dom';
import { glyph } from '../input/glyphs';

/**
 * Joining a friend without a link: type the room code they see in their
 * pause menu (on a controller, with the on-screen keyboard). A room is just
 * `?room=<code>`, so joining is a reload into it.
 */
export class JoinView {
  el: HTMLElement;
  private input: HTMLInputElement;
  private err: HTMLElement;

  constructor(root: HTMLElement, private onClose: () => void) {
    this.input = h('input', { class: 'join__code', type: 'text', maxlength: '24', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'abcde-fghij', 'aria-label': 'Room code', 'data-nav-first': '' }) as HTMLInputElement;
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.go();
    });
    this.err = h('p', { class: 'meta join__err', role: 'alert' });
    this.el = h(
      'section',
      { class: 'layer panel join', role: 'dialog', 'aria-label': 'Join a friend' },
      h(
        'header',
        { class: 'panel__head' },
        h('div', {}, h('span', { class: 'meta' }, 'Out tonight together'), h('h2', { class: 'panel__title' }, 'Join a friend')),
        h('button', { class: 'panel__close', onclick: () => this.onClose() }, h('span', { class: 'meta' }, 'Close'), glyph('cancel')),
      ),
      h(
        'div',
        { class: 'join__body' },
        h('p', {}, 'Ask them for the room code: it’s in their pause menu when they choose Invite someone.'),
        this.input,
        this.err,
        h('button', { class: 'join__go', onclick: () => this.go() }, 'Join their city'),
      ),
    );
    root.append(this.el);
  }

  open() {
    this.err.textContent = '';
    this.input.value = '';
    setOn(this.el, true);
  }

  close() {
    setOn(this.el, false);
  }

  get isOpen() {
    return this.el.classList.contains('is-on');
  }

  private go() {
    const code = this.input.value.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!/^[a-z0-9]{6,16}$/.test(code)) {
      this.err.textContent = 'That doesn’t look like a room code (letters and numbers, like abcde-fghij).';
      return;
    }
    const u = new URL(location.href);
    u.searchParams.set('room', code);
    location.href = u.toString();
  }
}

/** A room id, readable out loud: in groups of five. */
export function roomCode(room: string) {
  return room.replace(/(.{5})(?=.)/g, '$1-');
}
