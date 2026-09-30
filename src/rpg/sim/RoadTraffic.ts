import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SPECS, classFor } from '../../vehicles/specs';
import { buildVehicle, type VehicleModel } from '../../vehicles/model';
import type { Materials } from '../../world/materials';
import type { WorldContext } from '../../world/WorldContext';
import { BIOMES, type VehicleKind } from '../world/biomes';
import type { Road, WorldGen } from '../world/WorldGen';

/**
 * Traffic on the roads between places. Vehicles are picked by the land
 * they're driving through (pickups and trucks in farm country, off-roaders in
 * the north, buses between cities), keep to the right, follow the road's
 * rise and fall, slow for the car in front, and come and go out of sight.
 * Headlights at night, brake lights when they slow.
 */

interface Vehicle {
  kind: VehicleKind;
  road: Road;
  /** metres along the road */
  s: number;
  dir: 1 | -1;
  v: number;
  vmax: number;
  mesh: THREE.Group;
  lights: THREE.MeshStandardMaterial;
  tails: THREE.MeshStandardMaterial;
  pos: THREE.Vector3;
  yaw: number;
  alive: boolean;
}

const MAX = 16;
const SPAWN_MIN = 160, SPAWN_MAX = 520, DROP = 700;

export class RoadTraffic {
  group = new THREE.Group();
  private cars: Vehicle[] = [];
  private lengths = new Map<Road, Float64Array>();
  private spawnAt = 0;
  private tmp = new THREE.Vector3();
  night = 0;

  constructor(private gen: WorldGen, private mats: Materials) {}

  private cum(road: Road): Float64Array {
    let c = this.lengths.get(road);
    if (c) return c;
    const P = road.pts, n = P.length / 2;
    c = new Float64Array(n);
    for (let i = 1; i < n; i++) c[i] = c[i - 1] + Math.hypot(P[i * 2] - P[i * 2 - 2], P[i * 2 + 1] - P[i * 2 - 1]);
    if (this.lengths.size > 200) this.lengths.clear();
    this.lengths.set(road, c);
    return c;
  }

