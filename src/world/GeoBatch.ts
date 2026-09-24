import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const CHUNK = 72;
const tmpColor = new THREE.Color();

interface Entry {
  material: THREE.Material;
  geos: THREE.BufferGeometry[];
  cast: boolean;
  receive: boolean;
}

/**
 * Collects static geometry by material and spatial chunk, then merges it
 * into a small number of draw calls that still frustum-cull usefully.
 * Every geometry is normalised to non-indexed with a `color` attribute so
 * anything can be merged with anything that shares a material.
 */
export class GeoBatch {
  private entries = new Map<string, Entry>();
  private extraAttrs = new Map<THREE.Material, string[]>();

  /** Declare custom attributes (with their item size) a material's geometry always carries. */
  declare(material: THREE.Material, attrs: [string, number][]) {
    this.extraAttrs.set(material, attrs.map(([n, s]) => `${n}:${s}`));
  }

  add(
    material: THREE.Material,
    geo: THREE.BufferGeometry,
    matrix?: THREE.Matrix4,
    opts: { color?: THREE.ColorRepresentation; cast?: boolean; receive?: boolean; attrs?: Record<string, number[]> } = {},
  ) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    const count = g.attributes.position.count;

    tmpColor.set(opts.color ?? 0xffffff);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      col[i * 3] = tmpColor.r;
      col[i * 3 + 1] = tmpColor.g;
      col[i * 3 + 2] = tmpColor.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(a)) g.deleteAttribute(a);

    const declared = this.extraAttrs.get(material) ?? [];
    for (const spec of declared) {
      const [name, sizeS] = spec.split(':');
      const size = Number(sizeS);
      const v = opts.attrs?.[name] ?? new Array(size).fill(0);
      const arr = new Float32Array(count * size);
      for (let i = 0; i < count; i++) for (let k = 0; k < size; k++) arr[i * size + k] = v[k];
      g.setAttribute(name, new THREE.BufferAttribute(arr, size));
    }

    g.computeBoundingBox();
    const c = g.boundingBox!.getCenter(new THREE.Vector3());
    const key = `${material.uuid}|${Math.floor(c.x / CHUNK)}|${Math.floor(c.z / CHUNK)}|${opts.cast !== false ? 1 : 0}`;
    let e = this.entries.get(key);
    if (!e) this.entries.set(key, (e = { material, geos: [], cast: opts.cast !== false, receive: opts.receive !== false }));
    e.geos.push(g);
  }

  build(parent: THREE.Object3D): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const e of this.entries.values()) {
      const merged = mergeGeometries(e.geos, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, e.material);
      mesh.castShadow = e.cast;
      mesh.receiveShadow = e.receive;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
      out.push(mesh);
      e.geos.forEach((g) => g.dispose());
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
