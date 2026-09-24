import * as THREE from 'three';
import { FigureBatch } from './FigureBatch';
import { newMotion, newRig, solve, stepPhase, visibleParts, type Body, type Motion, type Outfit, type Rig } from './Humanoid';
import { carParts } from '../world/builders/props';
import { TAXI_COLOR } from './Traffic';
import { bodyFromLook, outfitFromLook } from './Look';
import type { WorldContext } from '../world/WorldContext';
import type { Multiplayer, Peer, PeerState } from '../net/Multiplayer';
import { h } from '../ui/dom';

const MAX = 12;

interface Slot {
  peer: Peer | null;
  motion: Motion;
  rig: Rig;
  outfit: Outfit;
  car: THREE.Group | null;
  carLook: string;
  label: HTMLElement;
  state: PeerState;
  visible: boolean;
  body: Body;
  /** which look is on (so we only re-dress on change) */
  dressed: string;
}

const BODY: Body = { height: 1.0, girth: 1.0, shoulders: 1.02, hips: 1.0, head: 1 };

/**
 * The other people in your night: the same figures as the crowd, in coats
 * you can tell apart, with a name that floats above them when they're near.
 * When they drive, you see their car.
 */
export class Remotes {
  group = new THREE.Group();
  private batch = new FigureBatch(MAX);
  private slots: Slot[] = [];
  private labels: HTMLElement;
  private root = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private one = new THREE.Vector3(1, 1, 1);
  private v = new THREE.Vector3();
  private sign = new THREE.MeshStandardMaterial({ color: 0x1a1408, emissive: new THREE.Color(1.0, 0.72, 0.3), emissiveIntensity: 2.2 });

  constructor(private ctx: WorldContext, ui: HTMLElement) {
    this.group.add(this.batch.group);
    this.labels = h('div', { class: 'peers', 'aria-hidden': 'true' });
    ui.prepend(this.labels);
    for (let i = 0; i < MAX; i++) {
      const label = h('span', { class: 'peers__name' });
      this.labels.append(label);
      this.slots.push({
        peer: null, motion: newMotion(), rig: newRig(), outfit: outfitFor(0x333333), car: null, carLook: '', label,
        state: { x: 0, y: 0, z: 0, yaw: 0, speed: 0, mode: 'walk' }, visible: false, body: { ...BODY }, dressed: '',
      });
      this.batch.hide(i);
    }
  }

  /** Where another player is right now (for their voice). */
  positionOf(id: string): THREE.Vector3 | null {
    const s = this.slots.find((x) => x.peer?.id === id && x.visible);
    return s ? this.v.set(s.state.x, s.state.y, s.state.z).clone() : null;
  }

  /** Light up a name while its player is speaking. */
  talking(id: string, on: boolean) {
    const s = this.slots.find((x) => x.peer?.id === id);
    s?.label.classList.toggle('is-talking', on);
  }

  /** The first other player (on foot) a ray passes through, within `max`. */
  hitTest(o: THREE.Vector3, dir: THREE.Vector3, max: number): { id: string; t: number; pos: THREE.Vector3 } | null {
    let best: { id: string; t: number; pos: THREE.Vector3 } | null = null;
    const hx = Math.hypot(dir.x, dir.z) || 1e-6;
    for (const s of this.slots) {
      const st = s.state;
      if (!s.visible || !s.peer || st.car) continue;
      const r = 0.34;
      const px = st.x - o.x, pz = st.z - o.z;
      const tc = (px * dir.x + pz * dir.z) / (hx * hx);
      if (tc < 0) continue;
      const cx = o.x + dir.x * tc - st.x, cz = o.z + dir.z * tc - st.z;
      const d2 = cx * cx + cz * cz;
      if (d2 > r * r) continue;
      const t = tc - Math.sqrt(r * r - d2) / hx;
      const y = o.y + dir.y * t;
      if (t > max || y < st.y || y > st.y + 1.85 || (best && t > best.t)) continue;
      best = { id: s.peer.id, t, pos: new THREE.Vector3(st.x, st.y, st.z) };
    }
    return best;
  }

  /** Where the others are, as solid circles (people and cars). */
  obstacles(out: { x: number; z: number; r: number }[]) {
    for (const s of this.slots) {
      if (!s.visible || s.state.mode === 'ride') continue;
      const st = s.state;
      if (st.car) {
        const fx = Math.sin(st.yaw), fz = Math.cos(st.yaw);
        for (const k of [-1.45, 0, 1.45]) out.push({ x: st.x + fx * k, z: st.z + fz * k, r: 0.95 });
      } else out.push({ x: st.x, z: st.z, r: 0.34 });
    }
  }

  /** Other players on foot (the host's traffic brakes and pulls over for them). */
  walkers(): { pos: THREE.Vector3; speed: number }[] {
    const out: { pos: THREE.Vector3; speed: number }[] = [];
    for (const s of this.slots) if (s.visible && !s.state.car) out.push({ pos: new THREE.Vector3(s.state.x, s.state.y, s.state.z), speed: s.state.speed });
    return out;
  }

  /** Other players' cars: where they are and how they're moving. */
  drivers(): { x: number; z: number; vx: number; vz: number }[] {
    const out: { x: number; z: number; vx: number; vz: number }[] = [];
    for (const s of this.slots) {
      const st = s.state;
      if (!s.visible || st.mode !== 'drive' || !st.car) continue;
      out.push({ x: st.x, z: st.z, vx: Math.sin(st.yaw) * st.car.v, vz: Math.cos(st.yaw) * st.car.v });
    }
    return out;
  }

