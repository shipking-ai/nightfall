import * as THREE from 'three';
import { newMotion, newRig, solve, stepPhase, visibleParts, type Body, type Outfit } from './Humanoid';
import { FigureBatch } from './FigureBatch';
import type { Collision } from '../world/Collision';
import type { Input } from '../core/Input';
import { bodyFromLook, outfitFromLook, type Look } from './Look';
import { WATER_Y, RIVER_Z0, RIVER_Z1, QUAY_Z, inRiver } from './Boats';

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
 * forgiving steps, a jump that clears a platform edge.
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
  /** an animation that holds the body (an emote you can't walk out of yet, a door) */
  busy = false;
  private motion = newMotion();
  private rig = newRig();
  private batch = new FigureBatch(1);
  private root = new THREE.Matrix4();
  private body: Body = { height: 1.0, girth: 1.02, shoulders: 1.04, hips: 0.98, head: 1 };
  /** a long charcoal coat and a turned-up scarf: the one silhouette you learn to recognise */
  private outfit: Outfit = {
    garment: 'coat', top: 0x2a2c30, legs: 0x16171a, shoes: 0x0e0e0f, skin: 0xb8876a, hair: 'swept', hairColor: 0x1a1512,
    accent: 0x6a5a48, hem: true, skirt: false, hoodDown: false, scarf: true, bag: false, umbrella: false, bulk: 1.1,
  };
  private parts = visibleParts(this.outfit, 0);
  private sitBlend = 0;
  /** combat: face this way (strafing) instead of the direction of travel */
  aimYaw: number | null = null;
  /** combat: the right arm's pose while armed/punching */
  armPose: 'aim' | 'punch' | 'guard' | null = null;
  /** admin: walk faster/slower; fly through everything */
  speedMul = 1;
  fly = false;
  /** in the river: floating at the surface, slow; Space by the quay wall climbs out */
  swimming = false;
  /** a pistol in the right hand, shown while armed */
  gun = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.2, 0.11).translate(0, -0.13, 0.03), new THREE.MeshStandardMaterial({ color: 0x151618, roughness: 0.4, metalness: 0.6 }));
  onStep: ((intensity: number) => void) | null = null;
  onLand: ((v: number) => void) | null = null;

  constructor() {
    this.group.add(this.batch.group);
    this.batch.dress(0, this.outfit);
    this.gun.matrixAutoUpdate = false;
    this.gun.visible = false;
    this.gun.castShadow = true;
    this.group.add(this.gun);
    this.motion.stride = 1.05;
    this.motion.armSwing = 0.9;
    this.motion.slouch = 0.02;
  }

  place(x: number, y: number, z: number, yaw: number) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.facing = yaw;
    this.sitting = false;
    this.sitBlend = 0;
  }

  sitAt(p: THREE.Vector3, yaw: number) {
    this.sitting = true;
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.facing = yaw;
  }

  update(dt: number, input: Input | null, camYaw: number, col: Collision, obstacles: { x: number; z: number; r: number }[]) {
    // intent in camera space
    // analog on a stick (a gentle push walks slowly), full speed from the keys
    const mv = input ? input.move() : { x: 0, y: 0, mag: 0 };
    const ix = -mv.x, iz = mv.y;
    const moving = mv.mag > 0.02;
    if (this.sitting && moving) this.sitting = false;

    this.sprinting = !!input && moving && input.state('sprint', !moving) && mv.mag > 0.5 && !this.crouching;
    this.swimming = !this.fly && inRiver(this.pos.x, this.pos.z, this.pos.y);
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
    const tx = wx * speed, tz = wz * speed;
    const rate = (moving ? ACCEL : DECEL) * (this.grounded ? 1 : 0.35);
    this.vel.x += clampAbs(tx - this.vel.x, rate * dt);
    this.vel.z += clampAbs(tz - this.vel.z, rate * dt);

    if (this.swimming) {
      // float with your head out; the quay wall has iron rungs: Space to climb out beside it
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
      }
    } else if (this.fly) {
      // noclip: straight through walls, up with Space, down with C
      const up = input ? (input.held('jump') ? 1 : 0) - (input.held('crouch') ? 1 : 0) : 0;
      this.vel.y = up * speed;
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.pos.y = Math.max(0.15, this.pos.y + this.vel.y * dt);
      this.grounded = false;
    } else if (input && this.grounded && !this.sitting && !this.busy && input.pressed('jump')) {
      this.vel.y = JUMP_V;
      this.grounded = false;
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
        if (!this.grounded && this.vel.y < -4) this.onLand?.(-this.vel.y);
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

    // face the direction of travel
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.aimYaw != null && !this.sitting) this.facing += wrap(this.aimYaw - this.facing) * Math.min(1, dt * 18);
    else if (hs > 0.25 && !this.sitting) {
      const want = Math.atan2(this.vel.x, this.vel.z);
      this.facing += wrap(want - this.facing) * Math.min(1, dt * 11);
    }

    // animation — the same rig everyone in the city uses
    const m = this.motion;
    this.sitBlend += ((this.sitting ? 1 : 0) - this.sitBlend) * Math.min(1, dt * 5);
    m.sit = this.sitBlend;
    m.speed = this.grounded || this.swimming ? hs : Math.max(hs, 2.5);
    m.armL = m.armR = this.sitting ? 'rest' : 'free';
    if (this.armPose && !this.sitting) {
      m.armR = this.armPose;
      if (this.armPose === 'guard') m.armL = 'guard';
    }
    m.lookYaw *= 0.9;
    const turnRate = hs > 0.25 ? wrap(Math.atan2(this.vel.x, this.vel.z) - this.facing) * 11 : 0;
    m.turn += (turnRate - m.turn) * Math.min(1, dt * 8);
    if (stepPhase(m, dt) && this.grounded) this.onStep?.(this.sprinting ? 1 : 0.6);
    if (!this.grounded && !this.swimming) m.phase += dt * 1.5; // legs keep moving through a jump
    if (this.swimming) {
      // a slow breaststroke: arms reach and sweep, the body low in the water
      m.phase += dt * (1.2 + hs);
      m.armL = m.armR = Math.sin(m.phase * 2) > 0 ? 'punch' : 'guard';
    }
    m.weight = Math.sin(performance.now() * 0.00021);

    this.root.compose(this.pos, _q.setFromAxisAngle(_up, this.facing), _one.setScalar(this.body.height));
    solve(this.rig, this.root, this.body, this.outfit, m, performance.now() / 1000);
    this.batch.write(0, this.rig, this.parts, false);
    this.batch.flush();
    if (this.gun.visible) this.gun.matrix.copy((this.rig as unknown as Record<string, THREE.Matrix4>).handR);
  }

  /** Wear a look (Wardrobe); the same one the other players see. */
  setLook(l: Look) {
    this.outfit = outfitFromLook(l);
    this.body = bodyFromLook(l);
    this.parts = visibleParts(this.outfit, 0);
    this.batch.dress(0, this.outfit);
  }

  /** in a car: the figure is not drawn, but position still drives the world */
  set hidden(v: boolean) {
    this.batch.group.visible = !v;
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }
}

const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _one = new THREE.Vector3(1, 1, 1);

function clampAbs(v: number, m: number) {
  return v > m ? m : v < -m ? -m : v;
}

export function wrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
