import * as THREE from 'three';

/**
 * What a blow looks like where it lands: a burst of sparks (warm for a hit,
 * cold for a block, gold for a parry), a ring that snaps open on the heavy
 * ones, and dust off the road when someone hits it. Small and quick: the
 * animation and the hitstop carry the weight; this is the punctuation.
 */
export type Burst = 'hit' | 'heavy' | 'block' | 'parry' | 'dust' | 'ex';

const MAX = 160;
const COLORS: Record<Burst, [number, number, number][]> = {
  hit: [[1, 0.85, 0.6], [1, 0.55, 0.25], [1, 1, 0.9]],
  heavy: [[1, 0.7, 0.35], [1, 0.4, 0.15], [1, 0.95, 0.8]],
  block: [[0.6, 0.8, 1], [0.85, 0.95, 1], [0.4, 0.6, 1]],
  parry: [[1, 0.9, 0.4], [1, 1, 0.8], [1, 0.75, 0.2]],
  dust: [[0.32, 0.31, 0.3], [0.26, 0.26, 0.27], [0.4, 0.38, 0.35]],
  ex: [[0.6, 0.85, 1], [1, 1, 1], [0.8, 0.6, 1]],
};

/** A pool of points that fly, fall (or drift, for dust) and fade. */
class Pool {
  pos: Float32Array;
  col: Float32Array;
  vel: Float32Array;
  base: Float32Array;
  life: Float32Array;
  geo = new THREE.BufferGeometry();
  points: THREE.Points;
  private next = 0;

  constructor(private max: number, mat: THREE.PointsMaterial, private dust: boolean) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -999;
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
  }

  spawn(at: THREE.Vector3, v: [number, number, number], c: [number, number, number], life: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set([at.x, at.y, at.z], i * 3);
    this.vel.set(v, i * 3);
    this.base.set(c, i * 3);
    this.col.set(c, i * 3);
    this.life[i] = life;
  }

  update(dt: number) {
    const drag = this.dust ? 0.9 : 0.95;
    const g = this.dust ? -0.3 : 14;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const j = i * 3;
      if (this.life[i] <= 0) {
        this.pos[j + 1] = -999;
        continue;
      }
      this.vel[j] *= drag;
      this.vel[j + 2] *= drag;
      this.vel[j + 1] = this.vel[j + 1] * drag - g * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      const k = Math.min(1, this.life[i] * (this.dust ? 1.4 : 5));
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

export class FightFx {
  group = new THREE.Group();
  private sparks = new Pool(MAX, new THREE.PointsMaterial({ size: 0.055, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), false);
  private dust = new Pool(64, new THREE.PointsMaterial({ size: 0.18, vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false }), true);
  private rings: { mesh: THREE.Mesh; t: number; dur: number; size: number }[] = [];

  constructor() {
    this.group.add(this.sparks.points, this.dust.points);
    const ringGeo = new THREE.RingGeometry(0.82, 1, 40);
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.rings.push({ mesh, t: 1, dur: 1, size: 1 });
    }
  }

  /** A burst at a point; `power` 0..1 scales how much. `dir` throws the sparks that way. */
  burst(kind: Burst, at: THREE.Vector3, power: number, dir?: THREE.Vector3) {
    const dusty = kind === 'dust';
    const n = dusty ? 10 + Math.round(power * 14) : 8 + Math.round(power * 22);
    const cs = COLORS[kind];
    for (let k = 0; k < n; k++) {
      const sp = dusty ? 0.6 + Math.random() * 1.4 : 2 + Math.random() * 5 * (0.5 + power);
      let vx = Math.random() * 2 - 1, vy = Math.random() * 2 - 1, vz = Math.random() * 2 - 1;
      const l = Math.hypot(vx, vy, vz) || 1;
      vx /= l;
      vy /= l;
      vz /= l;
      if (dir) {
        vx += dir.x * 1.2;
        vy += dir.y * 1.2;
        vz += dir.z * 1.2;
      }
      if (dusty) vy = Math.abs(vy) * 0.4;
      (dusty ? this.dust : this.sparks).spawn(at, [vx * sp, vy * sp, vz * sp], cs[k % cs.length], dusty ? 0.8 + Math.random() * 0.5 : 0.18 + Math.random() * 0.3 * (0.5 + power));
    }
    if (kind === 'heavy' || kind === 'parry' || kind === 'ex' || (kind === 'hit' && power > 0.6)) this.ring(at, kind === 'parry' ? 0xffd070 : kind === 'ex' ? 0x9ed0ff : 0xffc890, 0.5 + power * 0.9);
  }

  ring(at: THREE.Vector3, color: number, size: number) {
    const r = this.rings.find((x) => x.t >= x.dur) ?? this.rings[0];
    r.mesh.position.copy(at);
    (r.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    r.t = 0;
    r.dur = 0.22;
    r.size = size;
    r.mesh.visible = true;
  }

  update(dt: number, cam: THREE.Camera) {
    this.sparks.update(dt);
    this.dust.update(dt);
    for (const r of this.rings) {
      if (r.t >= r.dur) {
        r.mesh.visible = false;
        continue;
      }
      r.t += dt;
      const k = Math.min(1, r.t / r.dur);
      r.mesh.quaternion.copy(cam.quaternion);
      r.mesh.scale.setScalar(r.size * (0.25 + 0.75 * (1 - (1 - k) * (1 - k))));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9;
    }
  }

  clear() {
    this.sparks.clear();
    this.dust.clear();
    for (const r of this.rings) r.t = r.dur;
  }
}
