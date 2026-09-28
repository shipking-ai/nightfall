import * as THREE from 'three';
import { FigureBatch } from '../entities/FigureBatch';
import { makePerson } from '../data/people';
import { mulberry32 } from '../world/rng';
import type { Body, Outfit } from '../entities/Humanoid';
import type { AudioEngine } from '../audio/AudioEngine';
import type { Input } from '../core/Input';
import type { Collision, Box } from '../world/Collision';
import type { Player } from '../entities/Player';
import type { FollowCamera } from '../camera/FollowCamera';
import type { Tracers } from '../fx/Tracers';
import type { Blood } from '../fx/Blood';
import { NavGrid } from './warzone/NavGrid';
import { Soldier, chestY, headY, wrap, type Battle, type CapturePoint, type Unit } from './warzone/Soldier';
import { GunMeshes } from './warzone/Guns';
import { Viewmodel } from './warzone/Viewmodel';
import { ARMOR_SOAK, GUNS, LOADOUTS, MAX_ARMOR, damageAt, type Gun, type GunId, type Loadout } from './warzone/weapons';
import { WarzoneHud } from '../ui/WarzoneHud';

/**
 * WARZONE: Domination in Pier 9 Yard, six against six. The same yard you can
 * walk into in the City at night: the container stacks are the cover, the
 * lanes between them are the sight lines, the gantry legs are where you
 * stop to reload. Three points: A in the south strip, B in the gap in the
 * middle of the stacks, C by the gate on Harbor Lane. Hold them to score.
 *
 * The match layer: teams, the points and the score, spawning, the player's
 * guns (recoil, spread, reloads, aim assist), first person or over the
 * shoulder, bot shots, damage and armor, pickups, the kill feed. The bots
 * think for themselves (warzone/Soldier.ts).
 */

/** the playing area: the fenced yard, up to the lane by the gate */
export const YARD_BOUNDS = { x0: 40, z0: -28, x1: 101.5, z1: 60.5 };
const SCORE_LIMIT = 150;
const MATCH_TIME = 6 * 60;
const TICK = 2;
const RESPAWN = 5;
const TEAM_NAMES = ['Blue', 'Red'] as const;
const CALLSIGNS = ['Hale', 'Okafor', 'Brandt', 'Voss', 'Ruiz', 'Kimura', 'Doyle', 'Sato', 'Lindqvist', 'Marsh', 'Abara', 'Petrov', 'Quinn', 'Reyes', 'Novak', 'Ferreira'];

const POINTS: [CapturePoint['id'], number, number][] = [
  ['A', 92, -20],
  ['B', 68.5, 9],
  ['C', 46, 44],
];
/** where each side comes in: blue in the south-west corner, red on the lane in the north-east */
const SPAWNS: [number, number, number, number][] = [
  [48, -27, 60, -23],
  [89, 52, 100, 59],
];
/** fixed resupply: ammo on the lanes, armor in the side strips */
const STATIONS: ['ammo' | 'armor', number, number][] = [
  ['ammo', 68.5, -24],
  ['ammo', 68.5, 42],
  ['armor', 43.5, 9],
  ['armor', 95, 9],
];
const SLEEVE = [0x2c3644, 0x4a3128];

export interface WarzoneHost {
  audio: AudioEngine;
  input: Input;
  collision: Collision;
  ui: HTMLElement;
  camera: THREE.PerspectiveCamera;
  follow: FollowCamera;
  player: Player;
  tracers: Tracers;
  blood: Blood;
  aimAssist(): 'off' | 'low' | 'standard';
  hurtFlash(k: number): void;
  onModes(): void;
  onLeave(): void;
}

/** You, as the match sees you. */
class Me implements Unit {
  team: 0 | 1 = 0;
  name = 'You';
  isPlayer = true;
  alive = true;
  hp = 100;
  armor = MAX_ARMOR;
  kills = 0;
  deaths = 0;
  caps = 0;
  sinceShot = 99;
  constructor(private p: Player) {}
  get pos() {
    return this.p.pos;
  }
  get vel() {
    return this.p.vel;
  }
  get crouch() {
    return this.p.crouching ? 1 : 0;
  }
}

interface Pickup {
  kind: 'ammo' | 'armor';
  pos: THREE.Vector3;
  /** seconds left on the ground (dropped), or until it's back (a station) */
  t: number;
  station: boolean;
  up: boolean;
}

type Phase = 'idle' | 'loadout' | 'play' | 'over';

export class Warzone {
  group = new THREE.Group();
  active = false;
  hud: WarzoneHud;
  me: Me;
  bots: Soldier[] = [];
  private units: Unit[] = [];
  private batch = new FigureBatch(11);
  private guns = new GunMeshes(12);
  private vm = new Viewmodel();
  private nav: NavGrid | null = null;
  private walls: Box[] = [];
  private points: CapturePoint[] = POINTS.map(([id, x, z]) => ({ id, pos: new THREE.Vector3(x, 0, z), owner: -1, cap: 0, capTeam: -1, contested: false, radius: 5 }));
  private pointMeshes: { ring: THREE.Mesh; disc: THREE.Mesh; pillar: THREE.Mesh }[] = [];
  private pickups: Pickup[] = [];
  private pickupMesh: Record<'ammo' | 'armor', THREE.InstancedMesh>;
  private score: [number, number] = [0, 0];
  private clock = MATCH_TIME;
  private tickT = 0;
  private phase: Phase = 'idle';
  skill = 0.5;
  /** first person (the default) or over the shoulder */
  firstPerson = true;
  // your guns
  loadout: Loadout = LOADOUTS[0];
  private slot = 0;
  private held: [GunId, GunId] = ['carbine', 'pistol'];
  private mag: [number, number] = [30, 12];
  private reserve: [number, number] = [120, 48];
  private reloadT = 0;
  private switchT = 0;
  private cool = 0;
  private bloom = 0;
  private sinceFire = 99;
  private sinceHurt = 99;
  private recoilDebt = 0;
  private wasAiming = false;
  private deadT = 0;
  private killedBy: { name: string; gun: string; head: boolean } | null = null;
  private baseFov = 62;
  private eyeY = 1.6;
  private muzzle = new THREE.Vector3();
  private battle: Battle;
  private rng = mulberry32(1717);
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private hintT = 0;

