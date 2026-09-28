import * as THREE from 'three';
import type { WorldContext } from '../WorldContext';
import type { Rng } from '../rng';

/* Primitive geometries shared by every prop (base-anchored where noted). */
export const G = {
  box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10, 1).translate(0, 0.5, 0),
  cylHi: new THREE.CylinderGeometry(1, 1, 1, 18, 1).translate(0, 0.5, 0),
  taper: new THREE.CylinderGeometry(0.6, 1, 1, 8, 1).translate(0, 0.5, 0),
  sphere: new THREE.SphereGeometry(1, 12, 8),
  wheel: new THREE.CylinderGeometry(1, 1, 1, 14, 1).rotateZ(Math.PI / 2),
};

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
export function M(x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(sx, sy, sz));
}
/** Compose a local transform under a parent (position + yaw). */
export function under(parent: THREE.Matrix4, local: THREE.Matrix4) {
  return new THREE.Matrix4().multiplyMatrices(parent, local);
}

/* ── lighting fixtures ─────────────────────────────────────── */

/** Avenue lamp: iron column, swan-neck arm, sodium lantern. `dir` = arm direction in x. */
export function avenueLamp(ctx: WorldContext, x: number, z: number, dir: number, y0 = 0.15) {
  const { mats, batch } = ctx;
  batch.add(mats.iron, G.cyl, M(x, y0, z, 0.2, 0.5, 0.2));
  batch.add(mats.iron, G.cyl, M(x, y0, z, 0.09, 7.4, 0.09));
  batch.add(mats.iron, G.box, M(x + dir * 0.9, y0 + 7.2, z, 1.9, 0.08, 0.08));
  batch.add(mats.iron, G.box, M(x + dir * 1.75, y0 + 6.95, z, 0.5, 0.25, 0.38));
  batch.add(mats.lampWarm, G.box, M(x + dir * 1.75, y0 + 6.86, z, 0.36, 0.1, 0.26), { cast: false });
  ctx.collision.addCentered(x, y0, z, 0.3, 7, 0.3, false);
  return ctx.lamp(new THREE.Vector3(x + dir * 1.75, y0 + 6.75, z), 'warm', { ground: 0, intensity: 70, range: 26 });
}

/** Ornate riverside lamp: fluted post, glass lantern. */
export function lanternLamp(ctx: WorldContext, x: number, z: number, y0 = 0.15, kind: 'warm' | 'cold' = 'warm') {
  const { mats, batch } = ctx;
  batch.add(mats.iron, G.taper, M(x, y0, z, 0.22, 0.9, 0.22));
  batch.add(mats.iron, G.cyl, M(x, y0 + 0.9, z, 0.07, 3.1, 0.07));
  batch.add(mats.iron, G.box, M(x, y0 + 4.0, z, 0.5, 0.06, 0.5));
  batch.add(kind === 'warm' ? mats.lampWarm : mats.lampCold, G.box, M(x, y0 + 4.06, z, 0.34, 0.55, 0.34), { cast: false });
  batch.add(mats.iron, G.taper, M(x, y0 + 4.6, z, 0.3, 0.3, 0.3));
  ctx.collision.addCentered(x, y0, z, 0.4, 4, 0.4, false);
  return ctx.lamp(new THREE.Vector3(x, y0 + 4.3, z), kind, { ground: y0, intensity: 38, range: 18 });
}

/** Wall-mounted bracket lamp. `nx,nz` = wall normal. */
export function wallLamp(ctx: WorldContext, x: number, y: number, z: number, nx: number, nz: number, kind: 'warm' | 'cold' = 'warm', ground = 0.15) {
  const { mats, batch } = ctx;
  batch.add(mats.iron, G.box, M(x + nx * 0.3, y + 0.25, z + nz * 0.3, Math.abs(nz) * 0.05 + Math.abs(nx) * 0.6, 0.05, Math.abs(nx) * 0.05 + Math.abs(nz) * 0.6));
  batch.add(kind === 'warm' ? mats.lampWarm : mats.lampCold, G.box, M(x + nx * 0.55, y - 0.05, z + nz * 0.55, 0.22, 0.3, 0.22), { cast: false });
  return ctx.lamp(new THREE.Vector3(x + nx * 0.55, y - 0.15, z + nz * 0.55), kind, { ground, intensity: 22, range: 14, halo: 0.7 });
}

