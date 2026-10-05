import { h, setOn } from './dom';
import { glyph } from '../input/glyphs';
import type { Input } from '../core/Input';
import { CLASS_NAMES, WEAPON, type Weapon } from '../modes/warzone/arsenal';
import { ATTACH, MAX_ATTACHMENTS, SLOTS, SLOT_NAMES, attachmentsFor, describe, type Slot } from '../modes/warzone/attachments';
import { PRIMARIES, SECONDARIES, compile, type Gun, type Lethal, type Loadout, type Tactical } from '../modes/warzone/weapons';
import { gunModel } from '../modes/warzone/Guns';

/**
 * The gunsmith: build a loadout row by row. Up and down to pick a row, left
 * and right to change it. Every attachment shows what it gives and what it
 * costs, and the bars show the gun before (grey) and after (green better,
 * red worse). Five attachments to a gun. A drawing of the gun, side on,
 * changes as you dress it.
 *
 * Driven by the match's input polling (it runs inside the frame), so a pad,
 * the keyboard and the mouse all work the same way.
 */

export const LETHALS: [Lethal, string, string][] = [
  ['frag', 'Frag grenade', 'Cook it, throw it, clear the corner.'],
  ['semtex', 'Sticky charge', 'Sticks where it lands. Short fuse.'],
  ['molotov', 'Fire bottle', 'Burns the ground for a few seconds. Nobody holds a point on fire.'],
  ['claymore', 'Tripwire mine', 'Plant it in a doorway. Watches your back.'],
  ['throwknife', 'Throwing knife', 'Silent. One hit to the body. Pick it back up.'],
  ['c4', 'Remote charge', 'Throw it, then set it off when they walk past.'],
];
export const TACTICALS: [Tactical, string, string][] = [
  ['smoke', 'Smoke', 'A wall of smoke for a crossing.'],
  ['flash', 'Flash', 'Blinds and deafens whoever is looking at it.'],
  ['stun', 'Stun', 'Slows their legs and their aim.'],
  ['decoy', 'Decoy', 'Sounds like a fight. Shows up on their map.'],
  ['sensor', 'Sensor', 'Pings anyone moving nearby on your map.'],
  ['stim', 'Stim', 'Heal now, sprint again sooner.'],
];

type Row =
  | { kind: 'weapon'; which: 'primary' | 'secondary' }
  | { kind: 'att'; which: 'primary' | 'secondary'; slot: Slot }
  | { kind: 'lethal' }
  | { kind: 'tactical' };

/** The bars: [label, value 0..1 from a gun]. */
const BARS: [string, (g: Gun) => number][] = [
  ['Damage', (g) => Math.min(1, (g.blast ? g.blastDmg : g.dmg * g.pellets) / 130)],
  ['Fire rate', (g) => Math.min(1, 60 / g.rate / 1000)],
  ['Range', (g) => Math.min(1, g.range[1] / 170)],
  ['Accuracy', (g) => Math.max(0, 1 - (g.ads * 0.6 + g.hip * 0.4) / 0.05)],
  ['Control', (g) => Math.max(0, 1 - (g.recoil + g.kickH * 0.8) / 0.07)],
  ['Handling', (g) => Math.max(0, Math.min(1, 1 - (g.adsTime - 0.1) / 0.5))],
  ['Mobility', (g) => Math.max(0, Math.min(1, (g.weight - 0.8) / 0.3))],
];

export class Gunsmith {
  el: HTMLElement;
  open = false;
  private lo!: Loadout;
  private row = 0;
  private rows: Row[] = [];
  private list: HTMLElement;
  private side: HTMLElement;
  private canvas: HTMLCanvasElement;
  private note: HTMLElement;
  private onDone: (l: Loadout) => void = () => {};

  constructor(parent: HTMLElement) {
    this.list = h('div', { class: 'gs-rows' });
    this.canvas = h('canvas', { class: 'gs-draw', width: 560, height: 180 });
    this.side = h('div', { class: 'gs-side' });
    this.note = h('div', { class: 'gs-note meta' });
    this.el = h(
      'section',
      { class: 'gs', 'aria-label': 'Gunsmith' },
      h('header', { class: 'gs-head' }, h('h2', {}, 'Gunsmith'), this.note),
      h('div', { class: 'gs-body' }, this.list, h('div', { class: 'gs-right' }, this.canvas, this.side)),
      h(
        'footer',
        { class: 'gs-help' },
        h('span', { class: 'hintrow' }, glyph('navUp'), glyph('navDown'), h('span', { class: 'meta' }, 'Choose')),
        h('span', { class: 'hintrow' }, glyph('navLeft'), glyph('navRight'), h('span', { class: 'meta' }, 'Change')),
        h('span', { class: 'hintrow' }, glyph('cancel'), h('span', { class: 'meta' }, 'Save and back')),
      ),
    );
    parent.append(this.el);
  }

