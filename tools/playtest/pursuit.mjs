// CITY: a car chase. Three stars, in a car, flat out east along Linden Street and on into the outskirts.
// Where does each unit come from (in front of you or behind)? Does it drive the streets to you, close in, hit you?
// STARS=7 for the military.
import { launch } from './lib.mjs';
const t = await launch({ pad: 'xbox' });
const { page, shot, step, press, hold, stick, waitState, errors } = t;
const ev = (fn, arg) => page.evaluate(fn, arg);
const stars = Number(process.env.STARS ?? 3);
await waitState('landing'); await t.wait(3000);
await ev(() => { window.nf.mode = 'city'; window.nf.enter(); });
await waitState('playing', 200);
await ev(() => { const nf = window.nf; nf.player.place(-5.2, 0.15, 22, -Math.PI / 2); nf.follow.yaw = -Math.PI / 2; });
await step(1.5);
await press('X'); await step(1.5);
console.log('in a car', await ev(() => window.nf.vehicle?.kind));
// onto Linden Street, heading east, then wanted
await ev(() => { const nf = window.nf, c = nf.vehicle.car; c.dyn.place(-120, 0.15, -38.5, Math.PI / 2); c.pos.set(-120, 0.15, -38.5); nf.follow.yaw = Math.PI / 2; });
await step(0.5);
await ev((s) => window.nf.combat.setHeat(s), stars);
await hold('RT', true, 0, 0.75);
let rams = 0;
await ev(() => { const nf = window.nf; nf.__rams = 0; const h = nf.police.hooks?.rammed; });
const spawnSeen = [];
for (let i = 0; i < 14; i++) {
  await step(1.5);
  // keep it straight along the road
  await ev(() => { const c = window.nf.vehicle?.car; if (c && Math.abs(c.pos.z + 38.5) > 2.5) c.dyn.z += (-38.5 - c.dyn.z) * 0.3; });
  const r = await ev(() => {
    const nf = window.nf, p = nf.player.pos, car = nf.vehicle?.car;
    const fwd = car ? [Math.sin(car.yaw), Math.cos(car.yaw)] : [1, 0];
    return {
      p: [Math.round(p.x), Math.round(p.z)], v: car ? +car.v.toFixed(1) : 0, hp: car ? +car.damage.total.toFixed(2) : 0, stars: nf.combat.stars,
      cops: nf.police.cars.filter((c) => c.state !== 'off').map((c) => {
        const dx = c.pos.x - p.x, dz = c.pos.z - p.z, d = Math.hypot(dx, dz);
        const ahead = (dx * fwd[0] + dz * fwd[1]) / (d || 1);
        return `${c.mil ? 'M' : 'P'}:${c.state}:${Math.round(d)}m:${ahead > 0.3 ? 'ahead' : ahead < -0.3 ? 'behind' : 'side'}:v${Math.round(c.v)}`;
      }).join(' '),
    };
  });
  console.log(i, JSON.stringify(r));
  if (i === 6 || i === 12) await shot(`pursuit-${i}`);
}
await hold('RT', false);
console.log('errors', errors);
await t.browser.close();
