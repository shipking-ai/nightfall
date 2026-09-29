import { h, setOn } from '../../ui/dom';
import { ATTRS, PERKS, SKILLS, BACKGROUNDS, maxHealth, perkAvailable, xpFor } from '../game/character';
import { FACTIONS, standing } from '../game/factions';
import { item, KIND_LABEL, type ItemKind } from '../game/items';
import { current, type Quest } from '../game/quests';
import { SLOTS, type SaveEnvelope, type SlotId } from '../game/saves';
import type { Game, Stack } from '../game/Game';

/**
 * The Casefile: your life on paper. What you're working on and what you've
 * written down; who you are and what you're good at; what's in your pockets;
 * who thinks what of you; where you've been; and the save slots. One folder,
 * tabs across the top (the shoulder buttons flip them).
 */

export type Tab = 'case' | 'you' | 'pockets' | 'people' | 'places' | 'saves';
const TABS: [Tab, string][] = [['case', 'Case'], ['you', 'You'], ['pockets', 'Pockets'], ['people', 'People'], ['places', 'Places'], ['saves', 'Saves']];

export interface CasefileHooks {
  pos(): { x: number; z: number };
  track(id: string | null): void;
  save(slot: SlotId): boolean;
  load(slot: SlotId): void;
  peek(slot: SlotId): SaveEnvelope | null;
  newLife(): void;
  /** something you did changed what you look like or hold */
  changed(): void;
  toast(text: string): void;
}

export class Casefile {
  el: HTMLElement;
  private tabs = new Map<Tab, HTMLButtonElement>();
  private body: HTMLElement;
  private tab: Tab = 'case';
  private sel: number | null = null;
  private confirmNew = false;
  g!: Game;

  constructor(root: HTMLElement, private hk: CasefileHooks) {
    const nav = h('nav', { class: 'cf__tabs', role: 'tablist' });
    for (const [id, label] of TABS) {
      const b = h('button', { class: 'cf__tab', role: 'tab', type: 'button' }, label);
      b.addEventListener('click', () => this.show(id));
      this.tabs.set(id, b);
      nav.append(b);
    }
    this.body = h('div', { class: 'cf__body' });
    this.el = h(
      'section',
      { class: 'layer cf', role: 'dialog', 'aria-label': 'Casefile' },
      h('div', { class: 'cf__folder' }, h('header', { class: 'cf__head' }, h('span', { class: 'cf__stamp meta' }, 'Casefile'), nav), this.body),
    );
    root.append(this.el);
  }

  get isOpen() {
    return this.el.classList.contains('is-on');
  }

  open(g: Game, tab: Tab = this.tab) {
    this.g = g;
    setOn(this.el, true);
    this.show(tab);
  }

  close() {
    setOn(this.el, false);
    this.confirmNew = false;
  }

  flip(dir: -1 | 1) {
    const i = TABS.findIndex(([t]) => t === this.tab);
    this.show(TABS[(i + dir + TABS.length) % TABS.length][0]);
  }

  show(tab: Tab, focus = true) {
    this.tab = tab;
    for (const [id, b] of this.tabs) {
      b.classList.toggle('is-on', id === tab);
      b.setAttribute('aria-selected', String(id === tab));
    }
    const g = this.g;
    const view = tab === 'case' ? this.caseView(g) : tab === 'you' ? this.youView(g) : tab === 'pockets' ? this.pocketsView(g) : tab === 'people' ? this.peopleView(g) : tab === 'places' ? this.placesView(g) : this.savesView();
    this.body.replaceChildren(view);
    this.body.scrollTop = 0;
    if (focus) requestAnimationFrame(() => this.body.querySelector<HTMLElement>('button:not([disabled])')?.focus({ preventScroll: true }));
  }

  private refresh() {
    const y = this.body.scrollTop;
    this.show(this.tab, false);
    this.body.scrollTop = y;
  }

  /* ── Case: jobs, the story, the journal ─────────────────── */

