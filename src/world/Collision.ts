import * as THREE from 'three';

export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  /** false: the camera may pass through (thin props, railings) */
  cam: boolean;
  stamp: number;
}

const CELL = 16;

/**
 * Axis-aligned world collision. The city is built from boxes, so the
 * player is a vertical capsule approximated by a circle in XZ plus a
 * ground probe. Boxes are bucketed in a uniform grid.
 */
export class Collision {
  boxes: Box[] = [];
  private grid = new Map<number, Box[]>();
  private stamp = 1;
  private scratch: Box[] = [];

  add(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, cam = true): Box {
    const b: Box = {
      minX: Math.min(minX, maxX),
      minY: Math.min(minY, maxY),
      minZ: Math.min(minZ, maxZ),
      maxX: Math.max(minX, maxX),
      maxY: Math.max(minY, maxY),
      maxZ: Math.max(minZ, maxZ),
      cam,
      stamp: 0,
    };
    this.boxes.push(b);
    for (let cx = Math.floor(b.minX / CELL); cx <= Math.floor(b.maxX / CELL); cx++)
      for (let cz = Math.floor(b.minZ / CELL); cz <= Math.floor(b.maxZ / CELL); cz++) {
        const k = key(cx, cz);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(b);
      }
    return b;
  }

  /** Take boxes out again (the outskirts forget slices behind you). */
  remove(boxes: Box[]) {
    const gone = new Set(boxes);
    this.boxes = this.boxes.filter((b) => !gone.has(b));
    for (const b of boxes)
      for (let cx = Math.floor(b.minX / CELL); cx <= Math.floor(b.maxX / CELL); cx++)
        for (let cz = Math.floor(b.minZ / CELL); cz <= Math.floor(b.maxZ / CELL); cz++) {
          const list = this.grid.get(key(cx, cz));
          if (!list) continue;
          const i = list.indexOf(b);
          if (i >= 0) list.splice(i, 1);
        }
  }

  /** Centre + size helper. */
  addCentered(x: number, y: number, z: number, w: number, h: number, d: number, cam = true): Box {
    return this.add(x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2, cam);
  }

  query(x0: number, z0: number, x1: number, z1: number): Box[] {
    const out = this.scratch;
    out.length = 0;
    const s = ++this.stamp;
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
      for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const list = this.grid.get(key(cx, cz));
        if (!list) continue;
        for (const b of list)
          if (b.stamp !== s) {
            b.stamp = s;
            out.push(b);
          }
      }
    return out;
  }

  /** Highest walkable surface under (x,z) that is not above y + step. */
  groundAt(x: number, z: number, y: number, step: number, radius = 0.2): number {
    let g = 0;
    for (const b of this.query(x - radius, z - radius, x + radius, z + radius)) {
      if (x < b.minX - radius * 0.5 || x > b.maxX + radius * 0.5 || z < b.minZ - radius * 0.5 || z > b.maxZ + radius * 0.5) continue;
      if (b.maxY <= y + step && b.maxY > g) g = b.maxY;
    }
    return g;
  }

  /** Push a circle out of any box it overlaps at the given vertical span. */
  resolve(p: THREE.Vector3, radius: number, height: number, step: number): boolean {
    let hit = false;
    for (let iter = 0; iter < 2; iter++) {
      for (const b of this.query(p.x - radius, p.z - radius, p.x + radius, p.z + radius)) {
        if (b.maxY <= p.y + step || b.minY >= p.y + height) continue;
        const nx = clamp(p.x, b.minX, b.maxX);
        const nz = clamp(p.z, b.minZ, b.maxZ);
        let dx = p.x - nx;
        let dz = p.z - nz;
        const d2 = dx * dx + dz * dz;
        if (d2 > radius * radius) continue;
        hit = true;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          p.x = nx + (dx / d) * radius;
          p.z = nz + (dz / d) * radius;
        } else {
          // centre inside the box: exit via the nearest face
          const l = p.x - b.minX, rr = b.maxX - p.x, t = p.z - b.minZ, bt = b.maxZ - p.z;
          const m = Math.min(l, rr, t, bt);
          if (m === l) p.x = b.minX - radius;
          else if (m === rr) p.x = b.maxX + radius;
          else if (m === t) p.z = b.minZ - radius;
          else p.z = b.maxZ + radius;
        }
      }
    }
    return hit;
  }

  /** Distance along a ray to the first camera-blocking box, or maxDist. */
  raycast(o: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number {
    const ex = o.x + dir.x * maxDist, ez = o.z + dir.z * maxDist;
    let best = maxDist;
    for (const b of this.query(Math.min(o.x, ex), Math.min(o.z, ez), Math.max(o.x, ex), Math.max(o.z, ez))) {
      if (!b.cam) continue;
      const t = slab(o, dir, b);
      if (t >= 0 && t < best) best = t;
    }
    return best;
  }
}

function slab(o: THREE.Vector3, d: THREE.Vector3, b: Box): number {
  let tmin = -Infinity, tmax = Infinity;
  const axes: [number, number, number, number][] = [
    [o.x, d.x, b.minX, b.maxX],
    [o.y, d.y, b.minY, b.maxY],
    [o.z, d.z, b.minZ, b.maxZ],
  ];
  for (const [oo, dd, mn, mx] of axes) {
    if (Math.abs(dd) < 1e-9) {
      if (oo < mn || oo > mx) return -1;
    } else {
      let t1 = (mn - oo) / dd, t2 = (mx - oo) / dd;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
  }
  if (tmax < 0) return -1;
  return tmin < 0 ? 0 : tmin;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const key = (cx: number, cz: number) => (cx + 512) * 4096 + (cz + 512);