  /** Where the road passes closest to a point: metres along it, and how far off. */
  private nearest(road: Road, p: THREE.Vector3): { s: number; d: number } {
    const c = this.cum(road), P = road.pts, n = c.length;
    let best = 1e18, bs = 0;
    for (let i = 0; i < n - 1; i++) {
      const ax = P[i * 2], az = P[i * 2 + 1], dx = P[i * 2 + 2] - ax, dz = P[i * 2 + 3] - az;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / l2));
      const ex = ax + dx * t - p.x, ez = az + dz * t - p.z, d2 = ex * ex + ez * ez;
      if (d2 < best) {
        best = d2;
        bs = c[i] + (c[i + 1] - c[i]) * t;
      }
    }
    return { s: bs, d: Math.sqrt(best) };
  }

  /** Where on the road (in its lane) at distance s. */
  private at(road: Road, s: number, dir: 1 | -1, out: THREE.Vector3): { yaw: number; pitch: number } {
    const c = this.cum(road), P = road.pts, n = c.length;
    s = Math.max(0, Math.min(c[n - 1] - 0.01, s));
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid] <= s) lo = mid;
      else hi = mid;
    }
    const t = (s - c[lo]) / Math.max(1e-6, c[hi] - c[lo]);
    const ax = P[lo * 2], az = P[lo * 2 + 1], bx = P[hi * 2], bz = P[hi * 2 + 1];
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
    // right-hand traffic: the lane is to the right of the direction of travel
    const lane = road.kind === 'highway' ? 3.6 : road.kind === 'road' ? 2.2 : 1.2;
    const rx = (-dz / l) * -dir, rz = (dx / l) * -dir;
    out.set(ax + dx * t + rx * lane, road.h[lo] + (road.h[hi] - road.h[lo]) * t + 0.02, az + dz * t + rz * lane);
    const yaw = Math.atan2(dx * dir, dz * dir);
    const pitch = -Math.atan2((road.h[hi] - road.h[lo]) * dir, c[hi] - c[lo]);
    return { yaw, pitch };
  }

  update(dt: number, player: THREE.Vector3) {
    // spawn out of sight, on roads near you: a few tries a tick, by wall time
    // (slow frames cap dt, and a car or two should always be on its way)
    const now = performance.now();
    if (now >= this.spawnAt && this.cars.length < MAX) {
      this.spawnAt = now + 450;
      const roads = this.gen.roadsNear(player.x, player.z);
      for (let k = 0; k < 6 && roads.length; k++) {
        const road = roads[Math.floor(Math.random() * roads.length)];
        const near = this.nearest(road, player);
        if (near.d > SPAWN_MAX) continue;
        // along the road from where it passes you, far enough to be out of sight
        const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
        const along = Math.sqrt(Math.max(0, SPAWN_MIN * SPAWN_MIN - near.d * near.d)) + Math.random() * (SPAWN_MAX - SPAWN_MIN) * 0.6;
        // behind you going your way, or ahead coming towards you
        const s = near.s + (Math.random() < 0.5 ? -along : along);
        const c = this.cum(road);
        if (s < 0 || s > c[c.length - 1]) continue;
        this.at(road, s, dir, this.tmp);
        const d = this.tmp.distanceTo(player);
        if (d < SPAWN_MIN * 0.8 || d > SPAWN_MAX) continue;
        if (this.cars.some((o) => o.road === road && o.dir === dir && Math.abs(o.s - s) < 40)) continue;
        this.add(road, s, dir);
        break;
      }
    }
    for (const v of this.cars) {
      // the car ahead in the same lane
      let gap = 1e9;
      for (const o of this.cars) if (o !== v && o.road === v.road && o.dir === v.dir) {
        const ahead = (o.s - v.s) * v.dir;
        if (ahead > 0 && ahead < gap) gap = ahead;
      }
      // and you, standing in the road
      const dp = Math.hypot(player.x - v.pos.x, player.z - v.pos.z);
      const toYou = (player.x - v.pos.x) * Math.sin(v.yaw) + (player.z - v.pos.z) * Math.cos(v.yaw);
      if (toYou > 0 && dp < 30 && Math.abs(dp * dp - toYou * toYou) < 9) gap = Math.min(gap, toYou);
      const want = gap < 12 ? 0 : gap < 40 ? v.vmax * (gap - 12) / 28 : v.vmax;
      const braking = want < v.v - 0.5;
      v.v += Math.max(-9 * dt, Math.min(3 * dt, want - v.v));
      v.s += v.v * v.dir * dt;
      const c = this.cum(v.road);
      if (v.s < 0 || v.s > c[c.length - 1]) v.alive = false;
      const { yaw, pitch } = this.at(v.road, v.s, v.dir, v.pos);
      v.yaw = yaw;
      v.mesh.position.copy(v.pos);
      v.mesh.rotation.set(pitch, yaw, 0, 'YXZ');
      v.lights.emissiveIntensity = 0.2 + this.night * 5;
      // wheels roll with the road
      const md = v.mesh.userData.model as VehicleModel | undefined;
      if (md) for (const w of md.wheels) w.spin.rotation.x += (v.v * dt) / w.r;
      v.tails.emissiveIntensity = (braking ? 8 : 0.4) + this.night * 3;
      if (v.pos.distanceTo(player) > DROP) v.alive = false;
    }
    for (const v of this.cars) if (!v.alive) this.forget(v.mesh);
    this.cars = this.cars.filter((v) => v.alive);
  }

  private add(road: Road, s: number, dir: 1 | -1) {
    const mid = road.pts.length / 2 / 2 | 0;
    const biome = this.gen.ground(road.pts[mid * 2], road.pts[mid * 2 + 1]).biome;
    const list = BIOMES[biome].vehicles.length ? BIOMES[biome].vehicles : BIOMES.temperate.vehicles;
    let sum = 0;
    for (const [, w] of list) sum += w;
    let k = Math.random() * sum;
    let kind: VehicleKind = list[0][0];
    for (const [vk, w] of list) if ((k -= w) <= 0) {
      kind = vk;
      break;
    }
    if (road.kind === 'highway' && Math.random() < 0.08) kind = 'bus';
    if (road.kind === 'track' && (kind === 'bus' || kind === 'sports')) kind = 'pickup';
    const { mesh, lights, tails } = vehicleMesh(kind, this.mats);
    const vmax = (road.kind === 'highway' ? 27 : road.kind === 'road' ? 18 : 10) * (kind === 'truck' || kind === 'bus' ? 0.8 : kind === 'sports' ? 1.15 : 1) * (0.85 + Math.random() * 0.25);
    const v: Vehicle = { kind, road, s, dir, v: vmax, vmax, mesh, lights, tails, pos: new THREE.Vector3(), yaw: 0, alive: true };
    this.group.add(mesh);
    this.cars.push(v);
  }

  /** A car stopped (or crawling) beside you: the one you could pull the driver out of. */
  stoppedNear(p: THREE.Vector3, r = 3.2): { kind: VehicleKind; pos: THREE.Vector3; yaw: number } | null {
    let best: Vehicle | null = null, bd = r;
    for (const v of this.cars) {
      if (v.v > 1.5 || v.kind === 'bus' || v.kind === 'moto') continue;
      const d = Math.hypot(v.pos.x - p.x, v.pos.z - p.z);
      if (d < bd) (bd = d), (best = v);
    }
    return best && { kind: best.kind, pos: best.pos, yaw: best.yaw };
  }

  /** Take it off the road (it's yours now): returns its mesh and lights, and forgets it. */
  take(p: THREE.Vector3): { kind: VehicleKind; pos: THREE.Vector3; yaw: number; mesh: THREE.Group; tails: THREE.MeshStandardMaterial } | null {
    const s = this.stoppedNear(p);
    if (!s) return null;
    const v = this.cars.find((c) => c.pos === s.pos)!;
    this.cars = this.cars.filter((c) => c !== v);
    this.group.remove(v.mesh);
    v.mesh.rotation.set(0, 0, 0);
    return { kind: v.kind, pos: v.pos.clone(), yaw: v.yaw, mesh: v.mesh, tails: v.tails };
  }

  /** Solid circles for walkers (and your car). */
  obstacles(out: { x: number; z: number; r: number }[]) {
    for (const v of this.cars) {
      const L = v.kind === 'bus' || v.kind === 'truck' ? 4 : 1.5;
      for (const k of [-L, 0, L]) out.push({ x: v.pos.x + Math.sin(v.yaw) * k, z: v.pos.z + Math.cos(v.yaw) * k, r: v.kind === 'moto' ? 0.5 : 1.05 });
    }
  }

  clear() {
    for (const v of this.cars) this.forget(v.mesh);
    this.cars = [];
  }

  /** Off the road for good: its own geometry and paint go back to the GPU (the shared materials stay). */
  private forget(mesh: THREE.Group) {
    this.group.remove(mesh);
    disposeVehicle(mesh, this.mats);
  }

  get count() {
    return this.cars.length;
  }
}

