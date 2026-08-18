# Phase D2 — Hero Reference Packets v1

*Prepared by Claude for ChatGPT's hero-art generation. Data sources: OSM footprints/tags (unusually rich for all three — architects, materials, historic names), the city street-tree dataset, current SceneModel positions, and web references below. Phase D1 tagged as `vocab-v1-phase-d1`.*

Style contract reminder for all three: Style C — thick cartoon outlines, stronger-oblique standing perspective (facade + shallow receding roof plane; pitched roofs show only a ridge sliver, flat roofs show deck), brighter-but-controlled palette, simplified interiors, subordinate to the cream gameplay path. Transparent-background concepts welcome; raster is fine — vector purity is a later decision.

---

## HERO 01 — `hero.st_hedwig`

### Identity
- **Saint Hedwig Catholic Church** (OSM: "Saint Hedwig Catholic Church"; historic "Saint Hedwig Roman Catholic Church"), Three Holy Women Parish.
- 1702 N Humboldt Ave — **43.053174, −87.897631**.
- Current SceneModel: `bldg.civ.church` structure s0, scale 1.7, priority 1 (appears in all three test slices; e.g. pulaski slice at x152.6 y403.6).
- Replaces: the generic tower-church s0 at this location (name-keyed).

### Real geometry (OSM)
- Footprint **987 m², 48 × 26 m**, long axis east–west; **facade faces west onto Humboldt Ave**, where Brady Street crests the hill — the building visually anchors the entire corridor.
- `building:levels` 6 + `roof:levels` 2. Spire height **162 ft (~49 m)** per multiple sources.
- Tags: `building:material=cream_city_brick`, `building:architecture=romanesque_revival`, `building:architect=Henry Messmer`, `historic=building`, parish founded 1871, **current building 1886**.

