/**
 * The emote set: for the player (the wheel) and for people in the street,
 * who use the same animations when the moment calls for it.
 *
 * `hold` emotes stay until you move (sitting, leaning, arms crossed);
 * `full` ones stop your feet while they play.
 */
export interface Emote {
  id: string;
  label: string;
  clip: string;
  /** a looping clip to hold after the first one (sitting down → sitting) */
  then?: string;
  /** stays until the player moves */
  hold?: boolean;
  /** the whole body: can't walk through it */
  full?: boolean;
  /** a small mark for the wheel */
  mark: string;
}

export const EMOTES: Emote[] = [
  { id: 'wave', label: 'Wave', clip: 'emote.wave', mark: '✋' },
  { id: 'point', label: 'Point', clip: 'emote.point', mark: '☝' },
  { id: 'nod', label: 'Nod', clip: 'emote.nod', mark: '↓' },
  { id: 'shake', label: 'Shake head', clip: 'emote.shake', mark: '↔' },
  { id: 'thumbsUp', label: 'Thumbs up', clip: 'emote.thumbsUp', mark: '▲' },
  { id: 'thumbsDown', label: 'Thumbs down', clip: 'emote.thumbsDown', mark: '▼' },
  { id: 'shrug', label: 'Shrug', clip: 'emote.shrug', mark: '¯' },
  { id: 'clap', label: 'Clap', clip: 'emote.clap', mark: '✦' },

  { id: 'laugh', label: 'Laugh', clip: 'emote.laugh', mark: '☺' },
  { id: 'cry', label: 'Cry', clip: 'emote.cry', mark: '☂', full: true },
  { id: 'angry', label: 'Angry', clip: 'emote.angry', mark: '✊' },
  { id: 'confused', label: 'Confused', clip: 'emote.confused', mark: '?' },
  { id: 'beckon', label: 'Come here', clip: 'emote.beckon', mark: '↩' },
  { id: 'salute', label: 'Salute', clip: 'emote.salute', mark: '⌐' },
  { id: 'facepalm', label: 'Facepalm', clip: 'emote.facepalm', mark: '◐' },
  { id: 'surrender', label: 'Hands up', clip: 'emote.surrender', mark: 'Ψ', full: true },

  { id: 'crossArms', label: 'Cross arms', clip: 'idle.crossArms', hold: true, mark: '✕' },
  { id: 'handsHips', label: 'Hands on hips', clip: 'idle.handsHips', hold: true, mark: '◇' },
  { id: 'sit', label: 'Sit down', clip: 'emote.sit', then: 'emote.sitHold', hold: true, full: true, mark: '▁' },
  { id: 'lean', label: 'Lean', clip: 'idle.lean', hold: true, full: true, mark: '╱' },
  { id: 'lookAround', label: 'Look around', clip: 'idle.lookAround', mark: '◎' },
  { id: 'callOver', label: 'Call over', clip: 'emote.callOver', mark: '❝' },
  { id: 'shoo', label: 'Go away', clip: 'emote.shoo', mark: '⤳' },
  { id: 'handshake', label: 'Handshake', clip: 'emote.handshake', mark: '⚭' },
];

/** eight to a page on the wheel */
export const EMOTE_PAGES = [EMOTES.slice(0, 8), EMOTES.slice(8, 16), EMOTES.slice(16, 24)];

export function emoteById(id: string): Emote | undefined {
  return EMOTES.find((e) => e.id === id);
}
