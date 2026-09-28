import * as THREE from 'three';
import type { Body } from '../../entities/Humanoid';
import { bindPose, jointMatrices, BIND_BONES } from './bind';
import { headCentre, type HumanSpec, type Joints } from './anatomy';
import type { BuiltHuman } from './build';
import { skinMaterial, fabricMaterial, hairMaterial, eyeMaterial } from './materials';

/**
 * A person in the RPG: the sculpted meshes, skinned to one skeleton that
 * follows the shared rig. After the rig is solved for a frame, `pose()` copies
 * its joints into the bones; the GPU does the rest.
 *
 * Meshes come from the worker at three levels of detail; the best one ready
 * for the distance is drawn, so people appear straight away (coarse) and gain
 * their faces a moment later.
 */

type Req = { resolve: (h: BuiltHuman) => void; reject: (e: unknown) => void };

class Factory {
  private worker: Worker | null = null;
  private pending = new Map<number, Req>();
  private cache = new Map<string, Promise<BuiltHuman>>();
  private next = 1;
  private queue: (() => void)[] = [];
  private busy = 0;

  private get w() {
    if (!this.worker) {
      this.worker = new Worker(new URL('./human.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ id: number; human?: BuiltHuman; error?: string }>) => {
        const r = this.pending.get(e.data.id);
        this.pending.delete(e.data.id);
        this.busy--;
        if (e.data.human) r?.resolve(e.data.human);
        else r?.reject(new Error(e.data.error));
        this.queue.shift()?.();
      };
    }
    return this.worker;
  }

  /** Build (or reuse) one person at one level of detail. Lower levels jump the queue. */
  build(spec: HumanSpec, joints: Joints, lod: number): Promise<BuiltHuman> {
    const key = `${lod}|${JSON.stringify(spec)}|${joints.headScale}|${joints.shR[0].toFixed(3)}|${joints.hipR[0].toFixed(3)}`;
    let p = this.cache.get(key);
    if (p) return p;
    p = new Promise<BuiltHuman>((resolve, reject) => {
      const go = () => {
        const id = this.next++;
        this.pending.set(id, { resolve, reject });
        this.busy++;
        this.w.postMessage({ id, spec, joints, lod });
      };
      if (this.busy === 0) go();
      else if (lod === 2) this.queue.unshift(go);
      else this.queue.push(go);
    });
    if (this.cache.size > 60) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, p);
    return p;
  }
}

export const humanFactory = new Factory();

const LOD_DIST = [0, 6, 22];

export class RealHuman {
  group = new THREE.Group();
  private bones: THREE.Bone[];
  skeleton: THREE.Skeleton;
  private lods: (THREE.Group | null)[] = [null, null, null];
  private shown = -1;
  private mats: THREE.Matrix4[] = [];
  ready = false;
  /** the player: always the finest detail */
  hero = false;
  private headC: THREE.Vector3;
  private disposed = false;

  constructor(public spec: HumanSpec, public body: Body, opts: { hero?: boolean; lods?: number[] } = {}) {
    this.hero = !!opts.hero;
    const { joints, matrices } = bindPose(body);
    this.bones = BIND_BONES.map((n) => {
      const b = new THREE.Bone();
      b.name = n;
      b.matrixAutoUpdate = false;
      b.matrixWorldAutoUpdate = false;
      return b;
    });
    this.skeleton = new THREE.Skeleton(this.bones, matrices.map((m) => m.clone().invert()));
    const hc = headCentre(joints);
    this.headC = new THREE.Vector3(hc[0], hc[1], hc[2]);
    const want = opts.lods ?? (this.hero ? [2, 0] : [2, 1]);
    for (const lod of want) {
      humanFactory.build(spec, joints, lod).then((h) => {
        if (this.disposed) return;
        this.lods[lod] = this.assemble(h, lod);
        this.ready = true;
      }).catch((e) => console.error('human build failed', e));
    }
  }

  private assemble(h: BuiltHuman, lod: number): THREE.Group {
    const g = new THREE.Group();
    const s = this.spec;
    const stubble = s.beard === 'stubble' ? 0.7 : s.beard === 'none' ? (s.sex > 0.6 ? 0.25 : 0) : 0.4;
    const lip = new THREE.Color(s.skin).multiply(new THREE.Color(0.95, 0.62, 0.6)).getHex();
    for (const p of h.parts) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(p.position, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(p.normal, 3));
      geo.setAttribute('ao', new THREE.BufferAttribute(p.ao, 1));
      geo.setAttribute('skinIndex', new THREE.BufferAttribute(p.skinIndex, 4));
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(p.skinWeight, 4));
      geo.setIndex(new THREE.BufferAttribute(p.index, 1));
      geo.computeBoundingSphere();
      let mat: THREE.Material;
      if (p.mat === 'skin') mat = skinMaterial(p.color, this.headC, stubble, lip);
      else if (p.mat === 'hair') mat = hairMaterial(p.color, this.headC.clone().add(new THREE.Vector3(0, 0.1, -0.02)));
      else mat = fabricMaterial(p.color, p.fabric ?? 'cotton', p.mat);
      const mesh = new THREE.SkinnedMesh(geo, mat);
      mesh.bindMode = THREE.DetachedBindMode;
      mesh.bind(this.skeleton, new THREE.Matrix4());
      mesh.frustumCulled = false;
      mesh.castShadow = lod < 2;
      mesh.receiveShadow = true;
      mesh.name = p.name;
      g.add(mesh);
    }
    // the eyes
    if (lod < 2) {
      const eg = new THREE.SphereGeometry(h.eyeR, 20, 14);
      const local = eg.attributes.position.array.slice() as Float32Array;
      const em = eyeMaterial(s.eyeColor);
      for (const c of h.eyes) {
        const e = eg.clone();
        e.setAttribute('eyeLocal', new THREE.BufferAttribute(local, 3));
        e.translate(c[0], c[1], c[2]);
        const n = e.attributes.position.count;
        const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
          si[i * 4] = 3;
          sw[i * 4] = 1;
        }
        e.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
        e.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
        const mesh = new THREE.SkinnedMesh(e, em);
        mesh.bindMode = THREE.DetachedBindMode;
        mesh.bind(this.skeleton, new THREE.Matrix4());
        mesh.frustumCulled = false;
        g.add(mesh);
      }
    }
    g.visible = false;
    this.group.add(g);
    return g;
  }

  /** Right after the rig was solved for this person: bones follow its joints. Picks the detail for the distance. */
  pose(camDist: number) {
    jointMatrices(this.mats);
    for (let i = 0; i < this.bones.length; i++) this.bones[i].matrixWorld.copy(this.mats[i]);
    let want = this.hero ? 0 : camDist < LOD_DIST[1] ? 1 : camDist < LOD_DIST[2] ? 1 : 2;
    // the best that's ready, nearest what's wanted
    let pick = -1;
    for (let d = 0; d < 3 && pick < 0; d++) for (const l of [want + d, want - d]) if (l >= 0 && l < 3 && this.lods[l] && pick < 0) pick = l;
    if (pick !== this.shown) {
      if (this.shown >= 0) this.lods[this.shown]!.visible = false;
      if (pick >= 0) this.lods[pick]!.visible = true;
      this.shown = pick;
    }
    void want;
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }

  dispose() {
    this.disposed = true;
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    this.group.removeFromParent();
  }
}