  /** Edit a loadout (a copy); `done` gets it back when you leave. */
  edit(l: Loadout, note: string, done: (l: Loadout) => void) {
    this.lo = { ...l, pa: [...l.pa], sa: [...l.sa] };
    this.onDone = done;
    this.open = true;
    this.row = 0;
    this.note.textContent = note;
    setOn(this.el, true);
    this.render();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    setOn(this.el, false);
    this.onDone(this.lo);
  }

  /** One frame of input. */
  update(inp: Input) {
    if (!this.open) return;
    const up = inp.pressed('navUp') || inp.pressed('forward');
    const down = inp.pressed('navDown') || inp.pressed('back');
    const left = inp.pressed('navLeft') || inp.pressed('left');
    const right = inp.pressed('navRight') || inp.pressed('right');
    if (inp.pressed('cancel') || inp.pressed('interact')) return this.close();
    if (up) this.row = (this.row + this.rows.length - 1) % this.rows.length;
    if (down) this.row = (this.row + 1) % this.rows.length;
    if (left || right) this.change(right ? 1 : -1);
    if (up || down || left || right) this.render();
  }

  private gun(which: 'primary' | 'secondary'): Weapon {
    return WEAPON[which === 'primary' ? this.lo.primary : this.lo.secondary];
  }

  private atts(which: 'primary' | 'secondary') {
    return which === 'primary' ? this.lo.pa : this.lo.sa;
  }

  private change(d: number) {
    const r = this.rows[this.row];
    this.note.textContent = '';
    if (r.kind === 'weapon') {
      const pool = r.which === 'primary' ? PRIMARIES : SECONDARIES;
      const cur = pool.findIndex((w) => w.id === this.gun(r.which).id);
      const next = pool[(cur + d + pool.length) % pool.length];
      if (r.which === 'primary') this.lo.primary = next.id;
      else this.lo.secondary = next.id;
      // keep what still fits the new gun
      const list = this.atts(r.which);
      const keep = list.filter((id) => attachmentsFor(next.cls, ATTACH[id].slot).some((a) => a.id === id));
      list.splice(0, list.length, ...keep);
    } else if (r.kind === 'att') {
      const w = this.gun(r.which), list = this.atts(r.which);
      const opts = ['', ...attachmentsFor(w.cls, r.slot).map((a) => a.id)];
      const curId = list.find((id) => ATTACH[id].slot === r.slot) ?? '';
      const next = opts[(opts.indexOf(curId) + d + opts.length) % opts.length];
      const without = list.filter((id) => ATTACH[id].slot !== r.slot);
      if (next && without.length >= MAX_ATTACHMENTS) {
        this.note.textContent = `${MAX_ATTACHMENTS} attachments at most: take one off first.`;
        return;
      }
      list.splice(0, list.length, ...without, ...(next ? [next] : []));
    } else if (r.kind === 'lethal') {
      const i = LETHALS.findIndex(([id]) => id === this.lo.lethal);
      this.lo.lethal = LETHALS[(i + d + LETHALS.length) % LETHALS.length][0];
    } else {
      const i = TACTICALS.findIndex(([id]) => id === this.lo.tactical);
      this.lo.tactical = TACTICALS[(i + d + TACTICALS.length) % TACTICALS.length][0];
    }
    this.lo.name = `${this.gun('primary').name.split(' ').pop()} · ${this.gun('secondary').name.split(' ').pop()}`;
    this.lo.line = `${this.gun('primary').name} (${this.lo.pa.length}), ${this.gun('secondary').name}. ${LETHALS.find(([id]) => id === this.lo.lethal)?.[1]}, ${TACTICALS.find(([id]) => id === this.lo.tactical)?.[1].toLowerCase()}.`;
  }

  private buildRows() {
    const rows: Row[] = [];
    for (const which of ['primary', 'secondary'] as const) {
      rows.push({ kind: 'weapon', which });
      const w = this.gun(which);
      for (const slot of SLOTS) if (attachmentsFor(w.cls, slot).length) rows.push({ kind: 'att', which, slot });
    }
    rows.push({ kind: 'lethal' }, { kind: 'tactical' });
    this.rows = rows;
    this.row = Math.min(this.row, rows.length - 1);
  }

