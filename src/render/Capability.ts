import type { Quality } from '../core/Settings';

/**
 * What this machine can actually run.
 *
 * The renderer string is the only honest signal we can get about the GPU from
 * inside a browser, and it is a lie in a lot of interesting ways: it is the
 * *driver's* description, not the hardware's, it can be spoofed, and on Apple
 * silicon it usually says "Apple GPU" with no model at all. So we score it
 * with fuzzy rules rather than an exact table, and we treat the CPU, the amount
 * of memory and the screen as tie-breakers. Anything we can't recognise lands
 * in the middle, because guessing high on an unknown machine is how you get a
 * 12fps demo.
 */

export interface Capability {
  /** what we think the GPU is */
  gpu: string;
  /** rough score: how much of a modern card this is */
  score: number;
  /** the tier we would start on */
  tier: Quality;
  /** true if we're running on a software rasteriser (headless CI, no GPU) */
  software: boolean;
  cores: number;
  memoryGb: number;
  /** why we landed on this tier, in words, for the settings screen */
  reason: string;
}

/** One rule per GPU family: does the name match, and what is it worth. */
interface Rule {
  test: RegExp;
  score: number;
  label: string;
}

const RULES: Rule[] = [
  // ---- NVIDIA, newest first. The digit groups overlap, so match the family.
  { test: /rtx\s*50\d\d/i, score: 100, label: 'RTX 50-series' },
  { test: /rtx\s*40\d\d/i, score: 92, label: 'RTX 40-series' },
  { test: /rtx\s*30\d\d/i, score: 78, label: 'RTX 30-series' },
  { test: /rtx\s*20\d\d/i, score: 70, label: 'RTX 20-series' },
  // Pascal and Turing were both strong enough to run the top tier at 1080p.
  { test: /gtx\s*16\d\d/i, score: 60, label: 'GTX 16-series' },
  { test: /gtx\s*10\d\d/i, score: 56, label: 'GTX 10-series' },
  { test: /gtx\s*9[0-5]\d/i, score: 40, label: 'GTX 900-series' },
  { test: /gtx\s*\d{3}/i, score: 26, label: 'GTX 7-series or older' },
  { test: /(quadro|tesla)\s*[vrt]?\d/i, score: 70, label: 'Quadro/Tesla' },
  // ---- AMD. Three-digit cards (RX 580, RX 470) have no series to match, so
  // they get their own rule: Polaris was a solid mid-ranger.
  { test: /rx\s*(79|89)\d\d/i, score: 95, label: 'RX 7000/8000-series' },
  { test: /rx\s*6[0-9]\d\d/i, score: 76, label: 'RX 6000-series' },
  { test: /rx\s*5[0-9]\d\d/i, score: 64, label: 'RX 5000-series' },
  { test: /rx\s*[45]\d\d\d/i, score: 50, label: 'RX 4000-series' },
  { test: /rx\s*[3-6]\d\d(?!\d)/i, score: 48, label: 'RX 300/500-series' },
  { test: /(radeon|amd)\s*(pro|vega)/i, score: 58, label: 'Radeon Pro/Vega' },
  // ---- Intel
  { test: /arc\s*[ab]?\d{3,4}/i, score: 72, label: 'Intel Arc' },
  { test: /iris(\s*xe|\s*plus)?\s*(graphics)?/i, score: 34, label: 'Intel Iris Xe' },
  { test: /intel.*(uhd|hd|iris)/i, score: 22, label: 'Intel integrated' },
  // ---- Apple. All of M1..M4 are far past what this needs at every tier.
  { test: /apple\s*(m[1-9]|gpu)/i, score: 88, label: 'Apple silicon' },
  // ---- software. These are not GPUs at all and must never be trusted.
  { test: /(swiftshader|llvmpipe|software|basic render|microsoft basic)/i, score: 2, label: 'software rasteriser' },
];

/** How the score maps to a starting tier. */
function tierFor(score: number, cores: number, memoryGb: number, pixels: number): { tier: Quality; reason: string } {
  const thin = cores <= 4 || memoryGb <= 4;
  // A 4K screen is more pixels to push, so it pushes the tier down a notch.
  const heavyScreen = pixels > 3_500_000;
  if (score >= 88 && !thin && !heavyScreen) return { tier: 'cinematic', reason: 'this GPU can take it' };
  if (score >= 70 && !thin) return { tier: 'high', reason: 'a modern GPU' };
  if (score >= 45) return { tier: 'medium', reason: 'a mid-range GPU' };
  if (score >= 20) return { tier: 'low', reason: 'integrated or older graphics' };
  return { tier: 'low', reason: 'no usable GPU detected' };
}

/** Pull the renderer string out of a throwaway WebGL context. */
function rendererName(): string {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name || '';
  } catch {
    return '';
  }
}

export function detect(): Capability {
  const gpu = rendererName();
  const cores = navigator.hardwareConcurrency ?? 4;
  // deviceMemory is Chromium-only; the spec caps it at 8 and it is coarse anyway
  const memoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const pixels = innerWidth * innerHeight * Math.min(devicePixelRatio || 1, 2) ** 2;

  const software = /swiftshader|llvmpipe|software|basic render/i.test(gpu);
  const hit = RULES.find((r) => r.test.test(gpu));
  const score = hit ? hit.score : gpu ? 40 : 30;
  const { tier, reason } = tierFor(score, cores, memoryGb, pixels);

  return {
    gpu: gpu || 'unknown',
    score,
    tier,
    software,
    cores,
    memoryGb,
    reason: software ? 'running on a software renderer' : hit ? `${hit.label}, ${reason}` : `unrecognised GPU (${gpu || 'none'}), ${reason}`,
  };
}

/** The tiers, cheapest first, so the governor can walk them. */
export const TIERS: Quality[] = ['low', 'medium', 'high', 'cinematic'];

export function tierIndex(q: Quality): number {
  const i = TIERS.indexOf(q);
  return i < 0 ? 1 : i;
}

export function tierAt(i: number): Quality {
  return TIERS[Math.max(0, Math.min(TIERS.length - 1, i))];
}