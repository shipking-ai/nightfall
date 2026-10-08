// WARZONE with a controller, on game time: pick a loadout, deploy, first person, aim and fire, swap to
// third person, move up to B while the bots fight, die and respawn, the scoreboard, the end of the match.
import { launch } from './lib.mjs';
const t = await launch({ pad: process.env.PAD ?? 'xbox' });
const { page, shot, hold, stick, step, press, waitState, state, errors } = t;
const snap = () => page.evaluate(() => window.nf.warzone.snapshot);
const log = async (label) => console.log(label, JSON.stringify(await snap()));

await waitState('landing');
await t.wait(3000);
await page.evaluate(() => { window.nf.mode = 'warzone'; window.nf.enter(); });
console.log('state', await waitState('playing', 200));
// Warzone opens on its menu: Deploy goes to the loadout screen
await page.evaluate(() => document.querySelector('.wzm-go').click());
await step(0.5);
await shot('wz-01-loadout');
await press('RB'); await step(0.2);
await log('loadout picked');
await press('A'); await step(1);
await log('deployed');
await shot('wz-02-first-person');
// walk towards B, look around
await stick(0, 0.3, -1); await step(2.5); await stick(0, 0, 0);
await shot('wz-03-moving');
await hold('LT', true); await step(0.5);
await shot('wz-04-ads');
await hold('RT', true); await step(0.6); await hold('RT', false);
await shot('wz-05-firing');
await hold('LT', false); await step(0.3);
await log('after firing');
await press('Up'); await step(0.5);
await shot('wz-06-third-person');
await press('Up'); await step(0.3);
// let it play out for a while: push up and hold the trigger when something's in front
for (let i = 0; i < 10; i++) {
  await stick(0, (i % 3) - 1, -0.8); await step(0.8); await stick(0, 0, 0);
  await hold('LT', true); await hold('RT', true); await step(0.6); await hold('RT', false); await hold('LT', false);
  await step(0.6);
}
{ const t0 = Date.now(); await page.evaluate(() => 1); console.log('eval ms', Date.now() - t0); }
console.log('frame ms', await page.evaluate(() => { const t0 = performance.now(); window.nf.devStep(1); return Math.round(performance.now() - t0); }));
await log('before shot');
await shot('wz-07-fight');
await log('after a while');
await hold('View', true); await step(0.3);
await shot('wz-08-scoreboard');
await hold('View', false); await step(0.2);
// die, then come back with another loadout
await page.evaluate(() => { const w = window.nf.warzone; w.damage(w.me, 500, w.bots[7], w.bots[7].gun, true); });
await step(1.5);
await shot('wz-09-dead');
await log('dead');
await press('RB'); await step(4);
await press('A'); await step(1);
await log('respawned');
await shot('wz-10-respawned');
// the end of the match
await page.evaluate(() => { window.nf.warzone.score[0] = 149; window.nf.warzone.points[1].owner = 0; });
await step(3);
await t.wait(1000);
await log('over');
await shot('wz-11-over');
console.log('focus', await t.focused());
for (let i = 0; i < 3; i++) await press('Down');
await press('A');
page.evaluate(() => window.nf.realtime());
console.log('after leave', await waitState('landing', 60), 'look restored', await page.evaluate(() => window.nf.player.outfit.garment));
console.log('state', await state(), 'errors', errors);
await t.browser.close();
