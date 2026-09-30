import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { VehicleSpec } from './specs';

/**
 * A vehicle you can believe in, built from its spec: a body lofted through
 * cross-sections (a nose that rounds off, a hood that falls to it, a
 * glasshouse that leans in toward the roof, arches over the wheels), glass
 * with pillars, lights where lights go (head, tail, indicators, reverse),
 * mirrors, handles, plates, an exhaust, wipers, an interior (dash, seats, a
 * steering wheel that turns) and doors that open. Wheels are their own
 * objects: they steer, spin and ride the suspension.
 *
 * Paint, glass and trim share one shader patch (patchVehicle) for what
 * happens to a car: dents pushed in where it hit, scratched paint round
 * them, road dirt up the sills, rain beading and running down.
 *
 * Geometry is built once per class and shared; materials are per car.
 */

export interface VehicleModel {
  root: THREE.Group;
  /** the sprung body (pitches, rolls and heaves on the suspension) */
  body: THREE.Group;
  wheels: { lx: number; lz: number; r: number; steer: THREE.Object3D; spin: THREE.Object3D; front: boolean }[];
  steeringWheel: THREE.Object3D;
  doors: { pivot: THREE.Object3D; side: 1 | -1; open: number }[];
  wipers: THREE.Object3D[];
  mats: VehicleMats;
  /** car-local lamp positions (for the light pool): headlights L/R, tails L/R */
  lampAt: { head: THREE.Vector3[]; tail: THREE.Vector3[] };
  /** what the car's surface has been through */
  wear: Wear;
  dispose(): void;
}

export interface VehicleMats {
  paint: THREE.MeshPhysicalMaterial;
  glass: THREE.MeshPhysicalMaterial;
  trim: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  interior: THREE.MeshStandardMaterial;
  head: THREE.MeshStandardMaterial;
  tail: THREE.MeshStandardMaterial;
  indL: THREE.MeshStandardMaterial;
  indR: THREE.MeshStandardMaterial;
  reverse: THREE.MeshStandardMaterial;
  beacon: THREE.MeshStandardMaterial[];
  rubber: THREE.MeshStandardMaterial;
  rim: THREE.MeshStandardMaterial;
}

/** Up to 8 dents (car-local position, depth) plus dirt and wet, fed to the shaders. */
export interface Wear {
  dents: THREE.Vector4[];
  dirt: { value: number };
  wet: { value: number };
  time: { value: number };
  glassCrack: { value: number };
}

const DENTS = 8;

/* ─────────────────────────── the shader patch ─────────────────────────── */

function patchVehicle(m: THREE.Material, wear: Wear, kind: 'paint' | 'glass' | 'trim') {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDents = { value: wear.dents };
    sh.uniforms.uDirt = wear.dirt;
    sh.uniforms.uWetV = wear.wet;
    sh.uniforms.uTimeV = wear.time;
    sh.uniforms.uCrack = wear.glassCrack;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nuniform vec4 uDents[${DENTS}];\nvarying vec3 vLoc;\nvarying float vDent;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vDent = 0.0;
for (int i = 0; i < ${DENTS}; i++) {
  vec4 d = uDents[i];
  if (d.w <= 0.0) continue;
  float R = 0.3 + 0.9 * d.w;
  float k = 1.0 - clamp(distance(transformed, d.xyz) / R, 0.0, 1.0);
  k = k * k * (3.0 - 2.0 * k);
  // pushed in along the surface's normal (crumpled, not scaled)
  transformed -= normal * k * d.w * 0.16;
  vDent = max(vDent, k * min(1.0, d.w * 2.0));
}
vLoc = transformed;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uDirt;\nuniform float uWetV;\nuniform float uTimeV;\nuniform float uCrack;\nvarying vec3 vLoc;\nvarying float vDent;\nfloat vh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(vh(i), vh(i+vec2(1,0)), f.x), mix(vh(i+vec2(0,1)), vh(i+vec2(1,1)), f.x), f.y); }`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  ${kind === 'glass' ? `
  // cracked glass: a web round the impact
  if (uCrack > 0.0) {
    float c = vn(vLoc.xz * 40.0 + vLoc.y * 30.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75), smoothstep(0.93, 0.97, c) * uCrack);
    diffuseColor.a = max(diffuseColor.a, 0.5 * uCrack);
  }` : `
  // scratches and bare metal round a dent
  float sc = vn(vec2(vLoc.x * 3.0 + vLoc.z * 60.0, vLoc.y * 90.0));
  float scratch = smoothstep(0.62, 0.9, sc) * vDent;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.55, 0.56), scratch * 0.7);
  diffuseColor.rgb *= 1.0 - vDent * 0.25;`}
  // road dirt: thickest low down and behind the wheels
  float low = 1.0 - smoothstep(0.15, 0.9, vLoc.y);
  float grime = uDirt * (low * 0.85 + 0.15) * (0.6 + 0.4 * vn(vLoc.xz * 6.0 + vLoc.y * 3.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.13, 0.1), clamp(grime, 0.0, 0.85) * ${kind === 'glass' ? '0.5' : '1.0'});
  // rain: darker, and water running down in streaks
  float streak = smoothstep(0.55, 0.85, vn(vec2(vLoc.x * 18.0 + vLoc.z * 18.0, vLoc.y * 2.0 + uTimeV * 1.4)));
  diffuseColor.rgb *= 1.0 - uWetV * (0.12 + 0.12 * streak) * ${kind === 'glass' ? '0.4' : '1.0'};
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.85, clamp(uDirt * (1.0 - smoothstep(0.15, 0.9, vLoc.y)), 0.0, 0.8));
roughnessFactor = mix(roughnessFactor, 0.06, uWetV * 0.7);
roughnessFactor = mix(roughnessFactor, 0.7, vDent * 0.5);`,
      );
  };
  m.customProgramCacheKey = () => `veh-${kind}`;
}

