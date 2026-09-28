import * as THREE from 'three';
import { h, setOn } from './dom';
import { glyph } from '../input/glyphs';
import type { Input } from '../core/Input';
import type { Collision } from '../world/Collision';

/**
 * Photo mode: the interface goes, a free camera orbits you, a few looks for
 * the picture (black and white, sodium, cold, noir), and a shutter. The city
 * keeps moving: rain keeps falling, people keep walking past.
 */
export const FILTERS: [string, string][] = [
  ['Natural', 'none'],
  ['Black and white', 'grayscale(1) contrast(1.12) brightness(1.04)'],
  ['Sodium', 'sepia(0.45) saturate(1.25) contrast(1.06)'],
  ['Cold', 'saturate(0.75) hue-rotate(-14deg) brightness(1.06) contrast(1.05)'],
  ['Noir', 'grayscale(1) contrast(1.65) brightness(0.92)'],
];

export class PhotoMode {
  el: HTMLElement;
  active = false;
  filter = 0;
  private yaw = 0;
  private pitch = 0.15;
  private dist = 3.4;
  private fov = 50;
  private offset = new THREE.Vector3();
  private filterEl: HTMLElement;
  private flash: HTMLElement;
  private count: HTMLElement;
  private stage: HTMLElement;
  /** set by the app: take the picture after this frame is drawn */
  wantShot = false;
  hideSelf = false;

  constructor(root: HTMLElement, stage: HTMLElement) {
    this.stage = stage;
    this.filterEl = h('span', { class: 'photo__filter' });
    this.count = h('span', { class: 'meta' });
    this.flash = h('div', { class: 'photo__flash', 'aria-hidden': 'true' });
    this.el = h(
      'section',
      { class: 'photo', 'aria-label': 'Photo mode' },
      h('div', { class: 'photo__frame', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')),
      h(
        'footer',
        { class: 'photo__bar' },
        h('span', { class: 'meta meta--paper' }, 'Photo mode'),
        h('span', { class: 'hintrow' }, glyph('lookStick'), h('span', { class: 'meta' }, 'Orbit')),
        h('span', { class: 'hintrow' }, glyph('moveStick'), h('span', { class: 'meta' }, 'Move')),
        h('span', { class: 'hintrow' }, glyph('aim'), glyph('attack'), h('span', { class: 'meta hint-pad' }, 'Zoom'), h('span', { class: 'meta hint-kbm' }, 'Wheel · zoom')),
        h('span', { class: 'hintrow' }, glyph('tabPrev'), glyph('tabNext'), h('span', { class: 'meta' }, 'Look'), this.filterEl),
        h('span', { class: 'hintrow' }, glyph('jump'), h('span', { class: 'meta' }, 'Take')),
        h('span', { class: 'hintrow' }, glyph('crouch'), h('span', { class: 'meta' }, 'Hide this')),
        h('span', { class: 'hintrow' }, glyph('cancel'), h('span', { class: 'meta' }, 'Done')),
        this.count,
      ),
      this.flash,
    );
    root.append(this.el);
  }

  enter(target: THREE.Vector3, camYaw: number) {
    this.active = true;
    this.yaw = camYaw;
    this.pitch = 0.12;
    this.dist = 3.4;
    this.fov = 50;
    this.offset.set(0, 0, 0);
    this.hideSelf = false;
    this.el.classList.remove('is-bare');
    setOn(this.el, true);
    this.applyFilter();
    void target;
  }

  exit() {
    this.active = false;
    setOn(this.el, false);
    this.stage.style.filter = '';
  }

  private applyFilter() {
    const [name, css] = FILTERS[this.filter];
    this.filterEl.textContent = name;
    this.stage.style.filter = css === 'none' ? '' : css;
  }

  /** Per frame: returns 'exit' when the player leaves photo mode. */
  update(dt: number, input: Input, camera: THREE.PerspectiveCamera, target: THREE.Vector3, col: Collision): 'exit' | null {
    const pad = input.isPad ? input.pad : null;
    if (input.pressed('cancel') || input.pressed('photo')) return 'exit';
    // orbit
    this.yaw -= input.lookX * 0.0025 + input.stickYaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + input.lookY * 0.0025 + input.stickPitch, -0.6, 1.3);
    // move the focus point about (within reach of you)
    const mv = input.move();
    if (mv.mag) {
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      this.offset.x += (fx * mv.y - fz * mv.x) * dt * 2.2;
      this.offset.z += (fz * mv.y + fx * mv.x) * dt * 2.2;
      if (this.offset.length() > 6) this.offset.setLength(6);
    }
    // zoom (field of view) with the triggers, distance with the wheel
    const z = pad ? pad.value('RT') - pad.value('LT') : 0;
    this.fov = THREE.MathUtils.clamp(this.fov - z * 30 * dt, 18, 80);
    if (input.wheel) this.dist = THREE.MathUtils.clamp(this.dist + input.wheel * 0.4, 1.2, 9);
    if (input.pressed('tabNext') || input.consume('KeyE')) (this.filter = (this.filter + 1) % FILTERS.length), this.applyFilter();
    if (input.pressed('tabPrev') || input.consume('KeyQ')) (this.filter = (this.filter + FILTERS.length - 1) % FILTERS.length), this.applyFilter();
    if (input.pressed('crouch')) this.el.classList.toggle('is-bare');
    if (input.pressed('jump') || input.consume('Mouse0')) this.wantShot = true;

    const focus = target.clone().add(this.offset);
    focus.y += 1.35;
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const hit = col.raycast(focus, dir, this.dist + 0.3);
    const d = Math.max(0.5, Math.min(this.dist, hit - 0.25));
    camera.position.copy(focus).addScaledVector(dir, d);
    camera.position.y = Math.max(camera.position.y, target.y + 0.2);
    camera.fov = this.fov;
    camera.updateProjectionMatrix();
    camera.lookAt(focus);
    return null;
  }

  /** The shutter: copy the frame (with the chosen look), flash. */
  capture(canvas: HTMLCanvasElement): string | null {
    this.wantShot = false;
    try {
      const w = Math.min(1600, canvas.width), hh = Math.round((w / canvas.width) * canvas.height);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = hh;
      const g = c.getContext('2d')!;
      const css = FILTERS[this.filter][1];
      if (css !== 'none') g.filter = css;
      g.drawImage(canvas, 0, 0, w, hh);
      this.flash.classList.remove('is-on');
      void this.flash.offsetWidth;
      this.flash.classList.add('is-on');
      return c.toDataURL('image/jpeg', 0.86);
    } catch {
      return null;
    }
  }

  setCount(n: number) {
    this.count.textContent = n ? `${n} kept` : '';
  }
}
