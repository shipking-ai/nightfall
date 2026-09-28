import * as THREE from 'three';

/**
 * Anatomy — the shapes people are made of.
 *
 * Everything here is generated once, at load, and shared by every figure:
 * a sculpted head with face shapes as morph targets (so every person gets
 * their own face from one draw call), eyes, brows, facial hair that follows
 * the same face shapes, hair and hats that read as real silhouettes, hands
 * in a few grips, shoes, and garment pieces that change a body's outline.
 *
 * Units: metres. Head geometry is in head space: origin at the neck joint,
 * face towards +z. Other parts hang from their joint along -y.
 */

/* ─────────────────────────── a small mesh builder ─────────────────────────── */

export class MeshBuilder {
  pos: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  morphs: number[][] = [];

  constructor(public morphCount = 0) {
    for (let i = 0; i < morphCount; i++) this.morphs.push([]);
  }

  get count() {
    return this.pos.length / 3;
  }

  vert(p: THREE.Vector3, c: THREE.Color | null = null, deltas: THREE.Vector3[] | null = null) {
    this.pos.push(p.x, p.y, p.z);
    this.col.push(c ? c.r : 1, c ? c.g : 1, c ? c.b : 1);
    for (let m = 0; m < this.morphCount; m++) {
      const d = deltas?.[m];
      this.morphs[m].push(d ? d.x : 0, d ? d.y : 0, d ? d.z : 0);
    }
    return this.count - 1;
  }

  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number) {
    this.idx.push(a, b, c, a, c, d);
  }

  /** Append another builder's triangles (same morph count). */
  add(o: MeshBuilder) {
    const off = this.count;
    this.pos.push(...o.pos);
    this.col.push(...o.col);
    for (let m = 0; m < this.morphCount; m++) this.morphs[m].push(...(o.morphs[m] ?? new Array(o.pos.length).fill(0)));
    for (const i of o.idx) this.idx.push(i + off);
  }

  /** Append a plain three.js geometry (no morphs), optionally tinted. */
  addGeometry(g: THREE.BufferGeometry, tint: THREE.Color | null = null) {
    const src = g.index ? g : g;
    const p = src.attributes.position as THREE.BufferAttribute;
    const off = this.count;
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.col.push(tint ? tint.r : 1, tint ? tint.g : 1, tint ? tint.b : 1);
      for (let m = 0; m < this.morphCount; m++) this.morphs[m].push(0, 0, 0);
    }
    if (src.index) for (let i = 0; i < src.index.count; i++) this.idx.push(src.index.getX(i) + off);
    else for (let i = 0; i < p.count; i++) this.idx.push(i + off);
  }

  build(opts: { colors?: boolean } = {}): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    if (opts.colors) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    if (this.morphCount) {
      const base = g.attributes.normal as THREE.BufferAttribute;
      const mp: THREE.Float32BufferAttribute[] = [];
      const mn: THREE.Float32BufferAttribute[] = [];
      for (let m = 0; m < this.morphCount; m++) {
        const d = this.morphs[m];
        mp.push(new THREE.Float32BufferAttribute(d, 3));
        // the morphed shape's own normals, stored relative to the base's
        const moved = new THREE.BufferGeometry();
        moved.setAttribute('position', new THREE.Float32BufferAttribute(this.pos.map((v, i) => v + d[i]), 3));
        moved.setIndex(this.idx);
        moved.computeVertexNormals();
        const nn = moved.attributes.normal as THREE.BufferAttribute;
        const dn = new Float32Array(nn.count * 3);
        for (let i = 0; i < nn.count; i++) {
          dn[i * 3] = nn.getX(i) - base.getX(i);
          dn[i * 3 + 1] = nn.getY(i) - base.getY(i);
          dn[i * 3 + 2] = nn.getZ(i) - base.getZ(i);
        }
        mn.push(new THREE.Float32BufferAttribute(dn, 3));
        moved.dispose();
      }
      g.morphAttributes.position = mp;
      g.morphAttributes.normal = mn;
      g.morphTargetsRelative = true;
    }
    g.computeBoundingSphere();
    return g;
  }
}

/** Any three.js geometry → an indexed position/normal geometry (for merging and mirroring). */
function plain(g: THREE.BufferGeometry): MeshBuilder {
  const b = new MeshBuilder();
  b.addGeometry(g);
  return b;
}

/** Merge plain geometries (positions + normals, recomputed smooth per piece). */
export function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const b = new MeshBuilder();
  for (const g of geos) b.addGeometry(g);
  const out = b.build();
  // keep each piece's own normals (recomputing across unrelated pieces is fine: they share no vertices)
  return out;
}

/** Mirror a geometry across x (left from right), keeping faces outward. */
export function mirrorX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const b = plain(g);
  for (let i = 0; i < b.pos.length; i += 3) b.pos[i] = -b.pos[i];
  for (let i = 0; i < b.idx.length; i += 3) {
    const t = b.idx[i + 1];
    b.idx[i + 1] = b.idx[i + 2];
    b.idx[i + 2] = t;
  }
  return b.build();
}

/* ─────────────────────────── maths ─────────────────────────── */

const sstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const g1 = (d: number, s: number) => Math.exp(-(d * d) / (2 * s * s));
const g2 = (dx: number, dy: number, sx: number, sy: number) => Math.exp(-(dx * dx) / (2 * sx * sx) - (dy * dy) / (2 * sy * sy));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function hash3(x: number, y: number, z: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
/** Smooth value noise in [-1, 1]. */
export function noise3(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  let v = 0;
  for (let dz = 0; dz < 2; dz++)
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const w = (dx ? ux : 1 - ux) * (dy ? uy : 1 - uy) * (dz ? uz : 1 - uz);
        v += w * hash3(ix + dx, iy + dy, iz + dz);
      }
  return v * 2 - 1;
}

/* ─────────────────────────── the head ─────────────────────────── */

/** Half extents of the skull (width, height, depth) and where its centre sits above the neck joint. */
export const HEAD = { w: 0.075, h: 0.118, d: 0.101, cy: 0.128 };

/**
 * Face shapes, as morph targets. Every person carries a weight for each
 * (FigureBatch sets them per instance), so faces are genuinely different
 * people rather than one face under different hair.
 */
export const FACE_SHAPES = [
  'jawWide', 'chinNarrow', 'chinLong', 'noseLong', 'noseWide', 'noseHook', 'browHeavy',
  'cheeksFull', 'gaunt', 'lipsFull', 'foreheadSlope', 'aged', 'faceRound', 'earsOut',
] as const;
export type FaceShape = (typeof FACE_SHAPES)[number];
const NF = FACE_SHAPES.length;

