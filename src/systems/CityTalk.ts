import type { Npc } from '../entities/Crowd';
import type { Node } from '../rpg/game/dialogue';
import { feel } from '../anim/face';
import { mulberry32 } from '../world/rng';

/**
 * Talking to someone in District 03. Not a bark and a shrug any more: a
 * conversation, in their own manner. Who they are (what they do, how they
 * carry themselves) decides how they answer; whether you've been decent to
 * them before decides how they greet you.
 *
 * Topics: the time (it is always 3:17), somewhere to go (they point you to
 * a place, with a direction), themselves, anything strange (rumours that
 * lead to real places in the district), money (a few dollars buys warmth
 * and sometimes a tip), and a threat (some hand over their wallet; the
 * confident ones don't). Every answer is in a voice and on a face.
 */

export interface TalkHost {
  name(n: Npc): string;
  cash(): number;
  pay(n: number): void;
  /** a crime the street saw */
  crime(amount: number): void;
  /** speak a line in their voice, from where they stand */
  voice(n: Npc, text: string, mood: 'calm' | 'annoyed' | 'scared' | 'warm' | 'odd' | 'murmur'): void;
  /** somewhere open, with its direction and distance from them */
  somewhere(n: Npc): { name: string; dir: string; m: number };
  /** they run off */
  flee(n: Npc): void;
  /** they shove you back */
  shove(n: Npc): void;
  /** a rumour heard: archive it if it's new */
  heard(id: string): void;
}

/** How you stand with each person (memory for the night). */
const rapport = new WeakMap<Npc, number>();

const JOBS: Partial<Record<Npc['arche'], string[]>> = {
  commuter: ['I take the last train. I keep missing it. Every night, the same one.', 'I work over in the station offices. Paperwork for trains nobody runs.'],
  office: ['Accounts, on the fourteenth floor. The lights up there never go off.', 'I was supposed to be home hours ago. The lift keeps coming back to fourteen.'],
  student: ['I study late. Libraries are warm and nobody asks questions.', 'Architecture. This district is a bad example of everything.'],
  courier: ['Deliveries. Half the addresses don\'t exist. I deliver them anyway.', 'I ride all night. The streets loop if you go fast enough.'],
  market: ['I sell fruit on Kestrel Market. Nobody buys fruit at three in the morning, but here I am.', 'Stall forty-one. Come by. Bring cash.'],
  nurse: ['Night shift at the clinic. It is always the night shift.', 'I patch people up. Some of them keep coming back with the same cut.'],
  elder: ['I\'ve lived on Linden Street forty years. It was 3:17 then as well.', 'I walk. My doctor says to walk. So I walk.'],
  worker: ['Docks. The cranes run on their own now; I just watch them.', 'I fix the lamps. The ones that should be off stay on whatever I do.'],
  drifter: ['I don\'t do anything. That\'s the trick to it.', 'I sleep where it\'s dry. The launderette, mostly. The red coat is still there.'],
  taxi: ['I drive a cab. Everyone wants to go somewhere and nobody leaves.', 'Fares are good tonight. They\'re always good tonight.'],
  clerk: ['I keep the desk. I keep the book. I keep watching the door.'],
};

const STRANGE: { id: string; line: string }[] = [
  { id: 'rumour-stairwell', line: 'No. 7 on Linden Street. Count the floors on the way up. Then count them again.' },
  { id: 'rumour-launderette', line: 'There\'s a red coat in the launderette, machine seven. Nobody\'s claimed it in years.' },
  { id: 'rumour-lamps', line: 'Some of the street lamps shouldn\'t be on. Stand under one long enough and see.' },
  { id: 'rumour-bank', line: 'The bank on the Avenue. Someone said the vault wheel turns if you lean on it long enough.' },
  { id: 'rumour-watcher', line: 'There\'s someone who stands across the street from you. Not near. Never near. Always across.' },
  { id: 'rumour-hotel', line: 'The hotel clerk was looking at the door before anybody came in. Before you came in.' },
  { id: 'rumour-river', line: 'The ferry still runs. You just have to be at the river at the right time, which is now.' },
];

const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];

