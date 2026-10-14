import * as THREE from 'three';
import { NOISE } from '../render/glsl';
import { mulberry32 } from '../world/rng';

/**
 * Night sky dome with low cloud lit from below by the city, a moon that
 * shows through gaps, and a distant skyline ring of instanced towers.
 */
export class Sky {
  mesh: THREE.Mesh;
  skyline: THREE.InstancedMesh;
  uniforms = {
    uTime: { value: 0 },
    uZenith: { value: new THREE.Color(0.004, 0.006, 0.012) },
    uHorizon: { value: new THREE.Color(0.02, 0.022, 0.03) },
    uGlow: { value: new THREE.Color(0.075, 0.042, 0.022) },
    uMoonDir: { value: new THREE.Vector3(-0.45, 0.55, 0.7).normalize() },
    uCloud: { value: 0.75 },
    /** RPG daylight: 0 night (District 03 is always night) … 1 noon */
    uDay: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: new THREE.Color(1, 0.9, 0.75) },
    /** clear-night stars (0 under District 03's cloud) */
    uStars: { value: 0 },
  };

  constructor() {
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGlow; uniform vec3 uMoonDir; uniform float uCloud;
        uniform float uDay; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uStars;
        varying vec3 vDir;
        ${NOISE}
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHorizon, uZenith, smoothstep(-0.02, 0.55, h));
          float az = atan(d.x, d.z);
          float toward = 0.55 + 0.45 * cos(az);          // brightest over downtown, beyond the river
          col += uGlow * exp(-max(h, 0.0) * 7.0) * toward;
          vec2 uv = d.xz / max(h + 0.18, 0.1);
          float c = nf_fbm(uv * 0.9 + vec2(uTime * 0.004, uTime * 0.0015));
          c = smoothstep(0.38, 0.82, c) * uCloud;
          // stars on a clear night (not over District 03: its sky is always low cloud)
          if (uStars > 0.0 && h > 0.0) {
            vec2 sp = floor(d.xz / max(h, 0.2) * 260.0 + d.y * 91.0);
            float st = step(0.9975, nf_hash(sp)) * (0.5 + 0.5 * sin(uTime * 2.0 + nf_hash(sp * 1.7) * 40.0));
            col += vec3(0.8, 0.85, 1.0) * st * uStars * smoothstep(0.02, 0.2, h) * (1.0 - c);
          }
          vec3 cloudCol = uHorizon * 1.4 + uGlow * 1.3 * exp(-max(h, 0.0) * 2.5) * toward;
          // by day, cloud is lit from above: white tops, grey bellies, gold near the sun at the ends of the day
          float sd = max(dot(d, normalize(uSunDir)), 0.0);
          vec3 dayCloud = mix(vec3(0.5, 0.52, 0.56), vec3(0.95, 0.95, 0.93), smoothstep(0.3, 0.9, nf_fbm(uv * 1.7 + 3.0))) * (0.55 + 0.45 * uDay) + uSunCol * pow(sd, 6.0) * 0.5;
          cloudCol = mix(cloudCol, dayCloud * max(uDay, 0.05) * 1.1, smoothstep(0.0, 0.4, uDay));
          col = mix(col, cloudCol, c * smoothstep(-0.05, 0.2, h));
          float m = max(dot(d, normalize(uMoonDir)), 0.0);
          float moonVis = 1.0 - smoothstep(0.1, 0.5, uDay);
          col += vec3(0.75, 0.78, 0.85) * smoothstep(0.9993, 0.9996, m) * (1.0 - c * 0.92) * 0.9 * moonVis;
          col += vec3(0.05, 0.06, 0.08) * pow(m, 60.0) * (1.0 - c * 0.4) * moonVis;
          // the sun: disc, glare and the wide glow round it
          if (uDay > 0.0) {
            col += uSunCol * (smoothstep(0.99955, 0.99975, sd) * 30.0 * (1.0 - c * 0.95) + pow(sd, 300.0) * 2.0 * (1.0 - c * 0.7) + pow(sd, 12.0) * 0.25);
          }
          col = max(col, vec3(0.0));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;

    this.skyline = buildSkyline(this.uniforms);
  }

  followCamera(cam: THREE.Camera) {
    this.mesh.position.copy(cam.position);
  }
}

