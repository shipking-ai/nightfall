// AFTER HOURS with a controller: the pause menu's weather and clock, quick chat on the wheel,
// headphones, a photograph, and that photograph in the Archive.
import { launch } from './lib.mjs';
const t = await launch({ pad: process.env.PAD ?? 'xbox' });
const { page, shot, hold, stick, step, press, waitState, state, errors, focused } = t;
await waitState('landing');
await t.wait(3000);
await page.evaluate(() => { window.nf.mode = 'afterhours'; window.nf.enter(); });
console.log('state', await waitState('playing', 200));
await step(1);
await shot('ah-01-street');
// pause: the switches
await press('Menu'); await step(0.4);
await t.wait(600);
const items = await page.evaluate(() => [...document.querySelectorAll('.pause__item')].filter((b) => b.offsetParent).map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
console.log('pause', items);
// down to Weather (after Settings): Resume, Map, Archive, Wardrobe, Settings, Weather
for (let i = 0; i < 5; i++) await press('Down');
console.log('focus', await focused());
await press('A'); await press('A'); await press('A');
await press('Down'); await press('A');
await t.wait(400);
await shot('ah-02-pause-switches');
console.log('switches', await page.evaluate(() => [...document.querySelectorAll('.pause__item--switch')].map((b) => b.textContent.replace(/\s+/g, ' ').trim())), 'rain', await page.evaluate(() => window.nf.time.rainOverride), 'held', await page.evaluate(() => window.nf.clockHeld));
await press('B'); await step(0.5);
// quick chat: the wheel, to the last page, point up (Hello)
await hold('Down', true); await step(0.3);
await press('LB'); await step(0.2);
await stick(1, 0, -1); await step(0.3);
await shot('ah-03-quick-chat');
await hold('Down', false); await stick(1, 0, 0); await step(0.6);
console.log('emote', await page.evaluate(() => window.nf.player.emote?.id ?? null), 'chat', await page.evaluate(() => document.querySelector('.chat')?.textContent?.slice(-60) ?? ''));
// headphones
await press('Right'); await step(0.5);
console.log('headphones', await page.evaluate(() => ({ host: !!window.nf.radioHost, car: !!window.nf.radioHost?.car, station: window.nf.radio.station?.name ?? null })));
// a photograph
await press('Up'); await step(0.5);
await press('RB'); await step(0.3);
await shot('ah-05-photo-mode');
await press('A'); await step(0.5);
await press('B'); await step(0.5);
await t.wait(1500);
console.log('photos', await page.evaluate(() => window.nf.myPhotos.length));
// the Archive: to the last tab
page.evaluate(() => window.nf.realtime());
await page.evaluate(() => window.nf.openOverlay('archive', 'playing'));
await t.wait(2500);
await t.tap('LB');
await t.wait(2000);
await shot('ah-04-archive-yours');
console.log('archive tab', await page.evaluate(() => document.querySelector('.archive__cat.is-active')?.textContent));
console.log('state', await state(), 'errors', errors);
await t.browser.close();
