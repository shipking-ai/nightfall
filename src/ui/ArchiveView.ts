import { glyph } from '../input/glyphs';
import { h, setOn, svg } from './dom';
import { CATEGORIES, ENTRIES, type Category, type Entry } from '../data/archive';
import type { Photo } from '../core/photos';

type Tab = Category | 'photographs' | 'yours';

export interface ArchiveSource {
  found: Set<string>;
  unread: Set<string>;
  plates: Record<string, { src: string; time: string }>;
  marks: number;
  markRead(id: string): void;
  /** how many other people have recorded this entry (cloud; absent offline) */
  others?(id: string): number;
  /** the photographs you took yourself (photo mode), newest first */
  photos?: Photo[];
  forget?(id: string): Promise<boolean>;
}

/**
 * The Archive: an index, a catalogue, and a plate. Built like a museum
 * dossier — catalogue numbers, provenance, a photograph or a line of type.
 */
export class ArchiveView {
  el: HTMLElement;
  private index: HTMLElement;
  private list: HTMLElement;
  private detail: HTMLElement;
  private tab: Tab = 'places';
  private selected: string | null = null;
  private src!: ArchiveSource;

  constructor(root: HTMLElement, private onClose: () => void, private onTick: () => void) {
    this.index = h('nav', { class: 'archive__index', 'aria-label': 'Archive sections' });
    this.list = h('div', { class: 'archive__list', role: 'list' });
    this.detail = h('article', { class: 'archive__detail', 'aria-live': 'polite' });
    this.el = h(
      'section',
      { class: 'layer panel archive', role: 'dialog', 'aria-label': 'Archive' },
      h(
        'header',
        { class: 'panel__head' },
        h('div', {}, h('span', { class: 'meta' }, 'District 03 · The city record'), h('h2', { class: 'panel__title' }, 'Archive')),
        h('button', { class: 'panel__close', onclick: () => this.onClose() }, h('span', { class: 'meta' }, 'Close'), glyph('cancel')),
      ),
      h('div', { class: 'panel__body archive__body' }, this.index, this.list, this.detail),
    );
    root.append(this.el);
  }

  open(src: ArchiveSource) {
    this.src = src;
    // open on the newest unread entry, if there is one
    const unread = ENTRIES.find((e) => src.unread.has(e.id));
    if (unread) {
      this.tab = unread.cat;
      this.selected = unread.id;
    }
    this.render();
    setOn(this.el, true);
  }

  close() {
    setOn(this.el, false);
  }

