# Real-Time Backend — Scoping

**Status:** scoping draft · 2026-08-04
**Goal:** turn the single-player sim into one **shared, live game** across ~8 phones.

---

## 1. What this unlocks

Everything competitive that can't work on one device today:
- **One shared game state** — every team sees the same board, the same claimed spots.
- **Live board** — each team's token (last check-in) visible to everyone in real time.
- **First-come spawns** — a drop appears for all; exactly one team can grab it.
- **Star contests** — a rival at the bar can contest your claim mid-meter.
- **Battles / robberies** — resource transfers between teams, recorded centrally.
- **Survives reality** — a phone that dies/refreshes rejoins and picks up where it left off.

---

## 2. Constraints (they make this *easier* than a typical multiplayer game)

| Constraint | Implication |
|---|---|
| **~6–8 teams, one phone each** | ~8 concurrent clients. Tiny. No scaling concerns. |
| **One event, ~3–4 hours, once** | No need for heavy infra, matchmaking, or accounts. |
| **Players are friends at a party** | Trust is high → security/anti-cheat can be light. |
| **Organizer (you) runs it** | There's a trusted "host" who sets up the game. |
| **Client already built** | Board, spots, economy, interactions, juice all exist — this is the *server + sync* layer only. |

---

## 3. Recommended architecture — **Supabase** (managed Postgres + Realtime)

No server to write or host. Postgres is the **authoritative shared state**; its transactions
and unique constraints resolve races *for free*; Realtime pushes every change to all phones.

**Why it fits best here**
- **Durable** — state lives in the DB, so a refreshed/dead phone **rejoins and resumes** (critical for a 4-hour real-world game). In-memory servers lose this.
- **Race-safe by construction** — "first team to grab this spawn" = an atomic guarded UPDATE / a unique constraint. Postgres guarantees exactly-one-winner. No custom locking.
- **Real-time out of the box** — subscribe to table changes over websockets; the live board just re-renders on push.
- **Zero ops / free** — the free tier covers 8 clients for one event with room to spare. No deploy of a backend process.
- **Auth-lite built in** — anon sessions per phone; team **join codes** for the rest.

**The key insight that removes most of the hard parts: no live server timers needed.**
Everything time-based is **timestamp-driven**:
- Spawns: generate the **whole spawn schedule at game start** (rows with `spawn_at`/`expires_at`). Clients just show/hide by comparing to `now`. No loop creating them live.
- Star meter: store `ends_at`; the first client to observe `now ≥ ends_at` writes the lock via a guarded update (`... WHERE status='claiming'`). Idempotent, no server cron.

**Alternatives considered**
| Option | Verdict |
|---|---|
| **PartyKit** (Cloudflare room = authoritative in-memory state) | Great fit, elegant race handling (single-threaded room); but in-memory (persistence is extra work) and you write the server. Strong #2. |
| **Firebase (Firestore/RTDB)** | Also fine — realtime listeners, presence. Race resolution via transactions. Preference call vs Supabase (SQL vs NoSQL). |
| **Ably/Pusher** (pub/sub only) | You'd hand-manage all state + races. More plumbing. |
| **Custom Node + Socket.IO** | Full control, but you host/deploy/maintain a process for a one-night game. Overkill. |
| **CRDT (Yjs/Liveblocks)** | Merges concurrent edits, but can't express "exactly one winner." Wrong tool for exclusive claims. |

---

## 4. How the pieces fit together

```
 DESIGNER (local, you)                SUPABASE                     PLAYERS (8 phones)
 build board  ──publish──►  games row (board JSON) ◄─subscribe──  join with team code
                            teams / claims / spawns / stars  ◄──►  GPS check-in, tap, play
                            (authoritative state)          push→   live board updates
```

- The **designer stays your local authoring tool**. "Publish" writes the finished board (+ the pre-computed spawn schedule) into a `games` row.
- The **play client** is the same app, deployed as a static site (Vercel/Netlify), pointed at Supabase. Players open a link, join a game with a **code**, and play against shared state.

---

## 5. Data model (Postgres tables)

| Table | Columns (essentials) | Purpose |
|---|---|---|
| `games` | id, board (jsonb), status, started_at, config | One game session; holds the published board. |
| `teams` | id, game_id, name, emoji, coins, stars, items, join_code | Each team's roster + resources. |
| `spot_claims` | game_id, spot_id, team_id, kind, at · **unique(game_id, spot_id, team_id)** | Static per-team clears (each team once). |
| `spawns` | id, game_id, spot_id, reward, spawn_at, expires_at, **claimed_by** | Pre-scheduled drops; first-come via guarded update. |
| `star_claims` | id, game_id, bar_spot_id, team_id, started_at, ends_at, status · **partial unique(bar) where active** | The buy-a-round meter + lock. |
| `positions` | team_id, lat, lng, spot_id, updated_at | Last check-in for the live board (or use Realtime Presence). |
| `events` | game_id, ts, type, payload | Feed: robberies, battle outcomes, star locks — drives the activity log. |

