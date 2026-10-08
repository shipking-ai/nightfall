import * as THREE from 'three';
import { styleFor, approach, turnToward } from '../anim/gait';
import { Ragdoll } from '../anim/Ragdoll';
import { feel, gaze, moodFor } from '../anim/face';
import { LOD, buildRig, newMotion, newRig, solve, stepPhase, visibleParts, type Body, type Motion, type Outfit, type PartKey, type Rig } from './Humanoid';
import { newPose } from '../anim/pose';
import type { Collision } from '../world/Collision';
import { FigureBatch } from './FigureBatch';
import { Animator } from '../anim/Animator';
import '../anim/clips';
import { IdleDirector } from '../anim/IdleDirector';
import { archetypeFor, makePerson, type ArchetypeId, type Persona } from '../data/people';
import { ROUTES, type Route } from '../world/layout';
import type { Lamp, NpcSpot } from '../world/WorldContext';
import { mulberry32 } from '../world/rng';
import { randomVoice, type VoiceSpec } from '../audio/Voice';
import type { Bark } from '../data/barks';

type Mode = NpcSpot['mode'] | 'walk' | 'watcher' | 'cop' | 'crook';

/** police on foot, kept at the end of the list (never in city snapshots: wanted levels are yours alone) */
const COPS = 6;
/** people the outskirts can borrow (Crowd.lend) */
const EXTRAS = 16;
/** criminals, kept after the police (also never in snapshots) */
const CROOKS = 4;
type CrookState = 'idle' | 'approach' | 'flee' | 'hostile' | 'loiter';

export interface Npc {
  /** hidden for standing far from you (Crowd.update brings them back) */
  away?: boolean;
  mode: Mode;
  pos: THREE.Vector3;
  yaw: number;
  body: Body;
  outfit: Outfit;
  motion: Motion;
  rig: Rig;
  lod: number; // 0 near, 1 mid, 2 far
  parts: Set<PartKey>;
  timer: number;
  // walkers
  route?: ReturnType<typeof prepRoute>;
  s: number;
  dir: number;
  lateral: number;
  speed: number;
  v: number;
  paused: number;
  hidden: number;
  lookT: number;
  lookTarget: number;
  visible: boolean;
  // unease
  frozen: number; // seconds left standing unnaturally still
  wrongYaw: number; // facing somewhere no one would face
  glitchT: number;
  glowOn: boolean;
  /** eyes: a glance at you (seconds left), and the wait before the next */
  glance: number;
  glanceWait: number;
  // cars: a flinch, a step back, a long look after it
  alarm: number;
  alarmX: number;
  alarmZ: number;
  recoil: number;
  recoilX: number;
  recoilZ: number;
  // a voice, and what they've said lately
  voice: VoiceSpec;
  sayCd: number;
  /** how many times you've spoken to them */
  talked: number;
  /** seconds you've been looking straight at them */
  stareT: number;
  // combat
  hp: number;
  /** seconds since they went down; -1 while alive */
  dead: number;
  /** running from gunfire (walkers) or hands up (everyone else) */
  panic: number;
  panicX: number;
  panicZ: number;
  baseArms: [Motion['armL'], Motion['armR']] | null;
  /** police and criminals: next shot */
  fireT: number;
  crook?: { state: CrookState; victim: Npc | null; t: number; ax: number; az: number };
  /** kept off the streets by the population setting */
  culled?: boolean;
  /** who they are, and how they carry themselves */
  arche: ArchetypeId;
  persona: Persona;
  anim: Animator;
  idle: IdleDirector;
  /** a partner in conversation (talk spots come in pairs) */
  friend: Npc | null;
  speaking: boolean;
  talkT: number;
  /** something quietly wrong with them right now */
  horror: { kind: 'stare' | 'backwards' | 'repeat' | 'nothing' | 'smile' | 'wave' | 'follow'; t: number; x: number; z: number; n: number } | null;
  /** last frame's speed, for the lean into starts and stops */
  lastV: number;
  /** multiplayer: the host's latest word on this person (followers only) */
  net?: { a: number; b: number; c: number; v: number; flags: number; wrong: number; at: number };
}

/** One person in a city snapshot: walkers [s, dir, lateral, v, flags, wrongYaw], others [x, z, yaw, 0, flags, wrongYaw]. */
export type NpcWire = [number, number, number, number, number, number];
const F_VISIBLE = 1, F_FROZEN = 2, F_GLITCH = 4;

/**
 * The people of District 03. Most of them behave. They walk, wait, check a
 * phone, smoke, talk, sit by the river, look up when you pass.
 *
 * A few times an hour, something is slightly wrong — and because almost
 * everyone else is ordinary, that is enough.
 */
export class Crowd {
  group = new THREE.Group();
  npcs: Npc[] = [];
  private batch: FigureBatch;
  /**
   * One ragdoll per figure, allocated lazily. A body only exists once something
   * has hit them hard enough to want one; until then it costs nothing.
   */
  rag: (Ragdoll | null)[] = [];
  /** the city's boxes, so a flung body has something to hit */
  private ragCol: Collision | null = null;
  /** scratch pose the ragdoll writes into */
  private pose = newPose();
  private rng = mulberry32(77);
  /** everyone but the police and the criminals */
  citizens = 0;
  /** the ones the outskirts borrow: [extrasFrom, extrasTo) */
  private extrasFrom = 0;
  private extrasTo = 0;
  /** which outskirts spot each borrowed person is standing at */
  private lent = new Map<string, number>();
  /** index of the first criminal */
  crooksFrom = 0;
  /** a criminal shoots at you */
  onCrookShot?: (from: THREE.Vector3, hit: boolean) => void;
  private crimeT = 40;
  /** police: someone shoots at the player (hit: whether it lands) */
  onCopShot?: (from: THREE.Vector3, hit: boolean) => void;
  private copSpawnT = 0;
  /** separate, so giving people voices didn't change how anyone looks */
  private voiceRng = mulberry32(4242);
  private root = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private scl = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private frustum = new THREE.Frustum();
  private pm = new THREE.Matrix4();
  // unease director
  private unease = 75;
  private watcher: Npc;
  private watcherLamp: Lamp | null = null;
  private watcherSeen = 0;
  private lampCandidates: Lamp[];

  constructor(spots: NpcSpot[], lamps: Lamp[]) {
    const rng = this.rng;
    const plan: Record<string, number> = { avW: 3, avE: 3, avW2: 1, linden: 2, lindenN: 1, harbor: 2, square: 2, prom: 2, prom2: 1, fore: 2, alleyM: 1, yard: 1 };
    for (const route of ROUTES) {
      const r = prepRoute(route);
      for (let i = 0; i < (plan[route.id] ?? 0); i++) {
        const n = this.make('walk', new THREE.Vector3(), 0, archetypeFor(rng, route.id));
        n.route = r;
        n.s = rng.range(0, r.total);
        n.dir = rng.chance(0.5) ? 1 : -1;
        // brisk or slow, by who they are
        n.speed = (1.0 + 0.6 * n.persona.energy) * (1 - 0.25 * n.persona.age) * rng.range(0.9, 1.1);
        n.lateral = rng.range(-0.45, 0.45);
        n.outfit.umbrella = n.outfit.umbrella || (n.arche !== 'courier' && n.outfit.hat !== 'hood' && rng.chance(0.3));
        n.motion.armR = n.outfit.umbrella ? 'umbrella' : rng.chance(0.4) ? 'pockets' : 'free';
        n.motion.armL = n.motion.armR === 'pockets' || rng.chance(0.3) ? 'pockets' : 'free';
        this.npcs.push(n);
      }
    }
    for (const s of spots) {
      const n = this.make(s.mode, s.pos.clone(), s.yaw, s.mode === 'stare' ? 'clerk' : archetypeFor(rng, s.mode));
      if (s.mode === 'phone') n.motion.armR = 'phone';
      if (s.mode === 'smoke') n.motion.armR = 'smoke';
      if (s.mode === 'wait') {
        n.outfit.umbrella = rng.chance(0.5);
        n.motion.armR = n.outfit.umbrella ? 'umbrella' : 'pockets';
      }
      if (s.mode === 'sit') n.motion.armL = n.motion.armR = 'rest';
      if (s.mode === 'look') n.motion.armL = n.motion.armR = rng.chance(0.5) ? 'pockets' : 'free';
      this.npcs.push(n);
    }

    // conversations: each talker faces the nearest other talker
    for (const n of this.npcs) {
      if (n.mode !== 'talk' || n.friend) continue;
      let best: Npc | null = null, bd = 3;
      for (const o of this.npcs) {
        if (o === n || o.mode !== 'talk' || o.friend) continue;
        const d = o.pos.distanceTo(n.pos);
        if (d < bd) (best = o), (bd = d);
      }
      if (best) {
        n.friend = best;
        best.friend = n;
        n.speaking = true;
        n.talkT = rng.range(2, 5);
        best.talkT = n.talkT;
      }
    }

    // the one who is always somewhere they shouldn't be
    this.watcher = this.make('watcher', new THREE.Vector3(), 0, 'watcher');
    this.watcher.visible = false;
    this.npcs.push(this.watcher);
    // people lent to the outskirts (lend): put away until somewhere out there wants them
    this.extrasFrom = this.npcs.length;
    for (let i = 0; i < EXTRAS; i++) {
      const n = this.make('look', new THREE.Vector3(0, -50, 0), 0, archetypeFor(rng, rng.pick(['smoke', 'wait', 'talk', 'look'] as const)));
      n.visible = false;
      n.culled = true;
      this.npcs.push(n);
    }
    this.extrasTo = this.npcs.length;
    this.citizens = this.npcs.length;
    // the police, off duty until someone gives them a reason
    for (let i = 0; i < COPS; i++) {
      const c = this.make('cop', new THREE.Vector3(0, -50, 0), 0, 'police');
      c.visible = false;
      c.hp = 60;
      this.npcs.push(c);
    }
    this.crooksFrom = this.npcs.length;
    // and the people the police are really for
    for (let i = 0; i < CROOKS; i++) {
      const c = this.make('crook', new THREE.Vector3(0, -50, 0), 0, 'crook');
      c.visible = false;
      c.hp = 70;
      c.crook = { state: 'idle', victim: null, t: 0, ax: 0, az: 0 };
      this.npcs.push(c);
    }
    this.lampCandidates = lamps.filter((l) => l.pooled && !l.dynamic && l.pos.y > 3.5 && l.color.r > 0.9 && l.color.b < 0.6);

    this.batch = new FigureBatch(this.npcs.length);
    this.group.add(this.batch.group);
    this.npcs.forEach((n, i) => {
      this.batch.dress(i, n.outfit, n.motion.armR === 'smoke' ? 0xff7a30 : 0xbfd4ff, n.body);
      n.parts = visibleParts(n.outfit, 0);
      n.idle.onEvent = (e) => this.idleEvent(i, e);
    });
  }

