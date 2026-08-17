# Environmental Art Pipeline — Implementation Report

*Prepared by Claude (implementation/data side) for the art-direction collaboration with ChatGPT.
Source of truth: `src/snap.ts` (OSM fetch), `src/generate.ts` (board + scenery bake), `src/BoardCanvas.tsx` (renderer), `src/types.ts` (data model). Board area: Milwaukee Lower East Side, roughly 1–2 km across.*

---

## 1. How the pipeline works today (architecture in one page)

**Fetch.** All OSM data comes from the Overpass API (4 public mirrors with failover, responses cached in `localStorage`, 7-day TTL, only 4 cache slots). Queries are **bounding-box** queries over the play area's bbox — not polygon-clipped. Two relevant fetches:

- **Streets** (`fetchStreetWays`): ways matching `highway ~ residential|living_street|tertiary|secondary|primary|unclassified|pedestrian`, with node recursion. Only node IDs + coordinates are kept. **All way tags — including street names — are discarded.**
- **Scenery** (`fetchScenery`): one combined query for land-use polygons, green space, water, and POIs (exact tag list in §2).

**Bake.** Scenery is fetched once when the designer clicks "add surroundings" and the result is **baked into the board JSON** (`board.scenery`) and persisted. This is a crucial architectural fact: *we already have a design-time compile step*. Expensive composition logic can run there — the live renderer never needs to touch OSM.

**Render.** The whole board is drawn as **one SVG overlay in world meters** (local equirectangular projection; 1 SVG unit = 1 meter). Leaflet scales it natively with zoom like a magnified static image — nothing re-renders or re-levels-of-detail while zooming. All art is inline React SVG sprite components (~20 of them) authored in **front-elevation / shallow-oblique style already**: each sprite is anchored at its ground point and grows "up" (screen north). Painter's algorithm (sort by screen y) handles overlap. Variation is deterministic (`hash01(x, y)` — no RNG at render, identical every frame).

**Current state:** the previous illustrated-city experiment is behind feature flags that are all **off** (`SHOW_FABRIC`, `SHOW_POIS`, `SHOW_BLOCK_TINTS`, `SHOW_GREENS` = false, `TREE_KEEP` = 0). Today's board renders: grass ground plane → water/rivers → sidewalk strips → street track → intersection nodes → bar sprites → clouds/ribbon/compass. So we have a clean slate visually, with the old system intact as reference code.

---

## 2. What OSM data we currently retrieve

| Query fragment | Kept as |
|---|---|
| `landuse = residential/commercial/retail/industrial` (ways) | polygon ring + kind ("block") |
| `leisure = park/garden/playground/pitch` (ways) | polygon ring, **all lumped into one `parks` array, tags discarded** |
| `landuse = grass/recreation_ground/village_green/cemetery` | ditto → `parks` |
| `natural = wood/scrub`, `landuse = forest` | polygon ring → `woods` |
| `natural = water`, `waterway = riverbank` | polygon ring → `water` |
| `waterway = river/stream/canal` | polyline → `rivers` |
| `amenity = bar/pub/biergarten` (nodes + building ways → centroid) | point + **name** |
| **ALL** `amenity` nodes/ways, **ALL** `shop` nodes/ways, `tourism = hotel/museum/gallery` | point (centroid for ways) + **emoji** + name, capped at 140, everything without an emoji mapping silently dropped |
| `highway` ways (streets, separate query) | geometry only; names/tags discarded |

**The single biggest conceptual limitation:** every feature is collapsed to either *an untagged polygon* or *an emoji point* at fetch time. The semantic richness of OSM (a pitch's sport, a church's denomination, a building's footprint and orientation, a park's name) is thrown away before anything downstream can use it. The "OSM tag → icon.svg" feel is baked in at the data layer, not just the art layer.

