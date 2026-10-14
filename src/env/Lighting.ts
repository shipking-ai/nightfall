import * as THREE from 'three';
import type { Lamp } from '../world/WorldContext';
import { worldUniforms } from '../world/materials';

/** Global multiplier for pooled lamp intensities (tuned by eye against ACES exposure). */
const LAMP_GAIN = 3.0;

/**
 * Lighting rig:
 *  moon (directional, cool), sky fill (hemisphere), and a small pool of real
 *  point/spot lights re-assigned to the lamps nearest the viewer. Everything
 *  further away is carried by LightFX glow and reflections, so the number of
 *  lights in the shaders never changes.
 */
export class Lighting {
  /** the key light for everything the lamps don't reach: cool, high, casting the long shadows between buildings */
  moon = new THREE.DirectionalLight(0x9aaed2, 0.6);
  /** sky and bounce: enough that a street reads at a glance, never enough to fill the shadows */
  fill = new THREE.HemisphereLight(0x4a5878, 0x2a2420, 0.95);
  private moonOffset = new THREE.Vector3(-55, 85, 38);
  private points: THREE.PointLight[] = [];
  private spots: THREE.SpotLight[] = [];
  private assigned: (Lamp | null)[] = [];
  private spotAssigned: (Lamp | null)[] = [];
  private candidates: Lamp[];
  private timer = 0;
  private focus = new THREE.Vector3();
  /** the moon shadow camera's basis (same as its lookAt with world up) */
  private lightZ = this.moonOffset.clone().normalize();
  private lightX = new THREE.Vector3(0, 1, 0).cross(this.lightZ).normalize();
  private lightY = this.lightZ.clone().cross(this.lightX);
  private tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene, private lamps: Lamp[], poolSize: number, spotCount = 2) {
    this.candidates = lamps.filter((l) => l.pooled);
    this.moon.position.copy(this.moonOffset);
    this.moon.target.position.set(0, 0, 0);
    const sc = this.moon.shadow.camera;
    sc.left = sc.bottom = -70;
    sc.right = sc.top = 70;
    sc.near = 5;
    sc.far = 260;
    this.moon.shadow.bias = -0.0006;
    this.moon.shadow.normalBias = 0.05;
    scene.add(this.moon, this.moon.target, this.fill);

    for (let i = 0; i < poolSize; i++) {
      const p = new THREE.PointLight(0xffffff, 0, 20, 2);
      p.castShadow = false;
      scene.add(p);
      this.points.push(p);
      this.assigned.push(null);
    }
    for (let i = 0; i < spotCount; i++) {
      const s = new THREE.SpotLight(0xffffff, 0, 30, 1.15, 0.85, 2);
      s.shadow.mapSize.set(1024, 1024);
      s.shadow.bias = -0.0004;
      s.shadow.normalBias = 0.03;
      s.shadow.camera.near = 0.5;
      s.shadow.camera.far = 32;
      scene.add(s, s.target);
      this.spots.push(s);
      this.spotAssigned.push(null);
    }
  }

  /** RPG: the key light is the sun by day (or the moon), from wherever it is in the sky. */
  setKeyDirection(dir: THREE.Vector3, distance = 110) {
    this.moonOffset.copy(dir).normalize().multiplyScalar(distance);
    if (this.moonOffset.y < 8) this.moonOffset.y = 8;
    this.lightZ.copy(this.moonOffset).normalize();
    this.lightX.set(0, 1, 0).cross(this.lightZ).normalize();
    this.lightY.copy(this.lightZ).cross(this.lightX);
  }

  /** RPG: lamps that stream in and out with the world (District 03's are fixed). */
  setExtraLamps(extra: Lamp[]) {
    const base = this.baseLamps ?? (this.baseLamps = this.lamps.slice());
    this.lamps = base.concat(extra);
    this.candidates = this.lamps.filter((l) => l.pooled);
    this.assign(false);
  }
  private baseLamps: Lamp[] | null = null;

  setShadows(on: boolean, size: number) {
    this.moon.castShadow = on;
    if (this.moon.shadow.mapSize.x !== size * 2) {
      this.moon.shadow.mapSize.set(size * 2, size * 2);
      this.moon.shadow.map?.dispose();
      this.moon.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
    for (const s of this.spots) {
      s.castShadow = on;
      if (s.shadow.mapSize.x !== size) {
        s.shadow.mapSize.set(size, size);
        s.shadow.map?.dispose();
        s.shadow.map = null as unknown as THREE.WebGLRenderTarget;
      }
    }
  }

  /** Point lights are fixed in count; extra ones just stay dark. */
  setPoolLimit(n: number) {
    this.points.forEach((p, i) => (p.visible = i < n));
  }

  /** Force immediate re-assignment around a point (camera cuts, photographs). */
  focusNow(p: THREE.Vector3) {
    this.focus.copy(p);
    this.assign(true);
  }

  update(dt: number, t: number, focus: THREE.Vector3) {
    this.focus.copy(focus);
    // moon shadows follow the viewer, snapped to whole shadow-map texels in the
    // light's own view plane, so edges land on the same texels and never crawl
    const sc = this.moon.shadow.camera;
    const texel = (sc.right - sc.left) / this.moon.shadow.mapSize.x;
    const u = Math.round(focus.dot(this.lightX) / texel) * texel;
    const v = Math.round(focus.dot(this.lightY) / texel) * texel;
    // depth along the light only needs to keep the scene inside near/far; moving it
    // re-quantises every stored depth, so it steps in coarse 16 m jumps
    const w = Math.round(focus.dot(this.lightZ) / 16) * 16;
    const c = this.tmp.copy(this.lightX).multiplyScalar(u).addScaledVector(this.lightY, v).addScaledVector(this.lightZ, w);
    this.moon.target.position.copy(c);
    this.moon.position.copy(c).add(this.moonOffset);
    this.moon.target.updateMatrixWorld();
    // flicker / blink gains for every lamp
    for (let i = 0; i < this.lamps.length; i++) {
      const l = this.lamps[i];
      if (!l.flicker) continue;
      const ph = i * 1.37;
      switch (l.flicker) {
        case 1: // amber blink
          l.gain = smooth(Math.sin((t + ph) * Math.PI * 0.9)) ;
          break;
        case 2: // aviation flash
          l.gain = ((t + ph) % 2.6) < 0.22 ? 1 : 0.05;
          break;
        case 3: // departures board: mostly steady, occasional dips
          l.gain = Math.sin(t * 13 + ph) > 0.985 || ((t + ph) % 9) < 0.08 ? 0.35 : 1;
          break;
        case 4: { // a tube on its way out
          const k = (t * 0.6 + ph) % 7;
          l.gain = k < 0.9 ? (Math.sin(t * 60) > 0 ? 1 : 0.1) * (Math.sin(t * 7.3) > -0.3 ? 1 : 0.2) : 1;
          break;
        }
        case 5: // breathing
          l.gain = 0.82 + 0.18 * Math.sin(t * 0.8 + ph);
          break;
        case 6: // candle
          l.gain = 0.75 + 0.2 * Math.sin(t * 9 + ph) * Math.sin(t * 3.7 + ph * 2) + 0.05 * Math.sin(t * 23 + ph);
          break;
      }
    }

    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.2;
      this.assign(false);
    }

    const emit = worldUniforms.uEmit.value;
    const k = Math.min(1, dt * 5);
    this.points.forEach((p, i) => {
      const l = this.assigned[i];
      if (l?.dynamic) p.position.copy(l.pos);
      const target = l ? l.intensity * LAMP_GAIN * l.gain * emit : 0;
      p.intensity += (target - p.intensity) * k;
    });
    this.spots.forEach((s, i) => {
      const l = this.spotAssigned[i];
      const target = l ? l.intensity * LAMP_GAIN * 1.6 * l.gain * emit : 0;
      s.intensity += (target - s.intensity) * k;
    });
  }

  private assign(instant: boolean) {
    const f = this.focus;
    const scored = this.candidates
      .map((l) => ({ l, d: l.pos.distanceToSquared(f) / Math.max(0.2, l.intensity / 40) }))
      .filter((s) => s.d < 90 * 90)
      .sort((a, b) => a.d - b.d);

    // spots: nearest tall street lamps (they cast the shadows that make the scene)
    const spotLamps = scored.filter((s) => s.l.pos.y - s.l.ground > 3.5 && (s.l.intensity >= 30)).slice(0, this.spots.length).map((s) => s.l);
    this.spots.forEach((s, i) => {
      const l = spotLamps[i] ?? null;
      if (l !== this.spotAssigned[i]) {
        this.spotAssigned[i] = l;
        if (l) {
          s.position.copy(l.pos);
          s.target.position.set(l.pos.x, l.ground, l.pos.z);
          s.target.updateMatrixWorld();
          s.color.copy(l.color);
          s.distance = l.range * 1.3;
          s.shadow.camera.far = l.range * 1.3;
          if (!instant) s.intensity = 0;
        }
      }
    });

    const rest = scored.filter((s) => !spotLamps.includes(s.l)).map((s) => s.l);
    const want = rest.slice(0, this.points.filter((p) => p.visible).length);
    // keep lamps that are still wanted on the same light (no pops)
    const keep = new Set<Lamp>();
    this.assigned.forEach((l, i) => {
      if (l && want.includes(l) && this.points[i].visible) keep.add(l);
      else this.assigned[i] = null;
    });
    const fresh = want.filter((l) => !keep.has(l));
    this.points.forEach((p, i) => {
      if (!p.visible) return;
      if (this.assigned[i] === null && fresh.length) {
        const l = fresh.shift()!;
        this.assigned[i] = l;
        p.position.copy(l.pos);
        p.color.copy(l.color);
        p.distance = l.range * 1.3; // a little more reach: local bounce around each lamp
        if (!instant) p.intensity = 0;
      }
    });
    if (instant) {
      this.points.forEach((p, i) => {
        const l = this.assigned[i];
        p.intensity = l ? l.intensity * LAMP_GAIN * l.gain : 0;
      });
      this.spots.forEach((s, i) => {
        const l = this.spotAssigned[i];
        s.intensity = l ? l.intensity * LAMP_GAIN * 1.6 * l.gain : 0;
      });
    }
  }
}

function smooth(x: number) {
  return x > 0 ? Math.min(1, x * 3) : 0.04;
}
