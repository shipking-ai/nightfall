import * as THREE from 'three';
import { FigureBatch } from '../../entities/FigureBatch';
import { newMotion, newRig, solve, stepPhase, visibleParts, type Body, type Outfit, type PartKey } from '../../entities/Humanoid';
import { Animator } from '../../anim/Animator';
import '../../anim/fightClips';
import { MAX_JUGGLE, MOVES, PARRY_WINDOW, THROW_FRAMES, THROW_SLAM, type Move } from './moves';

/**
 * One fighter: a person from the city (the same rig, the same clothes), a
 * state machine that runs at a fixed 60 steps a second, and the authored
 * fight animations laid over a guard stance. The match (modes/Fight.ts)
 * owns time: it steps both fighters, freezes them for hitstop, and asks
 * `strike` whether an active attack has connected.
 */

export const MAX_HP = 1000;
export const MAX_METER = 300;
const DT = 1 / 60;
const GRAVITY = 24;

/** One frame of intent, from a controller or the CPU. */
export interface Intent {
  /** the stick turned into the world (x, z): along the fight and across it */
  wx: number;
  wz: number;
  /** the stick's up/down on screen (up + heavy launches, down + heavy sweeps) */
  sy: number;
  light: boolean;
  heavy: boolean;
  special: boolean;
  grab: boolean;
  dodge: boolean;
  jump: boolean;
  /** held */
  block: boolean;
  /** anything at all pressed (gets you up off the floor sooner) */
  any: boolean;
}

export const idleIntent = (): Intent => ({ wx: 0, wz: 0, sy: 0, light: false, heavy: false, special: false, grab: false, dodge: false, jump: false, block: false, any: false });

type Press = 'light' | 'heavy' | 'special' | 'grab' | 'dodge' | 'jump';
type Dir = 'n' | 'fwd' | 'back' | 'up' | 'down';

export type FState =
  | 'intro' | 'idle' | 'attack' | 'block' | 'blockstun' | 'hitstun' | 'air' | 'land' | 'juggle' | 'down' | 'getup' | 'dodge'
  | 'throw' | 'thrown' | 'parry' | 'guardBreak' | 'dizzy' | 'ko' | 'finisher' | 'finished' | 'win' | 'lose';

export type Outcome = 'hit' | 'counter' | 'block' | 'parry' | 'break' | 'throw' | 'tech' | 'breaker' | 'slam';

/** What the match hears about: effects, sound, rumble, the HUD. */
export interface FightEvents {
  contact(att: Fighter, def: Fighter, mv: Move | null, out: Outcome, at: THREE.Vector3, dmg: number): void;
  whiff(f: Fighter, mv: Move): void;
  step(f: Fighter, power: number): void;
  /** landing on the ground hard (a knockdown, a throw, a fall out of a juggle) */
  fall(f: Fighter, power: number): void;
}

export class Fighter {
  readonly batch: FigureBatch;
  anim = new Animator();
  motion = newMotion();
  rig = newRig();
  private parts: Set<PartKey>;
  private root = new THREE.Matrix4();

  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  /** the street's height under the fight */
  ground = 0;

  hp = MAX_HP;
  guard = 100;
  meter = 0;
  wins = 0;

  state: FState = 'idle';
  /** frames in this state */
  f = 0;
  /** frames the state lasts (stun, dodge, down) */
  len = 0;
  move: Move | null = null;
  /** this attack is EX (a bar of meter: harder, and it glows) */
  ex = false;
  /** the current attack has hit (or been blocked): cancels open */
  contact = false;
  hitDone = false;
  private airAttack = false;
  private sideSign = 1;
  juggles = 0;
  /** hits taken in the current combo, and what it's done */
  combo = 0;
  comboDmg = 0;
  /** frames since block was pressed (a fresh block is a parry) */
  private blockAge = 99;
  private blockHeld = false;
  private guardIdle = 0;
  private buf: { p: Press; dir: Dir; t: number } | null = null;
  private thrower: Fighter | null = null;
  private throwDir = new THREE.Vector2();
  opp!: Fighter;
  /** the finisher's hits, as its animation reaches them */
  onClipEvent: ((name: string) => void) | null = null;
  stats = { hits: 0, maxCombo: 0, parries: 0, dmg: 0, blocked: 0 };

