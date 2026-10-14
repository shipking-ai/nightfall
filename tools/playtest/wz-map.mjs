// WARZONE's minimap and compass: turn on the spot and check the map turns with you, objectives on the compass.
import { launch } from './lib.mjs';
const t = await launch({ pad: process.env.PAD ?? 'xbox' });
const { page, shot, step, press, waitState, errors } = t;
const ev = (fn, arg) => page.evaluate(fn, arg);
await waitState('landing');
await t.wait(3000);
await ev(() => { window.nf.mode = 'warzone'; window.nf.enter(); });
await waitState('playing', 200);
await ev(() => document.querySelector('.wzm-go').click());
await press('A'); await step(9);
for (const [i, yaw] of [[0, Math.PI], [1, Math.PI / 2], [2, 0]]) {
  await ev((y) => { window.nf.follow.yaw = y; }, yaw);
  await step(0.3);
  await shot(`wzmap-0${i}`);
}
await ev(() => { const w = window.nf.warzone; w.hardline = true; });
await step(0.3);
console.log('hardline hides map', await ev(() => getComputedStyle(document.querySelector('.wz-minimap')).display));
console.log('errors', errors);
await t.browser.close();
