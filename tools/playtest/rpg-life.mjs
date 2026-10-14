// RPG R3: the mirror, the Casefile, the story's first steps, talking, a shop, a bed, save and load.
import { launch } from './lib.mjs';
const t = await launch({ pad: 'xbox' });
const { page, shot, tap, waitState, focused, errors, step, press } = t;
const until = async (fn, secs = 60) => { for (let i = 0; i < secs * 2; i++) { if (await fn()) return true; await t.wait(500); } return false; };
const log = (...a) => console.log(...a);

async function enterRpg() {
  await waitState('landing');
  await t.wait(3000);
  // straight into the RPG (the menus have their own run in modes.mjs)
  await page.evaluate(() => { window.nf.mode = 'rpg'; window.nf.enter(); });
  await until(async () => (await page.evaluate(() => window.nf.state)) === 'playing' || (await page.evaluate(() => window.nf.state)) === 'overlay', 240);
}

await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('nightfall.rpg.save')) localStorage.removeItem(k); });
await enterRpg();
await t.wait(2500);
log('panel', await page.evaluate(() => window.nf.rpg.life.panel));
await until(() => page.evaluate(() => window.nf.player.real?.ready), 60);
await step(1);
await shot('rpg-life-01-creator');
// a pad: move down into the backgrounds and pick one
for (let i = 0; i < 3; i++) await press('Down');
await press('A');
log('focus after pad', await focused());
await page.evaluate(() => document.querySelector('.cr__begin').click());
await step(1);
const st = await page.evaluate(() => { const g = window.nf.rpg.life.game; return g && { name: g.c.name, bg: g.c.background, quests: g.s.quests.map((q) => q.title), track: g.s.track, inv: g.s.inv.map((s) => s.name ?? s.id), money: g.c.money }; });
log('state', JSON.stringify(st));
await step(2);
await shot('rpg-life-02-start');

// the Casefile, with the View button; RB flips tabs
await press('View');
await step(0.5);
log('casefile', await page.evaluate(() => window.nf.rpg.life.panel));
await shot('rpg-life-03-case');
await press('RB'); await step(0.3);
await shot('rpg-life-04-you');
await press('RB'); await step(0.3);
await shot('rpg-life-05-pockets');
await press('B'); await step(0.3);
log('closed', await page.evaluate(() => [window.nf.rpg.life.panel, window.nf.state]));

// to the first town (the letter says so)
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
await step(3);
log('town', town, 'stage', await page.evaluate(() => window.nf.rpg.life.game.s.quests[0].data.stage));

// someone to talk to
let talked = false;
for (let k = 0; k < 6 && !talked; k++) {
  const who = await page.evaluate(() => {
    const nf = window.nf, pop = nf.rpg.populace, p = nf.player.pos;
    const ws = [...pop.walkers.values()].filter((w) => w.human.ready).sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p));
    const w = ws[0];
    if (!w) return null;
    const yaw = Math.atan2(w.pos.x - p.x, w.pos.z - p.z);
    nf.player.place(w.pos.x - Math.sin(yaw) * 1.4, w.pos.y + 0.2, w.pos.z - Math.cos(yaw) * 1.4, yaw);
    nf.follow.yaw = yaw;
    return w.r.name;
  });
  await step(0.4);
  const prompt = await page.evaluate(() => document.querySelector('.hud-prompt, [class*=prompt]')?.textContent);
  log('near', who, 'prompt', prompt);
  if (prompt?.includes('Talk')) {
    await press('X');
    await step(0.6);
    talked = (await page.evaluate(() => window.nf.rpg.life.panel)) === 'talk';
  } else await step(2);
}
log('talk open', talked);
await shot('rpg-life-06-talk');
if (talked) {
  const opts = await page.evaluate(() => [...document.querySelectorAll('.talk__choice')].map((b) => b.textContent));
  log('choices', JSON.stringify(opts));
  await page.evaluate(() => [...document.querySelectorAll('.talk__choice')].find((b) => /ferryman/.test(b.textContent))?.click());
  await step(0.5);
  await shot('rpg-life-07-ferryman');
  log('after', await page.evaluate(() => [...document.querySelectorAll('.talk__line')].map((l) => l.textContent).join(' | ')));
  log('stage', await page.evaluate(() => window.nf.rpg.life.game.s.quests[0].data.stage));
  await page.evaluate(() => [...document.querySelectorAll('.talk__choice')].find((b) => /Goodbye|Leave/.test(b.textContent))?.click());
  await step(0.3);
}

