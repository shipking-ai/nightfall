import * as THREE from 'three';

/**
 * What explodes looks like it: a fireball that blooms and goes, a shock
 * ring along the ground, sparks and grit thrown out and falling, and a
 * column of smoke that hangs and drifts. Rockets and grenades in flight
 * are drawn here too, with the rocket's exhaust trail. Pooled; nothing
 * allocates per blast.
 */

const SMOKE = 220;
const SPARK = 260;
const BALLS = 6;
const FLY = 24;

function softDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class Points {
  pos: Float32Array;
  col: Float32Array;
  vel: Float32Array;
  base: Float32Array;
  life: Float32Array;
  max0: Float32Array;
  geo = new THREE.BufferGeometry();
  obj: THREE.Points;
  private next = 0;

  constructor(private max: number, mat: THREE.PointsMaterial, private grav: number, private drag: number, private fadeIn: boolean) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.max0 = new Float32Array(max);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -999;
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.obj = new THREE.Points(this.geo, mat);
    this.obj.frustumCulled = false;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, c: number, life: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.base.set([c, c * 0.98, c * 0.95], i * 3);
    this.life[i] = this.max0[i] = life;
  }

  tint(r: number, g: number, b: number) {
    const i = (this.next + this.max - 1) % this.max;
    this.base.set([r, g, b], i * 3);
  }

  update(dt: number) {
    const d = Math.pow(this.drag, dt * 60);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const j = i * 3;
      if (this.life[i] <= 0) {
        this.pos[j + 1] = -999;
        continue;
      }
      this.vel[j] *= d;
      this.vel[j + 2] *= d;
      this.vel[j + 1] = this.vel[j + 1] * d - this.grav * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] = Math.max(this.grav > 0 ? 0.02 : -999, this.pos[j + 1] + this.vel[j + 1] * dt);
      const age = 1 - this.life[i] / this.max0[i];
      const k = this.fadeIn ? Math.min(1, age * 8) * (1 - age) : Math.min(1, this.life[i] * 4);
      this.col[j] = this.base[j] * k;
      this.col[j + 1] = this.base[j + 1] * k;
      this.col[j + 2] = this.base[j + 2] * k;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    for (let i = 0; i < this.max; i++) this.pos[i * 3 + 1] = -999;
    this.geo.attributes.position.needsUpdate = true;
  }
}

export class Blasts {
  group = new THREE.Group();
  private smoke: Points;
  private sparks: Points;
  private balls: { m: THREE.Mesh; t: number; r: number }[] = [];
  private rings: { m: THREE.Mesh; t: number; r: number }[] = [];
  private fly: THREE.InstancedMesh;
  private flyN = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private z = new THREE.Vector3(0, 0, 1);

