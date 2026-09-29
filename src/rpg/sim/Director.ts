import * as THREE from 'three';
import { h } from '../../ui/dom';
import type { Rpg } from '../Rpg';
import type { Node } from '../game/dialogue';
import { item } from '../game/items';
import { randomSpec } from '../people/kit';
import type { HumanSpec } from '../people/anatomy';
import { SEA_Y } from '../world/WorldGen';
import { Figures, type Figure } from './Figures';
import { vehicleMesh } from './RoadTraffic';

/**
 * What happens to you out there. Two directors in one:
 *
 * Dread. Out of town, after dark, in the woods or the marsh or the ruins, a
 * feeling builds (faster the further the story has gone, slower by a fire,
 * in a car, or with Nerve). The edges of the screen close in. Then things
 * happen: someone very tall standing at the tree line, watching, gone when
 * you look straight at them; the street lights stuttering; your name, said
 * quietly, behind you; the woods going silent all at once. Nothing kills
 * you. It just lets you know it's there.
 *
 * The road. By day and evening, things turn up by the roads between towns:
 * a car broken down with its hazards going, someone hurt in the verge,
 * someone lost, an old box half-buried off the shoulder. Each can go more
 * than one way.
 */

type RoadKind = 'breakdown' | 'wounded' | 'lost' | 'cache';

interface RoadEvent {
  kind: RoadKind;
  pos: THREE.Vector3;
  fig: Figure | null;
  props: THREE.Object3D[];
  hazard?: THREE.MeshStandardMaterial;
  done: boolean;
  label: string;
}

export class Director {
  group = new THREE.Group();
  figures = new Figures();
  dread = 0;
  /** street lamps' gain multiplier (they stutter when it's close) */
  dim = 1;
  private dimT = 0;
  private cool = 45;
  private roadCool = 50;
  private watcher: { f: Figure; t: number; look: number } | null = null;
  private events: RoadEvent[] = [];
  private vignette: HTMLElement;
  private t = 0;

  constructor(private rpg: Rpg, ui: HTMLElement) {
    this.group.add(this.figures.group);
    this.vignette = h('div', { class: 'dread', 'aria-hidden': 'true' });
    ui.prepend(this.vignette);
  }

  private get g() {
    return this.rpg.life.game;
  }

  update(dt: number, live: boolean, camera: THREE.Camera) {
    this.t += dt;
    const p = this.rpg.host.player.pos;
    this.figures.update(dt, this.t, p, camera);
    const g = this.g;
    if (!g || !live) {
      this.vignette.style.opacity = '0';
      return;
    }
    this.feel(dt, p);
    this.cool -= dt;
    if (this.cool <= 0) {
      this.cool = 18 + Math.random() * 14;
      if (Math.random() < this.dread * 0.75 - 0.1) this.scare(p, camera);
    }
    this.roadCool -= dt;
    if (this.roadCool <= 0) {
      this.roadCool = 40 + Math.random() * 40;
      if (!this.events.some((e) => !e.done) && this.rpg.atmos.daylight > 0.2 && Math.random() < 0.55) this.roadside(p, camera);
    }
    this.tendWatcher(dt, p, camera);
    this.tendEvents(dt, p);
    // the lights
    if (this.dimT > 0) {
      this.dimT -= dt;
      this.dim = Math.random() < 0.3 ? 0.05 : 0.6 + Math.random() * 0.4;
      if (this.dimT <= 0) this.dim = 1;
    }
  }

  /* ── dread ────────────────────────────────────────────── */

  private feel(dt: number, p: THREE.Vector3) {
    const g = this.g!, a = this.rpg.atmos, place = this.rpg.place;
    const hour = a.hours;
    const s = place.settlement;
    const inTown = !!s && s.kind !== 'ruin' && Math.hypot(p.x - s.x, p.z - s.z) < s.radius * 0.8;
    let target = 0;
    if (a.daylight < 0.25) target += 0.35;
    if (hour >= 23 || hour < 4.5) target += 0.2;
    if (!inTown) target += 0.15;
    if (s?.kind === 'ruin') target += 0.3;
    if (['forest', 'swamp', 'boreal', 'tundra'].includes(place.biome)) target += 0.1;
    const stage = Number(g.s.quests.find((q) => q.kind === 'main')?.data.stage ?? 0);
    if (stage >= 3) target += 0.1;
    if (stage >= 5) target += 0.12;
    if (inTown) target *= 0.35;
    if (this.rpg.life.fire && this.rpg.life.fire.group.position.distanceTo(p) < 8) target -= 0.3;
    if (this.rpg.host.inVehicle()) target -= 0.15;
    target *= 1 - g.c.attrs.nerve * 0.045;
    if (g.c.perks.includes('coldblood')) target *= 0.6;
    target = Math.max(0, Math.min(1, target));
    this.dread += (target - this.dread) * Math.min(1, dt * 0.06);
    const v = Math.pow(this.dread, 1.4);
    this.vignette.style.opacity = v.toFixed(3);
    this.vignette.classList.toggle('is-pulse', this.dread > 0.72);
  }

