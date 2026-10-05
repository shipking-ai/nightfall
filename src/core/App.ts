import * as THREE from 'three';
import { Settings, budget, distanceBudget, populationShare, type Quality } from './Settings';
import { detect, type Capability } from '../render/Capability';
import { Governor, TUNING } from '../render/Governor';
import { SPECS } from '../vehicles/specs';
import { SaveState } from './SaveState';
import { Cloud } from './Cloud';
import { Input } from './Input';
import { Renderer } from '../render/Renderer';
import { buildCity } from '../world/City';
import type { WorldContext } from '../world/WorldContext';
import { worldUniforms } from '../world/materials';
import { SPAWN } from '../world/layout';
import { Sky } from '../env/Sky';
import { createWaterMaterial } from '../env/Water';
import { Lighting } from '../env/Lighting';
import { Weather } from '../env/Weather';
import { TimeOfDay } from '../env/TimeOfDay';
import { LightFX } from '../fx/LightFX';
import { Crowd } from '../entities/Crowd';
import { Traffic, type Car as TrafficCar } from '../entities/Traffic';
import { Vehicles, exitBeside, type DrivableCar } from '../entities/Vehicles';
import { wrap } from '../entities/Player';
import { Cinematics, subject, type Shot } from '../cine/Cinematics';
import { CineUi } from '../cine/CineUi';
import { bloody } from '../vehicles/model';
import { Player } from '../entities/Player';
import { FollowCamera } from '../camera/FollowCamera';
import { CinematicCamera, SHOTS } from '../camera/CinematicCamera';
import { AudioEngine } from '../audio/AudioEngine';
import { Radio } from '../audio/Radio';
import { Interaction } from '../systems/Interaction';
import { Discovery } from '../systems/Discovery';
import { Photographer } from '../systems/Photographer';
import { Intermission } from '../ui/Intermission';
import { Landing } from '../ui/Landing';
import { Hud } from '../ui/Hud';
import { PauseMenu } from '../ui/PauseMenu';
import { MapView } from '../ui/MapView';
import { ArchiveView } from '../ui/ArchiveView';
import { SettingsView } from '../ui/SettingsView';
import { CarScreen } from '../ui/CarScreen';
import { WardrobeView } from '../ui/WardrobeView';
import { interiorAt, interiorById, STAIRWELL, type InteriorDef } from '../world/builders/interiors';
import { itex } from '../world/interiorTextures';
import { barkLine } from '../data/barks';
import { Quests, type QuestEvent } from '../systems/Quests';
import { QuestMarker } from '../fx/QuestMarker';
import { Combat, WEAPONS } from '../systems/Combat';
import { ESCAPE_R, VAULT, fmtMoney, newRob, robAlarmStage, robHeat, robWanted, stepRob } from '../systems/Robbery';
import { POWERS, POWER_ORDER, corruption, cycle, grant, militaryGrade, newPowers, spend, tickPowers, type PowerId } from '../systems/Powers';
import { Tracers } from '../fx/Tracers';
import { Blood } from '../fx/Blood';
import { AdminPanel } from '../ui/AdminPanel';
import { Chat } from '../ui/Chat';
import { VoiceChat } from '../net/VoiceChat';
import { Outskirts } from '../world/Outskirts';
import { TouchControls, isTouch } from '../ui/TouchControls';
import { Boats, WATER_Y, QUAY_Z, RIVER_Z0, type Boat } from '../entities/Boats';
import { Police } from '../entities/Police';
import { DISTRICTS } from '../world/layout';
import { INTERIORS, HOMES, SEARCHES } from '../world/builders/interiors';
import { INTERACTIONS } from '../data/interactions';
import type { Npc } from '../entities/Crowd';
import { cleanLook, type Look } from '../entities/Look';
import { Multiplayer, type PeerState } from '../net/Multiplayer';
import { Remotes } from '../entities/Remotes';
import { Account } from '../net/Account';
import { h, wait } from '../ui/dom';
import { ENTRIES } from '../data/archive';
import { Nav } from '../ui/Nav';
import { JoinView, roomCode } from '../ui/JoinView';
import { EmoteWheel } from '../ui/EmoteWheel';
import { PhotoMode } from '../ui/PhotoMode';
import { savePhoto, listPhotos, deletePhoto, type Photo } from '../core/photos';
import { WIRE_EMOTES } from '../data/emotes';
import { SEATS } from '../world/builders/props';
import { ModeSelect } from '../ui/ModeSelect';
import { bindGlyphs, refreshGlyphs } from '../input/glyphs';
import type { Action } from '../input/actions';
import { MODES, type ModeId, type ModeRules } from '../modes/rules';
import type { ControlContext } from '../ui/Hud';
import { Fight, ARENA } from '../modes/Fight';
import { Warzone } from '../modes/Warzone';
import { charFill } from '../entities/FigureBatch';
import { Rpg, inD03 } from '../rpg/Rpg';

type State = 'boot' | 'landing' | 'entering' | 'playing' | 'overlay' | 'leaving';
interface NoteRow {
  id: string;
  x: number;
  y: number;
  z: number;
  title: string;
  body: string;
}

type Overlay = 'pause' | 'map' | 'archive' | 'settings' | 'wardrobe' | 'rpg' | null;

/**
 * NIGHTFALL — the application. Owns the loop and the state machine:
 * boot → landing (title sequence) → entering (transition) → playing ⇄ overlays.
 */
