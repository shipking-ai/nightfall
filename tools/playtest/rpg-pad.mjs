// R5: every RPG screen with only a controller. For each: is something focused (with the ring), do the
// d-pad, A, B and the shoulders do what they should, and can you always get back out.
import { launch, enterRpg } from './lib.mjs';
const t = await launch({ pad: 'xbox', w: 1280, h: 720 });
const { page, shot, tap, waitState, focused, errors, step, press } = t;
const until = async (fn, secs = 60) => { for (let i = 0; i < secs * 2; i++) { if (await fn()) return true; await t.wait(500); } return false; };
const log = (...a) => console.log(...a);
const problems = [];
const bad = (m) => { problems.push(m); log('  ✗', m); };
const ok = (m) => log('  ✓', m);
const panel = () => page.evaluate(() => window.nf.rpg.life.panel);
const ring = () => page.evaluate(() => { const a = document.activeElement; return !!a && a !== document.body && a.classList.contains('nav-focus'); });
const p = async (b, n = 1) => { for (let i = 0; i < n; i++) { await press(b, 0.2); await step(0.2); } };
/** press a direction until the focus matches (or give up) */
const seek = async (dir, re, max = 30) => {
  for (let i = 0; i < max; i++) {
    if (re.test(await focused())) return true;
    await p(dir);
  }
  return re.test(await focused());
};

await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('nightfall.rpg.save')) localStorage.removeItem(k); });
await waitState('landing');
await t.wait(3000);
await enterRpg(t, { creator: 'keep' });
await step(1);

// ── the mirror
log('creator');
log('  focus', await focused(), 'ring', await ring());
if (!(await ring())) bad('creator: nothing focused with the ring on arrival');
const f0 = await focused();
await p('Down', 2);
if ((await focused()) === f0) bad('creator: the d-pad does not move the focus');
else ok('creator: d-pad moves focus');
await shot('rpg-pad-01-creator');
if (await seek('Down', /Begin/i, 40)) {
  await p('A');
  await step(1);
  if ((await panel()) === 'creator') bad('creator: A on Begin did not start');
  else ok('creator: Begin with A');
} else bad('creator: could not reach Begin with the d-pad');
await step(2);

// ── the Casefile: View opens it (the map); RB walks the tabs
log('casefile');
await p('View');
await step(0.5);
if ((await panel()) !== 'casefile') bad('casefile: View did not open it');
const tabs = [];
for (let i = 0; i < 8; i++) {
  const info = await page.evaluate(() => {
    const tab = document.querySelector('.cf__tab.is-on')?.textContent;
    const a = document.activeElement;
    return { tab, focus: a ? `${a.tagName}.${a.className.split(' ')[0]}` : 'none', inBody: !!a && !!document.querySelector('.cf__body')?.contains(a) };
  });
  tabs.push(info);
  if (!info.inBody) bad(`casefile/${info.tab}: focus is not in the page (${info.focus})`);
  // the d-pad moves within the page (not on the map, where it pans)
  if (info.tab !== 'Map') {
    const before = await focused();
    await p('Down');
    const after = await focused();
    if (before === after && !/empty|Nowhere|Nobody/.test(await page.evaluate(() => document.querySelector('.cf__body')?.textContent ?? ''))) bad(`casefile/${info.tab}: d-pad Down did not move`);
  }
  await shot(`rpg-pad-02-cf-${(info.tab ?? 'x').toLowerCase()}`);
  await p('RB');
  await step(0.3);
}
log('  tabs', JSON.stringify(tabs.map((x) => `${x.tab}:${x.focus}`)));
// an item in the pockets: A opens it, B comes back
await page.evaluate(() => window.nf.rpg.life.cf.show('pockets'));
await step(0.3);
if (await seek('Down', /cf__item|Letter|letter/i, 6)) {
  await p('A');
  const detail = await page.evaluate(() => !!document.querySelector('.cf__detail, .cf__item-detail, [class*=detail]'));
  detail ? ok('pockets: A opens an item') : bad('pockets: A on an item shows nothing');
}
await p('B');
await step(0.3);
if ((await panel()) === 'casefile') await p('B');
await step(0.3);
(await panel()) ? bad(`casefile: B does not close it (${await panel()})`) : ok('casefile: B closes');

