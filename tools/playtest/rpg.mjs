// RPG: from the title with a controller → the RPG → look around the wider world.
// Then (dev hooks) visit a spread of places and hours and photograph each, checking streaming stays sane.
import { launch } from './lib.mjs';
const t = await launch({ pad: process.env.PAD ?? 'xbox' });
const { page, shot, tap, waitState, focused, errors, step } = t;
const until = async (fn, secs = 60) => {
  for (let i = 0; i < secs * 2; i++) {
    if (await fn()) return true;
    await t.wait(500);
  }
  return false;
};
await waitState('landing');
await t.wait(4000);
// straight into the RPG (the menus have their own run in modes.mjs)
await page.evaluate(() => { window.nf.mode = 'rpg'; window.nf.enter(); });
const ok = await until(async () => (await page.evaluate(() => window.nf.state)) === 'playing', 240);
console.log('playing', ok, JSON.stringify(await page.evaluate(() => window.nf.rpg.debug)));
await t.wait(3000);
await shot('rpg-start');

// visit places (dev): teleport, let the world stream in, set the hour, photograph
const visit = async (name, x, z, hour, yaw = 0, weather = null) => {
  const info = await page.evaluate(async ([x, z, hour, yaw, weather]) => {
    const nf = window.nf, r = nf.rpg;
    const g = r.gen.ground(x, z);
    nf.player.place(x, Math.max(g.h, g.water ?? -99) + 0.3, z, yaw);
    nf.follow.yaw = yaw;
    await r.streamer.preload(nf.player.pos, () => {});
    r.atmos.minutes = hour * 60;
    r.atmos.override = weather;
    r.atmos.settle(nf.player.pos, g.biome);
    nf.follow.snap(nf.player, nf.world.collision);
    nf.lighting.focusNow(nf.player.pos);
    return { biome: g.biome, h: +g.h.toFixed(1), water: g.water, place: r.place.name };
  }, [x, z, hour, yaw, weather]);
  await step(2);
  const d = await page.evaluate(() => ({ ...window.nf.rpg.debug, place: window.nf.rpg.place.name, region: window.nf.rpg.place.region, sky: window.nf.rpg.atmos.describe(), y: +window.nf.player.pos.y.toFixed(1) }));
  console.log(name, JSON.stringify(info), JSON.stringify(d));
  await shot(`rpg-${name}`);
};

// find a few biomes near home
const found = await page.evaluate(() => {
  const g = window.nf.rpg.gen;
  const want = ['forest', 'boreal', 'tundra', 'alpine', 'desert', 'scrub', 'swamp', 'coast', 'temperate'];
  const out = {};
  for (let r = 1500; r < 40000 && Object.keys(out).length < want.length; r += 700) {
    for (let a = 0; a < 24; a++) {
      const x = Math.cos((a / 24) * Math.PI * 2) * r, z = Math.sin((a / 24) * Math.PI * 2) * r;
      const gr = g.ground(x, z);
      if (want.includes(gr.biome) && !out[gr.biome] && gr.water == null && gr.urban === 0) out[gr.biome] = [Math.round(x), Math.round(z)];
    }
  }
  const towns = [];
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    const s = g.settlement(i, j);
    if (s.kind === 'city' || s.kind === 'town') towns.push([s.name, s.kind, s.archetype, Math.round(s.x), Math.round(s.z)]);
  }
  return { out, towns };
});
console.log(JSON.stringify(found));
await page.evaluate(() => window.nf.devStep(1));
await visit('merrow-south-noon', 84, 640, 12.5, Math.PI);
await visit('merrow-edge-dusk', 900, 300, 19.6, -Math.PI / 2);
const towns = found.towns.filter((t) => t[1] === 'city').slice(0, 2).concat(found.towns.filter((t) => t[1] === 'town').slice(0, 2));
for (const [name, kind, arch, x, z] of towns) await visit(`${kind}-${arch}-${name.replace(/\W/g, '')}`, x + 30, z + 30, 11, 0.8);
for (const [b, [x, z]] of Object.entries(found.out)) await visit(`biome-${b}`, x, z, b === 'desert' ? 15 : 10, 1.2);
// the render budget in a forest and a city
for (const [n, x, z] of [['forest', found.out.forest?.[0] ?? 2200, found.out.forest?.[1] ?? 0], ['city', towns[0]?.[3] ?? 0, (towns[0]?.[4] ?? 0) + 40]]) {
  await visit(`budget-${n}`, x, z, 12, 0.5);
  const info = await page.evaluate(() => { const i = window.nf.renderer.renderer.info; return { calls: i.render.calls, tris: i.render.triangles, geos: i.memory.geometries, tex: i.memory.textures }; });
  console.log('budget', n, JSON.stringify(info));
}
await visit('storm', found.out.forest?.[0] ?? 3000, found.out.forest?.[1] ?? 3000, 16, 0.3, 'storm');
await visit('night-clear', found.out.temperate?.[0] ?? 2000, found.out.temperate?.[1] ?? 2000, 23.5, 0.3, 'clear');
// a drive: into a District 03 car, east along Harbor Lane, out past the outskirts into Merrow's own streets
const drove = await page.evaluate(async () => {
  const nf = window.nf, r = nf.rpg;
  r.atmos.override = null;
  r.atmos.minutes = 9 * 60;
  const car = nf.vehicles.cars.slice().sort((a, b) => Math.hypot(a.pos.x - 60, a.pos.z - 55) - Math.hypot(b.pos.x - 60, b.pos.z - 55))[0];
  car.pos.set(120, 0, 55.5);
  car.yaw = Math.PI / 2;
  nf.player.place(118, 0.15, 58, Math.PI / 2);
  await r.streamer.preload(nf.player.pos, () => {});
  nf.boardNow({ kind: 'drive', car });
  return { x: car.pos.x };
});
await t.hold('RT', true);
for (let k = 0; k < 6; k++) {
  await step(5);
  const d = await page.evaluate(() => { const c = window.nf.vehicle?.car; return c ? { x: +c.pos.x.toFixed(0), y: +c.pos.y.toFixed(1), z: +c.pos.z.toFixed(0), v: +c.v.toFixed(1), place: window.nf.rpg.place.name, chunks: window.nf.rpg.streamer.chunks.size } : null; });
  console.log('drive', k, JSON.stringify(d));
}
await t.hold('RT', false);
await step(1);
await shot('rpg-drive-east');
console.log('drove from', JSON.stringify(drove));
await page.evaluate(() => window.nf.realtime());
console.log('errors', errors);
await t.browser.close();
