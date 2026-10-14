import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
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
  /** the class this car was built from: its seat, shape and paint options */
  spec: VehicleSpec;
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
  caliper: THREE.MeshStandardMaterial;
}

/** Up to 8 dents (car-local position, depth) plus dirt and wet, fed to the shaders. */
export interface Wear {
  dents: THREE.Vector4[];
  dirt: { value: number };
  wet: { value: number };
  time: { value: number };
  glassCrack: { value: number };
  /** blood on the bodywork: car-local position and amount (up to 4) */
  blood: THREE.Vector4[];
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
    sh.uniforms.uBlood = { value: wear.blood };
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
      .replace('#include <common>', `#include <common>\nuniform vec4 uBlood[4];\nuniform float uDirt;\nuniform float uWetV;\nuniform float uTimeV;\nuniform float uCrack;\nvarying vec3 vLoc;\nvarying float vDent;\nfloat vh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(vh(i), vh(i+vec2(1,0)), f.x), mix(vh(i+vec2(0,1)), vh(i+vec2(1,1)), f.x), f.y); }`)
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
  // blood where someone was hit: spattered, thickest at the point, run down by gravity
  for (int i = 0; i < 4; i++) {
    vec4 b = uBlood[i];
    if (b.w <= 0.0) continue;
    vec3 dd = vLoc - b.xyz;
    dd.y = dd.y > 0.0 ? dd.y * 1.6 : dd.y * 0.55;
    float bk = smoothstep(0.55, 0.0, length(dd)) * b.w;
    bk *= smoothstep(0.35, 0.75, vn(vLoc.xz * 22.0 + vLoc.y * 17.0 + float(i) * 3.1) + bk * 0.5);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.22, 0.01, 0.01), clamp(bk, 0.0, 0.9) * (1.0 - uWetV * 0.5));
  }
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

/** how wide a section really is at height y (the superellipse of lowerRing, not its bounding box) */
function halfWidthAt(q: Section, y: number) {
  const mid = (q.bot + q.deck) / 2, hh = (q.deck - q.bot) / 2;
  if (hh <= 0 || y > q.deck || y < q.bot) return -1;
  const v = (y - mid) / hh;
  const e = v > 0 ? 0.32 : 0.18;
  const sn = Math.pow(Math.min(1, Math.abs(v)), 1 / e);
  return q.hw * Math.pow(Math.sqrt(Math.max(0, 1 - sn * sn)), e) * (1 + 0.015 * (1 - sn));
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
  /** the brake caliper: on the hub, not spinning (in the wheel's frame, outer side +x) */
  caliper: THREE.BufferGeometry;
  /** number plates, with uvs */
  plates: THREE.BufferGeometry | null;
  wheelGeo: THREE.BufferGeometry;
  wiper: THREE.BufferGeometry;
  lamps: { head: THREE.BufferGeometry; tail: THREE.BufferGeometry; indL: THREE.BufferGeometry; indR: THREE.BufferGeometry; reverse: THREE.BufferGeometry; beacons: THREE.BufferGeometry[] };
  lampAt: { head: THREE.Vector3[]; tail: THREE.Vector3[] };
}
const CACHE = new Map<string, ClassGeo>();
const big0 = (spec: VehicleSpec) => spec.cls === 'truck' || spec.cls === 'bus' || spec.cls === 'firetruck' || spec.cls === 'refuse';

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
/** a box with rounded edges (bumpers, housings, lenses) */
const rbox = (x: number, y: number, z: number, w: number, h: number, d: number, r: number, rx = 0, ry = 0, rz = 0) => {
  const g = new RoundedBoxGeometry(w, h, d, 2, Math.max(0.001, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)));
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
};
/** the dark inside of a wheel arch: the upper half of a drum, seen from either side */
const archLiner = (x: number, y: number, z: number, r: number, w: number) => {
  const g = new THREE.CylinderGeometry(r, r, w, 18, 1, true, Math.PI * 0.5, Math.PI);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  const back = g.clone();
  const idx = back.index!;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i);
    idx.setX(i, idx.getX(i + 2));
    idx.setX(i + 2, a);
  }
  const n = back.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return mergeGeometries([g.toNonIndexed(), back.toNonIndexed()].map((q) => (q.deleteAttribute('uv'), q)))!;
};
/** a number plate (keeps its uvs: it carries a texture) */
const plate = (x: number, y: number, z: number, dir: 1 | -1) => {
  const g = new THREE.PlaneGeometry(0.52, 0.12);
  if (dir < 0) g.rotateY(Math.PI);
  g.translate(x, y, z);
  return g;
};
/** reverse a geometry's winding (after mirroring it) */
const flipWinding = (g: THREE.BufferGeometry) => {
  const q = g.index ? g.toNonIndexed() : g;
  const p = q.getAttribute('position') as THREE.BufferAttribute, n = q.getAttribute('normal') as THREE.BufferAttribute | undefined;
  for (let i = 0; i < p.count; i += 3) {
    for (const a of [p, n]) {
      if (!a) continue;
      const x = a.getX(i), y = a.getY(i), zz = a.getZ(i);
      a.setXYZ(i, a.getX(i + 2), a.getY(i + 2), a.getZ(i + 2));
      a.setXYZ(i + 2, x, y, zz);
    }
  }
  return q;
};

