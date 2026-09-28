/**
 * NIGHTFALL — District 03 layout.
 * Single source of truth for the city plan: the 3D builders, the collision
 * boundary, the survey map and the discovery zones all read from here.
 *
 * Axes: +x east, +z south. Units are metres. Ground is y = 0 (road),
 * pavements sit on 0.15 m kerbed pads.
 */

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export const r = (x0: number, z0: number, x1: number, z1: number): Rect => ({ x0, z0, x1, z1 });
export const inRect = (p: { x: number; z: number }, a: Rect, pad = 0) =>
  p.x >= a.x0 - pad && p.x <= a.x1 + pad && p.z >= a.z0 - pad && p.z <= a.z1 + pad;
export const expand = (a: Rect, d: number): Rect => r(a.x0 - d, a.z0 - d, a.x1 + d, a.z1 + d);

export const BOUNDS = r(-150, -200, 150, 164);
export const PAD_H = 0.15;

export type Style = 'stone' | 'brick' | 'concrete' | 'glass' | 'plain' | 'metal' | 'stucco' | 'adobe' | 'timber' | 'panel' | 'siding';

export interface Road {
  name: string;
  rect: Rect;
  axis: 'x' | 'z';
}

export const ROADS: Road[] = [
  { name: 'Central Avenue', rect: r(-9, -124, 9, 164), axis: 'z' },
  { name: 'Linden Street', rect: r(-150, -46, 150, -34), axis: 'x' },
  { name: 'Harbor Lane', rect: r(-150, 48, 150, 60), axis: 'x' },
  { name: 'River Road', rect: r(-150, 136, 150, 146), axis: 'x' },
];

export interface Block {
  id: string;
  rect: Rect;
  district: DistrictId;
  /** height range in metres */
  h: [number, number];
  styles: Style[];
  /** split axis for lots, and lot width range */
  lot: [number, number];
  /** leave these spans open (alleys / passages), along the split axis */
  gaps?: [number, number][];
  lit?: number;
}

export type DistrictId = 'avenue' | 'station' | 'market' | 'riverside' | 'yard' | 'quarter' | 'garden' | 'outskirts';

export const BLOCKS: Block[] = [
  // Central Avenue — tallest, oldest frontages
  { id: 'AW1', rect: r(-34, -120, -13, -50), district: 'avenue', h: [26, 48], styles: ['stone', 'stone', 'concrete'], lot: [14, 24] },
  { id: 'AW2', rect: r(-34, -30, -13, 44), district: 'avenue', h: [22, 40], styles: ['stone', 'brick', 'glass'], lot: [12, 22], gaps: [[6, 11]] },
  { id: 'AW3', rect: r(-34, 64, -13, 132), district: 'avenue', h: [20, 36], styles: ['stone', 'brick', 'concrete'], lot: [12, 20] },
  { id: 'AE1', rect: r(13, -120, 34, -50), district: 'avenue', h: [30, 58], styles: ['glass', 'stone', 'concrete'], lot: [16, 26] },
  { id: 'AE2', rect: r(13, -30, 34, 44), district: 'avenue', h: [24, 44], styles: ['stone', 'stone', 'brick'], lot: [12, 22] },
  { id: 'AE3', rect: r(13, 64, 34, 132), district: 'avenue', h: [18, 34], styles: ['brick', 'concrete', 'stone'], lot: [12, 20], gaps: [[30, 36]] },

  // Kestrel Market — low, dense, shopfronts
  { id: 'MA', rect: r(-62, -30, -42, 44), district: 'market', h: [9, 16], styles: ['brick', 'stone', 'concrete'], lot: [7, 12], lit: 0.34 },
  { id: 'MB', rect: r(-130, -30, -100, 44), district: 'market', h: [10, 18], styles: ['brick', 'brick', 'stone'], lot: [8, 13], lit: 0.3 },
  { id: 'MC', rect: r(-96, -30, -66, -6), district: 'market', h: [9, 14], styles: ['brick', 'concrete'], lot: [7, 11], lit: 0.32 },
  { id: 'MD1', rect: r(-130, 64, -92, 132), district: 'market', h: [9, 17], styles: ['brick', 'stone'], lot: [8, 13], lit: 0.3 },
  { id: 'MD2', rect: r(-86, 64, -62, 132), district: 'market', h: [10, 15], styles: ['brick', 'concrete'], lot: [7, 12], lit: 0.3 },
  { id: 'MD3', rect: r(-56, 64, -42, 132), district: 'market', h: [11, 16], styles: ['stone', 'brick'], lot: [8, 12], lit: 0.28 },

  // The Old Quarter — tight, dark, older than the grid
  { id: 'NQ1', rect: r(-62, -120, -42, -50), district: 'quarter', h: [12, 20], styles: ['stone', 'brick'], lot: [9, 14], lit: 0.18 },
  { id: 'NQ2', rect: r(-130, -120, -66, -104), district: 'quarter', h: [12, 18], styles: ['brick', 'stone'], lot: [10, 16], lit: 0.14 },
  { id: 'NQ3', rect: r(-130, -104, -120, -50), district: 'quarter', h: [10, 16], styles: ['brick'], lot: [10, 16], lit: 0.14 },
  { id: 'NQ4', rect: r(-96, -104, -66, -50), district: 'quarter', h: [11, 17], styles: ['stone', 'brick'], lot: [9, 14], lit: 0.16 },
  { id: 'NQ5', rect: r(-120, -68, -96, -50), district: 'quarter', h: [8, 12], styles: ['brick'], lot: [6, 9], gaps: [[16, 18]], lit: 0.2 },

  // Pier 9 Yard, north lots
  { id: 'I1', rect: r(44, -118, 90, -60), district: 'yard', h: [11, 14], styles: ['metal'], lot: [46, 46], lit: 0 },
  { id: 'I2', rect: r(100, -118, 146, -60), district: 'yard', h: [10, 13], styles: ['metal'], lot: [22, 24], lit: 0 },
];

