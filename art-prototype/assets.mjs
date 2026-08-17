// Style C asset library v2 — art-language refinement pass.
// Fewer tiny objects, more distinctive readable silhouettes:
//  - residential buildings have STRUCTURAL variants (porches, dormers, bays,
//    duplex width, roof shapes), not just recolors
//  - trees separate by silhouette + canopy texture + color
//  - St. Hedwig hero is more bespoke and assertive
//  - first storefront-row composite (2-3 shops in one building)
// Conventions: world meters, anchor at ground center, grows in -y.
// Oblique depth recedes up-and-right: offset = (+0.36d, -0.55d).

export const INK = '#33291f';
const LINE = 1.25; // thicker, confident outline
const dxy = (d) => [0.36 * d, -0.55 * d];

export const HOUSE_BODIES = ['#f6e7b8', '#bfe0c9', '#a9d3e8', '#f0b39a', '#f7d980', '#cdbde6', '#f6e7b8', '#e8c9a0'];
export const HOUSE_ROOFS = ['#d95d43', '#3f8f7a', '#8a6248', '#5f7285', '#c46a94', '#b3552f'];
export const SHOP_BODIES = ['#e0685a', '#5f9ea8', '#c99046', '#8f7fc0', '#5b8fc9', '#c9a53f'];
export const AWNINGS = ['#c93b3b', '#2f7d5d', '#3b5fc9', '#c9702f', '#7d4fc9', '#2f8f8f'];
export const CAR_BODIES = ['#e05252', '#4f8fd9', '#f2c04c', '#6fbf73', '#e8e4da', '#8f7fc0'];

