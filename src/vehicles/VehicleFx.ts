import * as THREE from 'three';

/**
 * What tyres and engines leave in the air and on the road:
 * - spray thrown up behind the wheels on a wet road (more with speed),
 * - smoke from tyres that are sliding (burnouts, handbrake turns, locked
 *   brakes) and from a hurt engine,
 * - skid marks: dark rubber laid where a tyre slid, fading over a minute.
 *
 * Everything is pooled (fixed buffers, no allocation per frame) and there's
 * a budget: far cars don't emit, and the oldest particle is reused first.
 */

const MAX_P = 700;
const MAX_MARKS = 900;

interface P {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  size: number; grow: number;
  /** 0 spray (bright, falls), 1 smoke (grey, rises and spreads) */
  kind: number;
}

export class VehicleFx {
  group = new THREE.Group();
  private ps: P[] = [];
  private next = 0;
  private pos = new Float32Array(MAX_P * 3);
  private data = new Float32Array(MAX_P * 3); // size, alpha, kind
  private geo = new THREE.BufferGeometry();
  private marks: THREE.InstancedMesh;
  private markAge = new Float32Array(MAX_MARKS);
  private markNext = 0;
  private lastMark = new Map<object, THREE.Vector3>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private v = new THREE.Vector3();

  constructor() {
    for (let i = 0; i < MAX_P; i++) this.ps.push({ x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0.3, grow: 0, kind: 0 });
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('pdata', new THREE.BufferAttribute(this.data, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 500 } },
      vertexShader: `attribute vec3 pdata; varying vec2 vD; uniform float uScale;
        void main() { vD = pdata.yz; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = pdata.x * uScale / max(0.5, -mv.z); }`,
      fragmentShader: `varying vec2 vD;
        void main() { vec2 c = gl_PointCoord - 0.5; float r = length(c); if (r > 0.5) discard;
          float soft = smoothstep(0.5, 0.0, r);
          vec3 col = mix(vec3(0.72, 0.76, 0.8), vec3(0.62, 0.6, 0.58), vD.y);
          gl_FragColor = vec4(col, soft * vD.x); }`,
    });
    const pts = new THREE.Points(this.geo, mat);
    pts.frustumCulled = false;
    this.group.add(pts);
    // skid marks: flat dark quads on the road
    const mg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mm = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.95, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.marks = new THREE.InstancedMesh(mg, mm, MAX_MARKS);
    this.marks.frustumCulled = false;
    this.marks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_MARKS; i++) this.marks.setMatrixAt(i, this.m);
    this.group.add(this.marks);
  }

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grow: number, kind: number) {
    const p = this.ps[this.next];
    this.next = (this.next + 1) % MAX_P;
    Object.assign(p, { x, y, z, vx, vy, vz, life, max: life, size, grow, kind });
  }

  /**
   * One car's wheels this frame. `wheels` gives each wheel's world contact
   * point, how much it's sliding and whether it's on the ground.
   */
  wheel(key: object, x: number, y: number, z: number, vx: number, vz: number, slip: number, speed: number, wet: number, dt: number, near: boolean) {
    if (!near) return;
    // spray: a fan of droplets behind a wheel on a wet road
    if (wet > 0.2 && speed > 6) {
      const n = Math.min(3, Math.floor(speed * wet * dt * 12 + Math.random()));
      for (let i = 0; i < n; i++) this.emit(x, y + 0.1, z, -vx * 0.15 + (Math.random() - 0.5) * 2, 0.8 + Math.random() * 1.5, -vz * 0.15 + (Math.random() - 0.5) * 2, 0.45 + Math.random() * 0.35, 0.12, 0.9, 0);
    }
    // smoke from a sliding tyre (not on a wet road: there it's spray)
    if (slip > 0.55 && speed > 1.5 && wet < 0.6) {
      if (Math.random() < dt * 30 * (slip - 0.5)) this.emit(x, y + 0.15, z, (Math.random() - 0.5) * 0.8, 0.4 + Math.random() * 0.5, (Math.random() - 0.5) * 0.8, 1.6 + Math.random(), 0.5, 1.6, 1);
    }
    // rubber on the road
    const last = this.lastMark.get(key);
    if (slip > 0.6 && speed > 2) {
      const here = this.v.set(x, y + 0.012, z);
      if (last) {
        const d = last.distanceTo(here);
        if (d > 0.25) {
          const i = this.markNext;
          this.markNext = (this.markNext + 1) % MAX_MARKS;
          this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(here.x - last.x, here.z - last.z));
          this.m.compose(this.s.set((last.x + here.x) / 2, (last.y + here.y) / 2, (last.z + here.z) / 2), this.q, new THREE.Vector3(0.2, 1, d + 0.02));
          this.marks.setMatrixAt(i, this.m);
          this.markAge[i] = 60;
          this.marks.instanceMatrix.needsUpdate = true;
          last.copy(here);
        }
      } else this.lastMark.set(key, here.clone());
    } else if (last) this.lastMark.delete(key);
  }

  /** A hurt engine smokes from under the bonnet. */
  engine(x: number, y: number, z: number, damage: number, dt: number) {
    if (damage < 0.4 || Math.random() > dt * 14 * damage) return;
    this.emit(x, y, z, (Math.random() - 0.5) * 0.3, 0.8 + Math.random() * 0.6, (Math.random() - 0.5) * 0.3, 2.2 + Math.random(), 0.35, 1.8, 1);
  }

  update(dt: number, cam: THREE.PerspectiveCamera, height: number) {
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    const mat = (this.group.children[0] as THREE.Points).material as THREE.ShaderMaterial;
    mat.uniforms.uScale.value = height / (2 * Math.tan((cam.fov * Math.PI) / 360));
    for (let i = 0; i < MAX_P; i++) {
      const p = this.ps[i];
      if (p.life <= 0) {
        this.data[i * 3 + 1] = 0;
        continue;
      }
      p.life -= dt;
      if (p.kind === 0) p.vy -= 9.8 * dt;
      else {
        p.vy += 0.3 * dt;
        p.vx *= 1 - dt * 0.8;
        p.vz *= 1 - dt * 0.8;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.size += p.grow * dt * (p.kind ? 1 : 0.3);
      const k = p.life / p.max;
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      this.data[i * 3] = p.size;
      this.data[i * 3 + 1] = (p.kind ? 0.3 : 0.12) * Math.min(1, k * 2) * Math.min(1, (1 - k) * 6);
      this.data[i * 3 + 2] = p.kind;
    }
    (this.geo.attributes.pdata as THREE.BufferAttribute).needsUpdate = true;
    // old skid marks fade out (then their slot is free)
    let dirty = false;
    for (let i = 0; i < MAX_MARKS; i++) {
      if (this.markAge[i] <= 0) continue;
      this.markAge[i] -= dt;
      if (this.markAge[i] <= 0) {
        this.m.makeScale(0, 0, 0);
        this.marks.setMatrixAt(i, this.m);
        dirty = true;
      }
    }
    if (dirty) this.marks.instanceMatrix.needsUpdate = true;
  }

  clear() {
    for (const p of this.ps) p.life = 0;
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_MARKS; i++) {
      this.markAge[i] = 0;
      this.marks.setMatrixAt(i, this.m);
    }
    this.marks.instanceMatrix.needsUpdate = true;
    this.lastMark.clear();
  }
}