/* ── the vehicles themselves ───────────────────────────── */

const PAINT = [0x7a1c16, 0x1c2a44, 0x2c2c2e, 0xb8b4ac, 0x3a4a2a, 0x5a4a36, 0x8a8a86, 0x1a1a1c, 0x6a5a2a, 0x2a4a5a, 0xd8d4cc];

export function vehicleMesh(kind: VehicleKind, mats: Materials): { mesh: THREE.Group; lights: THREE.MeshStandardMaterial; tails: THREE.MeshStandardMaterial; model: VehicleModel } {
  // the same vehicles you can drive (vehicles/model.ts): its class's body, its own paint
  const spec = SPECS[classFor(kind === 'moto' ? 'motorcycle' : kind)];
  const color = spec.livery ? spec.paints[0] : PAINT[Math.floor(Math.random() * PAINT.length)];
  const model = buildVehicle(spec, color);
  model.root.userData.model = model;
  void mats;
  return { mesh: model.root, lights: model.mats.head, tails: model.mats.tail, model };
}

/** Free what a vehicleMesh made for itself: every geometry (merged per vehicle) and its own materials, not the shared ones. */
export function disposeVehicle(root: THREE.Object3D, mats: Materials) {
  // a class model: its shapes are shared by its class, only its materials are its own
  const model = root.userData.model as VehicleModel | undefined;
  if (model) return model.dispose();
  const shared = new Set<THREE.Material>(Object.values(mats) as THREE.Material[]);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    const ms = Array.isArray(m.material) ? m.material : [m.material];
    for (const x of ms) if (!shared.has(x)) x.dispose();
  });
}
