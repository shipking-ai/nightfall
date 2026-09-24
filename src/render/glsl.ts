/** Shared GLSL helpers (hash / value noise / fbm). */
export const NOISE = /* glsl */ `
float nf_hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float nf_noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = nf_hash(i);
  float b = nf_hash(i + vec2(1.0, 0.0));
  float c = nf_hash(i + vec2(0.0, 1.0));
  float d = nf_hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float nf_fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * nf_noise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v;
}
`;
