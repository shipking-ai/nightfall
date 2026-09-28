// Shared helpers for the headless playtests (Playwright + SwiftShader WebGL).
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const OUT = process.env.SHOTS ?? resolve(here, '../../captures/playtest');
mkdirSync(OUT, { recursive: true });

export async function launch({ pad = 'xbox', w = 960, h = 540, url = 'http://localhost:5317/' } = {}) {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
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
  const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
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