  private render() {
    this.buildRows();
    const items = this.rows.map((r, i) => {
      let label = '', value = '', sub = '';
      if (r.kind === 'weapon') {
        const w = this.gun(r.which);
        label = r.which === 'primary' ? 'Primary' : 'Secondary';
        value = w.name;
        sub = CLASS_NAMES[w.cls];
      } else if (r.kind === 'att') {
        const id = this.atts(r.which).find((x) => ATTACH[x].slot === r.slot);
        label = SLOT_NAMES[r.slot];
        value = id ? ATTACH[id].name : 'None';
      } else if (r.kind === 'lethal') {
        label = 'Lethal';
        value = LETHALS.find(([id]) => id === this.lo.lethal)![1];
      } else {
        label = 'Tactical';
        value = TACTICALS.find(([id]) => id === this.lo.tactical)![1];
      }
      const el = h(
        'button',
        { class: `gs-row gs-row--${r.kind}${i === this.row ? ' is-sel' : ''}`, onclick: () => ((this.row = i), this.render()) },
        h('span', { class: 'gs-row__label meta' }, label),
        h('span', { class: 'gs-row__arrows' }, h('i', { onclick: (e: Event) => (e.stopPropagation(), (this.row = i), this.change(-1), this.render()) }, '‹'), h('b', {}, value), h('i', { onclick: (e: Event) => (e.stopPropagation(), (this.row = i), this.change(1), this.render()) }, '›')),
        sub ? h('span', { class: 'gs-row__sub meta' }, sub) : null,
      );
      return el;
    });
    this.list.replaceChildren(...items);
    items[this.row]?.scrollIntoView({ block: 'nearest' });
    // the right: the gun this row is about
    const r = this.rows[this.row];
    const which = r.kind === 'weapon' || r.kind === 'att' ? r.which : 'primary';
    const w = this.gun(which);
    const base = compile(w), now = compile(w, this.atts(which));
    this.draw(now);
    const bars = BARS.map(([label, f]) => {
      const a = f(base), b = f(now);
      return h(
        'div',
        { class: 'gs-bar' },
        h('span', { class: 'meta' }, label),
        h('i', { class: 'gs-bar__track' }, h('i', { class: 'gs-bar__base', style: `width:${(Math.min(a, b) * 100).toFixed(1)}%` }), h('i', { class: `gs-bar__delta ${b >= a ? 'up' : 'down'}`, style: `left:${(Math.min(a, b) * 100).toFixed(1)}%;width:${(Math.abs(b - a) * 100).toFixed(1)}%` })),
      );
    });
    let detail: HTMLElement[] = [];
    if (r.kind === 'att') {
      const id = this.atts(r.which).find((x) => ATTACH[x].slot === r.slot);
      detail = id ? describe(ATTACH[id].mods).map((d) => h('li', { class: d.good ? 'good' : 'bad' }, d.label)) : [h('li', { class: 'meta' }, 'Nothing fitted.')];
    } else if (r.kind === 'lethal' || r.kind === 'tactical') {
      const it = (r.kind === 'lethal' ? LETHALS : TACTICALS).find(([id]) => id === (r.kind === 'lethal' ? this.lo.lethal : this.lo.tactical))!;
      detail = [h('li', {}, it[2])];
    }
    const spec = `${now.mode === 'burst' ? `${now.burst}-round burst` : now.mode} · ${Math.round(60 / now.rate)} rpm · ${now.mag || '—'} rounds · ${now.atts.length}/${MAX_ATTACHMENTS} attachments`;
    this.side.replaceChildren(
      h('h3', {}, w.name),
      h('p', { class: 'gs-desc' }, w.desc),
      h('p', { class: 'meta' }, spec),
      h('div', { class: 'gs-bars' }, ...bars),
      ...(detail.length ? [h('ul', { class: 'gs-detail' }, ...detail)] : []),
    );
  }

  /** The gun side on, from its model's own parts. */
  private draw(g: Gun) {
    const c = this.canvas, x = c.getContext('2d')!;
    x.clearRect(0, 0, c.width, c.height);
    const prof = gunModel(g).profile;
    if (!prof.length) return;
    let z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [a, b, cz, d] of prof) (z0 = Math.min(z0, a)), (z1 = Math.max(z1, cz)), (y0 = Math.min(y0, b)), (y1 = Math.max(y1, d));
    const s = Math.min((c.width - 40) / (z1 - z0), (c.height - 30) / (y1 - y0));
    const ox = (c.width - (z1 - z0) * s) / 2, oy = (c.height + (y1 - y0) * s) / 2;
    for (const [a, b, cz, d, hex] of prof) {
      const col = `#${hex.toString(16).padStart(6, '0')}`;
      x.fillStyle = col;
      x.strokeStyle = 'rgba(255,255,255,0.22)';
      x.lineWidth = 1;
      const px = ox + (a - z0) * s, py = oy - (d - y0) * s, w = (cz - a) * s, hh = (d - b) * s;
      x.fillRect(px, py, w, hh);
      x.strokeRect(px + 0.5, py + 0.5, w - 1, hh - 1);
    }
  }
}
