// RPG R4a: animals in the woods, a hunt, butchering, a campfire and cooking, fishing.
import { launch, enterRpg } from './lib.mjs';
const t = await launch({ pad: 'xbox' });
const { page, shot, tap, waitState, focused, errors, step, press } = t;
const until = async (fn, secs = 60) => { for (let i = 0; i < secs * 2; i++) { if (await fn()) return true; await t.wait(500); } return false; };
const log = (...a) => console.log(...a);
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('nightfall.rpg.save')) localStorage.removeItem(k); });
await waitState('landing');
await t.wait(3000);
await enterRpg(t, { creator: 'keep' });
await page.evaluate(() => { [...document.querySelectorAll('.cr__bg')].find((b) => /Drifter/.test(b.textContent))?.click(); document.querySelector('.cr__begin').click(); });
await step(1);
// kit for the woods
await page.evaluate(() => { const g = window.nf.rpg.life.game; g.give('rifle', 1, undefined, true); g.give('r308', 20, undefined, true); g.give('fish', 1, undefined, true); g.give('herbs', 2, undefined, true); g.s.equipped = 'rifle'; });
// out into the wild: somewhere with forest, away from towns
const spot = await page.evaluate(async () => {
  const nf = window.nf, r = nf.rpg, g = r.gen;
  for (let k = 0; k < 400; k++) {
    const x = 3000 + (k % 20) * 300, z = -2000 + Math.floor(k / 20) * 300;
    const gr = g.ground(x, z);
    if (gr.water === null && gr.forest > 0.2 && gr.road === 0 && gr.urban === 0 && !g.placeAt(x, z, 300) && ['forest', 'temperate', 'boreal'].includes(gr.biome)) {
      nf.player.place(x, gr.h + 0.4, z, 0);
      await r.streamer.preload(nf.player.pos, () => {});
      r.atmos.minutes = 8 * 60;
      return { x, z, biome: gr.biome };
    }
  }
  return null;
});
log('spot', JSON.stringify(spot));
for (let i = 0; i < 12; i++) await step(1);
const seen = await page.evaluate(() => window.nf.rpg.wildlife.animals.map((a) => `${a.sp.id}${a.ready ? '' : '?'}@${Math.round(a.pos.distanceTo(window.nf.player.pos))}`));
log('animals', JSON.stringify(seen));
// walk up to the nearest (crouched, slowly) and look at it
const target = await page.evaluate(() => {
  const nf = window.nf, p = nf.player.pos;
  const a = nf.rpg.wildlife.animals.filter((x) => x.ready && x.sp.gait !== 'fly' && x.state !== 'dead').sort((x, y) => x.pos.distanceTo(p) - y.pos.distanceTo(p))[0];
  if (!a) return null;
  const yaw = Math.atan2(a.pos.x - p.x, a.pos.z - p.z);
  const d = a.pos.distanceTo(p);
  const k = Math.max(0, d - 25) / d;
  nf.player.place(p.x + (a.pos.x - p.x) * k, a.pos.y + 0.5, p.z + (a.pos.z - p.z) * k, yaw);
  nf.follow.yaw = yaw;
  window.__a = a;
  return { id: a.sp.id, d: Math.round(d), state: a.state };
});
log('target', JSON.stringify(target));
await step(1);
await page.evaluate(() => { const a = window.__a, nf = window.nf; if (!a) return; nf.debugCam = { pos: nf.player.pos.clone().add({ x: -Math.sin(nf.follow.yaw) * 2.5, y: 1.9, z: -Math.cos(nf.follow.yaw) * 2.5 }), look: a.pos.clone().add({ x: 0, y: a.sp.cy, z: 0 }) }; });
await step(0.3);
await shot('rpg-wild-01-sighted');
await page.evaluate(() => { window.nf.debugCam = null; });
// the shot (a ray straight at it from where you stand)
const kill = await page.evaluate(() => {
  const nf = window.nf, a = window.__a;
  if (!a) return null;
  const o = nf.player.pos.clone().add({ x: 0, y: 1.5, z: 0 });
  const dir = a.pos.clone().add({ x: 0, y: a.sp.cy, z: 0 }).sub(o).normalize();
  const hit = nf.rpg.hitTest(o, dir, 200);
  if (!hit) return 'miss';
  let killed = false;
  for (let i = 0; i < 4 && !killed; i++) killed = hit.apply(nf.rpg.life.weapon().dmg);
  nf.rpg.alarm(nf.player.pos, 220);
  return { what: hit.what, killed, state: a.state };
});
log('shot', JSON.stringify(kill));
await step(1.5);
// walk to it and butcher
await page.evaluate(() => { const nf = window.nf, a = window.__a; if (a) nf.player.place(a.pos.x - 1.2, a.pos.y + 0.4, a.pos.z, Math.PI / 2); });
await step(0.5);
log('prompt', await page.evaluate(() => document.querySelector('[class*=prompt]')?.textContent));
await page.evaluate(() => { const nf = window.nf, a = window.__a; nf.debugCam = { pos: a.pos.clone().add({ x: 2.2, y: 1.4, z: 2.2 }), look: a.pos.clone().add({ x: 0, y: 0.3, z: 0 }) }; });
await step(0.3);
await shot('rpg-wild-02-down');
await page.evaluate(() => { window.nf.debugCam = null; });
await press('X');
for (let i = 0; i < 6; i++) await step(0.5);
log('pockets', JSON.stringify(await page.evaluate(() => window.nf.rpg.life.game.s.inv.map((s) => `${s.id}×${s.n}`))));
// a fire, and supper
await page.evaluate(() => { window.nf.rpg.atmos.override = 'clear'; window.nf.rpg.atmos.minutes = 21 * 60; });
for (let i = 0; i < 4; i++) await step(1);
log('fire', await page.evaluate(() => window.nf.rpg.life.cf.hk.makeFire()));
await step(2);
await press('X');
await step(0.5);
log('camp', await page.evaluate(() => [window.nf.rpg.life.panel, [...document.querySelectorAll('.talk__choice')].map((b) => b.textContent).join(' | ')]));
await page.evaluate(() => [...document.querySelectorAll('.talk__choice')].find((b) => /Roast venison|Grill a fish/.test(b.textContent) && !b.disabled)?.click());
await step(0.5);
await shot('rpg-wild-03-camp');
await page.evaluate(() => [...document.querySelectorAll('.talk__choice')].find((b) => /Get up/.test(b.textContent))?.click());
await step(0.5);
// fishing: find the edge of some water nearby
const shore = await page.evaluate(async () => {
  const nf = window.nf, r = nf.rpg, g = r.gen, p = nf.player.pos;
  for (let rad = 50; rad < 3000; rad += 50) for (let a = 0; a < 24; a++) {
    const x = p.x + Math.sin(a / 24 * 6.28) * rad, z = p.z + Math.cos(a / 24 * 6.28) * rad;
    const w = g.ground(x, z);
    if (w.water === null) continue;
    // step back towards us until it's land
    for (let k = 1; k < 40; k++) {
      const lx = x - Math.sin(a / 24 * 6.28) * k, lz = z - Math.cos(a / 24 * 6.28) * k;
      const lg = g.ground(lx, lz);
      if (lg.water === null && lg.h > (w.water ?? 0) + 0.2) {
        const bx = lx - Math.sin(a / 24 * 6.28) * 1.5, bz = lz - Math.cos(a / 24 * 6.28) * 1.5;
        const yaw = Math.atan2(x - bx, z - bz);
        nf.player.place(bx, g.height(bx, bz) + 0.4, bz, yaw);
        nf.follow.yaw = yaw;
        await r.streamer.preload(nf.player.pos, () => {});
        return { rad, k };
      }
    }
  }
  return null;
});
log('shore', JSON.stringify(shore));
await page.evaluate(() => { window.nf.rpg.atmos.minutes = 9 * 60; });
await step(1);
log('prompt', await page.evaluate(() => document.querySelector('[class*=prompt]')?.textContent));
log('interaction', await page.evaluate(() => { const nf = window.nf; const f = nf.camera.getWorldDirection(new nf.player.pos.constructor()); const i = nf.rpg.life.interaction(nf.player.pos, f); return JSON.stringify({ i: i && [i.name, i.verb], fwd: [f.x.toFixed(2), f.z.toFixed(2)], p: [Math.round(nf.player.pos.x), Math.round(nf.player.pos.z)], swim: nf.player.swimming, rod: nf.rpg.life.game.count('rod') }); }));
await press('X');
await step(0.3);
log('fishing', await page.evaluate(() => window.nf.rpg.life.panel));
await shot('rpg-wild-04-fishing');
// play it: wait for the bite, strike, reel in rhythm
const res = await page.evaluate(async () => {
  const f = window.nf.rpg.life.fishing, btn = document.querySelector('.fish__reel');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 400 && f.isOpen; i++) {
    if (f.phase === 'bite') btn.click();
    else if (f.phase === 'fight' && f.ten < 0.62) btn.click();
    await sleep(120);
  }
  return window.nf.rpg.life.game.count('fish');
});
log('fish in pocket', res);
log('errors', JSON.stringify(errors));
await t.browser.close();
