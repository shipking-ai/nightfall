import * as THREE from 'three';
import type { WorldContext } from '../WorldContext';
import { tex } from '../textures';
import { mulberry32 } from '../rng';
import { G, M, avenueLamp, bench, bin, bollard, manhole, parkedCar, signal, streetSign, tree, CAR_COLORS } from './props';

const crossingZ = (z: number) => (z > -52 && z < -28) || (z > 42 && z < 66) || z > 131;

export function buildAvenue(ctx: WorldContext) {
  const rng = mulberry32(3);
  const { mats, batch } = ctx;

  // lamps, trees, bins along both pavements
  for (let z = -114; z <= 128; z += 16) {
    if (crossingZ(z)) continue;
    avenueLamp(ctx, -9.8, z, 1);
    avenueLamp(ctx, 9.8, z + 8, -1);
    if (!crossingZ(z + 8)) tree(ctx, -10, z + 8, rng);
    if (!crossingZ(z)) tree(ctx, 10, z, rng);
    if (rng.chance(0.3)) bin(ctx, -9.7, z + 3);
    if (rng.chance(0.3)) bin(ctx, 9.7, z - 3);
  }

  // junction furniture: flashing-amber signals, name plates, bollards
  const avenueSign = tex.streetSign('Central Av');
  const lindenSign = tex.streetSign('Linden St');
  const harborSign = tex.streetSign('Harbor Ln');
  const riverSign = tex.streetSign('River Rd');
  signal(ctx, 10.2, -32.6, Math.PI);
  signal(ctx, -10.2, -47.4, 0);
  signal(ctx, 10.2, 61.4, Math.PI);
  signal(ctx, -10.2, 46.6, 0);
  signal(ctx, -10.2, 134.6, 0);
  streetSign(ctx, avenueSign, -11.6, -31.2, Math.PI / 2);
  streetSign(ctx, lindenSign, 11.6, -48.6, 0);
  streetSign(ctx, harborSign, -11.6, 62.4, 0);
  streetSign(ctx, avenueSign, 11.6, 45.4, Math.PI / 2);
  streetSign(ctx, riverSign, 11.6, 133.4, 0);
  for (let x = -8; x <= 8; x += 2) bollard(ctx, x, 147.2);

  // manholes breathing steam
  for (const [x, z] of [[-3.2, -92], [4.1, -8], [-2.4, 72], [3.3, 112]] as const) {
    manhole(ctx, x, z);
    ctx.steam.push(new THREE.Vector3(x, 0.05, z));
  }

  // Parked cars in the kerb lane. More kinds than there were: a van and a
  // pickup are now drivable, and there's an estate, a hatch and a taxi in the
  // street alongside the saloons and the electric cars.
  const parked: [number, number, number, object?][] = [
    [-7.4, -100, Math.PI],
    [-7.4, -64, Math.PI, { drive: true }],
    [7.4, -84, 0],
    [7.4, -18, 0, { dome: true }],
    [-7.4, 14, Math.PI],
    [-7.4, 22, Math.PI, { drive: true, screen: true }],
    [7.4, 92, 0, { drive: true }],
    [-7.4, 104, Math.PI],
    [7.4, 118, 0],
    // further down, the rest of the fleet
    [-7.4, -44, Math.PI, { drive: true, kind: 'van' }],
    [-7.4, -12, Math.PI, { kind: 'hatch' }],
    [7.4, -30, 0, { drive: true, kind: 'pickup' }],
    [7.4, 8, 0, { drive: true, kind: 'taxi' }],
    [-7.4, 34, Math.PI, { drive: true, kind: 'police' }],
    [-7.4, 62, Math.PI, { drive: true, kind: 'hatch' }],
    [7.4, 76, 0, { drive: true, kind: 'sports' }],
    [-7.4, 130, Math.PI, { drive: true, kind: 'van', screen: true }],
  ];
  for (const [x, z, ry, o] of parked) parkedCar(ctx, x, z, ry, rng.pick(CAR_COLORS), o);

  /* Hotel Meridian — east side, lobby lit at all hours */
  const hz = -8;
  batch.add(mats.iron, G.box, M(11.4, 4.2, hz, 3.3, 0.18, 7));
  batch.add(mats.lampWarm, G.box, M(10.3, 4.12, hz, 0.1, 0.06, 6), { cast: false });
  for (const s of [-3.2, 3.2]) batch.add(mats.iron, G.cyl, M(9.9, 0.15, hz + s, 0.05, 4.1, 0.05));
  ctx.decal(lobbyTexture(), 12.96, 2.2, hz, 5.2, 3.4, -Math.PI / 2, { emissive: 1.6 });
  const blade = tex.hotelSign();
  ctx.decal(blade, 12.2, 10.5, hz - 4.6, 1.1, 5.5, 0, { emissive: 2.4, doubleSided: true });
  batch.add(mats.iron, G.box, M(12.4, 7.6, hz - 4.61, 1.4, 5.9, 0.08));
  ctx.lamp(new THREE.Vector3(10.6, 3.6, hz), 'interior', { intensity: 30, range: 12, halo: 0.6 });
  ctx.lamp(new THREE.Vector3(12.2, 10.5, hz - 4.6), 'warm', { pooled: false, cone: false, halo: 1.6, streak: 1.6, ground: 0.15 });
  ctx.npcSpots.push({ pos: new THREE.Vector3(12.0, 0.15, hz + 4.4), yaw: -Math.PI / 2, mode: 'smoke' });


  /* Pharmacy — west side, the one cold light on the street */
  const pz = 30;
  ctx.decal(tex.pharmacy(), -12.96, 4.9, pz, 4.2, 0.8, Math.PI / 2, { emissive: 2.2 });
  ctx.lamp(new THREE.Vector3(-12.2, 2.4, pz), 'cold', { intensity: 18, range: 10, halo: 0.5, cone: false });

  /* Bus shelter — east side */
  const bz = 24;
  batch.add(mats.iron, G.box, M(12.5, 0.15, bz, 0.06, 2.5, 4.2));
  batch.add(mats.glass, G.box, M(12.45, 0.4, bz, 0.03, 2.1, 4.0), { cast: false });
  batch.add(mats.iron, G.box, M(11.6, 2.62, bz, 2.0, 0.08, 4.4));
  for (const s of [-2.05, 2.05]) batch.add(mats.iron, G.box, M(11.0, 0.15, bz + s, 0.06, 2.5, 0.06));
  batch.add(mats.wood, G.box, M(12.2, 0.6, bz, 0.4, 0.06, 3.2));
  ctx.decal(tex.busAd(), 12.4, 1.5, bz - 1.35, 1.0, 1.6, -Math.PI / 2, { emissive: 0.45 });
  ctx.collision.add(12.4, 0, bz - 2.1, 12.6, 2.6, bz + 2.1, false);
  ctx.lamp(new THREE.Vector3(12.2, 1.5, bz - 1.35), 'cold', { pooled: false, cone: false, halo: 0.5, streak: 0.8, ground: 0.15 });
  ctx.point('bus-ad', new THREE.Vector3(11.4, 0.15, bz - 1.35), 2.0);
  ctx.npcSpots.push({ pos: new THREE.Vector3(11.3, 0.15, bz + 0.8), yaw: -Math.PI / 2, mode: 'phone' });
  ctx.npcSpots.push({ pos: new THREE.Vector3(11.7, 0.15, bz + 3.2), yaw: Math.PI, mode: 'wait' });

  /* Newspaper box — west side */
  const nz = 18;
  batch.add(mats.paint, G.box, M(-11.9, 0.15, nz, 0.6, 1.1, 0.5), { color: 0x2b3a33 });
  ctx.decal(tex.newspaper(), -11.59, 1.0, nz, 0.42, 0.52, Math.PI / 2);
  ctx.collision.addCentered(-11.9, 0.15, nz, 0.6, 1.1, 0.5, false);
  ctx.point('newspaper', new THREE.Vector3(-11.2, 0.15, nz), 1.8);

  // benches where people would actually sit
  bench(ctx, -12.4, -76, Math.PI / 2);
  bench(ctx, 12.4, 84, -Math.PI / 2);

  // graffiti in the alley cut through AW2
  ctx.decal(tex.graffiti('who left the lights on'), -23, 2.6, -23.94, 7, 1.75, 0, { transparent: true });
  ctx.lamp(new THREE.Vector3(-14.2, 4.2, -21.5), 'warm', { intensity: 12, range: 10, halo: 0.5, cone: false });

  // hum under the hotel sign
  ctx.sound('hum', new THREE.Vector3(12.2, 8, hz - 4.6));
}

