import * as THREE from 'three';

/**
 * Blood that behaves like a liquid, not a red firework.
 *
 * A wound throws droplets along the impact (and out of the far side for a
 * through-and-through): fine mist that hangs a moment, and heavier drops that
 * fly on real arcs under gravity, drawn stretched along their velocity. Each
 * drop that lands leaves a mark whose shape comes from how it landed: round
 * when it fell straight, an elongated teardrop with spatter satellites when it
 * came in fast and shallow. Drops that meet a wall leave a mark on the wall.
 *
 * Under someone who's down a pool spreads (fast at first, then slowing),
 * irregular at the edge, darkening as it dries. Walk through one and your
 * next steps print. Someone wounded who's still moving drips a trail.
 *
 * Rain thins everything: marks wash out and pale, pools spread wider and
 * fainter. Everything decays (nothing's permanent in a city that loops) and
 * everything is pooled and budgeted: far hits make fewer drops, and the
 * oldest marks are reused first.
 *
 * Kinds of wound read differently: a bullet is a fast narrow cone and a fine
 * mist (an exit spray behind); a blunt blow is a few heavy drops; a cut is a
 * line of drops flicked off the blade; a vehicle is a lot of everything.
 */

export type Wound = 'bullet' | 'blunt' | 'cut' | 'vehicle' | 'bite';

const DROPS = 600;
const MARKS = 700;
const POOLS = 24;

interface Drop {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
  size: number;
  /** 1 mist (hangs, fades, never lands), 0 a drop (falls and marks) */
  mist: number;
}

const markVert = /* glsl */ `
  attribute vec4 aMark; // x: age 0..1 (1 fresh), y: seed, z: elongation, w: kind (0 splat, 1 print, 2 drip, 3 wall)
  varying vec2 vUv;
  varying vec4 vMark;
  void main() {
    vUv = uv;
    vMark = aMark;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }`;

const markFrag = /* glsl */ `
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float seed = vMark.y * 37.0;
    float a = 0.0;
    if (vMark.w < 0.5 || vMark.w > 2.5) {
      // a splat: a lobed main drop (elongated along +y by the impact), and satellites flung beyond it
      vec2 q = vec2(p.x, (p.y + vMark.z * 0.35) / (1.0 + vMark.z));
      float ang = atan(q.y, q.x);
      float r = 0.42 + 0.08 * sin(ang * 5.0 + seed) + 0.06 * sin(ang * 9.0 + seed * 1.7) + 0.1 * (n(q * 3.0 + seed) - 0.5);
      a = smoothstep(r, r - 0.06, length(q));
      // spatter: small drops, more of them along the throw
      for (int i = 0; i < 7; i++) {
        float fi = float(i);
        vec2 c = vec2(h(vec2(fi, seed)) - 0.5, h(vec2(seed, fi)) * (0.4 + vMark.z) + 0.1) * vec2(1.4, 1.6) - vec2(0.0, 0.05);
        float s = 0.04 + 0.06 * h(vec2(fi * 3.1, seed));
        a = max(a, smoothstep(s, s * 0.6, length(p - c)));
      }
      if (vMark.w > 2.5) {
        // on a wall it runs: a drip line below the splat
        float run = smoothstep(0.06, 0.0, abs(p.x - (h(vec2(seed, 9.0)) - 0.5) * 0.4)) * step(p.y, -0.2) * smoothstep(-1.0, -0.2, p.y + 0.4 * h(vec2(seed, 3.0)));
        a = max(a, run * 0.9);
      }
    } else if (vMark.w < 1.5) {
      // a footprint: sole and heel, partial as the blood runs out
      vec2 q = p * vec2(1.0, 0.55);
      float sole = smoothstep(0.34, 0.3, length((q - vec2(0.0, 0.18)) * vec2(1.0, 1.15)));
      float heel = smoothstep(0.26, 0.22, length(q + vec2(0.0, 0.3)));
      a = max(sole, heel) * smoothstep(0.25, 0.6, n(p * 6.0 + seed));
    } else {
      // a drip: a small round drop with a crown
      float r = 0.5 + 0.08 * sin(atan(p.y, p.x) * 7.0 + seed);
      a = smoothstep(r, r - 0.1, length(p));
    }
    // fresh blood is a deep glossy red; old is brown-black; rain thins it pink and pale
    float age = vMark.x;
    vec3 fresh = vec3(0.16, 0.004, 0.003), old = vec3(0.045, 0.012, 0.008), thin = vec3(0.2, 0.035, 0.028);
    vec3 col = mix(old, fresh, smoothstep(0.55, 1.0, age));
    col = mix(col, thin, uWet * 0.35);
    // thicker in the middle
    col *= 0.8 + 0.2 * (1.0 - length(p));
    float alpha = a * min(1.0, age * 3.0) * (0.95 - uWet * 0.35);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, alpha);
  }`;

