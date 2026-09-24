import { Emitter } from '../core/Emitter';
import type { SaveState } from '../core/SaveState';
import { entryById, PLACE_BY_DISTRICT, type Entry } from '../data/archive';
import { districtAt, inRect, r } from '../world/layout';

const BRIDGE_ZONE = r(-10, 166, 10, 186);

/**
 * Turns presence into memory: walking into a place, reading a notice,
 * witnessing the loop — each becomes an Archive entry, once.
 */
export class Discovery extends Emitter<{ found: Entry; district: { name: string; code: string } | null }> {
  private lastDistrict: string | null = null;
  private queue: Entry[] = [];

  constructor(private save: SaveState) {
    super();
  }

  update(x: number, z: number) {
    const d = districtAt(x, z);
    const id = d?.id ?? null;
    if (id !== this.lastDistrict) {
      this.lastDistrict = id;
      this.emit('district', d ? { name: d.name, code: d.code } : null);
      if (d) {
        this.save.data.lastPlace = d.name;
        const place = PLACE_BY_DISTRICT[d.id];
        if (place) this.unlock(place);
      }
    }
    if (inRect({ x, z }, BRIDGE_ZONE)) this.unlock('ashford-bridge');
  }

  get districtName(): string {
    return this.save.data.lastPlace ?? 'Central Avenue';
  }

  unlock(id: string): boolean {
    const e = entryById(id);
    if (!e || !this.save.add(id)) return false;
    this.emit('found', e);
    return true;
  }

  get count() {
    return this.save.data.discovered.length;
  }

  /** the next update names the district again (e.g. coming back out of a building) */
  forgetDistrict() {
    this.lastDistrict = null;
  }

  reset() {
    this.lastDistrict = null;
    this.queue = [];
  }
}