  constructor(public name: string, public body: Body, public outfit: Outfit, public side: 0 | 1) {
    this.batch = new FigureBatch(1);
    this.batch.dress(0, outfit, side ? 0xff9a7a : 0x9fc4ff, body);
    this.parts = visibleParts(outfit, 0);
    this.motion.stride = 0.9;
    this.motion.armSwing = 0.2;
  }

  wear(o: Outfit, b: Body) {
    this.outfit = o;
    this.body = b;
    this.parts = visibleParts(o, 0);
    this.batch.dress(0, o, this.side ? 0xff9a7a : 0x9fc4ff, b);
  }

  /** A new round: full health, in the stance, facing the other. */
  reset(x: number, z: number, ground: number) {
    this.pos.set(x, ground, z);
    this.ground = ground;
    this.vel.set(0, 0, 0);
    this.hp = MAX_HP;
    this.guard = 100;
    this.combo = this.comboDmg = this.juggles = 0;
    this.buf = null;
    this.move = null;
    this.thrower = null;
    this.anim.clear();
    this.stance(0.001);
    this.set('idle');
  }

  private stance(fade = 0.2) {
    this.anim.play('f.stance', { group: 'stanceU', mask: 'upper', loop: true, fadeIn: fade, at: this.side * 0.7 });
    this.anim.play('f.stance', { group: 'stanceL', mask: 'legs', loop: true, fadeIn: fade, at: this.side * 0.7 });
  }

  private set(s: FState, len = 0) {
    this.state = s;
    this.f = 0;
    this.len = len;
  }

  get airborne() {
    return this.pos.y > this.ground + 0.02;
  }

  /** direction to the other fighter (unit, on the ground) */
  private toOpp(out = _u) {
    out.set(this.opp.pos.x - this.pos.x, this.opp.pos.z - this.pos.z);
    const l = out.length();
    return l > 1e-4 ? out.multiplyScalar(1 / l) : out.set(Math.sin(this.yaw), Math.cos(this.yaw));
  }

  distance() {
    return Math.hypot(this.opp.pos.x - this.pos.x, this.opp.pos.z - this.pos.z);
  }

  /** Can this one be put into a KO or a finisher (standing, not already falling)? */
  get stunnable() {
    return !['juggle', 'down', 'getup', 'thrown', 'ko', 'finished'].includes(this.state);
  }

  /* ─────────────────────────── input ─────────────────────────── */

  /** Read a frame of intent into the buffer (also during hitstop, so a combo's next press isn't lost). */
  feed(i: Intent) {
    const press: Press | null = i.special ? 'special' : i.grab ? 'grab' : i.heavy ? 'heavy' : i.light ? 'light' : i.dodge ? 'dodge' : i.jump ? 'jump' : null;
    if (press) this.buf = { p: press, dir: this.dirOf(i), t: 9 };
    if (i.block && !this.blockHeld) this.blockAge = 0;
    this.blockHeld = i.block;
  }

  private dirOf(i: Intent): Dir {
    if (i.sy > 0.55) return 'up';
    if (i.sy < -0.55) return 'down';
    const u = this.toOpp();
    const along = i.wx * u.x + i.wz * u.y;
    return along > 0.45 ? 'fwd' : along < -0.45 ? 'back' : 'n';
  }

  /* ─────────────────────────── a step ─────────────────────────── */

