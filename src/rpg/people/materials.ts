import * as THREE from 'three';
import { NOISE } from '../../render/glsl';
import type { Fabric, MatKind } from './anatomy';

/**
 * How RPG people are shaded. Skin lets light in: the diffuse wraps round
 * into the shadow side with a warm red edge, the face is redder at the
 * cheeks, nose, ears and lips, and the surface has pores and a little oil.
 * Cloth has a weave you can see up close and a soft sheen at grazing angles.
 * Hair is strands. Eyes are wet. Every part carries baked occlusion from the
 * sculpt (armpits, collars, the corners of the eyes).
 *
 * All the detail is procedural, in the bind pose's own coordinates, so it
 * stays put on the body as it moves.
 */

const BROW_FN = /* glsl */ `
// an eyebrow over this eye: an arched band of short hairs, thicker at the inner end, strokes combed outward
float nfBrow(vec3 eye) {
  vec3 d = vBind - eye;
  float ox = d.x * sign(eye.x);
  float t = clamp((ox + 0.019) / 0.047, 0.0, 1.0);
  float arch = uEyeR * 1.1 + 0.0045 + 0.004 * sin(t * 3.14159) - 0.004 * t;
  float w = 0.0036 * (1.35 - 0.7 * t) * (0.8 + 0.5 * uBrowK);
  float band = exp(-pow((d.y - arch) / w, 2.0)) * smoothstep(-0.021, -0.017, ox) * (1.0 - smoothstep(0.024, 0.03, ox)) * smoothstep(-0.02, 0.0, d.z);
  float hairs = n3(vec3(ox * 260.0 + d.y * 120.0, d.y * 1400.0 - ox * 200.0, 3.0));
  return band * smoothstep(0.3, 0.62, hairs * 0.7 + band * 0.35);
}
`;

const SKIN_WRAP = /* glsl */ `
  #ifdef NF_SKIN
    float nlr = dot( geometryNormal, directLight.direction );
    // light soaks further round the thin, fleshy parts (ears, nose, lips, fingers: MPFB2's thickness map)
    float wk = 0.75 + 0.7 * nfThin;
    vec3 wrapD = vec3( saturate( ( nlr + 0.42 * wk ) / ( 1.0 + 0.42 * wk ) ), saturate( ( nlr + 0.2 * wk ) / ( 1.0 + 0.2 * wk ) ), saturate( ( nlr + 0.14 * wk ) / ( 1.0 + 0.14 * wk ) ) );
    wrapD = wrapD * wrapD * ( 3.0 - 2.0 * wrapD );
    reflectedLight.directDiffuse += wrapD * directLight.color * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
    // and shines through them from behind (a red ear against the sun)
    reflectedLight.directDiffuse += directLight.color * vec3( 0.9, 0.22, 0.12 ) * pow( saturate( -nlr ), 1.5 ) * nfThin * nfThin * 0.35 * material.diffuseContribution;
  #else
    reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
  #endif`;

const DIRECT_LINE = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );';
let skinPars: string | null = null;
function skinLightsChunk() {
  if (skinPars) return skinPars;
  const src = THREE.ShaderChunk.lights_physical_pars_fragment;
  skinPars = src.includes(DIRECT_LINE) ? src.replace(DIRECT_LINE, SKIN_WRAP) : src;
  return skinPars;
}

/**
 * Textures from MakeHuman and MPFB2 (CC0), packed by tools/mh/textures.py:
 * the photographed eyeball, and the body's region masks (lips, eyelids,
 * nails, and how thin the flesh is) in MakeHuman's UVs.
 */
let TEX: { eye: THREE.Texture; regions: THREE.Texture } | null = null;
function peopleTextures() {
  if (TEX) return TEX;
  const l = new THREE.TextureLoader();
  const base = `${import.meta.env.BASE_URL ?? '/'}rpg/mh/`;
  const eye = l.load(`${base}eye.png`);
  eye.colorSpace = THREE.SRGBColorSpace;
  eye.anisotropy = 4;
  const regions = l.load(`${base}regions.png`);
  regions.colorSpace = THREE.NoColorSpace;
  TEX = { eye, regions };
  return TEX;
}

/** A tiling normal map (emmelleppi's CC0 set, via @pmndrs/assets), repeated this many times across the body's UVs. */
const NORMALS = new Map<string, THREE.Texture>();
function normalTex(name: string, repeat: number) {
  const key = `${name}:${repeat}`;
  let t = NORMALS.get(key);
  if (t) return t;
  const base = NORMALS.get(name) ?? new THREE.TextureLoader().load(`${import.meta.env.BASE_URL ?? '/'}rpg/tex/n_${name}.webp`);
  base.colorSpace = THREE.NoColorSpace;
  base.wrapS = base.wrapT = THREE.RepeatWrapping;
  NORMALS.set(name, base);
  t = base.clone();
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  NORMALS.set(key, t);
  return t;
}

