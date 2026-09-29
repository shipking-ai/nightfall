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

/**
 * A life in the wider world: the character, their things and their jobs
 * (the Game), the screens that show it (a conversation, the Casefile, a
 * shop counter, the mirror at the start), the saves, and the moments where
 * the world and the rules meet — talking to someone, going through a door,
 * searching a place, sleeping, taking a train.
 */

export type Panel = 'talk' | 'casefile' | 'shop' | 'creator';

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
      toast: (t) => rpg.hud.toast(t),
    });
    this.shop = new Shop(host.ui);
    this.shop.onClose = () => this.closePanel();
    this.creator = new Creator(host.ui);
    this.creator.onChange = (spec) => this.wantHero(spec);
    this.creator.onTurn = (d) => (host.player.facing += d * 0.7);
    this.creator.onBegin = (d) => this.begin(d.name.trim() || 'Nobody', d);
  }

  /** The screens, for the menu navigator (what back and the shoulder buttons mean). */
  get panels() {
    return [this.talk.el, this.cf.el, this.shop.el, this.creator.el];
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
    if (dm > 0 && dm < 24 * 60) {
      const n = a.now;
      const inCar = this.host.inVehicle();
      g.tick(dm, { temp: n.temp, rain: n.rain, wind: n.wind, sheltered: inCar, exertion: inCar ? 0 : Math.min(1, pl.speed / 6), night: a.daylight < 0.3 });
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