  step(i: Intent, ev: FightEvents) {
    if (this.buf && --this.buf.t <= 0) this.buf = null;
    this.blockAge++;
    const u = this.toOpp(_u2);
    const busyGuard = this.state === 'block' || this.state === 'blockstun';
    if (busyGuard) this.guardIdle = 0;
    else if (++this.guardIdle > 60) this.guard = Math.min(100, this.guard + 0.4);

    switch (this.state) {
      case 'idle': {
        if (this.act(i, ev)) break;
        if (i.block) {
          this.set('block');
          this.anim.play('f.block', { group: 'guard', fadeIn: 0.06, loop: true });
          break;
        }
        // walk: forward a little quicker than back; circle slowly across the line
        const along = i.wx * u.x + i.wz * u.y;
        const across = i.wx * -u.y + i.wz * u.x;
        const va = along * (along > 0 ? 2.3 : 1.9);
        const vc = across * 1.25;
        const tx = u.x * va - u.y * vc, tz = u.y * va + u.x * vc;
        const k = Math.min(1, DT * 16);
        this.vel.x += (tx - this.vel.x) * k;
        this.vel.z += (tz - this.vel.z) * k;
        this.face(u, 16);
        break;
      }
      case 'block':
        if (!i.block) {
          this.anim.stop('guard', 0.1);
          this.set('idle');
          break;
        }
        if (this.act(i, ev, true)) {
          this.anim.stop('guard', 0.05);
          break;
        }
        this.friction(14);
        this.face(u, 16);
        break;
      case 'attack':
        this.attackStep(i, ev, u);
        break;
      case 'air':
        if (this.buf && (this.buf.p === 'light' || this.buf.p === 'heavy') && !this.airAttack) this.act(i, ev);
        this.fly(ev);
        break;
      case 'land':
      case 'blockstun':
      case 'parry':
      case 'guardBreak':
        this.friction(9);
        if (this.state === 'parry' && this.f > 8 && this.act(i, ev)) break;
        if (this.f >= this.len) this.recover(i);
        break;
      case 'hitstun':
        this.friction(8);
        if (this.breaker(i, ev)) break;
        if (this.f >= this.len) this.recover(i);
        break;
      case 'juggle':
        if (this.breaker(i, ev)) break;
        this.fly(ev);
        break;
      case 'down':
        this.friction(6);
        if (this.hp <= 0) break; // out: they stay down
        if (i.any && this.f > 12) this.len = Math.min(this.len, this.f + 4);
        if (this.f >= this.len) {
          this.set('getup', 34);
          this.anim.play('f.getup', { group: 'act', fadeIn: 0.05, stay: true, speed: 50 / 34 });
          this.combo = this.comboDmg = this.juggles = 0;
        }
        break;
      case 'getup':
        if (this.f >= this.len) {
          this.anim.stop('act', 0.12);
          this.set('idle');
        }
        break;
      case 'dodge':
        this.friction(this.len > 20 ? 12 : 16);
        if (this.f > 15 && this.act(i, ev)) break;
        if (this.f >= this.len) this.set('idle');
        break;
      case 'throw':
        this.throwStep(ev);
        break;
      case 'thrown':
        break; // the thrower moves us
      case 'dizzy':
      case 'ko':
      case 'finished':
      case 'lose':
        this.friction(6);
        if (this.airborne || this.pos.y < this.ground) this.fly(ev);
        break;
      default:
        this.friction(10);
    }

    // move
    if (this.state !== 'thrown') {
      this.pos.x += this.vel.x * DT;
      this.pos.z += this.vel.z * DT;
    }
    this.f++;
  }

  private face(u: THREE.Vector2, rate: number) {
    const want = Math.atan2(u.x, u.y);
    this.yaw += wrap(want - this.yaw) * Math.min(1, DT * rate);
  }

  private friction(k: number) {
    const d = Math.max(0, 1 - DT * k);
    this.vel.x *= d;
    this.vel.z *= d;
  }

  /** Back to neutral after stun; a block held carries straight into blocking. */
  private recover(i: Intent) {
    this.anim.stop('act', 0.12);
    if (this.airborne) return this.set('air');
    this.combo = this.comboDmg = this.juggles = 0;
    if (i.block) {
      this.set('block');
      this.anim.play('f.block', { group: 'guard', fadeIn: 0.05, loop: true });
    } else {
      this.anim.stop('guard', 0.1);
      this.set('idle');
    }
  }

  /** Spend a buffered press, if there's one this state allows. */
  private act(i: Intent, ev: FightEvents, fromBlock = false): boolean {
    const b = this.buf;
    if (!b) return false;
    const air = this.airborne;
    if (air) {
      if (this.airAttack) return false;
      if (b.p === 'light' || b.p === 'heavy') {
        this.buf = null;
        this.airAttack = true;
        this.startMove(b.p === 'light' ? MOVES.airPunch : MOVES.airKick, ev);
        return true;
      }
      return false;
    }
    this.buf = null;
    switch (b.p) {
      case 'light':
        this.startMove(MOVES.jab, ev);
        return true;
      case 'heavy':
        this.startMove(b.dir === 'up' ? MOVES.launcher : b.dir === 'down' ? MOVES.sweep : b.dir === 'fwd' ? MOVES.roundhouse : MOVES.heavy, ev);
        return true;
      case 'special':
        this.startMove(MOVES.special, ev);
        return true;
      case 'grab':
        this.startMove(MOVES.grab, ev);
        return true;
      case 'dodge':
        this.dodge(b.dir, i);
        return true;
      case 'jump':
        if (fromBlock) this.anim.stop('guard', 0.05);
        this.jump(b.dir);
        return true;
    }
    return false;
  }