/** Which real surface each fabric gets up close: its normal map, how finely it tiles, how strongly. */
const FABRIC_NORMAL: Record<Fabric, [string, number, number]> = {
  cotton: ['weave', 110, 0.3],
  denim: ['weave', 70, 0.5],
  wool: ['weave', 60, 0.45],
  leather: ['leather', 55, 0.18],
  canvas: ['weave', 60, 0.45],
  knit: ['weave', 45, 0.55],
  nylon: ['weave', 140, 0.12],
  silk: ['weave', 160, 0.06],
};

export const peopleUniforms = {
  uTime: { value: 0 },
  /** wet from the rain (darker, glossier cloth and hair) */
  uWetP: { value: 0 },
  /** cold: redder noses and ears */
  uCold: { value: 0 },
};

function common(sh: THREE.WebGLProgramParametersWithUniforms) {
  Object.assign(sh.uniforms, peopleUniforms);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>\nattribute float ao;\nvarying float vAO;\nvarying vec3 vBind;\nvarying vec3 vBindN;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\nvAO = ao;\nvBind = position;\nvBindN = normal;`);
  sh.fragmentShader = sh.fragmentShader.replace(
    '#include <common>',
    `#include <common>\nuniform float uTime;\nuniform float uWetP;\nuniform float uCold;\nvarying float vAO;\nvarying vec3 vBind;\nvarying vec3 vBindN;\n${NOISE}\nfloat n3(vec3 p){ return nf_noise(p.xy + p.z * 1.7) * 0.5 + nf_noise(p.yz * 1.3 - p.x) * 0.5; }`,
  );
}

function aoPass(frag: string) {
  // occlusion darkens the ambient and a little of the direct light (it's cavities, not shadow)
  return frag.replace('#include <aomap_fragment>', `#include <aomap_fragment>\n reflectedLight.indirectDiffuse *= vAO;\n reflectedLight.indirectSpecular *= mix(0.5, 1.0, vAO);\n reflectedLight.directDiffuse *= mix(0.7, 1.0, vAO);`);
}

