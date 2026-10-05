import * as THREE from 'three';
import { NOISE } from '../../render/glsl';
import { worldUniforms } from '../../world/materials';
import type { Road } from './WorldGen';

/**
 * The roads between places, drawn as ribbons that follow the generator's
 * profile. Lane markings come from the shader (solid edges, a double yellow
 * down the middle of the highways, dashes between lanes), so a road is one
 * draw per chunk. Bridges get a deck, rails and piers, and register the deck
 * as something you can stand and drive on.
 */

export interface Deck {
  /** quad corners (x, z), in order */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** heights at the start and end of the segment */
  ha: number;
  hb: number;
  half: number;
}

export function createRoadMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, worldUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec3 aRoad;\nvarying vec3 vRoad;\nvarying vec3 vWPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvRoad = aRoad;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uWet;\nvarying vec3 vRoad;\nvarying vec3 vWPos;\n${NOISE}`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  float u = vRoad.x;      // 0..1 across
  float v = vRoad.y;      // metres along
  float kind = vRoad.z;   // 1 track, 2 road, 3 highway
  vec2 p = vWPos.xz;
  float n = nf_noise(p * 0.9), big = nf_fbm(p * 0.05);
  vec3 col;
  float rough;
  if (kind < 1.5) {
    // dirt track: two worn ruts, grass up the middle
    col = vec3(0.26, 0.2, 0.14) * (0.8 + 0.35 * n);
    float mid = smoothstep(0.38, 0.45, u) * smoothstep(0.62, 0.55, u);
    col = mix(col, vec3(0.12, 0.15, 0.07), mid * 0.7);
    rough = 0.95;
  } else {
    col = vec3(0.075, 0.077, 0.082) * (0.78 + 0.4 * n) * (0.85 + 0.3 * big);
    rough = 0.82;
    float w = kind > 2.5 ? 15.0 : 9.0;
    float x = u * w;
    float line = 0.0;
    // edge lines
    line += step(abs(x - 0.35), 0.08) + step(abs(x - (w - 0.35)), 0.08);
    vec3 lc = vec3(0.62, 0.61, 0.58);
    float dash = step(0.55, fract(v / 9.0));
    if (kind > 2.5) {
      // double yellow, lane dashes
      float yl = step(abs(x - w * 0.5 + 0.18), 0.07) + step(abs(x - w * 0.5 - 0.18), 0.07);
      col = mix(col, vec3(0.6, 0.45, 0.08), clamp(yl, 0.0, 1.0));
      line += (step(abs(x - w * 0.25), 0.07) + step(abs(x - w * 0.75), 0.07)) * dash;
    } else {
      line += step(abs(x - w * 0.5), 0.07) * dash;
    }
    col = mix(col, lc * (0.8 + 0.2 * n), clamp(line, 0.0, 1.0) * 0.85);
    // wear in the wheel tracks
    col *= 1.0 - 0.12 * smoothstep(0.1, 0.0, abs(fract(u * 2.0) - 0.3));
  }
  float pud = smoothstep(0.6, 0.66, big + n * 0.04) * uWet;
  col *= mix(1.0, 0.6, uWet * 0.7);
  col = mix(col, col * 0.35, pud);
  rough = mix(rough, 0.3, uWet * 0.7);
  rough = mix(rough, 0.03, pud);
  diffuseColor.rgb = col;
  roughnessFactor = rough;
}`,
      );
  };
  m.customProgramCacheKey = () => 'nf-road';
  return m;
}

/**
 * Ribbons for the parts of these roads whose segments start inside the
 * chunk, relative to (ox, oz). Returns the geometry, and bridge decks to
 * stand on and parts to build under them.
 */