  private scare(p: THREE.Vector3, camera: THREE.Camera) {
    const g = this.g!;
    const kinds: string[] = ['whisper', 'footsteps', 'silence'];
    if (!this.watcher && this.dread > 0.35) kinds.push('watcher', 'watcher');
    if (this.rpg.nearLamps(p, 90)) kinds.push('lights');
    if (this.rpg.host.inVehicle()) kinds.push('radio', 'radio');
    const k = kinds[Math.floor(Math.random() * kinds.length)];
    const name = g.c.name.split(' ')[0];
    switch (k) {
      case 'watcher':
        this.spawnWatcher(p, camera);
        break;
      case 'lights':
        this.dimT = 3 + Math.random() * 4;
        this.remember('lights', 'The street lights went out, one after another, and came back.');
        break;
      case 'whisper':
        this.rpg.hud.toast(`Someone said “${name}”. Quietly. Behind you.`, 'bad');
        this.rpg.host.rumble?.(0.4);
        this.remember('whisper', 'Heard my name in the dark. Nobody there.');
        break;
      case 'footsteps':
        this.rpg.hud.toast('Footsteps behind you, in step with yours. They stop when you stop.', 'bad');
        this.remember('footsteps', 'Something walked in step with me.');
        break;
      case 'silence':
        this.rpg.wildlife.alarm(p, 400);
        this.rpg.hud.toast('Everything goes quiet at once. The birds, the insects, all of it.', 'bad');
        this.remember('silence', 'The whole wood went silent, all at once.');
        break;
      case 'radio':
        this.rpg.hud.toast('The radio slides into static. Under it, a voice reads out a list of names. Yours is next.', 'bad');
        this.remember('radio', 'The car radio read my name out of the static.');
        break;
    }
  }

  private remember(key: string, line: string) {
    const g = this.g!;
    const flag = `horror:${key}`;
    if (g.s.mem.flags[flag]) return;
    g.s.mem.flags[flag] = true;
    g.note(line);
    const seen = Object.keys(g.s.mem.flags).filter((f) => f.startsWith('horror:')).length;
    if (seen >= 4 && !g.s.mem.secrets.includes('the-watcher')) {
      g.s.mem.secrets.push('the-watcher');
      g.note('It isn’t random. Whatever kept District 03 dark is following me out here.');
      g.xp(100, 'a secret');
    }
  }