const dropVert = /* glsl */ `
  attribute vec4 aDrop; // xyz velocity, w size
  attribute float aMist;
  varying vec2 vUv;
  varying float vMist;
  void main() {
    vUv = uv;
    vMist = aMist;
    // a quad facing the camera, stretched along the drop's velocity (motion reads as a streak)
    vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec3 v = (modelViewMatrix * vec4(aDrop.xyz, 0.0)).xyz;
    vec2 d = length(v.xy) > 1e-4 ? normalize(v.xy) : vec2(0.0, 1.0);
    vec2 side = vec2(-d.y, d.x);
    float stretch = 1.0 + min(3.0, length(aDrop.xyz) * 0.12) * (1.0 - aMist);
    vec2 off = side * position.x * aDrop.w + d * position.y * aDrop.w * stretch;
    c.xy += off * (1.0 + aMist * 2.5);
    gl_Position = projectionMatrix * c;
  }`;
const dropFrag = /* glsl */ `
  varying vec2 vUv;
  varying float vMist;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float a = mix(smoothstep(1.0, 0.7, r), smoothstep(1.0, 0.0, r) * 0.28, vMist);
    // a wet glint on the heavier drops
    vec3 col = vec3(0.1, 0.004, 0.003) + vec3(0.12) * smoothstep(0.35, 0.0, length(p - vec2(-0.3, 0.35))) * (1.0 - vMist);
    gl_FragColor = vec4(col, a);
  }`;

export class Blood {
  group = new THREE.Group();
  enabled = true;
  /** the ground's height under a point (set by the game), and how far a ray goes before it hits a wall */
  ground: (x: number, z: number, y: number) => number = () => 0;
  wall: ((o: THREE.Vector3, dir: THREE.Vector3, max: number) => number) | null = null;
  /** 0..1 rain: washes marks out */
  wet = 0;
  /** where the camera is (fewer drops for far hits) */
  eye = new THREE.Vector3();

  private drops: THREE.InstancedMesh;
  private dropAttr: THREE.InstancedBufferAttribute;
  private mistAttr: THREE.InstancedBufferAttribute;
  private dp: Drop[] = [];
  private next = 0;
  private marks: THREE.InstancedMesh;
  private markAttr: THREE.InstancedBufferAttribute;
  private markLife = new Float32Array(MARKS);
  private markMax = new Float32Array(MARKS);
  private nextMark = 0;
  private pools: { mesh: THREE.Mesh; grow: number; size: number; key: unknown; age: number; mat: THREE.MeshStandardMaterial & { uniforms: Record<string, { value: number }> } }[] = [];
  private nextPool = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private e = new THREE.Euler();
  private wetU = { value: 0 };
  /** feet that stepped in blood: prints left for a few steps */
  private prints = new Map<unknown, number>();
  private dripT = new Map<unknown, number>();