  /** Indices of the shared parked cars other players are driving right now. */
  drivenCars(): Set<number> {
    const out = new Set<number>();
    for (const s of this.slots) if (s.visible && s.state.mode === 'drive' && s.state.car && s.state.car.idx >= 0) out.add(s.state.car.idx);
    return out;
  }

  update(dt: number, t: number, mp: Multiplayer, camera: THREE.Camera, showLabels: boolean) {
    // give every peer a slot, free the slots of those who left
    const peers = [...mp.peers.values()].slice(0, MAX);
    for (const s of this.slots) if (s.peer && !mp.peers.has(s.peer.id)) this.release(s);
    for (const p of peers) {
      if (this.slots.some((s) => s.peer === p)) continue;
      const i = this.slots.findIndex((s) => !s.peer);
      if (i < 0) break;
      const s = this.slots[i];
      s.peer = p;
      s.dressed = '';
    }

    const w = innerWidth, hgt = innerHeight;
    this.slots.forEach((s, i) => {
      const p = s.peer;
      s.visible = !!p && mp.sample(p, s.state);
      if (!s.visible || !p) {
        this.batch.hide(i);
        if (s.car) s.car.visible = false;
        s.label.classList.remove('is-on');
        return;
      }
      const key = p.look ? JSON.stringify(p.look) : `coat:${p.coat}`;
      if (s.dressed !== key) {
        s.dressed = key;
        s.outfit = p.look ? outfitFromLook(p.look) : outfitFor(p.coat);
        s.body = p.look ? bodyFromLook(p.look) : { ...BODY };
        this.batch.dress(i, s.outfit);
      }
      const st = s.state;
      const inCar = !!st.car;
      // a car when they drive; riding, they're inside the shared taxi (drawn by Traffic)
      if (st.mode === 'ride') {
        this.batch.hide(i);
        if (s.car) s.car.visible = false;
      } else if (inCar) {
        this.batch.hide(i);
        this.placeCar(s, st);
      } else {
        if (s.car) s.car.visible = false;
        const m = s.motion;
        m.speed += (st.speed - m.speed) * Math.min(1, dt * 8);
        m.sit += ((st.mode === 'sit' ? 1 : 0) - m.sit) * Math.min(1, dt * 5);
        m.armL = m.armR = st.mode === 'sit' ? 'rest' : 'free';
        m.breath += dt * 1.2;
        stepPhase(m, dt);
        this.root.compose(this.v.set(st.x, st.y, st.z), this.q.setFromAxisAngle(this.up, st.yaw), this.one.setScalar(s.body.height));
        solve(s.rig, this.root, s.body, s.outfit, m, t);
        const d = camera.position.distanceTo(this.v);
        this.batch.write(i, s.rig, visibleParts(s.outfit, d), false);
      }
      // name, floating above them (or their roof)
      this.v.set(st.x, st.y + (inCar ? 2.1 : 2.15), st.z);
      const d = camera.position.distanceTo(this.v);
      this.v.project(camera);
      const on = showLabels && this.v.z < 1 && d < 70 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1;
      s.label.classList.toggle('is-on', on);
      if (on) {
        if (s.label.textContent !== p.name) s.label.textContent = p.name;
        s.label.style.transform = `translate(${((this.v.x + 1) / 2) * w}px, ${((1 - this.v.y) / 2) * hgt}px) translate(-50%, -100%)`;
        s.label.style.opacity = String(Math.max(0.25, 1 - d / 70));
      }
    });
    this.batch.flush();
  }

  private placeCar(s: Slot, st: PeerState) {
    const c = st.car!;
    const taxi = st.mode === 'ride';
    const look = taxi ? 'taxi' : `${c.color}|${c.van ? 1 : 0}`;
    if (!s.car || s.carLook !== look) {
      if (s.car) this.group.remove(s.car);
      s.car = this.buildCar(taxi ? TAXI_COLOR : c.color, !taxi && c.van, taxi);
      s.carLook = look;
      this.group.add(s.car);
    }
    const g = s.car;
    g.visible = true;
    g.position.set(st.x, st.y, st.z);
    g.rotation.y = st.yaw;
    const tail = g.userData.tail as THREE.MeshStandardMaterial;
    tail.emissiveIntensity = c.brake ? 11 : 4;
  }

  private buildCar(color: number, van: boolean, taxi: boolean) {
    const g = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.3 });
    const tail = (this.ctx.mats.lampRed as THREE.MeshStandardMaterial).clone();
    for (const part of carParts(color, van)) {
      const mesh = new THREE.Mesh(part.geo, part.kind === 'paint' ? paint : part.kind === 'tail' ? tail : part.mat(this.ctx));
      mesh.applyMatrix4(part.m);
      mesh.castShadow = part.kind === 'paint';
      g.add(mesh);
    }
    if (taxi) {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.3), this.sign);
      roof.position.set(0, 1.32, -0.2);
      g.add(roof);
    }
    g.userData.tail = tail;
    return g;
  }

  private release(s: Slot) {
    const i = this.slots.indexOf(s);
    s.peer = null;
    s.visible = false;
    this.batch.hide(i);
    if (s.car) {
      this.group.remove(s.car);
      s.car = null;
      s.carLook = '';
    }
    s.label.classList.remove('is-on');
  }
}

/** The player's own silhouette (long coat, scarf), in their colour. */
function outfitFor(coat: number): Outfit {
  return {
    garment: 'coat', top: coat, legs: 0x16171a, shoes: 0x0e0e0f, skin: 0xb8876a, hair: 'swept', hairColor: 0x1a1512,
    accent: 0x6a5a48, hem: true, skirt: false, hoodDown: false, scarf: true, bag: false, umbrella: false, bulk: 1.1,
  };
}
