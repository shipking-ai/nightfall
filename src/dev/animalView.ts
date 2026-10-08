import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Wildlife } from '../rpg/sim/Wildlife';
import type { SpeciesId } from '../rpg/sim/animals';
import { WorldGen } from '../rpg/world/WorldGen';

/** Dev: the RPG's animals in a row on a lawn. ?walk=1 to see them move, ?only=deer */
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
scene.background = new THREE.Color(0x9aa8b8);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;
const sun = new THREE.DirectionalLight(0xfff0dd, 3);
sun.position.set(4, 8, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 });
scene.add(sun, new THREE.HemisphereLight(0xb8c8e0, 0x4a4036, 0.9));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5a6a3e, roughness: 0.95 }));
ground.receiveShadow = true;
scene.add(ground);
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 200);
const gen = new WorldGen();
const pos = new THREE.Vector3();
const wild = new Wildlife({
  gen,
  heightAt: () => 0,
  waterAt: () => null,
  player: () => ({ pos, speed: 0, crouch: true, inCar: false, stealth: 260 }),
  daylight: () => 1,
  visibility: () => 2000,
  bite: () => {},
});
scene.add(wild.group);
const ids: SpeciesId[] = q.get('only') ? [q.get('only') as SpeciesId] : ['bear', 'elk', 'deer', 'boar', 'wolf', 'coyote', 'fox', 'hare', 'rabbit'];
let x = -((ids.length - 1) * 2.1) / 2;
for (const id of ids) {
  const a = wild.spawn(id, true, x, 0);
  a.yaw = Math.PI / 2 + 0.5;
  a.t = 1e9;
  if (q.get('walk')) {
    a.state = 'walk';
    a.target.set(x + 1e4, 0, 0);
  }
  x += 2.1;
}
const crow = wild.spawn('crow', true, 3, 2);
crow.pos.y = 2.5;
pos.set(0, 0, 0);
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  wild.update(dt, 'temperate', camera);
  const w = ids.length * 2.1;
  camera.position.set(0, 2.2, w * 0.95 + 2);
  camera.lookAt(0, 0.6, 0);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { ready: () => boolean }).ready = () => wild.animals.every((a) => a.ready);
