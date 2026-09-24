import * as THREE from 'three';
import type { WorldContext } from '../WorldContext';
import { tex } from '../textures';
import { facadeBox } from './buildings';
import { G, M, bench, bin, carParts, lanternLamp, parkedCar, under } from './props';
import { mulberry32 } from '../rng';

/**
 * Central Station — closed for eighteen years. A stone front, a vaulted
 * iron train shed, one carriage still at platform 2. The clock says 03:17.
 */
export function buildStation(ctx: WorldContext) {
  const { mats, batch } = ctx;
  const rng = mulberry32(17);
  const stone = { style: 'stone' as const, seed: 3.3, lit: -1 };
  const FZ0 = -153.5, FZ1 = -151.5;

  // ── front: two wings, the arch lintel, pediment
  facadeBox(ctx, -52, 0, FZ0, -5, 17, FZ1, stone);
  facadeBox(ctx, 5, 0, FZ0, 52, 17, FZ1, stone);
  facadeBox(ctx, -5, 7.4, FZ0, 5, 17, FZ1, stone);
  facadeBox(ctx, -30, 17, FZ0, 30, 21, FZ1, { ...stone, collide: false });
  facadeBox(ctx, -12, 21, FZ0, 12, 24, FZ1, { ...stone, collide: false });
  facadeBox(ctx, -53, 16.6, FZ0 - 0.4, 53, 17.4, FZ1 + 0.5, { ...stone, collide: false });
  // pilasters and tall arched windows
  for (let x = -46; x <= 46; x += 10) {
    if (Math.abs(x) < 8) continue;
    facadeBox(ctx, x - 0.7, 0, FZ1, x + 0.7, 16.6, FZ1 + 0.45, { ...stone, collide: false });
  }
  for (let x = -41; x <= 41; x += 10) {
    if (Math.abs(x) < 8) continue;
    batch.add(mats.darkGlass, G.box, M(x, 2.8, FZ1 + 0.06, 4.2, 10.5, 0.1), { cast: false });
    for (let k = 1; k < 4; k++) batch.add(mats.iron, G.box, M(x, 2.8 + k * 2.6, FZ1 + 0.13, 4.2, 0.08, 0.06), { cast: false });
    batch.add(mats.iron, G.box, M(x, 2.8, FZ1 + 0.13, 0.08, 10.5, 0.06), { cast: false });
  }
  // doorway: recessed, dark, doors chained open
  batch.add(mats.darkStone, G.box, M(0, 7.2, -152.5, 10.4, 0.4, 2.4));
  ctx.decal(tex.stationName(), 0, 9.1, FZ1 + 0.05, 13, 1.6, 0);
  // clock above the name
  batch.add(mats.darkStone, G.cylHi, M(0, 13.1, FZ1 + 0.02, 2.5, 0.3, 2.5, 0, Math.PI / 2));
  ctx.decal(tex.clockFace(), 0, 13.1, FZ1 + 0.36, 4.4, 4.4, 0, { emissive: 0.5 });
  ctx.point('station-clock', new THREE.Vector3(0, 0.15, -146), 5);

  // ── the shed: side walls, back wall, vaulted roof
  facadeBox(ctx, -52, 0, -200, -50, 12, FZ0, { ...stone, seed: 5 });
  facadeBox(ctx, 50, 0, -200, 52, 12, FZ0, { ...stone, seed: 6 });
  facadeBox(ctx, -52, 0, -202, 52, 12, -200, { ...stone, seed: 7 });
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(24.5, 24.5, 104, 40, 1, true, 0, Math.PI).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1b1d1f, roughness: 0.7, metalness: 0.5, side: THREE.DoubleSide }));
  roof.position.set(0, 11.5, -176.5);
  roof.scale.set(1, 0.62, 1);
  roof.castShadow = true;
  roof.receiveShadow = true;
  ctx.root.add(roof);
  // ribs
  const rib = new THREE.TorusGeometry(24.3, 0.22, 6, 40, Math.PI).rotateY(Math.PI / 2);
  for (let x = -48; x <= 48; x += 8) batch.add(mats.iron, rib, new THREE.Matrix4().compose(new THREE.Vector3(x, 11.5, -176.5), new THREE.Quaternion(), new THREE.Vector3(1, 0.62, 1)));
  // columns carrying the roof edges
  for (let x = -44; x <= 44; x += 11) {
    for (const z of [-199, -154.5]) batch.add(mats.iron, G.cyl, M(x, 0.15, z, 0.28, 11.4, 0.28));
  }

  // ── concourse: floor pad is in PADS. Platforms and tracks.
  // island platform 0.9 m high, with steps to the concourse
  facadeBox(ctx, -46, 0, -184, 46, 0.9, -172, { style: 'concrete', seed: 2, lit: -1, cast: false });
  batch.add(mats.marking, G.box, M(0, 0.9, -172.35, 92, 0.012, 0.35), { cast: false, color: 0xb89a55 });
  batch.add(mats.marking, G.box, M(0, 0.9, -183.65, 92, 0.012, 0.35), { cast: false, color: 0xb89a55 });
  for (let i = 0; i < 2; i++) {
    const w = 8 - i * 1.4;
    facadeBox(ctx, -w / 2, 0, -172 + 1.2 - i * 0.6, w / 2, 0.3 + i * 0.3, -172 + 1.8 - i * 0.6, { style: 'concrete', seed: 2, lit: -1, cast: false });
  }
  facadeBox(ctx, -2.8, 0, -172, 2.8, 0.6, -171.2, { style: 'concrete', seed: 2, lit: -1, cast: false });
  // rails
  for (const tz of [-167, -189]) {
    batch.add(mats.darkStone, G.box, M(0, 0.02, tz, 100, 0.08, 3.4), { cast: false });
    for (const o of [-0.72, 0.72]) batch.add(mats.metal, G.box, M(0, 0.1, tz + o, 100, 0.12, 0.08), { cast: false });
    for (let x = -49; x <= 49; x += 0.9) batch.add(mats.wood, G.box, M(x, 0.04, tz, 0.22, 0.07, 2.4), { cast: false });
  }
  // tunnel mouths in the side walls
  for (const sx of [-50.9, 50.9]) for (const tz of [-167, -189]) batch.add(mats.rubber, G.box, M(sx, 0.1, tz, 0.5, 5.2, 4.6), { cast: false });

  // the carriage at platform 2, one window still lit
  const car = M(-18, 0, -190, 1, 1, 1, Math.PI / 2);
  batch.add(mats.paint, G.box, under(car, M(0, 0.9, 0, 3.0, 3.0, 22)), { color: 0x2c3230 });
  batch.add(mats.paint, G.box, under(car, M(0, 3.9, 0, 2.6, 0.35, 21.6)), { color: 0x1c1f1e });
  for (let i = -4; i <= 4; i++) {
    const lit = i === 2;
    batch.add(lit ? mats.lampWarm : mats.darkGlass, G.box, under(car, M(1.51, 2.3, i * 2.3, 0.04, 0.9, 1.6)), { cast: false });
    batch.add(lit ? mats.lampWarm : mats.darkGlass, G.box, under(car, M(-1.51, 2.3, i * 2.3, 0.04, 0.9, 1.6)), { cast: false });
  }
  for (const s of [-8, 8]) for (const o of [-0.8, 0.8]) batch.add(mats.rubber, G.wheel, under(car, M(o, 0.45, s, 0.2, 0.42, 0.42)));
  ctx.collision.add(-29, 0, -191.5, -7, 4.2, -188.5);
  ctx.lamp(new THREE.Vector3(-18 + 2 * 2.3, 2.2, -188.2), 'interior', { intensity: 14, range: 12, cone: false, halo: 0.5 });
  ctx.point('train', new THREE.Vector3(-13.4, 0.9, -184.8), 2.6);

  // departures board over the concourse
  batch.add(mats.iron, G.box, M(0, 5.2, -160.5, 7.6, 2.9, 0.3));
  for (const s of [-3, 3]) batch.add(mats.iron, G.cyl, M(s, 6.6, -160.5, 0.03, 5, 0.03));
  ctx.decal(tex.departures(), 0, 6.65, -160.33, 7.2, 2.7, 0, { emissive: 1.8 });
  const board = ctx.lamp(new THREE.Vector3(0, 5.2, -159.4), 'amber', { intensity: 10, range: 9, cone: false, halo: 0.6, ground: 0.15 });
  board.flicker = 3;
  ctx.point('departures', new THREE.Vector3(0, 0.15, -158), 3.4);
  ctx.npcSpots.push({ pos: new THREE.Vector3(1.4, 0.15, -156.8), yaw: Math.PI, mode: 'stare' });

  // hanging concourse lights (cold, one dying) + a centre fill so the shed reads
  for (const [x, flick] of [[-22, 0], [22, 4]] as const) {
    batch.add(mats.iron, G.cyl, M(x, 6.2, -158, 0.02, 7, 0.02));
    batch.add(mats.lampCold, G.box, M(x, 6.0, -158, 2.4, 0.12, 0.3), { cast: false });
    const l = ctx.lamp(new THREE.Vector3(x, 5.8, -158), 'cold', { intensity: 34, range: 22, halo: 0.6 });
    if (flick) l.flicker = flick;
  }
  // centre of the shed was falling to black between the two mains
  batch.add(mats.iron, G.cyl, M(0, 6.2, -168, 0.02, 7, 0.02));
  batch.add(mats.lampCold, G.box, M(0, 6.0, -168, 2.4, 0.12, 0.3), { cast: false });
  ctx.lamp(new THREE.Vector3(0, 5.8, -168), 'cold', { intensity: 30, range: 24, halo: 0.6 });
  ctx.lamp(new THREE.Vector3(24, 5.8, -178), 'cold', { intensity: 24, range: 20, halo: 0.6, ground: 0.9 });
  batch.add(mats.iron, G.cyl, M(-24, 6.2, -178, 0.02, 7, 0.02));
  batch.add(mats.lampCold, G.box, M(-24, 6.0, -178, 2.4, 0.12, 0.3), { cast: false });
  ctx.lamp(new THREE.Vector3(-24, 5.8, -178), 'cold', { intensity: 24, range: 20, halo: 0.6, ground: 0.9 });

  // ticket machines, benches, the suitcase
  for (const x of [-34, -30]) {
    batch.add(mats.paint, G.box, M(x, 0.15, -153.2, 1.2, 1.9, 0.7), { color: 0x33393b });
    batch.add(mats.lampCold, G.box, M(x, 1.35, -152.83, 0.5, 0.35, 0.02), { cast: false });
    ctx.collision.addCentered(x, 0.15, -153.2, 1.2, 1.9, 0.7, false);
  }
  bench(ctx, -12, -156, Math.PI);
  bench(ctx, 12, -156, Math.PI);
  bench(ctx, -24, -178, Math.PI / 2, 0.9);
  bench(ctx, 30, -178, Math.PI / 2, 0.9);
  bin(ctx, 18, -154.5);
  // suitcase on the island platform
  batch.add(mats.paint, G.box, M(9, 0.9, -177, 0.72, 0.5, 0.25, 0.4), { color: 0x4a3524 });
  batch.add(mats.iron, G.box, M(9, 1.4, -177, 0.24, 0.05, 0.05, 0.4));
  ctx.point('suitcase', new THREE.Vector3(9, 0.9, -177), 2);
  // newspapers across the concourse floor
  for (let i = 0; i < 14; i++) batch.add(mats.marking, G.box, M(rng.range(-40, 40), 0.16, rng.range(-162, -155), rng.range(0.3, 0.6), 0.005, rng.range(0.4, 0.7), rng.range(0, 3)), { cast: false, color: 0x8a8578 });

  // missing poster by the entrance
  ctx.decal(tex.missing(), -7.4, 1.8, FZ1 + 0.5, 0.72, 1.0, 0);
  ctx.decal(tex.missing(), 7.8, 1.7, FZ1 + 0.5, 0.72, 1.0, 0.03);
  ctx.point('missing-poster', new THREE.Vector3(-7.4, 0.15, -150.2), 1.8);

  ctx.sound('drips', new THREE.Vector3(0, 6, -176));
  ctx.sound('drips', new THREE.Vector3(-30, 6, -170));

  /* ── forecourt: lamps, the Lamplighter, a taxi nobody is driving */
  for (const x of [-36, -18, 18, 36]) lanternLamp(ctx, x, -127.5);
  for (const x of [-38, 38]) lanternLamp(ctx, x, -148);
  // floodlights washing the facade from below
  for (const x of [-30, -12, 12, 30]) {
    batch.add(mats.iron, G.box, M(x, 0.15, -149.2, 0.6, 0.35, 0.4, 0, -0.5));
    batch.add(mats.lampWarm, G.box, M(x, 0.42, -149.35, 0.44, 0.04, 0.2, 0, -0.5), { cast: false });
    ctx.lamp(new THREE.Vector3(x, 1.6, -150.2), 'warm', { intensity: 55, range: 22, cone: false, halo: 0, streak: 0.15, ground: 0.15 });
  }

  // monument
  facadeBox(ctx, -2.2, 0, -140.2, 2.2, 0.8, -135.8, { style: 'stone', seed: 9, lit: -1 });
  facadeBox(ctx, -1.2, 0.8, -139.2, 1.2, 3.6, -136.8, { style: 'stone', seed: 9, lit: -1 });
  const statue = M(0, 3.6, -138, 1.55, 1.55, 1.55, Math.PI * 0.9);
  batch.add(mats.stone, G.cyl, under(statue, M(0, 0, 0, 0.16, 0.9, 0.16)));
  batch.add(mats.stone, G.taper, under(statue, M(0, 0.7, 0, 0.3, 0.8, 0.26)));
  batch.add(mats.stone, G.box, under(statue, M(0, 1.3, 0, 0.5, 0.3, 0.26)));
  batch.add(mats.stone, G.sphere, under(statue, M(0, 1.74, 0, 0.12, 0.14, 0.12)));
  batch.add(mats.stone, G.cyl, under(statue, M(0.34, 0.2, 0.1, 0.025, 2.1, 0.025)));
  batch.add(mats.stone, G.box, under(statue, M(0.34, 2.3, 0.1, 0.12, 0.2, 0.12)));
  batch.add(mats.stone, G.box, under(statue, M(0.22, 1.35, 0.06, 0.3, 0.08, 0.08, 0, 0, 0.9)));
  ctx.point('plaque', new THREE.Vector3(0, 0.15, -134.8), 2.2);

  // the taxi, engine idling, no driver
  parkedCar(ctx, -24, -131, Math.PI / 2, 0x2a2a24, { lights: true, dome: true });
  batch.add(mats.lampWarm, G.box, M(-24.25, 1.52, -131, 0.3, 0.12, 0.7), { cast: false });
  ctx.npcSpots.push({ pos: new THREE.Vector3(22, 0.15, -130.6), yaw: Math.PI * 0.9, mode: 'look' });
  void carParts;
}
