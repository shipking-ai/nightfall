import * as THREE from 'three';
import { SPECS } from '../vehicles/specs';
import { buildVehicle, setLights, type VehicleModel } from '../vehicles/model';
import type { VehicleSpec } from '../vehicles/specs';
import { Dynamics } from '../vehicles/dynamics';
import type { Collision } from '../world/Collision';
import type { Materials } from '../world/materials';

/**
 * The police, when they mean it.
 *
 * Two stars: patrol cars come down the nearest street with their light bars
 * going, pull up short of you and let officers out.
 * Three stars: a helicopter comes over the rooftops, circles, and holds you in
 * its searchlight. Four and up: someone in it has a rifle.
 *
 * The searchlights are real SpotLights that are always in the scene (dark when
 * unused), so the shader light count never changes. There are two of them from
 * the start, for the same reason: a second helicopter must not change the count
 * either.
 */
export interface PoliceHooks {
  /** officers out of a car at `at` */
  deploy(at: THREE.Vector3): void;
  /** the helicopter fires at you */
  shoot(from: THREE.Vector3, hit: boolean): void;
  /** it came down */
  downed(at: THREE.Vector3): void;
  /** whether the player is currently driving (so cruisers should pursue, not park) */
  playerDriving: boolean;
  /** a line the player should hear (the military announcing themselves) */
  say(line: string): void;
  /** a cruiser was destroyed and is burning where it stopped */
  wrecked(at: THREE.Vector3, mil: boolean): void;
}

/* ─────────────────────────── helicopter ─────────────────────────── */

class Heli {
  group = new THREE.Group();
  rotor = new THREE.Group();
  tailRotor = new THREE.Group();
  light: THREE.SpotLight;
  beam: THREE.Mesh;
  beamMat: THREE.MeshBasicMaterial;
  strobes: THREE.MeshBasicMaterial[] = [];
  pos = new THREE.Vector3(0, 80, -600);
  vel = new THREE.Vector3();
  heading = 0;
  orbit = Math.random() * Math.PI * 2;
  present = false;
  /** military variant: darker, shorter-ranged orbit, and it does not hold you */
  mil: boolean;
  hp = 260;
  falling = -1;
  fireT = 3;
  /** seconds this one must sit out before it can be sent again */
  cool = 0;
  private aim = new THREE.Vector3();

