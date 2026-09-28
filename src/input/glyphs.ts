import type { Action, PadButton } from './actions';
import type { Device, Input } from '../core/Input';

/**
 * What to call a button on the device in the player's hands. Prompts are
 * built with `glyph(action)` (an element carrying `data-glyph`), and
 * `refreshGlyphs` re-labels every one of them when the device changes, so
 * nobody holding a DualSense is ever told to press E.
 */

const XBOX: Record<PadButton, string> = {
  A: 'A', B: 'B', X: 'X', Y: 'Y', LB: 'LB', RB: 'RB', LT: 'LT', RT: 'RT',
  View: 'View', Menu: 'Menu', LS: 'LS', RS: 'RS', Up: '↑', Down: '↓', Left: '←', Right: '→', Home: 'Xbox',
};
const PS: Record<PadButton, string> = {
  A: '✕', B: '○', X: '□', Y: '△', LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2',
  View: 'Touchpad', Menu: 'Options', LS: 'L3', RS: 'R3', Up: '↑', Down: '↓', Left: '←', Right: '→', Home: 'PS',
};
/** spoken names, for screen readers and the controls list */
const PS_NAMES: Partial<Record<PadButton, string>> = { A: 'Cross', B: 'Circle', X: 'Square', Y: 'Triangle' };

const KEY_NAMES: Record<string, string> = {
  Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt',
  Escape: 'Esc', Enter: 'Enter', Backspace: '⌫', Tab: 'Tab', Backquote: '`', BracketLeft: '[', BracketRight: ']',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', PageUp: 'PgUp', PageDown: 'PgDn',
  Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', WheelUp: 'Wheel ↑', WheelDown: 'Wheel ↓',
};

export function keyName(code: string): string {
  if (code.startsWith('Shift+')) return `Shift+${keyName(code.slice(6))}`;
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

export function padName(b: PadButton, device: Device): string {
  return device === 'playstation' ? PS[b] : XBOX[b];
}

export function padSpoken(b: PadButton, device: Device): string {
  return device === 'playstation' ? PS_NAMES[b] ?? PS[b] : XBOX[b];
}

/** Class modifiers for the face-button colours (Xbox A green, PS cross blue, …). */
function faceClass(b: PadButton, device: Device) {
  if (!['A', 'B', 'X', 'Y'].includes(b)) return ['LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS'].includes(b) ? 'glyph--pill' : 'glyph--dpad';
  return `glyph--face glyph--${device === 'playstation' ? 'ps' : 'xb'}-${b.toLowerCase()}`;
}

let input: Input | null = null;

/** Called once by the app; glyphs follow this input from then on. */
export function bindGlyphs(i: Input) {
  input = i;
  i.on('device', () => refreshGlyphs());
  i.bindings.onChange = () => refreshGlyphs();
}

/** The label for an action on the current device (first binding), e.g. "E", "X", "□". */
export function label(a: Action, device: Device | null = input?.device ?? 'kbm'): string {
  if (!input) return '';
  const b = input.bindings.get(a);
  if (device === 'kbm' || device === 'touch' || !device) return b.kbm[0] ? keyName(b.kbm[0]) : '';
  return b.pad[0] ? padName(b.pad[0], device) : '';
}

/**
 * A prompt glyph for an action; stays correct when the device changes.
 * `special` overrides the pad button shown (the sticks, which aren't actions).
 */
export function glyph(a: Action | 'moveStick' | 'lookStick', extra = ''): HTMLElement {
  const el = document.createElement('span');
  el.dataset.glyph = a;
  if (extra) el.dataset.glyphExtra = extra;
  paint(el);
  return el;
}

function paint(el: HTMLElement) {
  const a = el.dataset.glyph as Action | 'moveStick' | 'lookStick';
  const device = input?.device ?? 'kbm';
  const pad = input?.isPad ?? false;
  el.className = 'glyph';
  if (a === 'moveStick' || a === 'lookStick') {
    if (pad) {
      el.classList.add('glyph--stick');
      el.textContent = a === 'moveStick' ? (device === 'playstation' ? 'L' : 'LS') : device === 'playstation' ? 'R' : 'RS';
    } else {
      el.classList.add('glyph--key');
      el.textContent = a === 'moveStick' ? 'WASD' : 'Mouse';
    }
    return;
  }
  const b = input?.bindings.get(a);
  if (!b) return;
  if (pad && b.pad[0]) {
    const btn = b.pad[0];
    el.classList.add(...faceClass(btn, device).split(' '));
    el.textContent = padName(btn, device);
    el.setAttribute('aria-label', padSpoken(btn, device));
  } else {
    el.classList.add('glyph--key');
    el.textContent = b.kbm[0] ? keyName(b.kbm[0]) : '—';
    el.removeAttribute('aria-label');
  }
  el.hidden = pad ? !b.pad[0] : !b.kbm[0];
}

export function refreshGlyphs(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-glyph]').forEach(paint);
}

/** A row for a controls strip: glyph + what it does. */
export function hintRow(a: Action | 'moveStick' | 'lookStick', text: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'hintrow';
  const t = document.createElement('span');
  t.className = 'meta';
  t.textContent = text;
  row.append(glyph(a), t);
  return row;
}

export function currentDevice(): Device {
  return input?.device ?? 'kbm';
}