export class App {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 2500);
  private settings = new Settings();
  /** what this machine is capable of, measured once at startup */
  private capability!: Capability;
  /** the tier actually in use right now (may differ from the setting under 'auto') */
  private quality!: Quality;
  /** moves the tier while you play, so quality tracks the machine */
  private governor!: Governor;
  private save = new SaveState();
  private cloud = new Cloud();
  private renderer: Renderer;
  private input: Input;
  private audio = new AudioEngine();

  private world!: WorldContext;
  private sky!: Sky;
  private lighting!: Lighting;
  private fx!: LightFX;
  private weather!: Weather;
  private time!: TimeOfDay;
  private crowd!: Crowd;
  private traffic!: Traffic;
  private vehicles!: Vehicles;
  /** what the player is sitting in, if anything */
  private vehicle: { kind: 'drive'; car: DrivableCar } | { kind: 'ride'; car: TrafficCar } | null = null;
  private driveVoice: { setPosition(p: THREE.Vector3, speed: number): void; mute(): void } | undefined;
  /** the engine of the car you're driving (made from its specs) */
  private engineVoice: ReturnType<AudioEngine['engineVoice']>;
  private horn: { on(p?: THREE.Vector3): void; off(): void } | undefined;
  private trafficHorns: { on(p?: THREE.Vector3): void; off(): void }[] = [];
  private honking = false;
  private radio = new Radio();
  /** the car the radio set lives in (it keeps playing there when you get out) */
  private radioHost: { car: DrivableCar | TrafficCar | null; pos: () => THREE.Vector3 } | null = null;
  /** After Hours on foot: the radio in your ears instead of a car's */
  private get headphones() {
    return !!this.radioHost && !this.radioHost.car;
  }
  private player = new Player();
  private follow: FollowCamera;
  private cine: CinematicCamera;
  private interaction!: Interaction;
  private discovery: Discovery;
  private photographer!: Photographer;

  private ui = document.getElementById('ui')!;
  private blackout = h('div', { class: 'blackout', 'aria-hidden': 'true' });
  private boxTop = h('div', { class: 'letterbox letterbox--top', 'aria-hidden': 'true' });
  private boxBottom = h('div', { class: 'letterbox letterbox--bottom', 'aria-hidden': 'true' });
  private intermission: Intermission;
  private landing: Landing;
  private hud: Hud;
  private pause: PauseMenu;
  private map!: MapView;
  private archive: ArchiveView;
  private settingsView: SettingsView;
  private carScreen: CarScreen;
  private wardrobe: WardrobeView;
  /** what you're wearing (saved locally in nightfall.me.v1, on the account, and shown to others) */
  private look: Look;
  /** the Wardrobe opened from the title: the figure is borrowed for a preview */
  private previewing = false;
  /** a soft light by the camera during a fitting (always in the scene, so the shader light count never changes) */
  private fitLight = new THREE.PointLight(0xffeedd, 0, 7, 2);
  /** the place you're inside, if any (world/builders/interiors.ts) */
  private inside: InteriorDef | null = null;
  private doorBusy = false;
  private stairLoops = 0;
  private quests!: Quests;
  private questMarker = new QuestMarker();
  /** a quest event raised by pressing E: interact() shows its lines itself */
  private questFromUse = false;
  private questHudT = 0;
  // combat
  private combat = new Combat();
  private tracers = new Tracers();
  private blood = new Blood();
  /** a knife or a blade in hand (a cut, not a blow) */
  private bladeInHand() {
    return this.rpg.active && /knife|machete|axe|blade/i.test(this.rpg.life.weapon().name);
  }
  private dying = false;
  /** seconds left inside (0: the gate is open) */
  private sentence = 0;
  /** how long a cop has had hold of you */
  private bustT = 0;
  /** smoothed frame time, for the admin stats */
  private fpsDt = 1 / 60;
  // admin
  private admin!: AdminPanel;
  private chat!: Chat;
  private voice!: VoiceChat;
  private outskirts!: Outskirts;
  private touch: TouchControls | null = null;
  private boats!: Boats;
  private police!: Police;
  /** the boat you're at the wheel of */
  private boat: Boat | null = null;
  private boatSteer = 0;
  private muted = new Set<string>();
  private blackoutT = 0;
  private notes: { id: string; title: string; pos: THREE.Vector3; mesh: THREE.Object3D }[] = [];
  private mp = new Multiplayer();
  private account = new Account();
  private accountSaveT = 0;
  private remotes!: Remotes;
  private myState: PeerState = { x: 0, y: 0, z: 0, yaw: 0, speed: 0, mode: 'walk' };

  private nav: Nav;
  private modeSelect: ModeSelect;
  /** the way of playing chosen on the title screen (one world, different rules) */
  private mode: ModeId = 'city';
  private get rules(): ModeRules {
    return MODES[this.mode];
  }
  private controlCtx: ControlContext | null = null;
  /** FIGHT's match: the arena, the rounds, the camera (modes/Fight.ts) */
  private fight!: Fight;
  /** WARZONE's match: bots, points, guns (modes/Warzone.ts) */
  private warzone!: Warzone;
  /** RPG: the wider world past District 03 (rpg/Rpg.ts) */
  private rpg!: Rpg;
  /** photo mode: a free camera and a shutter (After Hours, City) */
  private photo!: PhotoMode;
  /** your own photographs (IndexedDB), kept in step for the Archive */
  private myPhotos: Photo[] = [];
  /** the title screen's Join a friend (a room code) */
  private joinView!: JoinView;
  private get photoOn() {
    return !!this.photo?.active;
  }
  private wheel!: EmoteWheel;
  /** the emote we're showing the others (index + 1) and a toggle per start */
  private emoteNo = 0;
  private emoteSeq = 0;
  /** getting into or out of a vehicle: a short animation at the door first */
  private boarding: { t: number; go: () => void; tick?: (dt: number) => void } | null = null;
  /** in-engine scenes (cine/Cinematics.ts): the camera takes over from play and hands it back */
  scenes!: Cinematics;
  private sceneUi!: CineUi;
  private skipHeld = 0;
  /** a scene is playing (not handing back): play input waits */
  get sceneBusy() {
    return !!this.scenes?.active && !this.scenes.handingBack;
  }
  /** a car door to swing shut in a moment (after getting in or out) */
  private doorClose: { car: DrivableCar; t: number } | null = null;
  private controlSeen = new Map<ControlContext, number>();
  /** RPG: the gun in your pocket, not in your hand */
  private rpgHolstered = true;

  /** dev: a fixed camera (character reviews) */
  debugCam: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  /** dev: extra per-frame work (a line-up of people) */
  debugTick: ((dt: number, t: number) => void) | null = null;
  /** dev: simulate without drawing (fast playtests) */
  private noRender = false;
  private simNow = 0;

  /**
   * Dev playtests: stop the real-time loop and step the game in fixed frames
   * (drawing only the last), so a test runs on game time however slow the
   * machine drawing it is. `realtime()` hands back to the browser's loop.
   */
  devStep(frames: number, ms = 1000 / 30) {
    this.renderer.renderer.setAnimationLoop(null);
    if (!this.simNow) this.simNow = performance.now();
    for (let i = 0; i < frames; i++) {
      this.simNow += ms;
      this.noRender = i < frames - 1;
      this.frame(this.simNow);
    }
    this.noRender = false;
  }

  realtime() {
    this.simNow = 0;
    this.renderer.renderer.setAnimationLoop((now) => this.frame(now));
  }

  private state: State = 'boot';
  private overlay: Overlay = null;
  private overlayReturn: 'pause' | 'landing' | 'playing' = 'playing';
  private clock = new THREE.Timer();
  private t = 0;
  private cutting = false;
  private intentionalUnlock = false;
  private pausedAt = 0;
  private saveTimer = 0;
  private introT = 1;
  private sayingUntil = 0;
  private soundWanted = true;
  private phone = { ringing: false, until: 0, cooldown: 20, answered: false };
  private obstacles: { x: number; z: number; r: number }[] = [];
  /** everyone in the street a car could hit, rebuilt each frame for Vehicles */
  private peopleOnFoot: { pos: THREE.Vector3; dead: number; visible: boolean; hurt: (dmg: number, from: THREE.Vector3, force: boolean) => boolean; knockDown: (x: number, z: number) => void; toss: (vx: number, vz: number) => void }[] = [];
  private tmpV = new THREE.Vector3();
  private shelterT = 0;
  /** staff: every car you get into has an endless boost */
  private infiniteBoost = false;
  /** the bank vault (systems/Robbery.ts) */
  private rob = newRob();
  private lastRobLine: string | null = null;
  /** what the city did to you (systems/Powers.ts) */
  private powers = newPowers();
  /** staff: the clock stands still, the frame rate does not */
  private frozen = false;
  private lastGrade: string | null = null;
  /** seconds of Still left: while it runs nothing in the city moves but you */
  private held = 0;
  /** multiplayer city: when the host's last snapshot arrived, and when we (as host) next send one */
  private lastCity = 0;
  private cityT = 0;

  constructor() {
    const stage = document.getElementById('stage')!;
    this.renderer = new Renderer(stage, this.scene, this.camera);
    this.input = new Input(this.renderer.canvas);
    bindGlyphs(this.input);
    this.nav = new Nav(this.ui, this.input);
    this.nav.tick = () => this.audio.uiTick();
    this.nav.fallbackBack = () => {
      if (this.modeSelect.isOpen) this.closeModes();
      else if (this.overlay) this.back();
    };
    this.follow = new FollowCamera(this.camera);
    this.cine = new CinematicCamera(this.camera);
    this.scenes = new Cinematics(this.camera);
    this.scenes.occlude = (from, dir, max) => this.world.collision.raycast(from, dir, max);
    this.discovery = new Discovery(this.save);

    this.ui.append(this.boxTop, this.boxBottom);
    this.intermission = new Intermission(this.ui);
    this.landing = new Landing(this.ui, {
      enter: () => this.openModes(),
      explore: () => this.openOverlay('map', 'landing'),
      archive: () => this.openOverlay('archive', 'landing'),
      settings: () => this.openOverlay('settings', 'landing'),
      wardrobe: () => this.openOverlay('wardrobe', 'landing'),
      join: this.mp.enabled ? () => this.joinView.open() : undefined,
      toggleSound: () => this.toggleSound(),
    });
    this.joinView = new JoinView(this.ui, () => {
      this.joinView.close();
      this.audio.uiTick();
    });
    this.nav.scope(this.joinView.el, { back: () => this.joinView.close() });
    this.hud = new Hud(this.ui);
    this.sceneUi = new CineUi(this.ui);
    this.modeSelect = new ModeSelect(this.ui, {
      preview: (id) => this.previewMode(id),
      choose: (id) => this.chooseMode(id),
      back: () => this.closeModes(),
      tick: () => this.audio.uiTick(),
    });
    this.mode = this.settings.data.lastMode;
    this.wheel = new EmoteWheel(this.ui);
    this.photo = new PhotoMode(this.ui, document.getElementById('stage')!);
    listPhotos().then((l) => {
      this.myPhotos = l;
      this.photo.setCount(l.length);
    });
    this.pause = new PauseMenu(this.ui, {
      resume: () => this.closeOverlay(),
      map: () => this.openOverlay('map', 'pause'),
      archive: () => this.openOverlay('archive', 'pause'),
      settings: () => this.openOverlay('settings', 'pause'),
      exit: () => this.leave(),
      hover: () => this.audio.uiTick(),
      invite: this.mp.enabled ? () => this.invite() : undefined,
      wardrobe: () => this.openOverlay('wardrobe', 'pause'),
      admin: () => {
        this.closeOverlay();
        setTimeout(() => this.toggleAdmin(), 50);
      },
    });
    this.look = cleanLook(this.mp.me.look);
    this.wardrobe = new WardrobeView(this.ui, {
      change: (l) => this.player.setLook(l),
      done: (l) => {
        this.wearLook(l, true);
        this.back();
      },
      cancel: (l) => {
        this.player.setLook(l);
        this.back();
      },
      turn: (d) => (this.player.facing += d * 0.7),
      tick: () => this.audio.uiTick(),
    });
    this.archive = new ArchiveView(this.ui, () => this.back(), () => this.audio.uiTick());
    this.radio.onChange = () => this.showRadio();
    this.settingsView = new SettingsView(this.ui, this.settings, () => this.back(), () => this.erase(), {
      enabled: this.cloud.enabled,
      code: () => this.cloud.code,
      restore: async (code) => {
        const data = await this.cloud.adopt(code);
        this.save.merge(data, this.inWorld);
        this.landing.setResume(this.save.hasProgress ? this.save.data.lastPlace : null);
        return `${this.save.data.discovered.length} records restored`;
      },
    }, this.radio, {
      enabled: this.mp.enabled,
      name: () => this.mp.me.name,
      setName: (n) => {
        this.mp.setName(n);
        if (this.account.signedIn) this.account.saveProfile({ name: n }).catch(() => {});
      },
      room: () => this.mp.room,
      others: () => [...this.mp.peers.values()].map((p) => p.name),
      invite: () => this.invite(),
      leave: () => this.mp.leave(),
    }, {
      enabled: this.account.enabled,
      state: () => ({ signedIn: this.account.signedIn, email: this.account.user?.email ?? '', name: this.account.profile?.name ?? this.mp.me.name, role: this.account.profile?.role ?? 'player' }),
      signIn: (e, p) => this.account.signIn(e, p),
      signUp: (e, p, n) => this.account.signUp(e, p, n),
      magicLink: (e) => this.account.magicLink(e),
      google: () => this.account.google(),
      signOut: () => this.account.signOut(),
    },
    // so Settings can say what the machine was judged to be, and what it is
    // actually running at right now
    () => ({ tier: this.quality, fps: this.governor.fps, gpu: this.capability.gpu }),
    );
    this.settingsView.input = this.input;
    this.account.onChange = () => this.onAccount();
    this.save.onFlush = (d) => {
      this.cloud.push(d);
      // signed in: the account keeps a copy too (debounced)
      if (this.account.signedIn) {
        clearTimeout(this.accountSaveT);
        this.accountSaveT = window.setTimeout(() => this.account.putSave(this.save.data), 5000);
      }
    };
    this.carScreen = new CarScreen(this.ui);
    this.carScreen.onOpenChange = (open) => {
      if (open) {
        // the mouse is needed for the screen; this is not a pause
        this.intentionalUnlock = true;
        this.input.unlock();
        this.hud.setHint(null);
      } else if (!this.input.locked) this.hud.setHint('Click to look around');
    };
    this.carScreen.onPlay = () => {
      this.radio.off();
      this.radioHost = null;
    };
    this.ui.append(this.blackout);

    // what back and the shoulder buttons mean in each menu
    this.nav.scope(this.pause.el, { back: () => this.closeOverlay() });
    this.nav.scope(this.archive.el, { back: () => this.back(), tab: (d) => this.archive.cycleTab(d) });
    this.nav.scope(this.settingsView.el, { back: () => this.back(), tab: (d) => this.settingsView.cycleTab(d) });
    this.nav.scope(this.wardrobe.el, { back: () => this.back() });
    this.nav.scope(this.modeSelect.el, { back: () => this.closeModes() });
    this.nav.scope(this.carScreen.el, { back: () => this.carScreen.close() });

    this.bindEvents();
  }

  /* ─────────────────────────── boot ─────────────────────────── */

  /** Signed in or out: take the account's name, merge its save, refresh open screens. */
  private async onAccount() {
    this.mp.token = await this.account.token().catch(() => null);
    const p = this.account.profile;
    if (p) {
      if (p.banned) {
        await this.account.signOut();
        this.hud.say(['This account has been suspended.']);
        return;
      }
      if (p.name && p.name !== this.mp.me.name) this.mp.setName(p.name);
      // the account's look wins; a guest look is uploaded the first time
      if (p.look && Object.keys(p.look).length) this.wearLook(cleanLook(p.look), false);
      else this.account.saveProfile({ look: this.look as unknown as Record<string, unknown> }).catch(() => {});
      const remote = await this.account.loadSave();
      if (remote) this.save.merge(remote, this.inWorld);
      this.account.putSave(this.save.data);
      this.landing.setResume(this.save.hasProgress ? this.save.data.lastPlace : null);
    }
    this.settingsView.refresh();
  }

  async boot() {
    this.account.init();
    // the cloud copy may know about discoveries made on another visit or device
    this.cloud.pull().then((remote) => {
      if (!remote) return this.cloud.push(this.save.data);
      this.save.merge(remote, this.inWorld);
      this.landing.setResume(this.save.hasProgress ? this.save.data.lastPlace : null);
    });
    this.cloud.refreshCounts();
    this.intermission.setFacts('District 03', 'Moderate', '03:17');
    await this.intermission.show();
    await Promise.race([document.fonts.ready, wait(2500)]);
    this.blackout.classList.add('is-clear');

    this.world = await buildCity((k) => this.intermission.setProgress(k * 0.85));
    this.scene.add(this.world.root);
    this.outskirts = new Outskirts(this.world.mats, this.world.collision, this.world.root);
    this.scene.add(this.outskirts.group);
    this.boats = new Boats(this.world.mats);
    this.scene.add(this.boats.group);
    this.police = new Police(this.world.mats, {
      deploy: (at) => this.crowd.deployCop(at),
      shoot: (from, hit) => this.copShot(from.clone().setY(from.y - 1.45), hit),
      playerDriving: false,
      say: (line) => this.hud.toast(line),
      wrecked: (at, mil) => {
        this.tracers.shot(at.clone().setY(at.y + 0.6), at.clone().setY(at.y + 2.4), true);
        this.audio.crash(1);
        this.crowd.shock(at.x, at.z);
        this.hud.bark(mil ? 'Armoured vehicle destroyed.' : 'Cruiser destroyed.');
      },
      downed: (at) => {
        this.tracers.shot(at, at.clone().setY(at.y + 3), true);
        this.audio.crash(1);
        this.crowd.shock(at.x, at.z);
        this.combat.crime(1);
        this.hud.bark('The helicopter is down!');
      },
    });
    this.scene.add(this.police.group);

    // atmosphere
    const fog = new THREE.FogExp2(0x0b0c0f, 0.0078);
    this.scene.fog = fog;
    this.sky = new Sky();
    this.scene.add(this.sky.mesh, this.sky.skyline);
    const water = this.world.root.getObjectByName('water') as THREE.Mesh | undefined;
    if (water) water.material = createWaterMaterial(this.sky, fog);
    this.scene.environment = this.makeEnvironment();
    this.scene.environmentIntensity = 0.85;

    // What this machine can do, and the tier we resolved 'auto' to. The
    // governor takes it from here and moves it while you play.
    this.capability = detect();
    this.quality = this.settings.data.quality === 'auto' ? this.capability.tier : this.settings.data.quality;
    this.governor = new Governor(this.quality, {
      ...TUNING,
      ceiling: this.capability.software ? 'low' : 'cinematic',
      floor: 'low',
    });

    const b = budget(this.quality);
    this.lighting = new Lighting(this.scene, this.world.lamps, b.pointLights, 2);
    this.traffic = new Traffic(this.world, 4);
    this.vehicles = new Vehicles(this.world);
    this.remotes = new Remotes(this.world, this.ui);
    this.scene.add(this.remotes.group, this.fitLight);
    this.mp.onJoin = (p) => {
      if (this.state === 'playing' || this.state === 'overlay') this.hud.say([`${p.name} has come into the district.`]);
    };
    this.mp.onLeave = (p) => {
      const taxi = this.traffic.cars.find((c) => c.taxi?.riderId === p.id);
      if (taxi && this.mp.isHost) this.traffic.alight(taxi);
      if (this.state === 'playing' || this.state === 'overlay') this.hud.say([`${p.name} is gone.`]);
    };
    this.mp.onHorn = (x, z, on) => {
      const v = this.trafficHorns[1] ?? this.trafficHorns[0];
      if (on) {
        v?.on(new THREE.Vector3(x, 0, z));
        this.crowd.hear(x, z, 30);
      } else v?.off();
    };
    // the earliest arrival keeps time for everyone
    this.mp.onClock = (m) => {
      if (Math.abs(m - this.time.minutes) > 0.5) this.time.minutes = m;
    };
    this.mp.onPark = (i, x, z, yaw) => this.vehicles.moveTo(i, x, z, yaw);
    // shared city: followers take the host's crowd and traffic
    this.mp.onCity = (snap) => {
      this.lastCity = performance.now();
      if (Array.isArray(snap.n)) this.crowd.apply(snap.n as never);
      this.traffic.apply({ c: snap.c, r: snap.r });
    };
    // the host drives the one taxi for everyone
    this.mp.onTaxi = (a, from) => {
      const car = this.traffic.cars.find((c) => c.taxi);
      const tx = car?.taxi;
      if (!car || !tx) return;
      if (a === 'board' && !tx.rider && car.path) this.traffic.board(car, from);
      else if (a === 'stop' && tx.riderId === from) this.traffic.requestStop(car);
      else if (a === 'alight' && tx.riderId === from) this.traffic.alight(car);
    };
    this.player.setLook(this.look);
    this.mp.connect();
    this.vehicles.onImpact = (s) => {
      this.audio.crash(s);
      if (s > 0.35) this.crowd.shock(this.player.pos.x, this.player.pos.z);
    };
    this.traffic.onHonk = (x, z) => this.honk(x, z);
    this.scene.add(this.vehicles.group);
    this.fx = new LightFX(this.world.lamps);
    this.scene.add(this.fx.group);
    this.weather = new Weather(b.rain, this.world.steam);
    this.scene.add(this.weather.group);
    this.time = new TimeOfDay(this.sky, fog, this.lighting, this.weather);
    this.time.minutes = this.save.data.clock;
    this.crowd = new Crowd(this.world.npcSpots, this.world.lamps);
    this.crowd.onSay = (n, k) => this.npcSay(n, k);
    // so a car can knock people over, and their bodies land on the city's boxes
    this.crowd.setCollision(this.world.collision);
    this.vehicles.people = this.peopleOnFoot;
    this.vehicles.onStrike = (car, x, z, speed, square) => {
      this.audio.crash(0.4 + 0.5 * square);
      this.crowd.shock(x, z);
      this.blood.spray(this.tmpB.set(x, 0.5, z), this.tmpDir.set(x - car.pos.x, 0.4, z - car.pos.z).normalize(), 0.8 + square);
    };
    this.scene.add(this.crowd.group, this.traffic.group, this.player.group);
    this.player.group.visible = false;
    this.fight = new Fight({
      audio: this.audio,
      input: this.input,
      traffic: this.traffic,
      collision: this.world.collision,
      ui: this.ui,
      onModes: () => this.fightToModes(),
      onLeave: () => this.leave(),
    });
    this.fight.light = this.fitLight;
    this.scene.add(this.fight.group);
    this.nav.scope(this.fight.hud.end, { back: () => undefined });
    this.warzone = new Warzone({
      audio: this.audio,
      input: this.input,
      collision: this.world.collision,
      ui: this.ui,
      camera: this.camera,
      follow: this.follow,
      player: this.player,
      tracers: this.tracers,
      blood: this.blood,
      aimAssist: () => this.settings.data.aimAssist,
      hurtFlash: (k) => this.warzone.hud.hurt(k),
      onModes: () => this.fightToModes(),
      scene: (s) => this.scenes.play(s),
      cutscene: () => this.sceneBusy,
      onLeave: () => this.leave(),
    });
    this.scene.add(this.warzone.group);
    this.nav.scope(this.warzone.hud.end, { back: () => undefined });
    this.nav.scope(this.warzone.menu.el, { back: () => (this.warzone.menu.tab !== 'play' ? this.warzone.menu.cycleTab(-1) : undefined), tab: (d) => this.warzone.menu.cycleTab(d) });
    this.rpg = new Rpg({
      scene: this.scene,
      camera: this.camera,
      collision: this.world.collision,
      mats: this.world.mats,
      sky: this.sky,
      fog,
      lighting: this.lighting,
      weather: this.weather,
      player: this.player,
      follow: this.follow,
      outskirts: this.outskirts,
      cityRoot: this.world.root,
      ui: this.ui,
      environment: (zenith, horizon, ground) => this.makeEnvironment({ zenith, horizon, ground }),
      warm: async (obj) => {
        // for the target the scene is really drawn into (the composer's HDR buffer), as the warm-up does
        const r = this.renderer.renderer;
        const prev = r.getRenderTarget();
        r.setRenderTarget(this.renderer.composer.renderTarget1);
        const done = r.compileAsync(obj, this.camera, this.scene);
        r.setRenderTarget(prev);
        await done;
      },
      envFromEquirect: (tex) => {
        const pmrem = new THREE.PMREMGenerator(this.renderer.renderer);
        const rt = pmrem.fromEquirectangular(tex);
        pmrem.dispose();
        return rt.texture;
      },
      thunder: (delay, k) => setTimeout(() => this.audio.thunder(k), delay * 1000),
      vehicles: this.vehicles,
      say: (lines, who) => {
        this.hud.say(lines, who);
        this.sayingUntil = performance.now() + 1800;
      },
      panel: (open, from = 'playing') => {
        if (open) {
          if (this.overlay !== 'rpg') this.openOverlay('rpg', from);
        } else if (this.overlay === 'rpg') this.closeOverlay();
      },
      curtain: (on) => this.fade(on, on ? 500 : 700),
      inVehicle: () => !!this.vehicle || !!this.boat,
      rumble: (k) => this.input.rumble('bump', k),
      enterCar: (car) => this.enterVehicle({ kind: 'drive', car }),
      talkScene: (who, cut) => this.talkScene(who, cut),
      storyBeat: (caption) => this.storyBeat(caption),
      hurt: (dmg, by) => {
        if (this.dying || this.combat.god) return;
        this.hud.hurt(Math.min(0.6, dmg / 30));
        this.input.rumble('bump', Math.min(1, dmg / 20));
        this.blood.spray(this.tmpB.set(this.player.pos.x, this.player.pos.y + 1, this.player.pos.z), this.tmpDir.set(Math.random() - 0.5, 0.4, Math.random() - 0.5).normalize(), 0.5, 'bite');
        if (this.combat.hurt(dmg)) this.die(by);
      },
      spawn: SPAWN,
    });
    for (const el of this.rpg.life.panels) this.nav.scope(el, { back: () => this.back(), tab: (d) => this.rpg.life.panel === 'casefile' && this.rpg.life.cf.flip(d), pad: (dt) => this.rpg.life.mapInput(dt, this.input) });
    this.interaction = new Interaction(this.world.interact);
    this.quests = new Quests(this.save, new Map(this.world.interact.map((s) => [s.id, s.pos])));
    this.quests.onEvent = (e) => this.onQuest(e);
    this.scene.add(this.questMarker.group);
    this.scene.add(this.tracers.group, this.blood.group);
    // blood lands on whatever ground is here, and on the walls behind a wound
    this.blood.ground = (x, z, y) => this.world.collision.groundAt(x, z, y, 1.2, 0.02);
    this.blood.wall = (o, d, max) => this.world.collision.raycast(o, d, max);
    this.crowd.onCopShot = (from, hit) => this.copShot(from, hit);
    this.crowd.spawnAt = (out) => this.policeSpawn(out);
    this.crowd.onCrookShot = (from, hit) => this.copShot(from, hit, 'Someone on the street');
    this.initAdmin();
    this.chat = new Chat(this.ui, {
      send: (text) => {
        const sent = this.mp.chat(text);
        this.chat.add(this.mp.me.name, text, true);
        if (!sent) this.chat.add(null, 'Nobody else is here. Invite someone from the pause menu.');
        return true;
      },
      opened: () => {
        this.intentionalUnlock = true;
        this.input.unlock();
      },
      closed: () => {
        if (this.state === 'playing') this.input.lock();
      },
    });
    if (isTouch()) {
      this.input.touch = true;
      this.touch = new TouchControls(this.ui, this.input, { staff: () => this.staff });
    }
    this.voice = new VoiceChat(this.mp, () => (this.audio.ctx && this.audio.output ? { ctx: this.audio.ctx, out: this.audio.output } : null));
    this.mp.onChat = (from, name, text) => {
      if (!this.muted.has(from)) this.chat.add(name, text);
    };
    this.loadNotes();
    this.map = new MapView(this.ui, () => this.back(), this.world.interact);
    this.ui.insertBefore(this.map.el, this.blackout);
    this.nav.scope(this.map.el, { back: () => this.back(), tab: () => this.openOverlay('archive', this.overlayReturn) });
    this.photographer = new Photographer(
      this.renderer.renderer,
      this.scene,
      (p) => {
        this.lighting.focusNow(p);
        this.weather.update(p);
        // Rain streaks read as heavy noise in the small plate exposures —
        // hide the whole weather group (rain / splashes / steam) for the shot.
        this.weather.group.visible = false;
      },
      () => {
        this.weather.group.visible = true;
        this.lighting.focusNow(this.camera.position);
      },
    );

    this.time.on('loop', () => {
      this.audio.sag();
      if (this.state === 'playing' || this.state === 'overlay') this.discovery.unlock('the-loop');
    });
    this.discovery.on('found', (e) => {
      this.cloud.sight(e.id);
      this.hud.discovery(e);
      this.audio.bell();
      if (e.plate && !this.photographer.has(e.plate)) setTimeout(() => this.photographer.capture(e.plate!, this.time.label), 400);
    });
    this.discovery.on('district', (d) => {
      if (d && this.state === 'playing') this.hud.location(d.name, d.code);
    });
    let leftFoot = false;
    this.player.onStep = (k) => {
      this.audio.footstep(k);
      // step in blood and the next few prints show it
      leftFoot = !leftFoot;
      this.blood.step('me', this.player.pos.x, this.player.pos.y, this.player.pos.z, this.player.facing, leftFoot);
    };
    this.player.onLand = (v) => this.audio.land(v);

    this.applySettings();
    this.settings.on('change', () => this.applySettings());
    this.input.on('device', () => this.applyInterface());

    // warm up: compile every program, position the title camera
    this.cine.update(0, 0);
    this.lighting.focusNow(this.camera.position);
    this.intermission.setProgress(0.92);
    await wait(30);
    this.renderer.renderer.compile(this.scene, this.camera);
    this.renderer.render(0);
    this.intermission.setProgress(1);
    await wait(700);

    this.renderer.renderer.setAnimationLoop((now) => this.frame(now));
    this.toLanding(true);
  }

  /** The reflections' world: District 03's night (a sodium glow low down), or the RPG's sky of the moment. */
  private makeEnvironment(sky?: { zenith: THREE.Color; horizon: THREE.Color; ground: THREE.Color }) {
    const envScene = new THREE.Scene();
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        uZ: { value: sky?.zenith ?? new THREE.Color(0.03, 0.038, 0.06) },
        uH: { value: sky?.horizon ?? new THREE.Color(0.13, 0.09, 0.06) },
        uG: { value: sky?.ground ?? new THREE.Color(0.045, 0.04, 0.036) },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uZ; uniform vec3 uH; uniform vec3 uG; varying vec3 vP; void main(){ vec3 d = normalize(vP); float h = d.y;
        vec3 c = mix(uH, uZ, smoothstep(-0.05, 0.5, h));
        c = mix(c, uG, step(h, -0.05));
        gl_FragColor = vec4(c, 1.0); }`,
    });
    const ball = new THREE.SphereGeometry(10, 32, 16);
    envScene.add(new THREE.Mesh(ball, m));
    const pmrem = new THREE.PMREMGenerator(this.renderer.renderer);
    const rt = pmrem.fromScene(envScene, 0.02);
    pmrem.dispose();
    ball.dispose(); // (the RPG makes a new one as the sky changes: the scratch sky mustn't pile up)
    m.dispose();
    return rt.texture;
  }

  /* ─────────────────────────── settings ─────────────────────── */

  private applySettings() {
    const d = this.settings.data;
    // If the player picked 'auto', follow the governor's tier, not the setting.
    if (d.quality === 'auto') this.quality = this.governor.tier;
    else {
      this.quality = d.quality;
      this.governor.tier = d.quality;
    }
    const b = budget(this.quality);
    this.renderer.configure({ pixelRatio: b.pixelRatio, msaa: b.msaa, postfx: d.postfx, ao: b.ao, shafts: b.shafts });
    this.lighting.setShadows(d.shadows, b.shadowSize);
    this.lighting.setPoolLimit(b.pointLights);
    this.weather.setDensity(b.rain);
    this.fx.setAtmosphere(d.atmosphere);
    this.weather.setAtmosphere(d.atmosphere);
    this.camera.fov = d.fov;
    this.camera.updateProjectionMatrix();
    this.follow.sensitivity = d.sensitivity;
    this.follow.invertY = d.invertY;
    this.follow.reducedMotion = d.reducedMotion;
    this.cine.reducedMotion = d.reducedMotion;
    this.scenes.reducedMotion = d.reducedMotion;
    this.audio.setVolumes(d.master, d.ambience, d.music);
    this.radio.setVolume(d.radio);
    // controller
    const inp = this.input;
    inp.shape.deadzone = d.padDeadzone;
    inp.shape.curve = d.padCurve;
    inp.zoomSens = d.zoomSens;
    Object.assign(inp.look, { sensX: d.padSensX, sensY: d.padSensY, aimSens: d.padAimSens, accel: d.padAccel, invertX: d.padInvertX, invertY: d.padInvertY, southpaw: d.southpaw });
    inp.modes.sprint = d.sprintMode;
    inp.modes.aim = d.aimMode;
    inp.modes.crouch = d.crouchMode;
    inp.haptics.enabled = d.vibration;
    inp.haptics.strength = d.vibrationStrength;
    inp.haptics.triggers = d.triggerEffects;
    this.applyInterface();
    // how much of the city is alive, and how far you can see it
    const pop = populationShare(d.population);
    this.crowd?.setDensity(pop.people);
    this.traffic?.setDensity(pop.traffic);
    const dist = distanceBudget(d.drawDistance);
    this.camera.far = this.rpg?.active ? Math.max(dist.far, 6000) : dist.far;
    this.camera.updateProjectionMatrix();
    this.crowd?.setLod(dist.lodNear, dist.lodMid);
  }

  /** Television-sized interface when a controller is in use (or always, if asked). */
  private applyInterface() {
    const d = this.settings.data;
    const tv = d.uiSize === 'large' || (d.uiSize === 'auto' && this.input.isPad);
    document.body.classList.toggle('ui-tv', tv);
    const b = document.body.classList;
    if (d.prompts !== 'auto') {
      b.toggle('input-pad', d.prompts !== 'keyboard');
      b.toggle('pad-playstation', d.prompts === 'playstation');
      b.toggle('pad-xbox', d.prompts === 'xbox');
    }
    refreshGlyphs();
  }

  private async toggleSound() {
    if (this.audio.enabled) {
      this.audio.suspend();
      this.soundWanted = false;
    } else {
      this.soundWanted = true;
      await this.audio.start(this.world?.sounds ?? []);
      this.attachCarVoices();
    }
    this.landing.setSound(this.audio.enabled);
  }

  private attachCarVoices() {
    for (const c of this.traffic.cars) if (!c.sound) c.sound = this.audio.carVoice();
    if (!this.driveVoice) this.driveVoice = this.audio.carVoice();
    if (!this.horn) this.horn = this.audio.hornVoice();
    while (this.trafficHorns.length < 2) {
      const v = this.audio.hornVoice();
      if (!v) break;
      this.trafficHorns.push(v);
    }
  }

  /* ─────────────────────────── states ───────────────────────── */

  private async toLanding(first = false) {
    this.state = 'landing';
    this.input.enabled = false;
    this.player.group.visible = false;
    this.hud.show(false);
    this.hud.setPrompt(null);
    this.cine.index = 0;
    this.cine.t = 0;
    this.cine.endPush();
    this.cine.update(0, this.t);
    this.lighting.focusNow(this.camera.position);
    this.landing.setShot(SHOTS[0].caption);
    this.landing.setResume(this.save.hasProgress ? this.save.data.lastPlace : null);
    this.landing.setSound(this.audio.enabled);
    this.audio.setLanding(true);
    this.audio.setMuffled(false);
    this.letterbox(true);
    if (first) {
      await this.fade(true, 800);
      await this.intermission.hide();
    }
    this.fade(false, 2200);
    await wait(first ? 900 : 300);
    this.landing.show();
  }

  /** One city, the chosen mode's rules: who's out, what can hurt you, what the interface shows. */
  private applyRules() {
    const r = this.rules;
    this.crowd.setEnabled(r.crowd);
    this.traffic.setEnabled(r.traffic);
    this.crowd.crimeOn = r.crime;
    this.crowd.uneaseRate = r.unease;
    this.questMarker.group.visible = r.quests;
    if (!r.police) this.combat.heat = 0;
    if (r.combat !== 'street') this.combat.select(0);
    if (!r.quests) this.hud.objective(null);
    document.body.dataset.mode = r.id;
    // After Hours' weather and clock switches don't follow you out of it
    if (r.id !== 'afterhours' && this.time) {
      this.clockHeld = false;
      this.time.rainOverride = null;
    }
    // a little more light on people where the mode is about reading bodies
    charFill.value = r.combat === 'fight' ? 0.075 : r.combat === 'warzone' ? 0.07 : 0.05;
    // and more of the sky's light where you need to see into the dark to play
    if (this.time) this.time.fillBoost = r.combat === 'warzone' ? 1.9 : r.combat === 'fight' ? 1.35 : 1.12;
  }

  private async enter() {
    if (this.state !== 'landing') return;
    this.state = 'entering';
    this.applyRules();
    if (this.soundWanted && !this.audio.enabled) {
      await this.audio.start(this.world.sounds);
      this.attachCarVoices();
    }
    this.input.lock();
    this.audio.setLanding(false);
    this.cine.lock = null;
    this.cine.beginPush();
    if (this.landing.el.classList.contains('is-on')) await this.landing.leave();
    await wait(500);
    await this.fade(true, 700);

    // intermission card, set in the world's own terms
    const rpgMode = this.mode === 'rpg';
    this.intermission.setFacts(rpgMode ? 'Merrow' : this.save.data.lastPlace ?? 'District 03', rpgMode ? 'the night is ending' : this.time.rainLabel.toLowerCase(), rpgMode ? '05:29' : this.time.label);
    await this.intermission.show();
    this.intermission.setProgress(rpgMode ? 0 : 1);
    this.fade(false, 700);

    const p = this.save.data.player;
    const fight = this.rules.combat === 'fight';
    if (fight) {
      // FIGHT: the crossing, you in what you wear in the city
      this.player.place(ARENA.x - 1.9, 0, ARENA.z, Math.PI / 2);
      this.setInside(null);
      this.fight.start({ outfit: this.player.outfit, body: this.player.body });
    } else if (this.rules.combat === 'warzone') {
      // WARZONE: Pier 9 Yard, in fatigues; the match puts you at your spawn
      this.setInside(null);
      this.warzone.start({ outfit: this.player.outfit, body: this.player.body });
    } else if (rpgMode) {
      // RPG: the pavement on River Road, as the night runs out
      this.setInside(null);
      this.player.place(SPAWN.x, 0.15, SPAWN.z, SPAWN.yaw);
      await this.rpg.start(this.player.pos, (k) => this.intermission.setProgress(k));
      this.rpg.hud.show(false);
    } else if (p) this.player.place(p.x, p.y, p.z, p.yaw);
    else this.player.place(SPAWN.x, 0.15, SPAWN.z, SPAWN.yaw);
    if (!fight && !this.warzone.active) this.setInside(interiorAt(this.player.pos.x, this.player.pos.z));
    // behind the intermission card: compile what a match will show later (tracers, blood, pickups), so the first shot doesn't hitch
    if (fight) this.warmUp([this.fight.group]);
    else if (this.warzone.active) this.warmUp([this.warzone.group, this.tracers.group, this.blood.group]);
    else if (rpgMode) this.warmUp([this.rpg.group]);
    this.player.group.visible = !fight;
    this.cine.endPush();
    if (!this.warzone.active) this.follow.alignBehind(this.player);
    this.introT = this.warzone.active ? 1 : 0;
    this.follow.snap(this.player);
    this.lighting.focusNow(this.player.pos);
    this.letterbox(false);
    await wait(2600);

    await this.fade(true, 600);
    await this.intermission.hide();
    this.state = 'playing';
    this.input.enabled = true;
    this.discovery.reset();
    await this.fade(false, 1800);
    if (fight || this.warzone.active) return;
    this.hud.show(true);
    if (rpgMode) {
      this.rpg.hud.show(true);
      // a first life: the mirror, before anything else
      if (this.rpg.life.pendingCreator) this.rpg.life.openCreator();
    }
    if (this.inside) this.hud.location(this.inside.name, this.inside.code);
    else this.discovery.update(this.player.pos.x, this.player.pos.z);
    if (!this.save.hasProgress) {
      this.hud.showControls(true);
      setTimeout(() => this.hud.showControls(false), 9000);
    }
    if (!this.input.locked) this.hud.setHint('Click to look around');
    this.persist();
  }

  private async leave() {
    if (this.state !== 'playing' && this.state !== 'overlay') return;
    this.carScreen.show(false);
    this.leaveVehicle(true);
    this.radio.off();
    this.radioHost = null;
    this.persist();
    this.closeAllPanels();
    this.overlay = null;
    this.state = 'leaving';
    this.input.enabled = false;
    this.intentionalUnlock = true;
    this.input.unlock();
    this.hud.setHint(null);
    this.audio.setMuffled(false);
    await this.fade(true, 900);
    this.hud.show(false);
    if (this.fight.active) {
      this.fight.stop();
      this.fitLight.distance = 7;
      this.applyRulesFor('city');
    }
    if (this.warzone.active) {
      this.warzone.stop();
      this.player.setLook(this.look);
      this.applyRulesFor('city');
    }
    if (this.rpg.active) {
      this.rpg.stop();
      this.applyRulesFor('city');
      this.lighting.focusNow(this.camera.position);
    }
    await this.toLanding();
  }

  /** After Hours: the hour can be held where it is */
  private clockHeld = false;

  /** The pause menu's switches for this mode: the weather and the clock in After Hours, the microphone in a room. */
  private pauseSwitches(): { label: string; value: () => string; act: () => void }[] {
    const out: { label: string; value: () => string; act: () => void }[] = [];
    if (this.mode === 'afterhours') {
      const RAIN: [number | null, string][] = [[null, 'As it comes'], [0.05, 'Dry'], [0.3, 'Drizzle'], [0.65, 'Rain'], [1, 'Downpour']];
      out.push({
        label: 'Weather',
        value: () => RAIN.find(([v]) => v === this.time.rainOverride)?.[1] ?? 'As it comes',
        act: () => {
          const i = RAIN.findIndex(([v]) => v === this.time.rainOverride);
          this.time.rainOverride = RAIN[(i + 1) % RAIN.length][0];
        },
      });
      out.push({
        label: 'The hour',
        value: () => (this.clockHeld ? `Held at ${this.time.label}` : 'Passing'),
        act: () => (this.clockHeld = !this.clockHeld),
      });
    }
    if (this.mp.room) {
      out.push({
        label: 'Microphone',
        value: () => (this.voice.micOn ? 'On' : 'Off'),
        act: () => void this.toggleMic(),
      });
    }
    return out;
  }

  /**
   * Compile, and draw once, everything under these (hidden parts too), so a
   * match's first shot, first spray of blood or first dropped pack doesn't
   * stall the game while the driver builds its shader. Done behind the
   * intermission card.
   */
  private warmUp(objs: THREE.Object3D[]) {
    const saved: [THREE.Object3D, boolean, boolean][] = [];
    for (const o of objs)
      o.traverse((c) => {
        saved.push([c, c.visible, c.frustumCulled]);
        c.visible = true;
        c.frustumCulled = false;
      });
    const r = this.renderer.renderer;
    const prev = r.getRenderTarget();
    try {
      // into the same kind of target the scene is really drawn into (a linear HDR buffer, not the screen)
      r.setRenderTarget(this.renderer.composer.renderTarget1);
      r.compile(this.scene, this.camera);
      r.setRenderTarget(prev);
      this.renderer.render(this.t);
    } finally {
      r.setRenderTarget(prev);
      for (const [c, v, f] of saved) {
        c.visible = v;
        c.frustumCulled = f;
      }
    }
  }

  /** From the end of a match straight to the mode select. */
  private async fightToModes() {
    await this.leave();
    await this.openModes();
  }

  /** The title screen shows the ordinary city behind it, whatever you last played. */
  private applyRulesFor(id: ModeId) {
    const keep = this.mode;
    this.mode = id;
    this.applyRules();
    this.mode = keep;
  }

  /* ─────────────────────────── overlays ─────────────────────── */

  private openOverlay(o: Exclude<Overlay, null>, from: 'pause' | 'landing' | 'playing') {
    // out in the wider world, the map and the archive are the Casefile
    if ((o === 'map' || o === 'archive') && this.rpg.active && from !== 'landing') {
      if (this.rpg.life.game) this.rpg.life.openCasefile(o === 'map' ? 'map' : undefined, from === 'pause' ? 'pause' : 'playing');
      return;
    }
    this.audio.uiTick();
    if (this.state === 'playing') {
      this.intentionalUnlock = true;
      this.input.unlock();
      this.state = 'overlay';
      this.hud.setPrompt(null);
      this.hud.setHint(null);
    }
    if (from === 'landing') this.landing.hideInstant();
    this.closeAllPanels();
    this.overlay = o;
    this.overlayReturn = from;
    if (this.rpg.active) this.rpg.hud.show(o !== 'rpg' || this.rpg.life.panel === 'talk');
    this.audio.setMuffled(true);
    this.hud.show(false);
    if (o === 'pause') {
      this.pause.setAdmin(this.staff);
      this.pausedAt = performance.now();
      this.persist();
      this.pause.setMode(this.fight.active || this.warzone.active, this.pauseSwitches());
      this.pause.open({
        place: this.fight.active ? 'Harbor Lane crossing' : this.warzone.active ? 'Pier 9 Yard' : this.rpg.active ? this.rpg.place.name : this.discovery.districtName,
        time: this.rpg.active ? this.rpg.atmos.label : this.time.label,
        rain: this.rpg.active ? this.rpg.atmos.describe() : this.time.rainLabel.charAt(0) + this.time.rainLabel.slice(1).toLowerCase(),
        records: `${this.save.data.discovered.length} of ${ENTRIES.filter((e) => !e.hidden).length}`,
        together: this.mp.room ? (this.mp.peers.size ? [...this.mp.peers.values()].map((p) => p.name).join(', ') : 'Nobody else yet') : undefined,
      });
    }
    if (o === 'map') {
      const inWorld = this.state === 'overlay';
      const sp = this.save.data.player;
      const pp = inWorld ? { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.facing } : sp ? { x: sp.x, z: sp.z, yaw: sp.yaw } : null;
      this.map.open(new Set(this.save.data.discovered), pp);
    }
    if (o === 'archive') {
      // develop any plates that were never exposed (e.g. places found in an older build)
      // (one at a time, a moment apart, so the archive opening doesn't hold the frame up)
      const missing = ENTRIES.filter((e) => e.plate && this.save.has(e.id) && !this.photographer.has(e.plate));
      missing.forEach((e, i) => setTimeout(() => this.photographer.capture(e.plate!, this.time.label), 300 + i * 450));
      this.archive.open({
        found: new Set(this.save.data.discovered),
        unread: new Set(this.save.data.unread),
        plates: this.photographer.plates,
        marks: ['mark-quarter', 'mark-yard', 'mark-bridge'].filter((m) => this.save.hasFlag(m)).length,
        markRead: (id) => this.save.markRead(id),
        others: (id) => (this.cloud.counts[id] ?? 1) - 1,
        photos: this.myPhotos,
        forget: (id) =>
          deletePhoto(id).then((ok) => {
            this.myPhotos = this.myPhotos.filter((p) => p.id !== id);
            this.photo.setCount(this.myPhotos.length);
            return ok;
          }),
      });
      this.cloud.refreshCounts();
    }
    if (o === 'settings') this.settingsView.open();
    if (o === 'wardrobe') {
      // from the title there's no one out in the city yet: bring the figure out for a fitting
      if (from === 'landing' && this.world) {
        this.previewing = true;
        this.player.place(SPAWN.x, 0.15, SPAWN.z, SPAWN.yaw + Math.PI);
        this.player.group.visible = true;
        this.lighting.focusNow(this.player.pos);
      }
      this.letterbox(false);
      this.hud.setHint(null);
      this.wardrobe.open(this.look);
    }
  }

  /** Put on a look for good: you, the others, and your account all see it. */
  private wearLook(l: Look, save: boolean) {
    this.look = cleanLook(l);
    this.player.setLook(this.look);
    this.mp.setLook(this.look);
    if (save && this.account.signedIn) this.account.saveProfile({ look: this.look as unknown as Record<string, unknown> }).catch(() => {});
  }

  private closeAllPanels() {
    // (an RPG screen closes itself only when the overlay it lives in is closing, not while it's opening)
    if (this.overlay === 'rpg') this.rpg.life.closeAll();
    this.wardrobe.close();
    if (this.previewing) {
      this.previewing = false;
      this.player.group.visible = false;
    }
    this.pause.close();
    this.map.close();
    this.archive.close();
    this.settingsView.close();
  }

  /** Esc / close: step back one level. */
  private back() {
    if (!this.overlay) return;
    if (this.overlay === 'rpg' && this.rpg.life.back()) return;
    this.audio.uiTick();
    // leaving the Wardrobe without Done puts the old look back
    if (this.overlay === 'wardrobe') this.player.setLook(this.look);
    if (this.overlay !== 'pause' && this.overlayReturn === 'pause') {
      this.openOverlay('pause', 'playing');
      return;
    }
    if (this.overlayReturn === 'landing') {
      this.closeAllPanels();
      this.overlay = null;
      this.audio.setMuffled(false);
      this.letterbox(true);
      this.landing.show();
      return;
    }
    this.closeOverlay();
  }

  private closeOverlay() {
    this.closeAllPanels();
    this.overlay = null;
    if (this.rpg.active) this.rpg.hud.show(true);
    this.audio.setMuffled(false);
    if (this.state === 'overlay') {
      this.state = 'playing';
      this.hud.show(true);
      this.input.lock().then((ok) => {
        if (!ok || !this.input.locked) this.hud.setHint('Click to continue');
      });
    }
  }

  /* ─────────────────────────── events ───────────────────────── */

  private bindEvents() {
    document.addEventListener('pointerlockchange', () => {
      if (this.input.locked) {
        this.carScreen.close();
        this.hud.setHint(null);
        return;
      }
      if (this.intentionalUnlock) {
        this.intentionalUnlock = false;
        return;
      }
      if (this.state === 'playing') this.openOverlay('pause', 'playing');
    });
    this.renderer.canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !this.input.locked) this.input.lock();
    });
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
      const k = e.code;
      // keyboard globals follow the (remappable) bindings; the pad's are read per frame (padGlobals)
      const is = (a: Action) => this.input.bindings.get(a).kbm.includes(k);
      const explore = this.rules.combat === 'street' || this.rules.combat === 'none';
      if (this.modeSelect.isOpen) {
        if (k === 'Escape') this.closeModes();
        return;
      }
      if (is('chat') && this.state === 'playing' && explore && !this.chat?.isOpen && !this.carScreen.isOpen && !this.photoOn) {
        e.preventDefault();
        this.chat.open();
        return;
      }
      if (is('mic') && this.state === 'playing') {
        this.toggleMic();
        return;
      }
      if (is('admin') && (this.state === 'playing' || this.admin?.isOpen)) {
        e.preventDefault();
        this.toggleAdmin();
        return;
      }
      if (this.state === 'playing') {
        if (k === 'Escape') {
          e.preventDefault();
          this.openOverlay('pause', 'playing');
        } else if (is('map') && explore) this.openOverlay('map', 'playing');
        else if (is('archive') && explore) this.openOverlay('archive', 'playing');
        return;
      }
      if (this.overlay) {
        if (k === 'Escape') {
          if (this.overlay === 'pause' && performance.now() - this.pausedAt < 300) return;
          e.preventDefault();
          this.back();
        } else if ((is('map') && this.overlay === 'map') || (is('archive') && this.overlay === 'archive') || ((is('map') || is('archive')) && this.overlay === 'rpg' && this.rpg.life.panel === 'casefile')) {
          if (this.overlayReturn === 'playing') this.closeOverlay();
          else this.back();
        }
      }
    });
    addEventListener('visibilitychange', () => {
      if (document.hidden) this.persist(true);
    });
    addEventListener('beforeunload', () => this.persist(true));
  }

  /** A pad press of an action's pad binding (keyboard presses of the same action are the keydown handler's). */
  private padAct(a: Action): boolean {
    const pad = this.input.pad;
    if (!pad || !this.input.isPad) return false;
    return this.input.bindings.get(a).pad.some((b) => pad.pressed(b));
  }

  /** In play, on a pad: pause, map. */
  private padGlobals() {
    if (!this.input.isPad) return;
    const explore = this.rules.combat === 'street' || this.rules.combat === 'none';
    if (this.padAct('pause')) this.openOverlay('pause', 'playing');
    else if (explore && !this.vehicle && !this.boat && this.padAct('map')) this.openOverlay('map', 'playing');
  }

  /** Menus on a pad: what Menu, View and the map's stick do. The Nav does the rest. */
  private padMenus(dt: number) {
    const pad = this.input.pad;
    if (!pad || !this.input.isPad) return;
    if (this.overlay && this.overlayReturn !== 'landing' && pad.peek('Menu') && !(this.overlay === 'rpg' && this.rpg.life.panel === 'creator')) {
      pad.pressed('Menu');
      this.closeOverlay();
      return;
    }
    if (this.overlay === 'map') {
      const s = pad.stick(0, this.input.shape);
      this.map.pad(dt, s.x, s.y, pad.value('RT') - pad.value('LT'), pad.pressed('A'));
    }
  }

  /** Remember which prompts the player has seen, and show the strip for a new situation twice. */
  private updateControlContext() {
    let ctx: ControlContext;
    const v = this.vehicle;
    if (v) ctx = v.kind === 'drive' ? 'car' : 'taxi';
    else if (this.boat) ctx = 'boat';
    else if (this.player.swimming) ctx = 'swim';
    else if (this.rules.combat === 'street' && this.combat.w.id !== 'fists') ctx = 'armed';
    else ctx = this.mode === 'afterhours' ? 'afterhours' : this.rpg.active ? 'rpg' : 'foot';
    if (ctx === this.controlCtx) return;
    this.controlCtx = ctx;
    const seen = this.controlSeen.get(ctx) ?? 0;
    this.controlSeen.set(ctx, seen + 1);
    this.hud.controlsFor(ctx, seen < 2);
  }

  /** The emote wheel (hold, point, release) and photo mode. */
  private emotesAndPhotos() {
    const onFoot = !this.vehicle && !this.boat && !this.player.swimming && !this.dying && !this.boarding && !this.chat?.isOpen && !this.admin?.isOpen && !this.sceneBusy;
    if (this.rules.emotes && onFoot && !this.photoOn) {
      if (!this.wheel.isOpen && this.input.pressed('emote')) this.wheel.open();
      if (this.wheel.isOpen) {
        this.wheel.update(this.input);
        if (!this.input.held('emote')) {
          const e = this.wheel.close();
          if (e?.chat) {
            // type a message: the chat box (and on a pad, the on-screen keyboard)
            this.audio.uiTick();
            this.chat.open();
          } else if (e) {
            this.player.playEmote(e);
            this.emoteSeq++;
            this.audio.uiTick();
            if (e.say) {
              this.mp.chat(e.say);
              this.chat.add(this.mp.me.name, e.say, true);
            }
          }
        }
      }
    } else if (this.wheel.isOpen) this.wheel.close();
    this.emoteNo = this.player.emote ? WIRE_EMOTES.indexOf(this.player.emote) + 1 : 0;
    if (this.rules.photo && onFoot && !this.photoOn && !this.wheel.isOpen && this.input.pressed('photo')) this.photoMode(true);
    // powers: they are not a menu, they are a thing you happen to have
    if (this.rules.discovery && onFoot && !this.photoOn && !this.wheel.isOpen && this.powers.found.length) {
      if (this.input.pressed('powerPrev') || this.input.pressed('powerNext')) {
        const id = cycle(this.powers, this.input.pressed('powerNext') ? 1 : -1);
        this.hud.toast(`${POWERS[id].name} — ${POWERS[id].line}`);
      }
      if (this.input.pressed('powerUse')) this.usePower();
    }
    // After Hours: headphones on foot (no guns to switch, so the D-pad is free)
    if (this.mode === 'afterhours' && onFoot && !this.photoOn && !this.wheel.isOpen) {
      if (this.input.pressed('radioNext')) this.tuneRadio(1);
      else if (this.input.pressed('radioPrev')) this.tuneRadio(-1);
    }
  }

  private photoMode(on: boolean) {
    if (on) {
      this.photo.enter(this.player.pos, this.follow.yaw);
      this.hud.show(false);
      listPhotos().then((l) => this.photo.setCount(l.length));
    } else {
      this.photo.exit();
      this.camera.fov = this.settings.data.fov;
      this.camera.updateProjectionMatrix();
      if (this.state === 'playing') this.hud.show(true);
    }
  }

  /* ─────────────────────────── modes ─────────────────────────── */

  /** Enter world → how do you want to spend the night? */
  private async openModes() {
    if (this.state !== 'landing' || this.modeSelect.isOpen) return;
    this.audio.uiTick();
    await this.landing.leave();
    await this.modeSelect.open(this.mode);
  }

  private async closeModes() {
    if (!this.modeSelect.isOpen) return;
    this.previewToken++;
    await this.modeSelect.close();
    this.cine.lock = null;
    this.landing.show();
  }

  private previewToken = 0;
  /** The title camera cuts to where a mode happens: the background is the preview. */
  private async previewMode(id: ModeId) {
    const shot = MODES[id].shot;
    if (this.cine.lock === shot) return;
    const token = ++this.previewToken;
    await this.fade(true, 220);
    if (token !== this.previewToken) return;
    this.cine.hold(shot);
    this.cine.update(0, this.t);
    this.lighting.focusNow(this.camera.position);
    this.landing.setShot(this.cine.shot.caption);
    await this.fade(false, 520);
  }

  private async chooseMode(id: ModeId) {
    this.mode = id;
    this.settings.set('lastMode', id);
    this.previewToken++;
    await this.modeSelect.close();
    this.enter();
  }

  private persist(leaving = false) {
    const explore = (this.rules.combat === 'street' || this.rules.combat === 'none') && this.mode !== 'rpg';
    if (explore && (this.state === 'playing' || this.state === 'overlay' || this.state === 'leaving')) {
      this.save.data.player = { x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z, yaw: this.player.facing };
    }
    if (this.time) this.save.data.clock = this.time.minutes;
    this.save.flush();
    if (leaving) this.cloud.push(this.save.data, true);
  }

  /** the player is out in the district (so a merged save must not move them) */
  private get inWorld(): boolean {
    const st = this.state;
    return st === 'playing' || st === 'entering' || st === 'leaving' || (st === 'overlay' && this.overlayReturn !== 'landing');
  }

  private erase() {
    this.save.reset();
    this.photographer.clear();
    this.discovery.reset();
    this.landing.setResume(null);
  }

  /* ─────────────────────────── helpers ──────────────────────── */

  private async fade(toBlack: boolean, ms: number) {
    this.blackout.style.transitionDuration = `${this.settings.data.reducedMotion ? Math.min(ms, 300) : ms}ms`;
    this.blackout.classList.toggle('is-clear', !toBlack);
    await wait(this.settings.data.reducedMotion ? Math.min(ms, 300) : ms);
  }

  private letterbox(on: boolean) {
    this.boxTop.classList.toggle('is-on', on);
    this.boxBottom.classList.toggle('is-on', on);
  }

  /* ─────────────────────────── vehicles ─────────────────────── */

  /** What [E] would do right now about cars, if anything (nearest wins against inspect spots). */
  private vehicleOption(): { verb: string; name: string; go: () => void; d: number } | null {
    if (this.vehicle || this.player.sitting || !this.player.grounded || !this.rules.vehicles) return null;
    const taxi = this.traffic.waitingTaxi(this.player.pos);
    if (taxi) return { verb: 'Ride along', name: 'Taxi', d: 0, go: () => this.enterVehicle({ kind: 'ride', car: taxi }) };
    const near = this.vehicles.nearest(this.player.pos, 1.4);
    if (near) return { verb: 'Get in', name: carName(near.car), d: near.d, go: () => this.enterVehicle({ kind: 'drive', car: near.car }) };
    // somebody else's car, with somebody in it
    const live = this.traffic.nearestDrivable(this.player.pos, 2.8);
    if (live) return { verb: 'Pull them out', name: live.car.spec.name, d: live.d, go: () => this.takeLiveCar(live.car) };
    return null;
  }

  /**
   * Take a car somebody is driving. They get out on the pavement and react to
   * it; the car keeps its class, its paint and the speed it was doing, and
   * from then on it's an ordinary drivable car.
   */
  private takeLiveCar(car: import('../entities/Traffic').Car) {
    const got = this.traffic.takeOver(car);
    if (!got) return;
    // out onto the kerb, on the driver's side, facing away from the car
    const side = new THREE.Vector3(Math.cos(got.yaw), 0, -Math.sin(got.yaw));
    const out = got.pos.clone().addScaledVector(side, 1.5);
    out.y = this.world.collision.groundAt(out.x, out.z, got.pos.y + 1.2, 1, 0.9);
    this.crowd.dropBystander(out, got.yaw);
    this.crowd.shock(got.pos.x, got.pos.z);
    this.hud.bark('That is not your car.');
    // and now it is: same class and colour, real dynamics, its own lamps
    const dc = this.vehicles.spawn({ pos: got.pos, yaw: got.yaw, color: got.color, van: got.spec.cls === 'van', screen: false, kind: got.spec.cls, reach: Math.max(0.6, got.spec.shape.length / 2 - 0.95) });
    dc.v = Math.min(6, car.v);
    this.enterVehicle({ kind: 'drive', car: dc });
  }

  private enterVehicle(v: NonNullable<App['vehicle']>) {
    if (this.boarding) return;
    this.player.stopEmote(0.1);
    if (v.kind === 'drive') {
      // step to the driver's door, look at the car, open it, duck in, sit, pull it shut
      const car = v.car;
      const spot = this.vehicles.doorSpot(car, new THREE.Vector3());
      const from = this.player.pos.clone();
      const face = Math.atan2(Math.cos(car.yaw), -Math.sin(car.yaw)); // towards the car's side
      const walk = Math.min(0.6, from.distanceTo(spot) / 2.2);
      let el = 0, opened = false, ducked = false;
      const total = walk + 1.0;
      this.boarding = {
        t: total,
        go: () => this.boardNow(v),
        tick: (dt) => {
          el += dt;
          const k = Math.min(1, el / Math.max(0.01, walk));
          this.player.pos.lerpVectors(from, spot, k * k * (3 - 2 * k));
          this.player.facing += wrap(face - this.player.facing) * Math.min(1, dt * 8);
          if (!opened && el > walk * 0.7) {
            opened = true;
            this.vehicles.door(car, 0, true);
            this.audio.footstep(0.5, false);
          }
          if (!ducked && el > walk + 0.3) {
            ducked = true;
            this.player.act('act.enterCar', { hold: true });
          }
        },
      };
      return;
    }
    // a taxi's back seat: turn to it and get in
    const cp = v.car.group.position;
    this.player.facing = Math.atan2(cp.x - this.player.pos.x, cp.z - this.player.pos.z);
    this.player.act('act.enterCar', { hold: true });
    this.boarding = { t: 0.55, go: () => this.boardNow(v) };
  }

  private boardNow(v: NonNullable<App['vehicle']>) {
    this.vehicle = v;
    this.player.vel.set(0, 0, 0);
    if (v.kind === 'drive') {
      v.car.occupied = true;
      v.car.leaving = false;
      this.doorClose = { car: v.car, t: 0.45 };
    } else {
      this.traffic.board(v.car, this.mp.id);
      if (this.mp.shared && !this.mp.isHost) this.mp.taxi('board');
    }
    this.audio.footstep(0.9, false);
    this.input.rumble('bump', 0.6);
  }

  /* ─────────────────────────── scenes ─────────────────────────── */

  private talkWho: { pos: THREE.Vector3; yaw: number; height: number } | null = null;

  /**
   * A conversation, filmed: a two-shot as it starts, then over your shoulder
   * onto them while they talk (closer as it matters), a reverse onto you when
   * you answer, and back to play when it's done. No bars: it's still play.
   */
  private talkScene(who: { pos: THREE.Vector3; yaw: number; height: number } | null, cut?: 'them' | 'me' | 'close') {
    if (!who && !cut) {
      if (this.talkWho) {
        this.talkWho = null;
        this.scenes.skip();
      }
      return;
    }
    if (who) this.talkWho = who;
    const w = this.talkWho;
    if (!w) return;
    // face each other
    this.player.facing = Math.atan2(w.pos.x - this.player.pos.x, w.pos.z - this.player.pos.z);
    const them = subject(() => w.pos, () => w.yaw, 1.6 * w.height);
    const me = subject(() => this.player.pos, () => this.player.facing, 1.6 * this.player.body.height);
    const onThem: Shot = { kind: 'overShoulder', a: them, b: me, side: -1, dur: 9999 };
    const shot: Shot = cut === 'me' ? { kind: 'overShoulder', a: me, b: them, side: 1, dur: 2.2 } : cut === 'close' ? { kind: 'closeUp', a: them, side: -1, dur: 9999 } : onThem;
    if (!this.scenes.active || this.scenes.handingBack) {
      this.scenes.play({ bars: false, skippable: false, blendIn: 0.9, blendOut: 0.8, shots: [{ kind: 'twoShot', a: them, b: me, side: -1, dur: 1.5 }, shot] });
    } else this.scenes.cut(shot, cut === 'me' ? onThem : undefined);
  }

  /** The story moved: where you are, what's next, and a push in on you. */
  private storyBeat(caption: string) {
    if (this.scenes.active) return;
    const me = subject(() => this.player.pos, () => this.player.facing, 1.6 * this.player.body.height);
    this.scenes.play({
      blendIn: 1.4,
      blendOut: 1.2,
      shots: [
        { kind: 'establish', a: me, dur: 4, caption, dist: 26, height: 10 },
        { kind: 'pushIn', a: me, dur: 3, side: -1, dist: 4.5 },
      ],
      beats: [{ at: 4.2, do: () => this.player.act('idle.lookAround') }],
    });
  }

  /** Make (or reuse) a room and put its link on the clipboard. */
  private async invite(): Promise<string> {
    const url = await this.mp.invite();
    // the code is for a friend on a controller (Join a friend, on the title screen); the link for everyone else
    const code = this.mp.room ? `Code ${roomCode(this.mp.room)}` : 'Room ready';
    try {
      await navigator.clipboard.writeText(url);
      return `${code} · link copied`;
    } catch {
      return code;
    }
  }

  /* ─────────────────────────── interiors ─────────────────────── */

  /** Through a door: a short dip to black, and you're inside. */
  private async goInside(id: string) {
    const d = interiorById(id);
    if (!d || this.doorBusy || this.vehicle) return;
    this.doorBusy = true;
    this.audio.footstep(0.9, false);
    await this.fade(true, 380);
    this.player.place(d.spawn.x, d.spawn.y, d.spawn.z, d.spawn.yaw);
    this.follow.alignBehind(this.player);
    this.follow.snap(this.player, this.world.collision);
    this.lighting.focusNow(this.player.pos);
    this.setInside(d);
    this.fade(false, 520);
    this.hud.location(d.name, d.code);
    const firstTime = !this.save.hasFlag(`been:${d.id}`);
    if (firstTime) {
      this.save.flag(`been:${d.id}`);
      if (d.first) this.hud.say(d.first, d.name);
    }
    if (d.unlock) setTimeout(() => this.discovery.unlock(d.unlock!), 1600);
    this.doorBusy = false;
  }

  /** Back out onto the street, facing away from the door. */
  private async goOutside() {
    const d = this.inside;
    if (!d || this.doorBusy) return;
    if (d.id === 'jail' && this.sentence > 0) {
      this.audio.footstep(0.6, false);
      this.hud.say([`The gate is locked. ${clockText(this.sentence)} to go.`]);
      return;
    }
    this.doorBusy = true;
    this.audio.footstep(0.9, false);
    await this.fade(true, 380);
    this.player.place(d.door.x, 0.15, d.door.z, d.door.yaw);
    this.follow.alignBehind(this.player);
    this.follow.snap(this.player, this.world.collision);
    this.lighting.focusNow(this.player.pos);
    this.setInside(null);
    // back on the street: name the district again
    this.discovery.forgetDistrict();
    this.fade(false, 520);
    this.doorBusy = false;
  }

  /** Indoors: no rain falling around the camera, no sky roar; the stairwell counter resets. */
  private setInside(d: InteriorDef | null) {
    this.inside = d;
    this.weather.group.visible = !d;
    this.renderer.setIndoor(!!d);
    if (d?.id !== 'stairwell') this.resetStairs();
  }

  /** No. 7: at the top landing you're quietly one storey lower again, and the number on the wall goes up. */
  private stairwell() {
    if (this.inside?.id !== 'stairwell') return;
    const p = this.player.pos;
    if (p.y < STAIRWELL.topY - 0.3 || p.x > STAIRWELL.landingX + 0.9) return;
    p.y -= STAIRWELL.storey;
    this.follow.snap(this.player, this.world.collision);
    this.stairLoops++;
    const n = (k: number) => (k > 13 ? '\u2014' : String(k));
    STAIRWELL.signs.forEach((m, i) => {
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.map?.dispose();
      mat.map = itex.floorNumber(n(2 + i + this.stairLoops));
      mat.needsUpdate = true;
    });
    if (this.stairLoops === 11) this.hud.say(['You have been climbing for a long time.']);
  }

  private resetStairs() {
    if (!this.stairLoops) return;
    this.stairLoops = 0;
    STAIRWELL.signs.forEach((m, i) => {
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.map?.dispose();
      mat.map = itex.floorNumber(String(2 + i));
      mat.needsUpdate = true;
    });
  }

  /* ─────────────────────────── combat ─────────────────────── */

  private readonly seatM = new THREE.Matrix4();
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();

  /** Weapons, aiming, firing, the wanted level, the HUD. Every frame while playing. */
  private updateCombat(dt: number) {
    const c = this.combat, inp = this.input, p = this.player;
    c.update(dt, this.crowd.police > 0);
    const free = !this.vehicle && !this.boat && !this.dying && !this.admin?.isOpen && !this.carScreen.isOpen && !p.sitting;
    if (!free) {
      p.armPose = null;
      p.aimYaw = null;
      p.gun.visible = false;
      this.follow.aim = false;
      this.hud.combat(this.dying || this.vehicle ? { health: c.health, stars: c.stars, weapon: 'Fists', ammo: '', cross: false, hot: this.crowd.police > 0 } : null);
      return;
    }
    if (this.rpg.active) {
      // the wider world: you fight with what you're holding (the Casefile), and a gun only if you have one out
      const rw = this.rpg.life.weapon();
      if (inp.pressed('nextWeapon') || inp.pressed('prevWeapon') || inp.pressed('weapon2')) this.rpgHolstered = !this.rpgHolstered;
      if (inp.pressed('weapon1')) this.rpgHolstered = true;
      const want = rw.gun && !this.rpgHolstered ? 1 : 0;
      if (c.weapon !== want) c.select(want);
    } else {
      if (inp.pressed('weapon1')) c.select(0);
      if (inp.pressed('weapon2')) c.select(1);
      if (inp.pressed('weapon3')) c.select(2);
      if (inp.pressed('nextWeapon')) c.cycle(1);
      if (inp.pressed('prevWeapon')) c.cycle(-1);
    }
    if (inp.pressed('reload')) {
      c.reload();
      if (c.reloading > 0) inp.rumble('reload');
    }
    // Pale reaches the police too: while it runs they cannot see you well enough
    // to hold you, which is what makes it worth saving.
    if (c.stars > 0 && !this.dying && this.powers.paleT <= 0) {
      const cop = this.crowd.npcs.slice(this.crowd.citizens, this.crowd.crooksFrom).some((n) => n.visible && n.dead < 0 && n.pos.distanceTo(p.pos) < 1.7);
      this.bustT = cop && p.speed < 2.2 ? this.bustT + dt : Math.max(0, this.bustT - dt);
      if (this.bustT > 1.1) this.arrest();
    } else this.bustT = 0;
    // A burning wreck is a live hazard: you can use one as cover, but standing
    // in it costs you, and the regen delay means it keeps costing you.
    const wreck = this.police.wreckHeat(p.pos);
    if (wreck > 0 && !this.dying) {
      this.hud.hurt(dt * 0.6);
      if (this.combat.hurt(dt * 7 * wreck)) this.die('Fire');
    }
    // and the fire has to actually look like a fire
    for (const wr of this.police.burningWrecks()) {
      const d2 = (wr.x - p.pos.x) ** 2 + (wr.z - p.pos.z) ** 2;
      this.vehicles.fx.wreckFire(wr.x, wr.y, wr.z, wr.left, d2 < 240 * 240, dt);
    }
    const w = c.w;
    const gun = w.id !== 'fists';
    // fire (the mouse only once the pointer is captured, so the capturing click isn't a shot)
    const held = inp.locked && inp.value('attack') > 0.35;
    const pressed = inp.locked && inp.pressed('attack');
    const aimHeld = inp.state('aim');
    const aiming = aimHeld || c.sinceFire < 0.9;
    inp.aiming = aimHeld && gun;
    if (c.trigger(held, pressed) && (!this.rpg.active || !gun || this.rpg.life.spendRound())) {
      this.fire();
      inp.rumble(w.id === 'smg' ? 'smg' : w.id === 'fists' ? 'punch' : 'gunshot');
    }
    p.gun.visible = gun;
    p.armPose = gun ? (aiming ? 'aim' : null) : c.sinceFire < 0.2 ? 'punch' : aiming ? 'guard' : null;
    p.aimYaw = aiming ? this.follow.yaw : null;
    this.follow.aim = gun && aiming;
    const rw = this.rpg.active ? this.rpg.life.weapon() : null;
    const rounds = rw?.gun && rw.ammo ? String(this.rpg.life.game?.count(rw.ammo) ?? 0) : '';
    const ammo = c.reloading > 0 ? 'Reloading' : rw ? rounds : Number.isFinite(w.mag) ? `${c.ammo[c.weapon]} / ${w.mag}` : '';
    this.hud.combat({ health: c.health, stars: c.stars, weapon: rw ? (gun ? rw.name : rw.gun ? 'Fists' : rw.name) : w.name, ammo, cross: gun || aiming, hot: this.crowd.police > 0 });
  }

  /** Our shot (or punch): who it hits, what everyone sees and hears, and what the police make of it. */
  private fire() {
    const w = this.combat.w, p = this.player;
    if (w.id === 'fists') {
      const o = this.tmpA.set(p.pos.x, p.pos.y + 1.3, p.pos.z);
      const dir = this.tmpDir.set(Math.sin(p.facing), -0.1, Math.cos(p.facing)).normalize();
      const npc = this.crowd.hitTest(o, dir, w.range);
      const rem = this.remotes.hitTest(o, dir, npc ? npc.t : w.range);
      const wild = this.rpg.active && !npc && !rem ? this.rpg.hitTest(o, dir, w.range + 0.4) : null;
      this.audio.punch(!!(npc || rem || wild));
      if (wild) {
        wild.apply(this.rpg.life.weapon().dmg);
        this.blood.spray(this.tmpB.copy(o).addScaledVector(dir, wild.t), dir, 0.5, this.bladeInHand() ? 'cut' : 'blunt');
        return;
      }
      if (npc) {
        this.hitNpc(npc.i, w.dmg);
        this.blood.spray(this.tmpB.copy(o).addScaledVector(dir, npc.t), dir, 0.5, this.bladeInHand() ? 'cut' : 'blunt');
        this.mp.shot({ x: o.x, y: o.y, z: o.z, p: o.x, q: o.y, r: o.z, n: npc.i, a: '', m: w.dmg });
      } else if (rem) this.mp.shot({ x: o.x, y: o.y, z: o.z, p: o.x, q: o.y, r: o.z, n: -1, a: rem.id, m: w.dmg });
      return;
    }
    const cam = this.camera;
    const o = this.tmpA.copy(cam.position);
    const dir = cam.getWorldDirection(this.tmpDir);
    dir.x += (Math.random() - 0.5) * w.spread * 2;
    dir.y += (Math.random() - 0.5) * w.spread * 2;
    dir.z += (Math.random() - 0.5) * w.spread * 2;
    dir.normalize();
    // start past the player so the shot can't hit what's behind them
    const skip = cam.position.distanceTo(p.pos) * 0.8;
    o.addScaledVector(dir, skip);
    let t = Math.min(w.range, this.world.collision.raycast(o, dir, w.range));
    const npc = this.crowd.hitTest(o, dir, t);
    if (npc) t = npc.t;
    const rem = this.remotes.hitTest(o, dir, t);
    if (rem) t = rem.t;
    const wild = this.rpg.active && !npc && !rem ? this.rpg.hitTest(o, dir, t) : null;
    if (wild) t = wild.t;
    const heli = !npc && !rem && !wild ? this.police.heliHit(o, dir, t) : null;
    if (heli) {
      t = heli.t;
      this.police.damageHeli(heli.heli, w.dmg);
      this.combat.crime(0.3);
    }
    // and the cars. checked after everything else so it never steals a hit on
    // something standing in front of the cruiser.
    if (!npc && !rem && !wild && heli == null) {
      const cru = this.police.cruiserHit(o, dir, t);
      if (cru) {
        t = cru.t;
        this.police.damageCruiser(cru.car, w.dmg);
        // killing a cruiser is worth a star of heat on its own
        this.combat.crime(cru.car.mil ? 0.9 : 0.5);
      }
    }
    const end = this.tmpB.copy(o).addScaledVector(dir, t);
    const muzzle = new THREE.Vector3().setFromMatrixPosition(p.gun.matrix).addScaledVector(dir, 0.18);
    this.tracers.shot(muzzle, end, t < w.range);
    this.audio.gunshot(null, w.id === 'smg' ? 'smg' : 'pistol');
    this.crowd.scatter(p.pos.x, p.pos.z, 30, p.pos);
    this.crowd.scatter(end.x, end.z, 14, p.pos);
    // shooting in the street is a crime if anyone's around to see it
    if (this.witnesses(p.pos, 35)) this.combat.crime(w.id === 'smg' ? 0.05 : 0.15);
    if (this.rpg.active) this.rpg.alarm(p.pos, 220);
    if (wild) {
      wild.apply(this.rpg.life.weapon().dmg);
      this.blood.spray(end, dir, 0.8);
    }
    if (npc) {
      this.hitNpc(npc.i, w.dmg, end.y);
      this.blood.spray(end, dir);
    } else if (rem) this.blood.spray(end, dir);
    this.mp.shot({ x: muzzle.x, y: muzzle.y, z: muzzle.z, p: end.x, q: end.y, r: end.z, n: npc ? npc.i : -1, a: rem ? rem.id : '', m: npc || rem ? w.dmg : 0 });
  }

  private witnesses(at: THREE.Vector3, r: number) {
    for (let i = 0; i < this.crowd.citizens; i++) {
      const n = this.crowd.npcs[i];
      if (n.visible && n.dead < 0 && n.pos.distanceTo(at) < r) return true;
    }
    return false;
  }

  private hitNpc(i: number, dmg: number, hitY?: number) {
    const n = this.crowd.npcs[i];
    if (this.crowd.isCrook(i)) {
      // criminals: fair game. Stopping one even takes a little heat off you.
      this.crowd.provokeCrook(i);
      if (this.crowd.damage(i, dmg, this.player.pos, hitY)) {
        this.combat.heat = Math.max(0, this.combat.heat - 1);
        this.hud.toast('Criminal stopped');
      }
      return;
    }
    const cop = i >= this.crowd.citizens;
    const killed = this.crowd.damage(i, dmg, this.player.pos, hitY);
    this.combat.crime(killed ? (cop ? 2 : 1.2) : cop ? 1 : 0.6);
    if (killed && n) this.hud.bark(cop ? 'Officer down!' : 'Oh my god\u2014', undefined);
  }

  /** A car at speed through people. */
  private runOver(pos: THREE.Vector3, speed: number) {
    if (speed < 6) return;
    this.crowd.npcs.forEach((n, i) => {
      if (!n.visible || n.dead >= 0 || Math.hypot(n.pos.x - pos.x, n.pos.z - pos.z) > 1.4) return;
      const lethal = speed > 11;
      if (!lethal && n.frozen > 0) return; // already down
      if (lethal) this.hitNpc(i, speed * 7);
      else {
        // a knock, not a killing: down, then up again
        this.crowd.npcs[i].hp -= speed * 4;
        this.crowd.knockDown(i, pos.x, pos.z);
      }
      this.audio.crash(0.5);
      this.blood.spray(this.tmpB.set(n.pos.x, n.pos.y + 1, n.pos.z), this.tmpDir.set(n.pos.x - pos.x, 0.3, n.pos.z - pos.z).normalize(), 1.5, 'vehicle');
      // and on the car that did it
      const drv = this.vehicle?.kind === 'drive' ? this.vehicle.car : null;
      if (drv?.model) bloody(drv.model, n.pos.x - drv.pos.x, n.pos.z - drv.pos.z, drv.yaw, lethal ? 1 : 0.5);
      this.mp.shot({ x: pos.x, y: 0.5, z: pos.z, p: n.pos.x, q: 0.5, r: n.pos.z, n: i, a: '', m: 60 });
    });
  }

  /**
 * A vehicle at speed, on foot: the one case where the world can hurt you.
 * Traffic used to brake for anyone standing in the road, which meant you could
 * not be hit by a car at all — the same machine that kills a pedestrian in one
 * frame could not scratch the player.
 */
  private vehicleStrike(pos: THREE.Vector3, vx: number, vz: number, speed: number, by: string) {
    if (speed < 3 || this.dying) return;
    const p = this.player.pos;
    // swept test: a fast car covers a metre or more per frame, so a point test
    // would miss it clipping past
    const t = Math.max(0, Math.min(1, ((p.x - pos.x) * vx + (p.z - pos.z) * vz) / (speed * speed)));
    const cx = pos.x + vx * t, cz = pos.z + vz * t;
    const d = Math.hypot(p.x - cx, p.z - cz);
    if (d > 2.2) return;
    // how squarely: a graze along the side throws you aside, a nose-on kills
    const nx = vx / speed, nz = vz / speed;
    const along = Math.abs((p.x - pos.x) * nx + (p.z - pos.z) * nz);
    const square = 1 - Math.min(1, d / 2.2);
    const dmg = speed * (2.4 + 2.6 * square) - (along > 1.4 ? 8 : 0);
    this.audio.crash(0.4 + 0.4 * square);
    this.audio.land(6 + speed * 0.3);
    this.blood.spray(this.tmpB.set(p.x, p.y + 1.1, p.z), this.tmpDir.set(-nx, 0.4, -nz).normalize(), 0.7 + square);
    this.hud.hurt(Math.min(0.9, 0.2 + square * 0.5));
    this.follow.shake(0.4 + square * 0.6);
    if (this.combat.god) return;
    if (this.combat.hurt(Math.max(6, dmg))) {
      this.die(by);
      return;
    }
    // and thrown clear, so you're not left standing inside the car
    const away = Math.max(1e-3, d);
    const push = 2.5 + speed * 0.28 * square;
    this.player.vel.x += ((p.x - cx) / away) * push;
    this.player.vel.z += ((p.z - cz) / away) * push;
    this.player.vel.y = Math.min(this.player.vel.y + 1.6 * square + speed * 0.06, 4.5);
    this.player.grounded = false;
    this.crowd.shock(p.x, p.z);
  }

  /** The police fire at you. */
  private copShot(from: THREE.Vector3, hit: boolean, by = 'The police') {
    if (this.dying || this.inside) return;
    const p = this.player.pos;
    const a = this.tmpA.set(from.x, from.y + 1.45, from.z);
    const b = this.tmpB.set(p.x + (hit ? 0 : (Math.random() - 0.5) * 3), p.y + 1.2 + (hit ? 0 : Math.random()), p.z + (hit ? 0 : (Math.random() - 0.5) * 3));
    this.tracers.shot(a, b, hit);
    this.audio.gunshot(from, 'cop');
    if (!hit || this.combat.god) return;
    this.hud.hurt(0.3);
    this.blood.spray(b, this.tmpDir.subVectors(b, a).normalize(), 0.6);
    if (this.combat.hurt(9)) this.die(by);
  }

  /** Somewhere out of sight, 25–40 m away and on open ground, for an officer to come from. */
  private policeSpawn(out: THREE.Vector3) {
    if (this.inside || this.dying) return false;
    const p = this.player.pos, fwd = this.camera.getWorldDirection(this.tmpDir);
    for (let k = 0; k < 16; k++) {
      const a = Math.random() * Math.PI * 2, d = 25 + Math.random() * 15;
      const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
      if ((Math.sin(a) * fwd.x + Math.cos(a) * fwd.z) > 0.3) continue; // not right in front of you
      const blocked = this.world.collision.query(x - 0.5, z - 0.5, x + 0.5, z + 0.5).some((b) => b.maxY > 0.5 && x > b.minX - 0.4 && x < b.maxX + 0.4 && z > b.minZ - 0.4 && z < b.maxZ + 0.4);
      if (blocked || Math.abs(x) > 150 || z < -200 || z > 164) continue;
      out.set(x, 0.15, z);
      return true;
    }
    return false;
  }

  /** Down. A moment of black, then you come to outside the pharmacy, with the heat gone. */
  private async die(by?: string) {
    if (this.dying) return;
    this.dying = true;
    if (this.vehicle) this.leaveVehicle(true);
    this.blood.pool(this.player.pos, 'me');
    this.hud.say([by ? `${by} got you.` : 'Everything goes quiet.'], 'Down');
    await wait(1300);
    await this.fade(true, 900);
    if (this.inside) this.setInside(null);
    const rpgWake = this.rpg.active && !inD03(this.player.pos.x, this.player.pos.z) ? this.rpg.life.onDeath() : null;
    if (rpgWake) {
      this.player.place(rpgWake.x, rpgWake.y, rpgWake.z, rpgWake.yaw);
      this.follow.yaw = rpgWake.yaw;
      await this.rpg.streamer.preload(this.player.pos, () => {});
    } else {
      this.player.place(-10.2, 0.15, 30, Math.PI / 2);
      this.follow.yaw = Math.PI / 2;
    }
    this.follow.snap(this.player, this.world.collision);
    this.lighting.focusNow(this.player.pos);
    this.combat.respawn();
    this.blood.clear('me');
    this.discovery.forgetDistrict();
    await this.fade(false, 1200);
    this.dying = false;
    if (rpgWake) {
      this.combat.health = this.rpg.life.game ? Math.max(50, this.combat.health * 0.5) : this.combat.health;
      this.hud.say(rpgWake.lines);
      this.rpg.life.autosave();
      return;
    }
    this.hud.say(['You came to outside the pharmacy.', 'Somebody called an ambulance. Nobody stayed.']);
  }

  /** Busted: into the holding cell for a while (longer the more they wanted you). */
  private async arrest(seconds?: number) {
    if (this.dying) return;
    this.dying = true;
    this.bustT = 0;
    if (this.vehicle) this.leaveVehicle(true);
    const stars = Math.max(1, this.combat.stars);
    this.hud.say(['Busted.'], 'Police');
    this.audio.footstep(1.2, false);
    await wait(900);
    await this.fade(true, 800);
    const cell = interiorById('jail')!;
    this.player.place(cell.spawn.x, cell.spawn.y, cell.spawn.z, cell.spawn.yaw);
    this.follow.yaw = cell.spawn.yaw;
    this.follow.snap(this.player, this.world.collision);
    this.lighting.focusNow(this.player.pos);
    this.setInside(cell);
    this.combat.respawn();
    this.sentence = seconds ?? Math.min(90, 15 + stars * 15);
    await this.fade(false, 1000);
    this.dying = false;
    this.hud.location(cell.name, cell.code);
    this.hud.say(['They took your things and left you here.', `${clockText(this.sentence)}, the officer said. Maybe.`]);
  }

  /** Time passes in the cell; the gate buzzes open at the end. */
  private serveTime(dt: number) {
    if (this.sentence <= 0) return;
    if (this.inside?.id !== 'jail') {
      this.sentence = 0;
      return;
    }
    const before = Math.ceil(this.sentence);
    this.sentence = Math.max(0, this.sentence - dt);
    if (Math.ceil(this.sentence) !== before) this.hud.toast(this.sentence > 0 ? `Sentence \u00b7 ${clockText(this.sentence)}` : 'Released');
    if (this.sentence === 0) {
      this.audio.bell();
      this.hud.say(['The gate buzzes open. Nobody comes to see you out.']);
    }
  }

  /** Someone else in the room fired. */
  private remoteShot(from: string, s: { x: number; y: number; z: number; p: number; q: number; r: number; n: number; a: string; m: number }) {
    if (this.muted.has(from)) return;
    const a = new THREE.Vector3(s.x, s.y, s.z), b = new THREE.Vector3(s.p, s.q, s.r);
    const melee = a.distanceToSquared(b) < 0.01;
    if (melee) this.audio.punch(true);
    else {
      this.tracers.shot(a, b, s.m > 0);
      this.audio.gunshot(a, 'pistol');
      this.crowd.scatter(s.x, s.z, 30, a);
    }
    if (s.n >= 0 && s.n < this.crowd.npcs.length) {
      this.crowd.damage(s.n, s.m, a);
      if (s.m > 0) this.blood.spray(b, this.tmpDir.subVectors(b, a).normalize(), 0.8);
    }
    if (s.a && s.a === this.mp.id && !this.dying) {
      this.hud.hurt(0.4);
      const who = this.mp.peers.get(from)?.name ?? 'Someone';
      if (this.combat.hurt(s.m)) this.die(who);
    }
  }

  /** N: your mic on or off (the browser asks the first time). Heard by players near you. */
  private async toggleMic() {
    if (this.voice.micOn) {
      this.voice.micStop();
      return this.hud.toast('Mic off');
    }
    if (!this.mp.room) return this.hud.toast('Voice chat works in a shared room: invite someone from the pause menu.');
    if (this.mp.transport && this.mp.transport !== 'rooms') return this.hud.toast('Voice chat needs our room server, which is unreachable right now.');
    const ok = await this.voice.micStart();
    this.hud.toast(ok ? 'Mic on \u00b7 people near you can hear you (N to mute)' : 'No microphone (or the browser said no).');
  }

  /* ─────────────────────────── the river ─────────────────────── */

  /** At the promenade rail: a moored boat to step into, or the water to dive into. */
  private riverOption(): { name: string; verb: string; go: () => void } | null {
    const p = this.player.pos;
    if (this.vehicle || this.player.sitting || this.inside || !this.rules.vehicles || p.z < 160.5 || p.z > 163.3 || p.y < -0.5) return null;
    const b = this.boats.nearest(p);
    if (b) return { name: 'Boat', verb: 'Step aboard', go: () => this.enterBoat(b) };
    // not off the bridge (it has its own rails), and only facing the water
    if (Math.abs(p.x) < 11 || Math.cos(this.player.facing) < 0.3) return null;
    return { name: 'River', verb: 'Dive in', go: () => this.diveIn() };
  }

  private async enterBoat(b: Boat) {
    b.occupied = true;
    this.boat = b;
    this.player.act('act.boardBoat');
    this.follow.yaw = b.yaw;
    this.audio.footstep(1, false);
    if (!this.driveVoice) this.driveVoice = this.audio.carVoice();
  }

  /** Off the boat: onto the quay if you're alongside it, otherwise into the river. */
  private leaveBoat() {
    const b = this.boat;
    if (!b) return;
    b.occupied = false;
    this.boat = null;
    this.player.hidden = false;
    this.player.seat = null;
    this.driveVoice?.mute();
    if (Math.abs(b.pos.z - RIVER_Z0) < 3) this.player.place(b.pos.x, 0.15, QUAY_Z, Math.PI);
    else {
      this.player.place(b.pos.x + Math.cos(b.yaw) * 1.8, WATER_Y - 1.3, b.pos.z - Math.sin(b.yaw) * 1.8, b.yaw);
      this.audio.crash(0.25);
    }
    this.follow.yaw = this.player.facing;
    this.follow.snap(this.player);
  }

  private diveIn() {
    const p = this.player.pos;
    this.player.place(p.x, WATER_Y - 1.3, RIVER_Z0 + 1.2, 0);
    this.audio.crash(0.3);
    this.hud.say(['Cold. Colder than it looked.'], 'River');
  }

  /* ─────────────────────────── admin ─────────────────────── */

  private get staff() {
    return this.account.isStaff || import.meta.env.DEV;
  }

  private toggleAdmin() {
    if (!this.admin) return;
    if (this.admin.isOpen) {
      this.admin.close();
      if (this.state === 'playing') this.input.lock();
      return;
    }
    if (!this.staff) return this.hud.toast('Admin tools need a staff account.');
    this.intentionalUnlock = true;
    this.input.unlock();
    this.admin.open();
  }

  /** Room-wide if we're on our own server as staff; otherwise it only happens here. */
  private worldAct(act: string, extra: Record<string, unknown>, local: () => void) {
    if (this.mp.adminReady && this.account.isStaff) this.mp.admin(act, extra);
    else local();
  }

  private initAdmin() {
    const places: Record<string, [number, number, number, number]> = {};
    for (const d of DISTRICTS) if (d.label) places[d.name] = [d.label.x, 0.15, d.label.z, 0];
    places['Central Avenue'] = [0, 0.15, 10, 0];
    places['The Old Station'] = [0, 0.15, -146, Math.PI];
    for (const r of INTERIORS) places[r.name] = [r.spawn.x, r.spawn.y, r.spawn.z, r.spawn.yaw];
    this.admin = new AdminPanel(this.ui, {
      fly: (on) => (this.player.fly = on),
      god: (on) => (this.combat.god = on),
      infiniteBoost: (on) => {
        this.infiniteBoost = on;
        this.vehicles.infiniteBoost = on;
        // and the car you're already in, and any parked ones
        for (const c of this.vehicles.cars) {
          c.dyn.boostInfinite = on;
          c.dyn.boostable = on || (c.spec.voice.turbo >= 0.2 && c.spec.mech.mass <= 3600 && !c.spec.mech.bike);
        }
        this.rpg?.setInfiniteBoost(on);
      },
      speed: (k) => (this.player.speedMul = k),
      heal: () => (this.combat.health = 100),
      wanted: (d) => (d < 0 ? (this.combat.heat = 0) : this.combat.crime(d)),
      wantedLevel: (stars) => {
        // straight to a number of stars: heat is the star count, one per unit
        this.combat.setHeat(Math.max(0, Math.min(8, stars)));
        this.hud.toast(`Wanted: ${Math.round(this.combat.stars)} stars`);
      },
      spawnVehicle: (cls) => {
        const vs = SPECS[cls as keyof typeof SPECS];
        if (!vs) return this.hud.toast('No such vehicle.');
        const p = this.player.pos, f = this.player.facing;
        const car = this.vehicles.spawn({
          pos: new THREE.Vector3(p.x + Math.sin(f) * 5, p.y, p.z + Math.cos(f) * 5),
          yaw: f + Math.PI / 2,
          color: vs.livery ? vs.paints[0] : vs.paints[Math.floor(Math.random() * vs.paints.length)],
          van: cls === 'van',
          screen: false,
          kind: cls,
        });
        void car;
        this.hud.toast(`${vs.name} behind you.`);
      },
      vehicleClasses: () => Object.keys(SPECS),
      revive: () => {
        this.dying = false;
        this.bustT = 0;
        this.combat.health = 100;
        this.hud.toast('Back on your feet.');
      },
      grantPowers: () => {
        for (const id of POWER_ORDER) if (!this.powers.found.includes(id)) this.foundPower(id);
        this.hud.toast('All five powers, discovered.');
      },
      teleportTo: (x, z) => {
        if (!Number.isFinite(x) || !Number.isFinite(z)) return;
        if (this.vehicle) this.leaveVehicle(true);
        this.player.place(x, this.world.collision.groundAt(x, z, 40, 1, 0.9), z, this.player.facing);
        this.follow.snap(this.player, this.world.collision);
        this.lighting.focusNow(this.player.pos);
        this.hud.toast(`Moved to ${Math.round(x)}, ${Math.round(z)}.`);
      },
      bringCar: () => {
        const car = this.vehicles.cars.find((c) => !c.occupied && !c.taken);
        if (!car) return this.hud.toast('No free car.');
        const p = this.player.pos, f = this.player.facing;
        const idx = this.vehicles.cars.indexOf(car);
        this.vehicles.moveTo(idx, p.x + Math.sin(f) * 4, p.z + Math.cos(f) * 4, f + Math.PI / 2);
        this.mp.park(idx, car.pos.x, car.pos.z, car.yaw);
      },
      teleport: (name) => {
        const t = places[name];
        if (!t) return;
        if (this.vehicle) this.leaveVehicle(true);
        this.player.place(t[0], t[1], t[2], t[3]);
        this.follow.yaw = t[3];
        this.follow.snap(this.player, this.world.collision);
        this.lighting.focusNow(this.player.pos);
        this.setInside(interiorAt(t[0], t[2]));
        this.discovery.forgetDistrict();
      },
      places: () => Object.keys(places),
      resetQuests: () => this.quests.reset(),
      jailMe: () => (this.admin.close(), this.arrest(30)),
      time: (m) => this.worldAct('time', { m }, () => (this.time.minutes = m)),
      rain: (v) => this.worldAct('rain', { v: v ?? -1 }, () => (this.time.rainOverride = v)),
      event: (k) => this.worldAct(k, {}, () => this.worldEvent(k)),
      clearTraffic: () => {
        for (const car of [...this.traffic.cars]) this.traffic.retire(car);
        this.hud.toast('Streets cleared.');
      },
      knockDownAll: () => {
        let n = 0;
        this.crowd.npcs.forEach((npc, i) => {
          if (!npc.visible || npc.dead >= 0 || npc.mode === 'cop') return;
          this.crowd.damage(i, 9999, npc.pos.clone().setY(npc.pos.y + 1), undefined, true);
          n++;
        });
        this.hud.toast(`${n} down.`);
      },
      density: (v) => {
        const k = Math.max(0, Math.min(1, v));
        this.crowd.setDensity(k);
        this.traffic.setDensity(k);
        this.hud.toast(`City at ${Math.round(k * 100)}%.`);
      },
      freeze: (on) => {
        this.frozen = on;
        this.hud.toast(on ? 'Clock stopped.' : 'Clock running.');
      },
      announce: (text) => this.worldAct('announce', { text }, () => this.hud.say([text], 'Announcement')),
      players: () => [...this.mp.peers.values()].map((p) => ({ id: p.id, name: p.name, muted: this.muted.has(p.id) })),
      player: (act, id) => {
        if (act === 'jail' && !this.mp.adminReady) return this.hud.toast('Jailing others needs our room server.');
        if (act === 'mute' || act === 'unmute') {
          if (act === 'mute') this.muted.add(id);
          else this.muted.delete(id);
          if (this.mp.adminReady && this.account.isStaff) this.mp.admin(act, { a: id });
          return;
        }
        if (!this.mp.adminReady) return this.hud.toast('Kick and ban need our room server.');
        if (!this.account.isStaff) return this.hud.toast('Sign in with a staff account.');
        this.mp.admin(act, { a: id });
      },
      findAccounts: async (q) => {
        const sb = await this.account.supabase();
        const { data, error } = await sb.rpc('nf_admin_find', { q });
        if (error) throw error;
        return (data ?? []) as { id: string; name: string; role: string; banned: boolean }[];
      },
      banAccount: async (id, on) => {
        const sb = await this.account.supabase();
        const { data, error } = await sb.rpc('nf_admin_ban', { target: id, on });
        if (error) this.hud.toast('Not allowed.');
        return !error && !!data;
      },
      liveStats: () => ({
        fps: Math.round(1 / Math.max(1e-3, this.fpsDt)),
        network: this.mp.status === 'connected' ? (this.mp as unknown as { tx: { kind: string } | null }).tx?.kind ?? '\u2014' : this.mp.status,
        players_here: this.mp.peers.size + 1,
        host: this.mp.shared ? (this.mp.isHost ? 'you' : 'someone else') : '\u2014',
        people_about: this.crowd.npcs.filter((n) => n.visible && n.dead < 0 && n.mode !== 'cop').length,
        people_down: this.crowd.npcs.filter((n) => n.dead >= 0).length,
        police: this.crowd.police,
        wanted: this.combat.stars,
        traffic: this.traffic.cars.filter((c) => c.group.visible).length,
        draw_calls: this.renderer.renderer.info.render.calls,
        triangles: this.renderer.renderer.info.render.triangles,
        position: `${this.player.pos.x.toFixed(1)}, ${this.player.pos.z.toFixed(1)}`,
      }),
      serverStats: async () => {
        if (!this.account.signedIn) return null;
        const sb = await this.account.supabase();
        const { data, error } = await sb.rpc('nf_admin_stats');
        return error ? null : (data as Record<string, number>);
      },
      placeNote: async (title, body) => {
        if (!this.account.isStaff) return 'Sign in with a staff account to leave notes.';
        const sb = await this.account.supabase();
        const p = this.player.pos;
        const { data, error } = await sb.from('world_notes').insert({ x: p.x, y: p.y, z: p.z, title, body }).select('id, x, y, z, title, body').single();
        if (error || !data) return 'Could not place it.';
        this.addNote(data as NoteRow);
        return null;
      },
      notes: () => this.notes.map((n) => ({ id: n.id, title: n.title, dist: n.pos.distanceTo(this.player.pos) })).sort((a, b) => a.dist - b.dist),
      deleteNote: async (id) => {
        const sb = await this.account.supabase();
        const { error } = await sb.from('world_notes').delete().eq('id', id);
        if (error) return false;
        this.removeNote(id);
        return true;
      },
      roomReady: () => this.mp.adminReady && this.account.isStaff,
      close: () => this.toggleAdmin(),
    });
    this.nav.scope(this.admin.el, { back: () => this.toggleAdmin() });
    this.admin.el.dataset.navScope = '';
    this.mp.onShot = (from, s) => this.remoteShot(from, s);
    this.mp.onAdmin = (act, m) => this.onAdminMessage(act, m);
    this.mp.onKicked = (reason) => {
      this.hud.say([reason === 'banned' ? 'You have been banned from this room.' : 'You were removed from this room.'], 'Room');
      this.settingsView.refresh();
    };
    // the access token expires hourly: keep the room server's copy fresh
    setInterval(async () => {
      if (this.account.signedIn) this.mp.token = await this.account.token().catch(() => null);
    }, 10 * 60 * 1000);
  }

  private worldEvent(k: 'blackout' | 'unease') {
    if (k === 'blackout') this.blackoutT = 12;
    else this.crowd.provoke();
  }

  /** A staff action the room server vouched for. */
  private onAdminMessage(act: string, m: Record<string, unknown>) {
    const v = typeof m.v === 'number' ? m.v : null;
    const mm = typeof m.m === 'number' ? m.m : null;
    const target = typeof m.a === 'string' ? m.a : '';
    if (act === 'time' && mm != null) this.time.minutes = Math.max(0, Math.min(329, mm));
    else if (act === 'rain' && v != null) this.time.rainOverride = v < 0 ? null : Math.max(0, Math.min(1, v));
    else if (act === 'blackout' || act === 'unease') this.worldEvent(act);
    else if (act === 'announce' && typeof m.text === 'string') this.hud.say([m.text], 'Announcement');
    else if (act === 'jail' && target === this.mp.id) this.arrest(60);
    else if (act === 'mute' && target) this.muted.add(target);
    else if (act === 'unmute' && target) this.muted.delete(target);
    else if (act === 'kicked' || act === 'banned') this.hud.toast(act === 'kicked' ? 'Player removed.' : 'Player banned.');
    else if (act === 'denied') this.hud.toast('The room server says you are not staff.');
  }

  /* ─────────────────────────── notes (content editor) ─────────────────── */

  private async loadNotes() {
    try {
      const sb = await this.account.supabase();
      const { data } = await sb.from('world_notes').select('id, x, y, z, title, body').limit(200);
      for (const r of (data ?? []) as NoteRow[]) this.addNote(r);
    } catch {
      /* offline, or no backend configured */
    }
  }

  private addNote(r: NoteRow) {
    if (this.notes.some((n) => n.id === r.id)) return;
    const id = `note:${r.id}`;
    const pos = new THREE.Vector3(r.x, r.y, r.z);
    INTERACTIONS[id] = { name: r.title, verb: 'Read', lines: [r.body] };
    this.world.interact.push({ id, pos, radius: 2 });
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6), new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.8 }));
    post.position.y = 0.7;
    const words = r.body.match(/.{1,18}(\s|$)/g)?.slice(0, 8).map((s) => s.trim()) ?? [r.body];
    const paper = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 0.52),
      new THREE.MeshStandardMaterial({ map: itex.notice([r.title.toUpperCase(), '', ...words]), emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.9, side: THREE.DoubleSide }),
    );
    (paper.material as THREE.MeshStandardMaterial).emissiveMap = (paper.material as THREE.MeshStandardMaterial).map;
    paper.position.y = 1.45;
    g.add(post, paper);
    g.position.copy(pos);
    this.scene.add(g);
    this.notes.push({ id: r.id, title: r.title, pos, mesh: g });
  }

  private removeNote(id: string) {
    const i = this.notes.findIndex((n) => n.id === id);
    if (i < 0) return;
    this.scene.remove(this.notes[i].mesh);
    const k = this.world.interact.findIndex((s) => s.id === `note:${id}`);
    if (k >= 0) this.world.interact.splice(k, 1);
    delete INTERACTIONS[`note:${id}`];
    this.notes.splice(i, 1);
  }

  /* ─────────────────────────── side quests ─────────────────── */

  private onQuest(e: QuestEvent) {
    const q = e.quest;
    if (!this.questFromUse && e.lines.length) {
      this.hud.say(e.lines, q.title);
      this.sayingUntil = performance.now() + 2500;
    }
    if (e.type === 'start') this.hud.questFlash('New side quest', q.title);
    if (e.type === 'step') this.audio.uiTick();
    if (e.type === 'fail') this.hud.questFlash('Failed', q.title);
    if (e.type === 'done') {
      this.hud.questFlash('Complete', q.title);
      this.audio.bell();
      if (q.unlock) setTimeout(() => this.discovery.unlock(q.unlock!), 3200);
    }
  }

  /** The tracker and the marker, a few times a second. */
  private updateQuests(dt: number) {
    this.quests.update(dt, { pos: this.player.pos, driving: this.vehicle?.kind === 'drive', inside: this.inside?.id ?? null, stairLoops: this.stairLoops });
    const c = this.quests.current;
    // only point at things in the same space as you (the rooms are built far off the map)
    const target = c?.target && (c.target.x >= 900) === !!this.inside ? c.target : null;
    this.questMarker.update(dt, this.t, target, this.player.pos, !!this.inside);
    this.questHudT -= dt;
    if (this.questHudT > 0) return;
    this.questHudT = 0.2;
    if (!c) return this.hud.objective(null);
    const bits: string[] = [];
    if (c.left != null) {
      const s = Math.max(0, Math.ceil(c.left));
      bits.push(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    }
    if (target) bits.push(`${Math.round(Math.hypot(target.x - this.player.pos.x, target.z - this.player.pos.z))} m`);
    else if (c.target) bits.push(this.inside ? 'Outside' : 'Indoors');
    this.hud.objective({ title: c.quest.title, text: c.text, meta: bits.join(' \u00b7 ') });
  }

  /* ─────────────────────────── voices ─────────────────────── */

  private whoIs(n: Npc) {
    if (n.mode === 'stare') return 'Night clerk';
    if (n.mode === 'watcher') return '—';
    return n.talked ? 'Stranger' : 'Someone';
  }

  /** Someone in the crowd says something: their voice, from where they stand, and a subtitle if you're close. */
  private npcSay(n: Npc, kind: import('../data/barks').Bark) {
    if (!this.world || this.state === 'landing' || this.previewing) return;
    const d = n.pos.distanceTo(this.player.pos);
    if (d > (kind === 'chatter' ? 11 : 24)) return;
    const [text, mood] = barkLine(kind, n.mode, n.talked, this.weather.intensity > 0.3 && !this.inside);
    this.audio.say(n.voice, text, mood, n.pos, kind === 'chatter' ? 0.55 : 1);
    if (kind !== 'chatter' && d < 16 && !this.overlay) this.hud.bark(text, kind === 'talk' ? this.whoIs(n) : undefined);
  }

  /** A car in the street leans on its horn: two short blasts, and people look. */
  private honk(x: number, z: number) {
    const v = this.trafficHorns.find((h) => h) ?? null;
    this.crowd.hear(x, z, 26);
    if (!v || !this.audio.enabled) return;
    this.trafficHorns.push(this.trafficHorns.shift()!);
    const p = new THREE.Vector3(x, 0, z);
    const long = Math.random() < 0.35;
    v.on(p);
    setTimeout(() => v.off(), long ? 700 : 170);
    if (!long) {
      setTimeout(() => v.on(p), 290);
      setTimeout(() => v.off(), 480);
    }
  }

  /** R in any car: next station (Shift: previous); the set now lives in this car. */
  private tuneRadio(dir: 1 | -1) {
    const v = this.vehicle;
    const out = this.audio.output;
    if (!this.audio.ctx || !out) {
      this.hud.setHint('Turn the sound on to use the radio');
      return;
    }
    if (!v) {
      // headphones: on foot, the radio goes where you go
      if (!this.headphones) this.radioHost = { car: null, pos: () => this.player.pos };
      this.radio.setVolume(this.settings.data.radio);
      this.radio.next(this.audio.ctx, out, dir);
      return;
    }
    if (this.radioHost?.car !== v.car) {
      const car = v.car;
      this.radioHost = { car, pos: () => ('pos' in car ? car.pos : car.group.position) };
    }
    this.radio.setVolume(this.settings.data.radio);
    this.carScreen.pause();
    this.radio.next(this.audio.ctx, out, dir);
  }

  private radioHintTimer = 0;
  private showRadio() {
    const r = this.radio;
    const st = r.station;
    let text: string;
    if (!st) text = 'Radio off';
    else if (r.status === 'no-signal') text = `${st.name}  ·  no signal  ·  R next station`;
    else if (r.status === 'tuning') text = `${st.name}  ·  tuning…`;
    else text = r.nowPlaying ? `${st.name}  ·  ${r.nowPlaying}` : `${st.name}  ·  ${st.note}`;
    // only speak up while you're in the car it's playing in
    if (!this.headphones && (!this.vehicle || this.radioHost?.car !== this.vehicle.car)) return;
    this.hud.setHint(text);
    clearTimeout(this.radioHintTimer);
    this.radioHintTimer = window.setTimeout(() => this.hud.setHint(null), 6000);
  }

  /** Step out beside the car. `now` skips braking (leaving the world). */
  private leaveVehicle(now = false) {
    const v = this.vehicle;
    if (!v) return;
    if (v.kind === 'drive') {
      if (!now && Math.abs(v.car.v) > 1.5) {
        v.car.leaving = true; // brake first; the frame loop lets us out once stopped
        return;
      }
      v.car.v = 0;
      v.car.occupied = false;
      v.car.leaving = false;
      this.mp.park(this.vehicles.cars.indexOf(v.car), v.car.pos.x, v.car.pos.z, v.car.yaw);
      this.vehicles.exitPoint(v.car, this.world.collision, this.tmpV);
      // the door opens, you swing out and stand; it shuts behind you
      this.vehicles.door(v.car, 0, true);
      this.doorClose = { car: v.car, t: 1.1 };
      this.player.place(this.tmpV.x, this.tmpV.y, this.tmpV.z, Math.atan2(-Math.cos(v.car.yaw), Math.sin(v.car.yaw)));
    } else {
      const remote = this.mp.shared && !this.mp.isHost;
      if (!now && !v.car.taxi?.arrived) {
        this.traffic.requestStop(v.car);
        if (remote) this.mp.taxi('stop');
        return;
      }
      exitBeside(v.car.group.position, v.car.yaw, 1.45, -1, this.world.collision, this.tmpV);
      this.player.place(this.tmpV.x, this.tmpV.y, this.tmpV.z, v.car.yaw);
      this.traffic.alight(v.car);
      if (remote) this.mp.taxi('alight');
    }
    this.vehicle = null;
    this.player.hidden = false;
    this.player.seat = null;
    this.follow.endCar();
    this.player.act('act.exitCar', { hold: true });
    this.driveVoice?.mute();
    this.horn?.off();
    this.honking = false;
    this.audio.footstep(0.9, false);
    this.follow.yaw = this.player.facing;
    this.follow.snap(this.player);
  }

  private interact() {
    const cur = this.interaction.current;
    if (!cur || performance.now() < this.sayingUntil) return;
    const { spot, def } = cur;
    let override: string[] | undefined;
    let unlock = def.unlock;
    // the body does what the verb says: turn to it, then the hands
    if (spot.pos) this.player.facing = Math.atan2(spot.pos.x - this.player.pos.x, spot.pos.z - this.player.pos.z);
    const verbClip: Record<string, string> = { Inspect: 'act.inspect', Read: 'act.inspect', Use: 'act.press', Ring: 'act.press', Listen: 'react.whisper', Talk: 'emote.greet', Answer: 'act.payphone' };
    if (def.action === 'vend') this.player.act('act.vend', { hold: true });
    else if (def.action === 'enter' || def.action === 'exit') this.player.act('act.pushDoor');
    else if (def.action !== 'sit' && verbClip[def.verb]) this.player.act(verbClip[def.verb]);
    if (def.action === 'phone') {
      if (this.phone.ringing) {
        this.phone.ringing = false;
        this.phone.answered = true;
        this.audio.setPhoneRinging(false);
        override = def.lines;
      } else {
        override = def.again;
        unlock = undefined;
      }
    }
    if (def.action === 'enter') return this.goInside(spot.id.slice('enter:'.length));
    if (def.action === 'exit') return this.goOutside();
    if (def.action === 'bell') this.audio.bell();
    if (def.action === 'rob') return this.startRob();
    if (def.action === 'search') return this.search(spot.id);
    if (def.action === 'sleep') return this.sleep();
    // side quests may have something to say here instead
    this.questFromUse = true;
    const ql = this.rules.quests ? this.quests.use(spot.id) : null;
    this.questFromUse = false;
    if (ql?.length) override = ql;
    if (def.action === 'mark') this.save.flag(spot.id);
    if (def.action === 'sit') {
      this.player.sitAt(spot.pos, spot.yaw ?? 0);
      this.follow.yaw = (spot.yaw ?? 0);
    }
    if (def.action === 'vend' && !this.save.has('vending')) {
      setTimeout(() => this.audio.footstep(1.4, false), 2600);
      setTimeout(() => this.audio.footstep(1.2, false), 3100);
    }
    const lines = this.interaction.linesFor(spot.id, def, override);
    const dur = lines.reduce((a, l) => a + 2300 + l.length * 55, 0);
    this.sayingUntil = performance.now() + Math.min(dur, 2500);
    this.hud.say(lines, def.name);
    if (unlock) {
      const id = unlock;
      setTimeout(() => this.discovery.unlock(id), 1400);
    }
  }

  /** drawers already gone through this session */
  private searched = new Set<string>();

  /**
   * Going through someone's drawers. What's in there is mostly nothing, now
   * and then money. If anyone's home and sees you, that's a burglary: they
   * react, and the wanted level goes up.
   */
  private search(id: string) {
    const s = SEARCHES.get(id);
    if (!s) return;
    this.player.act('act.search');
    if (this.searched.has(id)) {
      this.hud.say(['Already been through it.'], s.name);
      return;
    }
    this.searched.add(id);
    const home = HOMES.get(s.home);
    // anyone in here, alive, who can see you?
    this.crowd.bodies(this.peopleOnFoot);
    const me = this.player.pos;
    const witness = home && this.peopleOnFoot.some((b) => b.visible && b.dead < 0 && b.pos.x > home.bounds[0] && b.pos.x < home.bounds[2] && b.pos.z > home.bounds[1] && b.pos.z < home.bounds[3] && Math.abs(b.pos.y - me.y) < 1.5 && Math.hypot(b.pos.x - me.x, b.pos.z - me.z) < 9);
    const r = Math.random();
    const cash = r < 0.45 ? 0 : Math.round(s.cash[0] + Math.random() * (s.cash[1] - s.cash[0]));
    const finds = ['Old receipts and a spare key.', 'Batteries, a torch, a birthday card nobody sent.', 'Paperwork. A photograph of the pier, years ago.', 'A watch that stopped at 3:17.', 'Nothing worth taking.'];
    const lines = [cash > 0 ? `${fmtMoney(cash)}, folded small.` : finds[Math.floor(Math.random() * finds.length)]];
    if (cash > 0) {
      this.save.data.cash = (this.save.data.cash ?? 0) + cash;
      this.hud.toast(`${fmtMoney(cash)} · you have ${fmtMoney(this.save.data.cash)}`);
    }
    if (witness) {
      lines.push(home!.kind === 'shop' || home!.kind === 'office' ? '"Hey! Put that back!"' : '"Who are you? Get out of my house!"');
      this.combat.crime(home!.kind === 'shop' ? 1.2 : 1);
      this.crowd.shock(this.player.pos.x, this.player.pos.z);
      this.audio.say({ pitch: 150, tract: 1, rate: 6, breath: 0.3 }, lines[1], 'scared', this.player.pos, 1);
    }
    this.hud.say(lines, s.name);
    this.sayingUntil = performance.now() + 1800;
  }

  /** A bed: lie down, the screen goes dark, you wake rested. It's still 3:17. */
  private async sleep() {
    if (this.doorBusy) return;
    this.doorBusy = true;
    this.player.act('act.lieDown', { hold: true });
    await this.fade(true, 900);
    this.combat.health = 100;
    await new Promise((r) => setTimeout(r, 1200));
    this.player.act('act.stand');
    this.fade(false, 900);
    this.hud.say(['You sleep, properly, for the first time in a while.', 'When you wake it is still 3:17.'], 'Bed');
    this.doorBusy = false;
  }

  /* ─────────────────────────── powers ─────────────────────────── */

  /**
   * The only way in is being somewhere it happens. These are the moments the
   * city already generates on its own — a wrong figure, the watcher, something
   * wrong on a street at 03:17 — and standing in one leaves you changed.
   */
  private tryDiscoverPower(dt: number) {
    const p = this.powers;
    if (!this.rules.discovery) return;
    if (p.found.length >= POWER_ORDER.length) return;
    tickPowers(p, dt);
    const here = this.player.pos;

    // Lift: the lamps that District records list as decommissioned. Stand under
    // one while it comes on by itself and it hands you something.
    for (const l of this.world.lamps) {
      if (Math.hypot(l.pos.x - here.x, l.pos.z - here.z) > 9) continue;
      if ((l.flicker ?? 0) > 0.6 && Math.random() < dt * 0.9) return this.foundPower('lift');
    }
    // Burn: the same lamps, but after the lights go out, on foot, alone.
    if (this.blackoutT > 0 && !this.vehicle && Math.random() < dt * 0.8) return this.foundPower('burn');
    // Still: whatever is being watched, if you are standing in the middle of it.
    if (Math.random() < dt * 0.7 && this.crowd.watched) return this.foundPower('still');
    // Pale: out past the last lamp, on your own.
    if (!this.vehicle && here.y < 0.05 && here.z > 210 && Math.random() < dt * 0.5) return this.foundPower('pale');
    // Hook: something came at you and you are still here.
    if (this.combat.health < 40 && Math.random() < dt * 0.6) return this.foundPower('hook');
  }

  private foundPower(id: PowerId) {
    if (!grant(this.powers, id)) return false;
    const d = POWERS[id];
    this.hud.toast(`${d.name} — ${d.epithet}`);
    this.player.act(d.clip, { hold: true });
    this.audio.sag();
    this.follow.shake(0.5);
    this.discovery.unlock('power-found');
    return true;
  }

  /** Fire the selected power. */
  private usePower() {
    const p = this.powers;
    if (!p.found.length) return;
    const id = p.sel;
    if (!spend(p, id)) {
      this.hud.toast(POWERS[id].name + ': not ready.');
      return;
    }
    const d = POWERS[id];
    this.player.act(d.useClip, { hold: false });
    this.audio.land(4);
    switch (id) {
      case 'lift':
        // everything loose near you rises, and so do you
        this.player.vel.y = 9.5;
        this.player.grounded = false;
        this.crowd.startle(this.player.pos, 18);
        break;
      case 'still':
        p.stillT = 6;
        this.crowd.still = p.stillT;
        this.held = p.stillT;
        this.hud.toast('The district holds its breath.');
        break;
case 'burn':
      this.burnLight(this.player.pos);
      break;
      case 'pale':
        p.paleT = 22;
        this.crowd.pale = p.paleT;
        this.hud.toast('Nobody looks at you.');
        break;
      case 'hook':
        this.hookSomething(this.player.pos);
        break;
    }
  }

  /** Does a power use land on a person? Then it is a crime, not a tool. */
  private misusePower(id: PowerId, pos: THREE.Vector3) {
    const d = POWERS[id];
    if (!d.crime) return;
    this.combat.crime(d.crime);
    this.powers.marked = true;
    this.hud.toast('Somebody saw that.');
  }

  private burnLight(at: THREE.Vector3) {
    this.crowd.shock(at.x, at.z);
    this.audio.bell();
    // it lights the district, and everyone within it knows
    for (const l of this.world.lamps) if (Math.hypot(l.pos.x - at.x, l.pos.z - at.z) < 30) l.flicker = Math.max(l.flicker ?? 0, 2);
  }

  private hookSomething(from: THREE.Vector3) {
    // it brings the nearest thing to you, whether or not you meant it
    let best = -1, bd = 40;
    this.crowd.npcs.forEach((n, i) => {
      if (!n.visible || n.dead >= 0) return;
      const d = Math.hypot(n.pos.x - from.x, n.pos.z - from.z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best < 0) return;
    this.crowd.knockDown(best, from.x, from.z);
    this.crowd.shock(from.x, from.z);
    this.misusePower('hook', this.crowd.npcs[best].pos);
  }

  /* ─────────────────────────── the robbery ─────────────────────────── */

  /**
   * Start turning the vault wheel. You have to stay at it; leaving it lets the
   * progress slip, and past a certain point the alarm draws people.
   */
  private startRob() {
    if (this.rob.stage === 'taken') return;
    this.rob.stage = 'turning';
    this.rob.coldT = 0;
    this.player.act('act.inspect', { hold: true });
    this.hud.toast('The wheel turns. It is very heavy.');
  }

  /** One frame of it: the hold, the alarm, and what the city does about it. */
  private tickRobbery(dt: number) {
    const s = this.rob;
    if (s.stage === 'idle') {
      this.audio.bankAlarm(false);
      this.hud.rob(null);
      return;
    }
    // standing at the wheel?
    const atVault = !this.vehicle && !this.inside && this.player.pos.distanceTo(this.tmpB.set(VAULT.x, this.player.pos.y, VAULT.z)) < 2.2;
    const r = stepRob(s, dt, atVault, this.player.pos);

    if (r.alarmed) {
      this.audio.bankAlarm(true);
      this.hud.toast('The alarm goes.');
      this.crowd.shock(VAULT.x, VAULT.z);
    }
    if (s.stage === 'turning' && atVault) this.audio.vaultWheel(s.progress);
    if (r.took) {
      this.audio.vaultOpen();
      this.hud.toast(`${fmtMoney(s.haul)} taken. The heat lands now, not when you leave.`);
      this.combat.crime(robHeat(s));
      this.crowd.shock(VAULT.x, VAULT.z);
    } else if (s.stage === 'turning') {
      this.combat.heat = Math.max(this.combat.heat, robHeat(s));
    }
    // the siren follows the robbery, not just the heat
    const alarm = s.alarmT > 0;
    this.audio.bankAlarm(alarm && this.state === 'playing');

    // and you have to actually get out of it
    if (s.stage === 'taken' && s.distance > ESCAPE_R) {
      s.stage = 'idle';
      this.hud.toast('Clear. For now.');
      this.discovery.unlock('bank-vault');
    }
    if (alarm && !this.lastRobLine) {
      const line = robAlarmStage(s);
      if (line && line !== this.lastRobLine) {
        this.lastRobLine = line;
        this.hud.toast(line);
      }
    } else if (!alarm) this.lastRobLine = null;

    this.hud.rob({ progress: s.progress, stage: s.stage, distance: s.stage === 'taken' ? s.distance : 0, haul: s.haul });
  }

  /** The police response the robbery is asking for, over the normal heat. */
  private get robWanted(): number {
    return this.rules.police ? robWanted(this.rob, this.rob.distance) : 0;
  }

  /* ─────────────────────────── loop ─────────────────────────── */

  private frame(now: number) {
    this.input.poll(now);
    this.clock.update(now);
    // clamp both ways: tab switches produce huge deltas, clock resets can produce negative ones
    // (a scene can run time slow: the last moment of a match)
    const dt = Math.max(0, Math.min(this.clock.getDelta(), 0.05)) * (this.scenes?.active ? this.scenes.timeScale : 1) * (this.frozen ? 0 : 1);
    this.t += dt;
    if (dt > 0) this.fpsDt += (dt - this.fpsDt) * 0.05;
    // Auto quality: watch the real frame time and move between tiers to hold
    // the frame rate. Only ever runs when the player has left it on 'auto'.
    if (this.settings.data.quality === 'auto' && this.governor.enabled && this.state === 'playing' && dt > 0) {
      if (this.governor.step(dt)) this.applySettings();
    }
    const t = this.t;
    worldUniforms.uTime.value = t;
    const playing = this.state === 'playing';
    const inWorld = playing || this.state === 'overlay' || this.state === 'leaving' || (this.state === 'entering' && this.player.group.visible);

    // camera
    const creating = this.overlay === 'rpg' && this.rpg.life.fitting;
    if ((this.overlay === 'wardrobe' && this.player.group.visible) || creating) {
      // a fitting: face the figure, framed left of centre so the panel (on the right) doesn't cover it.
      // (fz, -fx) is the camera's right when it looks back at the figure.
      const p = this.player.pos, f = this.player.facing;
      const fx = Math.sin(f), fz = Math.cos(f);
      const side = innerWidth > 720 ? 0.75 : 0;
      const lift = innerWidth > 720 ? 0 : -0.55; // phones: panel is at the bottom, so frame the figure high
      this.camera.position.set(p.x + fx * 2.9 + fz * side, p.y + 1.3, p.z + fz * 2.9 - fx * side);
      this.camera.lookAt(p.x + fz * side * 1.25, p.y + 1.0 + lift, p.z - fx * side * 1.25);
      this.fitLight.position.set(p.x + fx * 2.2 - fz * 0.8, p.y + 2.2, p.z + fz * 2.2 + fx * 0.8);
      this.fitLight.intensity = 9;
      if (this.previewing || creating) this.player.update(dt, null, f, this.world.collision, []);
    } else if (this.state === 'landing' || (this.state === 'entering' && !this.player.group.visible) || this.state === 'boot') {
      this.fitLight.intensity = 0;
      this.cine.update(dt, t);
      if (this.state === 'landing' && !this.overlay) this.cuts();
    } else if (inWorld) {
      this.fitLight.intensity = 0;
      if (playing && this.input.enabled && !this.wheel.isOpen && !this.photoOn) {
        const zs = this.input.zoomSens ? this.input.zoomScale : 1;
        this.follow.look(this.input.lookX * zs, this.input.lookY * zs);
        this.follow.stick(this.input.stickYaw, this.input.stickPitch);
      }
      this.introT = Math.min(1, this.introT + dt / 3.2);
      const v = this.vehicle;
      if (this.fight.active) {
        this.fight.update(dt, t, this.camera, playing && !this.overlay);
        this.player.pos.copy(this.fight.fighters[0].pos);
      } else if (this.warzone.active && this.warzone.fpActive) {
        this.warzone.eyeCamera(dt);
      } else if (this.photoOn) {
        if (this.photo.update(dt, this.input, this.camera, this.player.pos, this.world.collision) === 'exit') this.photoMode(false);
      } else if (this.boat) this.follow.updateVehicle(dt, this.boat.group.position, this.boat.yaw, this.boat.v, null);
      else if (v?.kind === 'drive') {
        const c = v.car, d = c.dyn;
        const slip = d.wheels.reduce((a, w) => Math.max(a, w.slip), 0);
        this.follow.updateCar(dt, { pos: c.pos, yaw: c.yaw, speed: c.v, body: c.model?.body.matrixWorld ?? c.group.matrixWorld, length: c.spec.shape.length, height: c.spec.shape.height, seat: c.seat ?? c.spec.seat, ax: d.ax, ay: d.ay, slip }, this.world.collision, this.vehicles.impact);
        // from the driver's seat, you don't see your own head
        this.player.hidden = this.follow.carView === 3;
      }
      else if (v?.kind === 'ride') this.follow.updateVehicle(dt, v.car.group.position, v.car.yaw, v.car.v, this.world.collision);
      else this.follow.update(dt, this.player, this.world.collision, t);
      if (this.introT < 1 && !v && !this.photoOn && !this.fight.active && !this.warzone.active) {
        // settle down behind the shoulder as the world fades in
        const k = 1 - easeOut(this.introT);
        this.camera.position.y += k * 2.6;
        this.camera.position.addScaledVector(this.tmpV.set(Math.sin(this.follow.yaw), 0, Math.cos(this.follow.yaw)), -k * 3);
        this.camera.lookAt(this.player.pos.x, this.player.pos.y + 1.4, this.player.pos.z);
      }
    }
    if (this.debugCam) {
      this.camera.position.copy(this.debugCam.pos);
      this.camera.lookAt(this.debugCam.look);
    }
    this.debugTick?.(dt, t);
    this.camera.updateMatrixWorld();

    // menus: a controller (or the arrow keys) moves the focus in whatever's open
    const menuUp =
      (this.state === 'landing' && !this.cutting) || this.state === 'overlay' || this.modeSelect.isOpen || !!this.admin?.isOpen || !!this.chat?.isOpen || this.carScreen.isOpen || this.nav.osk.isOpen || this.fight?.hud.endOpen || this.warzone?.endOpen || this.warzone?.menuOpen;
    this.nav.active = menuUp;
    if (menuUp) {
      if (this.overlay === 'settings') this.settingsView.update();
      this.padMenus(dt);
      if (!this.settingsView.listening) this.nav.update(dt);
    }

    // world simulation keeps running under menus — the city doesn't pause for you
    this.obstacles.length = 0;
    this.crowd.obstacles(this.obstacles);
    // and the bodies a car can hit
    this.crowd.bodies(this.peopleOnFoot);
    if (this.rpg?.active) this.rpg.traffic.obstacles(this.obstacles);
    const veh = this.vehicle;
    this.carScreen.show(veh?.kind === 'drive' && veh.car.screen && inWorld);
    this.carScreen.setVolume(this.settings.data.radio * this.settings.data.master * (this.overlay ? 0.3 : 1));
    if (inWorld) {
      const move = playing && this.input.enabled && !this.carScreen.isOpen && !this.admin?.isOpen && !this.chat?.isOpen && !this.dying && !this.photoOn && !this.boarding && !this.sceneBusy;
      if (this.boat) {
        const b = this.boat;
        const r = this.boats.drive(b, dt, move ? this.input : null);
        this.boatSteer = r.steer;
        this.player.pos.set(b.pos.x, WATER_Y + 0.4, b.pos.z);
        this.player.facing = b.yaw;
        b.group.updateMatrixWorld();
        this.seatM.copy(b.group.matrixWorld).multiply(this.tmpM.makeTranslation(0.35, 0.05, -1.3));
        this.player.seat = { m: this.seatM, drive: true, steer: -this.boatSteer };
        this.player.update(dt, null, this.follow.yaw, this.world.collision, []);
        this.driveVoice?.setPosition(b.pos, Math.abs(b.v) * 1.4);
        if (move && this.input.pressed('exitVehicle')) this.leaveBoat();
      } else if (veh?.kind === 'drive') {
        const solid = this.obstacles.slice();
        for (const c of this.traffic.cars) {
          if (!c.group.visible) continue;
          for (const k of [-1.4, 0, 1.4]) solid.push({ x: c.group.position.x + Math.sin(c.yaw) * k, z: c.group.position.z + Math.cos(c.yaw) * k, r: 0.95 });
        }
        this.vehicles.obstacles(solid, veh.car);
        this.remotes.obstacles(solid);
        this.vehicles.drive(veh.car, dt, move ? this.input : null, this.world.collision, solid);
        const honk = move && this.input.held('horn');
        if (honk !== this.honking) {
          this.honking = honk;
          this.mp.horn(veh.car.pos.x, veh.car.pos.z, honk);
          if (honk) {
            this.horn?.on();
            this.crowd.hear(veh.car.pos.x, veh.car.pos.z, 30, true);
          } else this.horn?.off();
        }
        this.crowd.threat(veh.car.pos.x, veh.car.pos.z, Math.sin(veh.car.yaw) * veh.car.v, Math.cos(veh.car.yaw) * veh.car.v, true);
        this.runOver(veh.car.pos, Math.abs(veh.car.v));
        this.player.pos.copy(veh.car.pos);
        this.player.facing = veh.car.yaw;
        veh.car.group.updateMatrixWorld();
        const sd = veh.car.seat ?? SEATS.driver;
        // sat in the body, so you lean and bob with it on its springs
        const body = veh.car.model?.body ?? veh.car.group;
        body.updateMatrixWorld();
        this.seatM.copy(body.matrixWorld).multiply(this.tmpM.makeTranslation(sd.x, sd.y, sd.z));
        this.player.seat = { m: this.seatM, drive: true, steer: veh.car.steer / 0.62, car: body.matrixWorld, at: sd };
        this.player.update(dt, null, this.follow.yaw, this.world.collision, []);
        if (veh.car.leaving && Math.abs(veh.car.v) < 0.3) this.leaveVehicle(true);
      } else if (veh?.kind === 'ride') {
        this.player.pos.copy(veh.car.group.position);
        this.player.facing = veh.car.yaw;
        veh.car.group.updateMatrixWorld();
        const backBody = veh.car.model?.body ?? veh.car.group;
        backBody.updateMatrixWorld();
        this.seatM.copy(backBody.matrixWorld).multiply(this.tmpM.makeTranslation(SEATS.back.x, SEATS.back.y, SEATS.back.z));
        this.player.seat = { m: this.seatM, drive: false, steer: 0, car: backBody.matrixWorld, at: SEATS.back };
        this.player.update(dt, null, this.follow.yaw, this.world.collision, []);
        const tx = veh.car.taxi;
        // our stop (the host's taxi reports it), or the host gave the seat to someone else
        if (tx?.arrived && tx.riderId === this.mp.id) this.leaveVehicle(true);
        else if (tx?.rider && tx.riderId && tx.riderId !== this.mp.id) this.leaveVehicle(true);
      } else {
        this.vehicles.obstacles(this.obstacles);
        this.remotes.obstacles(this.obstacles);
        // passing cars are solid too
        for (const c of this.traffic.cars) {
          if (!c.group.visible) continue;
          for (const k of [-1.4, 0, 1.4]) this.obstacles.push({ x: c.group.position.x + Math.sin(c.yaw) * k, z: c.group.position.z + Math.cos(c.yaw) * k, r: 0.95 });
        }
        this.police.obstacles(this.obstacles);
        if (this.player.seat) this.player.seat = null;
        if (!this.fight.active) this.player.update(dt, move && !this.wheel.isOpen && !(this.warzone.active && this.warzone.busy) ? this.input : null, this.follow.yaw, this.world.collision, this.obstacles);
        if (this.boarding) {
          this.boarding.tick?.(dt);
          this.boarding.t -= dt;
          if (this.boarding.t <= 0) {
            const go = this.boarding.go;
            this.boarding = null;
            go();
          }
        }
      }
    }
    if (this.doorClose && (this.doorClose.t -= dt) <= 0) {
      this.vehicles.door(this.doorClose.car, 0, false);
      this.audio.crash(0.08);
      this.doorClose = null;
    }
    this.vehicles.update(dt);
    this.vehicles.fx.update(dt, this.camera, innerHeight);
    this.boats.update(dt, (b) => (b === this.boat ? this.boatSteer : 0));
    if (inWorld && !this.vehicle) {
      this.stairwell();
      const here = interiorAt(this.player.pos.x, this.player.pos.z);
      if (here !== this.inside && !this.doorBusy) this.setInside(here);
    }
    // tell the others where we are; draw where they are
    let mine: PeerState | null = null;
    if (inWorld && this.state !== 'leaving') {
      const s = this.myState;
      const v = this.vehicle;
      s.x = this.player.pos.x;
      s.y = this.player.pos.y;
      s.z = this.player.pos.z;
      s.yaw = v ? v.car.yaw : this.player.facing;
      s.speed = v ? Math.abs(v.car.v) : this.player.speed;
      s.mode = v ? v.kind : this.player.sitting ? 'sit' : 'walk';
      s.emote = this.emoteNo;
      s.eseq = this.emoteSeq;
      s.car = v?.kind === 'drive' ? { color: v.car.color, screen: v.car.screen, van: v.car.van, brake: v.car.braking, v: v.car.v, idx: this.vehicles.cars.indexOf(v.car) } : v?.kind === 'ride' ? { color: 0, screen: false, van: false, brake: Math.abs(v.car.v) < 0.5, v: v.car.v, idx: -1 } : undefined;
      mine = s;
    }
    this.mp.update(dt, mine, this.time?.minutes ?? 0);
    this.remotes.update(dt, t, this.mp, this.camera, inWorld && !this.overlay);
    // shared parked cars: hide ours while someone else is driving it
    const taken = this.remotes.drivenCars();
    for (let i = 0; i < this.vehicles.cars.length; i++) this.vehicles.cars[i].taken = taken.has(i) && !this.vehicles.cars[i].occupied;
    const playerPos = inWorld ? this.player.pos : null;
    // in a shared room someone else may run the city: follow them while their snapshots keep coming
    const follower = this.mp.shared && !this.mp.isHost && performance.now() - this.lastCity < 3000;
    this.crowd.puppet = this.traffic.puppet = follower;
    const stars = this.dying || !this.rules.police ? 0 : Math.max(this.combat.stars, this.robWanted);
    this.crowd.wanted = stars;
    if (this.police) {
      // Still reaches the police too: they hold position rather than close in
    if (this.held > 0) {
      this.held -= dt;
      this.police.update(dt, t, null, 0, true, this.tmpDir.set(0, 0, 1), 0, this.world.collision);
    } else {
      // The pursuit test needs the speed of whatever the player is moving in.
      // Player.speed is the walking velocity, which is near zero in a car
      // because the car is what has the speed — so this used to read as "on
      // foot, standing still" and the police never came after you driving.
      const chaseSpeed = this.vehicle ? this.vehicle.car.v : this.player.speed;
      this.police.update(dt, t, inWorld && !this.dying ? this.player.pos : null, stars, !!this.inside, this.camera.getWorldDirection(this.tmpDir), chaseSpeed, this.world.collision);
    }
      // the rotor sound follows whichever helicopter is closest, so a second one is audible
    const live = [this.police.heli, this.police.milHeli].filter((h) => h.present && h.falling < 0);
    const pp = this.player.pos;
    live.sort((a, b) => a.pos.distanceToSquared(pp) - b.pos.distanceToSquared(pp));
    this.audio.heli(live.length && !this.inside ? live[0].pos : null);
    }
    if (this.warzone.active) this.warzone.update(dt, t, playing && !this.overlay);
    this.crowd.rain = this.weather.intensity;
    // the city's roads: as wet as the rain, and always night (the RPG sets its own)
    if (this.mode !== 'rpg') {
      this.vehicles.wet = Math.min(1, this.weather.intensity * 1.3 + 0.2);
      this.vehicles.dark = true;
    }
    this.crowd.update(dt, t, playerPos, this.camera);
    this.tracers.update(dt, this.camera);
    if (inWorld) this.outskirts.update(this.player.pos);
    this.touch?.update(
      this.state === 'playing' && !this.overlay && !this.chat?.isOpen && !this.admin?.isOpen && !this.carScreen.isOpen && !this.dying,
      this.vehicle ? 'car' : 'foot',
      this.hud.useVerb,
    );
    this.voice?.update(dt, (id) => this.remotes.positionOf(id), this.muted, (id, on) => this.remotes.talking(id, on));
    this.blood.enabled = this.settings.data.blood !== false;
    this.blood.eye.copy(this.camera.position);
    this.blood.wet = this.mode === 'rpg' ? this.rpg.atmos.now.rain : Math.min(1, this.weather.intensity * 1.2);
    if (this.rpg.active) this.rpg.populace.eachDead((w) => this.blood.pool(w.pos, w));
    for (const n of this.crowd.npcs) {
      // the wounded who are still on their feet leave a trail
      if (n.dead < 0 && n.visible && n.hp < 70 && n.v > 0.3) this.blood.drip(n, n.pos.x, n.pos.y, n.pos.z, (70 - n.hp) / 70, dt);
      if (n.dead >= 0 && n.visible) this.blood.pool(n.pos, n);
      else if (n.dead < 0) this.blood.clear(n);
    }
    this.blood.update(dt);
    this.admin?.tick(dt);
    this.audio.siren(inWorld && this.crowd.police > 0 && !this.inside ? 1 : 0);
    if (this.blackoutT > 0) {
      this.blackoutT -= dt;
      worldUniforms.uEmit.value = this.blackoutT > 0 ? (Math.random() < 0.02 ? 0.4 : 0.03) : 1;
    }
    // traffic brakes for you (or your car), and never for its own passenger
    const leftInRoad = this.vehicles.cars.filter((c) => !c.occupied).map((c) => c.pos);
    // the host also brakes and pulls over for the other players, and scares people with their cars
    const others = this.mp.shared ? this.remotes.walkers() : [];
    if (this.mp.shared) {
      for (const d of this.remotes.drivers()) {
        leftInRoad.push(new THREE.Vector3(d.x, 0, d.z));
        this.crowd.threat(d.x, d.z, d.vx, d.vz);
      }
    }
    // Still stops the traffic too: the cars freeze where they are, mid-lane
    if (this.held > 0) this.traffic.update(dt, null, 0, [], []);
    else this.traffic.update(dt, this.vehicle?.kind === 'ride' ? null : playerPos, this.vehicle ? 99 : this.player.speed, leftInRoad, others);
    this.traffic.drawDrivers(dt, t, this.camera.position);
    // host: tell everyone what the city is doing
    this.cityT -= dt;
    if (this.cityT <= 0 && this.mp.shared && this.mp.isHost && this.mp.peers.size) {
      this.cityT = 0.5;
      this.mp.city({ n: this.crowd.snapshot(), ...this.traffic.snapshot() });
    }
    for (const c of this.traffic.cars) {
      if (!c.group.visible || c === (this.vehicle?.car as unknown)) continue;
      const cvx = Math.sin(c.yaw) * c.v, cvz = Math.cos(c.yaw) * c.v;
      this.crowd.threat(c.group.position.x, c.group.position.z, cvx * 0.6, cvz * 0.6);
      // and it can hit you. Traffic still brakes for anyone standing in the
      // road, so this mostly catches a driver who didn't see you, or one who
      // chose not to — which is exactly when it should matter.
      if (!this.vehicle && !this.inside) this.vehicleStrike(c.group.position, cvx, cvz, Math.abs(c.v), 'A car');
    }
    // the radio plays from its car; if that car has driven off out of the district, it's gone
    if (this.radioHost?.car && 'path' in this.radioHost.car && !this.radioHost.car.group.visible) {
      this.radio.off();
      this.radioHost = null;
    }
    this.radio.update(dt, this.radioHost?.pos() ?? null, this.headphones || (!!this.vehicle && this.radioHost?.car === this.vehicle.car), this.camera.position, this.settings.data.master, !!this.overlay);
    this.radio.setAudible(this.audio.enabled);
    const dv = this.vehicle;
    if (dv?.kind === 'drive') {
      // your own car: its engine, tyres and wind (the generic voice is for everything else)
      this.driveVoice?.mute();
      if (!this.engineVoice && this.audio.enabled) this.engineVoice = this.audio.engineVoice();
      const c = dv.car, d = c.dyn, vo = c.spec.voice, m = c.spec.mech;
      this.engineVoice?.set(c.pos, { rpm: d.rpm, idle: m.idle, redline: m.redline, load: d.load, speed: Math.abs(c.v), slip: d.wheels.reduce((a, w) => Math.max(a, w.slip), 0), cyl: vo.cyl, rough: vo.rough, whine: vo.whine, turbo: vo.turbo, diesel: vo.diesel, inside: this.follow.carView >= 2 && this.follow.carView <= 3, damage: c.damage.engine, boost: d.boostNow });
      // and the reservoir, so you can see what you've got left to spend
      this.hud.boost(d.boostable ? d.boost : null, d.boostNow > 0.3);
    } else {
      this.engineVoice?.mute();
      this.hud.boost(null, false);
      if (dv && this.driveVoice) this.driveVoice.setPosition(dv.car.group.position, Math.abs(dv.car.v));
    }
    for (const u of this.world.updaters) u(t, dt);
    this.tickRobbery(dt);
    if (this.rules.discovery) {
      this.tryDiscoverPower(dt);
      // the military come when you've been using these on people
      const g = militaryGrade(this.powers, this.combat.heat);
      if (g && g !== this.lastGrade) {
        this.lastGrade = g;
        this.hud.toast(g);
      }
      if (!g) this.lastGrade = null;
    }
    if (this.rpg.active) {
      // the wider world keeps its own day
      this.rpg.atmos.speed = this.overlay ? 0 : this.player.sitting ? 8 : 1;
      this.rpg.update(dt, playing && !this.overlay);
    } else {
      this.time.speed = this.clockHeld ? 0 : this.player.sitting ? 8 : 1;
      this.time.update(dt, t, this.state !== 'boot');
    }
    const focus = inWorld ? this.player.pos : this.camera.position;
    this.lighting.update(dt, t, focus);
    this.fx.uniforms.uRain.value = this.weather.intensity;
    this.fx.sync();
    this.weather.update(this.camera.position);
    this.sky.followCamera(this.camera);

    if (playing && (this.fight.active || this.warzone.active)) {
      if (!this.fight.hud.endOpen && !this.warzone.endOpen) this.padGlobals();
    } else if (playing) {
      this.padGlobals();
      this.updateControlContext();
      this.emotesAndPhotos();
      const fwd = this.camera.getWorldDirection(this.tmpV);
      this.interaction.update(this.player.pos, fwd, this.player.sitting || !!this.vehicle);
      const cur = this.interaction.current;
      const busy = performance.now() < this.sayingUntil;
      let verb: string = cur?.def.verb ?? 'Inspect';
      if (cur?.def.action === 'phone' && !this.phone.ringing) verb = 'Inspect';
      const car = this.vehicleOption();
      const carWins = !!car && (!cur || car.d < cur.spot.pos.distanceTo(this.player.pos) - 0.5);
      if (this.vehicle) {
        const v = this.vehicle;
        const stopping = v.kind === 'drive' ? v.car.leaving : !!v.car.taxi?.stopping;
        this.hud.setPrompt(v.kind === 'drive' ? carName(v.car) : 'Taxi', stopping ? 'Stopping…' : v.kind === 'ride' ? 'Ask to stop' : 'Get out', 'exitVehicle');
        if (this.carScreen.isOpen) this.hud.setPrompt(null);
        if (this.input.pressed('exitVehicle')) this.leaveVehicle();
        if (v.kind === 'drive' && v.car.screen && this.input.pressed('screen')) this.carScreen.open();
        if (v.kind === 'drive' && this.input.pressed('carCamera')) {
          this.follow.carView = (this.follow.carView + 1) % FollowCamera.CAR_VIEWS.length;
          this.hud.toast?.(`Camera: ${FollowCamera.CAR_VIEWS[this.follow.carView]}`);
        }
        if (this.input.pressed('radioPrev')) this.tuneRadio(-1);
        else if (this.input.pressed('radioNext')) this.tuneRadio(1);
      } else if (this.boat) {
        this.hud.setPrompt('Boat', Math.abs(this.boat.pos.z - RIVER_Z0) < 3 ? 'Step off' : 'Jump in', 'exitVehicle');
      } else if (!this.player.swimming && (this.riverOption() as unknown) && !cur) {
        const opt = this.riverOption()!;
        this.hud.setPrompt(opt.name, opt.verb);
        if (this.input.pressed('interact')) opt.go();
      } else if (this.player.swimming) {
        const atWall = this.player.pos.z < RIVER_Z0 + 1.4;
        this.hud.setPrompt(atWall ? 'Quay wall' : 'River', atWall ? 'Climb out' : 'Swim to the quay', 'jump');
        if (!atWall) this.hud.setPrompt(null);
      } else if (car && carWins) {
        this.hud.setPrompt(car.name, car.verb);
        if (this.input.pressed('interact')) car.go();
      } else {
        // nothing to look at here, but someone to talk to
        const rp = this.rpg.active && !this.player.sitting && !busy ? this.rpg.interaction(this.player.pos, fwd) : null;
        const who = !rp && (!cur || busy) ? this.crowd.nearestTalker(this.player.pos, fwd) : null;
        if (rp) {
          this.hud.setPrompt(rp.name, rp.verb);
          if (this.input.pressed('interact')) rp.go();
        } else if (who && !this.player.sitting) {
          this.hud.setPrompt(this.whoIs(who), 'Talk');
          if (this.input.pressed('interact')) this.crowd.talk(who, this.player.pos);
        } else {
          this.hud.setPrompt(cur && !busy ? cur.def.name : null, verb);
          // only claim the button when there's something to use (on a pad it's also reload)
          if (cur && !busy && this.input.pressed('interact')) this.interact();
        }
      }
      if (this.rules.quests) this.updateQuests(dt);
      if (this.rules.combat === 'street') this.updateCombat(dt);
      else if (this.rules.combat === 'none') {
        this.player.armPose = null;
        this.player.aimYaw = null;
        this.player.gun.visible = false;
        this.hud.combat(null);
      }
      this.serveTime(dt);
      // indoors the rooms sit far off the map; the HUD keeps the room's name
      if (!this.inside && this.rules.discovery && (!this.rpg.active || inD03(this.player.pos.x, this.player.pos.z))) this.discovery.update(this.player.pos.x, this.player.pos.z);
      this.updatePhone(dt);
      this.saveTimer -= dt;
      if (this.saveTimer <= 0) {
        this.saveTimer = 5;
        this.persist();
      }
    }
    if (this.state === 'landing') this.landing.setMeta(this.time.label, this.time.rainLabel);

    // under a roof? (station shed, bus shelter, awnings; interiors later)
    this.shelterT -= dt;
    if (this.shelterT <= 0 && inWorld) {
      this.shelterT = 0.25;
      const head = this.tmpV.set(this.player.pos.x, this.player.pos.y + 1.7, this.player.pos.z);
      const roof = this.world.collision.raycast(head, UP, 14) < 14;
      this.audio.setShelter(roof ? 1 : 0);
    }
    // a scene in progress has the camera (it blends in from, and back out to, where play put it)
    if (this.scenes.active && !this.scenes.handingBack && this.scenes.scene?.skippable !== false && (this.input.held('confirm') || this.input.held('cancel'))) {
      this.skipHeld += dt / 0.8;
      if (this.skipHeld >= 1) {
        this.skipHeld = 0;
        this.scenes.skip();
      }
    } else this.skipHeld = Math.max(0, this.skipHeld - dt * 3);
    this.scenes.update(dt);
    this.renderer.cinema(this.scenes.bars, this.scenes.dofFocus, this.scenes.dofAperture);
    this.sceneUi.update(this.scenes, this.skipHeld);
    this.audio.update(dt, this.camera, this.weather.intensity);
    this.input.endFrame();
    if (this.noRender) return;
    this.renderer.render(t);
    if (this.photo.wantShot) {
      const url = this.photo.capture(this.renderer.canvas);
      this.audio.footstep(1.6, false);
      this.input.rumble('ui');
      if (url) savePhoto({ id: `p${Date.now()}`, at: Date.now(), place: this.inside?.name ?? this.discovery.districtName, time: this.time.label, url }).then(() =>
          listPhotos().then((l) => {
            this.myPhotos = l;
            this.photo.setCount(l.length);
          }),
        );
    }
  }

  /** Title sequence: dip to black between shots. */
  private async cuts() {
    if (this.cutting || this.cine.remaining > 1.0) return;
    this.cutting = true;
    await this.fade(true, 900);
    if (this.state !== 'landing') {
      this.cutting = false;
      return;
    }
    this.cine.next();
    this.cine.update(0, this.t);
    this.lighting.focusNow(this.camera.position);
    this.landing.setShot(this.cine.shot.caption);
    await this.fade(false, 1400);
    this.cutting = false;
  }

  private updatePhone(dt: number) {
    const booth = this.world.interact.find((s) => s.id === 'payphone');
    if (!booth) return;
    const d = booth.pos.distanceTo(this.player.pos);
    this.phone.cooldown -= dt;
    if (!this.phone.ringing && d < 26 && d > 4 && this.phone.cooldown <= 0) {
      this.phone.ringing = true;
      this.phone.until = this.t + 34;
      this.audio.setPhoneRinging(true);
    }
    if (this.phone.ringing && (this.t > this.phone.until || d > 60)) {
      this.phone.ringing = false;
      this.phone.cooldown = this.phone.answered ? 240 : 90;
      this.audio.setPhoneRinging(false);
    }
  }
}

const UP = new THREE.Vector3(0, 1, 0);

function easeOut(x: number) {
  return 1 - Math.pow(1 - x, 3);
}

function clockText(sec: number) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** What to call a car in a prompt. */
function carName(c: DrivableCar) {
  const k: Record<string, string> = { pickup: 'Pickup', offroad: '4×4', truck: 'Truck', sports: 'Sports car', hatch: 'Hatchback', van: 'Van' };
  return (c.kind && k[c.kind]) ?? (c.van ? 'Van' : c.screen ? 'Electric car' : 'Car');
}
