import * as THREE from 'three';
import { h, setOn } from './dom';
import { glyph, hintRow } from '../input/glyphs';
import type { Action } from '../input/actions';
import type { CapturePoint, Unit } from '../modes/warzone/Soldier';
import type { Loadout } from '../modes/warzone/weapons';
import { WEAPON } from '../modes/warzone/arsenal';
import { Minimap } from './Minimap';

/**
 * WARZONE's interface: the score and the clock at the top with the three
 * points under them, markers for the points in the world, the kill feed,
 * health and armor, the gun, a crosshair as wide as the real spread, hit
 * markers, where damage came from, and the respawn screen with loadouts.
 */

export interface WzChoice {
  again(): void;
  level(): void;
  modes(): void;
  leave(): void;
}

const HINTS: [Action | 'moveStick' | 'lookStick', string][] = [
  ['moveStick', 'Move'],
  ['aim', 'Aim'],
  ['attack', 'Fire'],
  ['reload', 'Reload'],
  ['nextWeapon', 'Switch'],
  ['crouch', 'Crouch'],
  ['sprint', 'Sprint'],
  ['screen', 'First / third person'],
  ['scoreboard', 'Scores'],
];

export class WarzoneHud {
  el: HTMLElement;
  private scoreEls: HTMLElement[];
  private barEls: HTMLElement[];
  private clockEl: HTMLElement;
  private pointEls: HTMLElement[] = [];
  private markerEls: HTMLElement[] = [];
  private tagEls: HTMLElement[] = [];
  private hpEl: HTMLElement;
  private armorEl: HTMLElement;
  private gunEl: HTMLElement;
  private magEl: HTMLElement;
  private reserveEl: HTMLElement;
  private otherEl: HTMLElement;
  private modeEl: HTMLElement;
  private gearEl: HTMLElement;
  private flashEl: HTMLElement;
  private stunEl: HTMLElement;
  private lastGear = '';
  private streakEl: HTMLElement;
  private progEl: HTMLElement;
  minimap = new Minimap();
  private radioEl: HTMLElement;
  private lastStreak = '';
  private scopeEl: HTMLElement;
  private reloadEl: HTMLElement;
  private cross: HTMLElement;
  private dot: HTMLElement;
  private hitEl: HTMLElement;
  private hitT = 0;
  private dmgEls: HTMLElement[] = [];
  private dmgI = 0;
  private feedEl: HTMLElement;
  private annEl: HTMLElement;
  private annT = 0;
  private loadEl: HTMLElement;
  private loadCards: HTMLElement;
  private loadTitle: HTMLElement;
  private deathEl: HTMLElement;
  private boardEl: HTMLElement;
  private hints: HTMLElement;
  end: HTMLElement;
  private endTitle: HTMLElement;
  private endStats: HTMLElement;
  private levelBtn: HTMLElement;
  private shown = false;
  private hurtEl = h('div', { class: 'wz-hurt', 'aria-hidden': 'true' });
  private v = new THREE.Vector3();
  private lastLoadout = '';

