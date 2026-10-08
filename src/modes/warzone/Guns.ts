import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Gun } from './weapons';
import type { Rig } from '../../entities/Humanoid';

/**
 * The guns, built from what they are: a receiver, a barrel of the right
 * bore, a handguard, the stock and magazine the weapon (or its attachments)
 * calls for, sights or an optic, a muzzle device, a grip or a bipod under
 * it. Each is one geometry with its colours in the vertices (gunmetal,
 * polymer, wood, glass), so a gun is one draw however it's dressed.
 *
 * Gun space: the grip at the origin, the bore along +z, up is +y. The model
 * says where its muzzle is, how high its sight line sits (so aiming puts it
 * dead centre) and where the off hand holds it.
 */

export interface GunModel {
  geo: THREE.BufferGeometry;
  /** the end of the bore */
  muzzle: THREE.Vector3;
  /** the sight line's height over the grip */
  sight: number;
  /** where the left hand holds it, along +z */
  fore: number;
  /** a one-handed weapon (pistols, blades) */
  oneHand: boolean;
  /** side-view rectangles for the gunsmith's drawing: [z0, y0, z1, y1, colour] */
  profile: [number, number, number, number, number][];
}

const C = {
  metal: 0x1d1e21,
  dark: 0x111214,
  steel: 0x3a3c40,
  black: 0x232427,
  tan: 0x8c7552,
  wood: 0x5a3a22,
  grey: 0x4a4d52,
  green: 0x3d4632,
  glass: 0x1a2a38,
  red: 0xd02020,
  blade: 0x9aa0a6,
};

class Builder {
  parts: THREE.BufferGeometry[] = [];
  profile: GunModel['profile'] = [];
  private col = new THREE.Color();

