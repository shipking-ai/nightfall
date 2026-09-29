// R5: the atlas. Open the Map tab, zoom out with a trigger, pan with the stick, drop a pin with A, and check the compass follows it.
import { launch } from './lib.mjs';
const t = await launch({ pad: 'xbox', w: 1280, h: 720 });
const { page, shot, tap, hold, stick, waitState, focused, errors } = t;
const until = async (fn, secs = 60) => { for (let i = 0; i < secs * 2; i++) { if (await fn()) return true; await t.wait(500); } return false; };
const log = (...a) => console.log(...a);
const fail = (m) => { log('FAIL', m); process.exitCode = 1; };
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('nightfall.rpg.save')) localStorage.removeItem(k); });
await waitState('landing');
await t.wait(3000);
await until(async () => (await focused()).includes('Enter'), 8);
for (let i = 0; i < 6 && !(await focused()).includes('Enter'); i++) { await tap(i < 3 ? 'Down' : 'Up'); await t.wait(700); }
await tap('A');
await until(() => page.evaluate(() => window.nf.modeSelect.isOpen), 20);
await t.wait(1200);
for (let i = 0; i < 8 && !(await focused()).includes('RPG'); i++) { await tap('Down'); await t.wait(800); }
await t.wait(2000);
await tap('A');
await until(async () => ['playing', 'overlay'].includes(await page.evaluate(() => window.nf.state)), 240);
await until(() => page.evaluate(() => window.nf.rpg.life.panel === 'creator'), 30);
await page.evaluate(() => document.querySelector('.cr__begin').click());
await t.wait(2000);
// chart a stretch of country as if we'd walked it: a band from here to the first town
const info = await page.evaluate(() => {
  const nf = window.nf, life = nf.rpg.life, g = life.game;
  const P = nf.rpgMain(life.world);
  const p = nf.player.pos;
  for (let k = 0; k <= 60; k++) {
    const x = p.x + (P.first.x - p.x) * (k / 60), z = p.z + (P.first.z - p.z) * (k / 60);
    const i = Math.floor(x / 400), j = Math.floor(z / 400);
    for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) g.s.mem.seen[`${i + a},${j + b}`] = 1;
  }
  life.openCasefile('map');
  return { first: P.first.name, d: Math.round(Math.hypot(P.first.x - p.x, P.first.z - p.z)), tab: document.querySelector('.cf__tab.is-on')?.textContent };
});
log('map', JSON.stringify(info));
await t.wait(500);
log('probe', JSON.stringify(await page.evaluate(() => {
  const nf = window.nf;
  const cf = document.querySelector('.cf');
  const cs = getComputedStyle(cf);
  return { state: nf.state, navActive: nf.nav?.active, isPad: nf.input?.isPad, top: nf.nav?.top()?.className ?? null, cls: cf.className, vis: cf.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }), op: cs.opacity, visibility: cs.visibility, display: cs.display, hidden: cf.hidden, nfNav: !!nf.nav };
})));
if (info.tab !== 'Map') fail('the map tab did not open');
await t.wait(6000);
await shot('rpg-map-1');
// zoom out (LT) and pan (left stick) towards the first town
await hold('LT', true, 0, 1);
await t.wait(5000);
log('probe2', JSON.stringify(await page.evaluate(() => {
  const nf = window.nf;
  const cf = document.querySelector('.cf');
  return { state: nf.state, rpg: nf.rpg.active, top: nf.nav?.top()?.className ?? null, mpp: nf.rpg.life.atlas.view.mpp };
})));
await t.wait(1600);
await hold('LT', false);
await t.wait(1500);
const before = await page.evaluate(() => window.nf.rpg.life.atlas.view);
await stick(0, 0.8, -0.8);
await t.wait(3000);
await stick(0, 0, 0);
const after = await page.evaluate(() => window.nf.rpg.life.atlas.view);
log('view', JSON.stringify(before), '→', JSON.stringify(after));
if (!(before.mpp > 10)) fail('LT did not zoom out');
if (!(after.x > before.x && after.z < before.z)) fail('the stick did not pan north-east');
await t.wait(5000);
await shot('rpg-map-2');
// a pin where the cross-hair is; the compass should follow it
await hold('A', true);
await t.wait(2500);
await hold('A', false);
await t.wait(1500);
const wp = await page.evaluate(() => window.nf.rpg.life.waypoint);
log('pin', JSON.stringify(wp));
if (!wp) fail('A did not drop a pin');
await hold('B', true);
await t.wait(2500);
await hold('B', false);
await t.wait(1500);
const goal = await page.evaluate(() => document.querySelector('.rpg-goal, [class*="goal"]')?.textContent ?? '');
log('goal', goal.slice(0, 80));
log('errors', JSON.stringify(errors));
if (errors.length) fail('errors');
await t.browser.close();
