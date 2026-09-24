import * as THREE from 'three';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { readJSON, writeJSON } from '../core/storage';

// v3: rain / splashes / steam are hidden for the exposure (see App setup),
// so plates captured with v2 that contain rain streaks are discarded.
const KEY = 'nightfall.plates.v3';
const W = 960;
const H = 540;

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** Where each place is photographed from, and what it looks at. */
export const PLATES: Record<string, { pos: THREE.Vector3; look: THREE.Vector3 }> = {
  avenue: { pos: v(-5, 1.6, 64), look: v(2, 7, -4) },
  station: { pos: v(-9, 1.6, -126), look: v(0, 9.5, -152) },
  market: { pos: v(-93, 1.7, 41), look: v(-74, 3, 6) },
  quarter: { pos: v(-64, 1.7, -58), look: v(-64, 3.2, -123) },
  yard: { pos: v(44, 2, 44), look: v(80, 9, 6) },
  riverside: { pos: v(-72, 1.7, 151), look: v(-22, 2.4, 174) },
  bridge: { pos: v(0.6, 1.7, 169), look: v(0, 1.6, 192) },
  garden: { pos: v(-102.5, 1.6, -70.5), look: v(-109, 3.2, -88) },
};

/**
 * Renders a real photograph of the world for the Archive the first time a
 * place is found. Plates persist in local storage between sessions.
 */
export class Photographer {
  plates: Record<string, { src: string; time: string }> = readJSON(KEY) ?? {};
  private cam = new THREE.PerspectiveCamera(52, W / H, 0.1, 2500);
  private rtScene = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
  private rtOut = new THREE.WebGLRenderTarget(W, H);
  private output = new OutputPass();

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private prepare: (pos: THREE.Vector3) => void,
    private restore: () => void,
  ) {
    this.output.renderToScreen = false;
  }

  has(plate: string) {
    return !!this.plates[plate];
  }

  capture(plate: string, time: string) {
    const p = PLATES[plate];
    if (!p) return;
    this.cam.position.copy(p.pos);
    this.cam.lookAt(p.look);
    this.cam.updateMatrixWorld();
    this.prepare(p.pos);
    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.rtScene);
    this.renderer.clear();
    this.renderer.render(this.scene, this.cam);
    this.output.render(this.renderer, this.rtOut, this.rtScene, 0, false);
    const px = new Uint8Array(W * H * 4);
    this.renderer.readRenderTargetPixels(this.rtOut, 0, 0, W, H, px);
    this.renderer.setRenderTarget(prevTarget);
    this.restore();

    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    g.putImageData(img, 0, 0);
    this.plates[plate] = { src: c.toDataURL('image/jpeg', 0.82), time };
    writeJSON(KEY, this.plates);
  }

  clear() {
    this.plates = {};
    writeJSON(KEY, {});
  }
}
