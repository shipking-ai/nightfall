/**
 * Regions of the RPG world. A biome is not a colour: it's what grows there,
 * what the weather does, who lives there and what they drive, what things
 * cost, what hunts you, what there is to do. The generator blends between
 * them (world/WorldGen.ts), and everything else asks this table.
 */
export type BiomeId = 'ocean' | 'coast' | 'temperate' | 'forest' | 'boreal' | 'tundra' | 'alpine' | 'desert' | 'scrub' | 'swamp';

export type Species = 'oak' | 'birch' | 'pine' | 'spruce' | 'palm' | 'cactus' | 'deadTree' | 'cypress' | 'bush' | 'rock' | 'boulder' | 'reed' | 'fern' | 'stump';

export type WildlifeId = 'deer' | 'rabbit' | 'fox' | 'wolf' | 'bear' | 'boar' | 'elk' | 'coyote' | 'snake' | 'gator' | 'crow' | 'gull' | 'heron' | 'fish' | 'hare' | 'lizard';

export interface Biome {
  id: BiomeId;
  name: string;
  /** ground layers (linear RGB): grass, dirt, rock, and what covers it in bad weather */
  grass: [number, number, number];
  dirt: [number, number, number];
  rock: [number, number, number];
  /** trees and props per hectare, and which ones */
  flora: [Species, number][];
  density: number;
  /** base temperature °C at noon (night is colder) */
  temp: number;
  /** odds of each weather (per front) */
  weather: { clear: number; cloud: number; rain: number; storm: number; fog: number; snow: number; dust: number };
  /** fog multiplier on clear days (haze, humidity) */
  haze: number;
  /** ambient bed: what you hear outside */
  ambience: 'city' | 'wind' | 'forest' | 'birds' | 'insects' | 'waves' | 'desertWind' | 'frogs' | 'snowWind';
  wildlife: [WildlifeId, number][];
  /** what people here wear (index into data/people outfits by warmth) 0 light … 3 heavy */
  warmth: number;
  /** vehicles on the roads here */
  vehicles: [VehicleKind, number][];
  /** multipliers on base prices */
  prices: Partial<Record<Good, number>>;
  /** what the land is for (jobs, activities) */
  activities: string[];
  threats: string[];
  /** a sentence for the map and the journal */
  blurb: string;
}

export type VehicleKind = 'sedan' | 'hatch' | 'taxi' | 'police' | 'van' | 'pickup' | 'offroad' | 'truck' | 'bus' | 'moto' | 'sports' | 'ambulance';
export type Good = 'food' | 'water' | 'fuel' | 'medicine' | 'ammo' | 'fur' | 'fish' | 'timber' | 'ore' | 'tools' | 'clothing' | 'electronics' | 'spice';

const W = (clear: number, cloud: number, rain: number, storm: number, fog: number, snow: number, dust: number) => ({ clear, cloud, rain, storm, fog, snow, dust });

