import * as THREE from 'three';
import { gunKey, gunModel, type GunModel } from './Guns';
import type { Gun } from './weapons';

/**
 * First person: the gun in your hands at the bottom of the view, with the
 * forearms and gloves that hold it. It rides with the camera, swings a
 * little behind your look, bobs with your stride, kicks back on every shot,
 * dips for a reload, drops out of view for a swap, and comes up to the
 * sights when you aim (the sight lined up on the middle of the screen).
 */


export class Viewmodel {
  group = new THREE.Group();
  private rig = new THREE.Group();
  private gun: THREE.Mesh;
  private arms = new THREE.Group();
  private sleeve = new THREE.MeshStandardMaterial({ color: 0x2c3644, roughness: 0.9, emissive: 0x0b0c0e });
  private glove = new THREE.MeshStandardMaterial({ color: 0x1a1a1b, roughness: 0.7, emissive: 0x080808 });
  private id: string | null = null;
  private model: GunModel | null = null;
  private melee = false;
  /** a launcher carried on the shoulder */
  private shoulder = false;
  private swingT = 0;
  private inspectT = 0;
  private aim = 0;
  private bob = 0;
  private kickV = 0;
  private swayX = 0;
  private swayY = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private sprint = 0;

  constructor() {
    this.group.matrixAutoUpdate = false;
    // a touch lighter than the guns in the world: it's close to your eye and the yard is dark
    this.gun = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.5, emissive: 0x0e0f11 }));
    this.rig.scale.setScalar(0.82);
    this.gun.rotation.y = Math.PI; // the gun points down -z, into the view
    this.rig.add(this.gun, this.arms);
    this.group.add(this.rig);
    this.group.visible = false;
    this.group.traverse((o) => (o.frustumCulled = false));
  }

  /** Hold a different gun (and dress the sleeves in the team's colour). */
  setGun(gun: Gun, sleeve: number) {
    this.sleeve.color.setHex(sleeve);
    const key = gunKey(gun);
    if (key === this.id) return;
    this.id = key;
    const model = (this.model = gunModel(gun));
    this.melee = gun.cls === 'melee';
    this.shoulder = gun.id === 'thresher';
    this.gun.geometry = model.geo;
    this.arms.clear();
    // camera space: the grip at the origin, the gun running away down -z
    const fore = model.fore;
    if (this.melee) {
      this.limb(new THREE.Vector3(0.0, -0.03, 0.02), new THREE.Vector3(0.12, -0.22, 0.42), 0.065, this.sleeve);
      this.hand(new THREE.Vector3(0, 0, 0.0));
    } else if (model.oneHand) {
      this.limb(new THREE.Vector3(0.0, -0.06, 0.02), new THREE.Vector3(0.1, -0.22, 0.4), 0.065, this.sleeve);
      this.limb(new THREE.Vector3(-0.02, -0.08, 0.0), new THREE.Vector3(-0.16, -0.24, 0.38), 0.065, this.sleeve);
      this.hand(new THREE.Vector3(0, -0.035, 0.0));
      this.hand(new THREE.Vector3(-0.025, -0.06, -0.01));
    } else {
      this.limb(new THREE.Vector3(0.0, -0.05, 0.03), new THREE.Vector3(0.12, -0.22, 0.42), 0.07, this.sleeve);
      this.limb(new THREE.Vector3(0.0, -0.03, -fore), new THREE.Vector3(-0.2, -0.24, 0.08), 0.07, this.sleeve);
      this.hand(new THREE.Vector3(0, -0.04, 0.0));
      this.hand(new THREE.Vector3(0, -0.02, -fore));
    }
    this.group.traverse((o) => (o.frustumCulled = false));
  }

  private limb(a: THREE.Vector3, b: THREE.Vector3, w: number, mat: THREE.Material) {
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, w * 0.9, len), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize());
    this.arms.add(m);
  }

  private hand(at: THREE.Vector3) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.09), this.glove);
    m.position.copy(at);
    this.arms.add(m);
  }

  /** A melee swing: the blade comes across the view. */
  swing() {
    this.swingT = 0.001;
  }

  /** Turn the gun over and look at it. */
  inspect() {
    if (this.inspectT <= 0) this.inspectT = 0.001;
  }

  /** A shot: the gun comes back and up, then settles. */
  kick(k: number) {
    this.kickV = Math.min(1.4, this.kickV + k);
  }

  update(
    dt: number,
    cam: THREE.Camera,
    s: { aim: number; speed: number; sprint: boolean; reload: number | null; swap: number; yaw: number; pitch: number; crouch: boolean; cycle?: number; empty?: boolean },
  ) {
    if (!this.id || !this.model) return;
    this.aim = this.melee ? 0 : s.aim;
    if (this.swingT > 0) this.swingT = this.swingT + dt > 0.42 ? 0 : this.swingT + dt;
    if (this.inspectT > 0) this.inspectT = this.inspectT + dt > 2.6 || s.aim > 0.1 || s.reload != null ? 0 : this.inspectT + dt;
    this.sprint += ((s.sprint ? 1 : 0) - this.sprint) * Math.min(1, dt * 8);
    this.bob += dt * (s.speed * 2.1 + 0.6);
    this.kickV = Math.max(0, this.kickV - dt * 7);
    // the gun lags a touch behind the look
    const dy = wrap(s.yaw - this.lastYaw), dp = s.pitch - this.lastPitch;
    this.lastYaw = s.yaw;
    this.lastPitch = s.pitch;
    const lag = 1 - this.aim * 0.7;
    this.swayX += (THREE.MathUtils.clamp(dy * 1.4, -0.08, 0.08) * lag - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (THREE.MathUtils.clamp(dp * 1.4, -0.06, 0.06) * lag - this.swayY) * Math.min(1, dt * 10);

    const a = this.aim;
    const walk = Math.min(1, s.speed / 4) * (1 - a * 0.8);
    const bx = Math.sin(this.bob) * 0.011 * walk;
    const by = -Math.abs(Math.cos(this.bob)) * 0.012 * walk;
    const breathe = Math.sin(performance.now() * 0.0016) * 0.003 * (1 - a * 0.6);
    const hip = this.shoulder ? new THREE.Vector3(0.2, -0.1, -0.12) : new THREE.Vector3(0.15, -0.19, -0.42);
    // aimed: the sight a touch under the middle (the dot is the reticle), the gun low enough to see past
    const ads = this.shoulder ? new THREE.Vector3(0.07, -0.15, -0.2) : new THREE.Vector3(0, -this.model.sight * 0.82 - 0.03, -0.52);
    const p = hip.lerp(ads, a);
    p.x += bx + this.swayX * 0.5;
    p.y += by + breathe - this.swayY * 0.4 - (s.crouch ? 0.01 : 0);
    p.z += this.kickV * 0.05;
    // a reload: down and tipped; a swap: down out of view and back
    const r = s.reload == null ? 0 : Math.sin(Math.PI * Math.min(1, s.reload));
    const swap = s.swap > 0 ? Math.sin(Math.PI * Math.min(1, s.swap / 0.45)) : 0;
    // a reload from empty goes further: the gun tips right over to work the action
    const deep = s.empty ? 1.35 : 1;
    // working a bolt or a pump: a quick dip and roll
    const cyc = s.cycle != null && s.cycle > 0 ? Math.sin(Math.PI * Math.min(1, s.cycle)) : 0;
    // a swing: wound back, across and through
    const sw = this.swingT > 0 ? this.swingT / 0.42 : 0;
    const swA = sw ? Math.sin(Math.PI * sw) : 0, swB = sw ? (sw < 0.35 ? -sw / 0.35 : -1 + ((sw - 0.35) / 0.65) * 2) : 0;
    // inspecting: turned to show its side, then the other
    const ins = this.inspectT > 0 ? Math.sin(Math.PI * Math.min(1, this.inspectT / 2.6)) : 0;
    const insRoll = this.inspectT > 0 ? Math.sin((this.inspectT / 2.6) * Math.PI * 2) : 0;
    p.y -= r * 0.07 * deep + swap * 0.3 + this.sprint * 0.06 + cyc * 0.02 - ins * 0.03;
    p.x += swB * 0.1 - ins * 0.08;
    p.z += swA * -0.12 + cyc * 0.02;
    this.rig.position.copy(p);
    this.rig.rotation.set(
      this.kickV * 0.1 - r * 0.55 * deep - swap * 0.6 + this.sprint * 0.25 - this.swayY * 0.6 - swA * 0.5 + cyc * 0.12 + ins * 0.2,
      -this.swayX * 0.8 + this.sprint * 0.55 + swB * 0.9 + ins * 0.9,
      r * 0.35 * deep + this.sprint * 0.3 + bx * 2 + cyc * 0.25 + insRoll * 0.6 + swA * 0.8,
      'YXZ',
    );
    cam.updateMatrixWorld();
    this.group.matrix.copy(cam.matrixWorld);
    this.group.matrixWorld.copy(cam.matrixWorld);
    this.rig.updateMatrixWorld(true);
  }

  /** The muzzle, in the world (for the tracer and the flash). */
  muzzle(out: THREE.Vector3) {
    if (!this.model) return out;
    this.gun.updateMatrixWorld(true);
    return out.copy(this.model.muzzle).applyMatrix4(this.gun.matrixWorld);
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }
}

function wrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
