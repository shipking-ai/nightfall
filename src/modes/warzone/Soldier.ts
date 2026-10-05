import * as THREE from 'three';
import { styleFor } from '../../anim/gait';
import { moodFor } from '../../anim/face';
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
  /** a live grenade or fire near here (to get away from) */
  danger?(at: THREE.Vector3, r: number): THREE.Vector3 | null;
  /** throw a grenade (or smoke, a flash) at a spot */
  lob?(s: Soldier, kind: 'frag' | 'smoke' | 'flash' | 'stun', at: THREE.Vector3): void;
  /** tell the squad: an enemy is there */
  callout?(s: Soldier, at: THREE.Vector3): void;
  /** the mode's own idea of where this one should be (a flag, a site, the zone); null: the points */
  goal?(s: Soldier): THREE.Vector3 | null;
}

/** The match's rules every unit plays by: free-for-all makes everyone else a foe. */
export const RULES = { ffa: false };
/** Is `b` an enemy of `a`? */
export function foe(a: Unit, b: Unit) {
  return a !== b && (RULES.ffa || a.team !== b.team);
}

type Mode = 'move' | 'fight' | 'retreat' | 'cover';

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
  /** blinded by a flash, slowed by a stun, pinned by fire going past (seconds) */
  blindT = 0;
  stunT = 0;
  suppressT = 0;
  /** somewhere worth looking: where the enemy was last seen, a fight heard, a squadmate's callout */
  private hunt = new THREE.Vector3();
  private huntT = 0;
  private lastSeen = new THREE.Vector3();
  /** a spot out of the enemy's sight (to reload or heal behind) */
  private coverAt = new THREE.Vector3();
  private coverT = 0;
  /** a flanker goes round the side: a waypoint first, then the point */
  private via: THREE.Vector3 | null = null;
  private flanker = Math.random() < 0.3;
  /** what they carry this life */
  frags = 1;
  tac: 'smoke' | 'flash' | 'stun' = (['smoke', 'flash', 'stun'] as const)[Math.floor(Math.random() * 3)];
  tacs = 1;
  private lobT = 2 + Math.random() * 4;

  constructor(public team: 0 | 1, public name: string, public body: Body, public outfit: Outfit, gun: GunId) {
    this.parts = visibleParts(outfit, 10);
    this.gun = GUNS[gun];
    this.mag = this.gun.mag;
    this.motion.stride = 1.05;
    this.motion.armSwing = 0.3;
    this.motion.style = styleFor({ energy: 0.7, confidence: 0.75, nervous: 0.3, tired: 0.2, age: 0.25 }, Math.random, { arche: 'soldier', bulk: outfit.bulk });
    moodFor(this.motion.face, { energy: 0.7, confidence: 0.75, nervous: 0.3, tired: 0.2, age: 0.25 }, 'soldier');
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
    this.blindT = this.stunT = this.suppressT = this.huntT = this.coverT = 0;
    this.via = null;
    this.frags = this.tacs = 1;
    this.lobT = 2 + Math.random() * 4;
  }

  /** A target on the range: stands where it's put, doesn't fight back. */
  dummy = false;

  /** A different gun (Gun Ladder). */
  setGun(id: GunId) {
    this.gun = GUNS[id];
    this.mag = this.gun.mag;
    this.reloading = 0;
  }

  /** A flash: can't see for a while. */
  blind(secs: number) {
    this.blindT = Math.max(this.blindT, secs);
    this.anim.play('react.shield', { group: 'hit', fadeIn: 0.05, fadeOut: 0.3 });
  }

  stun(secs: number) {
    this.stunT = Math.max(this.stunT, secs);
  }

  /** Rounds cracking past: get low, shoot worse. */
  suppress() {
    this.suppressT = 1.2;
  }

  /** Go and look somewhere (a noise, a callout), if there's nothing better to do. */
  investigate(at: THREE.Vector3, secs = 7) {
    if (this.target && this.target.alive) return;
    this.hunt.copy(at);
    this.huntT = secs;
    this.path = [];
    this.repathT = 0;
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
    this.blindT = Math.max(0, this.blindT - dt);
    this.stunT = Math.max(0, this.stunT - dt);
    this.suppressT = Math.max(0, this.suppressT - dt);
    this.huntT = Math.max(0, this.huntT - dt);
    this.coverT = Math.max(0, this.coverT - dt);
    this.lobT -= dt;
    if (this.reloading > 0 && (this.reloading -= dt) <= 0) {
      this.reloading = 0;
      this.mag = this.gun.mag;
    }
    // heal up out of the fight
    if (this.hurtT > 6 && this.hp < 100) this.hp = Math.min(100, this.hp + dt * 20);

    if (this.dummy) {
      this.friction(dt, 10);
      this.turnAim(this.aimYaw, 0, dt, 2);
      this.yaw += wrap(this.aimYaw - this.yaw) * Math.min(1, dt * 10);
      return;
    }
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.18 + Math.random() * 0.1;
      // a flash leaves them blind: nothing new gets noticed
      if (this.blindT <= 0) this.perceive(b);
    }
    this.goalT -= dt;
    if (this.goalT <= 0 || this.goalPoint === -1) this.chooseGoal(b);

    let want = new THREE.Vector2();
    let speed = 4.2 * this.gun.weight;
    const t = this.target;
    // a grenade at their feet beats everything else: run
    const danger = b.danger?.(this.pos, 5.5);
    if (danger) {
      const dx = this.pos.x - danger.x, dz = this.pos.z - danger.z, d = Math.hypot(dx, dz) || 1;
      want.set(dx / d, dz / d);
      if (!b.nav.walkable(this.pos.x + want.x, this.pos.z + want.y)) want.set(-want.y, want.x);
      speed = 5.2;
      this.wantCrouch = false;
      this.turnAim(Math.atan2(want.x, want.y), 0, dt, 6);
      this.move(dt, b, want, speed);
      return;
    }
    if (this.blindT > 0) {
      // staggering, an arm up, aim wandering
      this.turnAim(this.aimYaw + Math.sin(performance.now() * 0.003 + this.pos.x) * 0.8, 0.2, dt, 2);
      want.set(Math.sin(this.aimYaw + Math.PI), Math.cos(this.aimYaw + Math.PI)).multiplyScalar(0.3);
      this.move(dt, b, want, 1.2);
      return;
    }
    if (this.mode === 'cover') {
      const dx = this.coverAt.x - this.pos.x, dz = this.coverAt.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.5) want.set(dx / d, dz / d);
      this.wantCrouch = d < 1;
      if (t) this.turnAim(Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z), 0, dt, 4);
      if (!this.reloading && this.mag < this.gun.mag) this.reload();
      if (this.coverT <= 0 || (!this.reloading && this.hp > 60 && d < 1)) this.mode = t ? 'fight' : 'move';
      this.move(dt, b, want, 4.8 * this.gun.weight);
      return;
    }
    if (this.mode === 'retreat') {
      this.retreatT -= dt;
      if (this.retreatT <= 0 || !t) this.mode = t ? 'fight' : 'move';
    }
    // the reaction clock runs from the moment they're seen; it only holds the trigger, not the turn
    if (t) this.seenT += dt;
    if (t && t.alive && this.mode !== 'retreat') {
      this.mode = 'fight';
      this.lastSeen.copy(t.pos);
      this.fight(dt, b, t, want);
      speed = 2.1 * this.gun.weight * (this.crouch > 0.5 ? 0.5 : 1);
      // out of rounds or hurt mid-fight: find something to get behind first
      if (this.mode === 'fight' && (this.mag <= 0 || (this.hp < 50 && this.hurtT < 0.6)) && this.coverT <= 0 && this.findCover(b, t)) {
        this.mode = 'cover';
        this.coverT = 3.5;
      }
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
      else if (this.goalPoint >= 0 && b.points[this.goalPoint]) {
        const p = b.points[this.goalPoint].pos;
        this.turnAim(Math.atan2(p.x - this.pos.x, p.z - this.pos.z) + Math.sin(performance.now() * 0.0004 + this.pos.x) * 0.9, 0, dt, 1.5);
      }
    }
    this.move(dt, b, want, speed);
  }

  private move(dt: number, b: Battle, want: THREE.Vector2, speed: number) {
    if (this.stunT > 0) speed *= 0.4;
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

  /** Somewhere near, walkable, that the target can't see (and not further from the point than we have to be). */
  private findCover(b: Battle, t: Unit) {
    const eye = _e.set(t.pos.x, t.pos.y + 1.5, t.pos.z);
    let best = -Infinity;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + Math.random() * 0.4, r = 2.5 + Math.random() * 4;
      const x = this.pos.x + Math.cos(a) * r, z = this.pos.z + Math.sin(a) * r;
      if (!b.nav.walkable(x, z)) continue;
      if (b.sees(eye, _t.set(x, this.pos.y + 1.0, z))) continue;
      const s = -r - Math.hypot(x - t.pos.x, z - t.pos.z) * -0.1 + Math.random();
      if (s > best) (best = s), this.coverAt.set(x, 0, z);
    }
    if (best > -Infinity) {
      this.path = [];
      return true;
    }
    return false;
  }

  /** Look for someone to shoot: the closest enemy we can see (or who just shot at us, or is loud nearby). */
  private perceive(b: Battle) {
    const eye = _e.set(this.pos.x, this.pos.y + 1.55 - this.crouch * 0.45, this.pos.z);
    let best: Unit | null = null, bestD = Infinity;
    for (const u of b.units) {
      if (!foe(this, u) || !u.alive) continue;
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
        b.callout?.(this, best.pos);
        this.seenT = -(0.28 + Math.random() * 0.35) * (best.isPlayer ? 1.6 - b.skill * 0.6 : 1);
        this.fireT = 0;
      }
      this.lostT = 0;
    } else if (this.target) {
      this.lostT += 0.2;
      // out of sight a moment: lob something at where they were
      if (this.target.alive && this.lostT > 0.5 && this.lobT <= 0 && b.lob) {
        const d = this.lastSeen.distanceTo(this.pos);
        if (this.frags > 0 && d > 7 && d < 30 && Math.random() < 0.5) {
          this.frags--;
          this.lobT = 8 + Math.random() * 6;
          b.lob(this, 'frag', this.lastSeen);
          this.anim.play('act.throw', { group: 'hit', fadeIn: 0.1, fadeOut: 0.2 });
        } else if (this.tacs > 0 && this.tac !== 'smoke' && d > 6 && d < 22 && Math.random() < 0.4) {
          this.tacs--;
          this.lobT = 6 + Math.random() * 6;
          b.lob(this, this.tac, this.lastSeen);
          this.anim.play('act.throw', { group: 'hit', fadeIn: 0.1, fadeOut: 0.2 });
        }
      }
      if (this.lostT > 2.5 || !this.target.alive) {
        // gone: go and look where they were last seen
        if (this.target.alive) this.investigate(this.lastSeen, 6);
        this.target = null;
        this.seenT = 0;
      }
    }
  }

  /** Where to be: a point to take or hold. Most go for what they don't own; someone always holds home. */
  private chooseGoal(b: Battle) {
    const g = b.goal?.(this);
    if (g || !b.points.length) {
      // the mode says where (or there's nothing to hold: go where the fighting is)
      this.goalT = 1.5 + Math.random() * 1.5;
      this.goalPoint = -2;
      this.via = null;
      const at = g ?? b.home((1 - this.team) as 0 | 1);
      const [gx, gz] = b.nav.nearest(at.x + (Math.random() - 0.5) * 3, at.z + (Math.random() - 0.5) * 3);
      if (Math.hypot(gx - this.goal.x, gz - this.goal.z) > 1.5) {
        this.goal.set(gx, 0, gz);
        this.path = [];
        this.repathT = 0;
      }
      return;
    }
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
    // a flanker swings wide of the straight line to an enemy point
    this.via = null;
    if (this.flanker && p.owner !== this.team && p.owner !== -1) {
      const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
      if (d > 20) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const [vx, vz] = b.nav.nearest(this.pos.x + dx * 0.55 + (-dz / d) * 13 * side, this.pos.z + dz * 0.55 + (dx / d) * 13 * side);
        this.via = new THREE.Vector3(vx, 0, vz);
      }
    }
  }

  /** Walk the route to the goal (or, falling back, towards home). */
  private follow(dt: number, b: Battle, want: THREE.Vector2) {
    if (this.via && Math.hypot(this.via.x - this.pos.x, this.via.z - this.pos.z) < 2.5) {
      this.via = null;
      this.path = [];
    }
    const dest = this.mode === 'retreat' ? b.home(this.team) : this.huntT > 0 ? this.hunt : this.via ?? this.goal;
    if (this.huntT > 0 && this.hunt.distanceTo(this.pos) < 2) this.huntT = 0;
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
      this.wantCrouch = (d > 14 && Math.random() < 0.35) || (this.suppressT > 0 && Math.random() < 0.7);
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
      if (this.tac === 'smoke' && this.tacs > 0 && b.lob) {
        this.tacs--;
        b.lob(this, 'smoke', _t.set(this.pos.x + dx * 0.25, 0, this.pos.z + dz * 0.25));
      }
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
    if (this.suppressT > 0) p *= 0.6;
    if (this.stunT > 0) p *= 0.4;
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
    if (this.stunT > 0) rate *= 0.3;
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
    m.weight = Math.sin(t * 0.13 + this.pos.x) > 0 ? 0.7 : -0.7;
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
