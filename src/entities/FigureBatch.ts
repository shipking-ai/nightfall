import * as THREE from 'three';
import { ANATOMY, FACE_SHAPES, TORSO_SHAPES, GRIPS, underHat, type Grip } from './anatomy';
import { hairParts, PART_KEYS, visibleParts, type Body, type Outfit, type PartKey, type Rig } from './Humanoid';

/**
 * Draws many humanoids with one InstancedMesh per part geometry. Every mesh
 * has one slot per figure (two for paired limbs); hidden parts get a zero
 * matrix, and a mesh nobody is wearing isn't drawn at all.
 *
 * Faces and builds are per-instance morph weights (so every person has their
 * own face from one draw). Materials carry a cool rim so bodies separate
 * from the dark, a small fill so nobody disappears into it, a woven texture
 * on cloth and strands in hair.
 */

type MatKind = 'cloth' | 'skin' | 'face' | 'hair' | 'eyes' | 'iris' | 'canopy' | 'glow' | 'shoe' | 'glossy' | 'reflect';

const RIM = new THREE.Color(0.55, 0.62, 0.78);

/**
 * A little light of their own, so people stay readable against a dark
 * street (App raises it where the lighting is weakest). Shared by every
 * character material.
 */
export const charFill = { value: 0.045 };

function characterMaterial(kind: MatKind): THREE.MeshStandardMaterial {
  const params: THREE.MeshStandardMaterialParameters = {
    cloth: { roughness: 0.84, metalness: 0 },
    skin: { roughness: 0.52, metalness: 0 },
    face: { roughness: 0.5, metalness: 0, vertexColors: true },
    hair: { roughness: 0.46, metalness: 0.04 },
    eyes: { roughness: 0.18, metalness: 0 },
    iris: { roughness: 0.12, metalness: 0 },
    shoe: { roughness: 0.36, metalness: 0.05 },
    glossy: { roughness: 0.25, metalness: 0.4 },
    reflect: { roughness: 0.3, metalness: 0.2 },
    canopy: { roughness: 0.2, metalness: 0.1, side: THREE.DoubleSide },
    glow: {},
  }[kind];
  if (kind === 'glow') return new THREE.MeshBasicMaterial({ color: 0xffffff }) as unknown as THREE.MeshStandardMaterial; // unlit, tinted per figure
  const m = new THREE.MeshStandardMaterial(params);
  const rim = kind === 'skin' || kind === 'face' ? 0.11 : kind === 'hair' ? 0.12 : kind === 'eyes' || kind === 'iris' ? 0 : 0.09;
  m.onBeforeCompile = (s) => {
    s.uniforms.uRim = { value: rim };
    s.uniforms.uRimColor = { value: RIM };
    s.uniforms.uFill = charFill;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    let frag = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRim;\nuniform vec3 uRimColor;\nuniform float uFill;\nvarying vec3 vObj;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float nv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          float rim = pow(1.0 - nv, 3.0);
          totalEmissiveRadiance += uRimColor * rim * uRim;
          // a fill that keeps faces and clothes readable in the dark
          totalEmissiveRadiance += diffuseColor.rgb * uFill * (0.55 + 0.45 * nv);
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
          // folds: a soft darkening that runs down the garment
          float fold = 0.94 + 0.06 * sin(vObj.x * 38.0 + sin(vObj.y * 9.0) * 1.6);
          diffuseColor.rgb *= weave * pat * fold;
        }`,
      );
    }
    if (kind === 'hair') {
      frag = frag.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // strands: fine stripes running from the crown, clumped, darker at the roots
          vec3 d = normalize(vObj - vec3(0.0, 0.128, 0.0) + vec3(1e-4));
          float lon = atan(d.x, d.z);
          float strands = 0.5 + 0.5 * sin(lon * 190.0 + d.y * 14.0 + sin(lon * 23.0) * 3.0);
          float clump = 0.5 + 0.5 * sin(lon * 31.0 + d.y * 5.0);
          float roots = 0.8 + 0.2 * smoothstep(-0.2, 0.9, d.y);
          diffuseColor.rgb *= (0.8 + 0.2 * strands) * (0.9 + 0.1 * clump) * roots;
        }`,
      );
      // a sheen along the strands
      frag = frag.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float sheen = pow(clamp(1.0 - abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 6.0);
          totalEmissiveRadiance += diffuseColor.rgb * sheen * 0.25;
        }`,
      );
    }
    if (kind === 'skin' || kind === 'face') {
      // skin carries light a little: warm the shadow side
      frag = frag.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * vec3(0.05, 0.018, 0.012);`,
      );
    }
    s.fragmentShader = frag;
  };
  m.customProgramCacheKey = () => `nf-char2-${kind}`;
  return m;
}

