import * as THREE from 'three';
import { newMotion, newRig, solve, stepPhase, visibleParts, type Body, type Motion, type Outfit, type PartKey, type Rig } from '../../entities/Humanoid';
import { Animator } from '../../anim/Animator';
import '../../anim/clips';
import type { Collision } from '../../world/Collision';
import type { NavGrid } from './NavGrid';
import { GUNS, MAX_ARMOR, type Gun, type GunId } from './weapons';

/**
 * Anyone in the match: the player, or a bot. What the match needs to know
 * to aim at them, hurt them and put them on the scoreboard.
 */
export interface Unit {
  team: 0 | 1;
  name: string;
  isPlayer: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  alive: boolean;
  hp: number;
  armor: number;
  /** 0 standing … 1 crouched */
  crouch: number;
  kills: number;
  deaths: number;
  caps: number;
  /** seconds since they last fired (a shot gives you away) */
  sinceShot: number;
}

export interface CapturePoint {
  id: 'A' | 'B' | 'C';
  pos: THREE.Vector3;
  /** -1 nobody, 0 blue, 1 red */
  owner: -1 | 0 | 1;
  /** capture progress 0..1 by `capTeam` */
  cap: number;
  capTeam: -1 | 0 | 1;
  contested: boolean;
  radius: number;
}

/** What a bot can ask of the match. */
export interface Battle {
  units: Unit[];
  points: CapturePoint[];
  nav: NavGrid;
  col: Collision;
  /** can an eye at `a` see a body at `b`? */
  sees(a: THREE.Vector3, b: THREE.Vector3): boolean;
  /** a bot's shot: the match works out hits, damage, tracers, sound */
  fire(s: Soldier, target: Unit, hit: boolean, head: boolean): void;
  /** the team's spawn, for falling back */
  home(team: 0 | 1): THREE.Vector3;
  /** 0..1 how sharp the bots are against the player (difficulty) */
  skill: number;
}

type Mode = 'move' | 'fight' | 'retreat';

/** Heights on a body: where you aim, where a head is. */
export function chestY(u: Unit) {
  return u.pos.y + 1.2 - u.crouch * 0.38;
}
export function headY(u: Unit) {
  return u.pos.y + 1.63 - u.crouch * 0.5;
}

export class Soldier implements Unit {
  isPlayer = false;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  alive = true;
  hp = 100;
  armor = MAX_ARMOR;
  crouch = 0;
  kills = 0;
  deaths = 0;
  caps = 0;
  sinceShot = 99;
  motion: Motion = newMotion();
  rig: Rig = newRig();
  anim = new Animator();
  parts: Set<PartKey>;
  gun: Gun;
  mag: number;
  reloading = 0;
  /** seconds until they're back (dead) */
  respawnT = 0;
  // the mind
  private mode: Mode = 'move';
  private goal = new THREE.Vector3();
  private goalPoint = -1;
  private path: number[] = [];
  private pathI = 0;
  private repathT = 0;
  private thinkT = Math.random() * 0.3;
  private goalT = 0;
  target: Unit | null = null;
  private seenT = 0;
  private lostT = 0;
  private fireT = 0;
  private burst = 0;
  private strafe = 1;
  private strafeT = 0;
  private wantCrouch = false;
  private stuckT = 0;
  private lastPos = new THREE.Vector3();
  private retreatT = 0;
  /** the point this one leans towards (so a team spreads out instead of all running at B) */
  private lean = Math.floor(Math.random() * 3);
  /** aim angles actually held (they turn onto a target, they don't snap) */
  aimYaw = 0;
  aimPitch = 0;
  hurtT = 99;
  lastAttacker: Unit | null = null;

  constructor(public team: 0 | 1, public name: string, public body: Body, public outfit: Outfit, gun: GunId) {
    this.parts = visibleParts(outfit, 10);
    this.gun = GUNS[gun];
    this.mag = this.gun.mag;
    this.motion.stride = 1.05;
    this.motion.armSwing = 0.3;
  }

  spawn(x: number, z: number, y: number, yaw: number, gun?: GunId) {
    if (gun) this.gun = GUNS[gun];
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.yaw = this.aimYaw = yaw;
    this.aimPitch = 0;
    this.alive = true;
    this.hp = 100;
    this.armor = MAX_ARMOR;
    this.mag = this.gun.mag;
    this.reloading = 0;
    this.target = null;
    this.mode = 'move';
    this.path = [];
    this.goalPoint = -1;
    this.goalT = 0;
    this.crouch = 0;
    this.anim.clear();
    this.sinceShot = 99;
  }

