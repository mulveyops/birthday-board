# block-25 — art brief

**This is a complete, standalone request.** Everything needed is in this
document and its attachments; it assumes no earlier conversation, and nothing
you may have painted before applies to it. If you have attempted this block
before, ignore that attempt entirely and work only from what is written here.

## What we are making

An illustrated top-down map of a real Milwaukee neighbourhood — the Lower East
Side, around Brady Street — used as the board for a city-wide game that people
play on foot. The map's streets, sidewalks and game spaces are already drawn
and cannot move. What is missing is the land *between* the streets, so the city
blocks are being illustrated one at a time and composited back onto the map at
exact positions.

**You are painting one city block: block 25.** It is bounded by real streets,
it contains real buildings, and your painting drops into the hole where that
block sits.

## What is attached

- `block-25-canvas.png` — **the stencil.** The white shape is the real block:
  the part of your painting we keep. Everything outside it is cut away. It is
  the exact size your painting must be.
- `block-25-context.png` — where this block sits on the map, its paintable area
  washed red, with the surrounding streets labelled. Reference only: do not
  paint anything you see in it.

> ## ⚠ OUTPUT SIZE: **544 × 732 px — PORTRAIT, taller than it is wide**
>
> Identical in size and shape to the attached `block-25-canvas.png`. This is not a
> preference — the painting is composited onto a map at exactly this size, so a
> different shape gets stretched and every building in it comes out squashed.
> If you cannot output these exact pixels, output a **larger** image with the
> **same ratio (0.74 : 1)** and the same orientation. Never a default 4:3 or
> 16:9 canvas, and never the other orientation.

## Deliverable

- **One PNG, exactly 544 × 732 px, painted edge to edge.** That is 4× the block's
  final size on the board canvas (136 × 183 px at position x 468, y 1311 on the
  1875 × 2048 base) — we downscale and place it; paint at this working size so
  detail survives.
- **Paint the whole rectangle, corner to corner — no transparency, no
  margin, no rounded card.** Do not try to reproduce the block's outline
  yourself. We cut the exact shape out afterwards with the stencil, and we can
  only cut away what you painted: any bare pixel you leave becomes a hole in
  the map.
- **The stencil says which part of your painting will be SEEN.** In the
  attached `block-25-canvas.png` (same 544 × 732), the white area is the real
  block — its true shape, traced from the map, including the sidewalk that
  runs to the kerb. Everything outside the white gets discarded.
  - **Every building, tree and detail you care about must sit inside the
    white area**, comfortably clear of its edge. Anything crossing that edge
    is sliced in half on the finished map.
  - **Outside the white, paint plain ground only** — grass, paving, nothing
    with a shape worth losing. It is there so the cut has something to bite
    into, and you will never see it again.
- The roads, their dark outlines and the white game spots belong to the base
  map — do not draw them.
- **The perimeter band of your painting is the sidewalk/terrace zone** (~6 m
  ≈ 42 px wide): paint your own sidewalk paving there, with the street
  trees in the grass terrace strip alongside it.
- **North is up.** Scale: **1 px = 0.144 m** (a typical 17 × 8 m Polish
  flat ≈ 118 × 56 px; a street tree canopy ~8 m ≈ 56 px across).

## Style

Warm, cartoony **board-game illustration** — the look of a modern tabletop map
or a cosy city-builder, not a satellite photo and not a technical drawing.

- **Camera: strongly top-down.** Roofs dominate; walls are visible but
  vertically compressed. Every building on the block uses the same camera —
  this is the rule most easily broken, and a building drawn from a lower angle
  than its neighbours immediately looks pasted on.
- Thick, friendly dark outlines. Bright but controlled colours, flat fills with
  simple two-tone shading. Charm over realism; readable at small size.
- Shadows soft and consistent, all falling the same way, none of them long.

**Palette anchors** (the map around your block uses these, so matching them
makes your edges disappear into it): grass **#cad7a1**, road surface
**#eeddab**, the dark road outline **#8a7452**, sidewalk paving near
**#d8c78f**. Garden greens a little richer than the base grass; backyards
quiet and low-contrast — fences, vegetable patches, paths.

**No invented readable text anywhere** — no shop names, no street signs, no
house numbers. Real names appear only where this brief explicitly allows them.

## Where you are

Bounded by:
- **North:** East Kewaunee Street
- **East:** North Marshall Street
- **South:** East Pleasant Street
- **West:** North Cass Street

See `block-25-context.png` — your block outlined in red dashes on the actual base
map (shown at 2×), so you can see the street geometry your edges meet.

## No landmark here — this block is background

Nothing on this block is a landmark, and that is the point. It is the ordinary
neighbourhood fabric that makes the landmark blocks elsewhere on the board feel
special, so keep it **even and unshowy**: no invented hero building, no
attention-grabbing centrepiece, no one house obviously fancier than the rest.
Pleasant, lived-in, quiet.

## Other named places here

Real addresses on this block. Get the building type right; they need no
signage and no readable text.

- **Cass Street Park** — around (234, 536)
- **Cass Street Park** — around (323, 438)
- **Cass Street Park** — around (383, 425)
- **Little Free Library** (public_bookcase) — around (41, 721)
- **Cass Street Park** — around (150, 680)
- **Cass Street Park** — around (43, 698)

## Texture guidance — paint the vibe, counts are approximate

What's really on this block (from city data):

- 8 × linden tree
- 3 × oak tree
- 2 × mature elm (landmark size) tree
- 2 × maple tree
- 1 × parked car
- 1 × trash can
- 1 × bungalow
- 1 × bench

Property details (real): 
- 8 × fence
- 1 × walk

Counts are a vibe, not a checklist.

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
- No rounded corners, no inset border, no empty margin inside the stencil.
- **Don't change the canvas shape.** 544 × 732 (0.74 : 1, portrait) — a
  delivery in the wrong orientation is unusable no matter how good the art is.
- No invented store names, street names, or readable text (exceptions above).
- Don't relocate or mirror the landmark.
