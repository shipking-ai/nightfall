// WARZONE's front end with a controller: the menu opens on entry, RB walks the tabs (Play, Loadouts,
// Career, Controls), a mode is picked, Deploy starts it.
import { launch } from './lib.mjs';
const t = await launch({ pad: process.env.PAD ?? 'xbox' });
const { page, shot, step, press, waitState, errors, focused } = t;
const ev = (fn, arg) => page.evaluate(fn, arg);
await waitState('landing');
await t.wait(3000);
await ev(() => { window.nf.mode = 'warzone'; window.nf.enter(); });
console.log('state', await waitState('playing', 200));
await step(1);
console.log('menu open', await ev(() => window.nf.warzone.menuOpen), 'focus', (await focused()).slice(0, 40));
await shot('wzmenu-01-play');
for (const tab of ['loadouts', 'career', 'controls']) {
  await press('RB'); await t.wait(600); await step(0.2);
  console.log('tab', await ev(() => window.nf.warzone.menu.tab));
  await shot(`wzmenu-02-${tab}`);
}
await press('RB'); await t.wait(600); await step(0.2);
// pick Team Deathmatch by clicking its card (the D-pad works too; this keeps the run short)
await ev(() => [...document.querySelectorAll('.wzm-mode')].find((b) => b.textContent.includes('Team Deathmatch')).click());
await step(0.2);
console.log('mode', await ev(() => window.nf.warzone.modeId));
await ev(() => document.querySelector('.wzm-go').click());
await step(0.5);
console.log('after deploy click', JSON.stringify(await ev(() => ({ menu: window.nf.warzone.menuOpen, phase: window.nf.warzone.snapshot.phase }))));
await press('A'); await step(9);
console.log('playing', JSON.stringify(await ev(() => window.nf.warzone.snapshot.me)));
await shot('wzmenu-03-tdm');
console.log('errors', errors);
await t.browser.close();