  /** Hit by something: turn to face it, and remember who. */
  hurt(from: Unit) {
    this.hurtT = 0;
    this.lastAttacker = from;
    if (!this.target || this.target === from || !this.target.alive) {
      this.target = from;
      this.seenT = Math.max(this.seenT, 0.15);
    }
    const dx = from.pos.x - this.pos.x, dz = from.pos.z - this.pos.z;
    const rel = wrap(Math.atan2(dx, dz) - this.yaw);
    const clip = Math.abs(rel) < 0.8 ? 'react.hitFront' : Math.abs(rel) > 2.3 ? 'react.hitBack' : rel > 0 ? 'react.hitRight' : 'react.hitLeft';
    this.anim.play(clip, { group: 'hit', fadeIn: 0.04, fadeOut: 0.2 });
  }

  die(from: Unit | null) {
    this.alive = false;
    this.deaths++;
    this.vel.set(0, 0, 0);
    this.target = null;
    this.anim.stop('hit', 0.05);
    let clip = 'react.deathBack';
    if (from) {
      const rel = Math.abs(wrap(Math.atan2(from.pos.x - this.pos.x, from.pos.z - this.pos.z) - this.yaw));
      clip = rel > 1.6 ? 'react.deathForward' : 'react.deathBack';
    }
    this.anim.play(clip, { group: 'death', fadeIn: 0.08, stay: true });
  }

  /* ─────────────────────────── the mind ─────────────────────────── */

  update(dt: number, b: Battle) {
    this.anim.update(dt);
    this.sinceShot += dt;
    this.hurtT += dt;
    if (!this.alive) {
      this.friction(dt, 8);
      return;
    }
    if (this.reloading > 0 && (this.reloading -= dt) <= 0) {
      this.reloading = 0;
      this.mag = this.gun.mag;
    }
    // heal up out of the fight
    if (this.hurtT > 6 && this.hp < 100) this.hp = Math.min(100, this.hp + dt * 20);

    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.18 + Math.random() * 0.1;
      this.perceive(b);
    }
    this.goalT -= dt;
    if (this.goalT <= 0 || this.goalPoint < 0) this.chooseGoal(b);

    let want = new THREE.Vector2();
    let speed = 4.2 * this.gun.weight;
    const t = this.target;
    if (this.mode === 'retreat') {
      this.retreatT -= dt;
      if (this.retreatT <= 0 || !t) this.mode = t ? 'fight' : 'move';
    }
    // the reaction clock runs from the moment they're seen; it only holds the trigger, not the turn
    if (t) this.seenT += dt;
    if (t && t.alive && this.mode !== 'retreat') {
      this.mode = 'fight';
      this.fight(dt, b, t, want);
      speed = 2.1 * this.gun.weight * (this.crouch > 0.5 ? 0.5 : 1);
    } else {
      if (this.mode === 'fight') this.mode = 'move';
      this.follow(dt, b, want);
      if (this.mode === 'retreat') speed = 4.6;
      this.wantCrouch = false;
      // a quiet moment: top up the magazine
      if (!this.reloading && this.mag < this.gun.mag * 0.5) this.reload();
      // face where we're going, gun at the ready
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (hs > 0.5) this.turnAim(Math.atan2(this.vel.x, this.vel.z), 0, dt, 5);
      else if (this.goalPoint >= 0) {
        const p = b.points[this.goalPoint].pos;
        this.turnAim(Math.atan2(p.x - this.pos.x, p.z - this.pos.z) + Math.sin(performance.now() * 0.0004 + this.pos.x) * 0.9, 0, dt, 1.5);
      }
    }
    // move
    const l = want.length();
    if (l > 1) want.multiplyScalar(1 / l);
    const k = Math.min(1, dt * 9);
    this.vel.x += (want.x * speed - this.vel.x) * k;
    this.vel.z += (want.y * speed - this.vel.z) * k;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    b.col.resolve(this.pos, 0.34, 1.8, 0.45);
    this.pos.y = b.col.groundAt(this.pos.x, this.pos.z, this.pos.y, 0.45, 0.3);
    this.crouch += ((this.wantCrouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 7);
    // the body turns with the aim, the legs follow the feet
    this.yaw += wrap(this.aimYaw - this.yaw) * Math.min(1, dt * 10);
    // stuck on something: find another way
    if (l > 0.3) {
      this.stuckT = this.lastPos.distanceTo(this.pos) < dt * 0.6 ? this.stuckT + dt : 0;
      if (this.stuckT > 0.8) {
        this.stuckT = 0;
        this.path = [];
        this.repathT = 0;
        this.strafe = -this.strafe;
      }
    }
    this.lastPos.copy(this.pos);
  }

