import { mulberry32 } from '../../world/rng';
import { hash3, hashStr } from '../world/noise';
import { BIOMES, CITY_STYLES, type BiomeId } from '../world/biomes';
import type { Settlement } from '../world/WorldGen';
import type { Poi } from '../world/Towns';
import type { Resident } from '../sim/Populace';
import { SKILL, type Skill } from './character';
import { factionOfJob, FACTION } from './factions';
import { item } from './items';
import { hoursLabel, openNow, trades } from './economy';
import type { Game } from './Game';
import { accept, advanceMain, complete, current, fail, mainPlaces, MAIN_ID, offerFrom, type Quest, type QuestWorld } from './quests';

/**
 * Conversations as small trees: who's speaking, what they say, and what you
 * can say back. Choices that depend on a skill show the odds before you try
 * (you always know what you're gambling). A node's choices are made when
 * it's shown, so they reflect the world at that moment.
 */

export interface Choice {
  label: string;
  /** "Speech · 64%" */
  tag?: string;
  /** greyed, with the reason */
  disabled?: string;
  /** the next node; null ends the conversation; undefined hands off to another screen (a shop) */
  go: () => Node | null | undefined;
}

export interface Node {
  speaker: string;
  sub?: string;
  lines: string[];
  choices: Choice[];
}

export interface TalkCtx {
  g: Game;
  w: QuestWorld;
  hour: number;
  weather: string;
  biome: BiomeId;
  night: boolean;
  rumour(): string | null;
  openShop(poi: Poi): void;
  /** sleep until this hour (and autosave) */
  sleep(untilHour: number, cost: number): void;
  travel(to: Settlement, cost: number): void;
  /** the people of a town, for sending you to someone */
  residents(s: Settlement): Resident[];
  /** a moment passes (a meal, a drink): game minutes */
  pass(minutes: number): void;
}

const bye = (): Choice => ({ label: 'Goodbye.', go: () => null });

function checkChoice(ctx: TalkCtx, label: string, skill: Skill, diff: number, win: () => Node | null | undefined, lose: () => Node | null | undefined): Choice {
  const p = ctx.g.chance(skill, diff);
  return { label, tag: `${SKILL[skill].name} · ${Math.round(p * 100)}%`, go: () => (ctx.g.check(skill, diff) ? win() : lose()) };
}

function node(speaker: string, lines: string[], choices: Choice[], sub?: string): Node {
  return { speaker, sub, lines, choices };
}

/* ── residents ───────────────────────────────────────────── */

export function residentTalk(ctx: TalkCtx, r: Resident, greeting: string[]): Node {
  const g = ctx.g;
  const m = g.meet(r);
  const first = r.name.split(' ')[0];
  const fac = factionOfJob(r.job);
  const sub = `${jobLabel(r.job)} · ${r.town.name}${fac ? ` · ${FACTION[fac].short}` : ''}`;
  if (m.disp <= -45) return node(r.name, ['Get away from me.'], [{ label: 'Leave.', go: () => null }], sub);
  const root = (): Node => node(r.name, [], rootChoices(), sub);
  const rootChoices = (): Choice[] => {
    const out: Choice[] = [];
    // anything to do with a job you're on
    for (const q of g.s.quests) if (q.state === 'active') out.push(...questChoices(ctx, q, r, root));
    out.push({ label: 'Any work going?', go: () => work() });
    out.push({ label: `What’s ${r.town.name} like?`, go: () => node(r.name, townLines(ctx, r.town), [{ label: 'Something else…', go: root }, bye()], sub) });
    out.push({
      label: 'Heard anything lately?',
      go: () => {
        g.practice('investigation', 0.6);
        const rum = m.disp > -10 ? ctx.rumour() : null;
        return node(r.name, [rum ?? 'Nothing worth repeating.'], [{ label: 'Something else…', go: root }, bye()], sub);
      },
    });
    out.push(bye());
    return out;
  };
  const work = (): Node => {
    const offer = offerFrom(ctx.w, g, r);
    if (!offer) return node(r.name, [m.n < 2 && m.disp < 10 ? 'Not for someone I don’t know.' : 'Nothing today. Ask me another time.'], [{ label: 'Something else…', go: root }, bye()], sub);
    return node(r.name, offer.pitch, [
      { label: 'I’ll do it.', go: () => (accept(g, offer), node(r.name, [`Good. Don’t make me regret it, ${m.n > 2 ? 'friend' : 'stranger'}.`], [{ label: 'Something else…', go: root }, bye()], sub)) },
      { label: 'Not right now.', go: root },
    ], sub);
  };
  return node(r.name, greeting, rootChoices(), sub);

  function jobLabel(j: string) {
    return ({ worker: 'Works the yards', office: 'Office worker', shopkeeper: 'Keeps a shop', nurse: 'Nurse', teacher: 'Teacher', driver: 'Driver', mechanic: 'Mechanic', bartender: 'Bartender', student: 'Student', retired: 'Retired', night: 'Night shift', police: 'Police', rich: 'Old money', drifter: 'Drifter' } as Record<string, string>)[j] ?? j;
  }
  void first;
}

