import * as THREE from 'three';
import { CAR_ROUTES } from '../world/layout';
import { CAR_COLORS, SEATS } from '../world/builders/props';
import { SPECS, type VehicleClass, type VehicleSpec } from '../vehicles/specs';
import { buildVehicle, setLights, type VehicleModel } from '../vehicles/model';
import { FigureBatch } from './FigureBatch';
import { newMotion, newRig, seatedRoot, solve, stepPhase, visibleParts, type Body, type Motion, type Outfit, type Rig } from './Humanoid';
import { makePerson, weighted } from '../data/people';
import type { Lamp, WorldContext } from '../world/WorldContext';
import { mulberry32 } from '../world/rng';

interface Path {
  pts: THREE.Vector3[];
  cum: number[];
  total: number;
}

export interface Car {
  group: THREE.Group;
  path: Path | null;
  s: number;
  v: number;
  vmax: number;
  wait: number;
  lamps: Lamp[];
  yaw: number;
  sound?: { setPosition(p: THREE.Vector3, speed: number): void };
  /** the one car you can hail */
  taxi?: TaxiState;
  /** per-car tail-lamp material, so the brake lights are this car's alone */
  tailMat: THREE.MeshStandardMaterial;
  /** the car itself (vehicles/model.ts): wheels to turn, lamps to light */
  model: VehicleModel;
  /** which class this is, and what it was painted: what you'd get if you took it */
  spec: VehicleSpec;
  color: number;
  /** last position, for the wheels' roll */
  lastS: number;
  /** seconds spent stopped behind you (or a car you left in the road) */
  blocked: number;
  honkIn: number;
  /** multiplayer: the host's latest word on this car (followers only) */
  net?: { path: number; s: number; v: number; flags: number; at: number };
}

interface TaxiState {
  /** pulling in / standing at the kerb for the player */
  hailed: boolean;
  wait: number;
  cooldown: number;
  rider: boolean;
  /** the rider asked to get out, or the route is running out */
  stopping: boolean;
  /** stopped with a rider who should now step out (App reads and clears this) */
  arrived: boolean;
  /** multiplayer: which player is riding ('' = nobody; the local player when alone) */
  riderId: string;
}

/** One car in a city snapshot: [route index or -1, s, v, taxi flags]. */
export type CarWire = [number, number, number, number];
const T_HAILED = 1, T_RIDER = 2, T_STOPPING = 4, T_ARRIVED = 8;

export const TAXI_COLOR = 0xa8842c;

/**
 * What District 03 actually drives. Weighted towards the two classes that make
 * a street look like a street, with the rest in enough numbers that pulling
 * someone out of a car is a small surprise rather than a fixed set.
 */
const TRAFFIC_CLASSES: [VehicleClass, number][] = [
  ['sedan', 5],
  ['hatch', 4],
  ['sports', 1.2],
  ['pickup', 1.5],
  ['offroad', 1],
  ['van', 1.5],
  ['motorcycle', 1.5],
];

/**
 * A handful of cars that cross the district and leave. They slow for the
 * player, keep their distance from each other, and light the wet road ahead.
 */
export class Traffic {
  group = new THREE.Group();
  cars: Car[] = [];
  private paths: Path[];
  /** someone at every wheel (the taxi driver has been doing this a long time) */
  private drivers: FigureBatch;
  private people: { body: Body; outfit: Outfit; motion: Motion; rig: Rig; lastYaw: number }[] = [];
  private seatM = new THREE.Matrix4();
  private tmpM = new THREE.Matrix4();
  private rng = mulberry32(55);

