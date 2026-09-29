// Dev viewer: the RPG's animals, sculpted and coloured.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const q = process.argv[2] ?? '';
await page.goto(`http://localhost:5317/dev/animals.html${q}`);
for (let i = 0; i < 120 && !(await page.evaluate(() => window.ready?.())); i++) await page.waitForTimeout(500);
await page.waitForTimeout(1500);
await page.screenshot({ path: `captures/playtest/animals${q.replace(/[^a-z]/gi, '')}.png` });
console.log('errors', errors);
await browser.close();
