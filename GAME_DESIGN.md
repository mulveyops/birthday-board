# Milwaukee Birthday Game — Design Doc

**Status:** v0.1 draft · started 2026-08-04
**Format:** city-wide, real-time, walk-around party game · "Mario Party meets Pokémon GO"

> This is a living blueprint. Numbers marked _(tunable)_ are starting proposals to
> react to, not final. Open decisions are collected in [§13](#13-open-decisions).

---

## 1. Vision & constraints

A physical, city-wide game for the couple's **joint birthday**. Guests split into
teams and roam Milwaukee's **Lower East Side** on foot for an afternoon/evening,
collecting resources and claiming **Stars** at bars, battling rival teams, and
converging on a known **final bar** for a climactic finish.

| Constraint | Value _(tunable)_ |
|---|---|
| Players | ~30–40 |
| Teams | 6–8 teams of ~5 |
| Duration | 3–4 hours |
| Setting | Lower East Side, ~30-min walk radius (Ogden → river → Farwell) |
| Devices | **One phone per team** |
| Ending | Everyone at the final bar by a hard deadline |
| Vibe | Playful, social, low-friction, inclusive, safe |

**Design north stars**
- **Feet are the dice.** Movement is your real body walking the real city. No
  die rolls, no token-hopping.
- **The app is a toolbox, not a referee.** It tracks state and serves prompts;
  players verify physical things (battles, tasks) among themselves.
- **Ritual > alcohol.** Drinking is the social ritual; **NA / water always counts.**
  Safety and inclusivity are first-class.
- **Battery-safe.** GPS is a **single read on tap (check-in), never continuous
  tracking.**

---

## 2. Core model — POI-only _(the pivotal decision)_

**Streets are just streets.** They're the map and your navigation — not a game
board. There are **no tiles and no movement graph.**

The only interactive objects are **Spots** (points of interest) pinned to real
places. The loop:

1. Open the app → see the map: your uncleared spots, active Stars, and rival
   teams' last-known positions.
2. **Walk** to a spot.
3. When GPS says you're within the spot's **radius** (~30 m _(tunable)_), a
   **Check-in** button lights up.
4. Tap it → the spot's **interaction** fires (trivia / challenge / puzzle / grab).
5. Complete it → earn rewards (scaled to performance) → the spot **grays out for
   your team** (one-time-per-team).

> _Why this over tiles:_ you never "move N spaces," so discrete tiles never
> matched the physical game. This is simpler, matches reality, and keeps every
> mechanic below. Exploration is rewarded by **spreading spots densely** so
> covering ground = finding spots — not by continuous GPS coin-trails (battery).

---

## 3. Players, teams & setup

- Guests are divided into **6–8 teams of ~5** (balance by mixing friend groups /
  ability; method TBD — draft, random, or pre-assigned).
- Each team gets **one phone** running the app (a web link, no install).
- All teams **start at the same bar** at a set time, get a 2-minute rules primer,
  and are released together.
- Teams pick a **name** (and maybe a color/emoji token shown on the live board).

---

## 4. The map & spots

Spots are placed by the organizer in the board designer and typed. Proposed
taxonomy:

| Spot type | What it is | Reward | Density _(tunable)_ |
|---|---|---|---|
| **Coin** | Quick tap / micro-task | +coins (small) | Common — the exploration grind |
| **Challenge** | A task: trivia, puzzle, dare, photo mission | +coins scaled to performance | Common |
| **Chance** | Random event (bonus, item, curse, "mugging") | Variable — Mario-Party luck | Uncommon |
| **Item** | Grab one tactical item | 1 item | Uncommon |
| **Battle / Arena** | An encounter between teams → produces a winner (resolution TBD, §8) | Winner takes coins/item/contest | Uncommon |
| **Bar (Star hub)** | Where Stars are claimed; also beers + social convergence | Stars, beers | ~4–6 across the map |
| **Start / Finish** | Fixed anchors | — | 1 each |

**How a spot is claimed — two behaviors**

Every spot has a **claim mode**. The two that do the real work:

| Mode | Who gets it | Feel |
|---|---|---|
| **Static + per-team** _(default)_ | every team, once each | Bread-and-butter pickups (coins, challenges). Grays out **for you** when cleared → teams **fan out**. |
| **Spawned + first-come** | one team only, then gone | Dynamic **drops** that appear at a random time + place, claimed by whoever checks in first → teams **converge & race**. |

These are opposing social forces, and the push–pull is the point:
- **Static per-team pickups spread teams out** — clear it, it's gone for you, go find another.
- **Spawns pull teams back together** — _"a rare item appeared near Brady & Farwell!"_ — which is what feeds battles, robberies, and star contests, and gives the live board a job (should I race for it?).

**Spawn cadence _(confirmed direction):_** a new spawn appears on a **jittered 15–25 min interval** — never a fixed beat, always mixed up so teams can't clock it. Concurrency / expiry / fairness are deferred (§13).

**Check-in is GPS-gated:** you must physically be within radius; no remote play.

---

## 5. Economy — two layers

### Layer A — Progression (how you win)
| Resource | Source | Role |
|---|---|---|
| **Coins** | Spots (grind currency) | Spent to claim Stars; also a bonus-star tiebreaker |
| **Stars** | Bought at bars (see §7) | **Victory points.** 2–3 live at once; **lock permanently once claimed** |

- Proposed: **~6 total Stars** across the game; **2–3 active at a time**; a Star
  costs **~150 coins to "buy a round"** _(tunable)_.

### Layer B — Battle (how you fight)
| Resource | Source | Role |
|---|---|---|
| **Beers = health** | Drinking at bars/spots (alcoholic **or NA — both count**) | Battle HP; **diminishing returns**, **no cap** |
| **Items** | Item/Chance spots | Tactical modifiers; **stealable out on the map** ("highway robbery") |

- Proposed item set _(tunable)_: **Reroll** (redo a battle round type), **Skip**
  (bypass a spot's task), **Double** (double a reward or battle damage), **Veto**
  (block a rival's item), **Shield** (block a steal), **Lockpick** (shorten your
  Star timer once).

---

## 6. Interactions (what happens at a spot)

When a team checks in, the app serves the spot's content:
- **Trivia** — questions (general + **about the couple**), scored.
- **Challenge** — a described task the team performs; they self-report / photo it.
- **Puzzle** — a riddle or mini-puzzle to solve.
- **Coin grab** — trivially fast, just a tap for a small reward.
- **Chance** — the app rolls an outcome.

**Rewards scale to performance** (speed, accuracy, or a judge's call), so good
teams pull ahead without making weak teams feel stuck.

---

## 7. The Star claim — the signature mechanic

> **✓ Confirmed core mechanic.** The whole point is that a Star is claimed *over
> a period of time*, so rivals get a window to show up and contest — the timer is
> the feature, not a nuisance.

To claim a Star at a bar:
1. **Buy a round** — spend coins. A **time-based meter (~12–15 min)** _(tunable)_
   starts.
2. While the meter fills, your team is **"settling in"** — and the Star is
   **contestable**. Rivals who are physically at the bar can **battle to steal it.**
3. **Contest difficulty scales with meter progress:** early on, an attacker has
   the edge (you haven't settled); late, the defender is entrenched. There's a
   race-to-contest window.
4. Finish the meter (uncontested, or having won the defenses) → the Star **locks
   to your team permanently.**

**Two viable paths to a Star** (core balance goal — both must be good):
- **Buy** — the grinder: pile up coins, claim a quiet/uncontested bar.
- **Take** — the fighter: camp a bar and steal a Star mid-claim via battle.

The Star meter also produces the natural **20–40 min bar dwell** (buy a round,
drink, socialize, fend off ambushes) without a rule forcing it.

---

## 8. Battles (PvP)

A **Battle is an event with a fixed interface — and a deliberately black-box
resolution for now:**

> **Teams in → one winner out.** Two (or more) teams enter; the app declares a
> winner. **How the winner is decided is intentionally left open** (§13) — treat
> it as a black box we'll fill in later. Everything else can be designed around
> that contract.

- **Triggers (how a battle starts):**
  - a **Battle / Arena spot** (a place on the map where battles happen), and/or
  - a **Star contest** at a bar (§7), and/or
  - a **robbery** ("highway robbery") or straight PvP wager when teams meet.
- **Stakes (the winner gets, the loser loses):** coins, or one item, or the Star
  contest. These are defined; only the *how-you-win* is deferred.
- **Resolution — NOT decided yet.** Candidate directions (do **not** treat as
  chosen): a quick skill mini-game (charades / Fishbowl / couple-trivia), a
  health/Beers duel, or something else. Parked in §13.

---

## 9. The session — pacing & flow

```
T+0:00   All teams at the START bar. Rules primer. Release.
T+0:00 → Roam: clear spots, grind coins, grab items, drink (beers).
         First Stars go live at bars. Buy vs. Take begins.
         Teams cross paths → battles, robberies, contests.
~T+3:00  Final Stars resolve. Teams drift toward the FINAL bar.
T+3:30   HARD DEADLINE: everyone at the final bar. Tally.
         (Optional) climactic tournament bracket.
```

---

## 10. Endgame & winning

- **Primary victory:** most **Stars** at the deadline.
- **Bonus Stars (Mario-Party style, tiebreakers / flair):** most coins, most
  spots cleared, most battles won, most ground covered, etc.
- **Optional finale:** a **tournament bracket** seeded by resources (so leaders
  aren't eliminated early), for a shared climactic moment at the final bar.
- Exact win formula & tiebreak order: **open (§13).**

---

## 11. Safety, inclusivity & battery

- **NA / water counts as a beer** everywhere — the ritual is drinking *together*,
  not alcohol. No one is disadvantaged for not drinking.
- **Check-in on tap only** (single GPS read). No continuous tracking → protects
  battery and privacy. The live board shows each team at its **last check-in.**
- Encourage hydration/pacing; the Star dwell builds in natural breaks.
- Walking-radius kept small (~30 min) so no one is stranded.

---

## 12. Numbers to tune _(single source of truth for knobs)_

| Knob | Proposed start | Notes |
|---|---|---|
| Check-in radius | 30 m | GPS accuracy vs. precision |
| Total Stars | 6 | Scarcity drives conflict |
| Stars active at once | 2–3 | Focuses teams |
| Star cost (buy a round) | 150 coins | vs. average grind rate |
| Star meter length | 12–15 min | Drives bar dwell + contest window |
| Coin spot reward | +10 | The grind unit |
| Challenge reward | +20–50 | Performance-scaled |
| # spots total | ~40–60 | Density = exploration reward |
| **Spawn cadence** | **new spawn every 15–25 min, jittered** | Confirmed direction; never a fixed beat |
| Spawns live at once | 1–2 | Open — see §13 |
| Battle resolution | **TBD (black box)** | Interface fixed: teams in → winner out |
| Session length | 3.5 h | Hard final-bar deadline |

---

## 13. Open decisions

1. **Battle resolution (deliberately deferred):** how is the winner actually
   decided? Skill mini-game, a Beers/health duel, something else? The interface
   (teams in → winner out) and the stakes are fixed; only this is open. Includes
   the sub-question of **how Beers (health) plug in**, if at all.
2. **Star contest logistics:** must the attacker be physically at the bar for the
   whole contest? (Proposed: yes, GPS-gated.) How is a "defense" resolved — a
   battle each time, or one battle per attacker?
3. **Live board fidelity:** is "last check-in position" enough for the shared
   board to feel alive, given tap-only GPS?
4. **Exact economy values:** coin rewards, Star cost, meter length, # Stars/# spots.
5. **Win formula & tiebreakers:** Stars first, then which bonus stars, in what order?
6. **Team formation:** draft, random, or pre-assigned? How are the 6–8 phones set up?
7. **Content volume:** how many trivia/challenge/puzzle prompts do we need to
   author, and who writes them (esp. the couple-trivia)?
8. **Dispute/honor handling:** self-reported tasks & battle outcomes — how much
   does the app enforce vs. trust?
9. **Which real spots** map to which types (needs the finalized board).
10. **Spawn details:** cadence is set (15–25 min jittered), but — how many live at
    once? Do unclaimed spawns **expire**? How is **fairness** handled so a spawn
    isn't a free gift to the nearest team (countdown? spawn away from any one team?)
    vs. just embracing the luck?

---

## 14. Build implications _(for later — not rules)_

The runtime the rules imply, roughly in slice order:
1. **Core loop (local prototype):** map + spot + GPS check-in + one interaction +
   coins + gray-out. Proves the concept on a phone.
2. **Teams & economy:** coins, beers, items, inventory.
3. **Stars & bars:** the buy-a-round meter + lock.
4. **Real-time backend:** live shared board, contests, robberies (teams need to
   see each other → needs a server, not just localStorage).
5. **Battles:** the 2v2 toolbox.
6. **Endgame:** tally, bonus stars, optional bracket.

> The board designer (this repo today) becomes the **authoring tool** that exports
> the board definition — boundary, streets (map art), and the typed spots with
> their attached content — which the runtime consumes.
