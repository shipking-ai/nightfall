import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * Final grade: a slight lift in the shadows towards blue-grey, warm
 * highlights, vignette and fine film grain. Applied before tone mapping.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uGrain: { value: 0.035 },
    uVignette: { value: 0.65 },
    uSat: { value: 0.86 },
    uBars: { value: 0 },
    uAspect: { value: 16 / 9 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uGrain; uniform float uVignette; uniform float uSat; uniform float uBars; uniform float uAspect;
    varying vec2 vUv;
    float h(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      // split-tone: cool, lifted shadows; warm highlights
      c += vec3(0.003, 0.005, 0.008) * (1.0 - smoothstep(0.0, 0.2, l));
      c *= mix(vec3(1.0), vec3(1.04, 1.0, 0.94), smoothstep(0.3, 1.2, l));
      vec2 q = vUv - 0.5;
      float v = 1.0 - dot(q, q) * uVignette * 1.35;
      c *= clamp(v, 0.0, 1.0);
      float g = h(gl_FragCoord.xy + floor(uTime * 24.0) * vec2(37.0, 17.0)) - 0.5;
      c += g * uGrain * (0.2 + 0.8 * l / (1.0 + l));
      // cinema bars: the frame narrows to 2.39:1 (never wider than the screen already is)
      float want = clamp(1.0 - uAspect / 2.39, 0.0, 1.0) * 0.5 * uBars;
      if (vUv.y < want || vUv.y > 1.0 - want) c = vec3(0.0);
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

/**
 * Depth of field for cinematics: the scene's own depth decides how soft each
 * pixel is (a circle of confusion from the focus distance and aperture), a
 * disc of taps gathers the blur. Off (not even run) in ordinary play.
 */
const DofShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uFocus: { value: 5 },
    uAperture: { value: 0 },
    uNear: { value: 0.1 },
    uFar: { value: 1000 },
    uTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform float uFocus; uniform float uAperture; uniform float uNear; uniform float uFar; uniform vec2 uTexel;
    varying vec2 vUv;
    float lin(float d) { float z = d * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)); }
    float coc(vec2 uv) { float z = lin(texture2D(tDepth, uv).r); return clamp(abs(z - uFocus) / max(z, 0.1) * uAperture, 0.0, 1.0); }
    void main() {
      float c0 = coc(vUv);
      vec3 acc = texture2D(tDiffuse, vUv).rgb; float w = 1.0;
      float R = c0 * 14.0;
      if (R > 0.5) {
        for (int i = 0; i < 16; i++) {
          float a = float(i) * 2.39996, r = sqrt(float(i) + 0.5) / 4.0;
          vec2 o = vec2(cos(a), sin(a)) * r * R * uTexel;
          // a sharp foreground doesn't bleed into the blur behind it
          float cs = coc(vUv + o);
          float k = smoothstep(0.0, 0.3, cs + 0.05);
          acc += texture2D(tDiffuse, vUv + o).rgb * k; w += k;
        }
      }
      gl_FragColor = vec4(acc / w, 1.0);
    }`,
};

/**
 * Volumetric light shafts. Not a real volumetric integral — it is a radial
 * occlusion gather, which is why it is cheap enough to run always at the top
 * tier: march the shadow map from the bright point back to the camera and
 * accumulate how much of it was blocked. It reads as light through fog.
 */
const ShaftShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uSun: { value: new THREE.Vector3(0, 1, 0) },
    uDensity: { value: 0.72 },
    uDecay: { value: 0.94 },
    uWeight: { value: 0.5 },
    uTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
    uTint: { value: new THREE.Color(0xffd9a8) },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform sampler2D tDepth;
    uniform vec3 uSun; uniform float uDensity, uDecay, uWeight; uniform vec2 uTexel; uniform vec3 uTint;
    varying vec2 vUv;
    const int STEPS = 16;
    void main() {
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      // toward the brightest thing on screen: the sun, or whatever light the city is lit by
      vec2 delta = (uSun.xy / max(uSun.z, 0.001) * 0.5 + 0.5) - vUv;
      delta *= uDensity / float(STEPS);
      float illum = 1.0;
      vec2 uv = vUv;
      float dither = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
      uv -= delta * dither;
      for (int i = 0; i < STEPS; i++) {
        uv += delta;
        vec2 t = clamp(uv, 0.0, 1.0);
        // depth rises toward 1 in the distance; a near sample means occluded
        float d = texture2D(tDepth, t).r;
        illum *= mix(1.0, d, uWeight);
        illum *= uDecay;
      }
      float shaft = clamp(pow(illum, 3.0) - 1.0, 0.0, 1.0);
      // only add where the frame is already bright, so it doesn't haze the blacks
      float lum = dot(base, vec3(0.2126, 0.7152, 0.0722));
      gl_FragColor = vec4(base + uTint * shaft * smoothstep(0.25, 0.9, lum) * 0.5, 1.0);
    }`,
};

