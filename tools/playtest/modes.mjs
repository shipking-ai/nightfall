// Every mode, from the title, with nothing but a controller: Enter → mode select → the mode → play a
// moment → pause → leave → back at the title. Real time throughout (as a person would play it).
import { launch } from './lib.mjs';
const t = await launch({ pad: process.env.PAD ?? 'xbox' });
const { page, shot, tap, waitState, focused, errors } = t;
const state = () => page.evaluate(() => window.nf.state);
const until = async (fn, secs = 60) => {
  for (let i = 0; i < secs * 2; i++) {
    if (await fn()) return true;
    await t.wait(500);
  }
  return false;
};
await waitState('landing');
await t.wait(5000);
for (const [id, title] of [['warzone', 'Warzone'], ['fight', 'Fight'], ['city', 'City'], ['afterhours', 'After Hours']]) {
  // the title: Enter (the first thing focused)
  await until(async () => (await focused()).includes('Enter'), 20);
  await tap('A');
  await until(() => page.evaluate(() => window.nf.modeSelect.isOpen), 20);
  await t.wait(1500);
  // the list runs top to bottom: Warzone, Fight, City, After Hours
  const order = ['Warzone', 'Fight', 'City', 'After Hours'];
  for (let i = 0; i < 8 && !(await focused()).toLowerCase().includes(title.toLowerCase()); i++) {
    const now = await focused();
    const cur = order.findIndex((o) => now.toLowerCase().includes(o.toLowerCase()));
    await tap(cur >= 0 && cur > order.indexOf(title) ? 'Up' : 'Down');
    await t.wait(900);
  }
  const f = await focused();
  await shot(`modes-select-${id}`);
  await tap('A');
  const ok = await until(async () => (await state()) === 'playing', 120);
  await t.wait(4000);
  const mode = await page.evaluate(() => window.nf.mode);
  await shot(`modes-play-${id}`);
  // pause and leave
  await tap('Menu');
  await t.wait(2500);
  for (let i = 0; i < 12 && !(await focused()).includes('Leave'); i++) {
    await tap('Down');
    await t.wait(500);
  }
  const leaving = await focused();
  await tap('A');
  const back = await until(async () => (await state()) === 'landing', 60);
  console.log(id, JSON.stringify({ focused: f.slice(0, 50), playing: ok, mode, leave: leaving.slice(-24), back }));
  await t.wait(3000);
}
console.log('errors', errors);
await t.browser.close();