  constructor() {
    // droplets and mist
    const dg = new THREE.PlaneGeometry(2, 2);
    const dm = new THREE.ShaderMaterial({ vertexShader: dropVert, fragmentShader: dropFrag, transparent: true, depthWrite: false });
    this.drops = new THREE.InstancedMesh(dg, dm, DROPS);
    this.dropAttr = new THREE.InstancedBufferAttribute(new Float32Array(DROPS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.mistAttr = new THREE.InstancedBufferAttribute(new Float32Array(DROPS), 1).setUsage(THREE.DynamicDrawUsage);
    dg.setAttribute('aDrop', this.dropAttr);
    dg.setAttribute('aMist', this.mistAttr);
    this.drops.frustumCulled = false;
    this.drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < DROPS; i++) {
      this.dp.push({ x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0, life: 0, size: 0.01, mist: 0 });
      this.drops.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    }
    this.group.add(this.drops);
    // marks: splats, prints, drips (floor and wall), one instanced quad each
    const mg = new THREE.PlaneGeometry(1, 1);
    void markVert;
    this.markAttr = new THREE.InstancedBufferAttribute(new Float32Array(MARKS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    mg.setAttribute('aMark', this.markAttr);
    // lit like the street it's on: glossy and near-black-red when fresh (lamps glint in it), matte brown when dry
    const mm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    mm.onBeforeCompile = (sh) => {
      sh.uniforms.uWet = this.wetU;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aMark;\nvarying vec4 vMark;\nvarying vec2 vUv2;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMark = aMark;\nvUv2 = uv;');
      const body = markFrag.slice(markFrag.indexOf('void main() {') + 'void main() {'.length, markFrag.lastIndexOf('}'))
        .replace('gl_FragColor = vec4(col, alpha);', 'diffuseColor = vec4(col, alpha); nfAge = age;')
        .replace('if (alpha < 0.01) discard;', 'if (alpha < 0.01) discard;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uWet;\nvarying vec4 vMark;\nvarying vec2 vUv2;\nfloat nfAge = 1.0;\n' + markFrag.slice(markFrag.indexOf('float h('), markFrag.indexOf('void main()')))
        .replace('#include <color_fragment>', '{ vec2 vUv = vUv2;\n' + body + '\n}')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.65, 0.12, smoothstep(0.4, 0.9, nfAge));');
    };
    mm.customProgramCacheKey = () => 'nf-blood-mark';
    this.marks = new THREE.InstancedMesh(mg, mm, MARKS);
    this.marks.frustumCulled = false;
    this.marks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.marks.renderOrder = 2;
    for (let i = 0; i < MARKS; i++) this.marks.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    this.group.add(this.marks);
    // pools: a disc with an irregular, slowly spreading edge
    for (let i = 0; i < POOLS; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.08, metalness: 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }) as THREE.MeshStandardMaterial & { uniforms: Record<string, { value: number }> };
      mat.uniforms = { uGrow: { value: 0 }, uAge: { value: 1 }, uSeed: { value: Math.random() * 10 }, uWet: this.wetU };
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, mat.uniforms);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = position.xz;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', `#include <common>
uniform float uGrow; uniform float uAge; uniform float uSeed; uniform float uWet; varying vec2 vP;
float ph(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float pn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(ph(i),ph(i+vec2(1,0)),f.x),mix(ph(i+vec2(0,1)),ph(i+vec2(1,1)),f.x),f.y); }`)
          .replace('#include <color_fragment>', `{
  float ang = atan(vP.y, vP.x);
  float r = uGrow * (0.78 + 0.12 * sin(ang*3.0+uSeed) + 0.1 * pn(vP*4.0+uSeed) + 0.06*sin(ang*7.0+uSeed*2.0)) * (1.0 + uWet * 0.5);
  float d = length(vP);
  float a = smoothstep(r, r - 0.05, d);
  if (a < 0.01) discard;
  vec3 fresh = vec3(0.13, 0.003, 0.002), old = vec3(0.035, 0.009, 0.006);
  vec3 col = mix(old, fresh, uAge);
  col = mix(col, col * 0.7, smoothstep(r - 0.05, r - 0.2, d) * (1.0 - uAge));
  col = mix(col, vec3(0.16, 0.03, 0.024), uWet * 0.35);
  diffuseColor = vec4(col, a * (0.97 - uWet * 0.3));
}`)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.55, 0.05, uAge);');
      };
      mat.customProgramCacheKey = () => 'nf-blood-pool';
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4, 1, 1).rotateX(-Math.PI / 2), mat);
      mesh.visible = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.pools.push({ mesh, grow: 0, size: 1, key: null, age: 1, mat });
    }
  }

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, mist: number) {
    const d = this.dp[this.next];
    this.next = (this.next + 1) % DROPS;
    d.x = x;
    d.y = y;
    d.z = z;
    d.vx = vx;
    d.vy = vy;
    d.vz = vz;
    d.life = life;
    d.size = size;
    d.mist = mist;
  }

  /**
   * A wound at `at`, the blow travelling along `dir`. `amount` scales it
   * (a graze to a terrible hit); `kind` shapes it.
   */
  spray(at: THREE.Vector3, dir: THREE.Vector3, amount = 1, kind: Wound = 'bullet') {
    if (!this.enabled) return;
    const far = Math.min(1, this.eye.distanceTo(at) / 60);
    const budget = 1 - 0.7 * far;
    const hl = Math.hypot(dir.x, dir.z) || 1;
    const dx = dir.x / hl, dz = dir.z / hl;
    const R = (a: number) => (Math.random() - 0.5) * a;
    if (kind === 'bullet') {
      // entry: a puff of mist back toward the shooter; exit: a narrow fast cone onward
      const mist = Math.round(8 * amount * budget);
      for (let i = 0; i < mist; i++) this.emit(at.x, at.y, at.z, -dx * 0.6 + R(0.8), 0.2 + R(0.5), -dz * 0.6 + R(0.8), 0.25 + Math.random() * 0.25, 0.04 + Math.random() * 0.05, 1);
      const n = Math.round((10 + 12 * amount) * budget);
      for (let i = 0; i < n; i++) {
        const sp = 3 + Math.random() * 5 * amount;
        this.emit(at.x, at.y, at.z, dx * sp + R(1.4), dir.y * sp + 0.4 + R(1.2), dz * sp + R(1.4), 1.5, 0.006 + Math.random() * 0.012, 0);
      }
      for (let i = 0; i < 4 * amount * budget; i++) this.emit(at.x, at.y, at.z, dx * 4 + R(3), 1 + R(1), dz * 4 + R(3), 0.6, 0.05, 1);
      // through and through: onto whatever's behind
      if (this.wall && amount > 0.4) {
        const d = this.wall(at, this.p.set(dx, 0, dz), 2.5);
        if (d < 2.5) this.wallMark(at.x + dx * (d - 0.03), at.y + R(0.3) + 0.05 * d, at.z + dz * (d - 0.03), dx, dz, 0.3 + 0.35 * amount);
      }
    } else if (kind === 'blunt' || kind === 'bite') {
      // a few heavy drops, slower, spread wider
      const n = Math.round((5 + 6 * amount) * budget);
      for (let i = 0; i < n; i++) {
        const sp = 1.5 + Math.random() * 2.5;
        this.emit(at.x, at.y, at.z, dx * sp + R(2.2), 0.8 + Math.random() * 1.5, dz * sp + R(2.2), 1.5, 0.012 + Math.random() * 0.018, 0);
      }
    } else if (kind === 'cut') {
      // flicked off the blade: a line of drops across the swing
      const sx = -dz, sz = dx;
      const n = Math.round((8 + 8 * amount) * budget);
      for (let i = 0; i < n; i++) {
        const t = i / n - 0.5;
        this.emit(at.x + sx * t * 0.3, at.y, at.z + sz * t * 0.3, sx * (2 + t * 4) + dx, 1 + Math.random(), sz * (2 + t * 4) + dz, 1.5, 0.008 + Math.random() * 0.01, 0);
      }
    } else {
      // a vehicle: a lot, low and forward
      const n = Math.round((20 + 20 * amount) * budget);
      for (let i = 0; i < n; i++) {
        const sp = 2 + Math.random() * 6;
        this.emit(at.x, at.y, at.z, dx * sp + R(3), 0.5 + Math.random() * 2, dz * sp + R(3), 1.5, 0.01 + Math.random() * 0.02, 0);
      }
    }
  }

  /** A drop landed (floor): a mark shaped by how it came in. */
  private landMark(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number) {
    const i = this.nextMark;
    this.nextMark = (this.nextMark + 1) % MARKS;
    const hv = Math.hypot(vx, vz);
    const angle = Math.atan2(hv, Math.max(0.1, -vy)); // 0 straight down … π/2 skimming
    const elong = Math.min(2.5, Math.tan(Math.min(1.3, angle)) * 0.8);
    const s = size * (9 + 4 * Math.random()) * (1 + 0.15 * hv);
    this.q.setFromEuler(this.e.set(-Math.PI / 2, 0, Math.atan2(vx, vz) + Math.PI, "YXZ"));
    this.m.compose(this.s.set(x, y + 0.01, z), this.q, this.p.set(s, s * (1 + elong), 1));
    this.marks.setMatrixAt(i, this.m);
    this.markAttr.setXYZW(i, 1, Math.random(), elong, 0);
    this.markLife[i] = this.markMax[i] = 150 + Math.random() * 60;
    this.marks.instanceMatrix.needsUpdate = true;
    this.markAttr.needsUpdate = true;
  }

  /** A splash on a wall (facing back along dx,dz), with a run below it. */
  private wallMark(x: number, y: number, z: number, dx: number, dz: number, size: number) {
    const i = this.nextMark;
    this.nextMark = (this.nextMark + 1) % MARKS;
    this.q.setFromEuler(this.e.set(0, Math.atan2(-dx, -dz), Math.random() * 0.4 - 0.2, 'YXZ'));
    this.m.compose(this.s.set(x, y, z), this.q, this.p.set(size, size * 1.6, 1));
    this.marks.setMatrixAt(i, this.m);
    this.markAttr.setXYZW(i, 1, Math.random(), 0.3, 3);
    this.markLife[i] = this.markMax[i] = 200;
    this.marks.instanceMatrix.needsUpdate = true;
    this.markAttr.needsUpdate = true;
  }

  private flatMark(x: number, y: number, z: number, yaw: number, sx: number, sz: number, kind: number) {
    const i = this.nextMark;
    this.nextMark = (this.nextMark + 1) % MARKS;
    this.q.setFromEuler(this.e.set(-Math.PI / 2, yaw, 0, 'YXZ'));
    this.m.compose(this.s.set(x, y + 0.011, z), this.q, this.p.set(sx, sz, 1));
    this.marks.setMatrixAt(i, this.m);
    this.markAttr.setXYZW(i, 1, Math.random(), 0, kind);
    this.markLife[i] = this.markMax[i] = kind === 1 ? 90 : 120;
    this.marks.instanceMatrix.needsUpdate = true;
    this.markAttr.needsUpdate = true;
  }

  /** Someone down at `at`: a pool spreads under them (once per `key`). */
  pool(at: THREE.Vector3, key: unknown, size = 1) {
    if (!this.enabled || this.pools.some((p) => p.key === key && p.mesh.visible)) return;
    const p = this.pools[this.nextPool];
    this.nextPool = (this.nextPool + 1) % POOLS;
    p.key = key;
    p.grow = 0;
    p.age = 1;
    p.size = (0.6 + Math.random() * 0.4) * size;
    p.mesh.position.set(at.x + (Math.random() - 0.5) * 0.3, this.ground(at.x, at.z, at.y + 0.5) + 0.013, at.z + (Math.random() - 0.5) * 0.3);
    p.mesh.rotation.y = Math.random() * Math.PI;
    p.mesh.visible = true;
  }

  /** Someone got up (or was cleaned away): their pool goes. */
  clear(key: unknown) {
    for (const p of this.pools) if (p.key === key) p.mesh.visible = false;
    this.prints.delete(key);
    this.dripT.delete(key);
  }

  /**
   * A foot came down (`key` is whose). Near a pool, the sole picks it up and
   * the next several steps print, fainter each time.
   */
  step(key: unknown, x: number, y: number, z: number, yaw: number, left: boolean) {
    if (!this.enabled) return;
    for (const p of this.pools) {
      if (!p.mesh.visible) continue;
      const r = p.size * Math.sqrt(p.grow) * 1.1;
      if (Math.hypot(p.mesh.position.x - x, p.mesh.position.z - z) < r) this.prints.set(key, 8);
    }
    const n = this.prints.get(key) ?? 0;
    if (n <= 0) return;
    this.prints.set(key, n - 1);
    const side = left ? -0.1 : 0.1;
    this.flatMark(x + Math.cos(yaw) * side, this.ground(x, z, y + 0.5), z - Math.sin(yaw) * side, yaw + Math.PI, 0.12, 0.3, 1);
  }

  /** Someone wounded is moving: drops fall behind them now and then (`rate` 0..1). */
  drip(key: unknown, x: number, y: number, z: number, rate: number, dt: number) {
    if (!this.enabled || rate <= 0) return;
    const t = (this.dripT.get(key) ?? 0) - dt * rate;
    if (t > 0) return void this.dripT.set(key, t);
    this.dripT.set(key, 0.35 + Math.random() * 0.8);
    const s = 0.05 + Math.random() * 0.05;
    this.flatMark(x + (Math.random() - 0.5) * 0.3, this.ground(x, z, y + 0.5), z + (Math.random() - 0.5) * 0.3, Math.random() * 6.28, s, s, 2);
  }

  update(dt: number) {
    this.wetU.value += (this.wet - this.wetU.value) * Math.min(1, dt * 0.3);
    const wash = 1 + this.wet * 4;
    for (let i = 0; i < DROPS; i++) {
      const d = this.dp[i];
      if (d.life <= 0) {
        this.drops.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        continue;
      }
      d.life -= dt;
      if (d.mist) {
        // mist hangs and drifts
        d.vx *= 1 - dt * 3;
        d.vz *= 1 - dt * 3;
        d.vy = d.vy * (1 - dt * 3) - 0.3 * dt;
      } else {
        d.vy -= 9.8 * dt;
        // a little air drag on the small ones
        const k = 1 - dt * (0.6 / (1 + d.size * 60));
        d.vx *= k;
        d.vz *= k;
      }
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      if (!d.mist) {
        const g = this.ground(d.x, d.z, d.y + 0.3);
        if (d.y <= g) {
          this.landMark(d.x, g, d.z, d.vx, d.vy, d.vz, d.size);
          d.life = 0;
        }
      }
      const vis = d.life > 0 ? 1 : 0;
      this.m.makeTranslation(d.x, d.y, d.z);
      if (!vis) this.m.makeScale(0, 0, 0);
      this.drops.setMatrixAt(i, this.m);
      const fade = d.mist ? Math.min(1, d.life * 4) : 1;
      this.dropAttr.setXYZW(i, d.vx, d.vy, d.vz, d.size * fade);
      this.mistAttr.setX(i, d.mist);
    }
    this.drops.instanceMatrix.needsUpdate = true;
    this.dropAttr.needsUpdate = true;
    this.mistAttr.needsUpdate = true;
    // marks dry and fade (faster in the rain)
    let dirty = false;
    for (let i = 0; i < MARKS; i++) {
      if (this.markLife[i] <= 0) continue;
      this.markLife[i] -= dt * wash;
      const age = Math.max(0, this.markLife[i] / this.markMax[i]);
      this.markAttr.setX(i, age);
      if (this.markLife[i] <= 0) {
        this.marks.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        this.marks.instanceMatrix.needsUpdate = true;
      }
      dirty = true;
    }
    if (dirty) this.markAttr.needsUpdate = true;
    // pools spread (fast, then slower), darken as they dry
    for (const p of this.pools) {
      if (!p.mesh.visible) continue;
      p.grow = Math.min(1, p.grow + dt * 0.05 * (1.4 - p.grow));
      p.age = Math.max(0, p.age - dt / 240);
      p.mat.uniforms.uGrow.value = p.size * Math.sqrt(p.grow);
      p.mat.uniforms.uAge.value = p.age;
    }
  }
}
