/**
 * NIGHTFALL is one city with four ways to be in it. A mode is not a separate
 * game: it's a set of rules for the same simulation (who's in the streets,
 * whether anything can hurt you, what the interface shows), plus, for the two
 * competitive modes, a match controller layered on top (modes/Warzone.ts,
 * modes/Fight.ts).
 *
 * Everything below reads as configuration on purpose: the world, characters,
 * animation, vehicles, lighting and saves are shared by all four.
 */
export type ModeId = 'city' | 'afterhours' | 'warzone' | 'fight';

export interface ModeRules {
  id: ModeId;
  title: string;
  /** one line for the selection screen */
  line: string;
  /** a few words on what you do there */
  detail: string;
  /** the controller the mode is best with */
  input: string;
  /** how fights work, if at all */
  combat: 'street' | 'none' | 'warzone' | 'fight';
  /** the wanted level, patrol cars, the helicopter */
  police: boolean;
  /** muggings and gangs */
  crime: boolean;
  /** side-quest givers and the tracker */
  quests: boolean;
  /** how often something is quietly wrong (1 = the city's normal rate, 0 = never) */
  unease: number;
  /** the crowd walks the streets */
  crowd: boolean;
  /** traffic and the taxi */
  traffic: boolean;
  /** getting into parked cars and boats, diving in */
  vehicles: boolean;
  /** doors to the interiors */
  interiors: boolean;
  /** discoveries unlock the Archive */
  discovery: boolean;
  emotes: boolean;
  /** photo mode (freezes nothing; just a free camera and a shutter) */
  photo: boolean;
  /** the shared city with friends (crowd and traffic synced) */
  sharedCity: boolean;
  /** where the mode-select background camera looks (a title shot index) */
  shot: number;
}

export const MODES: Record<ModeId, ModeRules> = {
  city: {
    id: 'city',
    title: 'City',
    line: 'The whole night. Anything can happen.',
    detail: 'Drive, explore, take on side jobs, get into trouble, run from the police. And every so often, something in the city is not right.',
    input: 'Controller or keyboard',
    combat: 'street',
    police: true,
    crime: true,
    quests: true,
    unease: 1,
    crowd: true,
    traffic: true,
    vehicles: true,
    interiors: true,
    discovery: true,
    emotes: true,
    photo: true,
    sharedCity: true,
    shot: 0,
  },
  afterhours: {
    id: 'afterhours',
    title: 'After Hours',
    line: 'Rain, radio, and nowhere to be.',
    detail: 'No weapons, no police, no clock to beat. Walk, drive with the radio on, sit by the river, swim, take photographs.',
    input: 'Controller, for the couch',
    combat: 'none',
    police: false,
    crime: false,
    quests: false,
    unease: 0.25,
    crowd: true,
    traffic: true,
    vehicles: true,
    interiors: true,
    discovery: true,
    emotes: true,
    photo: true,
    sharedCity: true,
    shot: 1,
  },
  warzone: {
    id: 'warzone',
    title: 'Warzone',
    line: 'Two teams. Pier 9 Yard. Hold the ground.',
    detail: 'Domination across the container yard: take and hold three points, 6 versus 6. Pick a loadout, play the angles, pick up what the fallen drop.',
    input: 'Controller or mouse',
    combat: 'warzone',
    police: false,
    crime: false,
    quests: false,
    unease: 0,
    crowd: false,
    traffic: false,
    vehicles: false,
    interiors: false,
    discovery: false,
    emotes: true,
    photo: false,
    sharedCity: false,
    shot: 5,
  },
  fight: {
    id: 'fight',
    title: 'Fight',
    line: 'One on one, in the middle of the crossing.',
    detail: 'Best of three where Harbor Lane crosses the avenue, the traffic held at the lights and people stopping to watch. Read, block, parry, punish. Two controllers for a local versus.',
    input: 'Controller',
    combat: 'fight',
    police: false,
    crime: false,
    quests: false,
    unease: 0,
    crowd: false,
    traffic: false,
    vehicles: false,
    interiors: false,
    discovery: false,
    emotes: false,
    photo: false,
    sharedCity: false,
    shot: 6,
  },
};

export const MODE_ORDER: ModeId[] = ['warzone', 'fight', 'city', 'afterhours'];
