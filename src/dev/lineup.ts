import * as THREE from 'three';
import { FigureBatch } from '../entities/FigureBatch';
import { newMotion, newRig, solve, stepPhase, visibleParts, type Motion, type Rig } from '../entities/Humanoid';
import { makePerson, type ArchetypeId, type Person } from '../data/people';
import { mulberry32 } from '../world/rng';
import { Animator } from '../anim/Animator';
import { IdleDirector } from '../anim/IdleDirector';
import '../anim/clips';

/**
 * Dev only: a row of people under a street lamp, for judging faces, builds,
 * clothes and idles side by side (tools/playtest/characters.mjs).
 */
export interface Lineup {
  group: THREE.Group;
  people: (Person & { motion: Motion; rig: Rig; anim: Animator; idle: IdleDirector; pos: THREE.Vector3; yaw: number })[];
  update(dt: number, t: number, camDist: number): void;
  play(i: number, clip: string): void;
}

export function makeLineup(center: THREE.Vector3, yaw: number, arches: ArchetypeId[], seed = 7, spacing = 1.0): Lineup {
  const rng = mulberry32(seed);
  const batch = new FigureBatch(arches.length);
  const group = new THREE.Group();
  group.add(batch.group);
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const people = arches.map((a, i) => {
    const p = makePerson(rng, a);
    const motion = newMotion();
    motion.weight = rng.range(-1, 1);
    motion.slouch = 0.08 * p.persona.tired - 0.04 * p.persona.confidence + 0.05 * p.persona.age;
    const pos = center.clone().addScaledVector(right, (i - (arches.length - 1) / 2) * spacing);
    batch.dress(i, p.outfit, 0xbfd4ff, p.body);
    return { ...p, motion, rig: newRig(), anim: new Animator(), idle: new IdleDirector(p.persona, rng.next), pos, yaw };
  });
  const root = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const s = new THREE.Vector3();
  return {
    group,
    people,
    update(dt, t, camDist) {
      people.forEach((p, i) => {
        p.motion.speed = 0;
        p.motion.weight += (Math.sin(t * 0.13 + i) - p.motion.weight) * dt * 0.4;
        stepPhase(p.motion, dt);
        p.idle.update(dt, p.anim, { still: true, raining: false, cold: false, waiting: false, hands: '', hoodable: false, police: p.arche === 'police', wall: false });
        p.anim.update(dt);
        root.compose(p.pos, q.setFromAxisAngle(up, p.yaw), s.setScalar(p.body.height));
        solve(p.rig, root, p.body, p.outfit, p.motion, t, p.anim);
        batch.write(i, p.rig, visibleParts(p.outfit, camDist), false);
      });
      batch.flush();
    },
    play(i, clip) {
      people[i]?.anim.play(clip, { group: 'test', fadeIn: 0.2 });
    },
  };
}
