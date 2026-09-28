import * as THREE from 'three';
import { LOD, newMotion, newRig, randomBody, randomOutfit, solve, stepPhase, visibleParts, type Body, type Motion, type Outfit, type PartKey, type Rig } from './Humanoid';
import { FigureBatch } from './FigureBatch';
import { ROUTES, type Route } from '../world/layout';
import type { Lamp, NpcSpot } from '../world/WorldContext';
import { mulberry32 } from '../world/rng';
import { randomVoice, type VoiceSpec } from '../audio/Voice';
import type { Bark } from '../data/barks';

type Mode = NpcSpot['mode'] | 'walk' | 'watcher' | 'cop' | 'crook';

/** police on foot, kept at the end of the list (never in city snapshots: wanted levels are yours alone) */
const COPS = 6;
/** criminals, kept after the police (also never in snapshots) */
const CROOKS = 4;
type CrookState = 'idle' | 'approach' | 'flee' | 'hostile' | 'loiter';

export interface Npc {
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
  private rng = mulberry32(77);
  /** everyone but the police and the criminals */
  citizens = 0;
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
        const n = this.make('walk', new THREE.Vector3(), 0, route.id === 'yard' ? 'workwear' : undefined);
        n.route = r;
        n.s = rng.range(0, r.total);
        n.dir = rng.chance(0.5) ? 1 : -1;
        n.speed = rng.range(1.0, 1.6);
        n.lateral = rng.range(-0.45, 0.45);
        n.outfit.umbrella = rng.chance(0.4);
        n.motion.armR = n.outfit.umbrella ? 'umbrella' : rng.chance(0.4) ? 'pockets' : 'free';
        n.motion.armL = n.motion.armR === 'pockets' || rng.chance(0.3) ? 'pockets' : 'free';
        this.npcs.push(n);
      }
    }
    for (const s of spots) {
      const n = this.make(s.mode, s.pos.clone(), s.yaw);
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

    // the one who is always somewhere they shouldn't be
    this.watcher = this.make('watcher', new THREE.Vector3(), 0, 'raincoat');
    this.watcher.outfit.top = 0x8a8e8c;
    this.watcher.outfit.hair = 'hood';
    this.watcher.outfit.hairColor = 0x8a8e8c;
    this.watcher.outfit.scarf = false;
    this.watcher.outfit.bag = false;
    this.watcher.body.height = 1.08;
    this.watcher.body.girth = 0.9;
    this.watcher.visible = false;
    this.npcs.push(this.watcher);
    this.citizens = this.npcs.length;
    // the police, off duty until someone gives them a reason
    for (let i = 0; i < COPS; i++) {
      const c = this.make('cop', new THREE.Vector3(0, -50, 0), 0, 'jacket');
      Object.assign(c.outfit, { top: 0x18213a, legs: 0x12141c, shoes: 0x0b0b0c, accent: 0x2a3550, hair: 'cap', hairColor: 0x10131c, scarf: false, bag: false, umbrella: false, hem: false, skirt: false });
      c.visible = false;
      c.hp = 60;
      this.npcs.push(c);
    }
    this.crooksFrom = this.npcs.length;
    // and the people the police are really for
    for (let i = 0; i < CROOKS; i++) {
      const c = this.make('crook', new THREE.Vector3(0, -50, 0), 0, 'hoodie');
      Object.assign(c.outfit, { top: [0x1a1a1c, 0x2a2420, 0x1c2228, 0x3a1414][i], legs: 0x15161a, accent: 0x7a1c16, hair: 'hood', hairColor: [0x1a1a1c, 0x2a2420, 0x1c2228, 0x3a1414][i], hoodDown: false, scarf: false, bag: false, umbrella: false, hem: false, skirt: false });
      c.visible = false;
      c.hp = 70;
      c.crook = { state: 'idle', victim: null, t: 0, ax: 0, az: 0 };
      this.npcs.push(c);
    }
    this.lampCandidates = lamps.filter((l) => l.pooled && !l.dynamic && l.pos.y > 3.5 && l.color.r > 0.9 && l.color.b < 0.6);

    this.batch = new FigureBatch(this.npcs.length);
    this.group.add(this.batch.group);
    this.npcs.forEach((n, i) => {
      this.batch.dress(i, n.outfit, n.motion.armR === 'smoke' ? 0xff7a30 : 0xbfd4ff);
      n.parts = visibleParts(n.outfit, 0);
    });
  }

  private make(mode: Mode, pos: THREE.Vector3, yaw: number, garment?: Outfit['garment']): Npc {
    const rng = this.rng;
    const body = randomBody(rng);
    const outfit = randomOutfit(rng, garment);
    const motion = newMotion();
    motion.slouch = rng.range(-0.04, 0.1);
    motion.stride = rng.range(0.85, 1.15);
    motion.armSwing = rng.range(0.6, 1.25);
    motion.phase = rng.range(0, 10);
    motion.breath = rng.range(0, 10);
    motion.weight = rng.range(-1, 1);
    return {
      mode, pos, yaw, body, outfit, motion, rig: newRig(), lod: -1, parts: new Set(),
      timer: rng.range(2, 8), s: 0, dir: 1, lateral: 0, speed: 0, v: 0, paused: 0, hidden: 0,
      lookT: rng.range(2, 6), lookTarget: 0, visible: true, frozen: 0, wrongYaw: 0, glitchT: 0, glowOn: false,
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
      if (d < nd) (near = n), (nd = d);
    }
    // one of them answers back, not the whole street
    if (byPlayer && near && Math.random() < 0.6) this.say(near, 'honked');
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
      if (d < nd) (near = n), (nd = d);
    }
    if (near) this.say(near, 'crash');
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
  damage(i: number, dmg: number, from: THREE.Vector3): boolean {
    const n = this.npcs[i];
    if (!n || n.dead >= 0) return false;
    n.hp -= dmg;
    this.scatter(n.pos.x, n.pos.z, 26, from);
    if (n.hp > 0) {
      n.recoil = 0.25;
      const dx = n.pos.x - from.x, dz = n.pos.z - from.z, d = Math.hypot(dx, dz) || 1;
      n.recoilX = dx / d;
      n.recoilZ = dz / d;
      this.say(n, 'hurt', true);
      return false;
    }
    n.dead = 0;
    n.frozen = 0;
    n.motion.speed = 0;
    return true;
  }

  /** Gunfire at (x,z): people run from `from` (walkers) or freeze with their hands up. */
  scatter(x: number, z: number, radius: number, from: THREE.Vector3) {
    let near: Npc | null = null, nd = radius;
    for (const n of this.npcs) {
      if (!this.canReact(n)) continue;
      const d = Math.hypot(n.pos.x - x, n.pos.z - z);
      if (d > radius) continue;
      if (n.panic <= 0) n.baseArms = [n.motion.armL, n.motion.armR];
      n.panic = 9 + Math.random() * 5;
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
      n.yaw = Math.atan2(dx, dz);
      const v = d > 11 ? 4.4 : 0;
      n.pos.x += (dx / d) * v * dt;
      n.pos.z += (dz / d) * v * dt;
      n.pos.y += (player.y - n.pos.y) * Math.min(1, dt * 2);
      n.v = v;
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
  /** how often the quiet unsettling moments come (1 = normal, 0 = never) */
  uneaseRate = 1;

  /** Keep a share of ordinary people in the streets (population setting). */
  setDensity(k: number) {
    for (let i = 0; i < this.citizens; i++) {
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

  update(dt: number, t: number, player: THREE.Vector3 | null, camera: THREE.Camera) {
    if (!this.enabled) return;
    const camPos = camera.position;
    this.pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pm);
    if (player && !this.puppet) this.direct(dt, player, camPos);
    if (player) this.listen(dt, player, camera);
    this.policeUpdate(dt, player, this.wanted, this.spawnAt);
    this.crooksUpdate(dt, player);

    this.npcs.forEach((n, i) => {
      if (n.culled) {
        if (n.lod !== -1 || n.visible) {
          n.visible = false;
          this.batch.hide(i);
          n.lod = -1;
        }
        return;
      }
      if (n.dead >= 0) this.down(n, dt, player);
      else if (n.mode === 'cop' || n.mode === 'crook') {
        /* policeUpdate / crooksUpdate moved them */
      } else if (this.puppet && n.net) {
        this.follow(n, dt);
        if (n.mode !== 'walk' && n.mode !== 'watcher' && n.visible) this.stand(n, dt, t, player); // idle animation only
      } else if (n.mode === 'walk' && n.route) this.walk(n, dt, player);
      else if (n.mode === 'watcher') this.watch(n, dt, player);
      else this.stand(n, dt, t, player);
      if (n.dead < 0) this.react(n, dt);
      if (n.dead < 0) this.panicUpdate(n, dt);
      if (!n.visible) {
        this.batch.hide(i);
        n.lod = -1;
        return;
      }
      const d = n.pos.distanceTo(camPos);
      // far standing figures don't need a new pose every frame
      if (d > 150 && n.mode !== 'walk' && n.lod === 2 && (i + Math.floor(t * 10)) % 6 !== 0) return;
      const lod = d < LOD.near ? 0 : d < LOD.mid ? 1 : 2;
      if (lod !== n.lod) {
        n.lod = lod;
        n.parts = visibleParts(n.outfit, d);
      }
      // unease: a moment where a body moves the way a body shouldn't
      if (n.glitchT > 0) {
        n.glitchT -= dt;
        const k = 1 - Math.abs(1 - n.glitchT / 0.45);
        n.motion.glitch = Math.max(0, Math.min(1, k * 1.6));
      } else n.motion.glitch = 0;

      this.q.setFromAxisAngle(this.up, n.yaw + n.wrongYaw);
      this.scl.setScalar(n.body.height);
      if (n.dead >= 0) {
        // on their back, where they fell
        const k = Math.min(1, n.dead * 3);
        this.q.multiply(this.qDown.setFromAxisAngle(this.side, -Math.PI / 2 * k));
        this.tmpDown.copy(n.pos).setY(n.pos.y + 0.14 * k);
        this.root.compose(this.tmpDown, this.q, this.scl);
      } else this.root.compose(n.pos, this.q, this.scl);
      solve(n.rig, this.root, n.body, n.outfit, n.motion, t);
      this.batch.write(i, n.rig, n.parts, n.glowOn);
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
    } else if (rng.next() < dt * 0.018) {
      n.paused = rng.range(2, 5); // stop, look around, carry on
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
    m.lookYaw += (THREE.MathUtils.clamp(wrap(n.lookTarget), -1.1, 1.1) - m.lookYaw) * Math.min(1, dt * 3);
    if (n.paused <= 0 && n.lookTarget !== 0 && rng.next() < dt * 0.5) n.lookTarget *= 0.5;
    m.lookPitch = n.outfit.umbrella ? 0.08 : m.armR === 'pockets' ? 0.1 : 0;

    if (n.panic > 0) target = 5;
    n.v += (target - n.v) * Math.min(1, dt * 2.5);
    m.speed = n.v;
    stepPhase(m, dt);
    n.s += n.v * dt * n.dir;
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

  private stand(n: Npc, dt: number, t: number, player: THREE.Vector3 | null) {
    const m = n.motion;
    const rng = this.rng;
    n.timer -= dt;
    m.speed = 0;
    m.turn = 0;
    if (n.frozen > 0) {
      n.frozen -= dt;
      if (n.frozen <= 0) n.wrongYaw = 0;
      return; // nothing moves. not the chest, not the head.
    }
    m.breath += dt * 1.2;
    // weight moves from one leg to the other every few seconds
    m.weight += (Math.sin(t * 0.13 + n.timer * 0.1 + n.pos.x) - m.weight) * dt * 0.4;
    switch (n.mode) {
      case 'phone':
        m.lookPitch = 0.5;
        m.lookYaw = Math.sin(t * 0.3 + n.pos.z) * 0.08;
        n.glowOn = true;
        break;
      case 'smoke': {
        if (n.timer < 0) n.timer = rng.range(6, 11);
        const k = n.timer < 2.2 ? Math.sin(((2.2 - n.timer) / 2.2) * Math.PI) : 0;
        m.smokeT = Math.min(1, k * 1.4);
        n.glowOn = m.smokeT > 0.35; // the ember only shows at the lips
        m.lookYaw = Math.sin(t * 0.2 + n.pos.x) * 0.5;
        m.lookPitch = -0.05 * m.smokeT;
        break;
      }
      case 'look':
        if (n.timer < 0) {
          n.timer = rng.range(2.5, 6);
          n.lookTarget = rng.range(-1.1, 1.1);
        }
        m.lookYaw += (n.lookTarget - m.lookYaw) * Math.min(1, dt * 2);
        m.lookPitch = Math.sin(t * 0.15 + n.pos.x) * 0.1 - 0.04;
        break;
      case 'wait':
        if (n.timer < 0) n.timer = rng.range(5, 10);
        m.armL = n.timer < 1.4 ? 'watch' : 'pockets';
        m.lookPitch = n.timer < 1.4 ? 0.55 : 0;
        m.lookYaw += ((n.timer > 6 ? 0.6 : 0) - m.lookYaw) * dt; // down the street, for the bus
        break;
      case 'talk':
        if (n.timer < 0) n.timer = rng.range(1.5, 4);
        m.armL = n.timer < 1.2 ? 'gesture' : 'free';
        m.lookPitch = Math.sin(t * 2.1 + n.pos.x) * 0.05;
        m.lookYaw = Math.sin(t * 0.5 + n.pos.z) * 0.15;
        break;
      case 'sit':
        m.sit = 1;
        m.lookPitch = 0.05;
        m.lookYaw = Math.sin(t * 0.1 + n.pos.x) * 0.3;
        break;
      case 'stare':
        m.lookPitch = -0.1;
        m.lookYaw = 0;
        m.breath -= dt * 1.2; // too still
        break;
    }
    // people notice you when you're close — except the ones who never look away
    if (player && n.mode !== 'stare' && n.mode !== 'sit') {
      const dx = player.x - n.pos.x, dz = player.z - n.pos.z;
      if (dx * dx + dz * dz < 3.4 * 3.4) {
        const want = THREE.MathUtils.clamp(wrap(Math.atan2(dx, dz) - n.yaw), -1.2, 1.2);
        m.lookYaw += (want - m.lookYaw) * Math.min(1, dt * 2.5);
        m.lookPitch *= 0.9;
      }
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
    if (roll < 0.4) this.summonWatcher(player, camPos);
    else if (roll < 0.7) this.freezeSomeone(player);
    else this.glitchSomeone(player, camPos);
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
