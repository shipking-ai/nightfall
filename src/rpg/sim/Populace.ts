import * as THREE from 'three';
import { newMotion, newRig, solve, stepPhase, type Outfit, type Rig, type Motion } from '../../entities/Humanoid';
import { Animator } from '../../anim/Animator';
import '../../anim/clips';
import type { Collision } from '../../world/Collision';
import { mulberry32 } from '../../world/rng';
import { hash3 } from '../world/noise';
import type { Settlement, WorldGen } from '../world/WorldGen';
import type { Towns, TownPlan } from '../world/Towns';
import { RealHuman } from '../people/RealHuman';
import { randomSpec, type Who } from '../people/kit';
import type { HumanSpec } from '../people/anatomy';

/**
 * The people of the wider world. Every town keeps a list of residents, made
 * from its seed: a name, a job, a home and a workplace, the hours they keep,
 * what they're like. Where each of them is at any moment is worked out from
 * those hours, so the town goes on living whether you're watching or not —
 * asleep at 3, walking to work at 8, out for lunch, home at dusk, a few night
 * owls about. Only the ones near you are given a body (the realistic kind);
 * the rest are a schedule and a line in a list.
 *
 * Simulation detail by distance: embodied and animated within ~70 m; a
 * position from the schedule within the town; beyond that, just a count.
 */

export type Job = NonNullable<Who['job']> | 'shopkeeper' | 'nurse' | 'teacher' | 'driver' | 'retired' | 'night';

export interface Resident {
  id: string;
  town: Settlement;
  i: number;
  name: string;
  job: Job;
  /** walk-node indices in the town plan */
  home: number;
  work: number;
  /** minutes past midnight */
  wake: number;
  start: number;
  end: number;
  bed: number;
  /** evenings: out (0) … homebody (1) */
  homebody: number;
  friendly: number;
  brave: number;
  spec: HumanSpec;
  /** how many times you've spoken */
  met: number;
}

const FIRST = {
  f: ['Ada', 'Bea', 'Cora', 'Dana', 'Edie', 'Faye', 'Greta', 'Hana', 'Iris', 'June', 'Kit', 'Lena', 'Mara', 'Nell', 'Opal', 'Pia', 'Rosa', 'Sade', 'Tess', 'Uma', 'Vera', 'Wren', 'Yara', 'Zoe', 'Amina', 'Lucia', 'Mei', 'Priya', 'Ines', 'Noor'],
  m: ['Abe', 'Bram', 'Cal', 'Dev', 'Eli', 'Finn', 'Gus', 'Hal', 'Ivo', 'Jonas', 'Kofi', 'Leo', 'Milo', 'Nico', 'Otto', 'Pavel', 'Quinn', 'Rafe', 'Sol', 'Theo', 'Ugo', 'Vik', 'Wes', 'Yusuf', 'Zane', 'Tomas', 'Arjun', 'Kenji', 'Mateo', 'Idris'],
};
const LAST = ['Abbot', 'Brandt', 'Castell', 'Doyle', 'Ekwueme', 'Farrow', 'Grieve', 'Haskell', 'Ibarra', 'Janek', 'Kovac', 'Lund', 'Marsh', 'Novak', 'Okafor', 'Pryce', 'Quint', 'Rourke', 'Sato', 'Teague', 'Umber', 'Vance', 'Weller', 'Yilmaz', 'Zeller', 'Moreau', 'Achterberg', 'Delacroix', 'Nakamura', 'Oduya'];
const JOBS: Job[] = ['worker', 'office', 'shopkeeper', 'nurse', 'teacher', 'driver', 'mechanic', 'bartender', 'student', 'retired', 'night', 'police', 'rich', 'drifter'];

const MAX_EMBODIED = 12;
const NEAR = 110;
const FAR = 130;

export interface Walker {
  r: Resident;
  human: RealHuman;
  rig: Rig;
  m: Motion;
  anim: Animator;
  pos: THREE.Vector3;
  yaw: number;
  outfit: Outfit;
  /** stopped to talk to you (seconds left) */
  talk: number;
  idle: number;
}

export class Populace {
  group = new THREE.Group();
  private lists = new Map<string, Resident[]>();
  private walkers = new Map<string, Walker>();
  private pool = new Map<string, RealHuman>();
  private scanT = 0;
  private root = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  /** people about now in the towns near you (the statistical layer, for the HUD and the debug) */
  about = 0;

  constructor(private gen: WorldGen, private towns: Towns, private col: Collision) {}