/** Skin: `face` = the head centre in bind space (for the red zones, the stubble, the lips). */
export function skinMaterial(color: number, face: THREE.Vector3, stubble: number, lip: number, brows?: { eyes: [number, number, number][]; r: number; color: number; thick: number }): THREE.MeshPhysicalMaterial {
  // a dimmer specular than the default 4% (skin's is broad and soft), and a faint sheen of fine hair
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.6, metalness: 0, specularIntensity: 0.55, sheen: 0.18, sheenRoughness: 0.8, sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.5) });
  m.defines = { NF_SKIN: '', USE_UV: '' };
  // real pores and fine lines (a photographed skin-grain normal map, tiled finely over the body's UVs)
  m.normalMap = normalTex('pores', 48);
  m.normalScale.set(0.28, 0.28);
  m.onBeforeCompile = (sh) => {
    common(sh);
    sh.uniforms.uRegions = { value: peopleTextures().regions };
    const e = brows?.eyes ?? [[0, -9, 0], [0, -9, 0]];
    sh.uniforms.uEyeA = { value: new THREE.Vector3(...e[0]) };
    sh.uniforms.uEyeB = { value: new THREE.Vector3(...e[1]) };
    sh.uniforms.uEyeR = { value: brows?.r ?? 0.012 };
    sh.uniforms.uBrow = { value: new THREE.Color(brows?.color ?? 0x2a1c12) };
    sh.uniforms.uBrowK = { value: brows ? brows.thick : 0 };
    sh.uniforms.uFace = { value: face };
    sh.uniforms.uStubble = { value: stubble };
    sh.uniforms.uLip = { value: new THREE.Color(lip) };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <lights_physical_pars_fragment>', skinLightsChunk())
      .replace('void main() {', `${BROW_FN}\nvoid main() {`)
      .replace('#include <common>', `#include <common>\nuniform vec3 uFace;\nuniform float uStubble;\nuniform vec3 uLip;\nuniform sampler2D uRegions;\nfloat nfThin = 0.0;\nfloat nfBrowM = 0.0;\nuniform vec3 uEyeA;\nuniform vec3 uEyeB;\nuniform float uEyeR;\nuniform vec3 uBrow;\nuniform float uBrowK;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 f = vBind - uFace;
  // blood close to the surface: cheeks, nose, ears, lips, knuckles
  float cheeks = exp(-pow(length((f - vec3(sign(f.x) * 0.045, -0.018, 0.075)) / vec3(0.028, 0.026, 0.03)), 2.0));
  float nose = exp(-pow(length((f - vec3(0.0, -0.028, 0.12)) / vec3(0.018, 0.02, 0.02)), 2.0));
  float ears = exp(-pow(length((vec3(abs(f.x), f.y, f.z) - vec3(0.078, 0.0, 0.0)) / vec3(0.018, 0.035, 0.03)), 2.0));
  vec3 flush = vec3(0.7, 0.28, 0.24);
  float red = cheeks * 0.22 + nose * 0.25 + ears * 0.3;
  red *= 1.0 + uCold * 1.6;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * flush * 1.5, clamp(red, 0.0, 0.6));
  // eyebrows
  if (uBrowK > 0.0) {
    float brow = max(nfBrow(uEyeA), nfBrow(uEyeB));
    nfBrowM = clamp(brow, 0.0, 1.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, uBrow, nfBrowM * 0.92);
  }
  // the body's own regions, from MPFB2's masks: lips, eyelids, nails, thin flesh
  vec4 reg = texture2D(uRegions, vUv);
  nfThin = reg.a;
  float lipM = reg.r;
  diffuseColor.rgb = mix(diffuseColor.rgb, uLip, lipM * 0.72);
  // eyelids: thinner skin, a touch darker and pinker
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.86, 0.72, 0.72), reg.g * 0.6);
  // nails: pale, pink where they sit on the nail bed
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.82, 0.66, 0.62), diffuseColor.rgb, 0.35), reg.b * 0.8);
  // stubble / beard shadow on the jaw, chin and upper lip
  float jaw = smoothstep(-0.02, -0.06, f.y) * smoothstep(0.02, 0.05, f.z) * smoothstep(-0.13, -0.08, f.y) * (1.0 - lipM);
  float lipTop = exp(-pow(length((f - vec3(0.0, -0.049, 0.107)) / vec3(0.024, 0.007, 0.015)), 2.0));
  float stub = clamp(jaw + lipTop, 0.0, 1.0) * uStubble * (0.6 + 0.4 * n3(vBind * 900.0));
  diffuseColor.rgb *= 1.0 - stub * 0.45;
  // freckles, moles, the unevenness of real skin
  float blotch = n3(vBind * 60.0);
  diffuseColor.rgb *= 0.93 + 0.12 * blotch;
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
{
  vec3 f = vBind - uFace;
  // the T-zone shines a little; pores break up the highlight
  float tzone = exp(-pow(length((f - vec3(0.0, 0.0, 0.11)) / vec3(0.025, 0.07, 0.04)), 2.0));
  roughnessFactor = clamp(roughnessFactor - tzone * 0.14 + (n3(vBind * 700.0) - 0.5) * 0.12, 0.25, 0.8);
  vec4 regR = texture2D(uRegions, vUv);
  // wet lips, glossy nails
  roughnessFactor = mix(roughnessFactor, 0.28, regR.r * 0.8);
  roughnessFactor = mix(roughnessFactor, 0.2, regR.b);
  // hair doesn't shine like skin
  roughnessFactor = mix(roughnessFactor, 0.85, nfBrowM);
}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  // pores and fine lines
  vec3 q = vBind * 1100.0;
  vec3 j = vec3(n3(q), n3(q + 13.1), n3(q + 29.7)) - 0.5;
  normal = normalize(normal + j * 0.06);
}`,
      );
    sh.fragmentShader = aoPass(sh.fragmentShader);
  };
  m.customProgramCacheKey = () => 'nf-rpg-skin';
  return m;
}

const FABRIC: Record<Fabric, { rough: number; sheen: number; scale: number; bump: number; pattern: number }> = {
  cotton: { rough: 0.86, sheen: 0.25, scale: 900, bump: 0.18, pattern: 0 },
  denim: { rough: 0.9, sheen: 0.15, scale: 700, bump: 0.3, pattern: 1 },
  wool: { rough: 0.95, sheen: 0.6, scale: 350, bump: 0.25, pattern: 2 },
  leather: { rough: 0.48, sheen: 0, scale: 120, bump: 0.2, pattern: 3 },
  canvas: { rough: 0.9, sheen: 0.1, scale: 500, bump: 0.3, pattern: 4 },
  knit: { rough: 0.95, sheen: 0.5, scale: 260, bump: 0.45, pattern: 5 },
  nylon: { rough: 0.55, sheen: 0.1, scale: 800, bump: 0.12, pattern: 0 },
  silk: { rough: 0.35, sheen: 0.8, scale: 900, bump: 0.05, pattern: 0 },
};

