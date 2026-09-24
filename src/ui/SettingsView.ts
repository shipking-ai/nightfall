import { h, setOn } from './dom';
import type { Settings, SettingsData } from '../core/Settings';
import { searchStations, type Radio, type RadioResult } from '../audio/Radio';

/** Accounts: sign in / up, or keep playing as a guest. */
export interface AccountControls {
  enabled: boolean;
  state(): { signedIn: boolean; email: string; name: string; role: string };
  signIn(email: string, password: string): Promise<string>;
  signUp(email: string, password: string, name: string): Promise<string>;
  magicLink(email: string): Promise<string>;
  google(): Promise<void>;
  signOut(): Promise<void>;
}

/** Multiplayer: who you are to the others, and the room you're in. */
export interface TogetherControls {
  enabled: boolean;
  name(): string;
  setName(n: string): void;
  room(): string | null;
  others(): string[];
  invite(): Promise<string>;
  leave(): void;
}

export interface CloudControls {
  enabled: boolean;
  code(): string;
  /** resolves with a short status line, rejects with a readable message */
  restore(code: string): Promise<string>;
}

/** Practical settings, every control wired to something real. */
export class SettingsView {
  el: HTMLElement;
  private body: HTMLElement;
  private confirmErase = false;
  private query = '';
  private acct = { email: '', password: '', note: '', busy: false };
  private results: RadioResult[] | null = null;
  private searchNote = '';

  constructor(root: HTMLElement, private settings: Settings, private onClose: () => void, private onErase: () => void, private cloud: CloudControls, private radio: Radio, private together: TogetherControls, private account: AccountControls) {
    this.body = h('div', { class: 'panel__body settings__body' });
    this.el = h(
      'section',
      { class: 'layer panel settings', role: 'dialog', 'aria-label': 'Settings' },
      h(
        'header',
        { class: 'panel__head' },
        h('div', {}, h('span', { class: 'meta' }, 'Nightfall'), h('h2', { class: 'panel__title' }, 'Settings')),
        h('button', { class: 'panel__close', onclick: () => this.onClose() }, h('span', { class: 'meta' }, 'Close'), h('span', { class: 'key' }, 'Esc')),
      ),
      this.body,
    );
    root.append(this.el);
    settings.on('change', () => this.render());
  }

  /** Re-draw (account or room changed while open). */
  refresh() {
    if (this.el.classList.contains('is-on')) this.render();
  }

  open() {
    this.confirmErase = false;
    this.render();
    setOn(this.el, true);
  }

  close() {
    setOn(this.el, false);
  }

