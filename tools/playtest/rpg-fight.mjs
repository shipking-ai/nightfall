// RPG R4c: violence in town — a fall, witnesses, a price on your head, the Watch.
import { launch, enterRpg } from './lib.mjs';
const t = await launch({ pad: 'xbox' });
const { page, shot, tap, waitState, focused, errors, step } = t;
const until = async (fn, secs = 60) => { for (let i = 0; i < secs * 2; i++) { if (await fn()) return true; await t.wait(500); } return false; };
const log = (...a) => console.log(...a);
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('nightfall.rpg.save')) localStorage.removeItem(k); });
await waitState('landing');
await t.wait(3000);
await enterRpg(t, { creator: 'keep' });
await page.evaluate(() => { [...document.querySelectorAll('.cr__bg')].find((b) => /Bruiser/.test(b.textContent))?.click(); document.querySelector('.cr__begin').click(); });
await step(1);
// the first town at midday
const town = await page.evaluate(async () => {
  const nf = window.nf, life = nf.rpg.life;
  const P = window.nf.rpgMain(life.world);
  const plan = nf.rpg.streamer.towns.plan(P.first);
  const w = plan.walk.slice().sort((a, b) => Math.hypot(a.x - P.first.x, a.z - P.first.z) - Math.hypot(b.x - P.first.x, b.z - P.first.z))[0];
  nf.player.place(w.x, w.y + 0.3, w.z, 0);
  await nf.rpg.streamer.preload(nf.player.pos, () => {});
  nf.rpg.atmos.minutes = 13 * 60;
  return P.first.name;
});
for (let i = 0; i < 40; i++) {
  await step(0.5);
  if (await page.evaluate(() => [...window.nf.rpg.populace.walkers.values()].filter((w) => w.human.ready).length >= 3)) break;
  await t.wait(500);
}
const who = await page.evaluate(() => {
  const nf = window.nf, pop = nf.rpg.populace, p = nf.player.pos;
  const ws = [...pop.walkers.values()].filter((w) => w.human.ready && w.r.job !== 'police').sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p));
  const w = ws[0];
  if (!w) return null;
  const yaw = Math.atan2(w.pos.x - p.x, w.pos.z - p.z);
  nf.player.place(w.pos.x - Math.sin(yaw) * 1.1, w.pos.y + 0.2, w.pos.z - Math.cos(yaw) * 1.1, yaw);
  window.__w = w;
  // a bystander, close enough to see it all
  const b = ws[1];
  if (b) b.pos.set(w.pos.x + 6, b.pos.y, w.pos.z + 3);
  return { name: w.r.name, job: w.r.job, around: ws.length, bystander: b?.r.name };
});
log('town', town, 'victim', JSON.stringify(who));
await step(0.3);
// the fight (punches through the real hit test)
const fight = await page.evaluate(() => {
  const nf = window.nf, w = window.__w, p = nf.player.pos;
  const log = [];
  const b = [...nf.rpg.populace.walkers.values()].find((x) => x !== w && x.dead < 0);
  if (b) b.pos.set(w.pos.x + 6, b.pos.y, w.pos.z + 3);
  for (let i = 0; i < 12 && w.dead < 0; i++) {
    const o = p.clone().add({ x: 0, y: 1.3, z: 0 });
    const dir = w.pos.clone().add({ x: 0, y: 1.2, z: 0 }).sub(o).normalize();
    const hit = nf.rpg.hitTest(o, dir, 2.2);
    if (!hit) { log.push('miss'); continue; }
    log.push(hit.apply(nf.rpg.life.weapon().dmg) ? 'down' : `hp ${Math.round(w.hp)}`);
  }
  const g = nf.rpg.life.game;
  return { log: log.join(','), gone: g.s.mem.gone.length, bounty: JSON.stringify(g.s.mem.bounty), watch: Math.round(g.s.rep.watch) };
});
log('fight', JSON.stringify(fight));
await step(1.5);
await page.evaluate(() => { const nf = window.nf, w = window.__w; nf.debugCam = { pos: w.pos.clone().add({ x: 2.4, y: 1.6, z: 2.4 }), look: w.pos.clone().add({ x: 0, y: 0.4, z: 0 }) }; });
await step(0.3);
await shot('rpg-fight-01-down');
await page.evaluate(() => { window.nf.debugCam = null; });
// the Watch: an officer who knows your face
const cop = await page.evaluate(() => {
  const nf = window.nf, pop = nf.rpg.populace, p = nf.player.pos;
  const ws = [...pop.walkers.values()].filter((w) => w.dead < 0 && w.human.ready);
  const c = ws.find((w) => w.r.job === 'police') ?? ws[0];
  if (!c) return null;
  c.r.job = 'police';
  c.pos.set(p.x + 12, c.pos.y, p.z + 4);
  c.chase = true;
  return c.r.name;
});
log('officer', cop, 'money', await page.evaluate(() => window.nf.rpg.life.game.c.money));
for (let i = 0; i < 10; i++) await step(0.6);
await t.wait(3000);
for (let i = 0; i < 4; i++) await step(0.5);
log('after', JSON.stringify(await page.evaluate(() => { const g = window.nf.rpg.life.game; return { bounty: g.s.mem.bounty, money: g.c.money, clock: window.nf.rpg.atmos.label, guns: g.count('knuckles') }; })));
await shot('rpg-fight-02-after');
log('errors', JSON.stringify(errors));
await t.browser.close();