const P = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ') + ' Z';
const win = (x, y, w, h, sw = 0.55) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="0.35" fill="#fdf3c9" stroke="${INK}" stroke-width="${sw}"/>`;

// ============ RESIDENTIAL — Polish flat / 2-story family (4 structures) ============

// s0 — classic flat-roof Polish flat with a STACKED double porch (very Milwaukee).
function polishFlatS0() {
  const w = 9, h = 11.5, d = 9, L = w / 2;
  const [ox, oy] = dxy(d);
  return `
  <symbol id="bldg.res.polish_flat.s0" overflow="visible">
    <path d="${P([[L, 0], [L, -h], [L + ox, -h + oy], [L + ox, oy]])}" fill="var(--side,#d9c48e)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L, -h], [L, -h], [L + ox, -h + oy], [-L + ox, -h + oy]])}" fill="var(--roof,#d95d43)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L}" y="${-h}" width="${w}" height="${h}" fill="var(--body,#f6e7b8)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L - 0.6}" y="${-h - 0.9}" width="${w + 1.2}" height="1.5" rx="0.35" fill="var(--roof,#d95d43)" stroke="${INK}" stroke-width="0.8"/>
    <!-- stacked double porch: full-height column bay on the left -->
    <rect x="${-L - 1.2}" y="-10.4" width="5" height="10.4" fill="var(--porch,#fbf4e2)" stroke="${INK}" stroke-width="0.85"/>
    <path d="M${-L - 1.2} -5.4 h5" stroke="${INK}" stroke-width="0.7"/>
    <path d="M${-L - 0.5} -10.4 V0 M${L - 5.4 + 2.1} -10.4 V0" stroke="${INK}" stroke-width="0.7"/>
    <path d="M${-L - 1.2} -7.6 h5 M${-L - 1.2} -2.6 h5" stroke="${INK}" stroke-width="0.5" opacity="0.6"/>
    <rect x="${-L - 1.8}" y="-10.8" width="6.2" height="1" rx="0.3" fill="var(--roof,#d95d43)" stroke="${INK}" stroke-width="0.6"/>
    <!-- right-half windows + door -->
    ${win(0.9, -9.7, 2.6, 3)}
    <rect x="0.9" y="-4.4" width="2.5" height="4.4" rx="0.35" fill="var(--door,#7a4b32)" stroke="${INK}" stroke-width="0.65"/>
    <circle cx="3" cy="-2.3" r="0.3" fill="#f2c94c"/>
    <rect x="0.3" y="-0.7" width="3.9" height="1" fill="#cfc4ad" stroke="${INK}" stroke-width="0.5"/>
  </symbol>`;
}

// s1 — front-gable two-story: steep roof, subtle side roof plane, bay window.
function polishFlatS1() {
  const w = 9, h = 10, d = 4.5, L = w / 2, ridge = -16;
  const [ox, oy] = dxy(d);
  return `
  <symbol id="bldg.res.polish_flat.s1" overflow="visible">
    <!-- subtle receding roof plane -->
    <path d="${P([[0, ridge], [L + 1, -h], [L + 1 + ox, -h + oy], [ox, ridge + oy]])}" fill="var(--roofdark,#b34a34)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L}" y="${-h}" width="${w}" height="${h}" fill="var(--body,#f6e7b8)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <!-- steep front gable -->
    <path d="${P([[-L - 1.1, -h], [0, ridge], [L + 1.1, -h]])}" fill="var(--roof,#d95d43)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <circle cx="0" cy="${-h - 3.4}" r="1.15" fill="#fdf3c9" stroke="${INK}" stroke-width="0.55"/>
    ${win(-3.4, -9.2, 2.5, 2.9)}${win(1, -9.2, 2.5, 2.9)}
    <!-- ground-floor bay window -->
    <path d="${P([[-4, 0], [-4, -5.3], [-3, -6.1], [-0.6, -6.1], [0.4, -5.3], [0.4, 0]])}" fill="var(--body,#f6e7b8)" stroke="${INK}" stroke-width="0.8"/>
    ${win(-2.9, -5.2, 2.2, 3.4, 0.5)}
    <rect x="1.6" y="-4.5" width="2.5" height="4.5" rx="0.35" fill="var(--door,#7a4b32)" stroke="${INK}" stroke-width="0.65"/>
    <rect x="1" y="-0.7" width="3.7" height="1" fill="#cfc4ad" stroke="${INK}" stroke-width="0.5"/>
  </symbol>`;
}

// s2 — the WIDE duplex: twin doors, twin stoops, hipped roof.
function polishFlatS2() {
  const w = 12.5, h = 10.5, d = 4.5, L = w / 2;
  const [ox, oy] = dxy(d);
  return `
  <symbol id="bldg.res.polish_flat.s2" overflow="visible">
    <!-- hipped roof: trapezoid front + receding plane -->
    <path d="${P([[-L + 2.4, -h - 3.6], [L - 2.4 + ox, -h - 3.6 + oy], [L + ox, -h + oy], [L, -h]])}" fill="var(--roofdark,#b34a34)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L - 0.8, -h], [-L + 2.4, -h - 3.6], [L - 2.4, -h - 3.6], [L + 0.8, -h]])}" fill="var(--roof,#d95d43)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L}" y="${-h}" width="${w}" height="${h}" fill="var(--body,#f6e7b8)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <!-- mirrored halves: window over door, twice -->
    <path d="M0 ${-h} V0" stroke="${INK}" stroke-width="0.5" opacity="0.45"/>
    ${win(-4.9, -9.4, 2.6, 3)}${win(2.3, -9.4, 2.6, 3)}
    ${win(-4.9, -5, 2.6, 2.6)}${win(2.3, -5, 2.6, 2.6)}
    <rect x="-1.95" y="-4.5" width="1.75" height="4.5" rx="0.3" fill="var(--door,#7a4b32)" stroke="${INK}" stroke-width="0.6"/>
    <rect x="0.2" y="-4.5" width="1.75" height="4.5" rx="0.3" fill="var(--door2,#5e5140)" stroke="${INK}" stroke-width="0.6"/>
    <rect x="-2.5" y="-0.7" width="5" height="1" fill="#cfc4ad" stroke="${INK}" stroke-width="0.5"/>
    <!-- twin brackets under the eave -->
    <path d="M-4.4 ${-h} v-0.8 M4.4 ${-h} v-0.8" stroke="${INK}" stroke-width="0.6"/>
  </symbol>`;
}

// s3 — tall gable w/ full front porch and attic window (worker's cottage grown up).
function polishFlatS3() {
  const w = 8.6, h = 9.5, d = 4.5, L = w / 2, ridge = -15.5;
  const [ox, oy] = dxy(d);
  return `
  <symbol id="bldg.res.polish_flat.s3" overflow="visible">
    <path d="${P([[0, ridge], [L + 1, -h], [L + 1 + ox, -h + oy], [ox, ridge + oy]])}" fill="var(--roofdark,#2f6e5e)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L}" y="${-h}" width="${w}" height="${h}" fill="var(--body,#bfe0c9)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L - 1.1, -h], [0, ridge], [L + 1.1, -h]])}" fill="var(--roof,#3f8f7a)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <!-- attic pair -->
    ${win(-1.8, -12.9, 1.5, 2, 0.45)}${win(0.3, -12.9, 1.5, 2, 0.45)}
    ${win(-3.2, -8.7, 2.4, 2.7)}${win(0.8, -8.7, 2.4, 2.7)}
    <!-- full-width front porch -->
    <rect x="${-L - 1}" y="-4.6" width="${w + 2}" height="1" rx="0.3" fill="var(--roof,#3f8f7a)" stroke="${INK}" stroke-width="0.65"/>
    <path d="M${-L - 0.3} -3.6 V0 M0 -3.6 V0 M${L + 0.3} -3.6 V0" stroke="${INK}" stroke-width="0.7"/>
    <path d="M${-L - 1} -1.6 h${w + 2}" stroke="${INK}" stroke-width="0.5" opacity="0.55"/>
    <rect x="-1.25" y="-3.5" width="2.5" height="3.5" rx="0.3" fill="var(--door,#7a4b32)" stroke="${INK}" stroke-width="0.6"/>
    <rect x="-2.4" y="-0.6" width="4.8" height="0.9" fill="#cfc4ad" stroke="${INK}" stroke-width="0.5"/>
  </symbol>`;
}

// ============ RESIDENTIAL — bungalow (3 structures) ============

// s0 — Craftsman: low wide gable, deep porch, tapered columns, wide steps.
function bungalowS0() {
  const w = 11, h = 5.2, d = 5.5, L = w / 2, gable = 3.6;
  const [ox, oy] = dxy(d);
  return `
  <symbol id="bldg.res.bungalow.s0" overflow="visible">
    <path d="${P([[0, -h - gable], [L + 1.3, -h], [L + 1.3 + ox, -h + oy], [ox, -h - gable + oy]])}" fill="var(--roof,#3f8f7a)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L}" y="${-h}" width="${w}" height="${h}" fill="var(--body,#bfe0c9)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L - 1.3, -h], [0, -h - gable], [L + 1.3, -h]])}" fill="var(--roof,#3f8f7a)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    ${win(-1.2, -7.3, 2.4, 1.6, 0.45)}
    <!-- deep porch: roof slab + tapered columns -->
    <rect x="${-L - 1}" y="-4.4" width="${w + 2}" height="1.05" rx="0.3" fill="var(--roofdark,#2f6e5e)" stroke="${INK}" stroke-width="0.7"/>
    <path d="${P([[-L + 0.2, 0], [-L + 0.55, -3.35], [-L + 1.45, -3.35], [-L + 1.8, 0]])}" fill="var(--porch,#fbf4e2)" stroke="${INK}" stroke-width="0.6"/>
    <path d="${P([[L - 1.8, 0], [L - 1.45, -3.35], [-L + w - 0.55, -3.35], [L - 0.2, 0]])}" fill="var(--porch,#fbf4e2)" stroke="${INK}" stroke-width="0.6"/>
    ${win(-4.3, -3.3, 2.7, 2.5)}${win(1.6, -3.3, 2.7, 2.5)}
    <rect x="-1.35" y="-3.5" width="2.7" height="3.5" rx="0.3" fill="var(--door,#7a4b32)" stroke="${INK}" stroke-width="0.6"/>
    <rect x="-3" y="-0.75" width="6" height="1.05" fill="#cfc4ad" stroke="${INK}" stroke-width="0.5"/>
    <rect x="-3.6" y="-0.35" width="7.2" height="0.6" fill="#bcb098" stroke="${INK}" stroke-width="0.4"/>
  </symbol>`;
}

// s1 — hipped roof + central dormer.
function bungalowS1() {
  const w = 10.5, h = 5.4, d = 4.5, L = w / 2;
  const [ox, oy] = dxy(d);
  return `
  <symbol id="bldg.res.bungalow.s1" overflow="visible">
    <path d="${P([[-L + 2.2, -h - 3.2], [L - 2.2 + ox, -h - 3.2 + oy], [L + ox, -h + oy], [L, -h]])}" fill="var(--roofdark,#4f6274)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L - 0.9, -h], [-L + 2.2, -h - 3.2], [L - 2.2, -h - 3.2], [L + 0.9, -h]])}" fill="var(--roof,#5f7285)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <!-- central dormer -->
    <rect x="-1.5" y="${-h - 2.6}" width="3" height="2" fill="var(--body,#a9d3e8)" stroke="${INK}" stroke-width="0.6"/>
    <path d="${P([[-1.9, -h - 2.6], [0, -h - 3.7], [1.9, -h - 2.6]])}" fill="var(--roof,#5f7285)" stroke="${INK}" stroke-width="0.6"/>
    ${win(-0.85, -h - 2.35, 1.7, 1.5, 0.4)}
    <rect x="${-L}" y="${-h}" width="${w}" height="${h}" fill="var(--body,#a9d3e8)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    ${win(-4.2, -4.3, 2.7, 2.8)}${win(1.5, -4.3, 2.7, 2.8)}
    <rect x="-1.35" y="-3.7" width="2.7" height="3.7" rx="0.3" fill="var(--door,#7a4b32)" stroke="${INK}" stroke-width="0.6"/>
    <rect x="-2.2" y="-0.65" width="4.4" height="0.95" fill="#cfc4ad" stroke="${INK}" stroke-width="0.5"/>
  </symbol>`;
}

// s2 — side-gable cottage w/ chimney and shutters.
function bungalowS2() {
  const w = 9.5, h = 5, d = 4.5, L = w / 2;
  const [ox, oy] = dxy(d);
  return `
  <symbol id="bldg.res.bungalow.s2" overflow="visible">
    <!-- side-gable: roof face toward viewer -->
    <path d="${P([[-L - 0.9, -h], [-L + 1.4, -h - 3], [L - 1.4 + 0, -h - 3], [L + 0.9, -h]])}" fill="var(--roof,#8a6248)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L + 1.4, -h - 3], [L - 1.4, -h - 3], [L - 1.4 + ox, -h - 3 + oy], [-L + 1.4 + ox, -h - 3 + oy]])}" fill="var(--roofdark,#6e4e39)" stroke="${INK}" stroke-width="0.9" stroke-linejoin="round"/>
    <rect x="1.6" y="${-h - 5}" width="1.6" height="2.6" fill="#b3552f" stroke="${INK}" stroke-width="0.55"/>
    <rect x="${-L}" y="${-h}" width="${w}" height="${h}" fill="var(--body,#f0b39a)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <!-- shuttered windows -->
    ${win(-3.7, -4, 2.3, 2.5)}
    <rect x="-4.35" y="-4" width="0.65" height="2.5" fill="var(--roof,#8a6248)" stroke="${INK}" stroke-width="0.35"/>
    <rect x="-1.4" y="-4" width="0.65" height="2.5" fill="var(--roof,#8a6248)" stroke="${INK}" stroke-width="0.35"/>
    ${win(1.6, -4, 2.3, 2.5)}
    <rect x="0.95" y="-4" width="0.65" height="2.5" fill="var(--roof,#8a6248)" stroke="${INK}" stroke-width="0.35"/>
    <rect x="3.9" y="-4" width="0.65" height="2.5" fill="var(--roof,#8a6248)" stroke="${INK}" stroke-width="0.35"/>
    <rect x="-0.5" y="-3.4" width="2.2" height="3.4" rx="0.3" fill="var(--door,#5e5140)" stroke="${INK}" stroke-width="0.6"/>
    <rect x="-1.1" y="-0.6" width="3.4" height="0.9" fill="#cfc4ad" stroke="${INK}" stroke-width="0.5"/>
  </symbol>`;
}

// ============ apartment, garage (lightly simplified from v1) ============

// s0 — narrow 3-story walk-up: stoop, center door, paired windows.
function apartmentS0() {
  const w = 10.5, h = 13, d = 10, L = w / 2;
  const [ox, oy] = dxy(d);
  const wins = [];
  for (let r = 0; r < 3; r++) {
    wins.push(win(-L + 1.2, -11.7 + r * 3.7, 2.4, 2.6, 0.5));
    wins.push(win(L - 3.6, -11.7 + r * 3.7, 2.4, 2.6, 0.5));
  }
  return `
  <symbol id="bldg.res.apartment.s0" overflow="visible">
    <path d="${P([[L, 0], [L, -h], [L + ox, -h + oy], [L + ox, oy]])}" fill="var(--side,#c9a884)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L, -h], [L, -h], [L + ox, -h + oy], [-L + ox, -h + oy]])}" fill="var(--rooftop,#8d8577)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L}" y="${-h}" width="${w}" height="${h}" fill="var(--body,#e0b48f)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L - 0.6}" y="${-h - 0.95}" width="${w + 1.2}" height="1.6" rx="0.35" fill="var(--trim,#b3552f)" stroke="${INK}" stroke-width="0.8"/>
    <rect x="-1.55" y="-8" width="3.1" height="2.4" rx="0.3" fill="#fdf3c9" stroke="${INK}" stroke-width="0.5"/>
    <rect x="-1.55" y="-11.7" width="3.1" height="2.4" rx="0.3" fill="#fdf3c9" stroke="${INK}" stroke-width="0.5"/>
    ${wins.join('')}
    <rect x="-1.55" y="-4.4" width="3.1" height="4.4" rx="0.35" fill="var(--door,#6b4530)" stroke="${INK}" stroke-width="0.65"/>
    <path d="M-2.4 -4.6 L0 -5.9 L2.4 -4.6 Z" fill="var(--trim,#b3552f)" stroke="${INK}" stroke-width="0.6"/>
    <rect x="-2.6" y="-0.8" width="5.2" height="1.1" fill="#cfc4ad" stroke="${INK}" stroke-width="0.5"/>
  </symbol>`;
}

// s1 — wide brick block: three window bays, arched center entry, deep cornice.
function apartmentS1() {
  const w = 17, h = 12.5, d = 11, L = w / 2;
  const [ox, oy] = dxy(d);
  const wins = [];
  for (let r = 0; r < 3; r++) for (const c of [-6.6, -2.2, 2.2, 6.6].slice(0, 4))
    wins.push(win(c - 1.1, -11.2 + r * 3.6, 2.2, 2.6, 0.5));
  return `
  <symbol id="bldg.res.apartment.s1" overflow="visible">
    <path d="${P([[L, 0], [L, -h], [L + ox, -h + oy], [L + ox, oy]])}" fill="var(--side,#a8765a)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L, -h], [L, -h], [L + ox, -h + oy], [-L + ox, -h + oy]])}" fill="var(--rooftop,#8d8577)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L}" y="${-h}" width="${w}" height="${h}" fill="var(--body,#c98a66)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L - 0.7}" y="${-h - 1.1}" width="${w + 1.4}" height="1.8" rx="0.4" fill="var(--trim,#8a5a44)" stroke="${INK}" stroke-width="0.85"/>
    <path d="M${-L + 0.9} -4.1 h${w - 1.8}" stroke="var(--trim,#8a5a44)" stroke-width="0.5" opacity="0.7"/>
    ${wins.join('')}
    <path d="M-1.9 0 L-1.9 -3.5 A1.9 2 0 0 1 1.9 -3.5 L1.9 0 Z" fill="var(--door,#5e4534)" stroke="${INK}" stroke-width="0.65"/>
    <path d="M-2.5 -3.5 A2.5 2.5 0 0 1 2.5 -3.5" fill="none" stroke="var(--trim,#8a5a44)" stroke-width="0.8"/>
    <rect x="-3" y="-0.75" width="6" height="1.05" fill="#cfc4ad" stroke="${INK}" stroke-width="0.5"/>
  </symbol>`;
}

// s2 — corner apartment: chamfered corner entry, stone base band (mirrorable).
function apartmentS2() {
  const w = 14, h = 13, d = 11, L = w / 2;
  const [ox, oy] = dxy(d);
  const wins = [];
  for (let r = 0; r < 3; r++) {
    wins.push(win(-L + 1.2, -11.6 + r * 3.5, 2.3, 2.5, 0.5));
    wins.push(win(-L + 4.7, -11.6 + r * 3.5, 2.3, 2.5, 0.5));
    if (r > 0) wins.push(win(L - 4.7, -11.6 + r * 3.5, 2.3, 2.5, 0.5));
  }
  return `
  <symbol id="bldg.res.apartment.s2" overflow="visible">
    <path d="${P([[L, 0], [L, -h], [L + ox, -h + oy], [L + ox, oy]])}" fill="var(--side,#9a8a74)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L, -h], [L, -h], [L + ox, -h + oy], [-L + ox, -h + oy]])}" fill="var(--rooftop,#8d8577)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L, 0], [-L, -h], [L, -h], [L, -4], [L - 2.8, 0]])}" fill="var(--body,#c9c09a)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L - 0.6}" y="${-h - 0.95}" width="${w + 1.2}" height="1.6" rx="0.35" fill="var(--trim,#7d6b52)" stroke="${INK}" stroke-width="0.8"/>
    <!-- stone base band -->
    <path d="${P([[-L, 0], [-L, -3.2], [L - 1.6, -3.2], [L - 2.8, 0]])}" fill="var(--base,#b0a58c)" stroke="${INK}" stroke-width="0.7"/>
    ${wins.join('')}
    <!-- chamfer corner door -->
    <path d="${P([[L - 2.6, 0], [L - 0.5, -3], [L - 0.5, -6.2], [L - 3.8, -6.2], [L - 3.8, 0]])}" fill="var(--side,#9a8a74)" stroke="${INK}" stroke-width="0.7"/>
    <rect x="${L - 3.4}" y="-4.4" width="2.2" height="4.4" rx="0.3" fill="var(--door,#4f4234)" stroke="${INK}" stroke-width="0.55"/>
    <circle cx="${L - 2.8}" cy="-2.3" r="0.26" fill="#f2c94c"/>
  </symbol>`;
}

// s3 — 4-story urban block: taller, stepped parapet, strong vertical bay.
function apartmentS3() {
  const w = 13, h = 16.5, d = 11, L = w / 2;
  const [ox, oy] = dxy(d);
  const wins = [];
  for (let r = 0; r < 4; r++) {
    wins.push(win(-L + 1.2, -15 + r * 3.7, 2.3, 2.6, 0.5));
    wins.push(win(L - 3.5, -15 + r * 3.7, 2.3, 2.6, 0.5));
  }
  return `
  <symbol id="bldg.res.apartment.s3" overflow="visible">
    <path d="${P([[L, 0], [L, -h], [L + ox, -h + oy], [L + ox, oy]])}" fill="var(--side,#8f7a8a)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L, -h], [L, -h], [L + ox, -h + oy], [-L + ox, -h + oy]])}" fill="var(--rooftop,#8d8577)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L}" y="${-h}" width="${w}" height="${h}" fill="var(--body,#b3a0b8)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <!-- stepped parapet -->
    <rect x="${-L - 0.6}" y="${-h - 0.9}" width="${w + 1.2}" height="1.5" rx="0.35" fill="var(--trim,#6e5a74)" stroke="${INK}" stroke-width="0.8"/>
    <rect x="-2.6" y="${-h - 2}" width="5.2" height="1.4" rx="0.3" fill="var(--trim,#6e5a74)" stroke="${INK}" stroke-width="0.7"/>
    <!-- center vertical bay in contrast tone -->
    <rect x="-1.7" y="${-h}" width="3.4" height="${h}" fill="var(--bay,#a08aa8)" stroke="${INK}" stroke-width="0.6"/>
    ${wins.join('')}
    ${[0, 1, 2].map((r) => win(-1.2, -14.4 + r * 3.7, 2.4, 2.4, 0.5)).join('')}
    <rect x="-1.5" y="-4.3" width="3" height="4.3" rx="0.35" fill="var(--door,#4f4055)" stroke="${INK}" stroke-width="0.65"/>
    <rect x="-2.4" y="-0.75" width="4.8" height="1.05" fill="#cfc4ad" stroke="${INK}" stroke-width="0.5"/>
  </symbol>`;
}

// s0 — front-gable detached garage.
function garageS0() {
  const w = 6.6, h = 3.5, d = 4, L = w / 2;
  const [ox, oy] = dxy(d);
  return `
  <symbol id="bldg.res.garage.s0" overflow="visible">
    <path d="${P([[0, -h - 1.8], [L + 0.6, -h], [L + 0.6 + ox, -h + oy], [ox, -h - 1.8 + oy]])}" fill="var(--roof,#8a6248)" stroke="${INK}" stroke-width="1" stroke-linejoin="round"/>
    <rect x="${-L}" y="${-h}" width="${w}" height="${h}" fill="var(--body,#e8ddc4)" stroke="${INK}" stroke-width="1" stroke-linejoin="round"/>
    <path d="${P([[-L - 0.6, -h], [0, -h - 1.8], [L + 0.6, -h]])}" fill="var(--roof,#8a6248)" stroke="${INK}" stroke-width="1" stroke-linejoin="round"/>
    <rect x="${-L + 1}" y="-2.8" width="${w - 2}" height="2.8" rx="0.3" fill="var(--door,#9a8265)" stroke="${INK}" stroke-width="0.6"/>
    <path d="M${-L + 1} -1.9 h${w - 2}" stroke="${INK}" stroke-width="0.35" opacity="0.5"/>
  </symbol>`;
}

// s1 — alley garage: flat roof (full deck per roof rule), wide door, utilitarian.
function garageS1() {
  const w = 6.8, h = 3.1, d = 5.5, L = w / 2;
  const [ox, oy] = dxy(d);
  return `
  <symbol id="bldg.res.garage.s1" overflow="visible">
    <path d="${P([[L, 0], [L, -h], [L + ox, -h + oy], [L + ox, oy]])}" fill="var(--side,#c2b394)" stroke="${INK}" stroke-width="0.9" stroke-linejoin="round"/>
    <path d="${P([[-L, -h], [L, -h], [L + ox, -h + oy], [-L + ox, -h + oy]])}" fill="var(--rooftop,#8d8577)" stroke="${INK}" stroke-width="0.9" stroke-linejoin="round"/>
    <rect x="${-L}" y="${-h}" width="${w}" height="${h}" fill="var(--body,#d4c8a8)" stroke="${INK}" stroke-width="1" stroke-linejoin="round"/>
    <rect x="${-L - 0.4}" y="${-h - 0.6}" width="${w + 0.8}" height="1" rx="0.25" fill="var(--trim,#8a7a60)" stroke="${INK}" stroke-width="0.55"/>
    <rect x="${-L + 0.8}" y="-2.5" width="${w - 3}" height="2.5" rx="0.25" fill="var(--door,#9a8265)" stroke="${INK}" stroke-width="0.55"/>
    <path d="M${-L + 0.8} -1.7 h${w - 3} M${-L + 0.8} -0.9 h${w - 3}" stroke="${INK}" stroke-width="0.3" opacity="0.5"/>
    <rect x="${L - 1.9}" y="-2.4" width="1.3" height="2.4" rx="0.2" fill="#7a6a50" stroke="${INK}" stroke-width="0.45"/>
  </symbol>`;
}

// Sheds — environmental seasoning, smaller and simpler than garages.
function shedS0() {
  const w = 4, h = 2.4, L = w / 2;
  return `
  <symbol id="bldg.res.shed.s0" overflow="visible">
    <rect x="${-L}" y="${-h}" width="${w}" height="${h}" fill="var(--body,#cbb896)" stroke="${INK}" stroke-width="0.9" stroke-linejoin="round"/>
    <path d="${P([[-L - 0.5, -h], [0, -h - 1.4], [L + 0.5, -h]])}" fill="var(--roof,#7d6b5a)" stroke="${INK}" stroke-width="0.9" stroke-linejoin="round"/>
    <rect x="-0.8" y="-1.9" width="1.6" height="1.9" rx="0.2" fill="var(--door,#8a7355)" stroke="${INK}" stroke-width="0.5"/>
    <path d="M0 -1.9 V0" stroke="${INK}" stroke-width="0.3" opacity="0.6"/>
  </symbol>`;
}
function shedS1() {
  const w = 4.4, h = 2.2, L = w / 2;
  return `
  <symbol id="bldg.res.shed.s1" overflow="visible">
    <rect x="${-L}" y="${-h}" width="${w}" height="${h}" fill="var(--body,#b9b09a)" stroke="${INK}" stroke-width="0.9" stroke-linejoin="round"/>
    <path d="${P([[-L - 0.5, -h], [L + 0.5, -h - 1.1], [L + 0.5, -h]])}" fill="var(--roof,#6e6250)" stroke="${INK}" stroke-width="0.9" stroke-linejoin="round"/>
    <rect x="${-L + 0.6}" y="-1.7" width="1.4" height="1.7" rx="0.2" fill="var(--door,#8a7355)" stroke="${INK}" stroke-width="0.5"/>
    <rect x="${L - 1.7}" y="-1.6" width="1.1" height="0.9" rx="0.15" fill="#fdf3c9" stroke="${INK}" stroke-width="0.4"/>
  </symbol>`;
}

// Rowhouse — 3 attached residential units, shared walls, small stoops.
function rowhouseS0() {
  const w = 16.5, h = 10.5, d = 10, L = w / 2;
  const [ox, oy] = dxy(d);
  const unitW = w / 3;
  const units = [0, 1, 2].map((i) => {
    const x0 = -L + i * unitW;
    return `
    <rect x="${x0}" y="${-h}" width="${unitW}" height="${h}" fill="var(--u${i},#d9a8a0)" stroke="${INK}" stroke-width="0.9"/>
    ${win(x0 + 0.9, -9.3, 2, 2.5, 0.5)}${win(x0 + unitW - 2.9, -9.3, 2, 2.5, 0.5)}
    ${win(x0 + 0.9, -5.3, 2, 2.4, 0.5)}
    <rect x="${x0 + unitW - 2.9}" y="-4" width="2" height="4" rx="0.3" fill="var(--door,#6b4530)" stroke="${INK}" stroke-width="0.55"/>
    <rect x="${x0 + unitW - 3.3}" y="-0.6" width="2.8" height="0.9" fill="#cfc4ad" stroke="${INK}" stroke-width="0.45"/>`;
  }).join('');
  return `
  <symbol id="bldg.res.rowhouse.s0" overflow="visible">
    <path d="${P([[L, 0], [L, -h], [L + ox, -h + oy], [L + ox, oy]])}" fill="var(--side,#a8766a)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L, -h], [L, -h], [L + ox, -h + oy], [-L + ox, -h + oy]])}" fill="var(--rooftop,#8d8577)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    ${units}
    <rect x="${-L - 0.6}" y="${-h - 0.9}" width="${w + 1.2}" height="1.5" rx="0.35" fill="var(--trim,#8a5a44)" stroke="${INK}" stroke-width="0.8"/>
  </symbol>`;
}

// Conifers — yard/park dressing only (zero street conifers in the city data).
function coniferS0() { // spruce: stacked tiers, dark blue-green
  return `
  <symbol id="tree.conifer.s0" overflow="visible">
    <rect x="-0.55" y="-1.9" width="1.1" height="1.9" rx="0.3" fill="#6e4f38" stroke="${INK}" stroke-width="0.5"/>
    <path d="${P([[-3.6, -1.8], [3.6, -1.8], [0, -6]])}" fill="#3d7261" stroke="${INK}" stroke-width="1.05" stroke-linejoin="round"/>
    <path d="${P([[-3, -4.8], [3, -4.8], [0, -8.6]])}" fill="#447e6a" stroke="${INK}" stroke-width="1.05" stroke-linejoin="round"/>
    <path d="${P([[-2.3, -7.6], [2.3, -7.6], [0, -11.4]])}" fill="#4f8f77" stroke="${INK}" stroke-width="1.05" stroke-linejoin="round"/>
    <path d="M-2 -3.2 h1.4 M0.8 -6.1 h1.3 M-1.4 -8.8 h1.1" stroke="#2c5a4a" stroke-width="0.5" opacity="0.8"/>
  </symbol>`;
}
function coniferS1() { // pine: bare trunk, irregular asymmetric foliage clouds
  return `
  <symbol id="tree.conifer.s1" overflow="visible">
    <path d="M-0.6 0 C-0.4 -2.4 -0.5 -4.4 -0.2 -6.6 L0.6 -6.6 C0.5 -4.4 0.6 -2.4 0.8 0 Z" fill="#7a5a3c" stroke="${INK}" stroke-width="0.55"/>
    <path d="M0 -6 C-1.4 -6.8 -2.6 -7 -3.6 -8.2 M0.2 -6.6 C1.2 -7.6 2.2 -7.8 3 -8.8" fill="none" stroke="#7a5a3c" stroke-width="0.6"/>
    <ellipse cx="-3.6" cy="-8.9" rx="2.3" ry="1.3" fill="#527a4a" stroke="${INK}" stroke-width="0.85"/>
    <ellipse cx="2.9" cy="-9.4" rx="2.1" ry="1.2" fill="#5a854f" stroke="${INK}" stroke-width="0.85"/>
    <ellipse cx="-0.4" cy="-11.2" rx="2.6" ry="1.4" fill="#639158" stroke="${INK}" stroke-width="0.85"/>
    <ellipse cx="-1.4" cy="-11.7" rx="0.9" ry="0.45" fill="#8fb97e"/>
  </symbol>`;
}
function coniferS2() { // arborvitae: dense narrow column
  return `
  <symbol id="tree.conifer.s2" overflow="visible">
    <path d="M0 -7.6 C1.3 -7 1.7 -5.2 1.7 -3.4 C1.7 -1.4 1 -0.2 0 0 C-1 -0.2 -1.7 -1.4 -1.7 -3.4 C-1.7 -5.2 -1.3 -7 0 -7.6 Z"
      fill="#4a7d52" stroke="${INK}" stroke-width="0.95" stroke-linejoin="round"/>
    <path d="M-0.5 -6.2 C-0.7 -4.6 -0.7 -2.6 -0.5 -1 M0.5 -6 C0.7 -4.6 0.7 -2.8 0.5 -1.2" fill="none" stroke="#35603c" stroke-width="0.45" opacity="0.8"/>
    <path d="M-0.9 -6.6 C-0.4 -7.3 0.4 -7.4 0.8 -6.9 C0.3 -7 -0.4 -6.9 -0.9 -6.6 Z" fill="#6ea470"/>
  </symbol>`;
}

// Flowering s1 — looser multi-cluster crown with visible branchlets.
function floweringS1() {
  const puff = (x, y, r, tone) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${tone}" stroke="${INK}" stroke-width="0.75"/>`;
  return `
  <symbol id="tree.flowering.s1" overflow="visible">
    <path d="M-0.5 0 L-0.35 -2 H0.35 L0.5 0 Z" fill="#6b4530" stroke="${INK}" stroke-width="0.5"/>
    <path d="M0 -1.8 C-1.2 -2.6 -2.2 -2.8 -3 -4 M0 -2 C1.1 -2.8 2 -3 2.8 -4.2 M0 -2 C0.1 -3.2 0.2 -4 0.1 -5.2" fill="none" stroke="#6b4530" stroke-width="0.5"/>
    ${puff(-3.1, -4.9, 1.3, '#f2a8c8')}${puff(2.9, -5, 1.25, '#f7c3da')}${puff(0.1, -6.2, 1.45, '#ef9cc0')}${puff(-1.4, -3.9, 0.95, '#f7c3da')}${puff(1.5, -3.7, 0.85, '#f2a8c8')}
    <circle cx="-0.5" cy="-6.9" r="0.5" fill="#fde3f0"/>
    <circle cx="-3.6" cy="-5.4" r="0.4" fill="#fde3f0"/>
    <circle cx="2.4" cy="-4.4" r="0.35" fill="#ffffff"/>
  </symbol>`;
}

