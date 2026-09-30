// RPG R4d: what people drive out here (and how it handles), taking a car off the road, cards at the bar.
import { launch, enterRpg } from './lib.mjs';
const t = await launch({ pad: 'xbox' });
const { page, shot, tap, waitState, focused, errors, step, press } = t;
const until = async (fn, secs = 60) => { for (let i = 0; i < secs * 2; i++) { if (await fn()) return true; await t.wait(500); } return false; };
const log = (...a) => console.log(...a);
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('nightfall.rpg.save')) localStorage.removeItem(k); });
await waitState('landing');
await t.wait(3000);
await enterRpg(t, { creator: 'keep' });
await page.evaluate(() => { [...document.querySelectorAll('.cr__bg')].find((b) => /Wheelman/.test(b.textContent))?.click(); document.querySelector('.cr__begin').click(); });
await step(1);
await page.evaluate(() => { window.nf.rpg.life.game.c.money = 300; });
// a town
const town = await page.evaluate(async () => {
  const nf = window.nf, life = nf.rpg.life;
  const P = window.nf.rpgMain(life.world);
  const plan = nf.rpg.streamer.towns.plan(P.first);
  const w = plan.walk.slice().sort((a, b) => Math.hypot(a.x - P.first.x, a.z - P.first.z) - Math.hypot(b.x - P.first.x, b.z - P.first.z))[0];
  nf.player.place(w.x, w.y + 0.3, w.z, 0);
  await nf.rpg.streamer.preload(nf.player.pos, () => {});
  nf.rpg.atmos.minutes = 19 * 60;
  nf.rpg.atmos.override = 'clear';
  return { name: P.first.name, biome: P.first.biome };
});
for (let i = 0; i < 4; i++) await step(1);
const kinds = await page.evaluate(() => window.nf.vehicles.cars.filter((c) => c.streamed).map((c) => c.kind));
log('town', JSON.stringify(town), 'parked', JSON.stringify(kinds));
// into the one with the most character, and off down the road
const car = await page.evaluate(() => {
  const nf = window.nf;
  const cars = nf.vehicles.cars.filter((c) => c.streamed);
  const c = cars.find((x) => x.kind === 'pickup' || x.kind === 'offroad' || x.kind === 'truck') ?? cars[0];
  if (!c) return null;
  nf.boardNow({ kind: 'drive', car: c });
  return c.kind;
});
log('driving', car);
await t.hold('RT', true);
await step(5);
await t.hold('RT', false);
log('speed', await page.evaluate(() => { const c = window.nf.vehicle?.car; return c && { v: +c.v.toFixed(1), grip: window.nf.vehicles.grip }; }));
await shot('rpg-drive-01');
await press('B');
for (let i = 0; i < 6; i++) await step(0.5);
// a car off the road: one of the traffic, stopped beside you
const jack = await page.evaluate(() => {
  const nf = window.nf, tr = nf.rpg.traffic;
  const v = tr.cars[0];
  if (!v) return null;
  v.v = 0; v.vmax = 0;
  nf.player.place(v.pos.x + Math.cos(v.yaw) * 2, v.pos.y + 0.3, v.pos.z - Math.sin(v.yaw) * 2, v.yaw);
  return v.kind;
});
log('traffic car', jack);
if (jack) {
  await step(0.4);
  log('prompt', await page.evaluate(() => document.querySelector('[class*=prompt]')?.textContent));
  await press('X');
  for (let i = 0; i < 4; i++) await step(0.5);
  log('in it', await page.evaluate(() => window.nf.vehicle?.car?.kind ?? null));
  await press('B');
  for (let i = 0; i < 6; i++) await step(0.5);
}
// cards
const bar = await page.evaluate(async () => {
  const nf = window.nf, life = nf.rpg.life;
  const P = window.nf.rpgMain(life.world);
  const poi = nf.rpg.streamer.towns.plan(P.first).pois.find((p) => p.kind === 'bar');
  if (!poi) return null;
  nf.player.place(poi.x + Math.sin(poi.yaw) * 1.3, poi.y + 0.3, poi.z + Math.cos(poi.yaw) * 1.3, poi.yaw + Math.PI);
  nf.follow.yaw = poi.yaw + Math.PI;
  await nf.rpg.streamer.preload(nf.player.pos, () => {});
  return poi.name;
});
await step(0.6);
await press('X');
await step(0.4);
await page.evaluate(() => [...document.querySelectorAll('.talk__choice')].find((b) => /cards/.test(b.textContent))?.click());
await step(0.2);
const m0 = await page.evaluate(() => window.nf.rpg.life.game.c.money);
await page.evaluate(() => [...document.querySelectorAll('.talk__choice')].find((b) => /Deal me in/.test(b.textContent))?.click());
await step(0.2);
log('hand', await page.evaluate(() => [...document.querySelectorAll('.talk__line')].map((l) => l.textContent).join(' | ')));
await page.evaluate(() => [...document.querySelectorAll('.talk__choice')].find((b) => /Stand/.test(b.textContent))?.click());
await step(0.2);
log('result', await page.evaluate(() => [...document.querySelectorAll('.talk__line')].map((l) => l.textContent).join(' | ')), m0, '→', await page.evaluate(() => window.nf.rpg.life.game.c.money));
await t.wait(900);
await shot('rpg-drive-02-cards');
log('errors', JSON.stringify(errors));
await t.browser.close();
