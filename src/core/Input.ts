import { Emitter } from './Emitter';
import type { Action, PadButton } from '../input/actions';
import { Bindings } from '../input/bindings';
import { Gamepads, shapeStick, type Pad, type PadFamily, type StickShape } from '../input/Gamepads';
import { Haptics, type HapticEvent } from '../input/Haptics';

/** What the player is holding right now (prompts, glyphs and the interface follow it). */
export type Device = 'kbm' | 'touch' | PadFamily;

export interface PadLook {
  sensX: number;
  sensY: number;
  /** multiplier while aiming down sights */
  aimSens: number;
  /** extra turn speed after holding the stick at the edge, 0..1 */
  accel: number;
  invertX: boolean;
  invertY: boolean;
  /** swap the sticks (move on the right, look on the left) */
  southpaw: boolean;
}

export type HoldMode = 'hold' | 'toggle';

/** Anything that can drive a character: the main player, or a second local player on another pad. */
export interface Controls {
  held(a: Action): boolean;
  pressed(a: Action): boolean;
  value(a: Action): number;
  /** camera-relative movement intent: x right, y forward, mag 0..1 */
  move(): { x: number; y: number; mag: number };
}

/**
 * Every input device, behind named actions.
 *
 * Keyboard + mouse (pointer-locked look), touch (the TouchControls press the
 * same keys), and up to four gamepads. The most recently used device decides
 * which prompts are shown. A gamepad needs no pointer lock.
 *
 * The raw key API (`isDown`, `consume`) is still here for the few places that
 * really do mean a specific key (text fields, the admin panel).
 */
export class Input extends Emitter<{ device: Device }> implements Controls {
  private down = new Set<string>();
  private pressedKeys = new Set<string>();
  /** mouse movement this frame, in pixels */
  lookX = 0;
  lookY = 0;
  /** right-stick look this frame, in radians (already dead-zoned, curved, scaled and inverted) */
  stickYaw = 0;
  stickPitch = 0;
  /** mouse wheel notches this frame */
  wheel = 0;
  enabled = false;
  private dragging = false;

  bindings = new Bindings();
  pads = new Gamepads();
  haptics = new Haptics();
  device: Device = 'kbm';
  shape: StickShape = { deadzone: 0.14, curve: 'dynamic' };
  look: PadLook = { sensX: 1, sensY: 1, aimSens: 0.6, accel: 0.5, invertX: false, invertY: false, southpaw: false };
  modes: Record<'sprint' | 'aim' | 'crouch', HoldMode> = { sprint: 'hold', aim: 'hold', crouch: 'toggle' };
  /** set by gameplay while aiming (slower look) */
  aiming = false;
  /** set by gameplay: aim assist slows the stick near a target (0 = none, 1 = full stop) */
  aimSlow = 0;
  /** look speed scale from a scope's zoom (WARZONE sets it while aiming) */
  zoomScale = 1;
  zoomSens = true;
  /** the pad reserved for a second local player (FIGHT versus); player one never reads it */
  reservedPad: Pad | null = null;

  private toggles = new Map<Action, boolean>();
  private edgeAt = 0;
  private accelT = 0;
  private lastT = 0;