function buildSkyline(u: Sky['uniforms']): THREE.InstancedMesh {
  const rng = mulberry32(2024);
  const placements: { x: number; z: number; w: number; d: number; h: number }[] = [];
  const add = (cx: number, cz: number, count: number, spreadX: number, spreadZ: number, hMin: number, hMax: number) => {
    for (let i = 0; i < count; i++) {
      placements.push({
        x: cx + rng.range(-spreadX, spreadX),
        z: cz + rng.range(-spreadZ, spreadZ),
        w: rng.range(18, 44),
        d: rng.range(18, 44),
        h: rng.range(hMin, hMax) * (rng.chance(0.12) ? 1.7 : 1),
      });
    }
  };
  add(-80, 620, 90, 520, 180, 50, 150); // downtown, across the river
  add(-40, 460, 50, 420, 60, 30, 80);
  add(-620, 0, 40, 120, 520, 30, 90); // west
  add(620, -40, 40, 120, 520, 30, 90); // east
  add(0, -600, 50, 560, 120, 30, 100); // north

  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uHorizon: u.uHorizon, uGlow: u.uGlow, uTime: u.uTime },
    vertexShader: /* glsl */ `
      varying vec3 vW; varying vec3 vN; flat varying float vSeed; flat varying float vTop;
      void main() {
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(instanceMatrix) * normal);
        vSeed = instanceMatrix[3].x * 0.013 + instanceMatrix[3].z * 0.007;
        vTop = (instanceMatrix * vec4(0.0, 1.0, 0.0, 1.0)).y;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uHorizon; uniform vec3 uGlow; uniform float uTime;
      varying vec3 vW; varying vec3 vN; flat varying float vSeed; flat varying float vTop;
      ${NOISE}
      void main() {
        float dist = length(vW.xz - cameraPosition.xz);
        float haze = 1.0 - exp(-dist * 0.0011);
        vec3 body = vec3(0.006, 0.007, 0.009);
        vec3 col = body;
        if (abs(vN.y) < 0.5) {
          float u = abs(vN.x) > 0.5 ? vW.z : vW.x;
          vec2 cell = floor(vec2(u / 3.2, vW.y / 3.6));
          vec2 f = fract(vec2(u / 3.2, vW.y / 3.6));
          float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.25, f.y) * step(f.y, 0.8);
          float h = nf_hash(cell + vSeed * 91.0);
          float lit = step(h, 0.17) * win * step(vW.y, vTop - 3.0);
          vec3 wc = mix(vec3(1.0, 0.64, 0.34), vec3(0.85, 0.9, 1.0), step(0.8, nf_hash(cell * 1.3 + vSeed)));
          col += wc * lit * (0.5 + nf_hash(cell * 2.1) * 0.9);
        }
        // aviation lights on the tallest
        float top = step(vTop - 0.8, vW.y) * step(140.0, vTop);
        col += vec3(1.0, 0.1, 0.05) * top * step(0.8, fract(uTime * 0.4 + vSeed * 3.0)) * 3.0;
        vec3 hazeCol = uHorizon + uGlow * 0.9;
        col = mix(col, hazeCol, haze * 0.9);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, placements.length);
  const m = new THREE.Matrix4();
  placements.forEach((p, i) => {
    m.compose(new THREE.Vector3(p.x, -2, p.z), new THREE.Quaternion(), new THREE.Vector3(p.w, p.h, p.d));
    mesh.setMatrixAt(i, m);
  });
  mesh.frustumCulled = false;
  return mesh;
}