  private render() {
    const d = this.settings.data;
    const set = <K extends keyof SettingsData>(k: K, v: SettingsData[K]) => this.settings.set(k, v);

    const seg = <K extends keyof SettingsData>(k: K, opts: [SettingsData[K], string][]) =>
      h('div', { class: 'seg', role: 'group' }, ...opts.map(([v, label]) => h('button', { 'aria-pressed': String(d[k] === v), onclick: () => set(k, v) }, label)));
    const onOff = (k: 'shadows' | 'postfx' | 'atmosphere' | 'invertY' | 'reducedMotion' | 'blood') =>
      seg(k, [
        [true, 'On'],
        [false, 'Off'],
      ]);
    const range = (k: 'fov' | 'master' | 'ambience' | 'music' | 'radio' | 'sensitivity', min: number, max: number, step: number, fmt: (v: number) => string, label: string) => {
      const out = h('output', {}, fmt(d[k]));
      const input = h('input', { type: 'range', min, max, step, value: d[k], 'aria-label': label }) as HTMLInputElement;
      input.addEventListener('input', () => {
        out.textContent = fmt(Number(input.value));
      });
      input.addEventListener('change', () => set(k, Number(input.value)));
      return h('div', { class: 'range' }, input, out);
    };
    const row = (label: string, desc: string | null, control: HTMLElement) =>
      h('div', { class: 'setting' }, h('div', {}, h('span', { class: 'setting__label' }, label), desc ? h('span', { class: 'setting__desc' }, desc) : null), control);
    const pct = (v: number) => `${Math.round(v * 100)}`;

    const erase = h(
      'button',
      {
        class: 'danger',
        onclick: () => {
          if (!this.confirmErase) {
            this.confirmErase = true;
            erase.textContent = 'Press again to erase';
            return;
          }
          this.confirmErase = false;
          this.onErase();
          erase.textContent = 'Erased';
        },
      },
      'Erase archive',
    );

    this.body.replaceChildren(
      h(
        'div',
        { class: 'settings__grid' },
        h(
          'div',
          {},
          this.account.enabled ? this.accountSection(row) : null,
          h(
            'div',
            { class: 'settings__section' },
            h('span', { class: 'meta' }, 'Graphics'),
            row('Quality', 'Resolution, rain density and nearby lights.', seg('quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']])),
            row('Shadows', 'Shadows cast by the nearest street lamps.', onOff('shadows')),
            row('Post-processing', 'Bloom, grade and film grain.', onOff('postfx')),
            row('Blood', 'Sprays when someone is hit, pools when they go down.', onOff('blood')),
            row('Atmosphere', 'Wet reflections, light shafts, steam and splashes.', onOff('atmosphere')),
            row('Field of view', null, range('fov', 50, 80, 1, (v) => `${v}°`, 'Field of view')),
          ),
          h(
            'div',
            { class: 'settings__section' },
            h('span', { class: 'meta' }, 'Audio'),
            row('Master', null, range('master', 0, 1, 0.05, pct, 'Master volume')),
            row('Ambience', 'Rain, the city, footsteps.', range('ambience', 0, 1, 0.05, pct, 'Ambience volume')),
            row('Music', 'Sparse. Mostly silence.', range('music', 0, 1, 0.05, pct, 'Music volume')),
          ),
          this.radioSection(row, range('radio', 0, 1, 0.05, pct, 'Radio volume')),
          this.together.enabled ? this.togetherSection(row) : null,
        ),
        h(
          'div',
          {},
          h(
            'div',
            { class: 'settings__section' },
            h('span', { class: 'meta' }, 'Controls'),
            row('Mouse sensitivity', null, range('sensitivity', 0.3, 2.5, 0.05, (v) => v.toFixed(2), 'Mouse sensitivity')),
            row('Invert vertical look', null, onOff('invertY')),
            h(
              'div',
              { class: 'keys' },
              ...keyRow(['W', 'A', 'S', 'D'], 'Move'),
              ...keyRow(['Mouse'], 'Look'),
              ...keyRow(['Shift'], 'Run'),
              ...keyRow(['Space'], 'Jump'),
              ...keyRow(['E'], 'Inspect · sit · answer · get in'),
              ...keyRow(['H'], 'Horn (driving)'),
              ...keyRow(['R'], 'Radio: next station (Shift: previous)'),
              ...keyRow(['V'], 'Screen (electric cars)'),
              ...keyRow(['M'], 'Map'),
              ...keyRow(['J'], 'Archive'),
              ...keyRow(['Esc'], 'Pause'),
            ),
          ),
          h(
            'div',
            { class: 'settings__section' },
            h('span', { class: 'meta' }, 'Accessibility'),
            row('Reduced motion', 'Stills the title camera, idle sway and interface motion.', onOff('reducedMotion')),
          ),
          h(
            'div',
            { class: 'settings__section' },
            h('span', { class: 'meta' }, 'Data'),
            row('Archive and progress', this.cloud.enabled ? 'Kept in this browser, with a copy in the city record.' : 'Stored in this browser only.', erase),
            ...(this.cloud.enabled ? this.cloudRows(row) : []),
          ),
        ),
      ),
    );
  }

  /** Account: sign in, make an account, or stay a guest. */
  private accountSection(row: (label: string, desc: string | null, control: HTMLElement) => HTMLElement) {
    const a = this.account;
    const st = a.state();
    const f = this.acct;
    const note = h('span', { class: 'setting__desc', 'aria-live': 'polite' }, f.note);
    const run = (p: Promise<unknown>) => {
      f.busy = true;
      f.note = 'One moment\u2026';
      this.render();
      p.then(
        (msg) => {
          f.busy = false;
          f.note = typeof msg === 'string' ? msg : '';
          f.password = '';
          this.render();
        },
        (err: Error) => {
          f.busy = false;
          f.note = err.message;
          this.render();
        },
      );
    };
    if (st.signedIn) {
      const out = h('button', {}, 'Sign out');
      out.addEventListener('click', () => run(a.signOut().then(() => 'Signed out. Playing as a guest.')));
      return h(
        'div',
        { class: 'settings__section' },
        h('span', { class: 'meta' }, 'Account'),
        row(st.name, `${st.email}${st.role !== 'player' ? ` \u00b7 ${st.role}` : ''}. Your name, look and progress follow you to any device.`, h('div', { class: 'settings__code' }, out)),
        f.note ? h('p', { class: 'setting__desc' }, f.note) : null,
      );
    }
    const field = (type: string, key: 'email' | 'password', placeholder: string, auto: string) => {
      const i = h('input', { type, class: 'settings__code-input', placeholder, autocomplete: auto, value: f[key], 'aria-label': placeholder, spellcheck: 'false' }) as HTMLInputElement;
      i.addEventListener('input', () => (f[key] = i.value));
      i.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') run(a.signIn(f.email.trim(), f.password));
      });
      return i;
    };
    const btn = (label: string, fn: () => void) => {
      const b = h('button', {}, label) as HTMLButtonElement;
      b.disabled = f.busy;
      b.addEventListener('click', fn);
      return b;
    };
    const needEmail = () => (f.email.includes('@') ? true : ((f.note = 'Type your email first.'), this.render(), false));
    return h(
      'div',
      { class: 'settings__section' },
      h('span', { class: 'meta' }, 'Account'),
      h(
        'div',
        { class: 'setting setting--stack' },
        h('div', {}, h('span', { class: 'setting__label' }, 'Playing as a guest'), h('span', { class: 'setting__desc' }, 'Sign in to keep your name, look and progress on every device. Guests can do everything else.')),
        h('div', { class: 'account__fields' }, field('email', 'email', 'Email', 'email'), field('password', 'password', 'Password', 'current-password')),
        h(
          'div',
          { class: 'account__actions' },
          btn('Sign in', () => needEmail() && run(a.signIn(f.email.trim(), f.password))),
          btn('Create account', () => needEmail() && run(a.signUp(f.email.trim(), f.password, this.together.name()))),
          btn('Email me a link', () => needEmail() && run(a.magicLink(f.email.trim()))),
          btn('Continue with Google', () => run(a.google())),
        ),
        note,
      ),
    );
  }

  /** Together: your name, the room link, and a way back to a night of your own. */
  private togetherSection(row: (label: string, desc: string | null, control: HTMLElement) => HTMLElement) {
    const t = this.together;
    const name = h('input', { type: 'text', class: 'settings__code-input', value: t.name(), maxlength: '24', 'aria-label': 'Your name', spellcheck: 'false' }) as HTMLInputElement;
    const saveName = () => t.setName(name.value);
    name.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') name.blur();
    });
    name.addEventListener('change', saveName);
    const room = t.room();
    const others = t.others();
    const link = h('button', {}, room ? 'Copy link' : 'Invite someone');
    link.addEventListener('click', () => {
      t.invite().then(
        (msg) => {
          link.textContent = msg;
          setTimeout(() => this.render(), 1600);
        },
        () => (link.textContent = 'Couldn\u2019t make a link'),
      );
    });
    const alone = h('button', {}, 'Play alone');
    alone.addEventListener('click', () => {
      t.leave();
      this.render();
    });
    return h(
      'div',
      { class: 'settings__section' },
      h('span', { class: 'meta' }, 'Together'),
      row('Your name', 'What the others see above your head.', h('div', { class: 'settings__code' }, name)),
      row(
        room ? 'In a shared night' : 'Alone tonight',
        room ? (others.length ? `Out with you: ${others.join(', ')}.` : 'Nobody else here yet. Send them the link.') : 'Make a link and anyone who opens it walks the same streets.',
        h('div', { class: 'settings__code' }, link, room ? alone : null),
      ),
    );
  }

  /** Car radio: volume, stations you've saved, and a search of the Radio Browser directory. */
  private radioSection(row: (label: string, desc: string | null, control: HTMLElement) => HTMLElement, volume: HTMLElement) {
    const input = h('input', { type: 'search', class: 'settings__code-input', placeholder: 'Search stations: jazz, Tokyo, BBC…', 'aria-label': 'Search radio stations', value: this.query, spellcheck: 'false' }) as HTMLInputElement;
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') go();
    });
    input.addEventListener('input', () => (this.query = input.value));
    const go = () => {
      const q = input.value.trim();
      if (!q) return;
      this.query = q;
      this.searchNote = 'Searching…';
      this.results = null;
      this.render();
      searchStations(q).then(
        (r) => {
          this.results = r;
          this.searchNote = r.length ? '' : 'Nothing found that plays over https. Try a genre or a city.';
          this.render();
        },
        (err: Error) => {
          this.searchNote = err.message;
          this.render();
        },
      );
    };
    const find = h('button', {}, 'Search');
    find.addEventListener('click', go);

    const saved = new Set(this.radio.favourites.map((f) => f.rb));
    const results = (this.results ?? []).map((r) =>
      h(
        'div',
        { class: 'radio__row' },
        h('div', {}, h('span', { class: 'setting__label' }, r.name), h('span', { class: 'setting__desc' }, [r.country, r.tags.split(',').slice(0, 3).join(', ')].filter(Boolean).join(' · '))),
        saved.has(r.uuid)
          ? h('span', { class: 'meta' }, 'Saved')
          : h('button', { onclick: () => { this.radio.addFavourite(r); this.render(); } }, 'Add'),
      ),
    );
    const favs = this.radio.favourites.map((f) =>
      h(
        'div',
        { class: 'radio__row' },
        h('div', {}, h('span', { class: 'setting__label' }, f.name), h('span', { class: 'setting__desc' }, f.note)),
        h('button', { onclick: () => { this.radio.removeFavourite(f.id); this.render(); } }, 'Remove'),
      ),
    );
    return h(
      'div',
      { class: 'settings__section' },
      h('span', { class: 'meta' }, 'Car radio'),
      row('Radio', 'Live internet radio in any car or taxi. R changes station.', volume),
      h('div', { class: 'setting setting--stack' }, h('div', {}, h('span', { class: 'setting__label' }, 'Find a station'), h('span', { class: 'setting__desc', 'aria-live': 'polite' }, this.searchNote || 'Real stations from the Radio Browser directory. Add one and it joins the dial.')), h('div', { class: 'settings__code' }, input, find)),
      ...results,
      favs.length ? h('div', { class: 'radio__head' }, h('span', { class: 'meta' }, 'On your dial')) : null,
      ...favs,
      h('p', { class: 'setting__desc radio__credit' }, 'Presets from SomaFM, listener-supported radio from San Francisco (somafm.com). Directory by radio-browser.info.'),
    );
  }

  private cloudRows(row: (label: string, desc: string | null, control: HTMLElement) => HTMLElement) {
    const code = this.cloud.code();
    const copy = h('button', {}, 'Copy');
    copy.addEventListener('click', () => {
      navigator.clipboard?.writeText(code).then(
        () => (copy.textContent = 'Copied'),
        () => (copy.textContent = 'Select and copy'),
      );
    });
    const input = h('input', { type: 'text', class: 'settings__code-input', placeholder: 'Paste a save code', 'aria-label': 'Save code', spellcheck: 'false' }) as HTMLInputElement;
    const status = h('span', { class: 'setting__desc', 'aria-live': 'polite' });
    const load = h('button', {}, 'Restore');
    load.addEventListener('click', () => {
      status.textContent = 'Looking…';
      this.cloud.restore(input.value).then(
        (msg) => {
          status.textContent = msg;
          input.value = '';
        },
        (err: Error) => (status.textContent = err.message),
      );
    });
    // keep typing in the field from reaching the game's key bindings
    input.addEventListener('keydown', (e) => e.stopPropagation());
    return [
      row('Save code', 'Enter it on another device to continue there.', h('div', { class: 'settings__code' }, h('code', {}, code), copy)),
      h('div', { class: 'setting setting--stack' }, h('div', {}, h('span', { class: 'setting__label' }, 'Continue from another device'), status), h('div', { class: 'settings__code' }, input, load)),
    ];
  }
}

function keyRow(keys: string[], label: string) {
  return [h('span', {}, ...keys.map((k) => h('span', { class: 'key', style: 'margin-right:6px' }, k))), h('span', { class: 'meta' }, label)];
}