export const BIOMES: Record<BiomeId, Biome> = {
  ocean: {
    id: 'ocean', name: 'Open water', grass: [0.05, 0.07, 0.06], dirt: [0.2, 0.18, 0.13], rock: [0.1, 0.1, 0.1],
    flora: [], density: 0, temp: 14, weather: W(4, 3, 3, 2, 2, 0, 0), haze: 1.2, ambience: 'waves',
    wildlife: [['gull', 3], ['fish', 5]], warmth: 1, vehicles: [], prices: { fish: 0.7 }, activities: ['fishing', 'sailing'], threats: ['storms', 'drowning'],
    blurb: 'Grey water to the horizon.',
  },
  coast: {
    id: 'coast', name: 'Coast', grass: [0.16, 0.2, 0.08], dirt: [0.48, 0.42, 0.3], rock: [0.32, 0.3, 0.28],
    flora: [['palm', 2], ['bush', 3], ['reed', 2], ['rock', 2]], density: 14, temp: 22, weather: W(6, 3, 2, 1, 2, 0, 0), haze: 1.1, ambience: 'waves',
    wildlife: [['gull', 5], ['heron', 1], ['fish', 4], ['lizard', 1]], warmth: 0, vehicles: [['hatch', 3], ['sedan', 3], ['moto', 2], ['van', 1], ['sports', 1], ['taxi', 1]],
    prices: { fish: 0.6, fuel: 1.1, clothing: 0.9 }, activities: ['fishing', 'swimming', 'boats', 'surf', 'beach volleyball'], threats: ['riptides', 'smugglers'],
    blurb: 'Salt on everything. Boats, boardwalks, sand in the car.',
  },
  temperate: {
    id: 'temperate', name: 'Farmland', grass: [0.13, 0.19, 0.06], dirt: [0.24, 0.18, 0.11], rock: [0.3, 0.29, 0.27],
    flora: [['oak', 3], ['bush', 4], ['birch', 1], ['rock', 1], ['stump', 0.5]], density: 16, temp: 16, weather: W(5, 4, 4, 1, 2, 0.3, 0), haze: 1, ambience: 'birds',
    wildlife: [['rabbit', 4], ['deer', 3], ['fox', 2], ['crow', 3], ['boar', 1]], warmth: 1, vehicles: [['pickup', 4], ['sedan', 3], ['hatch', 2], ['truck', 2], ['van', 1]],
    prices: { food: 0.8, fuel: 1, timber: 1 }, activities: ['farm work', 'hunting', 'fishing', 'racing', 'trucking'], threats: ['boar', 'storms'],
    blurb: 'Hedges, fields, a silo on every horizon. The roads are straight and nobody is on them.',
  },
  forest: {
    id: 'forest', name: 'Forest', grass: [0.07, 0.12, 0.04], dirt: [0.16, 0.12, 0.08], rock: [0.26, 0.26, 0.24],
    flora: [['oak', 6], ['birch', 3], ['pine', 2], ['fern', 5], ['bush', 3], ['rock', 1], ['stump', 1], ['deadTree', 0.3]], density: 85, temp: 14, weather: W(4, 4, 4, 1, 4, 0.5, 0), haze: 1.3, ambience: 'forest',
    wildlife: [['deer', 5], ['boar', 2], ['wolf', 1], ['fox', 2], ['crow', 2], ['bear', 0.5]], warmth: 1, vehicles: [['pickup', 3], ['offroad', 3], ['truck', 2], ['sedan', 1]],
    prices: { timber: 0.6, fur: 0.9, food: 1 }, activities: ['hunting', 'tracking', 'logging', 'camping', 'foraging'], threats: ['wolves', 'bears', 'getting lost'],
    blurb: 'Old trees and older trails. Things live here that do not come out onto the road.',
  },
  boreal: {
    id: 'boreal', name: 'Taiga', grass: [0.09, 0.12, 0.07], dirt: [0.2, 0.17, 0.13], rock: [0.3, 0.3, 0.3],
    flora: [['spruce', 7], ['pine', 4], ['birch', 1.5], ['rock', 2], ['deadTree', 0.6]], density: 75, temp: 4, weather: W(3, 4, 2, 1, 3, 4, 0), haze: 1.2, ambience: 'wind',
    wildlife: [['elk', 3], ['wolf', 2], ['bear', 1], ['hare', 3], ['crow', 1]], warmth: 2, vehicles: [['offroad', 4], ['pickup', 3], ['truck', 2]],
    prices: { fur: 0.6, fuel: 1.3, food: 1.3, clothing: 0.9 }, activities: ['hunting', 'ice fishing', 'trapping', 'logging'], threats: ['cold', 'wolves', 'whiteouts'],
    blurb: 'Dark spruce and long winters. Towns of a hundred people and one bar.',
  },
  tundra: {
    id: 'tundra', name: 'Tundra', grass: [0.62, 0.64, 0.68], dirt: [0.3, 0.28, 0.25], rock: [0.34, 0.34, 0.36],
    flora: [['rock', 3], ['boulder', 1], ['deadTree', 0.4], ['bush', 0.5]], density: 4, temp: -8, weather: W(3, 4, 0, 2, 3, 6, 0), haze: 1.4, ambience: 'snowWind',
    wildlife: [['hare', 2], ['wolf', 2], ['elk', 1], ['crow', 1]], warmth: 3, vehicles: [['offroad', 5], ['truck', 2], ['pickup', 2]],
    prices: { fuel: 1.6, food: 1.6, medicine: 1.4, fur: 0.5 }, activities: ['survival', 'ice fishing', 'expeditions'], threats: ['freezing', 'whiteouts', 'thin ice'],
    blurb: 'Snow over everything, a sky the same colour. Your breath, your footprints, nothing else.',
  },
  alpine: {
    id: 'alpine', name: 'Mountains', grass: [0.12, 0.15, 0.08], dirt: [0.22, 0.2, 0.17], rock: [0.33, 0.32, 0.31],
    flora: [['spruce', 3], ['pine', 2], ['rock', 5], ['boulder', 2]], density: 14, temp: 2, weather: W(4, 4, 2, 2, 4, 4, 0), haze: 0.8, ambience: 'wind',
    wildlife: [['elk', 1], ['wolf', 1], ['bear', 1], ['crow', 2]], warmth: 2, vehicles: [['offroad', 4], ['pickup', 2], ['bus', 1], ['truck', 1]],
    prices: { fuel: 1.4, food: 1.3, tools: 1.1, ore: 0.6 }, activities: ['climbing', 'mining', 'caving', 'downhill racing'], threats: ['falls', 'avalanches', 'cold'],
    blurb: 'Switchbacks and scree. The mines closed; not all of them were emptied.',
  },
  desert: {
    id: 'desert', name: 'Desert', grass: [0.44, 0.32, 0.19], dirt: [0.5, 0.37, 0.23], rock: [0.42, 0.27, 0.17],
    flora: [['cactus', 3], ['deadTree', 1], ['rock', 3], ['boulder', 1.5], ['bush', 1]], density: 5, temp: 31, weather: W(9, 2, 0.3, 0.5, 0, 0, 2), haze: 0.7, ambience: 'desertWind',
    wildlife: [['snake', 2], ['coyote', 2], ['lizard', 4], ['crow', 1]], warmth: 0, vehicles: [['pickup', 4], ['offroad', 3], ['truck', 3], ['moto', 1]],
    prices: { water: 3, fuel: 1.2, spice: 0.7, food: 1.2 }, activities: ['racing', 'treasure hunting', 'smuggling', 'stargazing'], threats: ['heat', 'dehydration', 'sandstorms', 'snakes'],
    blurb: 'Heat that you can see. Towns that were built for a mine or a railroad and outlived both.',
  },
  scrub: {
    id: 'scrub', name: 'Dry hills', grass: [0.3, 0.26, 0.12], dirt: [0.42, 0.32, 0.2], rock: [0.4, 0.33, 0.25],
    flora: [['bush', 5], ['oak', 1], ['rock', 2], ['deadTree', 0.5], ['cactus', 0.5]], density: 8, temp: 27, weather: W(7, 3, 1, 0.5, 0.5, 0, 1), haze: 0.9, ambience: 'insects',
    wildlife: [['coyote', 2], ['rabbit', 3], ['snake', 1], ['crow', 2], ['deer', 1]], warmth: 0, vehicles: [['pickup', 4], ['sedan', 2], ['moto', 2], ['offroad', 2]],
    prices: { water: 1.5, fuel: 1.1 }, activities: ['racing', 'hunting', 'ranch work'], threats: ['wildfire', 'heat'],
    blurb: 'Gold grass, live oaks, the smell of dust after rain.',
  },
  swamp: {
    id: 'swamp', name: 'Wetlands', grass: [0.08, 0.11, 0.05], dirt: [0.12, 0.1, 0.07], rock: [0.2, 0.2, 0.18],
    flora: [['cypress', 6], ['reed', 6], ['deadTree', 2], ['bush', 3], ['fern', 2]], density: 55, temp: 26, weather: W(3, 4, 4, 2, 5, 0, 0), haze: 1.6, ambience: 'frogs',
    wildlife: [['gator', 2], ['heron', 3], ['snake', 2], ['fish', 3], ['crow', 1]], warmth: 0, vehicles: [['pickup', 4], ['offroad', 2], ['van', 1]],
    prices: { medicine: 1.3, fish: 0.7, food: 1.1 }, activities: ['fishing', 'airboats', 'hunting', 'foraging'], threats: ['gators', 'sinking mud', 'fever', 'getting lost'],
    blurb: 'Standing water, hanging moss, lights out on the water at night that nobody will explain.',
  },
};

