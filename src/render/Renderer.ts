import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

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
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uGrain; uniform float uVignette; uniform float uSat;
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
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

export class Renderer {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private renderPass: RenderPass;
  postfx = true;

  constructor(container: HTMLElement, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x000000, 1);
    container.appendChild(this.renderer.domElement);

    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x || 1, size.y || 1, { type: THREE.HalfFloatType, samples: 0 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.55, 0.82);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());

    addEventListener('resize', () => this.resize());
    this.resize();
  }

  get canvas() {
    return this.renderer.domElement;
  }

  configure(o: { pixelRatio: number; msaa: number; postfx: boolean }) {
    this.renderer.setPixelRatio(o.pixelRatio);
    this.postfx = o.postfx;
    this.bloom.enabled = o.postfx;
    this.grade.uniforms.uGrain.value = o.postfx ? 0.035 : 0;
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
  }

  render(t: number) {
    this.grade.uniforms.uTime.value = t;
    this.composer.render();
  }
}
