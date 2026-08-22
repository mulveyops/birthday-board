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
    rule: 'One player each, best of three. Shoot on three, not after three.',
    objective: true,
    solo: true,
  },
  {
    key: 'math',
    name: 'Speed math',
    rule: 'One player each. Somebody neutral calls out a two-digit sum — 23 × 7, that sort of thing. First correct answer wins. Wrong answer and the other side gets it.',
    objective: true,
    solo: true,
  },
  {
    key: 'spell',
    name: 'Spelling bee',
    rule: 'One player each. The other team picks the word and says it once. Spell it out loud. Get it wrong and your opponent may steal it with the correct spelling.',
    objective: true,
    solo: true,
  },
  {
    key: 'trivia',
    name: 'Trivia flash',
    rule: 'Anyone neutral reads a question from the party trivia and both teams race to shout the answer. First correct voice wins it. Shout before you’ve heard the whole question at your own risk.',
    objective: true,
    solo: false,
  },
  {
    key: 'counting',
    name: 'Count to twenty',
    rule: 'Your whole team, no order agreed in advance. Count to twenty out loud. Any two people speaking at once and you start again. First team to reach twenty wins.',
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
    rule: 'The other team gives your actor something to act out. Sixty seconds, no talking, no pointing at real objects, no spelling in the air. Both teams get a turn; whoever guessed theirs faster wins.',
    objective: false,
    solo: false,
  },
  {
    key: 'fishbowl',
    name: 'Fishbowl',
    rule: 'The other team gives your describer a word. Thirty seconds to get your team to say it — without using the word, any part of it, or a rhyme. Both teams take a turn.',
    objective: false,
    solo: false,
  },
  {
    key: 'majority',
    name: 'Majority rules',
    rule: 'Somebody asks a question with no right answer — best pizza topping, worst Brady Street bar. Everyone but your captain answers quietly, then your captain guesses what most of them said. Match the majority and you win. Both teams go.',
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
