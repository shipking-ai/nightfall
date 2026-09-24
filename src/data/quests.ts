/**
 * Side quests. Small errands that start from things you find, and end
 * somewhere else in the district, a little stranger than they began.
 *
 * Progress lives in save flags (`q:<id>`, `q:<id>:<n>`, `q:<id>:done`),
 * which never go backwards and merge cleanly between devices.
 */

export type Goal =
  /** press E at an interaction spot */
  | { kind: 'use'; spot: string }
  /** be at (x,z), on foot or in a car */
  | { kind: 'reach'; x: number; z: number; r: number }
  /** be at (x,z) in a car you're driving */
  | { kind: 'drive'; x: number; z: number; r: number }
  /** get into the driver's seat of any car */
  | { kind: 'car' }
  /** keep climbing No. 7 */
  | { kind: 'climb'; loops: number };

export interface Step {
  /** the objective, as it reads in the tracker */
  text: string;
  goal: Goal;
  /** said when the step is done */
  lines?: string[];
  /** a time limit (seconds); running out sends you back to `restart` */
  limit?: number;
  /** the spot that restarts a timed step (on a fail, or after a reload) */
  restart?: { spot: string; text: string; fail: string[] };
}

export interface Quest {
  id: string;
  title: string;
  /** the interaction spot that offers it */
  start: string;
  /** said as it starts */
  intro: string[];
  steps: Step[];
  /** archive entry unlocked at the end */
  unlock?: string;
}

export const QUESTS: Quest[] = [
  {
    id: 'red-coat',
    title: 'The Red Coat',
    start: 'laundry-notice',
    intro: ['NO DYEING. Machines close at 03:17.', 'Found: one red coat. Ask inside.'],
    steps: [
      {
        text: 'Open machine 7',
        goal: { kind: 'use', spot: 'laundry-seven' },
        lines: ['The drum stops. Twelve minutes left becomes none.', 'The coat is warm and dry. A name is sewn inside the collar: E. Marsh.'],
      },
      {
        text: 'The posters say Central Station. Go there',
        goal: { kind: 'reach', x: 0, z: -150, r: 9 },
        lines: ['Someone is standing on platform 2. There is no train due.'],
      },
      {
        text: 'Give the coat to the woman on platform 2',
        goal: { kind: 'use', spot: 'giver:platform' },
        lines: ['She puts it on without looking at you. “I wondered where I’d left it.”', 'When you look back from the steps, the platform is empty.'],
      },
    ],
    unlock: 'red-coat',
  },
  {
    id: 'night-shift',
    title: 'Night Shift',
    start: 'deli-ledger',
    intro: ['“Rye, two. Kabanos. For the night shift at the station.”', 'The bag is on the counter, still warm. Nobody has come for it.'],
    steps: [
      {
        text: 'Take the order to the night shift at the station',
        goal: { kind: 'use', spot: 'giver:signalman' },
        limit: 150,
        restart: {
          spot: 'deli-ledger',
          text: 'Pick up a fresh order at Kowalczyk & Sons',
          fail: ['The bread has gone cold.', 'Kowalczyk will have made another by now.'],
        },
        lines: ['“Eighteen years I’ve been waiting on this.” He takes the bag. “Still warm. Tell K. thanks.”'],
      },
    ],
    unlock: 'night-shift',
  },
  {
    id: 'last-fare',
    title: 'Last Fare',
    start: 'giver:fare',
    intro: ['“The river. Ashford Bridge. Please — before it closes.”', '“I can’t pay you. I’ll owe you.”'],
    steps: [
      { text: 'Get in a car', goal: { kind: 'car' } },
      {
        text: 'Drive to Ashford Bridge before it closes',
        goal: { kind: 'drive', x: 0, z: 152, r: 12 },
        limit: 120,
        restart: {
          spot: 'giver:fare',
          text: 'Go back to the woman outside the Hotel Meridian',
          fail: ['A clock somewhere strikes. The bridge is closed.', 'In the mirror, the back seat is empty.'],
        },
        lines: ['You pull up at the bridge. Nobody gets out.', 'There’s a coin on the back seat, older than the city.'],
      },
    ],
    unlock: 'the-fare',
  },
  {
    id: 'flat-2d',
    title: 'Flat 2D',
    start: 'pharmacy-bag',
    intro: ['A prescription waiting to be collected. Your name is on it.', 'Stapled to the bag: “Deliver to Flat 2D, No. 7 Linden Street.”'],
    steps: [
      {
        text: 'Find Flat 2D’s post box at No. 7, Linden Street',
        goal: { kind: 'use', spot: 'stair-mail' },
        lines: ['The box for 2D is full. The label says you. Better take it up.'],
      },
      {
        text: 'Climb to the second floor',
        goal: { kind: 'climb', loops: 4 },
        lines: ['There is a door marked 2D on this landing. There wasn’t before.', 'You leave the bag. Someone takes it from inside, very gently.'],
      },
    ],
    unlock: 'flat-2d',
  },
];

export const questById = (id: string) => QUESTS.find((q) => q.id === id);
