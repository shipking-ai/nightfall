import * as THREE from 'three';
import type { Rpg, RpgHost } from './Rpg';
import { Game, newState, type GameState, type Tone } from './game/Game';
import { Saves, type SlotId } from './game/saves';
import { poiTalk, residentTalk, staffOf, type Node, type TalkCtx } from './game/dialogue';
import { advanceMain, current, MAIN_ID, mainPlaces, startMain, type QuestWorld } from './game/quests';
import { heroSpec } from './people/kit';
import type { HumanSpec } from './people/anatomy';
import type { Walker } from './sim/Populace';
import type { Poi } from './world/Towns';
import type { Settlement } from './world/WorldGen';
import { Talk } from './ui/Talk';
import { Casefile, type Tab } from './ui/Casefile';
import { Shop } from './ui/Shop';
import { Creator } from './ui/Creator';
import { Fishing, type Catch } from './ui/Fishing';
import { Campfire } from './sim/Camp';
import type { Animal } from './sim/Wildlife';
import { item } from './game/items';
import { maxHealth } from './game/character';
import { BIOMES } from './world/biomes';

/**
 * A life in the wider world: the character, their things and their jobs
 * (the Game), the screens that show it (a conversation, the Casefile, a
 * shop counter, the mirror at the start), the saves, and the moments where
 * the world and the rules meet — talking to someone, going through a door,
 * searching a place, sleeping, taking a train.
 */

export type Panel = 'talk' | 'casefile' | 'shop' | 'creator' | 'fishing';

const AUTOSAVE_S = 150;

export class Life {
  game: Game | null = null;
  saves = new Saves();
  talk: Talk;
  cf: Casefile;
  shop: Shop;
  creator: Creator;
  panel: Panel | null = null;
  /** no save yet: the mirror opens as soon as the world is up */
  pendingCreator = false;
  private autoT = AUTOSAVE_S;
  private lastClock = -1;
  private talkingTo: Walker | null = null;
  private busy = false;
  private visitedKey = '';
  private heroT = 0;
  private heroWant: HumanSpec | null = null;

  constructor(private rpg: Rpg, private host: RpgHost) {
    this.talk = new Talk(host.ui);
    this.talk.onEnd = () => this.closePanel();
    this.cf = new Casefile(host.ui, {
      pos: () => host.player.pos,
      track: (id) => this.game && (this.game.s.track = id),
      save: (slot) => this.save(slot),
      load: (slot) => void this.load(slot),
      peek: (slot) => this.saves.peek(slot),
      newLife: () => this.newLife(),
      changed: () => {},
      makeFire: () => this.makeFire(),
      toast: (t) => rpg.hud.toast(t),
    });
    this.shop = new Shop(host.ui);
    this.shop.onClose = () => this.closePanel();
    this.creator = new Creator(host.ui);
    this.creator.onChange = (spec) => this.wantHero(spec);
    this.creator.onTurn = (d) => (host.player.facing += d * 0.7);
    this.creator.onBegin = (d) => this.begin(d.name.trim() || 'Nobody', d);
    this.fishing = new Fishing(host.ui);
    this.fishing.onEnd = (c, m) => this.landed(c, m);
  }

  fishing: Fishing;
  /** your fire, if you've lit one */
  fire: Campfire | null = null;

  /** The screens, for the menu navigator (what back and the shoulder buttons mean). */
  get panels() {
    return [this.talk.el, this.cf.el, this.shop.el, this.creator.el, this.fishing.el];
  }

  /** The creator is open: the camera turns to face you (the wardrobe's fitting shot). */
  get fitting() {
    return this.panel === 'creator';
  }

  get world(): QuestWorld {
    return { gen: this.rpg.gen, towns: this.rpg.streamer.towns, residents: (s) => this.rpg.populace.residents(s) };
  }

  private events() {
    return {
      toast: (t: string, tone: Tone) => this.rpg.hud.toast(t, tone),
      levelUp: (n: number) => this.rpg.hud.arrive(`Level ${n}`, 'A new perk to choose · open the Casefile'),
    };
  }

