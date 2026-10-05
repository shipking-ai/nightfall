import { Simplex, rngFor, rand3, smooth, clamp01, lerp, hashStr } from './noise';
import { makeName, type Archetype, type BiomeId } from './biomes';

/**
 * THE WORLD PLAN. Deterministic from a seed: ask it about any point on an
 * endless plane and it answers the same way every time — how high the ground
 * is, what grows there, whether there's water, which town is nearest, where
 * the road goes. Nothing here draws anything; the streamer (world/Streamer.ts)
 * turns answers into chunks around the player, and forgets them behind.
 *
 * Scale: a macro cell is 3.2 km. Every cell has one node — a city, a town, a
 * village, a ruin, a base, or just a crossroads — and roads join each node to
 * its neighbours', so the network never ends and never breaks. Climate drifts
 * over tens of kilometres (colder north, hotter south, sea to the west), so a
 * long drive crosses from rain city to farmland, forest, mountains, desert.
 *
 * District 03 (the handcrafted city every other mode plays in) sits at the
 * origin, inside Merrow, the home city. Handcrafted places always win over the
 * generator: their footprints are flat, and nothing procedural is built there.
 */

export const SEA_Y = -2.6;
export const CELL = 3200;
export const DEFAULT_SEED = 0x4e46_0317;

export type SettlementKind = 'city' | 'town' | 'village' | 'ruin' | 'military' | 'junction';

export interface Settlement {
  id: string;
  ci: number;
  cj: number;
  kind: SettlementKind;
  x: number;
  z: number;
  /** ground height of the flattened site */
  y: number;
  radius: number;
  name: string;
  archetype: Archetype | null;
  biome: BiomeId;
  seed: number;
  /** people the simulation keeps track of by name */
  residents: number;
  /** a coastal site: the sea side is left as sea */
  coastal: boolean;
  home?: boolean;
}

export interface Road {
  id: string;
  kind: 'highway' | 'road' | 'track';
  /** full width of the paved surface */
  width: number;
  /** x,z pairs */
  pts: Float64Array;
  /** surface height at each point */
  h: Float64Array;
  /** per point: 1 = on a bridge (the ground is left alone below it) */
  bridge: Uint8Array;
  a: string;
  b: string;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface Lake {
  id: string;
  x: number;
  z: number;
  r: number;
  level: number;
}

/** A place the generator must leave alone (District 03, the interiors, story locations). */
export interface Reserved {
  id: string;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** ground height inside (for the collision and the terrain around it) */
  y: number;
  /** blend distance to the natural ground outside */
  blend: number;
  /** terrain inside is dropped under the handcrafted ground (District 03 has its own) */
  hidden: boolean;
}

/** District 03 and the handcrafted edges around it: the ground planes (see world/builders/ground.ts) */
export const DISTRICT_03: Reserved = { id: 'district03', x0: -450, z0: -356, x1: 450, z1: 500, y: 0, blend: 0, hidden: true };
/** where procedural buildings may not go around District 03 (its outskirts, far bank, the rows behind the station) */
export const D03_KEEP = { x0: -472, z0: -300, x1: 472, z1: 246 };
/** the interiors are built far off the map, at x 1000–1400, z 1000 */
export const INTERIOR_BLOCK: Reserved = { id: 'interiors', x0: 960, z0: 960, x1: 1440, z1: 1040, y: 0, blend: 60, hidden: false };

export interface Climate {
  /** 0 frozen … 1 scorching */
  t: number;
  /** 0 arid … 1 soaked */
  m: number;
  /** −1 deep ocean … 1 deep inland */
  cont: number;
}

export interface Ground {
  h: number;
  biome: BiomeId;
  /** 0..1 */
  snow: number;
  sand: number;
  wet: number;
  forest: number;
  /** on a road (0..1) and which kind */
  road: number;
  roadKind: 0 | 1 | 2 | 3;
  /** in a settlement (0..1) */
  urban: number;
  water: number | null;
  t: number;
  m: number;
}

export class WorldGen {
  readonly seed: number;
  private nCont: Simplex;
  private nTemp: Simplex;
  private nMoist: Simplex;
  private nMount: Simplex;
  private nRidge: Simplex;
  private nHill: Simplex;
  private nDetail: Simplex;
  private nRiver: Simplex;
  private nRiverOn: Simplex;
  private nHome: Simplex;
  private nDune: Simplex;
  private nWarp: Simplex;
  private settlements = new Map<string, Settlement>();
  private roads = new Map<string, Road | null>();
  private lakes = new Map<string, Lake | null>();
  private nearCache = new Map<string, { s: Settlement[]; r: Road[]; l: Lake[] }>();
  private slCache = new Map<string, { s: Settlement[]; l: Lake[] }>();
  reserved: Reserved[] = [DISTRICT_03, INTERIOR_BLOCK];

