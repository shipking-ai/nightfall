import { h, setOn } from './dom';

/**
 * Staff tools, in a drawer on the right (` to open). The game keeps running
 * behind it. Everything here only asks App to do things: App decides what's
 * allowed (local powers for staff; room-wide actions go through the room
 * server, which checks the account's role again).
 */
export interface AdminHooks {
  // you
  fly(on: boolean): void;
  god(on: boolean): void;
  speed(k: number): void;
  heal(): void;
  wanted(d: number): void;
  bringCar(): void;
  teleport(place: string): void;
  places(): string[];
  resetQuests(): void;
  // the world (the whole room when you can, otherwise just you)
  time(minutes: number): void;
  rain(v: number | null): void;
  event(kind: 'blackout' | 'unease'): void;
  announce(text: string): void;
  // players
  players(): { id: string; name: string; muted: boolean }[];
  player(act: 'kick' | 'ban' | 'mute' | 'unmute' | 'jail', id: string): void;
  jailMe(): void;
  findAccounts(q: string): Promise<{ id: string; name: string; role: string; banned: boolean }[]>;
  banAccount(id: string, on: boolean): Promise<boolean>;
  // stats
  liveStats(): Record<string, string | number>;
  serverStats(): Promise<Record<string, number> | null>;
  // content
  placeNote(title: string, body: string): Promise<string | null>;
  notes(): { id: string; title: string; dist: number }[];
  deleteNote(id: string): Promise<boolean>;
  // state
  roomReady(): boolean;
  close(): void;
}

type Tab = 'you' | 'world' | 'players' | 'stats' | 'content';

export class AdminPanel {
  el: HTMLElement;
  private body: HTMLElement;
  private tab: Tab = 'you';
  private tabs: Record<Tab, HTMLButtonElement> = {} as Record<Tab, HTMLButtonElement>;
  private flags = { fly: false, god: false };
  private speedK = 1;
  private liveT = 0;
  isOpen = false;

  constructor(root: HTMLElement, private on: AdminHooks) {
    const bar = h('nav', { class: 'admin__tabs' });
    for (const t of ['you', 'world', 'players', 'stats', 'content'] as Tab[]) {
      const b = h('button', { class: 'admin__tab', onclick: () => this.show(t) }, t[0].toUpperCase() + t.slice(1));
      this.tabs[t] = b;
      bar.append(b);
    }
    this.body = h('div', { class: 'admin__body' });
    this.el = h(
      'aside',
      { class: 'admin', role: 'dialog', 'aria-label': 'Admin tools' },
      h('header', { class: 'admin__head' }, h('span', { class: 'meta meta--paper' }, 'Admin'), h('button', { class: 'admin__x', 'aria-label': 'Close', onclick: () => on.close() }, '×')),
      bar,
      this.body,
    );
    root.append(this.el);
  }

  open() {
    this.isOpen = true;
    setOn(this.el, true);
    this.show(this.tab);
  }

  close() {
    this.isOpen = false;
    setOn(this.el, false);
  }

  /** keep the live numbers moving while the Stats tab is open */
  tick(dt: number) {
    if (!this.isOpen || this.tab !== 'stats') return;
    this.liveT -= dt;
    if (this.liveT > 0) return;
    this.liveT = 0.5;
    const live = this.body.querySelector('[data-live]');
    if (live) live.replaceChildren(...this.rows(this.on.liveStats()));
  }

  private show(t: Tab) {
    this.tab = t;
    for (const [k, b] of Object.entries(this.tabs)) b.classList.toggle('is-active', k === t);
    this.body.replaceChildren(...this.render(t));
  }