/** Tall yard floodlight (cold LED). */
export function floodPole(ctx: WorldContext, x: number, z: number, ry = 0) {
  const { mats, batch } = ctx;
  batch.add(mats.metal, G.cyl, M(x, 0, z, 0.16, 12, 0.16));
  const f = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
  batch.add(mats.metal, G.box, M(x + f.x * 0.4, 11.8, z + f.z * 0.4, 1.4, 0.5, 0.5, ry));
  batch.add(mats.lampCold, G.box, M(x + f.x * 0.66, 11.72, z + f.z * 0.66, 1.2, 0.08, 0.3, ry), { cast: false });
  ctx.collision.addCentered(x, 0, z, 0.4, 12, 0.4, false);
  return ctx.lamp(new THREE.Vector3(x + f.x * 0.8, 11.5, z + f.z * 0.8), 'cold', { ground: 0, intensity: 150, range: 38, halo: 1.3 });
}

/* ── street furniture ──────────────────────────────────────── */

export function bench(ctx: WorldContext, x: number, z: number, ry: number, y0 = 0.15) {
  const { mats, batch } = ctx;
  const P = M(x, y0, z, 1, 1, 1, ry);
  for (let i = 0; i < 4; i++) batch.add(mats.wood, G.box, under(P, M(0, 0.44, -0.12 + i * 0.1, 1.8, 0.04, 0.08)));
  for (let i = 0; i < 3; i++) batch.add(mats.wood, G.box, under(P, M(0, 0.62 + i * 0.13, 0.26, 1.8, 0.08, 0.035, 0, -0.18)));
  for (const s of [-0.8, 0.8]) {
    batch.add(mats.iron, G.box, under(P, M(s, 0, 0.05, 0.06, 0.44, 0.5)));
    batch.add(mats.iron, G.box, under(P, M(s, 0.44, 0.27, 0.06, 0.5, 0.05, 0, -0.18)));
  }
  const c = new THREE.Vector3(0, 0, 0).applyMatrix4(P);
  ctx.collision.addCentered(c.x, y0, c.z, Math.abs(Math.cos(ry)) * 1.8 + Math.abs(Math.sin(ry)) * 0.6, 0.5, Math.abs(Math.sin(ry)) * 1.8 + Math.abs(Math.cos(ry)) * 0.6, false);
}

export function bin(ctx: WorldContext, x: number, z: number, y0 = 0.15) {
  ctx.batch.add(ctx.mats.iron, G.cyl, M(x, y0, z, 0.3, 0.95, 0.3));
  ctx.batch.add(ctx.mats.iron, G.cyl, M(x, y0 + 0.95, z, 0.34, 0.06, 0.34));
  ctx.collision.addCentered(x, y0, z, 0.6, 1, 0.6, false);
}

export function bollard(ctx: WorldContext, x: number, z: number, y0 = 0.15) {
  ctx.batch.add(ctx.mats.iron, G.cyl, M(x, y0, z, 0.1, 0.9, 0.1));
  ctx.batch.add(ctx.mats.iron, G.sphere, M(x, y0 + 0.92, z, 0.12, 0.08, 0.12));
  ctx.collision.addCentered(x, y0, z, 0.25, 1, 0.25, false);
}