// ── someone to talk to (in the first town)
log('talk');
await page.evaluate(async () => {
  const nf = window.nf, life = nf.rpg.life;
  const P = nf.rpgMain(life.world);
  const plan = nf.rpg.streamer.towns.plan(P.first);
  const w = plan.walk.slice().sort((a, b) => Math.hypot(a.x - P.first.x, a.z - P.first.z) - Math.hypot(b.x - P.first.x, b.z - P.first.z))[0];
  nf.player.place(w.x, w.y + 0.3, w.z, 0);
  await nf.rpg.streamer.preload(nf.player.pos, () => {});
  nf.rpg.atmos.minutes = 13 * 60;
  life.game.c.money += 200;
});
await step(3);
let talked = false;
for (let k = 0; k < 8 && !talked; k++) {
  await page.evaluate(() => {
    const nf = window.nf, pop = nf.rpg.populace, pp = nf.player.pos;
    const w = [...pop.walkers.values()].filter((w) => w.human.ready).sort((a, b) => a.pos.distanceTo(pp) - b.pos.distanceTo(pp))[0];
    if (!w) return;
    const yaw = Math.atan2(w.pos.x - pp.x, w.pos.z - pp.z);
    nf.player.place(w.pos.x - Math.sin(yaw) * 1.3, w.pos.y + 0.2, w.pos.z - Math.cos(yaw) * 1.3, yaw);
    nf.follow.yaw = yaw;
  });
  await step(0.4);
  await p('X');
  await step(0.5);
  talked = (await panel()) === 'talk';
  if (!talked) await step(2);
}
if (!talked) bad('talk: X next to a resident never opened a conversation');
else {
  log('  focus', await focused(), 'ring', await ring());
  if (!(await ring())) bad('talk: no focused choice on arrival');
  await shot('rpg-pad-03-talk');
  const f1 = await focused();
  await p('Down');
  if ((await focused()) === f1) bad('talk: d-pad does not move between choices');
  await p('A');
  await step(0.4);
  log('  after A', (await panel()) ?? 'closed', await focused());
  for (let i = 0; i < 4 && (await panel()) === 'talk'; i++) await p('B');
  (await panel()) ? bad('talk: B does not get out') : ok('talk: B leaves');
}

// ── a shop counter
log('shop');
const poi = await page.evaluate(async () => {
  const nf = window.nf, life = nf.rpg.life;
  const P = nf.rpgMain(life.world);
  const d = nf.rpg.streamer.towns.plan(P.first).pois.find((q) => q.kind === 'store');
  if (!d) return null;
  nf.player.place(d.x + Math.sin(d.yaw) * 1.3, d.y + 0.3, d.z + Math.cos(d.yaw) * 1.3, d.yaw + Math.PI);
  nf.follow.yaw = d.yaw + Math.PI;
  await nf.rpg.streamer.preload(nf.player.pos, () => {});
  return d.name;
});
if (!poi) log('  (no store here)');
else {
  await step(0.6);
  await p('X');
  await step(0.5);
  if ((await panel()) !== 'talk') bad('shop: X at the door did not open the counter');
  else if (!(await seek('Down', /trade/i, 8))) bad('shop: could not reach "trade" with the d-pad');
  else {
    await p('A');
    await step(0.5);
    if ((await panel()) !== 'shop') bad('shop: A on trade did not open the shop');
    else {
      log('  focus', await focused(), 'ring', await ring());
      if (!(await ring())) bad('shop: nothing focused on arrival');
      const m0 = await page.evaluate(() => window.nf.rpg.life.game.c.money);
      await seek('Down', /shop__line/, 6);
      await p('A');
      await step(0.3);
      const m1 = await page.evaluate(() => window.nf.rpg.life.game.c.money);
      m1 < m0 ? ok(`shop: bought with A (${m0} → ${m1})`) : bad('shop: A on a line did not buy');
      const tab0 = await page.evaluate(() => document.querySelector('.shop [aria-selected=true], .shop .is-on')?.textContent);
      await p('RB');
      const tab1 = await page.evaluate(() => document.querySelector('.shop [aria-selected=true], .shop .is-on')?.textContent);
      log('  RB', tab0, '→', tab1);
      await shot('rpg-pad-04-shop');
      for (let i = 0; i < 3 && (await panel()); i++) await p('B');
      (await panel()) ? bad(`shop: B does not get out (${await panel()})`) : ok('shop: B leaves');
    }
  }
}

// ── the pause menu: Menu opens it, and the Archive there is the Casefile
log('pause');
await p('Menu');
await step(0.4);
const st = await page.evaluate(() => ({ state: window.nf.state, overlay: window.nf.overlay }));
log('  ', JSON.stringify(st), await focused());
if (st.overlay !== 'pause') bad('pause: Menu did not open the pause menu');
else {
  if (await seek('Down', /Archive/i, 10)) {
    await p('A');
    await step(0.4);
    (await panel()) === 'casefile' ? ok('pause: Archive opens the Casefile') : bad('pause: Archive did not open the Casefile');
    for (let i = 0; i < 3 && (await page.evaluate(() => window.nf.state)) === 'overlay'; i++) await p('B');
  } else bad('pause: no Archive entry reachable');
}
log('state at the end', await page.evaluate(() => `${window.nf.state}/${window.nf.rpg.life.panel}`));
log('problems', problems.length ? '\n  - ' + problems.join('\n  - ') : 'none');
log('errors', JSON.stringify(errors));
await t.browser.close();
