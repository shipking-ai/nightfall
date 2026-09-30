import type { Mech } from './specs';

/**
 * How a vehicle actually moves: a body with mass on springs, on tyres that
 * grip and let go.
 *
 * - Each wheel's spring carries a share of the weight; accelerating, braking
 *   and cornering move that load between the wheels (the nose dives, the
 *   body leans), and a tyre can only give as much force as the load on it
 *   and the surface allow.
 * - Tyres make force from slip: a lateral slip angle (the car pointing one
 *   way and going another) and a longitudinal slip (driving or braking),
 *   sharing one friction budget. Past the peak they slide: understeer when
 *   the fronts give up first, oversteer when the rears do, a drift when the
 *   handbrake locks the rears or the throttle spins them.
 * - An engine with a torque curve through a gearbox (automatic: it shifts on
 *   rpm, holds a gear through a corner, drops into reverse from a stop).
 * - Surfaces: tarmac, wet tarmac (less grip; standing water floats the tyres
 *   at speed), gravel and grass, snow and ice.
 * - Off the ground it flies (and lands, with a thump and the suspension
 *   taking it).
 *
 * Integrated at a fixed 240 Hz inside each frame so it's steady at any frame rate.
 */

export interface Controls {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (left) .. 1 (right)
  handbrake: boolean;
}

export interface Wheel {
  /** attachment, car-local (x right, z forward) */
  lx: number;
  lz: number;
  front: boolean;
  driven: boolean;
  /** suspension compression (m) and its rate */
  comp: number;
  compV: number;
  /** load (N) this step */
  load: number;
  contact: boolean;
  /** road wheel angle (steering, radians) */
  steer: number;
  /** rolling angle (for drawing), angular speed */
  spin: number;
  omega: number;
  /** 0..1: sliding (for smoke, sound and marks) */
  slip: number;
  /** ground height under it this step */
  ground: number;
}

export interface Surface {
  /** grip multiplier here (1 tarmac; gravel 0.7; grass 0.6; snow 0.4; ice 0.15) */
  grip: number;
  /** 0 on a road … 1 off it */
  rough: number;
}

export interface World {
  ground(x: number, z: number): number;
  surface(x: number, z: number): Surface;
  /** 0..1: how wet the road is */
  wet: number;
}

const G = 9.81;
const STEP = 1 / 240;

export class Dynamics {
  // body (world): position at the ground under the body centre, heading, planar velocity
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  vx = 0;
  vz = 0;
  vy = 0;
  /** yaw rate (rad/s) */
  r = 0;
  /** body attitude from the springs (radians; pitch + = nose up, roll + = right side down) and heave (m above rest) */
  pitch = 0;
  roll = 0;
  heave = 0;
  pitchV = 0;
  rollV = 0;
  heaveV = 0;
  wheels: Wheel[] = [];
  // engine and gearbox
  rpm = 800;
  gear = 1;
  shiftT = 0;
  /** smoothed throttle actually applied (for sound) and the load on the engine */
  throttle = 0;
  load = 0;
  /** motorcycle lean (radians), visual */
  lean = 0;
  airborne = 0;
  /** last landing / impact strength, for effects (decays) */
  thump = 0;
  /** 0..1 engine damage: less power, rougher */
  engineDamage = 0;
  /** steering as applied (−1..1) */
  steerIn = 0;
  private acc = 0;
  /** longitudinal and lateral acceleration (m/s², car frame), smoothed: for the camera, the driver, the sound */
  ax = 0;
  ay = 0;

