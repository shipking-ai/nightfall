import * as THREE from 'three';
import type { Collision } from '../../world/Collision';
import type { AudioEngine } from '../../audio/AudioEngine';
import type { Tracers } from '../../fx/Tracers';
import type { Blasts } from './Blasts';
import { chestY, foe, headY, type Unit } from './Soldier';

/**
 * Support streaks: earned by kills in one life, never bought. Each is a
 * help, not a win button: recon shows the enemy for a while (counter-recon
 * takes it away), a supply drop restocks, a sentry watches a lane, a
 * precision strike walks shells down a line you mark, a drone hunts the
 * nearest enemy and goes off. Bots earn them too.
 */

export type StreakId = 'recon' | 'supply' | 'counter' | 'sentry' | 'strike' | 'drone';

export const STREAKS: { id: StreakId; name: string; kills: number; line: string }[] = [
  { id: 'recon', name: 'Recon sweep', kills: 3, line: 'Every enemy shows for 25 seconds.' },
  { id: 'supply', name: 'Supply drop', kills: 4, line: 'Ammunition, armour and gear, dropped at your feet.' },
  { id: 'counter', name: 'Counter-recon', kills: 5, line: 'Their sweeps and sensors go dark for 25 seconds.' },
  { id: 'sentry', name: 'Sentry', kills: 6, line: 'A turret that watches the lane in front of you for 45 seconds.' },
  { id: 'strike', name: 'Precision strike', kills: 7, line: 'Five shells walked down the line you are looking at.' },
  { id: 'drone', name: 'Attack drone', kills: 9, line: 'Finds the nearest enemy and goes off on them.' },
];
export const STREAK = Object.fromEntries(STREAKS.map((s) => [s.id, s])) as Record<StreakId, (typeof STREAKS)[number]>;

export interface StreakHost {
  units: Unit[];
  col: Collision;
  blasts: Blasts;
  audio: AudioEngine;
  tracers: Tracers;
  sees(a: THREE.Vector3, b: THREE.Vector3): boolean;
  blast(at: THREE.Vector3, r: number, dmg: number, owner: Unit, name: string): void;
  hurt(u: Unit, dmg: number, owner: Unit, name: string, head: boolean): boolean;
  supply(at: THREE.Vector3): void;
  announce(text: string, ours: boolean): void;
}

interface Sentry {
  pos: THREE.Vector3;
  yaw: number;
  owner: Unit;
  t: number;
  cool: number;
  mesh: THREE.Group;
}
interface Shell {
  at: THREE.Vector3;
  t: number;
  owner: Unit;
}
interface Drone {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  owner: Unit;
  t: number;
  mesh: THREE.Group;
}

export class Streaks {
  group = new THREE.Group();
  /** seconds of recon each team has left, and of jamming against each team */
  recon: [number, number] = [0, 0];
  jammed: [number, number] = [0, 0];
  private sentries: Sentry[] = [];
  private shells: Shell[] = [];
  private drones: Drone[] = [];
  private crates: { pos: THREE.Vector3; y: number; mesh: THREE.Mesh }[] = [];
  private mat = new THREE.MeshStandardMaterial({ color: 0x3a4030, roughness: 0.6, metalness: 0.4 });

  constructor(private host: StreakHost) {}

  clear() {
    this.recon = [0, 0];
    this.jammed = [0, 0];
    for (const s of this.sentries) this.group.remove(s.mesh);
    for (const d of this.drones) this.group.remove(d.mesh);
    for (const c of this.crates) this.group.remove(c.mesh);
    this.sentries = [];
    this.drones = [];
    this.crates = [];
    this.shells = [];
  }

  /** Can `team` see this enemy because of a sweep? */
  sweeps(team: 0 | 1) {
    return this.recon[team] > 0 && this.jammed[team] <= 0;
  }

