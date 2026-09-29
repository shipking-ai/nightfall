import { WorldGen } from '../world/WorldGen';
import { renderTile } from './atlasTile';

/** The atlas's land tiles, drawn off the main thread (each is a few thousand samples of the generator). */
let gen: WorldGen | null = null;

self.onmessage = (e: MessageEvent<{ seed: number; lv: number; ti: number; tj: number; key: string }>) => {
  const { seed, lv, ti, tj, key } = e.data;
  if (!gen || gen.seed !== seed) gen = new WorldGen(seed);
  const px = renderTile(gen, lv, ti, tj);
  (self as unknown as Worker).postMessage({ key, px }, [px.buffer]);
};