// ============ COMMERCIAL ============

// ============ MODULAR STOREFRONT TREATMENT VOCABULARY ============
// Reusable pieces composed into concrete symbols. Business category selects a
// treatment COMBO (encoded in variant, see generate.mjs); palette recolors it.
// No icons: category shows through awning/sign/window/patio character only.

const trtAwningStriped = (x, w, awnVar) => {
  const stripes = [0, 1, 2, 3, 4].map((i) =>
    `<rect x="${x + 0.2 + (i * (w - 0.4)) / 5}" y="-4.5" width="${(w - 0.4) / 10}" height="1.85" fill="#fdf6e3"/>`).join('');
  return `<path d="${P([[x - 0.5, -3], [x + w + 0.5, -3], [x + w, -4.5], [x, -4.5]])}" fill="${awnVar}" stroke="${INK}" stroke-width="0.7"/>${stripes}`;
};
const trtAwningSolid = (x, w, awnVar) =>
  `<path d="${P([[x - 0.5, -3], [x + w + 0.5, -3], [x + w, -4.5], [x, -4.5]])}" fill="${awnVar}" stroke="${INK}" stroke-width="0.7"/>
   <path d="M${x + 0.4} -3.4 L${x + w - 0.4} -3.4" stroke="#00000022" stroke-width="0.45"/>`;
const trtSignBand = (x, w, tone = 'var(--sign,#fdf6e3)') =>
  `<rect x="${x + 0.5}" y="-5.5" width="${w - 1}" height="1.6" rx="0.3" fill="${tone}" stroke="${INK}" stroke-width="0.5"/>
   <path d="M${x + 1.4} -4.7 h${w - 2.8}" stroke="#00000033" stroke-width="0.55"/>`;
const trtSignHang = (x, side = -1) =>
  `<path d="M${x} -7.4 h${side * 2.2}" stroke="${INK}" stroke-width="0.55"/>
   <rect x="${x + side * 2.2 - (side < 0 ? 2.4 : 0)}" y="-7" width="2.4" height="1.7" rx="0.3" fill="var(--sign,#fdf6e3)" stroke="${INK}" stroke-width="0.5"/>`;