/** Cloth (and leather, rubber soles): the weave in the normal, sheen at the edges, wear at the seams. */
export function fabricMaterial(color: number, fabric: Fabric, kind: MatKind): THREE.MeshPhysicalMaterial {
  const f = FABRIC[fabric];
  const m = new THREE.MeshPhysicalMaterial({
    color,
    roughness: f.rough,
    metalness: 0,
    sheen: f.sheen,
    sheenRoughness: 0.75,
    sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35),
  });
  // the weave, the knit, the grain of the leather: a real normal map where the part has UVs (MakeHuman's clothes)
  const [nm, rep, str] = FABRIC_NORMAL[fabric];
  m.normalMap = normalTex(nm, rep);
  m.normalScale.set(str, str);
  m.onBeforeCompile = (sh) => {
    common(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  // wear: faded where it rubs, darker in the creases; a little grime low down
  float wear = n3(vBind * 18.0);
  diffuseColor.rgb *= 0.86 + 0.2 * wear;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.72, smoothstep(0.35, 0.0, vBind.y) * 0.5);
  diffuseColor.rgb *= mix(1.0, 0.55, uWetP * ${fabric === 'leather' ? '0.2' : '0.8'});
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
 roughnessFactor = mix(roughnessFactor, ${fabric === 'leather' ? '0.2' : '0.45'}, uWetP * 0.8);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec3 q = vBind * ${f.scale.toFixed(1)};
  float w;
  ${
    f.pattern === 1
      ? 'w = fract((q.x + q.z) * 0.5 + q.y * 0.5) ;'
      : f.pattern === 2
        ? 'w = n3(q) * 0.7 + n3(q * 3.1) * 0.3;'
        : f.pattern === 3
          ? 'w = n3(q) + n3(q * 4.0) * 0.4;'
          : f.pattern === 4
            ? 'w = step(0.5, fract(q.x + q.z)) * 0.5 + step(0.5, fract(q.y)) * 0.5;'
            : f.pattern === 5
              ? 'w = abs(sin((q.x + q.z) * 3.14159)) + n3(q * 0.5) * 0.3;'
              : 'w = step(0.5, fract(q.x + q.z)) * 0.5 + step(0.5, fract(q.y)) * 0.5 + n3(q) * 0.3;'
  }
  vec3 j = vec3(sin(w * 6.283), cos(w * 6.283), n3(q * 0.37) - 0.5);
  normal = normalize(normal + j * ${f.bump.toFixed(2)} * 0.25);
}`,
      );
    sh.fragmentShader = aoPass(sh.fragmentShader);
  };
  m.customProgramCacheKey = () => `nf-rpg-fabric-${fabric}-${kind}`;
  return m;
}

/** Hair: strands along the flow (down from the crown), light at the tips, a sheen along them. */
export function hairMaterial(color: number, crown: THREE.Vector3, matte = false): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    common(sh);
    sh.uniforms.uCrown = { value: crown };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uCrown;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 d = vBind - uCrown;
  // strands: fine stripes across the flow direction, grouped into locks
  float ang = atan(d.x, d.z);
  float along = length(d);
  float strand = nf_noise(vec2(ang * 260.0, along * 18.0));
  float lock = nf_noise(vec2(ang * 22.0, along * 4.0));
  diffuseColor.rgb *= 0.55 + 0.55 * strand * (0.6 + 0.6 * lock);
  diffuseColor.rgb *= mix(1.0, 0.6, uWetP);
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
{
  vec3 d = vBind - uCrown;
  float strand = nf_noise(vec2(atan(d.x, d.z) * 260.0, length(d) * 18.0));
  roughnessFactor = clamp(${matte ? '0.75' : '0.32'} + strand * 0.35 - uWetP * 0.15, 0.15, 0.95);
}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec3 d = vBind - uCrown;
  float s = nf_noise(vec2(atan(d.x, d.z) * 300.0, length(d) * 10.0));
  normal = normalize(normal + vec3(s - 0.5, 0.0, 0.5 - s) * 0.35);
}`,
      );
    sh.fragmentShader = aoPass(sh.fragmentShader);
  };
  m.customProgramCacheKey = () => `nf-rpg-hair${matte ? '-matte' : ''}`;
  return m;
}

let strands: THREE.CanvasTexture | null = null;
/**
 * The strands a hair card carries, drawn once: a couple of hundred fine
 * hairs across the card, each its own length and shade, darker at the root,
 * thinning to nothing at the tip (alpha).
 */
