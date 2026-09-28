import * as THREE from 'three';
import type { Collision } from '../world/Collision';
import type { Player } from '../entities/Player';

/**
 * Over-the-shoulder follow camera. Mouse sets yaw/pitch; the boom shortens
 * instantly when something gets between camera and player and relaxes back
 * slowly, so walls never cut the view and the camera never snaps outward.
 */
export class FollowCamera {
  yaw = Math.PI;
  pitch = 0.12;
  sensitivity = 1;
  invertY = false;
  reducedMotion = false;
  private dist = 4.2;
  /** aiming a gun: in close over the shoulder */
  aim = false;
  private shoulder = 0.42;
  private boom = 4.2;
  private pivot = new THREE.Vector3();
  private smoothed = new THREE.Vector3();
  private initialised = false;
  private sway = 0;
  private sinceLook = 99;

  constructor(public camera: THREE.PerspectiveCamera) {}

  look(dx: number, dy: number) {
    if (dx || dy) this.sinceLook = 0;
    const s = 0.0022 * this.sensitivity;
    this.yaw -= dx * s;
    this.pitch += dy * s * (this.invertY ? -1 : 1);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -0.55, 1.0);
  }

  /** Right-stick look, already in radians (Input shapes and scales it). */
  stick(yaw: number, pitch: number) {
    if (!yaw && !pitch) return;
    this.sinceLook = 0;
    this.yaw -= yaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + pitch, -0.55, 1.0);
  }

  snap(player: Player, col: Collision | null = null) {
    this.initialised = false;
    this.update(0.016, player, col, 0);
  }

  update(dt: number, player: Player, col: Collision | null, t: number) {
    const target = this.aim ? 2.3 : player.sitting ? 5.2 : player.sprinting ? 4.7 : 4.2;
    this.shoulder += ((this.aim ? 0.62 : 0.42) - this.shoulder) * Math.min(1, dt * 8);
    this.dist += (target - this.dist) * Math.min(1, dt * 2);

    // pivot at the shoulders, a little to the right
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const want = new THREE.Vector3(player.pos.x, player.pos.y + (player.sitting ? 1.25 : 1.58), player.pos.z).addScaledVector(right, -this.shoulder);
    if (!this.initialised) this.smoothed.copy(want);
    // vertical smoothing hides kerb steps; horizontal stays tight so input feels immediate
    this.smoothed.x += (want.x - this.smoothed.x) * Math.min(1, dt * 22);
    this.smoothed.z += (want.z - this.smoothed.z) * Math.min(1, dt * 22);
    this.smoothed.y += (want.y - this.smoothed.y) * Math.min(1, dt * 9);
    this.pivot.copy(this.smoothed);

    const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    let allowed = this.dist;
    if (col) {
      const hit = col.raycast(this.pivot, dir, this.dist + 0.4);
      allowed = Math.max(0.6, Math.min(this.dist, hit - 0.35));
    }
    if (!this.initialised) this.boom = allowed;
    this.boom = allowed < this.boom ? allowed : this.boom + (allowed - this.boom) * Math.min(1, dt * 2.5);
    this.initialised = true;

    const pos = this.pivot.clone().addScaledVector(dir, this.boom);
    // never below the ground plane
    pos.y = Math.max(pos.y, player.pos.y + 0.35);
    this.camera.position.copy(pos);

    // a breath of idle sway; off with reduced motion
    this.sway = this.reducedMotion ? 0 : 1;
    const idle = player.speed < 0.2 ? 1 : 0;
    const swayY = Math.sin(t * 0.9) * 0.012 * this.sway * idle;
    const look = this.pivot.clone().addScaledVector(dir, -6);
    look.y += swayY;
    this.camera.lookAt(look);
  }

  /**
   * Chase camera for a car (driving or riding). Mouse look still orbits; after
   * a moment without input it swings back behind the car's heading.
   */
  updateVehicle(dt: number, pos: THREE.Vector3, heading: number, speed: number, col: Collision | null, shake = 0) {
    this.sinceLook += dt;
    if (this.sinceLook > 1.2 && Math.abs(speed) > 1) {
      let d = heading - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * Math.min(1, dt * 2.4);
      this.pitch += (0.16 - this.pitch) * Math.min(1, dt * 1.5);
    }
    const dist = 7 + Math.min(Math.abs(speed), 20) * 0.09;
    this.dist += (dist - this.dist) * Math.min(1, dt * 2);
    const want = new THREE.Vector3(pos.x, pos.y + 1.9, pos.z);
    if (!this.initialised) this.smoothed.copy(want);
    this.smoothed.x += (want.x - this.smoothed.x) * Math.min(1, dt * 14);
    this.smoothed.z += (want.z - this.smoothed.z) * Math.min(1, dt * 14);
    this.smoothed.y += (want.y - this.smoothed.y) * Math.min(1, dt * 6);
    this.pivot.copy(this.smoothed);
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    let allowed = this.dist;
    if (col) {
      const hit = col.raycast(this.pivot, dir, this.dist + 0.4);
      allowed = Math.max(1.2, Math.min(this.dist, hit - 0.35));
    }
    if (!this.initialised) this.boom = allowed;
    this.boom = allowed < this.boom ? allowed : this.boom + (allowed - this.boom) * Math.min(1, dt * 2.5);
    this.initialised = true;
    const cam = this.pivot.clone().addScaledVector(dir, this.boom);
    cam.y = Math.max(cam.y, pos.y + 0.6);
    if (shake > 0 && !this.reducedMotion) cam.add(new THREE.Vector3((Math.random() - 0.5) * shake * 0.5, (Math.random() - 0.5) * shake * 0.3, (Math.random() - 0.5) * shake * 0.5));
    this.camera.position.copy(cam);
    this.camera.lookAt(this.pivot.clone().addScaledVector(dir, -8));
  }

  /** Face the camera the same way the player is facing (used on spawn). */
  alignBehind(player: Player) {
    this.yaw = player.facing;
    this.pitch = 0.1;
  }
}
