import * as THREE from 'three';
import type { WorldContext } from '../WorldContext';
import { tex } from '../textures';
import { mulberry32 } from '../rng';
import { G, M, bin, crate, parkedCar, wallLamp, CAR_COLORS, under } from './props';

const TARPS = [0x3d4739, 0x4a2826, 0x7a7262, 0x36404a, 0x5a4a32];

/**
 * Kestrel Market — stalls set up every night, never opened. Narrow alleys,
 * a square strung with bulbs, a payphone that rings for someone.
 */
export function buildMarket(ctx: WorldContext) {
  const { mats, batch } = ctx;
  const rng = mulberry32(44);

  // ── stalls: covered, crated, waiting
  for (let ix = 0; ix < 3; ix++)
    for (let iz = 0; iz < 3; iz++) {
      if (ix === 1 && iz === 1) continue; // an open middle, where people stand
      const x = -88 + ix * 9 + rng.range(-0.6, 0.6);
      const z = 8 + iz * 11 + rng.range(-0.8, 0.8);
      stall(ctx, x, z, rng.pick(TARPS), rng);
    }

  // ── string lights across the square
  const poles: [number, number][] = [[-95, -4], [-67, -4], [-95, 43], [-67, 43]];
  for (const [x, z] of poles) batch.add(mats.iron, G.cyl, M(x, 0.15, z, 0.07, 6.2, 0.07));
  const strands: [number, number, number, number][] = [
    [-95, -4, -67, 43],
    [-67, -4, -95, 43],
    [-95, 19.5, -67, 19.5],
  ];
  batch.add(mats.iron, G.cyl, M(-95, 0.15, 19.5, 0.06, 6.0, 0.06));
  batch.add(mats.iron, G.cyl, M(-67, 0.15, 19.5, 0.06, 6.0, 0.06));
  for (const [x0, z0, x1, z1] of strands) {
    const n = 26;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      const y = 6.2 - Math.sin(t * Math.PI) * 1.4;
      const dead = rng.chance(0.18);
      batch.add(dead ? mats.darkGlass : mats.lampWarm, G.sphere, M(x, y - 0.12, z, 0.07, 0.09, 0.07), { cast: false });
      if (i < n) {
        const t2 = (i + 1) / n;
        const x2 = x0 + (x1 - x0) * t2, z2 = z0 + (z1 - z0) * t2, y2 = 6.2 - Math.sin(t2 * Math.PI) * 1.4;
        const mid = new THREE.Vector3((x + x2) / 2, (y + y2) / 2, (z + z2) / 2);
        const dir = new THREE.Vector3(x2 - x, y2 - y, z2 - z);
        const len = dir.length();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        batch.add(mats.iron, G.cyl, new THREE.Matrix4().compose(mid.addScaledVector(dir, -len / 2), q, new THREE.Vector3(0.012, len, 0.012)), { cast: false });
      }
      if (!dead && i % 5 === 2) ctx.lamp(new THREE.Vector3(x, y - 0.2, z), 'warm', { intensity: 6, range: 9, cone: false, halo: 0.35, streak: 0.5, pooled: i % 10 === 2 });
    }
  }

  // ── Kestrel Market arch over the Harbor Lane entrance
  for (const x of [-94.5, -67.5]) batch.add(mats.iron, G.box, M(x, 0.15, 44.2, 0.3, 7.2, 0.3));
  batch.add(mats.iron, G.box, M(-81, 7.0, 44.2, 27.3, 0.3, 0.3));
  ctx.decal(tex.kestrel(), -81, 7.9, 44.2, 18, 1.4, 0, { transparent: true, doubleSided: true });

  // ── shopfronts on the north side of the square (MC south face z = -6)
  const face = -5.96;
  // deli, closed "for five minutes"
  ctx.decal(tex.deli(), -80, 4.3, face, 5.4, 1.0, 0);
  awning(ctx, -80, 3.6, face, 6, 0x3d4739);
  ctx.decal(tex.closedCard(), -80.6, 1.5, face + 0.02, 0.45, 0.28, 0);
  ctx.point('closed-card', new THREE.Vector3(-80.6, 0.15, face + 1.4), 1.8);
  // launderette, lights on, machines turning for nobody
  const laundry = tex.launderette();
  ctx.decal(laundry, -90.5, 4.3, face, 4.2, 0.8, 0, { emissive: 1.8 });
  const ll = ctx.lamp(new THREE.Vector3(-90.5, 2.2, face + 0.8), 'cold', { intensity: 16, range: 11, cone: false, halo: 0.6 });
  ll.flicker = 4;
  ctx.sound('hum', new THREE.Vector3(-90.5, 3, face + 0.5));
  ctx.npcSpots.push({ pos: new THREE.Vector3(-88.6, 0.15, -3.6), yaw: Math.PI * 0.95, mode: 'look' });
  // tobacconist, shuttered
  awning(ctx, -71, 3.5, face, 5, 0x4a2826);

  // ── the payphone at the corner of Harbor Lane
  const px = -64.6, pz = 45.6;
  batch.add(mats.iron, G.box, M(px, 0.15, pz, 1.1, 2.3, 0.08));
  batch.add(mats.iron, G.box, M(px, 2.45, pz + 0.35, 1.2, 0.12, 0.9));
  batch.add(mats.paint, G.box, M(px, 1.1, pz + 0.12, 0.34, 0.55, 0.16), { color: 0x2a2e30 });
  batch.add(mats.lampCold, G.box, M(px, 2.36, pz + 0.35, 0.6, 0.03, 0.2), { cast: false });
  ctx.collision.addCentered(px, 0.15, pz, 1.1, 2.3, 0.3, false);
  ctx.lamp(new THREE.Vector3(px, 2.2, pz + 0.4), 'cold', { intensity: 8, range: 6, cone: false, halo: 0.5 });
  ctx.sound('phone', new THREE.Vector3(px, 1.3, pz + 0.2), 'payphone');
  ctx.point('payphone', new THREE.Vector3(px, 0.15, pz + 1.0), 1.8);

  // ── vending machine in the west alley
  const vx = -99.45, vz = 22;
  batch.add(mats.paint, G.box, M(vx, 0.15, vz, 0.9, 1.95, 1.0), { color: 0x2b3134 });
  ctx.decal(tex.vending(), vx + 0.46, 1.1, vz, 0.9, 1.8, Math.PI / 2, { emissive: 1.1 });
  ctx.collision.addCentered(vx, 0.15, vz, 0.9, 1.95, 1.0, false);
  ctx.lamp(new THREE.Vector3(vx + 0.9, 1.2, vz), 'cold', { intensity: 7, range: 7, cone: false, halo: 0.4, streak: 0.9 });
  ctx.sound('hum', new THREE.Vector3(vx + 0.5, 1, vz));
  ctx.point('vending', new THREE.Vector3(vx + 1.2, 0.15, vz), 1.8);

  // ── posters on the alley wall (MA west face x = -62)
  ctx.decal(tex.missing(), -62.04, 1.7, 12, 0.72, 1.0, -Math.PI / 2);
  ctx.decal(tex.timePoster(), -62.04, 1.7, 13.1, 0.72, 1.0, -Math.PI / 2);
  ctx.decal(tex.concert(), -62.04, 1.75, 14.2, 0.72, 1.0, -Math.PI / 2);
  ctx.decal(tex.timePoster(), -62.04, 1.72, 15.3, 0.72, 1.0, -Math.PI / 2);
  ctx.point('time-poster', new THREE.Vector3(-63.4, 0.15, 13.6), 2);

  // ── alley lamps, bins, crates, back doors
  for (const z of [-20, 4, 30]) wallLamp(ctx, -62, 3.6, z, -1, 0, 'warm');
  for (const z of [-14, 12, 36]) wallLamp(ctx, -100, 3.4, z, 1, 0, 'warm');
  for (const x of [-120, -104, -86, -54]) wallLamp(ctx, x, 3.8, 64, 0, -1, 'warm');
  for (const x of [-118, -78, -52]) wallLamp(ctx, x, 3.8, 132, 0, 1, 'warm');
  for (const z of [-24, 8, 38]) bin(ctx, -65.4, z);
  for (let i = 0; i < 10; i++) crate(ctx, -97 + rng.range(0, 0.6), 0.15, rng.range(-26, 40), rng.range(0.5, 0.8), rng.range(0, 1));
  for (let i = 0; i < 6; i++) crate(ctx, rng.range(-94, -70), 0.15, rng.range(-3, -1), 0.6, rng.range(0, 1));
  // laundry strung over the alley
  for (const z of [-12, 20]) {
    batch.add(mats.iron, G.box, M(-64, 6.5, z, 4, 0.02, 0.02), { cast: false });
    for (let i = 0; i < 4; i++) batch.add(mats.cloth, G.box, M(-65.4 + i * 0.9, 5.7, z, 0.6, 0.8, 0.02), { color: rng.pick([0x9a948a, 0x5a6068, 0x6a4a44]) });
  }

  // ── parked cars and a delivery van on Harbor Lane
  parkedCar(ctx, -110, 49.3, Math.PI / 2, rng.pick(CAR_COLORS), { van: true });
  parkedCar(ctx, -76, 49.3, Math.PI / 2, rng.pick(CAR_COLORS), { drive: true, screen: true });
  parkedCar(ctx, -40, 58.7, -Math.PI / 2, rng.pick(CAR_COLORS));
  parkedCar(ctx, -60, 137.3, Math.PI / 2, rng.pick(CAR_COLORS));

  // voices in the square
  ctx.sound('murmur', new THREE.Vector3(-80, 1.6, 18));
  ctx.npcSpots.push({ pos: new THREE.Vector3(-82.2, 0.15, 19.6), yaw: Math.PI / 2, mode: 'talk', pair: 'sq1' });
  ctx.npcSpots.push({ pos: new THREE.Vector3(-80.8, 0.15, 19.6), yaw: -Math.PI / 2, mode: 'talk', pair: 'sq1' });
  ctx.npcSpots.push({ pos: new THREE.Vector3(-74.2, 0.15, 30.8), yaw: 0.4, mode: 'talk', pair: 'sq2' });
  ctx.npcSpots.push({ pos: new THREE.Vector3(-73.6, 0.15, 32.1), yaw: Math.PI + 0.4, mode: 'talk', pair: 'sq2' });
  ctx.npcSpots.push({ pos: new THREE.Vector3(-66.2, 0.15, 46.2), yaw: Math.PI, mode: 'phone' });
}

