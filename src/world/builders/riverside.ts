import * as THREE from 'three';
import type { WorldContext } from '../WorldContext';
import { tex } from '../textures';
import { mulberry32 } from '../rng';
import { G, M, bench, bin, lanternLamp, tree, under } from './props';
import { facadeBox } from './buildings';

/**
 * The Riverside — the one place in the district that moves. A promenade,
 * a closed bridge, a boat named for something nobody has done yet.
 */
export function buildRiverside(ctx: WorldContext) {
  const { mats, batch } = ctx;
  const rng = mulberry32(88);

  // railing along the quay
  for (let x = -150; x <= 150; x += 2) {
    if (Math.abs(x) < 10.5) continue;
    batch.add(mats.iron, G.box, M(x, 0.15, 163.5, 0.06, 1.1, 0.06));
  }
  for (const [a, b] of [[-150, -10.4], [10.4, 150]] as const) {
    batch.add(mats.iron, G.box, M((a + b) / 2, 1.2, 163.5, b - a, 0.06, 0.08));
    batch.add(mats.iron, G.box, M((a + b) / 2, 0.7, 163.5, b - a, 0.03, 0.03));
  }

  // lamps, benches, trees
  for (let x = -138; x <= 138; x += 18) {
    if (Math.abs(x) < 14) continue;
    lanternLamp(ctx, x, 162.3);
    if (Math.abs(x) % 36 === 12 || rng.chance(0.35)) {
      bench(ctx, x + 6, 161, Math.PI);
      ctx.point('bench', new THREE.Vector3(x + 6, 0.15, 160.95), 1.6, 0);
    }
    if (rng.chance(0.5)) tree(ctx, x + 9, 148.8, rng);
  }
  bench(ctx, -54, 161, Math.PI); // someone is already sitting here
  bin(ctx, -51.6, 161.6);
  bin(ctx, 46, 161.6);

  // coin-operated viewer, pointed at a skyline that is always lit
  const vx = -30;
  batch.add(mats.iron, G.cyl, M(vx, 0.15, 162.4, 0.08, 1.1, 0.08));
  batch.add(mats.paint, G.box, M(vx, 1.2, 162.4, 0.34, 0.26, 0.5, 0, -0.1), { color: 0x3b4a44 });
  for (const s of [-0.09, 0.09]) batch.add(mats.iron, G.cyl, M(vx + s, 1.36, 162.66, 0.05, 0.14, 0.05, 0, Math.PI / 2));
  ctx.collision.addCentered(vx, 0.15, 162.4, 0.4, 1.4, 0.5, false);
  ctx.point('viewer', new THREE.Vector3(vx, 0.15, 161.3), 1.7);

  // the moored boat, below the quay
  const boat = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, 7.2), new THREE.MeshStandardMaterial({ color: 0x23282a, roughness: 0.6 }));
  hull.position.y = 0.2;
  const bow = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.2, 1.0, 3, 1).rotateY(Math.PI / 6), hull.material);
  bow.position.set(0, 0.2, 4.0);
  bow.scale.set(1, 1, 1.4);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.1, 2.4), new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 0.8 }));
  cabin.position.set(0, 1.2, -1.2);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.2, 0.15), mats.lampWarm);
  lamp.position.set(0, 1.9, -1.2);
  boat.add(hull, bow, cabin, lamp);
  const nameTex = boatName();
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.3), new THREE.MeshStandardMaterial({ map: nameTex, transparent: true, roughness: 0.8 }));
  plate.position.set(1.21, 0.35, 1.4);
  plate.rotation.y = Math.PI / 2;
  boat.add(plate);
  boat.position.set(42, -2.5, 170);
  boat.rotation.y = Math.PI / 2 + 0.05;
  boat.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  ctx.root.add(boat);
  const boatLamp = ctx.lamp(new THREE.Vector3(42, -0.7, 170), 'warm', { intensity: 4, range: 6, cone: false, halo: 0.35, streak: 1.6, ground: -2.55, pooled: false, dynamic: true });
  // lights on the far bank, doubled in the water
  for (let i = 0; i < 46; i++) {
    const fx = rng.range(-240, 240), fy = rng.range(2, 16);
    if (Math.abs(fx) < 12) continue;
    ctx.lamp(new THREE.Vector3(fx, fy, 205.6), rng.chance(0.75) ? 'warm' : 'cold', { pooled: false, cone: false, halo: rng.range(0.4, 1.0), streak: rng.range(1.2, 2.2), ground: -2.55 });
  }
  ctx.updaters.push((t) => {
    boat.position.y = -2.5 + Math.sin(t * 0.7) * 0.06;
    boat.rotation.z = Math.sin(t * 0.53) * 0.025;
    boat.rotation.x = Math.sin(t * 0.41) * 0.015;
    boatLamp.pos.y = boat.position.y + 1.8;
  });
  // rope to a bollard on the quay
  batch.add(mats.iron, G.cyl, M(44.5, 0.15, 162.2, 0.22, 0.5, 0.22));
  const ropeDir = new THREE.Vector3(-2.2, -2.4, 6.8);
  const ropeLen = ropeDir.length();
  batch.add(mats.wood, G.cyl, new THREE.Matrix4().compose(new THREE.Vector3(44.5, 0.55, 162.2), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), ropeDir.normalize()), new THREE.Vector3(0.03, ropeLen, 0.03)), { cast: false });
  ctx.point('boat', new THREE.Vector3(44.5, 0.15, 161.4), 2.2);

  // ── Ashford Bridge: balustrades, lamps, a barricade that has been temporary for eighteen years
  for (const sx of [-9.8, 9.8]) {
    facadeBox(ctx, sx - 0.35, 0.15, 164, sx + 0.35, 1.25, 206, { style: 'stone', seed: 4, lit: -1, collide: false });
    lanternLamp(ctx, sx, 172);
    lanternLamp(ctx, sx, 188);
  }
  // piers and arches under the deck
  facadeBox(ctx, -10, -5, 164, 10, 0.1, 200, { style: 'stone', seed: 8, lit: -1, collide: false, cast: false });
  for (const z of [176, 188]) facadeBox(ctx, -8, -6, z - 1.5, 8, -1, z + 1.5, { style: 'stone', seed: 8, lit: -1, collide: false, cast: false });
  // barricade
  for (let x = -8.6; x < 8.6; x += 2.2) {
    batch.add(mats.concrete, G.box, M(x + 1.05, 0.15, 186, 2.0, 0.85, 0.6));
    batch.add(mats.concrete, G.box, M(x + 1.05, 0.15, 186, 2.0, 0.25, 0.8));
  }
  ctx.collision.add(-9.5, 0, 185.5, 9.5, 3, 186.6, true);
  batch.add(mats.iron, G.box, M(-3, 1.0, 185.9, 0.08, 1.8, 0.08));
  batch.add(mats.iron, G.box, M(3, 1.0, 185.9, 0.08, 1.8, 0.08));
  ctx.decal(tex.bridgeNotice(), 0, 2.2, 185.66, 2.6, 1.62, Math.PI);
  batch.add(mats.iron, G.box, M(0, 1.38, 185.72, 2.7, 1.72, 0.04));
  ctx.decal(tex.mark(), 7.2, 0.62, 185.68, 0.6, 0.6, Math.PI, { transparent: true });
  ctx.point('bridge-notice', new THREE.Vector3(0, 0.15, 184.6), 2.4);
  ctx.point('mark-bridge', new THREE.Vector3(7.2, 0.15, 184.8), 1.6);
  for (const x of [-7, 0, 7]) {
    batch.add(mats.signalAmber, G.box, M(x, 1.0, 186, 0.18, 0.18, 0.18), { cast: false });
    const l = ctx.lamp(new THREE.Vector3(x, 1.1, 185.6), 'amber', { pooled: false, cone: false, halo: 0.6, streak: 0.9, ground: 0.15 });
    l.flicker = 1;
  }

  // ── the old rail bridge to the east: a dark truss
  const trussX0 = 82, trussX1 = 92;
  for (const x of [trussX0, trussX1]) {
    batch.add(mats.iron, G.box, M(x, 3.6, 182, 0.4, 0.4, 44));
    batch.add(mats.iron, G.box, M(x, 9.6, 182, 0.4, 0.4, 44));
    for (let z = 160; z <= 204; z += 4) {
      batch.add(mats.iron, G.box, M(x, 3.6, z, 0.25, 6.2, 0.25));
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 6, 4).normalize());
      batch.add(mats.iron, G.box, new THREE.Matrix4().compose(new THREE.Vector3(x, 3.6, z), q, new THREE.Vector3(0.18, Math.hypot(6, 4), 0.18)));
    }
  }
  batch.add(mats.iron, G.box, M((trussX0 + trussX1) / 2, 3.2, 182, trussX1 - trussX0, 0.5, 44));
  for (const z of [168, 196]) facadeBox(ctx, trussX0, -6, z - 2, trussX1, 3.2, z + 2, { style: 'brick', seed: 12, lit: -1, collide: false });
  facadeBox(ctx, trussX0 - 1, 0, 150, trussX1 + 1, 3.2, 163, { style: 'brick', seed: 12, lit: -1 });

  // water sound along the quay
  for (let x = -120; x <= 120; x += 60) ctx.sound('water', new THREE.Vector3(x, -1.5, 168));
  ctx.npcSpots.push({ pos: new THREE.Vector3(-54, 0.15, 160.9), yaw: 0, mode: 'sit' });
  ctx.npcSpots.push({ pos: new THREE.Vector3(24, 0.15, 162.7), yaw: 0.05, mode: 'stare' });
  void under;
}

function boatName(): THREE.CanvasTexture {
  const el = document.createElement('canvas');
  el.width = 256;
  el.height = 48;
  const c = el.getContext('2d')!;
  c.fillStyle = 'rgba(220,210,190,0.85)';
  c.font = '500 30px "IBM Plex Mono", monospace';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('R E T U R N', 128, 26);
  const t = new THREE.CanvasTexture(el);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