  constructor(root: HTMLElement, choice: WzChoice) {
    this.scoreEls = [h('b', {}, '0'), h('b', {}, '0')];
    this.barEls = [h('i'), h('i')];
    this.clockEl = h('span', { class: 'wz-clock' }, '6:00');
    const pts = h('div', { class: 'wz-points' });
    for (const id of ['A', 'B', 'C']) {
      const e = h('span', { class: 'wz-pt' }, h('i'), h('em', {}, id));
      this.pointEls.push(e);
      pts.append(e);
    }
    const top = h(
      'div',
      { class: 'wz-top' },
      h('div', { class: 'wz-team wz-team--blue' }, this.scoreEls[0], h('div', { class: 'wz-bar' }, this.barEls[0])),
      h('div', { class: 'wz-mid' }, this.clockEl, pts),
      h('div', { class: 'wz-team wz-team--red' }, h('div', { class: 'wz-bar' }, this.barEls[1]), this.scoreEls[1]),
    );
    for (let i = 0; i < 3; i++) this.markerEls.push(h('div', { class: 'wz-marker' }, h('em', {}, 'ABC'[i]), h('span')));
    for (let i = 0; i < 11; i++) this.tagEls.push(h('div', { class: 'wz-tag' }));
    this.hpEl = h('i');
    this.armorEl = h('i');
    const vitals = h('div', { class: 'wz-vitals' }, h('div', { class: 'wz-hp' }, this.hpEl), h('div', { class: 'wz-armor' }, this.armorEl));
    this.gunEl = h('span', { class: 'wz-gun__name' });
    this.magEl = h('b');
    this.reserveEl = h('span', { class: 'wz-gun__res' });
    this.otherEl = h('span', { class: 'wz-gun__other meta' });
    this.modeEl = h('span', { class: 'wz-gun__mode meta' });
    this.gearEl = h('div', { class: 'wz-gear' });
    this.streakEl = h('div', { class: 'wz-streaks' });
    this.radioEl = h('div', { class: 'wz-radio' });
    this.progEl = h('div', { class: 'wz-prog' }, h('span', { class: 'meta' }), h('i', {}, h('b')));
    this.flashEl = h('div', { class: 'wz-flash' });
    this.stunEl = h('div', { class: 'wz-stun' });
    this.scopeEl = h('div', { class: 'wz-scope' }, h('i', { class: 'wz-scope__h' }), h('i', { class: 'wz-scope__v' }));
    this.reloadEl = h('i', { class: 'wz-gun__reload' });
    const gun = h('div', { class: 'wz-gun' }, h('div', { class: 'wz-gun__head' }, this.modeEl, this.gunEl), h('div', { class: 'wz-gun__ammo' }, this.magEl, this.reserveEl), this.reloadEl, this.otherEl, this.gearEl);
    this.cross = h('div', { class: 'wz-cross' }, h('i'), h('i'), h('i'), h('i'));
    this.dot = h('div', { class: 'wz-dot' });
    this.hitEl = h('div', { class: 'wz-hit' }, h('i'), h('i'), h('i'), h('i'));
    for (let i = 0; i < 4; i++) this.dmgEls.push(h('div', { class: 'wz-dmg' }, h('i')));
    this.feedEl = h('div', { class: 'wz-feed' });
    this.annEl = h('div', { class: 'wz-ann' });
    this.loadTitle = h('h3', { class: 'wz-load__title' });
    this.loadCards = h('div', { class: 'wz-load__cards' });
    this.deathEl = h('div', { class: 'wz-death' });
    this.loadEl = h(
      'div',
      { class: 'wz-load' },
      this.deathEl,
      this.loadTitle,
      this.loadCards,
      h('div', { class: 'wz-load__help' }, h('span', { class: 'hintrow' }, glyph('tabPrev'), glyph('tabNext'), h('span', { class: 'meta' }, 'Loadout')), h('span', { class: 'hintrow' }, glyph('interact'), h('span', { class: 'meta' }, 'Gunsmith')), h('span', { class: 'hintrow' }, glyph('jump'), h('span', { class: 'meta' }, 'Deploy'))),
    );
    this.boardEl = h('div', { class: 'wz-board' });
    this.hints = h('div', { class: 'wz-hints' }, ...HINTS.map(([a, t]) => hintRow(a, t)));
    this.endTitle = h('h2', { class: 'fend__title' });
    this.endStats = h('div', { class: 'fend__stats' });
    this.levelBtn = h('button', { class: 'fend__btn', onclick: () => choice.level() }, 'Bots: Regular');
    this.end = h(
      'section',
      { class: 'fend', 'aria-label': 'Match over', 'data-nav-scope': '' },
      this.endTitle,
      this.endStats,
      h(
        'div',
        { class: 'fend__menu' },
        h('button', { class: 'fend__btn', 'data-nav-first': '', onclick: () => choice.again() }, 'Play again'),
        this.levelBtn,
        h('button', { class: 'fend__btn', onclick: () => choice.modes() }, 'Choose a mode'),
        h('button', { class: 'fend__btn', onclick: () => choice.leave() }, 'Leave to the title'),
      ),
    );
    this.el = h(
      'section',
      { class: 'wzhud', 'aria-label': 'Warzone' },
      this.hurtEl,
      ...this.markerEls,
      ...this.tagEls,
      ...this.dmgEls,
      top,
      this.feedEl,
      vitals,
      gun,
      this.cross,
      this.minimap.el,
      this.radioEl,
      this.minimap.compass,
      this.scopeEl,
      this.streakEl,
      this.progEl,
      this.stunEl,
      this.flashEl,
      this.dot,
      this.hitEl,
      this.annEl,
      this.hints,
      this.boardEl,
      this.loadEl,
      this.end,
    );
    root.append(this.el);
  }

