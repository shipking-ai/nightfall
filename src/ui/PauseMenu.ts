import { h, setOn } from './dom';

export interface PauseHandlers {
  resume(): void;
  map(): void;
  archive(): void;
  settings(): void;
  exit(): void;
  hover(): void;
  /** make or reuse a room, copy its link; resolves with what to show on the button */
  invite?(): Promise<string>;
  wardrobe?(): void;
  /** staff only (shown with setAdmin) */
  admin?(): void;
}

/** A column of words over a darkened, still-running world. */
export class PauseMenu {
  el: HTMLElement;
  private info: HTMLElement;
  private first: HTMLButtonElement;

  constructor(root: HTMLElement, on: PauseHandlers) {
    const item = (n: string, label: string, fn: () => void) =>
      h('button', { class: 'pause__item', onclick: fn, onmouseenter: () => on.hover(), onfocus: () => on.hover() }, h('span', { class: 'meta' }, n), label);
    this.first = item('01', 'Resume', on.resume);
    this.info = h('dl');
    this.el = h(
      'section',
      { class: 'layer pause', 'aria-label': 'Paused', role: 'dialog' },
      h(
        'nav',
        { class: 'pause__menu' },
        h('span', { class: 'meta' }, 'Paused'),
        this.first,
        item('02', 'Map', on.map),
        item('03', 'Archive', on.archive),
        item('04', 'Wardrobe', () => on.wardrobe?.()),
        item('05', 'Settings', on.settings),
        this.adminItem = item('A', 'Admin tools', () => on.admin?.()),
        ...(on.invite ? [this.inviteItem(on)] : []),
        item(on.invite ? '07' : '06', 'Leave the city', on.exit),
      ),
      h('footer', { class: 'pause__foot' }, this.info, h('span', { class: 'meta' }, 'Esc  ·  Resume')),
    );
    root.append(this.el);
  }

  private inviteLabel = h('span', {}, 'Invite someone');
  private adminItem!: HTMLElement;

  /** Show the Admin tools entry (staff accounts). */
  setAdmin(on: boolean) {
    this.adminItem.style.display = on ? '' : 'none';
  }

  private inviteItem(on: PauseHandlers) {
    const b = h('button', { class: 'pause__item', onmouseenter: () => on.hover(), onfocus: () => on.hover() }, h('span', { class: 'meta' }, '06'), this.inviteLabel);
    b.addEventListener('click', () => {
      on.invite!().then(
        (msg) => (this.inviteLabel.textContent = msg),
        () => (this.inviteLabel.textContent = 'Couldn’t make a link'),
      );
    });
    return b;
  }

  open(info: { place: string; time: string; rain: string; records: string; together?: string }) {
    const f = (k: string, v: string) => h('div', {}, h('dt', { class: 'meta' }, k), h('dd', {}, v));
    this.inviteLabel.textContent = 'Invite someone';
    this.info.replaceChildren(f('Location', info.place), f('Local time', info.time), f('Rainfall', info.rain), f('Archive', info.records), ...(info.together ? [f('Out tonight', info.together)] : []));
    setOn(this.el, true);
    requestAnimationFrame(() => this.first.focus({ preventScroll: true }));
  }

  close() {
    setOn(this.el, false);
  }
}