  /* ── starting, saving, loading ─────────────────────────── */

  /**
   * Before the world is built: the most recent save, if there is one, puts
   * you back where you were (and when, and who). Otherwise the mirror.
   */
  resume(): HumanSpec {
    const slot = this.saves.latest();
    const st = slot ? this.saves.load(slot) : null;
    if (!st) {
      this.game = null;
      this.pendingCreator = true;
      return heroSpec(0.9, 7);
    }
    this.apply(st);
    return st.hero;
  }

  private apply(st: GameState) {
    this.game = new Game(st, this.events());
    this.pendingCreator = false;
    const p = st.pos;
    this.host.player.place(p.x, p.y + 0.2, p.z, p.yaw);
    this.rpg.atmos.minutes = st.clock.minutes;
    this.rpg.atmos.day = st.clock.day;
    this.lastClock = -1;
    this.visitedKey = '';
  }

  private snapshot(): GameState | null {
    const g = this.game;
    if (!g) return null;
    const p = this.host.player.pos;
    g.s.pos = { x: p.x, y: p.y, z: p.z, yaw: this.host.player.facing };
    g.s.clock = { minutes: this.rpg.atmos.minutes, day: this.rpg.atmos.day };
    return g.s;
  }

  save(slot: SlotId): boolean {
    const st = this.snapshot();
    if (!st) return false;
    return this.saves.write(slot, st, this.rpg.place.name);
  }

  autosave() {
    if (this.game && !this.host.inVehicle()) this.save('auto');
    this.autoT = AUTOSAVE_S;
  }

  async load(slot: SlotId) {
    const st = this.saves.load(slot);
    if (!st) {
      this.rpg.hud.toast('That save can’t be read.', 'bad');
      return;
    }
    this.closePanel();
    await this.host.curtain(true);
    this.apply(st);
    this.rpg.setHero(st.hero);
    await this.rpg.streamer.preload(this.host.player.pos, () => {});
    this.rpg.atmos.settle(this.host.player.pos, this.rpg.place.biome);
    await this.host.curtain(false);
    this.rpg.hud.toast('Loaded.', 'info');
  }

  /** Start over: back to River Road at dawn, and the mirror. */
  private async newLife() {
    this.closePanel();
    await this.host.curtain(true);
    const sp = this.host.spawn;
    this.host.player.place(sp.x, 0.15, sp.z, sp.yaw);
    this.rpg.atmos.minutes = 5 * 60 + 29;
    this.rpg.atmos.day = 0;
    this.game = null;
    await this.rpg.streamer.preload(this.host.player.pos, () => {});
    await this.host.curtain(false);
    this.openCreator();
  }

  openCreator() {
    this.pendingCreator = false;
    this.panel = 'creator';
    this.host.panel(true, 'playing');
    this.creator.open();
  }

  private begin(name: string, d: { bg: Parameters<typeof newState>[1]; attrs: Parameters<typeof newState>[2]; spec: HumanSpec }) {
    const p = this.host.player.pos;
    const st = newState(name, d.bg, d.attrs, JSON.parse(JSON.stringify(d.spec)), { x: p.x, y: p.y, z: p.z, yaw: this.host.player.facing });
    st.clock = { minutes: this.rpg.atmos.minutes, day: this.rpg.atmos.day };
    this.game = new Game(st, this.events());
    startMain(this.world, this.game);
    this.rpg.setHero(st.hero);
    this.creator.close();
    this.panel = null;
    this.host.panel(false);
    this.lastClock = -1;
    this.autosave();
    this.rpg.hud.arrive(name, 'The night is over. There’s a letter in your coat. (Casefile: M or View)');
  }

  /** The figure rebuilds a moment after you stop changing it (building a person takes a beat). */
  private wantHero(spec: HumanSpec) {
    this.heroWant = JSON.parse(JSON.stringify(spec));
    this.heroT = 0.35;
  }

  /* ── panels ───────────────────────────────────────────── */

