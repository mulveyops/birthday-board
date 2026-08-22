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

/**
 * Words everyone knows and nobody can spell. Long-ish and commonly fumbled
 * rather than obscure — the fun is watching someone confident get to the third
 * syllable of "maintenance", not stumping them with a word they've never heard.
 * Place names are out for that reason: Kosciuszko isn't a spelling test, it's a
 * trick question.
 */
const SPELLING_WORDS = [
  'accommodate', 'acknowledge', 'acquaintance', 'aggressive', 'anniversary',
  'apparently', 'appropriate', 'argument', 'atmosphere', 'awkward',
  'beginning', 'believable', 'broccoli', 'bureaucracy', 'calendar',
  'camouflage', 'cemetery', 'colleague', 'commitment', 'committee',
  'comparison', 'conscience', 'conscious', 'consensus', 'convenience',
  'correspondence', 'definitely', 'dependent', 'desperate', 'deterrent',
  'discipline', 'embarrassed', 'environment', 'equipment', 'exaggerate',
  'excellent', 'existence', 'experience', 'familiar', 'fascinate',
  'February', 'fluorescent', 'foreign', 'fulfillment', 'generally',
  'gorgeous', 'grateful', 'guarantee', 'guidance', 'harassment',
  'hierarchy', 'humorous', 'hypocrisy', 'immediately', 'independent',
  'indispensable', 'intelligence', 'interrupt', 'irresistible', 'jewelry',
  'judgment', 'knowledge', 'laboratory', 'leisure', 'liaison',
  'library', 'license', 'lightning', 'maintenance', 'maneuver',
  'marriage', 'mathematics', 'medieval', 'millennium', 'miniature',
  'mischievous', 'misspell', 'necessary', 'neighbour', 'noticeable',
  'occasion', 'occurrence', 'opportunity', 'parallel', 'particular',
  'perseverance', 'personnel', 'persuade', 'playwright', 'possession',
  'privilege', 'probably', 'professor', 'pronunciation', 'questionnaire',
  'receipt', 'recommend', 'reference', 'relevant', 'religious',
  'restaurant', 'rhythm', 'ridiculous', 'sacrifice', 'schedule',
  'scissors', 'secretary', 'separate', 'sergeant', 'similar',
  'sincerely', 'souvenir', 'specifically', 'strength', 'successful',
  'sufficient', 'surprise', 'temperature', 'threshold', 'tomorrow',
  'transferred', 'twelfth', 'unanimous', 'unfortunately', 'vacuum',
  'vehicle', 'village', 'Wednesday', 'weird', 'wherever',
];

const ROUNDS = 14; // first to three, with steals on every miss — leave room

/** A question the reader can actually read out. Shape matches the party bank. */
/** The party bank calls them `choices`; kept identical so the bank drops
 *  straight in without a mapping step that could go stale. */
export interface DuelQuestion {
  q: string;
  choices?: string[];
  correct?: number;
}

/** What the reader reads out, in order. Empty for duels that need nothing.
 *
 *  `bank` is the party's own trivia, passed in because this module has no idea
 *  what game it's in. Trivia flash told people to "read a question from the
 *  party trivia" and then showed them nothing to read, which made it the one
 *  duel you couldn't actually run. */
export function duelMaterial(
  duelId: string,
  duelName: string,
  bank: DuelQuestion[] = [],
): { label: string; items: string[]; answers?: string[] } | null {
  const d = duelByName(duelName);
  if (!d) return null;

  if (d.key === 'trivia') {
    if (!bank.length) return null;
    // Same trick as the words and the sums: ordered by a hash of the duel's own
    // id, so both phones list the same questions in the same order with nothing
    // stored and nothing to fall out of sync.
    const order = bank
      .map((q, i) => ({ q, k: hash01(`${duelId}:t${i}`) }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.q)
      .slice(0, ROUNDS);
    return {
      label: 'Read these out — answers below each one, keep them to yourself',
      items: order.map((q) => q.q),
      answers: order.map((q) =>
        q.choices && typeof q.correct === 'number' ? q.choices[q.correct] ?? '' : '',
      ),
    };
  }

  if (d.key === 'spell') {
    const pool = [...SPELLING_WORDS]
      .map((w, i) => ({ w, k: hash01(`${duelId}:w${i}`) }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.w);
    return { label: 'Read these out one at a time — spellers look away', items: pool.slice(0, ROUNDS) };
  }

  if (d.key === 'math') {
    // Two digits by two digits, both factors small enough to hold in your head:
    // 12 × 17 is a think, 94 × 7 is a slog, and long division is nobody's idea
    // of a party. Nothing here needs a pen.
    const items: string[] = [];
    for (let i = 0; i < ROUNDS; i++) {
      const r1 = hash01(`${duelId}:a${i}`);
      const r2 = hash01(`${duelId}:b${i}`);
      const r3 = hash01(`${duelId}:c${i}`);
      if (r3 < 0.7) {
        const a = 11 + Math.floor(r1 * 9); // 11..19
        const b = 12 + Math.floor(r2 * 17); // 12..28
        items.push(`${a} × ${b}`);
      } else if (r3 < 0.88) {
        // an occasional square, which people either know instantly or don't
        const a = 13 + Math.floor(r1 * 12); // 13..24
        items.push(`${a} × ${a}`);
      } else {
        const a = 6 + Math.floor(r1 * 8); // 6..13
        const b = 11 + Math.floor(r2 * 30); // 11..40
        items.push(`${a} × ${b}`);
      }
    }
    return { label: 'Read these out one at a time — players look away', items };
  }

  return null;
}

