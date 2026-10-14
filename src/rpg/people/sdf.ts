/**
 * Signed distance fields for sculpting people in code. A shape is a list of
 * primitives combined in order (smooth union, smooth subtraction, smooth
 * intersection), each with a bounding sphere so the mesher can skip the ones
 * that can't matter at a point. Plain numbers only: this runs in a worker.
 */

export type V3 = [number, number, number];

export const enum Op {
  Union = 0,
  Sub = 1,
  Inter = 2,
}

export const enum Kind {
  Ellipsoid = 0,
  RoundCone = 1,
  Sphere = 2,
  RoundBox = 3,
  Plane = 4,
  Torus = 5,
}

export interface Prim {
  kind: Kind;
  op: Op;
  /** blend radius (0 = hard) */
  k: number;
  /** parameters (by kind) */
  a: V3;
  b: V3;
  r1: number;
  r2: number;
  /** bounding sphere */
  cx: number;
  cy: number;
  cz: number;
  cr: number;
  /** optional wrinkle/noise amplitude (metres) */
  noise?: number;
  /** a region id (for the skinning to prefer bones by region) */
  tag?: number;
}

/* ── primitive constructors ─────────────────────────────── */

export function ellipsoid(c: V3, r: V3, op: Op = Op.Union, k = 0.02): Prim {
  return { kind: Kind.Ellipsoid, op, k, a: c, b: r, r1: 0, r2: 0, cx: c[0], cy: c[1], cz: c[2], cr: Math.max(r[0], r[1], r[2]) };
}

/** a tapered capsule from a (radius r1) to b (radius r2) */
export function cone(a: V3, b: V3, r1: number, r2: number, op: Op = Op.Union, k = 0.02): Prim {
  const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, cz = (a[2] + b[2]) / 2;
  const half = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 2;
  return { kind: Kind.RoundCone, op, k, a, b, r1, r2, cx, cy, cz, cr: half + Math.max(r1, r2) };
}

export function sphere(c: V3, r: number, op: Op = Op.Union, k = 0.02): Prim {
  return { kind: Kind.Sphere, op, k, a: c, b: [0, 0, 0], r1: r, r2: 0, cx: c[0], cy: c[1], cz: c[2], cr: r };
}

/** axis-aligned rounded box: centre, half-size, corner radius */
export function box(c: V3, h: V3, round: number, op: Op = Op.Union, k = 0.02): Prim {
  return { kind: Kind.RoundBox, op, k, a: c, b: h, r1: round, r2: 0, cx: c[0], cy: c[1], cz: c[2], cr: Math.hypot(h[0], h[1], h[2]) + round };
}

/** half-space: points with dot(p - a, n) > 0 are outside (n unit) — use with Inter/Sub to cut */
export function plane(a: V3, n: V3, op: Op = Op.Inter, k = 0.01): Prim {
  return { kind: Kind.Plane, op, k, a, b: n, r1: 0, r2: 0, cx: a[0], cy: a[1], cz: a[2], cr: 1e9 };
}

/** torus in the XZ plane (a ring), major r1, minor r2 */
export function torus(c: V3, r1: number, r2: number, op: Op = Op.Union, k = 0.01): Prim {
  return { kind: Kind.Torus, op, k, a: c, b: [0, 0, 0], r1, r2, cx: c[0], cy: c[1], cz: c[2], cr: r1 + r2 };
}

/* ── distance functions ─────────────────────────────── */

function dEllipsoid(px: number, py: number, pz: number, r: V3) {
  const x = px / r[0], y = py / r[1], z = pz / r[2];
  const k0 = Math.sqrt(x * x + y * y + z * z);
  const x2 = px / (r[0] * r[0]), y2 = py / (r[1] * r[1]), z2 = pz / (r[2] * r[2]);
  const k1 = Math.sqrt(x2 * x2 + y2 * y2 + z2 * z2);
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(r[0], r[1], r[2]);
}

// iq's round cone
function dRoundCone(px: number, py: number, pz: number, a: V3, b: V3, r1: number, r2: number) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y;
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