  /** LB / RB: the previous or next section. */
  cycleTab(d: -1 | 1) {
    const ids: Tab[] = [...CATEGORIES.map((c) => c.id as Tab), 'photographs', 'yours'];
    const i = ids.indexOf(this.tab);
    this.tab = ids[(i + d + ids.length) % ids.length];
    this.selected = null;
    this.onTick();
    this.render();
    (this.index.querySelector('.is-active') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  private render() {
    this.renderIndex();
    this.renderList();
    this.renderDetail();
  }

  private renderIndex() {
    const { found } = this.src;
    const total = ENTRIES.filter((e) => !e.hidden || found.has(e.id)).length;
    const got = ENTRIES.filter((e) => found.has(e.id)).length;
    const tabs: { id: Tab; label: string; count: string }[] = CATEGORIES.map((c) => {
      const all = ENTRIES.filter((e) => e.cat === c.id && (!e.hidden || found.has(e.id)));
      return { id: c.id, label: c.label, count: `${all.filter((e) => found.has(e.id)).length}/${all.length}` };
    });
    tabs.push({ id: 'photographs', label: 'Photographs', count: String(Object.keys(this.src.plates).length).padStart(2, '0') });
    tabs.push({ id: 'yours', label: 'Your photographs', count: String(this.src.photos?.length ?? 0).padStart(2, '0') });
    this.index.replaceChildren(
      ...tabs.map((t) =>
        h(
          'button',
          {
            class: `archive__cat${t.id === this.tab ? ' is-active' : ''}`,
            'aria-current': t.id === this.tab ? 'true' : undefined,
            onclick: () => {
              this.tab = t.id;
              this.selected = null;
              this.onTick();
              this.render();
            },
          },
          h('span', {}, t.label),
          h('span', {}, t.count),
        ),
      ),
      h('div', { class: 'archive__progress' }, h('span', { class: 'meta' }, 'Recorded'), h('p', {}, String(got), h('span', {}, ` / ${total}`))),
    );
  }

  private entries(): Entry[] {
    if (this.tab === 'photographs') return ENTRIES.filter((e) => e.plate && this.src.plates[e.plate]);
    return ENTRIES.filter((e) => e.cat === this.tab && (!e.hidden || this.src.found.has(e.id)));
  }

  private renderList() {
    if (this.tab === 'yours') return this.renderPhotoList();
    const list = this.entries();
    if (!this.selected) this.selected = list.find((e) => this.src.found.has(e.id))?.id ?? null;
    if (this.tab === 'photographs') {
      this.list.replaceChildren(
        ...list.map((e, i) =>
          this.row(e, `PL-${String(i + 1).padStart(2, '0')}`, true),
        ),
      );
      if (!list.length) this.list.replaceChildren(h('p', { class: 'meta', style: 'padding: 18px 28px' }, 'No plates yet'));
      return;
    }
    this.list.replaceChildren(...list.map((e) => this.row(e, e.no, this.src.found.has(e.id))));
  }

  private row(e: Entry, no: string, known: boolean) {
    const unread = this.src.unread.has(e.id);
    return h(
      'button',
      {
        class: `archive__row${known ? '' : ' is-locked'}${e.id === this.selected ? ' is-active' : ''}`,
        role: 'listitem',
        disabled: !known,
        'aria-disabled': !known ? 'true' : undefined,
        onclick: () => {
          if (!known) return;
          this.selected = e.id;
          this.onTick();
          this.renderList();
          this.renderDetail();
        },
      },
      h('span', { class: 'meta' }, no),
      h('span', { class: 'archive__row-title' }, known ? e.title : 'Not yet recorded', unread ? h('span', { class: 'archive__row-new', 'aria-label': 'new' }) : null),
    );
  }

  /** Your own photographs: a list by where and when, the picture beside it. */
  private renderPhotoList() {
    const ps = this.src.photos ?? [];
    if (!this.selected || !ps.some((p) => p.id === this.selected)) this.selected = ps[0]?.id ?? null;
    if (!ps.length) {
      this.list.replaceChildren(h('p', { class: 'meta', style: 'padding: 18px 28px' }, 'None yet. Photo mode is in After Hours and the City (D-pad up, or P).'));
      return;
    }
    this.list.replaceChildren(
      ...ps.map((p, i) =>
        h(
          'button',
          {
            class: `archive__row${p.id === this.selected ? ' is-active' : ''}`,
            role: 'listitem',
            onclick: () => {
              this.selected = p.id;
              this.onTick();
              this.renderPhotoList();
              this.renderDetail();
            },
          },
          h('span', { class: 'meta' }, `PH-${String(ps.length - i).padStart(2, '0')}`),
          h('span', { class: 'archive__row-title' }, `${p.place} · ${p.time}`),
        ),
      ),
    );
  }

  private renderPhoto() {
    const p = this.src.photos?.find((x) => x.id === this.selected);
    if (!p) {
      this.detail.replaceChildren(h('div', { class: 'archive__empty' }, h('div', {}, h('span', { class: 'meta' }, 'No photographs yet'), h('p', {}, 'Stop somewhere. Take a picture. It will keep.'))));
      return;
    }
    const when = new Date(p.at);
    const del = h('button', { class: 'archive__delete' }, h('span', { class: 'meta' }, 'Delete this photograph'));
    del.addEventListener('click', async () => {
      if (!this.src.forget || !(await this.src.forget(p.id))) return;
      this.src.photos = this.src.photos!.filter((x) => x.id !== p.id);
      this.selected = null;
      this.onTick();
      this.render();
    });
    this.detail.replaceChildren(
      h(
        'div',
        { class: 'archive__detail-inner' },
        h('figure', { class: 'plate' }, h('img', { src: p.url, alt: `Your photograph: ${p.place}` }), h('figcaption', {}, h('span', { class: 'meta' }, p.place), h('span', { class: 'meta' }, `Taken ${p.time}`))),
        h('div', { class: 'meta meta--accent archive__cat-label' }, 'Your photographs'),
        h('h3', {}, p.place),
        h(
          'dl',
          { class: 'archive__facts' },
          h('div', {}, h('dt', { class: 'meta' }, 'Local time'), h('dd', {}, p.time)),
          h('div', {}, h('dt', { class: 'meta' }, 'Taken on'), h('dd', {}, when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))),
        ),
        del,
      ),
    );
    this.detail.scrollTop = 0;
  }

  private renderDetail() {
    if (this.tab === 'yours') return this.renderPhoto();
    const e = ENTRIES.find((x) => x.id === this.selected);
    if (!e || !this.src.found.has(e.id)) {
      this.detail.replaceChildren(
        h('div', { class: 'archive__empty' }, h('div', {}, h('span', { class: 'meta' }, 'Nothing recorded here yet'), h('p', {}, 'Walk. Look closely. The city keeps what you notice.'))),
      );
      return;
    }
    this.src.markRead(e.id);
    this.src.unread.delete(e.id);
    const plate = e.plate ? this.src.plates[e.plate] : undefined;
    let figure: HTMLElement;
    if (plate) {
      figure = h(
        'figure',
        { class: 'plate' },
        h('img', { src: plate.src, alt: `Photograph: ${e.title}` }),
        h('figcaption', {}, h('span', { class: 'meta' }, `Plate · ${e.title}`), h('span', { class: 'meta' }, `Exposed ${plate.time}`)),
      );
    } else if (e.art === 'mark') {
      const s = svg('svg', { viewBox: '-60 -60 120 120', 'aria-hidden': 'true' });
      s.append(svg('circle', { r: 38, fill: 'none', stroke: '#e9e5dc', 'stroke-width': 3 }));
      s.append(svg('line', { x1: 0, y1: -54, x2: 0, y2: 54, stroke: '#e9e5dc', 'stroke-width': 3, 'stroke-linecap': 'round' }));
      figure = h('figure', { class: 'plate' }, h('div', { class: 'plate--type plate--mark' }, s), h('figcaption', {}, h('span', { class: 'meta' }, 'Drawn from observation'), h('span', { class: 'meta' }, `Found ${this.src.marks} of 3`)));
    } else {
      figure = h('figure', { class: 'plate' }, h('div', { class: 'plate--type' }, h('q', {}, e.quote)), h('figcaption', {}, h('span', { class: 'meta' }, e.no), h('span', { class: 'meta' }, e.where)));
    }
    const cat = CATEGORIES.find((c) => c.id === e.cat)!.label;
    const inner = h(
      'div',
      { class: 'archive__detail-inner' },
      figure,
      h('div', { class: 'meta meta--accent archive__cat-label' }, `${cat} · ${e.no}`),
      h('h3', {}, e.title),
      h(
        'dl',
        { class: 'archive__facts' },
        h('div', {}, h('dt', { class: 'meta' }, 'Location'), h('dd', {}, e.where)),
        h('div', {}, h('dt', { class: 'meta' }, 'Catalogue'), h('dd', {}, e.no)),
        h('div', {}, h('dt', { class: 'meta' }, 'Recorded'), h('dd', {}, plate?.time ?? '03:17')),
        others(this.src.others?.(e.id)),
      ),
      h('div', { class: 'archive__text' }, ...e.body.map((p) => h('p', {}, p))),
      plate || e.art === 'mark' ? h('blockquote', { class: 'archive__quote' }, e.quote) : null,
    );
    this.detail.replaceChildren(inner);
    this.detail.scrollTop = 0;
    this.renderIndex();
  }
}

/** "Also recorded by 12 others", only when the cloud has answered */
function others(n: number | undefined) {
  if (n === undefined || n < 1) return null;
  return h('div', {}, h('dt', { class: 'meta' }, 'Also recorded by'), h('dd', {}, n === 1 ? 'one other' : `${n} others`));
}