  openCasefile(tab?: Tab, from: 'playing' | 'pause' = 'playing') {
    if (!this.game) return;
    this.closeAll();
    this.panel = 'casefile';
    this.host.panel(true, from);
    this.cf.open(this.game, tab);
  }

  /** A conversation that isn't with a resident (an event, the fire). */
  talkTo(n: Node) {
    this.openTalk(n, null);
  }

  private openTalk(n: Node, w: Walker | null) {
    this.closeAll();
    this.talkingTo = w;
    if (w) w.talk = 1e6;
    this.panel = 'talk';
    this.host.panel(true, 'playing');
    this.talk.show(n);
  }

  /** Esc / B inside a panel. True if the panel dealt with it (the App shouldn't close the overlay). */
  back(): boolean {
    if (this.panel === 'creator') return true; // you have to be someone
    return false;
  }

  /** Close whatever's open (the App's overlay closes with it). */
  closePanel() {
    this.closeAll();
    this.host.panel(false);
  }

  /** Hide every panel without telling the App (it's closing its overlay anyway). */
  closeAll() {
    this.talk.close();
    this.cf.close();
    this.shop.close();
    this.fishing.close();
    if (this.panel !== 'creator') this.creator.close();
    if (this.talkingTo) this.talkingTo.talk = 2.5;
    this.talkingTo = null;
    if (this.panel !== 'creator') this.panel = null;
  }

  /* ── the world and the rules ──────────────────────────── */

  private ctx(): TalkCtx {
    const g = this.game!;
    const a = this.rpg.atmos;
    return {
      g,
      w: this.world,
      hour: a.hours,
      weather: a.describe(),
      biome: this.rpg.place.biome,
      night: a.daylight < 0.3,
      rumour: () => this.rpg.rumourAt(this.host.player.pos),
      openShop: (poi) => {
        this.closeAll();
        this.panel = 'shop';
        this.host.panel(true, 'playing');
        this.shop.open(g, poi, this.rpg.place.biome);
      },
      sleep: (until, cost) => void this.sleep(until, cost),
      travel: (to, cost) => void this.travel(to, cost),
      residents: (s) => this.rpg.populace.residents(s),
      pass: (m) => a.advance(m),
    };
  }

  /** What [interact] would do here: search, talk, or go through a door. */
  interaction(pos: THREE.Vector3, fwd: THREE.Vector3): { name: string; verb: string; go: () => void } | null {
    const g = this.game;
    if (!g || this.busy) return null;
    // a place a job says to search
    for (const q of g.s.quests) {
      if (q.state !== 'active') continue;
      const o = current(q);
      if (o?.search && o.at && Math.hypot(pos.x - o.at.x, pos.z - o.at.z) < o.at.r) return { name: o.at.label, verb: 'Search', go: () => void this.search(q.id) };
    }
    // something happening by the road
    const ev = this.rpg.director.interaction(pos);
    if (ev) return ev;
    // something you brought down
    const carcass = this.rpg.wildlife.carcass(pos);
    if (carcass) return { name: carcass.sp.name, verb: 'Butcher', go: () => void this.butcher(carcass) };
    // your fire
    if (this.fire && this.fire.group.position.distanceTo(pos) < 2.4) return { name: 'Campfire', verb: 'Sit by the fire', go: () => this.openTalk(this.campNode(), null) };
    const w = this.rpg.populace.nearest(pos, fwd);
    if (w) {
      const m = g.s.mem.met[w.r.id];
      return {
        name: m ? w.r.name : 'Stranger',
        verb: 'Talk',
        go: () => {
          const lines = this.rpg.populace.talk(w, { hour: this.rpg.atmos.hours, weather: this.rpg.atmos.describe(), place: this.rpg.place.name, rumour: null });
          this.openTalk(residentTalk(this.ctx(), w.r, lines), w);
        },
      };
    }
    // water in front of you, and a rod
    if (g.count('rod') && !this.host.inVehicle() && this.waterAhead(pos, fwd)) return { name: 'Water', verb: 'Fish', go: () => this.cast() };
    const poi = this.doorAt(pos, fwd);
    if (poi) {
      return {
        name: poi.name,
        verb: 'Go in',
        go: () => {
          const s = this.rpg.gen.settlementsNear(poi.x, poi.z, 1).find((x) => x.id === poi.town) ?? this.rpg.place.settlement;
          if (!s) return;
          this.visitPoi(poi);
          const staff = staffOf(poi, s, this.rpg.populace.residents(s));
          this.openTalk(poiTalk(this.ctx(), poi, staff), null);
        },
      };
    }
    return null;
  }