  private startMove(mv: Move, ev: FightEvents) {
    this.anim.stop('guard', 0.05);
    this.move = mv;
    this.contact = false;
    this.hitDone = false;
    // a special with a bar of meter behind it
    this.ex = mv.id === 'special' && this.meter >= 100;
    if (this.ex) this.meter -= 100;
    this.set('attack', mv.startup + mv.active + mv.recovery);
    // aim at them now; after this the attack goes where it was aimed (that's what a sidestep beats)
    this.face(this.toOpp(), 1e3);
    this.anim.play(mv.clip, { group: 'act', fadeIn: 0.035, fadeOut: 0.12 });
    void ev;
  }

  private attackStep(i: Intent, ev: FightEvents, u: THREE.Vector2) {
    const mv = this.move!;
    // step in over the startup
    if (this.f < mv.startup && mv.lunge) {
      const s = mv.lunge / mv.startup / DT;
      this.vel.x = Math.sin(this.yaw) * s;
      this.vel.z = Math.cos(this.yaw) * s;
    } else if (!mv.air) this.friction(14);
    if (mv.air || this.airborne) this.fly(ev);
    if (this.state !== 'attack') return; // landed
    if (this.f === mv.startup && !this.contact) ev.whiff(this, mv);

    // cancels: on contact into the move's follow-ups; the light string also chains on a whiff
    const end = mv.startup + mv.active;
    const b = this.buf;
    if (b && this.f >= mv.startup && this.f <= end + 8) {
      let next: Move | null = null;
      if (b.p === 'light') next = mv.id === 'jab' ? MOVES.cross : mv.id === 'cross' ? MOVES.hook : mv.id === 'airPunch' ? MOVES.airKick : null;
      else if (b.p === 'heavy' && !mv.air) next = b.dir === 'up' ? MOVES.launcher : b.dir === 'down' ? MOVES.sweep : b.dir === 'fwd' ? MOVES.roundhouse : MOVES.heavy;
      else if (b.p === 'heavy' && mv.air) next = MOVES.airKick;
      else if (b.p === 'special') next = MOVES.special;
      const chain = b.p === 'light' && next && this.f >= end;
      if (next && mv.cancel.includes(next.id) && (this.contact || chain)) {
        this.buf = null;
        this.startMove(next, ev);
        return;
      }
      // a launcher that landed: jump after them
      if (b.p === 'jump' && mv.id === 'launcher' && this.contact) {
        this.buf = null;
        this.anim.stop('act', 0.08);
        this.jump('fwd');
        return;
      }
    }
    if (this.f >= this.len) {
      this.move = null;
      if (this.airborne) this.set('air');
      else this.recover(i);
    }
    void u;
  }

  private dodge(dir: Dir, i: Intent) {
    const u = this.toOpp();
    this.anim.stop('guard', 0.05);
    if (dir === 'back') {
      this.set('dodge', 22);
      this.vel.set(-u.x * 5.6, 0, -u.y * 5.6);
      this.anim.play('f.dodgeBack', { group: 'act', fadeIn: 0.04, fadeOut: 0.1 });
    } else if (dir === 'fwd') {
      this.set('dodge', 16);
      this.vel.set(u.x * 5.2, 0, u.y * 5.2);
    } else {
      // across the line: the way the stick leans, or the other way from last time
      const across = i.wx * -u.y + i.wz * u.x;
      const s = Math.abs(across) > 0.3 ? Math.sign(across) : (this.sideSign = -this.sideSign);
      this.set('dodge', 24);
      this.vel.set(-u.y * s * 4.6, 0, u.x * s * 4.6);
      this.anim.play('f.dodgeSide', { group: 'act', fadeIn: 0.04, fadeOut: 0.1, mirror: s > 0 });
    }
  }

  private jump(dir: Dir) {
    const u = this.toOpp();
    const h = dir === 'fwd' ? 2.6 : dir === 'back' ? -2.2 : 0;
    this.vel.set(u.x * h, 7.4, u.y * h);
    this.pos.y += 0.03;
    this.airAttack = false;
    this.set('air');
  }

