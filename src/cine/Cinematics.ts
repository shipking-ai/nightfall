import * as THREE from 'three';

/**
 * In-engine cinematics: the camera takes over from play without a cut, shots
 * are framed on the characters where they actually are (so the scene can
 * happen anywhere the game puts it), the people in it act (look, gesture,
 * speak, feel), and at the end the camera hands back to play by blending
 * into wherever the gameplay camera now is.
 *
 * A scene is a list of shots (each a framing on subjects, with a move, a
 * lens, a focus and a length) and a list of beats (things that happen at a
 * time: a line of dialogue, a gesture, a look). Shots cut between each
 * other; the first blends in from the gameplay camera and the scene blends
 * out to it. Depth of field and bars come in with the scene.
 *
 * Every move has a reason: establishing shots show where, tracking follows
 * someone going somewhere, push-ins come with something said that matters,
 * over-the-shoulder is a conversation, handheld is when things go wrong.
 */

export type ShotKind =
  | 'establish' | 'wide' | 'track' | 'dolly' | 'pushIn' | 'pullOut' | 'closeUp' | 'extremeCloseUp'
  | 'overShoulder' | 'twoShot' | 'low' | 'high' | 'handheld' | 'pov' | 'orbit' | 'chase';

/** Something the camera can frame: where they are, where their head is, which way they face. */
export interface Subject {
  pos(): THREE.Vector3;
  head(): THREE.Vector3;
  yaw(): number;
}

export interface Shot {
  kind: ShotKind;
  dur: number;
  a: Subject;
  /** the other person in the conversation (over-the-shoulder, two-shot, POV) */
  b?: Subject;
  /** which side of the line of action (-1 / 1): keep it the same across a conversation */
  side?: -1 | 1;
  /** lens (vertical fov, degrees) */
  fov?: number;
  /** depth of field aperture (0 off) */
  dof?: number;
  /** extra distance / height tweaks */
  dist?: number;
  height?: number;
  /** a caption for the shot (a place name) */
  caption?: string;
}

export interface Beat {
  at: number;
  do: () => void;
}

export interface Line {
  at: number;
  dur: number;
  who: string;
  text: string;
  /** the speaker (their face talks while the line is up) */
  face?: { talk: number };
}

export interface Scene {
  shots: Shot[];
  beats?: Beat[];
  lines?: Line[];
  /** bars (default on) */
  bars?: boolean;
  /** seconds to blend from the gameplay camera, and back */
  blendIn?: number;
  blendOut?: number;
  /** holding a button skips it (default true) */
  skippable?: boolean;
  /** time runs slower (a moment at the end of a match) */
  slow?: number;
  onEnd?: () => void;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const ease = (x: number) => x * x * (3 - 2 * x);

export class Cinematics {
  scene: Scene | null = null;
  t = 0;
  private shotT = 0;
  private shotI = 0;
  private total = 0;
  private fromPos = new THREE.Vector3();
  private fromQ = new THREE.Quaternion();
  private fromFov = 60;
  private endPos = new THREE.Vector3();
  private endQ = new THREE.Quaternion();
  private endFov = 60;
  private outT = -1;
  private focus = 5;
  private seed = Math.random() * 100;
  /** current framing for the renderer (bars 0..1, focus distance, aperture) */
  bars = 0;
  dofFocus = 5;
  dofAperture = 0;
  /** the caption / subtitle now showing */
  caption = '';
  line: Line | null = null;
  private beatI = 0;
  reducedMotion = false;
  /** how far a line of sight is clear (set by the game), so wide shots never sit inside a wall */
  occlude: ((from: THREE.Vector3, dir: THREE.Vector3, max: number) => number) | null = null;
  /** the time scale the game should run at */
  timeScale = 1;

  constructor(public camera: THREE.PerspectiveCamera) {}

  get active() {
    return !!this.scene;
  }

  /** In a blend-out: the game camera is back in charge, eased into. */
  get handingBack() {
    return this.outT >= 0;
  }

  play(scene: Scene) {
    this.scene = scene;
    this.t = 0;
    this.shotT = 0;
    this.shotI = 0;
    this.beatI = 0;
    this.outT = -1;
    this.total = scene.shots.reduce((a, s) => a + s.dur, 0);
    this.fromPos.copy(this.camera.position);
    this.fromQ.copy(this.camera.quaternion);
    this.fromFov = this.camera.fov;
    this.endFov = this.camera.fov;
    this.focus = scene.shots[0] ? this.camera.position.distanceTo(scene.shots[0].a.head()) : 5;
    this.timeScale = scene.slow ?? 1;
  }

