import * as THREE from 'three';
import { buildRig, newRig, J, type Body, type Outfit } from '../../entities/Humanoid';
import { newPose, C } from '../../anim/pose';
import type { Joints } from './anatomy';
import type { V3 } from './sdf';

/**
 * The pose people are sculpted in: the shared rig standing in an A (arms out
 * and down, feet a little apart), at scale 1. The joints here are where the
 * mesh is built; the matrices are each bone's "bind": skinning moves every
 * vertex by (bone now) × (bone at bind)⁻¹.
 */
export const BIND_BONES = ['pelvis', 'spine', 'chest', 'neck', 'shL', 'elL', 'wrL', 'shR', 'elR', 'wrR', 'hipL', 'knL', 'anL', 'hipR', 'knR', 'anR'] as const;

const NEUTRAL_OUTFIT = { bulk: 1 } as Outfit;

/** Arm and leg angles of the bind pose (MakeHuman people are bound at their own). */
export interface BindAngles {
  shAb: number;
  elBend: number;
  hipAb: number;
}

export function bindPose(body: Body, angles: BindAngles = { shAb: 0.9, elBend: 0.08, hipAb: 0.05 }): { joints: Joints; matrices: THREE.Matrix4[] } {
  const p = newPose();
  p[C.shLab] = p[C.shRab] = angles.shAb;
  p[C.elL] = p[C.elR] = angles.elBend;
  p[C.hipLab] = p[C.hipRab] = angles.hipAb;
  const rig = newRig();
  const b: Body = { ...body, height: 1 };
  buildRig(rig, new THREE.Matrix4(), b, NEUTRAL_OUTFIT, p);
  const mats = jointMatrices([]);
  const pos = (m: THREE.Matrix4): V3 => {
    const v = new THREE.Vector3().setFromMatrixPosition(m);
    return [v.x, v.y, v.z];
  };
  const dir = (m: THREE.Matrix4, x: number, y: number, z: number): V3 => {
    const v = new THREE.Vector3(x, y, z).transformDirection(m);
    return [v.x, v.y, v.z];
  };
  const handFrame = (w: THREE.Matrix4, side: -1 | 1) => {
    const along = dir(w, 0, -1, 0);
    // palms face the body; thumbs point forward
    const a = new THREE.Vector3(...along);
    const palm = new THREE.Vector3(-side, 0, 0).addScaledVector(a, -a.x * -side).normalize();
    const thumb = new THREE.Vector3(0, 0, 1).addScaledVector(a, -a.z).normalize();
    return { along, palm: palm.toArray() as V3, thumb: thumb.toArray() as V3 };
  };
  const joints: Joints = {
    pelvis: pos(J.pelvis), chest: pos(J.chest), neck: pos(J.neck),
    shL: pos(J.shL), elL: pos(J.elL), wrL: pos(J.wrL), shR: pos(J.shR), elR: pos(J.elR), wrR: pos(J.wrR),
    hipL: pos(J.hipL), knL: pos(J.knL), anL: pos(J.anL), hipR: pos(J.hipR), knR: pos(J.knR), anR: pos(J.anR),
    handL: handFrame(J.wrL, -1), handR: handFrame(J.wrR, 1),
    headScale: b.head,
  };
  return { joints, matrices: mats };
}

/**
 * The bone matrices the skin follows, from the rig's joints (J) as last
 * solved: the rig's own joints, plus a spine bone halfway between pelvis and
 * chest so the waist bends smoothly.
 */
export function jointMatrices(out: THREE.Matrix4[]): THREE.Matrix4[] {
  const src = [J.pelvis, null, J.chest, J.neck, J.shL, J.elL, J.wrL, J.shR, J.elR, J.wrR, J.hipL, J.knL, J.anL, J.hipR, J.knR, J.anR];
  for (let i = 0; i < src.length; i++) {
    if (!out[i]) out[i] = new THREE.Matrix4();
    const s = src[i];
    if (s) out[i].copy(s);
  }
  // spine: halfway, position and rotation
  J.pelvis.decompose(_p0, _q0, _s0);
  J.chest.decompose(_p1, _q1, _s1);
  out[1].compose(_p0.lerp(_p1, 0.5), _q0.slerp(_q1, 0.5), _s0.lerp(_s1, 0.5));
  return out;
}

const _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3();
const _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion();
const _s0 = new THREE.Vector3(), _s1 = new THREE.Vector3();
