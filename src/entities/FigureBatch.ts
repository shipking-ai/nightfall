import * as THREE from 'three';
import { PARTS, PART_KEYS, type Outfit, type PartKey, type Rig } from './Humanoid';

/**
 * Draws many humanoids with one InstancedMesh per part geometry — ~25 draws
 * for the whole crowd however many people are in it. Every mesh has one slot
 * per figure (two for left/right limbs); hidden parts get a zero matrix.
 *
 * Character materials carry a soft cool rim so bodies separate from the dark
 * behind them, and a subtle woven texture derived per figure, so clothing
 * reads as fabric rather than plastic.
 */

type MatKind = 'cloth' | 'skin' | 'hair' | 'eyes' | 'canopy' | 'glow' | 'shoe';

const RIM = new THREE.Color(0.55, 0.62, 0.78);

function characterMaterial(kind: MatKind): THREE.MeshStandardMaterial {
  const params: THREE.MeshStandardMaterialParameters = {
    cloth: { roughness: 0.82, metalness: 0 },
    skin: { roughness: 0.55, metalness: 0 },
    hair: { roughness: 0.5, metalness: 0.05 },
    eyes: { roughness: 0.2, metalness: 0, color: 0x0d0b0a },
    shoe: { roughness: 0.38, metalness: 0.05 },
    canopy: { roughness: 0.2, metalness: 0.1, side: THREE.DoubleSide },
    glow: { color: 0x000000, emissive: 0xdfe8ff, emissiveIntensity: 1.3, roughness: 1 },
  }[kind];
  if (kind === 'glow') return new THREE.MeshBasicMaterial({ color: 0xffffff }) as unknown as THREE.MeshStandardMaterial; // unlit, tinted per figure
  const m = new THREE.MeshStandardMaterial(params);
  if (kind === 'eyes' || kind === 'shoe') return m; // flat faces: a rim would wash them out
  const rim = kind === 'skin' ? 0.12 : kind === 'hair' ? 0.1 : 0.09;
  m.onBeforeCompile = (s) => {
    s.uniforms.uRim = { value: rim };
    s.uniforms.uRimColor = { value: RIM };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    let frag = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRim;\nuniform vec3 uRimColor;\nvarying vec3 vObj;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float nv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          float rim = pow(1.0 - nv, 3.0);
          totalEmissiveRadiance += uRimColor * rim * uRim;
        }`,
      );
    if (kind === 'cloth') {
      frag = frag.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
            float pick = fract(sin(dot(vColor.rgb, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          #else
            float pick = 0.0;
          #endif
          vec3 q = vObj * 90.0;
          float weave = 0.93 + 0.07 * sin(q.x + sin(q.y * 1.3)) * sin(q.y * 1.1 + q.z);
          float pat = 1.0;
          if (pick > 0.8) pat = 1.0 + 0.1 * step(0.86, fract(vObj.x * 55.0));                       // pinstripe
          else if (pick > 0.62) pat = 1.0 + 0.07 * (step(0.5, fract(vObj.x * 16.0)) - step(0.5, fract(vObj.y * 16.0)));  // check
          else if (pick > 0.48) pat = 1.0 + 0.06 * step(0.5, fract((vObj.x + vObj.y) * 30.0));      // twill
          diffuseColor.rgb *= weave * pat;
        }`,
      );
    }
    s.fragmentShader = frag;
  };
  m.customProgramCacheKey = () => `nf-char-${kind}`;
  return m;
}

/** geometry name per rig part (left/right limbs share one mesh) */
const GEO_OF: Record<Exclude<PartKey, 'hair'>, string> = {
  pelvis: 'pelvis', torso: 'torso', head: 'head', headFar: 'headFar', eyes: 'eyes',
  upperArmL: 'upperArm', upperArmR: 'upperArm', forearmL: 'forearm', forearmR: 'forearm', handL: 'hand', handR: 'hand',
  thighL: 'thigh', thighR: 'thigh', shinL: 'shin', shinR: 'shin', footL: 'foot', footR: 'foot',
  hem: 'hem', skirt: 'skirt', hoodDown: 'hoodDown', scarf: 'scarf', bag: 'bag', umbrella: 'umbrella', glow: 'glow',
  collar: 'collar', crew: 'crew', shirt: 'shirt',
};
const MAT_OF: Record<string, MatKind> = {
  head: 'skin', headFar: 'skin', hand: 'skin', eyes: 'eyes', umbrella: 'canopy', glow: 'glow', foot: 'shoe',
};
const SIDE: Partial<Record<PartKey, number>> = {
  upperArmR: 1, forearmR: 1, handR: 1, thighR: 1, shinR: 1, footR: 1,
};
const NO_SHADOW = new Set(['eyes', 'glow', 'hand', 'scarf', 'bag', 'headFar', 'crew', 'shirt', 'collar']);
const HAIR_STYLES = Object.keys(PARTS).filter((k) => k.startsWith('hair_'));

