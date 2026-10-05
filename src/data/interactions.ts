/**
 * What things say when you look at them. Short. Two lines at most.
 * `unlock` adds an archive entry; `action` triggers behaviour in the world.
 */
export interface InteractionDef {
  name: string;
  verb: 'Inspect' | 'Read' | 'Use' | 'Listen' | 'Sit' | 'Answer' | 'Enter' | 'Leave' | 'Ring' | 'Talk' | 'Open';
  lines: string[];
  again?: string[];
  unlock?: string;
  action?: 'sit' | 'phone' | 'vend' | 'mark' | 'enter' | 'exit' | 'bell' | 'rob';
}

export const INTERACTIONS: Record<string, InteractionDef> = {
  // ── doors (world/builders/interiors.ts): enter from the street, leave from inside ──
  'enter:hotel': { name: 'Hotel Meridian', verb: 'Enter', lines: [], action: 'enter' },
  'enter:launderette': { name: 'Launderette', verb: 'Enter', lines: [], action: 'enter' },
  'enter:deli': { name: 'Kowalczyk & Sons', verb: 'Enter', lines: [], action: 'enter' },
  'enter:pharmacy': { name: 'Pharmacy', verb: 'Enter', lines: [], action: 'enter' },
  'enter:stairwell': { name: 'No. 7', verb: 'Enter', lines: [], action: 'enter' },
  'exit:hotel': { name: 'Central Avenue', verb: 'Leave', lines: [], action: 'exit' },
  'exit:launderette': { name: 'Kestrel Market', verb: 'Leave', lines: [], action: 'exit' },
  'exit:deli': { name: 'Kestrel Market', verb: 'Leave', lines: [], action: 'exit' },
  'exit:pharmacy': { name: 'Central Avenue', verb: 'Leave', lines: [], action: 'exit' },
  'exit:stairwell': { name: 'Linden Street', verb: 'Leave', lines: [], action: 'exit' },
  'exit:jail': { name: 'Cell gate', verb: 'Leave', lines: [], action: 'exit' },
  'jail-wall': {
    name: 'Scratches',
    verb: 'Read',
    lines: ['Tally marks, hundreds of them. Then: \u201cIt was 3:17 when they brought me in. It still is.\u201d'],
  },

  // ── people from the side quests (data/quests.ts decides when they say more) ──
  'giver:platform': {
    name: 'Woman on platform 2',
    verb: 'Talk',
    lines: ['She is watching the empty track. She doesn’t answer.'],
  },
  'giver:signalman': {
    name: 'Signalman',
    verb: 'Talk',
    lines: ['“Quiet one tonight.” He doesn’t look up from the board.'],
    again: ['“Nothing’s due. Nothing’s been due for years.”'],
  },
  'giver:fare': {
    name: 'Woman in the rain',
    verb: 'Talk',
    lines: ['“I still owe you.”'],
  },

  // ── inside ──
  'hotel-bell': {
    name: 'Bell',
    verb: 'Ring',
    lines: ['You ring. The note hangs in the lobby longer than it should.', 'The clerk does not look at the bell. The clerk is looking at you.'],
    again: ['Nobody comes. The clerk is still looking at you.'],
    action: 'bell',
  },
  'hotel-book': {
    name: 'Guest book',
    verb: 'Read',
    lines: ['Tonight\u2019s guests, one to a line. Every entry is in the same handwriting.', 'It is yours.'],
    again: ['There is one more line than there was.'],
  },
  'hotel-lift': {
    name: 'Lift',
    verb: 'Inspect',
    lines: ['The dial says 13. The building has nine floors.', 'Somewhere above you, the lift is coming down.'],
    again: ['It never arrives.'],
  },
  'laundry-seven': {
    name: 'Machine 7',
    verb: 'Inspect',
    lines: ['A red coat turns and turns. Twelve minutes left.', 'There have been twelve minutes left since you came in.'],
    again: ['Twelve minutes left.'],
  },
  'laundry-notice': {
    name: 'Notice',
    verb: 'Read',
    lines: ['NO DYEING. Machines close at 03:17.', 'Found: one red coat. Ask inside.'],
  },
  'deli-clock': {
    name: 'Clock',
    verb: 'Inspect',
    lines: ['Seventeen minutes past three. The second hand moves, and the minute hand does not.'],
  },
  'deli-ledger': {
    name: 'Order book',
    verb: 'Read',
    lines: ['The last order: \u201cRye, two. Kabanos. For the night shift at the station.\u201d', 'Underneath: \u201cBack in 5 minutes. \u2014 K.\u201d It is dated eighteen years ago.'],
  },
  'pharmacy-bag': {
    name: 'Paper bag',
    verb: 'Inspect',
    lines: ['A prescription waiting to be collected. Your name is on it.', 'You have never been here.'],
    again: ['It is still waiting for you.'],
  },
  'stair-mail': {
    name: 'Post boxes',
    verb: 'Read',
    lines: ['Eighteen boxes. Seventeen are empty.', 'Flat 2D has a name label. It is yours.'],
  },
  'bank-vault': {
    name: 'Vault door',
    verb: 'Open',
    lines: ['Six hundred kilos of steel, and a wheel nobody has needed to turn in a long time.', 'It gives. It was never the lock that mattered.'],
    action: 'rob',
  },
  'bank-ledger': {
    name: 'Manager\u2019s ledger',
    verb: 'Read',
    lines: ['Every account closed out at 03:17, on the same night.', 'The last withdrawal is signed for in your name.'],
    again: ['The signature is yours. It has always been yours.'],
  },
  'bank-atm': {
    name: 'Cash machine',
    verb: 'Inspect',
    lines: ['It welcomes you by name. It has done this before.', 'Balance: enough.'],
    again: ['It welcomes you by name again.'],
  },
  newspaper: {
    name: 'Newspaper box',
    verb: 'Read',
    lines: ['The Evening Ledger, night edition.', 'CITY SLEEPS THROUGH BLACKOUT — “Clocks disagree,” say residents.'],
    unlock: 'evening-ledger',
  },
  'bus-ad': {
    name: 'Bus shelter',
    verb: 'Read',
    lines: ['City Museum — What the city keeps.', 'Closed indefinitely. Thank you for remembering.'],
  },
  plaque: {
    name: 'The Lamplighter',
    verb: 'Read',
    lines: ['TO THOSE WHO KEPT THE LIGHTS ON.', 'Beneath it, scratched in another hand: and to those who could not leave them.'],
    unlock: 'the-lamplighter',
  },
  'station-clock': {
    name: 'Station clock',
    verb: 'Inspect',
    lines: ['03:17. The second hand is moving. The minute hand is not.'],
    unlock: 'station-clock',
  },
  departures: {
    name: 'Departures',
    verb: 'Read',
    lines: ['03:17 — Ashford — Platform 2 — Delayed.', 'Every train after it: cancelled.'],
    unlock: 'departures',
  },
  suitcase: {
    name: 'Suitcase',
    verb: 'Inspect',
    lines: ['Locked. The luggage tag says PLATFORM 2, and nothing else you can read.'],
    unlock: 'suitcase',
  },
  train: {
    name: 'Carriage 4',
    verb: 'Inspect',
    lines: ['One window lit. A folded newspaper on the seat, a cup of tea still steaming.', 'The door is locked from the inside.'],
  },
  'missing-poster': {
    name: 'Poster',
    verb: 'Read',
    lines: ['MISSING — Elena Marsh.', 'Last seen at Central Station, shortly after 3 a.m.'],
    unlock: 'elena-marsh',
  },
  payphone: {
    name: 'Payphone',
    verb: 'Answer',
    lines: ['Static. Then a voice, very close:', '“You’re early. It isn’t 03:17 yet.” The line goes dead.'],
    again: ['The receiver is warm. Nobody is on the line.'],
    unlock: 'the-caller',
    action: 'phone',
  },
  vending: {
    name: 'Vending machine',
    verb: 'Use',
    lines: ['You feed it a coin. It hums, considers, and gives nothing.', 'A minute later, two cans drop. Both are cold. Neither is what you chose.'],
    again: ['It takes the coin. It keeps the coin.'],
    unlock: 'vending',
    action: 'vend',
  },
  'closed-card': {
    name: 'Kowalczyk & Sons',
    verb: 'Read',
    lines: ['“Back in 5 minutes. — K.”', 'The card has faded to the colour of weak tea.'],
  },
  'time-poster': {
    name: 'Posters',
    verb: 'Read',
    lines: ['HAVE YOU SEEN THIS TIME? — 03:17.', 'Underneath, smaller: It has seen you.'],
  },
  'mark-quarter': {
    name: 'A mark',
    verb: 'Inspect',
    lines: ['Chalk. A circle, split by a single line. Fresh enough to smudge.'],
    unlock: 'the-mark',
    action: 'mark',
  },
  'mark-yard': {
    name: 'A mark',
    verb: 'Inspect',
    lines: ['The same sign, painted this time, on the flank of the container.'],
    unlock: 'the-mark',
    action: 'mark',
  },
  'mark-bridge': {
    name: 'A mark',
    verb: 'Inspect',
    lines: ['Scratched into the concrete, low down, where you would only see it if you were looking.'],
    unlock: 'the-mark',
    action: 'mark',
  },
  viewer: {
    name: 'Viewer',
    verb: 'Use',
    lines: ['The coin slot takes nothing. The shutter opens anyway.', 'Downtown, across the river. Every window lit. Not one car on its streets.'],
  },
  boat: {
    name: 'The launch',
    verb: 'Inspect',
    lines: ['RETURN, painted on the bow. The cabin lamp is lit, the key in the ignition.', 'The rope is tied in a knot you cannot undo.'],
    unlock: 'the-boat',
  },
  'bridge-notice': {
    name: 'Notice',
    verb: 'Read',
    lines: ['BRIDGE CLOSED.', '“While essential repairs are carried out.” Notice 03/17.'],
    unlock: 'bridge-notice',
  },
  terminal: {
    name: 'Gatehouse terminal',
    verb: 'Read',
    lines: ['PIER 9 MANIFEST — CTR 0317-X, stack unknown, undeclared.', 'Last scan 03:17. Operator: —'],
    unlock: 'manifest',
  },
  'container-open': {
    name: 'Container',
    verb: 'Inspect',
    lines: ['Empty, but for a chair facing the doors and a bulb left burning.', 'The dust on the floor has been swept into a circle.'],
  },
  radio: {
    name: 'Radio',
    verb: 'Listen',
    lines: ['A dance band, very far away, playing something slow.', 'When the song ends it starts again from the same bar.'],
    unlock: 'the-radio',
  },
  photos: {
    name: 'Photographs',
    verb: 'Inspect',
    lines: ['Twelve prints of one street corner, each marked 3:17.', 'In half of them someone stands under the lamp. You feel you should know the corner.'],
    unlock: 'the-gardener',
  },
  chair: {
    name: 'Chair',
    verb: 'Sit',
    lines: ['You sit. The radio plays. For a while, nothing asks anything of you.'],
    action: 'sit',
  },
  bench: {
    name: 'Bench',
    verb: 'Sit',
    lines: ['You sit and watch the water. Time passes more easily here.'],
    action: 'sit',
  },
};
