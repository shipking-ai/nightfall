import * as THREE from 'three';
import { NOISE } from '../render/glsl';
import { worldUniforms } from '../world/materials';
import type { Sky } from './Sky';

/** River surface: dark, slow, reflecting the glow of a city on the other bank. */
export function createWaterMaterial(sky: Sky, fog: THREE.FogExp2): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: worldUniforms.uTime,
      uHorizon: sky.uniforms.uHorizon,
      uGlow: sky.uniforms.uGlow,
      uFogColor: { value: fog.color },
      uFogDensity: { value: fog.density },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uHorizon; uniform vec3 uGlow; uniform vec3 uFogColor; uniform float uFogDensity;
      varying vec3 vW;
      ${NOISE}
      void main() {
        vec2 p = vW.xz;
        float e = 0.15;
        vec2 flow = vec2(uTime * 0.35, 0.0);
        float h0 = nf_fbm(p * vec2(0.18, 0.5) + flow);
        float hx = nf_fbm((p + vec2(e, 0.0)) * vec2(0.18, 0.5) + flow);
        float hz = nf_fbm((p + vec2(0.0, e)) * vec2(0.18, 0.5) + flow);
        vec3 n = normalize(vec3((h0 - hx) * 2.2, 1.0, (h0 - hz) * 2.2));
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
        vec3 R = reflect(-V, n);
        float toward = 0.55 + 0.45 * cos(atan(R.x, R.z));
        vec3 skyRef = uHorizon * 1.2 + uGlow * exp(-max(R.y, 0.0) * 6.0) * toward * 1.4;
        vec3 deep = vec3(0.004, 0.006, 0.008);
        vec3 col = mix(deep, skyRef, 0.06 + fres * 0.5);
        float dist = length(cameraPosition - vW);
        float f = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
        col = mix(col, uFogColor, f);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
