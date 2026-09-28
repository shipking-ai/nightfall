// Character review: a line-up of archetypes under a street lamp, at several distances.
import { launch } from './lib.mjs';
const t = await launch({ pad: null, w: 1280, h: 720 });
const { page, shot, wait, waitState, errors } = t;
console.log('state', await waitState('landing'));
await wait(9000);
await page.evaluate(() => { window.nf.mode = 'city'; window.nf.enter(); });
console.log('state', await waitState('playing', 200));
await wait(3000);
const arches = (process.env.ARCH ?? 'commuter,office,student,courier,market,nurse,elder,worker,drifter,taxi,police').split(',');
await page.evaluate((arches) => {
  const nf = window.nf, THREE = null;
  const c = nf.player.pos.clone();
  const center = c.clone(); center.z -= 5; center.y = c.y;
  const L = window.nfLineup(center, 0, arches, Number(new URLSearchParams(location.search).get('seed') ?? 7), 0.95);
  nf.scene.add(L.group);
  nf.player.group.visible = false;
  nf.crowd.group.visible = false;
  window.__L = L;
  window.__center = center;
  nf.debugTick = (dt, t) => L.update(dt, t, nf.camera.position.distanceTo(center));
}, arches);
const cam = (dz, dy, dx = 0, ly = 1.25) => page.evaluate(([dz, dy, dx, ly]) => {
  const c = window.__center;
  const pos = c.clone(); pos.z += dz; pos.y += dy; pos.x += dx;
  const look = c.clone(); look.y += ly; look.x += dx;
  window.nf.debugCam = { pos, look };
}, [dz, dy, dx, ly]);
await cam(7.5, 1.4); await wait(5000); await shot('char-wide');
await cam(2.2, 1.55, -3.3, 1.5); await wait(3500); await shot('char-close-left');
await cam(2.2, 1.55, 0, 1.5); await wait(3500); await shot('char-close-mid');
await cam(2.2, 1.55, 3.3, 1.5); await wait(3500); await shot('char-close-right');
await cam(0.9, 1.62, -0.95 * 4, 1.6); await wait(3000); await shot('char-face-a');
await cam(0.9, 1.62, 0.95 * 1, 1.6); await wait(3000); await shot('char-face-b');
await cam(15, 1.6); await wait(3000); await shot('char-15m');
await cam(25, 1.7); await wait(3000); await shot('char-25m');
console.log('errors', errors);
await t.browser.close();
