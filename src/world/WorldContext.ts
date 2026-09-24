import * as THREE from 'three';
import { Collision } from './Collision';
import { GeoBatch } from './GeoBatch';
import type { Materials } from './materials';

export type LampKind = 'warm' | 'cold' | 'amber' | 'interior' | 'red';

/** A light source in the world. Only the nearest few get a real light; all get glow + reflections. */
export interface Lamp {
  pos: THREE.Vector3;
  color: THREE.Color;
  /** real-light intensity (candela) when this lamp is promoted to the light pool */
  intensity: number;
  range: number;
  /** ground height under the lamp, for the wet-street reflection */
  ground: number;
  halo: number;
  cone: boolean;
  streak: number;
  flicker?: number;
  /** real light participates in the pool (false = glow only) */
  pooled: boolean;
  /** optional spot-style shadow caster candidate */
  shadow?: boolean;
  /** runtime intensity multiplier (set by flicker) */
  gain: number;
  /** position changes at runtime (vehicles, the boat) */
  dynamic?: boolean;
}

export type SoundKind = 'hum' | 'water' | 'machine' | 'radio' | 'murmur' | 'drips' | 'phone';

export interface SoundSpot {
  kind: SoundKind;
  pos: THREE.Vector3;
  id?: string;
}

export interface InteractSpot {
  id: string;
  pos: THREE.Vector3;
  radius: number;
  /** seat facing, for SIT interactions */
  yaw?: number;
}

export interface NpcSpot {
  pos: THREE.Vector3;
  yaw: number;
  mode: 'phone' | 'look' | 'smoke' | 'wait' | 'talk' | 'sit' | 'stare';
  /** npcs with the same pair id face each other */
  pair?: string;
}

export interface CameraShot {
  id: string;
  caption: string;
  from: THREE.Vector3;
  to: THREE.Vector3;
  drift: THREE.Vector3;
}

/** Everything the builders produce; consumed by lighting, audio, NPCs, interaction. */
export class WorldContext {
  root = new THREE.Group();
  batch = new GeoBatch();
  collision = new Collision();
  lamps: Lamp[] = [];
  sounds: SoundSpot[] = [];
  interact: InteractSpot[] = [];
  /** parked cars the player can get into (simulated by entities/Vehicles, not merged) */
  cars: { pos: THREE.Vector3; yaw: number; color: number; van: boolean; screen: boolean }[] = [];
  npcSpots: NpcSpot[] = [];
  updaters: ((t: number, dt: number) => void)[] = [];
  /** manholes / vents that breathe steam */
  steam: THREE.Vector3[] = [];
  /** camera-occluding meshes kept separately (not merged) */
  dynamic = new THREE.Group();

  constructor(public mats: Materials) {
    this.root.add(this.dynamic);
  }

  lamp(p: THREE.Vector3, kind: LampKind, opts: Partial<Omit<Lamp, 'pos' | 'color'>> = {}): Lamp {
    const colors: Record<LampKind, THREE.Color> = {
      warm: new THREE.Color(1.0, 0.66, 0.36),
      cold: new THREE.Color(0.78, 0.86, 1.0),
      amber: new THREE.Color(1.0, 0.6, 0.18),
      interior: new THREE.Color(1.0, 0.78, 0.55),
      red: new THREE.Color(1.0, 0.12, 0.06),
    };
    const l: Lamp = {
      pos: p.clone(),
      color: colors[kind],
      intensity: 55,
      range: 26,
      ground: 0.15,
      halo: 1,
      cone: true,
      streak: 1,
      pooled: true,
      gain: 1,
      ...opts,
    };
    this.lamps.push(l);
    return l;
  }

  sound(kind: SoundKind, p: THREE.Vector3, id?: string) {
    this.sounds.push({ kind, pos: p.clone(), id });
  }

  point(id: string, p: THREE.Vector3, radius = 2.2, yaw?: number) {
    this.interact.push({ id, pos: p.clone(), radius, yaw });
  }

  /** Solid box: rendered via the batch and registered as a collider. */
  solid(material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, opts: { cam?: boolean; color?: THREE.ColorRepresentation; cast?: boolean; collide?: boolean } = {}) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y + h / 2, z), new THREE.Quaternion(), new THREE.Vector3(w, h, d));
    this.batch.add(material, BOX, m, { color: opts.color, cast: opts.cast });
    if (opts.collide !== false) this.collision.addCentered(x, y, z, w, h, d, opts.cam ?? true);
  }

  /** Visual-only box. */
  box(material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, ry = 0, color?: THREE.ColorRepresentation, cast = true) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y + h / 2, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)),
      new THREE.Vector3(w, h, d),
    );
    this.batch.add(material, BOX, m, { color, cast });
  }

  /** A textured plane (sign, poster, graffiti). Kept as its own mesh. */
  decal(texture: THREE.Texture, x: number, y: number, z: number, w: number, h: number, ry: number, opts: { emissive?: number; transparent?: boolean; rough?: number; doubleSided?: boolean } = {}): THREE.Mesh {
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: opts.rough ?? 0.85,
      transparent: opts.transparent ?? false,
      alphaTest: opts.transparent ? 0.02 : 0,
      depthWrite: !opts.transparent,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      side: opts.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      emissive: opts.emissive ? new THREE.Color(1, 1, 1) : new THREE.Color(0, 0, 0),
      emissiveMap: opts.emissive ? texture : null,
      emissiveIntensity: opts.emissive ?? 0,
    });
    const mesh = new THREE.Mesh(PLANE, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    mesh.scale.set(w, h, 1);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.root.add(mesh);
    return mesh;
  }
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const PLANE = new THREE.PlaneGeometry(1, 1);
