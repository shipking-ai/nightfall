import { h, setOn } from '../../ui/dom';

/**
 * Fishing: the line goes in and you wait (less, the better you are at it);
 * a bite, and you have a moment to strike; then a fight, reeling in taps
 * while the fish pulls. Reel too hard and the line snaps. One button for
 * all of it (A on a pad, Enter or a click otherwise).
 */

export interface Catch {
  name: string;
  weight: number;
}

type Phase = 'wait' | 'bite' | 'fight' | 'done';

export class Fishing {
  el: HTMLElement;
  private title: HTMLElement;
  private line: HTMLElement;
  private reel: HTMLButtonElement;
  private tension: HTMLElement;
  private progress: HTMLElement;
  private meters: HTMLElement;
  private phase: Phase = 'wait';
  private t = 0;
  private ten = 0;
  private prog = 0;
  private pull = 0;
  private raf = 0;
  private last = 0;
  private skill = 0;
  private fish: Catch = { name: 'Perch', weight: 0.4 };
  /** caught (or null: it got away / you packed up) */
  onEnd: (c: Catch | null, minutes: number) => void = () => {};
  private started = 0;

  constructor(root: HTMLElement) {
    this.title = h('h2', { class: 'fish__title' }, 'Fishing');
    this.line = h('p', { class: 'fish__line' });
    this.reel = h('button', { class: 'fish__reel', type: 'button' }, 'Strike') as HTMLButtonElement;
    this.reel.addEventListener('click', () => this.press());
    const quit = h('button', { class: 'fish__quit', type: 'button' }, 'Pack up');
    quit.addEventListener('click', () => this.finish(null));
    this.tension = h('span', { class: 'fish__fill fish__fill--ten' });
    this.progress = h('span', { class: 'fish__fill' });
    this.meters = h('div', { class: 'fish__meters' },
      h('label', { class: 'fish__meter' }, h('span', { class: 'meta' }, 'Line'), h('span', { class: 'fish__track' }, this.progress)),
      h('label', { class: 'fish__meter' }, h('span', { class: 'meta' }, 'Tension'), h('span', { class: 'fish__track' }, this.tension)));
    this.el = h('section', { class: 'layer fish', role: 'dialog', 'aria-label': 'Fishing' },
      h('div', { class: 'fish__card' }, this.title, this.line, this.meters, h('div', { class: 'fish__row' }, this.reel, quit)));
    root.append(this.el);
  }

  get isOpen() {
    return this.el.classList.contains('is-on');
  }

  /** skill: Survival 0–100; fish: what's biting here */
  open(skill: number, fish: Catch) {
    this.skill = skill;
    this.fish = fish;
    this.phase = 'wait';
    this.t = 2 + Math.random() * 6 * (1 - skill / 150);
    this.ten = 0;
    this.prog = 0;
    this.started = performance.now();
    setOn(this.el, true);
    this.render();
    this.last = performance.now();
    cancelAnimationFrame(this.raf);
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.step(dt);
      if (this.isOpen) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    requestAnimationFrame(() => this.reel.focus({ preventScroll: true }));
  }

  close() {
    setOn(this.el, false);
    cancelAnimationFrame(this.raf);
  }

  private step(dt: number) {
    this.t -= dt;
    if (this.phase === 'wait' && this.t <= 0) {
      this.phase = 'bite';
      this.t = 0.8 + this.skill / 200;
      this.render();
    } else if (this.phase === 'bite' && this.t <= 0) {
      this.phase = 'wait';
      this.t = 2 + Math.random() * 5;
      this.line.textContent = 'It spat the hook. The line goes slack. Wait…';
      this.render(false);
    } else if (this.phase === 'fight') {
      // the fish pulls in surges; tension eases when you stop reeling
      this.pull -= dt;
      if (this.pull <= 0) this.pull = 0.4 + Math.random() * 1.2;
      const surge = this.pull > 0.9;
      this.ten = Math.max(0, this.ten + (surge ? 0.35 + this.fish.weight * 0.12 : -0.38) * dt);
      this.prog = Math.max(0, this.prog - dt * 0.03 * this.fish.weight);
      if (this.ten >= 1) return this.snap();
      this.meter();
    }
  }

  private press() {
    if (this.phase === 'bite') {
      this.phase = 'fight';
      this.ten = 0.3;
      this.prog = 0.05;
      this.render();
      return;
    }
    if (this.phase === 'fight') {
      this.ten += 0.13 + this.fish.weight * 0.02;
      this.prog += (0.065 + this.skill / 1500) / Math.max(0.7, this.fish.weight * 0.6);
      if (this.ten >= 1) return this.snap();
      if (this.prog >= 1) return this.finish(this.fish);
      this.meter();
      return;
    }
    if (this.phase === 'wait') {
      // striking at nothing scares them off for a moment
      this.t += 1.5;
      this.line.textContent = 'Nothing there. Patience.';
    }
  }

  private snap() {
    this.phase = 'done';
    this.line.textContent = 'The line snaps. Something big goes back to the dark.';
    this.render(false);
    setTimeout(() => this.finish(null), 1400);
  }

  private finish(c: Catch | null) {
    if (!this.isOpen) return;
    this.close();
    const minutes = Math.max(5, Math.round((performance.now() - this.started) / 1000 * 1.5));
    this.onEnd(c, minutes);
  }

  private render(setLine = true) {
    const p = this.phase;
    if (setLine) this.line.textContent = p === 'wait' ? 'The line’s in the water. Wait for a bite…' : p === 'bite' ? 'A bite! Strike now!' : p === 'fight' ? 'Reel it in — tap, but don’t let the line go tight.' : '';
    this.reel.textContent = p === 'fight' ? 'Reel' : 'Strike';
    this.el.classList.toggle('is-bite', p === 'bite');
    this.meters.hidden = p !== 'fight';
    this.meter();
  }

  private meter() {
    this.progress.style.width = `${Math.round(Math.min(1, this.prog) * 100)}%`;
    this.tension.style.width = `${Math.round(Math.min(1, this.ten) * 100)}%`;
    this.tension.classList.toggle('is-hot', this.ten > 0.75);
  }
}
