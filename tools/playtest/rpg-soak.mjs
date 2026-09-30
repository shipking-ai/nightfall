// R6: a long session. MINUTES of play (default 60) at 30 fps: a loop between the story's towns at driving
// speed, walks through town, the Casefile and the map now and then. Every minute: memory, GPU objects,
// shader programs, chunks, collision, people, traffic. Fails on errors, or on anything that keeps growing.
import { launch, enterRpg } from './lib.mjs';
import { writeFileSync } from 'node:fs';
const MINUTES = Number(process.env.MINUTES ?? 60);
const t = await launch({ pad: 'xbox', w: 960, h: 540 });
const { page, errors } = t;
const log = (...a) => console.log(...a);
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('nightfall.rpg.save')) localStorage.removeItem(k); });
await enterRpg(t);
await t.step(2);
const t0 = Date.now();
const samples = [];
for (let minute = 0; minute < MINUTES; minute++) {
  const s = await page.evaluate(async (minute) => {
    const nf = window.nf, r = nf.rpg, g = r.gen, life = r.life;
    const P = nf.rpgMain(life.world);
    const stops = [P.first, P.city, P.cold, P.first, P.home].filter(Boolean);
    nf.renderer.renderer.setAnimationLoop(null);
    if (!nf.simNow) nf.simNow = performance.now();
    // this minute: a leg of the loop by road-ish straight line (driving), or a walk in town every 4th minute
    const walking = minute % 4 === 3;
    const a = stops[Math.floor(minute / 4) % stops.length], b = stops[(Math.floor(minute / 4) + 1) % stops.length];
    const leg = (minute % 4) / 3;
    let worst = 0;
    for (let f = 0; f < 1800; f++) {
      let x, z, yaw;
      if (walking) {
        const k = f / 1800, ang = minute * 1.3 + k * 2;
        x = a.x + Math.cos(ang) * 80 * k;
        z = a.z + Math.sin(ang) * 80 * k;
        yaw = ang;
      } else {
        const k = Math.min(1, leg + (f / 1800) / 3);
        x = a.x + (b.x - a.x) * k;
        z = a.z + (b.z - a.z) * k;
        yaw = Math.atan2(b.x - a.x, b.z - a.z);
      }
      nf.player.place(x, g.height(x, z) + 0.3, z, yaw);
      // a screen now and then: the Casefile (and its map) for a couple of seconds
      if (f === 900 && minute % 3 === 1) life.openCasefile(minute % 2 ? 'map' : 'case');
      if (f === 960 && life.panel === 'casefile') life.closePanel();
      const draw = f % 150 === 0;
      nf.noRender = !draw;
      const ft = performance.now();
      nf.simNow += 1000 / 30;
      nf.frame(nf.simNow);
      worst = Math.max(worst, performance.now() - ft);
      if (f % 30 === 0) await new Promise((res) => setTimeout(res, 0));
    }
    nf.noRender = false;
    const info = nf.renderer.renderer.info;
    let objs = 0;
    nf.scene.traverse(() => objs++);
    return {
      minute, heap: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576), geos: info.memory.geometries, tex: info.memory.textures, progs: info.programs.length,
      objs, chunks: r.streamer.chunks.size, boxes: nf.collision?.boxes?.length ?? r.host.collision.boxes.length, walkers: r.populace.walkers.size, traffic: r.traffic.count, parked: r.parked.size, animals: r.wildlife?.animals?.length ?? null,
      worstMs: Math.round(worst), state: nf.state, clock: r.atmos.label,
    };
  }, minute);
  samples.push(s);
  log(JSON.stringify(s));
  if (s.state !== 'playing' && s.state !== 'overlay') { log('FAIL state', s.state); break; }
}
// growth: compare the last quarter with the second quarter (after warm-up)
const q = (a, b) => samples.slice(Math.floor(samples.length * a), Math.floor(samples.length * b));
const avg = (xs, k) => xs.reduce((n, s) => n + s[k], 0) / Math.max(1, xs.length);
// (the route repeats every 20 minutes: compare the same places a loop apart once there are two loops after warm-up)
const early = samples.length >= 60 ? samples.slice(20, 40) : q(0.25, 0.5), late = samples.length >= 60 ? samples.slice(40, 60) : q(0.75, 1);
const verdict = {};
for (const k of ['heap', 'geos', 'tex', 'progs', 'objs', 'boxes']) {
  const e = avg(early, k), l = avg(late, k);
  verdict[k] = { early: Math.round(e), late: Math.round(l), growth: e ? +((l - e) / e).toFixed(2) : 0 };
}
log('growth', JSON.stringify(verdict));
const leaks = Object.entries(verdict).filter(([k, v]) => v.growth > (k === 'heap' ? 0.2 : 0.1));
log('leaks', leaks.length ? JSON.stringify(leaks.map(([k]) => k)) : 'none');
log('real time', Math.round((Date.now() - t0) / 1000), 's', 'errors', JSON.stringify(errors.slice(0, 10)));
writeFileSync('/tmp/rpg-soak.json', JSON.stringify(samples));
if (leaks.length || errors.length) process.exitCode = 1;
await t.browser.close();
