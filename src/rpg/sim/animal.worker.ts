import { buildAnimal, type SpeciesId } from './animals';

/** Sculpting animals off the main thread (one build per species and sex, cached by the caller). */
self.onmessage = (e: MessageEvent<{ id: number; species: SpeciesId; male: boolean }>) => {
  const { id, species, male } = e.data;
  try {
    const a = buildAnimal(species, male);
    const transfer: Transferable[] = [];
    for (const p of a.parts) transfer.push(p.position.buffer, p.normal.buffer, p.color.buffer, p.index.buffer);
    (self as unknown as Worker).postMessage({ id, animal: a }, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String((err as Error)?.stack ?? err) });
  }
};