  private caseView(g: Game) {
    const active = g.s.quests.filter((q) => q.state === 'active');
    const closed = g.s.quests.filter((q) => q.state !== 'active').slice(-8).reverse();
    const card = (q: Quest) => {
      const tracked = g.s.track === q.id;
      const o = current(q);
      const b = h('button', { class: `cf__case${tracked ? ' is-tracked' : ''}${q.kind === 'main' ? ' is-main' : ''}`, type: 'button', 'aria-pressed': String(tracked) },
        h('span', { class: 'cf__case-kind meta' }, q.kind === 'main' ? 'The story' : q.giver ? `${q.giver.name} · ${q.giver.townName}` : 'Job'),
        h('span', { class: 'cf__case-title' }, q.title),
        h('span', { class: 'cf__case-sum' }, q.summary),
        h('ul', { class: 'cf__objs' }, ...q.objectives.map((ob) => h('li', { class: ob.done ? 'is-done' : ob === o ? 'is-now' : '' }, ob.text))),
        h('span', { class: 'cf__case-foot meta' }, tracked ? 'Tracked on your compass' : 'Track this', q.reward.money ? ` · $${q.reward.money}` : ''),
      );
      b.addEventListener('click', () => {
        this.hk.track(tracked ? null : q.id);
        this.refresh();
      });
      return b;
    };
    return h('div', { class: 'cf__cols' },
      h('div', { class: 'cf__col' },
        h('h3', { class: 'cf__h' }, 'Open cases'),
        active.length ? h('div', { class: 'cf__cases' }, ...active.map(card)) : h('p', { class: 'cf__empty' }, 'Nothing open. Ask around: most people have something that needs doing.'),
        closed.length ? h('h3', { class: 'cf__h' }, 'Closed') : null,
        ...closed.map((q) => h('p', { class: `cf__closed cf__closed--${q.state}` }, h('span', { class: 'meta' }, q.state === 'done' ? 'Closed' : 'Failed'), ` ${q.title}. ${q.log[q.log.length - 1] ?? ''}`)),
      ),
      h('div', { class: 'cf__col cf__journal' },
        h('h3', { class: 'cf__h' }, 'Notebook'),
        ...g.s.journal.slice(-28).reverse().map((j) => h('p', { class: 'cf__note' }, h('span', { class: 'meta' }, `Day ${j.day + 1} · ${j.time}`), j.text)),
        g.s.journal.length ? null : h('p', { class: 'cf__empty' }, 'Blank pages.'),
      ),
    );
  }

  /* ── You: attributes, skills, perks, the body ──────────── */