function lobbyTexture(): THREE.CanvasTexture {
  const el = document.createElement('canvas');
  el.width = 512;
  el.height = 336;
  const c = el.getContext('2d')!;
  const g = c.createLinearGradient(0, 0, 0, 336);
  g.addColorStop(0, '#3a2412');
  g.addColorStop(1, '#8a5a2c');
  c.fillStyle = g;
  c.fillRect(0, 0, 512, 336);
  // back wall panels
  c.fillStyle = 'rgba(0,0,0,0.25)';
  for (let x = 20; x < 512; x += 90) c.fillRect(x, 30, 60, 190);
  // lamp
  c.fillStyle = '#ffd9a0';
  c.beginPath();
  c.arc(380, 150, 18, 0, Math.PI * 2);
  c.fill();
  // desk
  c.fillStyle = '#1c120a';
  c.fillRect(150, 210, 300, 126);
  c.fillStyle = '#3a2615';
  c.fillRect(150, 206, 300, 10);
  // the clerk, still
  c.fillStyle = '#0d0907';
  c.beginPath();
  c.arc(300, 150, 20, 0, Math.PI * 2);
  c.fill();
  c.fillRect(272, 170, 56, 44);
  // door mullions
  c.fillStyle = '#0a0806';
  c.fillRect(0, 0, 512, 12);
  c.fillRect(0, 0, 12, 336);
  c.fillRect(500, 0, 12, 336);
  c.fillRect(250, 0, 12, 336);
  const t = new THREE.CanvasTexture(el);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
