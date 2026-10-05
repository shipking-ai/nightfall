import { ACTIONS, type Action, type PadButton } from './actions';
import { readJSON, writeJSON } from '../core/storage';

/**
 * Default bindings, and the player's changes to them.
 *
 * Keyboard + mouse codes are KeyboardEvent.code values, plus `Mouse0`/`Mouse1`/
 * `Mouse2` for buttons and `WheelUp`/`WheelDown` for the wheel. A `Shift+`
 * prefix makes a chord. Pad bindings use the standard-mapping button names.
 *
 * Moving and looking on a pad come from the sticks (analog, dead-zoned and
 * curved in Gamepads.ts); the move actions here are the digital fallback.
 *
 * One physical button can mean different things in different situations (X is
 * "interact" on foot and "light attack" in FIGHT): gameplay only ever asks for
 * the actions that make sense where the player is, so these never collide.
 */
export interface Binding {
  kbm: string[];
  pad: PadButton[];
}

export const DEFAULT_BINDINGS: Record<Action, Binding> = {
  forward: { kbm: ['KeyW', 'ArrowUp'], pad: [] },
  back: { kbm: ['KeyS', 'ArrowDown'], pad: [] },
  left: { kbm: ['KeyA', 'ArrowLeft'], pad: [] },
  right: { kbm: ['KeyD', 'ArrowRight'], pad: [] },
  jump: { kbm: ['Space'], pad: ['A'] },
  sprint: { kbm: ['ShiftLeft', 'ShiftRight'], pad: ['LS'] },
  crouch: { kbm: ['KeyC', 'ControlLeft'], pad: ['B'] },
  interact: { kbm: ['KeyE'], pad: ['X'] },
  attack: { kbm: ['Mouse0', 'KeyF'], pad: ['RT'] },
  aim: { kbm: ['Mouse2'], pad: ['LT'] },
  reload: { kbm: ['KeyR'], pad: ['X'] },
  nextWeapon: { kbm: ['KeyQ', 'WheelDown'], pad: ['Y', 'Right'] },
  prevWeapon: { kbm: ['WheelUp'], pad: ['Left'] },
  weapon1: { kbm: ['Digit1'], pad: [] },
  weapon2: { kbm: ['Digit2'], pad: [] },
  weapon3: { kbm: ['Digit3'], pad: [] },

  throttle: { kbm: ['KeyW', 'ArrowUp'], pad: ['RT'] },
  brake: { kbm: ['KeyS', 'ArrowDown'], pad: ['LT'] },
  steerLeft: { kbm: ['KeyA', 'ArrowLeft'], pad: [] },
  steerRight: { kbm: ['KeyD', 'ArrowRight'], pad: [] },
  handbrake: { kbm: ['Space'], pad: ['A', 'RB'] },
  boost: { kbm: ['ShiftLeft', 'ShiftRight'], pad: ['X'] },
  horn: { kbm: ['KeyH'], pad: ['LS'] },
  exitVehicle: { kbm: ['KeyE'], pad: ['B', 'Y'] },
  radioNext: { kbm: ['KeyR'], pad: ['Right'] },
  radioPrev: { kbm: ['Shift+KeyR'], pad: ['Left'] },
  screen: { kbm: ['KeyV'], pad: ['Up'] },
  carCamera: { kbm: ['KeyC'], pad: ['Down'] },
  // Powers get their own keys. Everything they were sharing is already taken by
  // something that matters: E is interact (getting in a car), Q cycles weapons,
  // R reloads, F attacks, V is the car screen. On foot these three are free.
  powerUse: { kbm: ['KeyV'], pad: ['RB'] },
  powerPrev: { kbm: ['WheelUp', 'KeyX'], pad: ['LB'] },
  powerNext: { kbm: ['WheelDown', 'KeyZ'], pad: ['RB'] },

  melee: { kbm: ['KeyV'], pad: ['RS'] },
  scoreboard: { kbm: ['Tab'], pad: ['View'] },
  armor: { kbm: ['Digit4'], pad: ['Up'] },
  lethal: { kbm: ['KeyG'], pad: ['RB'] },
  tactical: { kbm: ['KeyZ'], pad: ['LB'] },
  streak: { kbm: ['Digit5', 'KeyB'], pad: ['Down'] },

  light: { kbm: ['Mouse0', 'KeyJ'], pad: ['X'] },
  heavy: { kbm: ['Mouse2', 'KeyK'], pad: ['Y'] },
  block: { kbm: ['ShiftLeft', 'KeyL'], pad: ['LB'] },
  dodge: { kbm: ['KeyC', 'ControlLeft'], pad: ['B'] },
  grab: { kbm: ['KeyE'], pad: ['RB'] },
  special: { kbm: ['KeyQ', 'KeyI'], pad: ['RT'] },
  lockOn: { kbm: ['Mouse1', 'KeyF'], pad: ['RS'] },

  map: { kbm: ['KeyM'], pad: ['View'] },
  archive: { kbm: ['KeyJ'], pad: [] },
  emote: { kbm: ['KeyG'], pad: ['Down'] },
  photo: { kbm: ['KeyP'], pad: ['Up'] },
  chat: { kbm: ['KeyT', 'Enter'], pad: [] },
  mic: { kbm: ['KeyN'], pad: [] },

  pause: { kbm: ['Escape'], pad: ['Menu'] },
  confirm: { kbm: ['Enter'], pad: ['A'] },
  cancel: { kbm: ['Escape', 'Backspace'], pad: ['B'] },
  navUp: { kbm: ['ArrowUp'], pad: ['Up'] },
  navDown: { kbm: ['ArrowDown'], pad: ['Down'] },
  navLeft: { kbm: ['ArrowLeft'], pad: ['Left'] },
  navRight: { kbm: ['ArrowRight'], pad: ['Right'] },
  tabPrev: { kbm: ['BracketLeft', 'PageUp'], pad: ['LB'] },
  tabNext: { kbm: ['BracketRight', 'PageDown'], pad: ['RB'] },
  admin: { kbm: ['Backquote', 'F10'], pad: [] },
};