  constructor(mats: Materials, mil = false) {
    this.mil = mil;
    const navy = new THREE.MeshStandardMaterial({ color: mil ? 0x2b3324 : 0x1b2334, roughness: 0.45, metalness: 0.4 });
    const white = new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.5, metalness: 0.3 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12).scale(1.15, 1.05, 2.3), navy);
    const stripe = new THREE.Mesh(new THREE.SphereGeometry(1.01, 16, 4, 0, Math.PI * 2, Math.PI * 0.46, Math.PI * 0.08).scale(1.15, 1.05, 2.3), white);
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.98, 14, 10, -Math.PI * 0.4, Math.PI * 0.8, 0.2, Math.PI * 0.45).scale(1.12, 1.0, 2.25), mats.darkGlass);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.34, 4.6, 10).rotateX(Math.PI / 2).translate(0, 0.25, -3.9), navy);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.7).translate(0, 0.8, -6.0), navy);
    const skidGeo = new THREE.CylinderGeometry(0.05, 0.05, 3.4, 6).rotateX(Math.PI / 2);
    const skids = [-0.85, 0.85].map((x) => new THREE.Mesh(skidGeo, mats.metal).translateX(x).translateY(-1.3));
    const blade = new THREE.BoxGeometry(0.28, 0.04, 10.5);
    this.rotor.add(new THREE.Mesh(blade, mats.rubber), new THREE.Mesh(blade.clone().rotateY(Math.PI / 2), mats.rubber));
    this.rotor.position.y = 1.25;
    this.tailRotor.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.5, 0.14), mats.rubber));
    this.tailRotor.position.set(0.18, 0.8, -6.0);
    for (const [x, c] of [[-0.6, 0xff2a1a], [0.6, 0x2a5cff]] as const) {
      const m = new THREE.MeshBasicMaterial({ color: c });
      this.strobes.push(m);
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), m);
      s.position.set(x, -1.0, 1.3);
      this.group.add(s);
    }
    this.group.add(body, stripe, glass, boom, fin, ...skids, this.rotor, this.tailRotor);
    body.castShadow = true;
    this.light = new THREE.SpotLight(0xe6eeff, 0, 110, 0.2, 0.45, 1);
    this.light.castShadow = false;
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xcfdcff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    // a unit cone from its tip (origin) down -y; stretched to the ground every frame
    this.beam = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 20, 1, true).translate(0, -0.5, 0), this.beamMat);
    this.beam.frustumCulled = false;
    this.group.visible = false;
  }

  /** Circle the target, hold the light on it, and leave when not wanted. */
  update(dt: number, t: number, target: THREE.Vector3 | null, want: boolean) {
    if (this.falling >= 0) return this.fall(dt);
    const home = new THREE.Vector3();
    if (want && target) {
      if (!this.present) {
        // arrive over the rooftops from somewhere out of the way
        const a = Math.random() * Math.PI * 2;
        this.pos.set(target.x + Math.sin(a) * 260, 70, target.z + Math.cos(a) * 260);
        this.present = true;
        this.hp = 260;
        this.group.visible = true;
      }
      this.orbit += dt * (this.mil ? -0.24 : 0.16);
      // further out and higher: it was close enough and low enough to be a
      // gun you couldn't look away from. The military one orbits tighter and
      // opposite, so two of them cross the street instead of stacking.
      const r = this.mil ? 30 : 42;
      const h = this.mil ? 34 : 52;
      const spd = this.mil ? -0.24 : 0.16;
      home.set(target.x + Math.sin(this.orbit) * r, target.y + h, target.z + Math.cos(this.orbit) * r);
    } else if (this.present) {
      home.set(this.pos.x + Math.sin(this.heading) * 400, 90, this.pos.z + Math.cos(this.heading) * 400);
      if (!target || this.pos.distanceTo(target) > 320) {
        this.present = false;
        this.group.visible = false;
      }
    } else return;
    // fly towards home with a little lag and lean into it
    const d = home.sub(this.pos);
    const want3 = d.clampLength(0, 26);
    this.vel.lerp(want3, Math.min(1, dt * 0.8));
    this.pos.addScaledVector(this.vel, dt);
    const flat = Math.hypot(this.vel.x, this.vel.z);
    if (flat > 0.5) this.heading += wrap(Math.atan2(this.vel.x, this.vel.z) - this.heading) * Math.min(1, dt * 1.2);
    this.group.position.copy(this.pos);
    this.group.rotation.set(Math.min(0.3, flat * 0.012), this.heading, Math.sin(t * 0.7) * 0.03, 'YXZ');
    this.rotor.rotation.y += dt * 38;
    this.tailRotor.rotation.x += dt * 50;
    const on = Math.floor(t * 3) % 2;
    this.strobes[0].color.setHex(on ? 0xff2a1a : 0x220000);
    this.strobes[1].color.setHex(on ? 0x001022 : 0x2a5cff);
    // the searchlight lags behind you, and sweeps rather than sticking
    if (target && want) {
      this.aim.lerp(target, Math.min(1, dt * 1.1));
      this.light.intensity = 90;
      this.beamMat.opacity = 0.05;
    } else {
      this.light.intensity = 0;
      this.beamMat.opacity = 0;
    }
    this.light.position.copy(this.pos).y -= 1.2;
    this.light.target.position.copy(this.aim);
    this.light.target.updateMatrixWorld();
    const len = this.light.position.distanceTo(this.aim);
    const r = Math.tan(this.light.angle) * len;
    this.beam.position.copy(this.light.position);
    this.beam.scale.set(r, len, r);
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), this.aim.clone().sub(this.light.position).normalize());
  }

  private fall(dt: number) {
    this.falling += dt;
    this.vel.y -= 14 * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.heading += dt * 5;
    this.group.position.copy(this.pos);
    this.group.rotation.set(0.4, this.heading, 0.3, 'YXZ');
    this.rotor.rotation.y += dt * 12;
    this.light.intensity = 0;
    this.beamMat.opacity = 0;
    if (this.pos.y < 0.5 || this.falling > 8) {
      this.group.visible = false;
      this.present = false;
      this.falling = -2; // it takes them a while to send another
      return true;
    }
    return false;
  }
}

