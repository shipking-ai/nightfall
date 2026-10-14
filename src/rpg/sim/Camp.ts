import * as THREE from 'three';
import type { Lamp } from '../../world/WorldContext';

/**
 * A campfire: a ring of stones, crossed logs, flames that lick and flicker,
 * and a warm light that throws your shadow on the trees. It burns for about
 * an hour of game time, then settles to embers and goes out.
 */
export class Campfire {
  group = new THREE.Group();
  /** a real light in the lamp pool (the game's lights are pooled, not added to the scene) */
  lamp: Lamp;
  private flames: THREE.Mesh[] = [];
  private flameMat: THREE.MeshBasicMaterial;
  /** game minutes of fire left */
  fuel = 60;
  private t = Math.random() * 10;

  constructor(pos: THREE.Vector3) {
    this.group.position.copy(pos);
    const stone = new THREE.MeshStandardMaterial({ color: 0x5a5854, roughness: 0.95 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 });
    const char = new THREE.MeshStandardMaterial({ color: 0x141010, roughness: 1, emissive: new THREE.Color(1, 0.3, 0.05), emissiveIntensity: 0.6 });
    const sGeo = new THREE.DodecahedronGeometry(0.11, 0);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const m = new THREE.Mesh(sGeo, stone);
      m.position.set(Math.cos(a) * 0.42, 0.05, Math.sin(a) * 0.42);
      m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      m.scale.setScalar(0.8 + Math.random() * 0.5);
      m.castShadow = true;
      this.group.add(m);
    }
    const lGeo = new THREE.CylinderGeometry(0.045, 0.055, 0.7, 7);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(lGeo, i % 2 ? wood : char);
      m.rotation.set(Math.PI / 2 - 0.35, (i / 4) * Math.PI * 2, 0, 'YXZ');
      m.position.set(Math.sin((i / 4) * Math.PI * 2) * 0.12, 0.14, Math.cos((i / 4) * Math.PI * 2) * 0.12);
      m.castShadow = true;
      this.group.add(m);
    }
    this.flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.25, 0.55, 0.16), transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
    const fGeo = new THREE.ConeGeometry(0.1, 0.5, 7, 1, true).translate(0, 0.25, 0);
    for (let i = 0; i < 5; i++) {
      const f = new THREE.Mesh(fGeo, this.flameMat);
      f.position.set((Math.random() - 0.5) * 0.14, 0.08, (Math.random() - 0.5) * 0.14);
      this.flames.push(f);
      this.group.add(f);
    }
    this.lamp = { pos: pos.clone().add(new THREE.Vector3(0, 0.7, 0)), color: new THREE.Color(1, 0.55, 0.25), intensity: 7, range: 12, ground: pos.y, halo: 0, cone: false, streak: 0, pooled: true, gain: 1 };
  }

  /** dt real seconds; minutes: game minutes that passed. False once it's out. */
  update(dt: number, minutes: number): boolean {
    this.fuel -= minutes;
    this.t += dt;
    const k = Math.max(0, Math.min(1, this.fuel / 15));
    this.flames.forEach((f, i) => {
      const w = Math.sin(this.t * (7 + i * 1.7) + i) * 0.5 + 0.5;
      f.scale.set(0.8 + w * 0.4, (0.6 + w * 0.7) * (0.3 + 0.7 * k), 0.8 + w * 0.4);
      f.rotation.y = this.t * (0.5 + i * 0.2);
    });
    this.flameMat.opacity = 0.3 + 0.45 * k;
    this.lamp.gain = (0.85 + Math.sin(this.t * 13) * 0.12 + Math.sin(this.t * 31) * 0.08) * (0.25 + 0.75 * k);
    return this.fuel > 0;
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
  }
}
