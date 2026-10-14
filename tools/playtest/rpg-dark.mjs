// RPG R4b: dread after dark (the watcher at the tree line), and something by the road.
import { launch, enterRpg } from './lib.mjs';
const t = await launch({ pad: 'xbox' });
const { page, shot, tap, waitState, focused, errors, step, press } = t;
const until = async (fn, secs = 60) => { for (let i = 0; i < secs * 2; i++) { if (await fn()) return true; await t.wait(500); } return false; };
const log = (...a) => console.log(...a);
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('nightfall.rpg.save')) localStorage.removeItem(k); });
await waitState('landing');
await t.wait(3000);
await enterRpg(t, { creator: 'keep' });
await page.evaluate(() => document.querySelector('.cr__begin').click());
await step(1);
// a road through the woods, at night
const at = await page.evaluate(async () => {
  const nf = window.nf, r = nf.rpg, g = r.gen;
  for (const [i, j, d] of [[1, 0, 0], [0, 1, 1], [1, 1, 0], [-1, 0, 0], [0, -1, 1]]) {
    const rd = g.road(i, j, d);
    if (!rd) continue;
    for (let k = 4; k < rd.pts.length / 2 - 4; k += 3) {
      const x = rd.pts[k * 2], z = rd.pts[k * 2 + 1];
      if (g.placeAt(x, z, 400)) continue;
      const yaw = Math.atan2(rd.pts[k * 2 + 2] - x, rd.pts[k * 2 + 3] - z);
      nf.player.place(x + Math.cos(yaw) * 6, g.height(x, z) + 0.4, z - Math.sin(yaw) * 6, yaw);
      nf.follow.yaw = yaw;
      await r.streamer.preload(nf.player.pos, () => {});
      r.atmos.minutes = 23.5 * 60;
      r.atmos.override = 'clear';
      return { x: Math.round(x), z: Math.round(z), biome: r.place.biome };
    }
  }
  return null;
});
log('at', JSON.stringify(at));
for (let i = 0; i < 20; i++) await step(1);
log('dread', await page.evaluate(() => window.nf.rpg.director.dread.toFixed(2)));
// the watcher
await page.evaluate(() => { const d = window.nf.rpg.director; d.dread = 0.9; d.spawnWatcher(window.nf.player.pos, window.nf.camera); });
for (let i = 0; i < 8; i++) await step(0.5);
const w = await page.evaluate(() => { const w = window.nf.rpg.director.watcher; return w && { ready: w.f.human.ready, d: Math.round(w.f.pos.distanceTo(window.nf.player.pos)) }; });
log('watcher', JSON.stringify(w));
await page.evaluate(() => { const nf = window.nf, w = nf.rpg.director.watcher; if (!w) return; const p = nf.player.pos, f = w.f.pos; const l = Math.hypot(f.x - p.x, f.z - p.z); nf.debugCam = { pos: f.clone().add({ x: (p.x - f.x) / l * 12, y: 1.6, z: (p.z - f.z) / l * 12 }), look: f.clone().add({ x: 0, y: 1.3, z: 0 }) }; });
await step(0.4);
await shot('rpg-dark-01-watcher');
await page.evaluate(() => { window.nf.debugCam = null; });
// by day: something by the road
await page.evaluate(() => { const r = window.nf.rpg; r.director.clear(); r.atmos.minutes = 10 * 60; });
await step(2);
const ev = await page.evaluate(() => { const d = window.nf.rpg.director; d.roadside(window.nf.player.pos, window.nf.camera); const e = d.events[d.events.length - 1]; return e && { kind: e.kind, d: Math.round(e.pos.distanceTo(window.nf.player.pos)) }; });
log('event', JSON.stringify(ev));
for (let i = 0; i < 8; i++) await step(0.5);
await page.evaluate(() => { const nf = window.nf, e = nf.rpg.director.events.at(-1); if (!e) return; const yaw = Math.atan2(e.pos.x - nf.player.pos.x, e.pos.z - nf.player.pos.z); nf.player.place(e.pos.x - Math.sin(yaw) * 1.6, e.pos.y + 0.4, e.pos.z - Math.cos(yaw) * 1.6, yaw); nf.follow.yaw = yaw; });
await step(0.6);
log('prompt', await page.evaluate(() => document.querySelector('[class*=prompt]')?.textContent));
await press('X');
await step(0.6);
log('talk', await page.evaluate(() => [window.nf.rpg.life.panel, document.querySelector('.talk__who')?.textContent, [...document.querySelectorAll('.talk__choice')].map((b) => b.textContent).join(' | ')]));
await shot('rpg-dark-02-roadside');
log('errors', JSON.stringify(errors));
await t.browser.close();
