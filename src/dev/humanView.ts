import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { newMotion, newRig, solve, stepPhase, type Body, type Outfit } from '../entities/Humanoid';
import { Animator } from '../anim/Animator';
import '../anim/clips';
import { RealHuman } from '../rpg/people/RealHuman';
import { randomSpec } from '../rpg/people/kit';
import type { HumanSpec } from '../rpg/people/anatomy';

/**
 * Dev: a line-up of RPG people under a sun and a sky, for looking at them
 * closely. ?shot=full|face|walk&seed=N&n=4
 */
const q = new URLSearchParams(location.search);
const shot = q.get('shot') ?? 'full';
const seed = Number(q.get('seed') ?? 1);
const n = Number(q.get('n') ?? 4);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.style.margin = '0';
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8a9aae);
const pm = new THREE.PMREMGenerator(renderer);
scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
const sun = new THREE.DirectionalLight(0xfff0dd, 3.2);
sun.position.set(3, 5, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -4;
sun.shadow.camera.right = sun.shadow.camera.top = 4;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, new THREE.HemisphereLight(0xb8c8e0, 0x4a4036, 0.9));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5a5852, roughness: 0.9 }));
ground.receiveShadow = true;
scene.add(ground);
const camera = new THREE.PerspectiveCamera(shot === 'face' ? 22 : 35, innerWidth / innerHeight, 0.05, 100);

interface Person {
  h: RealHuman;
  rig: ReturnType<typeof newRig>;
  m: ReturnType<typeof newMotion>;
  anim: Animator;
  body: Body;
  outfit: Outfit;
  x: number;
  spec: HumanSpec;
}
const people: Person[] = [];
for (let i = 0; i < n; i++) {
  const spec = randomSpec(seed * 97 + i * 13, { sex: i % 2 ? 0.1 : 0.9 });
  // ?hair=long,bun,… tries the cuts in turn
  const hairs = q.get('hair')?.split(',');
  if (hairs) spec.hair = hairs[i % hairs.length] as HumanSpec['hair'];
  // ?top=coat,shirt,… likewise
  const tops = q.get('top')?.split(',');
  if (tops) spec.top = { ...spec.top, kind: tops[i % tops.length] as HumanSpec['top']['kind'] };
  const body: Body = { height: 0.97 + (i % 3) * 0.03, girth: 1, shoulders: 1, hips: 1, head: 1 };
  const h = new RealHuman(spec, body, { hero: shot === 'face', lods: shot === 'face' ? [0] : [1], mh: q.get('mh') !== '0' });
  scene.add(h.group);
  const x = (i - (n - 1) / 2) * 0.9;
  people.push({ h, rig: newRig(), m: newMotion(), anim: new Animator(), body, outfit: { bulk: 1 } as Outfit, x, spec });
}
(window as unknown as { people: Person[] }).people = people;

const root = new THREE.Matrix4();
const _q = new THREE.Quaternion();
let t = 0;
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;
  for (const p of people) {
    const walk = shot === 'walk';
    p.m.speed = walk ? 1.5 : 0;
    stepPhase(p.m, dt);
    p.anim.update(dt);
    const z = walk ? ((t * 1.5 + p.x * 3) % 6) - 3 : 0;
    const body = p.h.body;
    root.compose(new THREE.Vector3(p.x, 0, z), _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), shot === 'face' ? 0 : walk ? 0 : 0.35 * Math.sin(t * 0.3)), new THREE.Vector3(1, 1, 1).multiplyScalar(body.height));
    solve(p.rig, root, body, p.outfit, p.m, t, p.anim);
    p.h.pose(camera.position.distanceTo(new THREE.Vector3(p.x, 1, z)));
  }
  if (shot === 'face') {
    const p = people[0];
    // ?view=side|back to see a cut from round the head
    const a = q.get('view') === 'back' ? Math.PI * 0.85 : q.get('view') === 'side' ? 1.25 : 0.44;
    const hr = q.get('hair') ? 1.15 : 0.83;
    const hy = q.get('hair') ? 0.04 : 0;
    camera.position.set(p.x + Math.sin(a) * hr, 1.62 + hy + (q.get('view') === 'top' ? 0.7 : 0), Math.cos(a) * hr);
    camera.lookAt(p.x, 1.6 + hy * 0.5, 0);
  } else {
    const r = shot === 'walk' ? 6 : 4.2;
    camera.position.set(Math.sin(0.4) * r, 1.4, Math.cos(0.4) * r);
    camera.lookAt(0, 0.95, 0);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { ready: () => boolean }).ready = () => people.every((p) => p.h.ready);