/** Paved pads (pavements, plazas). Blocks also get a 4 m pavement pad automatically. */
export const PADS: Rect[] = [
  r(-44, -152, 44, -124), // station forecourt
  r(-150, 146, 150, 164), // riverside promenade
  r(-10, 164, 10, 196), // bridge deck
  r(-96, -6, -66, 44), // market square
  r(-120, -104, -96, -68), // garden
  r(-48, -198, 48, -152), // station floor
];

/** Pier 9 Yard ground (concrete, level with road). */
export const YARD = r(38, -30, 150, 132);

export const RIVER = r(-400, 164, 400, 200);
export const BRIDGE = r(-10, 164, 10, 200);
export const STATION = r(-50, -200, 50, -152);
export const GARDEN = r(-120, -104, -96, -68);
export const SQUARE = r(-96, -6, -66, 44);

export interface District {
  id: DistrictId;
  name: string;
  code: string;
  label: { x: number; z: number };
  zone: Rect[];
}

export const DISTRICTS: District[] = [
  { id: 'station', name: 'The Old Station', code: 'D03 · N', label: { x: 0, z: -176 }, zone: [r(-50, -200, 50, -124)] },
  { id: 'avenue', name: 'Central Avenue', code: 'D03 · C', label: { x: 0, z: 10 }, zone: [r(-13, -124, 13, 146)] },
  { id: 'market', name: 'Kestrel Market', code: 'D03 · W', label: { x: -86, z: 90 }, zone: [r(-150, -30, -38, 136)] },
  { id: 'quarter', name: 'The Old Quarter', code: 'D03 · NW', label: { x: -90, z: -114 }, zone: [r(-150, -124, -38, -30)] },
  { id: 'yard', name: 'Pier 9 Yard', code: 'D03 · E', label: { x: 96, z: 40 }, zone: [r(38, -124, 150, 136)] },
  { id: 'riverside', name: 'The Riverside', code: 'D03 · S', label: { x: -80, z: 156 }, zone: [r(-150, 136, 150, 164)] },
  { id: 'garden', name: 'The Garden', code: '—', label: { x: -108, z: -86 }, zone: [GARDEN] },
];

/** Everywhere past the east and west edges (world/Outskirts.ts): not on any map. */
const OUTSKIRTS: District = { id: 'outskirts', name: 'The Outskirts', code: '—', label: { x: 0, z: 0 }, zone: [] };

/** Cross-street "gutter" between avenue and neighbours (alleys). */
export const ALLEYS: Rect[] = [r(-42, -120, -38, 132), r(34, -120, 38, 132)];

export function districtAt(x: number, z: number): District | null {
  // garden first (it's inside the quarter)
  for (const d of [...DISTRICTS].sort((a, b) => (a.id === 'garden' ? -1 : b.id === 'garden' ? 1 : 0))) {
    if (d.zone.some((z0) => inRect({ x, z }, z0))) return d;
  }
  if (Math.abs(x) > 150 && Math.abs(z) < 900) return OUTSKIRTS;
  if (z > 136) return DISTRICTS.find((d) => d.id === 'riverside')!;
  return null;
}

export const SPAWN = { x: -11, z: 118, yaw: Math.PI };

/** Pedestrian routes (ping-pong or loop), on pavement height. */
export interface Route {
  id: string;
  pts: [number, number][];
  loop?: boolean;
}

export const ROUTES: Route[] = [
  { id: 'avW', pts: [[-11.4, -118], [-11.4, 130]] },
  { id: 'avE', pts: [[11.4, -118], [11.4, 130]] },
  { id: 'avW2', pts: [[-12.2, -40], [-12.2, 132], [-40, 132]] },
  { id: 'linden', pts: [[-118, -31.6], [-40, -31.6], [30, -31.6]] },
  { id: 'lindenN', pts: [[-60, -48.4], [30, -48.4]] },
  { id: 'harbor', pts: [[-110, 46], [-40, 46], [30, 46]] },
  { id: 'square', pts: [[-93, -3], [-69, -3], [-69, 41], [-93, 41]], loop: true },
  { id: 'prom', pts: [[-130, 152], [-10, 152], [60, 152], [130, 152]] },
  { id: 'prom2', pts: [[-90, 158], [90, 158]] },
  { id: 'fore', pts: [[-34, -130], [34, -130], [34, -146], [-34, -146]], loop: true },
  { id: 'alleyM', pts: [[-64, -28], [-64, 44]] },
  { id: 'yard', pts: [[42, -26], [42, 44], [100, 44]] },
];

export interface CarRoute {
  pts: [number, number][];
}

// Right-hand traffic. Avenue: south x=-4.5, north x=4.5. Linden: east z=-38.5, west z=-41.5.
// Harbor: east z=55.5, west z=52.5. River Road: east z=142.6, west z=139.8. Kerb lanes are for parking.
export const CAR_ROUTES: CarRoute[] = [
  { pts: [[-180, -38.5], [-4.5, -38.5], [-4.5, 139.8], [-180, 139.8]] },
  { pts: [[180, 139.8], [4.5, 139.8], [4.5, -38.5], [180, -38.5]] },
  { pts: [[-180, 55.5], [4.5, 55.5], [4.5, -41.5], [-180, -41.5]] },
  { pts: [[180, -41.5], [-4.5, -41.5], [-4.5, 55.5], [180, 55.5]] },
  { pts: [[-180, 142.6], [180, 142.6]] },
  { pts: [[180, 52.5], [-180, 52.5]] },
];