  /** An idle asked for something in the world to change (the hood going up). */
  private idleEvent(i: number, e: string) {
    const n = this.npcs[i];
    if (e === 'hood' && n.outfit.hoodDown) {
      n.outfit.hoodDown = false;
      n.outfit.hat = 'hood';
      n.outfit.hatColor = n.outfit.top;
      this.batch.dress(i, n.outfit, 0xbfd4ff, n.body);
      n.lod = -1;
    }
  }

  private make(mode: Mode, pos: THREE.Vector3, yaw: number, arche?: ArchetypeId): Npc {
    const rng = this.rng;
    const person = makePerson(rng, arche);
    const { body, outfit, persona } = person;
    const motion = newMotion();
    // posture and gait from who they are
    motion.slouch = rng.range(-0.03, 0.05) + 0.08 * persona.tired - 0.05 * persona.confidence + 0.06 * persona.age;
    motion.stride = rng.range(0.9, 1.1) * (0.9 + 0.2 * persona.energy);
    motion.armSwing = rng.range(0.7, 1.1) * (0.7 + 0.5 * persona.confidence) * (1 - 0.3 * persona.age);
    motion.cadence = 0.9 + 0.25 * persona.energy - 0.12 * persona.age;
    motion.phase = rng.range(0, 10);
    motion.breath = rng.range(0, 10);
    motion.weight = rng.range(-1, 1);
    motion.cold = outfit.garment === 'tee' || outfit.garment === 'scrubs' ? 0.25 : persona.age > 0.7 ? 0.15 : 0;
    const irng = mulberry32(Math.floor(rng.next() * 1e9));
    // how they walk and the face they wear when nothing's happening
    motion.style = styleFor(persona, irng.next, { arche: person.arche, bulk: outfit.bulk, femme: Math.min(1, (body.bust ?? 0) * 1.6), toeOut: body.toeOut });
    moodFor(motion.face, persona, person.arche);
    const anim = new Animator();
    // underdressed for the night: a shiver that comes and goes, under everything else
    if (motion.cold > 0.2) anim.play('react.shiver', { group: 'shiver', loop: true, weight: 0.8, at: rng.range(0, 1) });
    return {
      arche: person.arche, persona, anim, idle: new IdleDirector(persona, irng.next), friend: null, speaking: false, talkT: 0, horror: null, lastV: 0,
      mode, pos, yaw, body, outfit, motion, rig: newRig(), lod: -1, parts: new Set(),
      timer: rng.range(2, 8), s: 0, dir: 1, lateral: 0, speed: 0, v: 0, paused: 0, hidden: 0,
      lookT: rng.range(2, 6), lookTarget: 0, visible: true, frozen: 0, wrongYaw: 0, glitchT: 0, glowOn: false, glance: 0, glanceWait: rng.range(2, 10),
      alarm: 0, alarmX: 0, alarmZ: 0, recoil: 0, recoilX: 0, recoilZ: 0,
      voice: randomVoice(this.voiceRng.next, body.height), sayCd: 0, talked: 0, stareT: 0,
      hp: 100, dead: -1, panic: 0, panicX: 0, panicZ: 0, baseArms: null, fireT: 1,
    };
  }

  /** Circles the player collides with. */
  obstacles(out: { x: number; z: number; r: number }[]) {
    for (const n of this.npcs) if (n.visible) out.push({ x: n.pos.x, z: n.pos.z, r: n.mode === 'sit' ? 0.5 : 0.3 * n.body.girth });
  }

  /**
   * A car moving at (x,z) with velocity (vx,vz). Anyone it's bearing down on
   * flinches, steps out of its line and turns to watch it go. The ones who
   * never react to you don't react to this either; the frozen don't move at all.
   */
  threat(x: number, z: number, vx: number, vz: number, byPlayer = false) {
    const speed = Math.hypot(vx, vz);
    if (speed < 3) return;
    const ux = vx / speed, uz = vz / speed;
    for (const n of this.npcs) {
      if (!this.canReact(n)) continue;
      const dx = n.pos.x - x, dz = n.pos.z - z;
      const along = dx * ux + dz * uz;
      const side = dx * uz - dz * ux;
      const d = Math.hypot(dx, dz);
      const inPath = along > -1 && along < speed * 1.3 + 3 && Math.abs(side) < 2.4;
      if (!inPath && d > 2.6) continue;
      const fresh = n.alarm < 2.6;
      if (fresh) n.alarm = 4 + Math.random() * 1.5;
      if (fresh && byPlayer && d < 8 && speed > 5) this.say(n, 'nearMiss');

      // Something is coming at them and fast enough to matter: get out of the
      // road rather than flinch. Walkers run for the kerb and keep going; people
      // standing about back off and turn away. A driver who doesn't slow for
      // people finds they've emptied the pavement in front of them.
      if (speed > 5 && along > -1.5 && along < speed * 2.2 + 5 && Math.abs(side) < 5 && n.recoil <= 0 && n.panic <= 0) {
        const urgency = speed > 9 ? 1 : speed > 7 ? 0.6 : 0.3;
        // away from the car's line, on the side they're already leaning
        const away = side >= 0 ? 1 : -1;
        const ax = uz * away, az = -ux * away;
        // and a little backwards, away from it
        const bx = -ux, bz = -uz;
        if (n.mode === 'walk') {
          n.panic = Math.max(n.panic, 3.5 + urgency * 3);
          // panic flees *from* the source, so it has to be where the car is
          n.panicX = x;
          n.panicZ = z;
          n.recoil = Math.max(n.recoil, 0.8 * urgency + 0.3);
          n.recoilX = ax * 0.8 + bx * 0.5 * urgency;
          n.recoilZ = az * 0.8 + bz * 0.5 * urgency;
        } else {
          n.recoil = Math.max(n.recoil, 0.5 * urgency + 0.25);
          n.recoilX = ax;
          n.recoilZ = az;
          n.lookTarget = wrap(Math.atan2(-ux, -uz) - n.yaw);
          if (speed > 7) n.anim.play('react.nearMiss', { group: 'react', fadeIn: 0.05 });
        }
      }
      // close and fast: a jump back; otherwise a flinch and a look
      if (fresh && n.mode !== 'sit') {
        n.idle.interrupt(n.anim);
        if (d < 4.5 && speed > 6) {
          n.anim.play('react.nearMiss', { group: 'react', fadeIn: 0.05 });
          feel(n.motion.face, 'surprise', 1, 0.6);
          feel(n.motion.face, 'fear', 0.7, 3);
        } else if (inPath) n.anim.play('react.flinch', { group: 'flinch', fadeIn: 0.05 });
        if (byPlayer && speed > 8 && d < 6) feel(n.motion.face, 'angry', 0.8, 5);
        // and after it's gone, what they think of the driver
        if (byPlayer && speed > 8 && d < 6) setTimeout(() => n.alarm > 0 && n.anim.play(Math.random() < 0.6 ? 'emote.angry' : 'emote.shake', { group: 'gesture', fadeIn: 0.25 }), 900);
      }
      n.alarmX = x;
      n.alarmZ = z;
      // step sideways out of its line, away from the side it's on
      if ((fresh || d < 1.6) && along < speed * 0.8 + 2 && Math.abs(side) < 2.6 && n.recoil <= 0) {
        const sgn = side >= 0 ? 1 : -1;
        n.recoil = 0.55;
        n.recoilX = uz * sgn;
        n.recoilZ = -ux * sgn;
      }
    }
  }

  /** A horn at (x,z): heads turn toward it. */
  hear(x: number, z: number, radius: number, byPlayer = false) {
    let near: Npc | null = null, nd = 12;
    for (const n of this.npcs) {
      if (!this.canReact(n)) continue;
      const d = Math.hypot(n.pos.x - x, n.pos.z - z);
      if (d > radius) continue;
      n.alarm = Math.max(n.alarm, 2.2 + Math.random());
      n.alarmX = x;
      n.alarmZ = z;
      // a jolt, and a look round at it
      if (d < radius * 0.6 && n.mode !== 'sit' && !n.anim.playing('react')) {
        n.anim.play('react.horn', { group: 'react', fadeIn: 0.04, mirror: (n.pos.x - x) * Math.cos(n.yaw) - (n.pos.z - z) * Math.sin(n.yaw) < 0 });
        feel(n.motion.face, 'surprise', 0.8, 0.5);
      }
      if (d < nd) (near = n), (nd = d);
    }
    // one of them answers back, not the whole street
    if (byPlayer && near && Math.random() < 0.6) {
      this.say(near, 'honked');
      const who = near;
      feel(who.motion.face, 'angry', 0.85, 4);
      setTimeout(() => who.anim.play(Math.random() < 0.5 ? 'react.annoyed' : 'emote.shoo', { group: 'gesture', fadeIn: 0.3 }), 700);
    }
  }

  /** Something loud and bad happened at (x,z): whoever's closest says so. */
  shock(x: number, z: number) {
    let near: Npc | null = null, nd = 18;
    for (const n of this.npcs) {
      if (!this.canReact(n)) continue;
      const d = Math.hypot(n.pos.x - x, n.pos.z - z);
      if (d > 18) continue;
      n.alarm = Math.max(n.alarm, 4);
      n.alarmX = x;
      n.alarmZ = z;
      n.idle.interrupt(n.anim);
      // close to a blast: turn away, arms round the head
      n.anim.play(d < 8 && n.mode !== 'sit' ? 'react.shield' : 'react.flinch', { group: 'react', fadeIn: 0.05 });
      feel(n.motion.face, 'fear', 1, 6);
      feel(n.motion.face, 'surprise', 1, 0.5);
      if (d < nd) (near = n), (nd = d);
    }
    if (near) {
      this.say(near, 'crash');
      setTimeout(() => near!.anim.play('emote.confused', { group: 'gesture', fadeIn: 0.3 }), 1400);
    }
  }

  /* ── voices ─────────────────────────────────────────────── */

  /** An officer steps out of a patrol car at `at` (if one's free). */
  deployCop(at: THREE.Vector3) {
    for (let i = this.citizens; i < this.crooksFrom; i++) {
      const n = this.npcs[i];
      if (n.visible || n.dead >= 0) continue;
      n.pos.copy(at);
      n.visible = true;
      n.hp = 60;
      n.fireT = 1.2 + Math.random();
      this.copSpawnT = 3;
      return true;
    }
    return false;
  }

  /** Admin: bring on one of the unsettling moments now. */
  provoke() {
    this.unease = 0;
  }

  /** Someone says something: App picks the line, plays the voice and shows the subtitle. */
  onSay?: (n: Npc, kind: Bark) => void;
  private hush = 0;
  private chatterT = 3;
  private lastPlayer = new THREE.Vector3();
  private playerSpeed = 0;

  private say(n: Npc, kind: Bark, force = false) {
    if (!force && (n.sayCd > 0 || this.hush > 0)) return;
    n.sayCd = 7 + Math.random() * 4;
    if (kind !== 'chatter') this.hush = 1.4;
    this.onSay?.(n, kind);
  }

