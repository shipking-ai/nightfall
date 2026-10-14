import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { SPECS, type VehicleClass } from '../vehicles/specs';
import { buildVehicle, setLights, dent, type VehicleModel } from '../vehicles/model';

/**
 * Dev: every class of vehicle under a sun, for looking at them.
 * ?only=sedan&view=side|front|rear|top|three&lights=1&doors=1&dents=1&wet=1&dirt=1
 */
const q = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
document.body.style.margin = '0';
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(q.get('night') ? 0x0a0c12 : 0x8a9aae);
const pm = new THREE.PMREMGenerator(renderer);
scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = q.get('night') ? 0.08 : 0.6;
const sun = new THREE.DirectionalLight(0xfff0dd, q.get('night') ? 0.1 : 3);
sun.position.set(6, 10, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30 });
scene.add(sun, new THREE.HemisphereLight(0xb8c8e0, 0x4a4036, q.get('night') ? 0.05 : 0.8));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4a4a48, roughness: 0.85 }));
ground.receiveShadow = true;
scene.add(ground);

const only = q.get('only')?.split(',') as VehicleClass[] | undefined;
const classes = (only ?? (Object.keys(SPECS) as VehicleClass[]));
const models: VehicleModel[] = [];
let x = 0;
for (const c of classes) {
  const spec = SPECS[c];
  const v = buildVehicle(spec, spec.paints[0]);
  const w = spec.shape.width + 1.2;
  v.root.position.set(x + w / 2, 0, 0);
  x += w;
  scene.add(v.root);
  if (q.get('doors')) for (const d of v.doors) (d.pivot.visible = true), (d.pivot.rotation.y = -d.side * 1.0);
  if (q.get('dents')) {
    dent(v, 0.5, 0.6, spec.shape.length / 2, 0.8);
    dent(v, spec.shape.width / 2, 0.7, 0.3, 0.6);
    v.wear.glassCrack.value = 0.8;
  }
  if (q.get('wet')) v.wear.wet.value = 1;
  if (q.get('dirt')) v.wear.dirt.value = 0.9;
  for (const wh of v.wheels) if (wh.front) wh.steer.rotation.y = q.get('steer') ? 0.4 : 0;
  models.push(v);
}
const cx = x / 2;
for (const v of models) v.root.position.x -= cx;
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 500);
const view = q.get('view') ?? 'three';
const span = Math.max(8, x * 0.55);
if (view === 'side') camera.position.set(0, 1.4, span * 1.7);
else if (view === 'front') camera.position.set(0, 1.6, -span * 1.6).set(0, 1.5, 0).add(new THREE.Vector3(span * 0.1, 0.4, span * 1.8)).setZ(span * 1.8);
else if (view === 'top') camera.position.set(0, span * 2.2, 0.01);
else camera.position.set(span * 0.7, span * 0.45, span * 1.3);
if (view === 'front') camera.position.set(0, 1.6, 12), models.forEach((v, i) => (v.root.position.set((i - (models.length - 1) / 2) * 2.8, 0, 0), (v.root.rotation.y = 0)));
if (view === 'rear') camera.position.set(0, 1.6, -12), models.forEach((v, i) => v.root.position.set((i - (models.length - 1) / 2) * 2.8, 0, 0));
if (only && only.length === 1 && view === 'three') camera.position.set(5.5, 2.4, 7);
camera.lookAt(0, 0.8, 0);
let t = 0;
const lights = !!q.get('lights');
function frame() {
  t += 1 / 60;
  for (const v of models) {
    setLights(v, { head: lights ? 1 : 0, brake: lights, reverse: false, indicator: lights ? 1 : 0, hazard: false, beacons: lights, running: true }, t, { head: false, tail: false });
    v.wear.time.value = t;
    for (const w of v.wheels) w.spin.rotation.x += q.get('roll') ? 0.1 : 0;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
(window as unknown as { ready: () => boolean }).ready = () => true;
(window as unknown as { models: VehicleModel[] }).models = models;
