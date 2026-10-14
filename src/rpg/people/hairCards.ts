import { B, type HairKind, type Joints } from './anatomy';
import type { BuiltPart } from './build';
import type { V3 } from './sdf';

/**
 * A head of hair as games do it: thousands of thin tapered cards, each a
 * lock of strands (the texture draws the strands; the card only carries
 * them). Every lock is grown from a root on the scalp: it leaves along the
 * scalp in the way that cut is combed, gravity takes it as it grows, and it
 * is kept off the head and the shoulders so it lies over them. Ponytails,
 * buns and braids gather their locks to a tie first, then hang or wind.
 */

interface Style {
  /** how many locks */
  n: number;
  /** length of a lock, metres (from the root, or from the tie) */
  len: number;
  /** points along a lock */
  seg: number;
  /** card width at the root */
  w: number;
  /** how quickly gravity takes the lock (0 lies along the scalp) */
  fall: number;
  /** how far off the scalp the locks sit */
  lift: number;
  /** curl radius (0: straight) */
  curl?: number;
  /** gathered to ties at the back (ponytail, braids) or wound into a bun */
  tie?: 'tail' | 'bun' | 'braids';
}

const STYLES: Partial<Record<HairKind, Style>> = {
  short: { n: 2200, len: 0.05, seg: 4, w: 0.014, fall: 0.12, lift: 0.004 },
  swept: { n: 2400, len: 0.075, seg: 6, w: 0.015, fall: 0.05, lift: 0.004 },
  curly: { n: 2200, len: 0.075, seg: 7, w: 0.013, fall: 0.1, lift: 0.012, curl: 0.009 },
  bob: { n: 2000, len: 0.17, seg: 8, w: 0.018, fall: 0.8, lift: 0.006 },
  long: { n: 2100, len: 0.36, seg: 11, w: 0.018, fall: 0.9, lift: 0.006 },
  ponytail: { n: 1900, len: 0.28, seg: 12, w: 0.015, fall: 0.9, lift: 0.003, tie: 'tail' },
  bun: { n: 1800, len: 0.2, seg: 12, w: 0.014, fall: 0, lift: 0.003, tie: 'bun' },
  braids: { n: 1800, len: 0.32, seg: 18, w: 0.016, fall: 0.9, lift: 0.003, tie: 'braids' },
};

type Vec = [number, number, number];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec, b: Vec, k = 1): Vec => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec): Vec => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** An ellipsoid something must stay outside of. */
interface Ell {
  c: Vec;
  r: Vec;
}
function pushOut(p: Vec, e: Ell, pad: number): Vec {
  const d: Vec = [(p[0] - e.c[0]) / (e.r[0] + pad), (p[1] - e.c[1]) / (e.r[1] + pad), (p[2] - e.c[2]) / (e.r[2] + pad)];
  const k = Math.hypot(d[0], d[1], d[2]);
  if (k >= 1 || k === 0) return p;
  return [e.c[0] + (d[0] / k) * (e.r[0] + pad), e.c[1] + (d[1] / k) * (e.r[1] + pad), e.c[2] + (d[2] / k) * (e.r[2] + pad)];
}

function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Grow the locks. `scalp`: the scalp's triangles as vertex ids into `Q`
 * (positions) and `N` (normals); `eye`: the eyes' mid-point.
 */
