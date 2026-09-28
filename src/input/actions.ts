/**
 * Every thing a player can do, named once. Gameplay asks for actions, never
 * for keys or buttons, so the same code runs on keyboard + mouse, a phone,
 * an Xbox pad, a DualSense or anything else the browser calls a gamepad.
 *
 * Bindings live in bindings.ts; what a device calls a button lives in glyphs.ts.
 */

/** Physical buttons of the W3C "standard" gamepad mapping, by index. */
export const PAD_BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'Up', 'Down', 'Left', 'Right', 'Home'] as const;
export type PadButton = (typeof PAD_BUTTONS)[number];

/**
 * Groups decide where a binding can collide with another (remapping warns only
 * inside a group) and which list a remapping screen shows.
 */
export type ActionGroup = 'move' | 'foot' | 'vehicle' | 'warzone' | 'fight' | 'explore' | 'system';

export interface ActionDef {
  label: string;
  group: ActionGroup;
  /** can't be remapped (menu navigation, pause) */
  fixed?: boolean;
}

const DEFS = {
  // moving and looking (analog on a pad; the keyboard's are digital)
  forward: { label: 'Move forward', group: 'move' },
  back: { label: 'Move back', group: 'move' },
  left: { label: 'Move left', group: 'move' },
  right: { label: 'Move right', group: 'move' },
  jump: { label: 'Jump / climb', group: 'foot' },
  sprint: { label: 'Sprint', group: 'foot' },
  crouch: { label: 'Crouch', group: 'foot' },
  interact: { label: 'Interact · get in', group: 'foot' },
  attack: { label: 'Attack · fire', group: 'foot' },
  aim: { label: 'Aim', group: 'foot' },
  reload: { label: 'Reload', group: 'foot' },
  nextWeapon: { label: 'Next weapon', group: 'foot' },
  prevWeapon: { label: 'Previous weapon', group: 'foot' },
  weapon1: { label: 'Fists', group: 'foot' },
  weapon2: { label: 'Pistol', group: 'foot' },
  weapon3: { label: 'SMG', group: 'foot' },
  // cars and boats
  throttle: { label: 'Accelerate', group: 'vehicle' },
  brake: { label: 'Brake · reverse', group: 'vehicle' },
  steerLeft: { label: 'Steer left', group: 'vehicle' },
  steerRight: { label: 'Steer right', group: 'vehicle' },
  handbrake: { label: 'Handbrake', group: 'vehicle' },
  horn: { label: 'Horn', group: 'vehicle' },
  exitVehicle: { label: 'Get out', group: 'vehicle' },
  radioNext: { label: 'Radio: next station', group: 'vehicle' },
  radioPrev: { label: 'Radio: previous station', group: 'vehicle' },
  screen: { label: 'Dash screen', group: 'vehicle' },
  // WARZONE extras
  melee: { label: 'Melee', group: 'warzone' },
  scoreboard: { label: 'Scoreboard', group: 'warzone' },
  armor: { label: 'Armour plate', group: 'warzone' },
  // FIGHT
  light: { label: 'Light attack', group: 'fight' },
  heavy: { label: 'Heavy attack', group: 'fight' },
  block: { label: 'Block · parry', group: 'fight' },
  dodge: { label: 'Dodge', group: 'fight' },
  grab: { label: 'Grab · throw', group: 'fight' },
  special: { label: 'Special', group: 'fight' },
  lockOn: { label: 'Switch target', group: 'fight' },
  // around the city
  map: { label: 'Map', group: 'explore' },
  archive: { label: 'Archive', group: 'explore' },
  emote: { label: 'Emotes (hold)', group: 'explore' },
  photo: { label: 'Photo mode', group: 'explore' },
  chat: { label: 'Chat', group: 'explore' },
  mic: { label: 'Microphone', group: 'explore' },
  // menus
  pause: { label: 'Pause', group: 'system', fixed: true },
  confirm: { label: 'Confirm', group: 'system', fixed: true },
  cancel: { label: 'Back', group: 'system', fixed: true },
  navUp: { label: 'Up', group: 'system', fixed: true },
  navDown: { label: 'Down', group: 'system', fixed: true },
  navLeft: { label: 'Left', group: 'system', fixed: true },
  navRight: { label: 'Right', group: 'system', fixed: true },
  tabPrev: { label: 'Previous tab', group: 'system', fixed: true },
  tabNext: { label: 'Next tab', group: 'system', fixed: true },
  admin: { label: 'Admin tools', group: 'system' },
} satisfies Record<string, ActionDef>;

export type Action = keyof typeof DEFS;
export const ACTIONS: Record<Action, ActionDef> = DEFS;

export const GROUP_LABELS: Record<ActionGroup, string> = {
  move: 'Moving',
  foot: 'On foot',
  vehicle: 'Cars and boats',
  warzone: 'Warzone',
  fight: 'Fight',
  explore: 'Around the city',
  system: 'Menus',
};
