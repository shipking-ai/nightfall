// Freezes: where does the main thread go while you travel? Updates only (no drawing, which SwiftShader
// makes meaningless), the player carried along at driving speed from the start through the first town.
// Reports the slowest frames, long tasks between frames, and a CPU profile by function.
import { launch, enterRpg } from './lib.mjs';
import { writeFileSync } from 'node:fs';
const t = await launch({ pad: 'xbox', w: 960, h: 540 });
const { page, tap, waitState, focused, step } = t;
const until = async (fn, secs = 60) => { for (let i = 0; i < secs * 2; i++) { if (await fn()) return true; await t.wait(500); } return false; };
const log = (...a) => console.log(...a);
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('nightfall.rpg.save')) localStorage.removeItem(k); });
await waitState('landing');
await t.wait(3000);
await enterRpg(t);
await step(1);
const FRAMES = Number(process.env.FRAMES ?? 4400);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await cdp.send('Profiler.start');
const RENDER_EVERY = Number(process.env.RENDER_EVERY ?? 0);
const res = await page.evaluate(async ([FRAMES, RENDER_EVERY]) => {
  const nf = window.nf, r = nf.rpg, g = r.gen;
  const P = nf.rpgMain(r.life.world);
  const long = [];
  const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) }); });
  try { po.observe({ type: 'longtask', buffered: false }); } catch {}
  const p0 = { x: nf.player.pos.x, z: nf.player.pos.z };
  // out to the first town and on through it
  const dx = P.first.x - p0.x, dz = P.first.z - p0.z, L = Math.hypot(dx, dz);
  const ux = dx / L, uz = dz / L;
  nf.noRender = true;
  if (!nf.simNow) nf.simNow = performance.now();
  nf.renderer.renderer.setAnimationLoop(null);
  const frames = [];
  const compiles = [];
  let last = performance.now();
  for (let i = 0; i < FRAMES; i++) {
    const d = i * 0.8; // 24 m/s
    const x = p0.x + ux * d, z = p0.z + uz * d;
    nf.player.place(x, g.height(x, z) + 0.3, z, Math.atan2(ux, uz));
    const draw = RENDER_EVERY > 0 && i % RENDER_EVERY === 0;
    const progs0 = draw ? new Set(nf.renderer.renderer.info.programs.map((p) => p.id)) : null;
    nf.noRender = !draw;
    const t0 = performance.now();
    nf.simNow += 1000 / 30;
    nf.frame(nf.simNow);
    const ms = performance.now() - t0;
    if (draw) {
      const fresh = nf.renderer.renderer.info.programs.filter((p) => !progs0.has(p.id));
      if (fresh.length) compiles.push({ i, ms: Math.round(ms), n: fresh.length, names: [...new Set(fresh.map((p) => p.name))].slice(0, 12) });
    }
    // let workers, timers and promises run, as they would between real frames
    await new Promise((res) => setTimeout(res, 0));
    const gap = performance.now() - last - ms;
    last = performance.now();
    frames.push({ i, ms: +ms.toFixed(1), gap: +gap.toFixed(1), x: Math.round(x), z: Math.round(z), chunks: r.streamer.chunks.size });
  }
  nf.noRender = false;
  po.disconnect();
  const sorted = frames.slice().sort((a, b) => b.ms - a.ms);
  const gaps = frames.slice().sort((a, b) => b.gap - a.gap);
  const ms = frames.map((f) => f.ms).sort((a, b) => a - b);
  const q = (p) => ms[Math.floor(p * (ms.length - 1))];
  return { compiles, programs: nf.renderer.renderer.info.programs.length, n: frames.length, p50: q(0.5), p90: q(0.9), p99: q(0.99), max: ms[ms.length - 1], worst: sorted.slice(0, 15), worstGaps: gaps.slice(0, 10), long: long.sort((a, b) => b.ms - a.ms).slice(0, 15), town: P.first.name, dist: Math.round(L) };
}, [FRAMES, RENDER_EVERY]);
const { profile } = await cdp.send('Profiler.stop');
log(JSON.stringify({ n: res.n, p50: res.p50, p90: res.p90, p99: res.p99, max: res.max, town: res.town, dist: res.dist }));
log('worst frames', JSON.stringify(res.worst));
log('worst gaps (work between frames)', JSON.stringify(res.worstGaps));
log('long tasks', JSON.stringify(res.long));
if (RENDER_EVERY) log('programs', res.programs, 'compiled mid-trip:', JSON.stringify(res.compiles));
// self time by function
const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const dt = profile.timeDeltas;
const counts = new Map();
for (let i = 0; i < profile.samples.length; i++) counts.set(profile.samples[i], (counts.get(profile.samples[i]) ?? 0) + (dt[i] ?? 0));
for (const [id, us] of counts) {
  const n = byId.get(id);
  const cf = n.callFrame;
  const key = `${cf.functionName || '(anon)'} ${cf.url.replace(/^.*\/src\//, 'src/').replace(/\?.*$/, '')}:${cf.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + us);
}
const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, us]) => `${(us / 1000).toFixed(0).padStart(7)} ms  ${k}`);
log('self time:\n' + top.join('\n'));
writeFileSync('/tmp/rpg-perf-profile.json', JSON.stringify(profile));
await t.browser.close();