  constructor(seed = DEFAULT_SEED) {
    this.seed = seed;
    let k = 1;
    const mk = () => new Simplex((seed ^ Math.imul(0x9e3779b1, k++)) >>> 0);
    this.nCont = mk();
    this.nTemp = mk();
    this.nMoist = mk();
    this.nMount = mk();
    this.nRidge = mk();
    this.nHill = mk();
    this.nDetail = mk();
    this.nRiver = mk();
    this.nRiverOn = mk();
    this.nHome = mk();
    this.nDune = mk();
    this.nWarp = mk();
  }

  /* ─────────────────────── climate and the natural ground ─────────────────────── */

  climate(x: number, z: number, out: Climate = { t: 0, m: 0, cont: 0 }): Climate {
    const d2 = x * x + (z - 260) * (z - 260);
    const home = Math.exp(-d2 / (6500 * 6500));
    const wx = x + this.nWarp.noise(x / 9000, z / 9000) * 2600;
    const wz = z + this.nWarp.noise(z / 9000 + 40, x / 9000) * 2600;
    // continents: the sea lies west, with islands; the home city is inland on a tidal river
    let c = this.nCont.fbm(wx / 26000, wz / 26000, 3) * 0.9 + 0.25;
    c -= smooth(-5000, -22000, x) * 0.95;
    c += home * 0.55;
    // colder north (−z), hotter south (+z); weather systems wander across it
    let t = 0.5 + clampN(z / 16000, -1.3, 1.3) * 0.34 + this.nTemp.fbm(wx / 12000, wz / 12000, 2) * 0.22;
    let m = 0.52 + this.nMoist.fbm(wx / 9500, wz / 9500, 3) * 0.55;
    t = lerp(t, 0.48, home);
    m = lerp(m, 0.64, home);
    out.t = t;
    out.m = m;
    out.cont = c;
    return out;
  }

  private mountainMask(x: number, z: number, land: number) {
    const d2 = x * x + (z - 260) * (z - 260);
    const nearHome = Math.exp(-d2 / (5200 * 5200));
    return smooth(0.02, 0.42, this.nMount.fbm(x / 15000, z / 15000, 2)) * land * (1 - nearHome);
  }

  /** The ground as nature left it (no towns, roads or rivers). `low` keeps only the broad shapes. */
  natural(x: number, z: number, low = false): number {
    const cl = this.climate(x, z, _cl);
    const c = cl.cont;
    const land = smooth(-0.1, 0.1, c);
    const inland = clamp01((c - 0.08) * 1.6);
    let h = lerp(-42, 3.5 + inland * 70, land);
    const mm = this.mountainMask(x, z, land);
    if (mm > 0.001) {
      const r = this.nRidge.ridged(x / 4300, z / 4300, low ? 2 : 5);
      h += mm * Math.pow(r, 1.55) * 860;
    }
    const d2 = x * x + (z - 260) * (z - 260);
    const tame = 1 - 0.75 * Math.exp(-d2 / (3200 * 3200));
    h += this.nHill.fbm(x / 1600, z / 1600, low ? 2 : 4) * 30 * land * tame;
    if (!low) {
      h += this.nDetail.fbm(x / 170, z / 170, 3) * 2.2 * land;
      // dunes where it's hot and dry
      const dry = smooth(0.66, 0.8, cl.t) * smooth(0.5, 0.35, cl.m) * land;
      if (dry > 0.01) h += dry * (this.nDune.ridged(x / 130 + z / 400, z / 80, 2) * 4 + this.nDune.fbm(x / 700, z / 700, 2) * 6);
    }
    return h;
  }

  /* ─────────────────────── settlements ─────────────────────── */

  /** The node of macro cell (ci, cj): a place, or a crossroads. */
  settlement(ci: number, cj: number): Settlement {
    const key = `${ci},${cj}`;
    const hit = this.settlements.get(key);
    if (hit) return hit;
    const s = this.makeSettlement(ci, cj);
    this.settlements.set(key, s);
    return s;
  }