function dRoundBox(px: number, py: number, pz: number, h: V3, r: number) {
  const qx = Math.abs(px) - h[0] + r, qy = Math.abs(py) - h[1] + r, qz = Math.abs(pz) - h[2] + r;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

export function primDist(p: Prim, x: number, y: number, z: number): number {
  switch (p.kind) {
    case Kind.Ellipsoid:
      return dEllipsoid(x - p.a[0], y - p.a[1], z - p.a[2], p.b);
    case Kind.RoundCone:
      return dRoundCone(x, y, z, p.a, p.b, p.r1, p.r2);
    case Kind.Sphere:
      return Math.hypot(x - p.a[0], y - p.a[1], z - p.a[2]) - p.r1;
    case Kind.RoundBox:
      return dRoundBox(x - p.a[0], y - p.a[1], z - p.a[2], p.b, p.r1);
    case Kind.Plane:
      return (x - p.a[0]) * p.b[0] + (y - p.a[1]) * p.b[1] + (z - p.a[2]) * p.b[2];
    case Kind.Torus: {
      const dx = x - p.a[0], dy = y - p.a[1], dz = z - p.a[2];
      const q = Math.hypot(dx, dz) - p.r1;
      return Math.hypot(q, dy) - p.r2;
    }
  }
}

/* ── combining ─────────────────────────────── */

function smin(a: number, b: number, k: number) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function smax(a: number, b: number, k: number) {
  return -smin(-a, -b, k);
}

/** A cheap 3D value noise for wrinkles and skin (deterministic). */
export function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number, c: number) => {
    let n = (a * 374761393 + b * 668265263 + c * 1274126177) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(h(ix, iy, iz), h(ix + 1, iy, iz), ux), l(h(ix, iy + 1, iz), h(ix + 1, iy + 1, iz), ux), uy),
    l(l(h(ix, iy, iz + 1), h(ix + 1, iy, iz + 1), ux), l(h(ix, iy + 1, iz + 1), h(ix + 1, iy + 1, iz + 1), ux), uy),
    uz,
  );
}

export class Shape {
  prims: Prim[] = [];
  /** a displacement applied at the end (fabric folds, skin), metres */
  detail: ((x: number, y: number, z: number) => number) | null = null;

  add(...p: Prim[]) {
    this.prims.push(...p);
    return this;
  }

  /** Signed distance at (x, y, z). `band`: beyond this the exact value doesn't matter (only its sign). */
  eval(x: number, y: number, z: number, band = 1e9): number {
    let d = 1e9;
    const P = this.prims;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      // bounding-sphere skip: this primitive can't change the result here
      const bx = x - p.cx, by = y - p.cy, bz = z - p.cz;
      const lb = Math.sqrt(bx * bx + by * by + bz * bz) - p.cr - p.k;
      if (p.op === Op.Union) {
        if (lb > d || lb > band) continue;
        d = smin(d, primDist(p, x, y, z), p.k);
      } else if (p.op === Op.Sub) {
        if (lb > p.k - d && lb > 0) continue;
        d = smax(d, -primDist(p, x, y, z), p.k);
      } else {
        d = smax(d, primDist(p, x, y, z), p.k);
      }
    }
    if (this.detail && d < 0.02 && d > -0.02) d += this.detail(x, y, z);
    return d;
  }

  bounds(pad = 0.02): { min: V3; max: V3 } {
    const min: V3 = [1e9, 1e9, 1e9], max: V3 = [-1e9, -1e9, -1e9];
    for (const p of this.prims) {
      if (p.op !== Op.Union) continue;
      min[0] = Math.min(min[0], p.cx - p.cr - pad);
      min[1] = Math.min(min[1], p.cy - p.cr - pad);
      min[2] = Math.min(min[2], p.cz - p.cr - pad);
      max[0] = Math.max(max[0], p.cx + p.cr + pad);
      max[1] = Math.max(max[1], p.cy + p.cr + pad);
      max[2] = Math.max(max[2], p.cz + p.cr + pad);
    }
    return { min, max };
  }
}