  show(on: boolean) {
    this.shown = on;
    setOn(this.el, on);
    if (!on) this.showEnd(null);
  }

  /** The edges of the screen go red, and fade. */
  hurt(k: number) {
    const e = this.hurtEl;
    e.style.transition = 'none';
    e.style.opacity = String(Math.min(1, 0.35 + k));
    void e.offsetWidth;
    e.style.transition = 'opacity 900ms ease-out';
    e.style.opacity = '0';
  }

  level(name: string) {
    this.levelBtn.textContent = `Bots: ${name}`;
  }

  showHints(on: boolean) {
    setOn(this.hints, on);
  }

  score(s: [number, number], limit: number, clock: number) {
    for (let i = 0; i < 2; i++) {
      this.scoreEls[i].textContent = String(s[i]);
      this.barEls[i].style.transform = `scaleX(${(s[i] / limit).toFixed(3)})`;
    }
    const c = Math.max(0, Math.ceil(clock));
    this.clockEl.textContent = `${Math.floor(c / 60)}:${String(c % 60).padStart(2, '0')}`;
  }

  /** Your squad on the radio: a line that fades. */
  radio(name: string, text: string) {
    const row = h('div', { class: 'wz-radio__line' }, h('b', {}, name), ` ${text}`);
    this.radioEl.prepend(row);
    while (this.radioEl.children.length > 3) this.radioEl.lastChild!.remove();
    setTimeout(() => row.classList.add('is-gone'), 3500);
    setTimeout(() => row.remove(), 4200);
  }

  /** Hardline hides the map, the compass and the markers. */
  hardline(on: boolean) {
    this.el.classList.toggle('is-hardline', on);
  }

  /** A held action's progress in the middle of the screen (planting, defusing); null hides it. */
  progress(label: string | null, k: number) {
    setOn(this.progEl, !!label);
    if (!label) return;
    (this.progEl.firstChild as HTMLElement).textContent = label;
    (this.progEl.lastChild!.firstChild as HTMLElement).style.transform = `scaleX(${Math.min(1, Math.max(0, k)).toFixed(3)})`;
  }

  points(ps: CapturePoint[], team: 0 | 1, labels?: string[]) {
    this.pointEls.forEach((e, i) => (e.style.display = i < ps.length ? '' : 'none'));
    ps.forEach((p, i) => {
      const e = this.pointEls[i];
      const label = labels?.[i] ?? p.id;
      if (e.lastChild!.textContent !== label) e.lastChild!.textContent = label;
      e.dataset.owner = p.owner < 0 ? 'none' : p.owner === team ? 'us' : 'them';
      e.dataset.cap = p.capTeam < 0 ? 'none' : p.capTeam === team ? 'us' : 'them';
      e.classList.toggle('is-contested', p.contested);
      (e.firstChild as HTMLElement).style.setProperty('--cap', p.cap.toFixed(3));
    });
  }

