// CITY: talking to someone with a controller. Walk up, X to talk, pick topics with the D-pad and A,
// threaten them, then B to leave.
import { launch } from './lib.mjs';
const t = await launch({ pad: process.env.PAD ?? 'xbox' });
const { page, shot, step, press, waitState, errors, focused } = t;
const ev = (fn, arg) => page.evaluate(fn, arg);
await waitState('landing');
await t.wait(3000);
await ev(() => { window.nf.mode = 'city'; window.nf.enter(); });
console.log('state', await waitState('playing', 200));
await step(2);
// stand in front of someone standing about (not a walker, not the watcher)
const who = await ev(() => {
  const nf = window.nf, c = nf.crowd;
  const n = c.npcs.find((x) => x.visible && x.dead < 0 && ['phone', 'look', 'smoke', 'wait'].includes(x.mode));
  const yaw = n.yaw;
  nf.player.place(n.pos.x + Math.sin(yaw) * 1.2, n.pos.y, n.pos.z + Math.cos(yaw) * 1.2, yaw + Math.PI);
  nf.follow.yaw = yaw + Math.PI;
  nf.save.data.cash = 50;
  return `${n.mode} ${n.arche}`;
});
console.log('talking to', who);
await step(0.6);
await press('X'); await t.wait(800); await step(0.3);
const card = () => ev(() => ({ open: document.querySelector('.talk')?.classList.contains('is-on'), who: document.querySelector('.talk__who')?.textContent, lines: [...document.querySelectorAll('.talk__line')].map((p) => p.textContent).join(' / ').slice(0, 160), choices: [...document.querySelectorAll('.talk__label')].map((b) => b.textContent).join(' | ') }));
console.log('open', JSON.stringify(await card()));
await shot('talk-01-greeting');
// Seen anything strange? (fourth)
for (let i = 0; i < 3; i++) { await press('Down'); await t.wait(300); }
console.log('focus', (await focused()).slice(-40));
await press('A'); await t.wait(800); await step(0.2);
console.log('strange', JSON.stringify(await card()));
await shot('talk-02-strange');
// for your trouble ($20): fifth
await ev(() => document.querySelectorAll('.talk__choice')[4].click()); await t.wait(600);
console.log('gave', JSON.stringify(await card()), 'cash', await ev(() => window.nf.save.data.cash));
// threaten: sixth
await ev(() => document.querySelectorAll('.talk__choice')[5].click()); await t.wait(600);
console.log('threat', JSON.stringify(await card()), 'cash', await ev(() => window.nf.save.data.cash), 'stars', await ev(() => window.nf.combat.stars));
await shot('talk-03-threat');
await press('A'); await t.wait(600); await step(0.2);
console.log('closed', JSON.stringify(await card()), 'busy', await ev(() => window.nf.player.busy));
console.log('errors', errors);
await t.browser.close();
