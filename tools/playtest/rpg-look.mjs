// RPG realism pass: the land up close (real normal maps), captured skies for lighting, people in it.
import { launch } from './lib.mjs';
const t = await launch({ pad: 'xbox', w: 1280, h: 720 });
const { page, shot, tap, waitState, focused, errors, step } = t;
const until = async (fn, secs = 60) => { for (let i = 0; i < secs * 2; i++) { if (await fn()) return true; await t.wait(500); } return false; };
const log = (...a) => console.log(...a);
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('nightfall.rpg.save')) localStorage.removeItem(k); });
await waitState('landing');
await t.wait(3000);
await until(async () => (await focused()).includes('Enter'), 8);
for (let i = 0; i < 6 && !(await focused()).includes('Enter'); i++) { await tap(i < 3 ? 'Down' : 'Up'); await t.wait(700); }
await tap('A');
await until(() => page.evaluate(() => window.nf.modeSelect.isOpen), 20);
await t.wait(1200);
for (let i = 0; i < 8 && !(await focused()).includes('RPG'); i++) { await tap('Down'); await t.wait(800); }
await t.wait(2000);
await tap('A');
await until(async () => ['playing', 'overlay'].includes(await page.evaluate(() => window.nf.state)), 240);
await until(() => page.evaluate(() => window.nf.rpg.life.panel === 'creator'), 30);
await page.evaluate(() => document.querySelector('.cr__begin').click());
await step(1);
const want = (process.env.PLACES ?? 'forest,desert,alpine,town').split(',');
for (const kind of want) {
  const at = await page.evaluate(async (kind) => {
    const nf = window.nf, r = nf.rpg, g = r.gen;
    let spot = null;
    if (kind === 'town') {
      const P = nf.rpgMain(r.life.world);
      const pl = r.streamer.towns.plan(P.first);
      const w = pl.walk.slice().sort((a, b) => Math.hypot(a.x - P.first.x, a.z - P.first.z) - Math.hypot(b.x - P.first.x, b.z - P.first.z))[0];
      spot = { x: w.x, z: w.z };
    } else for (let k = 0; k < 3000 && !spot; k++) {
      const a = k * 2.399, d = 800 + k * 25;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const gr = g.ground(x, z);
      if (gr.biome === kind && gr.water === null && gr.road === 0 && !g.placeAt(x, z, 200)) spot = { x, z };
    }
    if (!spot) return null;
    nf.player.place(spot.x, g.height(spot.x, spot.z) + 0.4, spot.z, 0.6);
    nf.follow.yaw = 0.6;
    await r.streamer.preload(nf.player.pos, () => {});
    r.atmos.minutes = 10.5 * 60;
    r.atmos.override = 'clear';
    return { ...spot, biome: r.place.biome };
  }, kind);
  if (!at) { log(kind, 'none'); continue; }
  for (let i = 0; i < 8; i++) await step(0.5);
  await t.wait(1500);
  for (let i = 0; i < 4; i++) await step(0.5);
  log('atmos', JSON.stringify(await page.evaluate(() => { const r = window.nf.rpg; return { now: r.atmos.now, fog: window.nf.scene.fog?.density, fogc: window.nf.scene.fog?.color.getHexString(), env: window.nf.scene.environmentIntensity, y: window.nf.player.pos.y, cam: window.nf.camera.position.y }; })));
  log(kind, JSON.stringify(at), 'sky', await page.evaluate(() => window.nf.rpg.skyFor()), 'hdri loaded', await page.evaluate(() => [...window.nf.rpg.hdri.keys()].join(',')));
  await shot(`rpg-look-${kind}`);
}
log('errors', JSON.stringify(errors));
await t.browser.close();