  /** In the air: gravity, and what happens on landing. */
  private fly(ev: FightEvents) {
    this.vel.y -= GRAVITY * DT;
    this.pos.y += this.vel.y * DT;
    if (this.pos.y > this.ground) return;
    this.pos.y = this.ground;
    const fall = -this.vel.y;
    this.vel.y = 0;
    switch (this.state) {
      case 'juggle':
        // out of a juggle or a knockdown: flat on the ground
        this.set('down', 34);
        this.anim.play('f.knockdown', { group: 'act', fadeIn: 0.06, at: 18 / 60, stay: true });
        ev.fall(this, Math.min(1, fall / 8));
        this.friction(30);
        break;
      case 'attack':
      case 'air':
        this.move = null;
        this.anim.stop('act', 0.08);
        this.set('land', this.state === 'attack' ? 7 : 4);
        ev.step(this, 0.9);
        break;
      default:
        ev.fall(this, Math.min(1, fall / 8));
    }
  }

  /** In a combo with a bar of meter: dodge breaks out and shoves them off. */
  private breaker(i: Intent, ev: FightEvents): boolean {
    if (!i.dodge || this.combo < 2 || this.meter < 100) return false;
    this.meter -= 100;
    this.buf = null;
    const u = this.toOpp();
    this.anim.play('f.dodgeBack', { group: 'act', fadeIn: 0.03, fadeOut: 0.1 });
    this.pos.y = Math.max(this.pos.y, this.ground);
    this.vel.set(-u.x * 3, 0, -u.y * 3);
    this.set('dodge', 22);
    this.combo = this.comboDmg = this.juggles = 0;
    const o = this.opp;
    o.move = null;
    o.set('guardBreak', 30);
    o.vel.set(u.x * 4.5, 0, u.y * 4.5);
    o.anim.play('f.guardBreak', { group: 'act', fadeIn: 0.03, fadeOut: 0.15, speed: 1.3 });
    ev.contact(this, o, null, 'breaker', _p.copy(this.pos).lerp(o.pos, 0.5).setY(this.ground + 1.2), 0);
    return true;
  }

  /* ─────────────────────────── contact ─────────────────────────── */

  /** Is an attack of ours live this frame? */
  get live() {
    const mv = this.move;
    return this.state === 'attack' && !!mv && !this.hitDone && this.f >= mv.startup && this.f < mv.startup + mv.active;
  }

  /** Would this attack miss them however it lands (a sidestep under a narrow one, getting up)? */
  private dodges(mv: Move) {
    switch (this.state) {
      case 'getup':
      case 'down':
      case 'thrown':
      case 'throw':
      case 'ko':
      case 'finished':
      case 'finisher':
      case 'intro':
      case 'win':
      case 'lose':
        return true;
      case 'dodge':
        // a sidestep beats anything that doesn't sweep wide; a backstep is only out of reach briefly
        return this.len === 24 ? this.f >= 2 && this.f <= 16 && mv.arc < 1.0 : this.len === 22 && this.f <= 10;
    }
    return false;
  }

  /**
   * The attacker's live frame: did it connect? Checks reach, the arc it was
   * aimed in, height, and whether they're somewhere a hit can't reach.
   */
  strike(ev: FightEvents) {
    if (!this.live) return;
    const mv = this.move!;
    const d = this.opp;
    const dist = this.distance();
    if (dist > mv.reach) return;
    const ang = Math.abs(wrap(Math.atan2(d.pos.x - this.pos.x, d.pos.z - this.pos.z) - this.yaw));
    if (ang > mv.arc) return;
    const h = d.pos.y - d.ground;
    if (mv.id === 'sweep' && h > 0.3) return;
    if (!mv.air && h > 1.7) return;
    if (mv.air && this.pos.y - d.pos.y > 2.2) return;
    if (d.dodges(mv)) return;
    this.hitDone = true;
    if (mv.id === 'grab') return this.grab(ev);
    d.receive(this, mv, ev);
  }