  constructor() {
    const dot = softDot();
    this.smoke = new Points(SMOKE, new THREE.PointsMaterial({ size: 2.4, map: dot, vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false }), -0.35, 0.985, true);
    this.sparks = new Points(SPARK, new THREE.PointsMaterial({ size: 0.09, map: dot, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 9.8, 0.99, false);
    this.group.add(this.smoke.obj, this.sparks.obj);
    const ballGeo = new THREE.IcosahedronGeometry(1, 2);
    for (let i = 0; i < BALLS; i++) {
      const m = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      m.visible = false;
      this.group.add(m);
      this.balls.push({ m, t: 9, r: 1 });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd8a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      ring.visible = false;
      this.group.add(ring);
      this.rings.push({ m: ring, t: 9, r: 1 });
    }
    const body = new THREE.CylinderGeometry(0.035, 0.035, 0.42, 8).rotateX(Math.PI / 2);
    this.fly = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ color: 0x3d4632, roughness: 0.6, metalness: 0.3 }), FLY);
    this.fly.count = 0;
    this.fly.frustumCulled = false;
    this.group.add(this.fly);
  }

  /** A blast of radius r (metres). */
  boom(at: THREE.Vector3, r: number) {
    const b = this.balls.find((x) => x.t > 0.5) ?? this.balls[0];
    b.t = 0;
    b.r = r * 0.55;
    b.m.position.copy(at);
    b.m.visible = true;
    const ring = this.rings.find((x) => x.t > 0.5) ?? this.rings[0];
    ring.t = 0;
    ring.r = r * 1.4;
    ring.m.position.set(at.x, Math.max(0.05, at.y - 0.3), at.z);
    ring.m.visible = true;
    for (let k = 0; k < 70; k++) {
      const a = Math.random() * Math.PI * 2, u = Math.random() * 0.9 + 0.1, sp = 6 + Math.random() * 16;
      this.sparks.spawn(at.x, at.y + 0.2, at.z, Math.cos(a) * sp * (1 - u * 0.5), u * sp, Math.sin(a) * sp * (1 - u * 0.5), 1, 0.4 + Math.random() * 0.9);
      this.sparks.tint(1, 0.6 + Math.random() * 0.3, 0.25);
    }
    // grit thrown up (dark, falls back)
    for (let k = 0; k < 40; k++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 7;
      this.sparks.spawn(at.x, at.y + 0.1, at.z, Math.cos(a) * sp, 3 + Math.random() * 8, Math.sin(a) * sp, 1, 1 + Math.random());
      this.sparks.tint(0.08, 0.07, 0.06);
    }
    // the smoke: a dark core, rising and spreading
    for (let k = 0; k < 26; k++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * r * 0.5;
      this.smoke.spawn(at.x + Math.cos(a) * d, at.y + Math.random() * r * 0.4, at.z + Math.sin(a) * d, Math.cos(a) * 1.5, 1.2 + Math.random() * 2.2, Math.sin(a) * 1.5, 0.12 + Math.random() * 0.1, 3 + Math.random() * 3);
    }
  }

  /** A puff of exhaust behind a rocket, or of dust where something lands. */
  puff(at: THREE.Vector3, shade = 0.35, life = 1.4) {
    this.smoke.spawn(at.x, at.y, at.z, (Math.random() - 0.5) * 0.4, 0.3 + Math.random() * 0.3, (Math.random() - 0.5) * 0.4, shade, life);
  }

  /** Start the frame's flying things, then draw each with `flying`. */
  beginFly() {
    this.flyN = 0;
  }

  flying(at: THREE.Vector3, vel: THREE.Vector3, scale = 1) {
    if (this.flyN >= FLY) return;
    this.q.setFromUnitVectors(this.z, this.s.copy(vel).normalize());
    this.m.compose(at, this.q, this.s.setScalar(scale));
    this.fly.setMatrixAt(this.flyN++, this.m);
  }

  update(dt: number) {
    this.fly.count = this.flyN;
    this.fly.instanceMatrix.needsUpdate = true;
    this.smoke.update(dt);
    this.sparks.update(dt);
    for (const b of this.balls) {
      if (b.t > 0.5) continue;
      b.t += dt;
      const k = Math.min(1, b.t / 0.35);
      b.m.scale.setScalar(b.r * (0.3 + 0.9 * Math.sqrt(k)));
      const mat = b.m.material as THREE.MeshBasicMaterial;
      mat.opacity = (1 - k) * 0.95;
      mat.color.setRGB(1, 0.75 - k * 0.45, 0.35 - k * 0.3);
      if (k >= 1) (b.m.visible = false), (b.t = 9);
    }
    for (const r of this.rings) {
      if (r.t > 0.5) continue;
      r.t += dt;
      const k = Math.min(1, r.t / 0.3);
      r.m.scale.setScalar(r.r * (0.2 + 0.8 * k));
      (r.m.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.7;
      if (k >= 1) (r.m.visible = false), (r.t = 9);
    }
  }

  clear() {
    this.smoke.clear();
    this.sparks.clear();
    for (const b of [...this.balls, ...this.rings]) (b.t = 9), (b.m.visible = false);
    this.fly.count = 0;
  }
}