  private spawnWatcher(p: THREE.Vector3, camera: THREE.Camera) {
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    const base = Math.atan2(fwd.x, fwd.z);
    for (let k = 0; k < 10; k++) {
      // off to one side of where you're looking, at the edge of what you can see
      const a = base + (Math.random() < 0.5 ? -1 : 1) * (0.55 + Math.random() * 0.45);
      const d = 45 + Math.random() * 25;
      const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
      const gr = this.rpg.gen.ground(x, z);
      if (gr.water !== null || gr.h < SEA_Y + 0.5) continue;
      const pos = new THREE.Vector3(x, this.rpg.streamer.heightAt(x, z), z);
      const f = this.figures.add(watcherSpec(), pos, Math.atan2(p.x - x, p.z - z), { watch: false, scale: 1.12 });
      // pale enough to catch what little light there is: you see it at the edge of the dark, just
      f.human.onReady = () => f.human.group.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m && 'emissive' in m && (o as THREE.Mesh).isMesh && m.color && m.color.r > 0.2) {
          m.emissive = m.color.clone().multiplyScalar(0.35);
          m.emissiveIntensity = 1;
        }
      });
      this.watcher = { f, t: 40, look: 0 };
      return;
    }
  }

  private tendWatcher(dt: number, p: THREE.Vector3, camera: THREE.Camera) {
    const w = this.watcher;
    if (!w) return;
    w.t -= dt;
    const f = w.f;
    f.yaw = Math.atan2(p.x - f.pos.x, p.z - f.pos.z);
    const d = Math.hypot(p.x - f.pos.x, p.z - f.pos.z);
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    const to = new THREE.Vector3(f.pos.x - camera.position.x, f.pos.y + 1.7 - camera.position.y, f.pos.z - camera.position.z).normalize();
    const looking = fwd.dot(to) > 0.992;
    w.look = looking ? w.look + dt : Math.max(0, w.look - dt * 0.5);
    if (w.look > 1.1 || d < 30 || w.t <= 0) {
      if (w.look > 1.1 || d < 30) {
        this.rpg.hud.toast(d < 30 ? 'Gone. There’s nothing there but the trees.' : 'You looked straight at it, and it wasn’t there.', 'bad');
        this.remember('watcher', 'Someone very tall stood at the tree line, watching me. When I looked straight at them, they were gone.');
      }
      this.figures.remove(f);
      this.watcher = null;
    }
  }

  /* ── the road ─────────────────────────────────────────── */

  private roadside(p: THREE.Vector3, camera: THREE.Camera) {
    if (this.rpg.place.settlement || this.rpg.inD03(p)) return;
    const roads = this.rpg.gen.roadsNear(p.x, p.z);
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    let best: { x: number; z: number; yaw: number } | null = null;
    // a point on a road, ahead of you, 90–160 m off
    for (const r of roads) {
      const P = r.pts;
      for (let i = 0; i < P.length / 2 - 1; i++) {
        const x = P[i * 2], z = P[i * 2 + 1];
        const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
        if (d < 90 || d > 160 || (dx * fwd.x + dz * fwd.z) / d < 0.3) continue;
        best = { x, z, yaw: Math.atan2(P[i * 2 + 2] - x, P[i * 2 + 3] - z) };
        break;
      }
      if (best) break;
    }
    const kinds: RoadKind[] = ['breakdown', 'breakdown', 'wounded', 'lost', 'cache'];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    if (!best) {
      if (kind !== 'cache') return;
      const a = Math.atan2(fwd.x, fwd.z) + (Math.random() - 0.5), d = 60 + Math.random() * 40;
      best = { x: p.x + Math.sin(a) * d, z: p.z + Math.cos(a) * d, yaw: a };
    }
    // step off onto the verge
    const side = Math.random() < 0.5 ? 1 : -1;
    const off = kind === 'cache' ? 18 + Math.random() * 14 : 6;
    const x = best.x + Math.cos(best.yaw) * off * side, z = best.z - Math.sin(best.yaw) * off * side;
    const gr = this.rpg.gen.ground(x, z);
    if (gr.water !== null) return;
    const y = this.rpg.streamer.heightAt(x, z);
    const pos = new THREE.Vector3(x, y, z);
    const ev: RoadEvent = { kind, pos, fig: null, props: [], done: false, label: '' };
    const biome = this.rpg.place.biome;
    const spec = (job: 'mechanic' | 'worker' | 'drifter' | 'student') => randomSpec(Math.floor(Math.random() * 1e9), { biome, job });
    if (kind === 'breakdown') {
      const { mesh, tails } = vehicleMesh(Math.random() < 0.5 ? 'sedan' : 'pickup', this.rpg.host.mats);
      mesh.position.set(best.x + Math.cos(best.yaw) * 4.2 * side, this.rpg.streamer.heightAt(best.x, best.z) + 0.02, best.z - Math.sin(best.yaw) * 4.2 * side);
      mesh.rotation.y = best.yaw;
      this.group.add(mesh);
      ev.props.push(mesh);
      ev.hazard = tails;
      ev.fig = this.figures.add(spec('worker'), pos, best.yaw + Math.PI / 2 * side, { loop: ['emote.wave', 'idle.checkPhone', 'emote.callOver', 'idle.footTap'] });
      ev.label = 'Stranded driver';
      this.rpg.hud.toast('A car stopped on the verge, hazards going. Someone waving.', 'info');
    } else if (kind === 'wounded') {
      ev.fig = this.figures.add(spec('drifter'), pos, best.yaw, { sit: true, loop: ['react.uneasy', 'emote.cry'] });
      ev.label = 'Someone hurt';
      this.rpg.hud.toast('Someone sitting in the verge, holding their arm.', 'info');
      if (this.rpg.atmos.daylight < 0.45) for (let i = 0; i < 3; i++) {
        const a = this.rpg.wildlife.spawn('wolf', i === 0, x + 60 + i * 3, z + 20);
        a.state = 'stalk';
        a.t = 25;
      }
    } else if (kind === 'lost') {
      const sp = spec('student');
      sp.extras = { ...sp.extras, backpack: 0x4a5a3a };
      ev.fig = this.figures.add(sp, pos, best.yaw, { loop: ['idle.lookAround', 'emote.confused', 'idle.scan'] });
      ev.label = 'Lost hiker';
    } else {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.35, 0.45), new THREE.MeshStandardMaterial({ color: 0x3a4430, roughness: 0.7, metalness: 0.4 }));
      box.position.set(x, y + 0.08, z);
      box.rotation.set(0.12, Math.random() * 6, 0.08);
      box.castShadow = true;
      this.group.add(box);
      ev.props.push(box);
      ev.label = 'Ammo box';
    }
    this.events.push(ev);
  }

  private tendEvents(dt: number, p: THREE.Vector3) {
    for (const e of this.events) {
      if (e.hazard) e.hazard.emissiveIntensity = Math.sin(this.t * 6) > 0 ? 6 : 0.2;
      if (p.distanceTo(e.pos) > 450) this.drop(e);
    }
    this.events = this.events.filter((e) => e.props.length || e.fig);
  }

  private drop(e: RoadEvent) {
    for (const o of e.props) this.group.remove(o);
    e.props = [];
    if (e.fig) this.figures.remove(e.fig);
    e.fig = null;
  }

  /** Something to do about an event in front of you. */
  interaction(pos: THREE.Vector3): { name: string; verb: string; go: () => void } | null {
    for (const e of this.events) {
      if (e.done) continue;
      const d = Math.hypot(pos.x - e.pos.x, pos.z - e.pos.z);
      if (d > 2.6) continue;
      if (e.kind === 'cache') return { name: e.label, verb: 'Open', go: () => this.openCache(e) };
      return { name: e.label, verb: 'Talk', go: () => this.rpg.life.talkTo(this.talk(e)) };
    }
    return null;
  }

  private talk(e: RoadEvent): Node {
    const g = this.g!;
    const end = (lines: string[]): Node => ({ speaker: e.label, lines, choices: [{ label: 'Goodbye.', go: () => null }] });
    const pct = (s: 'mechanics' | 'medicine' | 'survival' | 'speech', d: number) => `${s[0].toUpperCase()}${s.slice(1)} · ${Math.round(g.chance(s, d) * 100)}%`;
    if (e.kind === 'breakdown') {
      return {
        speaker: 'Stranded driver', sub: 'By the road', lines: ['Thank God. It just died on me. Lights on, nothing when I turn the key.', 'I’ve been here an hour. Nobody stops.'],
        choices: [
          { label: 'Let me have a look under the hood.', tag: pct('mechanics', 35), go: () => (g.check('mechanics', 35) ? (this.done(e, 'breakdown'), g.earn(30 + Math.round(Math.random() * 30), 'a thank-you'), g.rep('union', 4), g.xp(40, 'a roadside fix'), end(['It turns over! You’re a lifesaver. Here — no, take it.'])) : end(['…That made a noise it didn’t make before.', 'Maybe leave it. I’ll wait for a tow.'])) },
          { label: 'Take my repair kit.', disabled: g.count('repairkit') ? undefined : 'No repair kit', go: () => (g.take('repairkit', 1), this.done(e, 'breakdown'), g.earn(45, 'a thank-you'), g.rep('union', 6), g.xp(30, 'a good turn'), end(['You’d give me this? I’ll pay you for it. Thank you.'])) },
          { label: 'Can’t help, sorry.', go: () => null },
        ],
      };
    }
    if (e.kind === 'wounded') {
      const kit = g.count('medkit') ? 'medkit' : g.count('bandage') ? 'bandage' : null;
      return {
        speaker: 'Someone hurt', sub: 'In the verge', lines: ['Wolves. Came out of nowhere. I got up a tree but my arm…', 'Please. I can’t stop it bleeding.'],
        choices: [
          { label: kit ? `Patch them up (${item(kit).name.toLowerCase()}).` : 'Patch them up with what you’ve got.', tag: pct('medicine', kit ? 10 : 45), go: () => {
            if (kit) g.take(kit, 1);
            if (!g.check('medicine', kit ? 10 : 45)) return end(['You do what you can. It isn’t enough to stop it.', 'They thank you anyway, and start walking to town.']);
            this.done(e, 'wounded');
            g.rep('drifters', 8);
            g.xp(50, 'a life saved');
            const gift = ['watch', 'coin', 'ring'][Math.floor(Math.random() * 3)];
            g.give(gift, 1);
            return end(['That’s… better. That’s better.', 'Here. It was my father’s. I want you to have it.']);
          } },
          { label: 'Hold on. I’ll send someone from town.', go: () => end(['Hurry. Please.']) },
        ],
      };
    }
    const town = this.rpg.gen.settlementsNear(e.pos.x, e.pos.z, 1).filter((s) => s.kind === 'town' || s.kind === 'city').sort((a, b) => Math.hypot(a.x - e.pos.x, a.z - e.pos.z) - Math.hypot(b.x - e.pos.x, b.z - e.pos.z))[0];
    const dir = town ? compass(town.x - e.pos.x, town.z - e.pos.z) : 'back the way you came';
    return {
      speaker: 'Lost hiker', sub: 'Off the trail', lines: ['Sorry — do you know where we are? My map ends at the last town and my phone died.'],
      choices: [
        { label: town ? `${town.name}’s ${Math.round(Math.hypot(town.x - e.pos.x, town.z - e.pos.z) / 100) / 10} km ${dir}. Follow the road.` : 'Follow the road back.', go: () => (this.done(e, 'lost'), g.rep('drifters', 3), g.xp(20, 'directions'), end(['Thank you. Really. I thought I’d be out here all night.'])) },
        { label: 'Take my road atlas.', disabled: g.count('roadmap') ? undefined : 'No atlas', go: () => (g.take('roadmap', 1), this.done(e, 'lost'), g.rep('drifters', 6), g.xp(30, 'a good turn'), g.earn(20, 'for the atlas'), end(['You’re sure? Here, for your trouble.'])) },
        { label: 'No idea. Sorry.', go: () => null },
      ],
    };
  }

  private done(e: RoadEvent, key: string) {
    e.done = true;
    const g = this.g!;
    if (e.fig) e.fig.loop = ['emote.thumbsUp', 'emote.wave', 'idle.stretch'];
    if (e.hazard) e.hazard.emissiveIntensity = 0.4;
    g.s.mem.flags[`road:${key}`] = ((g.s.mem.flags[`road:${key}`] as number) ?? 0) + 1;
  }

  private openCache(e: RoadEvent) {
    const g = this.g!;
    const pry = g.count('crowbar') > 0;
    const ok = pry || g.check('lockpicking', 30);
    if (!ok) {
      this.rpg.hud.toast('Rusted shut. A crowbar would do it, or better hands with a pick.', 'info');
      return;
    }
    e.done = true;
    const rounds = ['r38', 'r9', 'shells', 'r308'][Math.floor(Math.random() * 4)];
    g.give(rounds, 6 + Math.floor(Math.random() * 12));
    g.earn(20 + Math.round(Math.random() * 60), 'in a tin');
    const lore = [
      'A page torn from a ledger: “Delivered to the Chapel — 40 candles, 12 bolts of black cloth, 1 bell (cracked).” Dated last winter.',
      'A note in pencil: “Don’t drive the old coast road after midnight. If a hitchhiker in grey waves, don’t stop. Don’t even slow down.”',
      'A map of the county, one town circled so hard the pen went through. Beside it: “it started here, not in the city.”',
      'A photograph of a family on a porch. Someone has scratched out one face, very carefully, again and again.',
    ];
    const text = lore[Math.floor(Math.random() * lore.length)];
    g.give('note', 1, { name: 'Note from the ammo box', desc: text });
    g.xp(20, 'a find');
    this.rpg.hud.toast(pry ? 'You lever the lid off.' : 'The lock gives.', 'info');
  }

  clear() {
    for (const e of this.events) this.drop(e);
    this.events = [];
    if (this.watcher) this.figures.remove(this.watcher.f);
    this.watcher = null;
    this.figures.clear();
    this.dread = 0;
    this.dim = 1;
    this.vignette.style.opacity = '0';
  }
}

/** The one at the tree line: very tall, very still, pale as paper, dressed for a funeral. */
function watcherSpec(): HumanSpec {
  const s = randomSpec(3170529, { sex: 0.95, age: 0.5 });
  s.skin = 0xb4b3ad;
  s.hair = 'bald';
  s.beard = 'none';
  s.fat = 0;
  s.muscle = 0.2;
  s.top = { kind: 'coat', color: 0x0a0a0c, fabric: 'wool' };
  s.bottom = { kind: 'trousers', color: 0x0a0a0c, fabric: 'wool' };
  s.shoes = { kind: 'shoes', color: 0x050505 };
  s.extras = {};
  s.eyeColor = 0x101010;
  return s;
}

function compass(dx: number, dz: number) {
  const a = (Math.atan2(dx, -dz) * 180) / Math.PI;
  return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(((a + 360) % 360) / 45) % 8];
}