function strandTexture() {
  if (strands) return strands;
  const W = 256, H = 512;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 260; i++) {
    const x = r() * W;
    const len = H * (0.55 + r() * 0.45);
    const drift = (r() - 0.5) * 10;
    // (a wide spread of shades, so the strands read even on dark hair in shade)
    const shade = 95 + r() * 160;
    const w = 0.8 + r() * 1.4;
    // a hair: dark at the root, its own shade along, fading out at the tip
    const grad = g.createLinearGradient(0, 0, 0, len);
    grad.addColorStop(0, `rgba(${shade * 0.55},${shade * 0.55},${shade * 0.55},1)`);
    grad.addColorStop(0.25, `rgba(${shade},${shade},${shade},1)`);
    grad.addColorStop(0.8, `rgba(${shade},${shade},${shade},0.9)`);
    grad.addColorStop(1, `rgba(${shade},${shade},${shade},0)`);
    g.strokeStyle = grad;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, 0);
    g.bezierCurveTo(x + drift * 0.3, len * 0.33, x + drift * 0.7, len * 0.66, x + drift, len);
    g.stroke();
  }
  strands = new THREE.CanvasTexture(cv);
  strands.flipY = false;
  strands.colorSpace = THREE.SRGBColorSpace;
  strands.anisotropy = 8;
  strands.wrapS = THREE.RepeatWrapping;
  return strands;
}

/**
 * Hair cards: the strand texture, cut out by its alpha, with a soft sheen.
 */
export function hairCardMaterial(color: number): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color, map: strandTexture(), alphaTest: 0.42, side: THREE.DoubleSide,
    roughness: 0.58, metalness: 0, specularIntensity: 0.3,
  });
  m.onBeforeCompile = (sh) => {
    // both faces of a card are the outside of the hair: no flipping the normal round for the back
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal);');
  };
  m.customProgramCacheKey = () => 'nf-rpg-haircard';
  return m;
}

/**
 * An eyeball: MakeHuman's photographed eye (veined sclera, a fibrous iris)
 * tinted to this person's eye colour, a dark limbal ring, and a wet clear coat
 * over it all. Without UVs (the sculpted far detail) it's drawn procedurally.
 */
export function eyeMaterial(iris: number, textured = false): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, metalness: 0 });
  if (textured) m.map = peopleTextures().eye;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uIris = { value: new THREE.Color(iris) };
    if (textured) {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform vec3 uIris;`)
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
{
  // MakeHuman's cornea is a clear shell over the iris (its UVs sit on the swatch in the corner): not drawn,
  // the eyeball's own clear coat is the wet surface
  if (vMapUv.x > 0.82 && vMapUv.y < 0.18) discard;
  float ir = sampledDiffuseColor.a;
  // tint the grey iris to their colour (brighter towards the pupil), and ring it with the dark limbus
  vec3 tinted = sampledDiffuseColor.rgb * uIris * 2.4;
  diffuseColor.rgb = mix(sampledDiffuseColor.rgb, tinted, ir);
  float limbus = smoothstep(0.0, 0.35, ir) * (1.0 - smoothstep(0.35, 0.9, ir));
  diffuseColor.rgb *= 1.0 - limbus * 0.55;
  diffuseColor.a = 1.0;
}`,
        );
      return;
    }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec3 eyeLocal;\nvarying vec3 vE;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvE = eyeLocal;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uIris;\nvarying vec3 vE;\n${NOISE}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 e = normalize(vE);
  float r = length(e.xy) * step(0.0, e.z) + step(e.z, 0.0);
  float ang = atan(e.y, e.x);
  vec3 sclera = vec3(0.74, 0.7, 0.66) * (0.9 + 0.1 * nf_noise(e.xy * 40.0));
  sclera = mix(sclera, vec3(0.8, 0.45, 0.42), smoothstep(0.55, 1.0, r) * 0.25);
  float fib = nf_noise(vec2(ang * 30.0, r * 20.0));
  vec3 irisC = uIris * (0.55 + 0.7 * fib) * mix(1.25, 0.6, smoothstep(0.1, 0.42, r));
  vec3 c = mix(irisC, sclera, smoothstep(0.4, 0.44, r));
  c = mix(vec3(0.01), c, smoothstep(0.14, 0.17, r));
  diffuseColor.rgb = c;
}`,
      );
  };
  m.customProgramCacheKey = () => (textured ? 'nf-rpg-eye-tex' : 'nf-rpg-eye');
  return m;
}