  private grab(ev: FightEvents) {
    const d = this.opp;
    const at = _p.copy(this.pos).lerp(d.pos, 0.5).setY(this.ground + 1.2);
    if (d.airborne || ['hitstun', 'blockstun', 'juggle', 'down', 'getup', 'guardBreak', 'dizzy'].includes(d.state)) return;
    // both grabbed at once: they break apart
    if (d.state === 'attack' && d.move?.id === 'grab' && d.f <= d.move.startup + d.move.active) {
      for (const [f, s] of [[this, -1], [d, 1]] as const) {
        const u = this.toOpp();
        f.move = null;
        f.anim.stop('act', 0.06);
        f.set('blockstun', 16);
        f.vel.set(u.x * 3.2 * s, 0, u.y * 3.2 * s);
      }
      d.hitDone = true;
      ev.contact(this, d, MOVES.grab, 'tech', at, 0);
      return;
    }
    this.contact = true;
    this.set('throw', THROW_FRAMES);
    this.anim.stop('guard', 0.05);
    this.anim.play('f.throw', { group: 'act', fadeIn: 0.04, stay: true });
    const u = this.toOpp();
    this.throwDir.set(u.x, u.y);
    d.thrower = this;
    d.move = null;
    d.anim.stop('guard', 0.05);
    d.set('thrown', THROW_FRAMES);
    d.yaw = Math.atan2(-u.x, -u.y);
    d.vel.set(0, 0, 0);
    d.anim.play('f.thrown', { group: 'act', fadeIn: 0.04, stay: true });
    ev.contact(this, d, MOVES.grab, 'throw', at, 0);
  }

  private throwStep(ev: FightEvents) {
    const d = this.opp;
    const dir = this.throwDir;
    this.friction(20);
    // carry them round: in front, swung past the hip, down behind
    const s = Math.min(1, Math.max(0, (this.f - 12) / (THROW_SLAM - 12)));
    const along = this.f < 12 ? 0.72 : THREE.MathUtils.lerp(0.72, -1.15, s * s * (3 - 2 * s));
    const across = Math.sin(s * Math.PI) * 0.75;
    if (d.state === 'thrown' && d.thrower === this) {
      d.pos.set(this.pos.x + dir.x * along - dir.y * across, d.ground, this.pos.z + dir.y * along + dir.x * across);
      d.f = this.f;
    }
    if (this.f === THROW_SLAM) {
      const mv = MOVES.grab;
      const dmg = Math.round(mv.dmg * this.scaling(d));
      d.damage(dmg, this);
      this.gain(14);
      d.gain(8);
      this.stats.hits++;
      ev.contact(this, d, mv, 'slam', _p.copy(d.pos).setY(d.ground + 0.3), dmg);
      ev.fall(d, 1);
    }
    if (this.f >= this.len) {
      // they're behind us now: turn to them (the throw's own turn hands straight over)
      this.anim.clear();
      this.stance(0.001);
      this.set('idle');
      this.face(this.toOpp(), 1e3);
      if (d.thrower === this) {
        d.thrower = null;
        d.anim.clear();
        d.stance(0.001);
        d.face(d.toOpp(), 1e3);
        d.anim.play('f.knockdown', { group: 'act', fadeIn: 0.001, at: 40 / 60, stay: true });
        d.set('down', 26);
        d.vel.set(0, 0, 0);
      }
    }
  }

  /** Damage keeps landing in a long combo, but less of it. */
  private scaling(d: Fighter) {
    return Math.max(0.35, 1 - d.combo * 0.12);
  }

  private gain(n: number) {
    this.meter = Math.min(MAX_METER, this.meter + n);
  }

  private damage(n: number, by: Fighter, chip = false) {
    this.hp = Math.max(chip ? Math.min(this.hp, 1) : 0, this.hp - n);
    by.stats.dmg += n;
  }

