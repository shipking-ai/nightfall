/**
 * WARZONE's arsenal: every gun and blade in NIGHTFALL's shooter, all
 * original. Each is a role, not a reskin: what it's for decides its rate,
 * recoil (how hard and which way it climbs), handling (how fast it aims and
 * how it moves), reach (where its damage falls away), reloads (a tactical
 * one with a round still chambered, a slower one from empty), how it fires
 * (automatic, a burst, one pull at a time, a bolt or a pump to work) and
 * what it sounds like.
 *
 * Numbers: damage per hit to a 100-health body (armour soaks some), rpm,
 * seconds, metres, radians of spread, m/s of bullet (0 = arrives at once).
 */

export type WeaponClass = 'ar' | 'br' | 'smg' | 'pdw' | 'shotgun' | 'sniper' | 'dmr' | 'lmg' | 'pistol' | 'revolver' | 'launcher' | 'melee';
export type FireMode = 'auto' | 'semi' | 'burst' | 'bolt' | 'pump' | 'lever' | 'single' | 'swing';

export const CLASS_NAMES: Record<WeaponClass, string> = {
  ar: 'Assault rifles', br: 'Battle rifles', smg: 'Submachine guns', pdw: 'Personal defence', shotgun: 'Shotguns', sniper: 'Sniper rifles',
  dmr: 'Marksman rifles', lmg: 'Machine guns', pistol: 'Pistols', revolver: 'Revolvers', launcher: 'Launchers', melee: 'Melee',
};

/** How a gun is shaped (for its model): lengths in metres along the gun, and a few choices. */
export interface Look {
  receiver: number;
  barrel: number;
  stock: 'none' | 'fixed' | 'folding' | 'skeleton' | 'thumbhole' | 'wood';
  mag: 'box' | 'curved' | 'drum' | 'tube' | 'top' | 'belt' | 'cylinder' | 'none' | 'grip';
  handguard: number;
  /** bullpup: the magazine behind the grip */
  bullpup?: boolean;
  /** body colour tint (a wood furniture, a tan polymer) */
  tone?: 'black' | 'tan' | 'wood' | 'grey' | 'green';
  /** a scope that's part of the gun (sniper rifles) */
  scope?: boolean;
  /** bore size (visual) */
  bore: number;
}

export interface Weapon {
  id: string;
  name: string;
  cls: WeaponClass;
  desc: string;
  mode: FireMode;
  /** rounds per burst */
  burst?: number;
  /** body damage near, and at the far end of the range */
  dmg: number;
  falloff: number;
  range: [number, number];
  head: number;
  limb: number;
  pellets: number;
  rpm: number;
  mag: number;
  reserve: number;
  reload: number;
  reloadEmpty: number;
  /** load one at a time (tube shotguns, revolvers with a loader do it all at once) */
  single?: boolean;
  /** seconds to aim down the sights */
  ads: number;
  /** seconds from sprinting to firing */
  sprintFire: number;
  /** move speed multiplier */
  move: number;
  /** spread at the hip and aimed (radians), bloom added per shot */
  hip: number;
  aim: number;
  bloom: number;
  /** recoil per shot (radians): vertical, horizontal amount and which way it tends (-1 left … 1 right) */
  kick: number;
  kickH: number;
  bias: number;
  /** how fast recoil recovers after you stop firing (per second) */
  recover: number;
  /** bullet speed (m/s), 0 = hitscan */
  velocity: number;
  /** what it can shoot through (0 nothing … 1 thin walls and people) */
  pen: number;
  /** aimed field of view (degrees) with its own sights */
  zoom: number;
  /** explosive: blast radius (m) and damage at the centre */
  blast?: number;
  blastDmg?: number;
  /** sound: calibre weight 0..1 (a pistol 0.2, a .50 1), and the character of the report */
  caliber: number;
  report: 'crack' | 'boom' | 'snap' | 'thump' | 'whump' | 'none';
  look: Look;
  /** player level it unlocks at */
  level: number;
}

const W = (w: Weapon) => w;