  private doorAt(pos: THREE.Vector3, fwd: THREE.Vector3): Poi | null {
    let best: Poi | null = null, bd = 3.4;
    for (const p of this.rpg.streamer.poisNear(pos.x, pos.z, 6)) {
      const dx = p.x - pos.x, dz = p.z - pos.z, d = Math.hypot(dx, dz);
      if (d < bd && (d < 1.2 || (dx * fwd.x + dz * fwd.z) / d > -0.2)) (best = p), (bd = d);
    }
    return best;
  }

  private visitPoi(p: Poi) {
    const m = this.game!.s.mem.pois;
    if (m[p.id]) m[p.id].n++;
    else m[p.id] = { n: 1, name: p.name, kind: p.kind, town: p.town, x: p.x, z: p.z };
  }

  /** Looking for something: it takes a while (less if you're good at it), and night finds things day doesn't. */
  private async search(qid: string) {
    const g = this.game!;
    const q = g.s.quests.find((x) => x.id === qid);
    const o = q && current(q);
    if (!q || !o) return;
    const night = this.rpg.atmos.daylight < 0.3;
    if (o.night && !night) {
      this.rpg.hud.toast('Nothing here in daylight. Come back after dark.', 'info');
      this.rpg.atmos.advance(10);
      return;
    }
    this.busy = true;
    const minutes = Math.round(35 * (g.c.perks.includes('bloodhound') ? 0.5 : 1) * (1 - g.c.skills.investigation / 200));
    this.rpg.hud.toast(`Searching… (${minutes} min)`, 'info');
    await this.host.curtain(true);
    this.rpg.atmos.advance(minutes);
    g.s.stats.searched++;
    const found = g.check('investigation', 25) || g.c.perks.includes('bloodhound') || (g.s.mem.flags[`tries:${qid}`] as number) >= 2;
    await this.host.curtain(false);
    this.busy = false;
    if (!found) {
      g.s.mem.flags[`tries:${qid}`] = ((g.s.mem.flags[`tries:${qid}`] as number) ?? 0) + 1;
      this.rpg.hud.toast('Nothing yet. Keep looking.', 'info');
      return;
    }
    if (night && this.rpg.place.settlement?.kind === 'ruin') this.rpg.hud.toast('Something moved at the edge of the torchlight.', 'bad');
    if (q.kind === 'main') {
      g.give('photo', 1, { name: 'Photograph of you', desc: 'You, outside a bank, in a coat you still wear. On the back, in pencil: a date forty years ago, and “314”.', quest: MAIN_ID });
      g.xp(120, 'what M. left');
      advanceMain(this.world, g, q, 4);
    } else {
      o.done = true;
      g.give('keepsake', 1, { name: String(q.data.thing).replace(/^(his|her) /, ''), desc: `${q.giver?.name ?? 'Someone'} wants this back.`, quest: q.id });
      if (Math.random() < 0.45) g.give(['coin', 'scrap', 'herbs', 'watch', 'cloth'][Math.floor(Math.random() * 5)], 1);
      g.xp(25, 'found it');
    }
    this.autosave();
  }

  private async sleep(until: number, cost: number) {
    const g = this.game!;
    if (!g.pay(cost)) return;
    this.closePanel();
    await this.host.curtain(true);
    const hours = (((until - this.rpg.atmos.hours) % 24) + 24) % 24 || 8;
    this.rpg.atmos.advance(hours * 60);
    g.sleep(hours);
    g.s.stats.days = this.rpg.atmos.day;
    this.autosave();
    await new Promise((r) => setTimeout(r, 600));
    await this.host.curtain(false);
    this.rpg.hud.toast(`Slept ${Math.round(hours)} hours. Saved.`, 'good');
  }