/** The sculpted surface of the head for a unit direction from its centre. */
function headPoint(sx: number, sy: number, sz: number, out: THREE.Vector3) {
  let x = sx * HEAD.w, y = sy * HEAD.h, z = sz * HEAD.d;
  const front = sstep(0.15, 0.7, sz);
  // the back of the skull is fuller; the crown a little narrower than the temples
  if (sz < 0) z *= 1.07;
  x *= 1 + 0.05 * sstep(-0.1, 0.35, sy) * (1 - sstep(0.55, 1, sy));
  // lower face narrows to the chin (the front more than the back)
  const low = sstep(-0.12, -0.95, sy);
  x *= 1 - 0.34 * low * (0.55 + 0.45 * Math.max(0, sz));
  // under the jaw the head tucks into the neck
  const under = sstep(-0.45, -1, sy) * sstep(0.35, -0.5, sz);
  z = lerp(z, z * 0.45, under);
  y += 0.018 * under;
  // a flatter face plane
  if (sz > 0.3) z -= (z - 0.3 * HEAD.d) * 0.18 * sstep(0.3, 0.95, sz);
  // temples
  x *= 1 - 0.04 * g2(Math.abs(sx) - 0.85, sy - 0.32, 0.2, 0.18);
  // eye sockets
  for (const s of [-1, 1]) z -= 0.0085 * g2(sx - s * 0.36, (sy - 0.12) * 1.25, 0.13, 0.13) * front;
  // brow ridge
  z += 0.0055 * g1(sy - 0.29, 0.07) * (1 - sstep(0.45, 0.85, Math.abs(sx))) * front;
  // nose: bridge to tip, widening at the wings
  const t = (0.22 - sy) / 0.43;
  if (t > -0.3 && t < 1.35) {
    const hgt = t < 1 ? 0.004 + 0.019 * Math.pow(Math.max(0, t), 1.4) : 0.023 * (1 - sstep(1, 1.35, t));
    const sig = 0.06 + 0.07 * Math.max(0, Math.min(1, t));
    z += hgt * g1(sx, sig) * front * sstep(-0.3, 0.05, t);
  }
  for (const s of [-1, 1]) z += 0.005 * g2(sx - s * 0.12, sy + 0.19, 0.06, 0.05) * front; // nostril wings
  // cheekbones
  for (const s of [-1, 1]) {
    const c = g2(sx - s * 0.56, sy - 0.0, 0.16, 0.12);
    z += 0.004 * c * front;
    x += s * 0.003 * c;
  }
  // lips: upper, lower, and the line between
  const lw = 1 - sstep(0.2, 0.36, Math.abs(sx));
  z += (0.0048 * g1(sy + 0.405, 0.035) + 0.0058 * g1(sy + 0.48, 0.04) - 0.0028 * g1(sy + 0.44, 0.012)) * lw * front;
  // chin
  z += 0.008 * g2(sx, sy + 0.8, 0.17, 0.12) * front;
  // jaw corners
  for (const s of [-1, 1]) x += s * 0.004 * g2(Math.abs(sx) - 0.8, sy + 0.58, 0.18, 0.12) * sstep(-0.2, 0.3, sz);
  return out.set(x, y + HEAD.cy, z);
}

/** How each face shape moves a point on the head (relative to the base). */
function faceDelta(k: FaceShape, sx: number, sy: number, sz: number, p: THREE.Vector3, out: THREE.Vector3) {
  out.set(0, 0, 0);
  const front = sstep(0.1, 0.6, sz);
  const s = Math.sign(sx) || 1;
  const faceY = p.y - HEAD.cy;
  switch (k) {
    case 'jawWide': {
      const m = sstep(-0.2, -0.75, sy) * sstep(-0.4, 0.3, sz) * sstep(0.15, 0.6, Math.abs(sx));
      out.x = s * 0.011 * m;
      break;
    }
    case 'chinNarrow': {
      const m = sstep(-0.35, -1, sy) * front;
      out.x = -p.x * 0.3 * m;
      out.z = 0.004 * g2(sx, sy + 0.8, 0.2, 0.15) * front;
      break;
    }
    case 'chinLong': {
      const m = sstep(-0.35, -1, sy) * sstep(-0.3, 0.3, sz);
      out.y = -0.013 * m;
      break;
    }
    case 'noseLong': {
      const t = (0.22 - sy) / 0.43;
      const m = t > 0 && t < 1.3 ? Math.pow(Math.min(1, t), 1.2) * (1 - sstep(1, 1.3, t)) : 0;
      out.z = 0.011 * m * g1(sx, 0.1) * front;
      out.y = -0.004 * m * g1(sx, 0.1) * front;
      break;
    }
    case 'noseWide': {
      const m = g2(Math.abs(sx) - 0.1, sy + 0.12, 0.08, 0.14) * front;
      out.x = s * 0.006 * m;
      out.z = 0.002 * m;
      break;
    }
    case 'noseHook':
      out.z = 0.007 * g2(sx, sy - 0.02, 0.06, 0.08) * front;
      break;
    case 'browHeavy': {
      const m = g1(sy - 0.27, 0.08) * (1 - sstep(0.5, 0.9, Math.abs(sx))) * front;
      out.z = 0.0065 * m;
      out.y = -0.003 * m;
      break;
    }
    case 'cheeksFull': {
      const m = g2(Math.abs(sx) - 0.62, sy + 0.3, 0.2, 0.2);
      out.x = s * 0.009 * m;
      out.z = 0.004 * m * front;
      out.y = -0.002 * m;
      break;
    }
    case 'gaunt': {
      const m = g2(Math.abs(sx) - 0.6, sy + 0.22, 0.14, 0.14);
      out.x = -s * 0.007 * m;
      out.z = -0.003 * m * front;
      break;
    }
    case 'lipsFull': {
      const lw = 1 - sstep(0.18, 0.38, Math.abs(sx));
      out.z = 0.0045 * (g1(sy + 0.405, 0.04) + g1(sy + 0.48, 0.045)) * lw * front;
      break;
    }
    case 'foreheadSlope':
      out.z = -0.011 * sstep(0.3, 0.95, sy) * front;
      break;
    case 'aged': {
      // softer jowls, a longer lower face, hollows under the eyes
      const j = g2(Math.abs(sx) - 0.62, sy + 0.55, 0.16, 0.14);
      out.y = -0.005 * j;
      out.x = s * 0.003 * j;
      for (const e of [-1, 1]) out.z -= 0.002 * g2(sx - e * 0.36, sy + 0.02, 0.1, 0.05) * front;
      out.z += 0.0015 * g1(Math.abs(sx) - 0.25, 0.05) * g1(sy + 0.3, 0.12) * front;
      break;
    }
    case 'faceRound': {
      const m = g1(faceY / HEAD.h + 0.2, 0.35) * sstep(-0.4, 0.2, sz);
      out.x = s * 0.006 * m * sstep(0.2, 0.8, Math.abs(sx));
      break;
    }
    case 'earsOut':
      break; // ears only (see buildEar)
  }
  return out;
}

const SKIN_TONE = {
  lips: new THREE.Color(0.86, 0.62, 0.6),
  cheek: new THREE.Color(1.0, 0.93, 0.9),
  socket: new THREE.Color(0.82, 0.78, 0.78),
  ear: new THREE.Color(0.97, 0.88, 0.86),
  nostril: new THREE.Color(0.62, 0.52, 0.5),
};

/** Vertex tint on the face: lips, flush on the cheeks, shadow in the sockets. */
function faceTint(sx: number, sy: number, sz: number, out: THREE.Color) {
  out.setRGB(1, 1, 1);
  const front = sstep(0.2, 0.75, sz);
  const lw = 1 - sstep(0.16, 0.34, Math.abs(sx));
  const lip = Math.max(g1(sy + 0.405, 0.03), g1(sy + 0.48, 0.035)) * lw * front;
  out.lerp(SKIN_TONE.lips, Math.min(1, lip * 1.15));
  const cheek = g2(Math.abs(sx) - 0.52, sy + 0.1, 0.18, 0.15) * front;
  out.multiply(new THREE.Color().setRGB(1, 1, 1).lerp(SKIN_TONE.cheek, cheek));
  let sock = 0;
  for (const s of [-1, 1]) sock += g2(sx - s * 0.36, (sy - 0.14) * 1.2, 0.12, 0.1);
  out.multiply(new THREE.Color().setRGB(1, 1, 1).lerp(SKIN_TONE.socket, Math.min(1, sock) * front));
  let nos = 0;
  for (const s of [-1, 1]) nos += g2(sx - s * 0.08, sy + 0.23, 0.035, 0.025);
  out.multiply(new THREE.Color().setRGB(1, 1, 1).lerp(SKIN_TONE.nostril, Math.min(1, nos) * front));
  return out;
}