  private makeSettlement(ci: number, cj: number): Settlement {
    if (ci === 0 && cj === 0) {
      return {
        id: 'merrow', ci, cj, kind: 'city', x: 0, z: 260, y: 0, radius: 1900, name: 'Merrow', archetype: 'megacity', biome: 'temperate',
        seed: hashStr('merrow'), residents: 420, coastal: false, home: true,
      };
    }
    const r = rngFor(ci, cj, this.seed);
    // look at a few spots in the cell and settle on the kindest ground
    let best = { x: 0, z: 0, h: 0, score: -1e9, sea: false };
    const nearHomeCell = Math.abs(ci) <= 1 && Math.abs(cj) <= 1;
    for (let k = 0; k < 7; k++) {
      let x = (ci + 0.5 + r.range(-0.32, 0.32)) * CELL, z = (cj + 0.5 + r.range(-0.32, 0.32)) * CELL;
      if (nearHomeCell) {
        // out past Merrow's edge
        const dx = x, dz = z - 260, d = Math.hypot(dx, dz) || 1;
        if (d < 2750) {
          x = (dx / d) * 2750;
          z = 260 + (dz / d) * 2750;
        }
      }
      const h = this.natural(x, z);
      const slope = Math.abs(this.natural(x + 70, z) - h) + Math.abs(this.natural(x, z + 70) - h);
      const seaNear = this.natural(x + 500, z) < SEA_Y || this.natural(x - 500, z) < SEA_Y || this.natural(x, z + 500) < SEA_Y || this.natural(x, z - 500) < SEA_Y;
      const score = (h < SEA_Y + 1.5 ? -500 : 0) - slope * 2.2 - Math.max(0, h - 260) * 0.25 + (seaNear ? 18 : 0) + r.range(0, 6);
      if (score > best.score) best = { x, z, h, score, sea: seaNear };
    }
    const cl = this.climate(best.x, best.z);
    const biome = this.biomeFor(best.h, cl, 0);
    const nearHome = Math.abs(ci) <= 1 && Math.abs(cj) <= 1;
    let kind: SettlementKind = 'junction';
    const roll = r.next();
    const dry = best.h < SEA_Y + 1.5;
    if (!dry) {
      if (roll < (nearHome ? 0 : 0.2)) kind = 'city';
      else if (roll < 0.5) kind = 'town';
      else if (roll < 0.77) kind = 'village';
      else if (roll < 0.83) kind = 'ruin';
      else if (roll < 0.87 && !nearHome) kind = 'military';
    }
    // guarantee a first town either side of home along the river
    if ((ci === 1 && cj === 0) || (ci === -1 && cj === 0)) kind = 'town';
    const alpine = biome === 'alpine' || best.h > 320;
    let archetype: Archetype | null = null;
    if (kind === 'city' || kind === 'town' || kind === 'village' || kind === 'ruin') {
      if (biome === 'desert' || biome === 'scrub') archetype = r.chance(0.75) ? 'desert' : 'industrial';
      else if (biome === 'tundra' || biome === 'boreal') archetype = r.chance(0.6) ? 'frozen' : 'mountain';
      else if (alpine) archetype = 'mountain';
      else if (best.sea || biome === 'coast') archetype = r.chance(0.5) ? 'coastal' : 'port';
      else if (biome === 'swamp') archetype = r.chance(0.5) ? 'industrial' : 'historic';
      else archetype = r.pick(['historic', 'industrial', 'suburban', 'financial', 'megacity', 'historic'] as const) as Archetype;
      if (kind !== 'city' && archetype === 'megacity') archetype = 'historic';
      if (kind !== 'city' && archetype === 'financial') archetype = 'suburban';
    }
    const climateName = archetype === 'desert' ? 'desert' : archetype === 'frozen' ? 'north' : 'plain';
    const name = kind === 'junction' ? `Crossroads ${ci},${cj}` : kind === 'military' ? `Camp ${r.pick(['Orrin', 'Halloway', 'Sable', 'Kettering', 'Voss', 'Arden'])}` : makeName(r, climateName);
    const radius0 = kind === 'city' ? (archetype === 'financial' || archetype === 'megacity' ? r.range(950, 1250) : r.range(700, 1000)) : kind === 'town' ? r.range(300, 420) : kind === 'village' ? r.range(110, 170) : kind === 'military' ? 260 : kind === 'ruin' ? r.range(140, 220) : 0;
    // never into a neighbour: every place stays inside its own cell (so two can never overlap), and clear of Merrow
    const dEdge = Math.max(300, Math.min(best.x - ci * CELL, (ci + 1) * CELL - best.x, best.z - cj * CELL, (cj + 1) * CELL - best.z));
    const gapHome = Math.hypot(best.x, best.z - 260) - 1900 - 150;
    const radius = Math.max(0, Math.min(radius0, dEdge, gapHome));
    const residents = kind === 'city' ? 360 : kind === 'town' ? 90 : kind === 'village' ? 26 : kind === 'military' ? 30 : 0;
    return {
      id: `s${ci}_${cj}`, ci, cj, kind, x: best.x, z: best.z, y: Math.max(best.h, SEA_Y + 2.4), radius, name, archetype, biome,
      seed: rngFor(ci, cj, this.seed + 7).next() * 1e9, residents, coastal: best.sea,
    };
  }

  /** Settlements (not crossroads) whose macro cell is within `rad` cells of (x, z). */
  settlementsNear(x: number, z: number, rad = 1): Settlement[] {
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    const out: Settlement[] = [];
    for (let i = ci - rad; i <= ci + rad; i++) for (let j = cj - rad; j <= cj + rad; j++) {
      const s = this.settlement(i, j);
      if (s.kind !== 'junction') out.push(s);
    }
    return out;
  }

  /* ─────────────────────── lakes ─────────────────────── */

