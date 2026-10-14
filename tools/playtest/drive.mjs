// Vehicles: get in (door, seat), drive (throttle, steer, brake, handbrake), every camera view,
// a crash (dents, damage), get out. Measures speed and rpm so a regression shows as numbers.
import { launch } from './lib.mjs';
const t = await launch({ pad: 'xbox' });
const { page, shot, step, press, hold, stick, waitState } = t;
await waitState('landing'); await t.wait(4000);
await page.evaluate(() => { window.nf.mode = 'city'; window.nf.enter(); });
await waitState('playing', 200); await step(1);
await page.evaluate(() => { const nf = window.nf; nf.player.place(-5.2, 0.15, 22, -Math.PI / 2); nf.follow.snap(nf.player, nf.world.collision); });
await step(1);
await hold('X', true); await step(0.3); await hold('X', false);
// the door opens while getting in
let doorSeen = 0;
for (let i = 0; i < 12; i++) { await step(0.1); doorSeen = Math.max(doorSeen, await page.evaluate(() => { const c = window.nf.vehicles.cars.find((c) => c.doorWant[0] > 0 || (c.model?.doors[0]?.open ?? 0) > 0.05); return c ? c.model.doors[0].open : 0; })); if (i === 5) await shot('drive-door'); }
await step(1.5);
const info = () => page.evaluate(() => { const v = window.nf.vehicle; if (!v) return null; const c = v.car, d = c.dyn; return { cls: c.spec.cls, kmh: +(c.v * 3.6).toFixed(1), rpm: Math.round(d.rpm), gear: d.gear, roll: +(d.roll * 57.3).toFixed(1), pitch: +(d.pitch * 57.3).toFixed(1), slip: +Math.max(...d.wheels.map((w) => w.slip)).toFixed(2), dmg: +c.damage.total.toFixed(2) }; });
// out onto an open stretch of road (a traffic lane), pointing along it
await page.evaluate(() => { const nf = window.nf; const c = nf.vehicle.car; const tc = nf.traffic.cars.find((x) => x.path) ?? nf.traffic.cars[0]; const p = tc.group.position; c.dyn.place(p.x - Math.sin(tc.yaw) * 30, 0, p.z - Math.cos(tc.yaw) * 30, tc.yaw); c.pos.set(c.dyn.x, 0, c.dyn.z); c.yaw = tc.yaw; });
await step(0.5);
console.log('in', JSON.stringify(await info()), 'door opened to', doorSeen.toFixed(2));
// accelerate
await hold('RT', true);
for (let i = 0; i < 6; i++) { await step(0.5); console.log('accel', JSON.stringify(await info())); }
await shot('drive-chase');
// steer while on the throttle
await stick(0, 0.8, 0);
await step(1.2); console.log('turning', JSON.stringify(await info())); await shot('drive-turn');
await stick(0, 0, 0);
await hold('RT', false);
// each camera view
for (let v = 1; v < 6; v++) { await press('Down'); await step(0.6); await shot(`drive-view${v}`); }
await press('Down'); await step(0.2);
// brake hard
await hold('LT', true); await step(0.6); console.log('braking', JSON.stringify(await info())); await shot('drive-brake'); await step(1.5); await hold('LT', false);
// a crash: full throttle into whatever's ahead
await hold('RT', true); await step(4); await hold('RT', false); await step(1);
console.log('after run', JSON.stringify(await info()));
const dents = await page.evaluate(() => window.nf.vehicle?.car.model.wear.dents.filter((d) => d.w > 0).map((d) => d.toArray().map((x) => +x.toFixed(2))) ?? -1);
console.log('dents', JSON.stringify(dents));
await page.evaluate(() => { const c = window.nf.vehicle.car.pos; window.nf.debugCam = { pos: c.clone().add({ x: 4.5, y: 2, z: 3 }), look: c.clone().add({ x: 0, y: 0.7, z: 0 }) }; });
await step(0.2); await shot('drive-outside');
await page.evaluate(() => { window.nf.debugCam = null; });
// out
await press('B'); await step(2.5);
console.log('out', await page.evaluate(() => { const v = window.nf.vehicle; return v ? { leaving: v.car.leaving, v: v.car.v, gear: v.car.dyn.gear } : true; }));
await shot('drive-out');
console.log('errors', t.errors); await t.browser.close();
