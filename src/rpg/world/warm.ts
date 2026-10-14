import type * as THREE from 'three';

/**
 * Shaders compiled before a new kind of thing is shown, off the frame
 * (a first draw would otherwise compile them on the spot: a freeze, worst on
 * Windows). The RPG sets the compiler; without one, things just appear.
 */
let warmer: ((obj: THREE.Object3D) => Promise<void>) | null = null;

export function setWarmer(fn: ((obj: THREE.Object3D) => Promise<void>) | null) {
  warmer = fn;
}

export async function warm(obj: THREE.Object3D) {
  if (!warmer) return;
  try {
    await warmer(obj);
  } catch {
    /* compiled on first draw instead */
  }
}