/* ─────────────────────────── patrol cars ─────────────────────────── */

interface Cruiser {
  group: THREE.Group;
  bar: THREE.MeshBasicMaterial[];
  /** the patrol car itself (vehicles/model.ts) */
  model: VehicleModel;
  pos: THREE.Vector3;
  yaw: number;
  v: number;
  state: 'off' | 'coming' | 'parked' | 'leaving' | 'chasing' | 'wreck';
  stopAt: THREE.Vector3;
  t: number;
  /** the dynamics, when this cruiser is actually driving (a chase) */
  dyn: Dynamics | null;
  /** military, not police: heavier, faster, armed, and does not give up */
  mil: boolean;
  /** health, and how long it burns for after that runs out */
  hp: number;
  burn: number;
  /** seconds until this one fires its weapon */
  turretCd: number;
  /** seconds left of the approach warning */
  beacon: number;
}

/** The streets a cruiser can come down (avenue, and the three cross streets that run on forever). */
function roadFor(p: THREE.Vector3): { axis: 'x' | 'z'; at: number } {
  if (Math.abs(p.x) < 60 && p.z > -120 && p.z < 140) return { axis: 'z', at: p.x > 0 ? 4.2 : -4.2 };
  const lines = [-40, 54, 141];
  const z = lines.reduce((a, b) => (Math.abs(b - p.z) < Math.abs(a - p.z) ? b : a));
  return { axis: 'x', at: z + (p.z > z ? 3.2 : -3.2) };
}

/** the military's paint, and their hardware. Light enough to tell from the
 * police at a glance, which matters more than looking military: olive-dark on a
 * black car in the rain is just another patrol car. */
const MIL_PAINT = 0x6d7355;
const MIL_MAT = new THREE.MeshStandardMaterial({ color: 0x2b3122, roughness: 0.6, metalness: 0.55 });
/** armour is armour: it takes roughly what the helicopter takes, and a patrol car
 * takes a little less */
const CRUISER_HP = 240;
const CRUISER_HP_MIL = 300;

export class Police {
  group = new THREE.Group();
  /** the police helicopter, and (past seven stars) a military one alongside it */
  heli: Heli;
  milHeli: Heli;
  cars: Cruiser[] = [];

  constructor(mats: Materials, private hooks: PoliceHooks) {
    this.heli = new Heli(mats, false);
    this.milHeli = new Heli(mats, true);
    this.group.add(this.heli.group, this.heli.light, this.heli.light.target, this.heli.beam);
    this.group.add(this.milHeli.group, this.milHeli.light, this.milHeli.light.target, this.milHeli.beam);
    const paint = new THREE.MeshStandardMaterial({ color: 0x151a24, roughness: 0.35, metalness: 0.5 });
    const door = new THREE.MeshStandardMaterial({ color: 0xd7d9dc, roughness: 0.4, metalness: 0.3 });
    for (let i = 0; i < 2; i++) this.addCruiser(SPECS.police, SPECS.police.paints[0], false);
    // The military do not turn up in a recoloured patrol car: they bring their
    // own hull, their own drivetrain and their own hitbox, because the whole
    // point of them arriving is that the thing in the mirror is not a cruiser.
    for (let i = 0; i < 2; i++) this.addCruiser(SPECS.armoured, MIL_PAINT, true);
  }

