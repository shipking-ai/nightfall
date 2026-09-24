import * as THREE from 'three';
import type { Materials } from '../world/materials';

/**
 * The police, when they mean it.
 *
 * Two stars: patrol cars come down the nearest street with their light bars
 * going, pull up short of you and let officers out.
 * Three stars: a helicopter comes over the rooftops, circles, and holds you in
 * its searchlight. Four and up: someone in it has a rifle.
 *
 * The searchlight is a real SpotLight that is always in the scene (dark when
 * unused), so the shader light count never changes.
 */
export interface PoliceHooks {
  /** officers out of a car at `at` */
  deploy(at: THREE.Vector3): void;
  /** the helicopter fires at you */
  shoot(from: THREE.Vector3, hit: boolean): void;
  /** it came down */
  downed(at: THREE.Vector3): void;
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
  hp = 260;
  falling = -1;
  fireT = 3;
  private aim = new THREE.Vector3();

  constructor(mats: Materials) {
    const navy = new THREE.MeshStandardMaterial({ color: 0x1b2334, roughness: 0.45, metalness: 0.4 });
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
      this.orbit += dt * 0.22;
      home.set(target.x + Math.sin(this.orbit) * 24, target.y + 36, target.z + Math.cos(this.orbit) * 24);
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
    // the searchlight lags behind you a little
    if (target && want) {
      this.aim.lerp(target, Math.min(1, dt * 1.6));
      this.light.intensity = 140;
      this.beamMat.opacity = 0.07;
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
  pos: THREE.Vector3;
  yaw: number;
  v: number;
  state: 'off' | 'coming' | 'parked' | 'leaving';
  stopAt: THREE.Vector3;
  t: number;
}

/** The streets a cruiser can come down (avenue, and the three cross streets that run on forever). */
function roadFor(p: THREE.Vector3): { axis: 'x' | 'z'; at: number } {
  if (Math.abs(p.x) < 60 && p.z > -120 && p.z < 140) return { axis: 'z', at: p.x > 0 ? 4.2 : -4.2 };
  const lines = [-40, 54, 141];
  const z = lines.reduce((a, b) => (Math.abs(b - p.z) < Math.abs(a - p.z) ? b : a));
  return { axis: 'x', at: z + (p.z > z ? 3.2 : -3.2) };
}

export class Police {
  group = new THREE.Group();
  heli: Heli;
  cars: Cruiser[] = [];
  private heliCool = 0;

  constructor(mats: Materials, private hooks: PoliceHooks) {
    this.heli = new Heli(mats);
    this.group.add(this.heli.group, this.heli.light, this.heli.light.target, this.heli.beam);
    const paint = new THREE.MeshStandardMaterial({ color: 0x151a24, roughness: 0.35, metalness: 0.5 });
    const door = new THREE.MeshStandardMaterial({ color: 0xd7d9dc, roughness: 0.4, metalness: 0.3 });
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      const bodyM = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.62, 4.6).translate(0, 0.62, 0), paint);
      const doors = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.4, 1.9).translate(0, 0.66, -0.1), door);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2.3).translate(0, 1.18, -0.25), mats.darkGlass);
      const bar: THREE.MeshBasicMaterial[] = [];
      for (const [x, c] of [[-0.35, 0xff2a1a], [0.35, 0x2a5cff]] as const) {
        const m = new THREE.MeshBasicMaterial({ color: c });
        bar.push(m);
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.26).translate(x, 1.5, -0.25), m));
      }
      for (const sx of [-0.84, 0.84]) for (const sz of [-1.45, 1.45]) g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 12).rotateZ(Math.PI / 2).translate(sx, 0.34, sz), mats.rubber));
      g.add(bodyM, doors, cabin);
      bodyM.castShadow = true;
      g.visible = false;
      this.group.add(g);
      this.cars.push({ group: g, bar, pos: new THREE.Vector3(), yaw: 0, v: 0, state: 'off', stopAt: new THREE.Vector3(), t: 0 });
    }
  }

  /** Solid circles for the player (cars that are out). */
  obstacles(out: { x: number; z: number; r: number }[]) {
    for (const c of this.cars) {
      if (c.state === 'off') continue;
      for (const k of [-1.5, 0, 1.5]) out.push({ x: c.pos.x + Math.sin(c.yaw) * k, z: c.pos.z + Math.cos(c.yaw) * k, r: 0.95 });
    }
  }

  /** Did a shot along this ray hit the helicopter first? */
  heliHit(o: THREE.Vector3, dir: THREE.Vector3, max: number): number | null {
    const h = this.heli;
    if (!h.present || h.falling >= 0) return null;
    const c = h.pos.clone().sub(o);
    const tc = c.dot(dir);
    if (tc < 0 || tc > max + 3) return null;
    const d2 = c.lengthSq() - tc * tc;
    return d2 < 2.4 * 2.4 ? tc - Math.sqrt(2.4 * 2.4 - d2) : null;
  }

  damageHeli(dmg: number) {
    const h = this.heli;
    h.hp -= dmg;
    if (h.hp <= 0 && h.falling < 0) {
      h.falling = 0;
      h.vel.set(h.vel.x * 0.5, 2, h.vel.z * 0.5);
    }
  }

  get active() {
    return this.heli.present || this.cars.some((c) => c.state !== 'off');
  }

  update(dt: number, t: number, player: THREE.Vector3 | null, stars: number, indoors: boolean, camFwd: THREE.Vector3) {
    // the helicopter
    const wasFalling = this.heli.falling >= 0;
    this.heliCool -= dt;
    const heliWanted = !!player && stars >= 3 && !indoors && this.heliCool <= 0;
    this.heli.update(dt, t, player, heliWanted);
    if (wasFalling && this.heli.falling === -2) {
      this.hooks.downed(this.heli.pos.clone().setY(0.2));
      this.heli.falling = -1;
      this.heliCool = 60;
    }
    if (this.heli.present && this.heli.falling < 0 && player && stars >= 4) {
      this.heli.fireT -= dt;
      if (this.heli.fireT <= 0) {
        this.heli.fireT = 1.8 + Math.random() * 1.4;
        this.hooks.shoot(this.heli.pos.clone().setY(this.heli.pos.y - 2.6), Math.random() < 0.28);
      }
    }
    // patrol cars
    const want = player && !indoors ? (stars >= 4 ? 2 : stars >= 2 ? 1 : 0) : 0;
    let out = this.cars.filter((c) => c.state === 'coming' || c.state === 'parked').length;
    for (const c of this.cars) {
      const flash = Math.floor(t * 4 + (c === this.cars[0] ? 0 : 1)) % 2;
      c.bar[0].color.setHex(flash ? 0xff2a1a : 0x2a0000);
      c.bar[1].color.setHex(flash ? 0x00081a : 0x2a5cff);
      if (c.state === 'off') {
        if (player && out < want) {
          this.dispatch(c, player, camFwd);
          out++;
        }
        continue;
      }
      if (want === 0 && (c.state === 'coming' || c.state === 'parked')) {
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
        }
      }
      c.pos.x += Math.sin(c.yaw) * c.v * dt;
      c.pos.z += Math.cos(c.yaw) * c.v * dt;
      c.group.position.copy(c.pos);
      c.group.rotation.y = c.yaw;
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
  }
}

function wrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