  private async travel(to: Settlement, cost: number) {
    const g = this.game!;
    if (!g.pay(cost)) return;
    this.closePanel();
    await this.host.curtain(true);
    const from = this.host.player.pos;
    const km = Math.hypot(to.x - from.x, to.z - from.z) / 1000;
    this.rpg.atmos.advance(20 + (km / 70) * 60);
    const plan = this.rpg.streamer.towns.plan(to);
    const st = plan.pois.find((p) => p.kind === 'station') ?? plan.pois[0];
    const at = st ? { x: st.x + Math.sin(st.yaw) * 2, z: st.z + Math.cos(st.yaw) * 2, yaw: st.yaw } : { x: plan.walk[0].x, z: plan.walk[0].z, yaw: 0 };
    this.host.player.place(at.x, this.rpg.gen.height(at.x, at.z) + 0.4, at.z, at.yaw);
    await this.rpg.streamer.preload(this.host.player.pos, () => {});
    g.practice('driving', 0.5);
    await this.host.curtain(false);
    this.rpg.hud.arrive(to.name, `Off the train · ${Math.round(km)} km`);
  }

  /* ── the wild: hunting, fire, fishing ─────────────────── */

  killed(a: Animal) {
    const g = this.game;
    if (!g) return;
    g.xp(a.sp.kind === 'predator' ? 40 : a.sp.health > 50 ? 25 : 8, a.sp.name.toLowerCase());
    g.practice(g.s.equipped && item(g.s.equipped).weapon?.skill === 'firearms' ? 'firearms' : 'melee', 2);
    g.practice('survival', 1);
    this.rpg.hud.toast(`${a.sp.name} down`, 'good');
  }

  /** What you're holding, for the fight: a gun (and what it takes), a blade or a bat, or your hands. */
  weapon(): { gun: boolean; dmg: number; ammo?: string; name: string } {
    const g = this.game;
    const id = g?.s.equipped;
    const w = id ? item(id).weapon : undefined;
    const c = g?.c;
    if (!w || !c) return { gun: false, dmg: 10 + (c ? c.attrs.grit * 2 + c.skills.melee / 6 : 4), name: 'Fists' };
    const skill = w.skill === 'firearms' ? c.skills.firearms : c.skills.melee;
    const bonus = w.skill === 'melee' ? c.attrs.grit * 1.5 + (c.perks.includes('brawler') ? 8 : 0) : 0;
    return { gun: w.skill === 'firearms', dmg: w.dmg * (0.75 + skill / 200) + bonus, ammo: w.ammo, name: item(id!).name };
  }

  /** One round out of your pockets for the gun in your hand; false (and a click) if you're out. */
  spendRound(): boolean {
    const g = this.game, w = this.weapon();
    if (!g || !w.gun || !w.ammo) return true;
    if (g.take(w.ammo, 1)) {
      g.practice('firearms', 0.3);
      return true;
    }
    this.rpg.hud.toast(`Out of ${item(w.ammo).name.toLowerCase()}`, 'bad');
    return false;
  }

  private async butcher(a: Animal) {
    const g = this.game!;
    if (!g.count('knife') && !g.count('crowbar')) {
      this.rpg.hud.toast('You need a knife to butcher it.', 'info');
      return;
    }
    this.busy = true;
    await this.host.curtain(true);
    this.rpg.atmos.advance(20);
    a.looted = true;
    const good = g.check('survival', 30);
    for (const [id, n] of a.sp.yield) {
      const k = id === 'hide' && !good ? Math.max(0, n - 1) : n;
      if (k > 0) g.give(id, k);
    }
    if (!good) this.rpg.hud.toast('A messy job. You ruined some of it.', 'info');
    g.xp(10, 'butchering');
    await this.host.curtain(false);
    this.busy = false;
  }