  lake(ci: number, cj: number): Lake | null {
    const key = `${ci},${cj}`;
    if (this.lakes.has(key)) return this.lakes.get(key)!;
    let lk: Lake | null = null;
    const r = rngFor(ci, cj, this.seed + 101);
    if (r.chance(0.34) && !(Math.abs(ci) <= 0 && Math.abs(cj) <= 0)) {
      const s = this.settlement(ci, cj);
      let best: { x: number; z: number; h: number } | null = null;
      for (let k = 0; k < 6; k++) {
        const x = (ci + 0.5 + r.range(-0.36, 0.36)) * CELL, z = (cj + 0.5 + r.range(-0.36, 0.36)) * CELL;
        const h = this.natural(x, z);
        if (h < SEA_Y + 3) continue;
        if (!best || h < best.h) best = { x, z, h };
      }
      const rad = r.range(170, 520);
      if (best && Math.hypot(best.x - s.x, best.z - s.z) > s.radius + rad + 250 && Math.hypot(best.x, best.z - 260) > 1900 + rad + 300) lk = { id: `l${ci}_${cj}`, x: best.x, z: best.z, r: rad, level: best.h + 0.6 };
    }
    this.lakes.set(key, lk);
    return lk;
  }

  /* ─────────────────────── roads ─────────────────────── */

  /** The road leaving cell (ci,cj)'s node towards a neighbour: dir 0 = east, 1 = south, 2 = south-east. */
  road(ci: number, cj: number, dir: 0 | 1 | 2): Road | null {
    const key = `${ci},${cj},${dir}`;
    if (this.roads.has(key)) return this.roads.get(key)!;
    const a = this.settlement(ci, cj);
    const b = dir === 0 ? this.settlement(ci + 1, cj) : dir === 1 ? this.settlement(ci, cj + 1) : this.settlement(ci + 1, cj + 1);
    let road: Road | null = null;
    const r = rngFor(ci, cj, this.seed + 211 + dir);
    const want = dir < 2 ? true : r.chance(0.22) && a.kind !== 'junction' && b.kind !== 'junction';
    if (want) road = this.buildRoad(a, b, key, r);
    this.roads.set(key, road);
    return road;
  }

