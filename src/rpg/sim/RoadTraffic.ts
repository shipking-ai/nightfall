import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SPECS, classFor } from '../../vehicles/specs';
import { buildVehicle, type VehicleModel } from '../../vehicles/model';
import { FigureBatch } from '../../entities/FigureBatch';
import { newMotion, newRig, seatedRoot, solve, stepPhase, visibleParts, type Body, type Motion, type Outfit, type Rig } from '../../entities/Humanoid';
import { makePerson, type ArchetypeId } from '../../data/people';
import { mulberry32 } from '../../world/rng';

const RNG = mulberry32(90210);
function weighted(r: { next(): number }, list: [ArchetypeId, number][]): ArchetypeId {
  let sum = 0;
  for (const [, w] of list) sum += w;
  let x = r.next() * sum;
  for (const [k, w] of list) if ((x -= w) <= 0) return k;
  return list[0][0];
}
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
  /** the person driving it (a figure in the drivers' batch), and where they sit */
  slot: number;
  driver: { body: Body; outfit: Outfit; motion: Motion; rig: Rig; lastYaw: number };
  seat: { x: number; y: number; z: number };
}

const MAX = 16;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
// Road geometry is only built within NEAR_R chunks of the player (Streamer.ts),
// so a car must never be spawned or kept further out than that — past it they
// drive along roads that aren't drawn, on nothing but the far-tile smear.
const BUILT_R = 384;
const SPAWN_MIN = 160, SPAWN_MAX = 380, DROP = 400;

/**
 * How far right of the centreline a car sits, in metres. Derived from the same
 * lane centres the road shader paints (Roads.ts: edge lines at 0.35 and w-0.35,
 * double-yellow median at w/2, dashes at w/4 and 3w/4 for a highway, w/2 for a
 * road) so the wheels sit in the painted lane instead of on a line.
 */
function laneOffset(road: Road): number {
  const w = road.width;
  if (w >= 13) return w / 4; // highway: outer lane of the near carriageway
  if (w >= 7) return w / 4; // road: one lane each way, dash on the centreline
  return w / 2 - 0.6; // track: single carriageway, no markings
}

export class RoadTraffic {
  group = new THREE.Group();
  private cars: Vehicle[] = [];
  private lengths = new Map<Road, Float64Array>();
  private spawnAt = 0;
  private tmp = new THREE.Vector3();
  night = 0;
  /** everyone at a wheel: drawn close up, sat in, hands on it, turning it with the road */
  private drivers = new FigureBatch(MAX, { shadows: false });
  private free: number[] = Array.from({ length: MAX }, (_, i) => MAX - 1 - i);
  private seatM = new THREE.Matrix4();
  private tmpM = new THREE.Matrix4();
  /** where each car was last frame, so a strike can be swept against it */
  private prev = new Map<Vehicle, THREE.Vector3>();
  /** when each car last hit someone */
  private hitAt = new Map<Vehicle, number>();
  /** everyone on foot near the roads, so traffic brakes for them; set each frame */
  strikable: { x: number; z: number }[] = [];