  /** The points, where they are on screen (or at the edge, pointing the way). */
  markers(ps: CapturePoint[], cam: THREE.PerspectiveCamera, me: Unit, labels?: string[]) {
    const W = innerWidth, H = innerHeight;
    this.markerEls.forEach((e, i) => (e.style.display = i < ps.length ? '' : 'none'));
    ps.forEach((p, i) => {
      const e = this.markerEls[i];
      const label = labels?.[i] ?? p.id;
      if (e.firstChild!.textContent !== label) e.firstChild!.textContent = label;
      const v = this.v.set(p.pos.x, p.pos.y + 3, p.pos.z).project(cam);
      let x = v.x, y = v.y;
      const behind = v.z > 1;
      if (behind) (x = -x), (y = -1);
      const m = 0.9;
      const k = Math.max(Math.abs(x) / m, Math.abs(y) / m, behind ? 1.0001 : 0);
      if (k > 1) (x /= k), (y /= k);
      e.style.transform = `translate(${((x + 1) / 2) * W}px, ${((1 - y) / 2) * H}px)`;
      e.dataset.owner = p.owner < 0 ? 'none' : p.owner === me.team ? 'us' : 'them';
      e.classList.toggle('is-contested', p.contested);
      const d = Math.hypot(p.pos.x - me.pos.x, p.pos.z - me.pos.z);
      const inside = d < p.radius;
      e.classList.toggle('is-here', inside);
      (e.lastChild as HTMLElement).textContent = inside ? (p.contested ? 'Contested' : p.owner === me.team ? 'Held' : 'Capturing') : `${Math.round(d)} m`;
    });
  }

