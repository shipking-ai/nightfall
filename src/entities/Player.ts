import * as THREE from 'three';
import { styleFor } from '../anim/gait';
import { newMotion, newRig, solve, stepPhase, visibleParts, type ArmMode, type Body, type Outfit } from './Humanoid';
import { FigureBatch } from './FigureBatch';
import type { Collision } from '../world/Collision';
import type { Input } from '../core/Input';
import { bodyFromLook, outfitFromLook, type Look } from './Look';
import { WATER_Y, RIVER_Z0, RIVER_Z1, QUAY_Z, inRiver } from './Boats';
import { Animator } from '../anim/Animator';
import '../anim/clips';
import type { Emote } from '../data/emotes';

const WALK = 3.1;
const SPRINT = 6.4;
const ACCEL = 22;
const DECEL = 16;
const GRAVITY = 19;
const JUMP_V = 6.1;
const RADIUS = 0.32;
const HEIGHT = 1.8;
const STEP = 0.46;

/**
 * Third-person walker. Responsive rather than realistic: quick acceleration,
 * forgiving steps, a jump that clears a platform edge. The same rig and the
 * same animation library as everyone in the city, so the player moves like
 * a person: weight into starts and stops, a landing in the knees, emotes and
 * actions that play over walking.
 */
export class Player {
  group = new THREE.Group();
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  facing = 0;
  grounded = true;
  sitting = false;
  sprinting = false;
  /** WARZONE: low behind cover */
  crouching = false;
  /** crouching is allowed (WARZONE) */
  canCrouch = false;
  /** an animation that holds the body (an emote you can't walk out of yet, a door) */
  busy = false;
  anim = new Animator();
  /** the emote playing, if any */
  emote: Emote | null = null;
  private motion = newMotion();
  rig = newRig();
  private batch = new FigureBatch(1);
  private root = new THREE.Matrix4();
  body: Body = { height: 1.0, girth: 1.02, shoulders: 1.04, hips: 0.98, head: 1 };
  /** a long charcoal coat and a turned-up scarf: the one silhouette you learn to recognise */
  outfit: Outfit = {
    garment: 'coat', top: 0x2a2c30, legs: 0x16171a, shoes: 0x0e0e0f, skin: 0xb8876a, hair: 'swept', hairColor: 0x1a1512,
    accent: 0x6a5a48, hem: true, skirt: false, hoodDown: false, scarf: true, bag: false, umbrella: false, bulk: 1.1,
  };
  private parts = visibleParts(this.outfit, 0);
  private sitBlend = 0;
  private lastSpeed = 0;
  /** combat: face this way (strafing) instead of the direction of travel */
  aimYaw: number | null = null;
  /** combat: the arms' pose while armed/punching */
  armPose: ArmMode | null = null;
  /** the left arm's pose, when a weapon needs both hands */
  armPoseL: ArmMode | null = null;
  /** the head (and a gun with it) tipped up or down to follow the aim */
  lookPitch = 0;
  /** admin: walk faster/slower; fly through everything */
  speedMul = 1;
  fly = false;
  /** in the river: floating at the surface, slow; Space by the quay wall climbs out */
  swimming = false;
  /** RPG: open water anywhere (the sea, lakes, rivers); null = District 03's river only */
  waterAt: ((x: number, z: number) => number | null | undefined) | null = null;
  /** RPG: the water level where you're swimming */
  private swimLevel = WATER_Y;
  private openWater = false;
  /**
   * In a vehicle: sat in a seat (world matrix of the seat), hands on the wheel
   * if driving. The figure is drawn there; `pos` still follows the car.
   */
  seat: { m: THREE.Matrix4; drive: boolean; steer: number } | null = null;
  /** a pistol in the right hand, shown while armed */
  gun = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.2, 0.11).translate(0, -0.13, 0.03), new THREE.MeshStandardMaterial({ color: 0x151618, roughness: 0.4, metalness: 0.6 }));
  onStep: ((intensity: number) => void) | null = null;
  onLand: ((v: number) => void) | null = null;

  constructor() {
    this.group.add(this.batch.group);
    this.batch.dress(0, this.outfit, 0x9fc4ff, this.body);
    this.gun.matrixAutoUpdate = false;
    this.gun.visible = false;
    this.gun.castShadow = true;
    this.group.add(this.gun);
    this.motion.stride = 1.05;
    this.motion.armSwing = 0.9;
    this.motion.slouch = 0.02;
    // the lead: steady, unhurried, a little guarded
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    this.motion.style = styleFor({ energy: 0.55, confidence: 0.7, nervous: 0.2, tired: 0.25, age: 0.3 }, rnd, { bulk: this.outfit.bulk, femme: 0.2 });
    this.motion.face.restless = 0.35;
  }

  place(x: number, y: number, z: number, yaw: number) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.facing = yaw;
    this.sitting = false;
    this.sitBlend = 0;
    this.stopEmote();
  }

  sitAt(p: THREE.Vector3, yaw: number) {
    this.sitting = true;
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.facing = yaw;
    this.stopEmote();
    this.anim.play('act.sitDown', { group: 'act', fadeIn: 0.2 });
  }

  /** An emote from the wheel. Upper-body ones play while you walk; full-body ones stop you. */
  playEmote(e: Emote) {
    this.stopEmote(0.15);
    this.emote = e;
    this.busy = !!e.full;
    this.anim.play(e.clip, {
      group: 'emote',
      fadeIn: 0.28,
      fadeOut: 0.35,
      stay: !!e.hold && !e.then,
      onEnd: () => {
        if (this.emote === e && !e.hold) {
          this.emote = null;
          this.busy = false;
        }
      },
    });
    if (e.then) {
      const first = e.clip;
      setTimeout(() => {
        if (this.emote === e && this.anim.playing(first)) this.anim.play(e.then!, { group: 'emote', loop: true, fadeIn: 0.2 });
      }, 1000 * 1.1);
    }
  }

  stopEmote(fade = 0.35) {
    if (!this.emote) return;
    this.anim.stop('emote', fade);
    this.emote = null;
    this.busy = false;
  }

  /** A short action over whatever else is happening (a door, a button, answering a phone). */
  act(clip: string, opts: { hold?: boolean; loop?: boolean } = {}) {
    this.anim.play(clip, { group: 'act', fadeIn: 0.18, fadeOut: 0.3, loop: opts.loop });
    if (opts.hold) this.busy = true;
    if (opts.hold) setTimeout(() => (this.busy = false), 900);
  }

  update(dt: number, input: Input | null, camYaw: number, col: Collision, obstacles: { x: number; z: number; r: number }[]) {
    this.anim.update(dt);
    const m = this.motion;
    // the feet find kerbs, steps and slopes for themselves
    if (!m.ground) m.ground = (x, z) => col.groundAt(x, z, this.pos.y + 0.4, 0.8, 0.05);
    if (this.seat) return this.updateSeated(dt);

    // analog on a stick (a gentle push walks slowly), full speed from the keys
    const mv = input && !this.busy ? input.move() : { x: 0, y: 0, mag: 0 };
    const ix = -mv.x, iz = mv.y;
    const moving = mv.mag > 0.02;
    if (this.sitting && moving) {
      this.sitting = false;
      this.anim.play('act.standUp', { group: 'act', fadeIn: 0.15 });
    }
    // held emotes end when you walk off; the rest play on over the walk
    if (moving && this.emote?.hold) this.stopEmote(0.3);

    this.crouching = this.canCrouch && !!input && input.state('crouch') && !this.swimming;
    this.sprinting = !!input && moving && input.state('sprint', !moving) && mv.mag > 0.5 && !this.crouching;
    // (undefined from waterAt: a handcrafted place with its own water rules — District 03's river)
    const openW = this.waterAt && !this.fly ? this.waterAt(this.pos.x, this.pos.z) : undefined;
    this.openWater = openW !== undefined;
    if (openW !== undefined) {
      // anywhere: deep enough water, and you're in it rather than on a bridge over it
      const floor = openW == null ? 0 : col.groundAt(this.pos.x, this.pos.z, this.pos.y, 0.1, 0.1);
      this.swimming = openW != null && openW - floor > 1.25 && this.pos.y < openW - 0.6;
      if (openW != null) this.swimLevel = openW;
    } else this.swimming = !this.fly && inRiver(this.pos.x, this.pos.z, this.pos.y);
    const push = Math.min(1, mv.mag * 1.15);
    const base = this.sprinting ? SPRINT : WALK * (this.crouching ? 0.55 : 1) * (0.35 + 0.65 * push);
    const speed = this.swimming ? (this.sprinting ? 2.9 : 1.8) : (this.sitting ? 0 : base) * this.speedMul * (this.aimYaw != null && !this.fly ? 0.7 : 1);
    const fwdX = Math.sin(camYaw), fwdZ = Math.cos(camYaw);
    let wx = fwdX * iz + fwdZ * ix;
    let wz = fwdZ * iz - fwdX * ix;
    const len = Math.hypot(wx, wz);
    if (len > 0) {
      wx /= len;
      wz /= len;
    }
    const tx = moving ? wx * speed : 0, tz = moving ? wz * speed : 0;
    const rate = (moving ? ACCEL : DECEL) * (this.grounded ? 1 : 0.35);
    this.vel.x += clampAbs(tx - this.vel.x, rate * dt);
    this.vel.z += clampAbs(tz - this.vel.z, rate * dt);

    if (this.swimming && this.openWater) {
      // open water: float, and wade out wherever the bottom comes up to meet you
      const surface = this.swimLevel - 1.32;
      this.vel.y = 0;
      const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
      this.pos.x = nx;
      this.pos.z = nz;
      col.resolve(this.pos, RADIUS, HEIGHT, 0.2);
      this.pos.y += (surface + Math.sin(performance.now() * 0.002) * 0.04 - this.pos.y) * Math.min(1, dt * 4);
      this.grounded = false;
      const floor = col.groundAt(this.pos.x, this.pos.z, this.pos.y + 2, 2.4, RADIUS);
      if (floor > this.pos.y - 0.2) {
        // shallows: stand up
        this.pos.y = floor;
        this.swimming = false;
        this.grounded = true;
      } else if (input && input.pressed('jump')) {
        // a ledge within reach: haul yourself out
        const ax = this.pos.x + Math.sin(this.facing) * 1.1, az = this.pos.z + Math.cos(this.facing) * 1.1;
        const ledge = col.groundAt(ax, az, this.swimLevel + 1.6, 3, RADIUS);
        if (ledge > this.swimLevel - 0.6 && ledge < this.swimLevel + 1.7) {
          this.pos.set(ax, ledge, az);
          this.vel.set(0, 0, 0);
          this.grounded = true;
          this.swimming = false;
          this.anim.play('act.climb', { group: 'act', fadeIn: 0.05 });
        }
      }
    } else if (this.swimming) {
      // float with your head out; the quay wall has iron rungs: jump to climb out beside it
      const surface = WATER_Y - 1.32;
      this.vel.y = 0;
      this.pos.x += this.vel.x * dt;
      this.pos.z = THREE.MathUtils.clamp(this.pos.z + this.vel.z * dt, RIVER_Z0 + 0.3, RIVER_Z1 - 0.3);
      this.pos.y += (surface + Math.sin(performance.now() * 0.002) * 0.04 - this.pos.y) * Math.min(1, dt * 4);
      this.grounded = false;
      if (input && input.pressed('jump') && this.pos.z < RIVER_Z0 + 1.4) {
        this.pos.set(this.pos.x, 0.15, QUAY_Z);
        this.vel.set(0, 0, 0);
        this.grounded = true;
        this.swimming = false;
        this.anim.play('act.climb', { group: 'act', fadeIn: 0.05 });
      }
    } else if (this.fly) {
      // noclip: straight through walls, up with jump, down with crouch
      const up = input ? (input.held('jump') ? 1 : 0) - (input.held('crouch') ? 1 : 0) : 0;
      this.vel.y = up * speed;
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.pos.y = Math.max(0.15, this.pos.y + this.vel.y * dt);
      this.grounded = false;
    } else if (input && this.grounded && !this.sitting && !this.busy && input.pressed('jump')) {
      this.vel.y = JUMP_V;
      this.grounded = false;
      this.stopEmote(0.1);
    }
    if (!this.fly && !this.swimming) this.vel.y -= GRAVITY * dt;

    if (!this.sitting && !this.fly && !this.swimming) {
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.pos.y += this.vel.y * dt;
      col.resolve(this.pos, RADIUS, HEIGHT, STEP);
      for (const o of obstacles) {
        const dx = this.pos.x - o.x, dz = this.pos.z - o.z;
        const d = Math.hypot(dx, dz), min = RADIUS + o.r;
        if (d < min && d > 1e-4) {
          this.pos.x = o.x + (dx / d) * min;
          this.pos.z = o.z + (dz / d) * min;
        }
      }
      const g = col.groundAt(this.pos.x, this.pos.z, this.pos.y, this.grounded ? STEP : 0.05, RADIUS);
      if (this.pos.y <= g + 0.001) {
        if (!this.grounded && this.vel.y < -4) {
          this.onLand?.(-this.vel.y);
          m.land = Math.min(1, -this.vel.y / 9);
        }
        // step up smoothly rather than snapping
        this.pos.y = this.grounded ? THREE.MathUtils.lerp(this.pos.y, g, Math.min(1, dt * 18)) : g;
        if (Math.abs(this.pos.y - g) < 0.01) this.pos.y = g;
        this.vel.y = 0;
        this.grounded = true;
      } else if (this.grounded && this.pos.y - g < STEP && this.vel.y <= 0) {
        // walking down a kerb
        this.pos.y = THREE.MathUtils.lerp(this.pos.y, g, Math.min(1, dt * 14));
        this.vel.y = 0;
      } else {
        this.grounded = false;
      }
    }

    // face the direction of travel (or the aim, strafing)
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.aimYaw != null && !this.sitting) this.facing += wrap(this.aimYaw - this.facing) * Math.min(1, dt * 18);
    else if (hs > 0.25 && !this.sitting) {
      const want = Math.atan2(this.vel.x, this.vel.z);
      this.facing += wrap(want - this.facing) * Math.min(1, dt * 11);
    }

    // animation: the same rig everyone in the city uses
    this.sitBlend += ((this.sitting ? 1 : 0) - this.sitBlend) * Math.min(1, dt * 5);
    m.sit = this.sitBlend;
    m.speed = this.grounded || this.swimming ? hs : Math.max(hs, 2.5);
    m.crouch += ((this.crouching ? 1 : 0) - m.crouch) * Math.min(1, dt * 9);
    m.air += ((!this.grounded && !this.swimming && !this.fly ? 1 : 0) - m.air) * Math.min(1, dt * 10);
    // leaning into starts, back from stops
    const acc = (hs - this.lastSpeed) / Math.max(dt, 1e-3);
    this.lastSpeed = hs;
    m.accel += (THREE.MathUtils.clamp(acc, -12, 12) - m.accel) * Math.min(1, dt * 8);
    // strafing and backing up while aiming: legs step the way you're going
    m.moveDir = hs > 0.3 && this.aimYaw != null ? wrap(Math.atan2(this.vel.x, this.vel.z) - this.facing) : m.moveDir * (1 - Math.min(1, dt * 6));
    m.armL = m.armR = this.sitting ? 'rest' : 'free';
    if (this.armPose && !this.sitting) {
      m.armR = this.armPose;
      if (this.armPoseL) m.armL = this.armPoseL;
      else if (this.armPose === 'guard') m.armL = 'guard';
    }
    m.lookYaw *= 0.9;
    m.lookPitch += (this.lookPitch - m.lookPitch) * Math.min(1, dt * 10);
    const turnRate = hs > 0.25 ? wrap(Math.atan2(this.vel.x, this.vel.z) - this.facing) * 11 : 0;
    m.turn += (turnRate - m.turn) * Math.min(1, dt * 8);
    if (stepPhase(m, dt) && this.grounded) this.onStep?.(this.sprinting ? 1 : this.crouching ? 0.35 : 0.6);
    if (!this.grounded && !this.swimming) m.phase += dt * 1.5; // legs keep moving through a jump
    if (this.swimming) {
      // a slow breaststroke: arms reach and sweep, the body low in the water
      m.phase += dt * (1.2 + hs);
      m.armL = m.armR = Math.sin(m.phase * 2) > 0 ? 'punch' : 'guard';
    }
    // the weight moves from one foot to the other now and then, not continuously
    m.weight = Math.sin(performance.now() * 0.00021) > 0 ? 0.8 : -0.8;
    m.steer = 0;

    this.root.compose(this.pos, _q.setFromAxisAngle(_up, this.facing), _one.setScalar(this.body.height));
    this.draw();
  }

  /** Sat in a car: legs to the pedals, hands on the wheel (or resting), the head looking about. */
  private updateSeated(dt: number) {
    const s = this.seat!;
    const m = this.motion;
    m.speed = 0;
    m.sit = 1;
    m.crouch = m.air = m.land = 0;
    m.armL = m.armR = s.drive ? 'wheel' : 'rest';
    m.steer += (s.steer - m.steer) * Math.min(1, dt * 8);
    m.lookYaw = m.steer * 0.25;
    m.breath += dt * 1.2;
    // a realistic body (RPG) is taller in the trunk than the city figure: sunk into the seat, it clears the roof
    const k = this.real ? 1 : this.body.height;
    this.root.copy(s.m);
    if (this.real) this.root.multiply(_s.makeTranslation(0, -0.12 - (this.body.torsoLen ?? 1) * 0.1, -0.02));
    this.root.multiply(_s.makeScale(k, k, k));
    this.draw();
  }

  /**
   * RPG: a realistic body drawn in place of the city figure (rpg/people). Its
   * bones follow the same rig, solved with its own proportions.
   */
  real: { group: THREE.Object3D; ready: boolean; pose(camDist: number): void } | null = null;

  private draw() {
    solve(this.rig, this.root, this.body, this.outfit, this.motion, performance.now() / 1000, this.anim);
    if (this.real?.ready) {
      this.real.pose(0);
      this.batch.group.visible = false;
      if (this.gun.visible) this.gun.matrix.copy(this.rig.handR);
      return;
    }
    this.batch.write(0, this.rig, this.parts, false);
    this.batch.flush();
    if (this.gun.visible) this.gun.matrix.copy(this.rig.handR);
  }

  /** Wear a look (Wardrobe); the same one the other players see. */
  setLook(l: Look) {
    this.outfit = outfitFromLook(l);
    this.body = bodyFromLook(l);
    this.parts = visibleParts(this.outfit, 0);
    this.batch.dress(0, this.outfit, 0x9fc4ff, this.body);
  }

  /** Wear a whole outfit and body (WARZONE fatigues, a FIGHT kit). */
  wear(o: Outfit, b: Body) {
    this.outfit = o;
    this.body = b;
    this.parts = visibleParts(o, 0);
    this.batch.dress(0, o, 0x9fc4ff, b);
  }

  /** in a car with no windows to see through: the figure is not drawn, but position still drives the world */
  set hidden(v: boolean) {
    this.batch.group.visible = !v && !this.real?.ready;
    if (this.real) this.real.group.visible = !v;
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }
}

const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _one = new THREE.Vector3(1, 1, 1);
const _s = new THREE.Matrix4();

function clampAbs(v: number, m: number) {
  return v > m ? m : v < -m ? -m : v;
}

export function wrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
