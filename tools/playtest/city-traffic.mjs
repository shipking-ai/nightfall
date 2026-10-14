// CITY: are there cars on every street? Sample which road each moving car is on, over a minute of game time,
// and what a frame costs with the whole pool out.
import { launch } from './lib.mjs';
const t = await launch({ pad: 'xbox' });
const { page, step, shot, waitState, errors } = t;
await waitState('landing');
await t.wait(3000);
await page.evaluate(() => { window.nf.mode = 'city'; window.nf.enter(); });
console.log('state', await waitState('playing', 200));
const seen = {};
let most = 0;
for (let i = 0; i < 12; i++) {
  await step(5);
  const r = await page.evaluate(() => {
    const roads = [
      ['Avenue N', -9, -34, 9, 164], ['Avenue S', -9, -124, 9, -46], ['Linden', -150, -46, 150, -34], ['Harbor', -150, 48, 150, 60], ['River', -150, 136, 150, 146],
    ];
    const cars = window.nf.traffic.cars.filter((c) => c.path && c.group.visible);
    const on = {};
    for (const c of cars) {
      const p = c.group.position;
      for (const [n, x0, z0, x1, z1] of roads) if (p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1) on[n] = (on[n] ?? 0) + 1;
    }
    return { active: cars.length, on };
  });
  most = Math.max(most, r.active);
  for (const [k, v] of Object.entries(r.on)) seen[k] = (seen[k] ?? 0) + v;
}
console.log('most cars out at once', most, 'car-samples per road', JSON.stringify(seen));
await page.evaluate(() => { const nf = window.nf; nf.player.place(-2, 0.15, -80, 0); nf.follow.yaw = 0; });
await step(3);
await shot('city-traffic-avenue-south');
const ms = await page.evaluate(() => { const t0 = performance.now(); window.nf.devStep(30); return +((performance.now() - t0) / 30).toFixed(1); });
console.log('ms per frame', ms, 'errors', errors);
await t.browser.close();
