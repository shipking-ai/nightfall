import { buildHuman } from './build';
import { buildMH, loadMH } from './mh';
import type { HumanSpec, Joints } from './anatomy';

/**
 * Building people is heavy: it happens here, off the main thread. `mh`: a
 * MakeHuman person (the realistic ones); otherwise a sculpted one (the far
 * detail level, and the fallback).
 */
self.onmessage = async (e: MessageEvent<{ id: number; spec: HumanSpec; joints?: Joints; lod: number; mh?: boolean; base?: string }>) => {
  const { id, spec, joints, lod, mh, base } = e.data;
  try {
    const h = mh ? buildMH(await loadMH(base ?? ''), spec) : buildHuman(spec, joints!, lod);
    const transfer: Transferable[] = [];
    for (const p of h.parts) {
      transfer.push(p.position.buffer, p.normal.buffer, p.ao.buffer, p.index.buffer, p.skinIndex.buffer, p.skinWeight.buffer);
      if (p.uv) transfer.push(p.uv.buffer);
      if (p.eyeLocal) transfer.push(p.eyeLocal.buffer);
    }
    (self as unknown as Worker).postMessage({ id, human: h }, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String((err as Error)?.stack ?? err) });
  }
};
