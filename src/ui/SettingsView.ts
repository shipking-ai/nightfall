import { h, setOn } from './dom';
import { QUALITIES, type Settings, type SettingsData } from '../core/Settings';
import { searchStations, type Radio, type RadioResult } from '../audio/Radio';
import type { Input } from '../core/Input';
import { ACTIONS, GROUP_LABELS, type Action, type ActionGroup } from '../input/actions';
import { glyph, keyName, padName } from '../input/glyphs';

type Tab = 'graphics' | 'audio' | 'controls' | 'controller' | 'interface' | 'account' | 'radio' | 'data';
const TABS: [Tab, string][] = [
  ['graphics', 'Graphics'],
  ['audio', 'Audio'],
  ['controller', 'Controller'],
  ['controls', 'Keyboard & mouse'],
  ['interface', 'Interface'],
  ['account', 'Account'],
  ['radio', 'Radio'],
  ['data', 'Data'],
];

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
  private tab: Tab = 'graphics';
  private tabsEl: HTMLElement;
  /** remapping: the action (and device) waiting for a key or button */
  listening: { action: Action; device: 'kbm' | 'pad'; note: HTMLElement } | null = null;
  private remapNote = '';
  input!: Input;

  constructor(root: HTMLElement, private settings: Settings, private onClose: () => void, private onErase: () => void, private cloud: CloudControls, private radio: Radio, private together: TogetherControls, private account: AccountControls, private perf?: () => { tier: string; fps: number; gpu: string } | null) {
    this.body = h('div', { class: 'panel__body settings__body' });
    this.tabsEl = h('nav', { class: 'settings__tabs', 'aria-label': 'Settings sections' });
    this.el = h(
      'section',
      { class: 'layer panel settings', role: 'dialog', 'aria-label': 'Settings' },
      h(
        'header',
        { class: 'panel__head' },
        h('div', {}, h('span', { class: 'meta' }, 'Nightfall'), h('h2', { class: 'panel__title' }, 'Settings')),
        h('button', { class: 'panel__close', onclick: () => this.onClose() }, h('span', { class: 'meta' }, 'Close'), glyph('cancel')),
      ),
      this.tabsEl,
      this.body,
    );
    root.append(this.el);
    settings.on('change', () => this.refresh());
    // remapping a key: the next key (or mouse button) pressed anywhere
    addEventListener('keydown', (e) => this.captureKey(e, e.code), true);
    addEventListener('mousedown', (e) => this.captureKey(e, `Mouse${e.button}`), true);
  }

  /** LB / RB: the previous or next page. */
  cycleTab(d: -1 | 1) {
    if (this.listening) return;
    const i = TABS.findIndex(([t]) => t === this.tab);
    this.tab = TABS[(i + d + TABS.length) % TABS.length][0];
    this.render();
    (this.tabsEl.querySelector('[aria-current="true"]') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  private captureKey(e: Event, code: string) {
    const l = this.listening;
    if (!l || l.device !== 'kbm') return;
    e.preventDefault();
    e.stopPropagation();
    if (code === 'Escape') return this.stopListening('Cancelled.');
    const clash = this.input.bindings.conflicts(l.action, 'kbm', code);
    this.input.bindings.set(l.action, 'kbm', code);
    this.stopListening(clash.length ? `${keyName(code)} is also ${clash.map((a) => ACTIONS[a].label).join(', ')}.` : `${ACTIONS[l.action].label}: ${keyName(code)}.`);
  }

  private stopListening(note: string) {
    this.listening = null;
    this.remapNote = note;
    this.render();
  }

  private padWait = 0;
  /** Per frame while open: a pad remap takes the next button pressed (Menu cancels). */
  update() {
    const l = this.listening;
    if (!l || l.device !== 'pad') return;
    const pad = this.input.pad;
    if (!pad) return;
    // wait for whatever confirmed "Change" to be let go
    if (this.padWait > 0) {
      if (!pad.anyHeld()) this.padWait = 0;
      pad.endFrame();
      return;
    }
    const b = pad.firstEdge();
    if (!b) return;
    pad.endFrame();
    if (b === 'Menu') return this.stopListening('Cancelled.');
    const clash = this.input.bindings.conflicts(l.action, 'pad', b);
    this.input.bindings.set(l.action, 'pad', b);
    this.stopListening(clash.length ? `${padName(b, this.input.device)} is also ${clash.map((a) => ACTIONS[a].label).join(', ')}.` : `${ACTIONS[l.action].label}: ${padName(b, this.input.device)}.`);
  }

  /** Re-draw (account or room changed while open). */
  refresh() {
    if (this.el.classList.contains('is-on')) this.render();
  }

  open() {
    this.confirmErase = false;
    this.listening = null;
    this.remapNote = '';
    this.render();
    setOn(this.el, true);
  }

  close() {
    this.listening = null;
    setOn(this.el, false);
  }

  /**
   * What the settings screen says about quality. Under 'auto' this is the only
   * place the player can see what the machine was judged to be, so it has to be
   * honest about both the guess and the live frame rate.
   */
  private qualityNote(q: SettingsData['quality']): string {
    const g = this.gpu();
    if (q !== 'auto') return 'Fixed. Resolution, rain density, lights, and the expensive passes.';
    const at = g ? g.tier : '…';
    const fps = g ? ` · ${Math.round(g.fps)} fps` : '';
    return `Auto — running ${at}${fps}. Set on ${g?.gpu ?? 'this machine'}.`;
  }

  /** Live detection + frame rate, or null if the host doesn't expose it. */
  private gpu(): { tier: string; fps: number; gpu: string } | null {
    return this.perf?.() ?? null;
  }

  private render() {
    const d = this.settings.data;
    const set = <K extends keyof SettingsData>(k: K, v: SettingsData[K]) => this.settings.set(k, v);

    const seg = <K extends keyof SettingsData>(k: K, opts: [SettingsData[K], string][]) =>
      h('div', { class: 'seg', role: 'group' }, ...opts.map(([v, label]) => h('button', { 'aria-pressed': String(d[k] === v), onclick: () => set(k, v) }, label)));
    type Bool = { [K in keyof SettingsData]: SettingsData[K] extends boolean ? K : never }[keyof SettingsData];
    type Num = { [K in keyof SettingsData]: SettingsData[K] extends number ? K : never }[keyof SettingsData];
    const onOff = (k: Bool) =>
      seg(k, [
        [true, 'On'],
        [false, 'Off'],
      ]);
    const range = (k: Num, min: number, max: number, step: number, fmt: (v: number) => string, label: string) => {
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
    const section = (title: string, ...kids: (Node | null)[]) => h('div', { class: 'settings__section' }, h('span', { class: 'meta' }, title), ...kids);
    const pct = (v: number) => `${Math.round(v * 100)}`;
    const x2 = (v: number) => v.toFixed(2);

    this.tabsEl.replaceChildren(
      h('span', { class: 'settings__tabkey', 'aria-hidden': 'true' }, glyph('tabPrev')),
      ...TABS.map(([t, label]) =>
        h('button', { class: 'settings__tab', 'aria-current': String(t === this.tab), onclick: () => ((this.tab = t), this.render()) }, label),
      ),
      h('span', { class: 'settings__tabkey', 'aria-hidden': 'true' }, glyph('tabNext')),
    );

    let page: (Node | null)[] = [];
    switch (this.tab) {
      case 'graphics':
        page = [
          section(
            'Graphics',
            row('Quality', this.qualityNote(d.quality), seg('quality', QUALITIES.map((q) => [q.id, q.label]))),
            row('Shadows', 'Moonlight and the nearest street lamps.', onOff('shadows')),
            row('Post-processing', 'Bloom, grade and film grain.', onOff('postfx')),
            row('Atmosphere', 'Wet reflections, light shafts, steam and splashes.', onOff('atmosphere')),
            row('Blood', 'Sprays when someone is hit, pools when they go down.', onOff('blood')),
            row('Field of view', null, range('fov', 50, 80, 1, (v) => `${v}°`, 'Field of view')),
          ),
          section(
            'Performance',
            row('Population', 'How many people and cars are out. Lower keeps the frame rate steady on slower machines.', seg('population', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']])),
            row('Draw distance', 'How far the city is drawn, and how close people must be for full detail.', seg('drawDistance', [['near', 'Near'], ['medium', 'Medium'], ['far', 'Far']])),
          ),
        ];
        break;
      case 'audio':
        page = [
          section(
            'Audio',
            row('Master', null, range('master', 0, 1, 0.05, pct, 'Master volume')),
            row('Ambience', 'Rain, the city, footsteps.', range('ambience', 0, 1, 0.05, pct, 'Ambience volume')),
            row('Music', 'Sparse. Mostly silence.', range('music', 0, 1, 0.05, pct, 'Music volume')),
            row('Car radio', 'Live internet radio in any car or taxi.', range('radio', 0, 1, 0.05, pct, 'Radio volume')),
          ),
        ];
        break;
      case 'controller':
        page = [
          section(
            'Look',
            row('Horizontal sensitivity', null, range('padSensX', 0.3, 2.5, 0.05, x2, 'Horizontal look sensitivity')),
            row('Vertical sensitivity', null, range('padSensY', 0.3, 2.5, 0.05, x2, 'Vertical look sensitivity')),
            row('Aim sensitivity', 'Look speed while aiming, as a share of normal.', range('padAimSens', 0.25, 1.2, 0.05, x2, 'Aim sensitivity')),
            row('Scale aim with zoom', 'Through a 4× or 8× scope the look slows to match, for the mouse and the stick.', onOff('zoomSens')),
            row('Look acceleration', 'Turns faster the longer the stick is held at its edge.', range('padAccel', 0, 1, 0.05, pct, 'Look acceleration')),
            row('Response curve', 'Dynamic: fine near the centre, quick at the edge. Classic: squared. Linear: straight.', seg('padCurve', [['dynamic', 'Dynamic'], ['classic', 'Classic'], ['linear', 'Linear']])),
            row('Dead zone', 'Raise it if the camera drifts on its own.', range('padDeadzone', 0.04, 0.35, 0.01, x2, 'Stick dead zone')),
            row('Invert vertical', null, onOff('padInvertY')),
            row('Invert horizontal', null, onOff('padInvertX')),
            row('Southpaw', 'Swap the sticks: move on the right, look on the left.', onOff('southpaw')),
          ),
          section(
            'Aiming and actions',
            row('Aim assist', 'Warzone: the look slows over a target and eases towards it.', seg('aimAssist', [['off', 'Off'], ['low', 'Low'], ['standard', 'Standard']])),
            row('Sprint', null, seg('sprintMode', [['hold', 'Hold'], ['toggle', 'Toggle']])),
            row('Aim', null, seg('aimMode', [['hold', 'Hold'], ['toggle', 'Toggle']])),
            row('Crouch', null, seg('crouchMode', [['hold', 'Hold'], ['toggle', 'Toggle']])),
          ),
          section(
            'Vibration',
            row('Vibration', 'Crashes, gunfire, blocks and heavy hits. Never a constant buzz.', onOff('vibration')),
            row('Strength', null, range('vibrationStrength', 0.1, 1, 0.05, pct, 'Vibration strength')),
            row('Trigger effects', 'Impulse triggers on pads and browsers that support them; ordinary rumble otherwise.', onOff('triggerEffects')),
          ),
          this.remapSection('pad'),
        ];
        break;
      case 'controls':
        page = [
          section('Mouse', row('Mouse sensitivity', null, range('sensitivity', 0.3, 2.5, 0.05, x2, 'Mouse sensitivity')), row('Invert vertical look', null, onOff('invertY'))),
          this.remapSection('kbm'),
        ];
        break;
      case 'interface':
        page = [
          section(
            'Interface',
            row('Interface size', 'Auto makes text and focus larger when you play with a controller, for a television across the room.', seg('uiSize', [['auto', 'Auto'], ['standard', 'Standard'], ['large', 'Large']])),
            row('Button prompts', 'Auto follows whatever you last touched.', seg('prompts', [['auto', 'Auto'], ['keyboard', 'Keyboard'], ['xbox', 'Xbox'], ['playstation', 'PlayStation']])),
          ),
          section('Accessibility', row('Reduced motion', 'Stills the title camera, idle sway and interface motion.', onOff('reducedMotion'))),
        ];
        break;
      case 'account':
        page = [this.account.enabled ? this.accountSection(row) : section('Account', h('p', { class: 'setting__desc' }, 'Accounts are not set up for this copy of the game.')), this.together.enabled ? this.togetherSection(row) : null];
        break;
      case 'radio':
        page = [this.radioSection(row, range('radio', 0, 1, 0.05, pct, 'Radio volume'))];
        break;
      case 'data': {
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
        page = [
          section(
            'Data',
            row('Archive and progress', this.cloud.enabled ? 'Kept in this browser, with a copy in the city record.' : 'Stored in this browser only.', erase),
            ...(this.cloud.enabled ? this.cloudRows(row) : []),
          ),
        ];
        break;
      }
    }
    this.body.replaceChildren(h('div', { class: `settings__page settings__page--${this.tab}` }, ...page));
  }

  /** Every remappable action for one device, grouped, with Change and Reset. */
  private remapSection(device: 'kbm' | 'pad') {
    const b = this.input.bindings;
    const groups: ActionGroup[] = device === 'pad' ? ['foot', 'vehicle', 'warzone', 'fight', 'explore'] : ['move', 'foot', 'vehicle', 'warzone', 'fight', 'explore', 'system'];
    const note = h('p', { class: 'setting__desc', 'aria-live': 'polite' }, this.remapNote || (device === 'pad' ? 'Choose Change, then press the button you want. Menu cancels.' : 'Choose Change, then press the key or mouse button you want. Esc cancels.'));
    const rows: HTMLElement[] = [];
    for (const g of groups) {
      const acts = (Object.keys(ACTIONS) as Action[]).filter((a) => ACTIONS[a].group === g && !(ACTIONS[a] as { fixed?: boolean }).fixed);
      if (!acts.length) continue;
      rows.push(h('div', { class: 'remap__group meta' }, GROUP_LABELS[g]));
      for (const a of acts) {
        const cur = b.get(a)[device] as string[];
        const listening = this.listening?.action === a && this.listening.device === device;
        const shown = listening ? h('span', { class: 'meta meta--accent' }, device === 'pad' ? 'Press a button…' : 'Press a key…') : h('span', { class: 'remap__keys' }, ...(cur.length ? cur.map((c) => h('span', { class: `glyph ${device === 'pad' ? 'glyph--pill' : 'glyph--key'}` }, device === 'pad' ? padName(c as never, this.input.device === 'kbm' ? 'xbox' : this.input.device) : keyName(c))) : [h('span', { class: 'meta' }, 'Unbound')]));
        const change = h('button', { 'data-nav-id': `remap-${device}-${a}` }, listening ? 'Waiting' : 'Change') as HTMLButtonElement;
        change.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.listening) return;
          this.listening = { action: a, device, note };
          this.padWait = 1;
          this.render();
        });
        rows.push(h('div', { class: `setting remap__row${b.isCustom(a, device) ? ' is-custom' : ''}` }, h('div', {}, h('span', { class: 'setting__label' }, ACTIONS[a].label)), h('div', { class: 'remap__ctl' }, shown, change)));
      }
    }
    const reset = h('button', {}, 'Reset to defaults');
    reset.addEventListener('click', () => {
      b.reset(device);
      this.remapNote = 'Back to the defaults.';
      this.render();
    });
    return h('div', { class: 'settings__section' }, h('span', { class: 'meta' }, device === 'pad' ? 'Button layout' : 'Key bindings'), note, ...rows, h('div', { class: 'setting' }, h('div', {}), reset));
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