  /** We've been reached by an attack: block it, parry it, or take it. */
  private receive(a: Fighter, mv: Move, ev: FightEvents) {
    const u = a.toOpp(_u3); // from them to us
    const at = this.impactPoint(a, mv);
    const facing = Math.abs(wrap(Math.atan2(-u.x, -u.y) - this.yaw)) < 1.9;
    const guarding = (this.state === 'block' || this.state === 'blockstun') && facing && !this.airborne;
    a.contact = true;
    if (guarding) {
      if (this.state === 'block' && this.blockAge <= PARRY_WINDOW) {
        // a parry: their attack is turned aside and they're left open
        this.set('parry', 14);
        this.anim.stop('guard', 0.04);
        this.anim.play('f.parry', { group: 'act', fadeIn: 0.02, fadeOut: 0.12 });
        a.move = null;
        a.set('hitstun', 28);
        a.anim.play('f.guardBreak', { group: 'act', fadeIn: 0.03, fadeOut: 0.15, speed: 1.4 });
        a.vel.set(u.x * -1.2, 0, u.y * -1.2);
        this.gain(24);
        this.stats.parries++;
        ev.contact(a, this, mv, 'parry', at, 0);
        return;
      }
      const chip = Math.round(mv.chip * (a.ex ? 1.5 : 1));
      this.damage(chip, a, true);
      this.guard -= mv.guard * (a.ex ? 1.5 : 1);
      this.vel.set(u.x * mv.push * 0.7, 0, u.y * mv.push * 0.7);
      a.gain(5);
      this.gain(4);
      this.stats.blocked++;
      if (this.guard <= 0) {
        this.guard = 55;
        this.set('guardBreak', 40);
        this.anim.stop('guard', 0.03);
        this.anim.play('f.guardBreak', { group: 'act', fadeIn: 0.02, fadeOut: 0.15 });
        ev.contact(a, this, mv, 'break', at, chip);
        return;
      }
      this.set('blockstun', mv.blockstun);
      this.anim.play('f.blockHit', { group: 'blockHit', fadeIn: 0.01, fadeOut: 0.1 });
      ev.contact(a, this, mv, 'block', at, chip);
      return;
    }

    const counter = this.state === 'attack' && !!this.move && this.f < this.move.startup;
    const dmg = Math.round(mv.dmg * this.scaling(this) * (counter ? 1.2 : 1) * (a.ex ? 1.4 : 1));
    this.damage(dmg, a);
    this.combo++;
    this.comboDmg += dmg;
    a.stats.hits++;
    a.stats.maxCombo = Math.max(a.stats.maxCombo, this.combo);
    a.gain(Math.round(8 * (mv.dmg / 50)));
    this.gain(6);
    this.move = null;
    this.anim.stop('guard', 0.03);
    const push = mv.push * (a.ex ? 1.3 : 1);
    const inAir = this.airborne || this.state === 'juggle';
    if (inAir) {
      // kept up in the air: each hit pops them a little less
      this.juggles++;
      this.set('juggle');
      this.vel.set(u.x * push * 0.6, this.juggles > MAX_JUGGLE ? 0 : Math.max(2.4, (mv.launch ?? 5.4) - this.juggles * 0.9), u.y * push * 0.6);
      if (mv.effect !== 'stun') this.vel.y = Math.max(this.vel.y, 3.5);
      this.anim.play('f.launched', { group: 'act', fadeIn: 0.03, at: 6 / 60, stay: true });
    } else if (mv.effect === 'launch') {
      this.juggles = 1;
      this.set('juggle');
      this.pos.y += 0.05;
      this.vel.set(u.x * push, mv.launch!, u.y * push);
      this.anim.play('f.launched', { group: 'act', fadeIn: 0.03, stay: true });
    } else if (mv.effect === 'knockdown') {
      this.set('juggle');
      this.pos.y += 0.05;
      this.vel.set(u.x * push, mv.id === 'sweep' ? 3.2 : 4.4, u.y * push);
      this.anim.play(mv.id === 'sweep' ? 'f.launched' : 'f.knockdown', { group: 'act', fadeIn: 0.03, stay: true, speed: mv.id === 'sweep' ? 1.6 : 1 });
    } else {
      this.set('hitstun', mv.hitstun + (counter ? 5 : 0));
      this.vel.set(u.x * push, 0, u.y * push);
      this.anim.play(mv.react, { group: 'act', fadeIn: 0.02, fadeOut: 0.12 });
    }
    ev.contact(a, this, mv, counter ? 'counter' : 'hit', at, dmg);
  }

  /** Where the blow lands: the striking hand or foot, pulled onto their body. */
  private impactPoint(a: Fighter, mv: Move) {
    const limb = mv.id === 'jab' || mv.id === 'hook' ? a.rig.handL : mv.id === 'roundhouse' || mv.id === 'airKick' || mv.id === 'sweep' ? a.rig.footR : a.rig.handR;
    _p.setFromMatrixPosition(limb);
    const y = mv.id === 'sweep' ? 0.25 : mv.id === 'cross' || mv.id === 'launcher' ? 1.25 : 1.5;
    const c = _q.set(this.pos.x, this.pos.y + y * this.body.height, this.pos.z);
    if (!Number.isFinite(_p.x) || _p.distanceTo(c) > 1.2) _p.copy(c);
    return _p.lerp(c, 0.45);
  }

  /* ─────────────────────────── the end of a round ─────────────────────────── */

