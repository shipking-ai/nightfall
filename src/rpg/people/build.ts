import { mesh } from './nets';
import { partsFor, boneSegments, headCentre, type HumanSpec, type Joints, type MatKind, type Fabric } from './anatomy';
import type { V3 } from './sdf';

/** One meshed, skinned part of a person, as plain arrays (transferable from the worker). */
export interface BuiltPart {
  name: string;
  mat: MatKind;
  color: number;
  fabric?: Fabric;
  position: Float32Array;
  normal: Float32Array;
  ao: Float32Array;
  index: Uint32Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
}

export interface BuiltHuman {
  parts: BuiltPart[];
  eyes: [V3, V3];
  eyeR: number;
  ms: number;
  tris: number;
}

/**
 * Mesh every part and weight it to the bones: each vertex follows the bones
 * it's nearest to, blended smoothly where two meet (an elbow, a hip, the
 * shoulder), up to four at once.
 */
export function buildHuman(spec: HumanSpec, joints: Joints, lod: number): BuiltHuman {
  const t0 = performance.now();
  const { parts, eyes, eyeR } = partsFor(spec, joints, lod);
  const segs = boneSegments(joints, headCentre(joints));
  const out: BuiltPart[] = [];
  let tris = 0;
  for (const p of parts) {
    const m = mesh(p.shape, p.min, p.max, p.cell, p.aoDist ?? 0.03);
    if (!m.index.length) continue;
    const vc = m.position.length / 3;
    const si = new Uint16Array(vc * 4), sw = new Float32Array(vc * 4);
    const d = new Float32Array(p.bones.length);
    for (let v = 0; v < vc; v++) {
      const x = m.position[v * 3], y = m.position[v * 3 + 1], z = m.position[v * 3 + 2];
      let dmin = 1e9;
      for (let b = 0; b < p.bones.length; b++) {
        const [a, c] = segs[p.bones[b]];
        const dist = segDist(x, y, z, a, c) / (p.boneBias?.[p.bones[b]] ?? 1);
        d[b] = dist;
        if (dist < dmin) dmin = dist;
      }
      // soft weights, the nearest few
      const w: [number, number][] = [];
      for (let b = 0; b < p.bones.length; b++) {
        const k = (d[b] - dmin) / 0.032;
        const wt = Math.exp(-k * k);
        if (wt > 0.01) w.push([p.bones[b], wt]);
      }
      w.sort((a, b) => b[1] - a[1]);
      let sum = 0;
      for (let i = 0; i < Math.min(4, w.length); i++) sum += w[i][1];
      for (let i = 0; i < 4; i++) {
        si[v * 4 + i] = i < w.length ? w[i][0] : 0;
        sw[v * 4 + i] = i < w.length ? w[i][1] / sum : 0;
      }
    }
    tris += m.index.length / 3;
    out.push({ name: p.name, mat: p.mat, color: p.color, fabric: p.fabric, position: m.position, normal: m.normal, ao: m.ao, index: m.index, skinIndex: si, skinWeight: sw });
  }
  return { parts: out, eyes, eyeR, ms: performance.now() - t0, tris };
}

function segDist(x: number, y: number, z: number, a: V3, b: V3) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = l2 > 0 ? ((x - a[0]) * dx + (y - a[1]) * dy + (z - a[2]) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = a[0] + dx * t - x, cy = a[1] + dy * t - y, cz = a[2] + dz * t - z;
  return Math.sqrt(cx * cx + cy * cy + cz * cz);
}
