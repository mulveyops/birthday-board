# Block kits — what to hand ChatGPT

Each folder holds the three files for one block. Drag **all three together** into the chat:

- `block-NN-brief.md` — the instructions: canvas size, bounding streets, landmarks that must appear, and what is really on that block
- `block-NN-context.png` — where the block sits on the board, paintable area washed red, streets labeled
- `block-NN-canvas.png` — the stencil: paint the white, leave everything else transparent

When the painting comes back, file it with one command (with no file argument it
grabs the newest ChatGPT image out of Downloads):

```bash
node art-prototype/block-compose.mjs add <blockNumber>
```

That rebuilds `art-prototype/out/board-painted.png` with every block filed so
far, plus `board-painted-crop-NN.png` — a 2× crop for judging the new one.

## Landmark blocks — worth doing first

These carry named places that have to read as themselves, so they exercise the
identity rules while the loop is still fresh.

| # | Folder | Must appear | Streets | Canvas |
|---|---|---|---|---|
| 13 | `kits/block-13/` | The Standard Tavern, Pete's Pub, Hi Hat Garage | North Pulaski Street · North Arlington Place · East Brady Street · North Franklin Place | 868×948 |
| 1 | `kits/block-01/` | Fink’s, Scaffidi’s Hideout | North Water Street · North Astor Street · North Humboldt Avenue · East Land Place · East Hamilton Street · North Marshall Street | 804×552 |
| 2 | `kits/block-02/` | Jamo's | East Kane Place · North Warren Avenue · East Hamilton Street · North Arlington Place | 532×1108 |
| 4 | `kits/block-04/` | WOLSKI'S | East Kane Place · North Arlington Place · North Pulaski Street · East Hamilton Street | 1224×1632 |
| 11 | `kits/block-11/` | ST. HEDWIG'S | East Hamilton Street · North Franklin Place · East Brady Street · North Humboldt Avenue | 564×948 |
| 20 | `kits/block-20/` | GLORIOSO'S | East Brady Street · North Humboldt Avenue · East Kewaunee Street · North Astor Street | 664×772 |
| 21 | `kits/block-21/` | Angelo's Piano Lounge | East Brady Street · North Cass Street · East Pleasant Street · North Van Buren Street | 540×1704 |

## The rest — neighborhood fabric

Houses, trees, garages, yards, the odd corner shop. Any order.

| # | Folder | Must appear | Streets | Canvas |
|---|---|---|---|---|
| 3 | `kits/block-03/` | — | East Kane Place · North Pulaski Street · East Hamilton Street · North Humboldt Avenue | 748×1176 |
| 5 | `kits/block-05/` | — | East Land Place · North Astor Street · East Hamilton Street · North Marshall Street | 624×384 |
| 6 | `kits/block-06/` | — | East Land Place · North Humboldt Avenue · East Hamilton Street · North Astor Street | 584×388 |
| 7 | `kits/block-07/` | — | East Hamilton Street · North Marshall Street · East Pearson Street · North Cass Street | 600×372 |
| 8 | `kits/block-08/` | — | East Hamilton Street · North Astor Street · East Pearson Street · North Marshall Street | 616×372 |
| 9 | `kits/block-09/` | — | East Hamilton Street · North Humboldt Avenue · East Pearson Street · North Astor Street | 604×372 |
| 10 | `kits/block-10/` | — | North Water Street · North Cass Street · East Pearson Street | 316×316 |
| 12 | `kits/block-12/` | — | East Hamilton Street · North Warren Avenue · East Brady Street · North Arlington Place | 528×948 |
| 14 | `kits/block-14/` | — | East Pearson Street · North Marshall Street · East Brady Street · North Cass Street | 600×408 |
| 15 | `kits/block-15/` | — | East Pearson Street · North Astor Street · East Brady Street · North Marshall Street | 616×404 |
| 16 | `kits/block-16/` | — | East Pearson Street · North Humboldt Avenue · East Brady Street · North Astor Street | 600×404 |
| 17 | `kits/block-17/` | — | East Brady Street · North Warren Avenue · North Arlington Place | 608×848 |
| 18 | `kits/block-18/` | — | East Brady Street · North Astor Street · East Kewaunee Street · North Marshall Street | 544×772 |
| 19 | `kits/block-19/` | — | East Brady Street · North Marshall Street · East Kewaunee Street · North Cass Street | 544×788 |
| 22 | `kits/block-22/` | — | East Brady Street · North Franklin Place · East Pleasant Street · North Humboldt Avenue | 580×1712 |
| 23 | `kits/block-23/` | — | East Brady Street · North Arlington Place · North Warren Avenue · North Franklin Place | 636×2028 |
| 24 | `kits/block-24/` | — | East Kewaunee Street · North Astor Street · East Pleasant Street · North Marshall Street | 544×760 |
| 25 | `kits/block-25/` | — | East Kewaunee Street · North Marshall Street · East Pleasant Street · North Cass Street | 544×732 |
| 26 | `kits/block-26/` | — | East Kewaunee Street · North Humboldt Avenue · East Pleasant Street · North Astor Street | 660×760 |
| 27 | `kits/block-27/` | — | East Pleasant Street · North Franklin Place · North Humboldt Avenue | 564×664 |
| 28 | `kits/block-28/` | — | East Pleasant Street · North Cass Street · North Van Buren Street | 540×752 |
| 29 | `kits/block-29/` | — | East Pleasant Street · North Marshall Street · North Cass Street | 536×752 |
| 30 | `kits/block-30/` | — | East Pleasant Street · North Astor Street · North Marshall Street | 544×752 |
| 31 | `kits/block-31/` | — | East Pleasant Street · North Humboldt Avenue · North Astor Street | 660×748 |

Regenerate any kit with:

```bash
node art-prototype/block-kit.mjs art-prototype/out/board-prototype.json <blockNumber>
```