/** What you can say to this person about a job you're on. */
function questChoices(ctx: TalkCtx, q: Quest, r: Resident, back: () => Node): Choice[] {
  const g = ctx.g;
  const o = current(q);
  const out: Choice[] = [];
  const again = (lines: string[]) => node(r.name, lines, [{ label: 'Something else…', go: back }, bye()]);
  if (q.kind === 'main') return mainChoices(ctx, q, r, back);
  if (!o) return out;
  if (q.kind === 'delivery' && o.who === r.id && g.hasQuestItem(q.id)) {
    out.push({
      label: 'I’ve a parcel for you.',
      go: () => {
        g.take('parcel', 1, q.id);
        if (q.data.opened) {
          g.feel(r.id, -25);
          complete(g, q, 'Delivered, opened. They noticed.', 0.5);
          return again(['This has been opened.', 'I’ll be telling them. Here. Half. Be grateful it’s that.']);
        }
        complete(g, q, `Delivered to ${r.name}.`);
        return again([`From ${q.giver?.name ?? 'them'}? Finally.`, 'Here. For your trouble.']);
      },
    });
  }
  if (q.kind === 'debt' && o.who === r.id && r.id === q.data.debtor) {
    const owed = Number(q.data.owed);
    const done = (lines: string[], how: string) => {
      o.done = true;
      q.log.push(how);
      return again(lines);
    };
    out.push({
      label: `${q.giver?.name.split(' ')[0]} wants the $${owed}.`,
      go: () => {
        const b = r.brave;
        return node(r.name, ['That again? I’ve told them. I haven’t got it.'], [
          checkChoice(ctx, 'Pay up and nobody else hears about it.', 'speech', 35 + b * 30,
            () => (g.earn(owed, 'collected'), g.feel(r.id, -5), done(['…Fine. Here. Tell them we’re square.'], 'Talked them into paying.')),
            () => (g.feel(r.id, -8), again(['No. And you can tell them that too.']))),
          checkChoice(ctx, 'Pay up, or I make it hurt.', 'melee', 30 + b * 45 - (g.c.perks.includes('intimidating') ? 15 : 0) - g.c.attrs.grit * 2,
            () => (g.earn(owed, 'collected'), g.feel(r.id, -40), g.townRep(r.town.id, -4), done(['Alright! Alright. Take it.'], 'Leaned on them until they paid.')),
            () => (g.feel(r.id, -30), g.townRep(r.town.id, -6), g.rep('watch', -3), again(['Help! Somebody! — Get away from me!']))),
          g.c.money >= owed
            ? { label: `Pay it yourself ($${owed}).`, go: () => (g.pay(owed), g.earn(owed, 'your own money'), g.feel(r.id, 25), done(['You’d do that? …I won’t forget it.'], 'Paid the debt out of my own pocket.')) }
            : { label: `Pay it yourself ($${owed}).`, disabled: 'Not enough money', go: () => null },
          { label: 'Forget it.', go: back },
        ]);
      },
    });
  }
  if (q.kind === 'debt' && o.who === r.id && r.id === q.giver?.id) {
    const owed = Number(q.data.owed);
    out.push({
      label: `Here’s your $${owed}.`,
      disabled: g.c.money < owed ? 'You haven’t got it' : undefined,
      go: () => (g.pay(owed), complete(g, q, q.log[q.log.length - 1] ?? 'Collected.'), again(['All of it? I don’t believe it. Here’s your share.'])),
    });
    if (g.c.money >= owed) {
      out.push(checkChoice(ctx, '[Lie] They hadn’t got it. (Keep the money.)', 'speech', 45,
        () => (fail(g, q, 'Told them the debtor had nothing. Kept the money.'), g.practice('speech', 2), again(['Figures. Well, thanks for trying.'])),
        () => (fail(g, q, 'Tried to keep the money. Got caught out.'), g.feel(r.id, -45), g.townRep(r.town.id, -6), again(['You’re lying. I can see it. Get out of my sight.']))));
    }
  }
  if (q.kind === 'missing' && o.who === r.id && g.hasQuestItem(q.id)) {
    out.push({
      label: `I found ${String(q.data.thing).replace(/^(his|her) /, 'your ')}.`,
      go: () => {
        g.take('keepsake', 1, q.id);
        complete(g, q, 'Found it and brought it back.');
        return again(['You found it. You actually—', 'Thank you. Here. It’s not enough.']);
      },
    });
  }
  if (q.kind === 'fetch' && o.who === r.id) {
    const want = String(q.data.want), n = Number(q.data.n);
    out.push({
      label: `I’ve got your ${item(want).name.toLowerCase()}.`,
      disabled: g.count(want) < n ? `You have ${g.count(want)} of ${n}` : undefined,
      go: () => (g.take(want, n), complete(g, q, 'Brought what they needed.'), again(['That’s the lot. Good.', 'Here’s what I said.'])),
    });
  }
  return out;
}