  private youView(g: Game) {
    const c = g.c;
    const bg = BACKGROUNDS.find((b) => b.id === c.background);
    const bar = (label: string, v: number, max: number, cls = '') =>
      h('div', { class: `cf__bar ${cls}` }, h('span', { class: 'meta' }, label), h('span', { class: 'cf__track' }, h('span', { class: 'cf__fill', style: `width:${Math.round((100 * v) / max)}%` })), h('span', { class: 'cf__num meta' }, `${Math.round(v)}`));
    const attrs = ATTRS.map((a) => {
      const plus = h('button', { class: 'cf__plus', type: 'button', disabled: c.attrPoints <= 0 || c.attrs[a.id] >= 10, 'aria-label': `Raise ${a.name}` }, '+');
      plus.addEventListener('click', () => {
        g.raise(a.id);
        this.refresh();
      });
      return h('div', { class: 'cf__attr' }, h('span', { class: 'cf__attr-n' }, String(c.attrs[a.id])), h('span', { class: 'cf__attr-name' }, a.name, h('small', {}, a.desc)), c.attrPoints > 0 ? plus : null);
    });
    const skills = SKILLS.map((s) => h('div', { class: 'cf__skill' }, h('span', {}, s.name), h('span', { class: 'cf__track' }, h('span', { class: 'cf__fill', style: `width:${Math.round(c.skills[s.id])}%` })), h('span', { class: 'cf__num meta' }, String(Math.floor(c.skills[s.id])))));
    const have = c.perks.map((id) => PERKS.find((p) => p.id === id)!).filter(Boolean);
    const open = PERKS.filter((p) => perkAvailable(c, p));
    const perkBtn = (p: (typeof PERKS)[number]) => {
      const b = h('button', { class: 'cf__perk', type: 'button', disabled: c.perkPoints <= 0 }, h('span', { class: 'cf__perk-name' }, p.name), h('small', {}, p.desc));
      b.addEventListener('click', () => {
        g.takePerk(p.id);
        this.refresh();
      });
      return b;
    };
    return h('div', { class: 'cf__cols' },
      h('div', { class: 'cf__col' },
        h('p', { class: 'cf__name' }, c.name, h('span', { class: 'meta' }, `${bg?.name ?? ''} · Level ${c.level}`)),
        bar('XP', c.xp, xpFor(c.level), 'is-xp'),
        bar('Health', c.health, maxHealth(c), 'is-hp'),
        bar('Fed', c.fed, 100),
        bar('Rested', c.rest, 100),
        bar('Warm', c.warmth, 100),
        h('p', { class: 'cf__status meta' }, g.statusLine().join(' · ') || 'Holding up.'),
        h('h3', { class: 'cf__h' }, 'Attributes', c.attrPoints ? h('span', { class: 'cf__badge meta' }, `${c.attrPoints} to spend`) : null),
        ...attrs,
      ),
      h('div', { class: 'cf__col' },
        h('h3', { class: 'cf__h' }, 'Skills'),
        h('p', { class: 'cf__hint' }, 'Skills grow by doing: talk your way out, pick the lock, drive the long road.'),
        ...skills,
        h('h3', { class: 'cf__h' }, 'Perks', c.perkPoints ? h('span', { class: 'cf__badge meta' }, `${c.perkPoints} to choose`) : null),
        have.length ? h('div', { class: 'cf__perks' }, ...have.map((p) => h('div', { class: 'cf__perk is-have' }, h('span', { class: 'cf__perk-name' }, p.name), h('small', {}, p.desc)))) : null,
        c.perkPoints > 0 ? h('div', { class: 'cf__perks' }, ...open.map(perkBtn)) : h('p', { class: 'cf__hint' }, 'A new perk every level.'),
      ),
    );
  }

  /* ── Pockets ──────────────────────────────────────────── */

  private pocketsView(g: Game) {
    const inv = g.s.inv;
    if (this.sel !== null && !inv[this.sel]) this.sel = null;
    const kinds = [...new Set(inv.map((s) => item(s.id).kind))] as ItemKind[];
    const row = (st: Stack) => {
      const i = inv.indexOf(st);
      const d = item(st.id);
      const on = g.s.equipped === st.id || Object.values(g.s.worn).includes(st.id);
      const b = h('button', { class: `cf__item${this.sel === i ? ' is-sel' : ''}${on ? ' is-on' : ''}`, type: 'button' }, h('span', {}, st.name ?? d.name), h('span', { class: 'meta' }, on ? 'in use' : st.n > 1 ? `×${st.n}` : ''), h('span', { class: 'cf__num meta' }, `${(d.w * st.n).toFixed(1)} kg`));
      b.addEventListener('click', () => {
        this.sel = i;
        this.refresh();
      });
      return b;
    };
    const st = this.sel !== null ? inv[this.sel] : null;
    const detail = st ? this.itemDetail(g, st) : h('p', { class: 'cf__empty' }, 'Choose something to look at it.');
    const w = g.weight(), cap = g.carry;
    return h('div', { class: 'cf__cols' },
      h('div', { class: 'cf__col' },
        h('p', { class: 'cf__money' }, `$${Math.floor(g.c.money)}`, h('span', { class: `meta${w > cap ? ' is-over' : ''}` }, `${w.toFixed(1)} / ${cap} kg${w > cap ? ' · too heavy to run' : ''}`)),
        ...kinds.flatMap((k) => [h('h3', { class: 'cf__h' }, KIND_LABEL[k]), ...inv.filter((s) => item(s.id).kind === k).map(row)]),
        inv.length ? null : h('p', { class: 'cf__empty' }, 'Empty pockets.'),
      ),
      h('div', { class: 'cf__col cf__detail' }, detail),
    );
  }

