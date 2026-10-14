// The player's own walk and run, filmed from the side in the city: frames for a strip.
import { launch } from './lib.mjs';
const t = await launch({ pad: 'xbox' });
const { page, shot, step, stick, hold, waitState, errors } = t;
await waitState('landing'); await t.wait(3000);
await page.evaluate(() => { window.nf.mode = 'city'; window.nf.enter(); });
await waitState('playing', 200);
await page.evaluate(() => { const nf = window.nf; nf.player.place(0, 0.15, -105, 0); nf.follow.yaw = Math.PI / 2; });
await step(1);
await page.evaluate(() => { const f = window.nf.follow; f.yaw = Math.PI / 2; f.pitch = 0.05; });
await stick(0, -1, 0); await step(1.2);
for (let i = 0; i < 5; i++) {
  await step(0.13);
  await shot(`pgait-walk-${i}`);
}
await hold('LS', true); await step(0.6);
for (let i = 0; i < 5; i++) {
  await step(0.09);
  await shot(`pgait-run-${i}`);
}
await hold('LS', false); await stick(0, 0, 0);
console.log('facing', await page.evaluate(() => window.nf.player.facing.toFixed(2)), 'speed', await page.evaluate(() => window.nf.player.speed), 'errors', errors);
await t.browser.close();
