import * as THREE from 'three';
import { BIOMES, type BiomeId } from '../world/biomes';
import type { WorldGen } from '../world/WorldGen';
import { SEA_Y } from '../world/WorldGen';
import { SPECIES, type AnimalBuild, type AnimalPart, type Species, type SpeciesId } from './animals';

/**
 * Animals in the wider world, by what lives where: deer and rabbits in the
 * farmland, elk and wolves in the north, boar in the woods, bears in the
 * mountains, coyotes in the scrub, crows over the fields and gulls over the
 * shore. They graze and wander in small herds, look up when they hear you,
 * and run; predators keep their distance by day and come closer at night.
 * A shot scatters everything for a long way. What you bring down you can
 * butcher (with a knife, and some Survival) for meat and hide.
 */

type State = 'graze' | 'walk' | 'alert' | 'flee' | 'stalk' | 'attack' | 'dead' | 'fly';

export interface Animal {
  id: number;
  sp: Species;
  male: boolean;
  herd: number;
  root: THREE.Group;
  head: THREE.Object3D | null;
  tail: THREE.Object3D | null;
  legs: { up: THREE.Object3D; low: THREE.Object3D; front: boolean; left: boolean }[];
  wings: THREE.Object3D[];
  pos: THREE.Vector3;
  yaw: number;
  v: number;
  state: State;
  t: number;
  health: number;
  phase: number;
  target: THREE.Vector3;
  aware: number;
  /** seconds since it died */
  dead: number;
  looted: boolean;
  bite: number;
  hurt: number;
  /** birds: circling centre, height, radius */
  orbit?: { x: number; z: number; h: number; r: number; a: number };
  ready: boolean;
}

export interface WildHost {
  gen: WorldGen;
  heightAt(x: number, z: number): number;
  waterAt(x: number, z: number): number | null;
  /** you: how loud and how visible (0 hidden … 1 sprinting in daylight) */
  player(): { pos: THREE.Vector3; speed: number; crouch: boolean; inCar: boolean; stealth: number };
  daylight(): number;
  visibility(): number;
  bite(dmg: number, by: string): void;
}