export function cityTalk(n: Npc, h: TalkHost): Node {
  const rng = mulberry32((n.pos.x * 73856093) ^ (n.pos.z * 19349663) ^ (n.talked * 83492791));
  const r = () => rng.next();
  const p = n.persona;
  const rap = rapport.get(n) ?? 0;
  const who = h.name(n);
  const face = n.motion.face;
  // their manner: warm, wary, brusque, or not quite right
  const wary = p.nervous > 0.55, blunt = p.confidence > 0.65 && p.energy > 0.5, gentle = !wary && !blunt;
  const say = (text: string, mood: Parameters<TalkHost['voice']>[2] = 'calm') => (h.voice(n, text, mood), text);

  const back = (lines: string[]): Node => ({ speaker: who, lines, choices: menu() });

  function menu() {
    const cash = h.cash();
    return [
      { label: 'What time is it?', go: () => time() },
      { label: 'Is there anywhere open?', go: () => place() },
      { label: 'What do you do?', go: () => self() },
      { label: 'Seen anything strange tonight?', go: () => strange() },
      { label: 'Here, for your trouble.', tag: '$20', disabled: cash < 20 ? 'You don\'t have $20' : undefined, go: () => give() },
      { label: 'Give me your wallet.', tag: 'Crime', go: () => threaten() },
      { label: 'Never mind.', go: () => bye() },
    ];
  }

  function time(): Node {
    feel(face, wary ? 'fear' : 'confused', 0.5, 2);
    const lines = wary
      ? ['Seventeen minutes past three. Don\'t ask me again. Please.']
      : blunt
        ? ['Three seventeen. Same as the last time you asked. Buy a watch.']
        : ['It\'s seventeen minutes past three.', 'It\'s been that for a while now, hasn\'t it.'];
    say(lines[0], wary ? 'scared' : blunt ? 'annoyed' : 'calm');
    return back(lines);
  }

  function place(): Node {
    const s = h.somewhere(n);
    feel(face, 'focus', 0.4, 2);
    const line = `${s.name}. ${s.m < 40 ? 'Just there' : `About ${Math.round(s.m / 10) * 10} metres`}, ${s.dir}.`;
    say(line, gentle ? 'warm' : 'calm');
    return back([line, rap > 0 ? 'Tell them I sent you. They won\'t know who I am either.' : wary ? 'I wouldn\'t go myself.' : 'It\'s open. Everything is open, at this hour.']);
  }

  function self(): Node {
    const pool = JOBS[n.arche] ?? ['I\'m just out walking. Same as you.'];
    const line = pick(r, pool);
    feel(face, rap > 0 ? 'happy' : 'suspicion', rap > 0 ? 0.5 : 0.25, 2);
    say(line, rap > 0 ? 'warm' : 'calm');
    return back([line]);
  }

  function strange(): Node {
    if (rap <= 0 && wary) {
      feel(face, 'fear', 0.6, 2);
      return back([say('No. Nothing. Why, what have you seen?', 'scared')]);
    }
    const s = pick(r, STRANGE);
    feel(face, 'surprise', 0.35, 2);
    h.heard(s.id);
    say(s.line, 'murmur');
    return back([s.line]);
  }

  function give(): Node {
    h.pay(-20);
    rapport.set(n, rap + 2);
    feel(face, 'happy', 0.8, 3);
    const tip = pick(r, STRANGE);
    h.heard(tip.id);
    const line = blunt ? 'I won\'t say no to that.' : wary ? 'Oh. Thank you. Nobody does that.' : 'That\'s kind of you. Really.';
    say(line, 'warm');
    return back([line, `Here's something for it: ${tip.line.charAt(0).toLowerCase()}${tip.line.slice(1)}`]);
  }

  function threaten(): Node {
    h.crime(0.6);
    rapport.set(n, rap - 3);
    if (p.confidence > 0.6 && n.mode !== 'sit') {
      feel(face, 'angry', 0.9, 3);
      h.shove(n);
      return { speaker: who, lines: [say('Try it. Go on. Try it.', 'annoyed')], choices: [{ label: 'Back off.', go: () => null }] };
    }
    const take = 5 + Math.floor(r() * 55);
    h.pay(take);
    feel(face, 'fear', 1, 4);
    h.flee(n);
    return { speaker: who, lines: [say('Okay, okay. Take it. Just take it.', 'scared'), `They hand over $${take} and run.`], choices: [{ label: 'Pocket it.', go: () => null }] };
  }

  function bye(): Node | null {
    if (rap > 0) say('Mind how you go.', 'warm');
    return null;
  }

  // the greeting: depends how you've been with them
  const greet =
    rap >= 2
      ? ['Oh, it\'s you again. Hello.']
      : rap < 0
        ? ['You. Stay where you are.']
        : n.talked > 1
          ? [blunt ? 'You again. What now?' : 'Hello again.']
          : wary
            ? ['Yes? What do you want?']
            : blunt
              ? ['Make it quick.']
              : ['Evening. Or morning. Hard to say.'];
  feel(face, rap >= 2 ? 'happy' : rap < 0 || wary ? 'suspicion' : 'focus', 0.45, 2);
  say(greet[0], rap >= 2 ? 'warm' : rap < 0 ? 'annoyed' : wary ? 'scared' : 'calm');
  return { speaker: who, sub: n.arche === 'clerk' ? 'Night clerk' : undefined, lines: greet, choices: menu() };
}

/** Are they friendly with you (they'll wave when you pass)? */
export function friendly(n: Npc) {
  return (rapport.get(n) ?? 0) >= 2;
}

const FIRST = ['Ada', 'Ruth', 'Mira', 'Noor', 'Iris', 'June', 'Hana', 'Elsa', 'Vera', 'Tomas', 'Leon', 'Abel', 'Otis', 'Ravi', 'Kofi', 'Milo', 'Ezra', 'Silas', 'Dmitri', 'Paolo', 'Grace', 'Lena', 'Sol', 'Ines'];
const LAST = ['Marsh', 'Kowalczyk', 'Abara', 'Lindqvist', 'Okafor', 'Reyes', 'Hale', 'Sato', 'Brandt', 'Novak', 'Quinn', 'Ferreira', 'Doyle', 'Petrov', 'Vance', 'Achterberg'];
/** A name for someone in the crowd, the same every time (by their place in it). */
export function nameFor(i: number) {
  const rng = mulberry32(0x5eed + i * 101);
  return `${FIRST[Math.floor(rng.next() * FIRST.length)]} ${LAST[Math.floor(rng.next() * LAST.length)]}`;
}