### ⚠ Correction to current art
Our generic s0 draws St. Hedwig in **red brick**. The real church is **Cream City brick** (pale cream/yellow — Milwaukee's signature material). The hero must flip to cream.

### Recognition features
**Must preserve (ranked):**
1. Single tall **central tower with copper-clad spire** — the spire has an Eastern European character (slightly domical/bulbous transition at its base) and is patina-green.
2. **Cream City brick** body with stone/darker trim.
3. **Round-arched (Romanesque) windows** — arched openings everywhere, in pairs on the tower.
4. Tall gabled nave running back behind the tower.
5. Extreme verticality: the spire towers over everything on Brady.

**Can simplify:** side-aisle articulation, corbel/brick detailing, bell openings, rear massing.
**Can exaggerate:** spire height and copper-green saturation; the arch rhythm; the "crowning the hill" presence.

### Palette (approx real)
Cream body (warm pale ochre-cream), **copper-patina green spire**, brown-gray slate nave roof, limestone/pale stone trim, dark wood doors, stained-glass blue-purple windows.

### Context
None needed beyond siting — its context *is* the corridor crest. Restraint recommended; the tower does the work.

### References
- [Wikipedia: St. Hedwig's (Milwaukee)](https://en.wikipedia.org/wiki/St._Hedwig%27s_(Milwaukee)) — architecture summary + a clear 2022 exterior photo ("Milwaukee July 2022 013" on the page) showing tower, spire, cream brick.
- [Urban Milwaukee building page](https://urbanmilwaukee.com/building/st-hedwigs-roman-catholic-church/) — photo(s) + "162-foot tower, copper-clad spire" description.
- [Architecture of Faith Milwaukee — St. Hedwig's](http://architectureoffaithmilwaukee.info/II-Romanesque-Revival/16-St-Hedwigs-Catholic.aspx) — Romanesque Revival analysis with photos.
- [Parish page](https://www.threeholywomenparish.org/locations/st-hedwig/) — current photos.
- [Urban Milwaukee: Cream City's Classic Churches](https://urbanmilwaukee.com/2014/09/03/milwaukee-architecture-the-cream-citys-classic-churches/) — context on cream-brick church family.
- [Street View at the site](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=43.053174,-87.897631) — walkable multi-angle reference.

---

## HERO 02 — `hero.wolskis`

### Identity
- **Wolski's Tavern** (OSM: "Wolski's Tavern"), family-run bar since 1908 in an **1895 front-gabled wood building**.
- 1836 N Pulaski St — **43.055231, −87.896601**.
- Current SceneModel: `bldg.com.corner_tavern` s0, scale 1.3, priority 2, `facing` 93° (toward its Pulaski intersection); pulaski slice at x242.6 y175.
- Replaces: the generic corner tavern at this location.

### Real geometry (OSM)
- Footprint **192 m², 18 × 13 m** — deliberately modest; a house-scaled tavern.
- `building:levels` 2 (+ basement), `roof:levels` 0.5, `building:architecture=front_gabled`, `building:material=wood`, `building:units=2`, `outdoor_seating=yes`, `historic=building`.
- Faces Pulaski Street; **directly across from Pulaski Playfield's tennis courts** — which our board already renders next to it, a genuine context win.

### Recognition features — the D2 stress test
The challenge: recognition through *character*, not monument scale.
**Must preserve (ranked):**
1. **Front-gabled two-story wood building** — reads as "a house that became a bar," roughly domestic proportions.
2. **Painted signboard band reading WOLSKI'S** across the first-floor facade (readable text explicitly allowed for this hero).
3. Light **clapboard siding** (white/cream) with dark trim and a dark roof.
4. Street-level tavern front: door + small windows with beer-sign warmth.
5. Its modesty itself — do NOT monumentalize; it should stay smaller than the church by a lot.

**Can simplify:** window count, rear additions.
**Can exaggerate:** the warm glowing windows, the sign band, and (optional easter egg) a tiny **"I CLOSED WOLSKI'S" bumper-sticker** nod somewhere — the sticker is the bar's world-famous artifact.

### Palette (approx real)
White/cream clapboard, dark charcoal/brown roof, dark green or black trim, warm amber windows, red accent for the sign or neon.

### Context
`outdoor_seating=yes` — a couple of sidewalk picnic tables or a small patio strip would be authentic and cheap. The adjacent tennis courts/playfield are already on the board.

### References
- [johndecember.com photo album — Wolski's](https://johndecember.com/places/mke/album/wolskisphotos.html) — multiple clean exterior angles; the best structural reference.
- [Urban Milwaukee gallery](https://urbanmilwaukee.com/business/wolskis-tavern/nggallery/image/image-1054/) — exterior photo.
- [Yelp — 80 photos](https://www.yelp.com/biz/wolskis-tavern-milwaukee) — facade, sign, interior warmth.
- [Tripadvisor photo](https://www.tripadvisor.com/LocationPhotoDirectLink-g60097-d4949347-i118340290-Wolski_s_Tavern-Milwaukee_Wisconsin.html) — exterior.
- [wolskis.com](https://www.wolskis.com/) — branding/logo treatment for the sign.
- [Street View at the site](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=43.055231,-87.896601).

---

## HERO 03 — `hero.gloriosos`

### Identity
- **Glorioso's Italian Market** (OSM: "Glorioso's Italian Market"; short "Glorioso's") — Brady Street institution since 1946, in this building since 2010.
- 1011 E Brady St — **43.052838, −87.899352**.
- The building is the **former Astor Theatre** (OSM `name:historic`, `start_date=1913`; Progressive Grocer says built 1907 — treat as 1907–1913 era theatre), later Brady Street Pharmacy, `building:material=stucco`, `historic=building`, architect Myers E. Becongia.
- Current SceneModel: `bldg.com.mixed_use` s2 (corner form), scale 1.0, priority 2, `facing` −129°; brady slice at x61.4 y359.
- Replaces: the generic corner mixed-use at this location.

### Real geometry (OSM)
- Footprint **909 m², 40 × 30 m** — the biggest commercial mass on Brady; long axis along Brady, **storefront faces south onto Brady Street**.
- `building:levels` 2 — but the interior is a tall single theatre volume (renovation removed an inserted second floor; ceiling soars to terra cotta tile).

### Recognition features
**Must preserve (ranked):**
1. **Wide, low theatre-block massing with a tall flat parapet** — reads as "old theatre turned market," clearly bigger and flatter-topped than its neighbors.
2. **Prominent horizontal GLORIOSO'S signage band** across the facade (readable text allowed).
3. **Italian tricolor cue** — green/white/red presence (awnings or banding) that says Italian market instantly.
4. Long **storefront glass run** along Brady at street level.
5. Light **stucco** body.

**Can simplify:** upper-facade window rhythm, parapet ornament.
**Can exaggerate:** the signage band and the tricolor; a hint of the theatre parapet curve if references support it.

### Palette (approx real)
Light stucco/cream body, deep green primary signage + awnings, red + white + green tricolor accents, dark storefront frames.

### Context
It anchors mid-Brady directly across from the family's original 1946 store. A sidewalk produce stand or awning run could be charming — restraint applies; the sign and massing carry it.

### References
- [gloriosos.com](https://gloriosos.com/) — branding, signage, current facade imagery.
- [Progressive Grocer feature](https://progressivegrocer.com/gloriosos-italian-market-milwaukee) and [New Era For Old World](https://progressivegrocer.com/new-era-old-world) — the Astor Theatre build-out story, some photos.
- [Yelp — 604 photos](https://www.yelp.com/biz/gloriosos-italian-market-milwaukee) — many exterior/signage shots.
- [Brady Street directory listing](https://bradystreet.org/directory/listing/gloriosos/) — corridor-context photo.
- [StoreMasters case study](https://www.storemasters.com/stores/gloriosos-italian-market/) — build-out imagery.
- [Street View at the site](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=43.052838,-87.899352).

---

## D. Integration recommendations

| | `hero.st_hedwig` | `hero.wolskis` | `hero.gloriosos` |
|---|---|---|---|
| Scale | **1.9** (vertical exaggeration concentrated in tower/spire — body stays ~1.5-equivalent) | **1.35** (modest; sign + character carry it) | **1.25** (real 40 m footprint already reads big; widen symbol, don't inflate) |
| `facing` | toward Humboldt Ave frontage (west); computed at placement like civic assets | keep current 93° (addresses its Pulaski corner) | south to Brady (current −129° corner logic acceptable; s2-style corner emphasis optional) |
| Anchor | ground center of **tower base** (so spire growth stays centered) | ground center of facade | ground center of Brady frontage |
| Priority | **0** (all three) | 0 | 0 |
| Eviction radius | **30 m** (suppress priority ≥4 buildings, all furniture, procedural trees; keep city-inventory street trees at the 15 m terrace band) | **20 m** (keep the neighboring houses close — its context is a residential block) | **24 m** (commercial neighbors may sit closer than residential would) |
| Replaces | `bldg.civ.church.s0` (name-keyed) | `bldg.com.corner_tavern` (name-keyed) | `bldg.com.mixed_use.s2` (name-keyed) |

Node protection unchanged and absolute: 26 m clearance, heroes never obscure nodes or the path. The existing name-keyed bespoke-registry mechanism from the original prototype is the intended integration seam — a hero is a SceneModel entry `{assetId: "hero.*", layer: "hero", priority: 0}` and the renderer resolves it exactly like any symbol (or as an embedded high-res transparent raster if we go that route; the SVG `<image>` element inside the same painter-sort works fine and the 16 MB budget is nowhere near threatened by three PNGs).

## Natural-hero compatibility (preserved, not implemented)
The architecture already supports non-building heroes: any SceneModel entry can be `hero.tree.american_elm`. The concrete candidate from our own dataset: **the 33″-DBH American Elm at 43.055741, −87.898172** (city inventory pid 3667642, condition Fair) — a Dutch-elm-disease survivor two blocks from Wolski's, currently rendered as a generic large elm at scale 2.05. When we get there, it needs only a bespoke symbol and a priority bump.

## Suggested generation order (per Steven's plan)
St. Hedwig first — 2–3 concept treatments, transparent background, judged against the actual board render (I can composite any concept into the pulaski slice within minutes for evaluation). Lock the hero-art language there, then Wolski's and Glorioso's inherit the DNA.
