import * as THREE from 'three';
import type { WorldContext } from '../WorldContext';
import { tex } from '../textures';
import { mulberry32 } from '../rng';
import { G, M, bin, crate, tree, wallLamp } from './props';

/**
 * The Old Quarter and, hidden inside it, the Garden: a walled courtyard
 * reached only through a gap behind a hanging tarp on Linden Street.
 * Someone tends it. Nobody has seen them.
 */
export function buildQuarter(ctx: WorldContext) {
  const { mats, batch } = ctx;
  const rng = mulberry32(1103);

  // sparse, tired lighting along Linden's north side
  for (const x of [-124, -108, -86, -72, -52]) wallLamp(ctx, x, 3.6, -50, 0, 1, 'warm');
  for (const z of [-60, -84, -108]) wallLamp(ctx, -62, 3.4, z, -1, 0, 'warm');

  // the dead-end alley between NQ4 and NQ1 ends at the old wall, and the mark
  ctx.decal(tex.mark(), -64, 1.9, -123.9, 1.3, 1.3, 0, { transparent: true });
  ctx.decal(tex.graffiti('18 yrs', 'rgba(210,200,180,0.55)'), -64, 3.4, -123.92, 3.2, 0.8, 0, { transparent: true });
  ctx.point('mark-quarter', new THREE.Vector3(-64, 0.15, -122.2), 2);
  for (let i = 0; i < 5; i++) crate(ctx, -65.2 + rng.range(0, 0.4), 0.15, -118 + i * 1.3, 0.7, rng.range(0, 1));
  bin(ctx, -63, -100);
  bin(ctx, -65, -76);

  /* ── the Garden ─────────────────────────────────────────── */
  const gx = -108, gz = -86;

  // entrance: a 2 m passage through NQ5 (x -104..-102), a tarp hung across its mouth
  const tarpGeo = new THREE.PlaneGeometry(2.2, 2.9, 8, 8);
  const tarp = new THREE.Mesh(tarpGeo, new THREE.MeshStandardMaterial({ color: 0x3f463d, roughness: 0.95, side: THREE.DoubleSide }));
  tarp.position.set(-103, 1.62, -50.4);
  tarp.castShadow = true;
  ctx.root.add(tarp);
  const base = Float32Array.from(tarpGeo.attributes.position.array as Float32Array);
  ctx.updaters.push((t) => {
    const p = tarpGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1];
      const hang = (1.45 - y) / 2.9; // 0 at the top, 1 at the bottom
      p.setZ(i, Math.sin(t * 1.3 + x * 2.1) * 0.08 * hang + Math.sin(t * 0.7 + y) * 0.04 * hang);
    }
    p.needsUpdate = true;
  });
  batch.add(mats.iron, G.box, M(-103, 3.08, -50.4, 2.4, 0.05, 0.05));
  // a weak lamp over the passage makes it look like a service door, not a way in
  wallLamp(ctx, -101.6, 3.3, -50, 0, 1, 'warm');

  // moss floor
  batch.add(mats.vertex, G.box, M(gx, 0.15, gz, 23.6, 0.02, 35.6), { color: 0x1a2118, cast: false });
  // gravel path from the passage to the tree
  for (let i = 0; i < 16; i++) batch.add(mats.stone, G.box, M(-103 + rng.range(-0.4, 0.4) - i * 0.3, 0.16, -69 - i * 1.05, 0.8, 0.02, 0.6, rng.range(0, 1)), { cast: false });

  // the tree, dressed in small lights
  tree(ctx, gx, gz, rng, 0.17, 1.5);
  for (let i = 0; i < 70; i++) {
    const a = i * 0.55, h = 2.2 + (i / 70) * 3.2, rad = 0.4 + (i / 70) * 1.6 + Math.sin(i) * 0.3;
    batch.add(mats.lampWarm, G.sphere, M(gx + Math.cos(a) * rad, h, gz + Math.sin(a) * rad, 0.035, 0.035, 0.035), { cast: false });
  }
  const glow = ctx.lamp(new THREE.Vector3(gx, 3.6, gz), 'interior', { intensity: 24, range: 16, cone: false, halo: 1.3, ground: 0.17 });
  glow.flicker = 5; // breathing

  // planters with something still green in them
  for (const [px, pz] of [[-117, -100], [-99, -100], [-117, -72], [-99, -75]] as const) {
    batch.add(mats.darkStone, G.box, M(px, 0.15, pz, 2.4, 0.7, 1.4));
    for (let k = 0; k < 4; k++) batch.add(mats.vertex, G.sphere, M(px + rng.range(-0.9, 0.9), 0.95, pz + rng.range(-0.4, 0.4), 0.4, 0.35, 0.4), { color: 0x243222 });
    ctx.collision.addCentered(px, 0.15, pz, 2.4, 0.7, 1.4, false);
  }

  // chair, table, the radio
  const cx = -113, cz = -80;
  batch.add(mats.wood, G.box, M(cx, 0.15, cz, 0.5, 0.45, 0.5));
  batch.add(mats.wood, G.box, M(cx, 0.6, cz + 0.22, 0.5, 0.55, 0.06));
  batch.add(mats.wood, G.box, M(cx + 1.0, 0.15, cz, 0.7, 0.7, 0.7));
  batch.add(mats.paint, G.box, M(cx + 1.0, 0.85, cz, 0.44, 0.26, 0.2), { color: 0x4a3524 });
  ctx.decal(tex.radioDial(), cx + 1.0, 1.0, cz - 0.105, 0.36, 0.09, Math.PI, { emissive: 1.4 });
  ctx.collision.addCentered(cx + 0.5, 0.15, cz, 1.7, 0.8, 0.8, false);
  ctx.sound('radio', new THREE.Vector3(cx + 1.0, 1, cz));
  ctx.point('radio', new THREE.Vector3(cx + 1.0, 0.15, cz - 1.1), 1.8);
  ctx.point('chair', new THREE.Vector3(cx, 0.15, cz - 0.05), 1.6, Math.PI);

  // the photographs: twelve nights, one corner, 3:17
  for (let i = 0; i < 12; i++) {
    const row = Math.floor(i / 6), col = i % 6;
    const t = tex.polaroid(i + 1);
    ctx.decal(t, -119.93, 1.5 + row * 0.62 + rng.range(-0.04, 0.04), -92 + col * 0.52 + rng.range(-0.05, 0.05), 0.36, 0.43, Math.PI / 2 + rng.range(-0.06, 0.06));
  }
  ctx.point('photos', new THREE.Vector3(-118.4, 0.15, -90.6), 2.2);

  // candles in jars along the east wall
  for (let i = 0; i < 7; i++) {
    const z = -98 + i * 3.1 + rng.range(-0.4, 0.4), x = -96.8 - rng.range(0, 0.5);
    batch.add(mats.glass, G.cyl, M(x, 0.17, z, 0.07, 0.16, 0.07), { cast: false });
    batch.add(mats.lampWarm, G.sphere, M(x, 0.26, z, 0.02, 0.035, 0.02), { cast: false });
    const l = ctx.lamp(new THREE.Vector3(x, 0.32, z), 'interior', { pooled: false, cone: false, halo: 0.25, streak: 0.3, ground: 0.17 });
    l.flicker = 6;
  }
}