const trtWinDisplay = (x, w) =>
  `<rect x="${x}" y="-2.9" width="${w}" height="2.9" fill="#bfe4ea" stroke="${INK}" stroke-width="0.55"/>
   <path d="M${x + 0.6} -0.4 L${x + 1.9} -2.4" stroke="#ffffff" stroke-width="0.5" opacity="0.85"/>
   <path d="M${x} -1.1 h${w}" stroke="#8fb5bd" stroke-width="0.35" opacity="0.8"/>`;
const trtWinNarrow = (x) =>
  `<rect x="${x}" y="-3" width="1.7" height="3" fill="#bfe4ea" stroke="${INK}" stroke-width="0.5"/>
   <rect x="${x + 2.4}" y="-3" width="1.7" height="3" fill="#bfe4ea" stroke="${INK}" stroke-width="0.5"/>`;
const trtWinWarm = (x, w) =>
  `<rect x="${x}" y="-3.1" width="${w}" height="3.1" fill="#f6c568" stroke="${INK}" stroke-width="0.55"/>
   <path d="M${x + w / 2} -3.1 V0 M${x} -1.4 h${w}" stroke="${INK}" stroke-width="0.35" opacity="0.7"/>`;
const trtPatio = (x) => `
   <g transform="translate(${x} 1.6)">
     <circle r="1.15" fill="#e8dcc2" stroke="${INK}" stroke-width="0.45"/>
     <path d="M0 -1.1 V-2.6 M-1.5 -2.6 A1.6 1 0 0 1 1.5 -2.6 Z" fill="#c9584a" stroke="${INK}" stroke-width="0.4"/>
     <circle cx="3" cy="0.4" r="0.95" fill="#e8dcc2" stroke="${INK}" stroke-width="0.4"/>
   </g>`;
const trtPlanters = (x1, x2) =>
  [x1, x2].map((px) => `
   <rect x="${px}" y="-1.2" width="1.6" height="1.2" rx="0.2" fill="#8a5a44" stroke="${INK}" stroke-width="0.4"/>
   <circle cx="${px + 0.45}" cy="-1.5" r="0.55" fill="#5da24b" stroke="${INK}" stroke-width="0.35"/>
   <circle cx="${px + 1.15}" cy="-1.6" r="0.5" fill="#79b25c" stroke="${INK}" stroke-width="0.35"/>`).join('');

// shared 2-story commercial shell
function comShell(w, h, d, extra = '') {
  const L = w / 2;
  const [ox, oy] = dxy(d);
  return `
    <path d="${P([[L, 0], [L, -h], [L + ox, -h + oy], [L + ox, oy]])}" fill="var(--side,#b0574b)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L, -h], [L, -h], [L + ox, -h + oy], [-L + ox, -h + oy]])}" fill="var(--rooftop,#8d8577)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L}" y="${-h}" width="${w}" height="${h}" fill="var(--body,#e0685a)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L - 0.6}" y="${-h - 0.9}" width="${w + 1.2}" height="1.5" rx="0.35" fill="var(--trim,#8a5a44)" stroke="${INK}" stroke-width="0.8"/>
    ${extra}`;
}

// Single storefront: 6 treatment combos (category-driven, see generate.mjs).
//   t0 bakery/food: striped awning + display window
//   t1 salon/service: solid awning + narrow windows + band
//   t2 shop: deep sign band + display window
//   t3 cafe: solid awning + patio tables
//   t4 shop+planters: band + display + planters
//   t5 bar-ish storefront: warm windows + hanging sign
function storefrontT(t) {
  const w = 10.5, h = 9.5, L = w / 2;
  const upper = `${win(-L + 1.2, -8.4, 2.2, 2.6, 0.5)}${win(-1.1, -8.4, 2.2, 2.6, 0.5)}${win(L - 3.4, -8.4, 2.2, 2.6, 0.5)}`;
  const door = `<rect x="${L - 3.1}" y="-3.2" width="2.3" height="3.2" rx="0.3" fill="var(--door,#5b4632)" stroke="${INK}" stroke-width="0.55"/>`;
  const T = [
    trtAwningStriped(-L, w, 'var(--awn,#c93b3b)') + trtWinDisplay(-L + 0.8, w - 4.8) + door,
    trtAwningSolid(-L, w, 'var(--awn,#2f7d5d)') + trtSignBand(-L, w) + trtWinNarrow(-L + 1.2) + door,
    trtSignBand(-L, w, 'var(--awn,#c93b3b)') + trtWinDisplay(-L + 0.8, w - 4.8) + door,
    trtAwningSolid(-L, w, 'var(--awn,#c9702f)') + trtWinDisplay(-L + 0.8, w - 5.6) + door + trtPatio(-L - 2.4),
    trtSignBand(-L, w) + trtWinDisplay(-L + 0.8, w - 4.8) + door + trtPlanters(-L + 0.4, L - 0.6),
    trtWinWarm(-L + 0.9, w - 4.9) + door + trtSignHang(-L),
  ][t];
  return `
  <symbol id="bldg.com.storefront.t${t}" overflow="visible">
    ${comShell(w, h, 10, upper)}
    ${T}
  </symbol>`;
}

// Storefront row: structure = bay count (s0 = 2-bay, s1 = 3-bay), three
// treatment layouts each; per-bay body/awning colors; ONE building silhouette.
function storefrontRowS(nBays, t) {
  const bayW = 7.2, w = bayW * nBays, h = 10, L = w / 2;
  const [ox, oy] = dxy(10);
  const parapets = nBays === 2 ? [1.2, 0] : [1.4, 0, 0.8];
  // layout table: per-bay treatment picks
  const layouts = [
    ['awnStr', 'band'], ['band', 'awnSol'], ['awnSol', 'warm'],
  ];
  const layouts3 = [
    ['awnStr', 'band', 'awnSol'], ['band', 'awnStr', 'planters'], ['awnSol', 'warm', 'awnStr'],
  ];
  const lay = (nBays === 2 ? layouts : layouts3)[t];
  const bays = Array.from({ length: nBays }, (_, i) => {
    const x0 = -L + i * bayW;
    const ph = parapets[i];
    const kind = lay[i];
    const front =
      kind === 'awnStr' ? trtAwningStriped(x0, bayW, `var(--a${i},#c93b3b)`) + trtWinDisplay(x0 + 0.7, bayW - 3.6)
      : kind === 'awnSol' ? trtAwningSolid(x0, bayW, `var(--a${i},#2f7d5d)`) + trtWinDisplay(x0 + 0.7, bayW - 3.6)
      : kind === 'warm' ? trtWinWarm(x0 + 0.7, bayW - 3.4) + trtSignBand(x0, bayW)
      : kind === 'planters' ? trtSignBand(x0, bayW) + trtWinDisplay(x0 + 0.7, bayW - 3.6) + trtPlanters(x0 + 0.3, x0 + bayW - 1.9)
      : trtSignBand(x0, bayW, `var(--a${i},#fdf6e3)`) + trtWinDisplay(x0 + 0.7, bayW - 3.6);
    return `
    <rect x="${x0}" y="${-h - ph}" width="${bayW}" height="${h + ph}" fill="var(--b${i},#e0685a)" stroke="${INK}" stroke-width="1"/>
    <rect x="${x0 - 0.25}" y="${-h - ph - 0.85}" width="${bayW + 0.5}" height="1.35" rx="0.3" fill="var(--trim,#8a5a44)" stroke="${INK}" stroke-width="0.7"/>
    ${win(x0 + 0.9, -8.6, 2, 2.5, 0.5)}${win(x0 + bayW - 2.9, -8.6, 2, 2.5, 0.5)}
    ${front}
    <rect x="${x0 + bayW - 2.5}" y="-3.1" width="1.8" height="3.1" rx="0.3" fill="#5b4632" stroke="${INK}" stroke-width="0.5"/>`;
  }).join('');
  return `
  <symbol id="bldg.com.storefront_row.s${nBays - 2}.t${t}" overflow="visible">
    <path d="${P([[L, 0], [L, -h - parapets[nBays - 1]], [L + ox, -h - parapets[nBays - 1] + oy], [L + ox, oy]])}" fill="var(--side,#b0574b)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L, -h - parapets[0]], [L, -h - parapets[nBays - 1]], [L + ox, -h - parapets[nBays - 1] + oy], [-L + ox, -h - parapets[0] + oy]])}" fill="var(--rooftop,#8d8577)" stroke="${INK}" stroke-width="1" stroke-linejoin="round"/>
    ${bays}
  </symbol>`;
}

// Mixed use: commercial ground floor + residential floors above.
// s0 — narrow 2-story shop+apartment; s1 — 3-story brick; s2 — corner (facing-aware).
function mixedUseS0() {
  const w = 9.5, h = 10;
  const L = w / 2;
  return `
  <symbol id="bldg.com.mixed_use.s0" overflow="visible">
    ${comShell(w, h, 10, '')}
    ${win(-L + 1.1, -8.8, 2.3, 2.8, 0.5)}${win(L - 3.4, -8.8, 2.3, 2.8, 0.5)}
    <path d="M${-L} -5.7 h${w}" stroke="var(--trim,#8a5a44)" stroke-width="0.55"/>
    ${trtAwningStriped(-L, w, 'var(--awn,#c93b3b)')}
    ${trtWinDisplay(-L + 0.8, w - 4.6)}
    <rect x="${L - 3}" y="-3.2" width="2.2" height="3.2" rx="0.3" fill="var(--door,#5b4632)" stroke="${INK}" stroke-width="0.55"/>
  </symbol>`;
}
function mixedUseS1() {
  const w = 12, h = 13.5, L = w / 2;
  const rows = [0, 1].map((r) =>
    `${win(-L + 1.1, -12.2 + r * 3.6, 2.2, 2.6, 0.5)}${win(-1.1, -12.2 + r * 3.6, 2.2, 2.6, 0.5)}${win(L - 3.3, -12.2 + r * 3.6, 2.2, 2.6, 0.5)}`).join('');
  return `
  <symbol id="bldg.com.mixed_use.s1" overflow="visible">
    ${comShell(w, h, 11, '')}
    ${rows}
    <path d="M${-L} -5.6 h${w}" stroke="var(--trim,#8a5a44)" stroke-width="0.55"/>
    ${trtSignBand(-L, w, 'var(--awn,#fdf6e3)')}
    ${trtWinDisplay(-L + 0.8, w - 5)}
    <rect x="${L - 3.4}" y="-3.2" width="2.4" height="3.2" rx="0.3" fill="var(--door,#5b4632)" stroke="${INK}" stroke-width="0.55"/>
  </symbol>`;
}
function mixedUseS2() {
  const w = 13, h = 13, L = w / 2;
  const [ox, oy] = dxy(11);
  const rows = [0, 1].map((r) =>
    `${win(-L + 1.1, -11.8 + r * 3.5, 2.2, 2.5, 0.5)}${win(-L + 4.6, -11.8 + r * 3.5, 2.2, 2.5, 0.5)}${win(L - 4.9, -11.8 + r * 3.5, 2.2, 2.5, 0.5)}`).join('');
  return `
  <symbol id="bldg.com.mixed_use.s2" overflow="visible">
    <path d="${P([[L, 0], [L, -h], [L + ox, -h + oy], [L + ox, oy]])}" fill="var(--side,#8a4a40)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L, -h], [L, -h], [L + ox, -h + oy], [-L + ox, -h + oy]])}" fill="var(--rooftop,#8d8577)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L, 0], [-L, -h], [L, -h], [L, -3.8], [L - 2.7, 0]])}" fill="var(--body,#c96a52)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L - 0.6}" y="${-h - 0.9}" width="${w + 1.2}" height="1.5" rx="0.35" fill="var(--trim,#8a5a44)" stroke="${INK}" stroke-width="0.8"/>
    ${rows}
    <path d="M${-L} -5.5 h${w}" stroke="var(--trim,#8a5a44)" stroke-width="0.55"/>
    ${trtAwningSolid(-L, w - 3.4, 'var(--awn,#2f7d5d)')}
    ${trtWinDisplay(-L + 0.8, w - 8)}
    <path d="${P([[L - 2.5, 0], [L - 0.5, -2.9], [L - 0.5, -6], [L - 3.6, -6], [L - 3.6, 0]])}" fill="var(--side,#8a4a40)" stroke="${INK}" stroke-width="0.7"/>
    <rect x="${L - 3.2}" y="-4.2" width="2.1" height="4.2" rx="0.3" fill="#4a3423" stroke="${INK}" stroke-width="0.55"/>
    ${trtSignHang(-L)}
  </symbol>`;
}