function stall(ctx: WorldContext, x: number, z: number, tarp: number, rng: ReturnType<typeof mulberry32>) {
  const { mats, batch } = ctx;
  const w = 3.6, d = 2.4;
  for (const sx of [-w / 2, w / 2]) for (const sz of [-d / 2, d / 2]) batch.add(mats.iron, G.cyl, M(x + sx, 0.15, z + sz, 0.04, sz < 0 ? 2.5 : 2.2, 0.04));
  batch.add(mats.cloth, G.box, M(x, 2.3, z, w + 0.4, 0.04, d + 0.5, 0, 0.12), { color: tarp });
  batch.add(mats.cloth, G.box, M(x, 1.95, z - d / 2 - 0.22, w + 0.4, 0.5, 0.03), { color: tarp });
  batch.add(mats.wood, G.box, M(x, 0.95, z, w, 0.06, d));
  // covered goods
  batch.add(mats.cloth, G.box, M(x, 1.0, z, w - 0.2, 0.5, d - 0.3), { color: rng.pick([0x2e3236, 0x3a3630, 0x26292b]) });
  ctx.collision.add(x - w / 2, 0, z - d / 2, x + w / 2, 1.5, z + d / 2, false);
  if (rng.chance(0.6)) crate(ctx, x + rng.range(-1, 1), 0.15, z + d / 2 + 0.6, 0.55, rng.range(0, 1));
  void under;
}

function awning(ctx: WorldContext, x: number, y: number, wallZ: number, w: number, color: number) {
  ctx.batch.add(ctx.mats.cloth, G.box, M(x, y, wallZ + 0.8, w, 0.04, 1.7, 0, 0.35), { color });
  ctx.batch.add(ctx.mats.cloth, G.box, M(x, y - 0.55, wallZ + 1.6, w, 0.3, 0.02), { color });
}
