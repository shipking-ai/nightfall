import { h, setOn, wait } from './dom';
import type { Entry } from '../data/archive';

/**
 * Almost nothing: a place name when you arrive somewhere, a prompt when
 * something can be looked at, a line of text when it is, and — rarely — a
 * discovery.
 */
export class Hud {
  el: HTMLElement;
  private loc: HTMLElement;
  private locCode: HTMLElement;
  private locName: HTMLElement;
  private prompt: HTMLElement;
  private promptName: HTMLElement;
  private promptVerb: HTMLElement;
  private caption: HTMLElement;
  private barkEl: HTMLElement;
  private quest: HTMLElement;
  private questKind: HTMLElement;
  private questText: HTMLElement;
  private questMeta: HTMLElement;
  private questFlashT = 0;
  private cross: HTMLElement;
  private health: HTMLElement;
  private healthBar: HTMLElement;
  private stars: HTMLElement;
  private weapon: HTMLElement;
  private hurtEl: HTMLElement;
  private toastEl: HTMLElement;
  private toastT = 0;
  private lastCombat = '';
  private barkTimer = 0;
  private hint: HTMLElement;
  private controls: HTMLElement;
  private disc: HTMLElement;
  private locTimer = 0;
  private capTimer = 0;
  private discQueue: Entry[] = [];
  private discBusy = false;
  private captionToken = 0;

  constructor(root: HTMLElement) {
    this.locCode = h('span', { class: 'meta' });
    this.locName = h('p', { class: 'hud__location-name' });
    this.loc = h('div', { class: 'hud__location', 'aria-live': 'polite' }, this.locCode, this.locName);
    this.promptName = h('span', { class: 'meta meta--paper' });
    this.promptVerb = h('span', { class: 'meta' });
    this.prompt = h('div', { class: 'hud__prompt' }, this.promptName, h('div', { class: 'hud__prompt-row' }, h('span', { class: 'key' }, 'E'), this.promptVerb));
    this.caption = h('div', { class: 'hud__caption', 'aria-live': 'polite' });
    this.hint = h('div', { class: 'hud__hint' });
    this.barkEl = h('div', { class: 'hud__bark', 'aria-live': 'polite' });
    this.questKind = h('span', { class: 'meta' });
    this.questText = h('p', { class: 'hud__quest-text' });
    this.questMeta = h('span', { class: 'meta meta--paper' });
    this.quest = h('div', { class: 'hud__quest', 'aria-live': 'polite' }, this.questKind, this.questText, this.questMeta);
    this.cross = h('div', { class: 'hud__cross', 'aria-hidden': 'true' });
    this.healthBar = h('i');
    this.health = h('div', { class: 'hud__health', role: 'meter', 'aria-label': 'Health' }, this.healthBar);
    this.stars = h('div', { class: 'hud__stars', 'aria-label': 'Wanted level' });
    this.weapon = h('div', { class: 'hud__weapon' });
    this.hurtEl = h('div', { class: 'hud__hurt', 'aria-hidden': 'true' });
    this.toastEl = h('div', { class: 'hud__toast', role: 'status' });
    this.controls = h(
      'div',
      { class: 'hud__controls' },
      row(['W', 'A', 'S', 'D'], 'Move'),
      row(['Shift'], 'Run'),
      row(['Space'], 'Jump'),
      row(['M'], 'Map'),
      row(['J'], 'Archive'),
      row(['Esc'], 'Pause'),
    );
    this.disc = h('div', { class: 'discovery', role: 'status' });
    this.el = h('section', { class: 'layer is-passive hud' }, this.hurtEl, this.loc, this.quest, this.stars, this.cross, this.health, this.weapon, this.toastEl, this.disc, this.barkEl, this.caption, this.prompt, this.hint, this.controls);
    root.append(this.el);
  }

  show(on: boolean) {
    setOn(this.el, on);
  }

  location(name: string, code: string) {
    this.locCode.textContent = code === '—' ? 'Unmapped' : `District 03 · ${code.replace('D03 · ', '')}`;
    this.locName.textContent = name;
    setOn(this.loc, true);
    clearTimeout(this.locTimer);
    this.locTimer = window.setTimeout(() => setOn(this.loc, false), 4200);
  }

  /** what E would do right now (touch controls label their button with it) */
  get useVerb(): string | null {
    return this.prompt.classList.contains('is-on') ? this.promptVerb.textContent : null;
  }

  setPrompt(name: string | null, verb = 'Inspect') {
    if (name) {
      this.promptName.textContent = name;
      this.promptVerb.textContent = verb;
    }
    setOn(this.prompt, !!name);
  }

  async say(lines: string[], label?: string) {
    const token = ++this.captionToken;
    clearTimeout(this.capTimer);
    for (let i = 0; i < lines.length; i++) {
      if (token !== this.captionToken) return;
      this.caption.replaceChildren(...(label && i === 0 ? [h('small', {}, label)] : []), lines[i]);
      setOn(this.caption, true);
      const hold = 1800 + lines[i].length * 55;
      await wait(hold);
      if (token !== this.captionToken) return;
      if (i < lines.length - 1) {
        setOn(this.caption, false);
        await wait(500);
      }
    }
    setOn(this.caption, false);
  }

