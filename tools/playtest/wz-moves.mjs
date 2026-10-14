// WARZONE movement: tactical sprint (L3 again while sprinting), slide (B at a run), mantle (A at a waist-high ledge).
import { launch } from './lib.mjs';
const t = await launch({ pad: process.env.PAD ?? 'xbox' });
const { page, shot, step, press, hold, stick, waitState, errors } = t;
const ev = (fn, arg) => page.evaluate(fn, arg);
await waitState('landing');
await t.wait(3000);
await ev(() => { window.nf.mode = 'warzone'; window.nf.enter(); });
await waitState('playing', 200);
await ev(() => document.querySelector('.wzm-go').click());
await press('A'); await step(9);
const P = () => ev(() => { const p = window.nf.player; return { x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2), v: +Math.hypot(p.vel.x, p.vel.z).toFixed(2), sprint: p.sprinting, tac: +p.tacT.toFixed(2), slide: +p.slideT.toFixed(2), crouch: p.crouching }; });
// sprint, then sprint again: the burst
await stick(0, 0, -1); await hold('LS', true); await step(0.6);
console.log('sprinting', JSON.stringify(await P()));
await hold('LS', false); await step(0.05); await hold('LS', true); await step(0.5);
console.log('tactical', JSON.stringify(await P()));
await press('B'); await step(0.05);
console.log('slide start', JSON.stringify(await P()));
await step(0.1);
console.log('sliding', JSON.stringify(await P()));
await shot('wzmv-01-slide');
await hold('LS', false); await step(0.9); await stick(0, 0, 0); await step(0.3);
console.log('after slide', JSON.stringify(await P()));
// a ledge between knee and head height in the yard: stand in front of it and jump
const spot = await ev(() => {
  const c = window.nf.world.collision, p = window.nf.player;
  const b = c.boxes.find((k) => k.maxY > 0.7 && k.maxY < 2.15 && k.minY < 0.2 && k.minX > 42 && k.maxX < 100 && k.minZ > -26 && k.maxZ < 58 && k.maxX - k.minX > 0.6 && k.maxZ - k.minZ > 0.6);
  if (!b) return null;
  const cx = (b.minX + b.maxX) / 2;
  p.place(cx, 0, b.minZ - 0.6, 0);
  window.nf.follow.yaw = 0;
  return { top: b.maxY, x: cx, z: b.minZ };
});
console.log('ledge', JSON.stringify(spot), await ev(() => [...new Set(window.nf.world.collision.boxes.filter((k) => k.minX > 42 && k.maxX < 100 && k.minZ > -26 && k.maxZ < 58).map((k) => k.maxY.toFixed(1)))].join(' ')));
if (spot) {
  await step(0.3);
  await press('A'); await step(0.6);
  console.log('mantled', JSON.stringify(await P()));
  await shot('wzmv-02-mantle');
}
console.log('errors', errors);
await t.browser.close();
