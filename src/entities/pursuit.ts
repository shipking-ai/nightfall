import * as THREE from 'three';
import type { Collision } from '../world/Collision';

/**
 * How a police or military car gets to you: by the streets.
 *
 * District 03 is a grid. Three long roads run east–west and never end
 * (Linden Street, Harbor Lane, River Road, carrying on through the
 * outskirts); Central Avenue crosses them north–south, and out past the
 * district's edges a cross street runs north–south every 80 m. A pursuing car
 * drives that grid: along its road to the cross street nearest the line to
 * you, turns, comes up it to your road, turns again and runs you down. Only
 * when it's close and can see you does it leave the lines and drive straight
 * at you.
 *
 * It comes from somewhere you aren't looking, a long way off, on a real
 * road, facing the way it needs to go: behind you, round a corner, on the
 * parallel street. Not dropped in front of your bonnet.
 */

/** the east–west roads (centre lines) */
export const Z_ROADS = [-40, 54, 141];
/** the district's own north–south road, and its extent */
const AVENUE = { x: 0, z0: -122, z1: 162 };
/** the outskirts' cross streets: x = ±(156 + 80 n), from the north wall to the river */
const EDGE = 156, STEP = 80;
const CROSS = { z0: -122, z1: 161 };

export function crossStreets(nearX: number, span = 400): number[] {
  const out = [AVENUE.x];
  for (const s of [-1, 1]) for (let n = 0; n < 40; n++) {
    const x = s * (EDGE + n * STEP);
    if (Math.abs(x - nearX) < span) out.push(x);
  }
  return out;
}

/** The east–west road this point is on (its centre z), if any. */
export function onH(x: number, z: number) {
  for (const zc of Z_ROADS) if (Math.abs(z - zc) < 9) return zc;
  return null;
}

/** The north–south road this point is on (its centre x), if any. */
export function onV(x: number, z: number) {
  if (Math.abs(x - AVENUE.x) < 10 && z > AVENUE.z0 && z < AVENUE.z1) return AVENUE.x;
  if (Math.abs(x) > 150 && z > CROSS.z0 && z < CROSS.z1) {
    const n = Math.round((Math.abs(x) - EDGE) / STEP);
    const xc = Math.sign(x) * (EDGE + n * STEP);
    if (n >= 0 && Math.abs(x - xc) < 7) return xc;
  }
  return null;
}

const nearestZ = (z: number) => Z_ROADS.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a));

/** The cross street to use between here and there: the one that makes the trip shortest. */
function crossBetween(cx: number, tx: number) {
  let best = AVENUE.x, bs = Infinity;
  for (const xv of crossStreets((cx + tx) / 2, Math.abs(cx - tx) / 2 + 200)) {
    const s = Math.abs(xv - cx) + Math.abs(xv - tx) + Math.abs(xv - cx) * 0.01;
    if (s < bs) (bs = s), (best = xv);
  }
  return best;
}

/**
 * Where to drive next to reach `t` from `c` along the grid. `direct`: close,
 * and nothing solid between, so just go for it.
 */
export function waypoint(c: THREE.Vector3, t: THREE.Vector3, direct: boolean, out: THREE.Vector3, yaw = 0) {
  if (direct) return out.copy(t);
  const h = onH(c.x, c.z), v = onV(c.x, c.z);
  const tz = onH(t.x, t.z) ?? nearestZ(t.z);
  const tv = onV(t.x, t.z);
  if (h !== null && v === null) {
    // on an east–west road
    if (Math.abs(t.z - h) < 9) return out.set(t.x, 0, h);
    const xv = tv !== null ? tv : crossBetween(c.x, t.x);
    if (Math.abs(c.x - xv) > 4) return out.set(xv, 0, h);
    return out.set(xv, 0, tv !== null ? t.z : tz);
  }
  if (v !== null && h === null) {
    // on a north–south road
    if (Math.abs(t.x - v) < 9) return out.set(v, 0, t.z);
    if (Math.abs(c.z - tz) > 4) return out.set(v, 0, tz);
    return out.set(t.x, 0, tz);
  }
  if (h !== null && v !== null) {
    // in a junction: take whichever road heads for them
    if (Math.abs(t.z - h) < 9) return out.set(t.x, 0, h);
    if (Math.abs(t.x - v) < 9) return out.set(v, 0, t.z);
    return Math.abs(t.x - c.x) > Math.abs(t.z - c.z) ? out.set(c.x + Math.sign(t.x - c.x) * 30, 0, h) : out.set(v, 0, c.z + Math.sign(tz - c.z) * 30);
  }
  // off the roads (a yard, a pavement): back onto the nearest one, merging forward rather than square on
  const zc = nearestZ(c.z);
  const xv = crossBetween(c.x, c.x);
  const fx = Math.sin(yaw) * 14, fz = Math.cos(yaw) * 14;
  return Math.abs(c.z - zc) < Math.abs(c.x - xv) ? out.set(c.x + fx, 0, zc) : out.set(xv, 0, c.z + fz);
}