const LAT = 30, LON = 40;

/** Grid over the head's sphere of directions (poles top and bottom, wrapping around). */
function headGrid(b: MeshBuilder, pointAt: (sx: number, sy: number, sz: number, p: THREE.Vector3) => THREE.Vector3 | null, opts: { tint?: boolean; lat?: number; lon?: number } = {}) {
  const lat = opts.lat ?? LAT, lon = opts.lon ?? LON;
  const p = new THREE.Vector3(), c = new THREE.Color();
  const d = FACE_SHAPES.map(() => new THREE.Vector3());
  const ids: (number | null)[][] = [];
  for (let i = 0; i <= lat; i++) {
    const th = (i / lat) * Math.PI;
    const row: (number | null)[] = [];
    const n = i === 0 || i === lat ? 1 : lon;
    for (let j = 0; j < n; j++) {
      const ph = (j / lon) * Math.PI * 2;
      const sx = Math.sin(th) * Math.sin(ph), sy = Math.cos(th), sz = Math.sin(th) * Math.cos(ph);
      const q = pointAt(sx, sy, sz, p);
      if (!q) {
        row.push(null);
        continue;
      }
      for (let k = 0; k < NF; k++) {
        faceDelta(FACE_SHAPES[k], sx, sy, sz, q, d[k]);
        // shells (hair on the face) move with the face under them
      }
      row.push(b.vert(q, opts.tint ? faceTint(sx, sy, sz, c) : null, b.morphCount ? d : null));
    }
    ids.push(row);
  }
  for (let i = 0; i < lat; i++) {
    for (let j = 0; j < lon; j++) {
      const j1 = (j + 1) % lon;
      const a = ids[i][ids[i].length === 1 ? 0 : j], bb = ids[i][ids[i].length === 1 ? 0 : j1];
      const cc = ids[i + 1][ids[i + 1].length === 1 ? 0 : j1], dd = ids[i + 1][ids[i + 1].length === 1 ? 0 : j];
      // outward winding (lat runs top → bottom, lon runs +z → +x)
      if (i === 0) {
        if (a != null && cc != null && dd != null) b.tri(a, dd, cc);
      } else if (i === lat - 1) {
        if (a != null && bb != null && cc != null) b.tri(a, cc, bb);
      } else if (a != null && bb != null && cc != null && dd != null) b.quad(a, dd, cc, bb);
    }
  }
}

/** An ear: a flattened, cupped disc at the side of the head. */
function buildEar(b: MeshBuilder, side: -1 | 1) {
  const e = new MeshBuilder(NF);
  const seg = 14, rings = 5;
  const cx = side * HEAD.w * 0.93, cy = HEAD.cy - 0.004, cz = -0.012;
  const ids: number[][] = [];
  const earIdx = FACE_SHAPES.indexOf('earsOut');
  const c = SKIN_TONE.ear;
  for (let r = 0; r <= rings; r++) {
    const rr = r / rings;
    const row: number[] = [];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      // taller than wide, the lobe at the bottom a little fuller
      const hy = 0.031 * (Math.sin(a) < 0 ? 0.95 : 1.05), hz = 0.017;
      const y = Math.sin(a) * hy * rr, z = Math.cos(a) * hz * rr;
      // cupped: the rim stands out, the bowl sinks towards the head
      const out = 0.004 + 0.007 * rr * rr - 0.004 * (1 - rr);
      const p = new THREE.Vector3(cx + side * out, cy + y, cz + z - 0.004 * rr);
      const deltas = FACE_SHAPES.map(() => new THREE.Vector3());
      deltas[earIdx].set(side * 0.009 * rr, 0.001 * rr, -0.004 * rr);
      row.push(e.vert(p, c, deltas));
    }
    ids.push(row);
  }
  for (let r = 0; r < rings; r++)
    for (let j = 0; j < seg; j++) {
      const j1 = (j + 1) % seg;
      if (side < 0) e.quad(ids[r][j], ids[r + 1][j], ids[r + 1][j1], ids[r][j1]);
      else e.quad(ids[r][j], ids[r][j1], ids[r + 1][j1], ids[r + 1][j]);
    }
  // the back of the ear (so it isn't paper-thin from behind)
  const back = ids[rings];
  const ctr = e.vert(new THREE.Vector3(cx - side * 0.002, cy, cz - 0.004), c, null);
  for (let j = 0; j < seg; j++) {
    const j1 = (j + 1) % seg;
    if (side < 0) e.tri(ctr, back[j1], back[j]);
    else e.tri(ctr, back[j], back[j1]);
  }
  b.add(e);
}

function buildHead(detail: boolean): THREE.BufferGeometry {
  const b = new MeshBuilder(detail ? NF : 0);
  headGrid(b, (sx, sy, sz, p) => headPoint(sx, sy, sz, p), { tint: detail, lat: detail ? LAT : 12, lon: detail ? LON : 14 });
  if (detail) {
    buildEar(b, -1);
    buildEar(b, 1);
  }
  return b.build({ colors: detail });
}

/** Where each eye sits (head space), from the sculpted socket. */
export const EYE = (() => {
  const p = new THREE.Vector3();
  const dir = new THREE.Vector3(0.36, 0.12, 0.93).normalize();
  headPoint(dir.x, dir.y, dir.z, p);
  return { x: p.x, y: p.y, z: p.z - 0.0045, r: 0.0118 };
})();

/** Eyes: the whites (a little tucked into the socket) and, separately, the irises. */
function buildEyes(): { whites: THREE.BufferGeometry; irises: THREE.BufferGeometry } {
  const w: THREE.BufferGeometry[] = [], ir: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    w.push(new THREE.SphereGeometry(EYE.r, 12, 9).scale(1.12, 0.78, 0.7).translate(s * EYE.x, EYE.y, EYE.z));
    ir.push(new THREE.CircleGeometry(EYE.r * 0.52, 12).translate(s * EYE.x, EYE.y - 0.0005, EYE.z + EYE.r * 0.7 + 0.0006));
  }
  return { whites: mergeAll(w), irises: mergeAll(ir) };
}

/** Eyebrows: a tapered strip following the brow ridge. */
function buildBrows(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const b = new MeshBuilder();
    const n = 7;
    const top: number[] = [], bot: number[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const sx = s * (0.16 + 0.42 * t);
      const sy = 0.27 + 0.03 * Math.sin(t * Math.PI) - 0.02 * t;
      const dir = new THREE.Vector3(sx, sy, Math.sqrt(Math.max(0.05, 1 - sx * sx - sy * sy)));
      const p = headPoint(dir.x, dir.y, dir.z, new THREE.Vector3());
      p.z += 0.0022;
      const thick = 0.0052 * (1 - 0.55 * t) + 0.0015;
      top.push(b.vert(p.clone().add(new THREE.Vector3(0, thick * 0.55, 0.0005))));
      bot.push(b.vert(p.clone().add(new THREE.Vector3(0, -thick * 0.45, 0.0012))));
    }
    for (let i = 0; i < n; i++) {
      if (s > 0) b.quad(bot[i], bot[i + 1], top[i + 1], top[i]);
      else b.quad(bot[i], top[i], top[i + 1], bot[i + 1]);
    }
    parts.push(b.build());
  }
  return mergeAll(parts);
}