function mainChoices(ctx: TalkCtx, q: Quest, r: Resident, back: () => Node): Choice[] {
  const g = ctx.g;
  const stage = Number(q.data.stage);
  const P = mainPlaces(ctx.w);
  const again = (lines: string[]) => node(r.name, lines, [{ label: 'Something else…', go: back }, bye()]);
  if (stage === 1 && r.town.id === P.first.id) {
    return [{
      label: 'I’m looking for “the ferryman”.',
      go: () => {
        const people = ctx.residents(P.first);
        const ferry = people.find((p) => p.job === 'driver') ?? people.find((p) => p.job === 'retired') ?? people[0];
        if (ferry.id === r.id) return again(['That’s me. Who’s asking?']);
        advanceMain(ctx.w, g, q, 2, { ferry: ferry.id, ferryName: ferry.name });
        return again([`The ferryman? That’s what the old-timers call ${ferry.name}.`, 'Drove the last night bus out of Merrow for thirty years. Still keeps the hours.', 'You’ll find them about town. Late, usually.']);
      },
    }];
  }
  if ((stage === 1 || stage === 2) && r.id === q.data.ferry) {
    return [{
      label: 'M. sent me.',
      go: () => {
        g.xp(80, 'the ferryman');
        advanceMain(ctx.w, g, q, 3);
        return node(r.name, [
          '…M. I haven’t heard that in a long time.',
          'Every night for thirty years I drove that bus to the edge of Merrow, and every night the road ran out at the river. Every night the same night.',
          'This morning the road went on. So you’re the one who walked out of it.',
          'M. left something for you. Out past town, where nobody goes. It only shows after dark.',
        ], [{ label: 'Who is M.?', go: () => again(['Someone who waited a long time for you. That’s all I’ll say out loud.']) }, bye()]);
      },
    }];
  }
  return [];
}

function townLines(ctx: TalkCtx, s: Settlement): string[] {
  const out: string[] = [];
  const style = s.archetype ? CITY_STYLES[s.archetype] : null;
  out.push(s.kind === 'city' ? `${s.name}? Big. ${style?.blurb ?? ''}` : s.kind === 'town' ? `${s.name}’s alright. Everybody knows everybody.` : `${s.name}? There’s not much to it.`);
  out.push(BIOMES[s.biome].blurb);
  const pois = ctx.w.towns.plan(s).pois;
  const sleep = pois.find((p) => p.kind === 'hotel' || p.kind === 'motel');
  const eat = pois.find((p) => p.kind === 'diner');
  const drink = pois.find((p) => p.kind === 'bar');
  const bits = [eat && `eat at ${eat.name}`, drink && `drink at ${drink.name}`, sleep && `sleep at ${sleep.name}`].filter(Boolean);
  if (bits.length) out.push(`If you need to ${bits.join(', ')}.`);
  return out;
}

/* ── doors: shops and services ───────────────────────────── */