  private friction(dt: number, k: number) {
    const d = Math.max(0, 1 - dt * k);
    this.vel.x *= d;
    this.vel.z *= d;
  }

  /** Look for someone to shoot: the closest enemy we can see (or who just shot at us, or is loud nearby). */
  private perceive(b: Battle) {
    const eye = _e.set(this.pos.x, this.pos.y + 1.55 - this.crouch * 0.45, this.pos.z);
    let best: Unit | null = null, bestD = Infinity;
    for (const u of b.units) {
      if (u.team === this.team || !u.alive) continue;
      const d = u.pos.distanceTo(this.pos);
      if (d > 70) continue;
      const rel = Math.abs(wrap(Math.atan2(u.pos.x - this.pos.x, u.pos.z - this.pos.z) - this.aimYaw));
      const noticed = rel < 1.25 || d < 10 || (u.sinceShot < 0.6 && d < 45) || u === this.lastAttacker;
      if (!noticed) continue;
      const w = d * (u === this.target ? 0.6 : 1) * (u.isPlayer ? 0.9 : 1);
      if (w >= bestD) continue;
      if (!b.sees(eye, _t.set(u.pos.x, chestY(u), u.pos.z))) continue;
      best = u;
      bestD = w;
    }
    if (best) {
      if (best !== this.target) {
        // a reaction time before they do anything about it
        this.target = best;
        this.seenT = -(0.28 + Math.random() * 0.35) * (best.isPlayer ? 1.6 - b.skill * 0.6 : 1);
        this.fireT = 0;
      }
      this.lostT = 0;
    } else if (this.target) {
      this.lostT += 0.2;
      if (this.lostT > 2.5 || !this.target.alive) {
        this.target = null;
        this.seenT = 0;
      }
    }
  }

  /** Where to be: a point to take or hold. Most go for what they don't own; someone always holds home. */
  private chooseGoal(b: Battle) {
    this.goalT = 6 + Math.random() * 8;
    let best = 0, bestS = -Infinity;
    b.points.forEach((p, i) => {
      const d = p.pos.distanceTo(this.pos);
      let s = -d * 0.05 + Math.random() * 2.2;
      if (p.owner !== this.team) s += 3;
      if (p.capTeam !== this.team && p.capTeam !== -1 && p.owner === this.team) s += 4; // it's being taken from us
      if (p.id === 'B') s += 0.5;
      if (i === this.lean) s += 1.8;
      if (s > bestS) (bestS = s), (best = i);
    });
    this.goalPoint = best;
    const p = b.points[best];
    const a = Math.random() * Math.PI * 2, r = Math.random() * p.radius * 0.8;
    const [gx, gz] = b.nav.nearest(p.pos.x + Math.cos(a) * r, p.pos.z + Math.sin(a) * r);
    this.goal.set(gx, 0, gz);
    this.path = [];
    this.repathT = 0;
  }