/** Paired meshes: two slots per figure (left, right). */
const PAIRED = new Set(['upperArm', 'forearm', 'thigh', 'shin', 'shoe', 'sneaker', 'boot', 'sole', 'bootShaft']);
const STATIC_GEO: Partial<Record<PartKey, string>> = {
  pelvis: 'pelvis', torso: 'torso', neck: 'neck', head: 'head', headFar: 'headFar', eyes: 'eyes', irises: 'irises', brows: 'brows', glasses: 'glasses',
  upperArmL: 'upperArm', upperArmR: 'upperArm', forearmL: 'forearm', forearmR: 'forearm',
  thighL: 'thigh', thighR: 'thigh', shinL: 'shin', shinR: 'shin', soleL: 'sole', soleR: 'sole', shaftL: 'bootShaft', shaftR: 'bootShaft',
  hem: 'hem', jacketHem: 'jacketHem', skirt: 'skirt', lapels: 'lapels', tie: 'tie', shirt: 'shirt', collar: 'collar', crew: 'crew', hoodDown: 'hoodDown',
  pocket: 'pocket', scarf: 'scarf', bag: 'bag', backpack: 'backpack', apronTop: 'apronTop', apronSkirt: 'apronSkirt', vest: 'vest', vestBand: 'vestBand',
  dutyBelt: 'dutyBelt', belt: 'belt', radio: 'radio', umbrella: 'umbrella', glow: 'glow',
};
const RIGHT: Partial<Record<PartKey, 1>> = { upperArmR: 1, forearmR: 1, thighR: 1, shinR: 1, footR: 1, soleR: 1, shaftR: 1 };

function matKindOf(g: string): MatKind {
  if (g === 'head') return 'face';
  if (g === 'headFar' || g === 'neck' || g.startsWith('hand')) return 'skin';
  if (g.startsWith('hair_') || g === 'brows' || g.startsWith('fh_')) return 'hair';
  if (g === 'eyes') return 'eyes';
  if (g === 'irises') return 'iris';
  if (g === 'shoe' || g === 'boot' || g === 'sneaker' || g === 'bootShaft' || g === 'dutyBelt' || g === 'radio' || g === 'belt') return 'shoe';
  if (g === 'glasses' || g === 'hat_peaked') return 'glossy';
  if (g === 'vestBand') return 'reflect';
  if (g === 'umbrella') return 'canopy';
  if (g === 'glow') return 'glow';
  return 'cloth';
}
const NO_SHADOW = (g: string) =>
  ['eyes', 'irises', 'brows', 'glow', 'glasses', 'scarf', 'bag', 'headFar', 'crew', 'shirt', 'collar', 'lapels', 'tie', 'pocket', 'sole', 'vestBand', 'radio', 'belt', 'dutyBelt', 'apronTop'].includes(g) ||
  g.startsWith('fh_') || g.startsWith('hand');

interface SlotLook {
  hair: string;
  hat: string;
  facial: string;
  shoe: string;
  /** every mesh this person can appear in */
  meshes: string[];
}

