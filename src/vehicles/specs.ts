/**
 * Every kind of vehicle in NIGHTFALL: its shape, its mechanicals and its
 * voice, as plain data. The physics (dynamics.ts), the model (model.ts) and
 * the sound (audio) all read from here, so a pickup is heavy, tall, soft and
 * lazy everywhere at once, and a sports car is low, stiff, loud and quick.
 *
 * Numbers are real-world-ish (kilograms, newton-metres, metres) so the
 * behaviour follows from them rather than being tuned per class by hand.
 */

export type VehicleClass =
  | 'sports' | 'sedan' | 'hatch' | 'taxi' | 'police' | 'armoured' | 'pickup' | 'van' | 'ambulance' | 'truck' | 'bus' | 'offroad' | 'motorcycle'
  | 'suv' | 'estate' | 'muscle' | 'limo' | 'city' | 'firetruck' | 'refuse' | 'roadster';

export type Drive = 'fwd' | 'rwd' | 'awd';

export interface BodyShape {
  /** overall length, width, roof height (metres) */
  length: number;
  width: number;
  height: number;
  /** ground clearance under the sills */
  clearance: number;
  /** beltline (where the glass starts) above the ground */
  belt: number;
  /** z of the windscreen base and top, rear screen top and base (from the centre, +z forward) */
  aBase: number;
  aTop: number;
  cTop: number;
  cBase: number;
  /** how far the glasshouse leans in at the roof (fraction of half-width) */
  tumble: number;
  /** nose and tail: how rounded (0 boxy … 1 round) and how high the deck is at the very ends */
  noseRound: number;
  tailRound: number;
  noseY: number;
  tailY: number;
  /** a load bed behind the cab (pickups), from z = bed back to the tail */
  bed?: number;
  /** a tall box behind the cab (trucks, ambulances) */
  box?: { from: number; height: number };
  /** doors per side (for the B-pillars and the door panels) */
  doors: 1 | 2;
  /** no roof: a windscreen and the sky (roadsters) */
  open?: boolean;
}

export interface Mech {
  /** kg */
  mass: number;
  /** centre of mass above the ground (m) */
  cogH: number;
  /** wheelbase and track (m); wheel radius and width */
  wheelbase: number;
  track: number;
  wheelR: number;
  wheelW: number;
  /** where the axles sit relative to the body centre (+z forward): front, rear */
  axleF: number;
  axleR: number;
  /** extra axles (trucks, buses): z positions, rear */
  extraAxles?: number[];
  drive: Drive;
  /** peak torque (N·m) at rpm; idle and redline */
  torque: number;
  torqueRpm: number;
  idle: number;
  redline: number;
  gears: number[];
  final: number;
  reverse: number;
  /** tyre grip (1 = a good road tyre on dry tarmac), and how much of it survives off the road */
  grip: number;
  offroad: number;
  /** brake force as a fraction of weight (g) */
  brake: number;
  /** suspension: static sag (m), travel (m), damping ratio */
  sag: number;
  travel: number;
  damping: number;
  /** anti-roll: extra roll stiffness, 0..1 */
  antiRoll: number;
  /** steering lock (radians) and how much it reduces at speed */
  lock: number;
  /** aero drag coefficient × frontal area (m²) */
  cda: number;
  /** a motorcycle leans rather than rolls */
  bike?: boolean;
}

export interface Voice {
  /** cylinders (the firing note), exhaust roughness 0..1, intake whine 0..1, a turbo's whistle */
  cyl: number;
  rough: number;
  whine: number;
  turbo: number;
  /** diesel clatter */
  diesel: boolean;
  /** horn pitch (Hz) */
  horn: number;
}

export interface VehicleSpec {
  cls: VehicleClass;
  name: string;
  shape: BodyShape;
  mech: Mech;
  voice: Voice;
  /** paint options, or a fixed livery */
  paints: number[];
  livery?: 'taxi' | 'police' | 'ambulance' | 'fire';
  /** where the driver's hips sit (car-local, metres) and passengers */
  seat: { x: number; y: number; z: number };
  seats: { x: number; y: number; z: number }[];
  /** steering wheel (centre) */
  wheel: { x: number; y: number; z: number; tilt: number };
}

const CAR_PAINTS = [0x1c1f24, 0x6b1e1e, 0x2a3a4e, 0xb8b8b2, 0x3d4a3a, 0x7a6a50, 0x121214, 0x4a4e56, 0x8a2a24, 0xd4d0c8, 0x274a6a, 0x5a3a2a];

