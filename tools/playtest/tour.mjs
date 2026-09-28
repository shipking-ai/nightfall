// A lighting tour of the City: the same spots every time, so a change in the light can be judged.
import { launch } from './lib.mjs';
const t = await launch({ pad: process.env.PAD ?? 'xbox' });
const { page, shot, step, waitState, errors } = t;
const PREFIX = process.env.TOUR ?? 'tour';
await waitState('landing');
await t.wait(3000);
await page.evaluate((m) => { window.nf.mode = m; window.nf.enter(); }, process.env.MODE ?? 'city');
console.log('state', await waitState('playing', 200));
const spots = [
  ['avenue', -11, 118, Math.PI],
  ['station', 0, -168, 0],
  ['square', -80, 20, -Math.PI / 2],
  ['riverside', 20, 152, Math.PI / 2],
  ['market', -64, 0, 0],
  ['alley', 36, 60, Math.PI],
];
for (const [name, x, z, yaw] of spots) {
  await page.evaluate(([x, z, yaw]) => { const nf = window.nf; nf.player.place(x, 0.15, z, yaw); nf.follow.alignBehind(nf.player); nf.follow.snap(nf.player, nf.world.collision); }, [x, z, yaw]);
  await step(1.2);
  await shot(`${PREFIX}-${name}`);
  console.log(name, await page.evaluate(() => window.nf.inside?.name ?? window.nf.discovery.districtName));
}
console.log('errors', errors);
await t.browser.close();