**Trees today are fiction:** no tree data is fetched at all. Trees are procedurally scattered inside park/wood polygons by area (~1 per 550 m², max 45/polygon, global cap 260) plus street-lining pairs every 70 m at a 17 m offset from centerlines. Stored as bare lat/lng — no species, no size.

---

## 3. Answers to the specific questions

### Q1 — What we retrieve: see §2.

### Q2 — What additional data is reasonably retrievable
Overpass can deliver all of the below in **one or two extra queries for our bbox** (the area is small; response sizes are a few MB at worst). None of this makes the pipeline unwieldy — the only caveat is the `localStorage` cache (~5 MB quota), which we'd swap for IndexedDB or bake results server-side. High-value additions:

- `building=*` ways with **full geometry and tags** (footprints, type, levels, height, addresses, names)
- `natural=tree` nodes with `species`/`genus`/`leaf_type`/`denotation`, plus `natural=tree_row` ways
- `leisure=*` with tags kept (esp. `pitch` + `sport=*`, `swimming_pool`, `playground`, `dog_park`, `marina`, `slipway`)
- `amenity=parking` polygons, `parking=surface/multi-storey`
- `highway=service` with `service=alley/driveway/parking_aisle` (Milwaukee alleys are well mapped — great for garage/back-lot composition)
- `railway=*` lines, `bridge=yes` on ways, `man_made=water_tower/tower/bridge`
- `barrier=fence/hedge/wall` ways, `leisure=garden` + `garden:type`
- point furniture: `amenity=bench`, `emergency=fire_hydrant`, `highway=street_lamp`, `amenity=bicycle_parking`, `highway=bus_stop`
- street **names** (already in responses we make; currently discarded)

### Q3 — Building information we currently have
**None.** `building=*` is never queried. Buildings only enter indirectly when a building way carries an `amenity`/`shop`/`tourism` tag — and then only its **centroid** survives. No footprints, no orientation, no heights, no levels, no addresses.

What's available if we fetch it (Milwaukee-specific reliability): footprint coverage in Milwaukee OSM is **very good** (Microsoft building-footprint import + active local mapping — nearly every structure has a polygon, including detached garages and sheds). Typed values (`house`, `apartments`, `garage`, `retail`, `church`, `school`…) are common but many are plain `building=yes`; `building:levels` is present on maybe 10–30% of structures (better downtown); `height` is rare; `addr:housenumber`/`addr:street` coverage is moderate-to-good from the address import. **Footprint area + shape + orientation is the reliable signal; type tags are a bonus; levels/height are hints, not data.**

### Q4 — Vegetation information
Currently: park/wood/scrub/forest/grass **polygons only** (untagged), trees invented procedurally.

Available in OSM: `natural=tree` nodes exist along some Milwaukee streets and in parks but coverage is **sparse and uneven**; `species`/`genus` tags exist on only a fraction of those. `natural=tree_row` occasionally. `leaf_type` (broadleaved/needleleaved) is the most common vegetation tag when trees are mapped at all.

**The real opportunity is off-OSM:** the City of Milwaukee maintains a public **street-tree inventory** (species, DBH, location, per-tree — Milwaukee Forestry data, available through the city open-data portal) covering essentially every terrace/parkway tree. Merging that (one-time conversion into our baked format) would give us *true species per street* — sugar maples, honey locusts, lindens, the whole Milwaukee palette — with far better coverage than OSM will ever have. Steven's plan to hand-survey trees composes naturally with this: the baked format just needs a `source: osm | city | manual` field. The proposed fallback chain (`species → genus → deciduous/conifer`) is exactly the right shape and easy to implement as a lookup table.

### Q5 — Park/recreation features
Currently fetched but flattened: `park`, `garden`, `playground`, `pitch`, `recreation_ground`, `village_green`, `cemetery`, `grass` — all become anonymous green polygons in one array. We literally cannot tell a playground from a cemetery downstream.