/** A shell over part of the face (facial hair), carrying the same face shapes as the head. */
function faceShell(region: (sx: number, sy: number, sz: number) => number, thick: number): THREE.BufferGeometry {
  const b = new MeshBuilder(NF);
  const n = new THREE.Vector3();
  headGrid(
    b,
    (sx, sy, sz, p) => {
      const r = region(sx, sy, sz);
      if (r <= 0) return null;
      headPoint(sx, sy, sz, p);
      n.set(p.x, p.y - HEAD.cy, p.z).normalize();
      return p.addScaledVector(n, 0.0012 + thick * r);
    },
    { lat: 34, lon: 48 },
  );
  return b.build();
}

/** where facial hair grows: the jaw, the chin, the upper lip, sideburns — never the cheeks under the eyes */
const lipsOut = (sx: number, sy: number) => Math.abs(sx) < 0.25 && sy > -0.53 && sy < -0.37;
const jaw = (sx: number, sy: number, sz: number) => {
  if (sz < -0.35) return 0;
  const side = Math.abs(sx);
  // the line it grows up to: low at the front (under the mouth corners), up to the ear at the sides
  const line = lerp(-0.34, 0.02, sstep(0.45, 0.9, side));
  return sy < line ? sstep(line, line - 0.12, sy) : 0;
};
const FACIAL = {
  stubble: (sx: number, sy: number, sz: number) => (lipsOut(sx, sy) ? 0 : Math.max(jaw(sx, sy, sz), sz > 0.55 && sy < -0.3 && sy > -0.38 && Math.abs(sx) < 0.3 ? 1 : 0)),
  beard: (sx: number, sy: number, sz: number) => {
    if (lipsOut(sx, sy)) return 0;
    const j = jaw(sx, sy, sz);
    const m = sz > 0.55 && sy < -0.3 && sy > -0.38 && Math.abs(sx) < 0.3 ? 0.5 : 0;
    return j > 0 ? 0.3 + 0.7 * j * sstep(-0.2, -0.75, sy) + 0.2 * j : m;
  },
  moustache: (sx: number, sy: number, sz: number) => (sz > 0.55 && sy < -0.3 && sy > -0.39 && Math.abs(sx) < 0.3 ? 1 - sstep(0.18, 0.3, Math.abs(sx)) * 0.6 : 0),
  goatee: (sx: number, sy: number, sz: number) => {
    const m = sz > 0.55 && sy < -0.3 && sy > -0.39 && Math.abs(sx) < 0.28;
    const c = sz > 0.35 && sy < -0.54 && Math.abs(sx) < 0.24;
    return m || c ? 1 : 0;
  },
};

/** Glasses: two frames, a bridge, arms to the ears. */
function buildGlasses(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    parts.push(new THREE.TorusGeometry(0.0165, 0.0017, 5, 16).scale(1.18, 0.82, 1).translate(s * EYE.x, EYE.y - 0.001, EYE.z + EYE.r + 0.006));
    parts.push(new THREE.BoxGeometry(0.0026, 0.0026, 0.085).translate(s * (HEAD.w * 0.96), EYE.y + 0.003, EYE.z - 0.036));
  }
  parts.push(new THREE.BoxGeometry(EYE.x * 2 - 0.036, 0.0026, 0.003).translate(0, EYE.y + 0.004, EYE.z + EYE.r + 0.007));
  return mergeAll(parts);
}

/* ─────────────────────────── hair and hats ─────────────────────────── */

/** Skull without the face (hair sits on this). */
function skull(sx: number, sy: number, sz: number, out: THREE.Vector3) {
  let x = sx * HEAD.w, z = sz * HEAD.d;
  const y = sy * HEAD.h;
  if (sz < 0) z *= 1.07;
  x *= 1 + 0.05 * sstep(-0.1, 0.35, sy) * (1 - sstep(0.55, 1, sy));
  if (sz > 0.3) z -= (z - 0.3 * HEAD.d) * 0.18 * sstep(0.3, 0.95, sz);
  return out.set(x, y + HEAD.cy, z);
}

/** Where hair grows: above a hairline across the forehead, over the ears' tops, down to the nape. */
function scalp(sx: number, sy: number, sz: number, hairline = 0.42, nape = -0.42): number {
  // the hairline: high at the front, dipping over the temples, low at the back
  const sideness = Math.abs(sx);
  const line = sz > 0 ? lerp(hairline + 0.04 * g1(sx, 0.2), -0.02, sstep(0.4, 0.95, sideness) * (1 - sstep(0.55, 0.9, sz))) : lerp(0.0, nape, sstep(0.0, -0.8, sz));
  // keep clear of the ears
  const ear = g2(sideness - 0.95, sy - 0.0, 0.14, 0.2) * sstep(0.1, -0.4, sz + 0.2);
  return sy - line - ear * 0.6;
}

type HairFn = (sx: number, sy: number, sz: number) => { t: number; on: boolean };

/** A shell of hair over the scalp: thickness in metres, feathered to nothing at its edge. */
function hairShell(fn: HairFn, opts: { lat?: number; lon?: number } = {}): MeshBuilder {
  const b = new MeshBuilder();
  const n = new THREE.Vector3();
  headGrid(
    b,
    (sx, sy, sz, p) => {
      const { t, on } = fn(sx, sy, sz);
      if (!on) return null;
      skull(sx, sy, sz, p);
      n.set(p.x, p.y - HEAD.cy, p.z).normalize();
      return p.addScaledVector(n, 0.0025 + Math.max(0, t));
    },
    { lat: opts.lat ?? 36, lon: opts.lon ?? 44 },
  );
  return b;
}

function cap(thick: (sx: number, sy: number, sz: number) => number, hairline = 0.42, nape = -0.42): MeshBuilder {
  return hairShell((sx, sy, sz) => {
    const e = scalp(sx, sy, sz, hairline, nape);
    return { on: e > -0.03, t: thick(sx, sy, sz) * sstep(-0.03, 0.14, e) };
  });
}

/** Long hair falling behind the shoulders: a curved sheet from the ears round the back. */
function longFall(len: number, width = 1): MeshBuilder {
  const b = new MeshBuilder();
  const rows = 9, cols = 16;
  const ids: number[][] = [];
  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    const y = HEAD.cy + 0.02 - v * len;
    const row: number[] = [];
    for (let c = 0; c <= cols; c++) {
      // from one side (just behind the ear) round the back to the other
      const a = lerp(-Math.PI * 0.62 * width, Math.PI * 0.62 * width, c / cols) + Math.PI;
      const flare = 1 + 0.25 * v + 0.05 * Math.sin(c * 1.7 + r);
      const rx = (HEAD.w + 0.012) * flare * (1 + 0.15 * v), rz = (HEAD.d + 0.01) * flare * (1 - 0.35 * v);
      const x = Math.sin(a) * rx, z = Math.cos(a) * rz - 0.01 - 0.02 * v * v;
      row.push(b.vert(new THREE.Vector3(x, y - 0.012 * Math.cos(a - Math.PI) * v, z)));
    }
    ids.push(row);
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) b.quad(ids[r][c], ids[r][c + 1], ids[r + 1][c + 1], ids[r + 1][c]);
  // double-sided: add a back face slightly inside
  const back = new MeshBuilder();
  const off = b.count;
  back.pos = b.pos.map((v, i) => (i % 3 === 1 ? v : v * 0.985));
  back.col = b.col.slice();
  back.idx = [];
  for (let i = 0; i < b.idx.length; i += 3) back.idx.push(b.idx[i], b.idx[i + 2], b.idx[i + 1]);
  void off;
  b.add(back);
  return b;
}

function capsuleAt(r: number, len: number, p: THREE.Vector3, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return new THREE.CapsuleGeometry(r, len, 4, 10).scale(sx, sy, sz).rotateX(rx).rotateY(ry).rotateZ(rz).translate(p.x, p.y, p.z);
}

