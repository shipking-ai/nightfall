import * as THREE from 'three';
import { CAR_ROUTES } from '../world/layout';
import { carParts, CAR_COLORS, CAR_GLASS } from '../world/builders/props';
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
 * A handful of cars that cross the district and leave. They slow for the
 * player, keep their distance from each other, and light the wet road ahead.
 */
export class Traffic {
  group = new THREE.Group();
  cars: Car[] = [];
  private paths: Path[];
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
      const tailMat = (ctx.mats.lampRed as THREE.MeshStandardMaterial).clone();
      for (const part of carParts(color)) {
        const mat = part.kind === 'paint' ? new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.3 }) : part.kind === 'tail' ? tailMat : part.kind === 'glass' ? CAR_GLASS : part.mat(ctx);
        const mesh = new THREE.Mesh(part.geo, mat);
        mesh.applyMatrix4(part.m);
        mesh.castShadow = part.kind === 'paint';
        g.add(mesh);
      }
      for (const sx of [-0.62, 0.62]) {
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.position.set(sx, 0.62, 2.25);
        beam.rotation.x = 0.06;
        g.add(beam);
      }
      if (isTaxi) {
        const roof = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.3), sign);
        roof.position.set(0, 1.32, -0.2);
        g.add(roof);
      }
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
      const car: Car = { group: g, path: null, s: 0, v: 0, vmax: 10, wait: i * 5 + 1, lamps, yaw: 0, tailMat, blocked: 0, honkIn: 0 };
      if (isTaxi) car.taxi = { hailed: false, wait: 0, cooldown: 0, rider: false, stopping: false, arrived: false, riderId: '' };
      this.cars.push(car);
    }
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
    // the pooled headlight sits a little ahead so it lights the road
    car.lamps[0].pos.addScaledVector(fwd, 1.5);
    car.lamps[0].gain = car.lamps[1].gain = 1;
    car.lamps[2].gain = car.lamps[3].gain = braking ? 2.6 : 1;
    car.tailMat.emissiveIntensity = braking ? 11 : 4;
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

  /** Off (WARZONE, FIGHT): every car off the streets. */
  setEnabled(on: boolean) {
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
    if (!this.group.visible) return;
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
          car.path = this.rng.pick(this.paths);
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
        car.wait = this.rng.range(3, 12);
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