Available with tags kept: `leisure=pitch` + `sport=baseball/basketball/tennis/soccer` (reliable — pitch polygons are usually drawn accurately, with orientation, so a baseball diamond asset can be *placed and rotated to the real diamond*), `leisure=playground` (+occasional `playground=*` equipment nodes), `swimming_pool`, `dog_park`, `garden`, `marina`, `beach` (Bradford Beach if the board ever grows), park **names** (`name` on `leisure=park` is near-universal), paths inside parks (`highway=footway/path` — already fetched in the boundary-snapping query, just unused for scenery).

### Q6 — Commercial/civic/landmark information
Currently: every amenity/shop/tourism point flattened to ~25 emoji categories, name kept, capped at 140.

Available: full `amenity` taxonomy (place_of_worship + `religion`/`denomination`, school, library, fire_station, police, post_office, townhall, hospital/clinic, theatre, cinema, bank...), full `shop` taxonomy (100+ values — we'd bucket them), `tourism`, `historic`, `office`. `name` is nearly universal on real POIs. Reliability in this neighborhood: **commercial corridors (Brady St, North Ave, Farwell/Prospect) are densely and accurately mapped**; civic buildings (churches, schools, fire stations) are essentially complete and usually mapped **on their building polygon** — which means when we fetch buildings (Q3) we get civic landmarks *with their real footprints* for free. That's the natural source for Level 3/4 landmark selection: the code already has a name-keyed bespoke registry (St. Hedwig's, Fink's, Y-Not, Hosed, Nomad, two park scenes) that grafts hero art onto matched features — this pattern extends cleanly.

### Q7 — Transportation/infrastructure/environment for scene composition
All currently unfetched, all cheap to add: service alleys & driveways (composition anchors for garages/parked cars), `amenity=parking` lots (reliable polygons → parked-car clusters), bus stops + routes (MCTS stops are mapped; bus shelter assets), `railway=rail` (the lakefront/river corridors), bridges (`bridge=yes` segments — the Brady St and Holton St bridges are characterful), `man_made=water_tower`, street lamps/hydrants/benches (sparse but nonzero), `highway=traffic_signals`/`crossing` nodes (reliable — could drive crosswalk striping at big intersections), `power=line/tower` (probably skip — visual noise). Water is already good: river polygons + banks render today.

### Q8 — How the renderer positions SVG assets relative to OSM geometry
Everything is placed in **world meters** in one SVG; sprites are anchored at a ground point and never rotate (always screen-upright). Three placement systems exist (currently flag-disabled but working):

1. **POI "fronts":** each POI point is projected onto the nearest street segment, then offset perpendicular to its real-world side of the street, 17–40 m from the centerline. The setback is computed from the sprite's height × how much of its growth heads into the street, so a facade's roof never drapes over more than ⅓ of the road. Dedupe radius 22–26 m; heroes claim ground first, then bars, then everyday storefronts.
2. **Procedural "fabric":** walks every street polyline on both sides at 24 m intervals (narrow Milwaukee lots), 22 m setback, and stamps house/storefront/warehouse depending on which land-use block contains the point; skips water/parks/junctions/fronts; grows-then-clamps sprite height against *every* nearby street; caps at 520 buildings + 110 interior bushes.
3. **Coordinate-anchored bespoke scenes:** real lat/lng, snapped to the nearest park polygon centroid.

Layering today (bottom→top): grass → block tints → woods/parks → water/rivers → sidewalks → shadows → **track + nodes** → building sprites (painter-sorted by y, so southern buildings overlap the road edge — intentional, gives the shallow-oblique depth) → trees → park scenes → bar sprites → game tokens → clouds → cartouche.

### Q9 — Architectural constraints for the asset library
- **World-meter coordinate system, single static SVG.** Assets are authored in meters (a house ≈ 8 m wide, 10–17 m tall on screen). No zoom-dependent LOD exists — one composition must read at every zoom (fit-zoom to fit+3). Asset detail should target legibility at fit-zoom; fine detail is a bonus at close zoom.
- **Inline SVG components, not files.** Current sprites are hand-coded JSX. For a real library we'd want authored SVG files compiled into symbols (`<defs>/<use>`) — fine, but it's a build-step change worth planning. DOM node count is the real budget: the old fabric system at ~900 sprites × ~15 elements was fine; a much richer scene should use `<use>` refs to keep the DOM lean.
- **Sprites don't rotate.** Facade-style assets are always upright; the placement layer chooses position/side, never orientation. Top-down assets (pitches, parking lots, pools) are the exception and *should* rotate to their real geometry — that's a new capability to add (trivial SVG transform, but the asset spec needs to declare "rotatable footprint" vs "upright billboard").
- **Painter sort by y** is the depth model — shallow-oblique composes naturally with it; strong isometric would too; pure top-down doesn't need it. Mixed perspectives are risky *within* a layer but fine *across* layers (top-down ground markings + oblique buildings is the classic illustrated-map combo and matches what exists).
- **Determinism is required** (hash-of-position variation, no Math.random at render) so the board is stable across renders and clients.
- **Bake-time is free, render-time is not.** Composition can be arbitrarily smart because it runs once at design time and serializes. Note the localStorage Overpass cache (5 MB) is the fetch-side bottleneck; buildings+trees for this bbox may need IndexedDB or server-side baking (a Supabase backend is already planned).
- **Boundary masking:** everything outside the play-area polygon is masked to sky; scenery is fetched by bbox then clipped visually. Compositions near the edge must tolerate being cut.

### Q10 — Recommendation: where a semantic composition layer fits
Insert a **compile pipeline** at bake time (where `buildScenery` runs today), producing a serialized **SceneModel** the renderer dumbly draws:

```
Overpass fetch (raw, tags KEPT)          — snap.ts, extended
        ↓
1. SEMANTIC NORMALIZATION
   raw elements → typed features (Building{footprint, type, levels, name},
   Tree{pos, species?, source}, Pitch{ring, sport, orientation}, Park{ring,
   name, contains...}, Landmark{...}, Alley, ParkingLot, …) with an
   importance level 0–4 assigned by rule + a hand-curated hero list
        ↓
2. COMPOSITION (the new creative layer — per "scene unit", not per feature)
   • residential block: cast 4–6 representative houses from the real
     footprints (biggest/most typed win), add garages where alleys run,
     hedges/fences on lot lines, negative space on purpose
   • park: furnish from real sub-features (pitches rotated to true
     orientation, playground asset, paths, benches) + species-true trees
   • commercial street: storefront runs sized to real POI density
   • landmark pass: L3/L4 features claim ground first and evict ambient art
        ↓
3. PLACEMENT SOLVER (mostly exists: street-facing snap, setbacks,
   roof-over-street clamp, dedupe, painter layers)
        ↓
SceneModel: flat list of {assetId, variant, x, y, scale, rotation?, layer}
   baked into board JSON → renderer resolves assetId → SVG symbol
```

The key contract for the art side: **the renderer will consume `assetId + variant + scale (+ rotation for ground-plane assets)`**, so the asset vocabulary ChatGPT designs should be a flat, named catalog with variants — exactly the kit-of-parts idea — plus per-asset metadata: footprint size in meters, anchor point, upright-billboard vs rotatable-footprint, and importance level.

---

## 4. Proposed semantic feature inventory

Grouped by what an illustrated board-game renderer can actually use. **Have** = in the pipeline today. **Get** = reasonably fetchable (Overpass unless noted). **Reliability** = for this Milwaukee neighborhood specifically. **Drives** = visual decisions it can legitimately inform.

### 4.1 Residential character
- **Have:** residential land-use polygons (block outlines) only.
- **Get:** building footprints w/ type/levels/area/orientation; alleys & driveways; `barrier=fence/hedge`; addr density (a proxy for lot density).
- **Reliability:** footprints excellent; `building=house/garage/apartments` typing common; levels patchy; fences/hedges sparse.
- **Drives:** which of small/medium/large house, duplex (Milwaukee Polish flat!), rowhouse, apartment asset to cast; how many per block (from real count, rendered at 30–50%); garage placement along real alleys; density/rhythm of the block; where hedges/fences go; how much negative space to keep.

### 4.2 Commercial character
- **Have:** commercial/retail land-use polygons; shop/amenity points as emoji + name.
- **Get:** full shop/amenity categories; building footprints for storefront rows; mixed-use hints (`building=commercial;apartments` + levels).
- **Reliability:** commercial corridors densely mapped and accurate; categories trustworthy.
- **Drives:** storefront vs corner-store vs mixed-use-block asset choice; awning/signage variant by shop category; storefront run length from real POI density; which corridor reads "busy" vs "quiet."

### 4.3 Civic buildings
- **Have:** only as emoji points (⛪🏫🏥📚🏦).
- **Get:** the same features *with their building footprints*, `religion/denomination`, `amenity` distinctions (fire_station, police, post_office, townhall), names.
- **Reliability:** essentially complete for churches/schools/fire stations; names near-universal.
- **Drives:** Level-3 placement priority; church vs school vs firehouse asset; scale from real footprint; steeple/flag/bay-door details; these are the anchor set for neighborhood recognizability.

### 4.4 Landmarks (hero tier)
- **Have:** a working name-keyed bespoke registry (St. Hedwig's, four named bars, two park scenes) — the pattern is proven.
- **Get:** `historic=*`, `tourism=attraction`, plus a **hand-curated hero list** (recommended over any tag heuristic — the neighborhood has maybe 10–20 heroes and human judgment beats tags at n=20).
- **Reliability:** curation = perfect by definition; OSM historic tags spotty.
- **Drives:** bespoke art slots, intentional scale exaggeration, saturation/outline emphasis, guaranteed survival through simplification, eviction rights over ambient art.

### 4.5 Vegetation
- **Have:** park/wood polygons; procedurally invented trees (no species).
- **Get:** OSM `natural=tree` (+species/genus/leaf_type) — sparse; **City of Milwaukee street-tree inventory (open data) — dense, species-accurate, per-terrace-tree**; manual field surveys (planned by Steven) via a simple additive dataset.
- **Reliability:** OSM trees weak; city inventory excellent for street trees (park interiors weaker); fallback chain `species → genus → deciduous/conifer` handles all gaps.
- **Drives:** species-recognizable silhouettes per real location (oak/maple/elm/linden/birch/honey-locust/willow/spruce/pine/arborvitae covers Milwaukee); street-tree rhythm from real spacing instead of the current fixed 70 m; wood-polygon fill mix by leaf_type; seasonal variants later. This is the category where real data most directly becomes charm.

### 4.6 Recreation
- **Have:** polygons only, anonymized into `parks`.
- **Get:** `pitch`+`sport` with true orientation, playground, pool, dog park, garden, marina/dock, park names.
- **Reliability:** pitches/playgrounds/pools reliably mapped in parks; sport tag trustworthy.
- **Drives:** rotate-to-real-geometry ground assets (diamond, courts, fields, pool); playground kit placement; park name labels as map garnish; bench/pavilion dressing along real park paths.

### 4.7 Transportation
- **Have:** the street graph itself (the game track); footways/cycleways fetched for boundary snapping but unused in scenery; street names fetched-and-discarded.
- **Get (free/cheap):** street names; alleys; bus stops/shelters; railway; bridges; traffic signals/crossings.
- **Reliability:** all high — this is OSM's strongest data class.
- **Drives:** street-name labels (huge charm-per-byte); crosswalk striping at signalized intersections; bus shelter + bus assets on real stops; bridge assets where track crosses water; parked-car placement along curbs and alleys.

### 4.8 Infrastructure & city detail
- **Have:** nothing (industrial land-use polygon tint only).
- **Get:** parking lots/structures, water towers, substations (`power=substation`), construction (`landuse=construction`), hydrants/street lamps/benches/bike racks (sparse), dumpster-grade detail (not mapped — pure art-side ambient).
- **Reliability:** parking excellent; man_made features good; furniture sparse — treat mapped furniture as "place exactly," and let the art side scatter unmapped ambient detail (parked cars, dumpsters, planters) procedurally with deterministic hashing, which the codebase already does well.
- **Drives:** parking-lot ground assets with parked-car fills; industrial dressing for the river edge; Level-0/1 texture density.

### 4.9 Water
- **Have (and rendering today):** water polygons, riverbanks, river/stream/canal lines — the Milwaukee River corridor already draws with banks + dashed current.
- **Get:** `waterway=dock/slipway`, marinas, `bridge=yes`, breakwaters.
- **Reliability:** excellent.
- **Drives:** docks/boats along the river, bridge crossings, shoreline treatment.

### 4.10 Neighborhood texture (Level 0)
- **Have:** grass base + sidewalk strips + block tints (tints currently off).
- **Get:** surface tags (`surface=*` on paths/lots), `landuse=grass` slivers, driveways.
- **Reliability:** mixed — but Level 0 mostly *shouldn't* be data-driven; it's the art side's canvas (grass tone shifts, pavement texture, lot-line hints) applied procedurally within data-defined regions.
- **Drives:** ground-plane palette zones per land-use; alley/driveway paving marks; the quiet variation that makes blocks feel hand-made.

---

## 5. Useful things already in the codebase that we'd overlooked

1. **Street names are already downloaded and thrown away** — labeling streets is nearly free and is classic illustrated-map charm.
2. **The bake-and-persist step exists** (`buildScenery` → `board.scenery` → saved board). The composition layer has an obvious, already-plumbed home; no runtime cost.
3. **The bespoke-hero registry pattern** (regex-on-name → custom sprite, coordinate-anchored park scenes) is exactly the Level-4 mechanism and already proven with 7 heroes.
4. **The placement solver is half-built:** street-side projection with true-side detection, height-aware setbacks so roofs drape ≤⅓ over streets, dedupe radii, junction avoidance, painter-sort layering, deterministic variation. The composition layer can drive these rather than reinvent them.
5. **The raw Overpass responses in cache already contain more than we use** — the `node["amenity"]` catch-all pulls benches, bike racks, fountains etc. that `poiEmoji` currently maps to null and drops.
6. **The existing sprite corpus is already shallow-oblique** (front elevations on a top-down ground plane with y-sorted overlap), and it demonstrably works with the track — a strong prior for the perspective decision, and a ready-made style reference for prototyping the three perspective options against.
7. **`squareTypes`/game-layer separation is clean** — scenery is purely decorative; nothing in gameplay reads it. The art system can be rebuilt freely without touching game logic (GAME_DESIGN.md: "streets are just streets").

---

## 6. Suggested next steps (for the joint design conversation)

1. **ChatGPT designs the asset vocabulary** as a flat catalog: `assetId`, variants, footprint meters, anchor, `billboard | footprint` render mode, importance level — using §4's "drives" columns as the menu of what data can select each asset.
2. **Perspective prototype:** pick ~8 representative assets (small house, duplex, storefront, church, oak, spruce, baseball diamond, parked car) in the three candidate perspectives; I can drop each set into the real board behind a flag for side-by-side judgment.
3. **I extend the fetch layer** (buildings, trees, tagged recreation, alleys, parking, names — one or two queries) and build the SceneModel normalization so we can report *actual counts per category for the actual board area* — turning §4's reliability estimates into ground truth before the art vocabulary is finalized.
4. **Milwaukee street-tree inventory**: I evaluate the city open-data export for the board bbox and report real species distribution, so the tree species list is driven by what's actually planted on these blocks.
