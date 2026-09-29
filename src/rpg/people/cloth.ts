import { B, type Joints } from './anatomy';

/**
 * Loose cloth. The clothes are cut from a helper mesh that follows the body
 * closely, so on their own they read as paint: every muscle and hollow shows
 * through. Real cloth is carried by the widest parts under it and falls
 * straight between them. So:
 *
 *  - a sleeve or a trouser leg becomes a tube: each point goes out towards
 *    the widest the limb gets at that point along it (the deltoid, the calf);
 *  - round the body, each point goes out towards the widest the torso gets in
 *    that direction at that height, which bridges the hollows;
 *  - a coat or a loose shirt hangs from the chest: below it, nothing comes in
 *    closer than the chest was in that direction.
 *
 * Every move is outwards and capped, so the cloth never sinks into the body.
 */

export interface Loose {
  /** 0 (as cut) … 1 (all the way out to the widest) for sleeves and legs */
  limb: number;
  /** the same, round the torso */
  torso: number;
  /** how much of the chest's reach a coat keeps as it falls (0: none, 1: straight down) */
  hang: number;
  /** most a point may move, metres */
  cap: number;
  /** how far off the body the cloth sits (the envelope is the body's) */
  pad: number;
  /** every point is round the torso (a coat's skirt), whatever bone it follows */
  all?: boolean;
}

type Seg = [number, number, number, number, number, number];

export function loosen(X: Float32Array, n: number, bones: Int32Array, j: Joints, o: Loose, env?: TorsoEnv) {
  // ── limbs: a tube round each bone's segment
  const segs = new Map<number, Seg>();
  const seg = (b: number, a: number[], c: number[]) => segs.set(b, [a[0], a[1], a[2], c[0], c[1], c[2]]);
  seg(B.shL, j.shL, j.elL);
  seg(B.elL, j.elL, j.wrL);
  seg(B.shR, j.shR, j.elR);
  seg(B.elR, j.elR, j.wrR);
  seg(B.hipL, j.hipL, j.knL);
  seg(B.knL, j.knL, j.anL);
  seg(B.hipR, j.hipR, j.knR);
  seg(B.knR, j.knR, j.anR);
  const BINS = 12;
  const limbEnv = new Map<number, Float32Array>();
  const tOf = new Float32Array(n), rOf = new Float32Array(n);
  const ax = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const s = o.all ? undefined : segs.get(bones[v]);
    if (!s) continue;
    const dx = s[3] - s[0], dy = s[4] - s[1], dz = s[5] - s[2];
    const L2 = dx * dx + dy * dy + dz * dz || 1;
    // (the axis point is the unclamped projection, so a point just past a joint is measured straight across)
    const tRaw = ((X[v * 3] - s[0]) * dx + (X[v * 3 + 1] - s[1]) * dy + (X[v * 3 + 2] - s[2]) * dz) / L2;
    const t = Math.min(1, Math.max(0, tRaw));
    const px = s[0] + dx * tRaw, py = s[1] + dy * tRaw, pz = s[2] + dz * tRaw;
    ax[v * 3] = px;
    ax[v * 3 + 1] = py;
    ax[v * 3 + 2] = pz;
    const r = Math.hypot(X[v * 3] - px, X[v * 3 + 1] - py, X[v * 3 + 2] - pz);
    tOf[v] = t;
    rOf[v] = r;
    let e = limbEnv.get(bones[v]);
    if (!e) limbEnv.set(bones[v], (e = new Float32Array(BINS)));
    const bi = Math.min(BINS - 1, Math.floor(t * BINS));
    e[bi] = Math.max(e[bi], r);
  }
  // the envelope along each bone: a running max from the widest part (cloth falls from it), then smoothed
  for (const e of limbEnv.values()) {
    const c = e.slice();
    for (let i = 0; i < BINS; i++) e[i] = Math.max(c[i], (c[i - 1] ?? 0) * 0.94, (c[i + 1] ?? 0) * 0.94);
  }
  // legs stay apart: a trouser leg never crosses towards the other past this
  const midX = (j.hipL[0] + j.hipR[0]) / 2;
  for (let v = 0; v < n; v++) {
    const e = limbEnv.get(bones[v]);
    if (!e || rOf[v] < 1e-5) continue;
    const bi = Math.min(BINS - 1, Math.floor(tOf[v] * BINS));
    // (less at the shoulder and the hip, where the limb joins the body)
    const joinK = Math.min(1, tOf[v] / 0.2 + (bones[v] === B.elL || bones[v] === B.elR || bones[v] === B.knL || bones[v] === B.knR ? 1 : 0));
    const grow = Math.min(o.cap, Math.max(0, e[bi] - rOf[v]) * o.limb * joinK);
    if (grow <= 0) continue;
    const k = (rOf[v] + grow) / rOf[v];
    let x = ax[v * 3] + (X[v * 3] - ax[v * 3]) * k;
    const isLeg = bones[v] === B.hipL || bones[v] === B.hipR || bones[v] === B.knL || bones[v] === B.knR;
    if (isLeg) {
      const side = Math.sign(ax[v * 3] - midX) || 1;
      if ((x - midX) * side < 0.012) x = midX + side * 0.012;
    }
    X[v * 3] = x;
    X[v * 3 + 1] = ax[v * 3 + 1] + (X[v * 3 + 1] - ax[v * 3 + 1]) * k;
    X[v * 3 + 2] = ax[v * 3 + 2] + (X[v * 3 + 2] - ax[v * 3 + 2]) * k;
  }

  // ── the torso
  if (!env || (o.torso <= 0 && o.hang <= 0)) return;
  const torsoBone = (b: number) => o.all || b === B.pelvis || b === B.spine || b === B.chest;
  for (let v = 0; v < n; v++) {
    if (!torsoBone(bones[v])) continue;
    const y = X[v * 3 + 1];
    const h = env.hOf(y);
    const dx = X[v * 3] - env.cx[h], dz = X[v * 3 + 2] - env.cz[h];
    const r = Math.hypot(dx, dz);
    if (r < 1e-5) continue;
    const a = env.angBin(dx, dz);
    const e = (o.hang > 0 ? env.hung[h * AB + a] : env.E[h * AB + a]) + o.pad;
    const k = y < env.chestY ? Math.max(o.torso, o.hang) : o.torso;
    const grow = Math.min(o.cap, Math.max(0, e - r) * k);
    if (grow <= 0) continue;
    X[v * 3] = env.cx[h] + (dx * (r + grow)) / r;
    X[v * 3 + 2] = env.cz[h] + (dz * (r + grow)) / r;
  }
}

