import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

let loader: GLTFLoader | null = null;

/** One glTF loader for the world's models, able to unpack Draco-compressed meshes (the decoder ships in public/rpg/draco). */
export function gltfLoader() {
  if (!loader) {
    const base = import.meta.env.BASE_URL ?? '/';
    const draco = new DRACOLoader().setDecoderPath(`${base}rpg/draco/`);
    loader = new GLTFLoader().setDRACOLoader(draco);
  }
  return loader;
}