/* ─────────────────────────── shapes ─────────────────────────── */

const smooth = (a: number, b: number, x: number) => {
  const u = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};
const sgnPow = (v: number, p: number) => Math.sign(v) * Math.pow(Math.abs(v), p);

interface Section {
  z: number;
  hw: number;
  bot: number;
  deck: number;
  /** cabin top, or -1 where there's no cabin */
  top: number;
}

function sections(spec: VehicleSpec): Section[] {
  const s = spec.shape, m = spec.mech;
  const L = s.length, hL = L / 2, W = s.width;
  // more sections at the ends and round the arches
  const zs: number[] = [];
  const n = Math.round(24 + L * 3);
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    zs.push(-hL + L * (0.5 - 0.5 * Math.cos(Math.PI * u)));
  }
  const axles = [m.axleF, m.axleR, ...(m.extraAxles ?? [])];
  for (const a of axles) for (const d of [-1, -0.7, -0.35, 0, 0.35, 0.7, 1]) zs.push(a + d * (m.wheelR + 0.1));
  for (const z of [s.aBase, s.aTop, s.cTop, s.cBase, s.bed ?? 99, s.box?.from ?? 99]) if (Math.abs(z) < hL) zs.push(z, z + 0.02, z - 0.02);
  zs.sort((a, b) => a - b);
  const uniq = zs.filter((z, i) => i === 0 || z - zs[i - 1] > 0.015).filter((z) => z >= -hL && z <= hL);
  const cabinTop = s.box ? Math.min(s.height, s.box.height - 0.3) : s.height;
  return uniq.map((z) => {
    // ends: the plan rounds off, the nose and tail drop
    const tF = hL - z, tR = z + hL;
    const rF = 0.25 + 0.55 * s.noseRound, rR = 0.2 + 0.5 * s.tailRound;
    const endK = Math.min(smooth(0, rF, tF), smooth(0, rR, tR));
    let hw = (W / 2) * (0.84 + 0.16 * Math.sqrt(endK)) - 0.02 * (1 - endK);
    // the deck: belt through the cabin, falling to the nose over the hood, to the tail over the boot
    let deck = s.belt;
    if (z > s.aBase) {
      const u = (z - s.aBase) / Math.max(0.01, hL - s.aBase);
      deck = s.belt + (s.noseY - s.belt) * Math.pow(u, 1.6 + s.noseRound);
      deck -= 0.08 * s.noseRound * Math.pow(u, 6);
    } else if (z < s.cBase) {
      const u = (s.cBase - z) / Math.max(0.01, s.cBase + hL);
      deck = s.belt + (s.tailY - s.belt) * Math.pow(u, 1.4 + s.tailRound);
      deck -= 0.06 * s.tailRound * Math.pow(u, 6);
    }
    if (s.box && z < s.box.from) deck = s.box.height;
    if (s.bed !== undefined && z < s.bed) deck = s.tailY;
    // the bottom: clearance, bumpers a little higher at the ends, and the arches
    let bot = s.clearance + 0.12 * (1 - Math.min(smooth(0, 0.4, tF), smooth(0, 0.4, tR)));
    for (const a of axles) {
      const dz = z - a, R = m.wheelR + 0.07;
      if (Math.abs(dz) < R) bot = Math.max(bot, m.wheelR + Math.sqrt(R * R - dz * dz) * 0.98);
    }
    bot = Math.min(bot, deck - 0.12);
    // the cabin: the screens rise from the belt to the roof, the roof crowns a little
    let top = -1;
    if (z <= s.aBase && z >= s.cBase && !(s.box && z < s.box.from) && !(s.bed !== undefined && z < s.bed)) {
      if (z > s.aTop) top = s.belt + (cabinTop - s.belt) * (1 - Math.pow((z - s.aTop) / Math.max(0.01, s.aBase - s.aTop), 1.15));
      else if (z < s.cTop) top = s.belt + (cabinTop - s.belt) * (1 - Math.pow((s.cTop - z) / Math.max(0.01, s.cTop - s.cBase), 1.25));
      else top = cabinTop + 0.03 * Math.sin((Math.PI * (z - s.cTop)) / Math.max(0.01, s.aTop - s.cTop));
    }
    hw *= 1;
    return { z, hw, bot, deck, top };
  });
}

