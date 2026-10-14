// RPG: enter with the pad, wait for your realistic body, look at it by day and at night.
import { launch } from './lib.mjs';
const t = await launch({ pad: 'xbox' });
const { page, shot, tap, waitState, focused, errors, step } = t;
const until = async (fn, secs = 60) => { for (let i = 0; i < secs * 2; i++) { if (await fn()) return true; await t.wait(500); } return false; };
await waitState('landing');
await t.wait(3000);
// straight into the RPG (the menus have their own run in modes.mjs)
await page.evaluate(() => { window.nf.mode = 'rpg'; window.nf.enter(); });
await until(async () => (await page.evaluate(() => window.nf.state)) === 'playing', 240);
const ready = await until(() => page.evaluate(() => !!window.nf.player.real?.ready), 120);
console.log('hero ready', ready);
for (const [name, hour, turn, dist] of [['hero-back-day', 11, 0, 0], ['hero-face-day', 11, Math.PI, 1], ['hero-face-night', 22.5, Math.PI, 1]]) {
  await page.evaluate(([hour, turn, dist]) => {
    const nf = window.nf;
    nf.rpg.atmos.minutes = hour * 60;
    nf.rpg.atmos.override = 'clear';
    nf.follow.yaw = nf.player.facing + turn;
    if (dist) nf.follow.dist = 2.2;
  }, [hour, turn, dist]);
  await step(1.5);
  await shot(`rpg-${name}`);
}
await page.evaluate(() => window.nf.realtime());
console.log('errors', errors);
await t.browser.close();