export function poiTalk(ctx: TalkCtx, poi: Poi, staff: Resident): Node {
  const g = ctx.g;
  const sub = `${label(poi.kind)} · ${hoursLabel(poi.kind)}`;
  const main = g.s.quests.find((q) => q.id === MAIN_ID && q.state === 'active');
  const mainO = main ? current(main) : null;
  // the story's doors first (they may open outside hours)
  if (main && mainO?.poi === poi.id) {
    const n = mainDoor(ctx, main, poi);
    if (n) return n;
  }
  if (!openNow(poi.kind, ctx.hour)) return node(poi.name, [`Closed. ${hoursLabel(poi.kind)}.`], [bye()], sub);
  const root = (): Node => node(poi.name, [], choices(), sub);
  const back = { label: 'Something else…', go: root };
  const again = (lines: string[]) => node(poi.name, lines, [back, bye()], sub);
  const buy = (label: string, cost: number, fx: () => string): Choice => ({
    label: `${label} ($${cost})`,
    disabled: g.c.money < cost ? 'Not enough money' : undefined,
    go: () => (g.pay(cost), again([fx()])),
  });
  const choices = (): Choice[] => {
    const out: Choice[] = [];
    if (trades(poi.kind)) out.push({ label: 'Let’s trade.', go: () => (ctx.openShop(poi), undefined) });
    switch (poi.kind) {
      case 'diner':
        out.push(buy('A hot meal', 9, () => (g.c.fed = Math.min(100, g.c.fed + 65), g.c.warmth = Math.min(100, g.c.warmth + 12), ctx.pass(30), 'Eggs, hash, coffee that tastes of the pot. You feel human again.')));
        out.push(buy('Coffee', 3, () => (g.c.rest = Math.min(100, g.c.rest + 15), g.c.warmth = Math.min(100, g.c.warmth + 8), ctx.pass(10), 'Refills are free. You have three.')));
        break;
      case 'bar':
      case 'club':
        out.push(buy('A drink', 6, () => (g.c.warmth = Math.min(100, g.c.warmth + 15), g.c.rest = Math.max(0, g.c.rest - 3), ctx.pass(20), 'It burns the right way.')));
        out.push(buy('Stand a round and listen', 15, () => {
          g.practice('investigation', 2);
          g.townRep(poi.town, 2);
          ctx.pass(40);
          return ctx.rumour() ?? 'Everybody talks, nobody says anything.';
        }));
        break;
      case 'hotel':
      case 'motel': {
        const cost = poi.kind === 'hotel' ? 45 : 22;
        out.push({ label: `A room for the night ($${cost})`, disabled: g.c.money < cost ? 'Not enough money' : undefined, go: () => (ctx.sleep(7, cost), null) });
        out.push({ label: 'A few hours’ sleep ($12)', disabled: g.c.money < 12 ? 'Not enough money' : undefined, go: () => (ctx.sleep((ctx.hour + 4) % 24, 12), null) });
        break;
      }
      case 'clinic': {
        const missing = Math.round(Math.max(0, maxHp(g) - g.c.health));
        const cost = Math.max(5, Math.round(missing * 1.2));
        out.push({ label: missing ? `Get patched up ($${cost})` : 'Get patched up', disabled: !missing ? 'Nothing to patch' : g.c.money < cost ? 'Not enough money' : undefined, go: () => (g.pay(cost), g.c.health = maxHp(g), ctx.pass(45), again(['Stitches, a shot, a lecture. You’re good as new.'])) });
        break;
      }
      case 'police': {
        const fine = g.s.mem.bounty[poi.town] ?? 0;
        if (fine > 0) out.push({ label: `Pay your fines ($${fine})`, disabled: g.c.money < fine ? 'Not enough money' : undefined, go: () => (g.pay(fine), delete g.s.mem.bounty[poi.town], g.rep('watch', 3), again(['Paid in full. Stay out of trouble.'])) });
        // an opened parcel with something in it the Watch would want
        for (const q of g.s.quests) {
          if (q.state !== 'active' || q.kind !== 'delivery' || !q.data.opened || q.data.contents !== 'contraband' || !g.hasQuestItem(q.id)) continue;
          out.push({
            label: `Hand over the parcel for ${q.data.whoName}.`,
            go: () => {
              g.take('parcel', 1, q.id);
              q.reward = { money: 60, xp: 70, rep: { watch: 12, syndicate: -14 } };
              complete(g, q, 'Turned the parcel in to the Watch.');
              if (q.giver) g.feel(q.giver.id, -60);
              return again(['Well, well. We’ve been wanting a look at one of these.', 'There’s a reward. Watch your back for a while.']);
            },
          });
        }
        out.push({ label: 'Anything I can help with?', go: () => caseWork() });
        break;
      }
      case 'church':
        out.push({ label: 'Sit a while.', go: () => (g.c.rest = Math.min(100, g.c.rest + 10), ctx.pass(30), again(['The candles gutter. It’s quiet. For a moment, nothing is following you.'])) });
        break;
      case 'gym':
        out.push(buy('Train for an hour', 10, () => (g.practice('athletics', 6), g.practice('melee', 4), g.c.fed = Math.max(0, g.c.fed - 8), ctx.pass(60), 'The bag doesn’t hit back. You feel it tomorrow.')));
        break;
      case 'station':
        out.push({ label: 'Train tickets', go: () => tickets() });
        break;
      case 'office':
      case 'bank':
      case 'garage':
      case 'workshop':
      case 'dock':
      case 'market':
        out.push({ label: 'Any work going?', go: () => staffWork() });
        break;
      case 'arcade':
        out.push(buy('Play a cabinet', 1, () => (g.practice('driving', 1), ctx.pass(15), Math.random() < 0.2 + g.c.attrs.reflex * 0.05 ? 'High score. Three letters, and they’re yours.' : 'Game over. It always is.')));
        break;
    }
    if (poi.kind === 'store' || poi.kind === 'bar' || poi.kind === 'diner' || poi.kind === 'gas') out.push({ label: 'Any work going?', go: () => staffWork() });
    out.push(bye());
    return out;
  };
  const staffWork = (): Node => {
    const offer = offerFrom(ctx.w, g, staff);
    if (!offer) return again(['Nothing today.']);
    return node(`${staff.name}, ${poi.name}`, offer.pitch, [
      { label: 'I’ll do it.', go: () => (accept(g, offer), again(['Good.'])) },
      { label: 'Not right now.', go: root },
    ], sub);
  };
  const caseWork = (): Node => {
    const offer = offerFrom(ctx.w, g, staff);
    if (!offer) return again(['Not unless you’ve a badge. Come back another day.']);
    offer.quest.reward.rep = { ...offer.quest.reward.rep, watch: 6 };
    return node(`Desk sergeant ${staff.name.split(' ')[1]}`, offer.pitch, [
      { label: 'I’ll look into it.', go: () => (accept(g, offer), again(['Keep it legal.'])) },
      { label: 'Not right now.', go: root },
    ], sub);
  };
  const tickets = (): Node => {
    const here = { x: poi.x, z: poi.z };
    const dests = Object.entries(g.s.mem.visited)
      .map(([id, v]) => ({ id, v }))
      .filter(({ id, v }) => id !== poi.town && (v.kind === 'city' || v.kind === 'town'))
      .slice(0, 8);
    if (!dests.length) return again(['Tickets to where? You haven’t been anywhere the line goes. (Visit other towns first.)']);
    return node(poi.name, ['Where to?'], [
      ...dests.map(({ id, v }) => {
        const km = Math.hypot(v.x - here.x, v.z - here.z) / 1000;
        const cost = Math.round(8 + km * 2.5);
        const to = findSettlement(ctx, id, v);
        return { label: `${v.name} · ${km.toFixed(1)} km ($${cost})`, disabled: g.c.money < cost ? 'Not enough money' : undefined, go: () => (ctx.travel(to, cost), null) };
      }),
      back,
    ], sub);
  };
  return root();
}

