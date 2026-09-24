import * as THREE from 'three';
import { carParts } from '../world/builders/props';
import type { Lamp, WorldContext } from '../world/WorldContext';
import type { Collision } from '../world/Collision';
import type { Input } from '../core/Input';
import { wrap } from './Player';

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
  private tmp = new THREE.Vector3();

  constructor(ctx: WorldContext) {
    for (const spec of ctx.cars) {
      const g = new THREE.Group();
      const paint = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.3, metalness: 0.3 });
      const tailMat = (ctx.mats.lampRed as THREE.MeshStandardMaterial).clone();
      for (const part of carParts(spec.color, spec.van)) {
        const mesh = new THREE.Mesh(part.geo, part.kind === 'paint' ? paint : part.kind === 'tail' ? tailMat : part.mat(ctx));
        mesh.applyMatrix4(part.m);
        mesh.castShadow = part.kind === 'paint';
        g.add(mesh);
      }
      this.group.add(g);
      const lamps = [
        ctx.lamp(new THREE.Vector3(), 'cold', { pooled: true, intensity: 40, range: 20, cone: false, halo: 0.7, streak: 1.6, ground: 0, gain: 0 }),
        ctx.lamp(new THREE.Vector3(), 'cold', { pooled: false, cone: false, halo: 0.7, streak: 1.6, ground: 0, gain: 0 }),
        ctx.lamp(new THREE.Vector3(), 'red', { pooled: false, cone: false, halo: 0.4, streak: 0.7, ground: 0, gain: 0 }),
        ctx.lamp(new THREE.Vector3(), 'red', { pooled: false, cone: false, halo: 0.4, streak: 0.7, ground: 0, gain: 0 }),
      ];
      lamps.forEach((l) => (l.dynamic = true));
      const car: DrivableCar = { group: g, pos: spec.pos.clone(), yaw: spec.yaw, v: 0, steer: 0, van: spec.van, reach: spec.van ? 1.7 : 1.45, lamps, occupied: false, leaving: false, braking: false, tailMat, screen: spec.screen, color: spec.color, taken: false };
      this.cars.push(car);
      this.place(car);
    }
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

  drive(car: DrivableCar, dt: number, input: Input | null, col: Collision, obstacles: Circle[]) {
    let throttle = 0, steer = 0, handbrake = false;
    if (input && !car.leaving) {
      if (input.isDown('KeyW') || input.isDown('ArrowUp')) throttle += 1;
      if (input.isDown('KeyS') || input.isDown('ArrowDown')) throttle -= 1;
      if (input.isDown('KeyA') || input.isDown('ArrowLeft')) steer += 1;
      if (input.isDown('KeyD') || input.isDown('ArrowRight')) steer -= 1;
      handbrake = input.isDown('Space');
    }
    if (car.leaving) handbrake = true;
    car.braking = (throttle < 0 && car.v > 0.2) || (throttle > 0 && car.v < -0.2) || (handbrake && Math.abs(car.v) > 0.1);

    // longitudinal
    if (throttle > 0) car.v += (car.v < -0.2 ? BRAKE : ACCEL * (1 - Math.max(0, car.v) / VMAX)) * dt;
    else if (throttle < 0) car.v -= (car.v > 0.2 ? BRAKE : REVERSE * (1 - Math.max(0, -car.v) / VREV)) * dt;
    else car.v -= Math.sign(car.v) * Math.min(Math.abs(car.v), DRAG * dt);
    if (handbrake) car.v -= Math.sign(car.v) * Math.min(Math.abs(car.v), 12 * dt);
    car.v = THREE.MathUtils.clamp(car.v, -VREV, VMAX);

    // steering: full lock at a crawl, gentle at speed, wheels self-centre
    const lock = 0.62 / (1 + Math.abs(car.v) * 0.07);
    car.steer += (steer * lock - car.steer) * Math.min(1, dt * (steer ? 5 : 8));
    car.yaw = wrap(car.yaw + (car.v * Math.tan(car.steer) / WHEELBASE) * dt);

    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    car.pos.x += fx * car.v * dt;
    car.pos.z += fz * car.v * dt;
    this.collide(car, col, obstacles);

    // ride over kerbs, never through walls
    const g = col.groundAt(car.pos.x, car.pos.z, car.pos.y, 0.35, 0.9);
    car.pos.y += (g - car.pos.y) * Math.min(1, dt * 12);
    this.place(car);
  }

  /** Someone else left this car here. */
  moveTo(i: number, x: number, z: number, yaw: number) {
    const car = this.cars[i];
    if (!car || car.occupied) return;
    car.pos.set(x, 0, z);
    car.yaw = yaw;
    car.v = 0;
    this.place(car);
  }

  /** Engine off: parked cars settle, lights out. */
  update(dt: number) {
    this.impact = Math.max(0, this.impact - dt * 2.5);
    for (const car of this.cars) {
      car.group.visible = !car.taken;
      if (car.occupied) continue;
      if (car.v !== 0) {
        car.v -= Math.sign(car.v) * Math.min(Math.abs(car.v), BRAKE * dt);
        this.place(car);
      }
      for (const l of car.lamps) l.gain = 0;
      car.braking = false;
      car.tailMat.emissiveIntensity = 0.8;
    }
  }

  /** A free spot beside the car to step out to (driver's side first). */
  exitPoint(car: DrivableCar, col: Collision, out: THREE.Vector3): THREE.Vector3 {
    return exitBeside(car.pos, car.yaw, car.reach, 1, col, out);
  }

  private collide(car: DrivableCar, col: Collision, obstacles: Circle[]) {
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    let pushX = 0, pushZ = 0;
    const p = this.tmp;
    for (const k of [-1, 0, 1]) {
      const cx = car.pos.x + fx * car.reach * k, cz = car.pos.z + fz * car.reach * k;
      p.set(cx, car.pos.y, cz);
      col.resolve(p, RADIUS, 1.4, 0.35);
      for (const o of obstacles) {
        const dx = p.x - o.x, dz = p.z - o.z;
        const d = Math.hypot(dx, dz), min = RADIUS + o.r;
        if (d < min && d > 1e-4) {
          p.x = o.x + (dx / d) * min;
          p.z = o.z + (dz / d) * min;
        }
      }
      const dx = p.x - cx, dz = p.z - cz;
      if (Math.abs(dx) > Math.abs(pushX)) pushX = dx;
      if (Math.abs(dz) > Math.abs(pushZ)) pushZ = dz;
    }
    const push = Math.hypot(pushX, pushZ);
    if (push < 1e-4) return;
    car.pos.x += pushX;
    car.pos.z += pushZ;
    // how much of our motion went into the wall
    const into = -(fx * pushX + fz * pushZ) / push * Math.sign(car.v);
    if (into > 0.3) {
      const hit = Math.abs(car.v) * into;
      if (hit > 3) {
        this.impact = Math.min(1, hit / 16);
        this.onImpact?.(this.impact);
      }
      car.v *= 1 - Math.min(0.85, into);
    }
  }

  private circles(car: DrivableCar, f: (x: number, z: number) => void) {
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    for (const k of [-1, 0, 1]) f(car.pos.x + fx * car.reach * k, car.pos.z + fz * car.reach * k);
  }

  private surfaceDistance(car: DrivableCar, x: number, z: number) {
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    const dx = x - car.pos.x, dz = z - car.pos.z;
    const along = dx * fx + dz * fz, side = dx * fz - dz * fx;
    const hl = car.van ? 2.5 : 2.2, hw = 0.95;
    const ex = Math.max(0, Math.abs(along) - hl), ez = Math.max(0, Math.abs(side) - hw);
    return Math.hypot(ex, ez);
  }

  private place(car: DrivableCar) {
    const g = car.group;
    g.position.copy(car.pos);
    g.rotation.y = car.yaw;
    g.updateMatrixWorld();
    const m = g.matrixWorld;
    const L = car.van ? 2.5 : 2.2;
    car.lamps[0].pos.set(-0.62, 0.66, L + 0.2).applyMatrix4(m);
    car.lamps[1].pos.set(0.62, 0.66, L + 0.2).applyMatrix4(m);
    car.lamps[2].pos.set(-0.68, 0.74, -L - 0.1).applyMatrix4(m);
    car.lamps[3].pos.set(0.68, 0.74, -L - 0.1).applyMatrix4(m);
    car.lamps[0].pos.x += Math.sin(car.yaw) * 1.5;
    car.lamps[0].pos.z += Math.cos(car.yaw) * 1.5;
    const on = car.occupied ? 1 : 0;
    car.lamps[0].gain = car.lamps[1].gain = on;
    car.lamps[2].gain = car.lamps[3].gain = on * (car.braking ? 2.6 : 1);
    car.tailMat.emissiveIntensity = car.occupied ? (car.braking ? 11 : 4) : 0.8;
  }
}

/**
 * A free spot beside a vehicle to step out to. `side` 1 = the car's local +x
 * (driver's side), -1 = local -x (the kerb side for right-hand traffic).
 */
export function exitBeside(pos: THREE.Vector3, yaw: number, reach: number, side: 1 | -1, col: Collision, out: THREE.Vector3): THREE.Vector3 {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const options: [number, number][] = [[2.0 * side, 0.3], [-2.0 * side, 0.3], [0, -(reach + 1.9)], [0, reach + 1.9]];
  for (const [sd, along] of options) {
    out.set(pos.x + fz * sd + fx * along, pos.y, pos.z - fx * sd + fz * along);
    const bx = out.x, bz = out.z;
    col.resolve(out, 0.32, 1.8, 0.46);
    if (Math.hypot(out.x - bx, out.z - bz) < 0.05) break;
  }
  out.y = col.groundAt(out.x, out.z, pos.y + 0.5, 0.6, 0.32);
  return out;
}
