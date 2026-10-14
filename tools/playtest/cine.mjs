// Cinematics: a scene blends in from play, frames people (establishing, push-in, close-up,
// over-the-shoulder, two-shot), brings in bars and depth of field, subtitles a line, and hands back.
import { launch } from './lib.mjs';
const t = await launch({ pad: 'xbox' });
const { page, shot, step, waitState } = t;
await waitState('landing'); await t.wait(4000);
await page.evaluate(() => { window.nf.mode = 'city'; window.nf.enter(); });
await waitState('playing', 200); await step(1);
await page.evaluate(() => { const nf = window.nf; nf.player.place(-5.2, 0.15, 22, Math.PI / 2); nf.follow.snap(nf.player, nf.world.collision); });
await step(1); await shot('cine-0-play');
// a scene with someone from the crowd: the nearest person to you
await page.evaluate(() => {
  const nf = window.nf, p = nf.player;
  const n = nf.crowd.npcs.filter((n) => n.visible && n.dead < 0).sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos))[0];
  const S = (pos, yaw, h) => ({ pos, yaw, head: () => pos().clone().setY(pos().y + h) });
  const me = S(() => p.pos, () => p.facing, 1.6), them = S(() => n.pos, () => n.yaw, 1.6 * n.body.height);
  window.__them = n;
  nf.scenes.play({
    shots: [
      { kind: 'establish', a: me, dur: 3, caption: 'Central Avenue' },
      { kind: 'pushIn', a: me, dur: 2.5, side: -1 },
      { kind: 'overShoulder', a: them, b: me, side: -1, dur: 2.5 },
      { kind: 'closeUp', a: me, dur: 2 },
      { kind: 'twoShot', a: them, b: me, dur: 2 },
    ],
    lines: [{ at: 5.6, dur: 2.4, who: 'Stranger', text: 'You shouldn’t be out this late.', face: n.motion.face }],
    beats: [{ at: 5.5, do: () => n.anim.play('emote.talk', { group: 'social' }) }],
  });
});
const at = [0.6, 2.4, 4.5, 6.4, 8.8, 11, 13.5];
let now = 0;
for (const [i, s] of at.entries()) {
  await step(s - now); now = s;
  const st = await page.evaluate(() => ({ active: window.nf.scenes.active, bars: +window.nf.scenes.bars.toFixed(2), dof: +window.nf.scenes.dofAperture.toFixed(2), line: window.nf.scenes.line?.text ?? '' }));
  console.log(s, JSON.stringify(st));
  await shot(`cine-${i + 1}`);
}
console.log('errors', t.errors);
await t.browser.close();