Race resolution examples:
- **Spawn grab:** `UPDATE spawns SET claimed_by=$team WHERE id=$id AND claimed_by IS NULL` → 1 row = you won, 0 rows = someone beat you.
- **Static clear:** `INSERT INTO spot_claims …` → unique constraint makes a repeat a no-op.
- **Star buy:** `INSERT INTO star_claims …` guarded by the partial-unique → only one active claim per bar.

---

## 6. Real-time sync

Each phone subscribes (filtered by its `game_id`) to changes on: `teams`, `spot_claims`,
`spawns`, `star_claims`, `positions`, `events`. Any write by any team pushes to all → the
board, HUD, and live tokens re-render. The client we built already renders from state; we
swap "React state" for "state hydrated + kept live from Supabase."

---

## 7. The hard parts — and how they're handled

| Concern | Handling |
|---|---|
| **Races** (spawn / contested claim) | Postgres atomic guarded writes + unique constraints. Exactly-one-winner, no locking code. |
| **Timers** (spawn cadence, star meter) | Timestamp-driven (pre-scheduled + `ends_at`). No server loop. |
| **Reconnect / dead phone** | State is in the DB; on reload the client re-hydrates from its `game_id` + local `team_id`. |
| **GPS accuracy** (urban ±10–30m) | Single read on tap (as designed); check-in radius ~30–40m to absorb drift. |
| **Cheating** | Friends at a party → light. Client-authoritative writes + server records; optional RLS later. |
| **GPS on tap** | `navigator.geolocation.getCurrentPosition` → distance to spot → allow claim if within radius. Drop-in for the desktop click. |

---

## 8. Key flows

1. **Setup (you):** finish board in designer → **Publish** → `games` row + team join codes + pre-computed spawn schedule.
2. **Join (team):** open link → enter name + code → creates/claims a `teams` row → `team_id` saved on the phone.
3. **Check-in:** tap → GPS read → within radius? → write `spot_claims` (or claim a spawn) → coins update → pushed to all.
4. **Spawn:** appears for everyone at `spawn_at`; first guarded update wins; disappears at `expires_at` or on claim.
5. **Star:** buy a round → `star_claims` (guarded) → meter from `ends_at`; contest = battle hook; lock on completion.
6. **Live board:** subscribe → every team's token, active spawns, star meters render live.
7. **Battle/robbery:** app = toolbox; outcome → `events` + resource transfer (resolution still black-box per GAME_DESIGN §13).

---

## 9. Build slices (incremental — each is playable/testable)

| # | Slice | Proves |
|---|---|---|
| **1** | Supabase project + schema; **publish board**; **join game with code** | Two phones sit in the same game. |
| **2** | **GPS check-in → shared spot_claims + per-team coins**; **live board** (tokens + cleared spots) | Real multiplayer core: we see each other play. |
| **3** | **Spawns** (pre-scheduled, first-come atomic claim) | The race mechanic works across devices. |
| **4** | **Stars & contests** (shared meter, lock, contest→battle hook) | The signature mechanic is live + contestable. |
| **5** | **Battles + events feed** (toolbox, transfers, activity log) | PvP + the "something's happening" feel. |
| **6** | **Robustness + host controls** (reconnect, start/pause/end, organizer dashboard) | Ready to run at the real party. |

**MVP that proves the whole idea = slices 1–2.** After that it's "add each mechanic to the shared layer."

---

## 10. Effort & cost

- **Cost:** **$0 extra.** User already pays for Supabase **Pro ($25/mo)** — which includes a
  Postgres database + Realtime + generous limits (100k MAU, 8 GB, 250 GB bandwidth). We add our
  ~6 tables in a dedicated **`game` schema** inside the **existing project**, isolated from other
  data; the game's footprint (8 phones, one evening) is negligible. A *new* project would add
  ~$10/mo (its own compute) — avoid by reusing the existing one. (A throwaway separate project is
  ~$10 for one month if full isolation is ever wanted.)
- **Effort:** slices 1–2 (join + shared check-ins + live board) are the meaningful lift and the proof; 3–6 layer on. No backend process to write — it's schema + client sync code.
- **Deploy:** the client is static React → Vercel/Netlify (free), env-configured with the Supabase URL/key.

---

## 11. Open decisions

1. **Platform:** Supabase (recommended) vs Firebase vs PartyKit vs custom.
2. **Timer authority:** timestamp-driven (recommended, no cron) vs a host-device loop vs scheduled edge functions.
3. **Join model:** anon session + team join code (recommended) vs named accounts.
4. **Board publish flow:** how the designer hands a finished board to a `games` row (button in the designer that writes to Supabase).
5. **Positions:** durable `positions` table vs ephemeral Realtime Presence (Presence is lighter, but lost on disconnect).
6. **Security depth:** open writes (trusted party) vs Row-Level Security scoping by game/team.
7. **Hosting:** where the player app is deployed (Vercel/Netlify).