export function roadGeometry(roads: Road[], x0: number, z0: number, size: number, ox: number, oz: number): { geo: THREE.BufferGeometry | null; decks: Deck[]; piers: { x: number; z: number; top: number; yaw: number; w: number }[]; rails: { ax: number; az: number; bx: number; bz: number; ha: number; hb: number }[] } {
  const pos: number[] = [], nrm: number[] = [], attr: number[] = [], idx: number[] = [];
  const decks: Deck[] = [];
  const piers: { x: number; z: number; top: number; yaw: number; w: number }[] = [];
  const rails: { ax: number; az: number; bx: number; bz: number; ha: number; hb: number }[] = [];
  for (const rd of roads) {
    if (rd.x1 < x0 || rd.x0 > x0 + size || rd.z1 < z0 || rd.z0 > z0 + size) continue;
    const P = rd.pts, m = P.length / 2;
    const half = rd.width / 2;
    const kind = rd.kind === 'highway' ? 3 : rd.kind === 'road' ? 2 : 1;
    // running length (for the dashes)
    let along = 0;
    for (let i = 0; i < m - 1; i++) {
      const ax = P[i * 2], az = P[i * 2 + 1], bx = P[i * 2 + 2], bz = P[i * 2 + 3];
      const seg = Math.hypot(bx - ax, bz - az);
      // A segment belongs to the chunk holding its midpoint, not to whichever
      // chunk its first endpoint fell in. Testing the start point alone left a
      // ~15 m hole in the carriageway at every chunk border the road crossed.
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (mx >= x0 && mx < x0 + size && mz >= z0 && mz < z0 + size) {
        // perpendiculars at both ends (averaged with the neighbouring segments, so the ribbon doesn't crack at bends)
        const perp = (k: number) => {
          const px0 = P[Math.max(0, k - 1) * 2], pz0 = P[Math.max(0, k - 1) * 2 + 1];
          const px1 = P[Math.min(m - 1, k + 1) * 2], pz1 = P[Math.min(m - 1, k + 1) * 2 + 1];
          const dx = px1 - px0, dz = pz1 - pz0, l = Math.hypot(dx, dz) || 1;
          return [-dz / l, dx / l];
        };
        const [nax, naz] = perp(i), [nbx, nbz] = perp(i + 1);
        const ha = rd.h[i] + 0.04, hb = rd.h[i + 1] + 0.04;
        const base = pos.length / 3;
        pos.push(ax - nax * half - ox, ha, az - naz * half - oz, ax + nax * half - ox, ha, az + naz * half - oz, bx - nbx * half - ox, hb, bz - nbz * half - oz, bx + nbx * half - ox, hb, bz + nbz * half - oz);
        // The surface normal from the quad's own corners, so grades and bridge
        // ramps shade like the ground they sit on. A hard (0,1,0) lit every
        // slope and every ramp as if it were flat.
        // e1 and e2 span the quad from the first corner; e1 is the across-carriageway
        // edge, which the builder keeps level, so its y is 0.
        const e1x = pos[(base + 1) * 3] - pos[base * 3];
        const e1z = pos[(base + 1) * 3 + 2] - pos[base * 3 + 2];
        const e2x = pos[(base + 2) * 3] - pos[base * 3];
        const e2y = pos[(base + 2) * 3 + 1] - pos[base * 3 + 1];
        const e2z = pos[(base + 2) * 3 + 2] - pos[base * 3 + 2];
        let nx = -e1z * e2y;
        let ny = e1z * e2x - e1x * e2z;
        let nz = e1x * e2y;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        for (let k = 0; k < 4; k++) nrm.push(nx, ny, nz);
        attr.push(0, along, kind, 1, along, kind, 0, along + seg, kind, 1, along + seg, kind);
        // wind so the face points up
        const cross = (pos[base * 3 + 3] - pos[base * 3]) * (pos[base * 3 + 8] - pos[base * 3 + 2]) - (pos[base * 3 + 5] - pos[base * 3 + 2]) * (pos[base * 3 + 6] - pos[base * 3]);
        if (cross < 0) idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
        else idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
        // the road surface is what you stand and drive on (the ground under it is sunk out of sight)
        if (!rd.bridge[i] && !rd.bridge[i + 1]) decks.push({ ax, az, bx, bz, ha: rd.h[i] + 0.04, hb: rd.h[i + 1] + 0.04, half });
        if (rd.bridge[i] || rd.bridge[i + 1]) {
          // the deck is stood on at exactly the height the ribbon is drawn at,
          // or the walkable surface sits 4 cm below the road you can see
          decks.push({ ax, az, bx, bz, ha: rd.h[i] + 0.04, hb: rd.h[i + 1] + 0.04, half });
          rails.push({ ax: ax - nax * (half + 0.4), az: az - naz * (half + 0.4), bx: bx - nbx * (half + 0.4), bz: bz - nbz * (half + 0.4), ha: rd.h[i], hb: rd.h[i + 1] });
          rails.push({ ax: ax + nax * (half + 0.4), az: az + naz * (half + 0.4), bx: bx + nbx * (half + 0.4), bz: bz + nbz * (half + 0.4), ha: rd.h[i], hb: rd.h[i + 1] });
          if (i % 2 === 0) piers.push({ x: ax, z: az, top: rd.h[i], yaw: Math.atan2(bx - ax, bz - az), w: rd.width });
        }
      }
      along += seg;
    }
  }
  if (!idx.length) return { geo: null, decks, piers, rails };
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aRoad', new THREE.Float32BufferAttribute(attr, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return { geo: g, decks, piers, rails };
}

/** Height of a deck under (x, z), or NaN. */
export function deckHeight(d: Deck, x: number, z: number): number {
  const dx = d.bx - d.ax, dz = d.bz - d.az;
  const l2 = dx * dx + dz * dz;
  if (l2 <= 0) return NaN;
  const t = ((x - d.ax) * dx + (z - d.az) * dz) / l2;
  if (t < -0.02 || t > 1.02) return NaN;
  const cx = d.ax + dx * t - x, cz = d.az + dz * t - z;
  if (cx * cx + cz * cz > d.half * d.half) return NaN;
  return d.ha + (d.hb - d.ha) * Math.min(1, Math.max(0, t));
}
