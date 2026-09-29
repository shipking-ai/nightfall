// RPG: a town at lunchtime — its residents out on the pavements, as realistic people; talk to one.
import { launch } from './lib.mjs';
const t = await launch({ pad: 'xbox' });
const { page, shot, tap, waitState, focused, errors } = t;
const until = async (fn, secs = 60) => { for (let i = 0; i < secs * 2; i++) { if (await fn()) return true; await t.wait(500); } return false; };
await waitState('landing');
await t.wait(3000);
await until(async () => (await focused()).includes('Enter'), 20);
await tap('A');
await until(() => page.evaluate(() => window.nf.modeSelect.isOpen), 20);
await t.wait(1200);
for (let i = 0; i < 8 && !(await focused()).includes('RPG'); i++) { await tap('Down'); await t.wait(800); }
await tap('A');
await until(async () => (await page.evaluate(() => window.nf.state)) === 'playing', 240);
const town = await page.evaluate(async () => {
  const nf = window.nf, r = nf.rpg;
  const s = r.gen.settlement(1, 0);
  const plan = r.streamer.towns.plan(s);
  const w = plan.walk.slice().sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z))[0];
  nf.player.place(w.x, w.y + 0.2, w.z, 0);
  await r.streamer.preload(nf.player.pos, () => {});
  r.atmos.minutes = 12.3 * 60;
  r.atmos.override = 'clear';
  return { name: s.name, kind: s.kind, residents: r.populace.residents(s).length, walk: plan.walk.length };
});
console.log('town', JSON.stringify(town));
await until(async () => (await page.evaluate(() => window.nf.rpg.populace.count)) > 0, 30);
await t.wait(25000);
const d = await page.evaluate(() => ({ ...window.nf.rpg.debug, ready: [...window.nf.rpg.populace.walkers.values()].filter((w) => w.human.ready).length }));
console.log('people', JSON.stringify(d));
// stand in front of the nearest one, face them, talk
const talked = await page.evaluate(() => {
  const nf = window.nf, pop = nf.rpg.populace;
  const ws = [...pop.walkers.values()].filter((w) => w.human.ready);
  if (!ws.length) return null;
  const w = ws[0];
  nf.player.place(w.pos.x, w.pos.y, w.pos.z - 1.6, 0);
  nf.follow.yaw = 0.3;
  return w.r.name + ' / ' + w.r.job;
});
await t.wait(1500);
await shot('rpg-people-talk-before');
await tap('X');
await t.wait(2500);
await shot('rpg-people-talk');
console.log('talked to', talked);
// a wider look
await page.evaluate(() => { window.nf.follow.yaw += Math.PI; });
await t.wait(1500);
await shot('rpg-people-street');
console.log('errors', errors);
await t.browser.close();