  /** The residents of a town (made once, the same every time). */
  residents(town: Settlement): Resident[] {
    let l = this.lists.get(town.id);
    if (l) return l;
    const plan = this.towns.plan(town);
    const n = Math.min(town.residents, plan.walk.length * 2);
    l = [];
    for (let i = 0; i < n; i++) {
      const r = mulberry32(hash3(Math.floor(town.seed), i, 0x5e1f));
      const female = r.next() < 0.5;
      const job = r.pick(JOBS);
      const age = job === 'retired' ? 0.75 + r.next() * 0.25 : job === 'student' ? r.next() * 0.1 : r.next() * 0.7;
      const shift = job === 'night' || job === 'bartender' ? 14 * 60 : job === 'nurse' && r.chance(0.4) ? 19 * 60 : 0;
      const start = ((8 * 60 + r.range(-60, 90)) + shift) % 1440;
      l.push({
        id: `${town.id}:${i}`, town, i,
        name: `${r.pick(female ? FIRST.f : FIRST.m)} ${r.pick(LAST)}`,
        job,
        home: r.int(0, plan.walk.length - 1),
        // workplaces cluster in the middle of town (the best of three tries)
        work: [r.int(0, plan.walk.length - 1), r.int(0, plan.walk.length - 1), r.int(0, plan.walk.length - 1)].sort((a, b) => dc(plan, a) - dc(plan, b))[0],
        wake: (start - 70 + 1440) % 1440,
        start,
        end: (start + (job === 'retired' || job === 'drifter' ? 0 : r.range(420, 560))) % 1440,
        bed: (start + r.range(900, 1020)) % 1440,
        homebody: r.next(),
        friendly: r.next(),
        brave: r.next(),
        spec: randomSpec(hash3(Math.floor(town.seed), i, 77), { sex: female ? r.range(0, 0.15) : r.range(0.85, 1), age, biome: town.biome, job: jobLook(job) }),
        met: 0,
      });
    }
    this.lists.set(town.id, l);
    return l;
  }

  /**
   * Where is this resident, and are they outside? From their hours alone:
   * walking between home and work, out at lunch, wandering in the evening.
   */
  where(r: Resident, plan: TownPlan, minutes: number, out: THREE.Vector3): boolean {
    const out2 = out;
    const W = plan.walk;
    if (!W.length) return false;
    const inWin = (a: number, b: number) => (a <= b ? minutes >= a && minutes < b : minutes >= a || minutes < b);
    const home = W[r.home], work = W[r.work];
    const commute = 25;
    const retired = r.job === 'retired' || r.job === 'drifter';
    if (!inWin(r.wake, r.bed)) return false; // asleep
    // on the way to work and back
    if (!retired && inWin(r.start - commute, r.start)) return this.along(home, work, (minutes - (r.start - commute) + 1440) % 1440 / commute, out);
    if (!retired && inWin(r.end, r.end + commute)) return this.along(work, home, (minutes - r.end + 1440) % 1440 / commute, out);
    // lunch: out for a walk round the block
    if (!retired && inWin(r.start + 240, r.start + 275)) return this.loop(plan, r, minutes, out, work);
    // at work, mostly inside; some jobs are out and about (errands, deliveries, the beat)
    if (!retired && inWin(r.start, r.end)) {
      const out = r.job === 'police' || r.job === 'driver' || r.job === 'drifter' ? 0.6 : 0.12;
      if ((hash3(r.i, Math.floor(minutes / 30), 23) % 1000) / 1000 < out) return this.loop(plan, r, minutes, out2, work);
      return false;
    }
    // the rest of the day: some go out, some stay in; the drifters and the retired wander
    const k = (hash3(r.i, Math.floor(minutes / 45), 91) % 1000) / 1000;
    if (k < (retired ? 0.7 : 0.5) * (1 - r.homebody * 0.6)) return this.loop(plan, r, minutes, out, home);
    return false;
  }

  private along(a: { x: number; z: number; y: number }, b: { x: number; z: number; y: number }, t: number, out: THREE.Vector3) {
    // along the pavements: first one way, then the other (blocks are square)
    t = Math.min(1, Math.max(0, t));
    const dx = Math.abs(b.x - a.x), dz = Math.abs(b.z - a.z);
    const s = dx / Math.max(1e-3, dx + dz);
    if (t < s) out.set(a.x + (b.x - a.x) * (t / s), a.y, a.z);
    else out.set(b.x, a.y, a.z + (b.z - a.z) * ((t - s) / Math.max(1e-3, 1 - s)));
    return true;
  }

