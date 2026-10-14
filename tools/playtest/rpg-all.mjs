// R6: the whole RPG checklist (docs/rpg-checklist.md), one test at a time, each in its own browser.
// A test passes if it exits cleanly, reports no page errors, and prints no FAIL or ✗ lines.
// ONLY=rpg-map,rpg-pad to run some; SKIP=rpg-soak to leave some out (the soak takes ~40 min).
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const ALL = [
  ['rpg', 'the world: every biome and town type, out of District 03'],
  ['rpg-roads', 'traffic, parked cars, driving off'],
  ['rpg-life', 'creator, Casefile, story start, talking, shops, a bed, save and load'],
  ['rpg-ferry', 'following the markers through the first story steps with a pad'],
  ['rpg-wild', 'animals, hunting, butchering, fire and cooking, fishing'],
  ['rpg-dark', 'dread at night, the watcher, roadside events'],
  ['rpg-fight', 'violence in town: witnesses, bounty, the Watch'],
  ['rpg-drive', 'vehicle kinds and handling, carjacking, cards'],
  ['rpg-map', 'the atlas: zoom, pan, pin with the pad'],
  ['rpg-pad', 'every screen with only a controller'],
  ['rpg-look', 'the look of forest, desert, mountains and town'],
  ['rpg-perf', 'frame time and stalls while travelling'],
  ['rpg-soak', 'an hour of play: leaks and errors'],
];
const only = process.env.ONLY?.split(','), skip = process.env.SKIP?.split(',') ?? [];
const run = ALL.filter(([n]) => (!only || only.includes(n)) && !skip.includes(n));
const results = [];
for (const [name, what] of run) {
  const t0 = Date.now();
  const r = spawnSync('node', [`${name}.mjs`], { encoding: 'utf8', timeout: name === 'rpg-soak' ? 5400e3 : 1500e3, maxBuffer: 64 << 20, env: { ...process.env, FRAMES: process.env.FRAMES ?? '1500' } });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const errLine = out.split('\n').reverse().find((l) => /^errors\b/.test(l.trim())) ?? '';
  const pageErrors = errLine && !/errors\s+(\[\]|\[ *\])\s*$/.test(errLine.trim());
  const fails = out.split('\n').filter((l) => /^\s*(FAIL|✗)|Error: |Uncaught/.test(l));
  const ok = r.status === 0 && !pageErrors && !fails.length && !r.error;
  const secs = Math.round((Date.now() - t0) / 1000);
  results.push({ name, what, ok, secs, status: r.status, fails: fails.slice(0, 6), errors: pageErrors ? errLine.slice(0, 300) : '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(10)} ${String(secs).padStart(5)} s  ${what}`);
  if (!ok) for (const f of [...fails.slice(0, 6), pageErrors ? errLine.slice(0, 300) : '', r.error ? String(r.error) : ''].filter(Boolean)) console.log(`        ${f.trim()}`);
}
writeFileSync('/tmp/rpg-all.json', JSON.stringify(results, null, 1));
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exitCode = bad.length ? 1 : 0;
