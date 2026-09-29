import { h, setOn } from '../../ui/dom';
import { buys, stock } from '../game/economy';
import { item } from '../game/items';
import type { Game } from '../game/Game';
import type { Poi } from '../world/Towns';
import type { BiomeId } from '../world/biomes';

/**
 * Buying and selling across a counter: their shelves on the left, your
 * pockets on the right, one press per item. Prices move with the region,
 * your Barter, your Charm and what the town thinks of you.
 */
export class Shop {
  el: HTMLElement;
  private title: HTMLElement;
  private money: HTMLElement;
  private left: HTMLElement;
  private right: HTMLElement;
  private poi!: Poi;
  private g!: Game;
  private biome: BiomeId = 'temperate';
  onClose: () => void = () => {};

  constructor(root: HTMLElement) {
    this.title = h('h2', { class: 'shop__title' });
    this.money = h('span', { class: 'shop__money meta' });
    this.left = h('div', { class: 'shop__col' });
    this.right = h('div', { class: 'shop__col' });
    const done = h('button', { class: 'shop__done', type: 'button' }, 'Done');
    done.addEventListener('click', () => this.onClose());
    this.el = h('section', { class: 'layer shop', role: 'dialog', 'aria-label': 'Trade' },
      h('div', { class: 'shop__card' }, h('header', { class: 'shop__head' }, this.title, this.money), h('div', { class: 'shop__cols' }, this.left, this.right), h('footer', { class: 'shop__foot' }, done)));
    root.append(this.el);
  }

  get isOpen() {
    return this.el.classList.contains('is-on');
  }

  open(g: Game, poi: Poi, biome: BiomeId) {
    this.g = g;
    this.poi = poi;
    this.biome = biome;
    setOn(this.el, true);
    this.render();
    requestAnimationFrame(() => this.el.querySelector<HTMLElement>('button:not([disabled])')?.focus({ preventScroll: true }));
  }

  close() {
    setOn(this.el, false);
  }

  private bought(): Record<string, number> {
    const key = `bought:${this.poi.id}:${this.g.day}`;
    const raw = this.g.s.mem.flags[key];
    return typeof raw === 'string' ? JSON.parse(raw) : {};
  }

  private render() {
    const g = this.g, poi = this.poi;
    const trep = g.s.towns[poi.town] ?? 0;
    this.title.textContent = poi.name;
    this.money.textContent = `$${Math.floor(g.c.money)} · ${g.weight().toFixed(1)} / ${g.carry} kg`;
    const shelf = stock(poi.id, poi.kind, g.day, this.bought());
    const y = [this.left.scrollTop, this.right.scrollTop];
    this.left.replaceChildren(
      h('h3', { class: 'shop__h meta' }, 'On the shelves'),
      ...shelf.map((line) => {
        const d = item(line.id);
        const p = g.price(line.id, this.biome, false, trep);
        const b = h('button', { class: 'shop__line', type: 'button', disabled: g.c.money < p }, h('span', {}, d.name), h('span', { class: 'meta' }, `×${line.n}`), h('span', { class: 'shop__price' }, `$${p}`));
        b.title = d.desc;
        b.addEventListener('click', () => {
          if (!g.pay(p)) return;
          g.give(line.id, 1, undefined, true);
          const bought = this.bought();
          bought[line.id] = (bought[line.id] ?? 0) + 1;
          g.s.mem.flags[`bought:${poi.id}:${g.day}`] = JSON.stringify(bought);
          g.s.stats.bought++;
          if (Math.random() < 0.35) g.practice('barter', 0.8);
          this.render();
        });
        return b;
      }),
      ...(shelf.length ? [] : [h('p', { class: 'shop__empty' }, 'Sold out. Come back tomorrow.')]),
    );
    const mine = g.s.inv.filter((st) => !item(st.id).quest && buys(poi.kind, item(st.id).kind) && item(st.id).v > 0);
    this.right.replaceChildren(
      h('h3', { class: 'shop__h meta' }, 'They’ll buy'),
      ...mine.map((st) => {
        const d = item(st.id);
        const p = g.price(st.id, this.biome, true, trep);
        const b = h('button', { class: 'shop__line', type: 'button' }, h('span', {}, d.name), h('span', { class: 'meta' }, st.n > 1 ? `×${st.n}` : ''), h('span', { class: 'shop__price' }, `$${p}`));
        b.addEventListener('click', () => {
          if (!g.take(st.id, 1)) return;
          g.c.money += p;
          g.s.stats.sold++;
          if (Math.random() < 0.35) g.practice('barter', 0.8);
          this.render();
        });
        return b;
      }),
      ...(mine.length ? [] : [h('p', { class: 'shop__empty' }, 'Nothing they want.')]),
    );
    [this.left.scrollTop, this.right.scrollTop] = y;
  }
}
