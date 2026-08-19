// Drift check for the whole-board-painting experiment.
//
// Overlays every spot's TRUE pixel position (from reference-render's meta
// JSON) as crosshairs on ChatGPT's returned painting, so you can see at a
// glance whether the painted streets landed under the real spots — the
// go/no-go signal for replacing the composed board with one illustration.
//
//   node art-prototype/drift-check.mjs <returned-image> <reference.meta.json> [out.png]

import { readFileSync } from 'fs';
import sharp from 'sharp';

const [, , artPath, metaPath, outPath = 'art-prototype/out/drift-check.png'] = process.argv;
if (!artPath || !metaPath) {
  console.error('usage: node art-prototype/drift-check.mjs <returned-image> <reference.meta.json> [out.png]');
  process.exit(1);
}
const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
const art = sharp(artPath);
const { width, height } = await art.metadata();

// The returned painting may be any resolution — scale meta coords onto it.
const sx = width / meta.image.width;
const sy = height / meta.image.height;

const marks = meta.spots
  .map((s) => {
    const x = (s.x * sx).toFixed(1), y = (s.y * sy).toFixed(1);
    const bar = s.type === 'bar' || s.type === 'poi';
    const c = bar ? '#dc2626' : '#2563eb';
    return (
      `<line x1="${x - 14}" y1="${y}" x2="${+x + 14}" y2="${y}" stroke="${c}" stroke-width="3"/>` +
      `<line x1="${x}" y1="${y - 14}" x2="${x}" y2="${+y + 14}" stroke="${c}" stroke-width="3"/>` +
      `<circle cx="${x}" cy="${y}" r="9" fill="none" stroke="${c}" stroke-width="2.5"/>`
    );
  })
  .join('');
const overlay = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${marks}</svg>`,
);
await art.composite([{ input: overlay }]).toFile(outPath);
console.log(`wrote ${outPath} — ${meta.spots.length} true positions over the painting`);
console.log('red = bars/POIs, blue = street spots. If crosshairs sit on painted streets, the experiment works.');