  /** Light a fire where you stand (a lighter, somewhere dry and not in town). */
  private makeFire(): string {
    const g = this.game;
    const p = this.host.player.pos;
    if (!g) return '';
    if (!g.count('lighter')) return 'You need a lighter.';
    if (this.rpg.place.settlement && Math.hypot(p.x - this.rpg.place.settlement.x, p.z - this.rpg.place.settlement.z) < this.rpg.place.settlement.radius * 0.8) return 'Not in the middle of town.';
    if (this.host.player.swimming || this.host.inVehicle()) return 'Not here.';
    if (this.rpg.atmos.now.rain > 0.6) return 'Too wet to get anything going.';
    this.putOut();
    const at = p.clone().add(new THREE.Vector3(Math.sin(this.host.player.facing) * 1.2, 0, Math.cos(this.host.player.facing) * 1.2));
    at.y = this.rpg.streamer.heightAt(at.x, at.z);
    this.fire = new Campfire(at);
    this.rpg.group.add(this.fire.group);
    this.rpg.extraLamps = [this.fire.lamp];
    this.rpg.refreshLamps();
    g.practice('survival', 1.5);
    this.closePanel();
    return 'You get a fire going.';
  }

  private putOut() {
    if (!this.fire) return;
    this.rpg.group.remove(this.fire.group);
    this.fire.dispose();
    this.fire = null;
    this.rpg.extraLamps = [];
    this.rpg.refreshLamps();
  }

  /** Sitting by the fire: cook, make things, rest. */
  private campNode(): Node {
    const g = this.game!;
    const back = () => this.campNode();
    const make = (label: string, need: [string, number][], out: [string, number], minutes: number, check?: { skill: 'survival' | 'mechanics' | 'medicine'; diff: number }) => {
      const missing = need.filter(([id, n]) => g.count(id) < n);
      return {
        label: `${label}${need.length ? ` (${need.map(([id, n]) => `${n > 1 ? `${n} × ` : ''}${item(id).name.toLowerCase()}`).join(', ')})` : ''}`,
        tag: check ? `${check.skill[0].toUpperCase()}${check.skill.slice(1)} · ${Math.round(g.chance(check.skill, check.diff) * 100)}%` : undefined,
        disabled: missing.length ? `Need ${missing.map(([id]) => item(id).name.toLowerCase()).join(', ')}` : undefined,
        go: (): Node => {
          for (const [id, n] of need) g.take(id, n);
          this.rpg.atmos.advance(minutes);
          const ok = !check || g.check(check.skill, check.diff);
          if (ok) g.give(out[0], out[1]);
          g.practice(check?.skill ?? 'survival', 1.5);
          return { speaker: 'Campfire', lines: [ok ? `${item(out[0]).name}.` : 'It doesn’t come out right. Wasted.'], choices: [{ label: 'Something else…', go: back }, { label: 'Get up.', go: () => null }] };
        },
      };
    };
    const left = Math.max(0, Math.round(this.fire?.fuel ?? 0));
    return {
      speaker: 'Campfire',
      sub: `${left} min of fire left · ${this.rpg.atmos.label}`,
      lines: ['The fire snaps. Somewhere out past the light, something moves through the brush and is gone.'],
      choices: [
        make('Grill a fish', [['fish', 1]], ['grilledfish', 1], 15),
        make('Roast venison', [['meat', 1]], ['venison', 1], 25),
        make('Cook a stew', [['meat', 1], ['herbs', 1]], ['stew', 1], 35, { skill: 'survival', diff: 20 }),
        make('Brew herbal tea', [['herbs', 2]], ['tea', 1], 10),
        make('Tear cloth into bandages', [['cloth', 2]], ['bandage', 2], 10, { skill: 'medicine', diff: 10 }),
        make('Bend scrap into lockpicks', [['scrap', 1]], ['lockpicks', 1], 30, { skill: 'mechanics', diff: 40 }),
        make('Put together a repair kit', [['scrap', 2], ['parts', 1]], ['repairkit', 1], 40, { skill: 'mechanics', diff: 30 }),
        {
          label: 'Rest by the fire for an hour',
          go: () => {
            this.rpg.atmos.advance(60);
            g.c.rest = Math.min(100, g.c.rest + 14);
            g.c.warmth = Math.max(g.c.warmth, 85);
            g.c.health = Math.min(maxHealth(g.c), g.c.health + 8);
            return { speaker: 'Campfire', lines: ['An hour of nothing but the fire. You needed that.'], choices: [{ label: 'Something else…', go: back }, { label: 'Get up.', go: () => null }] };
          },
        },
        { label: 'Put it out.', go: () => (this.putOut(), null) },
        { label: 'Get up.', go: () => null },
      ],
    };
  }

