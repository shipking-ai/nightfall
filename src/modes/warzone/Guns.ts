import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GunId } from './weapons';
import type { Rig } from '../../entities/Humanoid';

/**
 * The guns, drawn in hands: a few boxes each (receiver, barrel, stock,
 * magazine, grip, sight), instanced per model. A long gun is laid along the
 * line from the right hand (on the grip) to the left (on the foregrip), so
 * it sits where the arms say it is, at the hip or at the shoulder.
 */

type Part = [w: number, h: number, d: number, x: number, y: number, z: number, rx?: number];

const SHAPES: Record<GunId, Part[]> = {
  carbine: [
    [0.055, 0.085, 0.4, 0, 0.035, 0.1],
    [0.028, 0.028, 0.34, 0, 0.05, 0.46],
    [0.05, 0.08, 0.24, 0, 0.01, -0.2],
    [0.038, 0.15, 0.06, 0, -0.07, 0.14, 0.2],
    [0.035, 0.1, 0.045, 0, -0.05, -0.01, -0.3],
    [0.022, 0.03, 0.09, 0, 0.1, 0.06],
    [0.05, 0.05, 0.16, 0, 0.02, 0.33],
  ],
  smg: [
    [0.05, 0.08, 0.3, 0, 0.03, 0.06],
    [0.026, 0.026, 0.14, 0, 0.045, 0.28],
    [0.03, 0.03, 0.2, 0, 0.03, -0.18],
    [0.034, 0.17, 0.045, 0, -0.08, 0.1],
    [0.034, 0.1, 0.045, 0, -0.05, -0.02, -0.3],
    [0.02, 0.026, 0.06, 0, 0.085, 0.04],
  ],
  marksman: [
    [0.055, 0.085, 0.46, 0, 0.035, 0.12],
    [0.026, 0.026, 0.5, 0, 0.05, 0.6],
    [0.055, 0.1, 0.28, 0, 0.0, -0.22],
    [0.036, 0.11, 0.07, 0, -0.06, 0.16, 0.15],
    [0.035, 0.1, 0.045, 0, -0.05, -0.01, -0.3],
    [0.05, 0.05, 0.24, 0, 0.12, 0.08],
  ],
  shotgun: [
    [0.056, 0.08, 0.34, 0, 0.03, 0.05],
    [0.034, 0.034, 0.46, 0, 0.055, 0.44],
    [0.03, 0.03, 0.4, 0, 0.02, 0.4],
    [0.05, 0.05, 0.14, 0, 0.02, 0.36],
    [0.05, 0.09, 0.26, 0, 0.0, -0.22],
    [0.035, 0.1, 0.045, 0, -0.05, -0.02, -0.3],
  ],
  pistol: [
    [0.03, 0.04, 0.18, 0, 0.05, 0.05],
    [0.03, 0.1, 0.045, 0, -0.01, -0.01, -0.25],
  ],
};

const IDS = Object.keys(SHAPES) as GunId[];

/** A gun's shape, as one geometry (along +z, the grip at the origin). */
export function gunGeometry(id: GunId) {
  return build(SHAPES[id]);
}

/** Where the muzzle is on each gun, along +z. */
export const MUZZLE: Record<GunId, number> = { carbine: 0.64, smg: 0.36, marksman: 0.86, shotgun: 0.68, pistol: 0.16 };

function build(parts: Part[]) {
  return mergeGeometries(
    parts.map(([w, h, d, x, y, z, rx]) => {
      const g = new THREE.BoxGeometry(w, h, d);
      if (rx) g.rotateX(rx);
      return g.translate(x, y, z);
    }),
  )!;
}

export const GUN_MAT = new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.42, metalness: 0.55 });

export class GunMeshes {
  group = new THREE.Group();
  private meshes = new Map<GunId, THREE.InstancedMesh>();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private shown: (GunId | null)[];

  constructor(capacity: number) {
    this.shown = new Array(capacity).fill(null);
    for (const id of IDS) {
      const m = new THREE.InstancedMesh(build(SHAPES[id]), GUN_MAT, capacity);
      m.castShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < capacity; i++) m.setMatrixAt(i, this.zero);
      this.meshes.set(id, m);
      this.group.add(m);
    }
  }

  /** Put gun `id` (or nothing) in slot `i`'s hands. Returns the muzzle, in world space. */
  set(i: number, id: GunId | null, rig: Rig | null, facing: number, out?: THREE.Vector3): THREE.Vector3 | undefined {
    const prev = this.shown[i];
    if (prev && prev !== id) {
      const m = this.meshes.get(prev)!;
      m.setMatrixAt(i, this.zero);
      m.instanceMatrix.needsUpdate = true;
    }
    this.shown[i] = id;
    if (!id || !rig) return;
    const m = this.meshes.get(id)!;
    gunMatrix(rig, id, facing, _m);
    m.setMatrixAt(i, _m);
    m.instanceMatrix.needsUpdate = true;
    if (out) return out.set(0, 0.05, MUZZLE[id]).applyMatrix4(_m);
  }

  hide(i: number) {
    this.set(i, null, null, 0);
  }
}

const _m = new THREE.Matrix4();
const _r = new THREE.Vector3();
const _l = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Where a gun sits: from the right hand towards the left (a long gun), or along the right forearm's aim (a pistol). */
export function gunMatrix(rig: Rig, id: GunId, facing: number, out: THREE.Matrix4) {
  _r.setFromMatrixPosition(rig.handR);
  _l.setFromMatrixPosition(rig.handL);
  _z.subVectors(_l, _r);
  if (id === 'pistol' || _z.lengthSq() < 0.02) _z.set(Math.sin(facing), 0, Math.cos(facing));
  _z.normalize();
  _x.crossVectors(UP, _z);
  if (_x.lengthSq() < 1e-4) _x.set(1, 0, 0);
  _x.normalize();
  _y.crossVectors(_z, _x);
  out.makeBasis(_x, _y, _z).setPosition(_r);
  return out;
}