const KEY = 'nightfall.bindings.v1';

type Overrides = Partial<Record<Action, Partial<Binding>>>;

/** The live binding table: defaults with the player's remaps on top. */
export class Bindings {
  private overrides: Overrides;
  private table = {} as Record<Action, Binding>;
  onChange?: () => void;

  constructor() {
    this.overrides = readJSON<Overrides>(KEY) ?? {};
    this.rebuild();
  }

  get(a: Action): Binding {
    return this.table[a];
  }

  /** Replace one slot of an action's binding (slot 0 is the primary). */
  set(a: Action, device: 'kbm' | 'pad', code: string, slot = 0) {
    if (ACTIONS[a].fixed) return;
    const cur = [...this.table[a][device]] as string[];
    cur[slot] = code;
    const o = (this.overrides[a] ??= {});
    (o as Record<string, string[]>)[device] = cur.filter(Boolean);
    this.save();
  }

  /** Other actions in the same group already on this code (to warn before a remap). */
  conflicts(a: Action, device: 'kbm' | 'pad', code: string): Action[] {
    const g = ACTIONS[a].group;
    return (Object.keys(ACTIONS) as Action[]).filter((b) => b !== a && ACTIONS[b].group === g && (this.table[b][device] as string[]).includes(code));
  }

  reset(device?: 'kbm' | 'pad') {
    if (!device) this.overrides = {};
    else for (const o of Object.values(this.overrides)) if (o) delete o[device];
    this.save();
  }

  isCustom(a: Action, device: 'kbm' | 'pad') {
    return !!this.overrides[a]?.[device];
  }

  private save() {
    writeJSON(KEY, this.overrides);
    this.rebuild();
    this.onChange?.();
  }

  private rebuild() {
    for (const a of Object.keys(DEFAULT_BINDINGS) as Action[]) {
      const d = DEFAULT_BINDINGS[a];
      const o = this.overrides[a];
      this.table[a] = { kbm: (o?.kbm as string[] | undefined) ?? d.kbm, pad: (o?.pad as PadButton[] | undefined) ?? d.pad };
    }
  }
}
