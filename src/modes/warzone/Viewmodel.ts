import * as THREE from 'three';
import { MUZZLE, gunGeometry } from './Guns';
import type { GunId } from './weapons';

/**
 * First person: the gun in your hands at the bottom of the view, with the
 * forearms and gloves that hold it. It rides with the camera, swings a
 * little behind your look, bobs with your stride, kicks back on every shot,
 * dips for a reload, drops out of view for a swap, and comes up to the
 * sights when you aim (the sight lined up on the middle of the screen).
 */

/** how high each gun's sight sits over its grip (so aiming puts it dead centre) */
const SIGHT: Record<GunId, number> = { carbine: 0.118, smg: 0.1, marksman: 0.148, shotgun: 0.076, pistol: 0.072 };
/** where the left hand holds it, along the gun */
const FORE: Record<GunId, number> = { carbine: 0.3, smg: 0.2, marksman: 0.34, shotgun: 0.36, pistol: 0.0 };

export class Viewmodel {
  group = new THREE.Group();
  private rig = new THREE.Group();
  private gun: THREE.Mesh;
  private arms = new THREE.Group();
  private sleeve = new THREE.MeshStandardMaterial({ color: 0x2c3644, roughness: 0.9, emissive: 0x0b0c0e });
  private glove = new THREE.MeshStandardMaterial({ color: 0x1a1a1b, roughness: 0.7, emissive: 0x080808 });
  private id: GunId | null = null;
  private aim = 0;
  private bob = 0;
  private kickV = 0;
  private swayX = 0;
  private swayY = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private sprint = 0;
  private geos = new Map<GunId, THREE.BufferGeometry>();

  constructor() {
    this.group.matrixAutoUpdate = false;
    // a touch lighter than the guns in the world: it's close to your eye and the yard is dark
    this.gun = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: 0x34363a, roughness: 0.4, metalness: 0.5, emissive: 0x0e0f11 }));
    this.rig.scale.setScalar(0.82);
    this.gun.rotation.y = Math.PI; // the gun points down -z, into the view
    this.rig.add(this.gun, this.arms);
    this.group.add(this.rig);
    this.group.visible = false;
    this.group.traverse((o) => (o.frustumCulled = false));
  }

  /** Hold a different gun (and dress the sleeves in the team's colour). */
  setGun(id: GunId, sleeve: number) {
    this.sleeve.color.setHex(sleeve);
    if (id === this.id) return;
    this.id = id;
    let g = this.geos.get(id);
    if (!g) this.geos.set(id, (g = gunGeometry(id)));
    this.gun.geometry = g;
    this.arms.clear();
    // camera space: the grip at the origin, the gun running away down -z
    const fore = FORE[id];
    if (id === 'pistol') {
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

  /** A shot: the gun comes back and up, then settles. */
  kick(k: number) {
    this.kickV = Math.min(1.4, this.kickV + k);
  }

  update(
    dt: number,
    cam: THREE.Camera,
    s: { aim: boolean; speed: number; sprint: boolean; reload: number | null; swap: number; yaw: number; pitch: number; crouch: boolean },
  ) {
    if (!this.id) return;
    this.aim += ((s.aim ? 1 : 0) - this.aim) * Math.min(1, dt * 14);
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
    const hip = new THREE.Vector3(0.15, -0.19, -0.42);
    // aimed: the sight a touch under the middle (the dot is the reticle), the gun low enough to see past
    const ads = new THREE.Vector3(0, -SIGHT[this.id] * 0.82 - 0.03, -0.52);
    const p = hip.lerp(ads, a);
    p.x += bx + this.swayX * 0.5;
    p.y += by + breathe - this.swayY * 0.4 - (s.crouch ? 0.01 : 0);
    p.z += this.kickV * 0.05;
    // a reload: down and tipped; a swap: down out of view and back
    const r = s.reload == null ? 0 : Math.sin(Math.PI * Math.min(1, s.reload));
    const swap = s.swap > 0 ? Math.sin(Math.PI * Math.min(1, s.swap / 0.45)) : 0;
    p.y -= r * 0.07 + swap * 0.3 + this.sprint * 0.06;
    this.rig.position.copy(p);
    this.rig.rotation.set(this.kickV * 0.1 - r * 0.55 - swap * 0.6 + this.sprint * 0.25 - this.swayY * 0.6, -this.swayX * 0.8 + this.sprint * 0.55, r * 0.35 + this.sprint * 0.3 + bx * 2, 'YXZ');
    cam.updateMatrixWorld();
    this.group.matrix.copy(cam.matrixWorld);
    this.group.matrixWorld.copy(cam.matrixWorld);
    this.rig.updateMatrixWorld(true);
  }

  /** The muzzle, in the world (for the tracer and the flash). */
  muzzle(out: THREE.Vector3) {
    if (!this.id) return out;
    this.gun.updateMatrixWorld(true);
    return out.set(0, 0.05, MUZZLE[this.id]).applyMatrix4(this.gun.matrixWorld);
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