  private buildRoad(a: Settlement, b: Settlement, id: string, r: ReturnType<typeof rngFor>): Road | null {
    const rank = (s: Settlement) => (s.kind === 'city' ? 3 : s.kind === 'town' || s.kind === 'military' ? 2 : s.kind === 'village' ? 1 : s.kind === 'junction' ? 1.5 : 0.5);
    const lo = Math.min(rank(a), rank(b)), hi = Math.max(rank(a), rank(b));
    const kind: Road['kind'] = lo >= 1.5 && hi >= 2 ? 'highway' : lo >= 1 ? 'road' : 'track';
    const width = kind === 'highway' ? 15 : kind === 'road' ? 9 : 5.2;
    // over the sea: no road (islands keep to themselves)
    let wet = 0;
    for (let k = 1; k < 12; k++) {
      const t = k / 12;
      if (this.natural(lerp(a.x, b.x, t), lerp(a.z, b.z, t), true) < SEA_Y - 1) wet++;
    }
    if (wet > 2) return null;

    // walk from a to b, feeling for the kinder ground to either side
    const STEP = 60;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(4, Math.ceil(len / STEP));
    const px: number[] = [a.x], pz: number[] = [a.z];
    let x = a.x, z = a.z;
    let prevH = this.preRoad(x, z);
    const amp = kind === 'track' ? 1.4 : 1;
    for (let i = 1; i < n; i++) {
      const left = n - i;
      const dx = b.x - x, dz = b.z - z;
      const dl = Math.hypot(dx, dz) || 1;
      const ux = dx / dl, uz = dz / dl;
      const stepLen = dl / left;
      let bestC = 1e9, bx = x + ux * stepLen, bz = z + uz * stepLen, bh = prevH;
      // never step further sideways than forward: the candidate offsets run to
      // ±92 m on a track against a 60 m step, which let the polyline fold back
      // on itself and knot the ribbon over itself
      const spread = Math.min(22 * amp, stepLen * 0.7);
      for (let k = -3; k <= 3; k++) {
        const off = k * spread;
        const cx = x + ux * stepLen - uz * off, cz = z + uz * stepLen + ux * off;
        const h = this.preRoad(cx, cz);
        const wetC = h < SEA_Y + 0.5 ? 600 : 0;
        // turning back on the last stretch is expensive: the road has to arrive
        // where it was asked to arrive
        const toGoal = Math.hypot(b.x - cx, b.z - cz);
        const cost = Math.abs(h - prevH) * 3 + Math.abs(off) * 0.35 + wetC + toGoal * 0.05 + (i < 3 || left < 3 ? Math.abs(off) : 0);
        if (cost < bestC) {
          bestC = cost;
          bx = cx;
          bz = cz;
          bh = h;
        }
      }
      // a slow deterministic meander so it doesn't read as a ruler line
      const wob = Math.sin(i * 0.35 + r.range(0, 6.28)) * 6 * amp;
      bx += -uz * wob;
      bz += ux * wob;
      // and it must not fold the path either
      {
        const nx = bx - x, nz = bz - z;
        const nl = Math.hypot(nx, nz) || 1;
        if (nl > stepLen * 1.6) {
          bx = x + (nx / nl) * stepLen * 1.6;
          bz = z + (nz / nl) * stepLen * 1.6;
        }
      }
      px.push(bx);
      pz.push(bz);
      x = bx;
      z = bz;
      prevH = bh;
    }
    px.push(b.x);
    pz.push(b.z);
    // round the corners (Chaikin, twice), keeping the ends
    let X = px, Z = pz;
    for (let it = 0; it < 2; it++) {
      const nx: number[] = [X[0]], nz: number[] = [Z[0]];
      for (let i = 0; i < X.length - 1; i++) {
        nx.push(X[i] * 0.75 + X[i + 1] * 0.25, X[i] * 0.25 + X[i + 1] * 0.75);
        nz.push(Z[i] * 0.75 + Z[i + 1] * 0.25, Z[i] * 0.25 + Z[i + 1] * 0.75);
      }
      nx.push(X[X.length - 1]);
      nz.push(Z[Z.length - 1]);
      X = nx;
      Z = nz;
    }
    const m = X.length;
    const pts = new Float64Array(m * 2);
    const raw = new Float64Array(m);
    const bridge = new Uint8Array(m);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < m; i++) {
      pts[i * 2] = X[i];
      pts[i * 2 + 1] = Z[i];
      raw[i] = this.preRoad(X[i], Z[i]);
      x0 = Math.min(x0, X[i]);
      z0 = Math.min(z0, Z[i]);
      x1 = Math.max(x1, X[i]);
      z1 = Math.max(z1, Z[i]);
    }
    // the profile: smoothed, then held to a drivable grade
    const h = new Float64Array(m);
    const W = 4;
    for (let i = 0; i < m; i++) {
      let s = 0, c = 0;
      for (let k = -W; k <= W; k++) {
        const j = Math.min(m - 1, Math.max(0, i + k));
        const w = 1 + W - Math.abs(k);
        s += raw[j] * w;
        c += w;
      }
      h[i] = s / c;
    }
    h[0] = raw[0];
    h[m - 1] = raw[m - 1];
    const grade = kind === 'track' ? 0.14 : kind === 'road' ? 0.1 : 0.075;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < m; i++) {
        const ds = Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
        h[i] = Math.min(h[i - 1] + grade * ds, Math.max(h[i - 1] - grade * ds, h[i]));
      }
      for (let i = m - 2; i >= 0; i--) {
        const ds = Math.hypot(pts[i * 2 + 2] - pts[i * 2], pts[i * 2 + 3] - pts[i * 2 + 1]);
        h[i] = Math.min(h[i + 1] + grade * ds, Math.max(h[i + 1] - grade * ds, h[i]));
      }
    }
    // over water and across real valleys: bridges, never below the water's reach. A dip the road
    // simply crosses gets an embankment (the ground is built up to it), not a viaduct over a field.
    const overWater = new Uint8Array(m);
    for (let i = 0; i < m; i++) {
      const xx = pts[i * 2], zz = pts[i * 2 + 1];
      const r = this.riverAt(xx, zz);
      // riverAt answers "is there a river near here" out to half + 40 m, for
      // carving banks and riverbanks. Only the channel itself (d < half) means
      // this point is over water — testing `r` alone turned every road running
      // alongside a river into a kilometre of viaduct over dry fields.
      const river = r && r.d < r.half ? r : null;
      const lk = this.lakeAt(xx, zz);
      if (river || lk || raw[i] < SEA_Y + 0.6) {
        const surf = river ? river.surface : lk ? lk.level : SEA_Y;
        h[i] = Math.max(h[i], surf + 5.5);
        bridge[i] = 1;
        overWater[i] = 1;
      } else if (raw[i] < h[i] - 30) bridge[i] = 1;
    }
    // (a short run of bridge over dry ground is filled in instead)
    for (let i = 0; i < m; ) {
      if (!bridge[i]) {
        i++;
        continue;
      }
      let j = i;
      let anyWet = false;
      for (; j < m && bridge[j]; j++) if (overWater[j]) anyWet = true;
      if (!anyWet && j - i < 4) for (let k = i; k < j; k++) bridge[k] = 0;
      i = j;
    }
    // smooth ramps onto the bridges
    for (let pass = 0; pass < 3; pass++) for (let i = 1; i < m - 1; i++) if (bridge[i]) {
      for (const j of [i - 1, i + 1]) if (!bridge[j] && h[j] < h[i] - 1.5) h[j] = Math.max(h[j], h[i] - 1.5);
    }
    // The bbox has to cover the widest thing this road does to the ground: the
    // embankment blend reaches half + 4 + 26 + 90 ≈ half + 120, so padding by
    // 60 truncated it and left a hard crease in the terrain beside every road.
    const pad = width + 150;
    return { id, kind, width, pts, h, bridge, a: a.id, b: b.id, x0: x0 - pad, z0: z0 - pad, x1: x1 + pad, z1: z1 + pad };
  }

  /** Every road that might pass near (x, z). */
  roadsNear(x: number, z: number): Road[] {
    return this.near(x, z).r;
  }

  /** Settlements and lakes of the 3×3 macro cells around (x, z) (no roads: roads are built from these). */
  private nearSL(x: number, z: number) {
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    const key = `${ci},${cj}`;
    let n = this.slCache.get(key);
    if (n) return n;
    const s: Settlement[] = [];
    const ls: Lake[] = [];
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
      s.push(this.settlement(i, j));
      const l = this.lake(i, j);
      if (l) ls.push(l);
    }
    n = { s, l: ls };
    if (this.slCache.size > 64) this.slCache.delete(this.slCache.keys().next().value!);
    this.slCache.set(key, n);
    return n;
  }

  private near(x: number, z: number) {
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    const key = `${ci},${cj}`;
    let n = this.nearCache.get(key);
    if (n) return n;
    const sl = this.nearSL(x, z);
    const rs: Road[] = [];
    const cx0 = ci * CELL, cz0 = cj * CELL, cx1 = cx0 + CELL, cz1 = cz0 + CELL;
    for (let i = ci - 2; i <= ci + 1; i++) for (let j = cj - 2; j <= cj + 1; j++) {
      for (const d of [0, 1, 2] as const) {
        const rd = this.road(i, j, d);
        if (rd && rd.x1 > cx0 && rd.x0 < cx1 && rd.z1 > cz0 && rd.z0 < cz1) rs.push(rd);
      }
    }
    n = { s: sl.s, r: rs, l: sl.l };
    if (this.nearCache.size > 64) this.nearCache.delete(this.nearCache.keys().next().value!);
    this.nearCache.set(key, n);
    return n;
  }

  /* ─────────────────────── water ─────────────────────── */

  /** The river through (x, z), if any: its surface height and how far from its middle. */
  riverAt(x: number, z: number): { surface: number; d: number; half: number; home: boolean } | null {
    // the home river: through District 03 at z ≈ 182, then away across the country
    const ax = Math.abs(x);
    const ramp = smooth(650, 5200, ax);
    const zc = 182 + ramp * 1500 * this.nHome.fbm(x / 7000, 3.3, 2);
    const zc2 = 182 + ramp * 1500 * this.nHome.fbm((x + 4) / 7000, 3.3, 2);
    const slope = (zc2 - zc) / 4;
    const dHome = Math.abs(z - zc) / Math.sqrt(1 + slope * slope);
    const halfHome = 18 + ramp * 16;
    if (dHome < halfHome + 40) {
      const low = ramp > 0.001 ? this.natural(x, zc, true) : 0;
      const surface = Math.max(SEA_Y, lerp(SEA_Y, low - 3, smooth(900, 3000, ax)));
      return { surface, d: dHome, half: halfHome, home: true };
    }
    // rivers elsewhere: the zero lines of a slow noise field, on land, out of the peaks
    const s = 1 / 8200;
    const f = this.nRiver.noise(x * s, z * s);
    if (Math.abs(f) > 0.08) return null;
    const gx = (this.nRiver.noise((x + 8) * s, z * s) - f) / 8;
    const gz = (this.nRiver.noise(x * s, (z + 8) * s) - f) / 8;
    const g = Math.hypot(gx, gz) || 1e-9;
    const d = Math.abs(f) / g;
    const on = this.nRiverOn.noise(x / 22000, z / 22000);
    if (on < -0.25) return null;
    const half = 10 + clamp01(on + 0.25) * 14;
    if (d > half + 40) return null;
    // follow the river's middle back and ask how high the land is there
    const cx = x - (f * gx) / (g * g), cz = z - (f * gz) / (g * g);
    const cl = this.climate(cx, cz, _cl2);
    if (cl.cont < -0.05) return null;
    const land = smooth(-0.1, 0.1, cl.cont);
    if (this.mountainMask(cx, cz, land) > 0.35) return null;
    const lowH = this.natural(cx, cz, true);
    const surface = Math.max(SEA_Y, lowH - 2.4);
    return { surface, d, half, home: false };
  }

  lakeAt(x: number, z: number): Lake | null {
    for (const l of this.nearSL(x, z).l) {
      const d = Math.hypot(x - l.x, z - l.z);
      if (d < l.r) return l;
    }
    return null;
  }

  /* ─────────────────────── the ground, everything included ─────────────────────── */

  /** Ground height before roads and rivers: nature, flattened under towns, basins for lakes. */
  preRoad(x: number, z: number): number {
    let h = this.natural(x, z);
    const n = this.nearSL(x, z);
    for (const s of n.s) {
      if (s.kind === 'junction') continue;
      const d = Math.hypot(x - s.x, z - s.z);
      const R = s.radius;
      if (d > R + 380) continue;
      if (s.coastal && h < SEA_Y - 0.5 && !s.home) continue;
      const k = 1 - smooth(R * 0.9, R + 380, d);
      h = lerp(h, s.y, k);
    }
    for (const l of n.l) {
      const d = Math.hypot(x - l.x, z - l.z);
      if (d > l.r * 1.7) continue;
      if (d < l.r) {
        const k = d / l.r;
        h = Math.min(h, l.level - 0.4 - 7 * (1 - k * k));
      } else {
        const k = (d - l.r) / (l.r * 0.7);
        h = Math.max(h, lerp(l.level + 0.5, h, smooth(0, 1, k)));
      }
    }
    for (const rv of this.reserved) {
      if (rv.hidden) continue;
      const dx = Math.max(rv.x0 - x, 0, x - rv.x1), dz = Math.max(rv.z0 - z, 0, z - rv.z1);
      const d = Math.hypot(dx, dz);
      if (d < rv.blend) h = lerp(rv.y, h, smooth(0, rv.blend, d));
    }
    return h;
  }

  /**
   * Everything about the ground at (x, z): height (towns, roads, rivers,
   * lakes all applied), biome and the cover on it. The terrain mesh, the
   * collision, the vegetation and the NPCs all read this.
   */
  ground(x: number, z: number, out: Ground = newGround()): Ground {
    // handcrafted District 03: its own ground (the terrain hides below it)
    const d3 = DISTRICT_03;
    if (x > d3.x0 && x < d3.x1 && z > d3.z0 && z < d3.z1) {
      out.h = 0;
      out.biome = 'temperate';
      out.snow = out.sand = out.forest = 0;
      out.wet = 1;
      out.road = 1;
      out.roadKind = 3;
      out.urban = 1;
      out.water = z > 164 && z < 200 ? SEA_Y : null;
      out.t = 0.48;
      out.m = 0.64;
      return out;
    }
    let h = this.preRoad(x, z);
    // (preRoad's natural() left this point's climate in _cl)
    const clT = _cl.t, clM = _cl.m, clC = _cl.cont;
    const n = this.near(x, z);
    // urban: how deep into a settlement
    let urban = 0;
    for (const s of n.s) {
      if (s.kind === 'junction' || s.kind === 'ruin') continue;
      const d = Math.hypot(x - s.x, z - s.z);
      if (d < s.radius) urban = Math.max(urban, 1 - smooth(s.radius * 0.75, s.radius, d));
    }
    // roads: the nearest one flattens the ground under and beside it
    let road = 0, roadKind: Ground['roadKind'] = 0;
    for (const rd of n.r) {
      if (x < rd.x0 || x > rd.x1 || z < rd.z0 || z > rd.z1) continue;
      const P = rd.pts, m = P.length / 2;
      const half = rd.width / 2;
      // (an embankment is as wide as it needs to be: a high one spreads further)
      // How far the ground has to travel to meet this road. A tall embankment or
      // deep cutting spreads further, so the blend has to run out where the
      // terrain actually reaches the road height — otherwise the last sample
      // snaps back to natural height and leaves a cliff beside the road.
      const spread = (hr: number) => 26 + Math.min(90, Math.abs(hr - h) * 1.6);
      for (let i = 0; i < m - 1; i++) {
        const ax = P[i * 2], az = P[i * 2 + 1], bx = P[i * 2 + 2], bz = P[i * 2 + 3];
        const dx = bx - ax, dz = bz - az;
        const l2 = dx * dx + dz * dz;
        let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = ax + dx * t - x, cz = az + dz * t - z;
        const d = Math.sqrt(cx * cx + cz * cz);
        const onBridge = rd.bridge[i] && rd.bridge[i + 1];
        const hr = rd.h[i] + (rd.h[i + 1] - rd.h[i]) * t;
        // cheap reject, now that the reach depends on the height difference
        if (d > half + 4 + spread(hr)) continue;
        const bank = half + 4 + spread(hr);
        if (d > bank) continue;
        const w = 1 - smooth(half + 1.2, bank, d);
        // Every road that reaches this point contributes its own carve. Gating on
        // a running best weight let whichever road was enumerated first win
        // outright, so at a crossing the second road got no embankment and no
        // road flag at all — and trees grew in the carriageway.
        if (!onBridge || d > half + 3) {
          // embankment: the ground meets the road's edge just below its surface, and is sunk well
          // under the carriageway itself (so it can't show through between its samples)
          h = lerp(h, hr - (d < half + 0.4 ? 0.55 : 0.12), onBridge ? 0 : w);
        }
        if (!onBridge) {
          // The painted skirt on the terrain has to stop at the ribbon's own
          // edge. It used to reach 1.5 m past it, on a 4 m sample grid, which
          // left a stair-stepped band of asphalt hugging a road that was
          // narrower than the band — the "road" read as much wider than it is.
          if (d < half - 0.1) {
            road = 1;
            roadKind = rd.kind === 'highway' ? 3 : rd.kind === 'road' ? 2 : 1;
          } else if (d < half + 0.5) road = Math.max(road, 0.5);
        }
      }
    }
    // rivers cut their channel through whatever's there
    let water: number | null = null;
    const rv = this.riverAt(x, z);
    if (rv) {
      const { surface, d, half } = rv;
      const bed = surface - 3.2;
      if (d < half) {
        const k = d / half;
        h = Math.min(h, bed + 2.4 * k * k);
        water = surface;
      } else {
        const k = smooth(half, half + 34, d);
        h = Math.min(h, lerp(surface + 0.9, Math.max(h, surface + 0.9), k));
        if (h < surface) water = surface;
      }
    }
    const lk = this.lakeAt(x, z);
    if (lk && h < lk.level) water = lk.level;
    if (h < SEA_Y) water = water == null ? SEA_Y : Math.max(water, SEA_Y);

    // the cover
    const cl = _cl3;
    cl.t = clT;
    cl.m = clM;
    cl.cont = clC;
    const alt = Math.max(0, h);
    const t = cl.t - alt / 1500 * 0.34 + this.nDetail.noise(x / 90, z / 90) * 0.03;
    const m = cl.m + this.nDetail.noise(z / 120, x / 120) * 0.04;
    const biome = this.biomeFor(h, cl, alt, t, m);
    const snow = clamp01((0.24 - t) * 7) + (alt > 520 ? clamp01((alt - 520) / 120) : 0);
    const beach = h < SEA_Y + 2.6 && h > SEA_Y - 3 ? 1 - smooth(SEA_Y + 1.2, SEA_Y + 2.8, h) : 0;
    const sand = Math.max(beach * (rv || lk ? 0.4 : 1), biome === 'desert' ? 1 : biome === 'scrub' ? 0.25 : 0);
    const forest = biome === 'forest' || biome === 'boreal' || biome === 'swamp' ? clamp01(0.6 + this.nHill.noise(x / 420, z / 420) * 0.8) : biome === 'temperate' ? clamp01(this.nHill.noise(x / 300, z / 300) * 1.2 - 0.3) : 0;
    out.h = h;
    out.biome = biome;
    out.snow = clamp01(snow);
    out.sand = sand;
    out.wet = biome === 'swamp' ? 0.8 : m > 0.7 ? 0.4 : 0.1;
    out.forest = forest * (1 - urban) * (road > 0 ? 0 : 1);
    out.road = road;
    out.roadKind = roadKind;
    out.urban = urban;
    out.water = water;
    out.t = t;
    out.m = m;
    return out;
  }

  /** Just the height (collision, physics). */
  height(x: number, z: number): number {
    return this.ground(x, z, _g).h;
  }

  biomeFor(h: number, cl: Climate, alt = Math.max(0, h), t = cl.t - alt / 1500 * 0.34, m = cl.m): BiomeId {
    if (h < SEA_Y - 1.5) return 'ocean';
    if (h < SEA_Y + 2.2 && cl.cont < 0.2) return 'coast';
    if (alt > 360) return 'alpine';
    if (t < 0.17) return 'tundra';
    if (t < 0.33) return 'boreal';
    if (t > 0.7 && m < 0.46) return 'desert';
    if (t > 0.6 && m < 0.52) return 'scrub';
    if (t > 0.54 && m > 0.74 && alt < 45) return 'swamp';
    if (m > 0.58) return 'forest';
    return 'temperate';
  }

  /** The settlement you're in, or the nearest one within `max` metres. */
  placeAt(x: number, z: number, max = 0): Settlement | null {
    let best: Settlement | null = null, bd = Infinity;
    for (const s of this.nearSL(x, z).s) {
      if (s.kind === 'junction') continue;
      const d = Math.hypot(x - s.x, z - s.z) - s.radius;
      if (d < max && d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  /** A rough random for anything that wants to be the same at the same spot. */
  spot(x: number, z: number, salt: number) {
    return rand3(Math.floor(x), Math.floor(z), this.seed + salt);
  }
}

export const newGround = (): Ground => ({ h: 0, biome: 'temperate', snow: 0, sand: 0, wet: 0, forest: 0, road: 0, roadKind: 0, urban: 0, water: null, t: 0.5, m: 0.5 });
const _cl: Climate = { t: 0, m: 0, cont: 0 };
const _cl2: Climate = { t: 0, m: 0, cont: 0 };
const _cl3: Climate = { t: 0, m: 0, cont: 0 };
const _g = newGround();

function clampN(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}
