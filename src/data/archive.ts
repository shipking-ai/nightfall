/**
 * The Archive — everything the city lets you keep.
 * Places carry a photographic plate rendered from the live world when you
 * first find them; everything else is typeset.
 */

export type Category = 'places' | 'people' | 'records' | 'objects';

export interface Entry {
  id: string;
  no: string;
  cat: Category;
  title: string;
  quote: string;
  body: string[];
  where: string;
  /** places: which camera plate to photograph */
  plate?: string;
  /** typeset plate style for non-places */
  art?: 'mark' | 'quote';
  hidden?: boolean;
}

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'places', label: 'Places' },
  { id: 'people', label: 'People' },
  { id: 'records', label: 'Records' },
  { id: 'objects', label: 'Objects' },
];

export const ENTRIES: Entry[] = [
  /* ── places ─────────────────────────────────────────────── */
  {
    id: 'central-avenue',
    no: 'NF-001',
    cat: 'places',
    title: 'Central Avenue',
    quote: 'Every lamp on this street is paid for. Nobody can say by whom.',
    body: [
      'The avenue runs from the station to the river in one unbroken line, lit end to end. The lamps are sodium, the old kind, replaced years ago everywhere else in the city. District records list them as decommissioned. They have not gone out.',
      'Shop signs stay lit. Traffic keeps moving. Stand on the kerb long enough and you notice the cars never park, and the same taxi passes twice.',
    ],
    where: 'D03 · Central',
    plate: 'avenue',
  },
  {
    id: 'old-station',
    no: 'NF-002',
    cat: 'places',
    title: 'The Old Station',
    quote: 'It hasn’t run in eighteen years.',
    body: [
      'Central Station closed after the night the 03:17 to Ashford failed to leave. The official notice cites signalling faults. The departures board was never switched off.',
      'The carriage at platform two is original rolling stock. One window is lit. The seat beneath it is warm.',
    ],
    where: 'D03 · North',
    plate: 'station',
  },
  {
    id: 'market',
    no: 'NF-003',
    cat: 'places',
    title: 'Kestrel Market',
    quote: 'The stalls are set up every night. No one has seen them open.',
    body: [
      'A covered market since 1911, open to the sky since the roof came down. Traders arrive before dawn, residents say, and lay out their stalls under tarpaulin.',
      'Nobody has seen a trader. Nobody has seen dawn.',
    ],
    where: 'D03 · West',
    plate: 'market',
  },
  {
    id: 'quarter',
    no: 'NF-004',
    cat: 'places',
    title: 'The Old Quarter',
    quote: 'The streets here are older than the map.',
    body: [
      'The quarter predates the grid; its alleys bend around property lines nobody remembers drawing. Most windows are dark. The ones that are lit have been lit for a long time.',
      'One alley ends at the old district wall. Someone has been there before you, and left a sign.',
    ],
    where: 'D03 · North-west',
    plate: 'quarter',
  },
  {
    id: 'yard',
    no: 'NF-005',
    cat: 'places',
    title: 'Pier 9 Yard',
    quote: 'The crane turns toward the water at 03:17.',
    body: [
      'A container terminal that outlived its shipping line. The manifest is still printed every night at the gatehouse. The barrier arm has been raised since the day it was installed.',
      'Warehouse B-2 has its door half open and a bulb burning inside. There is nothing in there that needs light.',
    ],
    where: 'D03 · East',
    plate: 'yard',
  },
  {
    id: 'riverside',
    no: 'NF-006',
    cat: 'places',
    title: 'The Riverside',
    quote: 'The water moves. That’s more than can be said for the rest of the city.',
    body: [
      'The promenade was built for crowds that never came. From the railing you can see the far bank and, beyond it, the lights of a downtown with no road leading to it.',
      'People come here to sit. They sit for a long time.',
    ],
    where: 'D03 · South',
    plate: 'riverside',
  },
  {
    id: 'ashford-bridge',
    no: 'NF-007',
    cat: 'places',
    title: 'Ashford Bridge',
    quote: 'Closed for repairs. The notice is eighteen years old.',
    body: [
      'The only road out of the district. The barriers are concrete, the warning lamps are new, and the repair works have not begun.',
      'On the far side a street lamp blinks slowly, as if it were answering.',
    ],
    where: 'D03 · South',
    plate: 'bridge',
  },
  {
    id: 'garden',
    no: 'NF-008',
    cat: 'places',
    title: 'The Garden',
    quote: 'Someone has been tending it.',
    body: [
      'A courtyard sealed in by the backs of four buildings, reached through a gap a tarpaulin was hung to hide. The soil has been turned. The candles are fresh. There is one chair.',
      'It is the only place in the district where something is growing.',
    ],
    where: 'D03 · —',
    plate: 'garden',
    hidden: true,
  },

  /* ── people ─────────────────────────────────────────────── */
  {
    id: 'night-clerk',
    no: 'NF-101',
    cat: 'people',
    title: 'The Night Clerk',
    quote: 'The bell is on the desk. Nobody has rung it.',
    body: [
      'The lobby of the Hotel Meridian is lit at all hours. There is always someone at the desk: posture perfect, hands folded, eyes on the door.',
      'The register, visible through the glass, is open to a page dated eighteen years ago. There is one name on it. It is written in your handwriting.',
    ],
    where: 'Hotel Meridian, Central Avenue',
    art: 'quote',
  },
  {
    id: 'elena-marsh',
    no: 'NF-102',
    cat: 'people',
    title: 'Elena Marsh',
    quote: 'Last seen at Central Station, shortly after 3 a.m.',
    body: [
      'The posters are everywhere and none of them are new. They give a name, a station and a time. They do not give a year.',
      'Whoever put them up has kept putting them up.',
    ],
    where: 'Station front · Kestrel Market',
    art: 'quote',
  },
  {
    id: 'the-caller',
    no: 'NF-103',
    cat: 'people',
    title: 'The Caller',
    quote: 'You’re early. It isn’t 03:17 yet.',
    body: [
      'The payphone on Harbor Lane rings when you walk past it, and at no other time. The voice is close and unhurried, and sounds as if it has been waiting.',
      'It does not ask who you are.',
    ],
    where: 'Payphone, Harbor Lane',
    art: 'quote',
  },
  {
    id: 'the-gardener',
    no: 'NF-104',
    cat: 'people',
    title: 'The Gardener',
    quote: 'Every photograph is of the same corner.',
    body: [
      'Whoever keeps the garden photographs one street corner, at the same minute, night after night, and pins the prints to the wall.',
      'In some of them there is a figure under the lamp. In some there is not. The corner is not in District 03, or anywhere you have been.',
    ],
    where: 'The Garden',
    art: 'quote',
  },

  /* ── records ────────────────────────────────────────────── */
  {
    id: 'departures',
    no: 'NF-201',
    cat: 'records',
    title: 'Departures, Line 3',
    quote: '03:17 · Ashford · Platform 2 · Delayed',
    body: [
      'Every departure after it is marked cancelled. The 03:17 alone is only delayed, as if it might still leave.',
      'The board updates itself once a night. Nothing on it changes.',
    ],
    where: 'Central Station concourse',
    art: 'quote',
  },
  {
    id: 'bridge-notice',
    no: 'NF-202',
    cat: 'records',
    title: 'Notice 03/17',
    quote: 'We apologise for any inconvenience.',
    body: [
      'District Works Department notice closing Ashford Bridge “while essential repairs are carried out”.',
      'The department’s offices are on the far bank.',
    ],
    where: 'Ashford Bridge',
    art: 'quote',
  },
  {
    id: 'manifest',
    no: 'NF-203',
    cat: 'records',
    title: 'Yard Manifest',
    quote: 'CTR 0317-X · Stack ? · Undeclared',
    body: [
      'The gatehouse terminal still prints the night’s manifest. One container is listed without a stack, a weight or a contents field.',
      'The last scan is logged at 03:17. The operator field is blank.',
    ],
    where: 'Pier 9 gatehouse',
    art: 'quote',
  },
  {
    id: 'evening-ledger',
    no: 'NF-204',
    cat: 'records',
    title: 'The Evening Ledger',
    quote: '“Clocks disagree,” say residents.',
    body: [
      'Night edition, still in the box. The front page reports a district-wide blackout “lasting either four minutes or two hours, depending on whom you ask”.',
      'Page two is missing from every copy.',
    ],
    where: 'Newspaper box, Central Avenue',
    art: 'quote',
  },
  {
    id: 'the-loop',
    no: 'NF-205',
    cat: 'records',
    title: 'The Loop',
    quote: 'At 05:29 every light in the district flickers. Then it is 03:17.',
    body: [
      'You were there when it happened. The lamps dipped, the windows went dark, and when they came back the clocks had rolled back two hours and twelve minutes.',
      'Nobody on the street reacted. Perhaps nobody noticed. Perhaps everyone did, a long time ago.',
    ],
    where: 'Everywhere',
    art: 'quote',
    hidden: true,
  },

  /* ── objects ────────────────────────────────────────────── */
  {
    id: 'station-clock',
    no: 'NF-301',
    cat: 'objects',
    title: 'The Station Clock',
    quote: 'It is always 03:17 on the station front.',
    body: [
      'The hands have not moved since the night the station closed. It is not broken. The second hand sweeps; the mechanism can be heard running from the forecourt.',
    ],
    where: 'Central Station façade',
    art: 'quote',
  },
  {
    id: 'suitcase',
    no: 'NF-302',
    cat: 'objects',
    title: 'Unclaimed Suitcase',
    quote: 'The tag reads PLATFORM 2. The rest was written in pencil and rubbed out.',
    body: [
      'Brown leather, brass fittings, locked. Heavier than it should be. No one has claimed it, and no one has moved it.',
    ],
    where: 'Island platform, Central Station',
    art: 'quote',
  },
  {
    id: 'vending',
    no: 'NF-303',
    cat: 'objects',
    title: 'Vending Machine, Unit 14',
    quote: 'It took the coin. A minute later, it gave back two cans.',
    body: [
      'Both cans were cold. Neither was what you chose. The price display reads 0.00 and has done for as long as the alley has had a name.',
    ],
    where: 'West alley, Kestrel Market',
    art: 'quote',
  },
  {
    id: 'the-radio',
    no: 'NF-304',
    cat: 'objects',
    title: 'The Radio',
    quote: 'Tuned to a frequency past the end of the dial.',
    body: [
      'A valve set, warm to the touch. Between the static a dance band plays something slow. When the song ends it starts again from the same bar.',
    ],
    where: 'The Garden',
    art: 'quote',
    hidden: true,
  },
  {
    id: 'the-mark',
    no: 'NF-305',
    cat: 'objects',
    title: 'The Mark',
    quote: 'A circle, cut through by a single line.',
    body: [
      'Chalked, painted, scratched. The same sign in places nobody would think to look: the end of an alley, the side of a container, the foot of a barricade.',
      'Whoever leaves it is either showing the way to something, or marking where something was.',
    ],
    where: 'Various',
    art: 'mark',
  },
  {
    id: 'the-boat',
    no: 'NF-306',
    cat: 'objects',
    title: 'The Launch “Return”',
    quote: 'Moored, fuelled, and going nowhere.',
    body: [
      'A river launch tied up below the promenade. The cabin lamp is lit and the key is in the ignition.',
      'The mooring rope is tied in a knot you cannot undo.',
    ],
    where: 'The Riverside',
    art: 'quote',
  },
  {
    id: 'the-lamplighter',
    no: 'NF-307',
    cat: 'objects',
    title: 'The Lamplighter',
    quote: 'To those who kept the lights on.',
    body: [
      'A bronze figure raising a lamp pole, unveiled the year the station closed. The plaque gives no names, only the dedication.',
      'Underneath, scratched in a different hand: and to those who could not leave them.',
    ],
    where: 'Station forecourt',
    art: 'quote',
  },

  /* ── from the side quests (data/quests.ts) ─────────────────── */
  {
    id: 'the-fare',
    no: 'NF-105',
    cat: 'people',
    title: 'The Last Fare',
    quote: '“I can’t pay you. I’ll owe you.”',
    body: [
      'She waits outside the Hotel Meridian for a car that will take her to the river before the bridge closes. The bridge has been closed for as long as there are records.',
      'Drivers who take her say the back seat is empty when they arrive. Some of them keep the coin.',
    ],
    where: 'Hotel Meridian, Central Avenue',
    art: 'quote',
    hidden: true,
  },
  {
    id: 'night-shift',
    no: 'NF-206',
    cat: 'records',
    title: 'Order No. 4471',
    quote: 'Rye, two. Kabanos. For the night shift at the station.',
    body: [
      'Kowalczyk & Sons’ order book, eighteen years open at the same page. The order was delivered tonight. The signalman signed for it in a hand the book has seen before.',
    ],
    where: 'Kowalczyk & Sons, Kestrel Market',
    art: 'quote',
    hidden: true,
  },
  {
    id: 'flat-2d',
    no: 'NF-207',
    cat: 'records',
    title: 'Flat 2D',
    quote: 'There is a door marked 2D on this landing. There wasn’t before.',
    body: [
      'No. 7 Linden Street has eighteen flats and seventeen empty post boxes. The one that isn’t is labelled with your name.',
      'The prescription was collected. Nobody has lived in 2D since the building was built.',
    ],
    where: 'No. 7, Linden Street',
    art: 'quote',
    hidden: true,
  },
  {
    id: 'red-coat',
    no: 'NF-308',
    cat: 'objects',
    title: 'The Red Coat',
    quote: 'A name is sewn inside the collar: E. Marsh.',
    body: [
      'Left in machine 7 of the Kestrel Market launderette, where it had twelve minutes left for as long as anyone remembers.',
      'Returned to its owner on platform 2 of the Old Station. She had been waiting for it.',
    ],
    where: 'Launderette → Old Station',
    art: 'quote',
    hidden: true,
  },
];

export const entryById = (id: string) => ENTRIES.find((e) => e.id === id);

/** Place entries unlocked by walking into a zone. */
export const PLACE_BY_DISTRICT: Record<string, string> = {
  avenue: 'central-avenue',
  station: 'old-station',
  market: 'market',
  quarter: 'quarter',
  yard: 'yard',
  riverside: 'riverside',
  garden: 'garden',
};

/** Loading-screen fragments. */
export const LORE = [
  'The station clock has said 03:17 for eighteen years. It is not broken.',
  'Every lamp on Central Avenue is still paid for. Nobody can say by whom.',
  'The stalls in Kestrel Market are set up every night.',
  'Ashford Bridge is closed for repairs. The notice is older than the repairs.',
  'Somewhere in the Old Quarter, something is growing.',
  'The payphone on Harbor Lane only rings for people walking past.',
  'There is a mark: a circle, cut by a line. It appears where you would not look.',
];