  /** Something someone in the street said: a quiet subtitle that doesn't interrupt anything. */
  bark(text: string, who?: string) {
    this.barkEl.replaceChildren(...(who ? [h('small', {}, who)] : []), `“${text}”`);
    setOn(this.barkEl, true);
    clearTimeout(this.barkTimer);
    this.barkTimer = window.setTimeout(() => setOn(this.barkEl, false), 1600 + text.length * 60);
  }

  /** Health, wanted stars, what you're holding, and the crosshair. null hides it all. */
  combat(c: { health: number; stars: number; weapon: string; ammo: string; cross: boolean; hot: boolean } | null) {
    const key = c ? `${Math.round(c.health)}|${c.stars}|${c.weapon}|${c.ammo}|${c.cross}|${c.hot}` : '';
    if (key === this.lastCombat) return;
    this.lastCombat = key;
    setOn(this.cross, !!c?.cross);
    setOn(this.health, !!c && c.health < 100);
    setOn(this.stars, !!c && c.stars > 0);
    setOn(this.weapon, !!c && c.weapon !== 'Fists');
    if (!c) return;
    this.healthBar.style.width = `${Math.max(0, c.health)}%`;
    this.health.classList.toggle('is-low', c.health < 30);
    this.health.setAttribute('aria-valuenow', String(Math.round(c.health)));
    this.stars.replaceChildren(...[0, 1, 2, 3, 4].map((i) => h('span', { class: i < c.stars ? 'on' : '' }, '\u2605')));
    this.stars.classList.toggle('is-hot', c.hot);
    this.weapon.replaceChildren(h('span', { class: 'meta' }, c.weapon), h('b', {}, c.ammo));
  }

  /** A red edge when you're hit. */
  hurt(k: number) {
    this.hurtEl.style.transition = 'none';
    this.hurtEl.style.opacity = String(Math.min(1, 0.35 + k));
    void this.hurtEl.offsetWidth;
    this.hurtEl.style.transition = 'opacity 900ms ease-out';
    this.hurtEl.style.opacity = '0';
  }

  /** A short system note (admin actions, kicks). */
  toast(text: string) {
    this.toastEl.textContent = text;
    setOn(this.toastEl, true);
    clearTimeout(this.toastT);
    this.toastT = window.setTimeout(() => setOn(this.toastEl, false), 3200);
  }

  /** The side-quest tracker (top right). null hides it. */
  objective(o: { title: string; text: string; meta: string } | null) {
    setOn(this.quest, !!o);
    if (!o) return;
    if (performance.now() > this.questFlashT) this.questKind.textContent = `Side quest \u00b7 ${o.title}`;
    if (this.questText.textContent !== o.text) this.questText.textContent = o.text;
    this.questMeta.textContent = o.meta;
  }

  /** A moment on the tracker: "New side quest", "Complete", "Failed". */
  questFlash(label: string, title: string) {
    this.questFlashT = performance.now() + 3500;
    this.questKind.textContent = `${label} \u00b7 ${title}`;
    this.quest.classList.remove('is-flash');
    void this.quest.offsetWidth;
    this.quest.classList.add('is-flash');
  }

  clearCaption() {
    this.captionToken++;
    setOn(this.caption, false);
  }

  setHint(text: string | null) {
    // touch screens don't click to look around
    if (text && document.body.classList.contains('is-touch') && /^Click/.test(text)) text = null;
    if (text) this.hint.replaceChildren(h('span', { class: 'meta meta--paper' }, text));
    setOn(this.hint, !!text);
  }

  showControls(on: boolean) {
    setOn(this.controls, on);
  }

  discovery(e: Entry) {
    this.discQueue.push(e);
    if (!this.discBusy) this.nextDiscovery();
  }

  private async nextDiscovery() {
    const e = this.discQueue.shift();
    if (!e) {
      this.discBusy = false;
      return;
    }
    this.discBusy = true;
    this.disc.classList.remove('is-leaving');
    this.disc.replaceChildren(
      h('div', { class: 'discovery__label meta meta--accent' }, 'Discovery'),
      h('h2', { class: 'discovery__title' }, e.title),
      h('p', { class: 'discovery__quote' }, `“${e.quote}”`),
      h('span', { class: 'discovery__entry meta' }, `+ New archive entry  ·  ${e.no}`),
    );
    await wait(40);
    setOn(this.disc, true);
    await wait(5600);
    this.disc.classList.add('is-leaving');
    await wait(1000);
    setOn(this.disc, false);
    this.disc.classList.remove('is-leaving');
    await wait(500);
    this.nextDiscovery();
  }
}

function row(keys: string[], label: string) {
  return h('div', {}, ...keys.map((k) => h('span', { class: 'key' }, k)), h('span', { class: 'meta' }, label));
}