  /** Cut to a new shot now (and optionally one after it): a conversation's coverage. */
  cut(shot: Shot, then?: Shot) {
    const sc = this.scene;
    if (!sc || this.outT >= 0) return;
    sc.shots = sc.shots.slice(0, this.shotI).concat(then ? [shot, then] : [shot]);
    this.total = sc.shots.reduce((a, s) => a + s.dur, 0);
    this.shotT = 0;
    // a cut past the first shot never blends from the gameplay camera again
    if (this.shotI === 0) this.t = Math.max(this.t, sc.blendIn ?? 1.2);
  }

  /** Cut it short: go straight to handing back. */
  skip() {
    if (!this.scene || this.outT >= 0) return;
    this.t = this.total;
    this.shotI = this.scene.shots.length;
    for (; this.scene.beats && this.beatI < this.scene.beats.length; this.beatI++) this.scene.beats[this.beatI].do();
    this.beginOut();
  }

  private beginOut() {
    this.outT = 0;
    this.endPos.copy(this.camera.position);
    this.endQ.copy(this.camera.quaternion);
    this.endFov = this.camera.fov;
    this.line = null;
    this.caption = '';
    this.timeScale = 1;
  }

  /**
   * Call after the gameplay camera has been placed for this frame: while a
   * scene plays this overrides it; while handing back it blends from the
   * scene's last frame into it.
   */
  update(dt: number) {
    const sc = this.scene;
    if (!sc) {
      this.bars += (0 - this.bars) * Math.min(1, dt * 3);
      this.dofAperture += (0 - this.dofAperture) * Math.min(1, dt * 3);
      return;
    }
    const cam = this.camera;
    if (this.outT >= 0) {
      // back to play: from where the scene left the camera to where the game has it now
      const dur = sc.blendOut ?? 1.1;
      this.outT += dt;
      const k = ease(Math.min(1, this.outT / dur));
      const gamePos = _v.copy(cam.position), gameQ = _q.copy(cam.quaternion), gameFov = cam.fov;
      cam.position.lerpVectors(this.endPos, gamePos, k);
      cam.quaternion.slerpQuaternions(this.endQ, gameQ, k);
      cam.fov = this.endFov + (gameFov - this.endFov) * k;
      cam.updateProjectionMatrix();
      this.bars += (0 - this.bars) * Math.min(1, dt * 4);
      this.dofAperture += (0 - this.dofAperture) * Math.min(1, dt * 4);
      if (k >= 1) {
        const end = sc.onEnd;
        this.scene = null;
        this.outT = -1;
        end?.();
      }
      return;
    }
    this.t += dt;
    this.shotT += dt;
    // beats and lines
    for (; sc.beats && this.beatI < sc.beats.length && sc.beats[this.beatI].at <= this.t; this.beatI++) sc.beats[this.beatI].do();
    this.line = null;
    for (const l of sc.lines ?? []) {
      const on = this.t >= l.at && this.t < l.at + l.dur;
      if (on) this.line = l;
      if (l.face) l.face.talk = on ? 1 : 0;
    }
    // which shot
    while (this.shotI < sc.shots.length && this.shotT > sc.shots[this.shotI].dur) {
      this.shotT -= sc.shots[this.shotI].dur;
      this.shotI++;
    }
    if (this.shotI >= sc.shots.length) {
      for (const l of sc.lines ?? []) if (l.face) l.face.talk = 0;
      this.beginOut();
      return;
    }
    const shot = sc.shots[this.shotI];
    const u = Math.min(1, this.shotT / shot.dur);
    const { pos, look, fov } = this.frame(shot, u);
    // never inside a wall: pull in along the line of sight to just in front of whatever's in the way
    if (this.occlude && shot.kind !== 'pov' && shot.kind !== 'closeUp' && shot.kind !== 'extremeCloseUp' && shot.kind !== 'overShoulder') {
      const dir = _w.subVectors(pos, look);
      const len = dir.length();
      if (len > 0.5) {
        dir.divideScalar(len);
        const free = this.occlude(look, dir, len);
        if (free < len) pos.copy(look).addScaledVector(dir, Math.max(0.8, free - 0.35));
      }
    }
    this.caption = shot.caption ?? '';
    // blend in from the gameplay camera over the first moments (no cut into the scene)
    const bin = sc.blendIn ?? 1.2;
    const k = this.shotI === 0 && bin > 0 ? ease(Math.min(1, this.t / bin)) : 1;
    _m.lookAt(pos, look, THREE.Object3D.DEFAULT_UP);
    _q.setFromRotationMatrix(_m);
    cam.position.lerpVectors(this.fromPos, pos, k);
    cam.quaternion.slerpQuaternions(this.fromQ, _q, k);
    cam.fov = this.fromFov + (fov - this.fromFov) * k;
    cam.updateProjectionMatrix();
    // the focus pulls to the subject's distance; the aperture opens for close work
    const want = cam.position.distanceTo(shot.a.head());
    // on a cut the focus racks quickly to the new subject, then follows it gently
    this.focus += (want - this.focus) * Math.min(1, dt * (this.shotT < 0.35 ? 14 : 3.5));
    this.dofFocus = this.focus;
    this.dofAperture += ((shot.dof ?? this.defaultDof(shot.kind)) * (sc.bars === false ? 0.6 : 1) - this.dofAperture) * Math.min(1, dt * 3);
    this.bars += ((sc.bars === false ? 0 : 1) - this.bars) * Math.min(1, dt * 2.5);
  }