function cornerTavern() {
  const w = 12, h = 10, d = 11, L = w / 2;
  const [ox, oy] = dxy(d);
  return `
  <symbol id="bldg.com.corner_tavern" overflow="visible">
    <path d="${P([[L, 0], [L, -h], [L + ox, -h + oy], [L + ox, oy]])}" fill="var(--side,#6b4530)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L, -h], [L, -h], [L + ox, -h + oy], [-L + ox, -h + oy]])}" fill="var(--rooftop,#7d7466)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L, 0], [-L, -h], [L, -h], [L, -3.4], [L - 2.4, 0]])}" fill="var(--body,#8a5138)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L - 0.6}" y="${-h - 0.9}" width="${w + 1.2}" height="1.5" rx="0.35" fill="var(--trim,#59392e)" stroke="${INK}" stroke-width="0.8"/>
    <rect x="${-L + 0.9}" y="-9.2" width="${w - 1.8}" height="2.1" rx="0.4" fill="#2c2622" stroke="${INK}" stroke-width="0.55"/>
    <rect x="${-L + 1}" y="-6.2" width="3.4" height="3.4" rx="0.35" fill="#ffd977" stroke="${INK}" stroke-width="0.6"/>
    <rect x="${-L + 5.4}" y="-6.2" width="3.4" height="3.4" rx="0.35" fill="#ffd977" stroke="${INK}" stroke-width="0.6"/>
    <path d="M${-L + 1} -4.5 h3.4 M${-L + 5.4} -4.5 h3.4" stroke="${INK}" stroke-width="0.35"/>
    <path d="${P([[L - 2.2, 0], [L - 0.4, -2.7], [L - 0.4, -5.6], [L - 3.4, -5.6], [L - 3.4, 0]])}" fill="var(--doorwall,#6b4530)" stroke="${INK}" stroke-width="0.7"/>
    <rect x="${L - 3}" y="-3.9" width="2.1" height="3.9" rx="0.3" fill="#4a3423" stroke="${INK}" stroke-width="0.55"/>
    <circle cx="${L - 2.45}" cy="-2" r="0.25" fill="#f2c94c"/>
    <path d="M${-L} -8.6 h-2.6" stroke="${INK}" stroke-width="0.6"/>
    <circle cx="${-L - 2.6}" cy="-7" r="1.8" fill="#fdf6e3" stroke="${INK}" stroke-width="0.6"/>
    <rect x="${-L - 3.3}" y="-7.75" width="1.35" height="1.5" rx="0.2" fill="#e8a33d" stroke="${INK}" stroke-width="0.45"/>
    <ellipse cx="${-L - 2.6}" cy="-7.8" rx="0.8" ry="0.36" fill="#fffdf5" stroke="${INK}" stroke-width="0.3"/>
  </symbol>`;
}

// ============ CIVIC ============

// s0 — traditional tower church (St. Hedwig-adjacent language, strongest civic)
function churchS0() {
  const w = 16, h = 13, d = 15, L = w / 2;
  const [ox, oy] = dxy(d);
  const arch = (x, wd, ht) => `<path d="M${x} -4.6 L${x} ${-4.6 - ht} A${wd / 2} ${wd * 0.6} 0 0 1 ${x + wd} ${-4.6 - ht} L${x + wd} -4.6 Z" fill="#a9c8e8" stroke="${INK}" stroke-width="0.55"/>`;
  return `
  <symbol id="bldg.civ.church.s0" overflow="visible">
    <!-- nave roof plane -->
    <path d="${P([[0, -h - 5], [L + 1.2, -h], [L + 1.2 + ox, -h + oy], [ox, -h - 5 + oy]])}" fill="var(--roof,#6e5a4a)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <!-- nave -->
    <rect x="${-L}" y="${-h}" width="${w}" height="${h}" fill="var(--body,#c9654a)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L - 1.2, -h], [0, -h - 5], [L + 1.2, -h]])}" fill="var(--roof,#6e5a4a)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <!-- cream quoin strips -->
    <rect x="${-L}" y="${-h}" width="1.1" height="${h}" fill="#eddfc0" stroke="${INK}" stroke-width="0.45"/>
    <rect x="${L - 1.1}" y="${-h}" width="1.1" height="${h}" fill="#eddfc0" stroke="${INK}" stroke-width="0.45"/>
    ${arch(-6.3, 3, 4.6)}${arch(3.3, 3, 4.6)}
    <path d="M${-L} -3.4 h${w}" stroke="#a04f38" stroke-width="0.45" opacity="0.7"/>
    <!-- twin pinnacles at the nave shoulders -->
    <rect x="${-L - 0.4}" y="${-h - 2.6}" width="1.6" height="2.6" fill="#eddfc0" stroke="${INK}" stroke-width="0.55"/>
    <path d="${P([[-L - 0.7, -h - 2.6], [-L + 0.4, -h - 5.2], [-L + 1.5, -h - 2.6]])}" fill="#5a8f7c" stroke="${INK}" stroke-width="0.55"/>
    <rect x="${L - 1.2}" y="${-h - 2.6}" width="1.6" height="2.6" fill="#eddfc0" stroke="${INK}" stroke-width="0.55"/>
    <path d="${P([[L - 1.5, -h - 2.6], [L - 0.4, -h - 5.2], [L + 0.7, -h - 2.6]])}" fill="#5a8f7c" stroke="${INK}" stroke-width="0.55"/>
    <!-- central tower -->
    <rect x="-3.3" y="-27" width="6.6" height="27" fill="var(--body,#c9654a)" stroke="${INK}" stroke-width="${LINE}"/>
    <rect x="-3.3" y="-27" width="0.9" height="27" fill="#eddfc0" stroke="${INK}" stroke-width="0.4"/>
    <rect x="2.4" y="-27" width="0.9" height="27" fill="#eddfc0" stroke="${INK}" stroke-width="0.4"/>
    <!-- rose window -->
    <circle cx="0" cy="-21.5" r="2.1" fill="#a9c8e8" stroke="${INK}" stroke-width="0.6"/>
    <circle cx="0" cy="-21.5" r="0.75" fill="#eddfc0" stroke="${INK}" stroke-width="0.35"/>
    <path d="M0 -23.6 V-19.4 M-2.1 -21.5 H2.1 M-1.5 -23 L1.5 -20 M-1.5 -20 L1.5 -23" stroke="${INK}" stroke-width="0.3" opacity="0.75"/>
    <!-- belfry -->
    <rect x="-2.7" y="-31.8" width="5.4" height="4.8" fill="#eddfc0" stroke="${INK}" stroke-width="0.85"/>
    <rect x="-1.7" y="-31" width="1.4" height="3.1" rx="0.7" fill="#5b4632" stroke="${INK}" stroke-width="0.45"/>
    <rect x="0.3" y="-31" width="1.4" height="3.1" rx="0.7" fill="#5b4632" stroke="${INK}" stroke-width="0.45"/>
    <!-- copper spire, two faces + cross -->
    <path d="${P([[-3.5, -31.8], [0, -47], [0, -31.8]])}" fill="#5a8f7c" stroke="${INK}" stroke-width="0.85"/>
    <path d="${P([[0, -31.8], [0, -47], [3.5, -31.8]])}" fill="#6fa78f" stroke="${INK}" stroke-width="0.85"/>
    <path d="M0 -47 V-50 M-1.2 -48.9 H1.2" stroke="${INK}" stroke-width="0.65"/>
    <!-- triple arched entry -->
    <path d="M-3.4 0 L-3.4 -3.4 A1.15 1.3 0 0 1 -1.1 -3.4 L-1.1 0 Z" fill="#5b4632" stroke="${INK}" stroke-width="0.55"/>
    <path d="M-1.15 0 L-1.15 -4 A1.2 1.4 0 0 1 1.25 -4 L1.25 0 Z" fill="#4a3a2c" stroke="${INK}" stroke-width="0.6"/>
    <path d="M1.2 0 L1.2 -3.4 A1.15 1.3 0 0 1 3.5 -3.4 L3.5 0 Z" fill="#5b4632" stroke="${INK}" stroke-width="0.55"/>
    <rect x="-4" y="-0.7" width="8" height="1" fill="#cfc4ad" stroke="${INK}" stroke-width="0.5"/>
  </symbol>`;
}

// s1 — twin-tower parish church: wider facade, visibly different skyline.
function churchS1() {
  const w = 18, h = 12, L = w / 2;
  const [ox, oy] = dxy(13);
  const tower = (tx) => `
    <rect x="${tx - 2.4}" y="-21" width="4.8" height="21" fill="var(--body,#cdae8a)" stroke="${INK}" stroke-width="${LINE}"/>
    <rect x="${tx - 2.4}" y="-21" width="0.8" height="21" fill="#eddfc0" stroke="${INK}" stroke-width="0.4"/>
    <path d="M${tx - 1.3} -16.5 L${tx - 1.3} -19 A1.3 1.4 0 0 1 ${tx + 1.3} -19 L${tx + 1.3} -16.5 Z" fill="#a9c8e8" stroke="${INK}" stroke-width="0.5"/>
    <rect x="${tx - 2}" y="-23.6" width="4" height="2.6" fill="#eddfc0" stroke="${INK}" stroke-width="0.7"/>
    <path d="${P([[tx - 2.6, -23.6], [tx, -28.4], [tx + 2.6, -23.6]])}" fill="#5a8f7c" stroke="${INK}" stroke-width="0.75"/>
    <path d="M${tx} -28.4 V-30.2 M${tx - 0.9} -29.6 H${tx + 0.9}" stroke="${INK}" stroke-width="0.5"/>`;
  return `
  <symbol id="bldg.civ.church.s1" overflow="visible">
    <path d="${P([[0, -h - 4], [L + 1, -h], [L + 1 + ox, -h + oy], [ox, -h - 4 + oy]])}" fill="var(--roof,#6e5a4a)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L}" y="${-h}" width="${w}" height="${h}" fill="var(--body,#cdae8a)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L - 1, -h], [0, -h - 4], [L + 1, -h]])}" fill="var(--roof,#6e5a4a)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <circle cx="0" cy="-8.6" r="1.9" fill="#a9c8e8" stroke="${INK}" stroke-width="0.55"/>
    <path d="M0 -10.5 V-6.7 M-1.9 -8.6 H1.9" stroke="${INK}" stroke-width="0.3" opacity="0.75"/>
    ${tower(-L + 2.4)}${tower(L - 2.4)}
    <path d="M-1.7 0 L-1.7 -3.8 A1.7 1.9 0 0 1 1.7 -3.8 L1.7 0 Z" fill="#5b4632" stroke="${INK}" stroke-width="0.6"/>
    <rect x="-2.6" y="-0.7" width="5.2" height="1" fill="#cfc4ad" stroke="${INK}" stroke-width="0.5"/>
  </symbol>`;
}

// s2 — smaller neighborhood church: modest steeple, quiet presence.
function churchS2() {
  const w = 10, h = 8, L = w / 2;
  const [ox, oy] = dxy(9);
  return `
  <symbol id="bldg.civ.church.s2" overflow="visible">
    <path d="${P([[0, -h - 3.4], [L + 0.9, -h], [L + 0.9 + ox, -h + oy], [ox, -h - 3.4 + oy]])}" fill="var(--roof,#7d6b5a)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L}" y="${-h}" width="${w}" height="${h}" fill="var(--body,#e8e0cf)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L - 0.9, -h], [0, -h - 3.4], [L + 0.9, -h]])}" fill="var(--roof,#7d6b5a)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="-1.4" y="-14.6" width="2.8" height="4" fill="var(--body,#e8e0cf)" stroke="${INK}" stroke-width="0.7"/>
    <path d="${P([[-1.9, -14.6], [0, -18.6], [1.9, -14.6]])}" fill="#5a8f7c" stroke="${INK}" stroke-width="0.65"/>
    <path d="M0 -18.6 V-20.2 M-0.8 -19.7 H0.8" stroke="${INK}" stroke-width="0.5"/>
    <circle cx="0" cy="-6.4" r="1.15" fill="#a9c8e8" stroke="${INK}" stroke-width="0.5"/>
    <path d="M-2.2 -3.8 h1.6 v3.8 h-1.6 Z M0.6 -3.8 h1.6 v3.8 h-1.6 Z" fill="#a9c8e8" stroke="${INK}" stroke-width="0.45"/>
    <path d="M-1.5 0 L-1.5 -3 A1.5 1.7 0 0 1 1.5 -3 L1.5 0 Z" fill="#5b4632" stroke="${INK}" stroke-width="0.55"/>
  </symbol>`;
}

