// ZzFX ships plain JavaScript; the part of it NIGHTFALL uses (audio/AudioEngine.ts blip).
declare module 'zzfx' {
  export const ZZFX: { buildSamples(...params: number[]): number[]; sampleRate: number; volume: number };
  export function zzfx(...params: number[]): AudioBufferSourceNode;
}