export const WEAPONS: Weapon[] = [
  /* ── assault rifles: the middle of everything ── */
  W({ id: 'carbine', name: 'KV-9 Vanta', cls: 'ar', desc: 'The rifle everyone learns on. Steady climb, honest at every range.', mode: 'auto', dmg: 25, falloff: 0.72, range: [32, 75], head: 1.45, limb: 0.9, pellets: 1, rpm: 690, mag: 30, reserve: 150, reload: 2.0, reloadEmpty: 2.6, ads: 0.25, sprintFire: 0.24, move: 0.93, hip: 0.036, aim: 0.0035, bloom: 0.003, kick: 0.0105, kickH: 0.0045, bias: 0.15, recover: 0.12, velocity: 0, pen: 0.4, zoom: 46, caliber: 0.5, report: 'crack', look: { receiver: 0.4, barrel: 0.34, stock: 'folding', mag: 'curved', handguard: 0.3, bore: 0.009 }, level: 1 }),
  W({ id: 'kestrel', name: 'K4 Kestrel', cls: 'ar', desc: 'Short, light and quick to the sights. Loses the long lanes.', mode: 'auto', dmg: 23, falloff: 0.65, range: [26, 60], head: 1.4, limb: 0.9, pellets: 1, rpm: 780, mag: 30, reserve: 150, reload: 1.85, reloadEmpty: 2.4, ads: 0.21, sprintFire: 0.2, move: 0.96, hip: 0.032, aim: 0.0045, bloom: 0.003, kick: 0.0095, kickH: 0.0055, bias: -0.2, recover: 0.14, velocity: 0, pen: 0.35, zoom: 48, caliber: 0.45, report: 'crack', look: { receiver: 0.36, barrel: 0.26, stock: 'skeleton', mag: 'box', handguard: 0.24, tone: 'tan', bore: 0.009 }, level: 4 }),
  W({ id: 'halden', name: 'HR-762 Halden', cls: 'ar', desc: 'A heavier round. Four to the body where others take five, if you can hold it down.', mode: 'auto', dmg: 32, falloff: 0.75, range: [38, 85], head: 1.5, limb: 0.9, pellets: 1, rpm: 560, mag: 25, reserve: 125, reload: 2.2, reloadEmpty: 2.9, ads: 0.29, sprintFire: 0.27, move: 0.9, hip: 0.04, aim: 0.0032, bloom: 0.004, kick: 0.016, kickH: 0.006, bias: 0.35, recover: 0.1, velocity: 0, pen: 0.6, zoom: 44, caliber: 0.7, report: 'crack', look: { receiver: 0.44, barrel: 0.38, stock: 'fixed', mag: 'curved', handguard: 0.32, tone: 'wood', bore: 0.01 }, level: 9 }),
  W({ id: 'ferro', name: 'BX-5 Ferro', cls: 'ar', desc: 'Bullpup: a full barrel in a short gun. Fast fire, fast climb.', mode: 'auto', dmg: 22, falloff: 0.7, range: [30, 70], head: 1.4, limb: 0.9, pellets: 1, rpm: 900, mag: 30, reserve: 150, reload: 2.4, reloadEmpty: 3.0, ads: 0.24, sprintFire: 0.22, move: 0.94, hip: 0.034, aim: 0.004, bloom: 0.004, kick: 0.012, kickH: 0.007, bias: 0, recover: 0.12, velocity: 0, pen: 0.4, zoom: 46, caliber: 0.45, report: 'crack', look: { receiver: 0.5, barrel: 0.2, stock: 'none', mag: 'box', handguard: 0.22, bullpup: true, tone: 'grey', bore: 0.009 }, level: 14 }),
  W({ id: 'tern', name: 'AR-12 Tern', cls: 'ar', desc: 'Three-round bursts, very little climb between them. Reward for rhythm.', mode: 'burst', burst: 3, dmg: 29, falloff: 0.78, range: [40, 90], head: 1.5, limb: 0.9, pellets: 1, rpm: 900, mag: 30, reserve: 150, reload: 2.1, reloadEmpty: 2.7, ads: 0.26, sprintFire: 0.24, move: 0.93, hip: 0.035, aim: 0.003, bloom: 0.002, kick: 0.008, kickH: 0.003, bias: 0.1, recover: 0.16, velocity: 0, pen: 0.45, zoom: 45, caliber: 0.5, report: 'crack', look: { receiver: 0.42, barrel: 0.36, stock: 'fixed', mag: 'box', handguard: 0.34, tone: 'green', bore: 0.009 }, level: 20 }),
  /* ── battle rifles ── */
  W({ id: 'sentinel', name: 'BR-30 Sentinel', cls: 'br', desc: 'Semi-automatic, full-power rounds. Three to put someone down, if you place them.', mode: 'semi', dmg: 45, falloff: 0.85, range: [50, 110], head: 1.6, limb: 0.9, pellets: 1, rpm: 400, mag: 20, reserve: 100, reload: 2.3, reloadEmpty: 3.0, ads: 0.3, sprintFire: 0.28, move: 0.9, hip: 0.045, aim: 0.0022, bloom: 0.008, kick: 0.021, kickH: 0.004, bias: 0.2, recover: 0.3, velocity: 0, pen: 0.7, zoom: 42, caliber: 0.75, report: 'crack', look: { receiver: 0.46, barrel: 0.44, stock: 'fixed', mag: 'box', handguard: 0.36, tone: 'black', bore: 0.011 }, level: 6 }),
  W({ id: 'graves', name: 'Graves 3-R', cls: 'br', desc: 'A three-round burst of full-power rounds: one burst to the chest and a follow-up.', mode: 'burst', burst: 3, dmg: 34, falloff: 0.8, range: [45, 95], head: 1.5, limb: 0.9, pellets: 1, rpm: 720, mag: 24, reserve: 120, reload: 2.4, reloadEmpty: 3.1, ads: 0.31, sprintFire: 0.29, move: 0.9, hip: 0.044, aim: 0.0028, bloom: 0.004, kick: 0.013, kickH: 0.005, bias: -0.25, recover: 0.2, velocity: 0, pen: 0.65, zoom: 43, caliber: 0.7, report: 'crack', look: { receiver: 0.46, barrel: 0.4, stock: 'thumbhole', mag: 'box', handguard: 0.34, tone: 'tan', bore: 0.011 }, level: 17 }),
  W({ id: 'harrow', name: 'HW-14 Harrow', cls: 'br', desc: 'Old wood, new barrel. Fully automatic and hard to hold, deadly if you can.', mode: 'auto', dmg: 38, falloff: 0.82, range: [45, 100], head: 1.5, limb: 0.9, pellets: 1, rpm: 600, mag: 20, reserve: 100, reload: 2.5, reloadEmpty: 3.2, ads: 0.32, sprintFire: 0.3, move: 0.88, hip: 0.05, aim: 0.003, bloom: 0.006, kick: 0.022, kickH: 0.009, bias: 0.4, recover: 0.1, velocity: 0, pen: 0.7, zoom: 43, caliber: 0.75, report: 'crack', look: { receiver: 0.5, barrel: 0.46, stock: 'wood', mag: 'box', handguard: 0.4, tone: 'wood', bore: 0.011 }, level: 25 }),
  /* ── submachine guns ── */
  W({ id: 'smg', name: 'Wisp 9', cls: 'smg', desc: 'Very fast, very light. It wins the doorway and loses the street.', mode: 'auto', dmg: 19, falloff: 0.55, range: [12, 34], head: 1.3, limb: 0.95, pellets: 1, rpm: 950, mag: 32, reserve: 192, reload: 1.7, reloadEmpty: 2.2, ads: 0.18, sprintFire: 0.14, move: 1.0, hip: 0.026, aim: 0.01, bloom: 0.003, kick: 0.0075, kickH: 0.0065, bias: 0.05, recover: 0.18, velocity: 0, pen: 0.2, zoom: 52, caliber: 0.3, report: 'snap', look: { receiver: 0.3, barrel: 0.12, stock: 'folding', mag: 'box', handguard: 0.14, bore: 0.007 }, level: 1 }),
  W({ id: 'keel', name: 'Keel 45', cls: 'smg', desc: 'Slow, heavy rounds. Fewer of them, harder hits, easy to hold.', mode: 'auto', dmg: 27, falloff: 0.55, range: [14, 36], head: 1.3, limb: 0.95, pellets: 1, rpm: 640, mag: 25, reserve: 150, reload: 1.9, reloadEmpty: 2.4, ads: 0.2, sprintFire: 0.16, move: 0.98, hip: 0.028, aim: 0.009, bloom: 0.003, kick: 0.009, kickH: 0.004, bias: -0.1, recover: 0.2, velocity: 0, pen: 0.25, zoom: 52, caliber: 0.4, report: 'thump', look: { receiver: 0.34, barrel: 0.14, stock: 'fixed', mag: 'box', handguard: 0.16, tone: 'grey', bore: 0.011 }, level: 5 }),
  W({ id: 'hornet', name: 'Hornet PX', cls: 'smg', desc: 'A delayed-recoil design: absurd rate, recoil that goes straight down into the grip.', mode: 'auto', dmg: 18, falloff: 0.5, range: [10, 30], head: 1.3, limb: 0.95, pellets: 1, rpm: 1150, mag: 30, reserve: 180, reload: 1.8, reloadEmpty: 2.3, ads: 0.19, sprintFire: 0.15, move: 0.99, hip: 0.028, aim: 0.011, bloom: 0.004, kick: 0.006, kickH: 0.0035, bias: 0, recover: 0.2, velocity: 0, pen: 0.2, zoom: 52, caliber: 0.3, report: 'snap', look: { receiver: 0.36, barrel: 0.12, stock: 'skeleton', mag: 'box', handguard: 0.12, tone: 'black', bore: 0.008 }, level: 12 }),
  W({ id: 'mako', name: 'Mako SD', cls: 'smg', desc: 'Built suppressed. Quiet, off the enemy’s radar, a little shorter-legged.', mode: 'auto', dmg: 20, falloff: 0.5, range: [10, 28], head: 1.3, limb: 0.95, pellets: 1, rpm: 800, mag: 30, reserve: 180, reload: 1.9, reloadEmpty: 2.4, ads: 0.21, sprintFire: 0.16, move: 0.98, hip: 0.027, aim: 0.01, bloom: 0.003, kick: 0.0065, kickH: 0.0045, bias: 0.15, recover: 0.2, velocity: 0, pen: 0.2, zoom: 52, caliber: 0.3, report: 'none', look: { receiver: 0.32, barrel: 0.26, stock: 'folding', mag: 'curved', handguard: 0.26, tone: 'black', bore: 0.012 }, level: 22 }),
  W({ id: 'parr', name: 'Parr 5.7', cls: 'smg', desc: 'A 50-round top-loaded magazine. Keeps firing when everyone else is reloading.', mode: 'auto', dmg: 18, falloff: 0.6, range: [14, 38], head: 1.35, limb: 0.95, pellets: 1, rpm: 860, mag: 50, reserve: 200, reload: 2.5, reloadEmpty: 3.1, ads: 0.22, sprintFire: 0.17, move: 0.97, hip: 0.029, aim: 0.009, bloom: 0.003, kick: 0.007, kickH: 0.004, bias: -0.1, recover: 0.18, velocity: 0, pen: 0.35, zoom: 50, caliber: 0.3, report: 'snap', look: { receiver: 0.42, barrel: 0.1, stock: 'none', mag: 'top', handguard: 0.2, bullpup: true, tone: 'tan', bore: 0.007 }, level: 28 }),
  /* ── personal defence ── */
  W({ id: 'kite', name: 'Kite PDW', cls: 'pdw', desc: 'Between a pistol and an SMG: small enough to sprint with, rifle-ish round.', mode: 'auto', dmg: 21, falloff: 0.62, range: [16, 42], head: 1.35, limb: 0.9, pellets: 1, rpm: 820, mag: 30, reserve: 150, reload: 1.8, reloadEmpty: 2.3, ads: 0.19, sprintFire: 0.15, move: 0.99, hip: 0.028, aim: 0.007, bloom: 0.003, kick: 0.0085, kickH: 0.0045, bias: 0.2, recover: 0.16, velocity: 0, pen: 0.4, zoom: 50, caliber: 0.35, report: 'crack', look: { receiver: 0.32, barrel: 0.16, stock: 'folding', mag: 'grip', handguard: 0.18, tone: 'grey', bore: 0.007 }, level: 10 }),
  W({ id: 'carrow', name: 'Carrow 5.7', cls: 'pdw', desc: 'A 40-round PDW with a low bore. Almost no muzzle climb.', mode: 'auto', dmg: 19, falloff: 0.65, range: [18, 45], head: 1.35, limb: 0.9, pellets: 1, rpm: 780, mag: 40, reserve: 160, reload: 2.1, reloadEmpty: 2.6, ads: 0.2, sprintFire: 0.16, move: 0.98, hip: 0.029, aim: 0.0065, bloom: 0.002, kick: 0.0055, kickH: 0.004, bias: -0.3, recover: 0.2, velocity: 0, pen: 0.45, zoom: 50, caliber: 0.3, report: 'crack', look: { receiver: 0.4, barrel: 0.12, stock: 'none', mag: 'top', handguard: 0.2, bullpup: true, tone: 'green', bore: 0.006 }, level: 24 }),
  /* ── shotguns ── */
  W({ id: 'shotgun', name: 'Warden 12', cls: 'shotgun', desc: 'Pump-action. One shell ends a doorway argument. Loads one at a time.', mode: 'pump', dmg: 16, falloff: 0.18, range: [7, 22], head: 1.2, limb: 1, pellets: 8, rpm: 70, mag: 6, reserve: 36, reload: 0.5, reloadEmpty: 0.5, single: true, ads: 0.24, sprintFire: 0.2, move: 0.93, hip: 0.07, aim: 0.052, bloom: 0, kick: 0.05, kickH: 0.01, bias: 0, recover: 0.5, velocity: 0, pen: 0.1, zoom: 54, caliber: 0.8, report: 'boom', look: { receiver: 0.34, barrel: 0.46, stock: 'fixed', mag: 'tube', handguard: 0.16, tone: 'black', bore: 0.018 }, level: 1 }),
  W({ id: 'ashgrove', name: 'Ashgrove Semi', cls: 'shotgun', desc: 'Semi-automatic. Two shots faster than a pump, a little less in each.', mode: 'semi', dmg: 13, falloff: 0.2, range: [6, 20], head: 1.2, limb: 1, pellets: 8, rpm: 220, mag: 8, reserve: 40, reload: 0.45, reloadEmpty: 0.45, single: true, ads: 0.26, sprintFire: 0.22, move: 0.92, hip: 0.075, aim: 0.058, bloom: 0.01, kick: 0.04, kickH: 0.012, bias: 0.3, recover: 0.4, velocity: 0, pen: 0.1, zoom: 54, caliber: 0.75, report: 'boom', look: { receiver: 0.4, barrel: 0.44, stock: 'fixed', mag: 'tube', handguard: 0.2, tone: 'tan', bore: 0.018 }, level: 11 }),
  W({ id: 'twinbore', name: 'Twinbore', cls: 'shotgun', desc: 'Two barrels, two chances, then a long reload. Devastating up close.', mode: 'semi', dmg: 20, falloff: 0.15, range: [6, 18], head: 1.2, limb: 1, pellets: 9, rpm: 300, mag: 2, reserve: 30, reload: 2.2, reloadEmpty: 2.2, ads: 0.22, sprintFire: 0.18, move: 0.95, hip: 0.08, aim: 0.06, bloom: 0, kick: 0.06, kickH: 0.01, bias: 0, recover: 0.5, velocity: 0, pen: 0.1, zoom: 56, caliber: 0.85, report: 'boom', look: { receiver: 0.2, barrel: 0.5, stock: 'wood', mag: 'none', handguard: 0.24, tone: 'wood', bore: 0.02 }, level: 19 }),
  W({ id: 'tempest', name: 'Tempest Drum', cls: 'shotgun', desc: 'A fully automatic shotgun on a drum. Loud, heavy, empties rooms.', mode: 'auto', dmg: 10, falloff: 0.2, range: [6, 16], head: 1.2, limb: 1, pellets: 7, rpm: 330, mag: 20, reserve: 60, reload: 3.2, reloadEmpty: 3.8, ads: 0.3, sprintFire: 0.26, move: 0.88, hip: 0.08, aim: 0.065, bloom: 0.012, kick: 0.035, kickH: 0.015, bias: 0.2, recover: 0.3, velocity: 0, pen: 0.1, zoom: 54, caliber: 0.8, report: 'boom', look: { receiver: 0.42, barrel: 0.34, stock: 'fixed', mag: 'drum', handguard: 0.2, tone: 'black', bore: 0.018 }, level: 32 }),
  /* ── marksman rifles ── */
  W({ id: 'marksman', name: 'SR-10 Marshal', cls: 'dmr', desc: 'Semi-automatic and accurate. A head takes one; a body takes two.', mode: 'semi', dmg: 55, falloff: 0.82, range: [60, 140], head: 2.0, limb: 0.85, pellets: 1, rpm: 250, mag: 12, reserve: 60, reload: 2.4, reloadEmpty: 3.0, ads: 0.33, sprintFire: 0.3, move: 0.88, hip: 0.06, aim: 0.0009, bloom: 0.012, kick: 0.03, kickH: 0.004, bias: 0.1, recover: 0.4, velocity: 900, pen: 0.8, zoom: 30, caliber: 0.8, report: 'crack', look: { receiver: 0.46, barrel: 0.5, stock: 'fixed', mag: 'box', handguard: 0.4, scope: true, tone: 'black', bore: 0.01 }, level: 1 }),
  W({ id: 'tamsin', name: 'Tamsin 308', cls: 'dmr', desc: 'Faster follow-ups, lighter hits. For holding a lane without a bolt.', mode: 'semi', dmg: 46, falloff: 0.8, range: [55, 120], head: 1.9, limb: 0.85, pellets: 1, rpm: 320, mag: 15, reserve: 75, reload: 2.3, reloadEmpty: 2.9, ads: 0.3, sprintFire: 0.28, move: 0.9, hip: 0.058, aim: 0.0012, bloom: 0.01, kick: 0.024, kickH: 0.004, bias: -0.1, recover: 0.4, velocity: 850, pen: 0.7, zoom: 34, caliber: 0.75, report: 'crack', look: { receiver: 0.44, barrel: 0.46, stock: 'skeleton', mag: 'box', handguard: 0.38, tone: 'tan', bore: 0.01 }, level: 15 }),
  W({ id: 'pike', name: 'Pike Long', cls: 'dmr', desc: 'A long wooden marksman rifle with its own scope. Old design, still works.', mode: 'semi', dmg: 60, falloff: 0.85, range: [70, 150], head: 2.0, limb: 0.85, pellets: 1, rpm: 210, mag: 10, reserve: 50, reload: 2.6, reloadEmpty: 3.2, ads: 0.36, sprintFire: 0.32, move: 0.87, hip: 0.065, aim: 0.0008, bloom: 0.014, kick: 0.034, kickH: 0.006, bias: 0.3, recover: 0.35, velocity: 830, pen: 0.8, zoom: 28, caliber: 0.8, report: 'crack', look: { receiver: 0.5, barrel: 0.56, stock: 'thumbhole', mag: 'box', handguard: 0.46, scope: true, tone: 'wood', bore: 0.01 }, level: 27 }),
  /* ── sniper rifles ── */
  W({ id: 'longmere', name: 'Longmere .338', cls: 'sniper', desc: 'Bolt action. One to the chest at any range, if you lead a moving target.', mode: 'bolt', dmg: 110, falloff: 0.95, range: [120, 300], head: 2.5, limb: 0.8, pellets: 1, rpm: 45, mag: 5, reserve: 30, reload: 3.0, reloadEmpty: 3.8, ads: 0.45, sprintFire: 0.38, move: 0.84, hip: 0.09, aim: 0.0004, bloom: 0.03, kick: 0.06, kickH: 0.01, bias: 0.1, recover: 0.5, velocity: 900, pen: 0.9, zoom: 16, caliber: 0.95, report: 'crack', look: { receiver: 0.5, barrel: 0.66, stock: 'thumbhole', mag: 'box', handguard: 0.42, scope: true, tone: 'green', bore: 0.011 }, level: 8 }),
  W({ id: 'crane', name: 'Crane 50', cls: 'sniper', desc: 'Anti-materiel. Through cover, through armour, through the person behind.', mode: 'semi', dmg: 125, falloff: 1, range: [150, 400], head: 2, limb: 0.9, pellets: 1, rpm: 90, mag: 5, reserve: 20, reload: 3.6, reloadEmpty: 4.4, ads: 0.55, sprintFire: 0.45, move: 0.8, hip: 0.1, aim: 0.0004, bloom: 0.04, kick: 0.08, kickH: 0.015, bias: 0.2, recover: 0.4, velocity: 860, pen: 1, zoom: 14, caliber: 1, report: 'boom', look: { receiver: 0.6, barrel: 0.8, stock: 'fixed', mag: 'box', handguard: 0.4, scope: true, tone: 'grey', bore: 0.015 }, level: 30 }),
  W({ id: 'vesper', name: 'Vesper Lever', cls: 'sniper', desc: 'Lever-action with iron sights. Quicker than a bolt, no scope glint to give you away.', mode: 'lever', dmg: 85, falloff: 0.85, range: [60, 150], head: 2.2, limb: 0.85, pellets: 1, rpm: 90, mag: 7, reserve: 35, reload: 0.55, reloadEmpty: 0.55, single: true, ads: 0.3, sprintFire: 0.26, move: 0.92, hip: 0.07, aim: 0.0012, bloom: 0.02, kick: 0.04, kickH: 0.006, bias: 0, recover: 0.5, velocity: 700, pen: 0.6, zoom: 36, caliber: 0.8, report: 'crack', look: { receiver: 0.36, barrel: 0.54, stock: 'wood', mag: 'tube', handguard: 0.3, tone: 'wood', bore: 0.012 }, level: 21 }),
  /* ── machine guns ── */
  W({ id: 'bulwark', name: 'Bulwark 556', cls: 'lmg', desc: 'A hundred rounds on a belt. Suppress the lane; move slowly; reload never.', mode: 'auto', dmg: 26, falloff: 0.75, range: [40, 90], head: 1.4, limb: 0.9, pellets: 1, rpm: 750, mag: 100, reserve: 200, reload: 5.4, reloadEmpty: 6.0, ads: 0.45, sprintFire: 0.4, move: 0.84, hip: 0.05, aim: 0.004, bloom: 0.004, kick: 0.0095, kickH: 0.0065, bias: 0.25, recover: 0.1, velocity: 0, pen: 0.55, zoom: 44, caliber: 0.55, report: 'crack', look: { receiver: 0.52, barrel: 0.46, stock: 'fixed', mag: 'belt', handguard: 0.34, tone: 'black', bore: 0.009 }, level: 7 }),
  W({ id: 'mauler', name: 'Mauler 762', cls: 'lmg', desc: 'The heavy one. Slower fire, full-power rounds, hard to move with.', mode: 'auto', dmg: 34, falloff: 0.8, range: [45, 100], head: 1.45, limb: 0.9, pellets: 1, rpm: 600, mag: 75, reserve: 150, reload: 6.0, reloadEmpty: 6.6, ads: 0.52, sprintFire: 0.45, move: 0.8, hip: 0.055, aim: 0.0038, bloom: 0.005, kick: 0.014, kickH: 0.008, bias: 0.3, recover: 0.08, velocity: 0, pen: 0.75, zoom: 42, caliber: 0.75, report: 'crack', look: { receiver: 0.56, barrel: 0.5, stock: 'fixed', mag: 'belt', handguard: 0.38, tone: 'green', bore: 0.011 }, level: 18 }),
  W({ id: 'haymaker', name: 'Haymaker 54', cls: 'lmg', desc: 'A rifle that became a machine gun: a drum, a long barrel, a lighter frame.', mode: 'auto', dmg: 28, falloff: 0.75, range: [40, 90], head: 1.4, limb: 0.9, pellets: 1, rpm: 700, mag: 60, reserve: 180, reload: 4.0, reloadEmpty: 4.6, ads: 0.38, sprintFire: 0.34, move: 0.86, hip: 0.048, aim: 0.0038, bloom: 0.004, kick: 0.011, kickH: 0.006, bias: -0.2, recover: 0.12, velocity: 0, pen: 0.55, zoom: 44, caliber: 0.6, report: 'crack', look: { receiver: 0.48, barrel: 0.48, stock: 'wood', mag: 'drum', handguard: 0.36, tone: 'wood', bore: 0.01 }, level: 26 }),
  /* ── pistols ── */
  W({ id: 'pistol', name: 'P-17 Service', cls: 'pistol', desc: 'Reliable, quick, seventeen rounds. The one you draw when the rifle runs dry.', mode: 'semi', dmg: 27, falloff: 0.6, range: [16, 40], head: 1.5, limb: 0.95, pellets: 1, rpm: 400, mag: 17, reserve: 68, reload: 1.3, reloadEmpty: 1.7, ads: 0.14, sprintFire: 0.1, move: 1.03, hip: 0.022, aim: 0.007, bloom: 0.006, kick: 0.017, kickH: 0.004, bias: 0, recover: 0.4, velocity: 0, pen: 0.15, zoom: 54, caliber: 0.25, report: 'snap', look: { receiver: 0.18, barrel: 0.04, stock: 'none', mag: 'grip', handguard: 0, bore: 0.009 }, level: 1 }),
  W({ id: 'magnet', name: 'Magnet 45', cls: 'pistol', desc: 'Eight heavy rounds. Two to the head from the hip.', mode: 'semi', dmg: 38, falloff: 0.6, range: [14, 36], head: 1.6, limb: 0.95, pellets: 1, rpm: 300, mag: 8, reserve: 48, reload: 1.4, reloadEmpty: 1.8, ads: 0.15, sprintFire: 0.11, move: 1.02, hip: 0.024, aim: 0.007, bloom: 0.008, kick: 0.026, kickH: 0.005, bias: 0.1, recover: 0.35, velocity: 0, pen: 0.2, zoom: 54, caliber: 0.35, report: 'thump', look: { receiver: 0.2, barrel: 0.04, stock: 'none', mag: 'grip', handguard: 0, tone: 'grey', bore: 0.012 }, level: 3 }),
  W({ id: 'flint', name: 'Flint MP', cls: 'pistol', desc: 'A machine pistol. Fully automatic, wild, over in a second.', mode: 'auto', dmg: 18, falloff: 0.5, range: [10, 26], head: 1.3, limb: 0.95, pellets: 1, rpm: 1100, mag: 20, reserve: 100, reload: 1.5, reloadEmpty: 1.9, ads: 0.14, sprintFire: 0.1, move: 1.03, hip: 0.03, aim: 0.012, bloom: 0.004, kick: 0.009, kickH: 0.008, bias: 0.4, recover: 0.3, velocity: 0, pen: 0.1, zoom: 54, caliber: 0.25, report: 'snap', look: { receiver: 0.2, barrel: 0.05, stock: 'none', mag: 'grip', handguard: 0, tone: 'black', bore: 0.009 }, level: 13 }),
  W({ id: 'duet', name: 'Duet .40', cls: 'pistol', desc: 'Two-round bursts. Point, pull, two holes where you pointed.', mode: 'burst', burst: 2, dmg: 25, falloff: 0.6, range: [15, 38], head: 1.5, limb: 0.95, pellets: 1, rpm: 900, mag: 16, reserve: 80, reload: 1.4, reloadEmpty: 1.8, ads: 0.15, sprintFire: 0.1, move: 1.02, hip: 0.022, aim: 0.0065, bloom: 0.004, kick: 0.012, kickH: 0.004, bias: -0.1, recover: 0.4, velocity: 0, pen: 0.15, zoom: 54, caliber: 0.3, report: 'snap', look: { receiver: 0.2, barrel: 0.04, stock: 'none', mag: 'grip', handguard: 0, tone: 'tan', bore: 0.01 }, level: 23 }),
  /* ── revolvers ── */
  W({ id: 'carver', name: '.357 Carver', cls: 'revolver', desc: 'Six rounds, a heavy trigger, a very heavy hit. Reloads all six from a speedloader.', mode: 'semi', dmg: 55, falloff: 0.65, range: [18, 42], head: 1.6, limb: 0.95, pellets: 1, rpm: 160, mag: 6, reserve: 36, reload: 2.2, reloadEmpty: 2.2, ads: 0.18, sprintFire: 0.12, move: 1.0, hip: 0.024, aim: 0.005, bloom: 0.012, kick: 0.04, kickH: 0.006, bias: 0.2, recover: 0.4, velocity: 0, pen: 0.3, zoom: 52, caliber: 0.55, report: 'boom', look: { receiver: 0.16, barrel: 0.12, stock: 'none', mag: 'cylinder', handguard: 0, tone: 'grey', bore: 0.012 }, level: 16 }),
  W({ id: 'brute', name: '.500 Brute', cls: 'revolver', desc: 'Five rounds of the biggest handgun cartridge there is. One is usually enough.', mode: 'semi', dmg: 80, falloff: 0.65, range: [16, 38], head: 1.5, limb: 0.95, pellets: 1, rpm: 110, mag: 5, reserve: 25, reload: 2.6, reloadEmpty: 2.6, ads: 0.2, sprintFire: 0.14, move: 0.98, hip: 0.028, aim: 0.005, bloom: 0.02, kick: 0.065, kickH: 0.01, bias: 0.3, recover: 0.35, velocity: 0, pen: 0.45, zoom: 52, caliber: 0.9, report: 'boom', look: { receiver: 0.18, barrel: 0.2, stock: 'none', mag: 'cylinder', handguard: 0, tone: 'black', bore: 0.016 }, level: 29 }),
  /* ── launchers ── */
  W({ id: 'thresher', name: 'Thresher RL', cls: 'launcher', desc: 'An unguided rocket. Vehicles, turrets, people who bunch up behind a crate.', mode: 'single', dmg: 0, falloff: 1, range: [0, 200], head: 1, limb: 1, pellets: 1, rpm: 30, mag: 1, reserve: 3, reload: 3.4, reloadEmpty: 3.4, ads: 0.5, sprintFire: 0.45, move: 0.85, hip: 0.04, aim: 0.004, bloom: 0, kick: 0.05, kickH: 0.01, bias: 0, recover: 0.4, velocity: 55, pen: 0, zoom: 40, blast: 5, blastDmg: 160, caliber: 1, report: 'whump', look: { receiver: 0.6, barrel: 0.5, stock: 'none', mag: 'none', handguard: 0.2, tone: 'green', bore: 0.05 }, level: 12 }),
  W({ id: 'mortice', name: 'Mortice 40', cls: 'launcher', desc: 'A 40 mm grenade launcher. Lob it over cover; six in the cylinder.', mode: 'semi', dmg: 0, falloff: 1, range: [0, 120], head: 1, limb: 1, pellets: 1, rpm: 90, mag: 6, reserve: 6, reload: 4.2, reloadEmpty: 4.2, ads: 0.35, sprintFire: 0.3, move: 0.88, hip: 0.035, aim: 0.006, bloom: 0, kick: 0.04, kickH: 0.01, bias: 0, recover: 0.4, velocity: 38, pen: 0, zoom: 44, blast: 3.5, blastDmg: 110, caliber: 0.7, report: 'whump', look: { receiver: 0.3, barrel: 0.26, stock: 'folding', mag: 'cylinder', handguard: 0.1, tone: 'tan', bore: 0.04 }, level: 31 }),
  /* ── melee ── */
  W({ id: 'knife', name: 'Combat knife', cls: 'melee', desc: 'Quick. Two slashes, or one from behind.', mode: 'swing', dmg: 55, falloff: 1, range: [2, 2], head: 1, limb: 1, pellets: 1, rpm: 120, mag: 0, reserve: 0, reload: 0, reloadEmpty: 0, ads: 0.1, sprintFire: 0.05, move: 1.07, hip: 0, aim: 0, bloom: 0, kick: 0, kickH: 0, bias: 0, recover: 1, velocity: 0, pen: 0, zoom: 60, caliber: 0, report: 'none', look: { receiver: 0.1, barrel: 0.17, stock: 'none', mag: 'none', handguard: 0, bore: 0 }, level: 1 }),
  W({ id: 'hatchet', name: 'Tactical hatchet', cls: 'melee', desc: 'Slower than a knife, one swing to the body. And you can throw it.', mode: 'swing', dmg: 100, falloff: 1, range: [2.2, 2.2], head: 1, limb: 1, pellets: 1, rpm: 70, mag: 0, reserve: 0, reload: 0, reloadEmpty: 0, ads: 0.1, sprintFire: 0.05, move: 1.05, hip: 0, aim: 0, bloom: 0, kick: 0, kickH: 0, bias: 0, recover: 1, velocity: 0, pen: 0, zoom: 60, caliber: 0, report: 'none', look: { receiver: 0.1, barrel: 0.3, stock: 'none', mag: 'none', handguard: 0, tone: 'wood', bore: 0 }, level: 9 }),
  W({ id: 'baton', name: 'Riot baton', cls: 'melee', desc: 'Long reach, fast swings. Three to put someone down.', mode: 'swing', dmg: 40, falloff: 1, range: [2.6, 2.6], head: 1, limb: 1, pellets: 1, rpm: 150, mag: 0, reserve: 0, reload: 0, reloadEmpty: 0, ads: 0.1, sprintFire: 0.05, move: 1.06, hip: 0, aim: 0, bloom: 0, kick: 0, kickH: 0, bias: 0, recover: 1, velocity: 0, pen: 0, zoom: 60, caliber: 0, report: 'none', look: { receiver: 0.1, barrel: 0.5, stock: 'none', mag: 'none', handguard: 0, tone: 'black', bore: 0 }, level: 20 }),
];

export const WEAPON: Record<string, Weapon> = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

/** Primaries and secondaries (a pistol, a revolver, a launcher, a blade can go in the second slot). */
export const isSecondary = (w: Weapon) => w.cls === 'pistol' || w.cls === 'revolver' || w.cls === 'launcher' || w.cls === 'melee';