// s0 — neighborhood brick school: broad institutional frontage, flag.
function schoolS0() {
  const w = 16, h = 8.5, d = 12, L = w / 2;
  const [ox, oy] = dxy(d);
  const wins = [-6.4, -3.4, 0.6, 3.6].map((x) => win(x, -7.2, 2.4, 2.8, 0.5)).join('');
  return `
  <symbol id="bldg.civ.school.s0" overflow="visible">
    <path d="${P([[L, 0], [L, -h], [L + ox, -h + oy], [L + ox, oy]])}" fill="var(--side,#b08968)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L, -h], [L, -h], [L + ox, -h + oy], [-L + ox, -h + oy]])}" fill="var(--rooftop,#8d8577)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L}" y="${-h}" width="${w}" height="${h}" fill="var(--body,#d9a06b)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L - 0.6}" y="${-h - 0.9}" width="${w + 1.2}" height="1.5" rx="0.35" fill="var(--trim,#8a5a44)" stroke="${INK}" stroke-width="0.8"/>
    ${wins}
    <rect x="${L - 3.9}" y="-5.4" width="3.2" height="5.4" rx="0.35" fill="var(--body,#d9a06b)" stroke="${INK}" stroke-width="0.7"/>
    <rect x="${L - 3.3}" y="-4.2" width="2" height="4.2" rx="0.3" fill="#5b4632" stroke="${INK}" stroke-width="0.55"/>
    <path d="M${-L + 1.2} ${-h} V${-h - 4.4}" stroke="${INK}" stroke-width="0.55"/>
    <path d="M${-L + 1.2} ${-h - 4.4} h3 l-0.7 1 l0.7 1 h-3 Z" fill="#e05252" stroke="${INK}" stroke-width="0.45"/>
  </symbol>`;
}

// s1 — older multi-story school: taller mass, vertical bays, historic cornice.
function schoolS1() {
  const w = 17, h = 14, d = 13, L = w / 2;
  const [ox, oy] = dxy(d);
  const wins = [];
  for (let r = 0; r < 3; r++) for (const x of [-6.9, -4, 1.6, 4.5])
    wins.push(win(x, -12.6 + r * 3.9, 2.4, 2.9, 0.5));
  return `
  <symbol id="bldg.civ.school.s1" overflow="visible">
    <path d="${P([[L, 0], [L, -h], [L + ox, -h + oy], [L + ox, oy]])}" fill="var(--side,#9a6a4e)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L, -h], [L, -h], [L + ox, -h + oy], [-L + ox, -h + oy]])}" fill="var(--rooftop,#8d8577)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L}" y="${-h}" width="${w}" height="${h}" fill="var(--body,#c98a5e)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L - 0.7}" y="${-h - 1.1}" width="${w + 1.4}" height="1.8" rx="0.4" fill="var(--trim,#8a5a44)" stroke="${INK}" stroke-width="0.85"/>
    <!-- center entry bay rises above the cornice -->
    <rect x="-1.9" y="${-h - 2.3}" width="3.8" height="${h + 2.3}" fill="var(--bay,#b3754a)" stroke="${INK}" stroke-width="0.8"/>
    <path d="${P([[-2.5, -h - 2.3], [0, -h - 3.9], [2.5, -h - 2.3]])}" fill="var(--trim,#8a5a44)" stroke="${INK}" stroke-width="0.7"/>
    ${wins.join('')}
    ${win(-1.2, -12.4, 2.4, 2.6, 0.5)}${win(-1.2, -8.5, 2.4, 2.6, 0.5)}
    <path d="M-1.6 0 L-1.6 -3.7 A1.6 1.8 0 0 1 1.6 -3.7 L1.6 0 Z" fill="#4a3a2c" stroke="${INK}" stroke-width="0.6"/>
    <rect x="-2.8" y="-0.75" width="5.6" height="1.05" fill="#cfc4ad" stroke="${INK}" stroke-width="0.5"/>
    <path d="M0 ${-h - 3.9} V${-h - 7.3}" stroke="${INK}" stroke-width="0.5"/>
    <path d="M0 ${-h - 7.3} h2.7 l-0.6 0.9 l0.6 0.9 h-2.7 Z" fill="#e05252" stroke="${INK}" stroke-width="0.4"/>
  </symbol>`;
}

// ============ TREES v2 — silhouette + texture + color per species ============

// Linden: DENSE, rounded, full formal crown — deep rich green, tight scallops.
function treeLinden() {
  return `
  <symbol id="tree.linden" overflow="visible">
    <path d="M-0.8 0 L-0.55 -2.4 H0.55 L0.8 0 Z" fill="#7a5236" stroke="${INK}" stroke-width="0.6"/>
    <path d="M0 -12.2
      a2.5 2.5 0 0 1 2.5 1.4 a2.4 2.4 0 0 1 2 2.6 a2.3 2.3 0 0 1 0.2 3.2 a2.4 2.4 0 0 1 -2.2 2.6
      a2.6 2.6 0 0 1 -2.5 1.2 a2.6 2.6 0 0 1 -2.5 -1.2 a2.4 2.4 0 0 1 -2.2 -2.6 a2.3 2.3 0 0 1 0.2 -3.2
      a2.4 2.4 0 0 1 2 -2.6 a2.5 2.5 0 0 1 2.5 -1.4 Z"
      fill="#3f8f45" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M-2.9 -9.9 a2 2 0 0 1 2.5 -1.3 a2 2 0 0 1 2.4 0.5" fill="none" stroke="#67b45e" stroke-width="1.1" stroke-linecap="round"/>
    <path d="M-3.3 -6.3 a1.8 1.8 0 0 1 2.1 -0.6 M1 -5.4 a1.8 1.8 0 0 1 2.2 -0.4" fill="none" stroke="#2f6e38" stroke-width="0.7" opacity="0.8"/>
    <circle cx="-1.7" cy="-10.4" r="0.55" fill="#8fd07e"/>
  </symbol>`;
}

// Honeylocust: AIRY — small separated leaflet tufts on visible forking branches,
// yellow-green, lots of sky through the crown.
function treeHoneylocust() {
  const tuft = (x, y, r, tone) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${tone}" stroke="${INK}" stroke-width="0.7"/>`;
  return `
  <symbol id="tree.honeylocust" overflow="visible">
    <path d="M-0.6 0 L-0.4 -4.4 H0.4 L0.6 0 Z" fill="#8a6248" stroke="${INK}" stroke-width="0.6"/>
    <path d="M0 -3.6 C-1.8 -5.4 -3.6 -6.4 -5 -8.6 M0 -4.2 C0.2 -7 0.6 -8.8 0.3 -11.6 M0 -4 C1.8 -5.8 3.6 -6.4 5 -8.4 M0.4 -8.2 C1.7 -9.2 2.6 -9.9 3.6 -11.2 M-0.5 -8 C-1.7 -9 -2.6 -9.6 -3.4 -11" fill="none" stroke="#8a6248" stroke-width="0.55"/>
    ${tuft(-5.4, -9.4, 1.2, '#b8cf6e')}${tuft(-2.9, -7, 0.9, '#a5c95e')}
    ${tuft(0.2, -12.4, 1.3, '#b8cf6e')}${tuft(-1.6, -10.6, 0.85, '#cadf8a')}
    ${tuft(5.3, -9.1, 1.15, '#a5c95e')}${tuft(3.9, -12, 1, '#cadf8a')}
    ${tuft(2.1, -9.4, 0.75, '#b8cf6e')}
    <circle cx="-3.9" cy="-11.6" r="0.55" fill="#cadf8a" stroke="${INK}" stroke-width="0.55"/>
    <circle cx="-5.8" cy="-10" r="0.42" fill="#e2edad"/>
    <circle cx="-0.1" cy="-13.1" r="0.45" fill="#e2edad"/>
    <circle cx="2.9" cy="-7.4" r="0.4" fill="#e2edad"/>
  </symbol>`;
}

// Elm: TALL VASE — long arching limbs, crown held HIGH, narrow waist, wide top.
function treeElm() {
  return `
  <symbol id="tree.elm" overflow="visible">
    <path d="M-1.1 0 H1.1 L0.75 -3 H-0.75 Z" fill="#7a5236" stroke="${INK}" stroke-width="0.65"/>
    <path d="M-0.6 -2.8 C-2.2 -5.4 -5 -7.6 -6.2 -11 M0.6 -2.8 C2.2 -5.4 5 -7.6 6.2 -11 M0 -3 C0.1 -6 0.2 -8.4 0 -11.5 M-0.4 -6.5 C-2 -8.2 -3.4 -9.2 -4 -11.6 M0.4 -6.5 C2 -8.2 3.4 -9.2 4 -11.6" fill="none" stroke="#7a5236" stroke-width="0.85"/>
    <path d="M0 -19.4
      C3.4 -19.5 6.9 -18.4 8.1 -16.2 C9.2 -14.2 8.4 -12 6.3 -11.4
      C5.2 -10.2 3.2 -9.9 2 -10.7 C1.2 -10.3 -1.2 -10.3 -2 -10.7
      C-3.2 -9.9 -5.2 -10.2 -6.3 -11.4 C-8.4 -12 -9.2 -14.2 -8.1 -16.2 C-6.9 -18.4 -3.4 -19.5 0 -19.4 Z"
      fill="#55984f" stroke="${INK}" stroke-width="1.25" stroke-linejoin="round"/>
    <path d="M-5.6 -16.6 C-3.8 -18.3 0.8 -18.6 3 -17.3 C1 -17.5 -1.5 -17.2 -3.1 -16.4 Z" fill="#82bd74"/>
    <path d="M-2.6 -12.6 a2.4 2.4 0 0 1 2.9 -0.5 M2.6 -14.2 a2.2 2.2 0 0 1 2.5 0" fill="none" stroke="#3d7440" stroke-width="0.7" opacity="0.8"/>
  </symbol>`;
}

// Oak: BROADEST + heaviest — wide irregular crown, gnarled limbs, dark green.
function treeOak() {
  return `
  <symbol id="tree.oak" overflow="visible">
    <path d="M-1.5 0 L-1.05 -3 H1.05 L1.5 0 Z" fill="#6b4a30" stroke="${INK}" stroke-width="0.7"/>
    <path d="M-0.5 -2.8 C-2.6 -3.8 -4.6 -4 -6.6 -5.6 M0.5 -2.8 C2.4 -3.9 4.2 -3.9 6.2 -5.2" fill="none" stroke="#6b4a30" stroke-width="0.9"/>
    <path d="M-1.2 -12.1
      C0.3 -13.7 3.2 -13.4 4.2 -11.9 C6.6 -12.4 8.9 -10.6 8.3 -8.8 C10 -7.6 9.4 -5 7.2 -4.6
      C6.7 -3.2 4.3 -2.7 3 -3.5 C1.7 -2.5 -1.3 -2.5 -2.5 -3.5 C-4.7 -2.8 -7.1 -3.6 -7.4 -5.4
      C-9.4 -6 -9.7 -8.6 -8.1 -9.7 C-8 -11.7 -5.6 -13 -3.8 -12 C-3.1 -12.8 -2 -12.9 -1.2 -12.1 Z"
      fill="#3a713a" stroke="${INK}" stroke-width="1.35" stroke-linejoin="round"/>
    <path d="M-6.2 -9.9 C-4.7 -11.3 -1.5 -11.9 0.5 -11.2 C-1.3 -11.2 -3.5 -10.7 -4.7 -10 Z" fill="#699e5c"/>
    <path d="M-5.5 -6 a2.2 2.2 0 0 1 2.6 -0.7 M1.8 -5 a2.2 2.2 0 0 1 2.8 -0.3 M3.6 -9.9 a2 2 0 0 1 2.3 0.2 M-2.4 -8.2 a2 2 0 0 1 2.3 -0.4" fill="none" stroke="#2c5a2e" stroke-width="0.75" opacity="0.85"/>
  </symbol>`;
}

// Maple: rounded but BRIGHT + energetic — vivid green, pointed leafy bumps.
function treeMaple() {
  return `
  <symbol id="tree.maple" overflow="visible">
    <path d="M-0.8 0 L-0.55 -2.8 H0.55 L0.8 0 Z" fill="#7a5236" stroke="${INK}" stroke-width="0.6"/>
    <path d="M0 -12.8
      L1.7 -12.2 L2.9 -11.6 L3.4 -10.3 L4.7 -9.4 L4.6 -7.9 L5.2 -6.5 L4.1 -5.4 L3.7 -4.1 L2.2 -3.8
      L1.1 -3.1 L0 -3.4 L-1.1 -3.1 L-2.2 -3.8 L-3.7 -4.1 L-4.1 -5.4 L-5.2 -6.5 L-4.6 -7.9 L-4.7 -9.4
      L-3.4 -10.3 L-2.9 -11.6 L-1.7 -12.2 Z"
      fill="#6ec24a" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M-3.2 -10.2 C-1.9 -11.5 1 -11.8 2.6 -10.8 C1.1 -11 -0.8 -10.8 -1.9 -10.2 Z" fill="#9ade72"/>
    <path d="M-3.4 -6.4 L-2.2 -7.2 L-1 -6.5 M1.2 -5.2 L2.3 -6 L3.4 -5.3" fill="none" stroke="#4c9433" stroke-width="0.7" opacity="0.8"/>
  </symbol>`;
}

