import * as THREE from 'three';
import { carParts, CAR_GLASS, G } from '../world/builders/props';

/** the template shapes the city's cars are built from (shared: never freed) */
const TEMPLATE_GEOS = new Set<THREE.BufferGeometry>(Object.values(G));
import type { Lamp, WorldContext } from '../world/WorldContext';
import type { Collision } from '../world/Collision';
import type { Input } from '../core/Input';
import { wrap } from './Player';
import { SPECS, classFor, type VehicleSpec } from '../vehicles/specs';
import { Dynamics } from '../vehicles/dynamics';
import { buildVehicle, setLights, dent, type VehicleModel } from '../vehicles/model';

const ACCEL = 7.5;
const BRAKE = 16;
const REVERSE = 5;
const VMAX = 21;
const VREV = 6;
const DRAG = 2.2;
const WHEELBASE = 2.7;
const RADIUS = 0.95;

type Circle = { x: number; z: number; r: number };

export interface DrivableCar {
  group: THREE.Group;
  pos: THREE.Vector3;
  yaw: number;
  v: number;
  steer: number;
  van: boolean;
  /** half the distance between the front and rear collision circles */
  reach: number;
  lamps: Lamp[];
  occupied: boolean;
  /** set by "get out" while moving: brake to a stop, then let the player out */
  leaving: boolean;
  braking: boolean;
  tailMat: THREE.MeshStandardMaterial;
  /** electric: a YouTube screen on the dash (ui/CarScreen) */
  screen: boolean;
  color: number;
  /** another player is driving this one: ours is hidden (theirs is drawn by Remotes) */
  taken: boolean;
  /** parked by the RPG's streamer (not one of District 03's own) */
  streamed?: boolean;
  /** RPG: what kind (a pickup, a truck…), how it handles, where the driver sits */
  kind?: string;
  tune?: Tune;
  seat?: { x: number; y: number; z: number };
  /** RPG: 1 on a road, 0 off it (how much off-road slows it depends on the tune) */
  surface?: (x: number, z: number) => number;
  /** the real thing: its class, its physics, its model */
  spec: VehicleSpec;
  dyn: Dynamics;
  model: VehicleModel | null;
  /** what's broken: engine (0..1), lamps */
  damage: { engine: number; head: boolean; tail: boolean; total: number };
  /** indicators (-1, 0, 1), hazards, beacons (police / ambulance), headlights (0, 1, 2) */
  signal: { ind: -1 | 0 | 1; hazard: boolean; beacons: boolean; head: 0 | 1 | 2 };
  /** doors: where each wants to be (0 shut … 1 open), driver's first */
  doorWant: number[];
  /** when it last took a hit (seconds, the vehicles' clock) */
  lastHit?: number;
}

/** Handling, as multipliers on the city car's. */
export interface Tune {
  accel: number;
  vmax: number;
  steer: number;
  /** top speed off the road, as a fraction of on it */
  offroad: number;
}

/**
 * The parked cars you can actually get into. Arcade handling: a bicycle
 * model with speed-sensitive steering, three circles against the city's
 * boxes, and a hard stop against people and traffic.
 */
export class Vehicles {
  group = new THREE.Group();
  cars: DrivableCar[] = [];
  /** 0..1, how hard the last impact was (the camera shakes, audio thumps) */
  impact = 0;
  onImpact: ((strength: number) => void) | null = null;
  /** the road's grip (RPG weather: rain, snow, ice); 1 = dry tarmac */
  grip = 1;
  private tmp = new THREE.Vector3();

  /** the world's shared materials (never freed with a car) */
  private get shared() {
    return new Set<THREE.Material>(Object.values(this.ctx.mats) as THREE.Material[]);
  }

  constructor(private ctx: WorldContext) {
    for (const spec of ctx.cars) this.spawn(spec);
  }