  constructor(public m: Mech) {
    const hf = m.track / 2;
    const add = (lz: number, front: boolean, driven: boolean) => {
      for (const lx of m.bike ? [0] : [-hf, hf]) this.wheels.push({ lx, lz, front, driven, comp: m.sag, compV: 0, load: 0, contact: true, steer: 0, spin: 0, omega: 0, slip: 0, ground: 0 });
    };
    add(m.axleF, true, m.drive !== 'rwd');
    add(m.axleR, false, m.drive !== 'fwd');
    for (const z of m.extraAxles ?? []) add(z, false, m.drive !== 'fwd');
    this.rpm = m.idle;
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }
  /** signed forward speed (m/s) */
  get forward() {
    return this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw);
  }
  get lateral() {
    return this.vx * Math.cos(this.yaw) - this.vz * Math.sin(this.yaw);
  }

  place(x: number, y: number, z: number, yaw: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.yaw = yaw;
    this.vx = this.vz = this.vy = this.r = 0;
    this.pitch = this.roll = this.heave = this.pitchV = this.rollV = this.heaveV = 0;
    for (const w of this.wheels) {
      w.comp = this.m.sag;
      w.compV = 0;
      w.omega = 0;
    }
  }

  step(dt: number, c: Controls, world: World) {
    this.acc += Math.min(dt, 0.1);
    let n = 0;
    while (this.acc >= STEP && n < 40) {
      this.acc -= STEP;
      this.sub(STEP, c, world);
      n++;
    }
    for (const w of this.wheels) w.spin += w.omega * dt;
    this.thump = Math.max(0, this.thump - dt * 2);
  }

  private sub(dt: number, c: Controls, world: World) {
    const m = this.m;
    const mass = m.mass;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // car-frame velocity: u forward, w to the right
    let u = this.vx * sy + this.vz * cy;
    let w = this.vx * cy - this.vz * sy;
    const speed = Math.hypot(u, w);

    /* ── the driver ── */
    // steering: less lock at speed (people don't saw at the wheel at 100), and it winds on at a hand's pace
    const lockNow = m.lock / (1 + Math.max(0, Math.abs(u) - 4) * 0.045);
    this.steerIn += (c.steer - this.steerIn) * Math.min(1, dt * (Math.abs(c.steer) > Math.abs(this.steerIn) ? 6 : 9));
    const steerA = this.steerIn * lockNow;
    // Ackermann: the inside wheel turns more
    for (const wh of this.wheels) {
      if (!wh.front) continue;
      const turnR = m.wheelbase / Math.max(1e-3, Math.tan(Math.abs(steerA)));
      const inside = Math.sign(steerA) === Math.sign(wh.lx) || m.bike;
      wh.steer = steerA === 0 ? 0 : Math.sign(steerA) * Math.atan(m.wheelbase / Math.max(0.5, turnR + (inside ? -1 : 1) * m.track / 2));
    }

    /* ── engine and gearbox ── */
    // throttle and brake mean different things going backwards: the brake pedal reverses from a stop
    let drive = c.throttle, brake = c.brake;
    if (this.gear > 0 && u < 0.6 && c.brake > 0.2 && c.throttle < 0.1 && m.reverse > 0) this.gear = -1;
    else if (this.gear < 0 && (c.throttle > 0.1 || u > 0.5)) this.gear = 1;
    if (this.gear < 0) {
      drive = c.brake;
      brake = c.throttle;
    }
    this.throttle += (drive - this.throttle) * Math.min(1, dt * 12);
    const ratio = this.gear < 0 ? -m.reverse : m.gears[this.gear - 1];
    const drivenR = m.wheelR;
    const wheelRpm = (Math.abs(u) / drivenR) * 60 / (2 * Math.PI);
    // below ~1.5× idle the clutch slips: rpm floats up with the throttle
    const coupled = Math.abs(ratio) * m.final * wheelRpm;
    const slipRpm = m.idle + this.throttle * (m.torqueRpm * 0.55);
    let rpm = Math.max(coupled, this.gear === 1 || this.gear === -1 ? Math.max(m.idle, slipRpm * (1 - Math.min(1, coupled / (m.idle * 1.6)))) : m.idle);
    if (this.shiftT > 0) rpm = Math.max(m.idle, rpm * 0.97);
    this.rpm += (Math.min(rpm, m.redline * 1.02) - this.rpm) * Math.min(1, dt * 18);
    // automatic: up near the redline, down when it lugs; not mid-slide, not in the air
    if (this.shiftT > 0) this.shiftT -= dt;
    else if (this.gear > 0 && this.airborne <= 0) {
      const up = m.redline * (0.86 + 0.08 * this.throttle);
      const down = m.idle + (m.torqueRpm - m.idle) * (0.35 + 0.35 * this.throttle);
      if (this.rpm > up && this.gear < m.gears.length) {
        this.gear++;
        this.shiftT = 0.18 + 0.08 * (m.mass > 5000 ? 3 : 1);
      } else if (this.gear > 1 && this.rpm < down * 0.9 && coupled * m.gears[this.gear - 2] / m.gears[this.gear - 1] < up * 0.85) {
        this.gear--;
        this.shiftT = 0.12;
      }
    }
    // torque: a curve rising to the peak, holding, and falling to the redline (rev limiter above it)
    const x = this.rpm / m.torqueRpm;
    const curve = x < 1 ? 0.55 + 0.45 * Math.sin((Math.min(1, x) * Math.PI) / 2) : Math.max(0, 1 - 0.55 * Math.pow((this.rpm - m.torqueRpm) / Math.max(1, m.redline - m.torqueRpm), 1.6));
    const limiter = this.rpm > m.redline ? 0 : 1;
    const engineT = m.torque * curve * this.throttle * limiter * (1 - 0.6 * this.engineDamage) * (this.shiftT > 0 ? 0.1 : 1);
    const driveF = (engineT * ratio * m.final * 0.88) / drivenR; // at the contact patches, total
    this.load = this.throttle * curve;
    const nDriven = this.wheels.filter((q) => q.driven).length || 1;

    /* ── suspension ── */
    const nW = this.wheels.length;
    const kSpring = (mass * G) / nW / m.sag;
    const cDamp = 2 * m.damping * Math.sqrt(kSpring * (mass / nW));
    let fz = 0, tPitch = 0, tRoll = 0;
    let contacts = 0;
    for (const wh of this.wheels) {
      // where the wheel is (world) and the ground under it
      const px = this.x + wh.lx * cy + wh.lz * sy, pz = this.z - wh.lx * sy + wh.lz * cy;
      wh.ground = world.ground(px, pz);
      // the body point above this wheel, and how compressed the spring is
      const bodyY = this.y + this.heave + wh.lz * this.pitch - wh.lx * this.roll;
      const comp = Math.min(m.travel * 1.6, m.sag + (wh.ground - bodyY));
      const before = wh.comp;
      wh.comp = comp;
      wh.compV = (comp - before) / dt;
      if (comp <= 0) {
        wh.contact = false;
        wh.load = 0;
        wh.comp = 0;
        continue;
      }
      wh.contact = true;
      contacts++;
      // past the bump stop it's stiff
      const bump = comp > m.travel ? (comp - m.travel) * kSpring * 12 : 0;
      let f = kSpring * comp + cDamp * wh.compV + bump;
      // anti-roll bar: resists one side compressing more than the other on the same axle
      f += m.antiRoll * kSpring * 0.6 * (comp - this.axleMate(wh).comp) * (m.bike ? 0 : 1);
      f = Math.max(0, f);
      wh.load = f;
      fz += f;
      tPitch += f * wh.lz;
      tRoll -= f * wh.lx;
    }
    this.airborne = contacts === 0 ? this.airborne + dt : 0;

    /* ── tyres ── */
    let fxL = 0, fzL = 0, tYaw = 0;
    const wetK = 1 - 0.28 * world.wet;
    // standing water: past ~22 m/s on a wet road the tyres start to float
    const plane = world.wet > 0.5 ? Math.max(0, Math.min(1, (speed - 22) / 12)) * (world.wet - 0.5) * 2 : 0;
    for (const wh of this.wheels) {
      if (!wh.contact) {
        // a wheel in the air spins down (or up, on the throttle)
        wh.omega += ((wh.driven ? driveF / nDriven * 0.02 : 0) - wh.omega * 0.5) * dt;
        wh.slip = 0;
        continue;
      }
      const px = this.x + wh.lx * cy + wh.lz * sy, pz = this.z - wh.lx * sy + wh.lz * cy;
      const surf = world.surface(px, pz);
      const mu = m.grip * surf.grip * (1 - (1 - m.offroad) * surf.rough * 0.6) * wetK * (1 - 0.7 * plane);
      // this wheel's velocity (car frame), then in the wheel's own frame
      const ui = u - this.r * wh.lx, wi = w + this.r * wh.lz;
      const cs = Math.cos(wh.steer), sn = Math.sin(wh.steer);
      const uw = ui * cs + wi * sn, ww = -ui * sn + wi * cs;
      // lateral: slip angle through a tyre curve (peak near 7°, falling a little past it)
      const alpha = Math.atan2(ww, Math.max(Math.abs(uw), 1.5));
      let fy = -wh.load * mu * Math.sin(1.9 * Math.atan(9 * alpha - 0.97 * (9 * alpha - Math.atan(9 * alpha))));
      // longitudinal: drive and brakes, wanted
      let fx = wh.driven ? driveF / nDriven : 0;
      const brakeF = brake * m.brake * mass * G / this.wheels.length * (wh.front ? 1.25 : 0.75);
      fx -= Math.sign(uw) * Math.min(brakeF, Math.abs(uw) * mass * 4 / this.wheels.length);
      let locked = false;
      if (c.handbrake && !wh.front) {
        // rears locked: they slide, and slide sideways too
        fx = -Math.sign(uw) * wh.load * mu * 0.8 * Math.min(1, Math.abs(uw) * 2);
        fy *= 0.35;
        locked = true;
      }
      // one friction budget for both (the circle); what's asked beyond it is sliding
      const lim = wh.load * mu * 1.02;
      const want = Math.hypot(fx, fy);
      let slide = 0;
      if (want > lim) {
        slide = Math.min(1, (want - lim) / Math.max(1, lim));
        const k = lim / want;
        fx *= k;
        fy *= k;
      }
      // at a crawl, sideways slip dies away (no creeping)
      if (Math.abs(uw) < 1.5) fy += -ww * Math.min(1, wh.load / (mass * G)) * mass * 3 / this.wheels.length * (1 - Math.abs(uw) / 1.5);
      wh.slip = Math.max(slide, Math.min(1, Math.abs(alpha) / 0.3 - 0.35), locked && Math.abs(uw) > 1 ? 1 : 0);
      // wheel spin: rolling, plus wheelspin under power, zero when locked
      const roll = uw / m.wheelR;
      wh.omega = locked ? 0 : roll + (wh.driven && slide > 0 && fx * uw >= 0 ? Math.sign(driveF) * slide * 25 : 0);
      // back to the car frame
      const flx = fx * sn + fy * cs, flz = fx * cs - fy * sn;
      fxL += flx;
      fzL += flz;
      tYaw += wh.lz * flx - wh.lx * flz;
    }

    // air and rolling resistance
    const drag = 0.5 * 1.2 * m.cda * speed;
    fzL -= drag * u + 0.012 * mass * G * Math.sign(u) * Math.min(1, Math.abs(u));
    fxL -= drag * w;

    /* ── integrate ── */
    const aLong = fzL / mass, aLat = fxL / mass;
    // world acceleration from the car frame (forward = (sin, cos), right = (cos, −sin))
    this.vx += (aLong * sy + aLat * cy) * dt;
    this.vz += (aLong * cy - aLat * sy) * dt;
    const Iz = (mass * (m.wheelbase * m.wheelbase + m.track * m.track)) / 10;
    this.r += (tYaw / Iz) * dt;
    if (contacts === 0) this.r *= 1 - dt * 0.2;
    // yaw from the car's own rotation (at low speed with no tyre grip it doesn't spin forever)
    this.yaw += this.r * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    u = this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw);
    w = this.vx * Math.cos(this.yaw) - this.vz * Math.sin(this.yaw);
    this.ax += (aLong - this.ax) * Math.min(1, dt * 8);
    this.ay += (aLat - this.ay) * Math.min(1, dt * 8);

    // body: heave, pitch and roll on the springs, plus the load moved by accelerating and turning
    const H = m.cogH;
    const Ip = (mass * (m.wheelbase * m.wheelbase + H * H)) / 10, Ir = (mass * (m.track * m.track + H * H)) / 8;
    this.heaveV += ((fz - mass * G) / mass) * dt;
    this.pitchV += ((tPitch + mass * aLong * H) / Ip) * dt;
    this.rollV += ((tRoll - mass * aLat * H * (m.bike ? 0 : 1)) / Ir) * dt;
    if (contacts === 0) this.vy -= G * dt;
    this.heave += this.heaveV * dt;
    this.pitch += this.pitchV * dt;
    this.roll += this.rollV * dt;
    // keep the body where the ground is (y follows the ground under the centre; heave is the springs' play)
    const g0 = world.ground(this.x, this.z);
    if (contacts > 0) {
      if (this.vy < -4) this.thump = Math.min(1, -this.vy / 12);
      this.vy = 0;
      this.y += (g0 - this.y) * Math.min(1, dt * 30);
    } else {
      this.y += this.vy * dt;
      if (this.y < g0 - 0.1) this.y = g0 - 0.1;
    }
    this.pitch = Math.max(-0.25, Math.min(0.25, this.pitch));
    this.roll = Math.max(-0.3, Math.min(0.3, this.roll));
    this.heave = Math.max(-m.travel, Math.min(m.travel * 2, this.heave));
    // a bike leans into the turn instead
    if (m.bike) {
      const want = Math.atan2(u * this.r, G);
      this.lean += (Math.max(-0.8, Math.min(0.8, want)) - this.lean) * Math.min(1, dt * 6);
      this.roll = 0;
    }
  }

  private axleMate(wh: Wheel): Wheel {
    for (const o of this.wheels) if (o !== wh && o.lz === wh.lz) return o;
    return wh;
  }

  /** A collision: push the body out, take the speed into the obstacle, spin it by where it hit. */
  hit(nx: number, nz: number, px: number, pz: number): number {
    const into = -(this.vx * nx + this.vz * nz);
    if (into <= 0) return 0;
    const e = 0.18; // a little bounce, mostly crumple
    this.vx += nx * into * (1 + e);
    this.vz += nz * into * (1 + e);
    // off-centre hits turn the car (car-frame lever arm × the impulse)
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const lx = (px - this.x) * cy - (pz - this.z) * sy, lz = (px - this.x) * sy + (pz - this.z) * cy;
    const jx = (nx * cy - nz * sy) * into, jz = (nx * sy + nz * cy) * into;
    this.r += (lz * jx - lx * jz) * 0.35 / Math.max(1, this.m.wheelbase);
    this.rollV += (-jx) * 0.02;
    this.pitchV += (-jz) * 0.015;
    return into;
  }
}