  /** The person you'd speak to with E: close, in front of you, not busy being strange. */
  nearestTalker(pos: THREE.Vector3, fwd: THREE.Vector3, maxD = 2.1): Npc | null {
    let best: Npc | null = null, bd = maxD;
    for (const n of this.npcs) {
      if (!n.visible || n.frozen > 0) continue;
      const dx = n.pos.x - pos.x, dz = n.pos.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > bd || Math.abs(n.pos.y - pos.y) > 1.2) continue;
      if ((dx * fwd.x + dz * fwd.z) / Math.max(d, 1e-3) < 0.3 && d > 0.9) continue;
      best = n;
      bd = d;
    }
    return best;
  }

  /** You speak to them: they turn to you and answer (shorter each time). */
  talk(n: Npc, from: THREE.Vector3) {
    if (n.mode !== 'stare' && n.mode !== 'watcher') {
      n.alarm = Math.max(n.alarm, 3.5);
      n.alarmX = from.x;
      n.alarmZ = from.z;
    }
    this.say(n, 'talk', true);
    n.talked++;
  }

  /** You, walking about: bumping into people, staring at them, two people talking as you pass. */
  private listen(dt: number, player: THREE.Vector3, camera: THREE.Camera) {
    this.hush -= dt;
    const moved = Math.hypot(player.x - this.lastPlayer.x, player.z - this.lastPlayer.z);
    this.playerSpeed += (Math.min(moved / Math.max(dt, 1e-3), 20) - this.playerSpeed) * Math.min(1, dt * 8);
    this.lastPlayer.copy(player);
    const fwd = camera.getWorldDirection(this.tmpFwd);
    this.chatterT -= dt;
    // Pale: the district stops noticing you. Nobody looks, nobody reacts, and
    // you are not a thing that happened to them.
    if (this.pale > 0) {
      this.pale -= dt;
      for (const n of this.npcs) if (n.visible) n.stareT = 0;
      return;
    }
    for (const n of this.npcs) {
      if (n.sayCd > 0) n.sayCd -= dt;
      if (!n.visible) continue;
      const dx = n.pos.x - player.x, dz = n.pos.z - player.z;
      const d = Math.hypot(dx, dz);
      if (d > 14 || Math.abs(n.pos.y - player.y) > 2) {
        n.stareT = 0;
        continue;
      }
      // a shoulder into someone at walking pace or faster
      if (d < 0.3 * n.body.girth + 0.42 && this.playerSpeed > 1.3 && this.canReact(n)) {
        n.alarm = Math.max(n.alarm, 2.5);
        n.alarmX = player.x;
        n.alarmZ = player.z;
        if (n.recoil <= 0 && n.mode !== 'sit') {
          n.recoil = 0.3;
          n.recoilX = dx / Math.max(d, 1e-3);
          n.recoilZ = dz / Math.max(d, 1e-3);
          n.idle.interrupt(n.anim);
          n.anim.play('react.stumble', { group: 'react', fadeIn: 0.05, mirror: (dx * Math.cos(n.yaw) - dz * Math.sin(n.yaw)) < 0 });
          if (n.persona.confidence > 0.45 || Math.random() < 0.4) setTimeout(() => n.anim.play(n.persona.confidence > 0.6 ? 'emote.angry' : 'emote.shrug', { group: 'gesture', fadeIn: 0.3 }), 1000);
        }
        this.say(n, 'bump');
      }
      // looking right at someone, close, for a few seconds
      const c = camera.position;
      const ex = n.pos.x - c.x, ey = n.pos.y + 1.5 - c.y, ez = n.pos.z - c.z;
      const el = Math.hypot(ex, ey, ez);
      const aim = (ex * fwd.x + ey * fwd.y + ez * fwd.z) / Math.max(el, 1e-3);
      if (d < 5 && aim > 0.985 && this.playerSpeed < 1 && this.canReact(n)) {
        n.stareT += dt;
        if (n.stareT > 3.2) {
          n.stareT = -6;
          n.alarm = Math.max(n.alarm, 3);
          n.alarmX = player.x;
          n.alarmZ = player.z;
          this.say(n, 'stared');
        }
      } else if (n.stareT > 0) n.stareT = Math.max(0, n.stareT - dt * 2);
      // people in conversation, heard as you pass (no subtitles; you're not part of it)
      if (n.mode === 'talk' && d < 10 && this.chatterT <= 0 && n.sayCd <= 0) {
        this.chatterT = 1.6 + Math.random() * 2.2;
        this.say(n, 'chatter');
        n.sayCd = 2.5 + Math.random() * 2;
      }
    }
  }
  private tmpFwd = new THREE.Vector3();
  private qDown = new THREE.Quaternion();
  private side = new THREE.Vector3(1, 0, 0);
  private tmpDown = new THREE.Vector3();
  /** set by the game each frame: the player's wanted level (0–5) */
  wanted = 0;
  /** set by the game: find somewhere out of sight to bring a police officer in */
  spawnAt: (out: THREE.Vector3) => boolean = () => false;

  /** Running from gunfire: walkers flee along their route away from it; everyone else puts their hands up. */
  private panicUpdate(n: Npc, dt: number) {
    if (n.panic <= 0) return;
    n.panic -= dt;
    const m = n.motion;
    if (n.mode === 'walk' && n.route) {
      const { dir } = samplePath(n.route, n.s);
      const away = (n.pos.x - n.panicX) * dir.x + (n.pos.z - n.panicZ) * dir.y;
      n.dir = away >= 0 ? 1 : -1;
      n.paused = 0;
      n.alarm = 0;
      n.v += (5 - n.v) * Math.min(1, dt * 3);
      m.speed = n.v;
      m.armL = m.armR = 'free';
    } else if (n.mode !== 'sit') {
      m.armL = m.armR = 'hands';
    }
    if (n.panic <= 0 && n.baseArms) {
      [m.armL, m.armR] = n.baseArms;
      n.baseArms = null;
    }
  }

  private canReact(n: Npc) {
    return n.visible && n.dead < 0 && n.mode !== 'stare' && n.mode !== 'watcher' && n.mode !== 'cop' && n.mode !== 'crook' && n.frozen <= 0;
  }

  /* ── combat ─────────────────────────────────────────────── */

  /** The first person a ray passes through (a standing capsule each), within `max`. */
  hitTest(o: THREE.Vector3, dir: THREE.Vector3, max: number): { i: number; t: number } | null {
    let best: { i: number; t: number } | null = null;
    const hx = Math.hypot(dir.x, dir.z) || 1e-6;
    this.npcs.forEach((n, i) => {
      if (!n.visible || n.dead >= 0) return;
      const r = 0.32 * n.body.girth;
      // closest approach in the ground plane
      const px = n.pos.x - o.x, pz = n.pos.z - o.z;
      const tc = (px * dir.x + pz * dir.z) / (hx * hx);
      if (tc < 0) return;
      const cx = o.x + dir.x * tc - n.pos.x, cz = o.z + dir.z * tc - n.pos.z;
      const d2 = cx * cx + cz * cz;
      if (d2 > r * r) return;
      const t = tc - Math.sqrt(r * r - d2) / hx;
      if (t > max || (best && t > best.t)) return;
      const y = o.y + dir.y * t;
      if (y < n.pos.y || y > n.pos.y + 1.8 * n.body.height) return;
      best = { i, t };
    });
    return best;
  }

  /** Hurt someone. Returns true if that put them down. */
  damage(i: number, dmg: number, from: THREE.Vector3, hitY?: number, force = false): boolean {
    const n = this.npcs[i];
    if (!n || n.dead >= 0) return false;
    n.hp -= dmg;
    // the wound shows on them: that part of their clothes (or skin) soaks dark
    const at = hitY != null ? (hitY - n.pos.y) / (1.76 * n.body.height) : 0.62 + Math.random() * 0.15;
    this.batch.stain(i, at, Math.min(1, dmg / 40));
    this.scatter(n.pos.x, n.pos.z, 26, from);
    const dx = n.pos.x - from.x, dz = n.pos.z - from.z, d = Math.hypot(dx, dz) || 1;
    // where the hit came from, in their own frame: front, back, left, right
    const fx = Math.sin(n.yaw), fz = Math.cos(n.yaw);
    const along = -(dx * fx + dz * fz) / d, side = -(dx * fz - dz * fx) / d;
    n.idle.interrupt(n.anim);
    if (n.hp > 0) {
      n.recoil = 0.25;
      n.recoilX = dx / d;
      n.recoilZ = dz / d;
      const clip = Math.abs(along) > Math.abs(side) ? (along > 0 ? 'react.hitFront' : 'react.hitBack') : side > 0 ? 'react.hitLeft' : 'react.hitRight';
      n.anim.play(clip, { group: 'hit', fadeIn: 0.03, fadeOut: 0.2 });
      feel(n.motion.face, 'pain', 1, 1.6);
      feel(n.motion.face, 'fear', 0.8, 8);
      this.say(n, 'hurt', true);
      return false;
    }
    n.dead = 0;
    n.frozen = 0;
    n.motion.speed = 0;
    n.anim.stop();
    n.anim.play(along >= 0 ? 'react.deathBack' : 'react.deathForward', { group: 'death', fadeIn: 0.06, stay: true });
    // Something that hit them hard enough to kill them throws the body: the
    // clip plays, then they lie where it left them.
    if (force) {
      // stand the figure up first, so the body starts from the pose it was in
      this.q.setFromAxisAngle(this.up, n.yaw);
      this.scl.setScalar(n.body.height);
      this.root.compose(n.pos, this.q, this.scl);
      solve(n.rig, this.root, n.body, n.outfit, n.motion, performance.now() / 1000, n.anim);
      this.catchRag(i, n).launch(this.root, n.body, from, 4.5 + Math.min(6, dmg * 0.14));
    }
    return true;
  }

  /** The ragdoll for figure i, made if it isn't there yet. */
  private catchRag(i: number, n: Npc): Ragdoll {
    let r = this.rag[i];
    if (!r) this.rag[i] = r = new Ragdoll(n.body.height);
    if (this.ragCol) r.setCollision(this.ragCol);
    return r;
  }

  /**
   * Knock someone away from a car, hard enough to move them and stagger them.
   * Walkers carry it as a lateral shove off their route; everyone else slides.
   */
  toss(n: Npc, vx: number, vz: number) {
    if (n.dead >= 0) return;
    const s = Math.hypot(vx, vz);
    if (s < 0.5) return;
    n.recoil = Math.max(n.recoil, Math.min(1.4, 0.35 + s * 0.06));
    n.recoilX = vx / s;
    n.recoilZ = vz / s;
    // and they lose their footing for a moment
    n.paused = Math.max(n.paused, Math.min(2.5, 0.4 + s * 0.08));
    n.frozen = 0;
    n.alarm = Math.max(n.alarm, 4);
  }

  /**
   * Everyone on foot, so a car can find them and knock them down. Rebuilt each
   * frame rather than cached: the objects close over their index.
   */
  bodies(out: { pos: THREE.Vector3; dead: number; visible: boolean; hurt: (dmg: number, from: THREE.Vector3, force: boolean) => boolean; knockDown: (x: number, z: number) => void; toss: (vx: number, vz: number) => void }[]): void {
    out.length = 0;
    for (let i = 0; i < this.npcs.length; i++) {
      const n = this.npcs[i];
      if (n.dead >= 0 || !n.visible) continue;
      out.push({
        pos: n.pos,
        dead: n.dead,
        visible: n.visible,
        hurt: (dmg, from, force) => this.damage(i, dmg, from, undefined, force),
        knockDown: (x, z) => this.knockDown(i, x, z),
        toss: (vx, vz) => this.toss(n, vx, vz),
      });
    }
  }

  /**
   * Hit by a car and it wasn't the end: thrown down, a moment on the ground,
   * then up again (slowly), and they don't forget it.
   */
  knockDown(i: number, fromX: number, fromZ: number) {
    const n = this.npcs[i];
    if (!n || n.dead >= 0) return;
    this.toss(n, 0, 0);
    n.idle.interrupt(n.anim);
    n.anim.stop(undefined, 0.05);
    n.yaw = Math.atan2(fromX - n.pos.x, fromZ - n.pos.z); // thrown back, away from it
    n.anim.play('react.knockdown', { group: 'down', fadeIn: 0.04, stay: true });
    feel(n.motion.face, 'pain', 1, 4);
    feel(n.motion.face, 'fear', 0.9, 12);
    n.frozen = 3.6;
    n.v = 0;
    n.motion.speed = 0;
    setTimeout(() => {
      if (n.dead >= 0) return;
      n.anim.stop('down', 0.2);
      n.anim.play('react.getUp', { group: 'react', fadeIn: 0.15 });
      n.panic = Math.max(n.panic, 6);
    }, 2400);
  }

  /** Gunfire at (x,z): people run from `from` (walkers) or freeze with their hands up. */
  scatter(x: number, z: number, radius: number, from: THREE.Vector3) {
    let near: Npc | null = null, nd = radius;
    for (const n of this.npcs) {
      if (!this.canReact(n)) continue;
      const d = Math.hypot(n.pos.x - x, n.pos.z - z);
      if (d > radius) continue;
      if (n.panic <= 0) {
        n.baseArms = [n.motion.armL, n.motion.armR];
        n.idle.interrupt(n.anim);
        if (n.mode !== 'walk' && n.mode !== 'sit') n.anim.play('react.duck', { group: 'react', fadeIn: 0.08 });
        else if (n.mode === 'walk') n.anim.play('react.flinch', { group: 'flinch', fadeIn: 0.05 });
      }
      n.panic = 9 + Math.random() * 5;
      feel(n.motion.face, 'surprise', 1, 0.5);
      feel(n.motion.face, 'fear', 0.7 + 0.3 * n.persona.nervous, n.panic);
      n.panicX = from.x;
      n.panicZ = from.z;
      n.alarm = Math.max(n.alarm, 3);
      n.alarmX = from.x;
      n.alarmZ = from.z;
      if (d < nd) (near = n), (nd = d);
    }
    if (near) this.say(near, 'shot');
  }

  /** Is anyone left alive (and in sight of) this person? For the police: how many are chasing you. */
  get police(): number {
    let k = 0;
    for (let i = this.citizens; i < this.crooksFrom; i++) if (this.npcs[i].visible && this.npcs[i].dead < 0) k++;
    return k;
  }

  /** Police on foot: as many as the wanted level asks for, closing in and shooting. */
  private policeUpdate(dt: number, player: THREE.Vector3 | null, wanted: number, spawnAt: (out: THREE.Vector3) => boolean) {
    const want = player && wanted > 0 ? Math.min(COPS, 1 + wanted) : 0;
    this.copSpawnT -= dt;
    let have = this.police;
    for (let i = this.citizens; i < this.crooksFrom; i++) {
      const n = this.npcs[i];
      if (n.dead >= 0) continue;
      if (!n.visible) {
        if (have < want && this.copSpawnT <= 0 && spawnAt(n.pos)) {
          n.visible = true;
          n.hp = 60;
          n.fireT = 1.5 + Math.random();
          n.motion.armR = 'free';
          have++;
          this.copSpawnT = 2.5;
        }
        continue;
      }
      const m = n.motion;
      if (!player) continue;
      const dx = player.x - n.pos.x, dz = player.z - n.pos.z, d = Math.hypot(dx, dz);
      if (want === 0) {
        // stand down: walk off and go
        const v = 1.6;
        n.yaw = Math.atan2(-dx, -dz);
        n.pos.x -= (dx / d) * v * dt;
        n.pos.z -= (dz / d) * v * dt;
        m.speed = v;
        m.armR = 'free';
        stepPhase(m, dt);
        if (d > 45) n.visible = false;
        continue;
      }
      n.yaw += turnToward(n.yaw, Math.atan2(dx, dz), n.v, dt);
      const v = approach(n.v, d > 11 ? 4.4 : 0, dt, 3.2, 5.5);
      n.pos.x += Math.sin(n.yaw) * v * dt;
      n.pos.z += Math.cos(n.yaw) * v * dt;
      n.pos.y += (player.y - n.pos.y) * Math.min(1, dt * 2);
      n.v = v;
      feel(m.face, 'focus', 0.8, 1);
      m.speed = v;
      m.armR = d < 24 ? 'aim' : 'free';
      stepPhase(m, dt);
      n.fireT -= dt;
      if (d < 24 && n.fireT <= 0) {
        n.fireT = 1.1 + Math.random() * 0.9;
        this.onCopShot?.(n.pos, Math.random() < 0.34 - d * 0.006);
      }
    }
  }

  /** Is this one of the criminals? */
  isCrook(i: number) {
    return i >= this.crooksFrom;
  }

  /** Something the player did to (or near) a criminal: they stop pretending. */
  provokeCrook(i: number) {
    const c = this.npcs[i]?.crook;
    if (c && c.state !== 'hostile' && this.npcs[i].dead < 0) {
      c.state = 'hostile';
      c.t = 25;
    }
  }

  /**
   * Street crime, every minute or so while you're out: a mugging somewhere you
   * can see it, or a couple of people who don't want you on their corner.
   */
  private crooksUpdate(dt: number, player: THREE.Vector3 | null) {
    if (!player || this.puppet) return;
    if (!this.crimeOn) {
      for (let i = this.crooksFrom; i < this.npcs.length; i++) this.npcs[i].visible = false;
      return;
    }
    this.crimeT -= dt;
    const free = this.npcs.slice(this.crooksFrom).filter((n) => !n.visible && n.dead < 0);
    if (this.crimeT <= 0 && this.wanted === 0 && free.length >= 2 && Math.abs(player.z) < 900) {
      this.crimeT = 55 + Math.random() * 50;
      if (Math.random() < 0.65) this.startMugging(player, free[0]);
      else this.startGang(player, free.slice(0, 2));
    }
    for (let i = this.crooksFrom; i < this.npcs.length; i++) {
      const n = this.npcs[i];
      const c = n.crook!;
      if (!n.visible || n.dead >= 0) continue;
      const m = n.motion;
      const dx = player.x - n.pos.x, dz = player.z - n.pos.z, d = Math.hypot(dx, dz) || 1;
      let vx = 0, vz = 0, speed = 0;
      c.t -= dt;
      if (c.state === 'approach' && c.victim) {
        const v = c.victim;
        const ex = v.pos.x - n.pos.x, ez = v.pos.z - n.pos.z, ed = Math.hypot(ex, ez) || 1;
        if (!v.visible || v.dead >= 0 || c.t < 0) c.state = 'flee';
        else if (ed < 1.1) {
          // the grab: the victim cries out and everyone near looks
          v.alarm = 5;
          v.alarmX = n.pos.x;
          v.alarmZ = n.pos.z;
          this.scatter(v.pos.x, v.pos.z, 12, n.pos);
          this.say(v, 'robbed', true);
          c.state = 'flee';
          c.t = 30;
          c.ax = n.pos.x - dx / d;
          c.az = n.pos.z - dz / d;
        } else {
          vx = ex / ed;
          vz = ez / ed;
          speed = ed > 6 ? 3.2 : 1.4; // walk up casually for the last few metres
        }
      }
      if (c.state === 'flee') {
        // away from you, fast; if you catch up, they turn on you
        vx = -dx / d;
        vz = -dz / d;
        speed = 5.2;
        if (d < 6) {
          c.state = 'hostile';
          c.t = 20;
        }
        if (c.t < 0 || d > 70) n.visible = false;
      }
      if (c.state === 'loiter') {
        n.yaw += wrap(Math.atan2(dx, dz) - n.yaw) * Math.min(1, dt * (d < 16 ? 3 : 0.3));
        if (d < 11) {
          this.say(n, 'crook', true);
          c.state = 'hostile';
          c.t = 25;
        }
        if (c.t < 0 && d > 40) n.visible = false;
      }
      if (c.state === 'hostile') {
        // keep a distance and shoot; give up and run after a while
        n.yaw = Math.atan2(dx, dz);
        if (d > 16) (vx = dx / d), (vz = dz / d), (speed = 3.5);
        else if (d < 7) (vx = -dx / d), (vz = -dz / d), (speed = 2.2);
        m.armR = 'aim';
        n.fireT -= dt;
        if (d < 26 && n.fireT <= 0) {
          n.fireT = 0.9 + Math.random() * 1.1;
          this.onCrookShot?.(n.pos, Math.random() < 0.3 - d * 0.006);
        }
        if (c.t < 0) {
          c.state = 'flee';
          c.t = 20;
        }
      } else m.armR = 'free';
      if (speed > 0) {
        n.pos.x += vx * speed * dt;
        n.pos.z += vz * speed * dt;
        if (c.state !== 'hostile') n.yaw += wrap(Math.atan2(vx, vz) - n.yaw) * Math.min(1, dt * 8);
      }
      n.pos.y += (player.y > -0.5 && Math.abs(player.y - n.pos.y) < 2 ? player.y - n.pos.y : 0) * Math.min(1, dt * 2);
      n.v = speed;
      m.speed = speed;
      stepPhase(m, dt);
    }
  }

  private startMugging(player: THREE.Vector3, crook: Npc) {
    // a victim: someone ordinary, 14–40 m from you
    const pool = this.npcs.slice(0, this.citizens).filter((n) => this.canReact(n) && n.mode !== 'sit' && n.mode !== 'talk' && inRange(n.pos, player, 14, 40));
    if (!pool.length) return;
    const v = pool[(Math.random() * pool.length) | 0];
    const a = Math.random() * Math.PI * 2;
    crook.pos.set(v.pos.x + Math.sin(a) * 10, v.pos.y, v.pos.z + Math.cos(a) * 10);
    crook.visible = true;
    crook.hp = 70;
    crook.crook = { state: 'approach', victim: v, t: 20, ax: 0, az: 0 };
  }

  private startGang(player: THREE.Vector3, two: Npc[]) {
    const a = Math.random() * Math.PI * 2;
    const cx = player.x + Math.sin(a) * 30, cz = player.z + Math.cos(a) * 30;
    two.forEach((n, k) => {
      n.pos.set(cx + (k ? 1.2 : -1.2), 0.15, cz + (k ? 0.6 : -0.6));
      n.visible = true;
      n.hp = 70;
      n.fireT = 1 + Math.random();
      n.crook = { state: 'loiter', victim: null, t: 90, ax: 0, az: 0 };
    });
  }

  /** Down: lying where they fell; after a while (and out of sight) they're back on their feet. */
  private down(n: Npc, dt: number, player: THREE.Vector3 | null) {
    n.dead += dt;
    n.motion.speed = 0;
    n.alarm = 0;
    if (n.dead > 45 && (!player || player.distanceTo(n.pos) > 30)) {
      n.dead = -1;
      n.anim.clear();
      n.hp = n.mode === 'cop' ? 60 : 100;
      n.panic = 0;
      if (n.mode === 'cop' || n.mode === 'crook') n.visible = false;
      if (n.route) n.s = this.rng.range(0, n.route.total);
    }
  }

  /** Runs after the ordinary behaviour, so it wins: stop, step back, look. */
  private react(n: Npc, dt: number) {
    if (n.alarm <= 0) return;
    n.alarm -= dt;
    const m = n.motion;
    if (n.recoil > 0) {
      n.recoil -= dt;
      const k = 3.4 * dt;
      if (n.mode === 'walk' && n.route) {
        const { dir } = samplePath(n.route, n.s);
        // walkers carry their offset as a lateral distance from the path
        n.lateral = THREE.MathUtils.clamp(n.lateral + (n.recoilX * -dir.y + n.recoilZ * dir.x) * k, -1.8, 1.8);
      } else if (n.mode !== 'sit') {
        n.pos.x += n.recoilX * k;
        n.pos.z += n.recoilZ * k;
      }
    }
    if (n.mode === 'walk') {
      n.paused = Math.max(n.paused, 0.2);
      n.v *= 1 - Math.min(1, dt * 6);
      m.speed = n.v;
    }
    const want = wrap(Math.atan2(n.alarmX - n.pos.x, n.alarmZ - n.pos.z) - n.yaw);
    // turn the body if the head alone can't follow (not while sitting)
    if (Math.abs(want) > 1.1 && n.mode !== 'sit') {
      const dy = wrap(want - Math.sign(want) * 1.1) * Math.min(1, dt * 3);
      n.yaw += dy;
      m.turn = dy / Math.max(dt, 1e-3);
    }
    m.lookYaw += (THREE.MathUtils.clamp(want, -1.2, 1.2) - m.lookYaw) * Math.min(1, dt * 7);
    m.lookPitch *= 1 - Math.min(1, dt * 5);
    if (n.mode === 'phone') n.glowOn = n.alarm < 1.5; // eyes off the screen
  }

  /**
   * Multiplayer: when someone else hosts the room, this crowd stops deciding
   * anything and follows the host's snapshots (`apply`), smoothing between them.
   */
  puppet = false;

  /** The host's view of everyone, compact enough to send twice a second. */
  snapshot(): NpcWire[] {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return this.npcs.slice(0, this.citizens).map((n) => {
      const flags = (n.visible ? F_VISIBLE : 0) | (n.frozen > 0 ? F_FROZEN : 0) | (n.glitchT > 0 ? F_GLITCH : 0);
      if (n.mode === 'walk' && n.route) return [r2(n.s), n.dir, r2(n.lateral), r2(n.v), flags, r2(n.wrongYaw)];
      return [r2(n.pos.x), r2(n.pos.z), r2(n.yaw), 0, flags, r2(n.wrongYaw)];
    });
  }

  /** A snapshot from the host (followers). Unknown shapes are ignored. */
  apply(snap: NpcWire[]) {
    if (!Array.isArray(snap) || snap.length !== this.citizens) return;
    const at = performance.now();
    snap.forEach((w, i) => {
      if (!Array.isArray(w) || w.length < 6 || !w.every((v) => Number.isFinite(v))) return;
      const n = this.npcs[i];
      const glitchNow = !!(w[4] & F_GLITCH);
      if (glitchNow && !(n.net && n.net.flags & F_GLITCH)) {
        n.glitchT = 0.9;
        n.motion.glitchKind = this.rng.int(0, 2);
      }
      n.net = { a: w[0], b: w[1], c: w[2], v: w[3], flags: w[4], wrong: w[5], at };
    });
  }

  /** Follower: go where the host says, smoothly; dead-reckon walkers along their route. */
  private follow(n: Npc, dt: number) {
    const net = n.net;
    if (!net) return;
    n.visible = !!(net.flags & F_VISIBLE);
    n.frozen = net.flags & F_FROZEN ? Math.max(n.frozen, 0.5) : 0;
    n.wrongYaw = net.wrong;
    const m = n.motion;
    const k = Math.min(1, dt * 4);
    if (n.mode === 'walk' && n.route) {
      const r = n.route;
      const since = (performance.now() - net.at) / 1000;
      let target = net.a + net.v * net.b * Math.min(since, 1.5);
      if (r.loop) target = ((target % r.total) + r.total) % r.total;
      else target = THREE.MathUtils.clamp(target, 0, r.total);
      let diff = target - n.s;
      if (r.loop && Math.abs(diff) > r.total / 2) diff -= Math.sign(diff) * r.total;
      n.s = Math.abs(diff) > 6 ? target : n.s + diff * k;
      if (r.loop) n.s = ((n.s % r.total) + r.total) % r.total;
      n.dir = net.b >= 0 ? 1 : -1;
      n.lateral += (net.c - n.lateral) * k;
      n.v = n.frozen > 0 ? 0 : net.v;
      m.speed = n.v;
      if (n.frozen <= 0) stepPhase(m, dt);
      const { p, dir } = samplePath(r, n.s);
      n.pos.set(p.x - dir.y * n.lateral, 0.15, p.y + dir.x * n.lateral);
      const want = Math.atan2(dir.x * n.dir, dir.y * n.dir);
      const dy = wrap(want - n.yaw) * Math.min(1, dt * 4);
      m.turn = dy / Math.max(dt, 1e-3);
      n.yaw += dy;
    } else {
      if (n.pos.distanceTo(_tmp.set(net.a, n.pos.y, net.b)) > 4) n.pos.set(net.a, n.pos.y, net.b);
      else {
        n.pos.x += (net.a - n.pos.x) * k;
        n.pos.z += (net.b - n.pos.z) * k;
      }
      n.yaw += wrap(net.c - n.yaw) * k;
    }
  }

  /** muggings and gangs (CITY only) */
  crimeOn = true;
  /** how hard it's raining (App sets it every frame) */
  rain = 0;
  /** how often the quiet unsettling moments come (1 = normal, 0 = never) */
  uneaseRate = 1;

  /** Keep a share of ordinary people in the streets (population setting). */
  setDensity(k: number) {
    for (let i = 0; i < this.citizens; i++) {
      if (i >= this.extrasFrom && i < this.extrasTo) continue;
      const n = this.npcs[i];
      if (n === this.watcher || n.mode === 'stare') continue;
      // a fixed shuffle, so the same people stay home each time
      const r = ((i * 2654435761) >>> 0) / 4294967296;
      const was = !!n.culled;
      n.culled = r >= k;
      if (n.culled && !was) n.visible = false;
      if (!n.culled && was && n.mode !== 'walk') n.visible = true;
      if (!n.culled && was && n.mode === 'walk') (n.hidden = 0), (n.visible = true);
    }
  }

  /**
   * The outskirts have nobody of their own: they borrow from a small pool.
   * Each wanted spot (nearest first) gets someone standing there in its pose;
   * spots no longer wanted give their person back. Pairs talking face each
   * other.
   */
  lend(spots: (NpcSpot & { key: string })[]) {
    const want = new Set(spots.map((s) => s.key));
    for (const [key, i] of this.lent) {
      if (want.has(key)) continue;
      const n = this.npcs[i];
      if (n.friend) n.friend.friend = null;
      n.friend = null;
      n.culled = true;
      n.visible = false;
      this.lent.delete(key);
    }
    const busy = new Set(this.lent.values());
    const free: number[] = [];
    for (let i = this.extrasFrom; i < this.extrasTo; i++) if (!busy.has(i)) free.push(i);
    const fresh: Npc[] = [];
    for (const s of spots) {
      if (this.lent.has(s.key)) continue;
      const i = free.pop();
      if (i === undefined) break;
      const n = this.npcs[i];
      this.lent.set(s.key, i);
      n.mode = s.mode;
      n.pos.copy(s.pos);
      n.yaw = s.yaw;
      n.dead = -1;
      n.hp = 100;
      n.panic = 0;
      n.horror = null;
      this.rag[i] = null;
      n.motion.armL = n.motion.armR = 'free';
      if (s.mode === 'phone') n.motion.armR = 'phone';
      if (s.mode === 'smoke') n.motion.armR = 'smoke';
      if (s.mode === 'sit') n.motion.armL = n.motion.armR = 'rest';
      if (s.mode === 'wait' || s.mode === 'look') n.motion.armL = n.motion.armR = 'pockets';
      this.batch.dress(i, n.outfit, n.motion.armR === 'smoke' ? 0xff7a30 : 0xbfd4ff, n.body);
      n.culled = false;
      n.visible = true;
      n.away = false;
      n.lod = -1;
      fresh.push(n);
    }
    for (const n of fresh) {
      if (n.mode !== 'talk' || n.friend) continue;
      let best: Npc | null = null, bd = 3;
      for (const i of this.lent.values()) {
        const o = this.npcs[i];
        if (o === n || o.mode !== 'talk' || o.friend) continue;
        const d = o.pos.distanceTo(n.pos);
        if (d < bd) (best = o), (bd = d);
      }
      if (best) {
        n.friend = best;
        best.friend = n;
        n.speaking = true;
        n.talkT = 2 + Math.random() * 3;
        best.talkT = n.talkT;
      }
    }
  }

  setLod(near: number, mid: number) {
    LOD.near = near;
    LOD.mid = mid;
    for (const n of this.npcs) n.lod = -1;
  }

  /** Nobody on the streets at all (WARZONE, FIGHT). */
  setEnabled(on: boolean) {
    this.group.visible = on;
    this.enabled = on;
  }
  enabled = true;
  /** seconds of Pale left: while it runs, nobody notices you */
  pale = 0;
  /** seconds of Still left: while it runs, the district does not move */
  still = 0;

  /** which way the camera looks (for the ones that only move when you aren't looking) */
  private lastCamYaw = 0;
  private camDir = new THREE.Vector3();

  /**
   * Put an ordinary person on the street at `at`, facing `yaw`. Used when
   * somebody who was driving is put out on the road: they should be standing
   * next to the car, not teleported out of a driver seat with no explanation.
   * Returns the NPC if one was free.
   */
  dropBystander(at: THREE.Vector3, yaw: number) {
    for (let i = 0; i < this.citizens; i++) {
      const n = this.npcs[i];
      if (n === this.watcher || n.dead >= 0) continue;
      // a slot currently in use by somebody else on screen: leave them be
      if (n.visible && n.mode !== 'walk') continue;
      if (n.visible && n.pos.distanceTo(at) < 12) continue;
      n.visible = true;
      n.pos.set(at.x, at.y, at.z);
      n.yaw = yaw;
      n.v = 0;
      n.mode = 'talk';
      n.route = undefined;
      n.lod = -1;
      // startled: they look at what just happened to them and back away
      n.alarm = 4;
      n.alarmX = at.x;
      n.alarmZ = at.z;
      n.recoil = 0.4;
      n.recoilX = Math.sin(yaw);
      n.recoilZ = Math.cos(yaw);
      n.idle.interrupt(n.anim);
      return n;
    }
    return null;
  }

  /** The world's boxes, so a thrown body has something to land against. */
  setCollision(col: Collision) {
    this.ragCol = col;
  }

  update(dt: number, t: number, player: THREE.Vector3 | null, camera: THREE.Camera) {
    camera.getWorldDirection(this.camDir);
    this.lastCamYaw = Math.atan2(this.camDir.x, this.camDir.z);
    if (!this.enabled) return;
    const camPos = camera.position;
    this.pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pm);
    if (player && !this.puppet) this.direct(dt, player, camPos);
    if (player) this.listen(dt, player, camera);
    this.policeUpdate(dt, player, this.wanted, this.spawnAt);
    this.crooksUpdate(dt, player);

    // Still: the district stops. Not slows — stops, mid-stride, mid-sentence,
    // and holds there for the length of it. Nothing moves but you.
    const frozen = this.still > 0;
    if (frozen) this.still -= dt;

    this.npcs.forEach((n, i) => {
      if (frozen) {
        // held: no movement, no reactions, no new behaviour. The pose still
        // solves so the bodies read as people caught mid-motion rather than
        // switched off.
        n.v = 0;
        n.motion.speed = 0;
        n.motion.turn = 0;
        n.anim.update(dt * 0.02);
        if (!n.visible) {
          this.batch.hide(i);
          n.lod = -1;
          return;
        }
        this.q.setFromAxisAngle(this.up, n.yaw + n.wrongYaw);
        this.scl.setScalar(n.body.height);
        this.root.compose(n.pos, this.q, this.scl);
        solve(n.rig, this.root, n.body, n.outfit, n.motion, t, null);
        this.batch.write(i, n.rig, n.parts, false);
        return;
      }
      // people standing somewhere (a doorway, a sofa indoors) far from you: not simulated or drawn at all
      const away = !!player && n.mode !== 'walk' && n.mode !== 'cop' && n.mode !== 'crook' && n.mode !== 'watcher' && n.dead < 0 && (n.pos.x - player.x) ** 2 + (n.pos.z - player.z) ** 2 > 8100;
      if (n.culled || away) {
        if (n.lod !== -1 || n.visible) {
          if (away && n.visible) n.away = true;
          n.visible = false;
          this.batch.hide(i);
          n.lod = -1;
        }
        return;
      }
      // back in range: show the ones we hid for being far away
      if (n.away) {
        n.away = false;
        n.visible = true;
      }
      if (n.dead >= 0) this.down(n, dt, player);
      else if (n.mode === 'cop' || n.mode === 'crook') {
        /* policeUpdate / crooksUpdate moved them */
        if (n.visible && n.mode === 'cop') n.idle.update(dt, n.anim, { still: n.v < 0.2 && n.motion.armR !== 'aim', raining: false, cold: false, waiting: false, hands: '', hoodable: false, police: true, wall: false });
      } else if (this.puppet && n.net) {
        this.follow(n, dt);
        if (n.mode !== 'walk' && n.mode !== 'watcher' && n.visible) this.stand(n, dt, t, player); // idle animation only
      } else if (n.mode === 'walk' && n.route) this.walk(n, dt, player);
      else if (n.mode === 'watcher') this.watch(n, dt, player);
      else this.stand(n, dt, t, player);
      if (n.dead < 0) this.react(n, dt);
      if (n.dead < 0) this.panicUpdate(n, dt);
      if (n.horror && n.dead < 0) this.horrorUpdate(n, dt, player);
      if (!n.visible) {
        this.batch.hide(i);
        n.lod = -1;
        return;
      }
      const d = n.pos.distanceTo(camPos);
      // lean into starts and stops
      const acc = (n.v - n.lastV) / Math.max(dt, 1e-3);
      n.lastV = n.v;
      n.motion.accel += (acc - n.motion.accel) * Math.min(1, dt * 6);
      // rain: those without an umbrella hunch and hurry
      if (n.mode === 'walk' && !n.outfit.umbrella) n.motion.cold = Math.max(n.motion.cold * 0.99, this.rain > 0.35 ? 0.35 : 0);
      // animation (people too far to read a gesture only get the procedural pose)
      const animate = n.lod <= 1 || d < LOD.mid;
      if (animate) n.anim.update(dt);
      // far standing figures don't need a new pose every frame
      if (d > 150 && n.mode !== 'walk' && n.lod === 2 && (i + Math.floor(t * 10)) % 6 !== 0) return;
      const lod = d < LOD.near ? 0 : d < LOD.mid ? 1 : 2;
      if (lod !== n.lod) {
        n.lod = lod;
        n.parts = visibleParts(n.outfit, d);
      }
      // unease: a moment where a body moves the way a body shouldn't
      // the eyes get there before the head: people glance at you as you pass
      if (player && n.dead < 0 && d < 12) {
        const f = n.motion.face;
        if (n.glance > 0) {
          n.glance -= dt;
          const rel = wrap(Math.atan2(player.x - n.pos.x, player.z - n.pos.z) - n.yaw) - n.motion.lookYaw;
          if (Math.abs(rel) < 1.4) gaze(f, THREE.MathUtils.clamp(rel * 2.4, -1, 1), THREE.MathUtils.clamp((player.y + 1.6 - n.pos.y - 1.6 * n.body.height) * 0.3, -0.5, 0.5));
          if (n.glance <= 0) gaze(f, NaN, NaN);
        } else if ((n.glanceWait -= dt) <= 0) {
          n.glanceWait = (3 + Math.random() * 9) * (1.3 - n.persona.nervous);
          n.glance = 0.5 + Math.random() * (1 + n.persona.confidence);
        }
      }
      if (n.glitchT > 0) {
        n.glitchT -= dt;
        const k = 1 - Math.abs(1 - n.glitchT / 0.45);
        n.motion.glitch = Math.max(0, Math.min(1, k * 1.6));
      } else n.motion.glitch = 0;

      const rag = this.rag[i];
      if (rag && rag.alive) {
        // the body is where the physics put it, and posed from its bones
        rag.root(this.root, rag.yaw, n.body.height);
        rag.pose(this.pose, n.body);
        buildRig(n.rig, this.root, n.body, n.outfit, this.pose);
      } else {
        this.q.setFromAxisAngle(this.up, n.yaw + n.wrongYaw);
        this.scl.setScalar(n.body.height);
        this.root.compose(n.pos, this.q, this.scl);
        solve(n.rig, this.root, n.body, n.outfit, n.motion, t, animate ? n.anim : null);
      }
      const prop = n.anim.hasProp('ember') || n.anim.hasProp('phone');
      this.batch.write(i, n.rig, n.parts, n.glowOn || prop);
    });
    this.batch.flush();
  }

  /* ─────────────────────────── ordinary behaviour ─────────────────────────── */

  private walk(n: Npc, dt: number, player: THREE.Vector3 | null) {
    const r = n.route!;
    const rng = this.rng;
    const m = n.motion;
    if (n.hidden > 0) {
      n.hidden -= dt;
      // someone who went down an alley does not come back while you're waiting for them
      if (n.hidden <= 0 && player && player.distanceTo(n.pos) < 30) n.hidden = 4;
      n.visible = n.hidden <= 0;
      if (n.visible) n.dir *= -1;
      return;
    }
    if (n.frozen > 0) {
      n.frozen -= dt;
      m.speed = 0;
      m.breath -= dt; // not even breathing
      if (n.frozen <= 0) n.wrongYaw = 0;
      return;
    }
    let target = n.speed;
    if (n.paused > 0) {
      n.paused -= dt;
      target = 0;
      n.lookT -= dt;
      if (n.lookT < 0) {
        n.lookT = rng.range(0.8, 2.2);
        n.lookTarget = rng.range(-1.0, 1.0);
      }
    } else if (rng.next() < dt * 0.018 * (0.6 + n.persona.nervous)) {
      n.paused = rng.range(2.5, 5); // stop, look around, carry on
      n.anim.play(rng.chance(0.5) ? 'idle.crosswalk' : rng.chance(0.5) ? 'idle.lookAround' : 'idle.checkPhone', { group: 'idle', fadeIn: 0.5, speed: 0.9 + 0.2 * n.persona.energy });
    }
    if (player) {
      const dx = player.x - n.pos.x, dz = player.z - n.pos.z;
      if (dx * dx + dz * dz < 2.4 * 2.4) {
        const ahead = dx * Math.sin(n.yaw) + dz * Math.cos(n.yaw);
        if (ahead > 0) {
          target = Math.min(target, 0.2);
          n.lateral += (n.lateral >= 0 ? 1 : -1) * dt * 0.8;
          n.lateral = THREE.MathUtils.clamp(n.lateral, -1.2, 1.2);
        }
        n.lookTarget = Math.atan2(dx, dz) - n.yaw;
      }
    }
    // and they don't walk through each other: a walker reads the few people
    // around them and steps wide, or slows and lets them pass
    this.avoid(n, dt);
    m.lookYaw += (THREE.MathUtils.clamp(wrap(n.lookTarget), -1.1, 1.1) - m.lookYaw) * Math.min(1, dt * 3);
    if (n.paused <= 0 && n.lookTarget !== 0 && rng.next() < dt * 0.5) n.lookTarget *= 0.5;
    m.lookPitch = n.outfit.umbrella ? 0.08 : m.armR === 'pockets' ? 0.1 : 0;

    if (n.panic > 0) target = 5;
    else if (this.rain > 0.35 && !n.outfit.umbrella && target > 0) target *= 1.18; // hurrying through it
    // quietly wrong: walking backwards, still facing the way they came
    const back = n.horror?.kind === 'backwards';
    n.motion.moveDir += ((back ? Math.PI : 0) - n.motion.moveDir) * Math.min(1, dt * 6);
    // start and stop with a little inertia (the heavier and older, the more)
    n.v += (target - n.v) * Math.min(1, dt * (2.8 - 0.8 * n.persona.age));
    m.speed = n.v;
    stepPhase(m, dt);
    n.s += n.v * dt * n.dir * (back ? -0.6 : 1);
    this.greet(n);
    if (r.loop) n.s = ((n.s % r.total) + r.total) % r.total;
    else if (n.s < 0 || n.s > r.total) {
      n.s = THREE.MathUtils.clamp(n.s, 0, r.total);
      // going inside pops if the player can see it — only well out of view
      const nearPlayer = player ? player.distanceTo(n.pos) < 28 : false;
      if (!nearPlayer && rng.chance(0.4)) {
        n.hidden = rng.chance(0.15) ? rng.range(120, 240) : rng.range(6, 20);
        n.visible = false;
      } else {
        n.dir *= -1;
        n.paused = rng.range(0.5, 2);
      }
    }
    const { p, dir } = samplePath(r, n.s);
    n.pos.set(p.x - dir.y * n.lateral, 0.15, p.y + dir.x * n.lateral);
    const want = Math.atan2(dir.x * n.dir, dir.y * n.dir);
    const dy = wrap(want - n.yaw) * Math.min(1, dt * 4);
    m.turn = dy / Math.max(dt, 1e-3);
    n.yaw += dy;
  }

