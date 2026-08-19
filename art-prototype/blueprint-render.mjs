// Placement blueprint — the visual construction plan for the board painting.
//
// Not artwork: a precise overlay on the base map that tells the image model
// (and Steven, for approval) EXACTLY where every important object goes:
//   - landmark footprint boxes (true size from the baked scene data)
//   - a crosshair on each landmark's anchor point + an arrow toward the
//     street its facade faces
//   - translucent park polygons
//   - game-spot symbols coded by type
// Also writes a pixel-coordinate spec table — the production coordinate
// system is the canvas itself, not the human grid.
//
//   node art-prototype/blueprint-render.mjs <board.json> [outBase]
//     → <outBase>-blueprint.png + <outBase>-blueprint-spec.md
//     (default outBase: art-prototype/out/reference — matches reference-render)
//
// Frame math mirrors reference-render.mjs / BoardCanvas BACKDROP_FIT.island.

import { readFileSync, writeFileSync } from 'fs';
import sharp from 'sharp';

const ISLAND_BLOB = { x0: 0.085, x1: 0.943, y0: 0.154, y1: 0.91 };
const SHORE_M = 60;
const TARGET_PX = 2048;

const [, , boardPath, outBase = 'art-prototype/out/reference'] = process.argv;
if (!boardPath) {
  console.error('usage: node art-prototype/blueprint-render.mjs <board.json> [outBase]');
  process.exit(1);
}
const board = JSON.parse(readFileSync(boardPath, 'utf8'));
const scene = JSON.parse(readFileSync('public/art/scene.json', 'utf8'));

// --- frame (identical to reference-render.mjs) ------------------------------
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
const W = FW, H = FH;
const X = (p) => (p.lng - minLng) * kx;
const Y = (p) => (maxLat - p.lat) * ky;
const inFrame = (p) => X(p) >= 0 && X(p) <= W && Y(p) >= 0 && Y(p) <= H;

// --- streets (for facing arrows) -------------------------------------------
const byId = new Map(board.squares.map((s) => [s.id, s]));
const segs = [];
for (const e of board.edges ?? []) {
  const f = byId.get(e.from), t = byId.get(e.to);
  if (!f || !t) continue;
  const pts = (e.path?.length ? e.path : [f, t]).map((p) => [X(p), Y(p)]);
  for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i], pts[i + 1]]);
}
/** Direction (unit vector) from a point toward the nearest street. */
function towardStreet(x, y) {
  let best = null, bestD = Infinity;
  for (const [[ax, ay], [bx, by]] of segs) {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    const px = ax + t * dx, py = ay + t * dy;
    const d = Math.hypot(px - x, py - y);
    if (d < bestD) { bestD = d; best = [px, py]; }
  }
  if (!best) return { ux: 0, uy: 1, dist: 0 };
  const d = Math.hypot(best[0] - x, best[1] - y) || 1;
  return { ux: (best[0] - x) / d, uy: (best[1] - y) / d, dist: d };
}
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compassOf = (ux, uy) => COMPASS[Math.round((((Math.atan2(ux, -uy) * 180) / Math.PI + 360) % 360) / 45) % 8];

// --- landmarks: heroes + labeled taverns, true footprints from scene data ---
const HERO_NAME = {
  'st-hedwig': "ST. HEDWIG'S",
  hero_wolskis: "WOLSKI'S",
  gloriosos: "GLORIOSO'S",
};
const landmarks = [];
for (const e of scene.standing ?? []) {
  if (!inFrame(e)) continue;
  const isHero = e.t === 'img';
  if (!isHero && !e.label) continue;
  const name = isHero
    ? HERO_NAME[Object.keys(HERO_NAME).find((k) => (e.href || '').includes(k))] ?? 'HERO'
    : e.label;
  const w = e.w ?? 12, h = e.h ?? 10, ax = e.ax ?? 0.5, ay = e.ay ?? 0.9;
  const x = X(e), y = Y(e);
  landmarks.push({ name, x, y, box: { x: x - w * ax, y: y - h * ay, w, h }, hero: isHero });
}

// --- game spots -------------------------------------------------------------
const deg = new Map();
for (const e of board.edges ?? []) {
  deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
  deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
}
const spots = board.squares.filter((s) => (deg.get(s.id) ?? 0) >= 3 || s.type !== 'blank');
const SPOT_STYLE = {
  bar: ['#c2410c', 'B'],
  poi: ['#db2777', 'P'],
  challenge: ['#2563eb', 'T'],
  chance: ['#7c3aed', '?'],
  coin: ['#ca8a04', 'C'],
  bowser: ['#166534', '!'],
  start: ['#16a34a', 'S'],
  finish: ['#111827', 'F'],
};

// --- compose ---------------------------------------------------------------
const basePng = await sharp('art-prototype/out/reference.png').png().toBuffer();
const { width: pxW, height: pxH } = await sharp(basePng).metadata();
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');

