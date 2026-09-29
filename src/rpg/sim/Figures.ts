import * as THREE from 'three';
import { newMotion, newRig, solve, stepPhase, type Motion, type Outfit, type Rig } from '../../entities/Humanoid';
import { Animator } from '../../anim/Animator';
import '../../anim/clips';
import { RealHuman } from '../people/RealHuman';
import type { HumanSpec } from '../people/anatomy';

/**
 * People who aren't anybody's resident: someone by a broken-down car, a
 * hiker who's lost, a man sitting in the road holding his arm — and the one
 * at the tree line who shouldn't be there. Realistic bodies on the shared
 * rig, posed from the clip library (waving, sitting, standing very still).
 */

export interface Figure {
  id: number;
  human: RealHuman;
  rig: Rig;
  m: Motion;
  anim: Animator;
  pos: THREE.Vector3;
  yaw: number;
  outfit: Outfit;
  /** clips it plays over and over (one picked each time) */
  loop: string[];
  next: number;
  /** turn to face you when you're close */
  watch: boolean;
  scale: number;
  gone: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);

export class Figures {
  group = new THREE.Group();
  list: Figure[] = [];
  private seq = 0;
  private root = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();

  add(spec: HumanSpec, pos: THREE.Vector3, yaw: number, o: { loop?: string[]; sit?: boolean; watch?: boolean; scale?: number } = {}): Figure {
    const human = new RealHuman(spec, { height: 1, girth: 1, shoulders: 1, hips: 1, head: 1 });
    human.group.visible = false;
    this.group.add(human.group);
    const m = newMotion();
    if (o.sit) m.sit = 1;
    const f: Figure = { id: ++this.seq, human, rig: newRig(), m, anim: new Animator(), pos: pos.clone(), yaw, outfit: { bulk: 1 } as Outfit, loop: o.loop ?? [], next: 0.5, watch: o.watch ?? true, scale: o.scale ?? 1, gone: false };
    this.list.push(f);
    return f;
  }

  remove(f: Figure) {
    f.gone = true;
    this.group.remove(f.human.group);
    f.human.dispose();
    this.list = this.list.filter((x) => x !== f);
  }

  update(dt: number, t: number, player: THREE.Vector3, camera: THREE.Camera) {
    for (const f of this.list) {
      if (f.watch) {
        const d = Math.hypot(player.x - f.pos.x, player.z - f.pos.z);
        if (d < 14) {
          const fy = Math.atan2(player.x - f.pos.x, player.z - f.pos.z);
          f.yaw += Math.atan2(Math.sin(fy - f.yaw), Math.cos(fy - f.yaw)) * Math.min(1, dt * 2);
        }
      }
      f.next -= dt;
      if (f.loop.length && f.next <= 0) {
        f.anim.play(f.loop[Math.floor(Math.random() * f.loop.length)], { fadeIn: 0.3 });
        f.next = 3 + Math.random() * 4;
      }
      f.m.speed = 0;
      stepPhase(f.m, dt);
      f.anim.update(dt);
      const h = f.human;
      if (!h.ready) continue;
      h.group.visible = true;
      this.root.compose(f.pos, this.q.setFromAxisAngle(UP, f.yaw), this.s.setScalar(h.body.height * f.scale));
      solve(f.rig, this.root, h.body, f.outfit, f.m, t, f.anim);
      h.pose(camera.position.distanceTo(f.pos));
    }
  }

  clear() {
    for (const f of [...this.list]) this.remove(f);
  }
}
