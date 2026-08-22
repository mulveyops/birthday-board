/**
 * The duel roster — every head-to-head the game can call for.
 *
 * A duel is played in the room, not in the app: the app names the game, states
 * the rules so nobody argues about them on a pavement at 8pm, and then somebody
 * taps who won. So every `rule` below has to be readable by a drunk person in
 * one go, and has to settle what counts as winning.
 *
 * `objective` — the winner is obvious to everyone watching. No judging, no
 *   "that totally counted". These are the only ones an AMBUSHER may pick,
 *   because the team walking into a trap didn't choose to be there and
 *   shouldn't also have to accept their opponent's ruling.
 * `solo` — one player per team, so a team of five has no edge over a team of
 *   three. Also the only ones an ambusher may pick, for the same reason.
 *
 * Nothing here needs a prop you wouldn't already have on you.
 */
export interface Duel {
  key: string;
  name: string;
  rule: string;
  objective: boolean;
  solo: boolean;
}

export const DUELS: Duel[] = [
  {
    key: 'staring',
    name: 'Staring contest',
    rule: 'One player each, arm’s length apart. First to blink or look away loses. Laughing is allowed, blinking is not.',
    objective: true,
    solo: true,
  },
  {
    key: 'oneleg',
    name: 'One leg, eyes closed',
    rule: 'One player each. Stand on one foot, eyes shut, hands off everything. First foot down loses. Nobody touches anybody.',
    objective: true,
    solo: true,
  },
  {
    key: 'rps',
    name: 'Rock paper scissors',
    rule: 'One player each, best of seven. One, two, three, SHOOT.',
    objective: true,
    solo: true,
  },
  {
    key: 'math',
    name: 'Speed math',
    rule: 'One player each. Somebody else reads off the numbers from the game for both players at once. First correct answer wins. Wrong answer and the other side has a chance to steal.  First to 3 wins',
    objective: true,
    solo: true,
  },
  {
    key: 'spell',
    name: 'Spelling bee',
    rule: 'One player each. One at a time, spell it out loud. Get it wrong and your opponent may steal it with the correct spelling.  First to 3 correct answers wins',
    objective: true,
    solo: true,
  },
  {
    key: 'trivia',
    name: 'Trivia flash',
    rule: 'Anyone neutral reads a question from the party trivia and both teams race to shout the answer. First correct voice wins it, if you are wrong the other team gets it. Shout before you’ve heard the whole question at your own risk.  First to 3 wins',
    objective: true,
    solo: false,
  },
  {
    key: 'counting',
    name: 'Count to twenty',
    rule: 'Your whole team, no order agreed in advance.  Cannot go after someone directly next to you. Count to twenty out loud. Any two people speaking at once and you start again. First team to reach twenty wins.',
    objective: true,
    solo: false,
  },
  {
    key: 'ageorder',
    name: 'Age order, silently',
    rule: 'Your whole team lines up youngest to oldest. No talking, no writing, no counting on fingers, no showing an ID. First team to line up correctly wins — you only find out you were wrong once you’ve committed.',
    objective: true,
    solo: false,
  },
  {
    key: 'categories',
    name: 'Categories',
    rule: 'Somebody names a category — Milwaukee bars, breakfast cereals, whatever. Teams alternate naming things in it, no repeats, no long pauses. First team stuck loses.',
    objective: false,
    solo: false,
  },
  {
    key: 'charades',
    name: 'Charades',
    rule: 'The other team gives your actor something to act out. Thirty seconds, no talking, no pointing at real objects, no spelling in the air. Both teams take a turn until someone cannot get it.  If the team who goes first cannot get it the second team must get theirs to win',
    objective: false,
    solo: false,
  },
  {
    key: 'fishbowl',
    name: 'Fishbowl',
    rule: 'The other team gives your describer a word. Thirty seconds to get your team to say it — without using the word, any part of it, or a rhyme. Both teams take a turn until someone cannot get it.  If the team who goes first cannot get it the second team must get theirs to win',
    objective: false,
    solo: false,
  },
  {
    key: 'majority',
    name: 'Majority rules',
    rule: 'Somebody asks a question with no right answer — best pizza topping, worst Brady Street bar. Everyone but the 1 player tells the other team their answers secretly, then your captain guesses what most of them said. Match the majority and you win. Both teams go, one at a time, until someone is wrong.',
    objective: false,
    solo: false,
  },
];

/** What an ambusher is allowed to pick: nothing judged, nothing that rewards a
 * bigger team. They chose the ground; the rules shouldn't be theirs too. */
export const AMBUSH_DUELS = DUELS.filter((d) => d.objective && d.solo);

export function duelByName(name: string): Duel | undefined {
  return DUELS.find((d) => d.name === name || d.key === name);
}

export function randomDuel(): Duel {
  return DUELS[Math.floor(Math.random() * DUELS.length)];
}

// ---------------------------------------------------------------------------
// Duels the app supplies the material for.
//
// Both phones derive it from the duel's own id rather than one phone rolling
// and telling the other, so the words and the sums come out identical on both
// screens with nothing stored and nothing to fall out of sync.
//
// A LIST, not one item: these are first-to-three, and with steals a round can
// run past five. Whoever is reading works down it; the two competitors are not
// supposed to be looking at a phone at all.
// ---------------------------------------------------------------------------

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** Sayable out loud, awkward to spell, mostly local. */
const SPELLING_WORDS = [
  'kielbasa', 'bratwurst', 'Milwaukee', 'Kosciuszko', 'Pulaski', 'Wisconsin',
  'Menomonee', 'Oconomowoc', 'Kinnickinnic', 'Wauwatosa', 'Sheboygan', 'Manitowoc',
  'Waukesha', 'sauerkraut', 'pilsner', 'hefeweizen', 'Riverwest', 'Glorioso',
  'cheddar', 'custard', 'accordion', 'polka', 'anniversary', 'restaurant',
  'definitely', 'necessary', 'rhythm', 'liaison', 'bureaucracy', 'conscience',
  'maintenance', 'occurrence', 'embarrassed', 'connoisseur', 'silhouette',
];

const ROUNDS = 9; // first to three, with steals — plenty of room

/** What the reader reads out, in order. Empty for duels that need nothing. */
export function duelMaterial(duelId: string, duelName: string): { label: string; items: string[] } | null {
  const d = duelByName(duelName);
  if (!d) return null;

  if (d.key === 'spell') {
    const pool = [...SPELLING_WORDS]
      .map((w, i) => ({ w, k: hash01(`${duelId}:w${i}`) }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.w);
    return { label: 'Read these out one at a time — spellers look away', items: pool.slice(0, ROUNDS) };
  }

  if (d.key === 'math') {
    const items: string[] = [];
    for (let i = 0; i < ROUNDS; i++) {
      const r1 = hash01(`${duelId}:a${i}`);
      const r2 = hash01(`${duelId}:b${i}`);
      const r3 = hash01(`${duelId}:c${i}`);
      if (r3 < 0.45) items.push(`${12 + Math.floor(r1 * 88)} × ${3 + Math.floor(r2 * 7)}`);
      else if (r3 < 0.75) items.push(`${24 + Math.floor(r1 * 76)} + ${17 + Math.floor(r2 * 60)}`);
      else items.push(`${60 + Math.floor(r1 * 140)} − ${11 + Math.floor(r2 * 40)}`);
    }
    return { label: 'Read these out one at a time — players look away', items };
  }

  return null;
}