export const SPECS: Record<VehicleClass, VehicleSpec> = {
  sports: {
    cls: 'sports', name: 'Coupé',
    shape: { length: 4.45, width: 1.9, height: 1.24, clearance: 0.11, belt: 0.86, aBase: 0.72, aTop: -0.35, cTop: -0.95, cBase: -1.75, tumble: 0.28, noseRound: 0.75, tailRound: 0.6, noseY: 0.5, tailY: 0.8, doors: 1 },
    mech: { mass: 1420, cogH: 0.44, wheelbase: 2.55, track: 1.6, wheelR: 0.34, wheelW: 0.28, axleF: 1.33, axleR: -1.22, drive: 'rwd', torque: 520, torqueRpm: 5200, idle: 900, redline: 7800, gears: [3.3, 2.2, 1.62, 1.28, 1.05, 0.86], final: 3.6, reverse: 3.2, grip: 1.18, offroad: 0.45, brake: 1.15, sag: 0.055, travel: 0.11, damping: 0.42, antiRoll: 0.75, lock: 0.6, cda: 0.62 },
    voice: { cyl: 8, rough: 0.55, whine: 0.2, turbo: 0, diesel: false, horn: 520 },
    paints: [0x8a1a14, 0x121214, 0xd8d4cc, 0x1e3a6a, 0xc88a1a, 0x2a4a2a],
    seat: { x: -0.38, y: 0.3, z: -0.25 }, seats: [{ x: 0.38, y: 0.3, z: -0.25 }],
    wheel: { x: -0.38, y: 0.72, z: 0.25, tilt: 1.15 },
  },
  sedan: {
    cls: 'sedan', name: 'Saloon',
    shape: { length: 4.75, width: 1.84, height: 1.46, clearance: 0.15, belt: 0.98, aBase: 0.95, aTop: 0.1, cTop: -1.05, cBase: -1.65, tumble: 0.2, noseRound: 0.55, tailRound: 0.45, noseY: 0.62, tailY: 0.92, doors: 2 },
    mech: { mass: 1520, cogH: 0.54, wheelbase: 2.8, track: 1.56, wheelR: 0.33, wheelW: 0.22, axleF: 1.42, axleR: -1.38, drive: 'fwd', torque: 270, torqueRpm: 4000, idle: 750, redline: 6500, gears: [3.6, 2.1, 1.4, 1.03, 0.82, 0.68], final: 3.9, reverse: 3.4, grip: 0.98, offroad: 0.55, brake: 0.95, sag: 0.075, travel: 0.14, damping: 0.34, antiRoll: 0.45, lock: 0.62, cda: 0.68 },
    voice: { cyl: 4, rough: 0.25, whine: 0.3, turbo: 0.2, diesel: false, horn: 440 },
    paints: CAR_PAINTS,
    seat: { x: -0.38, y: 0.4, z: -0.3 }, seats: [{ x: 0.38, y: 0.4, z: -0.3 }, { x: 0.4, y: 0.42, z: -1.2 }, { x: -0.4, y: 0.42, z: -1.2 }],
    wheel: { x: -0.38, y: 0.86, z: 0.18, tilt: 1.1 },
  },
  hatch: {
    cls: 'hatch', name: 'Hatchback',
    shape: { length: 4.05, width: 1.76, height: 1.48, clearance: 0.14, belt: 0.96, aBase: 0.9, aTop: 0.05, cTop: -1.3, cBase: -1.7, tumble: 0.2, noseRound: 0.6, tailRound: 0.15, noseY: 0.62, tailY: 0.95, doors: 2 },
    mech: { mass: 1180, cogH: 0.53, wheelbase: 2.55, track: 1.5, wheelR: 0.31, wheelW: 0.2, axleF: 1.3, axleR: -1.25, drive: 'fwd', torque: 200, torqueRpm: 3800, idle: 800, redline: 6600, gears: [3.5, 2.0, 1.35, 1.03, 0.82], final: 4.1, reverse: 3.3, grip: 0.95, offroad: 0.55, brake: 0.95, sag: 0.08, travel: 0.14, damping: 0.33, antiRoll: 0.4, lock: 0.65, cda: 0.62 },
    voice: { cyl: 4, rough: 0.3, whine: 0.35, turbo: 0.35, diesel: false, horn: 480 },
    paints: CAR_PAINTS,
    seat: { x: -0.36, y: 0.4, z: -0.2 }, seats: [{ x: 0.36, y: 0.4, z: -0.2 }, { x: 0.38, y: 0.42, z: -1.05 }],
    wheel: { x: -0.36, y: 0.86, z: 0.26, tilt: 1.1 },
  },
  taxi: {
    cls: 'taxi', name: 'Taxi',
    shape: { length: 4.85, width: 1.84, height: 1.48, clearance: 0.15, belt: 0.98, aBase: 0.98, aTop: 0.12, cTop: -1.08, cBase: -1.7, tumble: 0.2, noseRound: 0.5, tailRound: 0.4, noseY: 0.62, tailY: 0.92, doors: 2 },
    mech: { mass: 1650, cogH: 0.56, wheelbase: 2.85, track: 1.56, wheelR: 0.33, wheelW: 0.22, axleF: 1.45, axleR: -1.4, drive: 'rwd', torque: 330, torqueRpm: 3600, idle: 700, redline: 6000, gears: [3.4, 2.0, 1.35, 1.0, 0.78], final: 3.6, reverse: 3.3, grip: 0.92, offroad: 0.5, brake: 0.9, sag: 0.09, travel: 0.15, damping: 0.3, antiRoll: 0.35, lock: 0.64, cda: 0.7 },
    voice: { cyl: 6, rough: 0.3, whine: 0.2, turbo: 0, diesel: false, horn: 420 },
    paints: [0xd8a82a], livery: 'taxi',
    seat: { x: -0.38, y: 0.4, z: -0.3 }, seats: [{ x: 0.38, y: 0.4, z: -0.3 }, { x: 0.4, y: 0.42, z: -1.25 }, { x: -0.4, y: 0.42, z: -1.25 }],
    wheel: { x: -0.38, y: 0.86, z: 0.18, tilt: 1.1 },
  },
  police: {
    cls: 'police', name: 'Patrol car',
    shape: { length: 4.9, width: 1.88, height: 1.5, clearance: 0.16, belt: 0.99, aBase: 0.98, aTop: 0.12, cTop: -1.08, cBase: -1.7, tumble: 0.2, noseRound: 0.5, tailRound: 0.4, noseY: 0.64, tailY: 0.93, doors: 2 },
    mech: { mass: 1780, cogH: 0.55, wheelbase: 2.9, track: 1.6, wheelR: 0.34, wheelW: 0.24, axleF: 1.47, axleR: -1.43, drive: 'awd', torque: 470, torqueRpm: 4200, idle: 750, redline: 6800, gears: [3.5, 2.2, 1.5, 1.14, 0.87, 0.69], final: 3.4, reverse: 3.3, grip: 1.04, offroad: 0.6, brake: 1.05, sag: 0.065, travel: 0.14, damping: 0.4, antiRoll: 0.6, lock: 0.62, cda: 0.72 },
    voice: { cyl: 8, rough: 0.4, whine: 0.25, turbo: 0.3, diesel: false, horn: 460 },
    paints: [0x16181c], livery: 'police',
    seat: { x: -0.38, y: 0.4, z: -0.3 }, seats: [{ x: 0.38, y: 0.4, z: -0.3 }, { x: 0.4, y: 0.42, z: -1.25 }, { x: -0.4, y: 0.42, z: -1.25 }],
    wheel: { x: -0.38, y: 0.86, z: 0.18, tilt: 1.1 },
  },
  armoured: {
    cls: 'armoured', name: 'Armoured car',
    // Nothing here is shaped like a saloon, on purpose: a short, tall, wedged
    // hull with the beltline pushed up to chin height (so the glass is a slit),
    // one door per side, and enough ground clearance and tyre to be a bad idea
    // on a wet road. It should read as "not a patrol car" from a moving car.
    shape: { length: 5.4, width: 2.16, height: 2.06, clearance: 0.36, belt: 1.56, aBase: 1.52, aTop: 0.86, cTop: -1.94, cBase: -2.24, tumble: 0.02, noseRound: 0.08, tailRound: 0.03, noseY: 0.98, tailY: 1.92, doors: 1 },
    mech: { mass: 4250, cogH: 0.96, wheelbase: 3.1, track: 1.86, wheelR: 0.46, wheelW: 0.3, axleF: 1.62, axleR: -1.52, drive: 'awd', torque: 790, torqueRpm: 2600, idle: 600, redline: 4200, gears: [4.2, 2.6, 1.7, 1.2, 0.9, 0.7], final: 3.8, reverse: 3.8, grip: 1.12, offroad: 0.9, brake: 0.68, sag: 0.14, travel: 0.27, damping: 0.34, antiRoll: 0.45, lock: 0.5, cda: 1.45 },
    voice: { cyl: 6, rough: 0.85, whine: 0.05, turbo: 0.6, diesel: true, horn: 300 },
    paints: [0x6d7355],
    seat: { x: -0.5, y: 0.88, z: 0.72 }, seats: [{ x: 0.5, y: 0.88, z: 0.72 }, { x: 0.5, y: 0.9, z: -0.5 }, { x: -0.5, y: 0.9, z: -0.5 }],
    wheel: { x: -0.5, y: 1.36, z: 1.04, tilt: 1.0 },
  },
  pickup: {
    cls: 'pickup', name: 'Pickup',
    shape: { length: 5.4, width: 1.98, height: 1.86, clearance: 0.26, belt: 1.3, aBase: 1.25, aTop: 0.55, cTop: -0.5, cBase: -0.6, tumble: 0.14, noseRound: 0.25, tailRound: 0.05, noseY: 1.12, tailY: 1.1, bed: -0.72, doors: 2 },
    mech: { mass: 2150, cogH: 0.82, wheelbase: 3.3, track: 1.7, wheelR: 0.42, wheelW: 0.28, axleF: 1.75, axleR: -1.55, drive: 'rwd', torque: 560, torqueRpm: 3200, idle: 650, redline: 5600, gears: [4.0, 2.4, 1.55, 1.15, 0.85, 0.67], final: 3.55, reverse: 3.6, grip: 0.95, offroad: 0.85, brake: 0.85, sag: 0.11, travel: 0.22, damping: 0.28, antiRoll: 0.3, lock: 0.58, cda: 1.05 },
    voice: { cyl: 8, rough: 0.7, whine: 0.1, turbo: 0, diesel: false, horn: 360 },
    paints: [0x6a1a14, 0x1a1c20, 0xd4d0c8, 0x2a3a2a, 0x3a4a5a, 0x7a6a50],
    seat: { x: -0.4, y: 0.62, z: 0.1 }, seats: [{ x: 0.4, y: 0.62, z: 0.1 }, { x: 0.4, y: 0.64, z: -0.4 }],
    wheel: { x: -0.4, y: 1.12, z: 0.6, tilt: 1.2 },
  },
  van: {
    cls: 'van', name: 'Van',
    shape: { length: 5.1, width: 1.98, height: 2.1, clearance: 0.18, belt: 1.18, aBase: 1.6, aTop: 1.05, cTop: -2.5, cBase: -2.52, tumble: 0.06, noseRound: 0.35, tailRound: 0.02, noseY: 1.05, tailY: 1.9, doors: 1 },
    mech: { mass: 2300, cogH: 0.88, wheelbase: 3.25, track: 1.68, wheelR: 0.36, wheelW: 0.22, axleF: 1.7, axleR: -1.55, drive: 'fwd', torque: 330, torqueRpm: 2400, idle: 750, redline: 4800, gears: [3.9, 2.2, 1.4, 1.0, 0.78, 0.64], final: 4.0, reverse: 3.7, grip: 0.9, offroad: 0.55, brake: 0.8, sag: 0.1, travel: 0.17, damping: 0.3, antiRoll: 0.35, lock: 0.6, cda: 1.3 },
    voice: { cyl: 4, rough: 0.5, whine: 0.15, turbo: 0.5, diesel: true, horn: 400 },
    paints: [0xd8d4cc, 0x1c1f24, 0x2a3a4e, 0x5a5a60, 0x8a2a24],
    seat: { x: -0.42, y: 0.72, z: 1.0 }, seats: [{ x: 0.42, y: 0.72, z: 1.0 }],
    wheel: { x: -0.42, y: 1.18, z: 1.42, tilt: 0.95 },
  },
  ambulance: {
    cls: 'ambulance', name: 'Ambulance',
    shape: { length: 5.9, width: 2.08, height: 2.6, clearance: 0.2, belt: 1.25, aBase: 1.9, aTop: 1.35, cTop: 1.2, cBase: 1.2, tumble: 0.05, noseRound: 0.35, tailRound: 0.02, noseY: 1.1, tailY: 2.5, box: { from: 1.0, height: 2.6 }, doors: 1 },
    mech: { mass: 3500, cogH: 0.95, wheelbase: 3.7, track: 1.75, wheelR: 0.38, wheelW: 0.24, axleF: 2.0, axleR: -1.7, drive: 'rwd', torque: 470, torqueRpm: 2200, idle: 700, redline: 4600, gears: [4.2, 2.4, 1.5, 1.0, 0.75], final: 4.1, reverse: 3.8, grip: 0.88, offroad: 0.5, brake: 0.75, sag: 0.09, travel: 0.16, damping: 0.35, antiRoll: 0.95, lock: 0.56, cda: 2.1 },
    voice: { cyl: 6, rough: 0.5, whine: 0.2, turbo: 0.4, diesel: true, horn: 380 },
    paints: [0xe8e4dc], livery: 'ambulance',
    seat: { x: -0.44, y: 0.78, z: 1.3 }, seats: [{ x: 0.44, y: 0.78, z: 1.3 }],
    wheel: { x: -0.44, y: 1.24, z: 1.72, tilt: 0.95 },
  },
  truck: {
    cls: 'truck', name: 'Box truck',
    shape: { length: 8.4, width: 2.45, height: 3.4, clearance: 0.32, belt: 1.75, aBase: 3.95, aTop: 3.7, cTop: 2.4, cBase: 2.4, tumble: 0.04, noseRound: 0.15, tailRound: 0.0, noseY: 1.6, tailY: 3.4, box: { from: 2.2, height: 3.4 }, doors: 1 },
    mech: { mass: 9500, cogH: 1.35, wheelbase: 5.2, track: 2.0, wheelR: 0.52, wheelW: 0.32, axleF: 3.0, axleR: -2.2, extraAxles: [-3.4], drive: 'rwd', torque: 1650, torqueRpm: 1400, idle: 600, redline: 2600, gears: [7.0, 4.8, 3.4, 2.4, 1.7, 1.25, 1.0, 0.78], final: 4.4, reverse: 6.5, grip: 0.82, offroad: 0.55, brake: 0.6, sag: 0.09, travel: 0.16, damping: 0.4, antiRoll: 0.6, lock: 0.52, cda: 6.5 },
    voice: { cyl: 6, rough: 0.8, whine: 0.1, turbo: 0.7, diesel: true, horn: 190 },
    paints: [0xd8d4cc, 0x2a3a4e, 0x8a2a24, 0x3a4a3a],
    seat: { x: -0.55, y: 1.3, z: 3.1 }, seats: [{ x: 0.55, y: 1.3, z: 3.1 }],
    wheel: { x: -0.55, y: 1.8, z: 3.55, tilt: 0.7 },
  },
  bus: {
    cls: 'bus', name: 'Bus',
    shape: { length: 11.5, width: 2.5, height: 3.1, clearance: 0.3, belt: 1.25, aBase: 5.55, aTop: 5.5, cTop: -5.6, cBase: -5.62, tumble: 0.02, noseRound: 0.1, tailRound: 0.05, noseY: 1.2, tailY: 3.05, doors: 1 },
    mech: { mass: 12500, cogH: 1.2, wheelbase: 6.1, track: 2.1, wheelR: 0.5, wheelW: 0.3, axleF: 3.6, axleR: -2.5, drive: 'rwd', torque: 1500, torqueRpm: 1300, idle: 600, redline: 2400, gears: [4.2, 2.4, 1.6, 1.15, 0.9, 0.72], final: 5.5, reverse: 5.0, grip: 0.8, offroad: 0.4, brake: 0.55, sag: 0.1, travel: 0.15, damping: 0.45, antiRoll: 0.7, lock: 0.6, cda: 7.0 },
    voice: { cyl: 6, rough: 0.7, whine: 0.25, turbo: 0.6, diesel: true, horn: 230 },
    paints: [0x8a2a24, 0x2a4a6a, 0xd8a82a],
    seat: { x: -0.7, y: 1.05, z: 4.7 }, seats: [],
    wheel: { x: -0.7, y: 1.55, z: 5.05, tilt: 0.5 },
  },
  offroad: {
    cls: 'offroad', name: '4×4',
    shape: { length: 4.6, width: 1.95, height: 1.95, clearance: 0.3, belt: 1.32, aBase: 1.05, aTop: 0.72, cTop: -1.9, cBase: -1.95, tumble: 0.08, noseRound: 0.15, tailRound: 0.05, noseY: 1.15, tailY: 1.3, doors: 2 },
    mech: { mass: 2250, cogH: 0.88, wheelbase: 2.9, track: 1.66, wheelR: 0.43, wheelW: 0.3, axleF: 1.45, axleR: -1.45, drive: 'awd', torque: 520, torqueRpm: 2600, idle: 700, redline: 5200, gears: [4.3, 2.5, 1.6, 1.2, 1.0, 0.8], final: 3.9, reverse: 4.0, grip: 0.92, offroad: 1.0, brake: 0.85, sag: 0.13, travel: 0.28, damping: 0.3, antiRoll: 0.3, lock: 0.6, cda: 1.15 },
    voice: { cyl: 6, rough: 0.6, whine: 0.1, turbo: 0.5, diesel: true, horn: 380 },
    paints: [0x3a4a3a, 0x6a5a3a, 0x1a1c20, 0xd4d0c8, 0x5a2a1e],
    seat: { x: -0.4, y: 0.66, z: -0.15 }, seats: [{ x: 0.4, y: 0.66, z: -0.15 }, { x: 0.4, y: 0.68, z: -1.0 }],
    wheel: { x: -0.4, y: 1.16, z: 0.32, tilt: 1.15 },
  },
  motorcycle: {
    cls: 'motorcycle', name: 'Motorcycle',
    shape: { length: 2.15, width: 0.8, height: 1.15, clearance: 0.14, belt: 0.95, aBase: 0.5, aTop: 0.5, cTop: -0.9, cBase: -0.9, tumble: 0, noseRound: 0.8, tailRound: 0.8, noseY: 0.95, tailY: 0.85, doors: 1 },
    mech: { mass: 250, cogH: 0.6, wheelbase: 1.45, track: 0.3, wheelR: 0.31, wheelW: 0.16, axleF: 0.72, axleR: -0.73, drive: 'rwd', torque: 105, torqueRpm: 8500, idle: 1300, redline: 11500, gears: [2.8, 2.05, 1.65, 1.38, 1.2, 1.08], final: 5.0, reverse: 0, grip: 1.1, offroad: 0.5, brake: 1.0, sag: 0.05, travel: 0.13, damping: 0.4, antiRoll: 0.9, lock: 0.5, cda: 0.45, bike: true },
    voice: { cyl: 2, rough: 0.75, whine: 0.25, turbo: 0, diesel: false, horn: 600 },
    paints: [0x121214, 0x8a1a14, 0x1e3a6a, 0xc8c4bc],
    seat: { x: 0, y: 0.52, z: -0.2 }, seats: [],
    wheel: { x: 0, y: 1.0, z: 0.45, tilt: 0.4 },
  },
  suv: {
    cls: 'suv', name: 'SUV',
    shape: { length: 4.78, width: 1.96, height: 1.76, clearance: 0.22, belt: 1.13, aBase: 1.02, aTop: 0.3, cTop: -1.62, cBase: -1.98, tumble: 0.12, noseRound: 0.42, tailRound: 0.12, noseY: 0.98, tailY: 1.16, doors: 2 },
    mech: { mass: 2050, cogH: 0.74, wheelbase: 2.86, track: 1.66, wheelR: 0.39, wheelW: 0.26, axleF: 1.45, axleR: -1.41, drive: 'awd', torque: 420, torqueRpm: 3600, idle: 700, redline: 6200, gears: [4.0, 2.4, 1.6, 1.2, 1.0, 0.8, 0.66], final: 3.5, reverse: 3.6, grip: 0.96, offroad: 0.75, brake: 0.9, sag: 0.1, travel: 0.2, damping: 0.32, antiRoll: 0.5, lock: 0.6, cda: 1.0 },
    voice: { cyl: 6, rough: 0.35, whine: 0.2, turbo: 0.4, diesel: false, horn: 420 },
    paints: [0x1c1f24, 0xd4d0c8, 0x2a3a4e, 0x5a5a60, 0x3d4a3a, 0x6b1e1e],
    seat: { x: -0.4, y: 0.6, z: -0.15 }, seats: [{ x: 0.4, y: 0.6, z: -0.15 }, { x: 0.42, y: 0.62, z: -1.05 }, { x: -0.42, y: 0.62, z: -1.05 }],
    wheel: { x: -0.4, y: 1.08, z: 0.3, tilt: 1.12 },
  },
  estate: {
    cls: 'estate', name: 'Estate',
    shape: { length: 4.85, width: 1.84, height: 1.5, clearance: 0.15, belt: 0.98, aBase: 0.96, aTop: 0.12, cTop: -1.86, cBase: -2.12, tumble: 0.16, noseRound: 0.55, tailRound: 0.15, noseY: 0.64, tailY: 0.98, doors: 2 },
    mech: { mass: 1600, cogH: 0.56, wheelbase: 2.84, track: 1.56, wheelR: 0.33, wheelW: 0.22, axleF: 1.44, axleR: -1.4, drive: 'fwd', torque: 320, torqueRpm: 2000, idle: 750, redline: 5000, gears: [3.7, 2.1, 1.35, 1.0, 0.8, 0.66], final: 3.6, reverse: 3.4, grip: 0.96, offroad: 0.55, brake: 0.92, sag: 0.08, travel: 0.15, damping: 0.33, antiRoll: 0.42, lock: 0.62, cda: 0.7 },
    voice: { cyl: 4, rough: 0.45, whine: 0.2, turbo: 0.45, diesel: true, horn: 440 },
    paints: CAR_PAINTS,
    seat: { x: -0.38, y: 0.4, z: -0.3 }, seats: [{ x: 0.38, y: 0.4, z: -0.3 }, { x: 0.4, y: 0.42, z: -1.2 }, { x: -0.4, y: 0.42, z: -1.2 }],
    wheel: { x: -0.38, y: 0.86, z: 0.18, tilt: 1.1 },
  },
  muscle: {
    cls: 'muscle', name: 'Muscle car',
    shape: { length: 4.9, width: 1.94, height: 1.32, clearance: 0.13, belt: 0.9, aBase: 0.5, aTop: -0.28, cTop: -0.98, cBase: -1.6, tumble: 0.22, noseRound: 0.28, tailRound: 0.28, noseY: 0.8, tailY: 0.88, doors: 1 },
    mech: { mass: 1700, cogH: 0.5, wheelbase: 2.78, track: 1.6, wheelR: 0.36, wheelW: 0.3, axleF: 1.5, axleR: -1.28, drive: 'rwd', torque: 640, torqueRpm: 4200, idle: 750, redline: 6500, gears: [2.9, 1.95, 1.4, 1.1, 0.88, 0.72], final: 3.55, reverse: 3.0, grip: 1.02, offroad: 0.45, brake: 0.92, sag: 0.07, travel: 0.13, damping: 0.34, antiRoll: 0.5, lock: 0.58, cda: 0.78 },
    voice: { cyl: 8, rough: 0.9, whine: 0.08, turbo: 0, diesel: false, horn: 380 },
    paints: [0x1a2a4a, 0x8a5a14, 0x121214, 0x5a1414, 0x2a4a2a, 0xc8c4bc],
    seat: { x: -0.4, y: 0.32, z: -0.4 }, seats: [{ x: 0.4, y: 0.32, z: -0.4 }],
    wheel: { x: -0.4, y: 0.76, z: 0.08, tilt: 1.15 },
  },
  roadster: {
    cls: 'roadster', name: 'Roadster',
    shape: { length: 4.0, width: 1.76, height: 1.18, clearance: 0.12, belt: 0.82, aBase: 0.45, aTop: -0.15, cTop: -0.75, cBase: -1.2, tumble: 0.3, noseRound: 0.8, tailRound: 0.65, noseY: 0.58, tailY: 0.78, doors: 1, open: true },
    mech: { mass: 1080, cogH: 0.42, wheelbase: 2.32, track: 1.5, wheelR: 0.32, wheelW: 0.22, axleF: 1.22, axleR: -1.1, drive: 'rwd', torque: 210, torqueRpm: 4800, idle: 850, redline: 7400, gears: [3.4, 2.1, 1.5, 1.15, 1.0, 0.84], final: 3.9, reverse: 3.3, grip: 1.08, offroad: 0.4, brake: 1.05, sag: 0.05, travel: 0.11, damping: 0.4, antiRoll: 0.7, lock: 0.64, cda: 0.55 },
    voice: { cyl: 4, rough: 0.55, whine: 0.25, turbo: 0, diesel: false, horn: 540 },
    paints: [0x8a1a14, 0x1e3a6a, 0xd8d4cc, 0x2a4a2a, 0x121214],
    seat: { x: -0.34, y: 0.28, z: -0.3 }, seats: [{ x: 0.34, y: 0.28, z: -0.3 }],
    wheel: { x: -0.34, y: 0.68, z: 0.15, tilt: 1.15 },
  },
  limo: {
    cls: 'limo', name: 'Limousine',
    shape: { length: 6.3, width: 1.9, height: 1.48, clearance: 0.15, belt: 0.98, aBase: 1.45, aTop: 0.65, cTop: -2.0, cBase: -2.55, tumble: 0.18, noseRound: 0.5, tailRound: 0.45, noseY: 0.66, tailY: 0.94, doors: 2 },
    mech: { mass: 2600, cogH: 0.56, wheelbase: 4.2, track: 1.6, wheelR: 0.35, wheelW: 0.24, axleF: 2.05, axleR: -2.15, drive: 'rwd', torque: 520, torqueRpm: 3800, idle: 650, redline: 6000, gears: [3.5, 2.2, 1.5, 1.1, 0.85, 0.7], final: 3.2, reverse: 3.3, grip: 0.92, offroad: 0.45, brake: 0.85, sag: 0.08, travel: 0.14, damping: 0.36, antiRoll: 0.5, lock: 0.55, cda: 0.82 },
    voice: { cyl: 8, rough: 0.2, whine: 0.15, turbo: 0, diesel: false, horn: 400 },
    paints: [0x0e0e10, 0xd8d4cc, 0x1c1f24],
    seat: { x: -0.4, y: 0.4, z: 0.85 }, seats: [{ x: 0.4, y: 0.4, z: 0.85 }, { x: 0.45, y: 0.42, z: -1.6 }, { x: -0.45, y: 0.42, z: -1.6 }],
    wheel: { x: -0.4, y: 0.86, z: 1.33, tilt: 1.1 },
  },
  city: {
    cls: 'city', name: 'City car',
    shape: { length: 2.95, width: 1.62, height: 1.56, clearance: 0.13, belt: 0.95, aBase: 0.68, aTop: 0.15, cTop: -1.12, cBase: -1.38, tumble: 0.16, noseRound: 0.72, tailRound: 0.12, noseY: 0.7, tailY: 1.0, doors: 1 },
    mech: { mass: 880, cogH: 0.55, wheelbase: 1.9, track: 1.38, wheelR: 0.29, wheelW: 0.17, axleF: 0.98, axleR: -0.92, drive: 'rwd', torque: 120, torqueRpm: 3200, idle: 850, redline: 6400, gears: [3.6, 2.1, 1.4, 1.0, 0.82], final: 4.3, reverse: 3.5, grip: 0.9, offroad: 0.45, brake: 0.9, sag: 0.08, travel: 0.12, damping: 0.32, antiRoll: 0.35, lock: 0.72, cda: 0.6 },
    voice: { cyl: 3, rough: 0.4, whine: 0.4, turbo: 0.2, diesel: false, horn: 560 },
    paints: [0xd8d0b8, 0x4a8a8a, 0xb8443a, 0xe0c060, 0x1c1f24, 0x8aa0b8],
    seat: { x: -0.32, y: 0.4, z: -0.3 }, seats: [{ x: 0.32, y: 0.4, z: -0.3 }],
    wheel: { x: -0.32, y: 0.86, z: 0.16, tilt: 1.05 },
  },
  firetruck: {
    cls: 'firetruck', name: 'Fire engine',
    shape: { length: 9.2, width: 2.5, height: 3.1, clearance: 0.3, belt: 1.7, aBase: 4.35, aTop: 4.1, cTop: 2.0, cBase: 2.0, tumble: 0.04, noseRound: 0.12, tailRound: 0.0, noseY: 1.55, tailY: 2.9, box: { from: 1.9, height: 2.9 }, doors: 2 },
    mech: { mass: 14500, cogH: 1.3, wheelbase: 5.0, track: 2.05, wheelR: 0.54, wheelW: 0.34, axleF: 3.0, axleR: -2.0, extraAxles: [-3.3], drive: 'rwd', torque: 1900, torqueRpm: 1400, idle: 600, redline: 2600, gears: [6.5, 4.4, 3.0, 2.1, 1.5, 1.15, 0.9], final: 4.6, reverse: 6.2, grip: 0.84, offroad: 0.55, brake: 0.62, sag: 0.08, travel: 0.15, damping: 0.42, antiRoll: 0.7, lock: 0.5, cda: 7.0 },
    voice: { cyl: 6, rough: 0.85, whine: 0.1, turbo: 0.7, diesel: true, horn: 170 },
    paints: [0xa8140e], livery: 'fire',
    seat: { x: -0.6, y: 1.3, z: 3.5 }, seats: [{ x: 0.6, y: 1.3, z: 3.5 }, { x: 0.6, y: 1.3, z: 2.6 }, { x: -0.6, y: 1.3, z: 2.6 }],
    wheel: { x: -0.6, y: 1.8, z: 3.95, tilt: 0.7 },
  },
  refuse: {
    cls: 'refuse', name: 'Refuse truck',
    shape: { length: 9.0, width: 2.5, height: 3.4, clearance: 0.32, belt: 1.75, aBase: 4.2, aTop: 3.95, cTop: 2.6, cBase: 2.6, tumble: 0.04, noseRound: 0.12, tailRound: 0.0, noseY: 1.6, tailY: 3.3, box: { from: 2.4, height: 3.35 }, doors: 1 },
    mech: { mass: 16000, cogH: 1.4, wheelbase: 4.6, track: 2.05, wheelR: 0.54, wheelW: 0.34, axleF: 2.9, axleR: -1.7, extraAxles: [-3.0], drive: 'rwd', torque: 1800, torqueRpm: 1300, idle: 600, redline: 2400, gears: [7.0, 4.8, 3.3, 2.3, 1.6, 1.2], final: 4.8, reverse: 6.5, grip: 0.8, offroad: 0.5, brake: 0.58, sag: 0.09, travel: 0.15, damping: 0.42, antiRoll: 0.7, lock: 0.52, cda: 7.2 },
    voice: { cyl: 6, rough: 0.9, whine: 0.15, turbo: 0.6, diesel: true, horn: 180 },
    paints: [0x2e5a32, 0xd8d4cc, 0xc8a020],
    seat: { x: -0.6, y: 1.32, z: 3.4 }, seats: [{ x: 0.6, y: 1.32, z: 3.4 }],
    wheel: { x: -0.6, y: 1.82, z: 3.85, tilt: 0.7 },
  },
};

/** The old city names for kinds of car, to a class. */
export function classFor(kind: string | undefined, van = false): VehicleClass {
  if (kind && kind in SPECS) return kind as VehicleClass;
  if (kind === 'hatchback') return 'hatch';
  if (kind === 'moto') return 'motorcycle';
  return van ? 'van' : 'sedan';
}