/** A loft through rings; returns positions and indices (rings of `ring` points each, open or closed). */
function loft(rings: number[][][], closed: boolean): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  const nR = rings[0].length;
  for (const r of rings) for (const p of r) pos.push(p[0], p[1], p[2]);
  for (let i = 0; i < rings.length - 1; i++) {
    const segs = closed ? nR : nR - 1;
    for (let j = 0; j < segs; j++) {
      const a = i * nR + j, b = i * nR + ((j + 1) % nR), c = (i + 1) * nR + j, d = (i + 1) * nR + ((j + 1) % nR);
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/** Close the ends of a closed loft with fans (nose and tail). */
function caps(rings: number[][][]): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  for (const [ri, flip] of [[0, true], [rings.length - 1, false]] as [number, boolean][]) {
    const r = rings[ri];
    const c = r.reduce((a, p) => [a[0] + p[0] / r.length, a[1] + p[1] / r.length, a[2] + p[2] / r.length], [0, 0, 0]);
    const base = pos.length / 3;
    pos.push(...c);
    for (const p of r) pos.push(p[0], p[1], p[2]);
    for (let j = 0; j < r.length; j++) {
      const a = base + 1 + j, b = base + 1 + ((j + 1) % r.length);
      if (flip) idx.push(base, b, a);
      else idx.push(base, a, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

const RING = 28;
/** lower body ring: a rounded box (superellipse), squarer at the bottom than the shoulders */
function lowerRing(s: Section, floor = -1): number[][] {
  const out: number[][] = [];
  const mid = (s.bot + s.deck) / 2, hh = (s.deck - s.bot) / 2;
  const wall = 0.08; // door thickness: inside the cabin the top is a tub (sills, then down to the floor)
  for (let j = 0; j < RING; j++) {
    const th = (j / RING) * Math.PI * 2;
    const c = Math.cos(th), sn = Math.sin(th);
    const e = sn > 0 ? 0.32 : 0.18; // rounder shoulders than sills
    let x = s.hw * sgnPow(c, e);
    const y = mid + hh * sgnPow(sn, e);
    // a slight bulge at the waist
    x *= 1 + 0.015 * (1 - Math.abs(sn));
    if (floor > 0 && sn > 0.2 && Math.abs(x) < s.hw - wall) {
      // the inside of the cabin: down from the sill to the floor
      const k = Math.min(1, (s.hw - wall - Math.abs(x)) / 0.05);
      out.push([Math.sign(x) * Math.min(Math.abs(x), s.hw - wall), y + (floor - y) * k, s.z]);
      continue;
    }
    out.push([x, y, s.z]);
  }
  return out;
}

/** cabin ring (open at the bottom): from the belt on the right, over the roof, to the belt on the left */
const CAB = 18;
function cabinRing(s: Section, tumble: number): number[][] {
  const out: number[][] = [];
  const h = Math.max(0.001, s.top - s.deck);
  for (let j = 0; j <= CAB; j++) {
    const th = (j / CAB) * Math.PI;
    const c = Math.cos(th), sn = Math.sin(th);
    const inset = 1 - tumble * Math.pow(sn, 1.5);
    const x = s.hw * 0.975 * inset * sgnPow(c, 0.3);
    const y = s.deck - 0.005 + h * sgnPow(sn, 0.35);
    out.push([x, y, s.z]);
  }
  return out;
}

/* ─────────────────────────── geometry cache (per class) ─────────────────────────── */

interface ClassGeo {
  paint: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;
  chrome: THREE.BufferGeometry;
  interior: THREE.BufferGeometry;
  /** door panels (in the door's own frame: hinge at the origin), per side */
  door: { geo: THREE.BufferGeometry; hinge: THREE.Vector3; side: 1 | -1 }[];
  tire: THREE.BufferGeometry;
  rim: THREE.BufferGeometry;
  wheelGeo: THREE.BufferGeometry;
  wiper: THREE.BufferGeometry;
  lamps: { head: THREE.BufferGeometry; tail: THREE.BufferGeometry; indL: THREE.BufferGeometry; indR: THREE.BufferGeometry; reverse: THREE.BufferGeometry; beacons: THREE.BufferGeometry[] };
  lampAt: { head: THREE.Vector3[]; tail: THREE.Vector3[] };
}
const CACHE = new Map<string, ClassGeo>();

const box = (x: number, y: number, z: number, w: number, h: number, d: number, rx = 0, ry = 0, rz = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
};
const cyl = (x: number, y: number, z: number, r: number, len: number, axis: 'x' | 'y' | 'z', seg = 12) => {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
};
const merge = (gs: THREE.BufferGeometry[]) => {
  // smooth normals from the shared vertices first (a loft's surface is one surface), then flatten
  for (const g of gs) if (!g.getAttribute('normal')) g.computeVertexNormals();
  const list = gs.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of list) for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  const m = mergeGeometries(list, false) ?? new THREE.BufferGeometry();
  for (const g of list) g.dispose();
  for (const g of gs) g.dispose();
  return m;
};

function classGeo(spec: VehicleSpec): ClassGeo {
  const key = spec.cls;
  const have = CACHE.get(key);
  if (have) return have;
  const s = spec.shape, m = spec.mech;
  const hL = s.length / 2;
  const paint: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [], trim: THREE.BufferGeometry[] = [], chrome: THREE.BufferGeometry[] = [], interior: THREE.BufferGeometry[] = [];
  const head: THREE.BufferGeometry[] = [], tail: THREE.BufferGeometry[] = [], indL: THREE.BufferGeometry[] = [], indR: THREE.BufferGeometry[] = [], rev: THREE.BufferGeometry[] = [], beacons: THREE.BufferGeometry[] = [];
  const doors: ClassGeo['door'] = [];
  const lampAt = { head: [] as THREE.Vector3[], tail: [] as THREE.Vector3[] };

  if (m.bike) {
    // a motorcycle: frame, tank, seat, engine, forks, bars, lights
    const R = m.wheelR;
    paint.push(box(0, 0.86, 0.12, 0.3, 0.2, 0.55, 0.12)); // tank
    paint.push(box(0, 0.78, -0.62, 0.22, 0.12, 0.5, -0.1)); // tail
    trim.push(box(0, 0.83, -0.28, 0.26, 0.08, 0.5, -0.05)); // seat
    trim.push(box(0, 0.5, 0.05, 0.28, 0.3, 0.42)); // engine
    chrome.push(cyl(0.1, 0.35, -0.5, 0.045, 0.7, 'z', 8)); // exhaust
    chrome.push(box(0, 0.72, 0.35, 0.05, 0.05, 0.9, 0.9)); // frame
    trim.push(box(0, R + 0.35, m.axleF - 0.08, 0.14, 0.75, 0.05, 0.42)); // forks
    trim.push(box(0, 1.02, 0.5, 0.7, 0.03, 0.03)); // bars
    head.push(cyl(0, 0.95, 0.72, 0.09, 0.06, 'z'));
    tail.push(box(0, 0.8, -0.9, 0.14, 0.05, 0.03));
    indL.push(box(-0.14, 0.92, 0.66, 0.05, 0.03, 0.03));
    indR.push(box(0.14, 0.92, 0.66, 0.05, 0.03, 0.03));
    rev.push(box(0, 0.74, -0.9, 0.04, 0.02, 0.02));
    lampAt.head.push(new THREE.Vector3(0, 0.95, 0.75));
    lampAt.tail.push(new THREE.Vector3(0, 0.8, -0.92));
  } else {
    const secs = sections(spec);
    // ── the lower body (paint), closed at the ends
    // the cabin is hollow (a tub with a floor), so you can sit in it and see out
    const lower = secs.map((q) => lowerRing(q, q.top > 0 && q.z < s.aBase - 0.12 && q.z > s.cBase + 0.08 ? q.bot + 0.18 : -1));
    paint.push(loft(lower, true), caps(lower));
    // ── the cabin: glass, with the roof and pillars in paint
    const cab = secs.filter((q) => q.top > 0);
    if (cab.length > 1) {
      const rings = cab.map((q) => cabinRing(q, s.tumble));
      const L0 = loft(rings, false);
      L0.computeVertexNormals();
      const P = L0.getAttribute('position') as THREE.BufferAttribute, NR = L0.getAttribute('normal') as THREE.BufferAttribute;
      const gl: number[] = [], pt: number[] = [], gln: number[] = [], ptn: number[] = [];
      const bPillars = s.doors === 2 ? [(s.aTop + s.cTop) / 2 + 0.05] : [];
      if (spec.cls === 'bus') for (let z = s.cTop + 1.2; z < s.aTop - 0.6; z += 1.35) bPillars.push(z);
      const nR = CAB + 1;
      // classify each quad by where it is in the grid: its ring position (belt, side, roof) and its z
      for (let i = 0; i < rings.length - 1; i++) {
        const zc = (cab[i].z + cab[i + 1].z) / 2;
        const inScreen = zc > s.aTop - 0.01 || zc < s.cTop + 0.01;
        for (let j = 0; j < CAB; j++) {
          const jc = (j + 0.5) / CAB; // 0 right belt … 0.5 roof centre … 1 left belt
          const edge = Math.min(jc, 1 - jc); // 0 at the belt, 0.5 on the roof
          let isPaint = edge < 0.045; // the window frame along the belt
          if (inScreen) isPaint ||= edge < 0.26 || (zc > s.aTop && Math.abs(zc - s.aTop) < 0.06) || (zc < s.cTop && Math.abs(zc - s.cTop) < 0.06);
          else {
            isPaint ||= edge > 0.27; // roof
            isPaint ||= Math.abs(zc - s.aTop) < 0.08 || (spec.cls !== 'bus' && Math.abs(zc - s.cTop) < 0.12);
            for (const bp of bPillars) if (Math.abs(zc - bp) < 0.06) isPaint = true;
          }
          const a = i * nR + j, b = i * nR + j + 1, c = (i + 1) * nR + j, d = (i + 1) * nR + j + 1;
          const dst = isPaint ? pt : gl, dn = isPaint ? ptn : gln;
          for (const v of [a, b, c, b, d, c]) {
            dst.push(P.getX(v), P.getY(v), P.getZ(v));
            dn.push(NR.getX(v), NR.getY(v), NR.getZ(v));
          }
        }
      }
      L0.dispose();
      const mk = (a: number[], n: number[]) => {
        const q = new THREE.BufferGeometry();
        q.setAttribute('position', new THREE.Float32BufferAttribute(a, 3));
        q.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
        return q;
      };
      paint.push(mk(pt, ptn));
      glass.push(mk(gl, gln));
    }
    // ── pickup bed: walls and a tailgate over the rear deck
    if (s.bed !== undefined) {
      const bw = s.width / 2 - 0.05, len = s.bed + hL - 0.05, cz = (s.bed - hL) / 2;
      paint.push(box(-bw, s.tailY + 0.2, cz, 0.07, 0.4, len), box(bw, s.tailY + 0.2, cz, 0.07, 0.4, len));
      paint.push(box(0, s.tailY + 0.2, -hL + 0.06, s.width - 0.1, 0.4, 0.07), box(0, s.tailY + 0.2, s.bed, s.width - 0.1, 0.4, 0.07));
      trim.push(box(0, s.tailY + 0.01, cz, s.width - 0.2, 0.02, len - 0.1));
    }
    // ── a box body: rear doors, a step
    if (s.box) {
      trim.push(box(0, s.box.height / 2 + 0.2, -hL - 0.005, s.width * 0.02, s.box.height - 0.5, 0.01));
      trim.push(box(0, s.clearance + 0.05, -hL - 0.1, s.width * 0.8, 0.05, 0.25));
    }
    // ── front: grille, bumpers, plate
    const nose = secs[secs.length - 1];
    const fz = hL;
    const gy = Math.max(s.clearance + 0.2, s.noseY - 0.25);
    trim.push(box(0, gy, fz - 0.02 - 0.05 * s.noseRound, s.width * (spec.cls === 'truck' || spec.cls === 'bus' ? 0.7 : 0.45), spec.cls === 'truck' ? 0.6 : 0.2, 0.06));
    trim.push(box(0, s.clearance + 0.16, fz - 0.04 - 0.08 * s.noseRound, s.width * 0.92, 0.14, 0.12));
    trim.push(box(0, s.clearance + 0.16, -hL + 0.04 + 0.06 * s.tailRound, s.width * 0.92, 0.14, 0.12));
    chrome.push(box(0, s.clearance + 0.3, fz - 0.02 - 0.08 * s.noseRound, 0.52, 0.12, 0.02));
    chrome.push(box(0, Math.min(s.tailY - 0.2, s.belt - 0.15), -hL - 0.005 + 0.07 * s.tailRound, 0.52, 0.12, 0.02));
    // ── lights: head, tail, indicators, reverse
    const hx = s.width / 2 - 0.22 - 0.05 * s.noseRound, hy = Math.max(s.clearance + 0.3, s.noseY - 0.12);
    const hz = fz - 0.03 - 0.16 * s.noseRound;
    for (const sx of [-1, 1]) {
      head.push(box(sx * hx, hy, hz, 0.32, 0.1, 0.06, -0.25 * s.noseRound, sx * 0.25 * s.noseRound));
      (sx < 0 ? indL : indR).push(box(sx * (hx + 0.2), hy - 0.02, hz - 0.06 * s.noseRound, 0.08, 0.06, 0.05, 0, sx * 0.5 * s.noseRound));
      lampAt.head.push(new THREE.Vector3(sx * hx, hy, hz + 0.05));
      const ty = Math.min(s.tailY - 0.12, s.belt - 0.05), tz = -hL + 0.02 + 0.12 * s.tailRound;
      tail.push(box(sx * (s.width / 2 - 0.2), ty, tz, 0.3, 0.12, 0.05, 0.2 * s.tailRound, -sx * 0.25 * s.tailRound));
      (sx < 0 ? indL : indR).push(box(sx * (s.width / 2 - 0.2), ty - 0.1, tz + 0.01, 0.2, 0.05, 0.05));
      rev.push(box(sx * (s.width / 2 - 0.44), ty - 0.02, tz, 0.1, 0.06, 0.05));
      lampAt.tail.push(new THREE.Vector3(sx * (s.width / 2 - 0.2), ty, tz - 0.05));
      if (s.box) {
        // marker lights high on the box
        tail.push(box(sx * (s.width / 2 - 0.1), s.box.height - 0.1, -hL - 0.01, 0.12, 0.06, 0.03));
      }
    }
    void nose;
    // ── mirrors and door handles
    const mz = s.aBase - 0.28;
    for (const sx of [-1, 1]) {
      const secM = secs.reduce((a, q) => (Math.abs(q.z - mz) < Math.abs(a.z - mz) ? q : a), secs[0]);
      trim.push(box(sx * (secM.hw + 0.1), s.belt + 0.1, mz, 0.18, 0.11, 0.06));
      glass.push(box(sx * (secM.hw + 0.1), s.belt + 0.1, mz - 0.035, 0.15, 0.085, 0.01));
      trim.push(box(sx * (secM.hw * 0.99 + 0.03), s.belt + 0.03, mz - 0.1, 0.03, 0.04, 0.12));
    }
    const handleZ = s.doors === 2 ? [s.aTop - 0.25, (s.aTop + s.cTop) / 2 - 0.2] : [s.aTop - 0.35];
    for (const z of handleZ) for (const sx of [-1, 1]) {
      const sec = secs.reduce((a, q) => (Math.abs(q.z - z) < Math.abs(a.z - z) ? q : a), secs[0]);
      chrome.push(box(sx * (sec.hw + 0.012), s.belt - 0.1, z, 0.02, 0.03, 0.14));
    }
    // ── exhaust
    chrome.push(cyl(-s.width / 2 + 0.4, s.clearance + 0.05, -hL + 0.02, 0.04, 0.2, 'z', 10));
    // ── interior: dash, seats, a console (seen through the glass)
    // the dash sits under the screen, below the sightline (the driver's eyes are ~0.25 m above it)
    const dz = Math.min(s.aBase - 0.08, spec.wheel.z + 0.4);
    interior.push(box(0, s.belt - 0.1, dz, s.width - 0.3, 0.12, 0.34));
    interior.push(box(0, s.belt - 0.34, dz - 0.04, s.width - 0.36, 0.34, 0.28));
    for (const st of [spec.seat, ...spec.seats]) {
      interior.push(box(st.x, st.y + 0.02, st.z, 0.5, 0.12, 0.5));
      interior.push(box(st.x, st.y + 0.36, st.z - 0.26, 0.48, 0.62, 0.12, -0.18));
      interior.push(box(st.x, st.y + 0.72, st.z - 0.3, 0.26, 0.16, 0.1, -0.18));
    }
    if (spec.shape.doors === 2 || spec.cls === 'sports') interior.push(box(0, spec.seat.y + 0.1, spec.seat.z + 0.1, 0.2, 0.2, 0.6));
    // ── doors: the side panel between the screen and the B pillar (driver's side first), hinged at the front
    const dFront = s.aTop + 0.02, dBack = s.doors === 2 ? (s.aTop + s.cTop) / 2 + 0.02 : Math.max(s.cTop, s.aTop - 1.15);
    for (const side of [1, -1] as (1 | -1)[]) {
      const rings = secs.filter((q) => q.z >= dBack && q.z <= dFront).map((q) => {
        // the outer skin of that side, sill to belt
        const out: number[][] = [];
        for (let j = 0; j <= 8; j++) {
          const y = q.bot + 0.06 + (q.deck - 0.03 - q.bot - 0.06) * (j / 8);
          out.push([side * (q.hw * 1.004 + 0.004), y, q.z]);
        }
        return out;
      });
      if (rings.length > 1) {
        const g = loft(side > 0 ? rings : rings.map((r) => [...r].reverse()), false);
        g.computeVertexNormals();
        const hinge = new THREE.Vector3(rings[rings.length - 1][0][0], 0, rings[rings.length - 1][0][2]);
        g.translate(-hinge.x, 0, -hinge.z);
        doors.push({ geo: g, hinge, side });
      }
    }
    // ── specials: a taxi sign, a police bar, an ambulance's beacons
    if (spec.livery === 'taxi') {
      trim.push(box(0, s.height + 0.08, (s.aTop + s.cTop) / 2, 0.5, 0.14, 0.2));
      head.push(box(0, s.height + 0.09, (s.aTop + s.cTop) / 2, 0.46, 0.1, 0.21));
    }
    if (spec.livery === 'police') {
      trim.push(box(0, s.height + 0.05, (s.aTop + s.cTop) / 2, 1.2, 0.06, 0.26));
      beacons.push(box(-0.32, s.height + 0.12, (s.aTop + s.cTop) / 2, 0.5, 0.1, 0.24), box(0.32, s.height + 0.12, (s.aTop + s.cTop) / 2, 0.5, 0.1, 0.24));
      // push bar
      trim.push(box(0, s.clearance + 0.4, hL + 0.1, s.width * 0.55, 0.36, 0.06));
    }
    if (spec.livery === 'ambulance' && s.box) {
      beacons.push(box(-0.7, s.box.height + 0.08, s.box.from - 0.2, 0.3, 0.12, 0.14), box(0.7, s.box.height + 0.08, s.box.from - 0.2, 0.3, 0.12, 0.14));
      // a red band down each side
      for (const sx of [-1, 1]) paint.push(box(sx * (s.width / 2 + 0.005), s.box.height * 0.55, (s.box.from - hL) / 2, 0.01, 0.22, s.box.from + hL - 0.2));
    }
  }

  // ── wheels: a rounded tyre and a spoked rim, axis along x
  const R = m.wheelR, Wd = m.wheelW;
  const prof: THREE.Vector2[] = [];
  const ri = R * 0.66;
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI;
    prof.push(new THREE.Vector2(R - 0.035 + 0.035 * Math.cos(a) - (1 - Math.cos(a)) * 0.01, (Wd / 2) * Math.sin(a)));
  }
  prof.unshift(new THREE.Vector2(ri, -Wd / 2 + 0.01));
  prof.push(new THREE.Vector2(ri, Wd / 2 - 0.01));
  const tire = new THREE.LatheGeometry(prof, 24);
  tire.rotateZ(Math.PI / 2);
  const spokes = m.bike ? 5 : spec.cls === 'truck' || spec.cls === 'bus' ? 8 : 6;
  const rimParts: THREE.BufferGeometry[] = [cyl(0, 0, 0, ri, Wd * 0.7, 'x', 20), cyl(Wd * 0.2, 0, 0, ri * 0.25, Wd * 0.5, 'x', 10)];
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    rimParts.push(box(Wd * 0.28, Math.cos(a) * ri * 0.5, Math.sin(a) * ri * 0.5, 0.03, ri * 0.95, 0.05, a));
  }
  const rim = merge(rimParts);
  const wiper = box(0.27, 0, 0, 0.54, 0.018, 0.012);

  const cg: ClassGeo = {
    paint: merge(paint), glass: merge(glass.length ? glass : [box(0, -9, 0, 0.01, 0.01, 0.01)]), trim: merge(trim), chrome: merge(chrome.length ? chrome : [box(0, -9, 0, 0.01, 0.01, 0.01)]),
    interior: merge(interior.length ? interior : [box(0, -9, 0, 0.01, 0.01, 0.01)]), door: doors, tire, rim, wheelGeo: tire, wiper,
    lamps: {
      head: merge(head), tail: merge(tail), indL: merge(indL), indR: merge(indR), reverse: merge(rev), beacons: beacons.map((b) => merge([b])),
    },
    lampAt,
  };
  CACHE.set(key, cg);
  return cg;
}

/* ─────────────────────────── one vehicle ─────────────────────────── */

export function buildVehicle(spec: VehicleSpec, color: number): VehicleModel {
  const cg = classGeo(spec);
  const wear: Wear = { dents: Array.from({ length: DENTS }, () => new THREE.Vector4(0, 0, 0, 0)), dirt: { value: 0.05 }, wet: { value: 0 }, time: { value: 0 }, glassCrack: { value: 0 } };
  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.06 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0c1014, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.62, clearcoat: 1, clearcoatRoughness: 0.02, side: THREE.DoubleSide, depthWrite: false });
  const trim = new THREE.MeshStandardMaterial({ color: 0x151618, roughness: 0.6, metalness: 0.1 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc8c8cc, roughness: 0.15, metalness: 1 });
  const interior = new THREE.MeshStandardMaterial({ color: 0x1c1b1a, roughness: 0.85 });
  const lamp = (c: number, e: number) => new THREE.MeshStandardMaterial({ color: c, emissive: e, emissiveIntensity: 0, roughness: 0.2 });
  const mats: VehicleMats = {
    paint, glass, trim, chrome, interior,
    head: lamp(0xdad8d0, 0xfff2d8), tail: lamp(0x5a0c0a, 0xff1a0a), indL: lamp(0x8a5a10, 0xffa020), indR: lamp(0x8a5a10, 0xffa020), reverse: lamp(0xc8c8c8, 0xffffff),
    beacon: spec.livery === 'police' ? [lamp(0x3a0a0a, 0xff2010), lamp(0x0a0a3a, 0x2050ff)] : spec.livery === 'ambulance' ? [lamp(0x3a0a0a, 0xff2010), lamp(0x3a0a0a, 0xff2010)] : [],
    rubber: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 }),
    rim: new THREE.MeshStandardMaterial({ color: spec.cls === 'sports' ? 0x2a2a2c : 0x9a9a9e, roughness: 0.3, metalness: 0.9 }),
  };
  patchVehicle(paint, wear, 'paint');
  patchVehicle(glass, wear, 'glass');
  patchVehicle(trim, wear, 'trim');

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, cast = true) => {
    const x = new THREE.Mesh(g, m);
    x.castShadow = cast;
    x.receiveShadow = true;
    body.add(x);
    return x;
  };
  mesh(cg.paint, paint);
  mesh(cg.glass, glass, false).renderOrder = 2;
  mesh(cg.trim, trim);
  mesh(cg.chrome, chrome, false);
  mesh(cg.interior, interior, false);
  mesh(cg.lamps.head, mats.head, false);
  mesh(cg.lamps.tail, mats.tail, false);
  mesh(cg.lamps.indL, mats.indL, false);
  mesh(cg.lamps.indR, mats.indR, false);
  mesh(cg.lamps.reverse, mats.reverse, false);
  cg.lamps.beacons.forEach((g, i) => mesh(g, mats.beacon[i % Math.max(1, mats.beacon.length)] ?? mats.tail, false));

  // doors: hidden in the body until they open (the body's own skin is under them)
  const doors: VehicleModel['doors'] = [];
  for (const d of cg.door) {
    const pivot = new THREE.Group();
    pivot.position.copy(d.hinge);
    const panel = new THREE.Mesh(d.geo, paint);
    panel.castShadow = true;
    pivot.add(panel);
    // the inside of the door: a trim card behind the skin
    const card = new THREE.Mesh(d.geo, interior);
    card.scale.set(0.96, 1, 1);
    card.position.x = -d.side * 0.05;
    pivot.add(card);
    pivot.visible = false;
    body.add(pivot);
    doors.push({ pivot, side: d.side, open: 0 });
  }

  // steering wheel
  const sw = new THREE.Group();
  // (the interior's material, not the trim's: the wear shader's dents are in the body's frame)
  const rimT = new THREE.Mesh(new THREE.TorusGeometry(spec.mech.bike ? 0.01 : 0.19, 0.018, 8, 24), interior);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 10).rotateX(Math.PI / 2), interior);
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.03, 0.015), interior);
  sw.add(rimT, hub, spoke);
  const swPivot = new THREE.Group();
  swPivot.position.set(spec.wheel.x, spec.wheel.y, spec.wheel.z);
  swPivot.rotation.x = -(Math.PI / 2 - spec.wheel.tilt);
  swPivot.add(sw);
  if (!spec.mech.bike) body.add(swPivot);

  // wipers: at the base of the screen, lying in its plane, sweeping up it
  const wipers: THREE.Object3D[] = [];
  if (!spec.mech.bike) {
    const sh = spec.shape;
    const tilt = Math.atan2((sh.box ? Math.min(sh.height, sh.box.height - 0.3) : sh.height) - sh.belt, Math.max(0.05, sh.aBase - sh.aTop));
    for (const x of spec.cls === 'bus' || spec.cls === 'truck' ? [-0.8, 0.2] : [-0.55, 0.05]) {
      const p = new THREE.Group();
      p.position.set(x, sh.belt + 0.03, sh.aBase - 0.04);
      p.rotation.x = tilt - Math.PI / 2;
      const arm = new THREE.Mesh(cg.wiper, interior);
      arm.position.z = 0.012;
      p.add(arm);
      body.add(p);
      wipers.push(p);
    }
  }

  // wheels (unsprung: children of the root, placed by the suspension)
  const wheels: VehicleModel['wheels'] = [];
  const m = spec.mech;
  const axles: [number, boolean][] = [[m.axleF, true], [m.axleR, false], ...(m.extraAxles ?? []).map((z) => [z, false] as [number, boolean])];
  for (const [z, front] of axles) {
    for (const lx of m.bike ? [0] : [-m.track / 2, m.track / 2]) {
      const steer = new THREE.Group();
      steer.position.set(lx, m.wheelR, z);
      const spin = new THREE.Group();
      const t = new THREE.Mesh(cg.tire, mats.rubber);
      t.castShadow = true;
      const r = new THREE.Mesh(cg.rim, mats.rim);
      // rims face outward
      if (lx < 0) r.scale.x = -1;
      spin.add(t, r);
      steer.add(spin);
      root.add(steer);
      wheels.push({ lx, lz: z, r: m.wheelR, steer, spin, front });
    }
  }

  const model: VehicleModel = {
    root, body, wheels, steeringWheel: sw, doors, wipers, mats, wear,
    lampAt: { head: cg.lampAt.head.map((v) => v.clone()), tail: cg.lampAt.tail.map((v) => v.clone()) },
    dispose() {
      // geometry is shared per class; materials are this car's own
      for (const mm of [paint, glass, trim, chrome, interior, mats.head, mats.tail, mats.indL, mats.indR, mats.reverse, mats.rubber, mats.rim, ...mats.beacon]) mm.dispose();
      rimT.geometry.dispose();
      hub.geometry.dispose();
      spoke.geometry.dispose();
    },
  };
  return model;
}