class DofPass extends ShaderPass {
  constructor(private cam: THREE.PerspectiveCamera) {
    super(DofShader);
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean) {
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    this.uniforms.uNear.value = this.cam.near;
    this.uniforms.uFar.value = this.cam.far;
    this.uniforms.uTexel.value.set(1 / readBuffer.width, 1 / readBuffer.height);
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
}

/** Light shafts need the depth buffer, so it gets the same treatment as DOF. */
class ShaftPass extends ShaderPass {
  constructor(private cam: THREE.PerspectiveCamera) {
    super(ShaftShader);
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean) {
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    this.uniforms.uTexel.value.set(1 / readBuffer.width, 1 / readBuffer.height);
    // project the city light into screen space so the shafts radiate from it
    const p = new THREE.Vector3(0, 90, -120).project(this.cam);
    this.uniforms.uSun.value.set(p.x, p.y, p.z);
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
}

export class Renderer {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private renderPass: RenderPass;
  private dof: DofPass;
  private ao: GTAOPass | null = null;
  private shafts: ShaftPass;
  postfx = true;
  /** is ambient occlusion running? */
  aoEnabled = false;
  /** are light shafts running? */
  shaftsEnabled = false;

  constructor(container: HTMLElement, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    // PCFShadowMap is the soft filter as of three r186 — the old PCFSoftShadowMap
    // is deprecated and silently falls back to this one, so naming it would have
    // been a lie that changed nothing. VSM is softer still but forces every
    // receiving surface to also cast, which this scene can't afford.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x000000, 1);
    container.appendChild(this.renderer.domElement);

    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x || 1, size.y || 1, { type: THREE.HalfFloatType, samples: 0 });
    this.composer = new EffectComposer(this.renderer, rt);
    // depth alongside colour (for depth of field in cinematics)
    for (const t of [this.composer.renderTarget1, this.composer.renderTarget2]) t.depthTexture = new THREE.DepthTexture(size.x || 1, size.y || 1);
    this.renderPass = new RenderPass(scene, camera);
    this.dof = new DofPass(camera);
    this.dof.enabled = false;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.55, 0.82);
    this.grade = new ShaderPass(GradeShader);

    // Ambient occlusion. Built once and left disabled: allocating it costs
    // several extra full-size targets, so a machine that drops to 'low' during
    // play doesn't keep paying for it, and toggling it on is then instant.
    try {
      this.ao = new GTAOPass(scene, camera, size.x || 1, size.y || 1);
      this.ao.output = GTAOPass.OUTPUT.Default;
      this.ao.blendIntensity = 0.85;
      this.ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.2, thickness: 1.4, scale: 1.1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
      this.ao.enabled = false;
    } catch {
      // some drivers refuse the float targets this needs; carry on without it
      this.ao = null;
    }
    this.shafts = new ShaftPass(camera);
    this.shafts.enabled = false;

    this.composer.addPass(this.renderPass);
    if (this.ao) this.composer.addPass(this.ao);
    this.composer.addPass(this.dof);
    this.composer.addPass(this.shafts);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());

    addEventListener('resize', () => this.resize());
    this.resize();
  }

  get canvas() {
    return this.renderer.domElement;
  }

  configure(o: { pixelRatio: number; msaa: number; postfx: boolean; ao?: boolean; shafts?: boolean }) {
    this.renderer.setPixelRatio(o.pixelRatio);
    this.postfx = o.postfx;
    this.bloom.enabled = o.postfx;
    this.grade.uniforms.uGrain.value = o.postfx ? 0.035 : 0;
    this.aoEnabled = !!o.ao && this.ao !== null && o.postfx;
    this.shaftsEnabled = !!o.shafts && o.postfx;
    if (this.ao) this.ao.enabled = this.aoEnabled;
    this.shafts.enabled = this.shaftsEnabled;
    (this.composer.renderTarget1 as THREE.WebGLRenderTarget).samples = o.msaa;
    (this.composer.renderTarget2 as THREE.WebGLRenderTarget).samples = o.msaa;
    this.resize();
  }

  /** Indoors the walls are close and pale: bloom only on the lamps themselves, and a touch less exposure. */
  setIndoor(on: boolean) {
    this.bloom.strength = on ? 0.3 : 0.55;
    this.bloom.threshold = on ? 0.97 : 0.82;
    this.renderer.toneMappingExposure = on ? 0.82 : 1.0;
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    // the AO pass runs at half res and upsamples: at full res it costs more
    // than everything else in the frame put together, and the difference is
    // invisible on the soft contact shadows it produces
    this.ao?.setSize(w / 2, h / 2);
  }

  /** True if this GPU can run the ambient occlusion pass (some drivers refuse). */
  get supportsAo() {
    return this.ao !== null;
  }

  /** Cinematic framing: bars (0..1), and depth of field (focus distance in metres, aperture 0 = off). */
  cinema(bars: number, focus: number, aperture: number) {
    this.grade.uniforms.uBars.value = bars;
    this.grade.uniforms.uAspect.value = this.camera.aspect;
    this.dof.enabled = aperture > 0.01 && this.postfx;
    this.dof.uniforms.uFocus.value = focus;
    this.dof.uniforms.uAperture.value = aperture;
  }

  render(t: number) {
    this.grade.uniforms.uTime.value = t;
    this.composer.render();
  }
}