  private paint(g: THREE.BufferGeometry, hex: number) {
    this.col.setHex(hex).convertSRGBToLinear();
    const n = g.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([this.col.r, this.col.g, this.col.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    g.deleteAttribute('uv');
    this.parts.push(g);
    return g;
  }

  /** a box, centred at (x, y, z), tipped about x by rx */
  box(w: number, h: number, d: number, x: number, y: number, z: number, hex: number, rx = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    g.translate(x, y, z);
    this.paint(g, hex);
    if (!x) {
      const ex = Math.abs(Math.sin(rx)) * h / 2 + Math.abs(Math.cos(rx)) * d / 2, ey = Math.abs(Math.cos(rx)) * h / 2 + Math.abs(Math.sin(rx)) * d / 2;
      this.profile.push([z - ex, y - ey, z + ex, y + ey, hex]);
    }
  }

  /** a cylinder along +z from z0 to z1 at height y */
  tube(r: number, z0: number, z1: number, y: number, hex: number, seg = 10, x = 0, r1 = r) {
    const g = new THREE.CylinderGeometry(r1, r, z1 - z0, seg).rotateX(Math.PI / 2).translate(x, y, (z0 + z1) / 2);
    this.paint(g, hex);
    if (!x) this.profile.push([z0, y - Math.max(r, r1), z1, y + Math.max(r, r1), hex]);
  }

  /** a disc on its side (a drum magazine), axis along x */
  drum(r: number, w: number, y: number, z: number, hex: number) {
    const g = new THREE.CylinderGeometry(r, r, w, 16).rotateZ(Math.PI / 2).translate(0, y, z);
    this.paint(g, hex);
    this.profile.push([z - r, y - r, z + r, y + r, hex]);
  }

  done() {
    const g = mergeGeometries(this.parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
    for (const p of this.parts) p.dispose();
    return g;
  }
}

const TONE: Record<string, number> = { black: C.black, tan: C.tan, wood: C.wood, grey: C.grey, green: C.green };

/** Build a gun's model from its look. */
export function buildGun(gun: Gun): GunModel {
  const L = gun.look, b = new Builder();
  const body = TONE[L.tone ?? 'black'] ?? C.black;
  const furn = L.stock === 'wood' || L.tone === 'wood' ? C.wood : body;
  if (gun.cls === 'melee') return melee(gun, b);
  const pistol = gun.cls === 'pistol' || gun.cls === 'revolver';
  if (pistol) return sidearm(gun, b, body);
  const bore = Math.max(0.011, L.bore * 1.5);
  const launcher = gun.cls === 'launcher';
  const recv = L.receiver;
  // the receiver: a bullpup carries most of it behind the grip
  const r0 = L.bullpup ? -recv * 0.62 : -0.07, r1 = r0 + recv;
  const rh = launcher ? 0.07 : 0.085, ry = 0.035;
  if (launcher && gun.id === 'thresher') {
    // a launch tube on the shoulder
    b.tube(0.05, -0.55, 0.6, 0.07, C.green, 14);
    b.tube(0.058, 0.52, 0.62, 0.07, C.dark, 14);
    b.tube(0.058, -0.6, -0.5, 0.07, C.dark, 14);
    b.box(0.03, 0.1, 0.045, 0, -0.04, -0.01, C.black, -0.25);
    b.box(0.03, 0.09, 0.04, 0, -0.03, 0.22, C.black);
    b.box(0.03, 0.06, 0.08, -0.06, 0.12, 0.05, C.steel);
    return out(b, new THREE.Vector3(0, 0.07, 0.62), 0.14, 0.22, false);
  }
  b.box(0.055, rh, recv, 0, ry, (r0 + r1) / 2, body);
  b.box(0.05, 0.02, recv * 0.9, 0, ry + rh / 2 + 0.008, (r0 + r1) / 2, C.metal);
  // handguard and barrel
  const hg0 = r1, hg1 = r1 + L.handguard;
  if (L.handguard > 0) b.box(0.05, 0.052, L.handguard, 0, 0.042, (hg0 + hg1) / 2, furn);
  const bz1 = r1 + Math.max(L.barrel, L.handguard + 0.04);
  b.tube(bore, r1, bz1, 0.05, C.metal);
  let mz = bz1;
  if (gun.cls === 'shotgun' && L.mag === 'tube') b.tube(0.017, r1, r1 + L.barrel * 0.85, 0.016, C.metal);
  if (gun.cls === 'shotgun' && gun.mode === 'pump') b.box(0.052, 0.05, 0.14, 0, 0.018, r1 + L.barrel * 0.42, furn);
  if (gun.id === 'twinbore') b.tube(bore, r1, bz1, 0.05 + bore * 2.1, C.metal);
  // the muzzle device
  if (L.muzzle) {
    const [len, rr] = L.muzzle;
    b.tube(rr, mz, mz + len, 0.05, C.dark, 12);
    mz += len;
  } else if (!launcher) b.tube(bore * 1.25, mz, mz + 0.025, 0.05, C.dark);
  // grip, trigger guard
  const gz = L.bullpup ? 0.02 : -0.01;
  b.box(0.034, 0.105, 0.045, 0, -0.05, gz, furn === C.wood ? C.wood : C.black, -0.3);
  b.box(0.012, 0.012, 0.07, 0, -0.012, gz + 0.04, C.metal);
  // the magazine
  const mzc = L.bullpup ? r0 + 0.08 : Math.min(r1 - 0.06, 0.12);
  const ms = L.magScale;
  switch (L.mag) {
    case 'box': b.box(0.034, 0.15 * ms, 0.06, 0, -0.07 * ms, mzc, C.black, 0.1); break;
    case 'curved':
      b.box(0.034, 0.09 * ms, 0.062, 0, -0.04 * ms, mzc, C.black, 0.12);
      b.box(0.034, 0.08 * ms, 0.058, 0, -0.11 * ms, mzc + 0.03 * ms, C.black, 0.42);
      break;
    case 'drum': b.drum(0.075, 0.06, -0.075, mzc, C.black); break;
    case 'top': b.box(0.06, 0.02, recv * 0.7, 0, ry + rh / 2 + 0.03, (r0 + r1) / 2, C.black); break;
    case 'belt':
      b.box(0.08, 0.1, 0.1, -0.05, -0.04, mzc, C.green);
      b.box(0.02, 0.03, 0.08, -0.02, 0.03, mzc, C.steel);
      break;
    case 'cylinder': b.tube(0.06, mzc - 0.05, mzc + 0.05, 0.0, C.steel, 6); break;
    case 'tube': break;
    default: break;
  }
  // the stock
  const s0 = L.bullpup ? r0 : r0;
  switch (L.stock) {
    case 'fixed': case 'wood':
      b.box(0.045, 0.085, 0.24, 0, 0.0, s0 - 0.12, furn, -0.06);
      b.box(0.048, 0.11, 0.025, 0, -0.012, s0 - 0.245, C.dark);
      break;
    case 'folding':
      b.tube(0.008, s0 - 0.22, s0, 0.045, C.steel, 6);
      b.tube(0.008, s0 - 0.22, s0, -0.005, C.steel, 6);
      b.box(0.04, 0.09, 0.02, 0, 0.02, s0 - 0.225, C.black);
      break;
    case 'skeleton':
      b.box(0.02, 0.012, 0.22, 0, 0.05, s0 - 0.11, body);
      b.box(0.02, 0.012, 0.2, 0, -0.01, s0 - 0.1, body, 0.15);
      b.box(0.035, 0.1, 0.02, 0, 0.02, s0 - 0.22, C.black);
      break;
    case 'thumbhole':
      b.box(0.045, 0.04, 0.26, 0, 0.045, s0 - 0.13, furn);
      b.box(0.045, 0.035, 0.22, 0, -0.035, s0 - 0.13, furn, 0.12);
      b.box(0.048, 0.12, 0.03, 0, 0.005, s0 - 0.26, C.dark);
      break;
    default: break;
  }
  // underbarrel
  const fore = Math.min(hg1 - 0.05, r1 + Math.max(0.12, L.handguard * 0.55));
  switch (L.under) {
    case 'vgrip': b.box(0.03, 0.09, 0.034, 0, -0.025, fore, C.black); break;
    case 'angled': b.box(0.03, 0.05, 0.08, 0, 0.0, fore, C.black, 0.6); break;
    case 'bipod':
      b.tube(0.007, fore - 0.02, fore + 0.2, 0.0, C.steel, 6, 0.018);
      b.tube(0.007, fore - 0.02, fore + 0.2, 0.0, C.steel, 6, -0.018);
      break;
    case 'launcher': b.tube(0.022, fore - 0.05, fore + 0.18, -0.005, C.green); break;
    default: break;
  }
  if (L.laser) {
    b.box(0.022, 0.026, 0.06, 0.038, 0.04, Math.min(hg1, r1 + 0.1) - 0.04, C.black);
    b.box(0.008, 0.008, 0.004, 0.038, 0.04, Math.min(hg1, r1 + 0.1) - 0.008, C.red);
  }
  // sights
  const top = ry + rh / 2 + 0.018;
  const oz = L.bullpup ? r0 + recv * 0.55 : (r0 + r1) / 2 + 0.02;
  let sight = top + 0.03;
  switch (L.optic) {
    case 'dot':
      b.box(0.034, 0.012, 0.05, 0, top + 0.006, oz, C.dark);
      b.box(0.03, 0.034, 0.024, 0, top + 0.028, oz, C.dark);
      sight = top + 0.03;
      break;
    case 'holo':
      b.box(0.042, 0.02, 0.08, 0, top + 0.01, oz, C.dark);
      b.box(0.042, 0.042, 0.012, 0, top + 0.04, oz + 0.03, C.dark);
      b.box(0.042, 0.042, 0.012, 0, top + 0.04, oz - 0.03, C.dark);
      sight = top + 0.04;
      break;
    case 'prism': case 'thermal':
      b.box(0.045, 0.05, 0.1, 0, top + 0.028, oz, L.optic === 'thermal' ? C.grey : C.dark);
      sight = top + 0.034;
      break;
    case 'acog':
      b.box(0.03, 0.014, 0.06, 0, top + 0.007, oz, C.dark);
      b.tube(0.02, oz - 0.06, oz + 0.07, top + 0.035, C.dark, 12, 0, 0.024);
      sight = top + 0.035;
      break;
    case 'scope':
      b.box(0.02, 0.03, 0.03, 0, top + 0.012, oz - 0.05, C.dark);
      b.box(0.02, 0.03, 0.03, 0, top + 0.012, oz + 0.05, C.dark);
      b.tube(0.017, oz - 0.12, oz + 0.12, top + 0.045, C.dark, 12);
      b.tube(0.022, oz - 0.18, oz - 0.1, top + 0.045, C.dark, 12, 0, 0.017);
      b.tube(0.017, oz + 0.1, oz + 0.2, top + 0.045, C.dark, 12, 0, 0.027);
      sight = top + 0.045;
      break;
    default:
      // irons: a rear notch over the receiver, a post out on the barrel
      b.box(0.026, 0.022, 0.016, 0, top + 0.008, r1 - 0.04, C.metal);
      b.box(0.006, 0.03, 0.01, 0, 0.088, Math.min(bz1 - 0.03, hg1), C.metal);
      sight = top + 0.016;
  }
  return out(b, new THREE.Vector3(0, 0.05, mz), sight, fore, false);
}

function sidearm(gun: Gun, b: Builder, body: number): GunModel {
  const L = gun.look;
  const rev = gun.cls === 'revolver';
  const len = L.receiver + L.barrel * 0.5;
  if (rev) {
    b.box(0.032, 0.05, 0.08, 0, 0.045, 0.02, C.steel);
    b.tube(0.03, 0.0, 0.07, 0.035, C.steel, 6);
    b.tube(Math.max(0.01, L.bore * 1.1), 0.06, 0.06 + L.barrel, 0.06, C.steel);
    b.box(0.014, 0.018, L.barrel, 0, 0.075, 0.06 + L.barrel / 2, C.steel);
  } else {
    b.box(0.03, 0.04, len, 0, 0.05, len / 2 - 0.04, body === C.black ? C.dark : body);
    b.box(0.028, 0.02, len * 0.85, 0, 0.022, len / 2 - 0.04, C.black);
  }
  const ms = L.magScale;
  b.box(0.03, 0.1, 0.045, 0, -0.01, -0.01, rev ? C.wood : C.black, -0.25);
  if (!rev && ms > 1) b.box(0.028, 0.06 * (ms - 1) + 0.02, 0.04, 0, -0.07 - 0.03 * (ms - 1), -0.025, C.black, -0.25);
  b.box(0.01, 0.01, 0.05, 0, 0.0, 0.03, C.metal);
  let mz = rev ? 0.06 + L.barrel : len - 0.04;
  if (L.muzzle) {
    b.tube(L.muzzle[1], mz, mz + L.muzzle[0], 0.05, C.dark, 12);
    mz += L.muzzle[0];
  }
  let sight = 0.078;
  if (L.optic === 'dot') {
    b.box(0.026, 0.026, 0.03, 0, 0.088, 0.02, C.dark);
    sight = 0.094;
  } else {
    b.box(0.02, 0.01, 0.01, 0, 0.074, -0.02, C.metal);
    b.box(0.005, 0.012, 0.008, 0, 0.074, mz - 0.02, C.metal);
  }
  if (L.laser) b.box(0.02, 0.022, 0.04, 0, 0.0, 0.08, C.black);
  return out(b, new THREE.Vector3(0, 0.05, mz), sight, 0, true);
}

function melee(gun: Gun, b: Builder): GunModel {
  if (gun.id === 'baton') {
    b.tube(0.016, -0.12, 0.0, 0.0, C.black, 8);
    b.tube(0.013, 0.0, 0.42, 0.0, C.dark, 8);
    return out(b, new THREE.Vector3(0, 0, 0.42), 0, 0, true);
  }
  if (gun.id === 'hatchet') {
    b.tube(0.015, -0.08, 0.3, 0.0, C.black, 8);
    b.box(0.012, 0.1, 0.07, 0, 0.04, 0.27, C.blade);
    b.box(0.014, 0.03, 0.04, 0, -0.03, 0.27, C.dark);
    return out(b, new THREE.Vector3(0, 0.04, 0.3), 0, 0, true);
  }
  b.box(0.026, 0.03, 0.11, 0, 0, -0.02, C.black);
  b.box(0.05, 0.012, 0.01, 0, 0, 0.04, C.dark);
  b.box(0.004, 0.028, 0.17, 0, 0.002, 0.13, C.blade);
  return out(b, new THREE.Vector3(0, 0, 0.22), 0, 0, true);
}

function out(b: Builder, muzzle: THREE.Vector3, sight: number, fore: number, oneHand: boolean): GunModel {
  const profile = b.profile;
  return { geo: b.done(), muzzle, sight, fore, oneHand, profile };
}

/** A model per gun and its attachments, built once. */
const CACHE = new Map<string, GunModel>();
export const gunKey = (g: Gun) => (g.atts.length ? `${g.id}+${g.atts.join('+')}` : g.id);
export function gunModel(g: Gun) {
  const k = gunKey(g);
  let m = CACHE.get(k);
  if (!m) CACHE.set(k, (m = buildGun(g)));
  return m;
}

export const GUN_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.5 });

/** The guns in everyone's hands: one instanced mesh per gun (and dressing) in use. */
export class GunMeshes {
  group = new THREE.Group();
  private meshes = new Map<string, THREE.InstancedMesh>();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private shown: (string | null)[];