/** Bare winter tree in an iron grate. */
export function tree(ctx: WorldContext, x: number, z: number, rng: Rng, y0 = 0.15, scale = 1) {
  const { mats, batch } = ctx;
  batch.add(mats.iron, G.box, M(x, y0, z, 1.6, 0.03, 1.6), { cast: false });
  const bark = mats.darkStone;
  const grow = (base: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, depth: number) => {
    const end = base.clone().addScaledVector(dir, len);
    const mid = base.clone().add(end).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const m = new THREE.Matrix4().compose(mid.clone().addScaledVector(dir, -len / 2), q, new THREE.Vector3(rad, len, rad));
    batch.add(bark, G.taper, m, { cast: depth < 2 });
    if (depth >= 3) return;
    const kids = depth === 0 ? rng.int(3, 4) : rng.int(2, 3);
    for (let i = 0; i < kids; i++) {
      const d = dir
        .clone()
        .add(new THREE.Vector3(rng.range(-0.9, 0.9), rng.range(0.1, 0.6), rng.range(-0.9, 0.9)))
        .normalize();
      grow(end, d, len * rng.range(0.55, 0.75), rad * 0.6, depth + 1);
    }
  };
  grow(new THREE.Vector3(x, y0, z), new THREE.Vector3(0, 1, 0), 3.2 * scale, 0.16 * scale, 0);
  ctx.collision.addCentered(x, y0, z, 0.4, 3, 0.4, false);
}

export function streetSign(ctx: WorldContext, tex: THREE.Texture, x: number, z: number, ry: number) {
  ctx.batch.add(ctx.mats.iron, G.cyl, M(x, 0.15, z, 0.05, 3.1, 0.05));
  ctx.decal(tex, x, 3.0, z, 1.3, 0.32, ry, { doubleSided: true });
}

/** Flashing-amber night signal on a pole. */
export function signal(ctx: WorldContext, x: number, z: number, ry: number) {
  const { mats, batch } = ctx;
  batch.add(mats.iron, G.cyl, M(x, 0.15, z, 0.08, 3.4, 0.08));
  const P = M(x, 3.55, z, 1, 1, 1, ry);
  batch.add(mats.iron, G.box, under(P, M(0, -0.5, 0, 0.32, 1.0, 0.24)));
  batch.add(mats.darkGlass, G.box, under(P, M(0, 0.12 - 0.5, 0.125, 0.16, 0.16, 0.02)), { cast: false });
  batch.add(mats.darkGlass, G.box, under(P, M(0, -0.18 - 0.5 + 0.3, 0.125, 0.16, 0.16, 0.02)), { cast: false });
  batch.add(mats.signalAmber, G.box, under(P, M(0, -0.2, 0.125, 0.16, 0.16, 0.02)), { cast: false });
  ctx.collision.addCentered(x, 0.15, z, 0.3, 3.4, 0.3, false);
  const p = new THREE.Vector3(0, -0.12, 0.3).applyMatrix4(P);
  const l = ctx.lamp(p, 'amber', { pooled: false, cone: false, halo: 0.55, streak: 0.6, ground: 0 });
  l.flicker = 1; // blink
  return l;
}

export function manhole(ctx: WorldContext, x: number, z: number) {
  ctx.batch.add(ctx.mats.iron, G.cylHi, M(x, -0.004, z, 0.42, 0.012, 0.42), { cast: false });
}

/* ── vehicles ──────────────────────────────────────────────── */

export const CAR_COLORS = [0x1a1c1f, 0x2b2f33, 0x3a3027, 0x1c2430, 0x4a4843, 0x2e1b18, 0x5a5448, 0x121314];

/** Adds a parked car to the static batch, returns its headlight positions (local). */
export function parkedCar(ctx: WorldContext, x: number, z: number, ry: number, color: number, opts: { lights?: boolean; dome?: boolean; van?: boolean; drive?: boolean; screen?: boolean } = {}) {
  if (opts.drive) {
    // the electric ones are pearl white, and have a screen on the dash
    ctx.cars.push({ pos: new THREE.Vector3(x, 0, z), yaw: ry, color: opts.screen ? 0xcfd0cc : color, van: !!opts.van, screen: !!opts.screen });
    return;
  }
  const P = M(x, 0, z, 1, 1, 1, ry);
  for (const part of carParts(color, opts.van)) ctx.batch.add(part.mat(ctx), part.geo, under(P, part.m), { color: part.color });
  ctx.collision.add(...footprint(x, z, ry, opts.van ? 2.1 : 1.9, opts.van ? 5.2 : 4.5, opts.van ? 2.4 : 1.5));
  if (opts.dome) {
    ctx.lamp(new THREE.Vector3(0, 1.3, 0.2).applyMatrix4(P), 'interior', { pooled: false, cone: false, halo: 0.35, streak: 0.2, ground: 0 });
  }
  if (opts.lights) {
    for (const s of [-0.6, 0.6]) {
      ctx.lamp(new THREE.Vector3(s, 0.72, 2.28).applyMatrix4(P), 'cold', { pooled: false, cone: false, halo: 0.8, streak: 1.4, ground: 0 });
      ctx.lamp(new THREE.Vector3(s, 0.8, -2.25).applyMatrix4(P), 'red', { pooled: false, cone: false, halo: 0.45, streak: 0.6, ground: 0 });
    }
  }
}

