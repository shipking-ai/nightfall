// WARZONE's gear and streaks with a controller: cook and throw a frag (RB), a flash (LB) that blinds a bot,
// smoke that blocks sight, then earned streaks (Down): recon, sentry, precision strike, drone. And the bots
// using theirs: grenades lobbed at where you were, cover, flanking.
import { launch } from './lib.mjs';
const t = await launch({ pad: process.env.PAD ?? 'xbox' });
const { page, shot, hold, step, press, waitState, errors } = t;
const ev = (fn, arg) => page.evaluate(fn, arg);
const me = () => ev(() => window.nf.warzone.snapshot.me);

await waitState('landing');
await t.wait(3000);
await ev(() => { window.nf.mode = 'warzone'; window.nf.enter(); });
console.log('state', await waitState('playing', 200));
await step(0.5);
await press('A'); await step(9); // deploy; let the opening scene hand back
console.log('deployed', JSON.stringify(await me()));
// a frag: hold RB to cook, let go to throw
await ev(() => { window.nf.follow.pitch = -0.25; });
await hold('RB', true); await step(1.2);
await shot('wzg-01-cooking');
await hold('RB', false); await step(0.3);
console.log('thrown', await ev(() => window.nf.warzone.gear.thrown.map((x) => `${x.kind}:${x.fuse.toFixed(2)}`).join(' ')));
await step(1.7);
await shot('wzg-02-frag');
// a flash at a bot: put one in front of us
await ev(() => {
  const w = window.nf.warzone, p = window.nf.player, f = window.nf.follow;
  const b = w.bots.find((x) => x.team === 1 && x.alive);
  b.pos.set(p.pos.x + Math.sin(f.yaw) * 7, p.pos.y, p.pos.z + Math.cos(f.yaw) * 7);
  b.aimYaw = b.yaw = f.yaw + Math.PI;
  f.pitch = -0.05;
  window.__b = b;
});
await press('LB'); await step(1.8);
await shot('wzg-03-flash');
console.log('bot blinded', await ev(() => window.__b.blindT.toFixed(2)), 'tacticals left', await ev(() => window.nf.warzone.tacticalN));
// streaks: earn them all at once
await ev(() => { const w = window.nf.warzone; w.earned.push('recon', 'sentry', 'strike', 'drone'); });
await press('Down'); await step(0.5);
await shot('wzg-04-recon');
console.log('recon', await ev(() => window.nf.warzone.streaks.recon.join(',')));
await press('Down'); await step(1.5);
await shot('wzg-05-sentry');
await ev(() => { window.nf.follow.pitch = 0.05; });
await press('Down'); await step(3.6);
await shot('wzg-06-strike');
await step(1);
await press('Down'); await step(2);
await shot('wzg-07-drone');
await step(4);
console.log('after streaks', JSON.stringify(await me()));
// let the bots fight for a while: count grenades, covers, flanks
let lobs = 0;
for (let i = 0; i < 40; i++) {
  await step(1);
  lobs += await ev(() => window.nf.warzone.gear.thrown.filter((x) => !x.owner.isPlayer && x.age < 1).length);
}
console.log('bot throws seen', lobs, 'modes', await ev(() => window.nf.warzone.bots.map((b) => b.mode).join(',')));
await shot('wzg-08-later');
console.log('snapshot', JSON.stringify(await ev(() => window.nf.warzone.snapshot)));
console.log('errors', errors);
await t.browser.close();
