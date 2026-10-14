import { h, setOn } from '../ui/dom';
import { glyph } from '../input/glyphs';
import type { Cinematics } from './Cinematics';

/**
 * What's on screen during a scene: subtitles (who, what), a caption for a
 * place, and a quiet "hold to skip". Every other HUD fades while it plays
 * (body.is-cine), and comes back as the camera hands back to play.
 */
export class CineUi {
  el: HTMLElement;
  private who: HTMLElement;
  private text: HTMLElement;
  private sub: HTMLElement;
  private cap: HTMLElement;
  private skipEl: HTMLElement;
  private skipBar: HTMLElement;
  private lastLine = '';
  private lastCap = '';

  constructor(root: HTMLElement) {
    this.who = h('span', { class: 'cine__who' });
    this.text = h('span', { class: 'cine__text' });
    this.sub = h('p', { class: 'cine__sub', 'aria-live': 'polite' }, this.who, this.text);
    this.cap = h('p', { class: 'cine__cap' });
    this.skipBar = h('i');
    this.skipEl = h('div', { class: 'cine__skip' }, glyph('confirm'), h('span', {}, 'Hold to skip'), h('b', {}, this.skipBar));
    this.el = h('section', { class: 'layer is-passive cine', 'aria-hidden': 'false' }, this.cap, this.sub, this.skipEl);
    root.append(this.el);
  }

  update(c: Cinematics, skipHeld: number) {
    const on = c.active && !c.handingBack;
    document.body.classList.toggle('is-cine', on);
    setOn(this.el, on);
    const line = c.line ? `${c.line.who}|${c.line.text}` : '';
    if (line !== this.lastLine) {
      this.lastLine = line;
      this.who.textContent = c.line?.who ?? '';
      this.text.textContent = c.line?.text ?? '';
      setOn(this.sub, !!c.line);
    }
    if (c.caption !== this.lastCap) {
      this.lastCap = c.caption;
      this.cap.textContent = c.caption;
      setOn(this.cap, !!c.caption);
    }
    setOn(this.skipEl, on && c.scene?.skippable !== false);
    this.skipBar.style.width = `${Math.round(Math.min(1, skipHeld) * 100)}%`;
  }
}
