import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { newMotion, newRig, solve, stepPhase, type Body, type Outfit } from '../entities/Humanoid';
import { Animator } from '../anim/Animator';
import { feel, gaze, type Emotion } from '../anim/face';
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
// ?expr=happy|sad|angry|fear|surprise|pain|talk|blink: hold an expression to look at
const expr = q.get('expr');
if (expr) for (const p of people) {
  if (expr === 'talk') p.m.face.talk = 1;
  else if (expr !== 'blink') feel(p.m.face, expr as Emotion, 1);
  if (q.get('gaze')) gaze(p.m.face, Number(q.get('gaze')), 0);
}

const root = new THREE.Matrix4();
const gaitRun: { x: number; z: number; yaw: number }[] = [];
/** ?shot=gait: speed (m/s), direction of travel relative to facing, turn rate, over a 24 s loop */
function gaitScript(t: number) {
  const u = t % 24;
  const ramp = (a: number, b: number, v0: number, v1: number) => v0 + (v1 - v0) * Math.min(1, Math.max(0, (u - a) / (b - a)));
  if (u < 2) return { v: 0, dir: 0, turn: 0 };
  if (u < 6) return { v: ramp(2, 3, 0, 1.4), dir: 0, turn: 0 };
  if (u < 9) return { v: ramp(6, 7.5, 1.4, 3.6), dir: 0, turn: 0 };
  if (u < 11) return { v: ramp(9, 10, 3.6, 6.5), dir: 0, turn: 0 };
  if (u < 14) return { v: ramp(11, 13.5, 6.5, 0), dir: 0, turn: 0 };
  if (u < 16) return { v: 0, dir: 0, turn: u < 15.3 ? 1.6 : 0 };
  if (u < 19) return { v: ramp(16, 16.5, 0, 1), dir: Math.PI / 2, turn: 0 };
  if (u < 22) return { v: ramp(19, 19.5, 0, 1), dir: Math.PI, turn: 0 };
  return { v: ramp(22, 22.4, 1, 0), dir: Math.PI, turn: 0 };
}
/** foot slide: how far a planted foot's sole moves (world, horizontal) while it's planted */
const slide = { worst: 0, sum: 0, n: 0, planted: [] as { x: number; z: number; on: boolean; d: number }[][] };
const _fp = new THREE.Vector3();
function measureSlide(pi: number, p: Person) {
  const g = p.m.g;
  const pl = slide.planted[pi] ?? (slide.planted[pi] = [{ x: 0, z: 0, on: false, d: 0 }, { x: 0, z: 0, on: false, d: 0 }]);
  for (let s = 0; s < 2; s++) {
    const on = (s === 0 ? g.stanceL : g.stanceR) === 1 && p.m.speed > 0.2 && p.m.air === 0;
    _fp.setFromMatrixPosition(s === 0 ? p.rig.soleL : p.rig.soleR);
    const f = pl[s];
    // measure from after the heel has come down (the first 12% of stance rolls about the heel)
    if (on && f.on) f.d = Math.max(f.d, Math.hypot(_fp.x - f.x, _fp.z - f.z));
    else if (on) {
      f.x = _fp.x;
      f.z = _fp.z;
      f.d = 0;
    } else if (f.on) {
      // a stance just ended: how far did the ankle drift across it
      slide.worst = Math.max(slide.worst, f.d);
      slide.sum += f.d;
      slide.n++;
    }
    f.on = on;
  }
}
(window as unknown as { slide: typeof slide }).slide = slide;
const _q = new THREE.Quaternion();
let t = 0;
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;
  for (const [pi, p] of people.entries()) {
    const walk = shot === 'walk';
    const body = p.h.body;
    let z = walk ? ((t * 1.5 + p.x * 3) % 6) - 3 : 0;
    let yaw = shot === 'face' ? 0 : walk ? 0 : 0.35 * Math.sin(t * 0.3);
    let x = p.x;
    if (shot === 'gait') {
      // a scripted route: start, walk, run, sprint, slow, stop, turn on the spot, sidestep, back up
      const g = gaitScript(t + pi * 0.7);
      p.m.speed = g.v;
      p.m.moveDir = g.dir;
      const st = gaitRun[pi] ?? (gaitRun[pi] = { x: p.x, z: -6, yaw: 0 });
      st.yaw += g.turn * dt;
      const mdir = st.yaw + g.dir;
      st.x += Math.sin(mdir) * g.v * dt;
      st.z += Math.cos(mdir) * g.v * dt;
      x = st.x;
      z = st.z;
      yaw = st.yaw;
      p.m.turn = g.turn;
    } else p.m.speed = walk ? 1.5 : 0;
    stepPhase(p.m, dt);
    p.anim.update(dt);
    root.compose(new THREE.Vector3(x, 0, z), _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1).multiplyScalar(body.height));
    solve(p.rig, root, body, p.outfit, p.m, t, p.anim);
    p.h.pose(camera.position.distanceTo(new THREE.Vector3(x, 1, z)));
    measureSlide(pi, p);
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
    const r = shot === 'walk' ? 6 : shot === 'gait' ? 9 : 4.2;
    const fz = shot === 'gait' ? (gaitRun[0]?.z ?? 0) : 0, fx = shot === 'gait' ? (gaitRun[0]?.x ?? 0) : 0;
    camera.position.set(fx + Math.sin(1.2) * r, 1.4, fz + Math.cos(1.2) * r);
    camera.lookAt(fx, 0.95, fz);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { ready: () => boolean }).ready = () => people.every((p) => p.h.ready);
