// Reference render for the whole-board-painting experiment.
//
// Bakes a geometrically EXACT base image of a board (island backdrop + street
// track + spot markers) for ChatGPT to repaint as one cohesive illustration
// (img2img, "preserve the layout exactly"). Also writes a sidecar meta JSON
// with the pixel position of every spot, so drift-check.mjs can measure how
// far the returned painting strayed and (later) calibrate display anchors.
//
//   node art-prototype/reference-render.mjs <board.json> [outBase]
//     → <outBase>.png  + <outBase>.meta.json   (default art-prototype/out/reference)
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