  /** A car parked somewhere new (the RPG's towns park them as they stream in). */
  spawn(spec: { pos: THREE.Vector3; yaw: number; color: number; van: boolean; screen: boolean; mesh?: THREE.Group; tails?: THREE.MeshStandardMaterial; kind?: string; tune?: Tune; seat?: { x: number; y: number; z: number }; reach?: number }, streamed = false): DrivableCar {
    const ctx = this.ctx;
    const vs = SPECS[classFor(spec.kind, spec.van)];
    const g = new THREE.Group();
    let model: VehicleModel | null = null;
    let tailMat: THREE.MeshStandardMaterial;
    if (spec.mesh) {
      // a vehicle that already has a body (one taken from the road's traffic)
      g.add(spec.mesh);
      tailMat = spec.tails ?? (ctx.mats.lampRed as THREE.MeshStandardMaterial).clone();
    } else {
      model = buildVehicle(vs, vs.livery ? vs.paints[0] : spec.color);
      g.add(model.root);
      tailMat = model.mats.tail;
    }
    this.group.add(g);
    const lamps = [
      ctx.lamp(new THREE.Vector3(), 'cold', { pooled: true, intensity: 40, range: 20, cone: false, halo: 0.7, streak: 1.6, ground: 0, gain: 0 }),
      ctx.lamp(new THREE.Vector3(), 'cold', { pooled: false, cone: false, halo: 0.7, streak: 1.6, ground: 0, gain: 0 }),
      ctx.lamp(new THREE.Vector3(), 'red', { pooled: false, cone: false, halo: 0.4, streak: 0.7, ground: 0, gain: 0 }),
      ctx.lamp(new THREE.Vector3(), 'red', { pooled: false, cone: false, halo: 0.4, streak: 0.7, ground: 0, gain: 0 }),
    ];
    lamps.forEach((l) => (l.dynamic = true));
    // streamed cars don't join the district's fixed list of lamps (they come and go)
    if (streamed) ctx.lamps.splice(ctx.lamps.length - lamps.length, lamps.length);
    const dyn = new Dynamics(vs.mech);
    dyn.place(spec.pos.x, spec.pos.y, spec.pos.z, spec.yaw);
    const reach = spec.reach ?? Math.max(0.6, vs.shape.length / 2 - 0.95);
    const car: DrivableCar = {
      group: g, pos: spec.pos.clone(), yaw: spec.yaw, v: 0, steer: 0, van: spec.van, reach, lamps, occupied: false, leaving: false, braking: false, tailMat, screen: spec.screen, color: spec.color, taken: false, streamed, kind: spec.kind, tune: spec.tune,
      seat: vs.seat, spec: vs, dyn, model, damage: { engine: 0, head: false, tail: false, total: 0 }, signal: { ind: 0, hazard: false, beacons: false, head: 0 }, doorWant: model ? model.doors.map(() => 0) : [],
    };
    this.cars.push(car);
    this.place(car, 0);
    return car;
  }