function buildHair(): Record<string, THREE.BufferGeometry> {
  const out: Record<string, THREE.BufferGeometry> = {};
  const fin = (b: MeshBuilder) => b.build();
  const top = (sy: number) => sstep(0.1, 0.9, sy);

  out.buzz = fin(cap(() => 0.0022, 0.44, -0.4));
  out.short = fin(cap((sx, sy, sz) => 0.007 + 0.009 * top(sy) + 0.004 * sstep(0.5, 0.95, sz) * top(sy) + 0.0035 * noise3(sx * 11, sy * 11, sz * 11), 0.43, -0.4));
  // side parting, volume swept over from the left
  out.swept = fin(
    cap((sx, sy, sz) => 0.007 + 0.011 * top(sy) * (0.7 + 0.3 * sstep(-0.6, 0.6, -sx)) + 0.008 * g2(sx - 0.1, sy - 0.62, 0.35, 0.18) * sstep(0.3, 0.9, sz), 0.4, -0.38),
  );
  out.messy = fin(
    cap((sx, sy, sz) => 0.01 + 0.008 * top(sy) + 0.009 * Math.max(0, noise3(sx * 7, sy * 7, sz * 7)) + 0.004 * noise3(sx * 17, sy * 17, sz * 17), 0.38, -0.44),
  );
  // tight curls, big and round: the silhouette alone says who this is
  out.curly = fin(
    hairShell((sx, sy, sz) => {
      const e = scalp(sx, sy, sz, 0.36, -0.5);
      const bumps = 0.006 * noise3(sx * 16, sy * 16, sz * 16) + 0.004 * noise3(sx * 31 + 3, sy * 31, sz * 31);
      return { on: e > -0.05, t: (0.028 + 0.012 * top(sy) + bumps) * sstep(-0.05, 0.2, e) };
    }),
  );
  // long: a cap with a fall to the shoulder blades and strands framing the face
  {
    const b = cap((sx, sy) => 0.007 + 0.006 * top(sy), 0.41, -0.3);
    b.add(longFall(0.3));
    const frame = new MeshBuilder();
    for (const s of [-1, 1]) frame.addGeometry(capsuleAt(0.012, 0.13, new THREE.Vector3(s * (HEAD.w + 0.006), HEAD.cy - 0.06, 0.035), 0.12, 0, s * 0.08, 1, 1, 0.6));
    b.add(frame);
    out.long = fin(b);
  }
  // bob: to the jaw all round
  {
    const b = cap((sx, sy) => 0.008 + 0.006 * top(sy), 0.41, -0.3);
    b.add(longFall(0.15, 1.12));
    out.bob = fin(b);
  }
  // ponytail and bun: pulled back tight, tied
  {
    const b = cap(() => 0.005, 0.44, -0.38);
    const tail = new MeshBuilder();
    tail.addGeometry(new THREE.TorusGeometry(0.014, 0.005, 5, 10).rotateX(0.4).translate(0, HEAD.cy + 0.03, -HEAD.d - 0.012));
    tail.addGeometry(capsuleAt(0.017, 0.15, new THREE.Vector3(0, HEAD.cy - 0.06, -HEAD.d - 0.028), -0.28, 0, 0, 1, 1, 0.8));
    b.add(tail);
    out.ponytail = fin(b);
  }
  {
    const b = cap(() => 0.005, 0.44, -0.38);
    const bun = new MeshBuilder();
    bun.addGeometry(new THREE.SphereGeometry(0.036, 12, 9).scale(1.05, 0.9, 1).translate(0, HEAD.cy + 0.085, -0.07));
    b.add(bun);
    out.bun = fin(b);
  }

  // under a hat: only what shows below it
  out.u_short = fin(hairShell((sx, sy, sz) => { const e = scalp(sx, sy, sz, 0.43, -0.4); return { on: e > -0.03 && sy < 0.12, t: 0.005 * sstep(-0.03, 0.12, e) }; }));
  {
    const b = hairShell((sx, sy, sz) => { const e = scalp(sx, sy, sz, 0.41, -0.3); return { on: e > -0.03 && sy < 0.15, t: 0.006 * sstep(-0.03, 0.12, e) }; });
    b.add(longFall(0.3));
    out.u_long = fin(b);
  }
  {
    const b = hairShell((sx, sy, sz) => { const e = scalp(sx, sy, sz, 0.36, -0.5); return { on: e > -0.05 && sy < 0.2, t: (0.024 + 0.005 * noise3(sx * 16, sy * 16, sz * 16)) * sstep(-0.05, 0.2, e) }; });
    out.u_curly = fin(b);
  }
  return out;
}

