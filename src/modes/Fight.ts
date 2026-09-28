import * as THREE from 'three';
import { Fighter, idleIntent, MAX_HP, type FightEvents, type Intent, type Outcome } from './fight/Fighter';
import { FightAI, LEVEL_NAMES, type Level } from './fight/FightAI';
import type { Move } from './fight/moves';
import { FightFx } from '../fx/FightFx';
import { FightHud } from '../ui/FightHud';
import { FigureBatch } from '../entities/FigureBatch';
import { newMotion, newRig, solve, stepPhase, visibleParts, type Body, type Motion, type Outfit, type PartKey, type Rig } from '../entities/Humanoid';
import { Animator } from '../anim/Animator';
import '../anim/clips';
import { makePerson, weighted, type ArchetypeId, type Person } from '../data/people';
import { mulberry32 } from '../world/rng';
import type { AudioEngine } from '../audio/AudioEngine';
import type { Controls, Input } from '../core/Input';
import type { Pad } from '../input/Gamepads';
import type { Traffic } from '../entities/Traffic';
import type { Collision } from '../world/Collision';
import type { HapticEvent } from '../input/Haptics';

/**
 * FIGHT: best of three, one on one, in the middle of the crossing where
 * Harbor Lane meets Central Avenue. The city is still there: the cars are
 * held at the lights with their drivers watching, a ring of people has
 * stopped on the way home, the rain keeps falling.
 *
 * This is the match layer. It owns time (a fixed 60 steps a second, hitstop,
 * the slow motion on a KO), the camera, the rounds and the crowd; the
 * fighters own their own bodies (fight/Fighter.ts).
 */

/** the middle of the crossing, and how far from it you can go */
export const ARENA = { x: 0, z: 54, r: 6.2 };
const ROUND_TIME = 60;
const STEP = 1 / 60;
const WINS = 2;

type Phase = 'idle' | 'intro' | 'call' | 'fight' | 'ko' | 'finish' | 'finisher' | 'after' | 'over';

interface Watcher {
  p: Person;
  motion: Motion;
  rig: Rig;
  anim: Animator;
  pos: THREE.Vector3;
  yaw: number;
  parts: Set<PartKey>;
  /** seconds until they do something (shift, cross arms, clap) */
  next: number;
  excite: number;
}

export interface FightHost {
  audio: AudioEngine;
  input: Input;
  traffic: Traffic;
  collision: Collision;
  ui: HTMLElement;
  /** the match menu's two ways out */
  onModes(): void;
  onLeave(): void;
}

/** the cars stopped at the lights, one per approach */
const HELD = [
  { x: -15.5, z: 55.5, yaw: Math.PI / 2 },
  { x: 15.5, z: 52.5, yaw: -Math.PI / 2 },
  { x: -4.5, z: 70, yaw: Math.PI },
  { x: 4.5, z: 38, yaw: 0 },
];