  /** Names over your teammates' heads. */
  /** Your squad's names over their heads; enemies only when a sensor gives them away. */
  tags(units: (Unit & { rig?: unknown })[], cam: THREE.PerspectiveCamera, me: Unit, revealed?: (u: Unit) => boolean) {
    const W = innerWidth, H = innerHeight;
    units.forEach((u, i) => {
      const e = this.tagEls[i];
      const d = u.pos.distanceTo(cam.position);
      const spotted = u.alive && u.team !== me.team && !!revealed?.(u);
      e.classList.toggle('is-enemy', spotted);
      const show = (u.alive && u.team === me.team && d < 60) || spotted;
      if (!show) {
        e.style.display = 'none';
        return;
      }
      const v = this.v.set(u.pos.x, u.pos.y + 2.05, u.pos.z).project(cam);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) {
        e.style.display = 'none';
        return;
      }
      e.style.display = '';
      e.textContent = u.name;
      e.style.transform = `translate(${((v.x + 1) / 2) * W}px, ${((1 - v.y) / 2) * H}px)`;
      e.style.opacity = String(Math.max(0.35, 1 - d / 60));
    });
  }

  vitals(hp: number, armor: number) {
    this.hpEl.style.transform = `scaleX(${Math.max(0, hp / 100).toFixed(3)})`;
    this.hpEl.parentElement!.classList.toggle('is-low', hp < 35);
    this.armorEl.style.transform = `scaleX(${Math.max(0, armor / 50).toFixed(3)})`;
  }

  /** Lethal and tactical left; `cook` 0..1 a frag in the hand; `charge` a remote charge waiting. */
  gear(lethal: string, ln: number, tactical: string, tn: number, cook: number | null, charge: boolean) {
    const key = `${lethal}${ln}${tactical}${tn}${cook == null ? '' : cook.toFixed(2)}${charge}`;
    if (key === this.lastGear) return;
    this.lastGear = key;
    this.gearEl.replaceChildren(
      h('span', { class: `wz-gear__item${ln ? '' : ' is-out'}${cook != null ? ' is-cook' : ''}` }, glyph('lethal'), h('b', {}, charge ? 'Detonate' : lethal), h('i', {}, `×${ln}`)),
      h('span', { class: `wz-gear__item${tn ? '' : ' is-out'}` }, glyph('tactical'), h('b', {}, tactical), h('i', {}, `×${tn}`)),
      ...(cook != null ? [h('i', { class: 'wz-gear__cook', style: `transform:scaleX(${cook.toFixed(3)})` })] : []),
    );
  }

  /** The streak ladder: kills this life against what each one costs, and what's ready to use. */
  streaks(list: { name: string; kills: number }[], kills: number, ready: string[]) {
    const key = `${kills}|${ready.join()}`;
    if (key === this.lastStreak) return;
    this.lastStreak = key;
    // nothing to show before the first kill (the controls are on screen then)
    if (!kills && !ready.length) return this.streakEl.replaceChildren();
    this.streakEl.replaceChildren(
      ...(ready.length ? [h('div', { class: 'wz-streaks__ready' }, glyph('streak'), h('b', {}, ready[0]), ready.length > 1 ? h('i', {}, `+${ready.length - 1}`) : null)] : []),
      ...list.map((s) => h('span', { class: `wz-streaks__step${kills >= s.kills ? ' is-done' : ''}`, title: s.name }, h('i', {}, String(s.kills)), h('em', {}, s.name))),
    );
  }

  /** Flashed (white, fading) and stunned (a blue smear at the edges). */
  blind(flash: number, stun: number) {
    this.flashEl.style.opacity = flash > 0 ? Math.min(1, flash / 1.2).toFixed(3) : '0';
    this.stunEl.style.opacity = stun > 0 ? Math.min(0.85, stun / 2).toFixed(3) : '0';
  }

  /** `mag` -1: a blade (nothing to count). */
  weapon(name: string, mag: number, reserve: number, other: string, reload: number | null, mode = '') {
    this.gunEl.textContent = name;
    this.modeEl.textContent = mode;
    this.magEl.textContent = mag < 0 ? '—' : String(mag);
    this.magEl.classList.toggle('is-low', mag >= 0 && mag <= 3);
    this.reserveEl.textContent = mag < 0 ? '' : `/ ${reserve}`;
    this.otherEl.textContent = other;
    this.reloadEl.style.transform = `scaleX(${reload == null ? 0 : reload.toFixed(3)})`;
    this.reloadEl.classList.toggle('is-on', reload != null);
  }

  /** `scope`: looking through a magnified optic (the view goes dark round the glass). */
  crosshair(c: { spread: number; enemy: boolean; aiming: boolean; fp?: boolean; scope?: boolean } | null) {
    const on = !!c && !(c.aiming && c.fp);
    setOn(this.cross, on);
    setOn(this.dot, !!c && !!c.fp && c.aiming && !c.scope);
    setOn(this.scopeEl, !!c && !!c.fp && !!c.scope);
    if (!c) return;
    this.cross.style.setProperty('--s', `${Math.max(5, Math.min(90, c.spread)).toFixed(1)}px`);
    this.cross.classList.toggle('is-enemy', c.enemy);
    this.dot.classList.toggle('is-enemy', c.enemy);
  }

  hitmarker(kill: boolean, head: boolean) {
    this.hitEl.className = `wz-hit is-on${kill ? ' is-kill' : ''}${head ? ' is-head' : ''}`;
    this.hitT = kill ? 0.45 : 0.2;
  }

  /** Damage from a direction (radians, relative to where you're looking). */
  damageFrom(rel: number) {
    const e = this.dmgEls[this.dmgI++ % this.dmgEls.length];
    e.style.transform = `translate(-50%, -50%) rotate(${rel.toFixed(3)}rad)`;
    e.classList.remove('is-on');
    void e.offsetWidth;
    e.classList.add('is-on');
  }

  feed(a: string, at: 0 | 1, gun: string, v: string, vt: 0 | 1, head: boolean, mine: boolean) {
    const row = h('p', { class: `wz-feed__row${mine ? ' is-mine' : ''}` }, h('b', { class: `t${at}` }, a), h('span', {}, head ? `${gun} · head` : gun), h('b', { class: `t${vt}` }, v));
    this.feedEl.prepend(row);
    while (this.feedEl.children.length > 5) this.feedEl.lastChild!.remove();
    setTimeout(() => row.classList.add('is-gone'), 5000);
    setTimeout(() => row.remove(), 5600);
  }

  feedClear() {
    this.feedEl.replaceChildren();
  }

  announce(text: string, kind: 'us' | 'them' | 'pickup') {
    this.annEl.textContent = text;
    this.annEl.className = `wz-ann is-on wz-ann--${kind}`;
    this.annT = kind === 'pickup' ? 1 : 2.2;
  }

  loadout(on: boolean, list?: Loadout[], sel = 0, first = false, force = false) {
    setOn(this.loadEl, on);
    if (!on || !list) return;
    const key = `${sel}|${first}`;
    if (force) this.lastLoadout = '';
    if (key === this.lastLoadout) return;
    this.lastLoadout = key;
    this.loadTitle.textContent = first ? 'Choose a loadout' : 'Next life';
    this.loadCards.replaceChildren(
      ...list.map((l, i) =>
        h('div', { class: `wz-card${i === sel ? ' is-sel' : ''}${l.custom ? ' is-custom' : ''}` }, h('b', {}, l.name), h('span', { class: 'meta' }, l.line), h('em', { class: 'meta' }, `${WEAPON[l.primary]?.name ?? ''} · ${WEAPON[l.secondary]?.name ?? ''}`)),
      ),
    );
    this.loadCards.children[sel]?.scrollIntoView({ block: 'nearest' });
  }

  death(d: { name: string; gun: string; head: boolean; t: number } | null) {
    setOn(this.deathEl, !!d);
    if (!d) return;
    const line = `Killed by ${d.name} · ${d.gun}${d.head ? ' · headshot' : ''}`;
    const when = d.t > 0 ? `Deploy in ${Math.ceil(d.t)}` : 'Ready to deploy';
    if (this.deathEl.dataset.k !== line + when) {
      this.deathEl.dataset.k = line + when;
      this.deathEl.replaceChildren(h('b', {}, line), h('span', { class: 'meta' }, when));
    }
  }

  scoreboard(units: Unit[] | null, score: [number, number]) {
    setOn(this.boardEl, !!units);
    if (!units) return;
    const col = (team: 0 | 1) =>
      h(
        'div',
        { class: `wz-board__team t${team}` },
        h('h4', {}, `${team ? 'Red' : 'Blue'} · ${score[team]}`),
        h('div', { class: 'wz-board__row meta' }, h('span', {}, 'Name'), h('span', {}, 'K'), h('span', {}, 'D'), h('span', {}, 'Caps')),
        ...units
          .filter((u) => u.team === team)
          .sort((a, b) => b.kills - a.kills)
          .map((u) => h('div', { class: `wz-board__row${u.isPlayer ? ' is-me' : ''}${u.alive ? '' : ' is-dead'}` }, h('span', {}, u.name), h('span', {}, String(u.kills)), h('span', {}, String(u.deaths)), h('span', {}, String(u.caps)))),
      );
    this.boardEl.replaceChildren(col(0), col(1));
  }

  update(dt: number) {
    if (!this.shown) return;
    if (this.hitT > 0 && (this.hitT -= dt) <= 0) this.hitEl.classList.remove('is-on');
    if (this.annT > 0 && (this.annT -= dt) <= 0) this.annEl.classList.remove('is-on');
  }

  showEnd(r: { title: string; lines: string[] } | null) {
    this.end.classList.toggle('is-on', !!r);
    if (!r) return;
    this.endTitle.textContent = r.title;
    this.endStats.replaceChildren(...r.lines.map((l) => h('p', { class: 'meta' }, l)));
  }

  get endOpen() {
    return this.end.classList.contains('is-on');
  }
}