  /** Out on their feet: the last round's KO waits for a finisher. */
  daze() {
    this.move = null;
    this.anim.clear();
    this.stance(0.001);
    this.set('dizzy');
    this.vel.set(0, this.vel.y, 0);
    this.anim.play('f.dizzy', { group: 'act', fadeIn: 0.15, loop: true });
  }

  knockOut() {
    this.move = null;
    this.set('ko');
    this.anim.play('f.ko', { group: 'act', fadeIn: 0.05, stay: true });
  }

  win() {
    this.move = null;
    this.set('win');
    this.vel.set(0, 0, 0);
    this.anim.stop('guard', 0.1);
    this.anim.play(Math.random() < 0.5 ? 'f.victory' : 'f.victory2', { group: 'act', fadeIn: 0.3, stay: true });
  }

  lose() {
    this.move = null;
    this.set('lose');
    this.anim.stop('guard', 0.1);
    this.anim.play('f.defeat', { group: 'act', fadeIn: 0.3, stay: true });
  }

  intro() {
    this.set('intro');
    this.anim.play('f.intro', { group: 'act', fadeIn: 0.001, fadeOut: 0.3 });
  }

  endIntro() {
    if (this.state === 'intro') this.set('idle');
  }

  /** The finisher: three blows, each one landing as the animation reaches it. */
  finish(onHit: (n: number) => void) {
    const d = this.opp;
    this.move = null;
    this.set('finisher');
    this.face(this.toOpp(), 1e3);
    let n = 0;
    this.anim.stop('guard', 0.05);
    this.anim.play('f.finisher', {
      group: 'act',
      fadeIn: 0.08,
      stay: true,
      onEvent: (e) => {
        if (e.startsWith('hit')) onHit(n++);
      },
    });
    d.set('finished');
    d.anim.clear();
    d.stance(0.001);
    d.anim.play('f.dizzy', { group: 'act', fadeIn: 0.001, loop: true });
  }

  /** A blow of the finisher landing on this one. */
  takeFinisher(n: number, from: Fighter) {
    const u = from.toOpp(_u3);
    if (n < 2) {
      this.anim.play(n === 0 ? 'f.hitBody' : 'f.hitHeavy', { group: 'act2', fadeIn: 0.02, fadeOut: 0.2 });
      this.vel.set(u.x * 1.2, 0, u.y * 1.2);
    } else {
      this.anim.stop('act', 0.02);
      this.anim.stop('act2', 0.02);
      this.set('ko');
      this.pos.y += 0.05;
      this.vel.set(u.x * 6, 5.2, u.y * 6);
      this.anim.play('f.ko', { group: 'act3', fadeIn: 0.02, stay: true, at: 8 / 60 });
    }
  }

  /* ─────────────────────────── drawing ─────────────────────────── */

  /** The animation's own clock: advanced once per fixed step (never during hitstop). */
  tick() {
    this.anim.update(DT);
  }

  /** Pose and draw; `frozen` is hitstop (the body holds exactly where it was). */
  draw(dt: number, t: number, frozen: boolean, ev: FightEvents | null) {
    const m = this.motion;
    const walking = this.state === 'idle' || this.state === 'dodge';
    const hs = Math.hypot(this.vel.x, this.vel.z);
    m.speed = walking ? hs : 0;
    m.moveDir = hs > 0.2 ? wrap(Math.atan2(this.vel.x, this.vel.z) - this.yaw) : m.moveDir * 0.9;
    m.air += ((this.state === 'air' || (this.state === 'attack' && this.airborne) ? 1 : 0) - m.air) * Math.min(1, dt * 12);
    m.armL = m.armR = 'free';
    m.weight = Math.sin(t * 0.8 + this.side);
    if (!frozen && stepPhase(m, dt) && walking && !this.airborne) ev?.step(this, 0.45);
    // the legs' stance gives way to walking as they move
    const legs = this.anim.layer('stanceL');
    if (legs) legs.max = 1 - Math.min(1, m.speed / 1.4);
    this.root.compose(this.pos, _qq.setFromAxisAngle(_up, this.yaw), _one.setScalar(this.body.height));
    solve(this.rig, this.root, this.body, this.outfit, m, t, this.anim);
    this.batch.write(0, this.rig, this.parts, this.ex && this.state === 'attack');
    this.batch.flush();
  }
}

const _u = new THREE.Vector2();
const _u2 = new THREE.Vector2();
const _u3 = new THREE.Vector2();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _qq = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _one = new THREE.Vector3(1, 1, 1);

export function wrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
