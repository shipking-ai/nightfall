// CITY: the buildings you can walk into. Go to a tall house's street door, press X, look round the
// ground floor, climb the stairs to the upper floor, search a drawer (someone's home: a burglary),
// sleep in a bed, then leave by the door.
import { launch } from './lib.mjs';
const t = await launch({ pad: process.env.PAD ?? 'xbox' });
const { page, shot, step, press, stick, waitState, errors } = t;
const ev = (fn, arg) => page.evaluate(fn, arg);
await waitState('landing');
await t.wait(3000);
await ev(() => { window.nf.mode = 'city'; window.nf.enter(); });
console.log('state', await waitState('playing', 200));
await step(2);
const info = await ev(() => {
  const nf = window.nf, spots = nf.world.interact;
  const gen = spots.filter((s) => s.id.startsWith('enter:') && /-\d+$/.test(s.id));
  return { generated: gen.length, searches: spots.filter((s) => s.id.startsWith('search:')).length, beds: spots.filter((s) => s.id.startsWith('sleep:')).length };
});
console.log('doors', JSON.stringify(info));
// a door to a building with an upper floor (a stair in it)
const door = await ev(() => {
  const nf = window.nf, spots = nf.world.interact;
  const stairs = new Set(spots.filter((s) => s.id.startsWith('sleep:')).map((s) => s.id.split(':')[1]));
  const d = spots.find((s) => s.id.startsWith('enter:') && stairs.has(s.id.slice(6)));
  nf.player.place(d.pos.x, 0.15, d.pos.z, 0);
  return d.id;
});
console.log('door', door);
await step(0.5);
console.log('prompt', await ev(() => window.nf.interaction.current?.spot.id));
await press('X'); await t.wait(1500); await step(1.5);
const inside = () => ev(() => { const nf = window.nf, p = nf.player.pos; return { inside: nf.inside?.id ?? null, x: +p.x.toFixed(1), y: +p.y.toFixed(2), z: +p.z.toFixed(1) }; });
console.log('in', JSON.stringify(await inside()));
await shot('homes-01-ground');
// up the stairs: stand at the foot (east hall) facing north and walk
const foot = await ev((door) => {
  const nf = window.nf, id = door.slice(6), b = nf.inside.bounds;
  const X1 = b[2] - 1, Z1 = b[3] - 1;
  nf.player.place(X1 - 0.65, 0.15, Z1 - 1.2, Math.PI);
  nf.follow.yaw = Math.PI;
  return { X1, Z1 };
}, door);
await step(0.3);
await stick(0, 0, -1); await step(3.5); await stick(0, 0, 0); await step(0.5);
console.log('after stairs', JSON.stringify(await inside()));
await shot('homes-02-upstairs');
// search the wardrobe upstairs, then sleep
const s = await ev(() => { const nf = window.nf, sp = nf.world.interact.find((x) => x.id.startsWith('search:' + nf.inside.id) && x.pos.y > 2); if (!sp) return null; nf.player.place(sp.pos.x, sp.pos.y, sp.pos.z + 0.6, Math.PI); return sp.id; });
await step(0.4);
console.log('search', s, 'prompt', await ev(() => window.nf.interaction.current?.spot.id));
await press('X'); await step(1);
console.log('cash', await ev(() => window.nf.save.data.cash ?? 0));
// downstairs: search in the living room, where someone's on the sofa
const s2 = await ev(() => { const nf = window.nf, sp = nf.world.interact.find((x) => x.id.startsWith('search:' + nf.inside.id) && x.pos.y < 1); nf.player.place(sp.pos.x, 0.15, sp.pos.z + 0.6, Math.PI); return sp.id; });
await t.wait(2200); await step(0.4);
await press('X'); await step(1);
console.log('downstairs search', s2, 'stars', await ev(() => window.nf.combat.stars), 'residents here', await ev(() => window.nf.crowd.npcs.filter((n) => n.visible && n.pos.distanceTo(window.nf.player.pos) < 12).length));
await shot('homes-03-search');
// out again
await ev(() => { const nf = window.nf, e = nf.world.interact.find((x) => x.id === 'exit:' + nf.inside.id); nf.player.place(e.pos.x, 0.15, e.pos.z, 0); });
await t.wait(2500); await step(0.4);
await press('X'); await t.wait(1500); await step(1.5);
console.log('out', JSON.stringify(await inside()));
console.log('errors', errors);
await t.browser.close();
