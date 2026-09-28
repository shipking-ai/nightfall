import { PAD_BUTTONS, type PadButton } from './actions';

export type PadFamily = 'xbox' | 'playstation' | 'generic';

/** How a stick's raw position becomes a movement: a radial dead zone, then a curve. */
export interface StickShape {
  deadzone: number;
  /** 'linear' straight through, 'classic' squared for fine aim, 'dynamic' fine near the centre and quick at the edge */
  curve: 'linear' | 'classic' | 'dynamic';
}

export interface Stick {
  x: number;
  y: number;
  /** 0..1 after the dead zone and curve */
  mag: number;
}

/** One connected controller, read once per frame. */
export class Pad {
  readonly index: number;
  family: PadFamily = 'generic';
  id = '';
  connected = false;
  /** 0..1 per standard button (analog for the triggers) */
  values = new Float32Array(PAD_BUTTONS.length);
  private prev = new Float32Array(PAD_BUTTONS.length);
  private edges = new Set<number>();
  axes = [0, 0, 0, 0];
  lastUsed = 0;
  /** the native pad, for rumble */
  raw: Gamepad | null = null;

  constructor(index: number) {
    this.index = index;
  }

  read(g: Gamepad | null, now: number) {
    this.raw = g;
    this.connected = !!g && g.connected;
    if (!g || !this.connected) {
      this.values.fill(0);
      this.prev.fill(0);
      this.edges.clear();
      this.axes = [0, 0, 0, 0];
      return;
    }
    if (g.id !== this.id) {
      this.id = g.id;
      this.family = familyOf(g.id);
    }
    this.prev.set(this.values);
    for (let i = 0; i < PAD_BUTTONS.length; i++) {
      const b = g.buttons[i];
      this.values[i] = b ? (typeof b.value === 'number' && b.value > 0 ? b.value : b.pressed ? 1 : 0) : 0;
      if (this.values[i] > 0.5 && this.prev[i] <= 0.5) {
        this.edges.add(i);
        this.lastUsed = now;
      }
    }
    for (let i = 0; i < 4; i++) {
      const v = g.axes[i] ?? 0;
      this.axes[i] = Number.isFinite(v) ? v : 0;
    }
    if (Math.hypot(this.axes[0], this.axes[1]) > 0.4 || Math.hypot(this.axes[2], this.axes[3]) > 0.4) this.lastUsed = now;
    // some browsers report the triggers only as axes on non-standard mappings; the D-pad as a hat axis
    if (g.mapping !== 'standard') this.fallbackMapping(g);
  }

  /** Non-standard layouts (old Firefox, some Linux drivers): D-pad on a hat axis, triggers on axes 2/5. */
  private fallbackMapping(g: Gamepad) {
    const hat = g.axes[9];
    if (typeof hat === 'number' && hat >= -1.1 && hat <= 1.1) {
      // 8 positions from -1 (up) clockwise in steps of 2/7; > 1 means centred
      const dir = Math.round(((hat + 1) * 7) / 2);
      const set = (i: number, on: boolean) => {
        if (on && this.values[i] <= 0.5) this.edges.add(i);
        this.values[i] = on ? 1 : this.values[i];
      };
      set(12, dir === 0 || dir === 1 || dir === 7);
      set(15, dir >= 1 && dir <= 3);
      set(13, dir >= 3 && dir <= 5);
      set(14, dir >= 5 && dir <= 7);
    }
  }

  held(b: PadButton, threshold = 0.5) {
    return this.values[PAD_BUTTONS.indexOf(b)] > threshold;
  }

  value(b: PadButton) {
    return this.values[PAD_BUTTONS.indexOf(b)];
  }

  /** True once per press; consumed on read. */
  pressed(b: PadButton) {
    const i = PAD_BUTTONS.indexOf(b);
    if (!this.edges.has(i)) return false;
    this.edges.delete(i);
    return true;
  }

  /** Was this pressed this frame (without consuming)? */
  peek(b: PadButton) {
    return this.edges.has(PAD_BUTTONS.indexOf(b));
  }

  endFrame() {
    this.edges.clear();
  }

  stick(which: 0 | 1, shape: StickShape): Stick {
    return shapeStick(this.axes[which * 2], this.axes[which * 2 + 1], shape);
  }

  /** Any button held at all (used to wait for a remap press to finish). */
  anyHeld() {
    for (const v of this.values) if (v > 0.5) return true;
    return false;
  }

  /** The first newly pressed button this frame, if any (remapping). */
  firstEdge(): PadButton | null {
    for (const i of this.edges) return PAD_BUTTONS[i];
    return null;
  }
}

export function shapeStick(x: number, y: number, s: StickShape): Stick {
  const r = Math.hypot(x, y);
  if (r <= s.deadzone || r < 1e-4) return { x: 0, y: 0, mag: 0 };
  // rescale so the edge of the dead zone is 0, not a jump to `deadzone`
  let m = Math.min(1, (r - s.deadzone) / (1 - s.deadzone));
  if (s.curve === 'classic') m = m * m;
  else if (s.curve === 'dynamic') m = m < 0.7 ? 0.55 * Math.pow(m / 0.7, 1.8) : 0.55 + ((m - 0.7) / 0.3) * 0.45;
  return { x: (x / r) * m, y: (y / r) * m, mag: m };
}

export function familyOf(id: string): PadFamily {
  const s = id.toLowerCase();
  // Xbox first: its id also says "Wireless Controller"
  if (/xbox|xinput|045e|microsoft/.test(s)) return 'xbox';
  if (/dualsense|dualshock|playstation|054c|ps[345]|^wireless controller/.test(s)) return 'playstation';
  return 'generic';
}

/** Every pad the browser knows about, polled once per frame. */
export class Gamepads {
  pads: Pad[] = [0, 1, 2, 3].map((i) => new Pad(i));
  /** the pad that was used most recently (player one's, unless a second player claims another) */
  active: Pad | null = null;
  onConnect?: (p: Pad, on: boolean) => void;
  private supported = typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';

  constructor() {
    if (typeof addEventListener === 'undefined') return;
    addEventListener('gamepadconnected', (e) => {
      const p = this.pads[(e as GamepadEvent).gamepad.index];
      if (p) this.onConnect?.(p, true);
    });
    addEventListener('gamepaddisconnected', (e) => {
      const p = this.pads[(e as GamepadEvent).gamepad.index];
      if (!p) return;
      p.read(null, 0);
      if (this.active === p) this.active = this.pads.find((q) => q.connected) ?? null;
      this.onConnect?.(p, false);
    });
  }

  poll(now: number) {
    if (!this.supported) return;
    let list: (Gamepad | null)[] = [];
    try {
      list = navigator.getGamepads() as (Gamepad | null)[];
    } catch {
      return;
    }
    for (let i = 0; i < this.pads.length; i++) this.pads[i].read(list[i] ?? null, now);
    let best: Pad | null = this.active?.connected ? this.active : null;
    for (const p of this.pads) if (p.connected && (!best || p.lastUsed > best.lastUsed)) best = p;
    this.active = best;
  }

  endFrame() {
    for (const p of this.pads) p.endFrame();
  }

  get any() {
    return this.pads.some((p) => p.connected);
  }
}