  /** Take a streamed car away again (you drove off and left it far behind, or its street unloaded). */
  despawn(car: DrivableCar) {
    const i = this.cars.indexOf(car);
    if (i < 0 || car.occupied) return;
    this.cars.splice(i, 1);
    this.group.remove(car.group);
    car.model?.dispose();
    if (car.model) return; // its shapes are shared by every car of its class
    // free what this car made for itself: its paint and lights, and any geometry that's its own
    // (the RPG's cars are merged per car; the city's share the template boxes, which must stay)
    car.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (!TEMPLATE_GEOS.has(m.geometry)) m.geometry.dispose();
      const mat = m.material as THREE.Material;
      if (mat !== CAR_GLASS && !this.shared.has(mat)) mat.dispose?.();
    });
  }

  /** The car whose body is within `reach` metres of p, nearest first. */
  nearest(p: THREE.Vector3, reach = 1.6): { car: DrivableCar; d: number } | null {
    let best: { car: DrivableCar; d: number } | null = null;
    for (const car of this.cars) {
      if (car.occupied || car.taken) continue;
      const d = this.surfaceDistance(car, p.x, p.z);
      if (d < reach && (!best || d < best.d)) best = { car, d };
    }
    return best;
  }

  /** Solid circles for everything that walks (the player can't pass through a parked car). */
  obstacles(out: Circle[], except?: DrivableCar) {
    for (const car of this.cars) {
      if (car === except || car.taken) continue;
      this.circles(car, (x, z) => out.push({ x, z, r: RADIUS }));
    }
  }

  /** 0..1: how wet the roads are (set by the weather) */
  wet = 0;
  /** is it dark enough for headlights (set by the time of day) */
  dark = true;
  private t = 0;

  drive(car: DrivableCar, dt: number, input: Input | null, col: Collision, obstacles: Circle[]) {
    let throttle = 0, brake = 0, steer = 0, handbrake = false;
    if (input && !car.leaving) {
      // analog triggers and stick on a pad; W/S and A/D on a keyboard
      throttle = input.value('throttle');
      brake = input.value('brake');
      steer = -input.steer();
      handbrake = input.held('handbrake');
    }
    if (car.leaving) {
      throttle = 0;
      brake = 1;
      handbrake = Math.abs(car.v) < 3;
    }
    const d = car.dyn;
    d.engineDamage = car.damage.engine;
    // the ground under a point, and what it's made of
    const onRoad = car.surface ?? (() => 1);
    const grip = this.grip;
    const world = {
      ground: (x: number, z: number) => col.groundAt(x, z, d.y + 0.6, 0.7, 0.25),
      surface: (x: number, z: number) => {
        const r = onRoad(x, z);
        return { grip: grip * (r > 0.5 ? 1 : 0.78), rough: 1 - r };
      },
      wet: this.wet,
    };
    d.step(dt, { throttle, brake, steer, handbrake }, world);
    car.pos.set(d.x, d.y, d.z);
    car.yaw = d.yaw;
    this.collide(car, col, obstacles);
    d.x = car.pos.x;
    d.z = car.pos.z;
    car.v = d.forward;
    car.steer = d.steerIn * car.spec.mech.lock;
    car.braking = (brake > 0.05 && d.gear > 0 && car.v > 0.3) || (throttle > 0.05 && d.gear < 0) || (handbrake && Math.abs(car.v) > 0.3);
    if (d.thump > 0.3) {
      this.impact = Math.max(this.impact, d.thump * 0.6);
      d.thump = 0;
      this.onImpact?.(this.impact);
    }
    // indicators: on while steering at low speed (a turn at a junction), off when straight again
    if (Math.abs(car.v) < 9 && Math.abs(steer) > 0.45) car.signal.ind = steer > 0 ? -1 : 1;
    else if (Math.abs(d.steerIn) < 0.1) car.signal.ind = 0;
    car.signal.head = this.dark ? 1 : 0;
    car.signal.beacons = car.spec.livery === 'police' || car.spec.livery === 'ambulance' ? car.signal.beacons : false;
    this.place(car, dt);
  }

  /** Someone else left this car here. */
  moveTo(i: number, x: number, z: number, yaw: number) {
    const car = this.cars[i];
    if (!car || car.occupied) return;
    car.pos.set(x, 0, z);
    car.yaw = yaw;
    car.v = 0;
    car.dyn.place(x, 0, z, yaw);
    this.place(car, 0);
  }

  /** Engine off: parked cars settle, lights out; doors swing; lamps and wipers for everyone. */
  update(dt: number) {
    this.t += dt;
    this.impact = Math.max(0, this.impact - dt * 2.5);
    for (const car of this.cars) {
      car.group.visible = !car.taken;
      if (car.occupied) continue;
      if (Math.abs(car.v) > 0.01) {
        // rolled to a stop after being left
        car.v -= Math.sign(car.v) * Math.min(Math.abs(car.v), BRAKE * dt);
        car.pos.x += Math.sin(car.yaw) * car.v * dt;
        car.pos.z += Math.cos(car.yaw) * car.v * dt;
        car.dyn.place(car.pos.x, car.pos.y, car.pos.z, car.yaw);
      }
      car.braking = false;
      this.place(car, dt);
    }
  }

  /** Open or shut a door (0 = the driver's). */
  door(car: DrivableCar, i: number, open: boolean) {
    if (i < car.doorWant.length) car.doorWant[i] = open ? 1 : 0;
  }

  /** Where to stand to get in at the driver's door (world). */
  doorSpot(car: DrivableCar, out: THREE.Vector3): THREE.Vector3 {
    const s = car.spec;
    const lx = -(s.shape.width / 2 + 0.45), lz = car.seat?.z ?? s.seat.z;
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    out.set(car.pos.x + lx * fz + (lz + 0.35) * fx, car.pos.y, car.pos.z - lx * fx + (lz + 0.35) * fz);
    return out;
  }

  /** A free spot beside the car to step out to (driver's side first). */
  exitPoint(car: DrivableCar, col: Collision, out: THREE.Vector3): THREE.Vector3 {
    // the driver sits on the car's local −x: out that side first
    return exitBeside(car.pos, car.yaw, car.reach, -1, col, out, car.spec.shape.width / 2);
  }

  private collide(car: DrivableCar, col: Collision, obstacles: Circle[]) {
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    const r = Math.min(RADIUS, car.spec.shape.width / 2);
    let pushX = 0, pushZ = 0, hx = 0, hz = 0;
    const p = this.tmp;
    for (const k of [-1, -0.5, 0, 0.5, 1]) {
      const cx = car.pos.x + fx * car.reach * k, cz = car.pos.z + fz * car.reach * k;
      p.set(cx, car.pos.y, cz);
      col.resolve(p, r, 1.4, 0.35);
      for (const o of obstacles) {
        const dx = p.x - o.x, dz = p.z - o.z;
        const d = Math.hypot(dx, dz), min = r + o.r;
        if (d < min && d > 1e-4) {
          p.x = o.x + (dx / d) * min;
          p.z = o.z + (dz / d) * min;
        }
      }
      const dx = p.x - cx, dz = p.z - cz;
      if (Math.hypot(dx, dz) > Math.hypot(pushX, pushZ)) {
        pushX = dx;
        pushZ = dz;
        hx = cx - (dx / (Math.hypot(dx, dz) || 1)) * r;
        hz = cz - (dz / (Math.hypot(dx, dz) || 1)) * r;
      }
    }
    const push = Math.hypot(pushX, pushZ);
    if (push < 1e-4) return;
    car.pos.x += pushX;
    car.pos.z += pushZ;
    // the physics takes the speed into the obstacle, and spins the car by where it hit
    const into = car.dyn.hit(pushX / push, pushZ / push, hx, hz);
    // one crash is one crash (not one every frame you stay against the wall)
    if (into > 2.5 && this.t - (car.lastHit ?? -9) > 0.4) {
      car.lastHit = this.t;
      this.impact = Math.min(1, into / 16);
      this.onImpact?.(this.impact);
      this.damage(car, hx, hz, into);
    }
  }

  /** What a hit does to the car: a dent where it landed, lamps, the engine, the glass. */
  private damage(car: DrivableCar, wx: number, wz: number, speed: number) {
    const s = car.spec.shape;
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    const dx = wx - car.pos.x, dz = wz - car.pos.z;
    const lz = dx * fx + dz * fz, lx = dx * fz - dz * fx;
    const k = Math.min(1, (speed - 2.5) / 14);
    car.damage.total = Math.min(1, car.damage.total + k * 0.3);
    if (car.model) dent(car.model, Math.max(-s.width / 2, Math.min(s.width / 2, lx)), Math.min(s.belt - 0.1, s.clearance + 0.35), Math.max(-s.length / 2, Math.min(s.length / 2, lz)), k * 0.8);
    const front = lz > s.length / 2 - 0.9, rear = lz < -s.length / 2 + 0.9;
    if (front) {
      car.damage.engine = Math.min(1, car.damage.engine + k * 0.35);
      if (k > 0.35) car.damage.head = true;
    }
    if (rear && k > 0.35) car.damage.tail = true;
    if (car.model && k > 0.55) car.model.wear.glassCrack.value = Math.min(1, car.model.wear.glassCrack.value + k * 0.5);
  }

  private circles(car: DrivableCar, f: (x: number, z: number) => void) {
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    for (const k of [-1, 0, 1]) f(car.pos.x + fx * car.reach * k, car.pos.z + fz * car.reach * k);
  }

  private surfaceDistance(car: DrivableCar, x: number, z: number) {
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    const dx = x - car.pos.x, dz = z - car.pos.z;
    const along = dx * fx + dz * fz, side = dx * fz - dz * fx;
    const hl = car.reach + 0.75, hw = 0.95;
    const ex = Math.max(0, Math.abs(along) - hl), ez = Math.max(0, Math.abs(side) - hw);
    return Math.hypot(ex, ez);
  }

  private place(car: DrivableCar, dt: number) {
    const g = car.group;
    g.position.copy(car.pos);
    g.rotation.y = car.yaw;
    const d = car.dyn, m = car.model;
    const on = car.occupied;
    if (m) {
      // the body on its springs
      m.body.position.y = d.heave;
      m.body.rotation.set(-d.pitch, 0, car.spec.mech.bike ? d.lean : -d.roll);
      // wheels: steer, roll, and ride the ground under each
      for (let i = 0; i < m.wheels.length; i++) {
        const w = m.wheels[i], dw = d.wheels[i];
        if (!dw) continue;
        w.steer.rotation.y = dw.steer;
        w.spin.rotation.x = dw.spin;
        const y = dw.contact ? dw.ground - car.pos.y + w.r : w.r - car.spec.mech.travel * 0.7 + d.heave;
        w.steer.position.y += (y - w.steer.position.y) * Math.min(1, dt * 30 + (dt === 0 ? 1 : 0));
        if (car.spec.mech.bike) w.steer.rotation.z = d.lean;
      }
      m.steeringWheel.rotation.z = -d.steerIn * 2.6;
      // doors swing (a door is shown only while it isn't shut)
      for (let i = 0; i < m.doors.length; i++) {
        const dr = m.doors[i];
        const want = car.doorWant[i] ?? 0;
        dr.open += (want - dr.open) * Math.min(1, dt * (want > dr.open ? 5 : 7));
        dr.pivot.visible = dr.open > 0.02;
        dr.pivot.rotation.y = -dr.side * dr.open * 1.1;
      }
      // wipers when it's raining and someone's driving
      const wipe = on && this.wet > 0.25 ? Math.abs(Math.sin(this.t * 2.2)) : 0;
      m.wipers.forEach((w) => (w.children[0].rotation.z = wipe * 1.45));
      // the weather on the paint: rain (wet road = wet car), dirt from driving off the road
      m.wear.wet.value += (this.wet - m.wear.wet.value) * Math.min(1, dt * 0.5);
      m.wear.time.value = this.t;
      if (on && car.surface && Math.abs(car.v) > 2 && car.surface(car.pos.x, car.pos.z) < 0.5) m.wear.dirt.value = Math.min(1, m.wear.dirt.value + dt * 0.01);
      setLights(m, {
        head: on ? car.signal.head : 0,
        brake: on && car.braking,
        reverse: on && d.gear < 0,
        indicator: on ? car.signal.ind : 0,
        hazard: car.signal.hazard || (car.leaving && on),
        beacons: on && car.signal.beacons,
        running: on,
      }, this.t, { head: car.damage.head, tail: car.damage.tail });
    }
    g.updateMatrixWorld();
    // the light pool follows the lamps (a broken lamp throws no light)
    const mw = m ? m.body.matrixWorld : g.matrixWorld;
    if (m) {
      car.lamps[0].pos.copy(m.lampAt.head[0] ?? this.tmp.set(-0.62, 0.66, 2)).applyMatrix4(mw);
      car.lamps[1].pos.copy(m.lampAt.head[1] ?? m.lampAt.head[0]).applyMatrix4(mw);
      car.lamps[2].pos.copy(m.lampAt.tail[0]).applyMatrix4(mw);
      car.lamps[3].pos.copy(m.lampAt.tail[1] ?? m.lampAt.tail[0]).applyMatrix4(mw);
    } else {
      const L = car.reach + 0.75;
      car.lamps[0].pos.set(-0.62, 0.66, L + 0.2).applyMatrix4(mw);
      car.lamps[1].pos.set(0.62, 0.66, L + 0.2).applyMatrix4(mw);
      car.lamps[2].pos.set(-0.68, 0.74, -L - 0.1).applyMatrix4(mw);
      car.lamps[3].pos.set(0.68, 0.74, -L - 0.1).applyMatrix4(mw);
      car.tailMat.emissiveIntensity = on ? (car.braking ? 11 : 4) : 0.8;
    }
    const head = on && car.signal.head > 0 && !car.damage.head ? 1 : 0;
    car.lamps[0].gain = car.lamps[1].gain = head;
    car.lamps[2].gain = car.lamps[3].gain = on && !car.damage.tail ? (car.braking ? 2.6 : 1) : 0;
  }
}

/**
 * A free spot beside a vehicle to step out to. `side` 1 = the car's local +x
 * (driver's side), -1 = local -x (the kerb side for right-hand traffic).
 */
export function exitBeside(pos: THREE.Vector3, yaw: number, reach: number, side: 1 | -1, col: Collision, out: THREE.Vector3, half = 1.45): THREE.Vector3 {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const options: [number, number][] = [[(half + 0.55) * side, 0.3], [-(half + 0.55) * side, 0.3], [0, -(reach + 1.9)], [0, reach + 1.9]];
  for (const [sd, along] of options) {
    out.set(pos.x + fz * sd + fx * along, pos.y, pos.z - fx * sd + fz * along);
    const bx = out.x, bz = out.z;
    col.resolve(out, 0.32, 1.8, 0.46);
    if (Math.hypot(out.x - bx, out.z - bz) < 0.05) break;
  }
  out.y = col.groundAt(out.x, out.z, pos.y + 0.5, 0.6, 0.32);
  return out;
}