/* ── Settlements ─────────────────────────────────────────────── */

export type Archetype = 'megacity' | 'financial' | 'coastal' | 'historic' | 'industrial' | 'desert' | 'mountain' | 'port' | 'suburban' | 'frozen';
export type FacadeStyle = 'stone' | 'brick' | 'concrete' | 'glass' | 'plain' | 'metal' | 'stucco' | 'adobe' | 'timber' | 'panel' | 'siding';

export interface CityStyle {
  id: Archetype;
  name: string;
  /** facade styles and weights */
  styles: [FacadeStyle, number][];
  /** building height range in the core, and at the edge */
  core: [number, number];
  edge: [number, number];
  /** block size (m) and street width */
  block: number;
  street: number;
  /** street lamp colour and spacing */
  lamp: 'warm' | 'cold' | 'amber';
  lampEvery: number;
  /** trees along streets */
  streetTrees: 'oak' | 'palm' | 'pine' | 'none';
  /** pitched roofs on low buildings */
  roofs: boolean;
  /** fraction of lit windows at night */
  lit: number;
  landmarks: LandmarkKind[];
  blurb: string;
}

export type LandmarkKind = 'tower' | 'twinTowers' | 'cathedral' | 'clockTower' | 'smokestacks' | 'waterTower' | 'cranes' | 'lighthouse' | 'dam' | 'stadium' | 'ferrisWheel' | 'radioMast' | 'domes' | 'mall' | 'observatory' | 'statue' | 'pier' | 'coolingTowers';