export class FigureBatch {
  group = new THREE.Group();
  private meshes = new Map<string, THREE.InstancedMesh>();
  private hairOf: string[] = [];
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private dirty = new Set<THREE.InstancedMesh>();

  constructor(private capacity: number) {
    const mats: Partial<Record<MatKind, THREE.MeshStandardMaterial>> = {};
    const mat = (k: MatKind) => (mats[k] ??= characterMaterial(k));
    const geoNames = new Set<string>([...Object.values(GEO_OF), ...HAIR_STYLES]);
    for (const g of geoNames) {
      const paired = ['upperArm', 'forearm', 'hand', 'thigh', 'shin', 'foot'].includes(g);
      const kind: MatKind = g.startsWith('hair_') ? 'hair' : MAT_OF[g] ?? 'cloth';
      const m = new THREE.InstancedMesh(PARTS[g], mat(kind), capacity * (paired ? 2 : 1));
      m.castShadow = !NO_SHADOW.has(g);
      m.receiveShadow = kind !== 'glow';
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < m.count; i++) m.setMatrixAt(i, this.zero);
      if (kind !== 'eyes') m.setColorAt(0, new THREE.Color(1, 1, 1));
      this.meshes.set(g, m);
      this.group.add(m);
    }
  }

  /** Paint a figure's clothes, skin and hair into its slot. */
  dress(slot: number, o: Outfit, glowColor = 0x9fc4ff) {
    const c = new THREE.Color();
    const set = (geo: string, index: number, col: number) => {
      const m = this.meshes.get(geo)!;
      if (!m.instanceColor) return;
      m.setColorAt(index, c.set(col));
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    };
    const legsCovered = o.legs;
    set('pelvis', slot, o.hem ? o.top : o.legs);
    set('torso', slot, o.top);
    set('head', slot, o.skin);
    set('headFar', slot, o.skin);
    for (let s = 0; s < 2; s++) {
      set('upperArm', slot * 2 + s, o.top);
      set('forearm', slot * 2 + s, o.top);
      set('hand', slot * 2 + s, o.skin);
      set('thigh', slot * 2 + s, legsCovered);
      set('shin', slot * 2 + s, legsCovered);
      set('foot', slot * 2 + s, o.shoes);
    }
    set('hem', slot, o.top);
    set('skirt', slot, shade(o.top, 0.85));
    set('hoodDown', slot, o.accent);
    set('scarf', slot, o.accent);
    set('bag', slot, shade(o.accent, 0.6));
    set('umbrella', slot, 0x121416);
    set('glow', slot, glowColor);
    set('collar', slot, shade(o.top, 0.8));
    set('crew', slot, shade(o.top, 0.85));
    set('shirt', slot, o.garment === 'suit' ? 0xb8b4aa : 0x6a6660);
    for (const h of HAIR_STYLES) set(h, slot, o.hairColor);
    this.hairOf[slot] = o.hair === 'none' ? '' : `hair_${o.hair}`;
  }

  hide(slot: number) {
    for (const [g, m] of this.meshes) {
      const paired = m.count === this.capacity * 2;
      if (paired) {
        m.setMatrixAt(slot * 2, this.zero);
        m.setMatrixAt(slot * 2 + 1, this.zero);
      } else m.setMatrixAt(slot, this.zero);
      this.dirty.add(m);
      void g;
    }
  }

  /** Write a solved rig into the slot, showing only `visible` parts. */
  write(slot: number, rig: Rig, visible: Set<PartKey>, glowOn: boolean) {
    for (const k of PART_KEYS) {
      if (k === 'hair') {
        for (const h of HAIR_STYLES) {
          const m = this.meshes.get(h)!;
          m.setMatrixAt(slot, visible.has('hair') && this.hairOf[slot] === h ? rig.hair : this.zero);
          this.dirty.add(m);
        }
        continue;
      }
      const g = GEO_OF[k];
      const m = this.meshes.get(g)!;
      const index = m.count === this.capacity * 2 ? slot * 2 + (SIDE[k] ?? 0) : slot;
      const show = k === 'glow' ? glowOn : visible.has(k);
      m.setMatrixAt(index, show ? rig[k] : this.zero);
      this.dirty.add(m);
    }
  }

  flush() {
    for (const m of this.dirty) m.instanceMatrix.needsUpdate = true;
    this.dirty.clear();
  }
}

function shade(c: number, k: number) {
  return new THREE.Color(c).multiplyScalar(k).getHex();
}
