# Milwaukee / Lower East Side — Asset Grounding Packet v1

*Prepared by Claude, 2026-08-18, from the board's real datasets: 947 OSM building footprints (material/levels/architecture tags), 77 named businesses, 715 city-inventory street trees, and the board graph. Companion machine-readable files: `commercial-inventory.json`, `residential-archetypes.json`, `raster-production-priority.json`.*

## Locked production rules (restated)

1. **No invented readable text on generic assets.** Generic storefronts get blank signboards, abstract pseudo-lettering, awnings, hanging sign shapes, window displays, category cues. Readable names appear ONLY on Tier A/B real businesses below.
2. **Camera:** strongly top-down, nearly head-on frontage, very little horizontal rotation. Roof visually dominant; walls vertically compressed. Buildings must feel attached to the map plane.
3. Transparent background; **no sidewalk apron**; foundation planting/patio only where integral; no baked street furniture (we place hydrants/benches/cars from data).
4. Style C: thick cartoon outlines, simplified interiors, bright-but-controlled palette.

---

## 1. Real commercial inventory — 77 named businesses

Full structured data in `commercial-inventory.json` (name, category, OSM tags, lat/lng, address, building footprint/dims/levels/material, frontage direction, corner status, historic flag). Board-polygon counts:

| Category | Count | Notes |
|---|---|---|
| tavern_bar | **23** | the neighborhood's defining category — 11 sit on corners |
| restaurant | 18 | Casablanca, DORSIA, The Diplomat, Emperor of China, Kompali, Thainamite… |
| salon_service | 11 | barbershops ×3, tattoo ×2, dry cleaning, hair |
| cafe | 9 | Brewed, Rochambo, Dryhootch (veterans' coffeehouse), Stone Creek-adjacent |
| retail | 8 | incl. Art Smart's Dart Mart & Juggling Emporium (yes, really) |
| entertainment | 2 | + parish/event venues |
| grocery_specialty | 2 | Glorioso's + Peter Sciortino's orbit |
| bakery | 1 | **Peter Sciortino's Bakery** (1948 institution) |
| other_local | 3 | offices/hotel |

## 2. Tier recommendations

### Tier A — heroes (bespoke art, real name, scale privilege)
Existing: `hero.st_hedwig`, `hero.wolskis`, `hero.gloriosos` ✓. **Recommended additions, ranked:**
1. **Peter Sciortino's Bakery** (1101 E Brady) — 1948 Italian bakery, painted-window storefront, cultural anchor of east Brady; the natural 4th hero and pairs with Glorioso's as the Italian-heritage duo.
2. **Y-Not II** (706 E Lyon) — 1919 corner tavern, red neon, plate glass; already has a bespoke SVG precedent.
3. **Up and Under Pub** (1216 E Brady) — the blues bar; recognizable dark facade + signage.
Hold the line after these: hero count target is 10–15 total *including future ones outside this slice set*, so bank the rest as Tier B.
(Non-building hero queued separately: the 33″ American Elm at 43.055741, −87.898172.)

### Tier B — character businesses (~real signage on semi-generic shells)
Ranked by board usefulness (corner taverns first — they're already facing-aware in the system):
1. The 11 **corner taverns**: Club Brady, Fink's, Hi Hat Lounge, Hi Hat Garage, Hosed on Brady, Jamo's, Jo-Cat's Pub, Regano's Roman Coin, Scaffidi's Hideout, The Standard Tavern, Thurman's 15
2. **MKE's Smallest Bar** (a joke that writes itself at board scale — tiny building, big flag)
3. Mid-block taverns: Malone's on Brady, Pete's Pub, Jack's American Pub, WürstBar, Angelo's Piano Lounge, Red Lion Pub on Tannery Row
4. Restaurants with facade identity: Casablanca (Moorish arches), DORSIA, Emperor of China, Lucky Liu's, The Diplomat
5. Cafés: Rochambo (funky two-story), Brewed Cafe (Brady St mural culture), Dryhootch (veterans' coffeehouse — in a converted house)
6. Retail character: Art Smart's Dart Mart & Juggling Emporium (the name alone is Milwaukee folklore), Famous Smoke Shop
Treatment: real name on the sign band/blade only; building shell can come from the generic commercial forms in §5.

### Tier C — data-only (all remaining named POIs)
Name/category drives placement + treatment selection (bakery gets bread-window treatment etc.) but artwork stays generic and **unlabeled**. This is the default for anything not listed above.

## 3. Residential architecture inventory (real counts, board polygon)

Full stats in `residential-archetypes.json`. **947 buildings total.** Median dims are oriented footprints (width × depth in meters):

| Archetype | Count | Median footprint | Levels | Materials (tagged) | Facade cues for the art |
|---|---|---|---|---|---|
| **Polish flat / 2-story narrow** | **348** | 17×8 | 2 (338 of 348) | vinyl/aluminum siding 117, brick 24, clapboard 22, asphalt siding 20, cream city 10 | **THE workhorse.** Narrow frontage, tall proportions. Historic cue: many are cottages *raised on tall brick basements* — raised first floor, prominent front stairs, half-exposed basement windows. Stacked porches, front-gable or flat cornice. |
| **Bungalow / 1-story cottage** | **175** | 15×7 | 1 (+8 at 1.5) | vinyl/aluminum 76, clapboard 8, brick 7 | Craftsman low gables w/ deep porches; hipped w/ dormer; side-gable w/ chimney+shutters. |
| **Detached garage** | 96 | 8×6 | 1 | mixed | Alley-facing, front-gable or flat. |
| **Wide duplex** | **79** | 22×10 | 2 (72) | brick 19, vinyl 15, cream city 6 | Twin entrances, twin stoops, hipped or gabled; brick more common than in flats. |
| **3-story walk-up apartment** | 37 | 21×9 | 2–3 | brick 15 | Narrow brick, center entry, stone lintels. |
| **Tall apartment (4+)** | 24 | 43×27 | 4–8 (+1 at 24!) | brick 12, cream city 4 | Big corniced blocks; one high-rise outlier (Arlington Court). |
| **Wide brick apartment** | 22 | 29×18 | 2–3 | brick 14 | Broad frontage, window rhythm. |
| Shed | 33 | 3×2 | 1 | — | Tiny; environmental seasoning. |
| Rowhouse/terrace | 3 | varies | 2–3 | cream city 2 | Astor/Graham rows — cream city brick! |

## 4. Milwaukee facade/material palette (from real tags + references)

The `building:material` tags across 500+ tagged buildings give the honest hierarchy:
1. **Aluminum/vinyl siding** (dominant on flats/bungalows) — soft pastels: white, cream, pale yellow, sage/mint green, muted blue, dusty rose, light gray
2. **Red/brown brick** (apartments, duplexes, taverns) — warm oxide reds through chocolate
3. **Cream City brick** (churches, rowhouses, better apartments, some flats) — pale warm ochre-cream, the signature Milwaukee material
4. **Clapboard/wood** — white + painted trim
5. **Asphalt siding** (20 flats! a real Milwaukee working-class texture — faux-brick asphalt sheet, dull brick-red/gray)
6. Stucco (Glorioso's/Astor block), composition board
Trim: white/cream dominant, dark green/black on taverns. Porches: painted wood, gray-floor/white-post convention. Roofs: asphalt shingle families (charcoal, brown, weathered green), flat tar w/ parapets on commercial. **Avoid rainbow saturation: the neighborhood reads as pastel siding + brick + cream city, punctuated by tavern green and Italian tricolor.**

## 5. Commercial architecture forms (identity-free shells)

| Form | Est. count on board | Proportions | Raster family |
|---|---|---|---|
| Narrow 1-story storefront | ~25 | 7–10m frontage | `raster.com.storefront_single` |
| Narrow 2-story mixed-use | ~30 | 8–11m frontage, shop below + flat above | `raster.com.mixed_use_2story` |
| 3-story mixed-use brick | ~8 | 12m+, corniced | `raster.com.mixed_use_3story` |
| Corner mixed-use / corner tavern shell | ~15 (11 corner bars) | chamfered/emphasized corner | `raster.com.corner` (facing-aware, mirrorable) |
| 2–3-bay storefront row | ~10 rows | 14–22m, stepped parapets, per-bay color | `raster.com.storefront_row` |
| Converted house used commercially | ~6 (Dryhootch, several salons) | residential shell + shop sign | reuse residential raster + Tier B/C treatment |
| House-tavern | a handful (Wolski's pattern) | domestic scale | covered by hero/Tier B |
| Theatre/large block | 1 (Glorioso's) | done | hero ✓ |

## 6. Tree raster packet (real inventory, board polygon)

| Class | Count | DBH min/med/max (in) | Species inside class | Silhouette brief |
|---|---|---|---|---|
| **linden** | 143 | 2 / 15 / 35 | Littleleaf 99, spp 33, Crimean 8, Silver 1, Basswood 2 | dense, formal, rounded-to-teardrop, richest deep green |
| **maple** | 139 | 1 / 9 / 38 | Norway 77, Freeman 16, Hedge 13, Amur 9, Miyabe's 8, + | round energetic crown, scalloped edge, brightest green |
| **flowering_ornamental** | 137 | 1 / 3 / 13 | Japanese tree lilac 72, Callery pear 37, apple 12, serviceberry 14, hawthorn 2 | clearly SMALL (half a shade tree), blossom pink/white |
| **ash** | 114 | 6 / 18 / 32 | Green 106, White 8 | upright oval, quiet mid-green (note: these are mature street rows) |
| **honeylocust** | 77 | 2 / 14 / 27 | Honeylocust 77 | airy, open, visible branching, yellow-green, sky through crown |
| **elm** | 51 | 2 / 7 / 41 | Hybrid 21, spp 14, Hackberry 8, Smooth-leaf 6, **American 2** | tall vase, crown held high; the 41″ American Elm is the future natural hero |
| **oak** | 41 | 2 / 3 / 21 | Swamp white 18, English 9, Bur 8, mixed 6 | broadest, heaviest, irregular; mostly YOUNG on this board (median 3″) — mature oak art still needed for the few big ones |
| conifer | 0 street | — | yard/park dressing only | spruce cone / irregular pine / arborvitae column |

Scale behavior: DBH drives size (0.85–1.7×; elm/oak may reach 2.05× when mature). Flowering class must stay visibly smaller than shade trees.

## 7. Recommended first raster production pack (derived from counts)

Order in `raster-production-priority.json`. The 20-asset pack, by coverage:

**Residential (10):** polish_flat stacked-porch, polish_flat front-gable+bay, polish_flat porch-gable *(3 silhouettes for the 348-instance family — include the raised-basement cue on at least one)*, wide_duplex *(79)*, bungalow craftsman + hipped-dormer + side-gable cottage *(3 for the 175 family)*, apartment walk-up 3-story *(37)*, apartment wide-brick *(22)*, detached garage *(96)*.
**Commercial shells (3):** single storefront (unlabeled), 3-bay storefront row, 3-story mixed-use. *(Corner form can wait for the Tier B tavern pass since those carry real names.)*
**Trees (6):** linden, maple, honeylocust, flowering ornamental, mature elm, mature oak. *(Ash can reuse a quieter linden-adjacent silhouette in v1 if 20 is the cap; otherwise make it #21.)*
**(+1 optional):** corner apartment.

## 8. Reference imagery (what to study)

- [Brady Street Historic District designation report (City of Milwaukee PDF)](https://city.milwaukee.gov/ImageLibrary/Groups/cityHPC/DesignatedReports/vticnf/HDBradySt.pdf) — the motherlode: period photos + architectural descriptions of the exact housing stock; study the **raised-basement Polish flats and cottage forms**.
- [Wikipedia: East Brady Street Historic District](https://en.wikipedia.org/wiki/East_Brady_Street_Historic_District) — district overview + images; study modest wooden Victorian houses/duplexes.
- [Urban Milwaukee: Brady Street area walk](https://urbanmilwaukee.com/2020/12/29/milwaukee-walks-brady-street-area-has-many-delights/) — streetscape photos; study **storefront-row rhythm and mixed-use scale**.
- [Urban Milwaukee: a beer garden disguised as a Polish flat](https://urbanmilwaukee.com/2015/06/11/finally-a-beer-garden-disguised-as-a-polish-flat/) — an explicit Polish-flat exemplar; study the **tall basement + stairs + narrow two-story massing**.
- [Wisconsin Historical Society: E. Brady St NR record](https://www.wisconsinhistory.org/record/national-register/NR1813) — building-by-building documentation of the commercial corridor.
- Street View starting points: [Brady & Arlington](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=43.0527,-87.8967) (storefront rows), [Pulaski St residential](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=43.0545,-87.8952) (flats + bungalows + garages/alleys) — walkable reference for any archetype.

---

*Everything above is measured from this board's actual data except where marked as estimate. The next raster batch generated against this packet should be recognizably Lower East Side without a single invented business name.*