  constructor(ctx: WorldContext, count = 4) {
    // Max corner radius 6 m (was a fixed 7): per-corner radius below is
    // angle-aware so turns stay tight inside the intersection instead of
    // swinging wide toward the parked kerb lane at junctions.
    this.paths = CAR_ROUTES.map((r) => roundPath(r.pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), 6));
    const beamMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying float vT; varying float vRim; varying float vDist;
        void main() {
          vT = position.z;                       // 0 at the lamp … 1 at the end
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vec3 n = normalize(normalMatrix * normal);
          vRim = abs(dot(n, normalize(-mv.xyz)));
          vDist = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vT; varying float vRim; varying float vDist;
        void main() {
          float t = clamp(vT, 0.0, 1.0);
          float rim = clamp(vRim, 0.0, 1.0);
          float a = pow(1.0 - t, 1.6) * smoothstep(0.0, 0.12, t) * rim * rim * rim * 0.022 * smoothstep(2.0, 8.0, vDist);
          gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * max(a, 0.0), 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const beamGeo = new THREE.CylinderGeometry(0.1, 2.2, 1, 28, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    beamGeo.scale(1, 0.55, 14);

    const sign = new THREE.MeshStandardMaterial({ color: 0x1a1408, emissive: new THREE.Color(1.0, 0.72, 0.3), emissiveIntensity: 2.2 });
    for (let i = 0; i < count; i++) {
      const isTaxi = i === 0;
      const color = isTaxi ? TAXI_COLOR : this.rng.pick(CAR_COLORS);
      const g = new THREE.Group();
      // The city drives the same machines you can. A taxi, and a spread of
      // ordinary traffic, so the car you pull someone out of is never one you
      // couldn't otherwise have found parked.
      const cls: VehicleClass = isTaxi ? 'taxi' : weighted(this.rng, TRAFFIC_CLASSES);
      const spec = SPECS[cls];
      const model = buildVehicle(spec, spec.livery ? spec.paints[0] : color);
      g.add(model.root);
      const tailMat = model.mats.tail;
      for (const sx of [-0.62, 0.62]) {
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.position.set(sx, 0.62, 2.25);
        beam.rotation.x = 0.06;
        g.add(beam);
      }
      void sign;
      g.visible = false;
      this.group.add(g);
      // lamps travel with the car: two white fronts (one pooled), two red rears
      const lamps = [
        ctx.lamp(new THREE.Vector3(), 'cold', { pooled: true, intensity: 40, range: 20, cone: false, halo: 0.7, streak: 1.6, ground: 0 }),
        ctx.lamp(new THREE.Vector3(), 'cold', { pooled: false, cone: false, halo: 0.7, streak: 1.6, ground: 0 }),
        ctx.lamp(new THREE.Vector3(), 'red', { pooled: false, cone: false, halo: 0.4, streak: 0.7, ground: 0 }),
        ctx.lamp(new THREE.Vector3(), 'red', { pooled: false, cone: false, halo: 0.4, streak: 0.7, ground: 0 }),
      ];
      lamps.forEach((l) => (l.dynamic = true));
      const car: Car = { group: g, path: null, s: 0, v: 0, vmax: 10, wait: i * 5 + 1, lamps, yaw: 0, tailMat, blocked: 0, honkIn: 0, model, spec, color, lastS: 0 };
      if (isTaxi) car.taxi = { hailed: false, wait: 0, cooldown: 0, rider: false, stopping: false, arrived: false, riderId: '' };
      this.cars.push(car);
    }
    this.drivers = new FigureBatch(count, { shadows: false });
    this.group.add(this.drivers.group);
    for (let i = 0; i < count; i++) {
      const p = makePerson(this.rng, i === 0 ? 'taxi' : weighted(this.rng, [['commuter', 3], ['office', 2], ['worker', 2], ['courier', 1], ['nurse', 1], ['drifter', 1]]));
      p.outfit.umbrella = false;
      p.outfit.backpack = null;
      const motion = newMotion();
      motion.sit = 1;
      motion.armL = motion.armR = 'wheel';
      this.drivers.dress(i, p.outfit, 0x9fc4ff, p.body);
      this.people.push({ body: p.body, outfit: p.outfit, motion, rig: newRig(), lastYaw: 0 });
    }
  }

  /** The drivers: sat in, hands on the wheel, turning it with the road; they glance at what they pass. */
  drawDrivers(dt: number, t: number, cam: THREE.Vector3) {
    this.cars.forEach((car, i) => {
      const p = this.people[i];
      if (!p) return;
      if (!car.group.visible || !this.group.visible) return this.drivers.hide(i);
      const d = car.group.position.distanceTo(cam);
      if (d > 70) return this.drivers.hide(i);
      car.group.updateMatrixWorld();
      // each car's own seat (a hatch's is not a saloon's), and hips on the cushion
      // rather than feet on it, or the driver's head goes through the roof
      const st = car.model.root.userData.seat ?? (car.model.root.userData.seat = car.model.spec.seat);
      const m = p.motion;
      const turn = wrapA(car.yaw - p.lastYaw) / Math.max(dt, 1e-3);
      p.lastYaw = car.yaw;
      m.steer += (THREE.MathUtils.clamp(turn * 1.6, -1, 1) - m.steer) * Math.min(1, dt * 5);
      // held at the lights by a fight: everyone's watching it
      const watch = this.held ? THREE.MathUtils.clamp(wrapA(Math.atan2(this.heldLook.x - car.group.position.x, this.heldLook.z - car.group.position.z) - car.yaw), -1.1, 1.1) : null;
      m.lookYaw += ((watch ?? m.steer * 0.35 + Math.sin(t * 0.3 + i * 2) * 0.15) - m.lookYaw) * Math.min(1, dt * 2);
      m.speed = 0;
      stepPhase(m, dt);
      seatedRoot(this.seatM, car.model.body.matrixWorld, st, p.body);
      solve(p.rig, this.seatM, p.body, p.outfit, m, t);
      this.drivers.write(i, p.rig, visibleParts(p.outfit, d), false);
    });
    this.drivers.flush();
  }

  /**
   * The nearest car out on a route that you could reach through the driver's
   * door. Only moving cars: a car waiting at the kerb with nobody in it is
   * scenery, and the taxi has its own interaction.
   */
  nearestDrivable(p: THREE.Vector3, reach = 2.6): { car: Car; d: number } | null {
    let best: { car: Car; d: number } | null = null;
    for (const car of this.cars) {
      if (!car.path || car.taxi?.rider) continue;
      const pos = car.group.position;
      const d = Math.hypot(pos.x - p.x, pos.z - p.z);
      if (d > reach) continue;
      if (!best || d < best.d) best = { car, d };
    }
    return best;
  }

  /**
   * Take a car off the road: it stops being traffic and becomes the player's.
   * The slot is retired (its path dropped, its lamps freed, its driver hidden)
   * so the pool can send it out again later as a different vehicle.
   */
  takeOver(car: Car): { pos: THREE.Vector3; yaw: number; spec: VehicleSpec; color: number } | null {
    if (!car.path) return null;
    const out = { pos: car.group.position.clone(), yaw: car.yaw, spec: car.spec, color: car.color };
    this.retire(car);
    return out;
  }

  /** Drop one car out of the traffic pool: no route, no lamps, no driver. */
  retire(car: Car) {
    car.path = null;
    car.s = 0;
    car.v = 0;
    car.blocked = 0;
    car.honkIn = 0;
    // out of the pool for good, not just parked: only setDensity() brings it back
    car.wait = Infinity;
    car.group.visible = false;
    car.taxi = undefined;
    for (const l of car.lamps) l.gain = 0;
    const i = this.cars.indexOf(car);
    if (i >= 0) this.drivers.hide(i);
    return i;
  }

  /** The taxi standing at the kerb within reach of p, if any. */
  waitingTaxi(p: THREE.Vector3): Car | null {
    for (const car of this.cars) {
      const tx = car.taxi;
      if (!tx || !car.path || !tx.hailed || tx.rider || Math.abs(car.v) > 0.6) continue;
      if (car.group.position.distanceTo(p) < 4.8) return car;
    }
    return null;
  }

  board(car: Car, riderId = 'me') {
    const tx = car.taxi!;
    tx.rider = true;
    tx.riderId = riderId;
    tx.hailed = false;
    tx.stopping = false;
    tx.arrived = false;
    car.vmax = 9;
  }

  /** "Let me out here." */
  requestStop(car: Car) {
    if (car.taxi) car.taxi.stopping = true;
  }

  alight(car: Car) {
    const tx = car.taxi!;
    tx.rider = false;
    tx.riderId = '';
    tx.stopping = false;
    tx.arrived = false;
    tx.cooldown = 20;
    car.wait = 0;
  }

  /** a car honks at (x,z) */
  onHonk: ((x: number, z: number) => void) | null = null;

  /**
   * `player` is you on foot or in a car; `blockers` are other things in the
   * road (cars you drove and left there). Traffic brakes for all of them.
   */
  /** Multiplayer: someone else hosts the room; follow their snapshots instead of driving. */
  puppet = false;

  snapshot(): { c: CarWire[]; r: string[] } {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return {
      c: this.cars.map((car) => {
        const tx = car.taxi;
        const flags = tx ? (tx.hailed ? T_HAILED : 0) | (tx.rider ? T_RIDER : 0) | (tx.stopping ? T_STOPPING : 0) | (tx.arrived ? T_ARRIVED : 0) : 0;
        return [car.path ? this.paths.indexOf(car.path) : -1, r2(car.s), r2(car.v), flags];
      }),
      r: this.cars.map((car) => car.taxi?.riderId ?? ''),
    };
  }

  apply(w: { c?: unknown; r?: unknown }) {
    if (!Array.isArray(w?.c) || w.c.length !== this.cars.length) return;
    const at = performance.now();
    (w.c as CarWire[]).forEach((c, i) => {
      if (!Array.isArray(c) || c.length < 4 || !c.every((v) => Number.isFinite(v))) return;
      const car = this.cars[i];
      car.net = { path: c[0], s: c[1], v: c[2], flags: c[3], at };
      const tx = car.taxi;
      if (tx) {
        tx.hailed = !!(c[3] & T_HAILED);
        tx.rider = !!(c[3] & T_RIDER);
        tx.stopping = !!(c[3] & T_STOPPING);
        tx.arrived = !!(c[3] & T_ARRIVED);
        const r = Array.isArray(w.r) ? w.r[i] : '';
        tx.riderId = typeof r === 'string' ? r.slice(0, 16) : '';
      }
    });
  }

  /** Follower: dead-reckon along the host's route, easing into each snapshot. */
  private follow(dt: number) {
    const tmp = new THREE.Vector3();
    const fwd = new THREE.Vector3();
    for (const car of this.cars) {
      const net = car.net;
      if (!net) continue;
      const path = net.path >= 0 ? this.paths[net.path] ?? null : null;
      if (!path) {
        car.path = null;
        car.group.visible = false;
        for (const l of car.lamps) l.gain = 0;
        continue;
      }
      if (car.path !== path) {
        car.path = path;
        car.s = net.s;
        car.group.visible = true;
      }
      const since = (performance.now() - net.at) / 1000;
      const target = Math.min(path.total, net.s + net.v * Math.min(since, 1.5));
      const diff = target - car.s;
      car.s = Math.abs(diff) > 8 ? target : car.s + diff * Math.min(1, dt * 4);
      const before = car.v;
      car.v += (net.v - car.v) * Math.min(1, dt * 5);
      this.place(car, tmp, fwd, car.v < before - dt * 0.6 || car.v < 0.3);
    }
  }

  private place(car: Car, tmp: THREE.Vector3, fwd: THREE.Vector3, braking: boolean) {
    sample(car.path!, car.s, tmp, fwd);
    car.group.position.copy(tmp);
    const yaw = Math.atan2(fwd.x, fwd.z);
    car.yaw = yaw;
    car.group.rotation.y = yaw;
    car.group.updateMatrixWorld();
    const m = car.group.matrixWorld;
    car.lamps[0].pos.set(-0.62, 0.66, 2.4).applyMatrix4(m);
    car.lamps[1].pos.set(0.62, 0.66, 2.4).applyMatrix4(m);
    car.lamps[2].pos.set(-0.68, 0.74, -2.3).applyMatrix4(m);
    car.lamps[3].pos.set(0.68, 0.74, -2.3).applyMatrix4(m);
    car.lamps[0].gain = car.lamps[1].gain = 1;
    car.lamps[2].gain = car.lamps[3].gain = braking ? 2.6 : 1;
    // lamps lit, brakes when it slows, the wheels roll with the road and steer into its bends
    setLights(car.model, { head: 1, brake: braking, reverse: false, indicator: 0, hazard: !!car.taxi?.hailed && car.v < 0.5, beacons: false, running: true }, performance.now() / 1000, { head: false, tail: false });
    const ds = car.s - car.lastS;
    car.lastS = car.s;
    const turn = wrapA(yaw - (car.model.root.userData.yaw ?? yaw));
    car.model.root.userData.yaw = yaw;
    for (const w of car.model.wheels) {
      if (Math.abs(ds) < 5) w.spin.rotation.x += ds / w.r;
      if (w.front) w.steer.rotation.y += (THREE.MathUtils.clamp(turn * 25, -0.5, 0.5) - w.steer.rotation.y) * 0.2;
    }
    car.sound?.setPosition(tmp, car.v);
  }

  /**
   * `player` is you on foot or in a car; `blockers` are other things in the
   * road (cars you drove and left there); `others` are other players on foot
   * (multiplayer host). Traffic brakes for all of them, and the taxi will
   * pull in for any of them.
   */
  /** how many cars are allowed out (population setting); the taxi is always one of them */
  private limit = Infinity;
  setDensity(k: number) {
    this.limit = Math.max(1, Math.round(this.cars.length * k));
  }

  /** FIGHT: cars stopped at the lights round the crossing (lights on, engines running, drivers watching). */
  private held: { x: number; z: number; yaw: number }[] | null = null;
  private heldLook = new THREE.Vector3();
  hold(spots: { x: number; z: number; yaw: number }[] | null, lookAt?: THREE.Vector3) {
    this.held = spots;
    if (lookAt) this.heldLook.copy(lookAt);
    this.group.visible = !!spots;
    const fwd = new THREE.Vector3();
    this.cars.forEach((car, i) => {
      car.path = null;
      car.v = 0;
      car.wait = 2 + Math.random() * 4;
      const s = spots?.[i];
      car.group.visible = !!s;
      for (const l of car.lamps) l.gain = 0;
      if (!s) return;
      fwd.set(Math.sin(s.yaw), 0, Math.cos(s.yaw));
      car.group.position.set(s.x, 0, s.z);
      car.yaw = s.yaw;
      car.group.rotation.y = s.yaw;
      car.group.updateMatrixWorld();
      const m = car.group.matrixWorld;
      car.lamps[0].pos.set(-0.62, 0.66, 2.4).applyMatrix4(m);
      car.lamps[1].pos.set(0.62, 0.66, 2.4).applyMatrix4(m);
      car.lamps[2].pos.set(-0.68, 0.74, -2.3).applyMatrix4(m);
      car.lamps[3].pos.set(0.68, 0.74, -2.3).applyMatrix4(m);
      car.lamps[0].gain = car.lamps[1].gain = 1;
      car.lamps[2].gain = car.lamps[3].gain = 2.6;
      car.tailMat.emissiveIntensity = 11;
      car.sound?.setPosition(car.group.position, 0);
      if (car.taxi) Object.assign(car.taxi, { hailed: false, rider: false, riderId: '', stopping: false, arrived: false });
    });
  }

  /** Off (WARZONE, FIGHT): every car off the streets. */
  setEnabled(on: boolean) {
    this.held = null;
    this.group.visible = on;
    if (on) return;
    for (const car of this.cars) {
      car.path = null;
      car.wait = 2 + Math.random() * 4;
      car.v = 0;
      car.group.visible = false;
      car.sound?.setPosition(car.group.position, 0);
      if (car.taxi) Object.assign(car.taxi, { rider: false, riderId: '', stopping: false, arrived: false });
    }
  }

  update(dt: number, player: THREE.Vector3 | null, playerSpeed = 0, blockers: THREE.Vector3[] = [], others: { pos: THREE.Vector3; speed: number }[] = []) {
    if (!this.group.visible || this.held) return;
    if (this.puppet) return this.follow(dt);
    const tmp = new THREE.Vector3();
    const fwd = new THREE.Vector3();
    for (const car of this.cars) {
      const tx = car.taxi;
      if (tx) tx.cooldown -= dt;
      if (!car.path) {
        car.wait -= dt;
        for (const l of car.lamps) l.gain = 0;
        if (this.cars.indexOf(car) >= this.limit) car.wait = Math.max(car.wait, 1);
        if (car.wait <= 0) {
          // the emptiest of a few roads, so the traffic spreads over the whole district
          let path = this.rng.pick(this.paths), fewest = Infinity;
          for (let k = 0; k < 3; k++) {
            const p = this.rng.pick(this.paths);
            const n = this.cars.filter((o) => o.path === p).length;
            if (n < fewest) (fewest = n), (path = p);
          }
          // not straight into the back of a car that's just set off along the same road
          if (this.cars.some((o) => o !== car && o.path === path && o.s < 28)) {
            car.wait = 0.8;
            continue;
          }
          car.path = path;
          car.s = 0;
          car.v = 8;
          car.vmax = this.rng.range(8.5, 12);
          car.group.visible = true;
        }
        continue;
      }
      sample(car.path, car.s, tmp, fwd);
      // brake for the player and for the car in front
      let limit = car.vmax;
      if (tx?.rider) {
        // the passenger's ride: stop when asked, and before the road leaves the district
        if (car.path.total - car.s < 40) tx.stopping = true;
        if (tx.stopping) {
          limit = 0;
          if (Math.abs(car.v) < 0.25) tx.arrived = true;
        }
      } else if (tx && tx.cooldown <= 0) {
        // hailing: anyone standing still at the kerb beside the taxi's lane, ahead of it
        let bestAhead = Infinity;
        const consider = (p: THREE.Vector3, speed: number) => {
          const dx = p.x - tmp.x, dz = p.z - tmp.z;
          const ahead = dx * fwd.x + dz * fwd.z;
          const side = Math.abs(dx * fwd.z - dz * fwd.x);
          if (speed < 0.8 && p.y < 1.2 && ahead > -4 && ahead < 35 && side > 1.8 && side < 8 && ahead < bestAhead) bestAhead = ahead;
        };
        if (player) consider(player, playerSpeed);
        for (const o of others) consider(o.pos, o.speed);
        const someone = bestAhead < Infinity;
        if (!tx.hailed && someone && bestAhead > 1 && car.path.total - car.s > 80) tx.hailed = true;
        if (tx.hailed) {
          if (someone) limit = Math.min(limit, Math.max(0, (bestAhead - 0.3) * 0.9));
          if (Math.abs(car.v) < 0.4) tx.wait += dt;
          if (tx.wait > 10 || !someone) {
            tx.hailed = false;
            tx.wait = 0;
            tx.cooldown = 25;
          }
        }
      }
      let heldUp = false;
      const yieldTo = (p: THREE.Vector3, width: number, gap: number) => {
        const dx = p.x - tmp.x, dz = p.z - tmp.z;
        const ahead = dx * fwd.x + dz * fwd.z;
        const side = Math.abs(dx * fwd.z - dz * fwd.x);
        if (ahead > 0 && ahead < 14 && side < width && p.y < 1.5) {
          const l = Math.max(0, (ahead - gap) * 1.2);
          if (l < limit) {
            limit = l;
            heldUp = l < 0.5;
          }
        }
      };
      if (player && !tx?.rider) yieldTo(player, 1.8, 4);
      for (const o of others) yieldTo(o.pos, 1.8, 4);
      for (const b of blockers) yieldTo(b, 2.1, 5.5);
      for (const o of this.cars) {
        if (o === car || !o.path) continue;
        const dx = o.group.position.x - tmp.x, dz = o.group.position.z - tmp.z;
        const ahead = dx * fwd.x + dz * fwd.z;
        const side = Math.abs(dx * fwd.z - dz * fwd.x);
        if (ahead > 0 && ahead < 14 && side < 2) limit = Math.min(limit, Math.max(0, (ahead - 7) * 1.5));
      }
      const before = car.v;
      car.v += (limit - car.v) * Math.min(1, dt * (limit < car.v ? 3 : 0.8));
      const braking = car.v < before - dt * 0.6 || car.v < 0.3;
      // held up by you: a patient pause, then the horn, then again
      if (heldUp && !tx?.hailed) {
        car.blocked += dt;
        car.honkIn -= dt;
        if (car.blocked > 2.2 && car.honkIn <= 0) {
          car.honkIn = 4 + this.rng.range(0, 4);
          this.onHonk?.(tmp.x, tmp.z);
        }
      } else {
        car.blocked = 0;
        car.honkIn = 0;
      }
      car.s += car.v * dt;
      if (car.s >= car.path.total && !tx?.rider) {
        car.path = null;
        car.group.visible = false;
        car.wait = this.rng.range(1.5, 6);
        continue;
      }
      this.place(car, tmp, fwd, braking);
    }
  }
}

/** Polyline → dense path with rounded corners. Radius is angle-aware: sharp
 *  90° junction turns get ~4.2 m so cars stay in the intersection, straights
 *  get ~0 (no rounding), U-turns get the full max. */
function roundPath(pts: THREE.Vector3[], radius: number): Path {
  const out: THREE.Vector3[] = [pts[0].clone()];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const d1 = b.clone().sub(a).normalize(), d2 = c.clone().sub(b).normalize();
    const cosTheta = THREE.MathUtils.clamp(d1.dot(d2), -1, 1);
    const theta = Math.acos(cosTheta); // 0 = straight, PI = U-turn
    const angleR = 6 * Math.sin(theta / 2);
    const r = Math.min(radius, angleR, a.distanceTo(b) / 2, b.distanceTo(c) / 2);
    const p0 = b.clone().addScaledVector(d1, -r), p2 = b.clone().addScaledVector(d2, r);
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      const q = new THREE.Vector3()
        .addScaledVector(p0, (1 - t) * (1 - t))
        .addScaledVector(b, 2 * (1 - t) * t)
        .addScaledVector(p2, t * t);
      out.push(q);
    }
  }
  out.push(pts[pts.length - 1].clone());
  const cum = [0];
  for (let i = 1; i < out.length; i++) cum.push(cum[i - 1] + out[i].distanceTo(out[i - 1]));
  return { pts: out, cum, total: cum[cum.length - 1] };
}

function sample(p: Path, s: number, out: THREE.Vector3, dir: THREE.Vector3) {
  let lo = 0, hi = p.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p.cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const seg = p.cum[hi] - p.cum[lo] || 1;
  const t = (s - p.cum[lo]) / seg;
  out.lerpVectors(p.pts[lo], p.pts[hi], Math.min(1, Math.max(0, t)));
  dir.subVectors(p.pts[hi], p.pts[lo]).normalize();
}

function wrapA(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