/** Whether something is being watched right now (the uneasy watcher). */
  get watched() {
    return this.watcher.visible;
  }

  /**
   * A power goes off nearby: everyone close enough to feel it looks up, and the
   * ones who were already afraid look further away.
   */
  startle(at: THREE.Vector3, r: number) {
    this.shock(at.x, at.z);
    for (const n of this.npcs) {
      if (!this.canReact(n)) continue;
      if (Math.hypot(n.pos.x - at.x, n.pos.z - at.z) > r) continue;
      n.idle.interrupt(n.anim);
      n.lookTarget = wrap(Math.atan2(at.x - n.pos.x, at.z - n.pos.z) - n.yaw);
      n.alarm = Math.max(n.alarm, 2.5);
      n.recoil = Math.max(n.recoil, 0.4);
      n.recoilX = (n.pos.x - at.x) / r;
      n.recoilZ = (n.pos.z - at.z) / r;
    }
  }

  /**
   * Walkers and people standing about don't collide, so two on the same pavement
 * drift through each other. This reads the neighbours and either steps wide
 * (a walker, as a lateral offset from their route) or slows and turns to let
 * them past. Only the nearest few are considered, and only ones in front.
 */
  private avoid(n: Npc, dt: number) {
    if (n.dead >= 0 || n.frozen > 0 || !n.visible) return;
    const fx = Math.sin(n.yaw), fz = Math.cos(n.yaw);
    for (const o of this.npcs) {
      if (o === n || o.dead >= 0 || !o.visible || o.mode === 'cop' || o.mode === 'crook') continue;
      const dx = o.pos.x - n.pos.x, dz = o.pos.z - n.pos.z;
      const d2 = dx * dx + dz * dz;
      const near = 2.3;
      if (d2 > near * near || d2 < 1e-4) continue;
      // only what is in front of us, or we react to people behind us too
      const ahead = (dx * fx + dz * fz) / Math.sqrt(d2);
      const side = (dx * fz - dz * fx) / Math.sqrt(d2);
      if (ahead < -0.35) continue;
      const d = Math.sqrt(d2);
      // get out of the way: sideways, away from them
      const push = (near - d) * 0.9;
      if (n.mode === 'walk') {
        // to the side they're already on, so we pass rather than merge
        const want = (side >= 0 ? 1 : -1) * push * 0.5;
        n.lateral += (want - n.lateral) * Math.min(1, dt * 4);
        n.lateral = THREE.MathUtils.clamp(n.lateral, -1.6, 1.6);
      } else {
        n.pos.x += (side >= 0 ? -1 : 1) * push * dt * 1.4;
        n.pos.z += (side >= 0 ? 1 : -1) * push * dt * 1.4;
      }
      // and look where we're going, which is where they are
      n.lookTarget = wrap(Math.atan2(dx, dz) - n.yaw);
      // if we can't get past, slow down rather than shove through
      if (d < 1.1 && ahead > 0.5) n.v *= 1 - Math.min(1, dt * 3);
    }
  }

  /** Two people who know each other pass in the street: a wave. */
  private greet(n: Npc) {
    if (n.anim.playing('gesture') || this.rng.next() > 0.0008) return;
    for (const o of this.npcs) {
      if (o === n || !o.visible || o.dead >= 0 || o.mode === 'watcher' || o.mode === 'stare' || o.mode === 'cop' || o.mode === 'crook') continue;
      const d = o.pos.distanceTo(n.pos);
      if (d > 4 || d < 1) continue;
      for (const [a, b] of [[n, o], [o, n]]) {
        a.lookTarget = wrap(Math.atan2(b.pos.x - a.pos.x, b.pos.z - a.pos.z) - a.yaw);
        a.anim.play('emote.greet', { group: 'gesture', fadeIn: 0.25, mirror: a.persona.leftHanded });
      }
      return;
    }
  }

  private stand(n: Npc, dt: number, t: number, player: THREE.Vector3 | null) {
    const m = n.motion;
    const rng = this.rng;
    n.timer -= dt;
    m.speed = 0;
    m.turn = 0;
    if (n.frozen > 0) {
      n.frozen -= dt;
      if (n.frozen <= 0) n.wrongYaw = 0;
      n.anim.stop(undefined, 0.6);
      m.blinkT = 9; // not even blinking
      return; // nothing moves. not the chest, not the head.
    }
    m.breath += dt * 1.2;
    // weight moves from one leg to the other every few seconds
    m.weight += (Math.sin(t * 0.13 + n.timer * 0.1 + n.pos.x) - m.weight) * dt * 0.4;
    // a slow wandering gaze under whatever idle is playing
    if (n.timer < 0) {
      n.timer = rng.range(2.5, 7) * (1.2 - 0.5 * n.persona.nervous);
      n.lookTarget = rng.range(-0.7, 0.7) * (0.6 + n.persona.nervous);
    }
    const hands = n.motion.armR === 'phone' ? 'phone' : n.motion.armR === 'umbrella' ? 'umbrella' : n.mode === 'smoke' ? 'smoke' : n.motion.armR;
    switch (n.mode) {
      case 'phone':
        m.lookPitch = 0.5;
        m.lookYaw = Math.sin(t * 0.3 + n.pos.z) * 0.08;
        n.glowOn = true;
        break;
      case 'smoke':
        m.smokeT = 0;
        m.lookYaw += (n.lookTarget * 0.7 - m.lookYaw) * Math.min(1, dt * 1.5);
        m.lookPitch = 0;
        break;
      case 'talk':
        this.converse(n, dt, t);
        break;
      case 'sit':
        m.sit = 1;
        m.lookPitch = 0.05;
        m.lookYaw += (n.lookTarget * 0.5 - m.lookYaw) * Math.min(1, dt * 1.2);
        break;
      case 'stare':
        m.lookPitch = -0.1;
        m.lookYaw = 0;
        m.breath -= dt * 1.2; // too still
        m.blinkT = Math.max(m.blinkT, 6);
        return;
      default:
        m.lookYaw += (n.lookTarget - m.lookYaw) * Math.min(1, dt * 1.6);
        m.lookPitch += (Math.sin(t * 0.15 + n.pos.x) * 0.08 - 0.03 - m.lookPitch) * Math.min(1, dt);
    }
    if (n.mode !== 'talk' && n.dead < 0 && n.panic <= 0 && n.alarm <= 0) {
      n.idle.update(dt, n.anim, {
        still: true,
        raining: this.rain > 0.3 && !n.outfit.umbrella,
        cold: m.cold > 0.1 || this.rain > 0.6,
        waiting: n.mode === 'wait',
        hands,
        hoodable: n.outfit.hoodDown && n.outfit.garment === 'hoodie',
        police: false,
        wall: false,
      });
    }
    // people notice you when you're close — except the ones who never look away
    if (player && n.mode !== 'sit') {
      const dx = player.x - n.pos.x, dz = player.z - n.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 3.4 * 3.4) {
        const want = THREE.MathUtils.clamp(wrap(Math.atan2(dx, dz) - n.yaw), -1.2, 1.2);
        m.lookYaw += (want - m.lookYaw) * Math.min(1, dt * 2.5);
        m.lookPitch *= 0.9;
        // a friendly nod, once, from the confident ones
        if (!n.anim.playing('gesture') && n.stareT <= 0 && rng.next() < dt * 0.25 * n.persona.confidence) n.anim.play('emote.nod', { group: 'gesture', fadeIn: 0.2 });
      }
    }
  }

  /** Two people talking: one speaks (and gestures), the other listens, nods, laughs; then they swap. */
  private converse(n: Npc, dt: number, t: number) {
    const m = n.motion;
    const f = n.friend;
    if (f) {
      const want = THREE.MathUtils.clamp(wrap(Math.atan2(f.pos.x - n.pos.x, f.pos.z - n.pos.z) - n.yaw), -1.1, 1.1);
      m.lookYaw += (want + Math.sin(t * 0.4 + n.pos.x) * 0.06 - m.lookYaw) * Math.min(1, dt * 3);
      m.lookPitch = Math.sin(t * 1.3 + n.pos.z) * 0.03;
    }
    n.talkT -= dt;
    if (n.talkT <= 0 && f) {
      n.talkT = f.talkT = this.rng.range(2.5, 6);
      n.speaking = !n.speaking;
      f.speaking = !n.speaking;
      // now and then a shared laugh
      if (this.rng.chance(0.18)) for (const who of [n, f]) who.anim.play('emote.laugh', { group: 'social', fadeIn: 0.3 });
    }
    m.face.talk += ((n.speaking ? 1 : 0) - m.face.talk) * Math.min(1, dt * 6);
    if (f) gaze(m.face, THREE.MathUtils.clamp((wrap(Math.atan2(f.pos.x - n.pos.x, f.pos.z - n.pos.z) - n.yaw) - m.lookYaw) * 2, -1, 1), 0);
    if (n.speaking) {
      if (!n.anim.playing('social')) n.anim.play('emote.talk', { group: 'social', loop: true, fadeIn: 0.5, speed: 0.85 + 0.3 * n.persona.energy, mirror: n.persona.leftHanded });
    } else {
      if (n.anim.playing('emote.talk')) n.anim.stop('social', 0.5);
      if (!n.anim.playing('gesture') && this.rng.next() < dt * 0.35) n.anim.play('emote.nod', { group: 'gesture', fadeIn: 0.2, speed: 0.8 });
    }
  }

  /* ─────────────────────────── unease ─────────────────────────── */

  /** Rare, quiet, never twice in a row. */
  private direct(dt: number, player: THREE.Vector3, camPos: THREE.Vector3) {
    this.unease -= dt * this.uneaseRate;
    if (this.uneaseRate <= 0) return;
    if (this.unease > 0 || this.watcher.visible) return;
    this.unease = this.rng.range(110, 220);
    const roll = this.rng.next();
    if (roll < 0.3) this.summonWatcher(player, camPos);
    else if (roll < 0.48) this.freezeSomeone(player);
    else if (roll < 0.62) this.glitchSomeone(player, camPos);
    else if (roll < 0.7) this.haunt('stare', player);
    else if (roll < 0.77) this.haunt('backwards', player);
    else if (roll < 0.83) this.haunt('repeat', player);
    else if (roll < 0.88) this.haunt('smile', player);
    else if (roll < 0.92) this.haunt('wave', player);
    else if (roll < 0.96) this.haunt('follow', player);
    else this.haunt('nothing', player);
  }

  /**
   * The quieter wrongnesses. Someone turns their head to you, slowly, and
   * keeps it there without blinking; someone walks backwards for a few
   * steps; someone checks their watch the exact same way four times; someone
   * stops, looks at a patch of dark that's empty, and backs away from it.
   * Then they're ordinary again.
   */
  private haunt(kind: 'stare' | 'backwards' | 'repeat' | 'nothing' | 'smile' | 'wave' | 'follow', player: THREE.Vector3) {
    const pool = this.npcs.slice(0, this.citizens).filter((n) => {
      if (!n.visible || n.mode === 'watcher' || n.mode === 'stare' || n.frozen > 0 || n.horror || n.dead >= 0) return false;
      const d = n.pos.distanceTo(player);
      if (kind === 'backwards') return n.mode === 'walk' && d > 8 && d < 30;
      if (kind === 'follow') return n.mode !== 'sit' && n.mode !== 'walk' && n.mode !== 'talk' && d > 12 && d < 30;
      return d > 6 && d < 26 && this.frustum.containsPoint(_tmp.copy(n.pos).setY(1.5));
    });
    if (!pool.length) {
      this.unease = 30;
      return;
    }
    const n = this.rng.pick(pool);
    n.horror = { kind, t: kind === 'stare' ? 14 : kind === 'backwards' ? 5 : kind === 'repeat' ? 12 : kind === 'follow' ? 40 : kind === 'wave' ? 12 : 9, x: 0, z: 0, n: 0 };
    if (kind === 'nothing') {
      // a point in the dark, a few metres off to their side
      const a = n.yaw + (this.rng.chance(0.5) ? 1 : -1) * this.rng.range(1.2, 2.2);
      n.horror.x = n.pos.x + Math.sin(a) * 6;
      n.horror.z = n.pos.z + Math.cos(a) * 6;
    }
  }

  private horrorUpdate(n: Npc, dt: number, player: THREE.Vector3 | null) {
    const h = n.horror!;
    const m = n.motion;
    h.t -= dt;
    if (h.t <= 0 || !player) {
      n.horror = null;
      return;
    }
    switch (h.kind) {
      case 'stare': {
        // the head comes round too slowly, then stays; no blinking, no breath
        const want = wrap(Math.atan2(player.x - n.pos.x, player.z - n.pos.z) - n.yaw);
        const lim = THREE.MathUtils.clamp(want, -1.45, 1.45);
        m.lookYaw += Math.sign(lim - m.lookYaw) * Math.min(Math.abs(lim - m.lookYaw), dt * 0.35);
        m.lookPitch = 0;
        m.blinkT = Math.max(m.blinkT, 2);
        m.breath -= dt;
        n.anim.stop('idle', 0.8);
        if (n.mode === 'walk') n.paused = Math.max(n.paused, 0.3);
        break;
      }
      case 'repeat':
        // the same small movement, identical each time
        if (!n.anim.playing('idle') && h.n < 4) {
          h.n++;
          n.anim.play('idle.checkWatch', { group: 'idle', fadeIn: 0.05, fadeOut: 0.05, speed: 1 });
        }
        if (n.mode === 'walk') n.paused = Math.max(n.paused, 0.3);
        break;
      case 'nothing': {
        if (n.mode === 'walk') n.paused = Math.max(n.paused, 0.3);
        const want = wrap(Math.atan2(h.x - n.pos.x, h.z - n.pos.z) - n.yaw);
        m.lookYaw += (THREE.MathUtils.clamp(want, -1.3, 1.3) - m.lookYaw) * Math.min(1, dt * 2);
        n.lookTarget = m.lookYaw;
        if (h.n === 0 && h.t < 8) {
          h.n = 1;
          n.anim.play('react.uneasy', { group: 'idle', fadeIn: 0.4 });
        } else if (h.n === 1 && h.t < 3.5 && n.mode !== 'sit') {
          h.n = 2;
          n.anim.play('react.backAway', { group: 'react', fadeIn: 0.3 });
        }
        break;
      }
      case 'backwards':
        break; // walk() handles it
      case 'smile': {
        // they look at you, and smile, and hold it a second too long
        const want = wrap(Math.atan2(player.x - n.pos.x, player.z - n.pos.z) - n.yaw);
        m.lookYaw += (THREE.MathUtils.clamp(want, -1.2, 1.2) - m.lookYaw) * Math.min(1, dt * 1.5);
        gaze(m.face, 0, 0);
        if (h.n === 0) {
          h.n = 1;
          n.anim.play('horror.smile', { group: 'face', fadeIn: 0.3 });
        }
        m.blinkT = Math.max(m.blinkT, 2);
        if (n.mode === 'walk') n.paused = Math.max(n.paused, 0.3);
        break;
      }
      case 'wave':
        // a wave that's a beat too slow, and doesn't stop when it should
        if (h.n === 0) {
          h.n = 1;
          n.anim.play('horror.wave', { group: 'gesture', fadeIn: 0.8, loop: true });
        }
        m.lookYaw += (THREE.MathUtils.clamp(wrap(Math.atan2(player.x - n.pos.x, player.z - n.pos.z) - n.yaw), -1.2, 1.2) - m.lookYaw) * Math.min(1, dt * 1.2);
        if (n.mode === 'walk') n.paused = Math.max(n.paused, 0.3);
        if (h.t < 0.6) n.anim.stop('gesture', 0.6);
        break;
      case 'follow': {
        // keeps the same distance behind you; stops when you turn to look
        const dx = player.x - n.pos.x, dz = player.z - n.pos.z, d = Math.hypot(dx, dz);
        const facing = Math.sin(this.lastCamYaw) * -dx + Math.cos(this.lastCamYaw) * -dz > d * 0.6;
        const go = !facing && d > 14 ? 1.25 : 0;
        n.yaw += turnToward(n.yaw, Math.atan2(dx, dz), n.v, dt);
        n.v = approach(n.v, go, dt, 1.5, 3);
        n.pos.x += Math.sin(n.yaw) * n.v * dt;
        n.pos.z += Math.cos(n.yaw) * n.v * dt;
        m.speed = n.v;
        if (n.mode === 'walk') n.paused = Math.max(n.paused, 0.3);
        if (facing) m.breath -= dt; // and holds still, even its breath
        break;
      }
    }
  }

  private summonWatcher(player: THREE.Vector3, camPos: THREE.Vector3) {
    const fwd = new THREE.Vector3().subVectors(player, camPos).setY(0).normalize();
    const options = this.lampCandidates.filter((l) => {
      const to = new THREE.Vector3(l.pos.x - player.x, 0, l.pos.z - player.z);
      const d = to.length();
      return d > 30 && d < 60 && to.normalize().dot(fwd) > 0.85;
    });
    if (!options.length) {
      this.unease = 20; // try again soon
      return;
    }
    const lamp = this.rng.pick(options);
    this.watcherLamp = lamp;
    // on the pavement under the lamp (avenue lamps hang over the road), facing you
    const onAvenue = Math.abs(lamp.pos.x) < 14;
    this.watcher.pos.set(onAvenue ? Math.sign(lamp.pos.x) * 10.9 : lamp.pos.x + (lamp.pos.x > 0 ? 0.9 : -0.9), 0.15, lamp.pos.z + (onAvenue ? 0 : 0.9));
    this.watcher.yaw = Math.atan2(player.x - this.watcher.pos.x, player.z - this.watcher.pos.z);
    this.watcher.visible = true;
    this.watcher.timer = 75;
    this.watcherSeen = 0;
  }

  private watch(n: Npc, dt: number, player: THREE.Vector3 | null) {
    if (!n.visible) return;
    const m = n.motion;
    m.speed = 0;
    m.lookPitch = 0.05;
    m.armL = m.armR = 'free';
    n.timer -= dt;
    if (!player) {
      n.visible = false;
      return;
    }
    const d = n.pos.distanceTo(player);
    const inView = this.frustum.containsPoint(_tmp.copy(n.pos).setY(1.2));
    if (inView) this.watcherSeen += dt;
    // it never lets you reach it; and once seen, it leaves when you look away
    const gone = d < 14 || n.timer <= 0 || (this.watcherSeen > 2 && !inView);
    if (gone) {
      n.visible = false;
      if (this.watcherLamp && d < 20) {
        const l = this.watcherLamp;
        const was = l.flicker;
        l.flicker = 4;
        setTimeout(() => (l.flicker = was), 1400);
      }
      this.watcherLamp = null;
    }
  }

  private freezeSomeone(player: THREE.Vector3) {
    const pool = this.npcs.filter((n) => n.visible && n.mode !== 'watcher' && n.mode !== 'sit' && n.frozen <= 0 && n.pos.distanceTo(player) < 45 && n.pos.distanceTo(player) > 8);
    if (!pool.length) return;
    const n = this.rng.pick(pool);
    n.frozen = this.rng.range(45, 90);
    n.motion.speed = 0;
    n.v = 0;
    // facing the wall, or facing you from too far away
    n.wrongYaw = this.rng.chance(0.5) ? Math.PI : wrap(Math.atan2(player.x - n.pos.x, player.z - n.pos.z) - n.yaw);
    n.motion.lookYaw = 0;
  }

  private glitchSomeone(player: THREE.Vector3, camPos: THREE.Vector3) {
    const pool = this.npcs.filter((n) => {
      if (!n.visible || n.mode === 'watcher') return false;
      const d = n.pos.distanceTo(player);
      return d > 5 && d < 22 && this.frustum.containsPoint(_tmp.copy(n.pos).setY(1.5));
    });
    void camPos;
    if (!pool.length) {
      this.unease = 30;
      return;
    }
    const n = this.rng.pick(pool);
    n.glitchT = 0.9;
    n.motion.glitchKind = this.rng.int(0, 2);
  }
}

