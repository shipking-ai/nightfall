import * as THREE from 'three';
import type { Collision } from '../../world/Collision';
import type { AudioEngine } from '../../audio/AudioEngine';
import type { Blasts } from './Blasts';
import type { Lethal, Tactical } from './weapons';
import { chestY, type Unit } from './Soldier';

/**
 * What you throw and plant. Everything thrown is a body: it arcs, bounces
 * off walls and the ground (and loses speed doing it), rolls to a stop.
 *
 * Lethal: a frag (cooked in the hand, so the fuse is already running), a
 * sticky charge, a fire bottle (breaks and burns the ground), a tripwire
 * mine, a throwing knife, and a remote charge you set off yourself.
 * Tactical: smoke (blocks sight, bots' and yours), a flash (blinds whoever
 * was looking), a stun (slows legs and aim), a decoy (sounds like a fight),
 * a sensor (shows who moves near it) and a stim (heal now).
 */

export type GearKind = Lethal | Tactical;

export const GEAR_NAME: Record<GearKind, string> = {
  frag: 'Frag', semtex: 'Sticky charge', molotov: 'Fire bottle', claymore: 'Tripwire mine', throwknife: 'Throwing knife', c4: 'Remote charge',
  smoke: 'Smoke', flash: 'Flash', stun: 'Stun', decoy: 'Decoy', sensor: 'Sensor', stim: 'Stim',
};

export interface GearHost {
  units: Unit[];
  col: Collision;
  blasts: Blasts;
  audio: AudioEngine;
  sees(a: THREE.Vector3, b: THREE.Vector3): boolean;
  /** an explosion at `at` (radius, damage at the centre), credited to `owner` */
  explode(at: THREE.Vector3, r: number, dmg: number, owner: Unit, name: string): void;
  /** direct damage (a knife, fire), credited to `owner`; true if it killed */
  hurt(u: Unit, dmg: number, owner: Unit, name: string, head: boolean): boolean;
  /** blinded (0..1, seconds scale) */
  blind(u: Unit, k: number): void;
  stun(u: Unit, k: number): void;
  /** a fight that isn't there: bots go and look */
  noise(at: THREE.Vector3, team: 0 | 1): void;
}

interface Thrown {
  kind: GearKind;
  owner: Unit;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** seconds until it goes off (Infinity: on contact, or when told) */
  fuse: number;
  stuck: boolean;
  resting: boolean;
  /** facing (mines) */
  yaw: number;
  /** seconds it has existed */
  age: number;
  /** stuck to a body */
  on: Unit | null;
  armed: boolean;
}

interface Zone {
  kind: 'smoke' | 'fire' | 'decoy' | 'sensor';
  pos: THREE.Vector3;
  r: number;
  t: number;
  owner: Unit;
  tick: number;
}

const MAX = 32;

export class Gear {
  group = new THREE.Group();
  thrown: Thrown[] = [];
  zones: Zone[] = [];
  private mesh: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private e = new THREE.Euler();