function footprint(x: number, z: number, ry: number, w: number, l: number, h: number): [number, number, number, number, number, number] {
  const along = Math.abs(Math.sin(ry)) > 0.7;
  const hw = (along ? l : w) / 2, hd = (along ? w : l) / 2;
  return [x - hw, 0, z - hd, x + hw, h, z + hd];
}

export interface CarPart {
  geo: THREE.BufferGeometry;
  m: THREE.Matrix4;
  mat: (ctx: WorldContext) => THREE.Material;
  color?: number;
  kind: 'paint' | 'glass' | 'dark' | 'head' | 'tail' | 'seat';
}

/**
 * Windows on the cars people drive and ride in: dark, but you can see who's
 * at the wheel. (Parked scenery cars keep opaque glass: nobody's inside.)
 */
export const CAR_GLASS = new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.05, metalness: 0.55, transparent: true, opacity: 0.5, depthWrite: false });

/** Where people sit, in car space (facing +z, the car's right is +x). */
export const SEATS = {
  driver: new THREE.Vector3(-0.4, 0.2, -0.05),
  front: new THREE.Vector3(0.4, 0.2, -0.05),
  back: new THREE.Vector3(0.38, 0.2, -1.05),
  wheel: new THREE.Vector3(-0.4, 0.95, 0.42),
};

/** Car made of a few boxes, facing +z, origin at ground centre. */
export function carParts(color: number, van = false): CarPart[] {
  const L = van ? 5.0 : 4.4;
  const parts: CarPart[] = [
    { kind: 'paint', geo: G.box, m: M(0, 0.32, 0, 1.78, van ? 1.5 : 0.62, L), mat: (c) => c.mats.paint, color },
    { kind: 'paint', geo: G.box, m: van ? M(0, 1.82, -0.35, 1.72, 0.5, L - 1.2) : M(0, 0.94, -0.25, 1.58, 0.52, 2.3), mat: (c) => c.mats.paint, color },
    { kind: 'glass', geo: G.box, m: van ? M(0, 1.3, L / 2 - 0.95, 1.7, 0.6, 0.35, 0, -0.35) : M(0, 0.95, -0.25, 1.62, 0.44, 2.36), mat: (c) => c.mats.darkGlass },
    { kind: 'dark', geo: G.box, m: M(0, 0.2, L / 2 - 0.05, 1.7, 0.2, 0.12), mat: (c) => c.mats.rubber },
    { kind: 'head', geo: G.box, m: M(-0.62, 0.62, L / 2, 0.36, 0.12, 0.05), mat: (c) => c.mats.lampCold },
    { kind: 'head', geo: G.box, m: M(0.62, 0.62, L / 2, 0.36, 0.12, 0.05), mat: (c) => c.mats.lampCold },
    { kind: 'tail', geo: G.box, m: M(-0.68, 0.72, -L / 2, 0.3, 0.1, 0.05), mat: (c) => c.mats.lampRed },
    { kind: 'tail', geo: G.box, m: M(0.68, 0.72, -L / 2, 0.3, 0.1, 0.05), mat: (c) => c.mats.lampRed },
  ];
  for (const sx of [-0.82, 0.82]) for (const sz of [-L / 2 + 0.85, L / 2 - 0.85]) parts.push({ kind: 'dark', geo: G.wheel, m: M(sx, 0.33, sz, 0.18, 0.33, 0.33), mat: (c) => c.mats.rubber });
  if (!van) {
    // seats and a wheel, seen through the glass
    for (const x of [-0.4, 0.4]) parts.push({ kind: 'seat', geo: G.box, m: M(x, 0.62, -0.42, 0.5, 0.62, 0.12, 0, -0.18), mat: (c) => c.mats.rubber });
    parts.push({ kind: 'seat', geo: G.box, m: M(0, 0.62, -1.42, 1.4, 0.55, 0.12, 0, -0.12), mat: (c) => c.mats.rubber });
    parts.push({ kind: 'seat', geo: G.cyl, m: M(SEATS.wheel.x, SEATS.wheel.y - 0.02, SEATS.wheel.z, 0.19, 0.03, 0.19, 0, -1.1), mat: (c) => c.mats.rubber });
  }
  return parts;
}

