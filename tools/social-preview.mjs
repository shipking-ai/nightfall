// The social preview (Open Graph / Twitter card, and GitHub's repository preview): a real frame of the
// city from the title camera, with the title set over it in the game's own type. 1200 × 630.
// Needs the dev server: `npm run dev`, then `node tools/social-preview.mjs`.
import { launch } from './playtest/lib.mjs';
import { copyFileSync } from 'node:fs';
const t = await launch({ pad: null, w: 1200, h: 630 });
const { page, waitState, step } = t;
await waitState('landing');
await t.wait(4000);
await page.addStyleTag({ content: '#ui { display: none !important; }' });
await page.evaluate(() => {
  const nf = window.nf;
  nf.cine.hold(0);
  nf.cine.t = nf.cine.shot.duration * 0.55;
  nf.cine.update(0, nf.t);
  nf.lighting.focusNow(nf.camera.position);
});
await step(0.5);
await page.evaluate(() => {
  const card = document.createElement('div');
  card.innerHTML = `
    <div class="og__shade"></div>
    <div class="og__top">District 03 — File no. 0317</div>
    <div class="og__main">
      <h1>NIGHTFALL</h1>
      <p class="og__tag">The city remembers what people forget.</p>
      <div class="og__rule"></div>
      <p class="og__modes"><span>City</span><i>·</i><span>After Hours</span><i>·</i><span>Warzone</span><i>·</i><span>Fight</span></p>
    </div>
    <div class="og__foot"><span>Play free in your browser</span><b>nightfall-sand.vercel.app</b><span class="og__pad">Controller ready</span></div>`;
  card.className = 'og';
  const css = document.createElement('style');
  css.textContent = `
    .og { position: fixed; inset: 0; z-index: 99; color: #efe9dd; font-family: 'IBM Plex Sans', sans-serif; }
    .og__shade { position: absolute; inset: 0;
      background: linear-gradient(90deg, rgba(7,8,9,.92) 0%, rgba(7,8,9,.78) 34%, rgba(7,8,9,.25) 62%, rgba(7,8,9,0) 78%),
                  linear-gradient(0deg, rgba(7,8,9,.75) 0%, rgba(7,8,9,0) 30%); }
    .og__top { position: absolute; left: 64px; top: 52px; font: 500 13px 'IBM Plex Mono', monospace; letter-spacing: .32em; text-transform: uppercase; color: #a4a6a4; }
    .og__main { position: absolute; left: 60px; top: 150px; }
    .og h1 { margin: 0; font: 400 132px/0.9 'Instrument Serif', Georgia, serif; letter-spacing: .05em; color: #f2ece0; text-shadow: 0 4px 40px rgba(0,0,0,.6); }
    .og__tag { margin: 18px 0 0 4px; font: italic 400 36px/1.1 'Instrument Serif', Georgia, serif; color: #cfc8ba; }
    .og__rule { margin: 30px 0 22px 4px; width: 120px; height: 2px; background: #c8a064; }
    .og__modes { margin: 0 0 0 4px; font: 500 17px 'IBM Plex Mono', monospace; letter-spacing: .26em; text-transform: uppercase; color: #e2c38f; display: flex; gap: 14px; }
    .og__modes i { font-style: normal; color: #7c705c; }
    .og__foot { position: absolute; left: 64px; right: 64px; bottom: 44px; display: flex; gap: 22px; align-items: baseline; font: 400 14px 'IBM Plex Mono', monospace; letter-spacing: .14em; color: #a4a6a4; }
    .og__foot b { font-weight: 500; color: #efe9dd; }
    .og__pad { margin-left: auto; padding: 5px 10px; border: 1px solid rgba(233,229,220,.35); color: #efe9dd; }`;
  document.head.append(css);
  document.body.append(card);
});
await page.evaluate(() => document.fonts.ready);
await t.wait(800);
await page.screenshot({ path: 'public/og.jpg', type: 'jpeg', quality: 88, timeout: 240000 });
copyFileSync('public/og.jpg', 'docs/media/social-preview.jpg');
console.log('written public/og.jpg and docs/media/social-preview.jpg', t.errors);
await t.browser.close();