  constructor(private capacity: number) {
    this.shown = new Array(capacity).fill(null);
  }

  private mesh(g: Gun) {
    const k = gunKey(g);
    let m = this.meshes.get(k);
    if (!m) {
      m = new THREE.InstancedMesh(gunModel(g).geo, GUN_MAT, this.capacity);
      m.castShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < this.capacity; i++) m.setMatrixAt(i, this.zero);
      this.meshes.set(k, m);
      this.group.add(m);
    }
    return m;
  }

  /** Put gun `g` (or nothing) in slot `i`'s hands. Returns the muzzle, in world space. */
  set(i: number, g: Gun | null, rig: Rig | null, facing: number, out?: THREE.Vector3): THREE.Vector3 | undefined {
    const prev = this.shown[i];
    const key = g ? gunKey(g) : null;
    if (prev && prev !== key) {
      const m = this.meshes.get(prev)!;
      m.setMatrixAt(i, this.zero);
      m.instanceMatrix.needsUpdate = true;
    }
    this.shown[i] = key;
    if (!g || !rig) return;
    const m = this.mesh(g);
    const model = gunModel(g);
    gunMatrix(rig, model.oneHand, facing, _m);
    m.setMatrixAt(i, _m);
    m.instanceMatrix.needsUpdate = true;
    if (out) return out.copy(model.muzzle).applyMatrix4(_m);
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

/** Where a gun sits: from the right hand towards the left (a long gun), or along the body's facing (one hand). */
export function gunMatrix(rig: Rig, oneHand: boolean, facing: number, out: THREE.Matrix4) {
  _r.setFromMatrixPosition(rig.handR);
  _l.setFromMatrixPosition(rig.handL);
  _z.subVectors(_l, _r);
  if (oneHand || _z.lengthSq() < 0.02) _z.set(Math.sin(facing), 0, Math.cos(facing));
  _z.normalize();
  _x.crossVectors(UP, _z);
  if (_x.lengthSq() < 1e-4) _x.set(1, 0, 0);
  _x.normalize();
  _y.crossVectors(_z, _x);
  out.makeBasis(_x, _y, _z).setPosition(_r);
  return out;
}