export class FigureBatch {
  group = new THREE.Group();
  private meshes = new Map<string, THREE.InstancedMesh>();
  private looks: SlotLook[] = [];
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private dirty = new Set<THREE.InstancedMesh>();
  /** how many slots might show each mesh (a mesh nobody uses isn't drawn) */
  private uses = new Map<string, number>();
  private morphDummy = { morphTargetInfluences: [] as number[] } as unknown as THREE.Mesh;

  constructor(private capacity: number, opts: { shadows?: boolean } = {}) {
    const mats: Partial<Record<MatKind, THREE.MeshStandardMaterial>> = {};
    const mat = (k: MatKind) => (mats[k] ??= characterMaterial(k));
    for (const [name, geo] of Object.entries(ANATOMY)) {
      const kind = matKindOf(name);
      const m = new THREE.InstancedMesh(geo, mat(kind), capacity * (PAIRED.has(name) ? 2 : 1));
      m.castShadow = opts.shadows !== false && !NO_SHADOW(name);
      m.receiveShadow = kind !== 'glow';
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < m.count; i++) m.setMatrixAt(i, this.zero);
      if (kind !== 'glow') m.setColorAt(0, new THREE.Color(1, 1, 1));
      // per-instance morph weights (faces, builds): start everyone neutral
      const morphs = geo.morphAttributes.position?.length ?? 0;
      if (morphs) {
        (this.morphDummy as unknown as { morphTargetInfluences: number[] }).morphTargetInfluences = new Array(morphs).fill(0);
        for (let i = 0; i < m.count; i++) m.setMorphAt(i, this.morphDummy);
        if (m.morphTexture) m.morphTexture.needsUpdate = true;
      }
      m.visible = false;
      this.meshes.set(name, m);
      this.uses.set(name, 0);
      this.group.add(m);
    }
    // the body is always in use once anyone is dressed
    this.looks = new Array(capacity).fill(null).map(() => ({ hair: '', hat: '', facial: '', shoe: 'shoe', meshes: [] }));
  }

  private use(name: string, d: number) {
    if (!name) return;
    const n = (this.uses.get(name) ?? 0) + d;
    this.uses.set(name, n);
    const m = this.meshes.get(name);
    if (m) m.visible = n > 0;
  }

  private dressed = new Set<number>();

  /**
   * Blood soaking into what someone's wearing (or into their skin) where they
   * were hit: that part darkens toward a deep red, more with each wound.
   * `at` is how high up the body (0 feet … 1 top of the head).
   */
  stain(slot: number, at: number, amount: number) {
    const parts = at > 0.86 ? ['head', 'neck'] : at > 0.56 ? ['torso', 'collar', 'crew', 'shirt', 'lapels', 'scarf', 'vest'] : at > 0.44 ? ['pelvis', 'hem', 'jacketHem', 'skirt', 'belt'] : ['thigh'];
    const c = new THREE.Color(), red = new THREE.Color(0x3a0606);
    for (const g of parts) {
      const m = this.meshes.get(g);
      if (!m?.instanceColor) continue;
      const idx = PAIRED.has(g) ? slot * 2 + (Math.random() < 0.5 ? 0 : 1) : slot;
      m.getColorAt(idx, c);
      m.setColorAt(idx, c.lerp(red, Math.min(0.55, amount * (g === 'head' || g === 'neck' ? 0.35 : 0.5))));
      m.instanceColor.needsUpdate = true;
    }
  }

  /** Paint a figure's clothes, skin, hair and face into its slot. */
  dress(slot: number, o: Outfit, glowColor = 0x9fc4ff, b?: Body) {
    const c = new THREE.Color();
    const set = (geo: string, index: number, col: number) => {
      const m = this.meshes.get(geo);
      if (!m?.instanceColor) return;
      m.setColorAt(index, c.set(col));
      m.instanceColor.needsUpdate = true;
    };
    // which of the variant meshes this person uses
    const { cut, hat } = hairParts(o);
    const look: SlotLook = {
      hair: hat !== 'none' ? (underHat(cut) ? `hair_${underHat(cut)}` : '') : cut !== 'none' ? `hair_${cut}` : '',
      hat: hat !== 'none' ? `hat_${hat}` : '',
      facial: o.facialHair && o.facialHair !== 'none' ? `fh_${o.facialHair}` : '',
      shoe: o.shoeKind ?? 'shoe',
      meshes: [],
    };
    // the meshes this outfit can ever show (at the closest distance)
    const parts = visibleParts(o, 0);
    const ms = new Set<string>(['headFar', 'irises', 'glow']);
    for (const k of parts) {
      if (k === 'hair' || k === 'hat' || k === 'facial') {
        if (look[k]) ms.add(look[k]);
      } else if (k === 'handL' || k === 'handR') for (const g of GRIPS) ms.add(`hand${k === 'handL' ? 'L' : 'R'}_${g}`);
      else if (k === 'footL' || k === 'footR') ms.add(look.shoe);
      else if (STATIC_GEO[k]) ms.add(STATIC_GEO[k]!);
    }
    look.meshes = [...ms];
    const prev = this.looks[slot];
    if (this.dressed.has(slot)) {
      for (const g of prev.meshes) this.use(g, -1);
      this.clearVariants(slot);
    }
    this.dressed.add(slot);
    this.looks[slot] = look;
    for (const g of look.meshes) this.use(g, 1);

    const hand = o.gloves ?? o.skin;
    const shortSleeves = o.sleeves === 'short';
    set('pelvis', slot, o.hem ? o.top : o.legs);
    set('torso', slot, o.top);
    set('neck', slot, o.skin);
    set('head', slot, o.skin);
    set('headFar', slot, o.skin);
    set('eyes', slot, 0xb8b0a4);
    set('irises', slot, o.eyeColor ?? 0x2a1c12);
    set('brows', slot, shade(o.hairColor, 0.85));
    set('glasses', slot, 0x16171a);
    for (const g of GRIPS) {
      set(`handL_${g}`, slot, hand);
      set(`handR_${g}`, slot, hand);
    }
    for (let s = 0; s < 2; s++) {
      set('upperArm', slot * 2 + s, o.top);
      set('forearm', slot * 2 + s, shortSleeves ? o.skin : o.top);
      set('thigh', slot * 2 + s, o.legs);
      set('shin', slot * 2 + s, o.legs);
      set('shoe', slot * 2 + s, o.shoes);
      set('sneaker', slot * 2 + s, o.shoes);
      set('boot', slot * 2 + s, o.shoes);
      set('sole', slot * 2 + s, o.soleColor ?? 0xd8d4cc);
      set('bootShaft', slot * 2 + s, o.shoes);
    }
    set('hem', slot, o.top);
    set('jacketHem', slot, o.top);
    set('skirt', slot, shade(o.top, 0.85));
    set('lapels', slot, shade(o.top, 0.72));
    set('tie', slot, o.tie ?? 0x2e2e30);
    set('shirt', slot, o.shirt ?? 0x6a6660);
    set('collar', slot, shade(o.top, 0.8));
    set('crew', slot, shade(o.top, 0.85));
    set('hoodDown', slot, o.garment === 'hoodie' || o.garment === 'raincoat' ? shade(o.top, 0.92) : o.accent);
    set('pocket', slot, shade(o.top, 0.9));
    set('scarf', slot, o.accent);
    set('bag', slot, shade(o.accent, 0.6));
    set('backpack', slot, o.backpack ?? 0x2a2a2e);
    set('apronTop', slot, o.apron ?? 0x6a6a60);
    set('apronSkirt', slot, o.apron ?? 0x6a6a60);
    set('vest', slot, o.vest ?? 0x222222);
    set('vestBand', slot, o.vestBand ?? 0xb8bcc0);
    set('dutyBelt', slot, 0x111214);
    set('belt', slot, 0x2a2018);
    set('radio', slot, 0x111214);
    set('umbrella', slot, 0x121416);
    set('glow', slot, glowColor);
    const hairCol = o.hairColor;
    for (const name of this.meshes.keys()) {
      if (name.startsWith('hair_')) set(name, slot, hairCol);
      if (name.startsWith('hat_')) set(name, slot, o.hatColor ?? o.accent);
      if (name.startsWith('fh_')) set(name, slot, name === 'fh_stubble' ? mix(o.skin, o.hairColor, 0.62) : shade(hairCol, 0.92));
    }
    if (b) this.shape(slot, b);
  }

  /** A face and a build: morph weights on the head, facial hair and trunk. */
  shape(slot: number, b: Body) {
    const face = b.face ?? [];
    const fw = FACE_SHAPES.map((_, i) => face[i] ?? 0);
    const tw = TORSO_SHAPES.map((k) => (b as unknown as Record<string, number | undefined>)[k] ?? 0);
    const put = (name: string, w: number[]) => {
      const m = this.meshes.get(name);
      if (!m) return;
      (this.morphDummy as unknown as { morphTargetInfluences: number[] }).morphTargetInfluences = w;
      m.setMorphAt(slot, this.morphDummy);
      if (m.morphTexture) m.morphTexture.needsUpdate = true;
    };
    put('head', fw);
    for (const f of ['fh_stubble', 'fh_beard', 'fh_moustache', 'fh_goatee']) put(f, fw);
    put('torso', tw);
  }

  hide(slot: number) {
    for (const m of this.meshes.values()) {
      const paired = m.count === this.capacity * 2;
      if (paired) {
        m.setMatrixAt(slot * 2, this.zero);
        m.setMatrixAt(slot * 2 + 1, this.zero);
      } else m.setMatrixAt(slot, this.zero);
      this.dirty.add(m);
    }
  }

  /** Write a solved rig into the slot, showing only `visible` parts. */
  write(slot: number, rig: Rig, visible: Set<PartKey>, glowOn: boolean) {
    const look = this.looks[slot];
    const put = (name: string, index: number, mat: THREE.Matrix4 | null) => {
      const m = this.meshes.get(name);
      if (!m) return;
      m.setMatrixAt(index, mat ?? this.zero);
      this.dirty.add(m);
    };
    for (const k of PART_KEYS) {
      const show = k === 'glow' ? glowOn : visible.has(k);
      switch (k) {
        case 'hair':
        case 'hat':
        case 'facial': {
          // one mesh per variant: only this person's is set, the others stay zero
          const g = look[k];
          if (g) put(g, slot, show ? rig[k] : null);
          continue;
        }
        case 'handL':
        case 'handR': {
          const side = k === 'handL' ? 'L' : 'R';
          const grip: Grip = k === 'handL' ? rig.gripL : rig.gripR;
          for (const g of GRIPS) put(`hand${side}_${g}`, slot, show && g === grip ? rig[k] : null);
          continue;
        }
        case 'footL':
        case 'footR': {
          const idx = slot * 2 + (k === 'footR' ? 1 : 0);
          for (const s of ['shoe', 'sneaker', 'boot']) put(s, idx, show && s === look.shoe ? rig[k] : null);
          continue;
        }
      }
      const g = STATIC_GEO[k]!;
      const index = PAIRED.has(g) ? slot * 2 + (RIGHT[k] ?? 0) : slot;
      put(g, index, show ? rig[k] : null);
    }
  }

  /** When someone changes clothes, whatever they were showing is cleared first. */
  clearVariants(slot: number) {
    for (const g of this.looks[slot].meshes) {
      const m = this.meshes.get(g);
      if (!m) continue;
      if (m.count === this.capacity * 2) {
        m.setMatrixAt(slot * 2, this.zero);
        m.setMatrixAt(slot * 2 + 1, this.zero);
      } else m.setMatrixAt(slot, this.zero);
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

function mix(a: number, b: number, t: number) {
  return new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
}