export class Fight {
  group = new THREE.Group();
  active = false;
  fighters: [Fighter, Fighter];
  hud: FightHud;
  private ai = new FightAI('normal');
  private p1Pad: Pad | null = null;
  private p2Pad: Pad | null = null;
  private joinT = 0;
  /** how long the controls strip has been up (it steps aside once you're fighting) */
  private hintT = 0;
  private fx = new FightFx();
  private phase: Phase = 'idle';
  private phaseT = 0;
  private round = 1;
  private clock = ROUND_TIME;
  private acc = 0;
  private hitstop = 0;
  private slow = 1;
  private shake = 0;
  private ground = 0;
  private winner: Fighter | null = null;
  private called = 0;
  private cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), side: 1, ready: false };
  private watchers: Watcher[] = [];
  private crowdBatch: FigureBatch;
  private rng = mulberry32(9091);
  private events: FightEvents;
  private intents: [Intent, Intent] = [idleIntent(), idleIntent()];
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  /** a key light over the fight (the App's always-present fitting light, lent to us) */
  light: THREE.PointLight | null = null;

  constructor(private host: FightHost) {
    const r = mulberry32(4242);
    const you = makePerson(r, 'fighter');
    const them = makePerson(r, 'fighter');
    this.fighters = [new Fighter('You', you.body, you.outfit, 0), new Fighter('CPU', them.body, them.outfit, 1)];
    this.fighters[0].opp = this.fighters[1];
    this.fighters[1].opp = this.fighters[0];
    for (const f of this.fighters) this.group.add(f.batch.group);
    this.group.add(this.fx.group);
    this.crowdBatch = new FigureBatch(18, { shadows: false });
    this.group.add(this.crowdBatch.group);
    this.group.visible = false;
    this.hud = new FightHud(host.ui, {
      rematch: () => this.rematch(),
      level: () => this.cycleLevel(),
      modes: () => host.onModes(),
      leave: () => host.onLeave(),
    });
    this.hud.level(LEVEL_NAMES[this.ai.level]);
    this.events = {
      contact: (a, d, mv, out, at, dmg) => this.contact(a, d, mv, out, at, dmg),
      whiff: (f, mv) => host.audio.fight('swing', mv.dmg / 80),
      step: (f, p) => host.audio.footstep(p * 0.6, false),
      fall: (f, p) => this.fall(f, p),
    };
  }

  /* ─────────────────────────── the match ─────────────────────────── */

  /** Into the crossing: you (as you look in the city) against a stranger. */
  start(you: { outfit: Outfit; body: Body; name?: string }) {
    this.active = true;
    this.group.visible = true;
    this.ground = this.host.collision.groundAt(ARENA.x, ARENA.z, 2, 3, 0.3);
    this.fighters[0].wear(you.outfit, you.body);
    this.opponent();
    this.buildCrowd();
    this.host.traffic.hold(HELD, new THREE.Vector3(ARENA.x, 1, ARENA.z));
    this.p1Pad = this.host.input.isPad ? this.host.input.pad : null;
    this.hintT = 0;
    this.hud.show(true);
    this.hud.showHints(true);
    this.startMatch();
    this.host.audio.crowd(0.6);
  }

  stop() {
    this.active = false;
    this.group.visible = false;
    this.phase = 'idle';
    this.hud.show(false);
    this.host.traffic.hold(null);
    this.host.input.reservedPad = null;
    this.p2Pad = null;
    this.fx.clear();
    this.host.audio.crowd(0);
    if (this.light) this.light.intensity = 0;
  }

  /** A new stranger to fight: someone who looks like they've done this before. */
  private opponent() {
    const r = mulberry32((Math.random() * 1e9) | 0);
    const p = makePerson(r, weighted<ArchetypeId>(r, [['fighter', 5], ['worker', 1], ['crook', 1.5], ['courier', 1]]));
    p.outfit.umbrella = false;
    p.outfit.bag = false;
    p.outfit.backpack = null;
    p.outfit.scarf = false;
    if (p.outfit.hat === 'hood' || p.outfit.hat === 'trilby') p.outfit.hat = 'none';
    this.fighters[1].wear(p.outfit, p.body);
    this.fighters[1].name = this.p2Pad ? 'Player 2' : ['Kade', 'Mara', 'Rook', 'Juno', 'Vic', 'Teo', 'Nell', 'Sasha'][Math.floor(r.next() * 8)];
    this.hud.names(this.fighters[0].name, this.fighters[1].name);
  }

  private startMatch() {
    this.round = 1;
    for (const f of this.fighters) {
      f.wins = 0;
      f.meter = 0;
      f.stats = { hits: 0, maxCombo: 0, parries: 0, dmg: 0, blocked: 0 };
    }
    this.hud.showEnd(null);
    this.hud.showHints(true);
    this.hintT = 0;
    this.startRound(true);
  }

  private rematch() {
    this.opponent();
    this.startMatch();
  }

  private cycleLevel() {
    const order: Level[] = ['easy', 'normal', 'hard'];
    this.ai.level = order[(order.indexOf(this.ai.level) + 1) % 3];
    this.hud.level(LEVEL_NAMES[this.ai.level]);
    this.host.audio.uiTick();
  }

  private startRound(first: boolean) {
    const [a, b] = this.fighters;
    a.reset(ARENA.x - 1.9, ARENA.z, this.ground);
    b.reset(ARENA.x + 1.9, ARENA.z, this.ground);
    a.yaw = Math.PI / 2;
    b.yaw = -Math.PI / 2;
    this.clock = ROUND_TIME;
    this.winner = null;
    this.hitstop = 0;
    this.slow = 1;
    this.acc = 0;
    this.ai.reset();
    this.called = 0;
    this.hud.prompt(false);
    this.hud.round(this.round, a.wins === WINS - 1 && b.wins === WINS - 1);
    this.hud.clock(ROUND_TIME);
    this.hud.call(null);
    this.cam.ready = false;
    if (first) {
      a.intro();
      b.intro();
      this.set('intro');
    } else this.set('call');
  }

  private set(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
  }

  get busy() {
    return this.phase === 'over';
  }

  /* ─────────────────────────── a frame ─────────────────────────── */

  /**
   * `live` is false under the pause menu and while the game fades in: the
   * fight holds still, the rain and the crowd don't.
   */
  update(dt: number, t: number, cam: THREE.PerspectiveCamera, live: boolean) {
    if (!this.active) return;
    const [a, b] = this.fighters;
    if (live) {
      this.readInputs(cam, dt);
      this.flow(dt);
      this.acc += dt * this.slow;
      let first = true;
      while (this.acc >= STEP) {
        this.acc -= STEP;
        this.fixedStep(first);
        first = false;
      }
      if (this.phase === 'fight') {
        this.clock -= dt;
        this.hud.clock(this.clock);
        if (this.clock <= 0) this.timeUp();
      }
    }
    const frozen = this.hitstop > 0;
    a.draw(dt, t, frozen || !live, this.events);
    b.draw(dt, t, frozen || !live, this.events);
    this.camera(dt, t, cam);
    this.watch(dt, t, cam);
    this.fx.update(dt * (frozen ? 0.15 : 1), cam);
    this.hud.update(dt, this.fighters);
    if (this.light) {
      // a key light over the fight, above and in front: faces and hands stay readable in the dark
      this.tmp.copy(a.pos).lerp(b.pos, 0.5);
      this.light.position.set(this.tmp.x + (cam.position.x - this.tmp.x) * 0.35, this.ground + 3.4, this.tmp.z + (cam.position.z - this.tmp.z) * 0.35);
      this.light.intensity = 16;
      this.light.distance = 11;
    }
  }

  /** One step of the fight at 60 a second. */
  private fixedStep(first: boolean) {
    const [a, b] = this.fighters;
    const ia = this.intents[0], ib = this.intents[1];
    // presses are read once a frame: only the first step of a frame sees them
    if (!first) for (const i of [ia, ib]) i.light = i.heavy = i.special = i.grab = i.dodge = i.jump = i.any = false;
    a.feed(ia);
    b.feed(ib);
    if (this.hitstop > 0) {
      this.hitstop--;
      return;
    }
    a.step(ia, this.events);
    b.step(ib, this.events);
    a.strike(this.events);
    b.strike(this.events);
    this.separate();
    a.tick();
    b.tick();
    this.checkKO();
  }

  /** Controllers (and the CPU) → this frame's intents. */
  private readInputs(cam: THREE.Camera, dt: number) {
    const input = this.host.input;
    const [a, b] = this.fighters;
    // player one's pad: the one they came in with, or the first to throw a punch (holding A is how a second player joins)
    if (!this.p1Pad) {
      const p = input.pads.pads.find((q) => q.connected && q !== this.p2Pad && (['X', 'Y', 'LB', 'RB', 'RT', 'B'] as const).some((k) => q.held(k)));
      if (p) this.p1Pad = p;
    }
    this.joining(dt);
    if (this.phase === 'fight' && (this.hintT += dt) > 14) this.hud.showHints(false);
    const fwd = cam.getWorldDirection(this.tmp);
    const l = Math.hypot(fwd.x, fwd.z) || 1;
    const fx = fwd.x / l, fz = fwd.z / l;
    const fromControls = (c: Controls, i: Intent) => {
      const m = c.move();
      i.wx = -fz * m.x + fx * m.y;
      i.wz = fx * m.x + fz * m.y;
      i.sy = m.y;
      i.light = c.pressed('light');
      i.heavy = c.pressed('heavy');
      i.special = c.pressed('special');
      i.grab = c.pressed('grab');
      i.dodge = c.pressed('dodge');
      i.jump = c.pressed('jump');
      i.block = c.held('block');
      i.any = i.light || i.heavy || i.special || i.grab || i.dodge || i.jump;
    };
    const open = this.phase === 'fight' || this.phase === 'finish';
    if (open) fromControls(input.controlsWith(this.p1Pad), this.intents[0]);
    else this.intents[0] = idleIntent();
    if (open && this.p2Pad) fromControls(input.padControls(this.p2Pad), this.intents[1]);
    else if (open) this.intents[1] = this.ai.intent(b, a);
    else this.intents[1] = idleIntent();
    // the finish: only the winner acts, and the special is the finisher
    if (this.phase === 'finish' && this.winner) {
      const w = this.winner.side;
      const iw = this.intents[w];
      const near = this.winner.distance() < 2.1;
      if (iw.special && near && this.winner.state === 'idle') this.finisher();
      iw.light = iw.heavy = iw.grab = iw.special = iw.dodge = iw.jump = iw.block = false;
      this.intents[1 - w] = idleIntent();
    }
  }

  /** Hold A on a second controller to take the other side. */
  private joining(dt: number) {
    const input = this.host.input;
    if (this.p2Pad) {
      if (!this.p2Pad.connected) {
        this.p2Pad = null;
        input.reservedPad = null;
        this.fighters[1].name = 'CPU';
        this.hud.names(this.fighters[0].name, 'CPU');
      }
      this.hud.join(null);
      return;
    }
    const others = this.phase === 'over' ? [] : input.pads.pads.filter((p) => p.connected && p !== this.p1Pad);
    this.hud.join(others.length ? 'Second controller: hold A to take the other side' : null);
    const q = others.find((p) => p.held('A'));
    this.joinT = q ? this.joinT + dt : 0;
    if (q && this.joinT > 0.8) {
      this.joinT = 0;
      this.p2Pad = q;
      input.reservedPad = q;
      this.fighters[1].name = 'Player 2';
      this.hud.names(this.fighters[0].name === 'CPU' ? 'Player 1' : this.fighters[0].name, 'Player 2');
      this.hud.tag(1, 'Joined');
      this.host.input.haptics.play(q, 'ui', 1);
    }
  }

  /** Round flow: the intro, ROUND n, FIGHT, KO, the finish, the next round. */
  private flow(dt: number) {
    this.phaseT += dt;
    const [a, b] = this.fighters;
    switch (this.phase) {
      case 'intro':
        if (this.phaseT > 2.4) {
          a.endIntro();
          b.endIntro();
          this.set('call');
        }
        break;
      case 'call': {
        const final = a.wins === WINS - 1 && b.wins === WINS - 1;
        if (this.called === 0) {
          this.called = 1;
          this.hud.call(final ? 'Final round' : `Round ${this.round}`, '', 1100);
        }
        if (this.phaseT > 1.15 && this.called === 1) {
          this.called = 2;
          this.hud.call('Fight', '', 700, 'go');
          this.host.audio.fight('bell');
          this.host.audio.crowd(0.6, 0.6);
          this.cheer(0.5);
          this.rumbleBoth('ui', 1);
        }
        if (this.phaseT > 1.5) this.set('fight');
        break;
      }
      case 'ko':
        if (this.slow < 1) this.slow = Math.min(1, this.slow + dt * 0.45);
        if (this.phaseT > 2.2 && this.winner && this.winner.state !== 'win' && !this.winner.airborne) {
          this.winner.win();
          this.cheer(1);
        }
        if (this.phaseT > 4.6) this.nextRound();
        break;
      case 'finish':
        this.hud.prompt(!!this.winner && (this.winner.side === 0 || !!this.p2Pad));
        if (this.phaseT > 6) {
          // no finisher: they go down on their own
          this.hud.prompt(false);
          this.hud.call(null);
          const l = this.winner!.opp;
          l.knockOut();
          this.host.audio.fight('ko');
          this.set('ko');
        }
        break;
      case 'finisher':
        if (this.phaseT > 3.1) {
          this.winner!.win();
          this.cheer(1);
          this.set('after');
        }
        break;
      case 'after':
        if (this.phaseT > 2.6) this.over();
        break;
    }
  }

  private nextRound() {
    const [a, b] = this.fighters;
    if (a.wins >= WINS || b.wins >= WINS) return this.over();
    this.round++;
    this.startRound(false);
  }

  private over() {
    const [a, b] = this.fighters;
    this.set('over');
    this.hud.showHints(false);
    this.hud.prompt(false);
    this.hud.call(null);
    const youWon = a.wins > b.wins;
    const versus = !!this.p2Pad;
    const title = versus ? `${youWon ? 'Player 1' : 'Player 2'} wins` : youWon ? 'You win' : 'You lose';
    const s = a.stats;
    this.hud.showEnd({
      title,
      lines: [
        `Rounds ${a.wins} – ${b.wins}`,
        `${s.hits} hits landed · longest combo ${s.maxCombo} · ${s.parries} parries`,
        `${s.dmg} damage dealt · ${b.stats.dmg} taken`,
      ],
    });
    this.host.audio.crowd(0.4, 0.4);
  }

  /** Someone's at zero: a KO, or (the deciding round) a finish. */
  private checkKO() {
    if (this.phase !== 'fight') return;
    const [a, b] = this.fighters;
    const loser = a.hp <= 0 ? a : b.hp <= 0 ? b : null;
    if (!loser) return;
    const w = loser.opp;
    this.winner = w;
    w.wins++;
    const decided = w.wins >= WINS;
    this.hud.clock(this.clock);
    if (decided && loser.stunnable) {
      // the last round: they're out on their feet, and it's yours to finish
      loser.daze();
      this.set('finish');
      this.hud.call('Finish it', '', 0, 'finish');
      this.host.audio.crowd(0.8, 1);
      this.cheer(1);
      this.slow = 0.35;
      setTimeout(() => (this.slow = 1), 700);
      return;
    }
    if (loser.stunnable) loser.knockOut();
    else loser.move = null;
    this.set('ko');
    this.slow = 0.25;
    this.hud.call('KO', '', 2000, 'ko');
    this.host.audio.fight('ko');
    this.host.audio.crowd(0.8, 1);
    this.cheer(1);
    this.shake = Math.max(this.shake, 0.5);
    this.rumbleSide(loser.side, 'ko', 1);
    this.rumbleSide(w.side, 'punchHeavy', 1);
  }

  private timeUp() {
    const [a, b] = this.fighters;
    this.clock = 0;
    this.hud.clock(0);
    if (a.hp === b.hp) {
      // a draw: the round is played again
      this.hud.call('Time', 'Draw', 2000);
      this.set('ko');
      this.winner = null;
      this.round--;
      this.phaseT = 1.5;
      return;
    }
    const w = a.hp > b.hp ? a : b;
    this.winner = w;
    w.wins++;
    this.hud.call('Time', `${w.name} takes the round`, 2200);
    w.opp.lose();
    this.host.audio.fight('bell');
    this.set('ko');
    this.phaseT = 1.2;
  }

  private finisher() {
    const w = this.winner!;
    const l = w.opp;
    this.set('finisher');
    this.hud.prompt(false);
    this.hud.call(null);
    this.host.audio.crowd(0.9, 0.8);
    w.finish((n) => {
      l.takeFinisher(n, w);
      const at = this.tmp2.copy(l.pos).setY(l.pos.y + (n === 0 ? 1.1 : 1.55) * l.body.height);
      this.fx.burst(n === 2 ? 'heavy' : 'hit', at, n === 2 ? 1.3 : 0.8);
      this.hitstop = n === 2 ? 18 : 9;
      this.shake = Math.max(this.shake, n === 2 ? 0.6 : 0.3);
      this.host.audio.fight(n === 2 ? 'ko' : 'heavy', 1.2);
      this.rumbleSide(w.side, n === 2 ? 'ko' : 'punchHeavy', 1);
      this.rumbleSide(l.side, n === 2 ? 'ko' : 'hurt', 1);
      this.cheer(n === 2 ? 1 : 0.6);
      if (n === 2) {
        this.hud.call('Finished', '', 2200, 'ko');
        this.slow = 0.3;
      }
    });
  }

  /* ─────────────────────────── contact ─────────────────────────── */

  private contact(a: Fighter, d: Fighter, mv: Move | null, out: Outcome, at: THREE.Vector3, dmg: number) {
    const audio = this.host.audio;
    const heavy = !!mv && mv.hitstop >= 10;
    const power = mv ? Math.min(1.3, mv.dmg / 100) : 0.8;
    const dir = this.tmp2.set(d.pos.x - a.pos.x, 0.3, d.pos.z - a.pos.z).normalize();
    switch (out) {
      case 'hit':
      case 'counter':
        this.hitstop = Math.max(this.hitstop, mv!.hitstop + (out === 'counter' ? 3 : 0) + (a.ex ? 3 : 0));
        this.fx.burst(heavy ? 'heavy' : 'hit', at, power, dir);
        if (a.ex) this.fx.burst('ex', at, 1, dir);
        audio.fight(heavy || out === 'counter' ? 'heavy' : 'hit', power);
        this.shake = Math.max(this.shake, heavy ? 0.28 : 0.1);
        this.rumbleSide(a.side, heavy ? 'punchHeavy' : 'punch', 0.7);
        this.rumbleSide(d.side, 'hurt', heavy ? 1 : 0.6);
        if (out === 'counter') this.hud.tag(a.side, 'Counter');
        if (a.ex) this.hud.tag(a.side, 'EX');
        if (mv!.effect === 'launch') this.hud.tag(a.side, 'Launch');
        this.hud.combo(a.side, d.combo, d.comboDmg);
        if (heavy || d.combo >= 4) this.cheer(heavy ? 0.7 : 0.4);
        break;
      case 'block':
        this.hitstop = Math.max(this.hitstop, Math.round(mv!.hitstop * 0.6));
        this.fx.burst('block', at, power * 0.6, dir);
        audio.fight('block', power);
        this.rumbleSide(d.side, 'block', 0.8);
        if (a.side === 1 && !this.p2Pad) this.ai.blocked();
        break;
      case 'parry':
        this.hitstop = Math.max(this.hitstop, 14);
        this.fx.burst('parry', at, 1, dir);
        audio.fight('parry');
        this.shake = Math.max(this.shake, 0.15);
        this.hud.tag(d.side, 'Parry');
        this.rumbleSide(d.side, 'parry', 1);
        this.rumbleSide(a.side, 'block', 0.6);
        this.cheer(0.6);
        break;
      case 'break':
        this.hitstop = Math.max(this.hitstop, 16);
        this.fx.burst('heavy', at, 1, dir);
        this.fx.burst('block', at, 1, dir);
        audio.fight('heavy', 1.2);
        this.shake = Math.max(this.shake, 0.3);
        this.hud.tag(a.side, 'Guard break');
        this.rumbleSide(d.side, 'knockdown', 0.8);
        this.cheer(0.8);
        break;
      case 'throw':
        this.hitstop = Math.max(this.hitstop, 4);
        audio.fight('grab');
        this.rumbleSide(d.side, 'block', 0.6);
        break;
      case 'slam':
        this.hitstop = Math.max(this.hitstop, 10);
        this.fx.burst('dust', at, 1);
        this.fx.burst('heavy', at, 0.9);
        audio.fight('slam', 1.2);
        this.shake = Math.max(this.shake, 0.4);
        this.rumbleSide(d.side, 'knockdown', 1);
        this.rumbleSide(a.side, 'punchHeavy', 0.7);
        this.hud.combo(a.side, Math.max(2, d.combo), dmg);
        this.cheer(0.9);
        break;
      case 'tech':
        this.hitstop = Math.max(this.hitstop, 8);
        this.fx.burst('block', at, 0.6);
        audio.fight('block', 1);
        this.hud.tag(0, 'Tech');
        this.hud.tag(1, 'Tech');
        this.rumbleBoth('block', 0.7);
        break;
      case 'breaker':
        this.hitstop = Math.max(this.hitstop, 12);
        this.fx.burst('ex', at, 1);
        audio.fight('parry');
        this.hud.tag(a.side, 'Breaker');
        this.rumbleBoth('parry', 0.8);
        this.cheer(0.8);
        break;
    }
  }

  private fall(f: Fighter, power: number) {
    this.fx.burst('dust', this.tmp2.set(f.pos.x, f.ground + 0.1, f.pos.z), power);
    this.host.audio.fight('slam', power * 0.7);
    this.shake = Math.max(this.shake, power * 0.25);
    this.rumbleSide(f.side, 'knockdown', power * 0.8);
  }

  private rumbleSide(side: 0 | 1, e: HapticEvent, scale: number) {
    if (side === 0) {
      if (this.p1Pad) this.host.input.haptics.play(this.p1Pad, e, scale);
      else this.host.input.rumble(e, scale);
    }
    else if (this.p2Pad) this.host.input.haptics.play(this.p2Pad, e, scale);
  }

  private rumbleBoth(e: HapticEvent, scale: number) {
    this.rumbleSide(0, e, scale);
    this.rumbleSide(1, e, scale);
  }

  /** Keep the two apart, and both inside the ring of people. */
  private separate() {
    const [a, b] = this.fighters;
    if (a.state !== 'thrown' && b.state !== 'thrown' && Math.abs(a.pos.y - b.pos.y) < 1.1) {
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz), min = 0.62;
      if (d < min) {
        const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
        const push = (min - d) / 2;
        a.pos.x -= nx * push;
        a.pos.z -= nz * push;
        b.pos.x += nx * push;
        b.pos.z += nz * push;
      }
    }
    for (const f of this.fighters) {
      const dx = f.pos.x - ARENA.x, dz = f.pos.z - ARENA.z;
      const d = Math.hypot(dx, dz);
      if (d > ARENA.r) {
        f.pos.x = ARENA.x + (dx / d) * ARENA.r;
        f.pos.z = ARENA.z + (dz / d) * ARENA.r;
        // the crowd shoves you back in
        const out = (f.vel.x * dx + f.vel.z * dz) / d;
        if (out > 0) {
          f.vel.x -= (dx / d) * out * 1.3;
          f.vel.z -= (dz / d) * out * 1.3;
          if (out > 2.5) this.cheer(0.4, f.pos);
        }
      }
    }
  }

  /* ─────────────────────────── the camera ─────────────────────────── */

  /**
   * Side on to the fight, always: across the line between the two fighters,
   * far enough to keep both in frame, closer when they close in. It orbits
   * as they circle, rises for a launch, pushes in on a KO and swings round
   * the finisher.
   */
  private camera(dt: number, t: number, cam: THREE.PerspectiveCamera) {
    const [a, b] = this.fighters;
    const c = this.cam;
    const mid = this.tmp.copy(a.pos).lerp(b.pos, 0.5);
    let ax = b.pos.x - a.pos.x, az = b.pos.z - a.pos.z;
    const spread = Math.hypot(ax, az) || 1;
    ax /= spread;
    az /= spread;
    // across the line, on whichever side the camera already is
    let px = -az, pz = ax;
    if (c.ready ? (c.pos.x - mid.x) * px + (c.pos.z - mid.z) * pz < 0 : pz < 0) {
      px = -px;
      pz = -pz;
    }
    const up = Math.max(a.pos.y - a.ground, b.pos.y - b.ground);
    let dist = THREE.MathUtils.clamp(2.9 + spread * 0.78, 3.7, 7.6);
    let height = 1.55 + spread * 0.06 + up * 0.35;
    const look = this.tmp2.set(mid.x, this.ground + 1.05 + up * 0.45, mid.z);
    let rate = 5;
    let orbit = 0;
    if (this.phase === 'intro') {
      // wide and turning in, like someone walking up to see
      const k = Math.min(1, this.phaseT / 2.4);
      const e = 1 - (1 - k) * (1 - k);
      dist = THREE.MathUtils.lerp(10, dist, e);
      height = THREE.MathUtils.lerp(4.5, height, e);
      orbit = (1 - e) * 0.9;
      rate = 30;
    } else if ((this.phase === 'ko' || this.phase === 'after' || this.phase === 'over') && this.winner) {
      // on the winner
      const w = this.winner;
      const s = this.phase === 'ko' && this.phaseT < 2.2 ? w.opp : w;
      look.set(s.pos.x, s.pos.y + (s === w ? 1.3 : 0.6), s.pos.z);
      dist = s === w ? 3.2 : 3.6;
      height = s === w ? 1.55 : 1.4;
      orbit = Math.sin(t * 0.15) * 0.4 + (s === w ? w.yaw - Math.atan2(px, pz) : 0) * 0.5;
      rate = 2.5;
    } else if (this.phase === 'finisher' || this.phase === 'finish') {
      dist = this.phase === 'finisher' ? 3.1 : 4.2;
      height = this.phase === 'finisher' ? 1.15 : 1.5;
      orbit = this.phase === 'finisher' ? 0.35 + this.phaseT * 0.32 : 0;
      look.y = this.ground + 1.2;
      rate = 3;
    }
    if (orbit) {
      const cs = Math.cos(orbit), sn = Math.sin(orbit);
      const x = px * cs - pz * sn, z = px * sn + pz * cs;
      px = x;
      pz = z;
    }
    // don't go through a wall
    const dir = new THREE.Vector3(px, 0, pz);
    const hit = this.host.collision.raycast(look, dir, dist);
    dist = Math.min(dist, Math.max(1.8, hit - 0.35));
    const want = new THREE.Vector3(look.x + px * dist, this.ground + height, look.z + pz * dist);
    if (!c.ready) {
      c.pos.copy(want);
      c.look.copy(look);
      c.ready = true;
    }
    const k = Math.min(1, dt * rate);
    c.pos.lerp(want, k);
    c.look.lerp(look, Math.min(1, dt * rate * 1.4));
    this.shake *= Math.max(0, 1 - dt * 5.5);
    const sh = this.shake * this.shake * 0.35;
    cam.position.copy(c.pos);
    cam.position.x += (Math.random() * 2 - 1) * sh;
    cam.position.y += (Math.random() * 2 - 1) * sh;
    cam.position.z += (Math.random() * 2 - 1) * sh;
    cam.lookAt(c.look);
  }

  /* ─────────────────────────── the crowd ─────────────────────────── */

  private buildCrowd() {
    const r = this.rng;
    this.watchers = [];
    const n = 18;
    for (let i = 0; i < n; i++) {
      const p = makePerson(r);
      p.outfit.umbrella = r.chance(0.2) && p.outfit.umbrella;
      const ang = (i / n) * Math.PI * 2 + r.range(-0.12, 0.12);
      const rad = r.range(8.1, 9.8);
      const x = ARENA.x + Math.sin(ang) * rad, z = ARENA.z + Math.cos(ang) * rad;
      const pos = new THREE.Vector3(x, this.host.collision.groundAt(x, z, 2, 3, 0.25), z);
      const anim = new Animator();
      const motion = newMotion();
      motion.stride = 0.9;
      this.crowdBatch.dress(i, p.outfit, 0x9fc4ff, p.body);
      this.watchers.push({ p, motion, rig: newRig(), anim, pos, yaw: Math.atan2(ARENA.x - x, ARENA.z - z), parts: visibleParts(p.outfit, 6), next: r.range(0, 3), excite: 0 });
    }
  }

  /** People round the ring: they fidget, lean to see, wince, clap, shout. */
  private watch(dt: number, t: number, cam: THREE.Camera) {
    const [a, b] = this.fighters;
    const mid = this.tmp.copy(a.pos).lerp(b.pos, 0.5);
    const cx = cam.position.x, cz = cam.position.z;
    const vx = mid.x - cx, vz = mid.z - cz;
    const vl = Math.hypot(vx, vz) || 1;
    this.watchers.forEach((w, i) => {
      w.anim.update(dt);
      w.next -= dt;
      w.excite = Math.max(0, w.excite - dt * 0.4);
      if (w.next <= 0 && !w.anim.holding) {
        w.next = 2.5 + Math.random() * 5;
        const pick = w.excite > 0.4 ? ['emote.clap', 'emote.point', 'emote.thumbsUp', 'emote.angry', 'emote.laugh'] : ['idle.crossArms', 'idle.handsHips', 'idle.shift', 'idle.lookAround', 'idle.rubHands', 'idle.footTap'];
        w.anim.play(pick[Math.floor(Math.random() * pick.length)], { group: 'idle', fadeIn: 0.4, fadeOut: 0.5 });
      }
      // follow the fight with their heads (and a little with their bodies)
      const want = Math.atan2(mid.x - w.pos.x, mid.z - w.pos.z);
      const off = wrap(want - w.yaw);
      if (Math.abs(off) > 0.6) w.yaw += off * Math.min(1, dt * 1.5);
      w.motion.lookYaw += (THREE.MathUtils.clamp(off, -1, 1) - w.motion.lookYaw) * Math.min(1, dt * 4);
      w.motion.speed = 0;
      w.motion.weight = Math.sin(t * 0.6 + i);
      stepPhase(w.motion, dt);
      // anyone between the camera and the fight steps out of the picture
      const ox = w.pos.x - cx, oz = w.pos.z - cz;
      const along = (ox * vx + oz * vz) / vl;
      const across = Math.abs(ox * vz - oz * vx) / vl;
      if ((along > -0.5 && along < vl - 1 && across < 1.3) || Math.hypot(ox, oz) < 1.5) return this.crowdBatch.hide(i);
      _m.compose(w.pos, _q.setFromAxisAngle(_up, w.yaw), _s.setScalar(w.p.body.height));
      solve(w.rig, _m, w.p.body, w.p.outfit, w.motion, t, w.anim);
      this.crowdBatch.write(i, w.rig, w.parts, false);
    });
    this.crowdBatch.flush();
  }

  /** The crowd reacts: louder and more of them the bigger it was; `near` gets the closest ones. */
  private cheer(amount: number, near?: THREE.Vector3) {
    this.host.audio.crowd(0.6, amount);
    for (const w of this.watchers) {
      const close = near ? w.pos.distanceTo(near) < 4 : Math.random() < amount;
      if (!close) continue;
      w.excite = Math.min(1, w.excite + amount);
      w.next = Math.random() * 0.35;
      if (near) w.anim.play('react.flinch', { group: 'react', fadeIn: 0.05, fadeOut: 0.3 });
    }
  }

  /** For the HUD elsewhere and the playtests. */
  get snapshot() {
    const [a, b] = this.fighters;
    return {
      phase: this.phase,
      round: this.round,
      clock: Math.ceil(this.clock),
      p1: { hp: a.hp, state: a.state, wins: a.wins, meter: a.meter, x: +a.pos.x.toFixed(2), z: +a.pos.z.toFixed(2) },
      p2: { hp: b.hp, state: b.state, wins: b.wins, meter: b.meter, x: +b.pos.x.toFixed(2), z: +b.pos.z.toFixed(2), cpu: !this.p2Pad },
      level: this.ai.level,
      hp: MAX_HP,
    };
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function wrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
