import * as THREE from 'three';
import { h } from '../../ui/dom';

/**
 * Where the tracked job wants you, shown in the world, not only on the
 * compass: a column of light standing over a place (you can see it from the
 * next valley), or a diamond over a person's head, and on the screen a label
 * with what and how far, held at the edge with an arrow when it's behind you
 * or off to the side.
 */
export interface Goal {
  x: number;
  y: number;
  z: number;
  /** a person: the diamond sits over their head and there's no column */
  person: boolean;
  title: string;
  text: string;
}

export class GoalMarker {
  group = new THREE.Group();
  private beamMat = new THREE.MeshBasicMaterial({ color: 0xffb04a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
  private gemMat = new THREE.MeshBasicMaterial({ color: 0xffc46a, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false });
  private beam: THREE.Mesh;
  private gem: THREE.Mesh;
  private fade = 0;
  private el: HTMLElement;
  private label: HTMLElement;
  private dist: HTMLElement;
  private arrow: HTMLElement;
  private v = new THREE.Vector3();

  constructor(ui: HTMLElement) {
    // a soft column: brighter at the foot, fading as it rises
    const g = new THREE.CylinderGeometry(1, 1, 1, 16, 8, true).translate(0, 0.5, 0);
    const col = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < g.attributes.position.count; i++) {
      const k = 1 - g.attributes.position.getY(i);
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.beamMat.vertexColors = true;
    this.beam = new THREE.Mesh(g, this.beamMat);
    this.gem = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), this.gemMat);
    this.beam.renderOrder = 6;
    this.gem.renderOrder = 7;
    this.beam.frustumCulled = this.gem.frustumCulled = false;
    this.group.add(this.beam, this.gem);
    this.group.visible = false;
    this.label = h('span', { class: 'rpgmk__label' });
    this.dist = h('span', { class: 'rpgmk__dist meta' });
    this.arrow = h('span', { class: 'rpgmk__arrow', 'aria-hidden': 'true' }, '▲');
    this.el = h('div', { class: 'rpgmk', 'aria-hidden': 'true' }, h('span', { class: 'rpgmk__gem' }), this.label, this.dist, this.arrow);
    ui.append(this.el);
  }

  update(dt: number, t: number, goal: Goal | null, camera: THREE.PerspectiveCamera, from: THREE.Vector3, show: boolean) {
    this.fade += ((goal && show ? 1 : 0) - this.fade) * Math.min(1, dt * 3);
    const on = this.fade > 0.01 && !!goal;
    this.group.visible = on;
    this.el.classList.toggle('is-on', on && show);
    if (!goal || !on) return;
    const d = Math.hypot(goal.x - from.x, goal.z - from.z);
    // sized to stay readable: a little bigger the further it is
    const s = Math.max(1, d / 60);
    this.group.position.set(goal.x, goal.y, goal.z);
    this.beam.visible = !goal.person;
    this.beam.scale.set(0.35 * s, 260, 0.35 * s);
    this.beamMat.opacity = this.fade * THREE.MathUtils.smoothstep(d, 6, 30) * 0.5;
    const gy = goal.person ? 2.35 : 3 + 1.2 * s;
    this.gem.position.y = gy + Math.sin(t * 2.2) * 0.12 * s;
    this.gem.rotation.y = t * 1.4;
    this.gem.scale.set(0.2 * s, 0.32 * s, 0.2 * s);
    this.gemMat.opacity = this.fade * (goal.person ? 0.95 : 0.85);
    // the label, where the diamond is on screen (at the edge when it's off it)
    this.v.set(goal.x, goal.y + gy + 0.6 * s, goal.z).project(camera);
    const behind = this.v.z > 1;
    let x = this.v.x, y = this.v.y;
    if (behind) (x = -x), (y = -1);
    const off = behind || Math.abs(x) > 0.92 || Math.abs(y) > 0.86;
    if (off) {
      const k = Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.86);
      x /= k;
      y /= k;
    }
    this.el.style.transform = `translate(${((x + 1) / 2) * 100}vw, ${((1 - y) / 2) * 100}vh) translate(-50%, -100%)`;
    this.el.classList.toggle('is-off', off);
    this.arrow.style.transform = `rotate(${Math.atan2(x, y)}rad)`;
    if (this.label.textContent !== goal.text) this.label.textContent = goal.text;
    const dt2 = d < 8 ? 'here' : d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`;
    if (this.dist.textContent !== dt2) this.dist.textContent = dt2;
  }

  clear() {
    this.fade = 0;
    this.group.visible = false;
    this.el.classList.remove('is-on');
  }
}
