import * as THREE from 'three';

/**
 * Blood: a short spray of droplets where a hit lands (thrown along the shot,
 * falling), and a dark pool that spreads under someone who's down.
 * Pooled; can be switched off in Settings.
 */
const DROPS = 160;
const POOLS = 16;

export class Blood {
  group = new THREE.Group();
  enabled = true;
  private drops: THREE.InstancedMesh;
  private dp = Array.from({ length: DROPS }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0 }));
  private next = 0;
  private pools: { mesh: THREE.Mesh; grow: number; size: number; key: unknown }[] = [];
  private nextPool = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();

  constructor() {
    this.drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.025, 5, 4), new THREE.MeshBasicMaterial({ color: 0x8a0a0a }), DROPS);
    this.drops.frustumCulled = false;
    this.drops.count = DROPS;
    for (let i = 0; i < DROPS; i++) this.drops.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    this.group.add(this.drops);
    const mat = new THREE.MeshStandardMaterial({ color: 0x6a0707, emissive: 0x2a0000, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.92, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false });
    for (let i = 0; i < POOLS; i++) {
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), mat);
      mesh.visible = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.pools.push({ mesh, grow: 0, size: 1, key: null });
    }
  }

  /** A hit at `at`, the shot travelling along `dir`. */
  spray(at: THREE.Vector3, dir: THREE.Vector3, amount = 1) {
    if (!this.enabled) return;
    const n = Math.round(10 + 10 * amount);
    for (let k = 0; k < n; k++) {
      const d = this.dp[this.next];
      this.next = (this.next + 1) % DROPS;
      d.p.copy(at);
      d.v.set(dir.x * 2.2 + (Math.random() - 0.5) * 2.4, 0.6 + Math.random() * 2, dir.z * 2.2 + (Math.random() - 0.5) * 2.4);
      d.life = 0.6 + Math.random() * 0.5;
    }
  }

  /** Someone down at `at`: a pool spreads under them (once per `key`). */
  pool(at: THREE.Vector3, key: unknown) {
    if (!this.enabled || this.pools.some((p) => p.key === key && p.mesh.visible)) return;
    const p = this.pools[this.nextPool];
    this.nextPool = (this.nextPool + 1) % POOLS;
    p.key = key;
    p.grow = 0;
    p.size = 0.55 + Math.random() * 0.35;
    p.mesh.position.set(at.x + (Math.random() - 0.5) * 0.3, at.y + 0.012, at.z + (Math.random() - 0.5) * 0.3);
    p.mesh.rotation.y = Math.random() * Math.PI;
    p.mesh.scale.setScalar(0.01);
    p.mesh.visible = true;
  }

  /** Someone got up (or was cleaned away): their pool goes. */
  clear(key: unknown) {
    for (const p of this.pools) if (p.key === key) p.mesh.visible = false;
  }

  update(dt: number) {
    for (let i = 0; i < DROPS; i++) {
      const d = this.dp[i];
      if (d.life <= 0) continue;
      d.life -= dt;
      d.v.y -= 9.8 * dt;
      d.p.addScaledVector(d.v, dt);
      if (d.p.y < 0.16) d.life = 0;
      const sc = d.life > 0 ? 1 : 0;
      this.drops.setMatrixAt(i, this.m.compose(d.p, this.q, this.s.set(sc, sc * 1.6, sc)));
    }
    this.drops.instanceMatrix.needsUpdate = true;
    for (const p of this.pools) {
      if (!p.mesh.visible || p.grow >= 1) continue;
      p.grow = Math.min(1, p.grow + dt * 0.12);
      const k = p.size * Math.sqrt(p.grow);
      p.mesh.scale.set(k, 1, k * 0.8);
    }
  }
}
