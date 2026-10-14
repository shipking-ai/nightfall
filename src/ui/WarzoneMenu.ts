import { h, setOn } from './dom';
import { glyph, hintRow } from '../input/glyphs';
import type { Action } from '../input/actions';
import { MODES, type ModeId } from '../modes/warzone/modes';
import { CHALLENGES, MAX_LEVEL, xpFor, type Career } from '../modes/warzone/career';
import { WEAPON, WEAPONS } from '../modes/warzone/arsenal';
import type { Loadout } from '../modes/warzone/weapons';
import { STREAKS } from '../modes/warzone/Streaks';

/**
 * Warzone's own front end: Play (the mode, the bots, Hardline, the view),
 * Loadouts (into the gunsmith), Career (level, numbers, challenges, what
 * opens next) and Controls. Plain buttons, so the controller, the keyboard
 * and the mouse all drive it; LB / RB change tabs.
 */

type Tab = 'play' | 'loadouts' | 'career' | 'controls';
const TABS: [Tab, string][] = [['play', 'Play'], ['loadouts', 'Loadouts'], ['career', 'Career'], ['controls', 'Controls']];

export interface MenuState {
  mode: ModeId;
  bots: string;
  hardline: boolean;
  firstPerson: boolean;
  loadouts: Loadout[];
  loadout: number;
  career: Career;
}

export interface MenuActions {
  start(): void;
  leave(): void;
  pick(mode: ModeId): void;
  bots(): void;
  hardline(): void;
  view(): void;
  edit(i: number): void;
  choose(i: number): void;
}

const CONTROLS: [Action, string][] = [
  ['attack', 'Fire'], ['aim', 'Aim down sights'], ['reload', 'Reload (hold to inspect)'], ['nextWeapon', 'Switch weapon'], ['melee', 'Melee'],
  ['lethal', 'Lethal (hold a frag to cook it)'], ['tactical', 'Tactical'], ['streak', 'Use a support streak'], ['sprint', 'Sprint'], ['crouch', 'Crouch'],
  ['jump', 'Jump · deploy'], ['interact', 'Plant · defuse · gunsmith'], ['screen', 'First / third person'], ['scoreboard', 'Scoreboard'],
];

export class WarzoneMenu {
  el: HTMLElement;
  private body: HTMLElement;
  private tabs: HTMLElement;
  private head: HTMLElement;
  tab: Tab = 'play';
  isOpen = false;
  private s!: MenuState;

  constructor(parent: HTMLElement, private act: MenuActions) {
    this.head = h('div', { class: 'wzm-head' });
    this.tabs = h('nav', { class: 'wzm-tabs' });
    this.body = h('div', { class: 'wzm-body' });
    this.el = h('section', { class: 'wzm', 'aria-label': 'Warzone', 'data-nav-scope': '' }, this.head, this.tabs, this.body);
    parent.append(this.el);
  }

  open(s: MenuState) {
    this.isOpen = true;
    this.s = s;
    setOn(this.el, true);
    this.render();
  }

  close() {
    this.isOpen = false;
    setOn(this.el, false);
  }

  /** Something changed (a setting, your career): draw it again. */
  refresh(s: MenuState) {
    this.s = s;
    if (this.isOpen) this.render();
  }

  cycleTab(d: -1 | 1) {
    const i = TABS.findIndex(([t]) => t === this.tab);
    this.tab = TABS[(i + d + TABS.length) % TABS.length][0];
    this.render();
  }

  private render() {
    const s = this.s, c = s.career, lv = c.level;
    this.head.replaceChildren(
      h('h1', { class: 'wzm-title' }, 'Warzone'),
      h('div', { class: 'wzm-level' }, h('b', {}, `Level ${lv}`), h('i', { class: 'wzm-xp' }, h('i', { style: `transform:scaleX(${c.progress.toFixed(3)})` })), h('span', { class: 'meta' }, lv >= MAX_LEVEL ? 'Top level' : `${c.data.xp - xpFor(lv)} / ${xpFor(lv + 1) - xpFor(lv)} XP`)),
    );
    this.tabs.replaceChildren(
      h('span', { class: 'wzm-tabs__hint' }, glyph('tabPrev')),
      ...TABS.map(([t, name]) => h('button', { class: `wzm-tab${t === this.tab ? ' is-sel' : ''}`, onclick: () => ((this.tab = t), this.render()) }, name)),
      h('span', { class: 'wzm-tabs__hint' }, glyph('tabNext')),
    );
    this.body.replaceChildren(...(this.tab === 'play' ? this.play() : this.tab === 'loadouts' ? this.loadouts() : this.tab === 'career' ? this.careerTab() : this.controls()));
  }

