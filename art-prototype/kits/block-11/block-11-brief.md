# block-11 — art brief

One block of the board, painted by you, composited by us. Numbering matches
reference-blocks.png (this is block 11).

## Deliverable

- **One transparent PNG, exactly 564 × 948 px.** That is 4× the block's
  final size on the board canvas (141 × 237 px at position x 1041, y 792 on the
  1875 × 2048 base) — we downscale and place it; paint at this working size so
  detail survives.
- **Paint only inside the white area of the stencil.** The attached
  `block-11-canvas.png` (same 564 × 948) is the paintable region, traced
  pixel-exact from the rendered base map: the full block INCLUDING its sidewalk
  apron, running right up to the street's dark outline — your art borders the
  road directly. Everything outside stays fully transparent. The roads, their
  dark outlines and the white game spots belong to the base map — never paint
  over them, never let art or shadows cross the stencil edge.
- **The perimeter band of your painting is the sidewalk/terrace zone** (~6 m
  ≈ 42 px wide): paint your own sidewalk paving there, with the street
  trees in the grass terrace strip alongside it.
- **North is up.** Scale: **1 px = 0.144 m** (a typical 17 × 8 m Polish
  flat ≈ 118 × 56 px; a street tree canopy ~8 m ≈ 56 px across).

## Style (locked)

Style C, matching the island base map and our existing sprites: **strongly
top-down camera — roofs dominant, walls vertically compressed**, thick friendly
dark outlines, bright flat colors with simple 2-tone shading, cartoony
board-game warmth. Ground between buildings is yard/garden texture in greens
that sit naturally on the base grass **#cad7a1**. Your edges meet the road's
dark outline (#8a7452) directly; the road surface beyond it is sand **#eeddab**
— sidewalk tones near #d8c78f blend well at the boundary.
Backyards: fences, garden patches, paths — quiet, low-contrast. **No invented
readable text anywhere** — real names only where this brief explicitly allows.

## Where you are

Bounded by:
- **North:** East Hamilton Street
- **East:** North Franklin Place
- **South:** East Brady Street
- **West:** North Humboldt Avenue

See `block-11-context.png` — your block outlined in red dashes on the actual base
map (shown at 2×), so you can see the street geometry your edges meet.

## Hard constraints — must be exactly here, exactly this

1. **ST. HEDWIG'S** — anchor at canvas px **(50, 846)** (the ground point of its entrance/front). **Saint Hedwig Catholic Church** (1886, Henry Messmer) — THE landmark of this block and the visual crest of Brady Street.
   - **Cream City brick** body (pale warm cream — NOT red brick), stone trim, Romanesque round-arched windows.
   - Single tall central tower with a **copper-patina-green spire** (162 ft) — slightly bulbous Eastern-European transition at its base. The spire is the tallest thing on the whole board; let it read over everything.
   - Tall gabled nave runs EAST behind the tower; **facade + main doors face WEST onto Humboldt Ave**.
   - Real footprint 48 × 26 m — at this canvas scale ≈ **333 × 181 px, long axis east–west**, tower + doors at the west end of that footprint.
   - Palette: cream body, patina-green spire, brown-gray slate nave roof, pale stone trim, dark wood doors, stained-glass blue-purple.
   - Match the look of our approved hero sprite (reference: art-prototype/out/st-hedwig-v2.webp) — same building, your painting.

Named real places on this block (get the buildings right, no signage needed
unless noted above):

- **Saint Hedwig Catholic Church** (place_of_worship) — around (156, 876)
- **Three Holy Women Parish Offices** (commercial) — around (84, 682)
- **Hedwig House Apartments** (social_facility) — around (115, 563)
- **Tamarack Waldorf Elementary School** (school) — around (475, 794)
- **East Village Condos** (residential) — around (509, 9)

## Texture guidance — paint the vibe, counts are approximate

What's really on this block (from city data):

- 9 × maple tree
- 7 × Polish flat
- 3 × honeylocust tree
- 3 × mature elm (landmark size) tree
- 1 × detached garage (alley side)
- 1 × storefront
- 1 × mixed-use commercial (shops below, flat above)
- 1 × school
- 1 × bike rack
- 1 × oak tree
- 1 × bus stop
- 1 × parked car

Property details (real): 
- 4 × driveway
- 1 × retaining wall
- 2 × walk

Composition rules of thumb: street trees live in the terrace band just inside
each street edge; houses front their street with small setbacks and entry
walks; garages and sheds hide mid-block along the alley side; commercial
buildings sit flush to their corner. Polish flat identity: a cottage raised on
a tall brick basement — raised first floor, front stairs, half-exposed basement
windows.

## Don'ts

- No roads, crosswalks, cars-on-the-road, or game spots — the road surface and
  its dark outline are the base map's.
- Nothing outside the stencil. No drop shadows past the polygon edge.
- No invented store names, street names, or readable text (exceptions above).
- Don't relocate, resize, or mirror the hard-constraint landmarks.
