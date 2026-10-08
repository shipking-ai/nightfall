// WARZONE's modes, each played for a while with the bots: does it score, does it end, are there errors?
// MODES=tdm,ffa,... to pick; SECS (game seconds per mode).
import { launch } from './lib.mjs';
const t = await launch({ pad: process.env.PAD ?? 'xbox' });
const { page, shot, step, press, waitState, errors } = t;
const ev = (fn, arg) => page.evaluate(fn, arg);
await waitState('landing');
await t.wait(3000);
await ev(() => { window.nf.mode = 'warzone'; window.nf.enter(); });
console.log('state', await waitState('playing', 200));
await step(0.5);
const list = (process.env.MODES ?? 'tdm,ffa,hotspot,tagged,ctf,ladder,charge,range,dom').split(',');
const secs = Number(process.env.SECS ?? 60);
for (const m of list) {
  await ev((m) => { const w = window.nf.warzone; w.modeId = m; w.again(); }, m);
  await step(0.3);
  await press('A'); await step(9);
  for (let i = 0; i < secs / 5; i++) {
    await step(5);
    // keep yourself in it: a little god mode so the run doesn't stall on your death
    await ev(() => { const w = window.nf.warzone; if (!w.me.alive && w.snapshot.phase !== 'over') { w.deadT = 0; } });
    await press('A');
  }
  const s = await ev(() => window.nf.warzone.snapshot);
  console.log(m, JSON.stringify({ phase: s.phase, score: s.score, round: s.round, flags: s.flags, me: `${s.me.kills}/${s.me.deaths} ${s.me.gun}`, bots: s.bots }));
  await shot(`wzm-${m}`);
}
console.log('errors', errors);
await t.browser.close();