// Ash: slim upright oval, pointed tip, vertical streaks — quieter green.
function treeAsh() {
  return `
  <symbol id="tree.ash" overflow="visible">
    <path d="M-0.7 0 L-0.5 -2.8 H0.5 L0.7 0 Z" fill="#7a5236" stroke="${INK}" stroke-width="0.6"/>
    <path d="M0 -13.4 C1.9 -12.1 3.2 -9.8 3.2 -7.3 C3.2 -4.8 2 -3 0 -2.8 C-2 -3 -3.2 -4.8 -3.2 -7.3 C-3.2 -9.8 -1.9 -12.1 0 -13.4 Z"
      fill="#5ea45e" stroke="${INK}" stroke-width="1.15" stroke-linejoin="round"/>
    <path d="M-1 -10.8 C-1.2 -8.6 -1.2 -6.4 -0.9 -4.4 M1 -10.4 C1.2 -8.4 1.2 -6.6 1 -4.8" fill="none" stroke="#417c44" stroke-width="0.6" opacity="0.8"/>
    <path d="M-1.6 -11 C-0.9 -12 0.5 -12.4 1.3 -11.7 C0.5 -11.8 -0.6 -11.5 -1.6 -11 Z" fill="#89c682"/>
  </symbol>`;
}

// Flowering class: clearly SMALLER, strong pink identity, blossom clusters.
function treeFlowering() {
  const puff = (x, y, r, tone) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${tone}" stroke="${INK}" stroke-width="0.8"/>`;
  return `
  <symbol id="tree.flowering.s0" overflow="visible">
    <path d="M-0.55 0 L-0.4 -2.2 H0.4 L0.55 0 Z" fill="#6b4530" stroke="${INK}" stroke-width="0.5"/>
    <path d="M0 -2 C-0.8 -2.8 -1.6 -3 -2.2 -3.8 M0 -2.2 C0.8 -2.9 1.5 -3.1 2.1 -3.9" fill="none" stroke="#6b4530" stroke-width="0.5"/>
    ${puff(-2.2, -4.6, 1.7, '#f2a8c8')}${puff(2.1, -4.7, 1.6, '#ef9cc0')}${puff(0, -6.3, 1.8, '#f2a8c8')}
    <circle cx="-0.7" cy="-7" r="0.6" fill="#fde3f0"/>
    <circle cx="-2.8" cy="-5.2" r="0.5" fill="#fde3f0"/>
    <circle cx="1.6" cy="-3.9" r="0.45" fill="#fde3f0"/>
    <circle cx="2.6" cy="-5.4" r="0.4" fill="#fde3f0"/>
    <circle cx="0.9" cy="-6.9" r="0.35" fill="#ffffff"/>
  </symbol>`;
}

// ============ ambient + ground (unchanged geometry, minor line bump) ============

// Parked cars — s0 sedan, s1 hatchback/small SUV, s2 pickup. Side view,
// punctuation not traffic simulation.
const carWheels = `
    <circle cx="-1.4" cy="-0.35" r="0.55" fill="#3a332b" stroke="${INK}" stroke-width="0.3"/>
    <circle cx="1.4" cy="-0.35" r="0.55" fill="#3a332b" stroke="${INK}" stroke-width="0.3"/>
    <circle cx="-1.4" cy="-0.35" r="0.22" fill="#cfc4ad"/>
    <circle cx="1.4" cy="-0.35" r="0.22" fill="#cfc4ad"/>`;
function carS0() {
  return `
  <symbol id="vehicle.parked_car.s0" overflow="visible">
    <path d="M-2.4 -1.1 C-2.4 -2.2 -1.6 -2.9 -0.7 -2.9 L0.9 -2.9 C1.7 -2.9 2.1 -2.3 2.4 -1.6 L2.4 -0.4 L-2.4 -0.4 Z" fill="var(--body,#e05252)" stroke="${INK}" stroke-width="0.6" stroke-linejoin="round"/>
    <path d="M-1.5 -1.7 L-1.2 -2.5 L0.7 -2.5 L1.1 -1.7 Z" fill="#bfe4ea" stroke="${INK}" stroke-width="0.4"/>
    ${carWheels}
  </symbol>`;
}
function carS1() {
  return `
  <symbol id="vehicle.parked_car.s1" overflow="visible">
    <path d="M-2.3 -1 C-2.3 -2.7 -1.9 -3.1 -1 -3.1 L1.5 -3.1 C2.1 -3.1 2.4 -2.5 2.4 -1.6 L2.4 -0.4 L-2.3 -0.4 Z" fill="var(--body,#4f8fd9)" stroke="${INK}" stroke-width="0.6" stroke-linejoin="round"/>
    <path d="M-1.7 -1.9 L-1.6 -2.7 L0.4 -2.7 L0.7 -1.9 Z" fill="#bfe4ea" stroke="${INK}" stroke-width="0.4"/>
    <path d="M1 -2.7 L1.5 -2.7 L1.7 -1.9 L1.1 -1.9 Z" fill="#bfe4ea" stroke="${INK}" stroke-width="0.35"/>
    ${carWheels}
  </symbol>`;
}
function carS2() {
  return `
  <symbol id="vehicle.parked_car.s2" overflow="visible">
    <path d="M-2.6 -1 L-2.6 -1.9 L-0.3 -1.9 L-0.3 -2.9 L1.3 -2.9 C1.9 -2.9 2.3 -2.4 2.5 -1.7 L2.5 -0.4 L-2.6 -0.4 Z" fill="var(--body,#6fbf73)" stroke="${INK}" stroke-width="0.6" stroke-linejoin="round"/>
    <path d="M0.1 -1.95 L0.2 -2.55 L1.2 -2.55 L1.5 -1.95 Z" fill="#bfe4ea" stroke="${INK}" stroke-width="0.35"/>
    <path d="M-2.6 -1.9 L-0.3 -1.9" stroke="${INK}" stroke-width="0.35"/>
    ${carWheels}
  </symbol>`;
}

// ============ FURNITURE — lowest-intensity standing objects ============
// Rewards inspection, never demands attention. Simple silhouettes, no noise.

function hydrant() {
  return `
  <symbol id="furniture.hydrant" overflow="visible">
    <rect x="-0.55" y="-1.5" width="1.1" height="1.5" rx="0.28" fill="#c62d2d" stroke="${INK}" stroke-width="0.35"/>
    <path d="M-0.55 -1.55 A0.55 0.55 0 0 1 0.55 -1.55 Z" fill="#c62d2d" stroke="${INK}" stroke-width="0.35"/>
    <rect x="-0.95" y="-1.15" width="0.42" height="0.45" rx="0.12" fill="#c62d2d" stroke="${INK}" stroke-width="0.25"/>
    <rect x="0.53" y="-1.15" width="0.42" height="0.45" rx="0.12" fill="#c62d2d" stroke="${INK}" stroke-width="0.25"/>
    <circle cx="0" cy="-1.95" r="0.24" fill="#e2a0a0" stroke="${INK}" stroke-width="0.2"/>
  </symbol>`;
}

function bench() {
  return `
  <symbol id="furniture.bench" overflow="visible">
    <rect x="-1.4" y="-1.4" width="2.8" height="0.45" rx="0.15" fill="#a97c50" stroke="${INK}" stroke-width="0.3"/>
    <rect x="-1.4" y="-0.75" width="2.8" height="0.4" rx="0.15" fill="#b98c5c" stroke="${INK}" stroke-width="0.3"/>
    <path d="M-1.15 -0.35 V0.25 M1.15 -0.35 V0.25" stroke="${INK}" stroke-width="0.3"/>
  </symbol>`;
}

// bus stop: s0 sign pole; s1 simple shelter (used when OSM says shelter=yes)
function busStopS0() {
  return `
  <symbol id="furniture.bus_stop.s0" overflow="visible">
    <path d="M0 0 V-3.6" stroke="${INK}" stroke-width="0.4"/>
    <rect x="-0.95" y="-4.9" width="1.9" height="1.4" rx="0.25" fill="#3b5fc9" stroke="${INK}" stroke-width="0.35"/>
    <rect x="-0.62" y="-4.6" width="1.24" height="0.62" rx="0.18" fill="#fdf6e3"/>
    <circle cx="-0.35" cy="-4.05" r="0.14" fill="#fdf6e3"/>
    <circle cx="0.35" cy="-4.05" r="0.14" fill="#fdf6e3"/>
  </symbol>`;
}
function busStopS1() {
  return `
  <symbol id="furniture.bus_stop.s1" overflow="visible">
    <rect x="-2.5" y="-3.3" width="5" height="0.55" rx="0.2" fill="#5f7285" stroke="${INK}" stroke-width="0.35"/>
    <path d="M-2.1 -2.75 V0 M2.1 -2.75 V0" stroke="${INK}" stroke-width="0.35"/>
    <rect x="-2.2" y="-2.75" width="4.4" height="2.1" fill="#bfe4ea" opacity="0.55" stroke="${INK}" stroke-width="0.25"/>
    <rect x="-1.5" y="-1.15" width="3" height="0.4" rx="0.12" fill="#a97c50" stroke="${INK}" stroke-width="0.25"/>
    <path d="M3 0 V-3.4" stroke="${INK}" stroke-width="0.35"/>
    <rect x="2.25" y="-4.5" width="1.5" height="1.1" rx="0.2" fill="#3b5fc9" stroke="${INK}" stroke-width="0.3"/>
  </symbol>`;
}

function bikeRack() {
  return `
  <symbol id="furniture.bike_rack" overflow="visible">
    <path d="M-1.5 0 V-1 A0.55 0.55 0 0 1 -0.4 -1 V0 M-0.1 0 V-1 A0.55 0.55 0 0 1 1 -1 V0 M1.3 0 V-1 A0.55 0.55 0 0 1 2.4 -1 V0" fill="none" stroke="#5f6a74" stroke-width="0.38"/>
  </symbol>`;
}

function trashCan() {
  return `
  <symbol id="furniture.trash_can" overflow="visible">
    <path d="M-0.6 -1.5 L-0.5 0 H0.5 L0.6 -1.5 Z" fill="#5e7a52" stroke="${INK}" stroke-width="0.3"/>
    <rect x="-0.72" y="-1.75" width="1.44" height="0.35" rx="0.15" fill="#4a6142" stroke="${INK}" stroke-width="0.25"/>
  </symbol>`;
}

function flagpole() {
  return `
  <symbol id="furniture.flagpole" overflow="visible">
    <path d="M0 0 V-8.5" stroke="${INK}" stroke-width="0.4"/>
    <circle cx="0" cy="-8.7" r="0.22" fill="#f2c94c" stroke="${INK}" stroke-width="0.2"/>
    <path d="M0 -8.4 h2.6 v1.6 h-2.6 Z" fill="#e8e4da" stroke="${INK}" stroke-width="0.3"/>
    <rect x="0" y="-8.4" width="1.1" height="0.85" fill="#3b5fc9"/>
    <path d="M0 -7.25 h2.6 M1.1 -7.8 h1.5" stroke="#c62d2d" stroke-width="0.32"/>
  </symbol>`;
}

function dumpster() {
  return `
  <symbol id="infra.dumpster" overflow="visible">
    <path d="M-1.5 -1.6 L1.5 -1.6 L1.35 0 H-1.35 Z" fill="#3f6d5d" stroke="${INK}" stroke-width="0.4"/>
    <path d="M-1.6 -1.6 L-1.2 -2.05 H1.2 L1.6 -1.6 Z" fill="#35594d" stroke="${INK}" stroke-width="0.35"/>
    <path d="M-0.55 -0.8 h1.1" stroke="${INK}" stroke-width="0.3" opacity="0.6"/>
  </symbol>`;
}

function tennisCourt() {
  return `
  <symbol id="ground.tennis" overflow="visible">
    <rect x="-15" y="-8.5" width="30" height="17" rx="1.2" fill="#3e7a5e" stroke="#2e5c47" stroke-width="0.7"/>
    <rect x="-11.9" y="-5.5" width="23.8" height="11" fill="#5da270" stroke="#fdf6e3" stroke-width="0.55"/>
    <path d="M-11.9 -4.1 H11.9 M-11.9 4.1 H11.9 M-6 -4.1 V4.1 M6 -4.1 V4.1 M-6 0 H6" stroke="#fdf6e3" stroke-width="0.45" fill="none"/>
    <path d="M0 -5.9 V5.9" stroke="#3a332b" stroke-width="0.6"/>
    <path d="M0 -5.9 V5.9" stroke="#e8e4da" stroke-width="0.3" stroke-dasharray="0.6 0.5"/>
  </symbol>`;
}

// ---- playground kit pieces (tiny standing elements on a play surface) ----
const pgSurface = (rx, ry) => `<ellipse cx="0" cy="0" rx="${rx}" ry="${ry}" fill="#efd9a7" stroke="#d9bc82" stroke-width="0.7"/>`;
const pgSwings = (x) => `
  <g transform="translate(${x} 0)">
    <path d="M-2.6 1.5 L-1.3 -3 M0 1.5 L-1.3 -3 M-4 1.5 L-2.8 -3 M-2.8 -3 L-1.3 -3" stroke="#5f7285" stroke-width="0.55" fill="none"/>
    <path d="M-2.4 -3 V-0.6 M-1.7 -3 V-0.6" stroke="${INK}" stroke-width="0.3"/>
    <rect x="-2.65" y="-0.6" width="0.6" height="0.4" fill="#e07a2f" stroke="${INK}" stroke-width="0.2"/>
    <rect x="-1.95" y="-0.6" width="0.6" height="0.4" fill="#3f8ecc" stroke="${INK}" stroke-width="0.2"/>
  </g>`;