/**
 * Somewhere to come from: on a road, 100–150 m from you, out of sight of
 * where you're looking and preferably behind where you're going. Faces the
 * way it'll drive.
 */
export function spawnPoint(p: THREE.Vector3, heading: THREE.Vector3, camFwd: THREE.Vector3, taken: THREE.Vector3[], col: Collision | null): { x: number; z: number; yaw: number } {
  const cands: { x: number; z: number; yaw: number }[] = [];
  for (const zc of Z_ROADS)
    for (const s of [-1, 1])
      for (const d of [105, 125, 145]) {
        const x = p.x + s * d;
        if (Math.abs(zc - p.z) > 150) continue;
        cands.push({ x, z: zc + (s > 0 ? -3.2 : 3.2), yaw: s > 0 ? -Math.PI / 2 : Math.PI / 2 });
      }
  for (const xv of crossStreets(p.x, 160))
    for (const s of [-1, 1])
      for (const d of [105, 130]) {
        const z = p.z + s * d;
        const lo = xv === 0 ? AVENUE.z0 : CROSS.z0, hi = xv === 0 ? AVENUE.z1 : CROSS.z1;
        if (z < lo + 4 || z > hi - 4) continue;
        cands.push({ x: xv + (s > 0 ? 3.2 : -3.2), z, yaw: s > 0 ? Math.PI : 0 });
      }
  let best = cands[0], bs = -Infinity;
  for (const c of cands) {
    const dx = c.x - p.x, dz = c.z - p.z, d = Math.hypot(dx, dz) || 1;
    if (d < 90 || d > 170) continue;
    // not in view; behind where you're heading is best
    const seen = (dx * camFwd.x + dz * camFwd.z) / d;
    const ahead = (dx * heading.x + dz * heading.z) / d;
    let s = -seen * 2 - ahead * 1.5 + Math.random() * 0.6;
    if (seen > 0.55) s -= 4;
    if (taken.some((t) => Math.hypot(t.x - c.x, t.z - c.z) < 25)) s -= 6;
    // not inside something (the outskirts are only built near you)
    if (col && col.groundAt(c.x, c.z, 2.5, 2.4, 1.0) > 1.2) s -= 10;
    if (s > bs) (bs = s), (best = c);
  }
  return best;
}

/** Steering away from what's in front: three feelers, the freer side wins. */
export function avoid(col: Collision, x: number, y: number, z: number, yaw: number, speed: number, tmp: THREE.Vector3, dir: THREE.Vector3): number {
  const reach = 5 + Math.abs(speed) * 0.55;
  const ray = (a: number) => {
    tmp.set(x, y + 0.7, z);
    dir.set(Math.sin(yaw + a), 0, Math.cos(yaw + a));
    return col.raycast(tmp, dir, reach);
  };
  const f = ray(0);
  if (f >= reach) return 0;
  const l = ray(0.5), r = ray(-0.5);
  const k = 1 - f / reach;
  // positive steer turns toward +yaw (see Dynamics): toward whichever feeler is freer
  return (l > r ? 1 : -1) * Math.min(1, 0.4 + k);
}