  private defaultDof(k: ShotKind) {
    return k === 'closeUp' || k === 'extremeCloseUp' ? 1.6 : k === 'overShoulder' || k === 'pov' ? 1.2 : k === 'pushIn' || k === 'twoShot' ? 0.7 : k === 'establish' || k === 'wide' || k === 'high' ? 0 : 0.35;
  }

  /** The camera for a shot at progress u (0..1): where it is, what it looks at, its lens. */
  private frame(s: Shot, u: number): { pos: THREE.Vector3; look: THREE.Vector3; fov: number } {
    const A = s.a.pos(), H = s.a.head(), yaw = s.a.yaw();
    const fwd = _w.set(Math.sin(yaw), 0, Math.cos(yaw)).clone();
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const side = s.side ?? 1;
    const e = ease(u);
    const pos = new THREE.Vector3(), look = new THREE.Vector3();
    let fov = s.fov ?? 40;
    const hand = (amp: number) => {
      if (this.reducedMotion) return;
      const t = this.t + this.seed;
      pos.x += amp * (Math.sin(t * 1.3) * 0.6 + Math.sin(t * 2.9) * 0.3);
      pos.y += amp * (Math.sin(t * 1.7 + 1) * 0.5 + Math.sin(t * 3.7) * 0.2);
      look.x += amp * Math.sin(t * 1.1 + 2) * 0.8;
      look.y += amp * Math.sin(t * 2.3) * 0.5;
    };
    switch (s.kind) {
      case 'establish': {
        // wide and high, drifting slowly round the place
        const d = s.dist ?? 22, h = s.height ?? 9;
        const a = yaw + Math.PI + side * (0.6 + 0.25 * e);
        pos.set(A.x + Math.sin(a) * d, A.y + h - 1.5 * e, A.z + Math.cos(a) * d);
        look.copy(A).setY(A.y + 1.2);
        fov = s.fov ?? 45;
        break;
      }
      case 'wide': {
        const d = s.dist ?? 8;
        pos.copy(A).addScaledVector(fwd, d * 0.8).addScaledVector(right, side * d * 0.6).setY(A.y + (s.height ?? 1.6));
        look.copy(A).setY(A.y + 1.1);
        fov = s.fov ?? 42;
        break;
      }
      case 'track': {
        // alongside them as they go, a little ahead
        const d = s.dist ?? 3.5;
        pos.copy(A).addScaledVector(right, side * d).addScaledVector(fwd, 0.8).setY(A.y + (s.height ?? 1.4));
        look.copy(H).addScaledVector(fwd, 0.6).setY(H.y - 0.2);
        fov = s.fov ?? 38;
        break;
      }
      case 'dolly': {
        // a slow lateral move across them
        const d = s.dist ?? 4;
        pos.copy(A).addScaledVector(fwd, d).addScaledVector(right, side * (-1.5 + 3 * e)).setY(A.y + (s.height ?? 1.5));
        look.copy(H).setY(H.y - 0.1);
        break;
      }
      case 'pushIn':
      case 'pullOut': {
        const k = s.kind === 'pushIn' ? e : 1 - e;
        const d = (s.dist ?? 4) * (1 - 0.55 * k);
        pos.copy(H).addScaledVector(fwd, d).addScaledVector(right, side * 0.35 * d).setY(H.y - 0.05);
        look.copy(H).setY(H.y - 0.05);
        fov = s.fov ?? 34;
        break;
      }
      case 'closeUp':
      case 'extremeCloseUp': {
        const ecu = s.kind === 'extremeCloseUp';
        const d = s.dist ?? (ecu ? 0.55 : 1.05);
        pos.copy(H).addScaledVector(fwd, d).addScaledVector(right, side * d * 0.3).setY(H.y + (ecu ? 0.03 : -0.02));
        look.copy(H).setY(H.y + (ecu ? 0.04 : -0.03));
        fov = s.fov ?? (ecu ? 24 : 30);
        // breathing room: the smallest drift
        if (!this.reducedMotion) pos.addScaledVector(fwd, -0.04 * e);
        break;
      }
      case 'overShoulder': {
        // behind B's shoulder, on the side of the line, looking at A's face
        const B = s.b ?? s.a;
        const bh = B.head(), ab = new THREE.Vector3().subVectors(H, bh).setY(0).normalize();
        const rb = new THREE.Vector3(ab.z, 0, -ab.x);
        pos.copy(bh).addScaledVector(ab, -0.55).addScaledVector(rb, side * 0.42).setY(bh.y + 0.05);
        look.copy(H).setY(H.y - 0.05).addScaledVector(rb, -side * 0.15);
        fov = s.fov ?? 32;
        break;
      }
      case 'twoShot': {
        const B = s.b ?? s.a;
        const bh = B.head();
        const mid = new THREE.Vector3().addVectors(H, bh).multiplyScalar(0.5);
        const ab = new THREE.Vector3().subVectors(bh, H).setY(0);
        const len = Math.max(0.8, ab.length());
        ab.normalize();
        const perp = new THREE.Vector3(ab.z, 0, -ab.x).multiplyScalar(side);
        const d = (s.dist ?? 1.6) + len;
        pos.copy(mid).addScaledVector(perp, d).setY(mid.y - 0.1);
        look.copy(mid).setY(mid.y - 0.15);
        fov = s.fov ?? 36;
        break;
      }
      case 'low': {
        pos.copy(A).addScaledVector(fwd, s.dist ?? 2.4).addScaledVector(right, side * 0.8).setY(A.y + 0.35);
        look.copy(H).setY(H.y + 0.1);
        fov = s.fov ?? 44;
        break;
      }
      case 'high': {
        pos.copy(A).addScaledVector(fwd, (s.dist ?? 3) * 0.6).addScaledVector(right, side * 1.2).setY(A.y + (s.height ?? 6));
        look.copy(A).setY(A.y + 0.5);
        fov = s.fov ?? 42;
        break;
      }
      case 'handheld': {
        const d = s.dist ?? 2.2;
        pos.copy(H).addScaledVector(fwd, d).addScaledVector(right, side * 0.7).setY(H.y - 0.2);
        look.copy(H).setY(H.y - 0.15);
        hand(0.05);
        fov = s.fov ?? 38;
        break;
      }
      case 'pov': {
        const B = s.b ?? s.a;
        pos.copy(B.head()).setY(B.head().y + 0.02);
        look.copy(H);
        fov = s.fov ?? 50;
        hand(0.008);
        break;
      }
      case 'orbit': {
        // round them slowly (a moment of victory, of loss)
        const d = s.dist ?? 3.4, a = yaw + side * (0.4 + 1.6 * e);
        pos.set(A.x + Math.sin(a) * d, A.y + (s.height ?? 1.5), A.z + Math.cos(a) * d);
        look.copy(H).setY(H.y - 0.2);
        fov = s.fov ?? 36;
        break;
      }
      case 'chase': {
        // behind and low, following a vehicle or a runner
        const d = s.dist ?? 6;
        pos.copy(A).addScaledVector(fwd, -d).addScaledVector(right, side * 1.2).setY(A.y + (s.height ?? 1.2));
        look.copy(A).addScaledVector(fwd, 6).setY(A.y + 1);
        hand(0.03);
        fov = s.fov ?? 50;
        break;
      }
    }
    return { pos, look, fov };
  }
}

/** A subject from an object that moves (a position, a head height, a heading). */
export function subject(pos: () => THREE.Vector3, yaw: () => number, headH = 1.62): Subject {
  const h = new THREE.Vector3();
  return { pos, yaw, head: () => h.copy(pos()).setY(pos().y + headH) };
}