  private waterAhead(pos: THREE.Vector3, fwd: THREE.Vector3): boolean {
    if (this.host.player.swimming) return false;
    const l = Math.hypot(fwd.x, fwd.z) || 1;
    for (const d of [2, 3.5, 5]) {
      const x = pos.x + (fwd.x / l) * d, z = pos.z + (fwd.z / l) * d;
      const w = this.rpg.streamer.waterAt(x, z);
      if (w !== null && w !== undefined && w > this.rpg.streamer.heightAt(x, z) + 0.3) return true;
    }
    return false;
  }

  private cast() {
    const g = this.game!;
    const b = this.rpg.place.biome;
    const fish: Record<string, [string, number][]> = {
      coast: [['Mackerel', 0.6], ['Sea bass', 1.4], ['Cod', 2.2]], ocean: [['Mackerel', 0.6], ['Cod', 2.4]], swamp: [['Catfish', 2.4], ['Bluegill', 0.4], ['Gar', 2.8]],
      tundra: [['Arctic char', 1.4], ['Grayling', 0.8]], boreal: [['Pike', 2.6], ['Perch', 0.5], ['Lake trout', 1.8]], alpine: [['Brook trout', 0.7], ['Grayling', 0.8]],
      desert: [['Carp', 1.8]], scrub: [['Carp', 1.6], ['Bass', 1.2]], forest: [['Brown trout', 1.2], ['Perch', 0.5]], temperate: [['Perch', 0.5], ['Bass', 1.2], ['Carp', 2]],
    };
    const pool = fish[b] ?? fish.temperate;
    const [name, w] = pool[Math.floor(Math.random() * pool.length)];
    const weight = +(w * (0.6 + Math.random() * 0.8)).toFixed(1);
    this.closeAll();
    this.panel = 'fishing';
    this.host.panel(true, 'playing');
    this.fishing.open(g.c.skills.survival + g.c.attrs.stamina * 3, { name, weight });
  }

  private landed(c: Catch | null, minutes: number) {
    const g = this.game!;
    this.rpg.atmos.advance(minutes);
    this.closePanel();
    if (!c) return;
    g.give('fish', 1, undefined, true);
    g.practice('survival', 2 + c.weight);
    g.xp(8 + c.weight * 6, 'a catch');
    this.rpg.hud.toast(`${c.name}, ${c.weight} kg`, 'item');
    if (!g.s.mem.flags[`fish:${c.name}`]) {
      g.s.mem.flags[`fish:${c.name}`] = true;
      g.note(`Caught my first ${c.name.toLowerCase()} (${c.weight} kg), ${BIOMES[this.rpg.place.biome].name.toLowerCase()}.`);
    }
  }

