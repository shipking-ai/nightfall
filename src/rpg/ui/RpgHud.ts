import { h, setOn } from '../../ui/dom';

/**
 * The RPG's always-on readout, kept small: a compass along the top edge,
 * and in the corner the hour, the weather, and where you are. The same
 * type and colour as the rest of NIGHTFALL; nothing that looks like a
 * dashboard.
 */
export class RpgHud {
  el: HTMLElement;
  private compass: HTMLElement;
  private strip: HTMLElement;
  private place: HTMLElement;
  private region: HTMLElement;
  private clock: HTMLElement;
  private sky: HTMLElement;
  private banner: HTMLElement;
  private bannerT = 0;
  private marks: { el: HTMLElement; yaw: number }[] = [];

  constructor(root: HTMLElement) {
    this.strip = h('div', { class: 'rpgc__strip' });
    for (let d = 0; d < 360; d += 15) {
      const label = d % 90 === 0 ? ['N', 'E', 'S', 'W'][d / 90] : d % 45 === 0 ? ['NE', 'SE', 'SW', 'NW'][(d - 45) / 90] : '';
      const el = h('span', { class: `rpgc__tick${label ? ' rpgc__tick--label' : ''}` }, label || '·');
      this.strip.append(el);
      this.marks.push({ el, yaw: (d * Math.PI) / 180 });
    }
    this.compass = h('div', { class: 'rpgc', 'aria-hidden': 'true' }, this.strip, h('span', { class: 'rpgc__needle' }));
    this.place = h('span', { class: 'rpgs__place' });
    this.region = h('span', { class: 'rpgs__region meta' });
    this.clock = h('span', { class: 'rpgs__clock' });
    this.sky = h('span', { class: 'rpgs__sky meta' });
    this.banner = h('div', { class: 'rpgb', 'aria-live': 'polite' });
    this.el = h(
      'div',
      { class: 'rpghud' },
      this.compass,
      h('div', { class: 'rpgs' }, h('div', { class: 'rpgs__row' }, this.clock, this.sky), h('div', { class: 'rpgs__row' }, this.place, this.region)),
      this.banner,
    );
    root.append(this.el);
  }

  show(on: boolean) {
    setOn(this.el, on);
  }

  /** Heading: the way the camera faces (0 = +z = south in world terms; the compass reads north up = −z). */
  update(dt: number, camYaw: number, clock: string, sky: string, place: string, region: string) {
    // camera yaw 0 looks along +z (south); north is yaw = π
    const bearing = (((Math.PI - camYaw) * 180) / Math.PI + 720) % 360;
    const px = 6; // px per degree
    for (const m of this.marks) {
      let d = (m.yaw * 180) / Math.PI - bearing;
      d = ((d + 540) % 360) - 180;
      const vis = Math.abs(d) < 75;
      m.el.style.transform = `translateX(${d * px}px)`;
      m.el.style.opacity = vis ? String(1 - Math.abs(d) / 80) : '0';
    }
    if (this.clock.textContent !== clock) this.clock.textContent = clock;
    if (this.sky.textContent !== sky) this.sky.textContent = sky;
    if (this.place.textContent !== place) this.place.textContent = place;
    if (this.region.textContent !== region) this.region.textContent = region;
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.banner.classList.remove('is-on');
    }
  }

  /** Arriving somewhere with a name: the name, large, then gone. */
  arrive(name: string, sub: string) {
    this.banner.replaceChildren(h('span', { class: 'meta rpgb__sub' }, sub), h('span', { class: 'rpgb__name' }, name));
    this.banner.classList.add('is-on');
    this.bannerT = 4.5;
  }
}
