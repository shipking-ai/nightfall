import { Tree } from '@dgreenheck/ez-tree';
/** Dev: how heavy each EZ-Tree preset is. */
const out: string[] = [];
for (const p of ['Oak Medium', 'Oak Small', 'Pine Medium', 'Pine Small', 'Aspen Medium', 'Ash Medium', 'Ash Small', 'Bush 1', 'Bush 2']) {
  const t = new Tree();
  t.loadPreset(p);
  t.generate();
  const b = t.branchesMesh.geometry, l = t.leavesMesh.geometry;
  b.computeBoundingBox();
  const tri = (g: typeof b) => (g.index ? g.index.count : g.attributes.position.count) / 3;
  out.push(`${p}: branch ${tri(b)} leaf ${tri(l)} h ${b.boundingBox!.max.y.toFixed(1)} mats ${(t.branchesMesh.material as { type: string }).type}/${(t.leavesMesh.material as { type: string }).type} attrs ${Object.keys(l.attributes).join(',')}`);
}
(window as unknown as { probe: string[] }).probe = out;
