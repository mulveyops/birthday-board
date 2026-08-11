# Birthday Board 🎲🍺

A city-wide board game across Milwaukee's Lower East Side for a joint birthday —
Mario Party meets Pokémon GO. Teams walk the neighborhood, clear squares for coins,
and converge on bars to fight over stars.

This repo currently contains **Slice 1: the Board Designer** — you drop in a
picture of the play area (a map screenshot), draw your play-area boundary on it,
and place the squares that make up the board. The board is saved as JSON you can
export and share.

## Run it

```bash
npm install
npm run dev
```

Then open the printed URL (usually http://localhost:5173).

## How to use the designer

1. **Map picture → Add image** — drop in a screenshot of the neighborhood.
2. **Play area → Draw area** — click along the edges to outline where the game is
   played; drag the points to adjust, then **Finish area** (everything outside
   dims so it reads as a board).
3. **Add a square** — pick a type, then click the map to drop squares. Click a
   square to edit its title/type/reward/notes; drag to reposition.
4. The board autosaves to your browser. **Export JSON** to save/share a copy,
   **Import JSON** to load one.

> Positions are stored as normalized (0–1) coordinates relative to the picture,
> so the board stays correct at any screen size. Because it's a picture, there
> are no real GPS coordinates yet — later "check-ins" can be honor-system, or we
> can add a one-time step to align the picture to real-world coordinates.

## Square types

- 🍺 **Bar** — convergence hub; stars spawn here and battles happen
- 🧩 **Challenge** — puzzle/task; reward scales with performance
- 🪙 **Coins** — simple pickup, the grind currency
- 🎲 **Chance** — random event, good or bad
- 📍 **Point of Interest** — monument or photo/picture-clue spot
- 🚩 **Start** / 🏁 **Final Bar** — the endpoints

## Roadmap (later slices)

Teams & tokens · live GPS check-ins · star spawns & claim timers · 2v2 battles ·
scoreboard & endgame bracket. These need a realtime backend and build on this
same board data.
