import * as THREE from 'three';
import { worldUniforms } from '../../world/materials';
import { floraUniforms } from './Flora';

/**
 * The trees you walk among: real ones, grown by EZ-Tree (Daniel Greenheck,
 * MIT; its bark photographs are CC0 from Poly Haven and TextureCan) — a
 * trunk that forks into limbs and twigs under photographed bark, and leaf
 * cards with real leaf shapes that move in the wind. A few of each species,
 * grown once when the RPG first needs them, drawn instanced for the nearest
 * fifty metres; the lighter stand-ins take over beyond.
 */

export type RealKind = 'oak' | 'birch' | 'pine' | 'spruce' | 'bush';

const PRESETS: Record<RealKind, [string, number][]> = {
  oak: [['Oak Medium', 11], ['Oak Small', 23], ['Oak Medium', 37]],
  birch: [['Aspen Medium', 5], ['Aspen Medium', 17]],
  pine: [['Pine Medium', 3], ['Pine Small', 29], ['Pine Medium', 41]],
  spruce: [['Pine Small', 7], ['Pine Medium', 13]],
  bush: [['Bush 1', 2], ['Bush 2', 9]],
};

export interface RealModel {
  bark: THREE.InstancedMesh;
  leaf: THREE.InstancedMesh;
  /** multiply a plant's scale by this to match the stand-in's height */
  fit: number;
}

const CAP = 120;

export class RealTrees {
  group = new THREE.Group();
  models = new Map<RealKind, RealModel[]>();
  ready = false;
  private loading = false;

  /** Grow the trees (once). `heights`: how tall each species' stand-in is, so a swap doesn't change the forest. */
  async load(heights: Record<RealKind, number>) {
    if (this.loading) return;
    this.loading = true;
    const { Tree } = await import('@dgreenheck/ez-tree');
    for (const kind of Object.keys(PRESETS) as RealKind[]) {
      const list: RealModel[] = [];
      for (const [preset, seed] of PRESETS[kind]) {
        const t = new Tree();
        t.loadPreset(preset);
        t.options.seed = seed;
        t.generate();
        const bg = t.branchesMesh.geometry as THREE.BufferGeometry;
        const lg = t.leavesMesh.geometry as THREE.BufferGeometry;
        bg.computeBoundingBox();
        lg.computeBoundingBox();
        const h = Math.max(bg.boundingBox!.max.y, lg.boundingBox!.max.y);
        const bark = new THREE.InstancedMesh(bg, barkMaterial(t.branchesMesh.material as THREE.MeshPhongMaterial), CAP);
        const leaf = new THREE.InstancedMesh(lg, leafMaterial(t.leavesMesh.material as THREE.MeshPhongMaterial), CAP);
        for (const m of [bark, leaf]) {
          m.count = 0;
          m.frustumCulled = false;
          m.castShadow = true;
          m.receiveShadow = true;
          m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          this.group.add(m);
        }
        list.push({ bark, leaf, fit: heights[kind] / Math.max(1, h) });
      }
      this.models.set(kind, list);
      // don't hold the frame up growing the whole forest at once
      await new Promise((r) => setTimeout(r, 0));
    }
    this.ready = true;
  }
}

function barkMaterial(src: THREE.MeshPhongMaterial) {
  const m = new THREE.MeshStandardMaterial({ color: src.color, map: src.map, normalMap: src.normalMap, roughnessMap: (src as unknown as { roughnessMap?: THREE.Texture }).roughnessMap ?? null, aoMap: src.aoMap, roughness: 0.95, metalness: 0 });
  m.normalScale.set(1.2, 1.2);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, floraUniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uSnowOn;`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75, 0.77, 0.8), uSnowOn * 0.25);`);
  };
  m.customProgramCacheKey = () => 'nf-real-bark';
  return m;
}

function leafMaterial(src: THREE.MeshPhongMaterial) {
  const m = new THREE.MeshStandardMaterial({ color: src.color, map: src.map, alphaTest: Math.max(0.35, src.alphaTest), side: THREE.DoubleSide, roughness: 0.7, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, floraUniforms, { uTime: worldUniforms.uTime });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nuniform float uWind;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  // leaves flutter; the higher and further out, the more
  vec3 ip = instanceMatrix[3].xyz;
  float ph = ip.x * 0.37 + ip.z * 0.21 + position.x * 0.2 + position.z * 0.3;
  float k = (0.02 + 0.03 * uWind) * clamp(position.y / 40.0, 0.0, 1.0);
  transformed.x += sin(uTime * 2.3 + ph) * k * 20.0;
  transformed.z += cos(uTime * 1.9 + ph * 1.3) * k * 14.0;
  transformed.y += sin(uTime * 3.1 + ph * 2.0) * k * 6.0;
}
#endif`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uSnowOn;`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.8, 0.84), uSnowOn * 0.55);`);
  };
  m.customProgramCacheKey = () => 'nf-real-leaf';
  return m;
}