export const CITY_STYLES: Record<Archetype, CityStyle> = {
  megacity: {
    id: 'megacity', name: 'Rain city', styles: [['stone', 3], ['brick', 3], ['concrete', 2], ['glass', 2]], core: [30, 120], edge: [10, 30], block: 70, street: 14,
    lamp: 'warm', lampEvery: 24, streetTrees: 'oak', roofs: false, lit: 0.3, landmarks: ['tower', 'radioMast', 'stadium'], blurb: 'Wet streets, old stone, towers lost in the cloud.',
  },
  financial: {
    id: 'financial', name: 'Financial metropolis', styles: [['glass', 6], ['concrete', 2], ['stone', 1]], core: [60, 220], edge: [18, 50], block: 80, street: 18,
    lamp: 'cold', lampEvery: 22, streetTrees: 'oak', roofs: false, lit: 0.42, landmarks: ['twinTowers', 'tower', 'stadium'], blurb: 'Glass and money. The lights stay on all night because someone is always working.',
  },
  coastal: {
    id: 'coastal', name: 'Coastal city', styles: [['stucco', 6], ['concrete', 1], ['glass', 1]], core: [14, 45], edge: [6, 14], block: 60, street: 13,
    lamp: 'warm', lampEvery: 26, streetTrees: 'palm', roofs: true, lit: 0.3, landmarks: ['pier', 'ferrisWheel', 'lighthouse'], blurb: 'White walls, palms, a pier with a wheel on the end of it.',
  },
  historic: {
    id: 'historic', name: 'Old city', styles: [['stone', 6], ['brick', 2], ['stucco', 1]], core: [12, 26], edge: [8, 16], block: 46, street: 9,
    lamp: 'amber', lampEvery: 18, streetTrees: 'none', roofs: true, lit: 0.34, landmarks: ['cathedral', 'clockTower', 'statue'], blurb: 'Cobbles and bell towers. Streets laid out before anyone had a car.',
  },
  industrial: {
    id: 'industrial', name: 'Mill town', styles: [['brick', 5], ['metal', 3], ['concrete', 2]], core: [14, 40], edge: [8, 16], block: 74, street: 14,
    lamp: 'amber', lampEvery: 28, streetTrees: 'none', roofs: false, lit: 0.22, landmarks: ['smokestacks', 'coolingTowers', 'waterTower'], blurb: 'Chimneys, rail sidings, a river the wrong colour.',
  },
  desert: {
    id: 'desert', name: 'Desert city', styles: [['adobe', 6], ['stucco', 2], ['concrete', 1]], core: [10, 34], edge: [4, 10], block: 72, street: 18,
    lamp: 'amber', lampEvery: 30, streetTrees: 'palm', roofs: false, lit: 0.26, landmarks: ['waterTower', 'domes', 'observatory'], blurb: 'Flat roofs, wide streets built for heat, a water tower everyone navigates by.',
  },
  mountain: {
    id: 'mountain', name: 'Mountain town', styles: [['timber', 4], ['stone', 4], ['plain', 1]], core: [10, 22], edge: [6, 12], block: 50, street: 10,
    lamp: 'warm', lampEvery: 20, streetTrees: 'pine', roofs: true, lit: 0.36, landmarks: ['dam', 'observatory', 'radioMast'], blurb: 'Timber and slate, a dam above the town, the road in closes in winter.',
  },
  port: {
    id: 'port', name: 'Port city', styles: [['brick', 3], ['metal', 3], ['concrete', 3]], core: [16, 50], edge: [8, 18], block: 80, street: 16,
    lamp: 'amber', lampEvery: 26, streetTrees: 'none', roofs: false, lit: 0.26, landmarks: ['cranes', 'lighthouse', 'tower'], blurb: 'Container stacks and gantry cranes, sailors in every bar.',
  },
  suburban: {
    id: 'suburban', name: 'Suburbs', styles: [['siding', 6], ['brick', 2], ['plain', 1]], core: [8, 24], edge: [5, 8], block: 64, street: 12,
    lamp: 'cold', lampEvery: 32, streetTrees: 'oak', roofs: true, lit: 0.4, landmarks: ['mall', 'waterTower', 'stadium'], blurb: 'Lawns and cul-de-sacs, a mall at the centre like a cathedral.',
  },
  frozen: {
    id: 'frozen', name: 'Northern city', styles: [['panel', 6], ['concrete', 2], ['brick', 1]], core: [18, 48], edge: [10, 20], block: 78, street: 16,
    lamp: 'amber', lampEvery: 24, streetTrees: 'none', roofs: false, lit: 0.44, landmarks: ['coolingTowers', 'radioMast', 'statue'], blurb: 'Concrete blocks steaming in the cold, sodium light on the snow.',
  },
};