  private render(t: Tab): Node[] {
    const on = this.on;
    const btn = (label: string, fn: () => void, cls = '') => h('button', { class: `admin__btn ${cls}`, onclick: fn }, label);
    const toggle = (label: string, key: 'fly' | 'god', fn: (v: boolean) => void) => {
      const b = h('button', { class: `admin__btn${this.flags[key] ? ' is-on' : ''}`, 'aria-pressed': String(this.flags[key]) }, label);
      b.onclick = () => {
        this.flags[key] = !this.flags[key];
        b.classList.toggle('is-on', this.flags[key]);
        b.setAttribute('aria-pressed', String(this.flags[key]));
        fn(this.flags[key]);
      };
      return b;
    };
    const section = (title: string, ...kids: Node[]) => h('section', { class: 'admin__sec' }, h('h3', { class: 'meta' }, title), ...kids);
    const row = (...kids: Node[]) => h('div', { class: 'admin__row' }, ...kids);
    const scope = () => h('p', { class: 'admin__note' }, on.roomReady() ? 'Applies to everyone in this room.' : 'Just you (not in a room on our server).');

    if (t === 'you') {
      const sp = h('input', { type: 'range', min: '0.5', max: '6', step: '0.5', value: String(this.speedK), 'aria-label': 'Speed' }) as HTMLInputElement;
      const spv = h('span', { class: 'admin__val' }, `${this.speedK}×`);
      sp.oninput = () => {
        this.speedK = Number(sp.value);
        spv.textContent = `${this.speedK}×`;
        on.speed(this.speedK);
      };
      const sel = h('select', { 'aria-label': 'Place' }, ...on.places().map((p) => h('option', { value: p }, p))) as HTMLSelectElement;
      return [
        section('Powers', row(toggle('Fly / noclip', 'fly', on.fly), toggle('God mode', 'god', on.god)), h('p', { class: 'admin__note' }, 'Fly: Space up, C down.')),
        section('Speed', row(sp, spv)),
        section('Teleport', row(sel, btn('Go', () => on.teleport(sel.value)))),
        section('Quick', row(btn('Bring a car', on.bringCar), btn('Heal', on.heal)), row(btn('Wanted +1', () => on.wanted(1)), btn('Clear wanted', () => on.wanted(-9))), row(btn('Reset my side quests', on.resetQuests), btn('Send me to jail', on.jailMe))),
      ];
    }
    if (t === 'world') {
      const tm = h('input', { type: 'range', min: '0', max: '330', step: '5', value: '197', 'aria-label': 'Time' }) as HTMLInputElement;
      const tv = h('span', { class: 'admin__val' }, clock(197));
      tm.oninput = () => (tv.textContent = clock(Number(tm.value)));
      const rn = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: '0.7', 'aria-label': 'Rain' }) as HTMLInputElement;
      const msg = h('input', { type: 'text', maxlength: '140', placeholder: 'Say something to everyone…', 'aria-label': 'Announcement' }) as HTMLInputElement;
      return [
        scope(),
        section('Time', row(tm, tv), row(btn('Set time', () => on.time(Number(tm.value))))),
        section('Rain', row(rn), row(btn('Set rain', () => on.rain(Number(rn.value))), btn('Let it come and go', () => on.rain(null)))),
        section('Events', row(btn('Blackout', () => on.event('blackout')), btn('Unease', () => on.event('unease')))),
        section('Announce', msg, row(btn('Send', () => msg.value.trim() && (on.announce(msg.value.trim()), (msg.value = ''))))),
      ];
    }
    if (t === 'players') {
      const list = on.players();
      const q = h('input', { type: 'search', placeholder: 'Account name…', 'aria-label': 'Find account' }) as HTMLInputElement;
      const found = h('div', { class: 'admin__list' });
      const search = async () => {
        found.replaceChildren(h('p', { class: 'admin__note' }, 'Looking…'));
        try {
          const rows = await on.findAccounts(q.value.trim());
          found.replaceChildren(
            ...(rows.length
              ? rows.map((r) => {
                  const b = btn(r.banned ? 'Unban' : 'Ban', async () => {
                    if (await on.banAccount(r.id, !r.banned)) search();
                  }, r.banned ? '' : 'is-danger');
                  if (r.role === 'admin') b.disabled = true;
                  return row(h('span', { class: 'admin__who' }, `${r.name}${r.role !== 'player' ? ` · ${r.role}` : ''}${r.banned ? ' · banned' : ''}`), b);
                })
              : [h('p', { class: 'admin__note' }, 'No accounts found.')]),
          );
        } catch {
          found.replaceChildren(h('p', { class: 'admin__note' }, 'Not allowed (sign in with a staff account).'));
        }
      };
      q.onkeydown = (e) => e.key === 'Enter' && search();
      return [
        section(
          'In this room',
          ...(list.length
            ? list.map((p) =>
                row(
                  h('span', { class: 'admin__who' }, p.name),
                  btn(p.muted ? 'Unmute' : 'Mute', () => (on.player(p.muted ? 'unmute' : 'mute', p.id), setTimeout(() => this.show('players'), 300))),
                  btn('Jail', () => on.player('jail', p.id)),
                  btn('Kick', () => on.player('kick', p.id)),
                  btn('Ban', () => on.player('ban', p.id), 'is-danger'),
                ),
              )
            : [h('p', { class: 'admin__note' }, 'Nobody else is here.')]),
          ...(on.roomReady() ? [] : [h('p', { class: 'admin__note' }, 'Kick and ban need our room server.')]),
        ),
        section('Accounts', row(q, btn('Find', search)), found),
      ];
    }
    if (t === 'stats') {
      const server = h('div', { class: 'admin__kv' }, h('p', { class: 'admin__note' }, 'Loading…'));
      on.serverStats().then((s) => server.replaceChildren(...(s ? this.rows(s) : [h('p', { class: 'admin__note' }, 'Not allowed (sign in with a staff account).')])));
      return [section('This session', h('div', { class: 'admin__kv', 'data-live': '' }, ...this.rows(on.liveStats()))), section('Everyone', server)];
    }
    // content: notes left in the world
    const title = h('input', { type: 'text', maxlength: '40', placeholder: 'Title', 'aria-label': 'Note title' }) as HTMLInputElement;
    const body = h('textarea', { maxlength: '280', rows: '3', placeholder: 'What it says…', 'aria-label': 'Note text' }) as HTMLTextAreaElement;
    const status = h('p', { class: 'admin__note' });
    const notes = on.notes();
    return [
      section(
        'Leave a note here',
        title,
        body,
        row(
          btn('Place it', async () => {
            if (!body.value.trim()) return;
            status.textContent = 'Placing…';
            const err = await on.placeNote(title.value.trim() || 'Notice', body.value.trim());
            status.textContent = err ?? 'Placed. Everyone will see it.';
            if (!err) setTimeout(() => this.show('content'), 600);
          }),
        ),
        status,
      ),
      section(
        'Notes (nearest first)',
        ...(notes.length
          ? notes.map((n) => row(h('span', { class: 'admin__who' }, `${n.title} · ${Math.round(n.dist)} m`), btn('Delete', async () => (await on.deleteNote(n.id)) && this.show('content'), 'is-danger')))
          : [h('p', { class: 'admin__note' }, 'None yet.')]),
      ),
    ];
  }

  private rows(o: Record<string, string | number>) {
    return Object.entries(o).map(([k, v]) => h('div', {}, h('span', {}, k.replace(/_/g, ' ')), h('b', {}, String(v))));
  }
}

function clock(m: number) {
  const t = Math.round(m);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
