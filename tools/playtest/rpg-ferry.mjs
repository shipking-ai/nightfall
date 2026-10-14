// The first stretch of the story, as a player would do it: reach the first town, follow the marker to the
// person to ask, ask with the pad, follow the marker to the ferryman (findable at any hour), talk to them.
import { launch, enterRpg } from './lib.mjs';
const t = await launch({ pad: 'xbox', w: 1280, h: 720 });
const { page, shot, tap, waitState, focused, errors, step, press } = t;
const until = async (fn, secs = 60) => { for (let i = 0; i < secs * 2; i++) { if (await fn()) return true; await t.wait(500); } return false; };
const log = (...a) => console.log(...a);
const fail = (m) => { log('FAIL', m); process.exitCode = 1; };
const p = async (b) => { await press(b, 0.2); await step(0.2); };
const seek = async (re, max = 10) => { for (let i = 0; i < max; i++) { if (re.test(await focused())) return true; await p('Down'); } return re.test(await focused()); };
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('nightfall.rpg.save')) localStorage.removeItem(k); });
await waitState('landing');
await t.wait(3000);
await enterRpg(t);
await step(1);

const goal = () => page.evaluate(() => {
  const nf = window.nf, r = nf.rpg, g = r.goal, q = r.life.game.s.quests.find((x) => x.id === 'main:long-night');
  const pp = nf.player.pos;
  return { stage: q?.data.stage, obj: q?.objectives.filter((o) => !o.done).map((o) => o.text), who: q?.objectives.find((o) => !o.done)?.who ?? null,
    goal: g && { person: g.person, d: Math.round(Math.hypot(g.x - pp.x, g.z - pp.z)), text: g.text }, marker: document.querySelector('.rpgmk')?.classList.contains('is-on') };
});
// into town (the story moves on when you arrive)
await page.evaluate(async () => {
  const nf = window.nf, life = nf.rpg.life;
  const P = nf.rpgMain(life.world);
  const plan = nf.rpg.streamer.towns.plan(P.first);
  const w = plan.walk.slice().sort((a, b) => Math.hypot(a.x - P.first.x, a.z - P.first.z) - Math.hypot(b.x - P.first.x, b.z - P.first.z))[0];
  nf.player.place(w.x, w.y + 0.3, w.z, 0);
  await nf.rpg.streamer.preload(nf.player.pos, () => {});
  nf.rpg.atmos.minutes = 23 * 60; // late: most people are in bed; the ones we need must still be findable
});
for (let i = 0; i < 6; i++) await step(0.5);
let g1 = await goal();
log('in town', JSON.stringify(g1));
if (Number(g1.stage) !== 1) fail('stage 1 did not start on arriving');
if (!g1.who) fail('stage 1 names nobody to ask');
if (!g1.goal?.person) fail('the marker is not on a person');
if (!g1.marker) fail('no marker on screen');
await shot('rpg-ferry-01-town');

// follow the marker to them: stand next to where it points
const reach = async () => {
  for (let k = 0; k < 10; k++) {
    const d = await page.evaluate(() => {
      const nf = window.nf, g = nf.rpg.goal;
      if (!g) return null;
      const w = nf.rpg.populace.find(nf.rpg.life.game.s.quests.find((x) => x.id === 'main:long-night').objectives.find((o) => !o.done).who);
      const tx = w ? w.pos.x : g.x, tz = w ? w.pos.z : g.z;
      const pp = nf.player.pos;
      const yaw = Math.atan2(tx - pp.x, tz - pp.z);
      nf.player.place(tx - Math.sin(yaw) * 1.3, nf.rpg.streamer.heightAt(tx, tz) + 0.3, tz - Math.cos(yaw) * 1.3, yaw);
      nf.follow.yaw = yaw;
      return w ? 'embodied' : 'not yet';
    });
    await step(0.8);
    if (d === 'embodied') return true;
  }
  return false;
};
const talkTo = async (re) => {
  await p('X');
  await step(0.5);
  if ((await page.evaluate(() => window.nf.rpg.life.panel)) !== 'talk') return false;
  if (!(await seek(re))) return false;
  await p('A');
  await step(0.5);
  return true;
};
if (!(await reach())) fail('could not reach the person to ask');
await shot('rpg-ferry-02-informant');
if (!(await talkTo(/ferryman/i))) fail('could not ask about the ferryman');
for (let i = 0; i < 3 && (await page.evaluate(() => window.nf.rpg.life.panel)); i++) await p('B');
let g2 = await goal();
log('asked', JSON.stringify(g2));
if (Number(g2.stage) !== 2) fail('asking did not name the ferryman');
if (!g2.goal?.person) fail('the marker is not on the ferryman');
if (!(await reach())) fail('could not reach the ferryman (at 23:00)');
await shot('rpg-ferry-03-ferryman');
if (!(await talkTo(/M\. sent me/i))) fail('could not tell the ferryman M. sent me');
for (let i = 0; i < 4 && (await page.evaluate(() => window.nf.rpg.life.panel)); i++) await p('B');
const g3 = await goal();
log('ferryman', JSON.stringify(g3));
if (Number(g3.stage) !== 3) fail('the story did not move on after the ferryman');
log('errors', JSON.stringify(errors));
await t.browser.close();
