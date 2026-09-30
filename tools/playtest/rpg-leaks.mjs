// Where do GPU objects leak from? Every geometry and texture created during play is recorded with where it was made;
// freed ones are forgotten. After MINUTES of the soak's route, the live ones that are no longer in the scene are
// grouped by the code that made them.
import { launch, enterRpg } from './lib.mjs';
const MINUTES = Number(process.env.MINUTES ?? 10);
const t = await launch({ pad: 'xbox', w: 960, h: 540 });
const { page, errors } = t;
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('nightfall.rpg.save')) localStorage.removeItem(k); });
await enterRpg(t);
await t.step(2);
// start recording (after the RPG is up: its start-up allocations are not the question).
// The classes are found from objects already in the scene (the app's own copy of three.js).
const ok = await page.evaluate(async () => {
  const nf = window.nf;
  const base = (o, name) => { let p = Object.getPrototypeOf(o); while (p && p.constructor.name !== name) p = Object.getPrototypeOf(p); return p?.constructor; };
  let geo = null, tex = null;
  nf.scene.traverse((o) => { if (!geo && o.geometry) geo = o.geometry; if (!tex && o.material?.map) tex = o.material.map; });
  tex ??= nf.scene.environment;
  const mod = { BufferGeometry: geo && base(geo, 'BufferGeometry'), Texture: tex && base(tex, 'Texture') };
  if (!mod.BufferGeometry || !mod.Texture) return false;
  // held weakly: what the game itself dropped is garbage, not a leak (a GPU object it forgot to dispose is still
  // kept alive by three.js's renderer bookkeeping, so it stays in here)
  const live = (window.__live = new Map());
  const reg = new FinalizationRegistry((k) => live.delete(k));
  const where = () => new Error().stack.split('\n').slice(2, 12).map((s) => s.trim().replace(/https?:\/\/[^/]+\//, '').replace(/\?[^:)]*/g, '')).filter((s) => !/three\.module|node_modules|deps\//.test(s)).slice(0, 3).join(' < ');
  for (const [Cls, kind] of [[mod.BufferGeometry, 'geometry'], [mod.Texture, 'texture']]) {
    const proto = Cls.prototype;
    const dispose = proto.dispose;
    proto.dispose = function () { if (this.__key) live.delete(this.__key); return dispose.call(this); };
    // clone/copy and constructors all end in the constructor: hook uuid assignment via a defineProperty on the prototype
    Object.defineProperty(proto, 'uuid', {
      configurable: true,
      get() { return this.__uuid; },
      set(v) {
        this.__uuid = v;
        if (!this.__key) { this.__key = {}; const ref = new WeakRef(this); live.set(this.__key, { ref, kind, at: where() }); reg.register(this, this.__key); }
      },
    });
  }
  return true;
});
console.log('instrumented', ok);
const t0 = Date.now();
await page.evaluate(async (MINUTES) => {
  const nf = window.nf, r = nf.rpg, g = r.gen, life = r.life;
  const P = nf.rpgMain(life.world);
  const stops = [P.first, P.city, P.cold, P.first, P.home].filter(Boolean);
  nf.renderer.renderer.setAnimationLoop(null);
  if (!nf.simNow) nf.simNow = performance.now();
  for (let minute = 0; minute < MINUTES; minute++) {
    const walking = minute % 4 === 3;
    const a = stops[Math.floor(minute / 4) % stops.length], b = stops[(Math.floor(minute / 4) + 1) % stops.length];
    const leg = (minute % 4) / 3;
    for (let f = 0; f < 1800; f++) {
      let x, z, yaw;
      if (walking) {
        const k = f / 1800, ang = minute * 1.3 + k * 2;
        x = a.x + Math.cos(ang) * 80 * k; z = a.z + Math.sin(ang) * 80 * k; yaw = ang;
      } else {
        const k = Math.min(1, leg + (f / 1800) / 3);
        x = a.x + (b.x - a.x) * k; z = a.z + (b.z - a.z) * k; yaw = Math.atan2(b.x - a.x, b.z - a.z);
      }
      nf.player.place(x, g.height(x, z) + 0.3, z, yaw);
      nf.noRender = f % 150 !== 0;
      nf.simNow += 1000 / 30;
      nf.frame(nf.simNow);
      if (f % 30 === 0) await new Promise((res) => setTimeout(res, 0));
    }
  }
  nf.noRender = false;
}, MINUTES);
const report = await page.evaluate(async () => {
  for (let i = 0; i < 3; i++) { window.gc?.(); await new Promise((r) => setTimeout(r, 50)); }
  const nf = window.nf, live = window.__live;
  // what's still in use: geometries and textures reachable from the scene (and the scene's environment)
  const used = new Set();
  nf.scene.traverse((o) => {
    if (o.geometry) used.add(o.geometry);
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) for (const k of Object.keys(m)) if (m[k] && m[k].isTexture) used.add(m[k]);
  });
  if (nf.scene.environment) used.add(nf.scene.environment);
  const groups = new Map();
  for (const [, v] of live) {
    const obj = v.ref.deref();
    if (!obj || used.has(obj)) continue;
    const key = `${v.kind}  ${v.at}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups].sort((a, b) => b[1] - a[1]).slice(0, 25);
});
console.log(`after ${MINUTES} min (${Math.round((Date.now() - t0) / 1000)} s): live but not in the scene, by where they were made:`);
for (const [k, n] of report) console.log(String(n).padStart(6), ' ', k);
console.log('errors', JSON.stringify(errors.slice(0, 5)));
await t.browser.close();