/** Headwear: each one changes the outline of the head. */
function buildHats(): Record<string, THREE.BufferGeometry> {
  const out: Record<string, THREE.BufferGeometry> = {};
  const shell = (t: (sx: number, sy: number, sz: number) => number, include: (sx: number, sy: number, sz: number) => boolean) =>
    hairShell((sx, sy, sz) => ({ on: include(sx, sy, sz), t: t(sx, sy, sz) }), { lat: 26, lon: 32 });

  // hood up: loose around the head, open at the face
  {
    const b = new MeshBuilder();
    const inner = new THREE.Vector3();
    headGrid(
      b,
      (sx, sy, sz, p) => {
        if (sz > 0.62 && sy < 0.62 && sy > -0.85) return null; // the opening
        if (sy < -0.55 && sz < 0.3) return null; // under the chin, into the collar
        skull(sx, sy, sz, inner);
        const loose = 0.018 + 0.014 * sstep(0.2, -0.6, sz) + 0.01 * sstep(0.3, 1, sy);
        p.set(inner.x * (1 + loose / HEAD.w), inner.y + 0.006 + 0.01 * sstep(0.5, 1, sy), inner.z * (1 + loose / HEAD.d) - 0.006);
        // a peak at the back of the crown
        p.z -= 0.012 * g2(sy - 0.7, sz + 0.6, 0.3, 0.3);
        return p;
      },
      { lat: 22, lon: 30 },
    );
    // the rim around the face, turned out a little
    const rim = new THREE.TorusGeometry(0.083, 0.008, 6, 22, Math.PI * 1.3).rotateZ(-Math.PI * 0.15).scale(0.95, 1.1, 1).translate(0, HEAD.cy - 0.012, HEAD.d * 0.72);
    b.addGeometry(rim);
    out.hood = b.build();
  }
  // beanie: a knit dome with a turned-up band
  {
    const b = shell((sx, sy) => 0.009 + 0.01 * sstep(0.6, 1, sy) + 0.0015 * Math.sin(Math.atan2(sx, 0.001 + Math.abs(sx)) * 40), (sx, sy, sz) => sy > 0.12 - 0.08 * sstep(0, -0.8, sz));
    b.addGeometry(new THREE.TorusGeometry(1, 0.013, 6, 30).rotateX(Math.PI / 2).scale(HEAD.w + 0.012, 1, HEAD.d + 0.014).translate(0, HEAD.cy + 0.02, -0.004));
    out.beanie = b.build();
  }
  // baseball cap: a round crown and a curved brim
  {
    const b = shell(() => 0.006, (sx, sy, sz) => sy > 0.2 - 0.12 * sstep(0, -0.7, sz));
    const brim = new THREE.CylinderGeometry(0.085, 0.085, 0.006, 20, 1, false, -Math.PI * 0.45, Math.PI * 0.9).scale(1, 1, 0.95).rotateX(0.18).translate(0, HEAD.cy + 0.055, HEAD.d * 0.55);
    b.addGeometry(brim);
    b.addGeometry(new THREE.SphereGeometry(0.006, 6, 4).translate(0, HEAD.cy + HEAD.h + 0.01, -0.005));
    out.cap = b.build();
  }
  // flat cap: low, flat, forward
  {
    const b = new MeshBuilder();
    const g = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(HEAD.w + 0.016, 0.052, HEAD.d + 0.03).translate(0, HEAD.cy + 0.05, 0.012);
    b.addGeometry(g);
    b.addGeometry(new THREE.CylinderGeometry(HEAD.w + 0.015, HEAD.w + 0.015, 0.03, 20, 1, true).scale(1, 1, (HEAD.d + 0.02) / (HEAD.w + 0.015)).translate(0, HEAD.cy + 0.037, 0.004));
    b.addGeometry(new THREE.CylinderGeometry(0.07, 0.07, 0.005, 16, 1, false, -Math.PI * 0.42, Math.PI * 0.84).scale(1, 1, 0.55).rotateX(0.08).translate(0, HEAD.cy + 0.04, HEAD.d * 0.82));
    out.flatcap = b.build();
  }
  // peaked cap (police): a stiff crown, a band, a gloss visor
  {
    const b = new MeshBuilder();
    b.addGeometry(new THREE.CylinderGeometry(HEAD.w + 0.03, HEAD.w + 0.012, 0.055, 22, 1, false).scale(1, 1, (HEAD.d + 0.03) / (HEAD.w + 0.03)).translate(0, HEAD.cy + 0.075, 0));
    b.addGeometry(new THREE.CylinderGeometry(HEAD.w + 0.031, HEAD.w + 0.031, 0.006, 22).scale(1, 1, (HEAD.d + 0.031) / (HEAD.w + 0.031)).translate(0, HEAD.cy + 0.103, 0));
    b.addGeometry(new THREE.CylinderGeometry(0.074, 0.074, 0.005, 16, 1, false, -Math.PI * 0.45, Math.PI * 0.9).scale(1, 1, 0.62).rotateX(0.35).translate(0, HEAD.cy + 0.05, HEAD.d * 0.8));
    b.addGeometry(new THREE.BoxGeometry(0.022, 0.018, 0.004).translate(0, HEAD.cy + 0.075, HEAD.d + 0.012));
    out.peaked = b.build();
  }
  // trilby: a pinched crown and a full brim
  {
    const b = new MeshBuilder();
    const crown = new THREE.CylinderGeometry(HEAD.w + 0.006, HEAD.w + 0.018, 0.09, 20, 3).scale(1, 1, (HEAD.d + 0.012) / (HEAD.w + 0.012));
    const p = crown.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), x = p.getX(i), z = p.getZ(i);
      // the crease down the top and the pinch at the front
      if (y > 0.03) p.setY(i, y - 0.012 * Math.exp(-(x * x) / 0.0006) - 0.01 * Math.max(0, z / (HEAD.d + 0.01)));
    }
    crown.computeVertexNormals();
    b.addGeometry(crown.translate(0, HEAD.cy + 0.085, 0));
    b.addGeometry(new THREE.CylinderGeometry(0.135, 0.135, 0.005, 26).scale(1, 1, 1.1).translate(0, HEAD.cy + 0.045, 0.002));
    b.addGeometry(new THREE.CylinderGeometry(HEAD.w + 0.019, HEAD.w + 0.019, 0.014, 20, 1, true).scale(1, 1, (HEAD.d + 0.013) / (HEAD.w + 0.012)).translate(0, HEAD.cy + 0.053, 0));
    out.trilby = b.build();
  }
  return out;
}

/* ─────────────────────────── body ─────────────────────────── */

/** Morph targets on the torso: the same trunk becomes different builds. */
export const TORSO_SHAPES = ['bust', 'belly', 'broad', 'slim'] as const;

/**
 * The trunk from the waist (chest joint) to the base of the neck, with a
 * rounded-rectangle section (a chest, not a tube). y 0 → 0.45.
 */
function buildTorso(): THREE.BufferGeometry {
  const NT = TORSO_SHAPES.length;
  const b = new MeshBuilder(NT);
  // [y, half-width, half-depth, front bias]
  const prof: [number, number, number, number][] = [
    [-0.01, 0.0, 0.0, 0],
    [0.0, 0.128, 0.088, 0],
    [0.06, 0.124, 0.086, 0.002],
    [0.14, 0.136, 0.092, 0.004],
    [0.22, 0.152, 0.1, 0.008],
    [0.29, 0.163, 0.104, 0.01],
    [0.345, 0.172, 0.098, 0.008],
    [0.385, 0.168, 0.086, 0.004],
    [0.415, 0.14, 0.07, 0.0],
    [0.44, 0.085, 0.055, 0.0],
    [0.455, 0.0, 0.0, 0],
  ];
  const seg = 24;
  const ids: number[][] = [];
  const pw = 2.2; // squareness of the section
  for (let r = 0; r < prof.length; r++) {
    const [y, hw, hd, fb] = prof[r];
    const row: number[] = [];
    const n = hw === 0 ? 1 : seg;
    for (let j = 0; j < n; j++) {
      const a = (j / seg) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const x = Math.sign(s) * Math.pow(Math.abs(s), 2 / pw) * hw;
      let z = Math.sign(c) * Math.pow(Math.abs(c), 2 / pw) * hd + fb * Math.max(0, c);
      // a shallow spine groove at the back, shoulder blades either side
      if (c < -0.8) z += 0.004 * (1 - Math.abs(s) * 6 > 0 ? 1 - Math.abs(s) * 6 : 0);
      const p = new THREE.Vector3(x, y, z);
      const d = TORSO_SHAPES.map(() => new THREE.Vector3());
      const front = Math.max(0, c);
      // bust: two soft forms on the upper chest
      d[0].z = 0.03 * front * g1(y - 0.285, 0.05) * (g1(x - 0.07, 0.045) + g1(x + 0.07, 0.045));
      d[0].y = -0.006 * front * g1(y - 0.285, 0.05) * (g1(x - 0.07, 0.05) + g1(x + 0.07, 0.05));
      // belly: the front of the lower trunk
      d[1].z = 0.045 * front * front * g1(y - 0.1, 0.075);
      d[1].x = 0.012 * Math.sign(x) * g1(y - 0.1, 0.08) * Math.abs(s);
      // broad: a wider, deeper chest and shoulders
      d[2].x = 0.022 * Math.sign(x) * sstep(0.12, 0.34, y) * Math.abs(s) * (1 - sstep(0.4, 0.45, y));
      d[2].z = 0.01 * Math.sign(c) * sstep(0.15, 0.3, y) * (1 - sstep(0.38, 0.45, y));
      // slim: a narrower waist
      d[3].x = -0.018 * Math.sign(x) * g1(y - 0.07, 0.08) * Math.abs(s);
      d[3].z = -0.008 * Math.sign(c) * g1(y - 0.07, 0.08);
      row.push(b.vert(p, null, d));
    }
    ids.push(row);
  }
  for (let r = 0; r < prof.length - 1; r++) {
    const A = ids[r], B = ids[r + 1];
    for (let j = 0; j < seg; j++) {
      const j1 = (j + 1) % seg;
      if (A.length === 1) b.tri(A[0], B[j1], B[j]);
      else if (B.length === 1) b.tri(A[j], A[j1], B[0]);
      else b.quad(A[j], A[j1], B[j1], B[j]);
    }
  }
  // deltoids and the trapezius slope into the neck
  const extras = new MeshBuilder(NT);
  for (const s of [-1, 1]) extras.addGeometry(new THREE.SphereGeometry(0.052, 12, 8).scale(1.05, 1.15, 1.0).translate(s * 0.158, 0.35, 0));
  extras.addGeometry(new THREE.SphereGeometry(0.07, 12, 8).scale(1.6, 0.45, 0.75).translate(0, 0.41, -0.014));
  b.add(extras);
  return b.build();
}

