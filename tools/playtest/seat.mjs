import { launch } from './lib.mjs';
const t = await launch({ pad: 'xbox' });
const { page, shot, step, press, waitState } = t;
await waitState('landing'); await t.wait(4000);
await page.evaluate(() => { window.nf.mode = 'city'; window.nf.enter(); });
await waitState('playing', 200); await step(1);
await page.evaluate(() => { const nf = window.nf; nf.player.place(-5.2, 0.15, 22, -Math.PI / 2); nf.follow.snap(nf.player, nf.world.collision); });
await step(1); await press('X'); await step(1.5);
await page.evaluate(() => { const c = window.nf.vehicle.car.pos; window.nf.debugCam = { pos: c.clone().add({ x: 3.2, y: 1.5, z: 1.2 }), look: c.clone().add({ x: 0, y: 0.9, z: 0 }) }; });
await step(0.2); await shot('seat-side');
await page.evaluate(() => { const c = window.nf.vehicle.car.pos; window.nf.debugCam = { pos: c.clone().add({ x: -1.2, y: 1.6, z: 3.5 }), look: c.clone().add({ x: -0.3, y: 1.0, z: 0 }) }; });
await step(0.2); await shot('seat-front');
// a traffic car with its driver, if one is out
await page.evaluate(() => { const nf = window.nf; nf.debugCam = null; const car = nf.traffic.cars.find((c) => c.group.visible); if (car) { const p = car.group.position; nf.debugCam = { pos: p.clone().add({ x: 2.8, y: 1.5, z: 0 }), look: p.clone().add({ x: 0, y: 0.9, z: 0 }) }; } });
await step(0.1); await shot('seat-traffic');
console.log(t.errors); await t.browser.close();
