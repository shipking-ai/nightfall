import type { Collision } from '../../world/Collision';

/**
 * Where the bots can walk: the yard sampled on a half-metre grid from the
 * same collision boxes that stop you, with A* for routes and a straight-line
 * check to cut the corners off them (so they run lanes, not staircases).
 */
export class NavGrid {
  readonly cell = 0.5;
  readonly w: number;
  readonly h: number;
  private open: Uint8Array;
  // A* scratch, reused
  private g: Float32Array;
  private f: Float32Array;
  private from: Int32Array;
  private seen: Uint32Array;
  private closed: Uint32Array;
  private gen = 1;

  constructor(private col: Collision, readonly x0: number, readonly z0: number, x1: number, z1: number, radius = 0.4) {
    this.w = Math.ceil((x1 - x0) / this.cell);
    this.h = Math.ceil((z1 - z0) / this.cell);
    const n = this.w * this.h;
    this.open = new Uint8Array(n);
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.from = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    for (let j = 0; j < this.h; j++)
      for (let i = 0; i < this.w; i++) {
        const x = x0 + (i + 0.5) * this.cell, z = z0 + (j + 0.5) * this.cell;
        let free = true;
        for (const b of col.query(x - radius, z - radius, x + radius, z + radius)) {
          // anything from knee to head height blocks; kerbs and low slabs don't
          if (b.maxY < 0.45 || b.minY > 1.7) continue;
          if (x > b.minX - radius && x < b.maxX + radius && z > b.minZ - radius && z < b.maxZ + radius) {
            free = false;
            break;
          }
        }
        this.open[j * this.w + i] = free ? 1 : 0;
      }
  }

  idx(x: number, z: number) {
    const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((z - this.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }

  walkable(x: number, z: number) {
    const k = this.idx(x, z);
    return k >= 0 && this.open[k] === 1;
  }

  /** The nearest walkable cell centre to a point (spawns, goals inside a stack). */
  nearest(x: number, z: number): [number, number] {
    if (this.walkable(x, z)) return [x, z];
    for (let r = 1; r < 30; r++)
      for (let a = 0; a < 16; a++) {
        const px = x + Math.cos((a / 16) * Math.PI * 2) * r * this.cell, pz = z + Math.sin((a / 16) * Math.PI * 2) * r * this.cell;
        if (this.walkable(px, pz)) return [px, pz];
      }
    return [x, z];
  }

  /** Can you walk straight from a to b? */
  clear(ax: number, az: number, bx: number, bz: number) {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(d / (this.cell * 0.5));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      if (!this.walkable(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  /** A route from a to b as a list of points (flattened x, z), or null. */
  path(ax: number, az: number, bx: number, bz: number): number[] | null {
    [ax, az] = this.nearest(ax, az);
    [bx, bz] = this.nearest(bx, bz);
    if (this.clear(ax, az, bx, bz)) return [bx, bz];
    const s = this.idx(ax, az), e = this.idx(bx, bz);
    if (s < 0 || e < 0) return null;
    const gen = ++this.gen;
    const W = this.w;
    const ei = e % W, ej = (e / W) | 0;
    const heur = (k: number) => {
      const dx = Math.abs((k % W) - ei), dz = Math.abs(((k / W) | 0) - ej);
      return (dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz)) * this.cell;
    };
    // a small binary heap of cell indices keyed on f
    const heap: number[] = [s];
    this.g[s] = 0;
    this.f[s] = heur(s);
    this.seen[s] = gen;
    this.from[s] = -1;
    const push = (k: number) => {
      heap.push(k);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (this.f[heap[p]] <= this.f[heap[i]]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < heap.length && this.f[heap[l]] < this.f[heap[m]]) m = l;
          if (r < heap.length && this.f[heap[r]] < this.f[heap[m]]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    let found = false;
    let steps = 0;
    while (heap.length && steps++ < 40000) {
      const k = pop();
      if (this.closed[k] === gen) continue;
      this.closed[k] = gen;
      if (k === e) {
        found = true;
        break;
      }
      const ki = k % W, kj = (k / W) | 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ki + di, nj = kj + dj;
          if (ni < 0 || nj < 0 || ni >= W || nj >= this.h) continue;
          const nk = nj * W + ni;
          if (!this.open[nk] || this.closed[nk] === gen) continue;
          // no cutting a corner between two blocked cells
          if (di && dj && (!this.open[kj * W + ni] || !this.open[nj * W + ki])) continue;
          const g = this.g[k] + (di && dj ? Math.SQRT2 : 1) * this.cell;
          if (this.seen[nk] === gen && g >= this.g[nk]) continue;
          this.seen[nk] = gen;
          this.g[nk] = g;
          this.f[nk] = g + heur(nk);
          this.from[nk] = k;
          push(nk);
        }
    }
    if (!found) return null;
    // walk back, then pull the string tight
    const cells: number[] = [];
    for (let k = e; k !== -1; k = this.from[k]) cells.push(k);
    cells.reverse();
    const pts: number[] = [];
    const cx = (k: number) => this.x0 + ((k % W) + 0.5) * this.cell;
    const cz = (k: number) => this.z0 + (((k / W) | 0) + 0.5) * this.cell;
    let ox = ax, oz = az;
    let i = 0;
    while (i < cells.length - 1) {
      let j = i + 1;
      while (j < cells.length - 1 && this.clear(ox, oz, cx(cells[j + 1]), cz(cells[j + 1]))) j++;
      ox = cx(cells[j]);
      oz = cz(cells[j]);
      pts.push(ox, oz);
      i = j;
    }
    pts.push(bx, bz);
    return pts;
  }
}