  /** Walk the route to the goal (or, falling back, towards home). */
  private follow(dt: number, b: Battle, want: THREE.Vector2) {
    const dest = this.mode === 'retreat' ? b.home(this.team) : this.goal;
    this.repathT -= dt;
    if (!this.path.length || this.repathT <= 0) {
      this.repathT = 3 + Math.random() * 2;
      this.path = b.nav.path(this.pos.x, this.pos.z, dest.x, dest.z) ?? [];
      this.pathI = 0;
    }
    if (this.pathI >= this.path.length) return;
    const px = this.path[this.pathI], pz = this.path[this.pathI + 1];
    const dx = px - this.pos.x, dz = pz - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.6) {
      this.pathI += 2;
      return;
    }
    want.set(dx / d, dz / d);
    // near the end of the route: ease in
    if (this.pathI >= this.path.length - 2 && d < 2) want.multiplyScalar(d / 2);
  }

  /** In a fight: turn onto them, strafe, crouch at range, shoot in bursts, reload, fall back when hurt. */
  private fight(dt: number, b: Battle, t: Unit, want: THREE.Vector2) {
    const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    const pitch = Math.atan2(chestY(t) - (this.pos.y + 1.45), d);
    this.turnAim(yaw, pitch, dt, 6);
    // strafe across their line; close the distance if the gun wants it, back off if too close
    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafeT = 0.6 + Math.random() * 1.1;
      this.strafe = Math.random() < 0.5 ? -1 : 1;
      this.wantCrouch = d > 14 && Math.random() < 0.35;
    }
    const ideal = this.gun.range[0] * 0.8;
    const toward = d > ideal + 6 ? 0.6 : d < 4 ? -0.5 : 0;
    const sx = Math.cos(yaw) * this.strafe, sz = -Math.sin(yaw) * this.strafe;
    want.set(sx * 0.8 + (dx / d) * toward, sz * 0.8 + (dz / d) * toward);
    if (!b.nav.walkable(this.pos.x + want.x * 0.8, this.pos.z + want.y * 0.8)) {
      this.strafe = -this.strafe;
      want.set(-want.x, -want.y);
    }
    // hurt and outgunned: get out of sight for a moment
    if (this.hp < 35 && this.hurtT < 1 && Math.random() < dt * 1.5) {
      this.mode = 'retreat';
      this.retreatT = 2 + Math.random() * 1.5;
      this.path = [];
      return;
    }
    if (this.reloading > 0) return;
    if (this.mag <= 0) return this.reload();
    if (this.seenT < 0) return;
    // on target yet?
    const off = Math.abs(wrap(yaw - this.aimYaw));
    if (off > 0.2) return;
    this.fireT -= dt;
    if (this.fireT > 0) return;
    if (this.burst <= 0) {
      this.burst = this.gun.auto ? 3 + Math.floor(Math.random() * 5) : 1;
      if (this.burst > 1 || this.fireT < -0.5) this.fireT = 0;
    }
    this.fireT = this.gun.rate * (this.gun.auto ? 1 : 1.8 + Math.random());
    this.burst--;
    if (this.burst <= 0) this.fireT += 0.25 + Math.random() * 0.45;
    this.mag--;
    this.sinceShot = 0;
    // accuracy: range, their movement, crouching, how long we've been tracking, and (against you) the difficulty
    const moving = Math.hypot(t.vel.x, t.vel.z);
    let p = 0.62 - d * 0.006 - moving * 0.045 - (t.crouch > 0.5 && d > 10 ? 0.1 : 0) + Math.min(0.2, this.seenT * 0.1);
    if (d > this.gun.range[1]) p *= 0.5;
    if (t.isPlayer) p *= 0.45 + b.skill * 0.4;
    p = THREE.MathUtils.clamp(p, 0.04, 0.85);
    const hit = Math.random() < p;
    b.fire(this, t, hit, hit && Math.random() < 0.12);
    this.anim.play('gun.recoil', { group: 'recoil', fadeIn: 0.01, fadeOut: 0.08 });
  }

  reload() {
    if (this.reloading || this.mag >= this.gun.mag) return;
    this.reloading = this.gun.reload;
    this.anim.play('gun.reload', { group: 'reload', fadeIn: 0.1, fadeOut: 0.2, speed: 2.2 / this.gun.reload });
  }

  private turnAim(yaw: number, pitch: number, dt: number, rate: number) {
    this.aimYaw += wrap(yaw - this.aimYaw) * Math.min(1, dt * rate);
    this.aimPitch += (pitch - this.aimPitch) * Math.min(1, dt * rate);
  }

  /* ─────────────────────────── the body ─────────────────────────── */

  pose(dt: number, t: number) {
    const m = this.motion;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    m.speed = this.alive ? hs : 0;
    m.moveDir = hs > 0.3 ? wrap(Math.atan2(this.vel.x, this.vel.z) - this.yaw) : m.moveDir * 0.9;
    m.crouch = this.crouch;
    const aiming = this.alive && (this.mode === 'fight' || this.sinceShot < 1) && !this.reloading;
    m.armR = this.gun.long ? (aiming ? 'rifleAim' : 'rifle') : aiming ? 'aim' : 'free';
    m.armL = this.gun.long ? m.armR : 'free';
    m.lookPitch = aiming ? -this.aimPitch : 0;
    m.lookYaw = 0;
    m.weight = Math.sin(t * 0.7 + this.pos.x);
    stepPhase(m, dt);
    _m.compose(this.pos, _q.setFromAxisAngle(_up, this.yaw), _s.setScalar(this.body.height));
    solve(this.rig, _m, this.body, this.outfit, m, t, this.anim);
  }
}

const _e = new THREE.Vector3();
const _t = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export function wrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