  /** Call one in. `at`: where you're looking (the strike's line, the sentry's spot). */
  use(id: StreakId, owner: Unit, at: THREE.Vector3, facing: number) {
    const h = this.host, team = owner.team, ours = owner.isPlayer || false;
    const them = (1 - team) as 0 | 1;
    switch (id) {
      case 'recon':
        this.recon[team] = 25;
        break;
      case 'counter':
        this.jammed[them] = 25;
        break;
      case 'supply': {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.6), this.mat);
        box.castShadow = true;
        const p = owner.pos.clone().add(new THREE.Vector3(Math.sin(facing) * 1.6, 0, Math.cos(facing) * 1.6));
        this.crates.push({ pos: p, y: 30, mesh: box });
        this.group.add(box);
        break;
      }
      case 'sentry': {
        const g = new THREE.Group();
        const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.35, 0.8, 3), this.mat);
        legs.position.y = 0.4;
        const head = new THREE.Group();
        head.position.y = 0.95;
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.26, 0.5), this.mat);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 8).rotateX(Math.PI / 2).translate(0, 0.02, 0.5), this.mat);
        head.add(box, barrel);
        g.add(legs, head);
        g.traverse((o) => (o.castShadow = true));
        const p = owner.pos.clone().add(new THREE.Vector3(Math.sin(facing) * 1.2, 0, Math.cos(facing) * 1.2));
        p.y = h.col.groundAt(p.x, p.z, owner.pos.y + 0.5, 1, 0.3);
        g.position.copy(p);
        this.sentries.push({ pos: p, yaw: facing, owner, t: 45, cool: 1, mesh: g });
        this.group.add(g);
        break;
      }
      case 'strike': {
        // five shells walked across the line, a beat apart, after a warning
        const dx = Math.cos(facing), dz = -Math.sin(facing);
        for (let k = 0; k < 5; k++) {
          const o = (k - 2) * 3.2;
          this.shells.push({ at: new THREE.Vector3(at.x + dx * o, at.y, at.z + dz * o), t: 3 + k * 0.35, owner });
        }
        break;
      }
      case 'drone': {
        const g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.3), this.mat);
        g.add(body);
        for (let k = 0; k < 4; k++) {
          const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.01, 12), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.5 }));
          arm.position.set(k < 2 ? -0.22 : 0.22, 0.05, k % 2 ? -0.22 : 0.22);
          g.add(arm);
        }
        const p = owner.pos.clone().setY(owner.pos.y + 2.2);
        g.position.copy(p);
        this.drones.push({ pos: p, vel: new THREE.Vector3(), owner, t: 25, mesh: g });
        this.group.add(g);
        break;
      }
    }
    h.announce(`${ours ? '' : owner.team === 0 ? 'Blue ' : 'Red '}${STREAK[id].name}${ours ? ' ready' : ' called in'}`, owner.team === 0);
    h.audio.uiTick?.();
  }

  update(dt: number) {
    const h = this.host;
    for (const t of [0, 1] as const) {
      this.recon[t] = Math.max(0, this.recon[t] - dt);
      this.jammed[t] = Math.max(0, this.jammed[t] - dt);
    }
    // crates fall
    for (let i = this.crates.length - 1; i >= 0; i--) {
      const c = this.crates[i];
      c.y = Math.max(0, c.y - dt * 14);
      c.mesh.position.set(c.pos.x, c.pos.y + 0.3 + c.y, c.pos.z);
      c.mesh.rotation.y += dt * (c.y > 0 ? 1.5 : 0);
      if (c.y <= 0) {
        h.blasts.puff(c.pos, 0.5, 1.4);
        h.audio.crash(0.4);
        h.supply(c.pos);
        this.group.remove(c.mesh);
        this.crates.splice(i, 1);
      }
    }
    // sentries: turn onto the nearest enemy in sight, fire
    for (let i = this.sentries.length - 1; i >= 0; i--) {
      const s = this.sentries[i];
      s.t -= dt;
      s.cool -= dt;
      if (s.t <= 0) {
        h.blasts.puff(s.pos, 0.4, 1);
        this.group.remove(s.mesh);
        this.sentries.splice(i, 1);
        continue;
      }
      const eye = _a.set(s.pos.x, s.pos.y + 1, s.pos.z);
      let best: Unit | null = null, bd = 36;
      for (const u of h.units) {
        if (!u.alive || !foe(s.owner, u)) continue;
        const d = u.pos.distanceTo(s.pos);
        if (d >= bd || !h.sees(eye, _b.set(u.pos.x, chestY(u), u.pos.z))) continue;
        best = u;
        bd = d;
      }
      const head = s.mesh.children[1];
      if (best) {
        const want = Math.atan2(best.pos.x - s.pos.x, best.pos.z - s.pos.z);
        s.yaw += wrap(want - s.yaw) * Math.min(1, dt * 5);
        if (s.cool <= 0 && Math.abs(wrap(want - s.yaw)) < 0.15) {
          s.cool = 0.13;
          const hit = Math.random() < 0.38;
          const to = _b.set(best.pos.x + (hit ? 0 : (Math.random() - 0.5) * 1.5), hit ? chestY(best) : chestY(best) + (Math.random() - 0.3), best.pos.z + (hit ? 0 : (Math.random() - 0.5) * 1.5));
          h.tracers.shot(_c.set(s.pos.x + Math.sin(s.yaw) * 0.8, s.pos.y + 1, s.pos.z + Math.cos(s.yaw) * 0.8), to, true);
          h.audio.gunshot(s.pos, { caliber: 0.45, report: 'snap' });
          if (hit) h.hurt(best, 16, s.owner, 'Sentry', Math.random() < 0.05);
        }
      } else s.yaw += Math.sin(s.t * 0.7) * dt * 0.6;
      head.rotation.y = s.yaw;
    }
    // shells: a whistle, then the ground goes up
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const sh = this.shells[i];
      sh.t -= dt;
      if (sh.t <= 0) {
        h.blast(sh.at, 6, 220, sh.owner, 'Precision strike');
        this.shells.splice(i, 1);
      }
    }
    // drones: up, across to the nearest enemy, and down onto them
    for (let i = this.drones.length - 1; i >= 0; i--) {
      const d = this.drones[i];
      d.t -= dt;
      let tgt: Unit | null = null, bd = Infinity;
      for (const u of h.units) {
        if (!u.alive || !foe(d.owner, u)) continue;
        const dist = u.pos.distanceTo(d.pos);
        if (dist < bd) (bd = dist), (tgt = u);
      }
      const goal = tgt ? _a.set(tgt.pos.x, bd < 6 ? headY(tgt) : tgt.pos.y + 4, tgt.pos.z) : _a.copy(d.pos);
      const want = _b.subVectors(goal, d.pos);
      const len = want.length();
      want.multiplyScalar(len > 0.01 ? (bd < 6 ? 14 : 10) / len : 0);
      d.vel.lerp(want, Math.min(1, dt * 2.5));
      const step = _c.copy(d.vel).multiplyScalar(dt);
      const wall = h.col.raycast(d.pos, _b.copy(step).normalize(), step.length() + 0.2);
      if (wall < step.length() + 0.2) d.vel.y += 6 * dt * 10;
      else d.pos.add(step);
      d.mesh.position.copy(d.pos);
      d.mesh.rotation.y += dt * 2;
      if ((tgt && d.pos.distanceTo(_a.set(tgt.pos.x, chestY(tgt), tgt.pos.z)) < 1.2) || d.t <= 0) {
        h.blast(d.pos.clone(), 4.5, 170, d.owner, 'Attack drone');
        this.group.remove(d.mesh);
        this.drones.splice(i, 1);
      }
    }
  }
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

function wrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