  private loop(plan: TownPlan, r: Resident, minutes: number, out: THREE.Vector3, from: { x: number; z: number; y: number }) {
    // a slow circuit between nearby corners
    const W = plan.walk;
    const slot = Math.floor(minutes / 6);
    const t = (minutes % 6) / 6;
    const pick = (k: number) => {
      const a = W[hash3(r.i, k, 17) % W.length], b = W[hash3(r.i, k, 19) % W.length];
      return Math.hypot(a.x - plan.s.x, a.z - plan.s.z) < Math.hypot(b.x - plan.s.x, b.z - plan.s.z) ? a : b;
    };
    const a = slot % 2 ? from : pick(slot);
    const b = slot % 2 ? pick(slot + 1) : from;
    const near = (p: { x: number; z: number; y: number }) => (Math.hypot(p.x - from.x, p.z - from.z) < 180 ? p : from);
    return this.along(near(a), near(b), t, out);
  }

  /** Every frame: bodies for the residents near you, walking where their day takes them. */
  update(dt: number, t: number, minutes: number, player: THREE.Vector3, camera: THREE.Camera, rain: number) {
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.5;
      this.scan(player, minutes);
    }
    const tmp = new THREE.Vector3();
    for (const w of this.walkers.values()) {
      const plan = this.towns.plan(w.r.town);
      const outside = this.where(w.r, plan, minutes, tmp);
      if (!outside) {
        // they went indoors: walk to the nearest door, then gone
        w.m.speed = 0;
      }
      const target = outside ? tmp : w.pos;
      const dx = target.x - w.pos.x, dz = target.z - w.pos.z;
      const d = Math.hypot(dx, dz);
      let speed = 0;
      if (w.talk > 0) {
        w.talk -= dt;
        const fy = Math.atan2(player.x - w.pos.x, player.z - w.pos.z);
        w.yaw += wrap(fy - w.yaw) * Math.min(1, dt * 5);
      } else if (d > 25) {
        w.pos.set(target.x, w.pos.y, target.z); // skipped ahead (sleeping, waiting): catch up
      } else if (d > 0.4) {
        speed = Math.min(1.35 + rain * 0.5, d * 2);
        w.pos.x += (dx / d) * speed * dt;
        w.pos.z += (dz / d) * speed * dt;
        w.yaw += wrap(Math.atan2(dx, dz) - w.yaw) * Math.min(1, dt * 6);
      }
      w.pos.y = this.col.groundAt(w.pos.x, w.pos.z, w.pos.y + 0.6, 0.7, 0.2);
      w.m.speed += (speed - w.m.speed) * Math.min(1, dt * 6);
      stepPhase(w.m, dt);
      w.anim.update(dt);
      const h = w.human;
      if (!h.ready) continue;
      h.group.visible = true;
      this.root.compose(w.pos, this.q.setFromAxisAngle(UP, w.yaw), _s.setScalar(h.body.height));
      solve(w.rig, this.root, h.body, w.outfit, w.m, t, w.anim);
      h.pose(camera.position.distanceTo(w.pos));
    }
  }

  private scan(player: THREE.Vector3, minutes: number) {
    const cand: { r: Resident; d: number; p: THREE.Vector3 }[] = [];
    let about = 0;
    const p = new THREE.Vector3();
    for (const town of this.gen.settlementsNear(player.x, player.z, 1)) {
      if (town.kind === 'ruin' || town.kind === 'junction') continue;
      if (Math.hypot(town.x - player.x, town.z - player.z) > town.radius + 300) continue;
      const plan = this.towns.plan(town);
      for (const r of this.residents(town)) {
        if (!this.where(r, plan, minutes, p)) continue;
        about++;
        const d = Math.hypot(p.x - player.x, p.z - player.z);
        if (d < FAR) cand.push({ r, d, p: p.clone() });
      }
    }
    this.about = about;
    cand.sort((a, b) => a.d - b.d);
    const keep = new Set<string>();
    for (const c of cand) {
      if (keep.size >= MAX_EMBODIED) break;
      if (c.d > NEAR && !this.walkers.has(c.r.id)) continue;
      keep.add(c.r.id);
      if (!this.walkers.has(c.r.id)) this.embody(c.r, c.p);
    }
    for (const [id, w] of this.walkers) if (!keep.has(id)) this.release(id, w);
  }

  private embody(r: Resident, at: THREE.Vector3) {
    let human = this.pool.get(r.id);
    if (!human) {
      human = new RealHuman(r.spec, { height: 1, girth: 1, shoulders: 1, hips: 1, head: 1 });
      this.pool.set(r.id, human);
      // don't keep too many people's meshes about
      if (this.pool.size > 28) {
        for (const [id, h] of this.pool) {
          if (this.walkers.has(id)) continue;
          h.dispose();
          this.pool.delete(id);
          if (this.pool.size <= 24) break;
        }
      }
    }
    human.group.visible = false;
    this.group.add(human.group);
    this.walkers.set(r.id, { r, human, rig: newRig(), m: newMotion(), anim: new Animator(), pos: at.clone(), yaw: Math.random() * 6.28, outfit: { bulk: 1 } as Outfit, talk: 0, idle: 0 });
  }

  private release(id: string, w: Walker) {
    w.human.group.visible = false;
    this.group.remove(w.human.group);
    this.walkers.delete(id);
  }

  /** The resident you're facing, within arm's reach. */
  nearest(pos: THREE.Vector3, fwd: THREE.Vector3, reach = 2.4): Walker | null {
    let best: Walker | null = null, bd = reach;
    for (const w of this.walkers.values()) {
      if (!w.human.ready) continue;
      const dx = w.pos.x - pos.x, dz = w.pos.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > bd || (dx * fwd.x + dz * fwd.z) / (d || 1) < 0.2) continue;
      bd = d;
      best = w;
    }
    return best;
  }

  /** You spoke to them: they stop, turn to you, and say something that fits who they are and the hour. */
  talk(w: Walker, ctx: { hour: number; weather: string; place: string; rumour: string | null }): string[] {
    w.talk = 6;
    const r = w.r;
    r.met++;
    const rnd = mulberry32(hash3(r.i, r.met, Math.floor(ctx.hour * 4)));
    const greet = ctx.hour < 5 || ctx.hour > 22 ? ['It’s late.', 'You’re up late.', 'Can’t sleep either?'] : ctx.hour < 11 ? ['Morning.', 'Morning. Cold one.'] : ctx.hour < 18 ? ['Afternoon.', 'Hello.'] : ['Evening.', 'Evening. Getting dark.'];
    const byJob: Record<string, string[]> = {
      worker: ['Double shift. Don’t ask.', 'The yard’s laying people off again.'],
      office: ['Meetings all day. About the meetings.', 'I’m going to be late.'],
      shopkeeper: ['Come by the shop sometime.', 'Takings are down. Everyone’s saving for something.'],
      nurse: ['Twelve hours on. Everyone in the county came in tonight.', 'Keep out of the hospital if you can.'],
      teacher: ['Half my class didn’t come in today.', 'They’re good kids. Mostly.'],
      driver: ['I’ve driven every road from here to the coast.', 'Roads north are bad this time of year.'],
      mechanic: ['If it’s got an engine, I’ve had my hands in it.', 'Your car making a noise? Bring it in.'],
      bartender: ['I hear everything. I repeat nothing. Mostly.', 'Pour you one, some night.'],
      student: ['Exams. I’m not sleeping.', 'I’m going to leave this town. One day.'],
      retired: ['Forty years I worked. Now I walk.', 'This town used to be different. Everyone says that. It’s true.'],
      night: ['Night shift. You get used to it. No you don’t.', 'The night’s the only time it’s quiet.'],
      police: ['Move along.', 'Keep your nose clean and we won’t have a problem.'],
      rich: ['I’m sorry, do I know you?', 'I really must be going.'],
      drifter: ['Spare anything? No? Alright.', 'I’ve seen things on these roads you wouldn’t believe.'],
    };
    const lines: string[] = [];
    if (r.met === 1) lines.push(`${rnd.pick(greet)} I’m ${r.name.split(' ')[0]}.`);
    else lines.push(r.met === 2 ? `You again.` : `We keep running into each other.`);
    if (r.friendly < 0.2 && r.met === 1) {
      lines.push('Not in the mood.');
      return lines;
    }
    lines.push(rnd.pick(byJob[r.job] ?? byJob.worker));
    if (/rain|storm/i.test(ctx.weather) && rnd.chance(0.5)) lines.push('Filthy weather.');
    if (ctx.rumour && r.friendly > 0.45) lines.push(ctx.rumour);
    return lines;
  }

  get count() {
    return this.walkers.size;
  }

  /** The body of a resident, if they're near enough to have one. */
  find(id: string): Walker | null {
    return this.walkers.get(id) ?? null;
  }

  clear() {
    for (const [id, w] of this.walkers) this.release(id, w);
  }
}

function dc(plan: TownPlan, i: number) {
  const w = plan.walk[i];
  return Math.hypot(w.x - plan.s.x, w.z - plan.s.z);
}

function jobLook(j: Job): Who['job'] {
  return j === 'shopkeeper' || j === 'teacher' ? 'office' : j === 'nurse' ? 'medic' : j === 'driver' || j === 'night' ? 'worker' : j === 'retired' ? 'office' : (j as Who['job']);
}

function wrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

const UP = new THREE.Vector3(0, 1, 0);
const _s = new THREE.Vector3();