const lathe = (profile: [number, number][], seg = 14, depth = 0.7) => {
  const pts = profile[0][1] > profile[profile.length - 1][1] ? [...profile].reverse() : profile;
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  g.scale(1, 1, depth);
  return g;
};

/** A limb segment hanging from its joint (origin) down to -len, shaped by a radius profile. */
const limb = (profile: [number, number][], len: number, depth = 0.9, seg = 12) => {
  const pts: [number, number][] = profile.map(([f, r]) => [r, -f * len]);
  const top = pts[0][0], bot = pts[pts.length - 1][0];
  const body = lathe([[0, top * 0.55], [top * 0.8, top * 0.45], ...pts, [bot * 0.75, -len - bot * 0.5], [0, -len - bot * 0.62]], seg, depth);
  body.rotateY(Math.PI);
  return body;
};

/* ─────────────────────────── hands ─────────────────────────── */

export type Grip = 'relaxed' | 'fist' | 'point' | 'thumb' | 'open';
export const GRIPS: Grip[] = ['relaxed', 'fist', 'point', 'thumb', 'open'];

/**
 * A right hand hanging from the wrist: palm facing the body (-x), thumb
 * forward (+z), fingers down. Each finger is two segments so it can curl.
 */
function buildHand(grip: Grip): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // the palm: wide front to back, thin side to side
  parts.push(new THREE.CapsuleGeometry(0.024, 0.042, 3, 8).scale(0.55, 1, 1.15).translate(0, -0.045, 0.004));
  const fingers = [
    { z: 0.02, len: 0.034 }, // index
    { z: 0.0065, len: 0.04 },
    { z: -0.0065, len: 0.037 },
    { z: -0.019, len: 0.029 }, // little finger
  ];
  const curlOf = (i: number) => {
    switch (grip) {
      case 'fist':
      case 'thumb':
        return 1.55;
      case 'point':
        return i === 0 ? 0.08 : 1.5;
      case 'open':
        return 0.05;
      default:
        return 0.42 + i * 0.07;
    }
  };
  fingers.forEach((f, i) => {
    const curl = curlOf(i);
    const r = 0.0083 - i * 0.0005;
    // proximal: from the knuckle, bending towards the palm (-x)
    const k = new THREE.Vector3(0, -0.07, f.z);
    const seg1 = f.len * 0.55, seg2 = f.len * 0.5;
    const a1 = curl * 0.75, a2 = curl * 1.05;
    const mid = k.clone().add(new THREE.Vector3(-Math.sin(a1) * seg1, -Math.cos(a1) * seg1, 0));
    parts.push(capsuleAt(r, seg1, k.clone().lerp(mid, 0.5), 0, 0, -a1));
    const tipDir = a1 + a2;
    const tip = mid.clone().add(new THREE.Vector3(-Math.sin(tipDir) * seg2, -Math.cos(tipDir) * seg2, 0));
    parts.push(capsuleAt(r * 0.92, seg2, mid.clone().lerp(tip, 0.5), 0, 0, -tipDir));
  });
  // the thumb: across the palm in a fist, up for a thumbs-up, alongside otherwise
  const tb = new THREE.Vector3(-0.004, -0.03, 0.026);
  if (grip === 'thumb') parts.push(capsuleAt(0.0095, 0.036, tb.clone().add(new THREE.Vector3(0.002, 0.024, 0.008)), 0.25, 0, 0));
  else if (grip === 'fist') parts.push(capsuleAt(0.0095, 0.03, tb.clone().add(new THREE.Vector3(-0.012, -0.03, 0.004)), 0.9, 0, 0.9));
  else if (grip === 'open') parts.push(capsuleAt(0.0095, 0.032, tb.clone().add(new THREE.Vector3(0.0, -0.014, 0.016)), 0.75, 0, 0));
  else parts.push(capsuleAt(0.0095, 0.03, tb.clone().add(new THREE.Vector3(-0.006, -0.02, 0.01)), 0.5, 0, 0.35));
  return mergeAll(parts);
}

/* ─────────────────────────── feet ─────────────────────────── */

function buildFeet() {
  const shoe = mergeAll([
    new THREE.CapsuleGeometry(0.04, 0.16, 4, 10).rotateX(Math.PI / 2).scale(0.95, 0.8, 1).translate(0, -0.044, 0.058),
    new THREE.BoxGeometry(0.078, 0.016, 0.235).translate(0, -0.074, 0.058),
  ]);
  // a trainer: fuller toe box, a thick sole (coloured on its own)
  const sneaker = mergeAll([new THREE.CapsuleGeometry(0.044, 0.155, 4, 10).rotateX(Math.PI / 2).scale(1.0, 0.82, 1).translate(0, -0.04, 0.056)]);
  const sole = mergeAll([new THREE.CapsuleGeometry(0.043, 0.17, 3, 10).rotateX(Math.PI / 2).scale(1.04, 0.35, 1.02).translate(0, -0.071, 0.058)]);
  // a boot: a heavier foot and a shaft up the shin
  const boot = mergeAll([
    new THREE.CapsuleGeometry(0.046, 0.16, 4, 10).rotateX(Math.PI / 2).scale(1.0, 0.85, 1).translate(0, -0.042, 0.052),
    new THREE.BoxGeometry(0.086, 0.022, 0.24).translate(0, -0.075, 0.054),
  ]);
  const bootShaft = lathe([[0.052, 0.0], [0.05, -0.1], [0.047, -0.16], [0.03, -0.17]], 12, 0.95);
  return { shoe, sneaker, sole, boot, bootShaft: bootShaft.translate(0, -0.26, 0) };
}

/* ─────────────────────────── garments ─────────────────────────── */

