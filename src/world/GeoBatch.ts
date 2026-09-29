import * as THREE from 'three';

const CHUNK = 72;
const tmpColor = new THREE.Color();

/** A template geometry, prepared once: non-indexed arrays and its middle. */
interface Src {
  pos: Float32Array;
  nrm: Float32Array;
  uv: Float32Array;
  count: number;
  center: THREE.Vector3;
}
const sources = new WeakMap<THREE.BufferGeometry, Src>();
function source(geo: THREE.BufferGeometry): Src {
  let s = sources.get(geo);
  if (s) return s;
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (!g.attributes.normal) g.computeVertexNormals();
  const count = g.attributes.position.count;
  const read = (name: string, size: number) => {
    const a = g.attributes[name] as THREE.BufferAttribute | undefined;
    const out = new Float32Array(count * size);
    if (!a) return out;
    for (let i = 0; i < count; i++) for (let k = 0; k < size; k++) out[i * size + k] = a.getComponent(i, k);
    return out;
  };
  g.computeBoundingBox();
  s = { pos: read('position', 3), nrm: read('normal', 3), uv: read('uv', 2), count, center: g.boundingBox!.getCenter(new THREE.Vector3()) };
  sources.set(geo, s);
  g.dispose();
  return s;
}

/** A float array that grows as it's appended to. */
class Grow {
  a: Float32Array;
  n = 0;
  constructor(size = 1024) {
    this.a = new Float32Array(size);
  }
  reserve(k: number) {
    if (this.n + k <= this.a.length) return;
    let len = this.a.length * 2;
    while (len < this.n + k) len *= 2;
    const b = new Float32Array(len);
    b.set(this.a.subarray(0, this.n));
    this.a = b;
  }
  done() {
    return this.a.slice(0, this.n);
  }
}

interface Entry {
  material: THREE.Material;
  pos: Grow;
  nrm: Grow;
  uv: Grow;
  col: Grow;
  extra: Map<string, { size: number; data: Grow }>;
  cast: boolean;
  receive: boolean;
}

const _nm = new THREE.Matrix3();
const _c = new THREE.Vector3();

/**
 * Collects static geometry by material and spatial chunk, then builds it into
 * a small number of draw calls that still frustum-cull usefully. Everything is
 * appended straight into one set of arrays per batch (non-indexed, with a
 * \`color\` attribute), so anything can go in with anything that shares a
 * material, and adding a thousand small boxes costs a thousand small copies,
 * not a thousand geometries merged at the end.
 */
export class GeoBatch {
  private entries = new Map<string, Entry>();
  private extraAttrs = new Map<THREE.Material, [string, number][]>();

  /** Declare custom attributes (with their item size) a material's geometry always carries. */
  declare(material: THREE.Material, attrs: [string, number][]) {
    this.extraAttrs.set(material, attrs);
  }

  add(
    material: THREE.Material,
    geo: THREE.BufferGeometry,
    matrix?: THREE.Matrix4,
    opts: { color?: THREE.ColorRepresentation; cast?: boolean; receive?: boolean; attrs?: Record<string, number[]> } = {},
  ) {
    const src = source(geo);
    const n = src.count;
    const m = matrix?.elements;
    _c.copy(src.center);
    if (matrix) _c.applyMatrix4(matrix);
    const key = `${material.uuid}|${Math.floor(_c.x / CHUNK)}|${Math.floor(_c.z / CHUNK)}|${opts.cast !== false ? 1 : 0}`;
    let e = this.entries.get(key);
    if (!e) {
      e = { material, pos: new Grow(), nrm: new Grow(), uv: new Grow(), col: new Grow(), extra: new Map(), cast: opts.cast !== false, receive: opts.receive !== false };
      for (const [name, size] of this.extraAttrs.get(material) ?? []) e.extra.set(name, { size, data: new Grow() });
      this.entries.set(key, e);
    }
    e.pos.reserve(n * 3);
    e.nrm.reserve(n * 3);
    e.uv.reserve(n * 2);
    e.col.reserve(n * 3);
    const P = e.pos.a, N = e.nrm.a, U = e.uv.a, C = e.col.a;
    let pi = e.pos.n, ni = e.nrm.n;
    const sp = src.pos, sn = src.nrm;
    if (m) {
      _nm.getNormalMatrix(matrix!);
      const q = _nm.elements;
      for (let i = 0; i < n; i++) {
        const x = sp[i * 3], y = sp[i * 3 + 1], z = sp[i * 3 + 2];
        P[pi++] = m[0] * x + m[4] * y + m[8] * z + m[12];
        P[pi++] = m[1] * x + m[5] * y + m[9] * z + m[13];
        P[pi++] = m[2] * x + m[6] * y + m[10] * z + m[14];
        const a = sn[i * 3], b = sn[i * 3 + 1], c = sn[i * 3 + 2];
        let nx = q[0] * a + q[3] * b + q[6] * c, ny = q[1] * a + q[4] * b + q[7] * c, nz = q[2] * a + q[5] * b + q[8] * c;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        N[ni++] = nx;
        N[ni++] = ny;
        N[ni++] = nz;
      }
    } else {
      P.set(sp, pi);
      N.set(sn, ni);
      pi += n * 3;
      ni += n * 3;
    }
    e.pos.n = pi;
    e.nrm.n = ni;
    U.set(src.uv, e.uv.n);
    e.uv.n += n * 2;
    tmpColor.set(opts.color ?? 0xffffff);
    let ci = e.col.n;
    for (let i = 0; i < n; i++) {
      C[ci++] = tmpColor.r;
      C[ci++] = tmpColor.g;
      C[ci++] = tmpColor.b;
    }
    e.col.n = ci;
    for (const [name, x] of e.extra) {
      const v = opts.attrs?.[name];
      x.data.reserve(n * x.size);
      const A = x.data.a;
      let k = x.data.n;
      for (let i = 0; i < n; i++) for (let c = 0; c < x.size; c++) A[k++] = v ? v[c] : 0;
      x.data.n = k;
    }
  }

  build(parent: THREE.Object3D): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const e of this.entries.values()) {
      if (!e.pos.n) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(e.pos.done(), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(e.nrm.done(), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(e.uv.done(), 2));
      g.setAttribute('color', new THREE.BufferAttribute(e.col.done(), 3));
      for (const [name, x] of e.extra) g.setAttribute(name, new THREE.BufferAttribute(x.data.done(), x.size));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const mesh = new THREE.Mesh(g, e.material);
      mesh.castShadow = e.cast;
      mesh.receiveShadow = e.receive;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
      out.push(mesh);
    }
    this.entries.clear();
    return out;
  }
}

/* small helpers for placing primitives */

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e3 = new THREE.Euler();
const v3 = new THREE.Vector3();
const s3 = new THREE.Vector3();

export function mat(x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0): THREE.Matrix4 {
  e3.set(rx, ry, rz);
  q.setFromEuler(e3);
  return new THREE.Matrix4().compose(v3.set(x, y, z), q, s3.set(sx, sy, sz));
}

export const unitBox = new THREE.BoxGeometry(1, 1, 1);
/** Box whose origin sits at its base centre. */
export const baseBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
export const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 12, 1).translate(0, 0.5, 0);
export const unitCyl6 = new THREE.CylinderGeometry(1, 1, 1, 6, 1).translate(0, 0.5, 0);
export const unitSphere = new THREE.SphereGeometry(1, 12, 8);

export { m4 };
