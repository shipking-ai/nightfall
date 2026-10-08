import * as THREE from 'three';
import type { WorldContext } from '../WorldContext';
import { tex } from '../textures';
import { mulberry32 } from '../rng';
import { facadeBox } from './buildings';
import { G, M, barrel, fence, floodPole, pallet, parkedCar, under } from './props';

const CONTAINER = [0x5a3326, 0x2f4450, 0x6b5a36, 0x3a4035, 0x4c4a47, 0x2a2e36, 0x6a3e2a];

/**
 * Pier 9 Yard — cranes that turn towards the water at 03:17, a manifest
 * with one line nobody wrote.
 */
export function buildYard(ctx: WorldContext) {
  const { mats, batch } = ctx;
  const rng = mulberry32(9);
  const metal = (seed: number) => ({ style: 'metal' as const, seed, lit: -1 });

  // warehouses
  facadeBox(ctx, 44, 0, -118, 90, 13, -60, metal(1));
  facadeBox(ctx, 100, 0, -118, 146, 11, -60, metal(2));
  facadeBox(ctx, 104, 0, -24, 144, 12, 24, metal(3));
  facadeBox(ctx, 104, 0, 72, 144, 12, 124, metal(4));
  facadeBox(ctx, 44, 0, 84, 72, 10, 128, metal(5));
  for (const [x0, z0, x1, z1, h] of [[44, -118, 90, -60, 13], [100, -118, 146, -60, 11], [104, -24, 144, 24, 12], [104, 72, 144, 124, 12], [44, 84, 72, 128, 10]] as const) {
    // pitched roof ridge
    batch.add(mats.metal, G.box, M((x0 + x1) / 2, h, (z0 + z1) / 2, x1 - x0 + 0.6, 0.35, z1 - z0 + 0.6));
    batch.add(mats.metal, G.box, M((x0 + x1) / 2, h + 0.35, (z0 + z1) / 2, x1 - x0 - 6, 0.9, z1 - z0 - 6));
  }
  ctx.decal(tex.stencil('PIER 9', 'NORTH SHED'), 67, 8.2, -59.9, 18, 4.5, 0, { transparent: true });
  ctx.decal(tex.stencil('B-2'), 103.9, 8.6, 0, 7, 1.75, -Math.PI / 2, { transparent: true });
  ctx.decal(tex.stencil('NO ENTRY', 'AFTER DARK'), 123, 7.4, -59.9, 12, 3, 0, { transparent: true });

  // warehouse B-2: roller door half up, a light left on inside
  batch.add(mats.metal, G.box, M(103.8, 3.2, 0, 0.2, 2.6, 8.2));
  batch.add(mats.rubber, G.box, M(103.95, 0, 0, 0.1, 3.2, 8));
  ctx.decal(interiorTex(), 103.88, 1.6, 0, 8, 3.2, -Math.PI / 2, { emissive: 1.1 });
  ctx.lamp(new THREE.Vector3(102.6, 2.2, 0), 'interior', { intensity: 26, range: 14, cone: false, halo: 0.5, ground: 0 });
  ctx.sound('machine', new THREE.Vector3(104, 3, 0));

  // containers
  const stacks: { x: number; z: number; n: number; open?: boolean }[] = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      const x = 54 + col * 14.5;
      const z = -14 + row * 11.5;
      if (row === 2 && col === 1) continue; // a gap to walk into
      stacks.push({ x, z, n: rng.int(1, 3) });
      stacks.push({ x, z: z + 2.6, n: rng.int(1, 3) });
    }
  }
  stacks.push({ x: 84, z: 72, n: 2 }, { x: 84, z: 74.6, n: 1 }, { x: 84, z: 88, n: 3 }, { x: 84, z: 98, n: 1, open: true });
  for (const s of stacks) {
    for (let k = 0; k < s.n; k++) container(ctx, s.x, k * 2.6, s.z, rng.pick(CONTAINER), rng);
    ctx.collision.add(s.x - 6.1, 0, s.z - 1.22, s.x + 6.1, s.n * 2.6, s.z + 1.22);
  }
  // the open container: doors swung, a bulb inside, a mark on the side
  const oc = stacks[stacks.length - 1];
  batch.add(mats.rubber, G.box, M(oc.x + 6.08, 0.1, oc.z, 0.05, 2.4, 2.2), { cast: false });
  for (const s of [-1, 1]) batch.add(mats.paint, G.box, M(oc.x + 6.2 + 0.6, 0, oc.z + s * 1.7, 1.2, 2.55, 0.06, s * 0.25), { color: 0x4c4a47 });
  ctx.lamp(new THREE.Vector3(oc.x + 5.4, 2.1, oc.z), 'interior', { intensity: 10, range: 8, cone: false, halo: 0.5, ground: 0 });
  batch.add(mats.lampWarm, G.sphere, M(oc.x + 5.4, 2.25, oc.z, 0.08, 0.1, 0.08), { cast: false });
  ctx.decal(tex.mark(), oc.x + 2, 1.4, oc.z - 1.24, 1.1, 1.1, Math.PI, { transparent: true });
  ctx.point('container-open', new THREE.Vector3(oc.x + 7.2, 0, oc.z), 2.4);
  ctx.point('mark-yard', new THREE.Vector3(oc.x + 2, 0, oc.z - 2.3), 1.8);

  // gantry crane over the stacks
  // The far leg has to stop short of Harbor Lane (z 48..60): at z = 50 it stood
  // a 1.2 m column in the middle of the carriageway.
  const cz0 = -22, cz1 = 44, cx0 = 44.5, cx1 = 99.5;
  for (const x of [cx0, cx1]) {
    for (const z of [cz0, cz1]) {
      batch.add(mats.paint, G.box, M(x, 0, z, 1.2, 24, 1.2), { color: 0x6b5a36 });
      ctx.collision.addCentered(x, 0, z, 1.2, 24, 1.2);
    }
    batch.add(mats.paint, G.box, M(x, 22.5, (cz0 + cz1) / 2, 1.4, 1.6, cz1 - cz0 + 1.2), { color: 0x6b5a36 });
    batch.add(mats.paint, G.box, M(x, 0, (cz0 + cz1) / 2, 1.0, 0.8, cz1 - cz0), { color: 0x4a3f28 });
  }
  for (const z of [cz0 + 20, cz1 - 20]) batch.add(mats.paint, G.box, M((cx0 + cx1) / 2, 24, z, cx1 - cx0 + 1.4, 1.8, 1.4), { color: 0x6b5a36 });
  batch.add(mats.paint, G.box, M(70, 22.4, 14, 5, 2.6, 4), { color: 0x514530 });
  batch.add(mats.lampWarm, G.box, M(72.52, 23.3, 14, 0.02, 0.9, 2.2), { cast: false });
  batch.add(mats.iron, G.cyl, M(70, 12, 14, 0.03, 10.4, 0.03), { cast: false });
  const warn = ctx.lamp(new THREE.Vector3(72, 26.1, 14), 'amber', { pooled: false, cone: false, halo: 1.1, streak: 0 });
  warn.flicker = 1;
  batch.add(mats.signalAmber, G.sphere, M(72, 26.1, 14, 0.18, 0.18, 0.18), { cast: false });
  ctx.sound('machine', new THREE.Vector3(70, 20, 14));

  // gatehouse at the Harbor Lane gate with the manifest terminal
  facadeBox(ctx, 39.5, 0, 62.5, 43.5, 3.1, 66.5, { style: 'concrete', seed: 14, lit: 1, floorH: 2.4, winW: 1.3 });
  batch.add(mats.concrete, G.box, M(41.5, 3.1, 64.5, 4.6, 0.25, 4.6));
  ctx.decal(tex.terminal(), 39.46, 1.5, 64.5, 1.2, 0.9, -Math.PI / 2, { emissive: 1.5 });
  ctx.lamp(new THREE.Vector3(38.7, 1.6, 64.5), 'amber', { intensity: 6, range: 5, cone: false, halo: 0.35, ground: 0 });
  ctx.point('terminal', new THREE.Vector3(38.4, 0, 64.5), 1.9);
  // barrier arm, raised
  batch.add(mats.paint, G.box, M(38.6, 0, 61.2, 0.4, 1.1, 0.4), { color: 0x6b5a36 });
  batch.add(mats.paint, G.box, M(38.6, 1.0, 61.2, 0.12, 0.12, 5.6, 0, 1.2), { color: 0xb8b0a0 });

  // perimeter fences
  fence(ctx, 38, -30, 38, 47);
  fence(ctx, 38, 67.5, 38, 132);
  fence(ctx, 38, -30, 82, -30);
  fence(ctx, 94, -30, 150, -30);
  fence(ctx, 38, 132, 150, 132);

  // floodlights
  for (const [x, z, ry] of [[40, -10, Math.PI / 2], [40, 30, Math.PI / 2], [101, 40, -Math.PI / 2], [101, -26, -Math.PI / 2], [76, 64, Math.PI], [100, 130, Math.PI], [60, 70, 0]] as const) floodPole(ctx, x, z, ry);
  ctx.lamp(new THREE.Vector3(67, 10.5, -58.5), 'cold', { intensity: 60, range: 22, halo: 0.8 });

  // clutter: barrels, pallets, a forklift, a skip
  for (let i = 0; i < 14; i++) barrel(ctx, 96 + rng.range(-1.5, 1.5), rng.range(58, 70), rng.pick([0x3a4a5a, 0x5a3326, 0x2a2e36]));
  for (let i = 0; i < 8; i++) pallet(ctx, 46 + i * 1.5, 76, rng.range(-0.1, 0.1), rng.int(1, 5));
  const fork = M(92, 0, 30, 1, 1, 1, 0.6);
  batch.add(mats.paint, G.box, under(fork, M(0, 0.3, 0, 1.2, 1.1, 2.2)), { color: 0x6b5a36 });
  batch.add(mats.iron, G.box, under(fork, M(0, 1.4, -0.3, 1.1, 0.06, 1.2)));
  for (const s of [-0.5, 0.5]) batch.add(mats.iron, G.box, under(fork, M(s, 0, 1.2, 0.08, 3.0, 0.08)));
  for (const s of [-0.3, 0.3]) batch.add(mats.iron, G.box, under(fork, M(s, 0.05, 1.8, 0.12, 0.05, 1.2)));
  ctx.collision.addCentered(92, 0, 30, 2.2, 2, 2.6, false);
  batch.add(mats.paint, G.box, M(128, 0, 48, 3.8, 1.6, 2.1), { color: 0x2f4450 });
  ctx.collision.addCentered(128, 0, 48, 3.8, 1.6, 2.1);
  parkedCar(ctx, 118, 40, 0.2, 0x3a3027, { van: true });

  ctx.npcSpots.push({ pos: new THREE.Vector3(36.6, 0.15, 60.8), yaw: -Math.PI / 2, mode: 'smoke' });
}

