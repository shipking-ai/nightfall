// Gait: foot slide, and a look at walking, running, stopping, turning and sidestepping.
// Loads dev/human.html?shot=gait (scripted route) and measures how far a planted ankle drifts.
import { launch, OUT } from './lib.mjs';
const MH = process.env.MH ?? '0';
const t = await launch({ pad: null, w: 900, h: 600, url: `http://localhost:5317/dev/human.html?shot=gait&n=3&mh=${MH}` });
const { page } = t;
for (let i = 0; i < 120 && !(await page.evaluate(() => window.ready?.()).catch(() => false)); i++) await t.wait(1000);
const shots = (process.env.AT ?? '4,8,10.5,13,15,18,21').split(',').map(Number);
const t0 = Date.now();
for (const s of shots) {
  while ((Date.now() - t0) / 1000 < s * (Number(process.env.SLOW ?? 1))) await t.wait(100);
  await t.shot(`gait-${String(s).replace('.', '_')}`);
}
const r = await page.evaluate(() => ({ worst: window.slide.worst, mean: window.slide.sum / Math.max(1, window.slide.n), n: window.slide.n }));
console.log('stance drift (m): worst', r.worst.toFixed(3), 'mean', r.mean.toFixed(3), 'stances', r.n);
console.log('errors', t.errors);
await t.browser.close();
if (t.errors.length || r.worst > 0.06) process.exit(1);