/* ── market / yard clutter ─────────────────────────────────── */

export function crate(ctx: WorldContext, x: number, y: number, z: number, s: number, ry: number, collide = true) {
  ctx.batch.add(ctx.mats.wood, G.box, M(x, y, z, s, s * 0.8, s, ry));
  if (collide) ctx.collision.addCentered(x, y, z, s, s * 0.8, s, false);
}

export function barrel(ctx: WorldContext, x: number, z: number, color: number, y0 = 0) {
  ctx.batch.add(ctx.mats.paint, G.cyl, M(x, y0, z, 0.3, 0.9, 0.3), { color });
  ctx.batch.add(ctx.mats.iron, G.cyl, M(x, y0 + 0.3, z, 0.31, 0.04, 0.31));
  ctx.collision.addCentered(x, y0, z, 0.6, 0.9, 0.6, false);
}

export function pallet(ctx: WorldContext, x: number, z: number, ry: number, stack = 1) {
  for (let i = 0; i < stack; i++) ctx.batch.add(ctx.mats.wood, G.box, M(x, i * 0.15, z, 1.2, 0.13, 1.0, ry));
  ctx.collision.addCentered(x, 0, z, 1.2, stack * 0.15, 1.2, false);
}

/** Fence panel (posts + mesh as thin dark slab). */
export function fence(ctx: WorldContext, x0: number, z0: number, x1: number, z1: number, h = 2.6) {
  const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), ry = Math.atan2(dx, dz);
  const n = Math.ceil(len / 3);
  for (let i = 0; i <= n; i++) ctx.batch.add(ctx.mats.metal, G.cyl, M(x0 + (dx * i) / n, 0, z0 + (dz * i) / n, 0.04, h, 0.04));
  ctx.batch.add(ctx.mats.metal, G.box, M((x0 + x1) / 2, h - 0.04, (z0 + z1) / 2, 0.04, 0.04, len, ry));
  ctx.batch.add(ctx.mats.metal, G.box, M((x0 + x1) / 2, 0.1, (z0 + z1) / 2, 0.03, 0.04, len, ry));
  ctx.batch.add(fenceMesh(ctx), G.box, M((x0 + x1) / 2, 0.1, (z0 + z1) / 2, 0.02, h - 0.14, len, ry), { cast: false });
  ctx.collision.add(Math.min(x0, x1) - 0.1, 0, Math.min(z0, z1) - 0.1, Math.max(x0, x1) + 0.1, h, Math.max(z0, z1) + 0.1, false);
}

let _fenceMat: THREE.Material | null = null;
function fenceMesh(ctx: WorldContext) {
  if (_fenceMat) return _fenceMat;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(150,150,150,1)';
  g.lineWidth = 2;
  for (let i = -64; i < 128; i += 16) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 64, 64);
    g.moveTo(i + 64, 0);
    g.lineTo(i, 64);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(40, 4);
  _fenceMat = new THREE.MeshStandardMaterial({ color: 0x777b7e, map: t, alphaMap: t, transparent: true, alphaTest: 0.3, metalness: 0.7, roughness: 0.5, side: THREE.DoubleSide });
  return _fenceMat;
}
