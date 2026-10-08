// CITY: the outskirts. Walk out past the district's edge and look around: are there places
// (gas station, diner, motel, park, car park, building site, market), shopfronts, people, traffic?
// Then use some of it: buy something, find a stash.
import { launch } from './lib.mjs';
const t = await launch({ pad: 'xbox' });
const { page, shot, step, waitState, errors } = t;
const ev = (fn, arg) => page.evaluate(fn, arg);
await waitState('landing'); await t.wait(3000);
await ev(() => { window.nf.mode = 'city'; window.nf.enter(); });
await waitState('playing', 200);

const survey = () => ev(() => {
  const nf = window.nf, p = nf.player.pos;
  const spots = nf.world.interact.filter((s) => s.id.startsWith('osk'));
  const kinds = {};
  for (const s of spots) { const k = s.id.split(':').pop().replace(/\d+$/, ''); kinds[k] = (kinds[k] ?? 0) + 1; }
  const lent = nf.crowd.npcs.filter((n) => n.visible && Math.abs(n.pos.x) > 150 && Math.hypot(n.pos.x - p.x, n.pos.z - p.z) < 120).length;
  const cars = nf.traffic.cars.filter((c) => c.path && c.group.visible && Math.abs(c.group.position.x) > 150 && Math.hypot(c.group.position.x - p.x, c.group.position.z - p.z) < 200).length;
  return { p: [Math.round(p.x), Math.round(p.z)], spots: spots.length, kinds, people: lent, cars };
});

const views = [[260, -36, Math.PI], [420, 50, Math.PI], [-300, 58, 0], [-520, 137, 0], [700, -36, Math.PI]];
let k = 0;
for (const [x, z, yaw] of views) {
  await ev(([x, z, yaw]) => { const nf = window.nf; nf.player.place(x, 0.15, z, yaw); nf.follow.yaw = yaw; }, [x, z, yaw]);
  await step(3);
  console.log('view', k, JSON.stringify(await survey()));
  await shot(`outskirts-${k++}`);
  // turn round and look at the other side of the street
  await ev(() => { const nf = window.nf; nf.follow.yaw += Math.PI; });
  await step(1);
  await shot(`outskirts-${k++}`);
}

// the places themselves: stand back in the road and look at each kind
const places = await ev(() => {
  const seen = new Set(), out = [];
  for (const s of window.nf.world.interact) {
    const m = /^osk-?\d+:(\d)(\d):(coffee|meal|room|statue|glovebox|toolbox|noodles)$/.exec(s.id);
    if (!m || seen.has(m[3])) continue;
    seen.add(m[3]);
    const band = [[-118, -48], [-32, 46], [62, 134]][+m[1]];
    const F = +m[2] === 0 ? band[0] : band[1], sgn = +m[2] === 0 ? 1 : -1;
    out.push({ kind: m[3], x: s.pos.x, z: F - sgn * 6, yaw: sgn > 0 ? 0 : Math.PI });
  }
  return out;
});
for (const pl of places) {
  await ev((pl) => { const nf = window.nf; nf.player.place(pl.x, 0.15, pl.z, pl.yaw); nf.follow.yaw = pl.yaw; }, pl);
  await step(2);
  await shot(`outskirts-place-${pl.kind}`);
}
console.log('places', places.map((p) => p.kind).join(' '));
// use things: stand at each buyable/stash point near the last view and press it
await ev(() => { window.nf.save.data.cash = 50; window.nf.combat.health = 40; });
const used = await ev(async () => {
  const nf = window.nf, res = [];
  const want = nf.world.interact.filter((s) => /:(coffee|meal|noodles|fruit|bag|glovebox|toolbox|till|snacks)$/.test(s.id)).slice(0, 5);
  for (const s of want) {
    nf.player.place(s.pos.x, 0.15, s.pos.z, 0);
    await new Promise((r) => setTimeout(r, 400));
    res.push({ id: s.id, cash0: nf.save.data.cash, hp0: Math.round(nf.combat.health) });
  }
  return res;
});
for (const u of used) {
  await ev((id) => { const nf = window.nf; const s = nf.world.interact.find((x) => x.id === id); nf.player.place(s.pos.x, 0.15, s.pos.z, 0); }, u.id);
  await step(0.6);
  const cur = await ev(() => window.nf.interaction.current?.spot.id ?? null);
  await t.press('X'); await step(0.4);
  const after = await ev(() => ({ cash: window.nf.save.data.cash, hp: Math.round(window.nf.combat.health), stars: window.nf.combat.stars }));
  console.log('use', u.id, 'prompt', cur, '→', JSON.stringify(after));
  await t.wait(3200);
}
console.log('errors', errors);
await t.browser.close();