  constructor(private target: HTMLElement) {
    super();
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
      this.down.add(e.code);
      this.pressedKeys.add(e.code);
      // synthetic keys come from the touch controls: that's still a touch player
      if (e.isTrusted) this.use('kbm');
      if (this.enabled && (e.code === 'Space' || e.code === 'Tab')) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
    addEventListener('mousemove', (e) => {
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 3 && !this.isTouchDevice) this.use('kbm');
      if (!this.enabled) return;
      if (document.pointerLockElement === this.target || this.dragging) {
        this.lookX += e.movementX;
        this.lookY += e.movementY;
      }
    });
    addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.use('touch');
      else if (e.pointerType === 'mouse') this.use('kbm');
    });
    target.addEventListener('mousedown', (e) => {
      this.dragging = true;
      // mouse buttons read like keys: Mouse0 (left), Mouse1 (middle), Mouse2 (right)
      this.down.add(`Mouse${e.button}`);
      this.pressedKeys.add(`Mouse${e.button}`);
    });
    addEventListener('mouseup', (e) => {
      this.dragging = false;
      this.down.delete(`Mouse${e.button}`);
    });
    target.addEventListener('contextmenu', (e) => this.enabled && e.preventDefault());
    addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      const s = Math.sign(e.deltaY);
      this.wheel += s;
      if (s) this.pressedKeys.add(s > 0 ? 'WheelDown' : 'WheelUp');
    });
    this.pads.onConnect = (p, on) => {
      if (on) this.use(p.family);
      else if (!this.pads.any && this.isPad) this.use(this.isTouchDevice ? 'touch' : 'kbm');
    };
    this.applyBodyClasses();
  }

  /* ─────────────────────────── devices ─────────────────────────── */

  /** phones and tablets: no pointer lock; looking comes from the touch controls */
  touch = false;
  private get isTouchDevice() {
    return this.touch;
  }

  get isPad() {
    return this.device === 'xbox' || this.device === 'playstation' || this.device === 'generic';
  }

  /** Player one's pad, if they're on one. */
  get pad(): Pad | null {
    const a = this.pads.active;
    return a && a !== this.reservedPad ? a : this.pads.pads.find((p) => p.connected && p !== this.reservedPad) ?? null;
  }

  private use(d: Device) {
    if (d === this.device) return;
    this.device = d;
    this.applyBodyClasses();
    this.emit('device', d);
  }

  private applyBodyClasses() {
    if (typeof document === 'undefined') return;
    const b = document.body.classList;
    b.toggle('input-pad', this.isPad);
    b.toggle('input-kbm', this.device === 'kbm');
    b.toggle('input-touch', this.device === 'touch');
    b.toggle('pad-xbox', this.device === 'xbox' || this.device === 'generic');
    b.toggle('pad-playstation', this.device === 'playstation');
  }

  get locked(): boolean {
    return this.touch || this.isPad || document.pointerLockElement === this.target;
  }

  /* ─────────────────────────── per frame ─────────────────────────── */

  /** Read the pads and turn the right stick into look. Call once at the start of a frame. */
  poll(now: number) {
    const dt = this.lastT ? Math.min(0.05, (now - this.lastT) / 1000) : 0;
    this.lastT = now;
    this.pads.poll(now);
    const pad = this.pad;
    if (pad && pad.lastUsed > this.edgeAt) {
      this.edgeAt = pad.lastUsed;
      this.use(pad.family);
    }
    this.stickYaw = this.stickPitch = 0;
    if (!pad || !this.enabled) return;
    const s = pad.stick(this.look.southpaw ? 0 : 1, this.shape);
    if (s.mag > 0.92) this.accelT = Math.min(1, this.accelT + dt / 0.45);
    else this.accelT = Math.max(0, this.accelT - dt * 4);
    const accel = 1 + this.look.accel * 1.2 * smooth(Math.max(0, this.accelT - 0.3) / 0.7);
    const aim = this.aiming ? this.look.aimSens : 1;
    const slow = 1 - Math.min(0.85, this.aimSlow);
    // radians per second at full deflection
    const zoom = this.zoomSens ? this.zoomScale : 1;
    const yawRate = 3.2 * this.look.sensX * accel * aim * slow * zoom;
    const pitchRate = 2.1 * this.look.sensY * aim * slow * zoom;
    this.stickYaw = s.x * yawRate * dt * (this.look.invertX ? -1 : 1);
    this.stickPitch = s.y * pitchRate * dt * (this.look.invertY ? -1 : 1);
  }

  endFrame(): void {
    this.pressedKeys.clear();
    this.pads.endFrame();
    this.lookX = 0;
    this.lookY = 0;
    this.wheel = 0;
  }

  /* ─────────────────────────── actions ─────────────────────────── */

  held(a: Action): boolean {
    const b = this.bindings.get(a);
    for (const code of b.kbm) if (this.keyHeld(code)) return true;
    const pad = this.pad;
    if (pad) for (const btn of b.pad) if (pad.held(btn)) return true;
    return false;
  }

  /** True once per press of any of the action's bindings; consumed on read. */
  pressed(a: Action): boolean {
    const b = this.bindings.get(a);
    for (const code of b.kbm) if (this.keyPressed(code)) return true;
    const pad = this.pad;
    if (pad) for (const btn of b.pad) if (pad.pressed(btn)) return true;
    return false;
  }

  /** Was it pressed this frame (without using the press up)? */
  peek(a: Action): boolean {
    const b = this.bindings.get(a);
    for (const code of b.kbm) {
      const [mod, key] = split(code);
      if (this.pressedKeys.has(key) && (!mod || this.shift)) return true;
    }
    const pad = this.pad;
    if (pad) for (const btn of b.pad) if (pad.peek(btn)) return true;
    return false;
  }

  /** 0..1: analog triggers on a pad, 0 or 1 from a key. */
  value(a: Action): number {
    const b = this.bindings.get(a);
    let v = 0;
    for (const code of b.kbm) if (this.keyHeld(code)) v = 1;
    const pad = this.pad;
    if (pad) for (const btn of b.pad) v = Math.max(v, pad.value(btn));
    return v;
  }

  /**
   * Hold or toggle, as the player chose in Settings (sprint, aim, crouch).
   * A toggle turns itself off when `release` says so (sprint stops when you stop).
   */
  state(a: 'sprint' | 'aim' | 'crouch', release = false): boolean {
    if (this.modes[a] === 'hold') return this.held(a);
    let on = this.toggles.get(a) ?? false;
    if (this.pressed(a)) on = !on;
    if (release) on = false;
    this.toggles.set(a, on);
    return on;
  }

  resetToggles() {
    this.toggles.clear();
  }

  /** Movement intent, camera-relative: the left stick (analog), or WASD. */
  move(): { x: number; y: number; mag: number } {
    let x = 0, y = 0;
    if (this.held('forward')) y += 1;
    if (this.held('back')) y -= 1;
    if (this.held('right')) x += 1;
    if (this.held('left')) x -= 1;
    const len = Math.hypot(x, y);
    if (len > 0) return { x: x / len, y: y / len, mag: 1 };
    const pad = this.pad;
    if (!pad) return { x: 0, y: 0, mag: 0 };
    const s = pad.stick(this.look.southpaw ? 1 : 0, { deadzone: this.shape.deadzone, curve: 'linear' });
    return { x: s.x, y: -s.y, mag: s.mag };
  }

  /** Steering, -1 (left) .. 1 (right): the left stick, or A/D. */
  steer(): number {
    let s = 0;
    if (this.held('steerLeft')) s -= 1;
    if (this.held('steerRight')) s += 1;
    if (s) return s;
    const pad = this.pad;
    if (!pad) return 0;
    const st = shapeStick(pad.axes[this.look.southpaw ? 2 : 0], 0, { deadzone: this.shape.deadzone, curve: 'classic' });
    return st.x;
  }

  rumble(e: HapticEvent, scale = 1) {
    if (this.isPad) this.haptics.play(this.pad, e, scale);
  }

  /* ─────────────────────────── raw keys ─────────────────────────── */

  private get shift() {
    return this.down.has('ShiftLeft') || this.down.has('ShiftRight');
  }

  private keyHeld(code: string) {
    const [mod, key] = split(code);
    return this.down.has(key) && (!mod || this.shift);
  }

  private keyPressed(code: string) {
    const [mod, key] = split(code);
    if (!this.pressedKeys.has(key) || (mod && !this.shift)) return false;
    this.pressedKeys.delete(key);
    return true;
  }

  /** A button that isn't a key (touch controls): held while `down`. */
  setVirtual(code: string, down: boolean) {
    if (down) {
      this.down.add(code);
      this.pressedKeys.add(code);
    } else this.down.delete(code);
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** True once per physical press; consumed on read. */
  consume(code: string): boolean {
    if (!this.pressedKeys.has(code)) return false;
    this.pressedKeys.delete(code);
    return true;
  }

  /** The first key pressed this frame (remapping). */
  firstKey(): string | null {
    for (const k of this.pressedKeys) return k;
    return null;
  }

  async lock(): Promise<boolean> {
    if (this.locked) return true;
    try {
      await (this.target.requestPointerLock() as unknown as Promise<void> | undefined);
      return true;
    } catch {
      return false;
    }
  }

  unlock(): void {
    if (document.pointerLockElement === this.target) document.exitPointerLock();
  }

  /** A second local player's controls on their own pad (FIGHT versus). */
  padControls(pad: Pad): Controls {
    const binds = this.bindings;
    const shape = this.shape;
    return {
      held: (a) => binds.get(a).pad.some((b) => pad.held(b)),
      pressed: (a) => binds.get(a).pad.some((b) => pad.pressed(b)),
      value: (a) => Math.max(0, ...binds.get(a).pad.map((b) => pad.value(b))),
      move: () => {
        const s = pad.stick(0, { deadzone: shape.deadzone, curve: 'linear' });
        let x = s.x, y = -s.y, mag = s.mag;
        if (!mag) {
          x = (pad.held('Right') ? 1 : 0) - (pad.held('Left') ? 1 : 0);
          y = (pad.held('Up') ? 1 : 0) - (pad.held('Down') ? 1 : 0);
          mag = Math.min(1, Math.hypot(x, y));
        }
        return { x, y, mag };
      },
    };
  }

  /**
   * Keyboard and mouse plus one particular pad (or none): player one in a
   * local versus, who mustn't be driven by the other player's controller.
   */
  controlsWith(pad: Pad | null): Controls {
    const pc = pad ? this.padControls(pad) : null;
    const kb = (a: Action) => this.bindings.get(a).kbm;
    return {
      held: (a) => kb(a).some((c) => this.keyHeld(c)) || !!pc?.held(a),
      pressed: (a) => kb(a).some((c) => this.keyPressed(c)) || !!pc?.pressed(a),
      value: (a) => Math.max(kb(a).some((c) => this.keyHeld(c)) ? 1 : 0, pc?.value(a) ?? 0),
      move: () => {
        const on = (a: Action) => kb(a).some((c) => this.keyHeld(c));
        const x = (on('right') ? 1 : 0) - (on('left') ? 1 : 0), y = (on('forward') ? 1 : 0) - (on('back') ? 1 : 0);
        const len = Math.hypot(x, y);
        if (len > 0) return { x: x / len, y: y / len, mag: 1 };
        return pc ? pc.move() : { x: 0, y: 0, mag: 0 };
      },
    };
  }

  /** Is this pad button held on player one's pad? (menus) */
  padHeld(b: PadButton) {
    return !!this.pad?.held(b);
  }
}

function split(code: string): [boolean, string] {
  return code.startsWith('Shift+') ? [true, code.slice(6)] : [false, code];
}

function smooth(x: number) {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}
