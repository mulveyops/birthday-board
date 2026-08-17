# World Inventory — Lower East Side Board

*Actual feature counts inside the board polygon (~0.5 km², Brady Street neighborhood), measured 2026-08-17.
Sources: OpenStreetMap via Overpass (tags kept this time), and the City of Milwaukee street-tree inventory via the Wisconsin Community Tree Map (WI DNR / TreePlotter). Per-tree data saved to `data/city_street_trees.json`.
Companion to `ART_PIPELINE_REPORT.md`. This inventory is the ground truth for Asset Vocabulary v1.*

## Buildings — 947 footprints

| building= | count | | size class (footprint) | count |
|---|---|---|---|---|
| house | 323 | | 80–140 m² (small house) | 409 |
| residential | 276 | | 140–220 m² (house/duplex) | 219 |
| garage | 108 | | 40–80 m² (garage/small) | 141 |
| apartments | 73 | | <40 m² (shed) | 68 |
| retail | 69 | | 220–400 m² (large res) | 62 |
| shed | 33 | | 400–1000 m² (apt/commercial) | 39 |
| yes (untyped) | 21 | | 1000+ m² (major) | 9 |
| commercial 9 · roof 8 · industrial 5 · detached 4 · church 3 · terrace 3 · construction 3 · school 2 · barn 2 · public/civic/office/carriage_house/warehouse 1 each | | | | |

- **`building:levels` on 901 of 947 (95%)** — 1-story: 309, 2-story: 511, 3: 42, 4: 15, 5: 4, 6: 3, 7: 2, 8: 1, **24: 1** (Arlington Court tower), plus 13 half-story values.
- Addresses on 830 (88%). Names on 62. `height` on only 15.
- **`historic=building` on 268 structures** + 2 historic districts — the neighborhood's old fabric is explicitly tagged.
- Named buildings include: Saint Hedwig Catholic Church (6 lvl), Fink's, Wolski's Tavern, Glorioso's Italian Market, The 1818 Lofts, Western Leather Lofts, Buckingham Apartments (8 lvl), Hamilton Stables (barn!), Brady Street Lift Station.

**The modal building of this board is a 2-story house on an 80–140 m² footprint — the Milwaukee duplex/Polish-flat silhouette is literally the statistical center of the neighborhood.**

## Trees

### City street-tree inventory (real, per-tree, species-accurate)
891 trees in the board bbox → **715 inside the board polygon**. Condition: 414 Good / 260 Fair / 18 Poor / 2 Excellent. DBH: median 10″, max 41″. Landuse: 478 residential streets, 202 commercial.

| Species | n | | Genus rollup | n |
|---|---|---|---|---|
| Ash, Green | 106 | | Linden | 143 |
| Linden, Littleleaf | 99 | | Maple | 139 |
| Norway Maple | 77 | | Ash | 114 |
| Honeylocust | 77 | | Honeylocust | 77 |
| Japanese Tree Lilac | 72 | | Lilac | 72 |
| Callery Pear | 37 | | Elm | 43 |
| Linden spp | 33 | | Oak | 41 |
| Hybrid Elm | 21 | | Pear | 37 |
| Swamp White Oak | 18 | | Serviceberry | 14 |
| Freeman Maple | 16 | | Apple | 12 |
| Elm spp 14 · Hedge Maple 13 · Apple 12 · Amur Maple 9 · English Oak 9 · + 24 more species | | | Hackberry 8, then long tail | |

Top 8 genera = **93% of all street trees.** Notable singles: one American Elm at 33″ DBH (a Dutch-elm survivor), one Ginkgo, one River Birch, one Bald Cypress just outside the polygon.

- **Zero conifers in the street inventory.** Spruce/pine/arborvitae on this board exist only in private yards and parks — conifer assets are yard/park dressing, not street trees.
- ~130 trees (lilac, pear, serviceberry, apple, hawthorn) are **small ornamental flowering trees** — a distinct silhouette class from shade trees.
- Caveat: 114 ash still listed; EAB removals may postdate the inventory. The city publishes an EAB-confirmation layer; Steven's walk-arounds can verify blocks that matter.

