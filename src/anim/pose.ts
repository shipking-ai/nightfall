/**
 * A pose is a flat array of joint values. Procedural locomotion writes a
 * base pose every frame; authored clips (anim/clips.ts) blend over the top of
 * it on layers (anim/Animator.ts); the rig (entities/Humanoid.ts) turns the
 * result into matrices.
 *
 * Angles are radians. Conventions, from the figure's point of view (facing +z):
 * Left and right are symmetric: the same value means the same movement on either side.
 *  - sh*f   upper arm forward (+) / back (-);  sh*ab  out from the body;  sh*tw  swings a raised arm in towards the midline;  sh*up  shrug (0..1)
 *  - el*    elbow bend (+ folds the forearm forward); el*tw  bends it in towards the body (+) or out (-)
 *  - wr*    wrist flex (rx) and bend out (rz);  grip*  0 relaxed, 1 fist, 2 point, 3 thumb up, 4 open
 *  - hip*f  thigh forward (+);  hip*ab  out to the side;  hip*tw  turned out
 *  - kn*    knee bend (+);  an*  ankle, on top of keeping the sole level
 *  - pel*   pelvis offset (pelY is added to the height the legs give) and rotation
 *  - sp*    chest relative to pelvis (rx + leans forward, ry + turns to its right);  nk*  head (rx + looks down, ry + turns to its right)
 *  (a figure faces +z; its right side is +x)
 *  - root*  the whole body (falls, lying down); rotation pivots at hip height
 */
export const CHANNELS = [
  'rootX', 'rootY', 'rootZ', 'rootRx', 'rootRy', 'rootRz',
  'pelX', 'pelY', 'pelZ', 'pelRx', 'pelRy', 'pelRz',
  'spRx', 'spRy', 'spRz',
  'nkRx', 'nkRy', 'nkRz',
  'shLf', 'shLab', 'shLtw', 'shLup', 'elL', 'elLtw', 'wrL', 'wrLz', 'gripL',
  'shRf', 'shRab', 'shRtw', 'shRup', 'elR', 'elRtw', 'wrR', 'wrRz', 'gripR',
  'hipLf', 'hipLab', 'hipLtw', 'knL', 'anL',
  'hipRf', 'hipRab', 'hipRtw', 'knR', 'anR',
  'blink', 'browUp', 'jaw',
  // the face beyond a blink: expressions and the eyes (anim/face.ts)
  'smile', 'frown', 'browIn', 'browAsym', 'eyeX', 'eyeY', 'squint',
] as const;
export type Channel = (typeof CHANNELS)[number];
export const NCH = CHANNELS.length;
export const C = Object.fromEntries(CHANNELS.map((c, i) => [c, i])) as Record<Channel, number>;

export type Pose = Float32Array;
export const newPose = (): Pose => new Float32Array(NCH);

/** Channel groups, for layers that should only touch part of the body. */
const idx = (names: Channel[]) => names.map((n) => C[n]);
export const MASKS = {
  full: CHANNELS.map((_, i) => i),
  upper: idx(['spRx', 'spRy', 'spRz', 'nkRx', 'nkRy', 'nkRz', 'shLf', 'shLab', 'shLtw', 'shLup', 'elL', 'elLtw', 'wrL', 'wrLz', 'gripL', 'shRf', 'shRab', 'shRtw', 'shRup', 'elR', 'elRtw', 'wrR', 'wrRz', 'gripR', 'blink', 'browUp', 'jaw', 'smile', 'frown', 'browIn', 'browAsym', 'eyeX', 'eyeY', 'squint']),
  arms: idx(['shLf', 'shLab', 'shLtw', 'shLup', 'elL', 'elLtw', 'wrL', 'wrLz', 'gripL', 'shRf', 'shRab', 'shRtw', 'shRup', 'elR', 'elRtw', 'wrR', 'wrRz', 'gripR']),
  armR: idx(['shRf', 'shRab', 'shRtw', 'shRup', 'elR', 'elRtw', 'wrR', 'wrRz', 'gripR']),
  armL: idx(['shLf', 'shLab', 'shLtw', 'shLup', 'elL', 'elLtw', 'wrL', 'wrLz', 'gripL']),
  head: idx(['nkRx', 'nkRy', 'nkRz', 'blink', 'browUp', 'jaw', 'smile', 'frown', 'browIn', 'browAsym', 'eyeX', 'eyeY', 'squint']),
  face: idx(['blink', 'browUp', 'jaw', 'smile', 'frown', 'browIn', 'browAsym', 'eyeX', 'eyeY', 'squint']),
  legs: idx(['pelX', 'pelY', 'pelZ', 'pelRx', 'pelRy', 'pelRz', 'hipLf', 'hipLab', 'hipLtw', 'knL', 'anL', 'hipRf', 'hipRab', 'hipRtw', 'knR', 'anR']),
};
export type MaskName = keyof typeof MASKS;

/** Grip channels hold a category, not an angle: they switch rather than blend. */
export const DISCRETE = new Set([C.gripL, C.gripR]);

/** Swap left and right (a left-handed wave from a right-handed one). */
const MIRROR_NEG = new Set<Channel>(['rootX', 'rootRy', 'rootRz', 'pelX', 'pelRy', 'pelRz', 'spRy', 'spRz', 'nkRy', 'nkRz', 'eyeX', 'browAsym']);
export function mirrorChannel(c: Channel): { to: Channel; neg: boolean } {
  let to = c as string;
  if (/^(sh|el|wr|grip|hip|kn|an)L/.test(c) || /^(el|wr|grip|kn|an)L$/.test(c)) to = c.replace(/L(?=[a-z]*$)/, 'R');
  else if (/^(sh|el|wr|grip|hip|kn|an)R/.test(c)) to = c.replace(/R(?=[a-z]*$)/, 'L');
  return { to: to as Channel, neg: MIRROR_NEG.has(c) };
}