  private addCruiser(spec: VehicleSpec, paint: number, mil: boolean) {
    const g = new THREE.Group();
    const model = buildVehicle(spec, paint);
    g.add(model.root);
    if (mil) {
      // The tells, front to back: a gun mount on the roof, a pale band round
      // the body, and a marker light. Without all three you cannot tell one
      // from a cruiser at night, and a pursuit you can't read isn't a pursuit.
      const turret = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.56, 0.18, 12), MIL_MAT);
      ring.position.y = 1.62;
      turret.add(ring);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.5, 7), MIL_MAT);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 1.76, 0.62);
      turret.add(barrel);
      g.add(turret);
      const band = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.16, 0.06), MIL_MAT);
      band.position.set(0, 0.62, 2.46);
      g.add(band);
      const band2 = band.clone();
      band2.position.z = -2.46;
      g.add(band2);
      const mark = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffb020 }));
      mark.position.set(0, 1.78, -0.3);
      g.add(mark);
    }
    const bar: THREE.MeshBasicMaterial[] = [];
    g.visible = false;
    this.group.add(g);
    this.cars.push({ group: g, bar, model, pos: new THREE.Vector3(), yaw: 0, v: 0, state: 'off', stopAt: new THREE.Vector3(), t: 0, dyn: null, mil, hp: mil ? CRUISER_HP_MIL : CRUISER_HP, burn: 0, turretCd: 0, beacon: 0 });
  }

  /** Solid circles for the player (cars that are out). */
  obstacles(out: { x: number; z: number; r: number }[]) {
    for (const c of this.cars) {
      if (c.state === 'off') continue;
      for (const k of [-1.5, 0, 1.5]) out.push({ x: c.pos.x + Math.sin(c.yaw) * k, z: c.pos.z + Math.cos(c.yaw) * k, r: 0.95 });
    }
  }

  /**
   * Wrecks burn down and then are cold metal, and then they're gone. Until the
   * fire is out they're a hazard: standing next to one hurts.
   */
  private tickWrecks(dt: number) {
    for (const c of this.cars) {
      if (c.state !== 'wreck') continue;
      c.burn -= dt;
      c.model.body.position.y = -0.06;
      c.model.body.rotation.z = 0.05;
      if (c.burn <= 0) {
        c.state = 'off';
        c.group.visible = false;
        c.hp = c.mil ? CRUISER_HP_MIL : CRUISER_HP;
        c.burn = 0;
        c.model.body.position.y = 0;
        c.model.body.rotation.z = 0;
      }
    }
  }

  /** How close is the player to a burning wreck? (0 = none) */
  wreckHeat(at: THREE.Vector3, r = 6): number {
    let hottest = 0;
    for (const c of this.cars) {
      if (c.state !== 'wreck' || c.burn <= 0) continue;
      const d = Math.hypot(c.pos.x - at.x, c.pos.z - at.z);
      hottest = Math.max(hottest, Math.max(0, 1 - d / r));
    }
    return hottest;
  }

  /** Every wreck still burning, for effects. */
  burningWrecks() {
    const out: { x: number; y: number; z: number; left: number }[] = [];
    for (const c of this.cars) if (c.state === 'wreck' && c.burn > 0) out.push({ x: c.pos.x, y: c.pos.y, z: c.pos.z, left: c.burn });
    return out;
  }

  /** Did a shot along this ray hit a helicopter first? Returns which one. */
  heliHit(o: THREE.Vector3, dir: THREE.Vector3, max: number): { t: number; heli: Heli } | null {
    let best: { t: number; heli: Heli } | null = null;
    for (const h of [this.heli, this.milHeli]) {
      if (!h.present || h.falling >= 0) continue;
      const c = h.pos.clone().sub(o);
      const tc = c.dot(dir);
      if (tc < 0 || tc > max + 3) continue;
      const d2 = c.lengthSq() - tc * tc;
      if (d2 < 2.4 * 2.4) {
        const t = tc - Math.sqrt(2.4 * 2.4 - d2);
        if (!best || t < best.t) best = { t, heli: h };
      }
    }
    return best;
  }

  /**
   * The nearest live cruiser along this ray. Boxes rather than spheres, because
   * a patrol car is 4.9 m long and treating it as a ball means you have to hit
   * it dead-centre to hurt it, which feels like the game is cheating.
   */
  cruiserHit(o: THREE.Vector3, dir: THREE.Vector3, max: number): { t: number; car: Cruiser } | null {
    let best: { t: number; car: Cruiser } | null = null;
    for (const c of this.cars) {
      if (c.state === 'off' || c.burn > 0) continue;
      // into the car's own frame, where it is a box
      const rx = o.x - c.pos.x, rz = o.z - c.pos.z;
      const s = Math.sin(-c.yaw), co = Math.cos(-c.yaw);
      const lx = rx * co - rz * s;
      const lz = rx * s + rz * co;
      const dy = o.y - (c.pos.y + 0.85);
      const dx = dir.x * co - dir.z * s;
      const dz = dir.x * s + dir.z * co;
      // slab test, half-extents taken from the class itself so an armoured car
      // is the bigger box it actually is
      const sh = c.mil ? SPECS.armoured.shape : SPECS.police.shape;
      const hx = sh.width / 2 + 0.11, hy = sh.height / 2 + 0.15, hz = sh.length / 2 + 0.15;
      let t0 = 0, t1 = max;
      let ok = true;
      for (const [p, d, h2] of [[lx, dx, hx], [dy, dir.y, hy], [lz, dz, hz]] as const) {
        if (Math.abs(d) < 1e-6) {
          if (p < -h2 || p > h2) { ok = false; break; }
          continue;
        }
        const inv = 1 / d;
        let a = (-h2 - p) * inv, b = (h2 - p) * inv;
        if (a > b) { const t = a; a = b; b = t; }
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        if (t0 > t1) { ok = false; break; }
      }
      if (ok && t0 >= 0 && (!best || t0 < best.t)) best = { t: t0, car: c };
    }
    return best;
  }

  /** Damage a cruiser. Killing it stops it driving and leaves a burning wreck. */
  damageCruiser(c: Cruiser, dmg: number) {
    if (c.state === 'off' || c.burn > 0) return;
    c.hp -= dmg;
    if (c.hp > 0) return;
    // out of the fight: it stops where it is, and stays there as cover or hazard
    c.burn = 9;
    c.state = 'wreck';
    c.dyn = null;
    c.v = 0;
    this.hooks.wrecked(c.pos.clone(), c.mil);
  }

  /** Damage a specific helicopter. Killing it sends it down and starts its cooldown. */
  damageHeli(h: Heli, dmg: number) {
    if (!h.present || h.falling >= 0) return;
    h.hp -= dmg;
    if (h.hp <= 0 && h.falling < 0) {
      h.falling = 0;
      h.vel.set(h.vel.x * 0.5, 2, h.vel.z * 0.5);
    }
  }

  get active() {
    return this.heli.present || this.milHeli.present || this.cars.some((c) => c.state !== 'off');
  }

  update(dt: number, t: number, player: THREE.Vector3 | null, stars: number, indoors: boolean, camFwd: THREE.Vector3, playerSpeed = 0, col: Collision | null = null) {
    // The helicopters. The police one comes at four stars and opens fire at five;
    // past seven the military sends its own alongside it.
    const heliWanted = !!player && !indoors && stars >= 4;
    const milHeliWanted = !!player && !indoors && stars >= 7;
    for (const h of [this.heli, this.milHeli]) {
      h.cool -= dt;
      const wasFalling = h.falling >= 0;
      h.update(dt, t, player, heliWanted && h.cool <= 0);
      if (wasFalling && h.falling === -2) {
        this.hooks.downed(h.pos.clone().setY(0.2));
        h.falling = -1;
        // down high up, they send another one sooner
        h.cool = stars >= 7 ? 28 : 60;
      }
    }
    // Only at the top of the scale, and much less often, and much less often to
    // actually land: at three stars it followed you, lit you up and opened fire
    // every two seconds, which was unsurvivable and left no room to escape it.
    const wantHeliFire = !!player && stars >= 5;
    for (const h of [this.heli, this.milHeli]) {
      if (!h.present || h.falling >= 0 || !wantHeliFire) continue;
      h.fireT -= dt;
      if (h.fireT > 0) continue;
      // The rotor is police at five stars and military at seven: quicker, and
      // far more willing to actually connect.
      const mil = h.mil || stars >= 7;
      h.fireT = mil ? 2.6 + Math.random() * 1.8 : 4.5 + Math.random() * 3.5;
      this.hooks.shoot(h.pos.clone().setY(h.pos.y - 2.6), Math.random() < (mil ? 0.3 : 0.16));
    }
    // Patrol cars. On foot they come down the street and stop, which is right.
    // Get in a car and they follow you: on foot they arrest you, in a car you can
    // outrun them, so they get real dynamics and a real pursuit.
    const chasing = !!player && !indoors && playerSpeed > 6;
    // Past five stars the police are no longer the whole answer: the military
    // come as their own vehicles, and they do not sit on the pavement.
    const mil = stars >= 6;
    const want = player && !indoors ? (chasing ? (stars >= 3 ? 2 : 1) : stars >= 4 ? 2 : stars >= 2 ? 1 : 0) : 0;
    // the military only ever move when you're in the world and being looked for
    const wantMil = player && !indoors && mil ? (chasing ? 2 : 1) : 0;
    if (this.hooks.playerDriving !== chasing) {
      this.hooks.playerDriving = chasing;
      // stand down out of a chase, or back off the road for it
      if (chasing) for (const c of this.cars) if (c.state === 'parked' || c.state === 'coming') this.beginChase(c);
    }
    const busy = (c: Cruiser) => c.state === 'coming' || c.state === 'parked' || c.state === 'chasing';
    this.tickWrecks(dt);
    let out = this.cars.filter((c) => !c.mil && busy(c)).length;
    let outMil = this.cars.filter((c) => c.mil && busy(c)).length;
    for (const c of this.cars) {
      if (c.state === 'wreck') continue;
      setLights(c.model, { head: 1, brake: c.v < 1 && c.state !== 'off', reverse: false, indicator: 0, hazard: false, beacons: true, running: true }, t + (c === this.cars[0] ? 0 : 0.13), { head: false, tail: false });
      for (const w of c.model.wheels) w.spin.rotation.x += (c.v * dt) / w.r;
      if (c.state === 'off') {
        // each tier has its own allowance, so the police don't take the slots
        // the military are meant to be filling
        const cap = c.mil ? wantMil : want;
        const used = c.mil ? outMil : out;
        if (player && used < cap) {
          this.dispatch(c, player, camFwd);
          if (chasing || c.mil) this.beginChase(c);
          if (c.mil) outMil++;
          else out++;
        }
        continue;
      }
      if (c.state === 'chasing') {
        if (player) this.chaseStep(c, dt, player, col);
        else {
          c.state = 'leaving';
          c.t = 0;
        }
      }
      if ((c.mil ? wantMil : want) === 0 && (c.state === 'coming' || c.state === 'parked')) {
        c.state = 'leaving';
        c.t = 0;
      }
      if (c.state === 'coming') {
        const d = Math.hypot(c.stopAt.x - c.pos.x, c.stopAt.z - c.pos.z);
        const target = d > 20 ? 17 : Math.max(0, d * 0.9);
        c.v += (target - c.v) * Math.min(1, dt * 2);
        if (d < 0.6 || c.v < 0.2) {
          c.state = 'parked';
          c.v = 0;
          const side = new THREE.Vector3(Math.cos(c.yaw), 0, -Math.sin(c.yaw));
          this.hooks.deploy(c.pos.clone().addScaledVector(side, 1.6).setY(0.15));
          this.hooks.deploy(c.pos.clone().addScaledVector(side, -1.6).setY(0.15));
        }
      } else if (c.state === 'leaving') {
        c.t += dt;
        if (c.t > 4) c.v += (14 - c.v) * Math.min(1, dt);
        if (player && c.pos.distanceTo(player) > 90) {
          c.state = 'off';
          c.group.visible = false;
          c.dyn = null;
        }
      }
      // A chasing car has already been moved by its own dynamics.
      if (c.state !== 'chasing') {
        c.pos.x += Math.sin(c.yaw) * c.v * dt;
        c.pos.z += Math.cos(c.yaw) * c.v * dt;
        c.group.position.copy(c.pos);
        c.group.rotation.y = c.yaw;
      } else {
        c.group.position.set(c.dyn!.x, c.dyn!.y, c.dyn!.z);
        c.group.rotation.set(c.dyn!.pitch, c.dyn!.yaw, c.dyn!.roll, 'YXZ');
        // the body rides the springs, so lean it with them
        c.model.body.position.y = c.dyn!.heave;
        c.model.body.rotation.x = c.dyn!.pitch;
        c.model.body.rotation.z = c.dyn!.roll;
        for (const w of c.model.wheels) w.steer.rotation.y = w.front ? c.dyn!.steerOut : 0;
      }
    }
  }

  /**
   * Put a cruiser into pursuit: give it real dynamics so it drives the way the
   * car you stole does, rather than sliding down a straight line.
   */
  private beginChase(c: Cruiser) {
    const spec = c.mil ? SPECS.armoured : SPECS.police;
    // the military run their own spec: 4.2 tonnes, a low-range diesel and far
    // more grip than a patrol car, so they close a gap a cruiser cannot
    if (!c.dyn) c.dyn = new Dynamics(spec.mech);
    // wherever it is now, and whatever way it was going
    c.dyn.place(c.pos.x, c.pos.y, c.pos.z, c.yaw);
    c.state = 'chasing';
  }

  /**
   * One frame of pursuit: steer toward you, throttle for the gap, and ease off
   * as it closes so it doesn't drive through the back of your car.
   */
  private chaseStep(c: Cruiser, dt: number, player: THREE.Vector3, col: Collision | null) {
    const d = c.dyn!;
    const dx = player.x - c.pos.x, dz = player.z - c.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    // Military vehicles are faster and heavier than patrol cars, and they do not
    // ease off the way a cruiser does.
    if (c.mil) {
      c.turretCd -= dt;
      c.beacon -= dt;
      if (dist < 46 && c.turretCd <= 0) {
        c.turretCd = 1.1 + Math.random() * 0.9;
        this.hooks.shoot(c.pos.clone().setY(c.pos.y + 1.5), Math.random() < 0.34);
      }
      if (dist > 90 && c.beacon <= 0) {
        this.hooks.say('Military, closing from the ring road.');
        c.beacon = 0.35;
      }
    }
    // aim: straight at you, but damped so it doesn't flick about at speed
    const want = Math.atan2(dx, dz);
    let err = want - c.yaw;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    const steer = Math.max(-1, Math.min(1, -err * 1.5));
    // keep a following distance: it wants to be on your bumper, not in you
    // The military hold further back, because they shoot from there instead.
    const gap = c.mil ? 24 : 7;
    const near = dist < gap;
    const throttle = near ? 0 : Math.min(1, 0.45 + dist / (c.mil ? 40 : 26));
    const world = {
      ground: (x: number, z: number) => (col ? col.groundAt(x, z, c.pos.y + 0.8, 1, 0.9) : 0),
      surface: () => ({ grip: 1.15, rough: 0 }),
      wet: 0,
    };
    d.step(dt, { throttle, brake: near && dist < gap * 0.62 ? 0.4 : 0, steer, handbrake: false, boost: dist > (c.mil ? 46 : 30) }, world);
    c.pos.set(d.x, d.y, d.z);
    c.yaw = d.yaw;
    c.v = d.forward;
    // it shouldn't drive through walls
    if (col) col.resolve(c.pos, 1.1, 1.5, 0.4);
    d.x = c.pos.x;
    d.z = c.pos.z;
    // lost you: give up after a while so they don't follow forever
    if (dist > 150) {
      c.state = 'leaving';
      c.t = 0;
      c.dyn = null;
    }
  }

  /** Bring a cruiser down the nearest street, from the far side of where you're looking. */
  private dispatch(c: Cruiser, p: THREE.Vector3, camFwd: THREE.Vector3) {
    const road = roadFor(p);
    const along = road.axis === 'z' ? camFwd.z : camFwd.x;
    // come from behind the camera's view; a second car comes from the other way
    const second = this.cars.some((o) => o !== c && o.state !== 'off');
    const from = (along > 0 ? -1 : 1) * (second ? -1 : 1);
    const dist = 60;
    if (road.axis === 'z') {
      c.pos.set(road.at, 0.15, p.z + from * dist);
      c.stopAt.set(road.at, 0.15, p.z + from * 9);
      c.yaw = from > 0 ? Math.PI : 0;
    } else {
      c.pos.set(p.x + from * dist, 0.15, road.at);
      c.stopAt.set(p.x + from * 9, 0.15, road.at);
      c.yaw = from > 0 ? -Math.PI / 2 : Math.PI / 2;
    }
    c.v = 17;
    c.state = 'coming';
    c.group.visible = true;
    // a car that came back from a wreck is a whole car again
    c.hp = c.mil ? CRUISER_HP_MIL : CRUISER_HP;
    c.burn = 0;
    c.model.body.position.y = 0;
    c.model.body.rotation.z = 0;
  }
}

function wrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