const pgSlide = (x) => `
  <g transform="translate(${x} 0)">
    <path d="M0 1.2 L0 -2.4 L3.3 0.2 L3.3 1.2" fill="#f2c04c" stroke="${INK}" stroke-width="0.4" stroke-linejoin="round"/>
    <rect x="-0.5" y="-3.2" width="1.1" height="1" fill="#e05252" stroke="${INK}" stroke-width="0.3"/>
  </g>`;
const pgClimber = (x) => `
  <g transform="translate(${x} 0)">
    <path d="M-2.2 0.8 A2.2 2.2 0 0 1 2.2 0.8" fill="none" stroke="#3f8ecc" stroke-width="0.5"/>
    <path d="M-1.5 -0.9 A1.7 1.9 0 0 1 1.5 -0.9 M-0.7 -1.4 A0.9 1 0 0 1 0.7 -1.4 M0 0.8 V-1.6 M-1.9 0.8 V-0.5 M1.9 0.8 V-0.5" fill="none" stroke="#3f8ecc" stroke-width="0.4"/>
  </g>`;
const pgSandbox = (x) => `
  <g transform="translate(${x} 0.4)">
    <rect x="-1.9" y="-1.4" width="3.8" height="2.4" rx="0.3" fill="#e8c987" stroke="#b3915a" stroke-width="0.45"/>
    <circle cx="0.5" cy="-0.2" r="0.4" fill="#e05252" stroke="${INK}" stroke-width="0.25"/>
  </g>`;
const pgSeesaw = (x) => `
  <g transform="translate(${x} 0)">
    <path d="M-2.4 -0.4 L2.4 -1.4" stroke="#e07a2f" stroke-width="0.5"/>
    <path d="M0 -0.9 L0 0.4" stroke="${INK}" stroke-width="0.4"/>
    <rect x="-2.8" y="-0.8" width="0.8" height="0.6" rx="0.15" fill="#3f8ecc" stroke="${INK}" stroke-width="0.2"/>
    <rect x="2" y="-1.8" width="0.8" height="0.6" rx="0.15" fill="#e05252" stroke="${INK}" stroke-width="0.2"/>
  </g>`;
const pgBench = (x) => `
  <g transform="translate(${x} 0.6)">
    <rect x="-1.3" y="-0.9" width="2.6" height="0.55" rx="0.15" fill="#8a6248" stroke="${INK}" stroke-width="0.3"/>
    <path d="M-1 -0.35 V0.3 M1 -0.35 V0.3" stroke="${INK}" stroke-width="0.25"/>
  </g>`;

// Playground compositions — three deterministic scene layouts, never one icon.
function playgroundS0() { // classic: swings + slide + sandbox
  return `<symbol id="ground.playground.s0" overflow="visible">${pgSurface(10, 6.5)}${pgSwings(-4.6)}${pgSlide(3.2)}${pgSandbox(-0.4)}</symbol>`;
}
function playgroundS1() { // climber-centered + slide + bench
  return `<symbol id="ground.playground.s1" overflow="visible">${pgSurface(9, 6)}${pgClimber(-2.8)}${pgSlide(2.4)}${pgBench(6.2)}</symbol>`;
}
function playgroundS2() { // swings + seesaw + sandbox (small)
  return `<symbol id="ground.playground.s2" overflow="visible">${pgSurface(8.5, 5.5)}${pgSwings(-3.6)}${pgSeesaw(2.6)}${pgSandbox(5.6)}</symbol>`;
}

// Basketball court — real geometry, simplified: rect + key paint + center + hoops.
function basketballCourt() {
  return `
  <symbol id="ground.basketball" overflow="visible">
    <rect x="-13" y="-7.5" width="26" height="15" rx="1" fill="#b0aa9c" stroke="#8f897c" stroke-width="0.7"/>
    <rect x="-12.2" y="-6.7" width="24.4" height="13.4" fill="none" stroke="#fdf6e3" stroke-width="0.5"/>
    <circle cx="0" cy="0" r="2.6" fill="none" stroke="#fdf6e3" stroke-width="0.5"/>
    <path d="M0 -6.7 V6.7" stroke="#fdf6e3" stroke-width="0.5"/>
    <path d="M-12.2 -2.6 h5 v5.2 h-5 Z M12.2 -2.6 h-5 v5.2 h5 Z" fill="#7d9e8a" stroke="#fdf6e3" stroke-width="0.5"/>
    <path d="M-12.6 -1.6 V1.6 M12.6 -1.6 V1.6" stroke="${INK}" stroke-width="0.7"/>
    <circle cx="-11.5" cy="0" r="0.55" fill="none" stroke="#e07a2f" stroke-width="0.45"/>
    <circle cx="11.5" cy="0" r="0.55" fill="none" stroke="#e07a2f" stroke-width="0.45"/>
  </symbol>`;
}

// Baseball diamond — the recognizable non-rectangular silhouette, compressed.
// Drawn with home plate at bottom (-y up); rotate to real orientation.
function baseballDiamond() {
  return `
  <symbol id="ground.baseball" overflow="visible">
    <!-- outfield grass wedge -->
    <path d="M0 8 L-15 -7 A19 19 0 0 1 15 -7 Z" fill="#8fc463" stroke="#79ab52" stroke-width="0.7" stroke-linejoin="round"/>
    <!-- infield skin -->
    <path d="M0 7 L-8.5 -1.5 L0 -10 L8.5 -1.5 Z" fill="#d9a869" stroke="#b3854e" stroke-width="0.7" stroke-linejoin="round"/>
    <!-- infield grass -->
    <path d="M0 4.6 L-6 -1.5 L0 -7.6 L6 -1.5 Z" fill="#a2d474" stroke="#84b95c" stroke-width="0.5"/>
    <!-- base paths -->
    <path d="M0 5.8 L-7.2 -1.5 L0 -8.8 L7.2 -1.5 Z" fill="none" stroke="#fdf6e3" stroke-width="0.65"/>
    <rect x="-0.65" y="5.15" width="1.3" height="1.3" fill="#fbfbf7" stroke="${INK}" stroke-width="0.3" transform="rotate(45 0 5.8)"/>
    <rect x="-7.85" y="-2.15" width="1.3" height="1.3" fill="#fbfbf7" stroke="${INK}" stroke-width="0.3" transform="rotate(45 -7.2 -1.5)"/>
    <rect x="-0.65" y="-9.45" width="1.3" height="1.3" fill="#fbfbf7" stroke="${INK}" stroke-width="0.3" transform="rotate(45 0 -8.8)"/>
    <rect x="6.55" y="-2.15" width="1.3" height="1.3" fill="#fbfbf7" stroke="${INK}" stroke-width="0.3" transform="rotate(45 7.2 -1.5)"/>
    <!-- mound -->
    <circle cx="0" cy="-1.5" r="1.05" fill="#d9a869" stroke="#b3854e" stroke-width="0.45"/>
    <!-- backstop behind home -->
    <path d="M-4.6 9.6 Q0 6.6 4.6 9.6" fill="none" stroke="#8a8f96" stroke-width="0.7"/>
    <path d="M-3.2 9 V7.6 M0 8.1 V6.8 M3.2 9 V7.6" stroke="#8a8f96" stroke-width="0.35"/>
  </symbol>`;
}

// Picnic table — mapped park furniture, top-down, tiny.
function picnicTable() {
  return `
  <symbol id="furniture.picnic_table" overflow="visible">
    <rect x="-1.5" y="-1" width="3" height="2" rx="0.25" fill="#a97c50" stroke="${INK}" stroke-width="0.4"/>
    <rect x="-1.5" y="-1.8" width="3" height="0.55" rx="0.2" fill="#8a6248" stroke="${INK}" stroke-width="0.3"/>
    <rect x="-1.5" y="1.25" width="3" height="0.55" rx="0.2" fill="#8a6248" stroke="${INK}" stroke-width="0.3"/>
  </symbol>`;
}

export function allSymbols() {
  return [
    polishFlatS0(), polishFlatS1(), polishFlatS2(), polishFlatS3(),
    bungalowS0(), bungalowS1(), bungalowS2(),
    apartmentS0(), apartmentS1(), apartmentS2(), apartmentS3(),
    garageS0(), garageS1(), shedS0(), shedS1(), rowhouseS0(),
    ...[0, 1, 2, 3, 4, 5].map(storefrontT),
    ...[0, 1, 2].map((t) => storefrontRowS(2, t)),
    ...[0, 1, 2].map((t) => storefrontRowS(3, t)),
    mixedUseS0(), mixedUseS1(), mixedUseS2(),
    cornerTavern(), churchS0(), churchS1(), churchS2(), schoolS0(), schoolS1(),
    treeLinden(), treeHoneylocust(), treeFlowering(), floweringS1(), treeMaple(), treeAsh(), treeElm(), treeOak(),
    coniferS0(), coniferS1(), coniferS2(),
    carS0(), carS1(), carS2(), tennisCourt(), basketballCourt(), baseballDiamond(),
    playgroundS0(), playgroundS1(), playgroundS2(), picnicTable(),
    hydrant(), bench(), busStopS0(), busStopS1(), bikeRack(), trashCan(), flagpole(), dumpster(),
  ].join('\n');
}

// structures per assetId (renderer appends .sN when > 1)
export const STRUCT_COUNT = {
  'bldg.res.polish_flat': 4,
  'bldg.res.bungalow': 3,
  'bldg.res.apartment': 4,
  'bldg.res.garage': 2,
  'bldg.res.shed': 2,
  'bldg.res.rowhouse': 1,
  'bldg.com.mixed_use': 3,
  'bldg.civ.church': 3,
  'bldg.civ.school': 2,
  'ground.playground': 3,
  'tree.flowering': 2,
  'tree.conifer': 3,
  'vehicle.parked_car': 3,
  'furniture.bus_stop': 2,
};
// commercial treatment counts (encoded in variant: variant = t*16 + palette)
export const TREATMENT_COUNT = {
  'bldg.com.storefront': 6,
  'bldg.com.storefront_row': 3,
};

export const ASSET_META = {
  'bldg.res.polish_flat': { halfW: 7, cls: 'standing' },
  'bldg.res.bungalow': { halfW: 7.5, cls: 'standing' },
  'bldg.res.apartment': { halfW: 9.5, cls: 'standing' },
  'bldg.res.garage': { halfW: 5, cls: 'standing' },
  'bldg.res.shed': { halfW: 3, cls: 'standing' },
  'bldg.res.rowhouse': { halfW: 10, cls: 'standing' },
  'tree.conifer': { halfW: 3.6, cls: 'tree' },
  'bldg.com.storefront': { halfW: 7, cls: 'standing' },
  'bldg.com.storefront_row': { halfW: 12.5, cls: 'standing' },
  'bldg.com.mixed_use': { halfW: 7.5, cls: 'standing' },
  'bldg.com.corner_tavern': { halfW: 8, cls: 'standing' },
  'bldg.civ.church': { halfW: 11, cls: 'standing', hero: true },
  'bldg.civ.school': { halfW: 10, cls: 'standing' },
  'tree.linden': { halfW: 5, cls: 'tree' },
  'tree.honeylocust': { halfW: 5.5, cls: 'tree' },
  'tree.flowering': { halfW: 3.2, cls: 'tree' },
  'tree.maple': { halfW: 5.4, cls: 'tree' },
  'tree.ash': { halfW: 3.6, cls: 'tree' },
  'tree.elm': { halfW: 8.5, cls: 'tree' },
  'tree.oak': { halfW: 9, cls: 'tree' },
  'vehicle.parked_car': { halfW: 2.6, cls: 'ambient' },
  'ground.tennis': { halfW: 15, cls: 'ground' },
  'ground.basketball': { halfW: 13, cls: 'ground' },
  'ground.baseball': { halfW: 16, cls: 'ground' },
  'ground.playground': { halfW: 10, cls: 'ground' },
  'furniture.picnic_table': { halfW: 2, cls: 'ground' },
  'furniture.hydrant': { halfW: 1, cls: 'furniture' },
  'furniture.bench': { halfW: 1.5, cls: 'furniture' },
  'furniture.bus_stop': { halfW: 2.5, cls: 'furniture' },
  'furniture.bike_rack': { halfW: 2, cls: 'furniture' },
  'furniture.trash_can': { halfW: 0.8, cls: 'furniture' },
  'furniture.flagpole': { halfW: 1.4, cls: 'furniture' },
  'infra.dumpster': { halfW: 1.7, cls: 'furniture' },
};