  private itemDetail(g: Game, st: Stack) {
    const d = item(st.id);
    const acts: HTMLElement[] = [];
    const act = (label: string, fn: () => string | void) => {
      const b = h('button', { class: 'cf__act', type: 'button' }, label);
      b.addEventListener('click', () => {
        const msg = fn();
        if (msg) this.hk.toast(msg);
        this.hk.changed();
        this.refresh();
      });
      acts.push(b);
    };
    const inUse = g.s.equipped === st.id || Object.values(g.s.worn).includes(st.id);
    if (d.use) act(d.use.label ?? 'Use', () => g.use(st));
    if (d.wear) act(inUse ? 'Take off' : 'Wear', () => g.use(st));
    if (d.weapon) act(inUse ? 'Put away' : 'Hold', () => g.use(st));
    if (st.id === 'parcel' && st.quest) {
      const q = g.s.quests.find((x) => x.id === st.quest);
      if (q && !q.data.opened) act('Open it', () => {
        q.data.opened = true;
        g.practice('lockpicking', 1);
        const c = String(q.data.contents);
        const what = c === 'contraband' ? 'Pills, hundreds of them, in unmarked bags. The Watch would want to see this.' : c === 'money' ? 'Banded cash. A lot of it.' : c === 'medicine' ? 'Prescription bottles, a name on each.' : c === 'photographs' ? 'Photographs of someone going about their day, taken from a distance.' : 'Letters. Love letters, by the look of them.';
        st.desc = `Opened. ${what}`;
        if (c === 'contraband' && !q.objectives.some((o) => o.poi === 'watch')) q.log.push('Opened the parcel. Contraband.');
        return 'You slit the tape.';
      });
    }
    if (!d.quest) act(st.n > 1 ? 'Drop one' : 'Drop', () => {
      g.take(st.id, 1);
      return `Dropped the ${d.name.toLowerCase()}.`;
    });
    const stats: string[] = [];
    if (d.weapon) stats.push(`Damage ${d.weapon.dmg}`, d.weapon.ammo ? `Takes ${item(d.weapon.ammo).name.toLowerCase()} (${g.count(d.weapon.ammo)})` : 'Close quarters');
    if (d.wear) stats.push(`Warmth ${Math.round((d.wear.warm ?? 0) * 100)}`, d.wear.dry ? `Rain ${Math.round(d.wear.dry * 100)}` : '');
    if (d.use?.fed) stats.push(`Food +${d.use.fed}`);
    if (d.use?.heal) stats.push(`Heals ${d.use.heal}`);
    if (d.v) stats.push(`Worth about $${d.v}`);
    return h('div', { class: 'cf__paper' },
      h('span', { class: 'meta' }, KIND_LABEL[d.kind]),
      h('h3', { class: 'cf__paper-title' }, st.name ?? d.name),
      h('p', {}, st.desc ?? d.desc),
      stats.filter(Boolean).length ? h('p', { class: 'meta cf__stats' }, stats.filter(Boolean).join(' · ')) : null,
      h('div', { class: 'cf__acts' }, ...acts),
    );
  }

  /* ── People: factions, towns, the ones you've met ──────── */

  private peopleView(g: Game) {
    const rep = (label: string, v: number, desc?: string) =>
      h('div', { class: 'cf__rep' }, h('span', { class: 'cf__rep-name' }, label, desc ? h('small', {}, desc) : null), h('span', { class: 'cf__rep-scale' }, h('span', { class: 'cf__rep-mark', style: `left:${50 + v / 2}%` })), h('span', { class: `meta cf__rep-word${v < -5 ? ' is-bad' : v >= 20 ? ' is-good' : ''}` }, standing(v)));
    const met = Object.entries(g.s.mem.met).sort((a, b) => b[1].last - a[1].last).slice(0, 30);
    return h('div', { class: 'cf__cols' },
      h('div', { class: 'cf__col' }, h('h3', { class: 'cf__h' }, 'Powers in the county'), ...FACTIONS.map((f) => rep(f.name, g.s.rep[f.id], f.desc))),
      h('div', { class: 'cf__col' },
        h('h3', { class: 'cf__h' }, 'Towns'),
        ...Object.entries(g.s.mem.visited).map(([id, v]) => rep(v.name, g.s.towns[id] ?? 0)),
        Object.keys(g.s.mem.visited).length ? null : h('p', { class: 'cf__empty' }, 'Nowhere yet.'),
        h('h3', { class: 'cf__h' }, 'People you’ve met'),
        ...met.map(([, m]) => h('p', { class: 'cf__person' }, h('span', {}, m.name), h('span', { class: 'meta' }, `${m.job} · ${g.s.mem.visited[m.town]?.name ?? ''}`), h('span', { class: `meta${m.disp < -10 ? ' is-bad' : m.disp > 20 ? ' is-good' : ''}` }, m.disp > 40 ? 'Friend' : m.disp > 10 ? 'Warm' : m.disp < -40 ? 'Enemy' : m.disp < -10 ? 'Cold' : 'Neutral'))),
        met.length ? null : h('p', { class: 'cf__empty' }, 'Nobody yet. Walk up to someone and talk.'),
      ),
    );
  }

