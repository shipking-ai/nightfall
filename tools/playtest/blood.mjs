// Blood: a gunshot (entry mist, exit spray onto a wall), a blow, a cut, a vehicle strike, a pool
// spreading, footprints through it, and rain washing it out. Screenshots up close.
import { launch } from './lib.mjs';
const t = await launch({ pad: 'xbox' });
const { page, shot, step, waitState } = t;
await waitState('landing'); await t.wait(4000);
await page.evaluate(() => { window.nf.mode = 'city'; window.nf.enter(); });
await waitState('playing', 200); await step(1);
await page.evaluate(() => { const nf = window.nf; nf.player.place(-5.2, 0.15, 22, Math.PI / 2); nf.follow.snap(nf.player, nf.world.collision); });
await step(0.5);
const setCam = (dx, dy, dz, lx, ly, lz) => page.evaluate(([dx, dy, dz, lx, ly, lz]) => { const p = window.nf.player.pos; window.nf.debugCam = { pos: p.clone().add({ x: dx, y: dy, z: dz }), look: p.clone().add({ x: lx, y: ly, z: lz }) }; }, [dx, dy, dz, lx, ly, lz]);
const spray = (kind, amount, x, y, z, dx, dy, dz) => page.evaluate(([kind, amount, x, y, z, dx, dy, dz]) => { const nf = window.nf, p = nf.player.pos; nf.blood.spray(p.clone().add({ x, y, z }), { x: dx, y: dy, z: dz, clone() { return this; } }, amount, kind); }, [kind, amount, x, y, z, dx, dy, dz]);
await setCam(0, 1.6, -2.8, 1.6, 0.8, 0.5);
for (const [kind, x] of [['bullet', 0.6], ['blunt', 1.4], ['cut', 2.2], ['vehicle', 3.0]]) await spray(kind, 1, x, 1.2, 0.3, 0.3, 0.05, 0.95);
await step(0.05); await shot('blood-0-flight');
await step(1.2); await shot('blood-1-landed');
await page.evaluate(() => { const nf = window.nf; nf.blood.pool(nf.player.pos.clone().add({ x: 1.8, y: 0, z: 1.4 }), 'test'); });
await step(8); await shot('blood-2-pool');
// walk through it: prints
await page.evaluate(() => { const nf = window.nf; nf.debugCam = null; nf.player.place(nf.player.pos.x + 1.8, 0.15, nf.player.pos.z + 1.4, Math.PI / 2); });
await t.hold('RT', false);
await t.stick(0, 0.9, 0); await step(2.5); await t.stick(0, 0, 0); await step(0.3);
await setCam(-1.5, 2.2, -2.2, 0.5, 0, 0.5);
await step(0.1); await shot('blood-3-prints');
console.log('errors', t.errors);
await t.browser.close();
