# block-30 — art brief

One block of the board, painted by you, composited by us. Numbering matches
reference-blocks.png (this is block 30).

## Deliverable

- **One transparent PNG, exactly 544 × 752 px.** That is 4× the block's
  final size on the board canvas (136 × 188 px at position x 644, y 1540 on the
  1875 × 2048 base) — we downscale and place it; paint at this working size so
  detail survives.
- **Paint only inside the white area of the stencil.** The attached
  `block-30-canvas.png` (same 544 × 752) is the paintable region, traced
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
- **North:** East Pleasant Street
- **East:** North Astor Street
- **South:** (no named street — board edge or alley)
- **West:** North Marshall Street

See `block-30-context.png` — your block outlined in red dashes on the actual base
map (shown at 2×), so you can see the street geometry your edges meet.

## Hard constraints — must be exactly here, exactly this

_No named landmarks on this block._

Named real places on this block (get the buildings right, no signage needed
unless noted above):

- **Old Mount Zion New Jerusalem** (place_of_worship) — around (445, 251)

## Texture guidance — paint the vibe, counts are approximate

What's really on this block (from city data):

- 9 × maple tree
- 7 × linden tree
- 5 × duplex
- 2 × Polish flat
- 2 × oak tree
- 1 × flowering ornamental tree
- 1 × bungalow
- 1 × church
- 1 × apartment building
- 1 × fire hydrant

Property details (real): 
- 1 × driveway
- 4 × walk

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
