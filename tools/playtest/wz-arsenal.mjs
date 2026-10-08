// WARZONE's arsenal with a controller: the gunsmith (change the primary, fit attachments), deploy and fire
// it, a bolt-action through the scope, the launcher's blast, and a knife.
import { launch } from './lib.mjs';
const t = await launch({ pad: process.env.PAD ?? 'xbox' });
const { page, shot, hold, stick, step, press, waitState, errors } = t;
const snap = () => page.evaluate(() => window.nf.warzone.snapshot);
const log = async (label) => console.log(label, JSON.stringify((await snap()).me));

await waitState('landing');
await t.wait(3000);
await page.evaluate(() => { window.nf.mode = 'warzone'; window.nf.enter(); });
console.log('state', await waitState('playing', 200));
// Warzone opens on its menu: Deploy goes to the loadout screen
await page.evaluate(() => document.querySelector('.wzm-go').click());
await step(0.5);
// the gunsmith on the first preset: it edits a copy
await press('X'); await step(0.3);
console.log('smith open', await page.evaluate(() => window.nf.warzone.smith.open));
await shot('wza-01-gunsmith');
for (let i = 0; i < 3; i++) { await press('Right'); await step(0.1); }
await press('Down'); await step(0.1);
await press('Right'); await step(0.1);
await press('Down'); await step(0.1); await press('Down'); await step(0.1);
await press('Right'); await step(0.1); await press('Right'); await step(0.1);
await shot('wza-02-gunsmith-dressed');
await press('B'); await step(0.3);
console.log('smith closed', !(await page.evaluate(() => window.nf.warzone.smith.open)), await page.evaluate(() => { const l = window.nf.warzone.loadout; return `${l.name} ${l.primary} [${l.pa}]`; }));
await press('A'); await step(1.2);
await log('deployed custom');
// the opening scene has the camera: the gun stays quiet until it hands back
await hold('RT', true); await step(0.5); await hold('RT', false);
await log('during the opening (mag full)');
await step(8);
await hold('LT', true); await step(0.6);
await hold('RT', true); await step(0.8); await hold('RT', false);
await shot('wza-03-custom-fire');
console.log('load overlay', await page.evaluate(() => [...document.querySelectorAll('.wz-load')].map((e) => e.className + ' op=' + getComputedStyle(e).opacity).join(';')));
await hold('LT', false); await step(0.3);
await log('after fire');
// die and come back as Recon (bolt-action, 8× scope)
const pick = async (id) => {
  await page.evaluate(() => { const w = window.nf.warzone; w.damage(w.me, 500, w.bots[7], w.bots[7].gun, true); });
  await step(1);
  for (let i = 0; i < 12; i++) {
    if (await page.evaluate((id) => window.nf.warzone.loadout.id === id, id)) break;
    await press('RB'); await step(0.1);
  }
  await step(5);
  await press('A'); await step(1.2);
};
await pick('sniper');
await log('recon');
await hold('LT', true); await step(0.9);
await shot('wza-04-scope');
await press('RT'); await step(0.15);
await shot('wza-05-bolt');
await step(1.2);
await hold('LT', false);
await log('after bolt');
// support: the launcher
await pick('support');
await press('Y'); await step(0.8);
await page.evaluate(() => { const f = window.nf.follow; f.pitch = 0.1; });
await press('RT'); await step(0.6);
await shot('wza-06-rocket');
await step(0.4);
await shot('wza-07-blast');
await log('after rocket');
// a knife: quick melee
await press('RS'); await step(0.2);
await shot('wza-08-melee');
console.log('errors', errors);
await t.browser.close();
