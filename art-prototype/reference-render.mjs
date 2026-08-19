// Reference render for the whole-board-painting experiment.
//
// Bakes a geometrically EXACT base image of a board (island backdrop + street
// track + spot markers) for ChatGPT to repaint as one cohesive illustration
// (img2img, "preserve the layout exactly"). Also writes a sidecar meta JSON
// with the pixel position of every spot, so drift-check.mjs can measure how
// far the returned painting strayed and (later) calibrate display anchors.
//
//   node art-prototype/reference-render.mjs <board.json> [outBase]
//     → <outBase>.png          clean base for the img2img repaint
//       <outBase>-grid.png     same image + labeled A1/B2/… grid (the
//                              "director's copy" for per-cell art direction)
//       <outBase>-manifest.md  every spot listed by grid cell, with a
//                              "what to paint here" column to fill in
//       <outBase>.meta.json    true per-spot pixel coords for drift-check
//     (default outBase: art-prototype/out/reference)
//
// The frame math mirrors BoardCanvas.tsx (BACKDROP_FIT island + framePads +
// SHORE_M) so the returned painting can be mounted full-frame exactly like the
// island backdrop is today. Keep these constants in sync with BoardCanvas.

import { readFileSync, writeFileSync } from 'fs';
import sharp from 'sharp';

const ISLAND_BLOB = { x0: 0.085, x1: 0.943, y0: 0.154, y1: 0.91 }; // sync: BACKDROP_FIT.island
const SHORE_M = 60; // sync: BoardCanvas SHORE_M
const ROAD = { sidewalk: '#d8c78f', casing: '#8a7452', fill: '#eeddab' }; // sync: BACKDROP_FIT.island
const SIDEWALK_M = 38, CASING_M = 26, FILL_M = 20; // sync: BoardCanvas widths
const TARGET_PX = 2048; // long edge of the baked PNG

const [, , boardPath, outBase = 'art-prototype/out/reference'] = process.argv;
if (!boardPath) {
  console.error('usage: node art-prototype/reference-render.mjs <board.json> [outBase]');
  process.exit(1);
}
const board = JSON.parse(readFileSync(boardPath, 'utf8'));
if (!board.boundary?.length || !board.squares?.length) {
  console.error('board JSON needs boundary + squares');
  process.exit(1);
}

// --- frame (equirectangular world meters, y down) — mirrors BoardCanvas geo ---
const lats = board.boundary.map((p) => p.lat);
const lngs = board.boundary.map((p) => p.lng);
const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
const kx = Math.cos((midLat * Math.PI) / 180) * 111320;
const ky = 111320;
const bWm = (Math.max(...lngs) - Math.min(...lngs)) * kx;
const bHm = (Math.max(...lats) - Math.min(...lats)) * ky;
const FW = (bWm + 2 * SHORE_M) / (ISLAND_BLOB.x1 - ISLAND_BLOB.x0);
const FH = (bHm + 2 * SHORE_M) / (ISLAND_BLOB.y1 - ISLAND_BLOB.y0);
const padL = FW * ISLAND_BLOB.x0 + SHORE_M;
const padT = FH * ISLAND_BLOB.y0 + SHORE_M;
const minLng = Math.min(...lngs) - padL / kx;
const maxLat = Math.max(...lats) + padT / ky;
const W = FW;
const H = FH;
const X = (p) => (p.lng - minLng) * kx;
const Y = (p) => (maxLat - p.lat) * ky;

// --- streets: edge path if traced, else straight between its two squares ----
const byId = new Map(board.squares.map((s) => [s.id, s]));
const edgeLines = (board.edges ?? [])
  .map((e) => {
    const from = byId.get(e.from), to = byId.get(e.to);
    if (!from || !to) return null;
    const pts = e.path?.length ? e.path : [from, to];
    return pts.map((p) => `${X(p).toFixed(1)},${Y(p).toFixed(1)}`).join(' ');
  })
  .filter(Boolean);

// --- spots: everything interactive gets a marker the painter must respect ---
const deg = new Map();
for (const e of board.edges ?? []) {
  deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
  deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
}
const spots = board.squares.filter((s) => (deg.get(s.id) ?? 0) >= 3 || s.type !== 'blank');

