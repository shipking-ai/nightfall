import * as THREE from 'three';

/**
 * Gunfire you can see: a bright streak from the muzzle to where it hit,
 * a flash at the muzzle, a puff where it landed. Pooled; nothing allocates
 * per shot. (No lights: the shader light count must never change.)
 */
const N = 24;

export class Tracers {
  group = new THREE.Group();
  private lines: THREE.LineSegments;
  private pos: Float32Array;
  private col: Float32Array;
  private life = new Float32Array(N);
  private flashes: THREE.Mesh[] = [];
  private flashLife = new Float32Array(N);
  private next = 0;

  constructor() {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 6);
    this.col = new Float32Array(N * 6);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.lines.frustumCulled = false;
    this.group.add(this.lines);
    const tex = flashTexture();
    for (let i = 0; i < N; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, color: 0xffc27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      m.visible = false;
      this.flashes.push(m);
      this.group.add(m);
    }
  }

  shot(from: THREE.Vector3, to: THREE.Vector3, hit: boolean) {
    const i = this.next;
    this.next = (this.next + 1) % N;
    this.pos.set([from.x, from.y, from.z, to.x, to.y, to.z], i * 6);
    this.life[i] = 1;
    this.flash(from, 0.55, i);
    if (hit) this.flash(to, 0.3, (i + N / 2) % N);
  }

  private flash(p: THREE.Vector3, size: number, i: number) {
    const m = this.flashes[i];
    m.position.copy(p);
    m.scale.setScalar(size);
    m.visible = true;
    this.flashLife[i] = 1;
  }

  update(dt: number, camera: THREE.Camera) {
    for (let i = 0; i < N; i++) {
      if (this.life[i] > 0) {
        this.life[i] = Math.max(0, this.life[i] - dt * 9);
        const k = this.life[i];
        this.col.set([1.0 * k, 0.8 * k, 0.45 * k, 0.5 * k, 0.35 * k, 0.2 * k], i * 6);
      }
      if (this.flashLife[i] > 0) {
        this.flashLife[i] -= dt * 16;
        const m = this.flashes[i];
        m.visible = this.flashLife[i] > 0;
        m.quaternion.copy(camera.quaternion);
        (m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, this.flashLife[i]);
      }
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.attributes.color.needsUpdate = true;
  }
}

function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,240,1)');
  r.addColorStop(0.25, 'rgba(255,200,120,0.8)');
  r.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
