import * as THREE from 'three';
import { r, type Rect } from '../layout';
import { G, M } from './props';
import { facadeBox } from './buildings';
import { itex } from '../interiorTextures';
import { tex as ctxTextures } from '../textures';
import type { WorldContext } from '../WorldContext';
import type { Rng } from '../rng';

/**
 * Merrow Savings Bank — a bank you walk into.
 *
 * Every other interior in NIGHTFALL is built out past the edge of the world and
 * reached by pressing a key, which fades you there. This one is different on
 * purpose: it is a real building in the street, with a real opening in its
 * front wall, so you walk in off the pavement. Everything else (collision, the
 * ground probe, lamps, people, the rain, multiplayer) works the same because it
 * is the same world and the same code.
 *
 * The lot it occupies is left as a gap in its block (layout.ts AE1), and the
 * block's own generator builds the storeys above and around it.
 */

/** the frontage on Central Avenue: the gap in AE1, in the gap's coordinates */
export const BANK_LOT: Rect = r(13, -74, 34, -61);
/** where the doorway is cut into the west (street) wall */
const DOOR_Z = -70;
const DOOR_W = 2.6;
const DOOR_H = 3.4;
const GROUND = 5.4;

export function buildBank(ctx: WorldContext, rng: Rng) {
  const L = BANK_LOT;
  const cz = (L.z0 + L.z1) / 2;
  const w = L.x1 - L.x0;
  const d = L.z1 - L.z0;
  const { mats, batch } = ctx;
  const seed = rng.range(0, 100);

  /* ── the shell: four walls, with a hole in the west one ── */
  // floor, and the pavement-level threshold you step over
  ctx.solid(mats.vertex, (L.x0 + L.x1) / 2, 0, cz, w + 0.4, 0.15, d + 0.4, { color: 0x584f42, cam: false });
  // ceiling
  ctx.solid(mats.vertex, (L.x0 + L.x1) / 2, GROUND, cz, w + 0.4, 0.4, d + 0.4, { color: 0x2a2620, cam: false });

  // north, south and east walls
  ctx.solid(mats.vertex, (L.x0 + L.x1) / 2, 0.15, L.z0, w, GROUND, 0.4, { color: 0x6a5f4a });
  ctx.solid(mats.vertex, (L.x0 + L.x1) / 2, 0.15, L.z1, w, GROUND, 0.4, { color: 0x6a5f4a });
  ctx.solid(mats.vertex, L.x1, 0.15, cz, 0.4, GROUND, d, { color: 0x6a5f4a });

  // The west (street) wall, in two pieces either side of the doorway.
  // ctx.solid takes a centre in x and z, so the pieces are derived from the
  // doorway rather than split down the middle of the wall — otherwise the hole
  // lands somewhere other than where the door frame and portico are built, and
  // the doorway is a wall.
  const gapA = DOOR_Z - DOOR_W / 2; // south edge of the opening
  const gapB = DOOR_Z + DOOR_W / 2; // north edge
  const southLen = gapA - L.z0;
  const northLen = L.z1 - gapB;
  ctx.solid(mats.vertex, L.x0, 0.15, L.z0 + southLen / 2, 0.4, GROUND, southLen, { color: 0x6a5f4a });
  ctx.solid(mats.vertex, L.x0, 0.15, gapB + northLen / 2, 0.4, GROUND, northLen, { color: 0x6a5f4a });
  // and the lintel over the opening
  ctx.solid(mats.vertex, L.x0, DOOR_H + 0.15, DOOR_Z, 0.4, GROUND - DOOR_H - 0.15, DOOR_W, { color: 0x6a5f4a });

  /* ── the shopfront, outside the doorway ── */
  // the doorway itself: a brass frame and two glazed leaves, standing open
  batch.add(mats.metal, G.box, M(L.x0 - 0.06, 0.15, DOOR_Z - DOOR_W / 2 - 0.12, 0.12, DOOR_H, 0.24));
  batch.add(mats.metal, G.box, M(L.x0 - 0.06, 0.15, DOOR_Z + DOOR_W / 2 + 0.12, 0.12, DOOR_H, 0.24));
  batch.add(mats.metal, G.box, M(L.x0 - 0.06, DOOR_H + 0.03, DOOR_Z, 0.12, 0.24, DOOR_W + 0.48));
  // the leaves, swung back against the wall
  for (const s of [-1, 1]) {
    batch.add(mats.glass, G.box, M(L.x0 - 0.55, 0.15, DOOR_Z + s * (DOOR_W / 2 - 0.1), 1.1, DOOR_H - 0.2, 0.06), { cast: false });
    batch.add(mats.metal, G.box, M(L.x0 - 1.05, 0.15, DOOR_Z + s * (DOOR_W / 2 - 0.1), 0.08, DOOR_H - 0.2, 0.1));
  }
  // the step down to the pavement, and a brass sill
  batch.add(mats.concrete, G.box, M(L.x0 - 0.5, 0.15, DOOR_Z, 1.0, 0.06, DOOR_W + 1.4));
  batch.add(mats.metal, G.box, M(L.x0 - 0.12, 0.19, DOOR_Z, 0.24, 0.02, DOOR_W));

  // the portico: two columns, an entablature, and the name in brass
  for (const s of [-2.9, 2.9]) {
    ctx.solid(mats.concrete, L.x0 - 2.2, 0.15, DOOR_Z + s, 1.2, GROUND - 0.9, 1.2, { color: 0xb8b2a4 });
    batch.add(mats.concrete, G.box, M(L.x0 - 2.2, 0.15, DOOR_Z + s, 1.6, 0.22, 1.6));
    batch.add(mats.concrete, G.box, M(L.x0 - 2.2, GROUND - 1.05, DOOR_Z + s, 1.6, 0.26, 1.6));
  }
  batch.add(mats.concrete, G.box, M(L.x0 - 2.2, GROUND - 0.75, DOOR_Z, 1.3, 0.6, d - 1));
  batch.add(mats.concrete, G.box, M(L.x0 - 2.2, GROUND - 0.15, DOOR_Z, 1.6, 0.28, d + 0.3));
  ctx.decal(ctxTextures.bank(), L.x0 - 2.88, GROUND - 0.45, DOOR_Z, d - 2, 0.85, -Math.PI / 2, { emissive: 2 });
  // uplights washing the columns: the one building on this street lit from below
  for (const s of [-2.9, 2.9]) {
    ctx.lamp(new THREE.Vector3(L.x0 - 1.4, 0.4, DOOR_Z + s), 'warm', { intensity: 18, range: 8, cone: false, halo: 0.5, ground: 0.15 });
    batch.add(mats.lampWarm, G.box, M(L.x0 - 0.7, 0.17, DOOR_Z + s, 0.4, 0.12, 0.4), { cast: false });
  }
  ctx.lamp(new THREE.Vector3(L.x0 - 0.4, 3.2, DOOR_Z), 'interior', { intensity: 30, range: 12, halo: 0.6 });

  /* ── the shop window, north of the door ── */
  {
    const wz = DOOR_Z + 6.2;
    batch.add(mats.darkStone, G.box, M(L.x0 - 0.04, 0.15, wz, 0.08, DOOR_H + 0.5, 5.4), { cast: false });
    batch.add(mats.glass, G.box, M(L.x0 - 0.09, 0.15, wz, 0.04, DOOR_H + 0.2, 5.2), { cast: false });
    batch.add(mats.metal, G.box, M(L.x0 - 0.06, 0.15, wz, 0.06, 0.1, 5.4));
    ctx.decal(itex.bankWindow(), L.x0 - 0.12, 1.8, wz, 4.6, 2.4, -Math.PI / 2, { emissive: 1.5 });
  }

  /* ── inside: the counter, the tellers, the vault ── */
  // marble counter across the back, facing the door. It stops short of both ends
  // so there's room to walk round it — spanning the full depth left only 0.8 m
  // gaps, which a 0.64 m wide player scrapes through rather than walks.
  const cx = L.x0 + 9.5;
  const counterD = d - 5.5;
  ctx.solid(mats.darkStone, cx, 0.15, cz, 1.0, 1.1, counterD);
  batch.add(mats.darkStone, G.box, M(cx, 1.25, cz, 1.2, 0.08, counterD + 0.2));
  // a brass grille over each teller window, and a name plate
  for (let i = -1; i <= 1; i++) {
    const tz = cz + i * 3.6;
    batch.add(mats.iron, G.box, M(cx + 0.6, 1.35, tz, 0.06, 0.08, 3.4));
    batch.add(mats.iron, G.box, M(cx + 0.6, 2.5, tz, 0.06, 0.08, 3.4));
    for (let k = -4; k <= 4; k++) ctx.solid(mats.iron, cx + 0.6, 1.35, tz + k * 0.38, 0.05, 1.2, 0.05, { cam: false });
    ctx.decal(itex.bankPlate(['TELLER 1', 'TELLER 2', 'TELLER 3'][i + 1]), cx + 0.66, 2.75, tz, 0.24, 0.7, Math.PI / 2, { emissive: 0.6 });
  }
  // the vault, in the east wall
  const vx = L.x1 - 0.4;
  ctx.solid(mats.metal, vx - 1.1, 0.15, cz + 2.6, 0.4, 4.2, 4.2, { color: 0x5a5a58 });
  batch.add(mats.darkStone, G.box, M(vx - 0.45, 2.35, cz + 2.6, 0.16, 2.3, 2.1));
  // the wheel
  ctx.solid(mats.metal, vx - 0.32, 2.1, cz + 2.6, 0.12, 0.55, 0.55, { color: 0x6a6a68, cam: false });
  batch.add(mats.metal, G.cyl, M(vx - 0.24, 2.1, cz + 2.6, 0.5, 0.06, 0.5));
  for (let i = 0; i < 4; i++) batch.add(mats.metal, G.box, M(vx - 0.2, 2.1, cz + 2.6, 0.05, 0.5, 0.06), { cast: false });

  // the manager's glass box, south end
  const ox = L.x0 + 4.2;
  ctx.solid(mats.wood, ox, 0.15, L.z0 + 0.4, 3.4, 2.6, 0.12, { cam: false });
  batch.add(mats.glass, G.box, M(ox, 1.9, L.z0 + 0.52, 3.2, 1.4, 0.04), { cast: false });
  ctx.solid(mats.wood, ox - 0.8, 0.15, L.z0 + 1.5, 1.6, 0.75, 0.7, { cam: false });

  // the ATM, and somewhere to wait
  const atm = new THREE.Vector3(L.x0 + 2.6, 0.15, L.z1 - 2.4);
  ctx.solid(mats.vertex, atm.x, atm.y, atm.z, 0.9, 1.9, 0.7, { color: 0x3a3e40 });
  ctx.decal(itex.bankSign(), atm.x, 1.5, atm.z - 0.37, 0.6, 0.5, Math.PI, { emissive: 1.8 });
  for (const s of [-1, 1]) {
    ctx.solid(mats.wood, L.x0 + 3.2, 0.15, cz + s * 4.4 - 0.7, 3.2, 0.45, 0.6, { cam: false });
    batch.add(mats.wood, G.box, M(L.x0 + 3.2, 0.6, cz + s * 4.4 - 1.0, 3.2, 0.5, 0.12));
  }
  // a rug down the middle
  batch.add(mats.vertex, G.box, M(L.x0 + 5.5, 0.151, cz, 4.0, 0.01, d - 3), { color: 0x4a2a26, cast: false });

  /* ── light, sound, and the people who work here ── */
  for (const [x, z] of [
    [L.x0 + 3.5, cz - 4],
    [L.x0 + 3.5, cz + 4],
    [L.x0 + 9, cz],
    [L.x0 + 15, cz],
  ]) {
    ctx.lamp(new THREE.Vector3(x, GROUND - 1.1, z), 'cold', { intensity: 12, range: 11, cone: false, halo: 0.2, ground: 0.15, streak: 0 });
    batch.add(mats.lampCold, G.box, M(x, GROUND - 0.22, z, 1.2, 0.06, 0.35), { cast: false });
  }
  const warm = ctx.lamp(new THREE.Vector3(ox, 2.5, L.z0 + 1.4), 'interior', { intensity: 8, range: 7, cone: false, halo: 0, ground: 0.15, streak: 0 });
  warm.flicker = 2;
  ctx.sound('hum', new THREE.Vector3(vx - 1, 2, cz + 2.6));

  // a teller behind the counter, someone at the machine, someone waiting
  ctx.npcSpots.push({ pos: new THREE.Vector3(cx + 2.4, 0.15, cz), yaw: -Math.PI / 2, mode: 'look' });
  ctx.npcSpots.push({ pos: new THREE.Vector3(atm.x + 1.1, 0.15, atm.z + 0.4), yaw: -Math.PI / 2, mode: 'wait' });
  ctx.npcSpots.push({ pos: new THREE.Vector3(L.x0 + 2.6, 0.15, cz - 3.2), yaw: Math.PI / 2, mode: 'wait' });
  // and the queue outside, on the pavement
  ctx.npcSpots.push({ pos: new THREE.Vector3(L.x0 - 3.4, 0.15, DOOR_Z + 1.6), yaw: -Math.PI / 2, mode: 'phone' });
  ctx.npcSpots.push({ pos: new THREE.Vector3(L.x0 - 3.4, 0.15, DOOR_Z - 1.4), yaw: -Math.PI / 2, mode: 'wait' });

  /* ── the things you can look at ── */
  ctx.point('bank-vault', new THREE.Vector3(vx - 1.9, 0.15, cz + 2.6), 2.2);
  ctx.point('bank-ledger', new THREE.Vector3(ox - 0.4, 0.15, L.z0 + 1.9), 1.6);
  ctx.point('bank-atm', new THREE.Vector3(atm.x + 0.9, 0.15, atm.z + 0.3), 1.6);

  /* ── the storeys above ── */
  const upperH = 22;
  facadeBox(ctx, L.x0, GROUND, L.z0, L.x1, upperH, L.z1, { style: 'stone', seed, lit: 0.24 });
  // a cornice, and a parapet
  facadeBox(ctx, L.x0 - 0.35, upperH - 0.2, L.z0 - 0.35, L.x1 + 0.35, upperH + 0.7, L.z1 + 0.35, { style: 'stone', seed, lit: -1, collide: false });
  facadeBox(ctx, L.x0 - 0.3, GROUND, L.z0 - 0.3, L.x1 + 0.3, GROUND + 0.7, L.z1 + 0.3, { style: 'stone', seed, lit: -1, collide: false });
  // roof clutter, so it isn't a flat top
  ctx.box(mats.concrete, (L.x0 + L.x1) / 2 + 3, upperH, cz - 3, 3.4, 2.2, 2.6);
  ctx.box(mats.iron, (L.x0 + L.x1) / 2 - 4, upperH + 2.9, cz + 2, 0.12, 4.6, 0.12);
  const beacon = ctx.lamp(new THREE.Vector3((L.x0 + L.x1) / 2 - 4, upperH + 5.4, cz + 2), 'red', { pooled: false, cone: false, streak: 0, halo: 1 });
  beacon.flicker = 2;
}

/** Where the bank is, for the map and the discovery zones. */
export const BANK_CENTRE = { x: 23.5, z: DOOR_Z };