// --- compose the SVG ---------------------------------------------------------
const islandPng = await sharp('public/art/backdrops/island.webp').png().toBuffer();
const stroke = (cls, w, color) =>
  edgeLines.map((pts) => `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
const spotMarks = spots
  .map((s) => {
    const x = X(s).toFixed(1), y = Y(s).toFixed(1);
    if (s.type === 'bar' || s.type === 'poi') {
      const label = (s.title || '').toUpperCase().slice(0, 22);
      return `<circle cx="${x}" cy="${y}" r="9" fill="#c2410c" stroke="#3a362f" stroke-width="2"/>` +
        (label ? `<text x="${x}" y="${+y - 14}" font-size="16" font-family="Arial, sans-serif" font-weight="bold" text-anchor="middle" fill="#3a362f" stroke="#ffffff" stroke-width="3" paint-order="stroke">${label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>` : '');
    }
    return `<circle cx="${x}" cy="${y}" r="7" fill="#f4efe4" stroke="#3a362f" stroke-width="2.5"/>`;
  })
  .join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}">
  <image href="data:image/png;base64,${islandPng.toString('base64')}" x="0" y="0" width="${W.toFixed(1)}" height="${H.toFixed(1)}" preserveAspectRatio="none"/>
  ${stroke('sw', SIDEWALK_M, ROAD.sidewalk)}
  ${stroke('c', CASING_M, ROAD.casing)}
  ${stroke('f', FILL_M, ROAD.fill)}
  ${spotMarks}
</svg>`;

const scale = TARGET_PX / Math.max(W, H);
const png = await sharp(Buffer.from(svg), { density: 72 * scale }).png().toBuffer();
const outPng = `${outBase}.png`;
await sharp(png).toFile(outPng);
const { width: pxW, height: pxH } = await sharp(outPng).metadata();

// --- director's copy: labeled grid for per-cell art direction ---------------
const CELL_M = 120; // one grid cell ≈ a city block
const cols = Math.ceil(W / CELL_M);
const rows = Math.ceil(H / CELL_M);
const colName = (c) => String.fromCharCode(65 + c); // A, B, C…
const cellOf = (xM, yM) => `${colName(Math.min(cols - 1, Math.floor(xM / CELL_M)))}${Math.min(rows, Math.floor(yM / CELL_M) + 1)}`;
{
  let g = '';
  for (let c = 1; c < cols; c++)
    g += `<line x1="${c * CELL_M}" y1="0" x2="${c * CELL_M}" y2="${H}" stroke="#1e293b" stroke-width="1.6" stroke-dasharray="8 8" opacity="0.5"/>`;
  for (let r = 1; r < rows; r++)
    g += `<line x1="0" y1="${r * CELL_M}" x2="${W}" y2="${r * CELL_M}" stroke="#1e293b" stroke-width="1.6" stroke-dasharray="8 8" opacity="0.5"/>`;
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++)
      g += `<text x="${c * CELL_M + 6}" y="${r * CELL_M + 20}" font-size="17" font-family="Arial, sans-serif" font-weight="bold" fill="#1e293b" stroke="#ffffff" stroke-width="3.5" paint-order="stroke" opacity="0.85">${colName(c)}${r + 1}</text>`;
  const gridSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" width="${pxW}" height="${pxH}">${g}</svg>`;
  await sharp(png).composite([{ input: Buffer.from(gridSvg) }]).toFile(`${outBase}-grid.png`);
}

// --- manifest: an extremely detailed scene description for the painter ------
// Mines the baked world data (public/art/scene.json — the same 986 sprites the
// live app renders) plus the board's own spots, so ChatGPT knows what stands
// on every block: named landmarks, building archetypes, tree species, parks.
{
  const nameOf = (s) => (s.title && s.title !== 'Space' ? s.title : '');
  const SEED = {
    bar: (n) => `**${n || 'unnamed bar'}** — corner tavern, signboard with its name`,
    poi: (n) => `**${n || 'unnamed landmark'}** — bespoke landmark building/scene`,
    challenge: () => 'trivia/challenge stop — a small plaza or feature players gather at',
    chance: () => 'chance stop — something whimsical for the ❓ draw',
    coin: () => 'coin pickup — minor flourish, keep the street clear',
    bowser: () => 'BOWSER lair — imposing, a bit ominous',
    start: () => 'START — festive gateway/arch',
    finish: () => 'FINAL BAR — the endgame destination, make it grand',
  };
  const cellOfLL = (p) => cellOf(X(p), Y(p));
  const inFrame = (p) => X(p) >= 0 && X(p) <= W && Y(p) >= 0 && Y(p) <= H;

  // Baked scene world (optional — sections just shrink if it's absent).
  let scene = null;
  try {
    scene = JSON.parse(readFileSync('public/art/scene.json', 'utf8'));
  } catch {
    /* no baked scene — manifest covers board spots only */
  }

  // Bespoke hero landmarks, described from the Hero Reference Packets.
  const HERO_DESC = {
    'st-hedwig': "**St. Hedwig's Church** — cream-city (pale yellow) brick Romanesque church with a tall copper-green spire",
    hero_wolskis: "**Wolski's** — 1895 front-gabled wooden house-tavern, famous white WOLSKI'S signboard",
    gloriosos: "**Glorioso's Italian Market** — former 1910s theater, stucco front, green-white-red tricolor band and GLORIOSO'S sign",
  };
  const heroes = (scene?.standing ?? [])
    .filter((e) => e.t === 'img' && inFrame(e))
    .map((e) => {
      const key = Object.keys(HERO_DESC).find((k) => (e.href || '').includes(k));
      return { cell: cellOfLL(e), desc: HERO_DESC[key] ?? `**${e.href}**` };
    });
  const taverns = (scene?.standing ?? [])
    .filter((e) => e.label && inFrame(e))
    .map((e) => ({ cell: cellOfLL(e), desc: `**${e.label}** — corner tavern with its name on the signboard` }));

  // Block-by-block character: classify every baked sprite into a friendly name.
  const FAMILY = [
    [/polish_flat/, 'b', 'Polish flat'],
    [/duplex/, 'b', 'brick duplex'],
    [/bungalow/, 'b', 'bungalow'],
    [/apartment/, 'b', '3-story walk-up apartment'],
    [/corner_tavern/, 'b', 'corner tavern'],
    [/storefront|mixed_use|com\.row/, 'b', 'storefront'],
    [/church/, 'b', 'church'],
    [/school/, 'b', 'school'],
    [/bldg\.com/, 'b', 'commercial building'],
    [/bldg\.res|house/, 'b', 'house'],
    [/tree_maple/, 't', 'maple'],
    [/tree_linden/, 't', 'linden'],
    [/tree_flowering/, 't', 'flowering tree'],
    [/tree_honeylocust/, 't', 'honeylocust'],
    [/tree_elm/, 't', 'MATURE LANDMARK ELM'],
    [/tree_oak/, 't', 'oak'],
    [/conifer/, 't', 'conifer'],
    [/hydrant/, 'p', 'fire hydrant'],
    [/parked_car/, 'p', 'parked car'],
    [/bench/, 'p', 'bench'],
    [/picnic/, 'p', 'picnic table'],
    [/bus_stop/, 'p', 'bus stop'],
    [/bike_rack/, 'p', 'bike rack'],
    [/basketball/, 'g', 'basketball court'],
    [/tennis/, 'g', 'tennis court'],
    [/baseball/, 'g', 'baseball diamond'],
    [/playground/, 'g', 'playground'],
  ];
  const classify = (ref) => FAMILY.find(([re]) => re.test(ref || ''));
  const cellAgg = new Map(); // cell -> {b:Map, t:Map, p:Map, g:Map}
  const bump = (cell, cat, name) => {
    if (!cellAgg.has(cell)) cellAgg.set(cell, { b: new Map(), t: new Map(), p: new Map(), g: new Map() });
    const m = cellAgg.get(cell)[cat];
    m.set(name, (m.get(name) ?? 0) + 1);
  };
  for (const e of [...(scene?.standing ?? []), ...(scene?.ground ?? [])]) {
    if (e.t === 'img' || e.label || !inFrame(e)) continue; // heroes/taverns listed above
    const hit = classify(e.ref);
    if (hit) bump(cellOfLL(e), hit[1], hit[2]);
  }
  const plural = (n) => (/(x|ch|s)$/.test(n) ? `${n}es` : `${n}s`);
  const fmtCounts = (m) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => (c > 1 ? `${c} ${plural(n)}` : `1 ${n}`)).join(', ');
  const charRows = [...cellAgg.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([cell, { b, t, p, g }]) => {
      const parts = [];
      if (b.size) parts.push(fmtCounts(b));
      if (g.size) parts.push(`recreation: ${fmtCounts(g)}`);
      if (t.size) parts.push(`trees: ${fmtCounts(t)}`);
      if (p.size) parts.push(`street detail: ${fmtCounts(p)}`);
      return `| ${cell} | ${parts.join(' · ')} |`;
    })
    .join('\n');

  // Parks: polygon extent → cell span.
  const parkRows = (scene?.parks ?? [])
    .map((ring, i) => {
      const pts = ring.map(([lat, lng]) => ({ lat, lng })).filter(inFrame);
      if (!pts.length) return null;
      const cells = [...new Set(pts.map(cellOfLL))];
      return `- Park/green space spanning ${cells[0]}${cells.length > 1 ? `–${cells[cells.length - 1]}` : ''}: open lawn with paths, trees along the edges`;
    })
    .filter(Boolean)
    .join('\n');

  const typed = spots.filter((s) => s.type !== 'blank');
  const blanks = spots.length - typed.length;
  const spotRows = typed
    .map((s) => ({ s, cell: cellOf(X(s), Y(s)) }))
    .sort((a, b) => a.cell.localeCompare(b.cell, undefined, { numeric: true }))
    .map(({ s, cell }) => `| ${cell} | ${s.type} | ${nameOf(s)} | ${SEED[s.type]?.(nameOf(s)) ?? ''} |`)
    .join('\n');

  const manifest = `# Board painting manifest — full scene description

Paint over \`${outBase}.png\`; use \`${outBase}-grid.png\` only to locate things
(do NOT paint the grid). Grid: ${CELL_M}m cells, columns A–${colName(cols - 1)} west→east,
rows 1–${rows} north→south.

## Overview

This is Milwaukee's Lower East Side as one cohesive storybook board-game
illustration: a leafy riverside neighborhood of wooden Polish flats, brick
duplexes and bungalows, corner taverns, and big street trees. The island,
Milwaukee River, banner, and compass are already painted — keep them. The
sand-colored streets and every marker must stay EXACTLY where they are:
white dots are landable plazas on the road, red dots are named landmark
buildings. Blocks between streets get the buildings/trees described below.

Building glossary (Milwaukee vernacular, for every cell below):
- **Polish flat** — a wooden cottage raised on a tall half-exposed brick
  basement, with front stairs up to the raised first floor. The signature
  house of this neighborhood.
- **brick duplex** — a wide two-family brick house, two front doors.
- **bungalow** — low 1.5-story house with a big hipped/dormered roof.
- **3-story walk-up apartment** — flat-roofed brick block.
- **storefront** — commercial ground floor with awning/sign band, on corners
  and along the main streets.

## Bespoke landmarks (paint these true to their real look)

${[...heroes, ...taverns].map((h) => `- ${h.cell}: ${h.desc}`).join('\n') || '- (none in the baked scene — landmark bars come from the board spots below)'}

## Game spots (players land here — the art must match the role)

| Cell | Type | Name | What to paint here |
|------|------|------|--------------------|
${spotRows}

Plus ${blanks} plain intersections (white dots) — keep them clear and legible,
no buildings on top of them.

## Parks & recreation

${parkRows || '- (none baked)'}

## Block-by-block character (what stands on each grid cell today)

| Cell | Contents |
|------|----------|
${charRows || '| — | (no baked scene data) |'}

## Ground rules

- Do not move, add, or remove any street, intersection, or marker.
- Do not paint the grid lines or cell labels into the image.
- Tree species and building types above reflect the real neighborhood — vary
  them naturally but keep each cell's mix and density.
- One consistent painterly style throughout (match the island/banner art).
`;
  writeFileSync(`${outBase}-manifest.md`, manifest);
}

// --- sidecar meta: pixel coords for drift-check + future calibration --------
const meta = {
  source: boardPath,
  frame: { W: +W.toFixed(1), H: +H.toFixed(1), minLng, maxLat, kx, ky },
  image: { width: pxW, height: pxH, pxPerM: +(pxW / W).toFixed(4) },
  spots: spots.map((s) => ({
    id: s.id,
    type: s.type,
    title: s.title || '',
    x: +((X(s) * pxW) / W).toFixed(1),
    y: +((Y(s) * pxH) / H).toFixed(1),
  })),
};
writeFileSync(`${outBase}.meta.json`, JSON.stringify(meta, null, 1));
console.log(`baked ${outPng} (${pxW}x${pxH}, ${spots.length} spots) + ${outBase}.meta.json`);
