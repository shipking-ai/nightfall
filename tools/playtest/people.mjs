// Dev: photograph the RPG people (dev/human.html) — full line-up, a face, walking.
import { launch, OUT } from './lib.mjs';
const shots = (process.env.SHOTS_LIST ?? 'full,face,walk').split(',');
for (const s of shots) {
  const t = await launch({ pad: null, w: 1280, h: 720, url: `http://localhost:5317/dev/human.html?shot=${s}&seed=${process.env.SEED ?? 1}&n=${s === 'face' ? 1 : 4}${process.env.HAIR ? '&hair=' + process.env.HAIR : ''}${process.env.VIEW ? '&view=' + process.env.VIEW : ''}` });
  for (let i = 0; i < 240; i++) {
    if (await t.page.evaluate(() => window.ready?.()).catch(() => false)) break;
    await t.wait(500);
  }
  await t.wait(2500);
  await t.shot(`people-${s}${process.env.SEED ? '-' + process.env.SEED : ''}${process.env.TAG ? '-' + process.env.TAG : ''}`);
  console.log(s, 'errors', t.errors);
  await t.browser.close();
}
