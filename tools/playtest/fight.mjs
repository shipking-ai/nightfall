// FIGHT with a controller, on game time: the intro, a round against the CPU (strings, a launcher,
// blocking, a throw), a KO, the final round's finisher, the match menu, and a second pad joining.
import { launch } from './lib.mjs';
const t = await launch({ pad: process.env.PAD ?? 'xbox' });
const { page, shot, hold, stick, step, press, waitState, state, errors } = t;
const snap = () => page.evaluate(() => window.nf.fight.snapshot);
const log = async (label) => console.log(label, JSON.stringify(await snap()));

await waitState('landing');
await t.wait(3000);
await page.evaluate(() => { window.nf.mode = 'fight'; window.nf.enter(); });
console.log('state', await waitState('playing', 200));
await step(0.6);
await shot('fight-01-intro');
await step(2.2);
await shot('fight-02-round');
await step(1.2);
await log('fight begins');

// walk in and throw the light string
await stick(0, 1, 0); await step(0.5); await stick(0, 0, 0);
await press('X', 0.06); await step(0.12);
await shot('fight-03-jab');
await press('X', 0.06); await press('X', 0.06); await step(0.2);
await shot('fight-04-string');
await log('after string');
// launcher (up + heavy) and follow up in the air
await stick(0, 0, -1); await press('Y', 0.06); await stick(0, 0, 0); await step(0.18);
await shot('fight-05-launcher');
await press('A', 0.06); await step(0.15); await press('X', 0.06); await step(0.1);
await shot('fight-06-air');
await step(1.5);
await log('after launcher');
// block for a while as the CPU comes in
await hold('LB', true); await step(1.4);
await shot('fight-07-block');
await hold('LB', false);
// a throw
await stick(0, 1, 0); await step(0.4); await stick(0, 0, 0);
await press('RB', 0.06); await step(0.5);
await shot('fight-08-throw');
await step(1.2);
await log('after throw');
// let the CPU have a go for a few seconds (we just block and jab back)
for (let i = 0; i < 6; i++) {
  await hold('LB', true); await step(0.5); await hold('LB', false);
  await press('X', 0.06); await press('X', 0.06); await step(0.3);
}
await shot('fight-09-exchange');
await log('exchange');

// finish round 1 quickly: the CPU on its last legs, one jab
await page.evaluate(() => { const b = window.nf.fight.fighters[1]; b.hp = 0; });
await step(0.1);
await step(0.4);
await shot('fight-10-ko');
await log('ko');
await step(5);
await log('round 2');
await shot('fight-11-round2');
// round 2: straight to the final blow → the finish
await step(1.6);
await page.evaluate(() => { const [a, b] = window.nf.fight.fighters; b.pos.x = a.pos.x + 1.6; b.hp = 0; });
await step(0.1);
await step(0.6);
await log('finish?');
await shot('fight-12-finish-it');
await stick(0, 1, 0); await step(0.4); await stick(0, 0, 0);
await press('RT', 0.06); await step(0.5);
await shot('fight-13-finisher');
console.log('prompt', await page.evaluate(() => document.querySelector('.fprompt').className));
await step(1.2);
await shot('fight-14-finisher-2');
await step(5);
await log('over');
await t.wait(1200);
await shot('fight-15-match-over');
console.log('focus', await t.focused());
await press('Down'); await press('A'); await step(0.2);
console.log('focus after level', await t.focused());
// a rematch, and a second controller joins it
await press('Up'); await press('A'); await step(1);
await log('rematch');
await page.evaluate(() => window.__addPad('playstation'));
await step(0.3);
await hold('A', true, 1); await step(1.1); await hold('A', false, 1);
await step(2);
await log('p2 joined?');
// player two walks in and jabs; player one blocks
await stick(0, -1, 0, 1); await step(0.8); await stick(0, 0, 0, 1);
await hold('LB', true, 0);
await press('X', 0.06, 1); await step(0.3);
await shot('fight-16-versus');
await hold('LB', false, 0);
await log('versus');
console.log('state', await state(), 'errors', errors);
await t.browser.close();