export function hairCards(kind: HairKind, color: number, seed: number, scalp: number[], Q: Float32Array, N: Float32Array, j: Joints, eye: V3, headVerts: number[]): BuiltPart | null {
  const st = STYLES[kind];
  if (!st || scalp.length < 3) return null;
  const rand = rng(seed * 7919 + 17);
  // the head, as an ellipsoid fitted round the scalp
  let lo: Vec = [1e9, 1e9, 1e9], hi: Vec = [-1e9, -1e9, -1e9];
  for (const v of scalp) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], Q[v * 3 + k]);
    hi[k] = Math.max(hi[k], Q[v * 3 + k]);
  }
  const hc: Vec = [(lo[0] + hi[0]) / 2, eye[1] + 0.01, (lo[2] + Math.max(hi[2], eye[2])) / 2 - 0.005];
  // (a little inside the scalp's bounds: an ellipsoid round them stands off the real skull in places)
  const head: Ell = { c: hc, r: [((hi[0] - lo[0]) / 2) * 0.85, (hi[1] - hc[1]) * 0.85, ((Math.max(hi[2], eye[2]) - lo[2]) / 2) * 0.85] };
  // the neck and the shoulders the longer cuts fall over
  const neckY = j.neck[1];
  const neck: Ell = { c: [j.neck[0], neckY - 0.03, j.neck[2] - 0.01], r: [0.06, 0.09, 0.065] };
  const shW = Math.abs(j.shL[0] - j.shR[0]) / 2;
  const torso: Ell = { c: [j.chest[0], j.chest[1] - 0.02, j.chest[2] - 0.005], r: [shW + 0.045, 0.24, 0.13] };
  const bodies = [neck, torso];
  // the head itself: kept off its real surface (the nearest of its vertices, out along that vertex's normal)
  const onHead = (q: Vec, pad: number, hug = false): Vec => {
    for (let it = 0; it < 2; it++) {
      let best = -1, bd = 1e9;
      for (const v of headVerts) {
        const dx = q[0] - Q[v * 3], dy = q[1] - Q[v * 3 + 1], dz = q[2] - Q[v * 3 + 2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd) {
          bd = d;
          best = v;
        }
      }
      // (a short cut is pulled back onto the head from further out: no flyaways over the ears)
      const reach = hug ? 0.07 : 0.03;
      if (best < 0 || bd > reach * reach) return q;
      const nn: Vec = [N[best * 3], N[best * 3 + 1], N[best * 3 + 2]];
      const h = dot(sub(q, [Q[best * 3], Q[best * 3 + 1], Q[best * 3 + 2]]), nn);
      // (hugging: pulled down onto the scalp too, not only pushed off it)
      if (h >= pad && !(hug && h > pad + 0.0005)) return q;
      q = add(q, nn, pad - h);
    }
    return q;
  };
  // roots: scattered over the scalp by area
  const areas: number[] = [];
  let total = 0;
  for (let i = 0; i < scalp.length; i += 3) {
    const a = scalp[i], b = scalp[i + 1], c = scalp[i + 2];
    const pa: Vec = [Q[a * 3], Q[a * 3 + 1], Q[a * 3 + 2]], pb: Vec = [Q[b * 3], Q[b * 3 + 1], Q[b * 3 + 2]], pc: Vec = [Q[c * 3], Q[c * 3 + 1], Q[c * 3 + 2]];
    const ar = Math.hypot(...cross(sub(pb, pa), sub(pc, pa))) / 2;
    total += ar;
    areas.push(total);
  }
  // where the hair parts (a little off centre), and where ties sit
  const side = rand() < 0.5 ? -1 : 1;
  const part: Vec = [hc[0] + side * head.r[0] * 0.3, hc[1] + head.r[1], hc[2] + head.r[2] * 0.25];
  const crown: Vec = [hc[0], hc[1] + head.r[1] * 0.85, hc[2] - head.r[2] * 0.35];
  const ties: Vec[] =
    st.tie === 'tail' ? [[hc[0], hc[1] + head.r[1] * 0.35, hc[2] - head.r[2] - 0.012]]
    : st.tie === 'bun' ? [[hc[0], hc[1] + head.r[1] * 0.55, hc[2] - head.r[2] * 0.9 - 0.02]]
    : st.tie === 'braids' ? [[hc[0] - head.r[0] * 0.8, hc[1] - head.r[1] * 0.35, hc[2] - head.r[2] * 0.45], [hc[0] + head.r[0] * 0.8, hc[1] - head.r[1] * 0.35, hc[2] - head.r[2] * 0.45]]
    : [];
  const bunR = 0.038;
  // the nape's hair hangs down the back of the neck, not round to the throat
  const behindNeck = (q: Vec): Vec => {
    if (q[1] > eye[1] - 0.09 || Math.abs(q[0] - hc[0]) > 0.085) return q;
    const zMax = j.neck[2] - 0.035;
    return q[2] > zMax && q[1] > neckY - 0.08 ? [q[0], q[1], zMax] : q;
  };
  // nothing hangs in front of the face: from the brow down, a lock that strays in front of it goes to the side
  const faceHalf = head.r[0] * 0.78;
  const offFace = (q: Vec): Vec => {
    if (kind === 'short' || kind === 'curly' || kind === 'swept') return q;
    if (q[2] < eye[2] - 0.045 || q[1] > eye[1] + 0.05 || q[1] < eye[1] - 0.32) return q;
    const dx = q[0] - hc[0];
    if (Math.abs(dx) >= faceHalf) return q;
    return [hc[0] + (dx < 0 ? -faceHalf : faceHalf), q[1], q[2]];
  };

  const pos: number[] = [], nrm: number[] = [], uvs: number[] = [], sI: number[] = [], sW: number[] = [], idx: number[] = [];
  const pts: Vec[] = [];
  for (let s = 0; s < st.n; s++) {
    // a root, somewhere on the scalp
    const r = rand() * total;
    let lo2 = 0, hi2 = areas.length - 1;
    while (lo2 < hi2) {
      const m = (lo2 + hi2) >> 1;
      if (areas[m] < r) lo2 = m + 1;
      else hi2 = m;
    }
    const ti = lo2 * 3;
    let u = rand(), v = rand();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const w0 = 1 - u - v;
    const [a, b, c] = [scalp[ti], scalp[ti + 1], scalp[ti + 2]];
    let p: Vec = [0, 0, 0], n: Vec = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      p[k] = Q[a * 3 + k] * w0 + Q[b * 3 + k] * u + Q[c * 3 + k] * v;
      n[k] = N[a * 3 + k] * w0 + N[b * 3 + k] * u + N[c * 3 + k] * v;
    }
    n = norm(n);
    // how it's combed: away from the parting (swept: back off the brow; short: down and back from the crown)
    let comb: Vec;
    if (kind === 'swept') comb = add(norm(sub(p, part)), [0, 0.2, -1.4]);
    else if (kind === 'short' || kind === 'curly') comb = add(norm(sub(p, crown)), [0, -0.3, p[2] > hc[2] + head.r[2] * 0.4 ? 0.4 : -0.2]);
    else {
      comb = norm(sub(p, part));
      // off the face: the front falls to either side of the parting and back
      if (p[2] > hc[2]) comb = norm(add(comb, [p[0] < part[0] ? -1 : 1, 0, -0.5], 1.2 * Math.min(1, (p[2] - hc[2]) / (head.r[2] * 0.5))));
    }
    // along the scalp
    comb = norm(sub(comb, [n[0] * dot(comb, n), n[1] * dot(comb, n), n[2] * dot(comb, n)]));
    const lift = st.lift * (0.6 + rand() * 0.8);
    pts.length = 0;
    // start just under the surface, so the root sits in the cap
    pts.push(add(p, n, -0.001));
    let at = add(p, n, lift);
    let dir = comb;
    const hug = kind === 'short' || kind === 'swept' || kind === 'curly';
    // (short cuts are shorter at the nape: tapered, not a mullet)
    const nape = hug ? Math.min(1, Math.max(0.25, (p[1] - (eye[1] - 0.075)) / 0.06)) : 1;
    let len = st.len * nape * (st.tie ? 1 : 0.75 + rand() * 0.5);
    // and end at the hairline, not down the neck
    if (hug) len = Math.min(len, Math.max(0.008, p[1] - (eye[1] - 0.085)));
    if (st.tie) {
      // gather: over the head to the tie
      const tie = ties.length > 1 ? ties[p[0] < hc[0] ? 0 : 1] : ties[0];
      const k = 5;
      const from = at;
      for (let q = 1; q <= k; q++) {
        let m = add(from, sub(tie, from), q / k);
        // pulled tight over the head
        m = onHead(pushOut(m, head, st.lift), st.lift + 0.002, q < k);
        pts.push(m);
      }
      at = add(tie, norm([rand() - 0.5, rand() - 0.5, rand() - 0.5]), 0.006);
      if (st.tie === 'bun') {
        // wind round the bun: a loop on a random great circle about its centre
        const bc = add(tie, norm(sub(tie, hc)), bunR * 0.6);
        const ax = norm([rand() - 0.5, rand() - 0.5, rand() - 0.5]);
        const e1 = norm(cross(ax, sub(at, bc)));
        const e2 = norm(cross(ax, e1));
        const rr = bunR * (0.75 + rand() * 0.3);
        const loop = st.seg - k;
        for (let q = 1; q <= loop; q++) {
          const ang = (q / loop) * Math.PI * 1.6;
          pts.push(add(add(bc, e1, Math.cos(ang) * rr), e2, Math.sin(ang) * rr));
        }
      } else {
        // hang from the tie
        const steps = st.seg - k;
        const sl = len / steps;
        dir = norm([(rand() - 0.5) * 0.3, -0.5, -0.8]);
        const braid = st.tie === 'braids';
        for (let q = 1; q <= steps; q++) {
          dir = norm(add(dir, [0, -1, 0], st.fall * 0.5));
          at = add(at, dir, sl);
          // a braid is a tight, woven rope: pull each lock to the rope's axis and cross it over
          if (braid) {
            const t = q / steps;
            const tie = ties[p[0] < hc[0] ? 0 : 1];
            // (the rope hangs down the outside of the neck and back, not through them)
            let axis: Vec = [tie[0], tie[1] - len * t * 0.95, tie[2] - 0.03 - t * 0.02];
            axis = pushOut(pushOut(axis, neck, 0.022), torso, 0.022);
            // three strands, each winding round the rope's axis a third of a turn apart
            const ang = t * 26 + (s % 3) * 2.094;
            const rr = 0.016 * (1 - t * 0.45);
            at = add(axis, [Math.cos(ang) * rr + (rand() - 0.5) * 0.004, 0, Math.sin(ang) * rr * 0.8]);
          }
          for (const e of bodies) at = pushOut(at, e, 0.004);
          pts.push(at);
        }
      }
    } else {
      // loose: grow, and let gravity take it (short steps at the root, so it hugs the scalp first)
      const wsum = st.seg * 0.5 + (st.seg * (st.seg + 1)) / (2 * st.seg);
      for (let q = 1; q <= st.seg; q++) {
        const sl = (len * (0.5 + q / st.seg)) / wsum;
        dir = norm(add(dir, [0, -1, 0], st.fall * (q / st.seg)));
        at = add(at, dir, sl);
        if (st.curl) {
          const side2 = norm(cross(dir, n));
          const ph = q * 1.9 + s;
          at = add(add(at, side2, Math.cos(ph) * st.curl), n, Math.sin(ph) * st.curl * 0.6);
        }
        for (const e of bodies) at = pushOut(at, e, lift);
        // short cuts lie on the scalp (swept stands up a little off the brow)
        const quiff = kind === 'swept' ? 0.007 * Math.max(0, 1 - q / st.seg) * Math.min(1, Math.max(0, (p[2] - hc[2]) / (head.r[2] * 0.5))) : 0;
        at = offFace(behindNeck(onHead(at, lift + quiff, hug)));
        // a lock never climbs: being pushed out over the head doesn't turn it upwards
        const was = dir[1];
        dir = norm(sub(at, pts[pts.length - 1]));
        if (dir[1] > was) dir = norm([dir[0], was, dir[2]]);
        pts.push(at);
      }
    }
    // the card: a ribbon along the lock, lying flat to the head (widthways round it)
    const base = pos.length / 3;
    const u0 = rand() * 0.5;
    for (let q = 0; q < pts.length; q++) {
      const t = q / (pts.length - 1);
      const pt = pts[q];
      const along = norm(q < pts.length - 1 ? sub(pts[q + 1], pt) : sub(pt, pts[q - 1]));
      // shaded as a head of hair: round the crown, and round a column below it where it hangs
      const out = norm(sub(pt, st.tie && q > 5 ? add(pt, [0, 0, 0.1]) : [hc[0], Math.min(pt[1], hc[1]), hc[2]]));
      const wd = norm(cross(along, out));
      const w = st.w * (st.tie === 'braids' && q > 5 ? 1 - 0.3 * t : 1 - 0.55 * t);
      // light it as the outside of a head of hair, not as a flat card
      const ln = out;
      // follow the head; the long ends follow the chest as they fall past the neck
      const k = Math.min(1, Math.max(0, (neckY - 0.02 - pt[1]) / 0.12));
      for (const sd of [-0.5, 0.5]) {
        pos.push(pt[0] + wd[0] * w * sd, pt[1] + wd[1] * w * sd, pt[2] + wd[2] * w * sd);
        nrm.push(ln[0], ln[1], ln[2]);
        uvs.push(u0 + (sd + 0.5) * 0.5, t);
        sI.push(B.neck, B.chest, 0, 0);
        sW.push(1 - k, k, 0, 0);
      }
      if (q > 0) {
        const i0 = base + (q - 1) * 2;
        idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
      }
    }
  }
  const nv = pos.length / 3;
  return {
    name: 'hairCards', mat: 'hairCard', color,
    position: new Float32Array(pos), normal: new Float32Array(nrm), ao: new Float32Array(nv).fill(1),
    index: new Uint32Array(idx), skinIndex: new Uint16Array(sI), skinWeight: new Float32Array(sW), uv: new Float32Array(uvs),
  };
}
