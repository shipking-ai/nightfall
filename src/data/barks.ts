import type { Mood } from '../audio/Voice';

/**
 * What people in the street say, and how. Short, ordinary, a little tired —
 * it's late, it's raining. Only the odd ones are odd.
 */

export type Bark =
  | 'bump' // you walked into them
  | 'nearMiss' // your car came at them
  | 'honked' // you leaned on the horn nearby
  | 'stared' // you've been looking at them a while
  | 'crash' // a car hit something close by
  | 'talk' // you spoke to them (E)
  | 'chatter' // two people talking to each other; no subtitle
  | 'hurt' // hit, still standing
  | 'shot' // gunfire nearby
  | 'robbed' // a mugger just took something from them
  | 'crook'; // a criminal, to you

type Line = [text: string, mood: Mood];

const L = (mood: Mood, ...lines: string[]): Line[] => lines.map((t) => [t, mood]);

export const BARKS: Record<Exclude<Bark, 'talk' | 'chatter'>, Line[]> = {
  bump: [
    ...L('annoyed', 'Watch it.', 'Hey—', 'Excuse you.', 'Do you mind?', 'Eyes up, pal.', 'Seriously?'),
    ...L('calm', 'Sorry. Sorry.', 'Oh— my fault.', 'Careful, it’s slippery.'),
  ],
  nearMiss: [
    ...L('scared', 'Whoa!', 'Jesus—!', 'Slow down!', 'Are you insane?!', 'It’s a crossing!'),
    ...L('annoyed', 'Learn to drive!', 'Idiot!', 'There are people here!'),
  ],
  honked: [
    ...L('annoyed', 'Alright, alright.', 'I’m walking!', 'Yeah, I heard you.', 'Where am I supposed to go?'),
    ...L('calm', 'Somebody’s in a hurry.'),
  ],
  stared: [
    ...L('annoyed', 'Can I help you?', 'Do I know you?', 'What?', 'You’re staring.'),
    ...L('calm', 'Something on my face?', 'You lost?'),
  ],
  hurt: [...L('scared', 'Aagh!', 'Ah— God—', 'Stop! Please!', 'I’m hit—')],
  shot: [...L('scared', 'Run!', 'He’s got a gun!', 'Get down!', 'Somebody call the police!', 'Oh God, oh God—')],
  robbed: [...L('scared', 'Help! He took my bag!', 'Stop him! Thief!', 'Hey! That\u2019s mine!', 'Somebody stop him!')],
  crook: [...L('annoyed', 'What you looking at?', 'Walk away.', 'Wrong street, friend.', 'You want some?', 'Back off!')],
  crash: [...L('scared', 'Oh my god!', 'Is everyone okay?!', 'Someone call someone!', 'Did you see that?!')],
};

/** Talking to someone, by what they're doing. A second and third word gets shorter answers. */
const TALK: Record<string, Line[]> = {
  walk: [
    ...L('calm', 'Evening.', 'Can’t stop, sorry.', 'Last tram’s gone, if you’re waiting.', 'Don’t go down by the river tonight.', 'Cold one.'),
    ...L('warm', 'Mind how you go.'),
  ],
  wait: [
    ...L('calm', 'Bus is late. Bus is always late.', 'Twenty minutes, the sign says. It said that twenty minutes ago.', 'You waiting too?'),
  ],
  phone: [...L('annoyed', 'Hang on— no, not you.', 'I’m on the phone.'), ...L('calm', 'Sorry, one sec.')],
  smoke: [...L('calm', 'Got a light? No? Never mind.', 'Just the one. Then I’m going home.', 'Quiet tonight.')],
  sit: [...L('warm', 'Nice night for it.', 'I like it when it’s like this. Nobody about.', 'Sit, if you want.')],
  talk: [...L('annoyed', 'We’re talking here.', 'Do you mind?'), ...L('calm', 'Private conversation, friend.')],
  look: [...L('calm', 'You see that? Up there.', 'I thought I saw someone in the window. Top floor.', 'Something’s off tonight. Can’t put my finger on it.')],
  stare: [...L('odd', 'Your room is ready.', 'We’ve been expecting you.', 'Room thirteen. Same as always.')],
  watcher: [...L('odd', 'You shouldn’t be able to see me.')],
};
const TALK_AGAIN: Line[] = [...L('calm', 'Yes?', 'Still here?'), ...L('annoyed', 'Look, I’ve got to go.', 'Leave me alone, will you.')];
const WET: Line[] = L('calm', 'Of course it’s raining.', 'Soaked through.', 'Supposed to clear by midnight. It won’t.');

/** The words people half-say to each other; only the rhythm matters, nobody reads them. */
const CHATTER = ['and then she said', 'no, the other one, by the station', 'I told him, I did', 'every night the same', 'you’re joking', 'right, right'];

const pick = <T,>(a: T[]) => a[(Math.random() * a.length) | 0];

export function barkLine(kind: Bark, mode: string, times: number, raining: boolean): Line {
  if (kind === 'chatter') return [pick(CHATTER), 'murmur'];
  if (kind === 'talk') {
    const own = TALK[mode] ?? TALK.walk;
    if (mode === 'stare' || mode === 'watcher') return pick(own);
    if (times >= 2) return pick(TALK_AGAIN.slice(times >= 3 ? 2 : 0));
    if (raining && Math.random() < 0.25) return pick(WET);
    return pick(own);
  }
  return pick(BARKS[kind]);
}