/** The plate everyone in District 03 seems to have. Shared, made once. */
let PLATE: THREE.MeshStandardMaterial | null = null;
export function plateMaterial() {
  if (PLATE) return PLATE;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 60;
  const x = c.getContext('2d')!;
  x.fillStyle = '#e9e6dc';
  x.fillRect(0, 0, 256, 60);
  x.strokeStyle = '#1a1a1a';
  x.lineWidth = 4;
  x.strokeRect(3, 3, 250, 54);
  x.fillStyle = '#2a4a8a';
  x.fillRect(5, 5, 26, 50);
  x.fillStyle = '#e9e6dc';
  x.font = '600 14px "IBM Plex Sans", sans-serif';
  x.textAlign = 'center';
  x.fillText('03', 18, 36);
  x.fillStyle = '#141414';
  x.font = '700 38px "IBM Plex Mono", ui-monospace, monospace';
  x.fillText('NF 3·17', 142, 44);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  PLATE = new THREE.MeshStandardMaterial({ map: t, roughness: 0.4, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2 });
  return PLATE;
}

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
  const plates: THREE.BufferGeometry[] = [];
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
    for (const sx of [-1, 1]) {
      (sx < 0 ? indR : indL).push(box(sx * 0.14, 0.92, 0.66, 0.05, 0.03, 0.03));
    }
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
          // an open car keeps only its windscreen and the frame round it
          if (s.open && (zc <= s.aTop + 0.02 || edge > 0.45)) continue;
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
    // ── the details that make it a car rather than a shape. Each piece sits on
    // the body's actual surface (surfZ), so nothing floats off a rounded nose.
    const secAt = (z: number) => secs.reduce((a, q) => (Math.abs(q.z - z) < Math.abs(a.z - z) ? q : a), secs[0]);
    /** the frontmost (dir 1) or rearmost (dir −1) z where the body is at least this wide at this height */
    const surfZ = (x: number, y: number, dir: 1 | -1) => {
      const list = dir > 0 ? [...secs].reverse() : secs;
      for (const q of list) if (halfWidthAt(q, y) >= Math.abs(x)) return q.z;
      return dir * (hL - 0.2);
    };
    const big = spec.cls === 'truck' || spec.cls === 'bus' || spec.cls === 'firetruck' || spec.cls === 'refuse';
    const sporty = spec.cls === 'sports' || spec.cls === 'muscle' || spec.cls === 'roadster';
    // bumpers: body-coloured, wrapped round the corners, a black lip under them
    for (const dir of [1, -1] as const) {
      const by = s.clearance + 0.2, bh = big ? 0.42 : 0.3;
      const zEnd = dir > 0 ? hL : -hL;
      const zFace = surfZ(0, by, dir);
      const bw = secAt(zFace - dir * 0.16).hw * 2 - 0.04;
      paint.push(rbox(0, by, zFace - dir * 0.12, bw, bh, 0.26, 0.13));
      trim.push(rbox(0, s.clearance + 0.07, zFace - dir * 0.16, bw * 0.8, 0.07, 0.22, 0.03));
      void zEnd;
      if (dir > 0) {
        // the lower intake, and the plate on it
        trim.push(rbox(0, by - 0.02, zFace + 0.02, bw * (sporty ? 0.72 : 0.5), bh * 0.42, 0.04, 0.02));
        plates.push(plate(0, by + bh * 0.28, zFace + 0.04, 1));
      } else {
        // a diffuser (or a step), the plate up on the boot or the box
        trim.push(rbox(0, by - 0.04, zFace - 0.02, bw * 0.6, bh * 0.36, 0.04, 0.02));
        const py = Math.min(s.tailY - 0.25, s.belt - 0.2);
        plates.push(plate(0, Math.max(by + 0.22, py), surfZ(0, Math.max(by + 0.22, py), -1) - 0.01, -1));
      }
    }
    // the grille: a dark mesh in a chrome surround, with bars across it
    {
      const gy = big ? s.clearance + 0.75 : Math.max(s.clearance + 0.42, s.noseY - 0.2);
      const gw = big ? s.width * 0.72 : s.width * (spec.cls === 'suv' || spec.cls === 'pickup' || spec.cls === 'offroad' ? 0.5 : sporty ? 0.36 : 0.42);
      const gh = big ? 0.75 : spec.cls === 'pickup' || spec.cls === 'suv' || spec.cls === 'offroad' ? 0.32 : 0.16;
      const gz = surfZ(gw / 2, gy, 1);
      chrome.push(rbox(0, gy, gz - 0.015, gw + 0.05, gh + 0.05, 0.05, 0.02));
      trim.push(rbox(0, gy, gz, gw, gh, 0.05, 0.015));
      const bars = big ? 5 : gh > 0.2 ? 3 : 2;
      for (let i = 1; i <= bars; i++) chrome.push(box(0, gy - gh / 2 + (gh * i) / (bars + 1), gz + 0.022, gw * 0.96, 0.012, 0.012));
    }
    // ── lights: clusters, not cubes. A black housing, a lens that lights,
    // a projector disc in it and a daytime strip along the top edge.
    // Car faces +z with +y up, so local −x is its RIGHT and +x its LEFT. The
    // indicator lamps are named by the side they are on, not by the sign used
    // to place them.
    const hw0 = secAt(hL - 0.25).hw;
    const hlW0 = big ? 0.34 : sporty ? 0.4 : 0.38, hlH = big ? 0.22 : sporty ? 0.12 : 0.16;
    const gHalf = (big ? s.width * 0.72 : s.width * (spec.cls === 'suv' || spec.cls === 'pickup' || spec.cls === 'offroad' ? 0.5 : sporty ? 0.36 : 0.42)) / 2 + 0.03;
    void hw0;
    const hy0 = big ? s.clearance + 0.62 : Math.max(s.clearance + 0.42, s.noseY - 0.12);
    const hy = hy0;
    /** a cluster between `inner` and the body's real edge at that height, no wider than it wants to be */
    const fit = (want: number, inner: number, y: number, z: number) => {
      const room = halfWidthAt(secAt(z), y) - 0.04 - inner;
      const w = Math.max(0.12, Math.min(want, room));
      return { w, x: inner + w / 2 };
    };
    const HF = fit(hlW0, gHalf + 0.02, hy, hL - 0.12);
    const hlW = HF.w, hx = HF.x;
    const ty = Math.min(s.tailY - 0.14, s.belt - 0.06);
    const tlH = big ? 0.32 : 0.17;
    const TF = fit(big ? 0.24 : 0.38, big ? s.width / 2 - 0.4 : 0.32, ty, -hL + 0.12);
    const tlW = TF.w, tx = TF.x;
    /** where a cluster `w` wide sits on the curve: its centre z and the yaw that lays it along the surface */
    const onCurve = (sx: number, x: number, y: number, w: number, dir: 1 | -1) => {
      // the centre sits on the surface; the cluster turns with the surface's slope there, but only so far
      const zi = surfZ(sx * (x - w / 2), y, dir), zc = surfZ(sx * x, y, dir);
      const k = Math.max(0, Math.min(0.5, (dir * (zi - zc)) / (w / 2)));
      return { z: zc + dir * 0.012, ry: dir * sx * Math.asin(k) };
    };
    /** parts built round the origin, then set into the body at (x, y, z) turned by ry */
    const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, ry: number) => g.applyMatrix4(new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z));
    for (const sx of [-1, 1]) {
      const H = onCurve(sx, hx, hy, hlW, 1);
      const hz = H.z;
      const put = (g: THREE.BufferGeometry) => at(g, sx * hx, hy, hz, H.ry);
      trim.push(put(rbox(0, 0, -0.025, hlW + 0.03, hlH + 0.03, 0.09, 0.025)));
      // the reflector fills the housing (it reads as a lamp by day, whatever the paint)
      chrome.push(put(rbox(0, 0, 0.012, hlW * 0.94, hlH * 0.82, 0.04, 0.02)));
      head.push(put(cyl(-sx * hlW * 0.2, -hlH * 0.04, 0.03, hlH * 0.3, 0.03, 'z', 18)));
      head.push(put(cyl(sx * hlW * 0.12, -hlH * 0.04, 0.03, hlH * 0.24, 0.03, 'z', 16)));
      head.push(put(rbox(0, hlH * 0.36, 0.03, hlW * 0.9, hlH * 0.12, 0.03, 0.005)));
      (sx < 0 ? indR : indL).push(put(rbox(sx * (hlW / 2 - 0.04), -hlH * 0.3, 0.03, 0.07, hlH * 0.22, 0.03, 0.006)));
      lampAt.head.push(new THREE.Vector3(sx * hx, hy, hz + 0.08));
      // the tail: a housing, a lens, the indicator and the reverse lamp set into it
      const T = onCurve(sx, tx, ty, tlW, -1);
      const tz = T.z;
      const putT = (g: THREE.BufferGeometry) => at(g, sx * tx, ty, tz, T.ry);
      trim.push(putT(rbox(0, 0, 0.025, tlW + 0.03, tlH + 0.03, 0.08, 0.02)));
      tail.push(putT(rbox(0, tlH * 0.14, -0.02, tlW * 0.96, tlH * 0.62, 0.04, 0.012)));
      (sx < 0 ? indR : indL).push(putT(rbox(sx * tlW * 0.25, -tlH * 0.36, -0.018, tlW * 0.42, tlH * 0.2, 0.04, 0.006)));
      rev.push(putT(rbox(-sx * tlW * 0.25, -tlH * 0.36, -0.018, tlW * 0.42, tlH * 0.2, 0.04, 0.006)));
      lampAt.tail.push(new THREE.Vector3(sx * tx, ty, tz - 0.06));
      if (s.box) {
        // marker lights high on the box
        tail.push(rbox(sx * (s.width / 2 - 0.1), s.box.height - 0.1, -hL - 0.01, 0.12, 0.06, 0.03, 0.01));
        tail.push(rbox(sx * (s.width / 2 - 0.1), s.box.height - 0.1, s.box.from + 0.01, 0.12, 0.06, 0.03, 0.01));
      }
    }
    // a light bar joining the tails across the boot (saloons, coupés, the newer ones)
    if (spec.cls === 'sedan' || sporty || spec.cls === 'estate' || spec.cls === 'suv' || spec.cls === 'limo') tail.push(rbox(0, ty + tlH * 0.3, surfZ(0, ty, -1) - 0.004, (tx - tlW / 2) * 2 + 0.02, 0.025, 0.03, 0.008));
    // ── mirrors: a body-coloured housing on a stalk, the glass facing back
    const mz = s.aBase - 0.28;
    for (const sx of [-1, 1]) {
      const secM = secAt(mz);
      const mx = sx * (secM.hw + 0.13), my = s.belt + 0.1;
      trim.push(box(sx * (secM.hw + 0.04), s.belt + 0.04, mz + 0.02, 0.1, 0.04, 0.08));
      paint.push(rbox(mx, my, mz, big ? 0.14 : 0.2, big ? 0.3 : 0.12, 0.1, 0.035));
      glass.push(rbox(mx, my, mz - 0.052, big ? 0.11 : 0.17, big ? 0.26 : 0.095, 0.005, 0.002));
      (sx < 0 ? indR : indL).push(box(mx + sx * 0.06, my - 0.03, mz + 0.03, 0.06, 0.015, 0.03));
    }
    // ── door handles, flush and chrome; shut lines; a chrome strip under the windows; black sills
    const handleZ = s.doors === 2 ? [s.aTop - 0.25, (s.aTop + s.cTop) / 2 - 0.2] : [s.aTop - 0.35];
    for (const z of handleZ) for (const sx of [-1, 1]) {
      const sec = secAt(z);
      chrome.push(rbox(sx * (sec.hw + 0.01), s.belt - 0.12, z, 0.025, 0.035, 0.16, 0.01));
    }
    const dFront0 = s.aTop + 0.02, dBack0 = s.doors === 2 ? (s.aTop + s.cTop) / 2 + 0.02 : Math.max(s.cTop, s.aTop - 1.15);
    const seams = s.doors === 2 ? [dFront0, dBack0, s.cTop - 0.02] : [dFront0, dBack0];
    for (const z of seams) for (const sx of [-1, 1]) {
      const sec = secAt(z);
      if (sec.deck - sec.bot < 0.2) continue;
      trim.push(box(sx * (sec.hw + 0.002), (sec.deck + sec.bot) / 2 + 0.02, z, 0.006, (sec.deck - sec.bot) * 0.82, 0.008));
    }
    if (!big) {
      const zA = s.aBase - 0.05, zC = s.cBase + 0.05;
      for (const sx of [-1, 1]) {
        const segs = 10;
        for (let i = 0; i < segs; i++) {
          const z0 = zC + ((zA - zC) * i) / segs, z1 = zC + ((zA - zC) * (i + 1)) / segs, zc = (z0 + z1) / 2;
          const q = secAt(zc);
          if (q.top < 0) continue;
          (spec.cls === 'offroad' || spec.cls === 'pickup' ? trim : chrome).push(box(sx * (q.hw * 0.985 + 0.004), q.deck + 0.005, zc, 0.012, 0.02, z1 - z0 + 0.01));
        }
      }
    }
    // sills between the arches, and the arch liners (dark, so the wheels sit in wells, not on a flat side)
    const axlesAll = [m.axleF, m.axleR, ...(m.extraAxles ?? [])].sort((a, b) => b - a);
    for (const sx of [-1, 1]) {
      for (let i = 0; i < axlesAll.length - 1; i++) {
        const z0 = axlesAll[i + 1] + m.wheelR + 0.12, z1 = axlesAll[i] - m.wheelR - 0.12;
        if (z1 - z0 < 0.3) continue;
        const q = secAt((z0 + z1) / 2);
        trim.push(rbox(sx * (q.hw - 0.01), q.bot + 0.05, (z0 + z1) / 2, 0.05, 0.1, z1 - z0, 0.02));
      }
      for (const az of axlesAll) {
        const q = secAt(az);
        trim.push(archLiner(sx * (q.hw - m.wheelW / 2 - 0.04), m.wheelR, az, m.wheelR + 0.07, m.wheelW + 0.12));
      }
    }
    // ── exhaust: one pipe, or two for the quick ones
    for (const ex of sporty ? [-s.width / 2 + 0.35, s.width / 2 - 0.35] : [-s.width / 2 + 0.4]) {
      chrome.push(cyl(ex, s.clearance + 0.08, surfZ(ex, s.clearance + 0.2, -1) - 0.02, sporty ? 0.05 : 0.035, 0.22, 'z', 14));
      trim.push(cyl(ex, s.clearance + 0.08, surfZ(ex, s.clearance + 0.2, -1) - 0.08, sporty ? 0.04 : 0.028, 0.2, 'z', 12));
    }
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
    // ── doors: the side panel between the screen and the B pillar.
    // The car faces +z, so −x is the driver's side; index 0 is that door, and
    // index 1 the passenger's, so `vehicles.door(car, 0, …)` opens the door the
    // player actually walks up to.
    const dFront = s.aTop + 0.02, dBack = s.doors === 2 ? (s.aTop + s.cTop) / 2 + 0.02 : Math.max(s.cTop, s.aTop - 1.15);
    for (const side of [-1, 1] as (1 | -1)[]) {
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
      // push bar: a frame, so the grille and plate show through
      for (const x of [-s.width * 0.25, s.width * 0.25]) trim.push(rbox(x, s.clearance + 0.36, hL + 0.1, 0.06, 0.5, 0.06, 0.02));
      for (const y of [s.clearance + 0.2, s.clearance + 0.56]) trim.push(rbox(0, y, hL + 0.12, s.width * 0.56, 0.06, 0.06, 0.02));
    }
    if (s.open) {
      // a hoop behind each seat, and the hood folded down behind them
      for (const st of [spec.seat, ...spec.seats]) trim.push(rbox(st.x, s.belt + 0.25, st.z - 0.45, 0.32, 0.36, 0.06, 0.05));
      trim.push(rbox(0, s.belt + 0.04, s.cTop - 0.15, s.width * 0.8, 0.12, 0.5, 0.05));
    }
    if (spec.livery === 'fire' && s.box) {
      // a light bar over the cab, a ladder along the roof, lockers down the sides
      trim.push(rbox(0, s.height + 0.04, s.aTop - 0.4, 1.6, 0.08, 0.3, 0.03));
      beacons.push(rbox(-0.45, s.height + 0.13, s.aTop - 0.4, 0.6, 0.12, 0.26, 0.04), rbox(0.45, s.height + 0.13, s.aTop - 0.4, 0.6, 0.12, 0.26, 0.04));
      const lz0 = -hL + 0.4, lz1 = s.box.from - 0.2;
      for (const sx of [-0.45, 0.45]) chrome.push(box(sx, s.box.height + 0.16, (lz0 + lz1) / 2, 0.06, 0.08, lz1 - lz0));
      for (let z = lz0; z <= lz1; z += 0.35) chrome.push(box(0, s.box.height + 0.16, z, 0.9, 0.035, 0.035));
      for (const sx of [-1, 1]) {
        for (let z = -hL + 0.9; z < s.box.from - 0.6; z += 1.25) chrome.push(rbox(sx * (s.width / 2 + 0.005), s.box.height * 0.5, z, 0.012, s.box.height * 0.55, 1.1, 0.004));
        paint.push(box(sx * (s.width / 2 + 0.008), s.box.height * 0.22, (s.box.from - hL) / 2, 0.008, 0.1, s.box.from + hL - 0.2));
      }
      beacons.push(rbox(-0.9, s.box.height + 0.06, -hL + 0.3, 0.2, 0.12, 0.14, 0.03), rbox(0.9, s.box.height + 0.06, -hL + 0.3, 0.2, 0.12, 0.14, 0.03));
    }
    if (spec.cls === 'refuse' && s.box) {
      // the hopper at the back, its hinge, and the arm that lifts the bins
      trim.push(rbox(0, s.clearance + 1.2, -hL + 0.45, s.width - 0.1, 1.6, 0.9, 0.08));
      chrome.push(cyl(0, s.box.height - 0.2, -hL + 0.9, 0.08, s.width - 0.2, 'x', 12));
      for (const sx of [-1, 1]) trim.push(box(sx * (s.width / 2 - 0.25), s.clearance + 0.6, -hL - 0.05, 0.12, 1.0, 0.12));
    }
    if (spec.livery === 'ambulance' && s.box) {
      beacons.push(box(-0.7, s.box.height + 0.08, s.box.from - 0.2, 0.3, 0.12, 0.14), box(0.7, s.box.height + 0.08, s.box.from - 0.2, 0.3, 0.12, 0.14));
      // a red band down each side
      for (const sx of [-1, 1]) paint.push(box(sx * (s.width / 2 + 0.005), s.box.height * 0.55, (s.box.from - hL) / 2, 0.01, 0.22, s.box.from + hL - 0.2));
    }
  }

  // ── wheels: a tyre with a sidewall and a tread shoulder; a dished rim
  // (a lip, twin spokes, a centre cap and nuts), a disc behind the spokes,
  // and a caliper that stays put while the wheel turns. Axis along x, outer face +x.
  const R = m.wheelR, Wd = m.wheelW;
  const prof: THREE.Vector2[] = [];
  const ri = R * (m.bike ? 0.72 : big0(spec) ? 0.6 : spec.cls === 'sports' || spec.cls === 'muscle' ? 0.74 : 0.68);
  for (let i = 0; i <= 14; i++) {
    const a = -Math.PI / 2 + (i / 14) * Math.PI;
    // a squarer shoulder than a semicircle, and a slight bulge in the sidewall
    const c = Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), 0.55);
    prof.push(new THREE.Vector2(R - 0.04 + 0.04 * c, (Wd / 2) * Math.sin(a) * (1 + 0.04 * Math.cos(a))));
  }
  prof.unshift(new THREE.Vector2(ri, -Wd / 2 + 0.01), new THREE.Vector2(ri + 0.02, -Wd / 2));
  prof.push(new THREE.Vector2(ri + 0.02, Wd / 2), new THREE.Vector2(ri, Wd / 2 - 0.01));
  const tire = new THREE.LatheGeometry(prof, 32);
  tire.rotateZ(Math.PI / 2);
  const spokes = m.bike ? 5 : big0(spec) ? 8 : spec.cls === 'offroad' || spec.cls === 'pickup' ? 6 : 5;
  const face = Wd * 0.32;
  const rimParts: THREE.BufferGeometry[] = [
    // the barrel and the lip
    new THREE.CylinderGeometry(ri, ri, Wd * 0.86, 28, 1, true).rotateZ(Math.PI / 2),
    new THREE.TorusGeometry(ri - 0.008, 0.014, 6, 32).rotateY(Math.PI / 2).translate(Wd * 0.43, 0, 0),
    // the disc and the hub
    cyl(Wd * 0.02, 0, 0, ri * 0.74, 0.025, 'x', 24),
    cyl(face - 0.01, 0, 0, ri * 0.22, 0.04, 'x', 16),
    cyl(face + 0.02, 0, 0, ri * 0.13, 0.03, 'x', 14),
  ];
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    for (const off of big0(spec) || m.bike ? [0] : [-0.09, 0.09]) {
      const aa = a + off;
      // each spoke runs from the hub out to the lip, set back toward the rim at its end (the dish)
      rimParts.push(box(face - 0.012, Math.cos(aa) * ri * 0.58, Math.sin(aa) * ri * 0.58, 0.028, ri * 0.8, big0(spec) ? 0.05 : 0.032, aa));
    }
    // a wheel nut between each pair
    const an = a + Math.PI / spokes;
    rimParts.push(cyl(face + 0.012, Math.cos(an) * ri * 0.16, Math.sin(an) * ri * 0.16, 0.012, 0.025, 'x', 6));
  }
  const rim = merge(rimParts);
  const caliper = merge([rbox(Wd * 0.06, ri * 0.5, -ri * 0.45, 0.07, ri * 0.42, ri * 0.32, 0.02, -0.6)]);
  const wiper = box(0.27, 0, 0, 0.54, 0.018, 0.012);

  const cg: ClassGeo = {
    paint: merge(paint), glass: merge(glass.length ? glass : [box(0, -9, 0, 0.01, 0.01, 0.01)]), trim: merge(trim), chrome: merge(chrome.length ? chrome : [box(0, -9, 0, 0.01, 0.01, 0.01)]),
    interior: merge(interior.length ? interior : [box(0, -9, 0, 0.01, 0.01, 0.01)]), door: doors, tire, rim, caliper, wheelGeo: tire, wiper,
    plates: plates.length ? mergeGeometries(plates, false) : null,
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
  const wear: Wear = { dents: Array.from({ length: DENTS }, () => new THREE.Vector4(0, 0, 0, 0)), dirt: { value: 0.05 }, wet: { value: 0 }, time: { value: 0 }, glassCrack: { value: 0 }, blood: Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 0, 0)) };
  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.06 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0c1014, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.62, clearcoat: 1, clearcoatRoughness: 0.02, side: THREE.DoubleSide, depthWrite: false });
  const trim = new THREE.MeshStandardMaterial({ color: 0x151618, roughness: 0.6, metalness: 0.1 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc8c8cc, roughness: 0.15, metalness: 1 });
  const interior = new THREE.MeshStandardMaterial({ color: 0x1c1b1a, roughness: 0.85 });
  const lamp = (c: number, e: number) => new THREE.MeshStandardMaterial({ color: c, emissive: e, emissiveIntensity: 0, roughness: 0.2 });
  const mats: VehicleMats = {
    paint, glass, trim, chrome, interior,
    head: lamp(0xdad8d0, 0xfff2d8), tail: lamp(0xa0140e, 0xff1a0a), indL: lamp(0x8a5a10, 0xffa020), indR: lamp(0x8a5a10, 0xffa020), reverse: lamp(0xc8c8c8, 0xffffff),
    beacon: spec.livery === 'police' ? [lamp(0x3a0a0a, 0xff2010), lamp(0x0a0a3a, 0x2050ff)] : spec.livery === 'ambulance' || spec.livery === 'fire' ? [lamp(0x3a0a0a, 0xff2010), lamp(0x3a0a0a, 0xff2010)] : [],
    rubber: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 }),
    rim: new THREE.MeshStandardMaterial({ color: spec.cls === 'sports' || spec.cls === 'muscle' ? 0x2a2a2c : spec.cls === 'offroad' || spec.cls === 'armoured' ? 0x3a3a36 : 0xa8a8ac, roughness: 0.28, metalness: 0.9 }),
    caliper: new THREE.MeshStandardMaterial({ color: spec.cls === 'sports' || spec.cls === 'roadster' ? 0xb01a14 : spec.cls === 'muscle' ? 0xc8a020 : 0x3a3a3c, roughness: 0.45, metalness: 0.3 }),
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
  if (cg.plates) mesh(cg.plates, plateMaterial(), false);

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
      // the caliper rides with the steering, not the spin
      if (!m.bike) {
        const cal = new THREE.Mesh(cg.caliper, mats.caliper);
        if (lx < 0) cal.scale.x = -1;
        steer.add(cal);
      }
      root.add(steer);
      wheels.push({ lx, lz: z, r: m.wheelR, steer, spin, front });
    }
  }

  const model: VehicleModel = {
    root, body, spec, wheels, steeringWheel: sw, doors, wipers, mats, wear,
    lampAt: { head: cg.lampAt.head.map((v) => v.clone()), tail: cg.lampAt.tail.map((v) => v.clone()) },
    dispose() {
      // geometry is shared per class; materials are this car's own
      for (const mm of [paint, glass, trim, chrome, interior, mats.head, mats.tail, mats.indL, mats.indR, mats.reverse, mats.rubber, mats.rim, mats.caliper, ...mats.beacon]) mm.dispose();
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
  // The car faces +z, so −x is its right. `indicator` is −1 for a left turn and
  // +1 for a right turn; the lamps are named by the side they sit on.
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

/**
 * A class's shapes for a parked, never-driven car baked into the scenery
 * (the city's static batch): body, glass, trim, lamps and wheels in place,
 * as (kind, geometry) pairs in car-local space. Shared; never freed.
 */
const STATIC = new Map<string, { kind: 'paint' | 'glass' | 'trim' | 'chrome' | 'interior' | 'head' | 'tail' | 'rubber' | 'rim'; geo: THREE.BufferGeometry }[]>();
export function staticVehicleParts(spec: VehicleSpec) {
  const have = STATIC.get(spec.cls);
  if (have) return have;
  const cg = classGeo(spec);
  const out: { kind: 'paint' | 'glass' | 'trim' | 'chrome' | 'interior' | 'head' | 'tail' | 'rubber' | 'rim'; geo: THREE.BufferGeometry }[] = [
    { kind: 'paint', geo: cg.paint }, { kind: 'glass', geo: cg.glass }, { kind: 'trim', geo: cg.trim }, { kind: 'chrome', geo: cg.chrome },
    { kind: 'interior', geo: cg.interior }, { kind: 'head', geo: cg.lamps.head }, { kind: 'tail', geo: cg.lamps.tail },
  ];
  const m = spec.mech;
  const axles = [m.axleF, m.axleR, ...(m.extraAxles ?? [])];
  const tires: THREE.BufferGeometry[] = [], rims: THREE.BufferGeometry[] = [], cals: THREE.BufferGeometry[] = [];
  for (const z of axles) for (const lx of m.bike ? [0] : [-m.track / 2, m.track / 2]) {
    tires.push(cg.tire.clone().translate(lx, m.wheelR, z));
    // mirrored for the left-hand side, with the winding put back so it isn't inside out
    const r = cg.rim.clone();
    const c = cg.caliper.clone();
    rims.push((lx < 0 ? flipWinding(r.scale(-1, 1, 1)) : r).translate(lx, m.wheelR, z));
    if (!m.bike) cals.push((lx < 0 ? flipWinding(c.scale(-1, 1, 1)) : c).translate(lx, m.wheelR, z));
  }
  out.push({ kind: 'rubber', geo: merge(tires) }, { kind: 'rim', geo: merge(rims) });
  if (cals.length) out.push({ kind: 'trim', geo: merge(cals) });
  STATIC.set(spec.cls, out);
  return out;
}

/**
 * Someone hit by this car: blood on the bodywork where they struck it
 * (`dx, dz` world offset from the car to them, `yaw` the car's heading).
 * Rain washes it off slowly (the wear shader thins it when wet).
 */
export function bloody(v: VehicleModel, dx: number, dz: number, yaw: number, amount: number) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const lz = dx * fx + dz * fz, lx = dx * fz - dz * fx;
  const slot = v.wear.blood.find((b) => b.w <= 0) ?? v.wear.blood.reduce((a, b) => (b.w < a.w ? b : a));
  slot.set(lx * 0.6, 0.75, lz * 0.9, Math.min(1, amount));
}
