import * as THREE from 'three';
import { NOISE } from '../render/glsl';

/**
 * Shared world uniforms. Driven by TimeOfDay / Weather each frame so every
 * material that reads them stays in sync (window lights, wetness, the loop flicker).
 */
export const worldUniforms = {
  uTime: { value: 0 },
  uLitScale: { value: 1 }, // fraction of windows still lit (drops towards dawn)
  uEmit: { value: 1 }, // global emissive gain (dips during the loop reset)
  uWet: { value: 0.85 }, // ground wetness
};

export const STYLE_INDEX = { stone: 0, brick: 1, concrete: 2, glass: 3, plain: 4, metal: 5, stucco: 6, adobe: 7, timber: 8, panel: 9, siding: 10 } as const;

/* ─────────────────────────────────────────────────────────────
   Facade material — procedural windows, storefronts, weathering.
   Per-building parameters arrive as vertex attributes so the whole
   city can be merged into a handful of draw calls.
     aBld = (seed, floorHeight, windowSpacing, litRatio [<0 = blank wall])
     aTop = (roofHeight, styleIndex[, baseHeight]) — base defaults to 0 (District 03 stands at sea level)
   ───────────────────────────────────────────────────────────── */

function patchFacade(shader: THREE.WebGLProgramParametersWithUniforms) {
  Object.assign(shader.uniforms, worldUniforms);
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
attribute vec4 aBld;
attribute vec3 aTop;
varying vec3 vWPos;
varying vec3 vWNrm;
flat varying vec4 vBld;
flat varying vec3 vTop;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNrm = normalize(mat3(modelMatrix) * objectNormal);
vBld = aBld;
vTop = aTop;`,
    );

  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
uniform float uTime;
uniform float uLitScale;
uniform float uEmit;
uniform float uWet;
varying vec3 vWPos;
varying vec3 vWNrm;
flat varying vec4 vBld;
flat varying vec3 vTop;
${NOISE}`,
    )
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
{
  vec3 n = normalize(vWNrm);
  float seed = vBld.x;
  float floorH = vBld.y;
  float winW = vBld.z;
  float litR = vBld.w;
  float style = vTop.y;
  float roofY = vTop.x - vTop.z;

  vec3 wallCol;
  float rough = 0.86;
  if (style < 0.5) wallCol = vec3(0.27, 0.25, 0.225);
  else if (style < 1.5) wallCol = vec3(0.21, 0.125, 0.095);
  else if (style < 2.5) wallCol = vec3(0.2, 0.205, 0.205);
  else if (style < 3.5) wallCol = vec3(0.07, 0.08, 0.09);
  else if (style < 4.5) wallCol = vec3(0.22, 0.22, 0.215);
  else if (style < 5.5) wallCol = vec3(0.19, 0.2, 0.2);
  // the other cities (RPG): colour comes from the building's seed
  else if (style < 6.5) {
    float k = fract(seed * 0.618);
    wallCol = k < 0.3 ? vec3(0.62, 0.6, 0.55) : k < 0.5 ? vec3(0.6, 0.52, 0.4) : k < 0.65 ? vec3(0.55, 0.38, 0.32) : k < 0.8 ? vec3(0.42, 0.5, 0.55) : vec3(0.58, 0.48, 0.28);
  }
  else if (style < 7.5) wallCol = mix(vec3(0.46, 0.33, 0.21), vec3(0.52, 0.28, 0.18), fract(seed * 0.37));
  else if (style < 8.5) wallCol = mix(vec3(0.17, 0.11, 0.07), vec3(0.26, 0.17, 0.1), fract(seed * 0.51));
  else if (style < 9.5) wallCol = mix(vec3(0.3, 0.3, 0.29), vec3(0.34, 0.31, 0.27), fract(seed * 0.29));
  else {
    float k = fract(seed * 0.73);
    wallCol = k < 0.3 ? vec3(0.6, 0.6, 0.58) : k < 0.5 ? vec3(0.36, 0.45, 0.52) : k < 0.7 ? vec3(0.4, 0.46, 0.38) : k < 0.85 ? vec3(0.58, 0.52, 0.34) : vec3(0.3, 0.3, 0.32);
  }

  bool xFacing = abs(n.x) > abs(n.z);
  float u = xFacing ? vWPos.z : vWPos.x;
  float y = vWPos.y - vTop.z;
  float grain = nf_noise(vec2(u, y) * 0.4 + seed * 7.0);
  float streak = nf_noise(vec2(u * 1.3, y * 0.05) + seed * 3.0);
  vec3 col = wallCol * (0.78 + 0.34 * grain) * (0.8 + 0.28 * streak);
  vec3 emi = vec3(0.0);

  if (n.y > 0.5) {
    // roofs: tar, puddled
    float pud = smoothstep(0.55, 0.62, nf_fbm(vWPos.xz * 0.2 + seed));
    col = vec3(0.05, 0.05, 0.052) * (0.8 + 0.3 * grain);
    rough = mix(0.8, 0.1, pud * uWet);
  } else if (n.y < -0.5) {
    col = wallCol * 0.4;
  } else {
    if (style > 7.5 && style < 8.5) {
      // timber: vertical boards
      col *= 0.8 + 0.2 * step(0.08, fract(u * 3.3));
      rough = 0.8;
    }
    if (style > 8.5 && style < 9.5) {
      // precast panels
      vec2 pc = fract(vec2(u / 3.0, y / 2.9));
      col *= mix(0.62, 1.0, step(0.03, pc.x) * step(0.04, pc.y));
      col = mix(col, vec3(0.18, 0.12, 0.08), smoothstep(0.6, 0.95, streak) * 0.4);
    }
    if (style > 9.5) {
      // clapboard siding
      col *= 0.82 + 0.18 * smoothstep(0.0, 0.15, fract(y * 4.2));
      rough = 0.6;
    }
    if (style > 4.5 && style < 5.5) {
      // corrugated cladding
      col *= 0.78 + 0.22 * sin(u * 9.0);
      col = mix(col, vec3(0.2, 0.12, 0.07), smoothstep(0.55, 0.9, streak) * 0.5);
      rough = 0.55;
    }
    if (style < 1.5) {
      // storey ledges
      float ledge = smoothstep(0.0, 0.05, fract((y - 0.2) / floorH)) ;
      col *= mix(0.62, 1.0, ledge);
    }
    if (style > 0.5 && style < 1.5) {
      // brick coursing
      vec2 bc = vec2(u * 4.0 + step(0.5, fract(y * 6.0)) * 0.5, y * 12.0);
      float mortar = step(0.9, fract(bc.x)) + step(0.85, fract(bc.y));
      col = mix(col, vec3(0.16, 0.15, 0.14), clamp(mortar, 0.0, 1.0) * 0.35);
    }

    if (litR >= 0.0 && (style < 4.5 || style > 5.5)) {
      float gh = floorH * 1.3;
      if (y > gh && y < roofY - 1.1) {
        float fy0 = (y - gh) / floorH;
        float cy = floor(fy0);
        float fy = fract(fy0);
        float fu0 = u / winW + seed * 31.0;
        float cx = floor(fu0);
        float fx = fract(fu0);
        float mask;
        if (style > 2.5 && style < 5.5) mask = step(0.05, fx) * step(fx, 0.95) * step(0.08, fy) * step(fy, 0.93);
        else if ((style > 1.5 && style < 2.5) || (style > 8.5 && style < 9.5)) mask = step(0.1, fx) * step(fx, 0.9) * step(0.3, fy) * step(fy, 0.8);
        else if (style > 6.5 && style < 7.5) mask = step(0.34, fx) * step(fx, 0.66) * step(0.25, fy) * step(fy, 0.75);
        else mask = step(0.24, fx) * step(fx, 0.76) * step(0.18, fy) * step(fy, 0.84);
        if (mask > 0.5) {
          float h = nf_hash(vec2(cx, cy) + seed * vec2(13.1, 7.7));
          float h2 = nf_hash(vec2(cx, cy) * 1.7 + seed * 2.3);
          float h3 = nf_hash(vec2(cx, cy) * 3.1 + seed * 5.9);
          col = vec3(0.012, 0.014, 0.018);
          rough = 0.07;
          if (h < litR * uLitScale) {
            vec3 warm = mix(vec3(1.0, 0.58, 0.28), vec3(1.0, 0.8, 0.58), h2);
            float g = 1.0;
            if (h3 > 0.95) {
              warm = vec3(0.42, 0.56, 1.0);
              g = 0.55 + 0.45 * sin(uTime * (2.0 + h2 * 6.0) + h * 40.0) * sin(uTime * 1.3 + h3 * 9.0);
            }
            float inner = 0.45 + 0.55 * smoothstep(0.0, 1.0, fy);
            if (h2 > 0.7) inner *= 0.6 + 0.4 * smoothstep(0.35, 0.65, fract(fy * 6.0));
            if (h2 < 0.2) inner *= 0.3 + 0.7 * smoothstep(0.26, 0.34, abs(fx - 0.5));
            emi = warm * inner * (0.28 + 0.9 * h2) * g * uEmit;
            col = warm * 0.05;
          } else if (style > 2.5) {
            col = vec3(0.02, 0.025, 0.03);
          }
        } else if (style > 2.5 && style < 5.5) {
          col = vec3(0.1, 0.105, 0.11) * (0.8 + 0.3 * grain);
          rough = 0.4;
        }
      } else if (y <= gh) {
        // storefronts
        float su = u / (winW * 1.8) + seed * 11.0;
        float scx = floor(su);
        float sfx = fract(su);
        float sfy = y / gh;
        float pane = step(0.06, sfx) * step(sfx, 0.94) * step(0.1, sfy) * step(sfy, 0.7);
        float sh = nf_hash(vec2(scx, seed * 3.1));
        float sh2 = nf_hash(vec2(scx * 2.7, seed));
        if (sfy > 0.74 && sfy < 0.9) {
          col = vec3(0.045, 0.045, 0.048);
          rough = 0.5;
        }
        if (pane > 0.5) {
          if (sh < litR * 0.6 * uLitScale + 0.03) {
            vec3 shop = sh2 > 0.7 ? vec3(0.8, 0.86, 0.85) : vec3(1.0, 0.66, 0.38);
            // an interior: brighter towards the back ceiling, shelving silhouettes, a mullion
            float depth = smoothstep(0.1, 0.7, sfy) * (0.7 + 0.3 * sin(sfx * 3.14159));
            float shelves = 1.0 - 0.55 * step(0.5, fract(sfy * 5.0 + sh2)) * step(sfy, 0.45);
            float mull = step(0.035, abs(sfx - 0.5));
            emi = shop * (0.22 + 0.55 * sh2) * depth * shelves * mull * uEmit;
            col = shop * 0.03;
            rough = 0.05;
          } else if (sh > 0.62) {
            col = vec3(0.14, 0.14, 0.145) * (0.7 + 0.3 * step(0.5, fract(y * 7.0))) * (0.8 + 0.3 * grain);
            rough = 0.45;
          } else {
            col = vec3(0.015, 0.016, 0.02);
            rough = 0.05;
          }
        }
      }
    }
    // rain darkening at the foot of walls
    col *= mix(0.55, 1.0, smoothstep(0.0, 1.4, y));
  }

  diffuseColor.rgb = col;
  roughnessFactor = rough;
  totalEmissiveRadiance = emi;
}`,
    )
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>');
}

export function createFacadeMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.0, envMapIntensity: 0.6 });
  m.onBeforeCompile = patchFacade;
  m.customProgramCacheKey = () => 'nf-facade';
  return m;
}

/* ─────────────────────────────────────────────────────────────
   Ground — asphalt / paving / yard concrete with rain puddles.
   ───────────────────────────────────────────────────────────── */

export function createGroundMaterial(kind: 0 | 1 | 2): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.0, envMapIntensity: 1.0 });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, worldUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uWet;\nuniform float uTime;\nvarying vec3 vWPos;\n${NOISE}`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  vec2 p = vWPos.xz;
  float big = nf_fbm(p * 0.06);
  float small = nf_noise(p * 0.8);
  float puddle = smoothstep(0.57, 0.63, big + small * 0.04) * uWet;
  vec3 base;
  float joint = 1.0;
  #if ${kind} == 0
    base = vec3(0.075, 0.077, 0.082) * (0.75 + 0.45 * small) * (0.85 + 0.3 * nf_noise(p * 0.12));
  #elif ${kind} == 1
    vec2 tp = p / vec2(0.9, 1.35);
    vec2 t = fract(tp);
    joint = step(0.04, t.x) * step(0.04, t.y);
    base = vec3(0.16, 0.155, 0.145) * (0.72 + 0.34 * nf_hash(floor(tp))) * mix(0.45, 1.0, joint);
  #else
    vec2 t = fract(p / 6.0);
    joint = step(0.006, t.x) * step(0.006, t.y);
    base = vec3(0.13, 0.13, 0.125) * (0.7 + 0.4 * nf_fbm(p * 0.3)) * mix(0.4, 1.0, joint);
  #endif
  float rough = mix(0.8, 0.36, uWet);
  rough = mix(rough, 0.025, puddle);
  // rain rings breaking the puddle surface
  float ring = nf_noise(p * 6.0 + uTime * 1.7) * nf_noise(p * 4.0 - uTime * 1.3);
  rough += ring * 0.12 * puddle;
  base *= mix(1.0, 0.6, uWet * 0.7);
  base = mix(base, base * 0.35, puddle);
  diffuseColor.rgb = base;
  roughnessFactor = rough;
}`,
      );
  };
  m.customProgramCacheKey = () => `nf-ground-${kind}`;
  return m;
}

/* ─────────────────────────────────────────────────────────────
   Plain shared materials
   ───────────────────────────────────────────────────────────── */

export function createMaterials() {
  const std = (color: number, roughness: number, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

  return {
    facade: createFacadeMaterial(),
    asphalt: createGroundMaterial(0),
    paving: createGroundMaterial(1),
    yard: createGroundMaterial(2),
    kerb: std(0x5a5854, 0.7),
    concrete: std(0x6a6863, 0.88),
    stone: std(0x7a7166, 0.82),
    darkStone: std(0x3a3733, 0.8),
    iron: std(0x16181a, 0.45, 0.7),
    metal: std(0x55585b, 0.38, 0.75),
    rust: std(0x4a2e22, 0.8, 0.3),
    wood: std(0x3b2a1f, 0.8),
    paint: std(0xffffff, 0.35, 0.25, { vertexColors: true }),
    cloth: std(0xffffff, 0.92, 0, { vertexColors: true, side: THREE.DoubleSide }),
    glass: std(0x0a0d10, 0.04, 0.6, { transparent: true, opacity: 0.55 }),
    darkGlass: std(0x050607, 0.05, 0.4),
    rubber: std(0x0c0c0d, 0.85),
    marking: std(0x8d8a82, 0.6),
    lampWarm: std(0x201710, 0.4, 0, { emissive: new THREE.Color(1.0, 0.7, 0.4), emissiveIntensity: 4.2 }),
    lampCold: std(0x10141a, 0.4, 0, { emissive: new THREE.Color(0.82, 0.9, 1.0), emissiveIntensity: 3.5 }),
    lampRed: std(0x200505, 0.4, 0, { emissive: new THREE.Color(1.0, 0.12, 0.06), emissiveIntensity: 4 }),
    signalAmber: std(0x201505, 0.4, 0, { emissive: new THREE.Color(1.0, 0.62, 0.15), emissiveIntensity: 5 }),
    vertex: std(0xffffff, 0.8, 0, { vertexColors: true }),
    water: std(0x000000, 0.1),
  };
}

export type Materials = ReturnType<typeof createMaterials>;