  constructor(private host: GearHost) {
    const g = new THREE.CylinderGeometry(0.035, 0.04, 0.1, 10);
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0x3e4536, roughness: 0.7, metalness: 0.2 }), MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.group.add(this.mesh);
  }

  clear() {
    this.thrown.length = 0;
    this.zones.length = 0;
  }

  /** Throw (or plant) one. `cooked`: seconds already off the fuse. */
  throw(kind: GearKind, owner: Unit, from: THREE.Vector3, dir: THREE.Vector3, cooked = 0) {
    const plant = kind === 'claymore' || kind === 'sensor';
    const speed = kind === 'throwknife' ? 34 : plant ? 3 : kind === 'molotov' ? 15 : 17;
    const v = dir.clone().multiplyScalar(speed);
    if (!plant && kind !== 'throwknife') v.y += 3.2;
    const fuse =
      kind === 'frag' ? 3 - cooked : kind === 'semtex' ? 1.6 : kind === 'flash' || kind === 'stun' ? 1.4 : kind === 'smoke' ? 1.2 : kind === 'decoy' ? 1 : Infinity;
    this.thrown.push({ kind, owner, pos: from.clone(), vel: v, fuse, stuck: false, resting: false, yaw: Math.atan2(dir.x, dir.z), age: 0, on: null, armed: false });
    if (this.thrown.length > MAX) this.thrown.shift();
    this.host.audio.mechanism(plant ? 'magIn' : 'pin', owner.isPlayer ? null : owner.pos);
  }

  /** A lob that lands at `at` (bots: they work out the arc). */
  lob(kind: GearKind, owner: Unit, from: THREE.Vector3, at: THREE.Vector3) {
    const dx = at.x - from.x, dz = at.z - from.z, dy = at.y - from.y;
    const T = THREE.MathUtils.clamp(Math.hypot(dx, dz) / 13, 0.45, 2.2);
    this.throw(kind, owner, from, _d.set(0, 0, 1));
    const t = this.thrown[this.thrown.length - 1];
    t.vel.set(dx / T, (dy + 0.5 * 9.8 * T * T) / T, dz / T);
    // a frag is cooked so it goes off about when it lands
    if (kind === 'frag') t.fuse = Math.max(T + 0.4, 1.2);
  }

  /** Set off your remote charges. Returns true if there were any. */
  detonate(owner: Unit) {
    let any = false;
    for (const t of this.thrown) if (t.kind === 'c4' && t.owner === owner) (t.fuse = 0), (any = true);
    return any;
  }

  /** Is one of `owner`'s remote charges out? */
  hasCharge(owner: Unit) {
    return this.thrown.some((t) => t.kind === 'c4' && t.owner === owner);
  }

  /** Does smoke lie between a and b? */
  smokeBlocks(a: THREE.Vector3, b: THREE.Vector3) {
    for (const z of this.zones) {
      if (z.kind !== 'smoke' || z.t < 0.6) continue;
      // distance from the cloud's centre to the segment
      _d.subVectors(b, a);
      const l2 = _d.lengthSq() || 1;
      const k = THREE.MathUtils.clamp(_o.subVectors(z.pos, a).dot(_d) / l2, 0, 1);
      const c = _o.copy(a).addScaledVector(_d, k);
      if (c.distanceTo(z.pos) < z.r * Math.min(1, z.t / 1.5)) return true;
    }
    return false;
  }

  /** Is this unit revealed by an enemy sensor? */
  revealed(u: Unit, by: 0 | 1) {
    for (const z of this.zones) if (z.kind === 'sensor' && z.owner.team === by && u.team !== by && z.pos.distanceTo(u.pos) < z.r && Math.hypot(u.vel.x, u.vel.z) > 0.4) return true;
    return false;
  }

  /** The nearest live grenade within `r` of a point (bots run from it). */
  danger(at: THREE.Vector3, r: number): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null, bd = r;
    for (const t of this.thrown) {
      if (!(t.kind === 'frag' || t.kind === 'semtex' || t.kind === 'molotov') || t.fuse === Infinity && t.kind !== 'molotov') continue;
      const d = t.pos.distanceTo(at);
      if (d < bd) (bd = d), (best = t.pos);
    }
    for (const z of this.zones) if (z.kind === 'fire' && z.pos.distanceTo(at) < z.r + 1) return z.pos;
    return best;
  }

  update(dt: number) {
    const h = this.host;
    for (let i = this.thrown.length - 1; i >= 0; i--) {
      const t = this.thrown[i];
      t.age += dt;
      if (t.on) {
        if (!t.on.alive) t.on = null;
        else t.pos.set(t.on.pos.x, chestY(t.on), t.on.pos.z);
      } else if (!t.stuck && !t.resting) this.fly(t, dt);
      if (t.kind === 'throwknife' && (t.resting || t.stuck)) {
        this.thrown.splice(i, 1);
        continue;
      }
      // mines watch the ground in front of them once they've settled
      if (t.kind === 'claymore' && t.resting) {
        if (t.age > 1.5) t.armed = true;
        if (t.armed && t.fuse === Infinity)
          for (const u of h.units) {
            if (!u.alive || u.team === t.owner.team) continue;
            const dx = u.pos.x - t.pos.x, dz = u.pos.z - t.pos.z, d = Math.hypot(dx, dz);
            if (d > 2.8) continue;
            const off = Math.abs(wrap(Math.atan2(dx, dz) - t.yaw));
            if (off < 1.1) {
              t.fuse = 0.25;
              h.audio.mechanism('click', t.pos);
            }
          }
      }
      if (t.kind === 'sensor' && t.resting) {
        this.zones.push({ kind: 'sensor', pos: t.pos.clone(), r: 16, t: 0, owner: t.owner, tick: 0 });
        this.thrown.splice(i, 1);
        continue;
      }
      if (t.fuse !== Infinity) t.fuse -= dt;
      if (t.fuse <= 0) {
        this.go(t);
        this.thrown.splice(i, 1);
      }
    }
    // the zones
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.t += dt;
      z.tick -= dt;
      const life = z.kind === 'smoke' ? 11 : z.kind === 'fire' ? 7 : z.kind === 'decoy' ? 8 : 22;
      if (z.t > life) {
        this.zones.splice(i, 1);
        continue;
      }
      if (z.kind === 'smoke' && z.tick <= 0 && z.t < life - 2) {
        z.tick = 0.07;
        const a = Math.random() * Math.PI * 2, rr = Math.random() * z.r * Math.min(1, z.t / 1.5) * 0.8;
        _o.set(z.pos.x + Math.cos(a) * rr, z.pos.y + 0.3 + Math.random() * 2.2, z.pos.z + Math.sin(a) * rr);
        h.blasts.puff(_o, 0.62, 3.5);
      }
      if (z.kind === 'fire') {
        if (z.tick <= 0) {
          z.tick = 0.05;
          const a = Math.random() * Math.PI * 2, rr = Math.random() * z.r;
          h.blasts.flame(_o.set(z.pos.x + Math.cos(a) * rr, z.pos.y + 0.05, z.pos.z + Math.sin(a) * rr));
        }
        for (const u of h.units) if (u.alive && u.pos.distanceTo(z.pos) < z.r && Math.abs(u.pos.y - z.pos.y) < 1.5) h.hurt(u, 22 * dt, z.owner, 'Fire bottle', false);
      }
      if (z.kind === 'decoy' && z.tick <= 0) {
        z.tick = 0.08 + Math.random() * (Math.random() < 0.3 ? 0.9 : 0.12);
        h.audio.gunshot(z.pos, { caliber: 0.5, report: 'crack' });
        h.noise(z.pos, z.owner.team);
      }
    }
    this.draw();
  }

  private fly(t: Thrown, dt: number) {
    const h = this.host;
    if (t.kind !== 'throwknife') t.vel.y -= 9.8 * dt;
    else t.vel.y -= 2 * dt;
    const step = _d.copy(t.vel).multiplyScalar(dt);
    const len = step.length();
    if (len < 1e-5) return;
    const dir = _o.copy(step).divideScalar(len);
    // bodies first (a knife or a sticky charge finds people)
    if (t.kind === 'throwknife' || t.kind === 'semtex' || t.kind === 'molotov') {
      for (const u of h.units) {
        if (!u.alive || u === t.owner || u.team === t.owner.team) continue;
        const near = _n.set(u.pos.x, Math.min(Math.max(t.pos.y, u.pos.y + 0.2), u.pos.y + 1.7), u.pos.z);
        if (near.distanceTo(t.pos) > 0.45 + len) continue;
        if (t.kind === 'throwknife') {
          const head = t.pos.y > u.pos.y + 1.45;
          h.hurt(u, head ? 200 : 100, t.owner, 'Throwing knife', head);
          t.stuck = true;
          return;
        }
        if (t.kind === 'semtex') {
          t.on = u;
          t.stuck = true;
          h.audio.mechanism('click', t.pos);
          return;
        }
        t.fuse = 0;
        return;
      }
    }
    const wall = h.col.raycast(t.pos, dir, len);
    if (wall < len) {
      t.pos.addScaledVector(dir, Math.max(0, wall - 0.04));
      if (t.kind === 'semtex' || t.kind === 'c4' || t.kind === 'throwknife') {
        t.stuck = true;
        return;
      }
      if (t.kind === 'molotov') {
        t.fuse = 0;
        return;
      }
      // which way was the wall? whichever axis is blocked bounces
      const bx = h.col.raycast(t.pos, _n.set(Math.sign(dir.x) || 1, 0, 0), 0.2) < 0.2;
      const bz = h.col.raycast(t.pos, _n.set(0, 0, Math.sign(dir.z) || 1), 0.2) < 0.2;
      if (bx || !bz) t.vel.x *= -0.45;
      if (bz || !bx) t.vel.z *= -0.45;
      t.vel.y *= 0.6;
      h.audio.mechanism('shell', t.pos);
      return;
    }
    t.pos.add(step);
    const ground = h.col.groundAt(t.pos.x, t.pos.z, t.pos.y + 0.3, 0.6, 0.05);
    if (t.pos.y < ground + 0.04) {
      t.pos.y = ground + 0.04;
      if (t.kind === 'molotov') {
        t.fuse = 0;
        return;
      }
      if (t.kind === 'semtex' || t.kind === 'c4') {
        t.stuck = true;
        return;
      }
      if (t.vel.y < -1.5) h.audio.mechanism('shell', t.pos);
      t.vel.y = Math.abs(t.vel.y) * 0.32;
      t.vel.x *= 0.62;
      t.vel.z *= 0.62;
      if (Math.hypot(t.vel.x, t.vel.z) < 0.4 && t.vel.y < 0.6) {
        t.vel.set(0, 0, 0);
        t.resting = true;
      }
    }
  }

  /** It goes off. */
  private go(t: Thrown) {
    const h = this.host, at = t.pos;
    switch (t.kind) {
      case 'frag': h.explode(at, 6, 150, t.owner, 'Frag'); break;
      case 'semtex': h.explode(at, 5, 160, t.owner, 'Sticky charge'); break;
      case 'c4': h.explode(at, 6.5, 200, t.owner, 'Remote charge'); break;
      case 'claymore': h.explode(_n.copy(at).add(_o.set(Math.sin(t.yaw) * 1.2, 0.4, Math.cos(t.yaw) * 1.2)), 4, 160, t.owner, 'Tripwire mine'); break;
      case 'molotov':
        h.audio.mechanism('shell', at);
        h.blasts.boom(at, 1.4);
        this.zones.push({ kind: 'fire', pos: at.clone().setY(Math.max(0, at.y - 0.2)), r: 3, t: 0, owner: t.owner, tick: 0 });
        break;
      case 'smoke':
        h.audio.mechanism('magOut', at);
        this.zones.push({ kind: 'smoke', pos: at.clone(), r: 4.5, t: 0, owner: t.owner, tick: 0 });
        break;
      case 'decoy':
        this.zones.push({ kind: 'decoy', pos: at.clone(), r: 0, t: 0, owner: t.owner, tick: 0.3 });
        break;
      case 'flash': case 'stun': {
        h.blasts.pop(at, t.kind === 'flash' ? 0xffffff : 0xa0c8ff);
        h.audio.explosion(at, 0.35);
        const range = t.kind === 'flash' ? 15 : 8;
        const eye = _n.copy(at).setY(at.y + 0.2);
        for (const u of h.units) {
          if (!u.alive) continue;
          if (u.team === t.owner.team && u !== t.owner) continue;
          const c = _o.set(u.pos.x, chestY(u) + 0.3, u.pos.z);
          const d = c.distanceTo(at);
          if (d > range || !h.sees(eye, c)) continue;
          const k = 1 - d / range;
          if (t.kind === 'flash') h.blind(u, k);
          else h.stun(u, Math.min(1, k + 0.35));
        }
        break;
      }
      default: break;
    }
  }

  private draw() {
    let n = 0;
    for (const t of this.thrown) {
      if (n >= MAX) break;
      const flat = t.kind === 'claymore' || t.kind === 'c4' || t.kind === 'sensor';
      this.e.set(flat ? 0 : t.age * 9, t.yaw, flat ? 0 : t.age * 5);
      this.q.setFromEuler(this.e);
      const sc = t.kind === 'claymore' ? [2.4, 1.2, 0.7] : t.kind === 'c4' ? [2, 0.5, 1.6] : t.kind === 'throwknife' ? [0.3, 2.2, 0.3] : t.kind === 'molotov' ? [1.1, 2.4, 1.1] : [1, 1, 1];
      this.m.compose(t.pos, this.q, this.s.set(sc[0], sc[1], sc[2]));
      this.mesh.setMatrixAt(n++, this.m);
    }
    for (const z of this.zones) {
      if (z.kind !== 'sensor' || n >= MAX) continue;
      this.m.compose(z.pos, this.q.identity(), this.s.set(1.2, 2.6, 1.2));
      this.mesh.setMatrixAt(n++, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const _d = new THREE.Vector3();
const _o = new THREE.Vector3();
const _n = new THREE.Vector3();

function wrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