const HB = 32, AB = 24;

/** How far the torso reaches in each direction at each height (from the body), and the same hung from the chest. */
export interface TorsoEnv {
  E: Float32Array;
  hung: Float32Array;
  cx: Float32Array;
  cz: Float32Array;
  chestY: number;
  hOf: (y: number) => number;
  angBin: (dx: number, dz: number) => number;
}

export function torsoEnvelope(P: Float32Array, verts: Iterable<number>, bones: (v: number) => number, j: Joints): TorsoEnv {
  const torsoBone = (b: number) => b === B.pelvis || b === B.spine || b === B.chest;
  const y0 = j.pelvis[1] - 0.45, y1 = j.neck[1];
  const hOf = (y: number) => Math.min(HB - 1, Math.max(0, Math.floor(((y - y0) / (y1 - y0)) * HB)));
  const angBin = (dx: number, dz: number) => Math.floor(((Math.atan2(dx, dz) / (Math.PI * 2) + 1) % 1) * AB) % AB;
  const cx = new Float32Array(HB), cz = new Float32Array(HB), cn = new Float32Array(HB);
  const list: number[] = [];
  for (const v of verts) if (torsoBone(bones(v))) list.push(v);
  for (const v of list) {
    const h = hOf(P[v * 3 + 1]);
    cx[h] += P[v * 3];
    cz[h] += P[v * 3 + 2];
    cn[h]++;
  }
  // (bands with no torso in them, below the hips, take the lowest one's axis; above, the one below)
  let lastX = j.pelvis[0], lastZ = j.pelvis[2];
  for (let h = 0; h < HB; h++) if (cn[h]) {
    lastX = cx[h] / cn[h];
    lastZ = cz[h] / cn[h];
    break;
  }
  for (let h = 0; h < HB; h++) {
    if (cn[h]) {
      cx[h] /= cn[h];
      cz[h] /= cn[h];
      lastX = cx[h];
      lastZ = cz[h];
    } else {
      cx[h] = lastX;
      cz[h] = lastZ;
    }
  }
  const E = new Float32Array(HB * AB);
  for (const v of list) {
    const h = hOf(P[v * 3 + 1]);
    const dx = P[v * 3] - cx[h], dz = P[v * 3 + 2] - cz[h];
    const a = angBin(dx, dz);
    E[h * AB + a] = Math.max(E[h * AB + a], Math.hypot(dx, dz));
  }
  // smooth round each ring (a hollow between two bulges is bridged)
  for (let h = 0; h < HB; h++) {
    const c = E.slice(h * AB, h * AB + AB);
    for (let a = 0; a < AB; a++) E[h * AB + a] = Math.max(c[a], c[(a + 1) % AB] * 0.97, c[(a + AB - 1) % AB] * 0.97);
  }
  // hung from the chest: going down, each direction keeps most of the reach above it
  const chestY = j.chest[1] + 0.02;
  const hung = E.slice();
  for (let h = hOf(chestY) - 1; h >= 0; h--) for (let a = 0; a < AB; a++) hung[h * AB + a] = Math.max(hung[h * AB + a], hung[(h + 1) * AB + a] * 0.985);
  return { E, hung, cx, cz, chestY, hOf, angBin };
}