const _tmp = new THREE.Vector3();

function prepRoute(r: Route) {
  const pts = r.pts.map(([x, z]) => new THREE.Vector2(x, z));
  if (r.loop) pts.push(pts[0].clone());
  const lens: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = pts[i].distanceTo(pts[i + 1]);
    lens.push(l);
    total += l;
  }
  return { pts, lens, total, loop: !!r.loop };
}

const _p = new THREE.Vector2();
const _d = new THREE.Vector2();
function samplePath(r: ReturnType<typeof prepRoute>, s: number) {
  let acc = 0;
  for (let i = 0; i < r.lens.length; i++) {
    if (s <= acc + r.lens[i] || i === r.lens.length - 1) {
      const t = r.lens[i] ? (s - acc) / r.lens[i] : 0;
      _p.lerpVectors(r.pts[i], r.pts[i + 1], THREE.MathUtils.clamp(t, 0, 1));
      _d.subVectors(r.pts[i + 1], r.pts[i]).normalize();
      return { p: _p, dir: _d };
    }
    acc += r.lens[i];
  }
  return { p: _p.copy(r.pts[0]), dir: _d.set(0, 1) };
}

function wrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function inRange(a: THREE.Vector3, b: THREE.Vector3, lo: number, hi: number) {
  const d = Math.hypot(a.x - b.x, a.z - b.z);
  return d >= lo && d <= hi;
}