  constructor(private gen: WorldGen, private mats: Materials) {
    this.group.add(this.drivers.group);
  }

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
    // The ribbon is mitred: its cross-section is the perpendicular averaged with
    // the neighbouring segments, not this segment's own chord. Offsetting the car
    // by the chord put it off the drawn carriageway on every bend, so use the
    // same average the mesh uses.
    const perp = (k: number) => {
      const px0 = P[Math.max(0, k - 1) * 2], pz0 = P[Math.max(0, k - 1) * 2 + 1];
      const px1 = P[Math.min(n - 1, k + 1) * 2], pz1 = P[Math.min(n - 1, k + 1) * 2 + 1];
      const dx = px1 - px0, dz = pz1 - pz0, l = Math.hypot(dx, dz) || 1;
      return [-dz / l, dx / l];
    };
    const [pax, paz] = perp(lo);
    const [pbx, pbz] = perp(hi);
    const nx = pax + (pbx - pax) * t;
    const nz = paz + (pbz - paz) * t;
    const nl = Math.hypot(nx, nz) || 1;
    const ax = P[lo * 2], az = P[lo * 2 + 1], bx = P[hi * 2], bz = P[hi * 2 + 1];
    const dx = bx - ax, dz = bz - az;
    // Right-hand traffic: keep to the right of the direction of travel. In a
    // +y-up frame the right of travel f=(dx,dz) is (-dz, dx), and travelling
    // backwards (dir -1) reverses it — so the offset is signed by dir.
    const lane = laneOffset(road);
    const rx = (nx / nl) * dir, rz = (nz / nl) * dir;
    // the ribbon is drawn 4 cm above the road profile, so stand the car on it
    const y = road.h[lo] + (road.h[hi] - road.h[lo]) * t + 0.04;
    out.set(ax + dx * t + rx * lane, y, az + dz * t + rz * lane);
    const yaw = Math.atan2(dx * dir, dz * dir);
    // the grade over the stretch, so the nose follows the road rather than
    // stepping down every segment
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
      // remember where it was, for the swept strike test below
      const pv = this.prev.get(v);
      if (pv) pv.copy(v.pos);
      else this.prev.set(v, v.pos.clone());
      // the car ahead in the same lane
      let gap = 1e9;
      for (const o of this.cars) if (o !== v && o.road === v.road && o.dir === v.dir) {
        const ahead = (o.s - v.s) * v.dir;
        if (ahead > 0 && ahead < gap) gap = ahead;
      }
      // you, standing in the road. Traffic slows for people it can see in time —
      // so it brakes for you, but only from far enough out to matter. Someone
      // who steps out in front of a car at close quarters still gets hit, which
      // is the whole point of the strike test.
      const dp = Math.hypot(player.x - v.pos.x, player.z - v.pos.z);
      const toYou = (player.x - v.pos.x) * Math.sin(v.yaw) + (player.z - v.pos.z) * Math.cos(v.yaw);
      const lateral = Math.abs(dp * dp - toYou * toYou) > 0 ? Math.sqrt(Math.max(0, dp * dp - toYou * toYou)) : 0;
      if (toYou > 0 && dp < 34 && lateral < 2.4) {
        // the distance it needs to stop, plus a reaction margin
        const stop = (v.v * v.v) / (2 * 7) + v.v * 0.55;
        if (toYou > stop * 0.55) gap = Math.min(gap, toYou);
      }
      for (const w of this.strikable) {
        const wx = w.x - v.pos.x, wz = w.z - v.pos.z;
        const dw = Math.hypot(wx, wz);
        if (dw > 30) continue;
        const tow = wx * Math.sin(v.yaw) + wz * Math.cos(v.yaw);
        if (tow <= 0) continue;
        const lat = Math.sqrt(Math.max(0, dw * dw - tow * tow));
        if (lat >= 2.4) continue;
        const stop = (v.v * v.v) / (2 * 7) + v.v * 0.7;
        if (tow > stop * 0.4) gap = Math.min(gap, tow);
      }
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
      if (v.pos.distanceTo(player) > Math.min(DROP, BUILT_R)) v.alive = false;
    }
    for (const v of this.cars) if (!v.alive) this.drop(v);
    this.cars = this.cars.filter((v) => v.alive);
    this.drawDrivers(dt, player);
  }

  /**
   * Anyone a car on the road has just hit. `fn` is called once per hit, with
   * the car's position and its velocity, so the caller can decide what being
   * hit by a car means. Traffic brakes for people in the road, so this mostly
   * catches a car that arrived too fast to stop, or one whose driver didn't.
   */
  strikes(p: THREE.Vector3, fn: (pos: THREE.Vector3, vx: number, vz: number, speed: number) => void) {
    for (const v of this.cars) {
      const speed = Math.abs(v.v);
      if (speed < 3) continue;
      // yaw already carries the direction of travel, so this is its velocity
      const vx = Math.sin(v.yaw) * v.v, vz = Math.cos(v.yaw) * v.v;
      // swept against where the car was last frame, so nothing slips through
      // the gap between frames at 20 m/s
      const back = this.prev.get(v);
      const t = back ? clamp01(((p.x - back.x) * vx + (p.z - back.z) * vz) / (speed * speed)) : 0;
      const ax = (back ? back.x : v.pos.x) + vx * t, az = (back ? back.z : v.pos.z) + vz * t;
      if (Math.hypot(p.x - ax, p.z - az) > 2.2) continue;
      // once per car per moment, so a slow overlap doesn't fire every frame
      const now = performance.now();
      if ((this.hitAt.get(v) ?? -1e9) > now - 700) continue;
      this.hitAt.set(v, now);
      fn(v.pos, vx, vz, speed);
    }
  }

  /** The drivers, near enough to see: in their seats, steering with the road, glancing about. */
  private drawDrivers(dt: number, player: THREE.Vector3) {
    const t = performance.now() / 1000;
    for (const v of this.cars) {
      const d = v.pos.distanceTo(player);
      if (d > 70 || v.slot < 0) {
        if (v.slot >= 0) this.drivers.hide(v.slot);
        continue;
      }
      const p = v.driver, m = p.motion;
      const turn = Math.atan2(Math.sin(v.yaw - p.lastYaw), Math.cos(v.yaw - p.lastYaw)) / Math.max(dt, 1e-3);
      p.lastYaw = v.yaw;
      m.steer += (THREE.MathUtils.clamp(turn * 1.6, -1, 1) - m.steer) * Math.min(1, dt * 5);
      // eyes on the road, into the bend, now and then the mirror
      const mirror = Math.sin(t * 0.37 + v.slot * 1.7) > 0.93 ? 0.75 : 0;
      m.lookYaw += (m.steer * 0.4 + mirror - m.lookYaw) * Math.min(1, dt * 3);
      m.speed = 0;
      stepPhase(m, dt);
      v.mesh.updateMatrixWorld();
      const md = v.mesh.userData.model as VehicleModel | undefined;
      // hips on the cushion, not feet on it: the seat datum is a hip point, and
      // the rig's origin is the feet, so without this the head goes through the roof
      seatedRoot(this.seatM, md ? md.body.matrixWorld : v.mesh.matrixWorld, v.seat, p.body);
      solve(p.rig, this.seatM, p.body, p.outfit, m, t);
      this.drivers.write(v.slot, p.rig, visibleParts(p.outfit, d), false);
    }
    this.drivers.flush();
  }

  private drop(v: Vehicle) {
    this.forget(v.mesh);
    this.prev.delete(v);
    this.hitAt.delete(v);
    if (v.slot >= 0) {
      this.drivers.hide(v.slot);
      this.free.push(v.slot);
      v.slot = -1;
    }
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
    const { mesh, lights, tails, seat } = vehicleMesh(kind, this.mats);
    // who's driving: an ordinary person of these parts
    const slot = this.free.pop() ?? -1;
    const who = makePerson(RNG, weighted(RNG, [['commuter', 3], ['worker', 3], ['office', 1], ['elder', 1], ['drifter', 0.5], ['courier', 1]]));
    who.outfit.umbrella = false;
    who.outfit.backpack = null;
    const motion = newMotion();
    motion.sit = 1;
    motion.armL = motion.armR = 'wheel';
    if (slot >= 0) this.drivers.dress(slot, who.outfit, 0x9fc4ff, who.body);
    const vmax = (road.kind === 'highway' ? 27 : road.kind === 'road' ? 18 : 10) * (kind === 'truck' || kind === 'bus' ? 0.8 : kind === 'sports' ? 1.15 : 1) * (0.85 + Math.random() * 0.25);
    const v: Vehicle = { kind, road, s, dir, v: vmax, vmax, mesh, lights, tails, pos: new THREE.Vector3(), yaw: 0, alive: true, slot, driver: { body: who.body, outfit: who.outfit, motion, rig: newRig(), lastYaw: 0 }, seat };
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
    if (v.slot >= 0) {
      // the driver's out of it now (pulled out: they run off in the fiction; their figure goes)
      this.drivers.hide(v.slot);
      this.free.push(v.slot);
      v.slot = -1;
    }
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
    for (const v of this.cars) this.drop(v);
    this.cars = [];
    this.drivers.flush();
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

export function vehicleMesh(kind: VehicleKind, mats: Materials): { mesh: THREE.Group; lights: THREE.MeshStandardMaterial; tails: THREE.MeshStandardMaterial; model: VehicleModel; seat: { x: number; y: number; z: number } } {
  // the same vehicles you can drive (vehicles/model.ts): its class's body, its own paint
  const spec = SPECS[classFor(kind === 'moto' ? 'motorcycle' : kind)];
  const color = spec.livery ? spec.paints[0] : PAINT[Math.floor(Math.random() * PAINT.length)];
  const model = buildVehicle(spec, color);
  model.root.userData.model = model;
  void mats;
  return { mesh: model.root, lights: model.mats.head, tails: model.mats.tail, model, seat: spec.seat };
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