const MAX = 22;
const SPAWN_MIN = 130, SPAWN_MAX = 230, DROP = 330;
const SKIP: Record<string, true> = { snake: true, lizard: true, gator: true, heron: true, fish: true };

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class Wildlife {
  group = new THREE.Group();
  animals: Animal[] = [];
  private builds = new Map<string, Promise<AnimalBuild>>();
  private geos = new Map<string, Map<string, THREE.BufferGeometry>>();
  private worker: Worker | null = null;
  private pending = new Map<number, (b: AnimalBuild) => void>();
  private seq = 0;
  private spawnT = 0;
  private herdSeq = 0;
  private fur = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, sheen: 0.6, sheenRoughness: 0.75, sheenColor: new THREE.Color(0.55, 0.5, 0.45) });
  private feathers = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide });

  constructor(private host: WildHost) {}

  /* ── building ─────────────────────────────────────────── */

  private build(sp: SpeciesId, male: boolean): Promise<AnimalBuild> {
    const key = `${sp}:${male ? 1 : 0}`;
    let p = this.builds.get(key);
    if (p) return p;
    this.worker ??= this.makeWorker();
    const id = ++this.seq;
    p = new Promise<AnimalBuild>((res) => this.pending.set(id, res));
    this.worker.postMessage({ id, species: sp, male });
    this.builds.set(key, p);
    return p;
  }

  private makeWorker() {
    const w = new Worker(new URL('./animal.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ id: number; animal?: AnimalBuild; error?: string }>) => {
      const res = this.pending.get(e.data.id);
      this.pending.delete(e.data.id);
      if (e.data.error) console.error(e.data.error);
      else if (res && e.data.animal) res(e.data.animal);
    };
    return w;
  }

  private geometry(key: string, p: AnimalPart): THREE.BufferGeometry {
    let m = this.geos.get(key);
    if (!m) this.geos.set(key, (m = new Map()));
    let g = m.get(p.name);
    if (!g) {
      g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p.position, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(p.normal, 3));
      g.setAttribute('color', new THREE.BufferAttribute(p.color, 3));
      g.setIndex(new THREE.BufferAttribute(p.index, 1));
      g.computeBoundingSphere();
      m.set(p.name, g);
    }
    return g;
  }

  private assemble(a: Animal, b: AnimalBuild) {
    const key = `${b.id}:${b.male ? 1 : 0}`;
    const mat = a.sp.gait === 'fly' ? this.feathers : this.fur;
    const mk = (p: AnimalPart) => {
      const m = new THREE.Mesh(this.geometry(key, p), mat);
      m.castShadow = a.sp.len > 0.25;
      return m;
    };
    const by = (n: AnimalPart['name']) => b.parts.find((p) => p.name === n);
    const body = by('body')!;
    a.root.add(mk(body));
    for (const n of ['head', 'tail'] as const) {
      const p = by(n);
      if (!p) continue;
      const g = new THREE.Group();
      g.position.set(...p.pivot);
      g.add(mk(p));
      a.root.add(g);
      if (n === 'head') a.head = g;
      else a.tail = g;
    }
    const wing = by('wing');
    if (wing) {
      for (const side of [1, -1]) {
        const g = new THREE.Group();
        g.position.set(wing.pivot[0] * side, wing.pivot[1], wing.pivot[2]);
        g.scale.x = side;
        g.add(mk(wing));
        a.root.add(g);
        a.wings.push(g);
      }
    }
    for (const front of [true, false]) {
      const up = by(front ? 'legFU' : 'legBU'), low = by(front ? 'legFL' : 'legBL');
      if (!up || !low) continue;
      for (const left of [true, false]) {
        const x = (left ? -1 : 1) * a.sp.legX;
        const gu = new THREE.Group();
        gu.position.set(x, up.pivot[1], up.pivot[2]);
        gu.add(mk(up));
        const gl = new THREE.Group();
        gl.position.set(0, low.pivot[1] - up.pivot[1], low.pivot[2] - up.pivot[2]);
        gl.add(mk(low));
        gu.add(gl);
        a.root.add(gu);
        a.legs.push({ up: gu, low: gl, front, left });
      }
    }
    a.ready = true;
    a.root.visible = true;
  }

  /* ── the herd ─────────────────────────────────────────── */

  private spawnNear(p: THREE.Vector3, biome: BiomeId) {
    const g = this.host.gen;
    if (g.placeAt(p.x, p.z, 120)) return; // not in town
    const alive = this.animals.filter((a) => a.state !== 'dead');
    const dens: Partial<Record<BiomeId, number>> = { forest: 9, boreal: 8, temperate: 5, tundra: 4, alpine: 4, scrub: 5, desert: 2, swamp: 5, coast: 3 };
    const want = dens[biome] ?? 0;
    const night = this.host.daylight() < 0.3;
    const birds = alive.filter((a) => a.sp.gait === 'fly').length;
    if (alive.length - birds >= Math.min(MAX, want) && birds > 0) return;
    const list = BIOMES[biome].wildlife.filter(([s]) => !SKIP[s]);
    if (!list.length) return;
    let sum = 0;
    for (const [, w] of list) sum += w;
    let k = Math.random() * sum;
    let pick = list[0][0];
    for (const [s, w] of list) if ((k -= w) <= 0) {
      pick = s;
      break;
    }
    const sp = SPECIES[pick as SpeciesId];
    if (!sp) return;
    const isBird = sp.gait === 'fly';
    if (isBird ? birds >= 1 : alive.length - birds >= want) return;
    // wolves are mostly out after dark (except in the far north)
    if (sp.id === 'wolf' && !night && biome !== 'tundra' && Math.random() < 0.8) return;
    const a0 = Math.random() * Math.PI * 2, d0 = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
    const cx = p.x + Math.sin(a0) * d0, cz = p.z + Math.cos(a0) * d0;
    const gr = g.ground(cx, cz);
    if (!isBird && (gr.water !== null || gr.h < SEA_Y + 0.5 || gr.road > 0.1 || gr.urban > 0.05)) return;
    const n = isBird ? 5 + Math.floor(Math.random() * 7)
      : sp.id === 'deer' ? 2 + Math.floor(Math.random() * 4) : sp.id === 'elk' ? 2 + Math.floor(Math.random() * 3)
      : sp.id === 'wolf' ? (night ? 3 : 2) + Math.floor(Math.random() * 3) : sp.id === 'boar' || sp.id === 'coyote' ? 1 + Math.floor(Math.random() * 3)
      : sp.id === 'rabbit' ? 1 + Math.floor(Math.random() * 2) : 1;
    const herd = ++this.herdSeq;
    const orbit = isBird ? { x: cx, z: cz, h: 18 + Math.random() * 20, r: 14 + Math.random() * 18, a: Math.random() * 6.28 } : undefined;
    for (let i = 0; i < n; i++) {
      const x = cx + (Math.random() - 0.5) * (isBird ? 6 : 14), z = cz + (Math.random() - 0.5) * (isBird ? 6 : 14);
      const male = Math.random() < (sp.id === 'deer' || sp.id === 'elk' ? 0.35 : 0.5);
      this.add(sp, male, herd, x, z, orbit ? { ...orbit, a: orbit.a + i * 0.5, h: orbit.h + (Math.random() - 0.5) * 4, r: orbit.r + (Math.random() - 0.5) * 6 } : undefined);
    }
  }

  /** One animal, here (the dev viewer; events that want a particular animal). */
  spawn(id: SpeciesId, male: boolean, x: number, z: number): Animal {
    this.add(SPECIES[id], male, ++this.herdSeq, x, z, SPECIES[id].gait === 'fly' ? { x, z, h: 3, r: 2, a: 0 } : undefined);
    return this.animals[this.animals.length - 1];
  }

  private add(sp: Species, male: boolean, herd: number, x: number, z: number, orbit?: Animal['orbit']) {
    const root = new THREE.Group();
    root.visible = false;
    const a: Animal = {
      id: ++this.seq, sp, male, herd, root, head: null, tail: null, legs: [], wings: [],
      pos: new THREE.Vector3(x, this.host.heightAt(x, z), z), yaw: Math.random() * Math.PI * 2, v: 0,
      state: sp.gait === 'fly' ? 'fly' : 'graze', t: 2 + Math.random() * 6, health: sp.health, phase: Math.random(), target: new THREE.Vector3(x, 0, z),
      aware: 0, dead: -1, looted: false, bite: 0, hurt: 0, orbit, ready: false,
    };
    this.animals.push(a);
    this.group.add(root);
    this.build(sp.id, male).then((b) => {
      if (this.animals.includes(a)) this.assemble(a, b);
    });
  }

  /** A gunshot (or a scream): everything within r runs, and the birds go up. */
  alarm(at: THREE.Vector3, r: number) {
    for (const a of this.animals) {
      if (a.state === 'dead') continue;
      const d = a.pos.distanceTo(at);
      if (d > r) continue;
      if (a.sp.gait === 'fly') {
        a.orbit = undefined;
        a.state = 'flee';
        a.t = 12;
        a.target.set(a.pos.x + (a.pos.x - at.x) * 8, 0, a.pos.z + (a.pos.z - at.z) * 8);
      } else if (a.sp.kind === 'prey' || a.health < a.sp.health * 0.6 || this.host.daylight() > 0.3) this.flee(a, at, 10 + Math.random() * 6);
      else this.stalk(a);
    }
  }

  private flee(a: Animal, from: THREE.Vector3, secs: number) {
    a.state = 'flee';
    a.t = secs;
    const dx = a.pos.x - from.x, dz = a.pos.z - from.z, l = Math.hypot(dx, dz) || 1;
    a.target.set(a.pos.x + (dx / l) * 120 + (Math.random() - 0.5) * 30, 0, a.pos.z + (dz / l) * 120 + (Math.random() - 0.5) * 30);
  }

  private stalk(a: Animal) {
    if (a.state === 'attack' || a.state === 'stalk') return;
    a.state = 'stalk';
    a.t = 30;
  }

  /* ── every frame ──────────────────────────────────────── */

  update(dt: number, biome: BiomeId, camera: THREE.Camera) {
    const pl = this.host.player();
    const p = pl.pos;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 1.4;
      if (!pl.inCar || Math.random() < 0.3) this.spawnNear(p, biome);
    }
    const day = this.host.daylight();
    const vis = Math.max(0.35, Math.min(1, this.host.visibility() / 1500));
    const loud = (pl.inCar ? 1.4 : pl.crouch ? 0.45 : pl.speed > 5 ? 1.6 : pl.speed > 0.5 ? 1 : 0.6) * (0.55 + 0.45 * day) * vis * (1 - pl.stealth / 260);
    for (const a of this.animals) {
      const d = Math.hypot(a.pos.x - p.x, a.pos.z - p.z);
      if (d > DROP + (a.state === 'dead' && !a.looted ? 150 : 0)) {
        a.state = 'dead';
        a.dead = 1e6; // gone
        continue;
      }
      if (!a.ready) continue;
      a.root.visible = d < 280 && camera.position.distanceTo(a.pos) < 300;
      if (a.sp.gait === 'fly') this.bird(a, dt, p);
      else this.think(a, dt, p, d, loud, day);
      if (a.root.visible) this.pose(a, dt);
    }
    // forget the far and the long dead
    for (const a of this.animals) if (a.dead > 600 || a.dead > 1e5) this.group.remove(a.root);
    this.animals = this.animals.filter((a) => !(a.dead > 600 || a.dead > 1e5));
  }

  private think(a: Animal, dt: number, p: THREE.Vector3, d: number, loud: number, day: number) {
    const sp = a.sp;
    a.t -= dt;
    a.bite -= dt;
    if (a.state === 'dead') {
      a.dead += dt;
      a.v = 0;
      return;
    }
    const notice = sp.notice * loud;
    // noticing you
    if (d < notice) a.aware = Math.min(3, a.aware + dt * (1.5 + (notice - d) / notice * 3));
    else a.aware = Math.max(0, a.aware - dt * 0.4);
    const predator = sp.kind === 'predator';
    const bold = predator && (sp.id === 'bear' ? d < 14 || a.hurt > 0 : sp.id === 'boar' ? d < 9 || a.hurt > 0 : day < 0.3 || a.hurt > 0);
    if (a.state === 'graze' || a.state === 'walk' || a.state === 'alert') {
      if (a.aware > 1.6 || d < notice * 0.45) {
        if (predator && bold) this.stalk(a);
        else this.flee(a, p, 8 + Math.random() * 6);
        // the herd goes with it (flee() and stalk() changed the state)
        const now = a.state as State;
        for (const o of this.animals) if (o !== a && o.herd === a.herd && o.state !== 'dead' && o.state !== now) {
          if (now === 'flee') this.flee(o, p, a.t + Math.random() * 2);
          else if (now === 'stalk') this.stalk(o);
        }
      } else if (a.aware > 0.6 && a.state !== 'alert') {
        a.state = 'alert';
        a.t = 1 + Math.random() * 2;
      }
    }
    let speed = 0;
    switch (a.state) {
      case 'graze':
        if (a.t <= 0) {
          a.state = 'walk';
          a.t = 4 + Math.random() * 8;
          const r = 8 + Math.random() * 22, ang = Math.random() * Math.PI * 2;
          a.target.set(a.pos.x + Math.sin(ang) * r, 0, a.pos.z + Math.cos(ang) * r);
        }
        break;
      case 'walk':
        speed = sp.walk;
        if (a.t <= 0 || Math.hypot(a.target.x - a.pos.x, a.target.z - a.pos.z) < 1) {
          a.state = 'graze';
          a.t = 3 + Math.random() * 9;
        }
        break;
      case 'alert':
        a.yaw += wrap(Math.atan2(p.x - a.pos.x, p.z - a.pos.z) - a.yaw) * Math.min(1, dt * 1.5) * 0.3;
        if (a.t <= 0 && a.aware < 1.2) {
          a.state = 'graze';
          a.t = 2 + Math.random() * 4;
        }
        break;
      case 'flee':
        speed = sp.run * (a.t > 3 ? 1 : 0.5);
        if (a.t <= 0) {
          a.state = 'walk';
          a.t = 6;
          a.aware = 0.8;
        }
        break;
      case 'stalk': {
        // circle in, then go for you
        a.target.set(p.x, 0, p.z);
        speed = d > 18 ? sp.run * 0.55 : sp.walk * 1.6;
        if (d < 12 || sp.id === 'bear' || sp.id === 'boar') {
          a.state = 'attack';
          a.t = 20;
        }
        if (a.t <= 0 || (day > 0.35 && !a.hurt && sp.id !== 'bear' && sp.id !== 'boar')) this.flee(a, p, 8);
        break;
      }
      case 'attack':
        a.target.set(p.x, 0, p.z);
        speed = d > 1.6 ? sp.run * 0.9 : 0;
        if (d < 1.9 && a.bite <= 0 && !this.host.player().inCar) {
          a.bite = sp.id === 'bear' ? 1.6 : 1.1;
          const dmg = sp.id === 'bear' ? 22 : sp.id === 'boar' ? 12 : sp.id === 'wolf' ? 9 : 5;
          this.host.bite(dmg, `A ${sp.name.toLowerCase()}`);
        }
        if (a.t <= 0 || a.health < sp.health * 0.35) this.flee(a, p, 12);
        break;
    }
    // steer towards the target, round water
    if (speed > 0) {
      const ty = Math.atan2(a.target.x - a.pos.x, a.target.z - a.pos.z);
      a.yaw += wrap(ty - a.yaw) * Math.min(1, dt * (a.state === 'flee' ? 4 : 2.5));
      const nx = a.pos.x + Math.sin(a.yaw) * speed * dt * 1.5, nz = a.pos.z + Math.cos(a.yaw) * speed * dt * 1.5;
      if (this.host.waterAt(nx, nz) !== null || this.host.heightAt(nx, nz) < SEA_Y + 0.3) {
        a.yaw += Math.PI * 0.6;
        a.target.set(a.pos.x + Math.sin(a.yaw) * 40, 0, a.pos.z + Math.cos(a.yaw) * 40);
      }
    }
    a.v += (speed - a.v) * Math.min(1, dt * (speed > a.v ? 3 : 5));
    a.pos.x += Math.sin(a.yaw) * a.v * dt;
    a.pos.z += Math.cos(a.yaw) * a.v * dt;
    a.pos.y = this.host.heightAt(a.pos.x, a.pos.z);
  }

  private bird(a: Animal, dt: number, p: THREE.Vector3) {
    a.t -= dt;
    if (a.state === 'dead') {
      a.dead += dt;
      a.pos.y = Math.max(this.host.heightAt(a.pos.x, a.pos.z), a.pos.y - dt * 9);
      return;
    }
    const o = a.orbit;
    let tx: number, ty: number, tz: number;
    if (o) {
      o.a += dt * (6 / Math.max(8, o.r));
      tx = o.x + Math.sin(o.a) * o.r;
      tz = o.z + Math.cos(o.a) * o.r;
      ty = this.host.heightAt(o.x, o.z) + o.h;
      // the flock drifts
      o.x += Math.sin(o.a * 0.1) * dt * 0.8;
      o.z += Math.cos(o.a * 0.13) * dt * 0.8;
    } else {
      tx = a.target.x;
      tz = a.target.z;
      ty = this.host.heightAt(a.pos.x, a.pos.z) + 45;
      if (a.t <= 0) a.dead = 1e6;
    }
    _v.set(tx - a.pos.x, ty - a.pos.y, tz - a.pos.z);
    const l = _v.length() || 1;
    const sp = o ? Math.min(9, l * 2) : a.sp.run;
    a.pos.addScaledVector(_v, (sp * dt) / l);
    a.yaw = Math.atan2(_v.x, _v.z);
    a.v = sp;
    void p;
  }

  private pose(a: Animal, dt: number) {
    const sp = a.sp;
    a.root.position.copy(a.pos);
    if (a.state === 'dead') {
      // on its side, legs out: the body's centre drops from standing height to lying height
      const k = Math.min(1, (a.dead + 0.05) * 3);
      const sgn = a.id % 2 ? 1 : -1;
      const phi = (Math.PI / 2) * k;
      a.root.rotation.set(0, a.yaw, phi * sgn, 'YXZ');
      if (sp.gait !== 'fly') {
        const sn = Math.sin(phi);
        a.root.position.x += Math.cos(a.yaw) * sp.cy * sn * sgn;
        a.root.position.z += -Math.sin(a.yaw) * sp.cy * sn * sgn;
        a.root.position.y += sp.rx * 0.9 * sn;
      }
      for (const l of a.legs) {
        l.up.rotation.x = (l.front ? -0.5 : 0.5) * k;
        l.low.rotation.x = 0.2 * k;
      }
      if (a.head) a.head.rotation.set(0.4 * k, 0, 0);
      return;
    }
    if (sp.gait === 'fly') {
      a.root.rotation.set(0, a.yaw, 0);
      const flap = a.orbit && Math.sin(a.phase * 0.7) > 0.3 ? 0.08 : Math.sin(a.phase * 12) * 0.75;
      a.phase += dt;
      for (const w of a.wings) w.rotation.z = flap;
      return;
    }
    // gait: how far a stride goes, which leg is where in the cycle
    const stride = sp.legTop * (a.v > sp.walk * 2 ? 2.6 : 1.5) + 0.05;
    a.phase = (a.phase + (a.v * dt) / stride) % 1;
    const run = a.v > sp.walk * 2.5;
    const amp = Math.min(run ? 0.85 : 0.45, 0.12 + a.v * (run ? 0.07 : 0.2));
    const moving = a.v > 0.08;
    if (sp.gait === 'hop') {
      const h = moving ? Math.abs(Math.sin(a.phase * Math.PI)) : 0;
      a.root.position.y += h * sp.legTop * (run ? 1.2 : 0.5);
      a.root.rotation.set(-h * 0.3, a.yaw, 0, 'YXZ');
      for (const l of a.legs) {
        l.up.rotation.x = moving ? (l.front ? -0.5 : 0.6) * h : 0;
        l.low.rotation.x = moving ? 0.4 * h : 0;
      }
    } else {
      a.root.rotation.set(0, a.yaw, 0);
      const off = (l: { front: boolean; left: boolean }) => (run ? (l.front ? 0.5 : 0) + (l.left ? 0 : 0.1) : (l.front ? 0 : 0.25) + (l.left ? 0 : 0.5));
      for (const l of a.legs) {
        const ph = (a.phase + off(l)) * Math.PI * 2;
        l.up.rotation.x = moving ? Math.sin(ph) * amp : 0;
        l.low.rotation.x = moving ? Math.max(0, -Math.cos(ph)) * amp * 1.3 : 0;
      }
      if (moving) a.root.position.y += Math.abs(Math.sin(a.phase * Math.PI * 2)) * 0.012 * Math.min(4, a.v);
    }
    if (a.head) {
      // head down to graze, up and turned when alert, forward when running
      const want = a.state === 'graze' ? sp.neck.up + 0.35 : a.state === 'alert' ? -0.25 : run ? 0.25 : 0.1;
      a.head.rotation.x += (want - a.head.rotation.x) * Math.min(1, dt * 3);
    }
    if (a.tail) {
      const flag = a.state === 'flee' && sp.id === 'deer' ? -1.3 : 0;
      a.tail.rotation.x += (flag - a.tail.rotation.x) * Math.min(1, dt * 5);
      a.tail.rotation.y = Math.sin(a.phase * Math.PI * 4) * (moving ? 0.15 : 0.05);
    }
  }

  /* ── hunting ──────────────────────────────────────────── */

  /** A ray against the animals: the nearest hit within maxT, and what hitting it does. */
  hitTest(o: THREE.Vector3, dir: THREE.Vector3, maxT: number): { t: number; a: Animal; head: boolean } | null {
    let best: { t: number; a: Animal; head: boolean } | null = null;
    for (const a of this.animals) {
      if (!a.ready || a.state === 'dead' || !a.root.visible) continue;
      const sp = a.sp;
      // body and head as spheres
      const fwdX = Math.sin(a.yaw), fwdZ = Math.cos(a.yaw);
      const checks: [number, number, number, number, boolean][] = [
        [a.pos.x, a.pos.y + sp.cy, a.pos.z, Math.max(sp.rx, sp.ry) * 1.25 + sp.len * 0.15, false],
        [a.pos.x - fwdX * sp.len * 0.35, a.pos.y + sp.cy, a.pos.z - fwdZ * sp.len * 0.35, Math.max(sp.rx, sp.ry) * 1.1, false],
        [a.pos.x + fwdX * (sp.len * 0.5 + sp.neck.len * 0.7), a.pos.y + sp.cy + sp.neck.len * 0.6, a.pos.z + fwdZ * (sp.len * 0.5 + sp.neck.len * 0.7), sp.head.r * 1.4, true],
      ];
      for (const [cx, cy, cz, r, head] of checks) {
        _w.set(cx - o.x, cy - o.y, cz - o.z);
        const tc = _w.dot(dir);
        if (tc < 0) continue;
        const d2 = _w.lengthSq() - tc * tc;
        if (d2 > r * r) continue;
        const t = tc - Math.sqrt(r * r - d2);
        if (t < maxT && (!best || t < best.t)) best = { t, a, head };
      }
    }
    return best;
  }

  /** Damage an animal; true if that killed it. */
  damage(a: Animal, dmg: number, from: THREE.Vector3): boolean {
    if (a.state === 'dead') return false;
    a.health -= dmg;
    a.hurt += dmg;
    if (a.health <= 0) {
      a.state = 'dead';
      a.dead = 0;
      a.v = 0;
      if (a.sp.gait === 'fly') a.orbit = undefined;
      return true;
    }
    if (a.sp.kind === 'prey') this.flee(a, from, 14);
    else this.stalk(a);
    return false;
  }

  /** The nearest body you could butcher. */
  carcass(p: THREE.Vector3, reach = 2.4): Animal | null {
    let best: Animal | null = null, bd = reach;
    for (const a of this.animals) {
      if (a.state !== 'dead' || a.looted || a.sp.gait === 'fly' || a.dead > 1e5) continue;
      const d = Math.hypot(a.pos.x - p.x, a.pos.z - p.z);
      if (d < bd) (bd = d), (best = a);
    }
    return best;
  }

  clear() {
    for (const a of this.animals) this.group.remove(a.root);
    this.animals = [];
  }

  get count() {
    return this.animals.filter((a) => a.state !== 'dead').length;
  }
}

function wrap(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