/* ── Names ───────────────────────────────────────────────────── */

const SYL = {
  a: ['Ash', 'Bram', 'Cal', 'Dun', 'Eld', 'Fen', 'Gal', 'Hol', 'Ives', 'Kest', 'Lorn', 'Mar', 'Nor', 'Oak', 'Pell', 'Quar', 'Rav', 'Sal', 'Tarn', 'Vey', 'Wick', 'Yar', 'Corv', 'Hart', 'Stor'],
  b: ['bridge', 'ford', 'haven', 'mouth', 'field', 'moor', 'stead', 'wick', 'mere', 'holt', 'crest', 'fall', 'reach', 'port', 'dale', 'gate', 'worth', 'ton', 'by', 'well'],
  desert: ['San Aleso', 'Mirado', 'Costa Seca', 'Varela', 'Piedras', 'El Tanque', 'Arroyo', 'Solano', 'Cruz Negra', 'Bajío', 'Las Palmas', 'Encino', 'Soledad', 'Dos Ríos', 'Viento'],
  north: ['Kalvik', 'Norrby', 'Skarn', 'Vorsk', 'Isfjord', 'Tovik', 'Grend', 'Hallin', 'Ostra', 'Kiruv', 'Brenna', 'Lysk', 'Varr', 'Sundmo', 'Frost'],
};

export function makeName(r: { next(): number; pick<T>(a: readonly T[]): T }, climate: 'desert' | 'north' | 'plain'): string {
  const pre = r.next();
  const lead = pre < 0.08 ? 'North ' : pre < 0.14 ? 'Upper ' : pre < 0.2 ? 'Old ' : pre < 0.24 ? 'Saint ' : '';
  if (climate === 'desert') return r.pick(SYL.desert) + (r.next() < 0.3 ? ` ${r.pick(['Viejo', 'Alto', 'del Sur', 'Blanco', 'Verde'])}` : '');
  if (climate === 'north') return r.pick(SYL.north) + (r.next() < 0.35 ? r.pick(['vik', 'by', 'holm', 'strand', 'dal']) : '');
  return lead + r.pick(SYL.a) + r.pick(SYL.b);
}