function findSettlement(ctx: TalkCtx, id: string, v: { x: number; z: number }): Settlement {
  const near = ctx.w.gen.settlementsNear(v.x, v.z, 1);
  return near.find((s) => s.id === id) ?? near[0];
}

function mainDoor(ctx: TalkCtx, q: Quest, poi: Poi): Node | null {
  const g = ctx.g;
  const stage = Number(q.data.stage);
  const again = (who: string, lines: string[]) => node(who, lines, [bye()]);
  if (stage === 4 && poi.kind !== 'church') {
    const open = openNow(poi.kind, ctx.hour);
    const win = (how: string) => {
      g.give('key', 1, { name: 'Deposit box key, No. 314', desc: 'Brass, heavy, stamped 314.', quest: MAIN_ID }, true);
      g.xp(150, 'the photograph');
      g.rep('families', -8);
      q.log.push(how);
      advanceMain(ctx.w, g, q, 5);
      return again('Box 314', ['The box holds one thing: a card, black, from a church in the north.', '“We meet when the night is deepest.”']);
    };
    const clerk = 'The manager';
    const choices: Choice[] = [];
    if (open) {
      choices.push(checkChoice(ctx, 'I’m the heir. I’m here about my family’s box.', 'speech', 55,
        () => win('Talked my way into the vault.'),
        () => (g.rep('families', -4), again(clerk, ['I don’t think so. Good day.', '(They’re watching you all the way to the door.)']))));
      choices.push(checkChoice(ctx, 'Show them the photograph, and the date on it.', 'investigation', 45,
        () => win('Showed them the photograph. They went pale and fetched the key.'),
        () => again(clerk, ['An old photograph. Lots of people have old photographs.'])));
      choices.push({ label: 'Slide $300 across the desk.', disabled: g.c.money < 300 ? 'Not enough money' : undefined, go: () => (g.pay(300), win('Paid the manager to look the other way.')) });
    }
    if (ctx.night && !open) {
      choices.push(checkChoice(ctx, 'Pick the side door and find the records room.', 'lockpicking', 50,
        () => (g.practice('stealth', 3), win('Broke in after dark and found the box myself.')),
        () => (g.s.mem.bounty[poi.town] = (g.s.mem.bounty[poi.town] ?? 0) + 60, g.rep('watch', -8), again(poi.name, ['The lock won’t give. Somewhere inside, an alarm starts to ring.']))));
    }
    choices.push(bye());
    return node(open ? `${poi.name}, the manager’s desk` : poi.name, open ? ['May I help you?'] : ['Closed. The side door is in the alley, out of the light.'], choices, 'The Long Night');
  }
  if (stage === 5 && poi.kind === 'church') {
    if (!(ctx.hour >= 23 || ctx.hour < 3)) return again(poi.name, ['A few old people, a caretaker. Nothing that looks like it meets at midnight.', '(Come back between 23:00 and 03:00.)']);
    const end = (how: string, fx: () => void) => {
      fx();
      g.xp(300, 'the long night');
      q.log.push(how);
      advanceMain(ctx.w, g, q, 6);
      return again('The Keeper', ['Then go. The night will find you again. It always does.', '(Chapter one ends here. More of the long night is coming.)']);
    };
    return node('The Keeper', [
      'No hymns. Forty people in the dark, and one candle.',
      'You came. M. said you would, when the loop broke.',
      'District 03 was never cursed. It was closed. Kept. Something got in, a long time ago, and the night was the only lock we had.',
      'Now you’ve walked out, the lock is open. It will come looking for the one who carries the night with them.',
      'Stay with us. Or don’t. Choose.',
    ], [
      { label: 'I’ll stay. Teach me.', go: () => end('Joined the Quiet Chapel.', () => (g.rep('chapel', 40), g.rep('families', -10))) },
      checkChoice(ctx, 'This is a cult. I’m taking it to the Watch.', 'speech', 40, () => end('Exposed the Chapel to the Watch.', () => (g.rep('watch', 25), g.rep('chapel', -50))), () => end('Tried to walk out. They let me.', () => g.rep('chapel', -20))),
      { label: 'Say nothing, and leave.', go: () => end('Walked out into the dark alone.', () => g.rep('drifters', 10)) },
    ], 'The Long Night');
  }
  return null;
}

