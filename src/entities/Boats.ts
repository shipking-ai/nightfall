import * as THREE from 'three';
import type { Materials } from '../world/materials';
import type { Input } from '../core/Input';

/** The river (world/layout RIVER) and its surface. */
export const WATER_Y = -2.6;
export const RIVER_Z0 = 164.9;
export const RIVER_Z1 = 199.1;
/** the promenade just above the quay wall, where you climb out */
export const QUAY_Z = 162.4;

export function inRiver(x: number, z: number, y: number) {
  return z > 164.4 && z < 199.6 && y < -0.5 && Math.abs(x) < 1e5;
}

export interface Boat {
  group: THREE.Group;
  pos: THREE.Vector3;
  yaw: number;
  v: number;
  occupied: boolean;
  lamp: THREE.Mesh;
}

/**
 * A few launches moored below the promenade. Step down (E) from the quay,
 * WASD to go, Space to throttle back hard, E to step off (onto the quay if
 * you're alongside it, otherwise into the water).
 */
export class Boats {
  group = new THREE.Group();
  boats: Boat[] = [];
  private t = 0;

  constructor(mats: Materials) {
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x1d2a33, roughness: 0.5, metalness: 0.2 });
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x6a5238, roughness: 0.8 });
    const white = new THREE.MeshStandardMaterial({ color: 0x7c7b76, roughness: 0.7 });
    for (const [x, yaw, color] of [[-58, Math.PI / 2, 0x1d2a33], [46, -Math.PI / 2, 0x3a1f1c], [118, Math.PI / 2, 0x243326]] as const) {
      const g = new THREE.Group();
      const hull = new THREE.Mesh(hullShape(), color === 0x1d2a33 ? hullMat : new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2 }));
      hull.castShadow = true;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 3.4).translate(0, 0.62, -0.35), deckMat);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.75, 1.1).translate(0, 1.0, 0.35), white);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.34, 0.05).rotateX(-0.35).translate(0, 1.2, 0.93), mats.darkGlass);
      const motor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.7, 0.4).translate(0, 0.55, -2.15), mats.rubber);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6).translate(0, 1.45, 0.35), mats.lampWarm);
      g.add(hull, deck, cabin, glass, motor, lamp);
      const b: Boat = { group: g, pos: new THREE.Vector3(x, WATER_Y, 166.6), yaw, v: 0, occupied: false, lamp };
      this.boats.push(b);
      this.group.add(g);
    }
  }

  /** A boat you could step down into from where you stand on the promenade. */
  nearest(p: THREE.Vector3): Boat | null {
    if (p.z < 159 || p.z > 163.3 || p.y < -0.5) return null;
    let best: Boat | null = null, bd = 4.5;
    for (const b of this.boats) {
      if (b.occupied) continue;
      const d = Math.hypot(b.pos.x - p.x, (b.pos.z - p.z) * 0.5);
      if (d < bd) (best = b), (bd = d);
    }
    return best;
  }

  drive(b: Boat, dt: number, input: Input | null) {
    let throttle = 0, steer = 0, brake = false;
    if (input) {
      if (input.isDown('KeyW') || input.isDown('ArrowUp')) throttle += 1;
      if (input.isDown('KeyS') || input.isDown('ArrowDown')) throttle -= 1;
      if (input.isDown('KeyA') || input.isDown('ArrowLeft')) steer += 1;
      if (input.isDown('KeyD') || input.isDown('ArrowRight')) steer -= 1;
      brake = input.isDown('Space');
    }
    const max = throttle >= 0 ? 17 : 5;
    b.v += (throttle * max - b.v) * Math.min(1, dt * (throttle ? 0.7 : 0.35));
    if (brake) b.v *= 1 - Math.min(1, dt * 2.5);
    b.yaw += steer * dt * (0.25 + Math.min(1, Math.abs(b.v) / 6) * 0.75) * Math.sign(b.v || 1);
    b.pos.x += Math.sin(b.yaw) * b.v * dt;
    b.pos.z += Math.cos(b.yaw) * b.v * dt;
    // the banks: bump off and lose speed
    const lo = RIVER_Z0 + 1.2, hi = RIVER_Z1 - 1.2;
    if (b.pos.z < lo || b.pos.z > hi) {
      b.pos.z = THREE.MathUtils.clamp(b.pos.z, lo, hi);
      b.v *= 0.4;
    }
    return { throttle, steer };
  }

  update(dt: number, steerOf: (b: Boat) => number) {
    this.t += dt;
    for (const [i, b] of this.boats.entries()) {
      if (!b.occupied) b.v *= 1 - Math.min(1, dt * 0.6);
      const bob = Math.sin(this.t * 1.3 + i) * 0.05 + Math.sin(this.t * 2.1 + i * 2) * 0.025;
      b.group.position.set(b.pos.x, WATER_Y - 0.28 + bob, b.pos.z);
      // nose up with speed, lean into turns, rock a little always
      b.group.rotation.set(-Math.min(0.12, Math.abs(b.v) * 0.008) + Math.sin(this.t * 1.7 + i) * 0.02, b.yaw, -steerOf(b) * Math.min(1, Math.abs(b.v) / 10) * 0.12 + Math.sin(this.t * 1.1 + i) * 0.025, 'YXZ');
    }
  }
}

/** A launch's hull: a pointed bow, a flat transom. */
function hullShape() {
  const s = new THREE.Shape();
  s.moveTo(-0.95, -2.3);
  s.lineTo(0.95, -2.3);
  s.lineTo(0.95, 0.8);
  s.quadraticCurveTo(0.9, 2.1, 0, 2.6);
  s.quadraticCurveTo(-0.9, 2.1, -0.95, 0.8);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.75, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2 });
  // shape lies in XY; stand it up so its length runs along z and its depth becomes height
  g.rotateX(Math.PI / 2);
  g.translate(0, 0.65, 0);
  return g;
}
