import type { Shape, V3 } from './sdf';

/**
 * Surface nets: a smooth, watertight mesh from a distance field. One vertex
 * per grid cell that the surface crosses (at the average of its edge
 * crossings), quads across every edge the surface cuts. Blocks of the grid
 * that are clearly all inside or all outside are skipped, so a body at a
 * centimetre and a face at a few millimetres take a fraction of a second.
 *
 * Normals come from the field's gradient; ambient occlusion from how much of
 * the field is close by (armpits, collars, the corners of the mouth).
 */
export interface NetMesh {
  position: Float32Array;
  normal: Float32Array;
  ao: Float32Array;
  index: Uint32Array;
}

export function mesh(shape: Shape, min: V3, max: V3, cell: number, aoDist = 0.03): NetMesh {
  const nx = Math.max(2, Math.ceil((max[0] - min[0]) / cell) + 1);
  const ny = Math.max(2, Math.ceil((max[1] - min[1]) / cell) + 1);
  const nz = Math.max(2, Math.ceil((max[2] - min[2]) / cell) + 1);
  const N = nx * ny * nz;
  const val = new Float32Array(N);
  const at = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const band = cell * 3;
  // fill the grid, a block at a time: a block far from the surface gets one value everywhere
  const B = 4;
  const half = (B * cell * Math.sqrt(3)) / 2;
  for (let bk = 0; bk < nz; bk += B) for (let bj = 0; bj < ny; bj += B) for (let bi = 0; bi < nx; bi += B) {
    const ci = Math.min(nx - 1, bi + B / 2), cj = Math.min(ny - 1, bj + B / 2), ck = Math.min(nz - 1, bk + B / 2);
    const dc = shape.eval(min[0] + ci * cell, min[1] + cj * cell, min[2] + ck * cell, half * 2 + band);
    const far = Math.abs(dc) > half * 1.6 + band;
    for (let k = bk; k < Math.min(nz, bk + B); k++) for (let j = bj; j < Math.min(ny, bj + B); j++) for (let i = bi; i < Math.min(nx, bi + B); i++) {
      val[at(i, j, k)] = far ? dc : shape.eval(min[0] + i * cell, min[1] + j * cell, min[2] + k * cell, band);
    }
  }
  // one vertex per crossed cell
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const vidx = new Int32Array(cx * cy * cz).fill(-1);
  const pos: number[] = [];
  const corner = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const cv = new Float32Array(8);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    let inside = 0;
    for (let c = 0; c < 8; c++) {
      const v = val[at(i + corner[c][0], j + corner[c][1], k + corner[c][2])];
      cv[c] = v;
      if (v < 0) inside |= 1 << c;
    }
    if (inside === 0 || inside === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      const va = cv[a], vb = cv[b];
      if (va < 0 === vb < 0) continue;
      const t = va / (va - vb);
      sx += corner[a][0] + (corner[b][0] - corner[a][0]) * t;
      sy += corner[a][1] + (corner[b][1] - corner[a][1]) * t;
      sz += corner[a][2] + (corner[b][2] - corner[a][2]) * t;
      n++;
    }
    vidx[i + cx * (j + cy * k)] = pos.length / 3;
    pos.push(min[0] + (i + sx / n) * cell, min[1] + (j + sy / n) * cell, min[2] + (k + sz / n) * cell);
  }
  // quads across crossed edges
  const idx: number[] = [];
  const cellAt = (i: number, j: number, k: number) => (i < 0 || j < 0 || k < 0 || i >= cx || j >= cy || k >= cz ? -1 : vidx[i + cx * (j + cy * k)]);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v0 = val[at(i, j, k)];
    // x edge
    if (i < nx - 1) {
      const v1 = val[at(i + 1, j, k)];
      if (v0 < 0 !== v1 < 0) quad(cellAt(i, j - 1, k - 1), cellAt(i, j, k - 1), cellAt(i, j, k), cellAt(i, j - 1, k), v0 < 0);
    }
    if (j < ny - 1) {
      const v1 = val[at(i, j + 1, k)];
      if (v0 < 0 !== v1 < 0) quad(cellAt(i - 1, j, k - 1), cellAt(i - 1, j, k), cellAt(i, j, k), cellAt(i, j, k - 1), v0 < 0);
    }
    if (k < nz - 1) {
      const v1 = val[at(i, j, k + 1)];
      if (v0 < 0 !== v1 < 0) quad(cellAt(i - 1, j - 1, k), cellAt(i, j - 1, k), cellAt(i, j, k), cellAt(i - 1, j, k), v0 < 0);
    }
  }
  function quad(a: number, b: number, c: number, d: number, flip: boolean) {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, b, c, a, c, d);
    else idx.push(a, c, b, a, d, c);
  }
  // normals from the gradient, occlusion from the field around
  const vc = pos.length / 3;
  const normal = new Float32Array(vc * 3);
  const ao = new Float32Array(vc);
  const e = cell * 0.5;
  for (let v = 0; v < vc; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    let gx = shape.eval(x + e, y, z) - shape.eval(x - e, y, z);
    let gy = shape.eval(x, y + e, z) - shape.eval(x, y - e, z);
    let gz = shape.eval(x, y, z + e) - shape.eval(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    gx /= l;
    gy /= l;
    gz /= l;
    normal[v * 3] = gx;
    normal[v * 3 + 1] = gy;
    normal[v * 3 + 2] = gz;
    // how open is it out along the normal (two steps)
    let occ = 0;
    for (const s of [0.5, 1]) {
      const d = shape.eval(x + gx * aoDist * s, y + gy * aoDist * s, z + gz * aoDist * s);
      occ += Math.max(0, aoDist * s - d) / (aoDist * s);
    }
    ao[v] = Math.max(0.25, 1 - occ * 0.5);
  }
  // fix winding against the normals (whichever way the quad came out, face outwards)
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const wx = pos[c * 3] - pos[a * 3], wy = pos[c * 3 + 1] - pos[a * 3 + 1], wz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
    const nxs = normal[a * 3] + normal[b * 3] + normal[c * 3], nys = normal[a * 3 + 1] + normal[b * 3 + 1] + normal[c * 3 + 1], nzs = normal[a * 3 + 2] + normal[b * 3 + 2] + normal[c * 3 + 2];
    if (fx * nxs + fy * nys + fz * nzs < 0) {
      idx[t + 1] = c;
      idx[t + 2] = b;
    }
  }
  return { position: new Float32Array(pos), normal, ao, index: new Uint32Array(idx) };
}