function container(ctx: WorldContext, x: number, y: number, z: number, color: number, rng: ReturnType<typeof mulberry32>) {
  const { mats, batch } = ctx;
  batch.add(mats.paint, G.box, M(x, y, z, 12.1, 2.55, 2.4), { color });
  // ribs
  for (let i = -5; i <= 5; i++) batch.add(mats.paint, G.box, M(x + i * 1.08, y + 0.1, z, 0.1, 2.35, 2.46), { color: shade(color, 0.8), cast: false });
  batch.add(mats.paint, G.box, M(x + 6.06, y + 0.05, z, 0.04, 2.45, 2.3), { color: shade(color, 0.6), cast: false });
  void rng;
}

function shade(c: number, k: number) {
  const col = new THREE.Color(c).multiplyScalar(k);
  return col.getHex();
}

function interiorTex(): THREE.CanvasTexture {
  const el = document.createElement('canvas');
  el.width = 512;
  el.height = 200;
  const c = el.getContext('2d')!;
  const g = c.createRadialGradient(256, 30, 10, 256, 80, 300);
  g.addColorStop(0, '#9a7040');
  g.addColorStop(1, '#0c0906');
  c.fillStyle = g;
  c.fillRect(0, 0, 512, 200);
  c.fillStyle = '#060504';
  c.fillRect(60, 110, 90, 90);
  c.fillRect(170, 90, 60, 110);
  c.fillRect(380, 120, 110, 80);
  c.fillStyle = 'rgba(0,0,0,0.5)';
  c.fillRect(0, 0, 512, 12);
  const t = new THREE.CanvasTexture(el);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