  /**
   * Down: you come to at the nearest clinic you know (or the nearest town),
   * patched up, lighter in the wallet.
   */
  onDeath(): { x: number; y: number; z: number; yaw: number; lines: string[] } {
    const g = this.game;
    const p = this.host.player.pos;
    const near = this.rpg.gen.settlementsNear(p.x, p.z, 2).filter((s) => s.kind === 'city' || s.kind === 'town').sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    for (const s of near) {
      const clinic = this.rpg.streamer.towns.plan(s).pois.find((x) => x.kind === 'clinic');
      if (!clinic) continue;
      const lost = g ? Math.min(80, Math.round(g.c.money * 0.2)) : 0;
      if (g) {
        g.c.money -= lost;
        g.c.health = maxHealth(g.c) * 0.5;
        g.c.warmth = Math.max(g.c.warmth, 60);
        g.note(`Woke up at ${clinic.name}, ${s.name}. $${lost} lighter.`);
      }
      return { x: clinic.x + Math.sin(clinic.yaw) * 2, y: this.rpg.gen.height(clinic.x, clinic.z) + 0.3, z: clinic.z + Math.cos(clinic.yaw) * 2, yaw: clinic.yaw, lines: [`You came to at ${clinic.name}, ${s.name}.`, lost ? `Somebody’s bill came to $${lost}.` : 'Nobody asked for anything.'] };
    }
    const sp = this.host.spawn;
    return { x: sp.x, y: 0.15, z: sp.z, yaw: sp.yaw, lines: ['You came to on River Road. You don’t remember the way back.'] };
  }

  /* ── every frame ──────────────────────────────────────── */

  update(dt: number, live: boolean) {
    // the figure being made in the mirror
    if (this.heroWant) {
      this.heroT -= dt;
      if (this.heroT <= 0) {
        this.rpg.setHero(this.heroWant);
        this.heroWant = null;
      }
    }
    const g = this.game;
    if (!g) {
      this.rpg.hud.setGoal(null);
      return;
    }
    g.s.playtime += dt;
    const a = this.rpg.atmos;
    const clock = a.day * 1440 + a.minutes;
    if (this.lastClock < 0) this.lastClock = clock;
    const dm = clock - this.lastClock;
    this.lastClock = clock;
    const pl = this.host.player;
    if (this.fire && !this.fire.update(dt, Math.max(0, dm))) this.putOut();
    if (dm > 0 && dm < 24 * 60) {
      const n = a.now;
      const inCar = this.host.inVehicle();
      const byFire = !!this.fire && this.fire.group.position.distanceTo(pl.pos) < 4;
      g.tick(dm, { temp: n.temp + (byFire ? 18 : 0), rain: n.rain, wind: n.wind, sheltered: inCar, exertion: inCar ? 0 : Math.min(1, pl.speed / 6), night: a.daylight < 0.3 });
      if (inCar) g.s.stats.driven += dm; // minutes at the wheel
    }
    if (live) {
      // arriving somewhere (a place remembers you; the story notices)
      const s = this.rpg.place.settlement;
      const key = s?.id ?? '';
      if (key !== this.visitedKey) {
        this.visitedKey = key;
        if (s && !s.home && s.kind !== 'junction') {
          if (g.visit({ id: s.id, name: s.name, x: s.x, z: s.z, kind: s.kind, biome: s.biome })) this.autosave();
        } else if (s?.home) g.visit({ id: s.id, name: s.name, x: s.x, z: s.z, kind: s.kind, biome: s.biome });
        const main = g.s.quests.find((q) => q.id === MAIN_ID && q.state === 'active');
        if (main && Number(main.data.stage) === 0 && s && s.id === mainPlaces(this.world).first.id) {
          g.xp(50, 'the first town');
          advanceMain(this.world, g, main, 1);
          this.autosave();
        }
      }
      this.autoT -= dt;
      if (this.autoT <= 0) this.autosave();
    }
    this.rpg.hud.condition(g.statusLine());
    this.goal(pl.pos);
  }

  /** Point the compass at whatever the tracked job wants next. */
  private goal(p: THREE.Vector3) {
    const g = this.game!;
    const q = g.s.quests.find((x) => x.id === g.s.track && x.state === 'active');
    const o = q && current(q);
    if (!q || !o) {
      this.rpg.hud.setGoal(null);
      return;
    }
    let x = o.at?.x ?? p.x, z = o.at?.z ?? p.z;
    if (o.who) {
      const w = this.rpg.populace.find(o.who);
      if (w) (x = w.pos.x), (z = w.pos.z);
    }
    const dist = Math.hypot(x - p.x, z - p.z);
    this.rpg.hud.setGoal({ dx: x - p.x, dz: z - p.z, title: q.title, text: o.text, dist });
  }
}