  private play(): HTMLElement[] {
    const s = this.s;
    const modes = h(
      'div',
      { class: 'wzm-modes' },
      ...MODES.map((m) =>
        h('button', { class: `wzm-mode${m.id === s.mode ? ' is-sel' : ''}`, 'aria-pressed': m.id === s.mode ? 'true' : 'false', onclick: () => this.act.pick(m.id) }, h('b', {}, m.name), h('span', {}, m.line)),
      ),
    );
    const opt = (label: string, value: string, fn: () => void) => h('button', { class: 'wzm-opt', onclick: fn }, h('span', { class: 'meta' }, label), h('b', {}, value));
    const lo = s.loadouts[s.loadout];
    return [
      modes,
      h(
        'div',
        { class: 'wzm-row' },
        opt('Bots', s.bots, () => this.act.bots()),
        opt('Hardline', s.hardline ? 'On' : 'Off', () => this.act.hardline()),
        opt('View', s.firstPerson ? 'First person' : 'Over the shoulder', () => this.act.view()),
        opt('Loadout', lo ? lo.name : '', () => this.act.choose((s.loadout + 1) % s.loadouts.length)),
        h('button', { class: 'wzm-go', 'data-nav-first': '', onclick: () => this.act.start() }, 'Deploy'),
      ),
      h('p', { class: 'wzm-note meta' }, 'A private match against bots, in Pier 9 Yard. Six a side (twelve for yourselves in free-for-all).'),
      h('button', { class: 'wzm-leave', onclick: () => this.act.leave() }, 'Leave Warzone'),
    ];
  }

  private loadouts(): HTMLElement[] {
    const s = this.s;
    return [
      h(
        'div',
        { class: 'wzm-loads' },
        ...s.loadouts.map((l, i) =>
          h(
            'button',
            { class: `wzm-load${i === s.loadout ? ' is-sel' : ''}${l.custom ? ' is-custom' : ''}`, onclick: () => this.act.edit(i) },
            h('b', {}, l.name),
            h('span', {}, `${WEAPON[l.primary]?.name ?? ''} · ${WEAPON[l.secondary]?.name ?? ''}`),
            h('em', { class: 'meta' }, l.custom ? 'Yours · edit' : 'Preset · edit a copy'),
          ),
        ),
      ),
      h('p', { class: 'wzm-note meta' }, 'Pick one to open the gunsmith. Presets are copied into your slots; yours save as you change them.'),
    ];
  }

  private careerTab(): HTMLElement[] {
    const c = this.s.career, st = c.data.stats, lv = c.level;
    const fav = Object.entries(st.byGun).sort((a, b) => b[1] - a[1])[0];
    const num = (label: string, v: string | number) => h('div', { class: 'wzm-num' }, h('b', {}, String(v)), h('span', { class: 'meta' }, label));
    const next: HTMLElement[] = [];
    for (let l = lv + 1; l <= Math.min(MAX_LEVEL, lv + 6); l++) {
      const opens = c.unlocksAt(l);
      if (opens.length) next.push(h('li', {}, h('b', {}, `Level ${l}`), ` ${opens.join(', ')}`));
    }
    return [
      h(
        'div',
        { class: 'wzm-nums' },
        num('Kills', st.kills),
        num('Deaths', st.deaths),
        num('K/D', st.deaths ? (st.kills / st.deaths).toFixed(2) : st.kills),
        num('Headshots', st.heads),
        num('Wins', `${st.wins} / ${st.matches}`),
        num('Objectives', st.caps),
        num('Best life', st.bestStreak),
        num('Favourite', fav ? `${WEAPON[fav[0]]?.name ?? fav[0]}` : '—'),
      ),
      h('div', { class: 'wzm-cols' },
        h('div', {},
          h('h3', {}, 'Challenges'),
          h('ul', { class: 'wzm-ch' }, ...CHALLENGES.map((ch) => {
            const v = Math.min(ch.goal, ch.of(st)), done = c.data.done.includes(ch.id);
            return h('li', { class: done ? 'is-done' : '' }, h('span', {}, ch.name), h('i', {}, h('i', { style: `transform:scaleX(${(v / ch.goal).toFixed(3)})` })), h('em', { class: 'meta' }, done ? 'Done' : `${v} / ${ch.goal} · ${ch.xp} XP`));
          })),
        ),
        h('div', {},
          h('h3', {}, 'Coming up'),
          next.length ? h('ul', { class: 'wzm-next' }, ...next) : h('p', { class: 'meta' }, 'Everything is open.'),
          h('h3', {}, 'Support streaks'),
          h('ul', { class: 'wzm-next' }, ...STREAKS.map((x) => h('li', {}, h('b', {}, `${x.kills} kills`), ` ${x.name}: ${x.line}`))),
          h('p', { class: 'meta' }, `${WEAPONS.filter((w) => w.level <= lv).length} of ${WEAPONS.length} weapons open. Levels come from playing: kills, objectives, matches and challenges. Nothing is for sale.`),
        ),
      ),
    ];
  }

  private controls(): HTMLElement[] {
    return [h('div', { class: 'wzm-controls' }, ...CONTROLS.map(([a, label]) => hintRow(a, label))), h('p', { class: 'wzm-note meta' }, 'Rebind anything in Settings → Controls. Sensitivity, dead zones, response curves, aim assist and hold-or-toggle are there too.')];
  }
}