### OSM vegetation
232 `natural=tree` nodes (0 with species — OSM adds coverage in parks/yards, city data adds truth on streets), 1 tree row, 12 gardens, 113 `landuse=grass` patches, 62 scrub, 5 wood patches. Barriers: **167 fence ways (3.2 km!)**, 97 retaining walls (1.5 km — the bluff!), 26 walls, 1 hedge.

## Recreation
2 real parks — **Cass Street Park (9,000 m²)** and **Pulaski Street Playfield (9,900 m²)**. 8 pitches: **5 tennis, 2 basketball, 1 baseball** (with true orientation in OSM). 6 playgrounds. 16 picnic tables, 11 outdoor-seating areas.

## Civic & landmarks
- Churches: 3 — Saint Hedwig (roman catholic), Three Holy Women Parish – Saint Rita, Old Mount Zion New Jerusalem (pentecostal).
- Schools: 2 — Cass Street School, Tamarack Waldorf Elementary.
- **No fire station, police station, library, or post office inside the polygon.** The civic pack for THIS board is churches + schools.
- 10 `tourism=artwork` pieces (murals/sculptures — Brady Street is muraled).

## Commercial
23 named bars/pubs (Wolski's, Y-Not II, Hosed on Brady, Fink's, Up and Under, Jamo's, Hi Hat, WürstBar, Nomad-adjacent corridor…), 27 restaurants/cafés/fast food/ice cream, ~21 shops across 13 categories (hairdresser 5, dry cleaning 2, tattoo 2, tobacco 2, clothes 2, plus bakery/supermarket/convenience/bicycle/etc.).

## Transportation & infrastructure
- 26 named streets (Brady, Farwell, Humboldt, Astor, Cass, Pulaski, RiverWalk Way…). Way classes in bbox: 62 residential, 37 secondary, 8 tertiary, **541 footways**, 5 paths, 1 cycleway.
- **482 mapped driveways, 19 alley segments (1.03 km), 48 parking aisles** — the accessory-building composition (garages off alleys/driveways) is fully data-supported.
- 107 parking features, 540 pedestrian crossings, 13 bus stops, 4 traffic signals, **47 fire hydrants**, 34 benches, 54 bicycle parkings, 21 waste baskets, 5 flagpoles, 2 chimneys, 1 tower.
- No railway, no bridges inside the polygon (river corridor sits just outside the west edge).

## What this means for Asset Vocabulary v1 (data-driven priorities)

1. **Residential pack carries the board**: two-story narrow house / Polish flat / duplex (≈500+ instances), one-story bungalow (≈300), detached garage (108) + shed (33+68 small footprints), 3–4 story apartment (73), rowhouse/terrace (3 named rows + Astor/Graham rows). Lot dressing: fence (3.2 km mapped!), retaining wall (the East Side bluff look), driveway, hedge (rare in data — art-side choice).
2. **Tree pack, in priority order**: honeylocust, littleleaf linden, Norway maple, green ash, **small-flowering class** (lilac/pear/serviceberry/apple), hybrid/American elm, swamp white oak, Freeman maple — that's 90%+ real coverage. Conifers only as yard/park variants. Genus-level assets alone would cover 93% truthfully.
3. **Ground assets**: tennis court ×5, basketball ×2, baseball diamond ×1, playground ×6, parking lot ×dozens, crosswalk ×540 (use sparingly at signals: 4).
4. **Civic/landmark**: church ×3 (one is the St. Hedwig hero), school ×2 — a small, finishable set.
5. **Commercial**: storefront/corner-bar assets earn heavy reuse (23 bars + 27 food + 21 shops on essentially two corridors).
6. **Street furniture (Level 0–1)**: hydrant, bench, bus stop, bike rack, picnic table all have real mapped positions — place-exactly rather than scatter.
