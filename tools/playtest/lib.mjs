// Shared helpers for the headless playtests (Playwright + SwiftShader WebGL).
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const OUT = process.env.SHOTS ?? resolve(here, '../../captures/playtest');
mkdirSync(OUT, { recursive: true });

export async function launch({ pad = 'xbox', w = 960, h = 540, url = 'http://localhost:5317/' } = {}) {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CERT|net::|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  if (pad) {
    await page.addInitScript(`window.__padFamily = ${JSON.stringify(pad)};`);
    await page.addInitScript(readFileSync(resolve(here, 'fakepad.js'), 'utf8'));
  }
  await page.goto(url, { waitUntil: 'load' });
  const state = () => page.evaluate(() => window.nf?.state).catch(() => 'reloading');
  const waitState = async (s, secs = 180) => {
    for (let i = 0; i < secs * 2 && (await state()) !== s; i++) await page.waitForTimeout(500);
    return state();
  };
  const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png`, timeout: 240000 });
  const tap = (b, ms, pad) => page.evaluate(([b, ms, pad]) => window.__tap(b, ms, pad), [b, ms ?? 1300, pad ?? 0]);
  const hold = (b, on = true, pad = 0, v = 1) => page.evaluate(([b, on, pad, v]) => window.__hold(b, on, pad, v), [b, on, pad, v]);
  const stick = (which, x, y, pad = 0) => page.evaluate(([w, x, y, p]) => window.__stick(w, x, y, p), [which, x, y, pad]);
  const focused = () => page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName}.${a.className} "${(a.textContent || '').trim().slice(0, 40)}"` : 'none'; });
  /** step the game on game time (seconds at 30 fps), drawing the last frame */
  const step = (secs) => page.evaluate((n) => window.nf.devStep(n), Math.max(1, Math.round(secs * 30)));
  /** press a pad button for a few game frames */
  const press = async (b, secs = 0.15, pad = 0) => {
    await hold(b, true, pad);
    await step(secs);
    await hold(b, false, pad);
    await step(0.1);
  };
  return { browser, page, errors, state, waitState, shot, tap, hold, stick, focused, step, press, wait: (ms) => page.waitForTimeout(ms) };
}

/**
 * Into the RPG, checked: open the mode select from the title, choose RPG, and make sure it really started
 * (a missed tap used to leave a test running on the title screen). Retries; throws if it can't.
 * `creator`: 'begin' starts a life with the defaults, 'keep' leaves the mirror open.
 */
export async function enterRpg(t, { creator = 'begin' } = {}) {
  const { page, tap, focused, waitState } = t;
  const until = async (fn, secs = 60) => { for (let i = 0; i < secs * 2; i++) { if (await fn().catch(() => false)) return true; await t.wait(500); } return false; };
  const st = () => page.evaluate(() => window.nf.state);
  let entered = false;
  for (let attempt = 0; attempt < 3 && !entered; attempt++) {
    await waitState('landing');
    await t.wait(2500);
    await until(async () => (await focused()).includes('Enter'), 8);
    for (let i = 0; i < 6 && !(await focused()).includes('Enter'); i++) { await tap(i < 3 ? 'Down' : 'Up'); await t.wait(700); }
    await tap('A');
    if (!(await until(() => page.evaluate(() => window.nf.modeSelect.isOpen), 20))) continue;
    await t.wait(1200);
    // (the item itself, rather than counting d-pad presses to it)
    await page.evaluate(() => document.querySelector('.modes__item--rpg')?.focus());
    await t.wait(600);
    await tap('A');
    entered = await until(async () => ['playing', 'overlay', 'entering'].includes(await st()), 60) && (await until(async () => ['playing', 'overlay'].includes(await st()), 240));
    if (!entered) console.log(`(enterRpg: attempt ${attempt + 1} did not start the RPG; state ${await st()})`);
  }
  if (!entered) throw new Error('could not enter the RPG');
  await until(() => page.evaluate(() => window.nf.rpg.life.panel === 'creator' || !!window.nf.rpg.life.game), 60);
  if (creator === 'begin' && (await page.evaluate(() => window.nf.rpg.life.panel === 'creator'))) await page.evaluate(() => document.querySelector('.cr__begin').click());
}