function buildGarments() {
  const g: Record<string, THREE.BufferGeometry> = {};
  /** long coat skirt from the waist to below the knee */
  g.hem = lathe([[0.15, 0.02], [0.17, -0.12], [0.205, -0.35], [0.235, -0.62]], 16, 0.78);
  /** a jacket's skirt: to the top of the thigh, a little flared */
  g.jacketHem = lathe([[0.15, 0.03], [0.162, -0.06], [0.176, -0.17]], 16, 0.8);
  /** short skirt */
  g.skirt = lathe([[0.145, 0.02], [0.17, -0.12], [0.215, -0.4]], 16, 0.8);
  /** lapels: two folded-back flaps down the chest */
  {
    const parts: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(s * 0.055, 0.02);
      shape.lineTo(s * 0.07, 0.12);
      shape.lineTo(s * 0.045, 0.19);
      shape.lineTo(s * 0.012, 0.165);
      const geo = new THREE.ShapeGeometry(shape);
      parts.push(geo.rotateX(-0.2).translate(s * 0.012, 0.22, 0.11));
    }
    g.lapels = mergeAll(parts);
  }
  /** a tie, knot to belt */
  g.tie = mergeAll([new THREE.BoxGeometry(0.018, 0.018, 0.012).translate(0, 0.405, 0.1), new THREE.CylinderGeometry(0.004, 0.022, 0.25, 4).rotateY(Math.PI / 4).scale(1, 1, 0.35).translate(0, 0.27, 0.108)]);
  /** shirt front showing under a jacket */
  {
    const shape = new THREE.Shape();
    shape.moveTo(-0.055, 0.435);
    shape.lineTo(0.055, 0.435);
    shape.lineTo(0, 0.2);
    g.shirt = new THREE.ShapeGeometry(shape).rotateX(-0.12).translate(0, 0.03, 0.104);
  }
  /** coat / jacket collar, turned up */
  g.collar = mergeAll([
    lathe([[0.068, 0.39], [0.08, 0.43], [0.098, 0.46]], 14, 0.9).translate(0, 0, 0.004),
    new THREE.BoxGeometry(0.045, 0.14, 0.01).rotateZ(0.35).rotateX(-0.12).translate(-0.042, 0.35, 0.104),
    new THREE.BoxGeometry(0.045, 0.14, 0.01).rotateZ(-0.35).rotateX(-0.12).translate(0.042, 0.35, 0.104),
  ]);
  /** crew neck on a knit, a tee or a hoodie */
  g.crew = new THREE.TorusGeometry(0.064, 0.013, 6, 16).rotateX(Math.PI / 2).translate(0, 0.438, 0.004);
  /** a hood lying down at the back of the neck */
  g.hoodDown = new THREE.TorusGeometry(0.09, 0.034, 8, 16, Math.PI * 1.4).rotateX(Math.PI / 2).rotateY(Math.PI * 0.8).scale(1, 1, 1.15).translate(0, 0.44, -0.035);
  /** the kangaroo pocket on a hoodie */
  g.pocket = new THREE.BoxGeometry(0.2, 0.09, 0.012).translate(0, 0.08, 0.098);
  g.scarf = mergeAll([new THREE.TorusGeometry(0.066, 0.028, 8, 16).rotateX(Math.PI / 2).translate(0, 0.45, 0.005), new THREE.BoxGeometry(0.058, 0.2, 0.018).translate(0.03, 0.34, 0.1)]);
  g.bag = mergeAll([new THREE.BoxGeometry(0.07, 0.22, 0.28).translate(0.2, -0.08, 0.02), new THREE.BoxGeometry(0.02, 0.62, 0.03).rotateZ(-0.62).translate(0.03, 0.2, 0.095)]);
  /** a courier's insulated box on the back, and its straps */
  g.backpack = mergeAll([
    new THREE.BoxGeometry(0.36, 0.4, 0.28).translate(0, 0.22, -0.26),
    new THREE.BoxGeometry(0.03, 0.34, 0.015).translate(-0.09, 0.25, 0.1),
    new THREE.BoxGeometry(0.03, 0.34, 0.015).translate(0.09, 0.25, 0.1),
  ]);
  /** apron: a bib on the chest and a skirt down the front */
  g.apronTop = mergeAll([new THREE.BoxGeometry(0.2, 0.2, 0.01).translate(0, 0.25, 0.108), new THREE.TorusGeometry(0.07, 0.004, 4, 12, Math.PI).translate(0, 0.35, 0.03).rotateX(-0.3)]);
  g.apronSkirt = lathe([[0.16, 0.05], [0.18, -0.2], [0.2, -0.46]], 12, 0.82);
  {
    // keep only the front third of the apron skirt
    const p = g.apronSkirt.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) if (p.getZ(i) < 0.03) p.setZ(i, 0.03 + (p.getZ(i) - 0.03) * 0.05);
    g.apronSkirt.computeVertexNormals();
  }
  /** a stab vest: a shell over the trunk, and its reflective band */
  g.vest = lathe([[0.14, 0.04], [0.158, 0.16], [0.172, 0.3], [0.168, 0.37], [0.12, 0.41]], 16, 0.72);
  g.vestBand = lathe([[0.162, 0.22], [0.166, 0.26]], 18, 0.73);
  /** a duty belt with pouches (police) */
  g.dutyBelt = mergeAll([
    lathe([[0.146, 0.035], [0.148, 0.075]], 16, 0.76),
    ...[-1, 1].map((s) => new THREE.BoxGeometry(0.05, 0.07, 0.05).translate(s * 0.15, 0.03, 0.02)),
    new THREE.BoxGeometry(0.04, 0.05, 0.035).translate(0.05, 0.045, 0.11),
  ]);
  /** a trouser belt */
  g.belt = lathe([[0.143, 0.045], [0.144, 0.068]], 16, 0.74);
  /** a shoulder radio (police) */
  g.radio = new THREE.BoxGeometry(0.035, 0.06, 0.022).translate(-0.1, 0.36, 0.1);
  g.umbrella = mergeAll([new THREE.ConeGeometry(0.56, 0.24, 14, 1, true).translate(0, 0.94, 0), new THREE.CylinderGeometry(0.008, 0.008, 0.95, 5).translate(0, 0.46, 0)]);
  g.glow = new THREE.BoxGeometry(0.055, 0.09, 0.008);
  return g;
}

/* ─────────────────────────── the library ─────────────────────────── */

export const ANATOMY = (() => {
  const eyes = buildEyes();
  const hands: Record<string, THREE.BufferGeometry> = {};
  for (const grip of GRIPS) {
    const r = buildHand(grip);
    hands[`handR_${grip}`] = r;
    hands[`handL_${grip}`] = mirrorX(r);
  }
  const hair = buildHair();
  const hats = buildHats();
  const feet = buildFeet();
  const parts: Record<string, THREE.BufferGeometry> = {
    head: buildHead(true),
    headFar: buildHead(false),
    eyes: eyes.whites,
    irises: eyes.irises,
    brows: buildBrows(),
    fh_stubble: faceShell(FACIAL.stubble, 0.0008),
    fh_beard: faceShell(FACIAL.beard, 0.009),
    fh_moustache: faceShell(FACIAL.moustache, 0.004),
    fh_goatee: faceShell(FACIAL.goatee, 0.0055),
    glasses: buildGlasses(),
    neck: lathe([[0.048, 0.05], [0.05, 0.0], [0.056, -0.06], [0.066, -0.085]], 14, 0.95),
    torso: buildTorso(),
    pelvis: lathe([[0.0, -0.1], [0.1, -0.1], [0.138, -0.04], [0.142, 0.04], [0.134, 0.1], [0.0, 0.1]], 16, 0.72),
    upperArm: limb([[0, 0.05], [0.18, 0.053], [0.5, 0.047], [1, 0.039]], 0.28),
    forearm: limb([[0, 0.042], [0.2, 0.046], [0.6, 0.035], [1, 0.027]], 0.25),
    thigh: limb([[0, 0.09], [0.2, 0.088], [0.6, 0.07], [1, 0.053]], 0.43, 0.95),
    shin: limb([[0, 0.053], [0.25, 0.061], [0.55, 0.05], [0.9, 0.036], [1, 0.035]], 0.42, 0.95),
    ...hands,
    ...feet,
    ...buildGarments(),
  };
  for (const [k, v] of Object.entries(hair)) parts[`hair_${k}`] = v;
  for (const [k, v] of Object.entries(hats)) parts[`hat_${k}`] = v;
  return parts;
})();

export const HAIR_STYLES = ['buzz', 'short', 'swept', 'messy', 'curly', 'long', 'bob', 'ponytail', 'bun'] as const;
export type HairCut = (typeof HAIR_STYLES)[number];
export const HAT_STYLES = ['hood', 'beanie', 'cap', 'flatcap', 'peaked', 'trilby'] as const;
export type HatStyle = (typeof HAT_STYLES)[number];
export type FacialHair = 'none' | 'stubble' | 'moustache' | 'goatee' | 'beard';

/** Which hair shows under a hat. */
export function underHat(cut: HairCut | 'none'): string | null {
  switch (cut) {
    case 'none':
      return null;
    case 'long':
    case 'bob':
      return 'u_long';
    case 'curly':
      return 'u_curly';
    case 'buzz':
      return null;
    default:
      return 'u_short';
  }
}