function maxHp(g: Game) {
  const c = g.c;
  return 70 + c.attrs.stamina * 6 + c.attrs.grit * 2 + c.level * 3;
}

function label(kind: string) {
  return ({ diner: 'Diner', bar: 'Bar', store: 'Store', gas: 'Gas station', garage: 'Garage', clinic: 'Clinic', hotel: 'Hotel', police: 'Police', gunsmith: 'Gunsmith', pawn: 'Pawn shop', arcade: 'Arcade', club: 'Club', gym: 'Gym', church: 'Church', bank: 'Bank', dock: 'Dock', market: 'Market', office: 'Offices', station: 'Station', motel: 'Motel', workshop: 'Workshop' } as Record<string, string>)[kind] ?? kind;
}

/** Someone behind the counter, made from the door (so it's the same person every visit). */
export function staffOf(poi: Poi, town: Settlement, residents: Resident[]): Resident {
  const r = mulberry32(hash3(hashStr(poi.id), 3, 3));
  const base = residents[Math.floor(r.next() * residents.length)] ?? residents[0];
  const job = poi.kind === 'police' ? 'police' : poi.kind === 'bar' || poi.kind === 'club' ? 'bartender' : poi.kind === 'clinic' ? 'nurse' : poi.kind === 'garage' || poi.kind === 'workshop' ? 'mechanic' : poi.kind === 'office' || poi.kind === 'bank' ? 'office' : 'shopkeeper';
  return { ...base, id: `${poi.id}:staff`, job, town, friendly: 0.6 };
}
