import * as THREE from 'three';

export interface Shot {
  caption: string;
  from: THREE.Vector3;
  to: THREE.Vector3;
  lookFrom: THREE.Vector3;
  lookTo: THREE.Vector3;
  duration: number;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** The title sequence: slow dollies through the district, cut through black. */
export const SHOTS: Shot[] = [
  { caption: 'Central Avenue', from: v(1.6, 1.15, 126), to: v(0.4, 1.45, 102), lookFrom: v(-1, 7, -30), lookTo: v(-2, 8.5, -40), duration: 15 },
  { caption: 'The Riverside', from: v(-64, 2.0, 157.5), to: v(-50, 2.3, 158.5), lookFrom: v(6, 3.2, 178), lookTo: v(10, 3.6, 180), duration: 14 },
  { caption: 'Kestrel Market', from: v(-81, 1.5, 58), to: v(-81, 1.8, 46), lookFrom: v(-80, 3.5, 4), lookTo: v(-80, 3.8, 0), duration: 14 },
  { caption: 'The Old Station', from: v(15, 1.3, -110), to: v(8, 1.8, -121), lookFrom: v(0, 11, -152), lookTo: v(0, 12, -152), duration: 14 },
  { caption: 'Pier 9 Yard', from: v(58, 1.8, 66), to: v(62, 2.6, 60), lookFrom: v(78, 14, 10), lookTo: v(80, 12, 8), duration: 13 },
];

/** Title-sequence camera and the push-in used when entering the world. */
export class CinematicCamera {
  index = 0;
  t = 0;
  reducedMotion = false;
  private look = new THREE.Vector3();
  private pushT = -1;
  private pushFrom = new THREE.Vector3();
  private pushDir = new THREE.Vector3();

  constructor(public camera: THREE.PerspectiveCamera) {}

  get shot() {
    return SHOTS[this.index];
  }

  /** Seconds left in the current shot. */
  get remaining() {
    return this.shot.duration - this.t;
  }

  next() {
    this.index = (this.index + 1) % SHOTS.length;
    this.t = 0;
  }

  update(dt: number, time: number) {
    if (this.pushT >= 0) {
      this.pushT += dt;
      const k = this.pushT;
      // slow start, then commit: a breath before stepping in
      const d = Math.pow(k, 2.2) * 2.4;
      this.camera.position.copy(this.pushFrom).addScaledVector(this.pushDir, d);
      return;
    }
    this.t += dt;
    const s = this.shot;
    const k = this.reducedMotion ? 0.5 : ease(Math.min(1, this.t / s.duration));
    this.camera.position.lerpVectors(s.from, s.to, k);
    this.look.lerpVectors(s.lookFrom, s.lookTo, k);
    if (!this.reducedMotion) {
      // a hand-held breath, never a shake
      this.camera.position.y += Math.sin(time * 0.55) * 0.025;
      this.look.x += Math.sin(time * 0.31) * 0.12;
      this.look.y += Math.sin(time * 0.43) * 0.08;
    }
    this.camera.lookAt(this.look);
  }

  beginPush() {
    this.pushT = 0;
    this.pushFrom.copy(this.camera.position);
    this.camera.getWorldDirection(this.pushDir);
  }

  endPush() {
    this.pushT = -1;
  }
}

function ease(x: number) {
  return x * x * (3 - 2 * x) * 0.5 + x * 0.5;
}
