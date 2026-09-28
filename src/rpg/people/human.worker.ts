import { buildHuman } from './build';
import type { HumanSpec, Joints } from './anatomy';

/** Sculpting people is heavy: it happens here, off the main thread. */
self.onmessage = (e: MessageEvent<{ id: number; spec: HumanSpec; joints: Joints; lod: number }>) => {
  const { id, spec, joints, lod } = e.data;
  try {
    const h = buildHuman(spec, joints, lod);
    const transfer: Transferable[] = [];
    for (const p of h.parts) transfer.push(p.position.buffer, p.normal.buffer, p.ao.buffer, p.index.buffer, p.skinIndex.buffer, p.skinWeight.buffer);
    (self as unknown as Worker).postMessage({ id, human: h }, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
