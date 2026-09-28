// FIGHT: pause with the controller (the fight HUD must step aside), and the held cars' headlights stay on the cars.
import { launch } from './lib.mjs';
const t = await launch({ pad: process.env.PAD ?? 'xbox' });
const { page, shot, step, press, waitState, state, errors } = t;
await waitState('landing');
await t.wait(3000);
await page.evaluate(() => { window.nf.mode = 'fight'; window.nf.enter(); });
console.log('state', await waitState('playing', 200));
await step(6);
await shot('fp-01-fight');
await press('Menu'); await step(0.6);
await t.wait(800);
await shot('fp-02-paused');
console.log('overlay', await page.evaluate(() => window.nf.overlay));
await press('B'); await step(0.5);
// look at a held car from close by
await page.evaluate(() => { const nf = window.nf; const c = nf.traffic.cars[0].group.position; nf.debugCam = { pos: c.clone().add({ x: 3, y: 1.8, z: 6 }), look: c.clone() }; });
await step(0.3);
await shot('fp-03-car');
console.log('lamps', await page.evaluate(() => window.nf.traffic.cars.map((c) => [c.group.position.x.toFixed(1), c.group.position.z.toFixed(1), c.lamps[1].pos.x.toFixed(1), c.lamps[1].pos.z.toFixed(1), c.group.visible])));
console.log('state', await state(), 'errors', errors);
await t.browser.close();
