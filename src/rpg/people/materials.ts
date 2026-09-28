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

const SKIN_WRAP = /* glsl */ `
  #ifdef NF_SKIN
    float nlr = dot( geometryNormal, directLight.direction );
    vec3 wrapD = vec3( saturate( ( nlr + 0.42 ) / 1.42 ), saturate( ( nlr + 0.2 ) / 1.2 ), saturate( ( nlr + 0.14 ) / 1.14 ) );
    wrapD = wrapD * wrapD * ( 3.0 - 2.0 * wrapD );
    reflectedLight.directDiffuse += wrapD * directLight.color * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
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
export function skinMaterial(color: number, face: THREE.Vector3, stubble: number, lip: number): THREE.MeshPhysicalMaterial {
  // a dimmer specular than the default 4% (skin's is broad and soft), and a faint sheen of fine hair
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.6, metalness: 0, specularIntensity: 0.55, sheen: 0.18, sheenRoughness: 0.8, sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.5) });
  m.defines = { NF_SKIN: '' };
  m.onBeforeCompile = (sh) => {
    common(sh);
    sh.uniforms.uFace = { value: face };
    sh.uniforms.uStubble = { value: stubble };
    sh.uniforms.uLip = { value: new THREE.Color(lip) };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <lights_physical_pars_fragment>', skinLightsChunk())
      .replace('#include <common>', `#include <common>\nuniform vec3 uFace;\nuniform float uStubble;\nuniform vec3 uLip;`)
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
  // lips
  float lipM = exp(-pow(length((f - vec3(0.0, -0.061, 0.106)) / vec3(0.02, 0.009, 0.012)), 4.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, uLip, lipM * 0.75);
  // stubble / beard shadow on the jaw, chin and upper lip
  float jaw = smoothstep(-0.02, -0.06, f.y) * smoothstep(0.02, 0.05, f.z) * smoothstep(-0.13, -0.08, f.y) * (1.0 - lipM);
  float lipTop = exp(-pow(length((f - vec3(0.0, -0.049, 0.107)) / vec3(0.024, 0.007, 0.015)), 2.0));
  float stub = clamp(jaw + lipTop, 0.0, 1.0) * uStubble * (0.6 + 0.4 * n3(vBind * 900.0));
  diffuseColor.rgb *= 1.0 - stub * 0.45;
  // freckles, moles, the unevenness of real skin
  float blotch = n3(vBind * 60.0);
  diffuseColor.rgb *= 0.93 + 0.12 * blotch;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.72, 0.6, 0.55), step(0.985, nf_hash(floor(vBind.xy * 420.0) + floor(vBind.z * 420.0))) * 0.6);
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
export function hairMaterial(color: number, crown: THREE.Vector3): THREE.MeshStandardMaterial {
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
  roughnessFactor = clamp(0.32 + strand * 0.35 - uWetP * 0.15, 0.15, 0.9);
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
  m.customProgramCacheKey = () => 'nf-rpg-hair';
  return m;
}

/** An eyeball: sclera, an iris with fibres, the pupil, and a wet clear coat over it all. */
export function eyeMaterial(iris: number): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.04, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uIris = { value: new THREE.Color(iris) };
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
  m.customProgramCacheKey = () => 'nf-rpg-eye';
  return m;
}