  /* ── Places ───────────────────────────────────────────── */

  private placesView(g: Game) {
    const p = this.hk.pos();
    const list = Object.entries(g.s.mem.visited).map(([id, v]) => ({ id, v, d: Math.hypot(v.x - p.x, v.z - p.z) })).sort((a, b) => a.d - b.d);
    const dir = (dx: number, dz: number) => {
      const a = Math.atan2(dx, -dz);
      return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((a / (Math.PI * 2)) * 8 + 8) % 8) % 8];
    };
    return h('div', { class: 'cf__col cf__places' },
      h('h3', { class: 'cf__h' }, 'Places you’ve been'),
      h('p', { class: 'cf__hint' }, 'The full map comes with the atlas. For now: where, how far, which way.'),
      ...list.map(({ v, d }) => h('p', { class: 'cf__place' }, h('span', {}, v.name), h('span', { class: 'meta' }, `${v.kind} · ${v.biome}`), h('span', { class: 'cf__num meta' }, d < 300 ? 'here' : `${(d / 1000).toFixed(1)} km ${dir(v.x - p.x, v.z - p.z)}`))),
      list.length ? null : h('p', { class: 'cf__empty' }, 'Nowhere yet.'),
    );
  }

  /* ── Saves ────────────────────────────────────────────── */

  private savesView() {
    const rows = SLOTS.map((slot) => {
      const e = this.hk.peek(slot);
      const when = e ? new Date(e.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      const save = h('button', { class: 'cf__act', type: 'button', disabled: slot === 'auto' }, slot === 'auto' ? 'Automatic' : 'Save here');
      save.addEventListener('click', () => {
        this.hk.toast(this.hk.save(slot) ? 'Saved.' : 'Couldn’t save (storage is full or blocked).');
        this.refresh();
      });
      const load = h('button', { class: 'cf__act', type: 'button', disabled: !e }, 'Load');
      load.addEventListener('click', () => this.hk.load(slot));
      return h('div', { class: 'cf__slot' },
        h('span', { class: 'cf__slot-n meta' }, slot === 'auto' ? 'Auto' : `Slot ${slot}`),
        h('span', { class: 'cf__slot-what' }, e ? e.label : 'Empty', e ? h('small', {}, `${e.place} · ${when} · ${Math.round(e.playtime / 60)} min played`) : null),
        h('span', { class: 'cf__acts' }, save, load),
      );
    });
    const fresh = h('button', { class: `cf__act${this.confirmNew ? ' is-danger' : ''}`, type: 'button' }, this.confirmNew ? 'Yes: start a new life (unsaved progress is lost)' : 'Start a new life…');
    fresh.addEventListener('click', () => {
      if (!this.confirmNew) {
        this.confirmNew = true;
        this.refresh();
        return;
      }
      this.confirmNew = false;
      this.hk.newLife();
    });
    return h('div', { class: 'cf__col cf__saves' }, h('h3', { class: 'cf__h' }, 'Save slots'), h('p', { class: 'cf__hint' }, 'The game saves itself when you sleep, finish a job, reach a new town, and every few minutes.'), ...rows, h('div', { class: 'cf__acts' }, fresh));
  }
}