let o = `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff" opacity="0.42"/>`;
// parks
for (const ring of scene.parks ?? []) {
  const pts = ring.map(([lat, lng]) => `${X({ lat, lng }).toFixed(1)},${Y({ lat, lng }).toFixed(1)}`).join(' ');
  o += `<polygon points="${pts}" fill="#16a34a" opacity="0.25" stroke="#166534" stroke-width="2.5"/>`;
}
// landmark boxes + anchors + facing arrows + labels
for (const L of landmarks) {
  const { ux, uy } = towardStreet(L.x, L.y);
  const ex = L.x + ux * 22, ey = L.y + uy * 22;
  o += `<rect x="${L.box.x.toFixed(1)}" y="${L.box.y.toFixed(1)}" width="${L.box.w}" height="${L.box.h}" fill="#7c3aed" opacity="0.28" stroke="#6d28d9" stroke-width="3"/>`;
  o += `<line x1="${L.x - 9}" y1="${L.y}" x2="${L.x + 9}" y2="${L.y}" stroke="#dc2626" stroke-width="3"/>`;
  o += `<line x1="${L.x}" y1="${L.y - 9}" x2="${L.x}" y2="${L.y + 9}" stroke="#dc2626" stroke-width="3"/>`;
  o += `<line x1="${L.x}" y1="${L.y}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="#111827" stroke-width="3.5"/>`;
  o += `<polygon points="${ex.toFixed(1)},${ey.toFixed(1)} ${(ex - ux * 8 - uy * 5).toFixed(1)},${(ey - uy * 8 + ux * 5).toFixed(1)} ${(ex - ux * 8 + uy * 5).toFixed(1)},${(ey - uy * 8 - ux * 5).toFixed(1)}" fill="#111827"/>`;
  o += `<text x="${L.box.x.toFixed(1)}" y="${(L.box.y - 6).toFixed(1)}" font-size="17" font-family="Arial" font-weight="bold" fill="#4c1d95" stroke="#ffffff" stroke-width="4" paint-order="stroke">${esc(L.name)}</text>`;
}
// game spots
for (const s of spots) {
  const [color, code] = SPOT_STYLE[s.type] ?? ['#64748b', '·'];
  const x = X(s).toFixed(1), y = Y(s).toFixed(1);
  o += `<circle cx="${x}" cy="${y}" r="12" fill="#ffffff" opacity="0.9" stroke="${color}" stroke-width="4"/>`;
  o += `<text x="${x}" y="${+y + 5.5}" font-size="15" font-family="Arial" font-weight="bold" text-anchor="middle" fill="${color}">${code}</text>`;
}
// legend
const legendRows = Object.entries(SPOT_STYLE)
  .map(([t, [c, code]], i) => `<circle cx="18" cy="${26 + i * 24}" r="9" fill="#fff" stroke="${c}" stroke-width="3"/><text x="18" y="${31 + i * 24}" font-size="11" text-anchor="middle" font-family="Arial" font-weight="bold" fill="${c}">${code}</text><text x="34" y="${31 + i * 24}" font-size="13" font-family="Arial" fill="#111827">${t}</text>`)
  .join('');
o += `<g transform="translate(${W - 150}, ${H - 240})"><rect x="0" y="0" width="140" height="${Object.keys(SPOT_STYLE).length * 24 + 16}" rx="8" fill="#ffffff" opacity="0.92" stroke="#111827"/>${legendRows}</g>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" width="${pxW}" height="${pxH}">${o}</svg>`;
await sharp(basePng).composite([{ input: Buffer.from(svg) }]).toFile(`${outBase}-blueprint.png`);

// --- pixel-coordinate spec (the production coordinate system) ---------------
const PX = (v) => Math.round((v * pxW) / W);
const PY = (v) => Math.round((v * pxH) / H);
const lmRows = landmarks
  .map((L) => {
    const { ux, uy } = towardStreet(L.x, L.y);
    return `| ${L.name} | ${PX(L.x)}, ${PY(L.y)} | ${PX(L.box.x)},${PY(L.box.y)} → ${PX(L.box.x + L.box.w)},${PY(L.box.y + L.box.h)} | ${compassOf(ux, uy)} (toward its street) |`;
  })
  .join('\n');
const spotRows = spots
  .filter((s) => s.type !== 'blank')
  .map((s) => `| ${s.type} | ${s.title && s.title !== 'Space' ? s.title : ''} | ${PX(X(s))}, ${PY(Y(s))} |`)
  .join('\n');
const spec = `# Placement spec — canvas pixel coordinates (${pxW}×${pxH}, origin top-left)

An anchor is the entrance/playable point, NOT the building center. The
footprint is the area the building may occupy. Facing = direction the
facade looks (toward its street).

## Landmarks

| Name | Anchor (x, y) | Footprint (x1,y1 → x2,y2) | Facing |
|------|---------------|---------------------------|--------|
${lmRows}

## Typed game spots

| Type | Name | Anchor (x, y) |
|------|------|----------------|
${spotRows}

Plus ${spots.filter((s) => s.type === 'blank').length} plain intersections — see the white dots on the base map; all must stay visible.
`;
writeFileSync(`${outBase}-blueprint-spec.md`, spec);
console.log(`baked ${outBase}-blueprint.png (${landmarks.length} landmarks, ${spots.length} spots) + ${outBase}-blueprint-spec.md`);
