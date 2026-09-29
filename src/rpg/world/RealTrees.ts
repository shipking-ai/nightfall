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

export type RealKind = 'oak' | 'birch' | 'pine' | 'spruce' | 'bush' | 'rock' | 'boulder';
type TreeKind = Exclude<RealKind, 'rock' | 'boulder'>;

const PRESETS: Record<TreeKind, [string, number][]> = {
  oak: [['Oak Medium', 11], ['Oak Small', 23], ['Oak Medium', 37]],
  birch: [['Aspen Medium', 5], ['Aspen Medium', 17]],
  pine: [['Pine Medium', 3], ['Pine Small', 29], ['Pine Medium', 41]],
  spruce: [['Pine Small', 7], ['Pine Medium', 13]],
  bush: [['Bush 1', 2], ['Bush 2', 9]],
};

export interface RealModel {
  bark: THREE.InstancedMesh;
  /** none on a rock */
  leaf?: THREE.InstancedMesh;
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
    await this.loadRocks(heights).catch((e) => console.warn('rocks', e));
    const { Tree } = await import('@dgreenheck/ez-tree');
    for (const kind of Object.keys(PRESETS) as TreeKind[]) {
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

  /**
   * Scanned stones (the EZ-Tree demo's rocks, from Poly Haven photogrammetry,
   * CC0), sized to the stand-in's height; rocks and boulders share the scans.
   */
  private async loadRocks(heights: Record<RealKind, number>) {
    const l = (await import('./gltf')).gltfLoader();
    const base = `${import.meta.env.BASE_URL ?? '/'}rpg/models/`;
    const scans: { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial; h: number }[] = [];
    for (const f of ['rock1', 'rock2', 'rock3']) {
      const scene = (await l.loadAsync(`${base}${f}.glb`)).scene;
      scene.updateMatrixWorld(true);
      const mesh = scene.getObjectByProperty('isMesh', true) as THREE.Mesh | undefined;
      if (!mesh) continue;
      const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      // centred, and sunk a little so it sits in the ground rather than on it
      geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y - (bb.max.y - bb.min.y) * 0.12, -(bb.min.z + bb.max.z) / 2);
      const src = mesh.material as THREE.MeshStandardMaterial;
      const mat = new THREE.MeshStandardMaterial({ color: src.color, map: src.map, normalMap: src.normalMap, roughnessMap: src.roughnessMap, aoMap: src.aoMap, roughness: 1, metalness: 0 });
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, floraUniforms);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', `#include <common>\nuniform float uSnowOn;`)
          .replace('#include <color_fragment>', `#include <color_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.8, 0.84), uSnowOn * smoothstep(0.4, 0.9, vNormal.y) * 0.8);`);
      };
      mat.customProgramCacheKey = () => 'nf-real-rock';
      scans.push({ geo, mat, h: (bb.max.y - bb.min.y) * 0.88 });
    }
    for (const kind of ['rock', 'boulder'] as const) {
      const list: RealModel[] = [];
      for (const s of scans) {
        const bark = new THREE.InstancedMesh(s.geo, s.mat, kind === 'rock' ? 400 : 200);
        bark.count = 0;
        bark.frustumCulled = false;
        bark.castShadow = kind === 'boulder';
        bark.receiveShadow = true;
        bark.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(bark);
        list.push({ bark, fit: heights[kind] / Math.max(0.05, s.h) });
      }
      if (list.length) this.models.set(kind, list);
    }
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
