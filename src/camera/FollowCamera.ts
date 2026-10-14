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
  /** a one-off kick from something hitting you; decays on its own */
  private kick = 0;
  private dist = 4.2;
  /** aiming a gun: in close over the shoulder */
  aim = false;
  /** how far you can look down and up (first person looks further) */
  pitchMin = -0.55;
  pitchMax = 1.0;
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
    this.pitch = THREE.MathUtils.clamp(this.pitch, this.pitchMin, this.pitchMax);
  }

  /** Right-stick look, already in radians (Input shapes and scales it). */
  stick(yaw: number, pitch: number) {
    if (!yaw && !pitch) return;
    this.sinceLook = 0;
    this.yaw -= yaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + pitch, this.pitchMin, this.pitchMax);
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
    const want = new THREE.Vector3(player.pos.x, player.pos.y + (player.sitting ? 1.25 : player.crouching ? 1.15 : 1.58), player.pos.z).addScaledVector(right, -this.shoulder);
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
    this.applyKick(pos, dt);
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
    this.applyKick(cam, dt);
    this.camera.position.copy(cam);
    this.camera.lookAt(this.pivot.clone().addScaledVector(dir, -8));
  }

  /** A hard knock: shake the view once, then let it settle. */
  shake(amount: number) {
    this.kick = Math.min(1.4, this.kick + amount);
  }

  /** The same kick in whatever view is current. */
  private applyKick(p: THREE.Vector3, dt: number) {
    if (this.kick <= 0) return;
    this.kick = Math.max(0, this.kick - dt * 2.2);
    if (this.reducedMotion) return;
    const k = this.kick * this.kick;
    p.x += (Math.random() - 0.5) * k * 0.5;
    p.y += (Math.random() - 0.5) * k * 0.4;
    p.z += (Math.random() - 0.5) * k * 0.5;
  }

  /** which driving view: chase, far chase, hood, cockpit, bumper, cinematic */
  carView = 0;
  static CAR_VIEWS = ['Chase', 'Far chase', 'Hood', 'Cockpit', 'Bumper', 'Cinematic'] as const;
  private carLag = new THREE.Vector3();
  private cineT = 0;
  private cineAt = new THREE.Vector3();
  private fovBase = 0;

  /**
   * Driving: the camera belongs to the car. It trails on a spring (so it
   * swings wide in a slide and drops back under acceleration), leans a little
   * with the body, widens its view with speed, and settles back behind after
   * you look round. Hood, cockpit and bumper views ride the body itself, so
   * the suspension moves them. The cinematic view cuts between roadside and
   * tracking shots the way a replay would.
   */
  updateCar(dt: number, c: { pos: THREE.Vector3; yaw: number; speed: number; body: THREE.Matrix4; length: number; height: number; seat: { x: number; y: number; z: number }; ax: number; ay: number; slip: number }, col: Collision | null, shake = 0) {
    const cam = this.camera;
    if (!this.fovBase) this.fovBase = cam.fov;
    this.sinceLook += dt;
    const v = Math.abs(c.speed);
    const view = this.carView;
    const tmp = new THREE.Vector3();
    // more view at speed (a sense of it, not a fish-eye)
    const fov = this.fovBase + Math.min(12, v * 0.35) * (view === 3 ? 0.4 : 1);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 2);
      cam.updateProjectionMatrix();
    }
    const fwd = new THREE.Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw));
    if (view === 2 || view === 3 || view === 4) {
      // riding the body: hood, the driver's eyes, the front bumper
      const local = view === 3 ? tmp.set(c.seat.x, c.seat.y + 0.8, c.seat.z + 0.1) : view === 2 ? tmp.set(0, c.height * 0.62 + 0.25, c.length * 0.28) : tmp.set(0, 0.45, c.length / 2 + 0.1);
      cam.position.copy(local.applyMatrix4(c.body));
      // look where the car goes, with a little of your own look on top
      if (this.sinceLook > 1.2) {
        let d = c.yaw - this.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yaw += d * Math.min(1, dt * 4);
        this.pitch += (0 - this.pitch) * Math.min(1, dt * 3);
      }
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(c.body));
      const look = new THREE.Vector3(-Math.sin(this.yaw - c.yaw), Math.sin(-this.pitch * 0.5), Math.cos(this.yaw - c.yaw)).applyQuaternion(q);
      look.set(-look.x, look.y, look.z);
      const lookW = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch * 0.5), Math.sin(-this.pitch * 0.5) - 0.04, Math.cos(this.yaw) * Math.cos(this.pitch * 0.5));
      cam.up.set(0, 1, 0).applyQuaternion(q);
      cam.lookAt(tmp.copy(cam.position).add(lookW));
      cam.up.set(0, 1, 0);
      void look;
      return;
    }
    if (view === 5) {
      // cinematic: a roadside camera that watches you pass, then the next one ahead
      this.cineT -= dt;
      if (this.cineT <= 0 || cam.position.distanceTo(c.pos) > 45) {
        this.cineT = 3 + Math.random() * 2.5;
        const side = Math.random() < 0.5 ? -1 : 1;
        const ahead = 14 + v * 1.6;
        this.cineAt.copy(c.pos).addScaledVector(fwd, ahead).add(tmp.set(fwd.z * side * (5 + Math.random() * 5), 0, -fwd.x * side * (5 + Math.random() * 5)));
        this.cineAt.y = c.pos.y + 0.6 + Math.random() * 1.8;
      }
      cam.position.copy(this.cineAt);
      cam.lookAt(tmp.copy(c.pos).setY(c.pos.y + 0.8));
      return;
    }
    // chase views: behind and above, on a spring that lets the car move within the frame
    if (this.sinceLook > 1.2) {
      let d = c.yaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      // swing round behind faster the faster you go; slower in a slide (the camera shows the drift)
      this.yaw += d * Math.min(1, dt * (1.2 + Math.min(2.5, v * 0.12)) * (1 - 0.6 * c.slip));
      this.pitch += ((view === 1 ? 0.2 : 0.13) - this.pitch) * Math.min(1, dt * 1.5);
    }
    const base = (view === 1 ? 9.5 : 6.4) + c.length * 0.25;
    const dist = base + Math.min(v, 30) * 0.05 - Math.max(-2, Math.min(2, c.ax)) * 0.18;
    this.dist += (dist - this.dist) * Math.min(1, dt * 2.5);
    const want = tmp.set(c.pos.x, c.pos.y + c.height * 0.85 + (view === 1 ? 0.9 : 0.35), c.pos.z);
    if (!this.initialised) this.smoothed.copy(want);
    // the lag: the car leads the camera a little under hard acceleration and in turns
    this.smoothed.x += (want.x - this.smoothed.x) * Math.min(1, dt * 10);
    this.smoothed.z += (want.z - this.smoothed.z) * Math.min(1, dt * 10);
    this.smoothed.y += (want.y - this.smoothed.y) * Math.min(1, dt * 5);
    this.pivot.copy(this.smoothed);
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    let allowed = this.dist;
    if (col) allowed = Math.max(1.4, Math.min(this.dist, col.raycast(this.pivot, dir, this.dist + 0.4) - 0.35));
    if (!this.initialised) this.boom = allowed;
    this.boom = allowed < this.boom ? allowed : this.boom + (allowed - this.boom) * Math.min(1, dt * 2.5);
    this.initialised = true;
    const p = this.pivot.clone().addScaledVector(dir, this.boom);
    p.y = Math.max(p.y, c.pos.y + 0.6);
    // shake from impacts and rough ground only (no constant wobble), gentle, and none with reduced motion
    if (shake > 0 && !this.reducedMotion) p.add(tmp.set((Math.random() - 0.5) * shake * 0.35, (Math.random() - 0.5) * shake * 0.2, (Math.random() - 0.5) * shake * 0.35));
    this.carLag.lerp(tmp.set(c.ay * 0.02, 0, 0), Math.min(1, dt * 3));
    this.applyKick(p, dt);
    cam.position.copy(p);
    cam.lookAt(this.pivot.clone().addScaledVector(dir, -8).add(new THREE.Vector3(0, -0.4, 0)));
    // lean with the car in a hard corner (a degree or two)
    cam.rotateZ(Math.max(-0.035, Math.min(0.035, -c.ay * 0.004)) * (this.reducedMotion ? 0 : 1));
  }

  /** Put the view back to how it was (off the road). */
  endCar() {
    if (this.fovBase) {
      this.camera.fov = this.fovBase;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Face the camera the same way the player is facing (used on spawn). */
  alignBehind(player: Player) {
    this.yaw = player.facing;
    this.pitch = 0.1;
  }
}
