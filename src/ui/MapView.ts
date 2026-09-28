import { h, setOn, svg } from './dom';
import { glyph } from '../input/glyphs';
import { BLOCKS, DISTRICTS, ROADS, PADS, YARD, STATION, GARDEN, BRIDGE, type Rect } from '../world/layout';
import { ENTRIES, PLACE_BY_DISTRICT } from '../data/archive';
import type { InteractSpot } from '../world/WorldContext';
import { INTERACTIONS } from '../data/interactions';

const FULL = { x: -170, y: -212, w: 340, h: 430 };

/**
 * A survey sheet of District 03 — drawn from the same layout the city is
 * built from. Only what you have found is named.
 */
export class MapView {
  el: HTMLElement;
  private sheet: HTMLElement;
  private svgEl: SVGSVGElement;
  private side: HTMLElement;
  private view = { ...FULL };
  private drag: { x: number; y: number; vx: number; vy: number } | null = null;
  private player: SVGGElement | null = null;

  constructor(root: HTMLElement, private onClose: () => void, private spots: InteractSpot[]) {
    this.svgEl = svg('svg', { role: 'img', 'aria-label': 'Survey map of District 03', preserveAspectRatio: 'xMidYMid meet' });
    this.sheet = h('div', { class: 'map__sheet' }, this.svgEl, h('span', { class: 'meta map__hint' }, h('span', { class: 'hint-kbm' }, 'Drag to pan · Scroll to zoom · Double-click to reset'), h('span', { class: 'hint-pad' }, glyph('moveStick'), ' Pan  ', glyph('aim'), glyph('attack'), ' Zoom  ', glyph('jump'), ' Reset  ', glyph('tabNext'), ' Archive')));
    this.side = h('aside', { class: 'map__side' });
    this.el = h(
      'section',
      { class: 'layer panel map', role: 'dialog', 'aria-label': 'Map' },
      h(
        'header',
        { class: 'panel__head' },
        h('div', {}, h('span', { class: 'meta' }, 'Survey sheet · District 03'), h('h2', { class: 'panel__title' }, 'The District')),
        h('button', { class: 'panel__close', onclick: () => this.onClose() }, h('span', { class: 'meta' }, 'Close'), glyph('map')),
      ),
      h('div', { class: 'panel__body map__body' }, this.sheet, this.side),
    );
    root.append(this.el);
    this.bindPanZoom();
  }

  open(discovered: Set<string>, player: { x: number; z: number; yaw: number } | null) {
    this.draw(discovered, player);
    this.drawSide(discovered);
    setOn(this.el, true);
  }

  close() {
    setOn(this.el, false);
  }

  private applyView() {
    const v = this.view;
    this.svgEl.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
  }

