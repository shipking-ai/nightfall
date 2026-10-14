// RPG realism pass: the land up close (real normal maps), captured skies for lighting, people in it.
import { launch, enterRpg } from './lib.mjs';
const t = await launch({ pad: 'xbox', w: 1280, h: 720 });
const { page, shot, tap, waitState, focused, errors, step } = t;
const until = async (fn, secs = 60) => { for (let i = 0; i < secs * 2; i++) { if (await fn()) return true; await t.wait(500); } return false; };
const log = (...a) => console.log(...a);
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('nightfall.rpg.save')) localStorage.removeItem(k); });
await waitState('landing');
await t.wait(3000);
// (trace anything that takes the game back to the title)
await page.evaluate(() => {
  const nf = window.nf;
  window.__calls = [];
  const wrap = (obj, k, name) => {
    const f = obj[k].bind(obj);
    obj[k] = (...a) => { window.__calls.push({ k: name, state: nf.state, overlay: nf.overlay, ret: nf.overlayReturn, stack: new Error().stack.split('\n').slice(2, 8).map((x) => x.trim().replace(/https?:\/\/[^/]+\//, '').replace(/\?t=\d+/, '')).join(' | ') }); return f(...a); };
  };
  for (const k of ['toLanding', 'leave', 'back', 'closeModes']) wrap(nf, k, k);
  wrap(nf.landing, 'show', 'landing.show');
});
await enterRpg(t);
await step(1);
const want = (process.env.PLACES ?? 'forest,desert,alpine,town').split(',');
for (const kind of want) {
  const at = await page.evaluate(async (kind) => {
    const nf = window.nf, r = nf.rpg, g = r.gen;
    let spot = null;
    if (kind === 'town') {
      const P = nf.rpgMain(r.life.world);
      const pl = r.streamer.towns.plan(P.first);
      // across the street from a diner or a bar, looking at its front
      const door = pl.pois.find((p) => p.kind === 'diner' || p.kind === 'bar') ?? pl.pois[0];
      if (door) spot = { x: door.x + Math.sin(door.yaw) * 10 + Math.cos(door.yaw) * 2, z: door.z + Math.cos(door.yaw) * 10 - Math.sin(door.yaw) * 2, face: door.yaw + Math.PI };
      else {
        const w = pl.walk.slice().sort((a, b) => Math.hypot(a.x - P.first.x, a.z - P.first.z) - Math.hypot(b.x - P.first.x, b.z - P.first.z))[0];
        spot = { x: w.x, z: w.z };
      }
    } else if (kind === 'bridge') {
      // a bridge, from the side and a little way off
      const P = nf.rpgMain(r.life.world);
      let best = null;
      for (const rd of g.roadsNear(P.first.x, P.first.z)) for (let i = 2; i + 3 < rd.pts.length && !best; i += 2) {
        if (!rd.bridge[i / 2] || !rd.bridge[i / 2 - 1] || !rd.bridge[i / 2 + 1]) continue;
        const x = rd.pts[i], z = rd.pts[i + 1];
        const dir = Math.atan2(rd.pts[i + 2] - x, rd.pts[i + 3] - z);
        const side = dir + Math.PI / 2;
        const sx = x + Math.sin(side) * 45, sz = z + Math.cos(side) * 45;
        if (g.ground(sx, sz).water != null) continue;
        best = { x: sx, z: sz, face: side + Math.PI };
      }
      spot = best;
    } else if (kind === 'road' || kind === 'roadtown') {
      // on a road, looking along it: out in the country, or where it comes into the first town
      const P = nf.rpgMain(r.life.world);
      const c = kind === 'road' ? { x: (P.first.x + nf.player.pos.x) / 2, z: (P.first.z + nf.player.pos.z) / 2 } : { x: P.first.x, z: P.first.z };
      let best = null, bd = 1e12;
      for (const rd of g.roadsNear(c.x, c.z)) for (let i = 0; i + 3 < rd.pts.length; i += 2) {
        const x = rd.pts[i], z = rd.pts[i + 1];
        if (rd.bridge[i / 2]) continue;
        const town = g.placeAt(x, z, 0);
        if (kind === 'road' && town) continue;
        const want = kind === 'road' ? Math.hypot(x - c.x, z - c.z) : Math.abs(Math.hypot(x - P.first.x, z - P.first.z) - (P.first.radius + 30));
        if (want < bd) (bd = want), (best = { x, z, face: Math.atan2(rd.pts[i + 2] - x, rd.pts[i + 3] - z) + (kind === 'roadtown' ? 0 : 0) });
      }
      spot = best;
      if (spot && kind === 'roadtown') {
        // face the town
        const tw = Math.atan2(P.first.x - spot.x, P.first.z - spot.z);
        if (Math.cos(tw - spot.face) < 0) spot.face += Math.PI;
      }
    } else for (let k = 0; k < 3000 && !spot; k++) {
      const a = k * 2.399, d = 800 + k * 25;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const gr = g.ground(x, z);
      if (gr.biome === kind && gr.water === null && gr.road === 0 && !g.placeAt(x, z, 200)) spot = { x, z };
    }
    if (!spot) return null;
    const face = spot.face ?? 0.6;
    nf.player.place(spot.x, g.height(spot.x, spot.z) + 0.4, spot.z, face);
    nf.follow.yaw = face;
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
  log('state', await page.evaluate(() => window.nf.state));
  log(kind, JSON.stringify(at), 'sky', await page.evaluate(() => window.nf.rpg.skyFor()), 'hdri loaded', await page.evaluate(() => [...window.nf.rpg.hdri.keys()].join(',')));
  if (process.env.HIDE) await page.evaluate((hide) => {
    const r = window.nf.rpg;
    if (hide.includes('tiles')) for (const t of r.streamer.tiles.values()) t.mesh.visible = false;
    if (hide.includes('flora')) r.streamer.flora.group.visible = false;
    if (hide.includes('terrain')) for (const c of r.streamer.chunks.values()) c.group.children[0].visible = false;
  }, process.env.HIDE);
  if (process.env.HIDE) await step(0.2);
  if (process.env.SIDE) {
    // from off to one side, a little above, looking back at where you stand
    await page.evaluate((dist) => {
      const nf = window.nf, p = nf.player.pos, f = nf.player.facing + Math.PI / 2;
      nf.debugCam = { pos: p.clone().add({ x: Math.sin(f) * dist, y: 8, z: Math.cos(f) * dist }), look: p.clone() };
    }, Number(process.env.SIDE));
    await step(0.3);
  }
  if (process.env.TOP) {
    // straight down from above (the App's debug camera)
    await page.evaluate((hgt) => {
      const nf = window.nf, p = nf.player.pos;
      nf.debugCam = { pos: p.clone().add({ x: 0, y: hgt, z: 0.01 }), look: p.clone() };
    }, Number(process.env.TOP));
    await step(0.3);
  }
  log('ground', JSON.stringify(await page.evaluate(() => {
    const nf = window.nf, r = nf.rpg, g = r.gen, pp = nf.player.pos;
    const gr = g.ground(pp.x, pp.z);
    const c = r.streamer.chunkAt(pp.x, pp.z);
    const f = c?.field;
    const vi = f ? Math.round((pp.x - f.x0) / f.step) : -1, vj = f ? Math.round((pp.z - f.z0) / f.step) : -1;
    const k = f ? vj * f.n + vi : -1;
    const kids = c ? c.group.children.map((o) => `${o.type}:${o.material?.type ?? ''}:${o.geometry?.attributes?.position?.count ?? 0}`) : [];
    return { gen: { h: +gr.h.toFixed(2), road: +gr.road.toFixed(2), water: gr.water }, field: f ? { h: +f.h[k].toFixed(2), road: +f.road[k].toFixed(2), n: f.n, step: f.step } : null, player: +pp.y.toFixed(2), chunkKids: kids.slice(0, 8), nKids: kids.length };
  })));
  log('real', JSON.stringify(await page.evaluate(() => { const f = window.nf.rpg.streamer.flora; const o = {}; for (const [k, l] of f.real.models) o[k] = l.reduce((n, m) => n + m.bark.count, 0); return o; })));
  await shot(`rpg-look-${kind}`);
}
log('title calls', JSON.stringify(await page.evaluate(() => window.__calls)));
log('errors', JSON.stringify(errors));
await t.browser.close();
