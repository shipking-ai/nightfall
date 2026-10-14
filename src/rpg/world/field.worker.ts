import { WorldGen } from './WorldGen';
import { buildField } from './fieldGen';

/** Chunk fields worked out ahead of time, off the main thread (a thousand-odd samples of the generator each). */
let gen: WorldGen | null = null;

self.onmessage = (e: MessageEvent<{ seed: number; x0: number; z0: number; size: number; seg: number; key: string }>) => {
  const { seed, x0, z0, size, seg, key } = e.data;
  if (!gen || gen.seed !== seed) gen = new WorldGen(seed);
  const s = buildField(gen, x0, z0, size, seg);
  const f = s.field;
  (self as unknown as Worker).postMessage({ key, s }, [f.h.buffer, f.water.buffer, f.forest.buffer, f.road.buffer, f.urban.buffer, f.biome.buffer, s.grass.buffer, s.soil.buffer, s.mix.buffer, s.hb.buffer]);
};