  private bindPanZoom() {
    const s = this.sheet;
    s.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.svgEl.getBoundingClientRect();
      const k = Math.exp(e.deltaY * 0.0012);
      const nw = Math.min(FULL.w * 1.2, Math.max(60, this.view.w * k));
      const scale = nw / this.view.w;
      const px = (e.clientX - rect.left) / rect.width, py = (e.clientY - rect.top) / rect.height;
      this.view.x += (this.view.w - nw) * px;
      this.view.y += (this.view.h - this.view.h * scale) * py;
      this.view.w = nw;
      this.view.h *= scale;
      this.applyView();
    }, { passive: false });
    s.addEventListener('pointerdown', (e) => {
      s.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y };
    });
    s.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const rect = this.svgEl.getBoundingClientRect();
      const unit = Math.max(this.view.w / rect.width, this.view.h / rect.height);
      this.view.x = this.drag.vx - (e.clientX - this.drag.x) * unit;
      this.view.y = this.drag.vy - (e.clientY - this.drag.y) * unit;
      this.applyView();
    });
    s.addEventListener('pointerup', () => (this.drag = null));
    s.addEventListener('dblclick', () => {
      this.view = { ...FULL };
      this.applyView();
    });
  }

  /** Controller: left stick pans, triggers zoom (units: fractions of the view per second). */
  pad(dt: number, x: number, y: number, zoom: number, reset: boolean) {
    if (reset) {
      this.view = { ...FULL };
      return this.applyView();
    }
    if (!x && !y && !zoom) return;
    const v = this.view;
    v.x += x * v.w * 0.9 * dt;
    v.y += y * v.h * 0.9 * dt;
    if (zoom) {
      const k = Math.exp(-zoom * 1.6 * dt);
      const nw = Math.min(FULL.w * 1.2, Math.max(60, v.w * k));
      const scale = nw / v.w;
      v.x += (v.w - nw) / 2;
      v.y += (v.h - v.h * scale) / 2;
      v.w = nw;
      v.h *= scale;
    }
    this.applyView();
  }

  private focus(x: number, z: number) {
    this.view.w = 150;
    this.view.h = 190;
    this.view.x = x - this.view.w / 2;
    this.view.y = z - this.view.h / 2;
    this.applyView();
  }

  private draw(found: Set<string>, player: { x: number; z: number; yaw: number } | null) {
    const S = this.svgEl;
    S.replaceChildren();
    const ink = 'rgba(233,229,220,';
    const rect = (a: Rect, attrs: Record<string, string | number>) => svg('rect', { x: a.x0, y: a.z0, width: a.x1 - a.x0, height: a.z1 - a.z0, ...attrs });

    const defs = svg('defs');
    const hatch = svg('pattern', { id: 'water', width: 4, height: 4, patternUnits: 'userSpaceOnUse' }, svg('path', { d: 'M0 2 H4', stroke: `${ink}0.16)`, 'stroke-width': 0.3 }));
    const diag = svg('pattern', { id: 'uncharted', width: 3, height: 3, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, svg('path', { d: 'M0 0 V3', stroke: `${ink}0.08)`, 'stroke-width': 0.4 }));
    defs.append(hatch, diag);
    S.append(defs);

    // sheet frame + survey grid
    const g = svg('g', {});
    g.append(rect({ x0: -160, z0: -205, x1: 160, z1: 210 }, { fill: 'none', stroke: `${ink}0.25)`, 'stroke-width': 0.4 }));
    const cols = 'ABCDEFGH';
    for (let i = 0; i <= 8; i++) {
      const x = -160 + i * 40;
      g.append(svg('line', { x1: x, y1: -205, x2: x, y2: 210, stroke: `${ink}0.05)`, 'stroke-width': 0.25 }));
      if (i < 8) g.append(svg('text', { x: x + 20, y: -208, class: 'map-label', 'text-anchor': 'middle' }, cols[i]));
    }
    for (let j = 0; j <= 10; j++) {
      const z = -205 + j * 41.5;
      g.append(svg('line', { x1: -160, y1: z, x2: 160, y2: z, stroke: `${ink}0.05)`, 'stroke-width': 0.25 }));
      if (j < 10) g.append(svg('text', { x: -164, y: z + 22, class: 'map-label', 'text-anchor': 'middle' }, String(j + 1)));
    }
    S.append(g);

    // river and bridge
    S.append(rect({ x0: -160, z0: 164, x1: 160, z1: 200 }, { fill: 'url(#water)' }));
    S.append(svg('line', { x1: -160, y1: 164, x2: 160, y2: 164, stroke: `${ink}0.35)`, 'stroke-width': 0.4 }));
    S.append(svg('line', { x1: -160, y1: 200, x2: 160, y2: 200, stroke: `${ink}0.2)`, 'stroke-width': 0.3 }));
    S.append(rect(BRIDGE, { fill: 'rgba(10,11,12,1)', stroke: `${ink}0.35)`, 'stroke-width': 0.35 }));
    S.append(svg('line', { x1: -9, y1: 186, x2: 9, y2: 186, stroke: '#c8a064', 'stroke-width': 0.7, 'stroke-dasharray': '1.2 1' }));
    S.append(svg('text', { x: 0, y: 184, class: 'map-label', 'text-anchor': 'middle', 'font-size': 4 }, 'CLOSED'));
    S.append(svg('text', { x: 60, y: 184, class: 'map-district' }, 'the river'));

    // roads: kerb lines only
    for (const road of ROADS) {
      const a = road.rect;
      const attrs = { stroke: `${ink}0.2)`, 'stroke-width': 0.3 };
      if (road.axis === 'x') {
        S.append(svg('line', { x1: a.x0, y1: a.z0, x2: a.x1, y2: a.z0, ...attrs }), svg('line', { x1: a.x0, y1: a.z1, x2: a.x1, y2: a.z1, ...attrs }));
        S.append(svg('text', { x: a.x1 - 12, y: (a.z0 + a.z1) / 2 + 1.4, class: 'map-label', 'text-anchor': 'end', 'font-size': 3.6 }, road.name));
      } else {
        S.append(svg('line', { x1: a.x0, y1: a.z0, x2: a.x0, y2: a.z1, ...attrs }), svg('line', { x1: a.x1, y1: a.z0, x2: a.x1, y2: a.z1, ...attrs }));
        const t = svg('text', { x: 0, y: -80, class: 'map-label', 'text-anchor': 'middle', 'font-size': 3.6, transform: 'rotate(-90 0 -80)' }, road.name);
        S.append(t);
      }
    }

    // plazas
    for (const p of PADS.slice(0, 4)) S.append(rect(p, { fill: `${ink}0.025)` }));
    S.append(rect(YARD, { fill: `${ink}0.02)`, stroke: `${ink}0.12)`, 'stroke-width': 0.25, 'stroke-dasharray': '1 1' }));

    // blocks: drawn if the district is known, hatched if not
    const districtOf = (id: string) => DISTRICTS.find((d) => d.id === id)!;
    const known = (distId: string) => found.has(PLACE_BY_DISTRICT[distId] ?? '');
    for (const b of BLOCKS) {
      const k = known(b.district);
      S.append(rect(b.rect, k ? { fill: `${ink}0.07)`, stroke: `${ink}0.45)`, 'stroke-width': 0.35 } : { fill: 'url(#uncharted)', stroke: `${ink}0.14)`, 'stroke-width': 0.25, 'stroke-dasharray': '0.8 0.8' }));
    }
    // warehouses of the yard + station shed
    const yardSheds: Rect[] = [
      { x0: 104, z0: -24, x1: 144, z1: 24 },
      { x0: 104, z0: 72, x1: 144, z1: 124 },
      { x0: 44, z0: 84, x1: 72, z1: 128 },
    ];
    for (const r0 of yardSheds) S.append(rect(r0, known('yard') ? { fill: `${ink}0.07)`, stroke: `${ink}0.45)`, 'stroke-width': 0.35 } : { fill: 'url(#uncharted)', stroke: `${ink}0.14)`, 'stroke-width': 0.25 }));
    S.append(rect(STATION, known('station') ? { fill: `${ink}0.06)`, stroke: `${ink}0.5)`, 'stroke-width': 0.4 } : { fill: 'url(#uncharted)', stroke: `${ink}0.14)`, 'stroke-width': 0.25 }));
    if (known('station')) {
      for (const tz of [-167, -189]) S.append(svg('line', { x1: -50, y1: tz, x2: 50, y2: tz, stroke: `${ink}0.3)`, 'stroke-width': 0.3, 'stroke-dasharray': '2 0.8' }));
    }
    if (found.has('garden')) {
      S.append(rect(GARDEN, { fill: 'rgba(200,160,100,0.06)', stroke: '#c8a064', 'stroke-width': 0.35 }));
      S.append(svg('circle', { cx: -108, cy: -86, r: 1.4, fill: 'none', stroke: '#c8a064', 'stroke-width': 0.3 }));
    }

    // district names
    for (const d of DISTRICTS) {
      if (d.id === 'garden' && !found.has('garden')) continue;
      const k = d.id === 'garden' || known(d.id);
      const lbl = svg('text', { x: d.label.x, y: d.label.z, class: 'map-district', 'text-anchor': 'middle', opacity: k ? 1 : 0.45 }, k ? d.name : 'Uncharted');
      S.append(lbl);
    }
    void districtOf;

    // points of interest you have recorded
    const drawn = new Set<string>();
    for (const s of this.spots) {
      const def = INTERACTIONS[s.id];
      if (!def?.unlock || !found.has(def.unlock) || drawn.has(def.unlock)) continue;
      drawn.add(def.unlock);
      const e = ENTRIES.find((x) => x.id === def.unlock)!;
      S.append(svg('circle', { cx: s.pos.x, cy: s.pos.z, r: 1.1, fill: 'none', stroke: '#e9e5dc', 'stroke-width': 0.3 }));
      S.append(svg('text', { x: s.pos.x + 2.2, y: s.pos.z + 1.1, class: 'map-poi', 'font-size': 3.6 }, e.title));
    }

    // north + scale
    const n = svg('g', { transform: 'translate(142 -188)' });
    n.append(svg('path', { d: 'M0 -7 L2.5 3 L0 1.4 L-2.5 3 Z', fill: '#e9e5dc' }), svg('text', { x: 0, y: -9, class: 'map-label', 'text-anchor': 'middle', 'font-size': 3.5 }, 'N'));
    S.append(n);
    const sc = svg('g', { transform: 'translate(-150 204)' });
    sc.append(svg('line', { x1: 0, y1: 0, x2: 50, y2: 0, stroke: '#e9e5dc', 'stroke-width': 0.35 }));
    for (const x of [0, 25, 50]) sc.append(svg('line', { x1: x, y1: -1.2, x2: x, y2: 1.2, stroke: '#e9e5dc', 'stroke-width': 0.35 }));
    sc.append(svg('text', { x: 52, y: 1.2, class: 'map-label', 'font-size': 3.4 }, '50 M'));
    S.append(sc);

    // you — 1.6x arrow with a pulse ring so it reads at full-zoom-out
    if (player) {
      const deg = (-player.yaw * 180) / Math.PI + 180;
      const p = svg('g', { transform: `translate(${player.x} ${player.z}) rotate(${deg})` });
      p.append(svg('circle', { r: 7.2, fill: 'rgba(200,160,100,0.14)' }));
      const pulse = svg('circle', { r: 7.2, fill: 'none', stroke: 'rgba(200,160,100,0.55)', 'stroke-width': 0.5 });
      pulse.append(
        svg('animate', { attributeName: 'r', values: '7.2;11.5;7.2', dur: '2.2s', repeatCount: 'indefinite' }),
        svg('animate', { attributeName: 'opacity', values: '0.8;0.1;0.8', dur: '2.2s', repeatCount: 'indefinite' }),
      );
      p.append(pulse);
      p.append(svg('path', { d: 'M0 -5.1 L3.2 3.8 L0 1.9 L-3.2 3.8 Z', fill: '#c8a064', stroke: 'rgba(10,11,12,0.9)', 'stroke-width': 0.4 }));
      S.append(p);
      this.player = p;
    }
    this.applyView();
  }

  private drawSide(found: Set<string>) {
    const places = ENTRIES.filter((e) => e.cat === 'places');
    const count = places.filter((p) => found.has(p.id)).length;
    const list = h('div', {});
    places.forEach((p, i) => {
      const k = found.has(p.id);
      if (p.hidden && !k) return;
      const d = DISTRICTS.find((x) => PLACE_BY_DISTRICT[x.id] === p.id);
      const at = d ? d.label : { x: 0, z: 180 };
      list.append(
        h(
          'button',
          { class: `map__loc${k ? '' : ' is-locked'}`, onclick: () => this.focus(at.x, at.z), 'aria-label': k ? `Show ${p.title}` : 'Uncharted place' },
          h('span', { class: 'meta' }, String(i + 1).padStart(2, '0')),
          h('span', { class: 'map__loc-name' }, k ? p.title : 'Uncharted'),
          h('span', { class: 'meta' }, p.where),
        ),
      );
    });
    this.side.replaceChildren(
      h('div', {}, h('span', { class: 'meta' }, 'Places recorded'), h('p', { class: 'panel__title', style: 'font-size:44px;margin-top:10px' }, `${count}`, h('span', { class: 'meta', style: 'margin-left:10px' }, `of ${places.length}`))),
      list,
      h(
        'div',
        { class: 'map__legend' },
        h('div', {}, legendSvg('you'), h('span', { class: 'meta' }, 'You')),
        h('div', {}, legendSvg('poi'), h('span', { class: 'meta' }, 'Recorded')),
        h('div', {}, legendSvg('unk'), h('span', { class: 'meta' }, 'Uncharted')),
      ),
    );
  }
}

function legendSvg(kind: 'you' | 'poi' | 'unk') {
  const s = svg('svg', { width: 18, height: 18, viewBox: '-9 -9 18 18', 'aria-hidden': 'true' });
  if (kind === 'you') s.append(svg('circle', { r: 7, fill: 'rgba(200,160,100,0.14)' }), svg('path', { d: 'M0 -5.1 L3.2 3.8 L0 1.9 L-3.2 3.8 Z', fill: '#c8a064' }));
  if (kind === 'poi') s.append(svg('circle', { r: 4, fill: 'none', stroke: '#e9e5dc', 'stroke-width': 1 }));
  if (kind === 'unk') s.append(svg('rect', { x: -6, y: -6, width: 12, height: 12, fill: 'none', stroke: 'rgba(233,229,220,.35)', 'stroke-dasharray': '2 2' }));
  return s;
}