// doors: a diner, a store, a room for the night
const door = async (kind) => page.evaluate(async (kind) => {
  const nf = window.nf, life = nf.rpg.life;
  const P = window.nf.rpgMain(life.world);
  const poi = nf.rpg.streamer.towns.plan(P.first).pois.find((p) => p.kind === kind);
  if (!poi) return null;
  nf.player.place(poi.x + Math.sin(poi.yaw) * 1.3, poi.y + 0.3, poi.z + Math.cos(poi.yaw) * 1.3, poi.yaw + Math.PI);
  nf.follow.yaw = poi.yaw + Math.PI;
  await nf.rpg.streamer.preload(nf.player.pos, () => {});
  return poi.name;
}, kind);
await page.evaluate(() => (window.nf.rpg.life.game.c.money += 120));
for (const kind of ['diner', 'store', 'motel', 'hotel']) {
  const name = await door(kind);
  if (!name) { log(kind, 'none here'); continue; }
  await step(0.6);
  await press('X');
  await step(0.6);
  const open = await page.evaluate(() => window.nf.rpg.life.panel);
  const opts = await page.evaluate(() => [...document.querySelectorAll('.talk__choice')].map((b) => b.textContent));
  log(kind, name, open, JSON.stringify(opts));
  if (kind === 'diner') {
    await shot('rpg-life-08-diner');
    const fed = await page.evaluate(() => window.nf.rpg.life.game.c.fed);
    await page.evaluate(() => [...document.querySelectorAll('.talk__choice')].find((b) => /hot meal/.test(b.textContent))?.click());
    await step(0.3);
    log('fed', Math.round(fed), '→', Math.round(await page.evaluate(() => window.nf.rpg.life.game.c.fed)));
    await page.evaluate(() => [...document.querySelectorAll('.talk__choice')].find((b) => /Goodbye/.test(b.textContent))?.click());
  }
  if (kind === 'store') {
    await page.evaluate(() => [...document.querySelectorAll('.talk__choice')].find((b) => /trade/.test(b.textContent))?.click());
    await step(0.5);
    log('shop', await page.evaluate(() => window.nf.rpg.life.panel));
    const m0 = await page.evaluate(() => window.nf.rpg.life.game.c.money);
    await page.evaluate(() => document.querySelector('.shop__line:not([disabled])')?.click());
    await step(0.3);
    log('money', m0, '→', await page.evaluate(() => window.nf.rpg.life.game.c.money));
    await shot('rpg-life-09-shop');
    await press('B');
    await step(0.3);
  }
  if (kind === 'motel' || kind === 'hotel') {
    const before = await page.evaluate(() => window.nf.rpg.atmos.label);
    await page.evaluate(() => [...document.querySelectorAll('.talk__choice')].find((b) => /A room/.test(b.textContent))?.click());
    // lying down plays out in real time before the night passes
    await t.wait(4000);
    for (let i = 0; i < 12; i++) await step(0.5);
    log('slept', before, '→', await page.evaluate(() => window.nf.rpg.atmos.label), 'auto', await page.evaluate(() => !!localStorage.getItem('nightfall.rpg.save.auto')));
    break;
  }
}
await shot('rpg-life-10-after');
// save by hand, then a fresh page should put you back here
const saved = await page.evaluate(() => { const nf = window.nf; nf.rpg.life.save('1'); return { x: Math.round(nf.player.pos.x), z: Math.round(nf.player.pos.z) }; });
log('saved at', JSON.stringify(saved), 'errors so far', errors.length);
await page.reload({ waitUntil: 'load' });
log('after reload saves', await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('rpg'))));
await enterRpg();
log('state after enter', await page.evaluate(() => window.nf.state), await focused());
await t.wait(2000);
const back = await page.evaluate(() => { const nf = window.nf; return { panel: nf.rpg.life.panel, x: Math.round(nf.player.pos.x), z: Math.round(nf.player.pos.z), name: nf.rpg.life.game?.c.name, stage: nf.rpg.life.game?.s.quests[0]?.data.stage }; });
log('reloaded', JSON.stringify(back));
await shot('rpg-life-11-reloaded');
log('errors', JSON.stringify(errors));
await t.browser.close();