/* ─────────────────────────── per frame ─────────────────────────── */

export interface LightState {
  head: number; // 0 off, 1 dipped, 2 main beam
  brake: boolean;
  reverse: boolean;
  indicator: -1 | 0 | 1;
  hazard: boolean;
  beacons: boolean;
  running: boolean;
}

/** Lights, indicators blinking, beacons flashing (a broken lamp stays dark). */
export function setLights(v: VehicleModel, l: LightState, t: number, broken: { head: boolean; tail: boolean }) {
  const blink = Math.sin(t * Math.PI * 2 * 1.5) > 0 ? 1 : 0;
  v.mats.head.emissiveIntensity = broken.head ? 0 : l.head === 0 ? (l.running ? 0.4 : 0) : l.head === 1 ? 3 : 5;
  v.mats.tail.emissiveIntensity = broken.tail ? 0 : (l.brake ? 7 : 0) + (l.head > 0 || l.running ? 2 : 0);
  v.mats.reverse.emissiveIntensity = l.reverse ? 4 : 0;
  v.mats.indL.emissiveIntensity = (l.hazard || l.indicator < 0) && blink ? 5 : 0;
  v.mats.indR.emissiveIntensity = (l.hazard || l.indicator > 0) && blink ? 5 : 0;
  v.mats.beacon.forEach((m, i) => (m.emissiveIntensity = l.beacons ? ((Math.floor(t * 6) + i) % 2 ? 9 : 0.3) : 0));
}

/** Add a dent where it hit (car-local), deepening one that's close already. */
export function dent(v: VehicleModel, x: number, y: number, z: number, depth: number) {
  let best: THREE.Vector4 | null = null, bd = 0.5;
  for (const d of v.wear.dents) {
    if (d.w <= 0) continue;
    const dd = Math.hypot(d.x - x, d.y - y, d.z - z);
    if (dd < bd) (best = d), (bd = dd);
  }
  if (best) {
    best.w = Math.min(1, best.w + depth);
    return;
  }
  // a free slot, else the shallowest
  let slot = v.wear.dents.find((d) => d.w <= 0) ?? v.wear.dents.reduce((a, d) => (d.w < a.w ? d : a));
  slot.set(x, y, z, Math.min(1, depth));
}