  constructor(private host: WarzoneHost) {
    this.me = new Me(host.player);
    this.group.add(this.batch.group, this.guns.group, this.vm.group);
    this.group.visible = false;
    // the points: a ring on the ground, a faint disc, a thin beam of light
    for (const p of this.points) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(p.radius - 0.25, p.radius, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false, fog: false }));
      const disc = new THREE.Mesh(new THREE.CircleGeometry(p.radius - 0.25, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, depthWrite: false }));
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 9, 8, 1, true).translate(0, 4.5, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      for (const m of [ring, disc, pillar]) {
        m.position.copy(p.pos);
        m.position.y = 0.04;
        this.group.add(m);
      }
      this.pointMeshes.push({ ring, disc, pillar });
    }
    const box = (kind: 'ammo' | 'armor') => {
      const g = kind === 'ammo' ? new THREE.BoxGeometry(0.55, 0.3, 0.35) : new THREE.BoxGeometry(0.45, 0.55, 0.08);
      const mat = new THREE.MeshStandardMaterial({ color: kind === 'ammo' ? 0x4a5236 : 0x3a4656, roughness: 0.6, emissive: kind === 'ammo' ? 0x8a7a40 : 0x3a78c0, emissiveIntensity: kind === 'ammo' ? 0.22 : 0.45 });
      const m = new THREE.InstancedMesh(g, mat, 32);
      m.count = 0;
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    };
    this.pickupMesh = { ammo: box('ammo'), armor: box('armor') };
    this.hud = new WarzoneHud(host.ui, {
      again: () => this.again(),
      level: () => this.cycleSkill(),
      modes: () => host.onModes(),
      leave: () => host.onLeave(),
    });
    this.hud.level(this.skillName);
    this.battle = {
      units: this.units,
      points: this.points,
      nav: null as unknown as NavGrid,
      col: host.collision,
      sees: (a, b) => this.sees(a, b),
      fire: (s, t, hit, head) => this.botFire(s, t, hit, head),
      home: (team) => this.spawnCentre(team),
      skill: this.skill,
    };
  }

  /* ─────────────────────────── the match ─────────────────────────── */

  start(face: { outfit: Outfit; body: Body }) {
    this.active = true;
    this.group.visible = true;
    // the boundary: the yard's own fences, and the open sides closed off
    const c = this.host.collision, B = YARD_BOUNDS;
    this.walls = [
      c.add(B.x0 - 0.4, 0, B.z0, B.x0, 4, B.z1, false),
      c.add(B.x1, 0, B.z0, B.x1 + 0.4, 4, B.z1, false),
      c.add(B.x0, 0, B.z0 - 0.4, B.x1, 4, B.z0, false),
      c.add(B.x0, 0, B.z1, B.x1, 4, B.z1 + 0.4, false),
    ];
    this.nav ??= new NavGrid(c, B.x0, B.z0, B.x1, B.z1, 0.38);
    this.battle.nav = this.nav;
    // you, in fatigues, with your own face
    const r = mulberry32(77);
    const kit = makePerson(r, 'soldier');
    const o = this.teamKit(kit.outfit, 0);
    o.skin = face.outfit.skin;
    o.hair = face.outfit.hair === 'long' ? 'bun' : face.outfit.hair;
    o.hairColor = face.outfit.hairColor;
    o.facialHair = face.outfit.facialHair;
    o.glasses = face.outfit.glasses;
    this.host.player.wear(o, face.body);
    this.host.player.canCrouch = true;
    this.host.player.gun.visible = false;
    this.lookRange();
    this.makeBots();
    this.baseFov = this.host.camera.fov;
    this.hud.show(true);
    this.newMatch();
  }

  stop() {
    this.active = false;
    this.group.visible = false;
    this.phase = 'idle';
    this.host.collision.remove(this.walls);
    this.walls = [];
    this.hud.show(false);
    const p = this.host.player, f = this.host.follow;
    p.canCrouch = false;
    p.armPose = p.armPoseL = null;
    p.aimYaw = null;
    p.speedMul = 1;
    p.busy = false;
    p.anim.clear();
    p.hidden = false;
    p.lookPitch = 0;
    this.vm.visible = false;
    f.pitchMin = -0.55;
    f.pitchMax = 1.0;
    f.pitch = THREE.MathUtils.clamp(f.pitch, -0.55, 1.0);
    f.aim = false;
    this.host.input.aiming = false;
    this.host.input.aimSlow = 0;
    this.host.camera.fov = this.baseFov;
    this.host.camera.updateProjectionMatrix();
  }

  /** First person can look further up and down than the shoulder camera. */
  private lookRange() {
    const f = this.host.follow;
    f.pitchMin = this.firstPerson ? -1.3 : -0.55;
    f.pitchMax = this.firstPerson ? 1.3 : 1.0;
    f.pitch = THREE.MathUtils.clamp(f.pitch, f.pitchMin, f.pitchMax);
  }

  private teamKit(o: Outfit, team: 0 | 1): Outfit {
    const blue = team === 0;
    return {
      ...o,
      top: SLEEVE[team],
      legs: blue ? 0x262a30 : 0x302a26,
      vest: blue ? 0x28313c : 0x3a2c24,
      vestBand: blue ? 0x3f7ac0 : 0xc0503a,
      accent: blue ? 0x3f7ac0 : 0xc0503a,
      hat: o.hat === 'cap' || o.hat === 'beanie' ? o.hat : 'none',
      hatColor: blue ? 0x232a33 : 0x33251f,
      umbrella: false,
      bag: false,
      backpack: null,
      scarf: false,
    };
  }

  private makeBots() {
    if (this.bots.length) return;
    const names = [...CALLSIGNS];
    for (let i = 0; i < 11; i++) {
      const team: 0 | 1 = i < 5 ? 0 : 1;
      const p = makePerson(this.rng, 'soldier');
      const o = this.teamKit(p.outfit, team);
      const lo = LOADOUTS[Math.floor(this.rng.next() * LOADOUTS.length)];
      const name = names.splice(Math.floor(this.rng.next() * names.length), 1)[0];
      const s = new Soldier(team, name, p.body, o, lo.primary);
      this.batch.dress(i, o, 0x9fc4ff, p.body);
      this.bots.push(s);
    }
  }

  private newMatch() {
    this.score = [0, 0];
    this.clock = MATCH_TIME;
    this.tickT = TICK;
    for (const p of this.points) Object.assign(p, { owner: -1, cap: 0, capTeam: -1, contested: false });
    this.units.length = 0;
    this.units.push(this.me, ...this.bots);
    for (const u of this.units) u.kills = u.deaths = u.caps = 0;
    this.pickups = STATIONS.map(([kind, x, z]) => ({ kind, pos: new THREE.Vector3(x, 0, z), t: 0, station: true, up: true }));
    for (const b of this.bots) this.spawnBot(b);
    this.hud.showEnd(null);
    this.hud.feedClear();
    this.hintT = 0;
    this.hud.showHints(true);
    this.phase = 'loadout';
    this.me.alive = false;
    this.deadT = RESPAWN;
    this.killedBy = null;
    this.hud.loadout(true, LOADOUTS, LOADOUTS.indexOf(this.loadout), true);
    this.placeForPreview();
  }

  private again() {
    this.newMatch();
  }

  private cycleSkill() {
    this.skill = this.skill < 0.3 ? 0.5 : this.skill < 0.7 ? 0.9 : 0.2;
    this.battle.skill = this.skill;
    this.hud.level(this.skillName);
    this.host.audio.uiTick();
  }

  get skillName() {
    return this.skill < 0.3 ? 'Recruit' : this.skill < 0.7 ? 'Regular' : 'Veteran';
  }

  /** Before you deploy: stand at the spawn (the camera looks out over the yard). */
  private placeForPreview() {
    const [x, z] = this.spawnSpot(0);
    const p = this.host.player;
    p.place(x, this.host.collision.groundAt(x, z, 2, 3, 0.3), z, this.faceInto(x, z));
    p.anim.clear();
    p.busy = true;
    this.host.follow.alignBehind(p);
    this.host.follow.snap(p, this.host.collision);
  }

  private spawnCentre(team: 0 | 1) {
    const s = SPAWNS[team];
    return this.tmp2.set((s[0] + s[2]) / 2, 0, (s[1] + s[3]) / 2);
  }

  /** Somewhere in the team's spawn that's walkable and not in an enemy's face. */
  private spawnSpot(team: 0 | 1): [number, number] {
    const s = SPAWNS[team];
    let best: [number, number] = [(s[0] + s[2]) / 2, (s[1] + s[3]) / 2], bestD = -1;
    for (let k = 0; k < 8; k++) {
      const x = s[0] + Math.random() * (s[2] - s[0]), z = s[1] + Math.random() * (s[3] - s[1]);
      if (this.nav && !this.nav.walkable(x, z)) continue;
      let near = Infinity;
      for (const u of this.units) if (u.alive && u.team !== team) near = Math.min(near, Math.hypot(u.pos.x - x, u.pos.z - z));
      if (near > bestD) (bestD = near), (best = [x, z]);
    }
    return best;
  }

  /** Facing into the yard from a spawn (towards B). */
  private faceInto(x: number, z: number) {
    return Math.atan2(68.5 - x, 9 - z);
  }

  private spawnBot(b: Soldier) {
    const [x, z] = this.spawnSpot(b.team);
    const lo = LOADOUTS[Math.floor(Math.random() * LOADOUTS.length)];
    b.spawn(x, z, this.host.collision.groundAt(x, z, 2, 3, 0.3), this.faceInto(x, z), lo.primary);
  }

  /** Into the fight with the chosen loadout. */
  private deploy() {
    const lo = this.loadout;
    this.held = [lo.primary, lo.secondary];
    this.slot = 0;
    this.mag = [GUNS[lo.primary].mag, GUNS[lo.secondary].mag];
    this.reserve = [GUNS[lo.primary].reserve, GUNS[lo.secondary].reserve];
    this.reloadT = this.switchT = this.cool = this.bloom = this.recoilDebt = 0;
    const me = this.me;
    me.alive = true;
    me.hp = 100;
    me.armor = MAX_ARMOR;
    const [x, z] = this.spawnSpot(0);
    const p = this.host.player;
    p.anim.clear();
    p.busy = false;
    p.place(x, this.host.collision.groundAt(x, z, 2, 3, 0.3), z, this.faceInto(x, z));
    this.host.follow.alignBehind(p);
    this.host.follow.pitch = 0.05;
    this.host.follow.snap(p, this.host.collision);
    this.hud.loadout(false);
    this.hud.death(null);
    this.phase = 'play';
    this.switchT = 0.45;
    p.act('gun.switch');
  }

  /* ─────────────────────────── a frame ─────────────────────────── */

  /** `live`: playing and not paused. The bodies are drawn either way. */
  update(dt: number, t: number, live: boolean) {
    if (!this.active) return;
    this.hud.el.classList.toggle('is-paused', !live);
    if (live) {
      this.battle.skill = this.skill;
      if (this.phase === 'play' || this.phase === 'loadout') {
        this.playerGuns(dt);
        for (const b of this.bots) {
          b.update(dt, this.battle);
          if (!b.alive && (b.respawnT -= dt) <= 0) this.spawnBot(b);
        }
        this.separate();
        this.pointsUpdate(dt);
        this.pickupsUpdate(dt);
        this.respawnFlow(dt);
        if (this.phase === 'play') {
          this.clock -= dt;
          if (this.clock <= 0 || this.score[0] >= SCORE_LIMIT || this.score[1] >= SCORE_LIMIT) this.over();
        }
      }
      if ((this.hintT += dt) > 16) this.hud.showHints(false);
      if (this.host.input.held('scoreboard') && this.phase !== 'over') this.hud.scoreboard(this.units, this.score);
      else this.hud.scoreboard(null, this.score);
    }
    // bodies and guns
    const cam = this.host.camera;
    this.bots.forEach((b, i) => {
      b.pose(live ? dt : 0, t);
      this.batch.write(i, b.rig, b.parts, false);
      this.guns.set(i + 1, b.alive ? b.gun.id : null, b.rig, b.yaw);
    });
    this.batch.flush();
    const p = this.host.player;
    const gun = this.gun;
    const fp = this.fpActive;
    p.hidden = fp;
    this.vm.visible = fp;
    this.guns.set(0, this.me.alive && this.phase === 'play' && !fp ? gun.id : null, p.rig, p.facing, this.muzzle);
    this.drawPoints(t);
    this.drawPickups(t);
    // the HUD
    this.hud.score(this.score, SCORE_LIMIT, this.clock);
    this.hud.points(this.points, this.me.team);
    this.hud.markers(this.points, cam, this.me);
    this.hud.tags(this.bots, cam, this.me);
    this.hud.vitals(this.me.hp, this.me.armor);
    const other = GUNS[this.held[1 - this.slot]];
    this.hud.weapon(gun.name, this.mag[this.slot], this.reserve[this.slot], other.name, this.reloadT > 0 ? 1 - this.reloadT / gun.reload : null);
    this.hud.update(dt);
  }

  /** Seeing it through your own eyes right now (alive, in the fight, first person on). */
  get fpActive() {
    return this.firstPerson && this.me.alive && this.phase === 'play';
  }

  /**
   * First person: the camera at your eyes, turned by the same look as the
   * shoulder camera (so aim, recoil and aim assist are all one thing). The
   * viewmodel follows it.
   */
  eyeCamera(dt: number) {
    const p = this.host.player, f = this.host.follow, cam = this.host.camera;
    const eye = (p.crouching ? 1.12 : 1.6) * p.body.height;
    this.eyeY += (eye - this.eyeY) * Math.min(1, dt * 12);
    const fx = Math.sin(f.yaw) * Math.cos(f.pitch), fy = -Math.sin(f.pitch), fz = Math.cos(f.yaw) * Math.cos(f.pitch);
    cam.position.set(p.pos.x + Math.sin(f.yaw) * 0.14, p.pos.y + this.eyeY, p.pos.z + Math.cos(f.yaw) * 0.14);
    cam.lookAt(cam.position.x + fx, cam.position.y + fy, cam.position.z + fz);
    this.vm.update(dt, cam, {
      aim: this.host.follow.aim,
      speed: p.speed,
      sprint: p.sprinting,
      reload: this.reloadT > 0 ? 1 - this.reloadT / this.gun.reload : null,
      swap: this.switchT,
      yaw: f.yaw,
      pitch: f.pitch,
      crouch: p.crouching,
    });
    this.vm.muzzle(this.muzzle);
  }

  get gun(): Gun {
    return GUNS[this.held[this.slot]];
  }

  /* ─────────────────────────── your guns ─────────────────────────── */

  private playerGuns(dt: number) {
    const inp = this.host.input, p = this.host.player, f = this.host.follow, cam = this.host.camera;
    const me = this.me;
    this.sinceHurt += dt;
    this.sinceFire += dt;
    me.sinceShot += dt;
    this.cool -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 0.12);
    // armor doesn't come back; health does, out of the fight
    if (me.alive && this.sinceHurt > 5 && me.hp < 100) me.hp = Math.min(100, me.hp + dt * 22);
    if (inp.pressed('screen')) {
      this.firstPerson = !this.firstPerson;
      this.lookRange();
      this.host.audio.uiTick();
    }
    if (!me.alive || this.phase !== 'play') {
      p.armPose = p.armPoseL = null;
      p.aimYaw = null;
      f.aim = false;
      inp.aiming = false;
      inp.aimSlow = 0;
      this.zoom(this.baseFov, dt);
      this.hud.crosshair(null);
      return;
    }
    const gun = this.gun;
    this.vm.setGun(gun.id, SLEEVE[this.me.team]);
    // switch, reload
    if (this.switchT > 0) this.switchT -= dt;
    if (inp.pressed('nextWeapon') || inp.pressed('prevWeapon')) {
      this.slot = 1 - this.slot;
      this.switchT = 0.45;
      this.reloadT = 0;
      p.act('gun.switch');
      this.host.audio.uiTick();
    }
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        this.reloadT = 0;
        const need = this.gun.mag - this.mag[this.slot];
        const take = Math.min(need, this.reserve[this.slot]);
        this.mag[this.slot] += take;
        this.reserve[this.slot] -= take;
        inp.rumble('reloadDone');
      }
    }
    const startReload = () => {
      if (this.reloadT > 0 || this.switchT > 0 || this.mag[this.slot] >= gun.mag || this.reserve[this.slot] <= 0) return;
      this.reloadT = gun.reload;
      p.anim.play('gun.reload', { group: 'reload', fadeIn: 0.1, fadeOut: 0.2, speed: 2.2 / gun.reload });
      inp.rumble('reload');
    };
    if (inp.pressed('reload')) startReload();
    // aim
    const aiming = inp.state('aim') && this.switchT <= 0 && !p.sprinting;
    inp.aiming = aiming;
    f.aim = aiming;
    this.zoom(aiming ? gun.zoom : this.baseFov, dt);
    p.speedMul = gun.weight * (aiming ? 0.62 : 1) * (this.reloadT > 0 ? 0.9 : 1);
    this.aimAssist(aiming);
    this.wasAiming = aiming;
    // fire
    const want = gun.auto ? inp.value('attack') > 0.35 : inp.pressed('attack');
    if (want && this.cool <= 0 && this.reloadT <= 0 && this.switchT <= 0 && !p.sprinting && inp.locked) {
      if (this.mag[this.slot] <= 0) startReload();
      else this.shoot(aiming);
    }
    // recoil settles back (most of it)
    if (this.recoilDebt > 0) {
      const back = Math.min(this.recoilDebt, dt * 0.09);
      this.recoilDebt -= back;
      f.pitch += back * 0.6;
    }
    // the body: gun up while aiming or just after a shot, at the ready otherwise
    const up = aiming || this.sinceFire < 0.7;
    if (gun.long) {
      p.armPose = up && this.reloadT <= 0 ? 'rifleAim' : 'rifle';
      p.armPoseL = p.armPose;
    } else {
      p.armPose = up ? 'aim' : null;
      p.armPoseL = null;
    }
    p.aimYaw = up || this.fpActive ? f.yaw : null;
    p.lookPitch = up ? -f.pitch * 0.8 : 0;
    // the crosshair: as wide as the spread really is
    const spread = this.spread(aiming);
    const px = (Math.tan(spread) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) * (innerHeight / 2);
    this.hud.crosshair({ spread: px, enemy: this.enemyUnderCrosshair(), aiming, fp: this.fpActive });
  }

  private zoom(fov: number, dt: number) {
    const cam = this.host.camera;
    const next = cam.fov + (fov - cam.fov) * Math.min(1, dt * 12);
    if (Math.abs(next - cam.fov) > 0.01) {
      cam.fov = next;
      cam.updateProjectionMatrix();
    }
  }

  private spread(aiming: boolean) {
    const g = this.gun, p = this.host.player;
    let s = (aiming ? g.ads : g.hip) + this.bloom;
    s += Math.min(0.03, p.speed * (aiming ? 0.0015 : 0.004));
    if (!p.grounded) s += 0.04;
    if (p.crouching) s *= 0.75;
    return s;
  }

  private shoot(aiming: boolean) {
    const gun = this.gun, p = this.host.player, f = this.host.follow, cam = this.host.camera, inp = this.host.input;
    this.mag[this.slot]--;
    this.cool = gun.rate;
    this.sinceFire = 0;
    this.me.sinceShot = 0;
    const spread = this.spread(aiming);
    this.bloom = Math.min(0.05, this.bloom + gun.bloom);
    const fwd = cam.getWorldDirection(this.dir);
    const skip = this.fpActive ? 0.25 : cam.position.distanceTo(p.pos) * 0.85;
    let anyHit = false, killed = false, headHit = false;
    for (let k = 0; k < gun.pellets; k++) {
      const dir = this.tmp.copy(fwd);
      // a random point in the cone
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
      const right = _r.set(fwd.z, 0, -fwd.x).normalize(), up = _u.crossVectors(right, fwd);
      dir.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      const o = _o.copy(cam.position).addScaledVector(dir, skip);
      const wall = this.host.collision.raycast(o, dir, 160);
      const hit = this.rayUnits(o, dir, wall, this.me.team);
      const end = _e.copy(o).addScaledVector(dir, hit ? hit.t : wall);
      if (k === 0 || k % 3 === 0) this.host.tracers.shot(this.muzzle, end, hit ? true : wall < 160);
      if (hit) {
        anyHit = true;
        headHit ||= hit.head;
        const dmg = damageAt(gun, hit.t + skip) * (hit.head ? gun.headshot : 1);
        if (this.damage(hit.u, dmg, this.me, gun, hit.head)) killed = true;
        this.host.blood.spray(end, dir, gun.pellets > 1 ? 0.3 : 0.6);
      }
    }
    this.host.audio.gunshot(null, gun.sound);
    inp.rumble(gun.id === 'smg' || gun.id === 'carbine' ? 'smg' : 'gunshot', gun.pellets > 1 ? 1.2 : 0.8);
    // kick: up, and a little either way; aiming and crouching steady it
    const kick = gun.recoil * (aiming ? 0.72 : 1) * (p.crouching ? 0.8 : 1);
    f.pitch = Math.max(f.pitchMin, f.pitch - kick);
    f.yaw += (Math.random() - 0.45) * kick * 0.55;
    this.recoilDebt += kick;
    p.anim.play('gun.recoil', { group: 'recoil', fadeIn: 0.01, fadeOut: 0.08 });
    this.vm.kick(gun.recoil * 25);
    if (anyHit) {
      this.hud.hitmarker(killed, headHit);
      inp.rumble(killed ? 'kill' : 'hitmarker', 0.8);
    }
    if (this.mag[this.slot] === 0 && this.reserve[this.slot] > 0) {
      this.reloadT = gun.reload;
      p.anim.play('gun.reload', { group: 'reload', fadeIn: 0.1, fadeOut: 0.2, speed: 2.2 / gun.reload });
    }
  }

  /** The first enemy body a ray meets before `max`: a head, or the cylinder of a body. */
  private rayUnits(o: THREE.Vector3, d: THREE.Vector3, max: number, team: 0 | 1) {
    let best: { u: Unit; t: number; head: boolean } | null = null;
    for (const u of this.units) {
      if (u.team === team || !u.alive) continue;
      const hy = headY(u);
      const th = raySphere(o, d, u.pos.x, hy, u.pos.z, 0.16);
      if (th >= 0 && th < max && (!best || th < best.t)) best = { u, t: th, head: true };
      const tb = rayCylinder(o, d, u.pos.x, u.pos.z, 0.3, u.pos.y + 0.15, hy - 0.16);
      if (tb >= 0 && tb < max && (!best || tb < best.t - 0.05)) best = { u, t: tb, head: false };
    }
    return best;
  }

  private enemyUnderCrosshair() {
    const cam = this.host.camera;
    const d = cam.getWorldDirection(_d);
    const o = _o.copy(cam.position);
    const wall = this.host.collision.raycast(o, d, 120);
    return !!this.rayUnits(o, d, wall, this.me.team);
  }

  /**
   * Aim assist, on a controller only: the look slows as the crosshair
   * crosses an enemy, and bringing the sights up close to one settles onto
   * them. Nothing on a mouse, and nothing through a wall.
   */
  private aimAssist(aiming: boolean) {
    const inp = this.host.input, f = this.host.follow, cam = this.host.camera;
    const level = this.host.aimAssist();
    if (!inp.isPad || level === 'off') {
      inp.aimSlow = 0;
      return;
    }
    const fwd = cam.getWorldDirection(_d);
    let best: Unit | null = null, bestA = Infinity;
    for (const u of this.units) {
      if (u.team === this.me.team || !u.alive) continue;
      const to = _o.set(u.pos.x - cam.position.x, chestY(u) - cam.position.y, u.pos.z - cam.position.z);
      const dist = to.length();
      if (dist > 70) continue;
      const ang = fwd.angleTo(to);
      // wider close up (a body fills more of the view)
      const reach = Math.max(0.035, Math.atan2(0.9, dist)) * (level === 'standard' ? 1.4 : 1);
      if (ang < reach && ang < bestA) (best = u), (bestA = ang);
    }
    if (best && !this.sees(cam.position, _e.set(best.pos.x, chestY(best), best.pos.z))) best = null;
    inp.aimSlow = best ? (level === 'standard' ? 0.5 : 0.3) * (aiming ? 1 : 0.6) : 0;
    if (aiming && !this.wasAiming && best) {
      const k = level === 'standard' ? 0.6 : 0.35;
      const tx = best.pos.x - cam.position.x, ty = chestY(best) - cam.position.y, tz = best.pos.z - cam.position.z;
      const yaw = Math.atan2(tx, tz), pitch = -Math.atan2(ty, Math.hypot(tx, tz));
      f.yaw += wrap(yaw - f.yaw) * k;
      f.pitch += (pitch - f.pitch) * k;
    }
  }

  /* ─────────────────────────── damage ─────────────────────────── */

  /** Returns true if it killed them. Armor takes most of it until it's gone. */
  private damage(u: Unit, dmg: number, from: Unit, gun: Gun, head: boolean): boolean {
    if (!u.alive) return false;
    const soak = Math.min(u.armor, dmg * ARMOR_SOAK);
    u.armor -= soak;
    u.hp -= dmg - soak;
    if (u === this.me) {
      this.sinceHurt = 0;
      this.host.hurtFlash(Math.min(1, dmg / 40));
      this.host.input.rumble('hurt', Math.min(1, dmg / 30));
      const fwd = this.host.camera.getWorldDirection(_d);
      const rel = Math.atan2(from.pos.x - u.pos.x, from.pos.z - u.pos.z) - Math.atan2(fwd.x, fwd.z);
      this.hud.damageFrom(wrap(rel));
    } else if (u instanceof Soldier) u.hurt(from);
    if (u.hp > 0) return false;
    u.hp = 0;
    this.kill(u, from, gun, head);
    return true;
  }

  private kill(u: Unit, from: Unit, gun: Gun, head: boolean) {
    from.kills++;
    this.hud.feed(from.name, from.team, gun.name, u.name, u.team, head, from.isPlayer || u.isPlayer);
    // they drop what they had
    this.pickups.push({ kind: Math.random() < 0.6 ? 'ammo' : 'armor', pos: u.pos.clone(), t: 25, station: false, up: true });
    if (this.pickups.length > 30) this.pickups.splice(this.pickups.findIndex((p) => !p.station), 1);
    if (u instanceof Soldier) {
      u.die(from);
      u.respawnT = RESPAWN + Math.random() * 2;
    } else {
      // you: down, and the camera pulls out over your shoulder to see who did it
      this.me.alive = false;
      this.me.deaths++;
      this.deadT = RESPAWN;
      this.killedBy = { name: from.name, gun: gun.name, head };
      const p = this.host.player;
      p.busy = true;
      p.armPose = p.armPoseL = null;
      const rel = Math.abs(wrap(Math.atan2(from.pos.x - p.pos.x, from.pos.z - p.pos.z) - p.facing));
      p.anim.play(rel > 1.6 ? 'react.deathForward' : 'react.deathBack', { group: 'death', fadeIn: 0.08, stay: true });
      const f = this.host.follow;
      f.yaw = Math.atan2(from.pos.x - p.pos.x, from.pos.z - p.pos.z);
      f.pitch = 0.35;
      f.pitchMin = -0.55;
      f.pitchMax = 1.0;
      this.host.input.rumble('kill', 1);
      this.hud.loadout(true, LOADOUTS, LOADOUTS.indexOf(this.loadout), false);
    }
  }

  /** A bot's shot: a hit lands on the body (or head); a miss goes past them into whatever's behind. */
  private botFire(s: Soldier, t: Unit, hit: boolean, head: boolean) {
    const muzzle = this.guns.set(this.bots.indexOf(s) + 1, s.gun.id, s.rig, s.yaw, _m) ?? _m.set(s.pos.x, s.pos.y + 1.4, s.pos.z);
    const aim = _e.set(t.pos.x, head ? headY(t) : chestY(t) - 0.15 + Math.random() * 0.4, t.pos.z);
    if (!hit) {
      aim.x += (Math.random() - 0.5) * 1.6;
      aim.y += Math.random() * 0.9 - 0.2;
      aim.z += (Math.random() - 0.5) * 1.6;
    }
    const dir = _d.subVectors(aim, muzzle);
    const dist = dir.length();
    dir.normalize();
    const wall = this.host.collision.raycast(muzzle, dir, hit ? dist : 120);
    const clear = wall >= dist - 0.3;
    const end = _o.copy(muzzle).addScaledVector(dir, hit && clear ? dist : Math.min(wall, 120));
    this.host.tracers.shot(muzzle, end, true);
    this.host.audio.gunshot(muzzle, s.gun.sound);
    if (hit && clear) {
      const dmg = damageAt(s.gun, dist) * (head ? s.gun.headshot : 1) * (s.gun.pellets > 1 ? s.gun.pellets * 0.6 : 1);
      this.damage(t, dmg, s, s.gun, head);
      this.host.blood.spray(end, dir, 0.5);
    }
  }

  /** Can an eye here see a body there (nothing solid in between)? */
  private sees(a: THREE.Vector3, b: THREE.Vector3) {
    const d = _s.subVectors(b, a);
    const l = d.length();
    if (l < 0.01) return true;
    d.multiplyScalar(1 / l);
    return this.host.collision.raycast(a, d, l) >= l - 0.2;
  }

  /** People don't stand inside each other. */
  private separate() {
    const us = this.units;
    for (let i = 0; i < us.length; i++) {
      const a = us[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < us.length; j++) {
        const b = us[j];
        if (!b.alive) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.42 || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), push = (0.65 - d) / 2;
        const nx = dx / d, nz = dz / d;
        if (!a.isPlayer) (a.pos.x -= nx * push), (a.pos.z -= nz * push);
        if (!b.isPlayer) (b.pos.x += nx * push), (b.pos.z += nz * push);
      }
    }
  }

  /* ─────────────────────────── points, score, pickups ─────────────────────────── */

  private pointsUpdate(dt: number) {
    for (const p of this.points) {
      const n: [number, number] = [0, 0];
      for (const u of this.units) if (u.alive && Math.hypot(u.pos.x - p.pos.x, u.pos.z - p.pos.z) < p.radius && u.pos.y < 2) n[u.team]++;
      p.contested = n[0] > 0 && n[1] > 0;
      if (p.contested) continue;
      const team: -1 | 0 | 1 = n[0] ? 0 : n[1] ? 1 : -1;
      if (team === -1 || team === p.owner) {
        p.cap = Math.max(0, p.cap - dt * 0.15);
        if (!p.cap) p.capTeam = -1;
        continue;
      }
      const rate = Math.min(2, 1 + 0.5 * (n[team] - 1)) / 6;
      if (p.capTeam === team || p.capTeam === -1) {
        p.capTeam = team;
        p.cap += rate * dt;
        if (p.cap >= 1) this.captured(p, team);
      } else {
        p.cap -= rate * dt;
        if (p.cap <= 0) {
          p.cap = 0;
          p.capTeam = team;
        }
      }
    }
    this.tickT -= dt;
    if (this.tickT <= 0 && this.phase === 'play') {
      this.tickT = TICK;
      for (const p of this.points) {
        const o = p.owner;
        if (o !== -1) this.score[o] = Math.min(SCORE_LIMIT, this.score[o] + 1);
      }
    }
  }

  private captured(p: CapturePoint, team: 0 | 1) {
    const lost = p.owner === this.me.team;
    p.owner = team;
    p.cap = 0;
    p.capTeam = -1;
    for (const u of this.units) if (u.alive && u.team === team && Math.hypot(u.pos.x - p.pos.x, u.pos.z - p.pos.z) < p.radius) u.caps++;
    const ours = team === this.me.team;
    this.hud.announce(ours ? `${p.id} captured` : lost ? `${p.id} lost` : `${TEAM_NAMES[team]} took ${p.id}`, ours ? 'us' : 'them');
    this.host.audio.fight(ours ? 'bell' : 'block', 0.6);
    this.host.input.rumble(ours ? 'reloadDone' : 'uneasy', 0.6);
  }

  private pickupsUpdate(dt: number) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i];
      if (!k.up) {
        if ((k.t -= dt) <= 0) k.up = true;
        continue;
      }
      if (!k.station && (k.t -= dt) <= 0) {
        this.pickups.splice(i, 1);
        continue;
      }
      const me = this.me;
      if (me.alive && Math.hypot(me.pos.x - k.pos.x, me.pos.z - k.pos.z) < 1.1 && this.collect(k, me)) this.take(i, k);
      else
        for (const b of this.bots)
          if (b.alive && k.kind === 'armor' && b.armor < MAX_ARMOR && Math.hypot(b.pos.x - k.pos.x, b.pos.z - k.pos.z) < 1) {
            b.armor = Math.min(MAX_ARMOR, b.armor + 25);
            this.take(i, k);
            break;
          }
    }
  }

  /** Would you get anything from it? (A full pack isn't wasted on you.) */
  private collect(k: Pickup, me: Me): boolean {
    if (k.kind === 'armor') {
      if (me.armor >= MAX_ARMOR) return false;
      me.armor = Math.min(MAX_ARMOR, me.armor + 25);
      this.hud.announce('Armor', 'pickup');
    } else {
      const full = this.held.every((id, i) => this.reserve[i] >= GUNS[id].reserve);
      if (full) return false;
      this.held.forEach((id, i) => (this.reserve[i] = Math.min(GUNS[id].reserve * 1.5, this.reserve[i] + Math.ceil(GUNS[id].reserve * 0.5))));
      this.hud.announce('Ammo', 'pickup');
    }
    this.host.audio.fight('grab', 0.6);
    this.host.input.rumble('reloadDone', 0.7);
    return true;
  }

  private take(i: number, k: Pickup) {
    if (k.station) {
      k.up = false;
      k.t = 25;
    } else this.pickups.splice(i, 1);
  }

  /* ─────────────────────────── dying and coming back ─────────────────────────── */

  private respawnFlow(dt: number) {
    if (this.me.alive) return;
    const inp = this.host.input;
    this.deadT -= dt;
    const i = LOADOUTS.indexOf(this.loadout);
    if (inp.pressed('tabNext')) this.loadout = LOADOUTS[(i + 1) % LOADOUTS.length];
    if (inp.pressed('tabPrev')) this.loadout = LOADOUTS[(i + LOADOUTS.length - 1) % LOADOUTS.length];
    if (this.loadout !== LOADOUTS[i]) this.host.audio.uiTick();
    const first = this.phase === 'loadout';
    const ready = first || this.deadT <= 0;
    this.hud.loadout(true, LOADOUTS, LOADOUTS.indexOf(this.loadout), first);
    this.hud.death(this.killedBy && !first ? { ...this.killedBy, t: Math.max(0, this.deadT) } : null);
    if (ready && (inp.pressed('jump') || (this.deadT < -6 && !first))) {
      this.deploy();
      this.lookRange();
    }
  }

  private over() {
    this.phase = 'over';
    const [b, r] = this.score;
    const won = b > r, draw = b === r;
    const me = this.me;
    this.hud.showEnd({
      title: draw ? 'Draw' : won ? 'Victory' : 'Defeat',
      lines: [`Blue ${b} – ${r} Red`, `${me.kills} kills · ${me.deaths} deaths · ${me.caps} captures`],
    });
    this.hud.loadout(false);
    this.hud.death(null);
    this.hud.crosshair(null);
    this.host.audio.fight('bell');
    this.host.input.rumble(won ? 'kill' : 'uneasy', 1);
  }

  get endOpen() {
    return this.hud.endOpen;
  }

  /** Your body isn't yours to move right now (dead, choosing a loadout, the match is over). */
  get busy() {
    return !this.me.alive || this.phase !== 'play';
  }

  /* ─────────────────────────── drawing ─────────────────────────── */

  private drawPoints(t: number) {
    const col = (o: number) => (o === 0 ? 0x5a9cff : o === 1 ? 0xff6a4a : 0xe9e5dc);
    this.points.forEach((p, i) => {
      const m = this.pointMeshes[i];
      const c = col(p.owner);
      (m.ring.material as THREE.MeshBasicMaterial).color.setHex(p.contested ? 0xffd070 : c);
      (m.disc.material as THREE.MeshBasicMaterial).color.setHex(p.capTeam >= 0 ? col(p.capTeam) : c);
      (m.disc.material as THREE.MeshBasicMaterial).opacity = 0.05 + p.cap * 0.14;
      (m.pillar.material as THREE.MeshBasicMaterial).color.setHex(c);
      (m.pillar.material as THREE.MeshBasicMaterial).opacity = 0.25 + Math.sin(t * 2 + i) * 0.08;
    });
  }

  private drawPickups(t: number) {
    for (const kind of ['ammo', 'armor'] as const) {
      const mesh = this.pickupMesh[kind];
      let n = 0;
      for (const k of this.pickups) {
        if (!k.up || k.kind !== kind || n >= 32) continue;
        _mm.compose(_o.set(k.pos.x, k.pos.y + 0.35 + Math.sin(t * 2.4 + k.pos.x) * 0.06, k.pos.z), _q.setFromAxisAngle(_up, t * 1.2 + k.pos.z), _one);
        mesh.setMatrixAt(n++, _mm);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** For the playtests. */
  get snapshot() {
    return {
      phase: this.phase,
      score: [...this.score],
      clock: Math.ceil(this.clock),
      fp: this.fpActive,
      points: this.points.map((p) => `${p.id}:${p.owner}${p.contested ? '!' : ''}${p.cap > 0 ? `(${p.capTeam}:${p.cap.toFixed(2)})` : ''}`).join(' '),
      me: { alive: this.me.alive, hp: Math.round(this.me.hp), armor: Math.round(this.me.armor), kills: this.me.kills, deaths: this.me.deaths, gun: this.gun.id, mag: this.mag[this.slot], reserve: this.reserve[this.slot], x: +this.me.pos.x.toFixed(1), z: +this.me.pos.z.toFixed(1) },
      bots: this.bots.map((b) => `${b.team}${b.alive ? '' : '✝'}${b.kills}/${b.deaths}`).join(' '),
    };
  }
}

const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _o = new THREE.Vector3();
const _e = new THREE.Vector3();
const _d = new THREE.Vector3();
const _s = new THREE.Vector3();
const _m = new THREE.Vector3();
const _mm = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _one = new THREE.Vector3(1, 1, 1);

function raySphere(o: THREE.Vector3, d: THREE.Vector3, cx: number, cy: number, cz: number, r: number) {
  const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const h = b * b - c;
  if (h < 0) return -1;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : -1;
}

/** An upright cylinder (x, z, radius) between two heights. */
function rayCylinder(o: THREE.Vector3, d: THREE.Vector3, cx: number, cz: number, r: number, y0: number, y1: number) {
  const ox = o.x - cx, oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-8) return -1;
  const b = ox * d.x + oz * d.z;
  const c = ox * ox + oz * oz - r * r;
  const h = b * b - a * c;
  if (h < 0) return -1;
  const t = (-b - Math.sqrt(h)) / a;
  if (t < 0) return -1;
  const y = o.y + d.y * t;
  return y >= y0 && y <= y1 ? t : -1;
}
