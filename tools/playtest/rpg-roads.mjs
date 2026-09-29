// RPG: traffic on a highway; parked cars in a town you can drive away in.
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
// stand by a highway
const where = await page.evaluate(async () => {
  const nf = window.nf, r = nf.rpg, g = r.gen;
  let road = null;
  for (let i = -1; i <= 1 && !road; i++) for (let j = -1; j <= 1 && !road; j++) for (const d of [0, 1]) { const rd = g.road(i, j, d); if (rd && rd.kind === 'highway') { road = rd; break; } }
  const k = Math.floor(road.pts.length / 2 / 3);
  const x = road.pts[k * 2] + 14, z = road.pts[k * 2 + 1];
  nf.player.place(x, g.height(x, z) + 0.3, z, 0);
  await r.streamer.preload(nf.player.pos, () => {});
  r.atmos.minutes = 9 * 60;
  r.atmos.override = 'clear';
  nf.follow.yaw = Math.atan2(road.pts[k * 2 + 2] - road.pts[k * 2], road.pts[k * 2 + 3] - road.pts[k * 2 + 1]) + Math.PI * 0.35;
  return { x: Math.round(x), z: Math.round(z), kind: road.kind };
});
console.log('at', JSON.stringify(where));
await t.wait(20000);
console.log('traffic', JSON.stringify(await page.evaluate(() => window.nf.rpg.debug)));
const tc = await page.evaluate(() => {
  const nf = window.nf, p = nf.player.pos;
  const c = nf.rpg.traffic.cars.slice().sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p))[0];
  if (!c) return null;
  nf.player.place(c.pos.x + Math.cos(c.yaw) * 30, nf.rpg.gen.height(c.pos.x + Math.cos(c.yaw) * 30, c.pos.z - Math.sin(c.yaw) * 30) + 0.3, c.pos.z - Math.sin(c.yaw) * 30, 0);
  window.__tc = c;
  return { kind: c.kind, d: Math.round(c.pos.distanceTo(p)) };
});
console.log('nearest traffic', JSON.stringify(tc));
for (let i = 0; i < 4; i++) {
  await page.evaluate(() => { const c = window.__tc; const nf = window.nf; nf.debugCam = { pos: c.pos.clone().add({ x: Math.cos(c.yaw) * 9 + Math.sin(c.yaw) * 7, y: 2.2, z: -Math.sin(c.yaw) * 9 + Math.cos(c.yaw) * 7 }), look: c.pos.clone().add({ x: 0, y: 0.8, z: 0 }) }; });
  await t.step(0.25);
}
await shot('rpg-roads-highway');
await page.evaluate(() => { window.nf.debugCam = null; });
// a town: parked cars; get in one and drive
const town = await page.evaluate(async () => {
  const nf = window.nf, r = nf.rpg;
  const s = r.gen.settlement(1, 0);
  const plan = r.streamer.towns.plan(s);
  const w = plan.walk.slice().sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z))[0];
  nf.player.place(w.x, w.y + 0.2, w.z, 0);
  await r.streamer.preload(nf.player.pos, () => {});
  return s.name;
});
for (let i = 0; i < 10 && !(await page.evaluate(() => window.nf.vehicles.cars.some((c) => c.streamed))); i++) await t.step(1);
const car = await page.evaluate(() => {
  const nf = window.nf;
  const cars = nf.vehicles.cars.filter((c) => c.streamed);
  if (!cars.length) return null;
  const c = cars[0];
  nf.player.place(c.pos.x + Math.cos(c.yaw) * 1.9, c.pos.y + 0.2, c.pos.z - Math.sin(c.yaw) * 1.9, c.yaw);
  return { n: cars.length, x: Math.round(c.pos.x), z: Math.round(c.pos.z) };
});
console.log('town', town, 'parked', JSON.stringify(car));
await t.step(1);
console.log('pre', JSON.stringify(await page.evaluate(() => { const nf = window.nf; const n = nf.vehicles.nearest(nf.player.pos, 1.4); return { d: n?.d, grounded: nf.player.grounded, prompt: document.querySelector('.prompt, .hud-prompt, [class*=prompt]')?.textContent, p: [nf.player.pos.x, nf.player.pos.y, nf.player.pos.z].map(Math.round) }; })));
await t.press('X');
await t.step(1.5);
const inCar = await page.evaluate(() => !!window.nf.vehicle);
await t.hold('RT', true);
await t.step(5);
await t.hold('RT', false);
const moved = await page.evaluate(() => { const c = window.nf.vehicle?.car; return c ? { x: Math.round(c.pos.x), z: Math.round(c.pos.z), v: +c.v.toFixed(1) } : null; });
console.log('in car', inCar, JSON.stringify(moved));
await shot('rpg-roads-drive');
console.log('errors', errors);
await t.browser.close();
