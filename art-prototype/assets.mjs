// Style C asset library — stronger-oblique cartoon sprites, world meters.
// Every standing asset: anchor at ground center (0,0), grows in -y.
// Oblique convention: depth recedes up-and-right, offset = (+0.36d, -0.55d).
// Variants via CSS custom properties set on each <use> (--body, --roof, --trim).
// Ground assets are top-down and rotatable.

export const INK = '#33291f';
const LINE = 1.1; // base outline weight (world m) — thick, confident
const dxy = (d) => [0.36 * d, -0.55 * d]; // oblique depth offset

// ---------- palettes ----------
export const HOUSE_BODIES = ['#f6e7b8', '#bfe0c9', '#a9d3e8', '#f0b39a', '#f7d980', '#cdbde6', '#f6e7b8', '#e8c9a0'];
export const HOUSE_ROOFS = ['#d95d43', '#3f8f7a', '#8a6248', '#5f7285', '#c46a94', '#b3552f'];
export const SHOP_BODIES = ['#e0685a', '#5f9ea8', '#c99046', '#8f7fc0', '#5b8fc9', '#c9a53f'];
export const AWNINGS = ['#c93b3b', '#2f7d5d', '#3b5fc9', '#c9702f', '#7d4fc9'];
export const CAR_BODIES = ['#e05252', '#4f8fd9', '#f2c04c', '#6fbf73', '#e8e4da', '#8f7fc0'];

// helper: rect path string
const P = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ') + ' Z';

// ---------- residential ----------

// Milwaukee Polish flat: narrow, tall 2-story, flat-ish roof, bay window, stoop.
function polishFlat() {
  const w = 8.4, h = 11, d = 9;
  const [ox, oy] = dxy(d);
  const L = w / 2;
  return `
  <symbol id="bldg.res.polish_flat" overflow="visible">
    <!-- side wall (right, receding) -->
    <path d="${P([[L, 0], [L, -h], [L + ox, -h + oy], [L + ox, oy]])}" fill="var(--side,#d9c48e)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <!-- roof plane -->
    <path d="${P([[-L, -h], [L, -h], [L + ox, -h + oy], [-L + ox, -h + oy]])}" fill="var(--roof,#d95d43)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="M${-L + ox * 0.5} ${-h + oy * 0.5} L${L + ox * 0.5} ${-h + oy * 0.5}" stroke="var(--roofline,#00000022)" stroke-width="0.5" fill="none"/>
    <!-- facade -->
    <rect x="${-L}" y="${-h}" width="${w}" height="${h}" fill="var(--body,#f6e7b8)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <!-- cornice -->
    <rect x="${-L - 0.5}" y="${-h - 0.7}" width="${w + 1}" height="1.3" rx="0.3" fill="var(--roof,#d95d43)" stroke="${INK}" stroke-width="0.7"/>
    <!-- upper windows -->
    <rect x="${-L + 1.1}" y="-9.3" width="2.3" height="2.9" rx="0.3" fill="#fdf3c9" stroke="${INK}" stroke-width="0.55"/>
    <rect x="${L - 3.4}" y="-9.3" width="2.3" height="2.9" rx="0.3" fill="#fdf3c9" stroke="${INK}" stroke-width="0.55"/>
    <path d="M${-L + 1.1} -7.9 h2.3 M${L - 3.4} -7.9 h2.3" stroke="${INK}" stroke-width="0.35"/>
    <!-- bay window (ground floor left) -->
    <path d="${P([[-L + 0.4, 0], [-L + 0.4, -5.2], [-L + 1.3, -5.9], [-L + 3.7, -5.9], [-L + 4.6, -5.2], [-L + 4.6, 0]])}" fill="var(--body,#f6e7b8)" stroke="${INK}" stroke-width="0.7"/>
    <rect x="${-L + 1.5}" y="-5.1" width="2" height="3.4" rx="0.3" fill="#fdf3c9" stroke="${INK}" stroke-width="0.5"/>
    <!-- door + stoop (right) -->
    <rect x="${L - 3.3}" y="-4.6" width="2.3" height="4.6" rx="0.35" fill="var(--door,#7a4b32)" stroke="${INK}" stroke-width="0.6"/>
    <circle cx="${L - 1.5}" cy="-2.4" r="0.28" fill="#f2c94c"/>
    <rect x="${L - 3.8}" y="-0.6" width="3.3" height="0.9" fill="#cfc4ad" stroke="${INK}" stroke-width="0.45"/>
  </symbol>`;
}

// 1-story bungalow: wide, front gable + receding roof plane, full porch.
function bungalow() {
  const w = 10, h = 5.6, d = 10, gable = 4.2;
  const [ox, oy] = dxy(d);
  const L = w / 2;
  return `
  <symbol id="bldg.res.bungalow" overflow="visible">
    <!-- roof plane behind gable -->
    <path d="${P([[0, -h - gable], [L + 0.9, -h], [L + 0.9 + ox, -h + oy], [ox, -h - gable + oy]])}" fill="var(--roof,#3f8f7a)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <!-- body -->
    <rect x="${-L}" y="${-h}" width="${w}" height="${h}" fill="var(--body,#bfe0c9)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <!-- gable -->
    <path d="${P([[-L - 0.9, -h], [0, -h - gable], [L + 0.9, -h]])}" fill="var(--roof,#3f8f7a)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="-1.1" y="${-h - 2.4}" width="2.2" height="1.6" rx="0.3" fill="#fdf3c9" stroke="${INK}" stroke-width="0.45"/>
    <!-- porch roof + posts -->
    <rect x="${-L - 0.6}" y="-3.9" width="${w + 1.2}" height="0.95" rx="0.25" fill="var(--roof,#3f8f7a)" stroke="${INK}" stroke-width="0.6"/>
    <path d="M${-L + 0.7} -3 V0 M${L - 0.7} -3 V0" stroke="${INK}" stroke-width="0.65"/>
    <!-- windows + door -->
    <rect x="${-L + 1.4}" y="-3.1" width="2.5" height="2.4" rx="0.3" fill="#fdf3c9" stroke="${INK}" stroke-width="0.5"/>
    <rect x="${L - 3.9}" y="-3.1" width="2.5" height="2.4" rx="0.3" fill="#fdf3c9" stroke="${INK}" stroke-width="0.5"/>
    <rect x="-1.2" y="-3.4" width="2.4" height="3.4" rx="0.3" fill="var(--door,#7a4b32)" stroke="${INK}" stroke-width="0.55"/>
  </symbol>`;
}

// 3-story apartment block: flat roof plane, window grid, entry awning.
function apartment() {
  const w = 13, h = 12.5, d = 11;
  const [ox, oy] = dxy(d);
  const L = w / 2;
  const wins = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      wins.push(`<rect x="${-L + 1.2 + c * 3}" y="${-11.2 + r * 3.5}" width="2" height="2.4" rx="0.3" fill="#fdf3c9" stroke="${INK}" stroke-width="0.5"/>`);
    }
  }
  return `
  <symbol id="bldg.res.apartment" overflow="visible">
    <path d="${P([[L, 0], [L, -h], [L + ox, -h + oy], [L + ox, oy]])}" fill="var(--side,#c9a884)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L, -h], [L, -h], [L + ox, -h + oy], [-L + ox, -h + oy]])}" fill="var(--rooftop,#8d8577)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L}" y="${-h}" width="${w}" height="${h}" fill="var(--body,#e0b48f)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L - 0.5}" y="${-h - 0.8}" width="${w + 1}" height="1.4" rx="0.3" fill="var(--trim,#b3552f)" stroke="${INK}" stroke-width="0.7"/>
    ${wins.join('')}
    <rect x="-1.6" y="-4.2" width="3.2" height="4.2" rx="0.35" fill="var(--door,#6b4530)" stroke="${INK}" stroke-width="0.6"/>
    <path d="M-2.4 -4.4 L0 -5.6 L2.4 -4.4 Z" fill="var(--trim,#b3552f)" stroke="${INK}" stroke-width="0.55"/>
  </symbol>`;
}

// Detached alley garage.
function garage() {
  const w = 6.4, h = 3.4, d = 7;
  const [ox, oy] = dxy(d);
  const L = w / 2;
  return `
  <symbol id="bldg.res.garage" overflow="visible">
    <path d="${P([[0, -h - 1.7], [L + 0.5, -h], [L + 0.5 + ox, -h + oy], [ox, -h - 1.7 + oy]])}" fill="var(--roof,#8a6248)" stroke="${INK}" stroke-width="0.9" stroke-linejoin="round"/>
    <rect x="${-L}" y="${-h}" width="${w}" height="${h}" fill="var(--body,#e8ddc4)" stroke="${INK}" stroke-width="0.9" stroke-linejoin="round"/>
    <path d="${P([[-L - 0.5, -h], [0, -h - 1.7], [L + 0.5, -h]])}" fill="var(--roof,#8a6248)" stroke="${INK}" stroke-width="0.9" stroke-linejoin="round"/>
    <rect x="${-L + 0.9}" y="-2.7" width="${w - 1.8}" height="2.7" rx="0.3" fill="var(--door,#9a8265)" stroke="${INK}" stroke-width="0.55"/>
    <path d="M${-L + 0.9} -1.85 h${w - 1.8} M${-L + 0.9} -1 h${w - 1.8}" stroke="${INK}" stroke-width="0.3" opacity="0.5"/>
  </symbol>`;
}

// ---------- commercial ----------

// Mixed-use storefront: shop below (awning, glass), flat roof plane, sign band.
function storefront() {
  const w = 10.5, h = 9.5, d = 10;
  const [ox, oy] = dxy(d);
  const L = w / 2;
  const stripes = [0, 1, 2, 3, 4].map((i) =>
    `<rect x="${-L + 0.2 + (i * (w - 0.4)) / 5}" y="-5.4" width="${(w - 0.4) / 10}" height="2.1" fill="#fdf6e3"/>`).join('');
  return `
  <symbol id="bldg.com.storefront" overflow="visible">
    <path d="${P([[L, 0], [L, -h], [L + ox, -h + oy], [L + ox, oy]])}" fill="var(--side,#b0574b)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L, -h], [L, -h], [L + ox, -h + oy], [-L + ox, -h + oy]])}" fill="var(--rooftop,#8d8577)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L}" y="${-h}" width="${w}" height="${h}" fill="var(--body,#e0685a)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L - 0.5}" y="${-h - 0.8}" width="${w + 1}" height="1.4" rx="0.3" fill="var(--trim,#8a5a44)" stroke="${INK}" stroke-width="0.7"/>
    <!-- upstairs windows -->
    <rect x="${-L + 1.2}" y="-8.4" width="2.2" height="2.6" rx="0.3" fill="#fdf3c9" stroke="${INK}" stroke-width="0.5"/>
    <rect x="-1.1" y="-8.4" width="2.2" height="2.6" rx="0.3" fill="#fdf3c9" stroke="${INK}" stroke-width="0.5"/>
    <rect x="${L - 3.4}" y="-8.4" width="2.2" height="2.6" rx="0.3" fill="#fdf3c9" stroke="${INK}" stroke-width="0.5"/>
    <!-- sign band -->
    <rect x="${-L + 0.6}" y="-5.55" width="${w - 1.2}" height="1.5" rx="0.3" fill="var(--sign,#fdf6e3)" stroke="${INK}" stroke-width="0.5"/>
    <!-- awning -->
    <path d="${P([[-L - 0.7, -3.3], [L + 0.7, -3.3], [L + 0.2, -4.6], [-L + -0.2, -4.6]])}" fill="var(--awn,#c93b3b)" stroke="${INK}" stroke-width="0.7"/>
    ${stripes}
    <!-- glass + door -->
    <rect x="${-L + 0.8}" y="-3" width="${w - 4.6}" height="3" fill="#bfe4ea" stroke="${INK}" stroke-width="0.55"/>
    <path d="M${-L + 1.5} -0.4 L${-L + 3.2} -2.6" stroke="#ffffff" stroke-width="0.5" opacity="0.8"/>
    <rect x="${L - 3.2}" y="-3.2" width="2.4" height="3.2" rx="0.3" fill="var(--door,#5b4632)" stroke="${INK}" stroke-width="0.55"/>
  </symbol>`;
}

// Corner tavern: chamfered corner door, big warm windows, blade sign, roof plane.
function cornerTavern() {
  const w = 12, h = 10, d = 11;
  const [ox, oy] = dxy(d);
  const L = w / 2;
  return `
  <symbol id="bldg.com.corner_tavern" overflow="visible">
    <path d="${P([[L, 0], [L, -h], [L + ox, -h + oy], [L + ox, oy]])}" fill="var(--side,#6b4530)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L, -h], [L, -h], [L + ox, -h + oy], [-L + ox, -h + oy]])}" fill="var(--rooftop,#7d7466)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L, 0], [-L, -h], [L, -h], [L, -3.4], [L - 2.4, 0]])}" fill="var(--body,#8a5138)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L - 0.5}" y="${-h - 0.8}" width="${w + 1}" height="1.4" rx="0.3" fill="var(--trim,#59392e)" stroke="${INK}" stroke-width="0.7"/>
    <!-- name board -->
    <rect x="${-L + 0.9}" y="-9.2" width="${w - 1.8}" height="2.1" rx="0.4" fill="#2c2622" stroke="${INK}" stroke-width="0.55"/>
    <text x="0" y="-7.6" font-size="1.55" font-weight="700" text-anchor="middle" fill="#f2c94c" font-family="Georgia, serif" letter-spacing="0.14">
      <tspan>TAVERN</tspan>
    </text>
    <!-- warm windows -->
    <rect x="${-L + 1}" y="-6.2" width="3.4" height="3.4" rx="0.35" fill="#ffd977" stroke="${INK}" stroke-width="0.6"/>
    <rect x="${-L + 5.4}" y="-6.2" width="3.4" height="3.4" rx="0.35" fill="#ffd977" stroke="${INK}" stroke-width="0.6"/>
    <path d="M${-L + 1} -4.5 h3.4 M${-L + 5.4} -4.5 h3.4" stroke="${INK}" stroke-width="0.35"/>
    <!-- chamfer corner door -->
    <path d="${P([[L - 2.2, 0], [L - 0.4, -2.7], [L - 0.4, -5.6], [L - 3.4, -5.6], [L - 3.4, 0]])}" fill="var(--doorwall,#6b4530)" stroke="${INK}" stroke-width="0.7"/>
    <rect x="${L - 3}" y="-3.9" width="2.1" height="3.9" rx="0.3" fill="#4a3423" stroke="${INK}" stroke-width="0.55"/>
    <circle cx="${L - 2.45}" cy="-2" r="0.25" fill="#f2c94c"/>
    <!-- hanging mug blade sign -->
    <path d="M${-L} -8.6 h-2.6" stroke="${INK}" stroke-width="0.6"/>
    <circle cx="${-L - 2.6}" cy="-7" r="1.8" fill="#fdf6e3" stroke="${INK}" stroke-width="0.6"/>
    <rect x="${-L - 3.3}" y="-7.75" width="1.35" height="1.5" rx="0.2" fill="#e8a33d" stroke="${INK}" stroke-width="0.45"/>
    <ellipse cx="${-L - 2.6}" cy="-7.8" rx="0.8" ry="0.36" fill="#fffdf5" stroke="${INK}" stroke-width="0.3"/>
  </symbol>`;
}

// ---------- civic ----------

// Church (St. Hedwig-inspired hero): red brick, tall copper-spire tower.
function church() {
  const w = 15, h = 12, d = 14;
  const [ox, oy] = dxy(d);
  const L = w / 2;
  const arch = (x) => `<path d="M${x} -4.2 L${x} -8.4 A1.5 1.7 0 0 1 ${x + 3} -8.4 L${x + 3} -4.2 Z" fill="#a9c8e8" stroke="${INK}" stroke-width="0.55"/>`;
  return `
  <symbol id="bldg.civ.church" overflow="visible">
    <!-- nave roof plane -->
    <path d="${P([[0, -h - 4.5], [L + 1, -h], [L + 1 + ox, -h + oy], [ox, -h - 4.5 + oy]])}" fill="var(--roof,#6e5a4a)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <!-- nave body -->
    <rect x="${-L}" y="${-h}" width="${w}" height="${h}" fill="var(--body,#c9654a)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L - 1, -h], [0, -h - 4.5], [L + 1, -h]])}" fill="var(--roof,#6e5a4a)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    ${arch(-5.9)}${arch(3)}
    <path d="M${-L} -3.1 h${w}" stroke="#a04f38" stroke-width="0.4" opacity="0.7"/>
    <!-- central tower -->
    <rect x="-2.9" y="-24" width="5.8" height="24" fill="var(--body,#c9654a)" stroke="${INK}" stroke-width="${LINE}"/>
    <path d="M-2.9 -14.5 h5.8" stroke="#a04f38" stroke-width="0.4" opacity="0.7"/>
    <circle cx="0" cy="-19.5" r="1.6" fill="#a9c8e8" stroke="${INK}" stroke-width="0.55"/>
    <!-- belfry -->
    <rect x="-2.3" y="-28.2" width="4.6" height="4.2" fill="#eddfc0" stroke="${INK}" stroke-width="0.8"/>
    <rect x="-1" y="-27.5" width="2" height="2.7" rx="0.9" fill="#5b4632" stroke="${INK}" stroke-width="0.45"/>
    <!-- copper spire: two oblique faces -->
    <path d="${P([[-3.1, -28.2], [0, -41], [0, -28.2]])}" fill="#5a8f7c" stroke="${INK}" stroke-width="0.8"/>
    <path d="${P([[0, -28.2], [0, -41], [3.1, -28.2]])}" fill="#6fa78f" stroke="${INK}" stroke-width="0.8"/>
    <path d="M0 -41 V-43.4 M-1 -42.5 H1" stroke="${INK}" stroke-width="0.55"/>
    <!-- doors -->
    <path d="M-1.9 0 L-1.9 -3.6 A1.9 1.9 0 0 1 1.9 -3.6 L1.9 0 Z" fill="#5b4632" stroke="${INK}" stroke-width="0.6"/>
  </symbol>`;
}

// School: wide friendly civic block, flag, big doorway.
function school() {
  const w = 16, h = 8.5, d = 12;
  const [ox, oy] = dxy(d);
  const L = w / 2;
  const wins = [-6.4, -3.4, 0.6, 3.6].map((x) =>
    `<rect x="${x}" y="-7.2" width="2.4" height="2.8" rx="0.3" fill="#fdf3c9" stroke="${INK}" stroke-width="0.5"/>`).join('');
  return `
  <symbol id="bldg.civ.school" overflow="visible">
    <path d="${P([[L, 0], [L, -h], [L + ox, -h + oy], [L + ox, oy]])}" fill="var(--side,#b08968)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <path d="${P([[-L, -h], [L, -h], [L + ox, -h + oy], [-L + ox, -h + oy]])}" fill="var(--rooftop,#8d8577)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L}" y="${-h}" width="${w}" height="${h}" fill="var(--body,#d9a06b)" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>
    <rect x="${-L - 0.5}" y="${-h - 0.8}" width="${w + 1}" height="1.4" rx="0.3" fill="var(--trim,#8a5a44)" stroke="${INK}" stroke-width="0.7"/>
    ${wins}
    <!-- entry -->
    <rect x="${L - 3.9}" y="-5.4" width="3.2" height="5.4" rx="0.35" fill="var(--body,#d9a06b)" stroke="${INK}" stroke-width="0.7"/>
    <rect x="${L - 3.3}" y="-4.2" width="2" height="4.2" rx="0.3" fill="#5b4632" stroke="${INK}" stroke-width="0.55"/>
    <!-- flag -->
    <path d="M${-L + 1.2} ${-h} V${-h - 4.4}" stroke="${INK}" stroke-width="0.55"/>
    <path d="M${-L + 1.2} ${-h - 4.4} h3 l-0.7 1 l0.7 1 h-3 Z" fill="#e05252" stroke="${INK}" stroke-width="0.45"/>
  </symbol>`;
}

// ---------- trees ----------
// All trees: trunk + species-charactered canopy, highlight upper-left.

function treeLinden() {
  // tidy dense teardrop — formal street tree
  return `
  <symbol id="tree.linden" overflow="visible">
    <path d="M-0.7 0 L-0.5 -2.6 H0.5 L0.7 0 Z" fill="#7a5236" stroke="${INK}" stroke-width="0.55"/>
    <path d="M0 -12.6 C2.9 -12.2 4.4 -9.8 4.6 -7.4 C4.8 -5 3.6 -2.9 0 -2.6 C-3.6 -2.9 -4.8 -5 -4.6 -7.4 C-4.4 -9.8 -2.9 -12.2 0 -12.6 Z" fill="#4f9e4f" stroke="${INK}" stroke-width="1.05" stroke-linejoin="round"/>
    <path d="M-2.9 -10.4 C-1.9 -11.6 1.4 -11.9 2.6 -10.6 C1.6 -11 0.3 -10.9 -0.6 -10.5 C-1.5 -10.9 -2.2 -10.7 -2.9 -10.4 Z" fill="#79c46e"/>
    <path d="M-3.4 -7.6 C-2.4 -8.4 -1 -8.3 -0.2 -7.7" fill="none" stroke="#3d7d3f" stroke-width="0.5" opacity="0.7"/>
    <path d="M0.6 -5.6 C1.6 -6.3 2.9 -6.1 3.4 -5.4" fill="none" stroke="#3d7d3f" stroke-width="0.5" opacity="0.7"/>
  </symbol>`;
}

function treeHoneylocust() {
  // airy, open crown: separated feathery tufts on visible limbs
  const tuft = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#a5c95e" stroke="${INK}" stroke-width="0.85"/>`;
  return `
  <symbol id="tree.honeylocust" overflow="visible">
    <path d="M-0.6 0 L-0.4 -3.4 H0.4 L0.6 0 Z" fill="#8a6248" stroke="${INK}" stroke-width="0.55"/>
    <path d="M0 -3 L-2.6 -6.4 M0 -3.4 L0.4 -8 M0 -3.2 L2.8 -5.8" stroke="#8a6248" stroke-width="0.6" fill="none"/>
    ${tuft(-3.2, -7.4, 2)}${tuft(3.3, -6.8, 1.9)}${tuft(0.4, -9.6, 2.2)}${tuft(-1.4, -5.4, 1.5)}${tuft(2, -8.9, 1.5)}
    <circle cx="-3.8" cy="-8.1" r="0.75" fill="#cfe08f"/>
    <circle cx="-0.2" cy="-10.4" r="0.8" fill="#cfe08f"/>
  </symbol>`;
}

function treeFlowering() {
  // small ornamental (lilac/pear/serviceberry class) — blossom puffs
  const puff = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#f0b4cc" stroke="${INK}" stroke-width="0.8"/>`;
  return `
  <symbol id="tree.flowering" overflow="visible">
    <path d="M-0.5 0 L-0.35 -2.5 H0.35 L0.5 0 Z" fill="#6b4530" stroke="${INK}" stroke-width="0.5"/>
    ${puff(-1.9, -4.4, 1.9)}${puff(1.9, -4.6, 1.8)}${puff(0, -6.4, 2)}
    <circle cx="-0.6" cy="-7.1" r="0.7" fill="#fbdff0"/>
    <circle cx="-2.5" cy="-5" r="0.55" fill="#fbdff0"/>
    <circle cx="1.3" cy="-3.6" r="0.4" fill="#fbdff0"/>
  </symbol>`;
}

function treeMaple() {
  // big round lobed crown
  return `
  <symbol id="tree.maple" overflow="visible">
    <path d="M-0.8 0 L-0.55 -3 H0.55 L0.8 0 Z" fill="#7a5236" stroke="${INK}" stroke-width="0.55"/>
    <path d="M0 -13.4 C1.8 -13.6 3 -12.4 4.2 -11.2 C5.8 -10.4 5.9 -8.2 5 -6.9 C5.6 -4.9 3.8 -3.2 1.9 -3.6 C1 -2.7 -1 -2.7 -1.9 -3.6 C-3.8 -3.2 -5.6 -4.9 -5 -6.9 C-5.9 -8.2 -5.8 -10.4 -4.2 -11.2 C-3 -12.4 -1.8 -13.6 0 -13.4 Z" fill="#57a04a" stroke="${INK}" stroke-width="1.05" stroke-linejoin="round"/>
    <path d="M-3.6 -10.6 C-2.4 -11.9 0.4 -12.3 1.9 -11.4 C0.6 -11.5 -0.8 -11.3 -1.7 -10.8 C-2.4 -11.1 -3 -10.9 -3.6 -10.6 Z" fill="#83c66f"/>
    <path d="M-4 -7.2 C-3 -8 -1.6 -7.9 -0.8 -7.3 M1.2 -5.4 C2.2 -6.1 3.5 -5.9 4 -5.2" fill="none" stroke="#417a39" stroke-width="0.5" opacity="0.7"/>
  </symbol>`;
}

function treeAsh() {
  // upright oval crown, slightly pointed top
  return `
  <symbol id="tree.ash" overflow="visible">
    <path d="M-0.7 0 L-0.5 -3 H0.5 L0.7 0 Z" fill="#7a5236" stroke="${INK}" stroke-width="0.55"/>
    <path d="M0 -13 C2.4 -12 3.9 -9.6 3.9 -7.2 C3.9 -4.8 2.4 -3 0 -2.8 C-2.4 -3 -3.9 -4.8 -3.9 -7.2 C-3.9 -9.6 -2.4 -12 0 -13 Z" fill="#63aa5c" stroke="${INK}" stroke-width="1.05" stroke-linejoin="round"/>
    <path d="M-2.2 -10.3 C-1.3 -11.4 0.9 -11.6 1.9 -10.7 C0.9 -10.9 -0.3 -10.8 -1 -10.4 Z" fill="#8fce7d"/>
    <path d="M-2.6 -6.6 C-1.7 -7.3 -0.4 -7.2 0.3 -6.7" fill="none" stroke="#47823f" stroke-width="0.5" opacity="0.7"/>
  </symbol>`;
}

function treeElm() {
  // vase silhouette: arching limbs, crown held high and wide
  return `
  <symbol id="tree.elm" overflow="visible">
    <path d="M-0.7 0 C-0.5 -2 -0.6 -3.2 -1.8 -4.6 M0.7 0 C0.5 -2 0.6 -3.2 1.8 -4.6 M0 -1.4 V-4" stroke="#7a5236" stroke-width="0.8" fill="none"/>
    <path d="M-0.9 0 H0.9 L0.6 -2.4 H-0.6 Z" fill="#7a5236" stroke="${INK}" stroke-width="0.5"/>
    <path d="M0 -12.8 C3 -12.9 5.6 -11.4 6.2 -9.2 C6.7 -7.4 5.4 -5.7 3.4 -5.5 C2.2 -4.6 0.8 -4.4 0 -4.7 C-0.8 -4.4 -2.2 -4.6 -3.4 -5.5 C-5.4 -5.7 -6.7 -7.4 -6.2 -9.2 C-5.6 -11.4 -3 -12.9 0 -12.8 Z" fill="#4f9455" stroke="${INK}" stroke-width="1.05" stroke-linejoin="round"/>
    <path d="M-4.4 -10.6 C-3 -11.8 0 -12.1 1.6 -11.2 C0.2 -11.3 -1.4 -11.1 -2.4 -10.6 Z" fill="#7cc06e"/>
  </symbol>`;
}

function treeOak() {
  // broad, sturdy, cloud-lobed crown — wider than tall
  return `
  <symbol id="tree.oak" overflow="visible">
    <path d="M-1 0 L-0.7 -3.2 H0.7 L1 0 Z" fill="#6b4a30" stroke="${INK}" stroke-width="0.6"/>
    <path d="M0 -11.8 C2.2 -12.4 4.2 -11.4 5 -10 C6.8 -9.6 7.2 -7.2 6 -6 C6.2 -4.4 4.4 -3.2 2.8 -3.8 C1.8 -2.9 -1.8 -2.9 -2.8 -3.8 C-4.4 -3.2 -6.2 -4.4 -6 -6 C-7.2 -7.2 -6.8 -9.6 -5 -10 C-4.2 -11.4 -2.2 -12.4 0 -11.8 Z" fill="#4c8f45" stroke="${INK}" stroke-width="1.05" stroke-linejoin="round"/>
    <path d="M-4.2 -9.4 C-2.8 -10.6 0 -10.9 1.6 -10 C0.2 -10.1 -1.6 -9.9 -2.6 -9.4 Z" fill="#76b465"/>
  </symbol>`;
}

// ---------- ambient ----------

function car() {
  return `
  <symbol id="veh.car" overflow="visible">
    <path d="M-2.4 -1.1 C-2.4 -2.2 -1.6 -2.9 -0.7 -2.9 L0.9 -2.9 C1.7 -2.9 2.1 -2.3 2.4 -1.6 L2.4 -0.4 L-2.4 -0.4 Z" fill="var(--body,#e05252)" stroke="${INK}" stroke-width="0.55" stroke-linejoin="round"/>
    <path d="M-1.5 -1.7 L-1.2 -2.5 L0.7 -2.5 L1.1 -1.7 Z" fill="#bfe4ea" stroke="${INK}" stroke-width="0.4"/>
    <circle cx="-1.4" cy="-0.35" r="0.55" fill="#3a332b" stroke="${INK}" stroke-width="0.3"/>
    <circle cx="1.4" cy="-0.35" r="0.55" fill="#3a332b" stroke="${INK}" stroke-width="0.3"/>
    <circle cx="-1.4" cy="-0.35" r="0.22" fill="#cfc4ad"/>
    <circle cx="1.4" cy="-0.35" r="0.22" fill="#cfc4ad"/>
  </symbol>`;
}

// ---------- ground assets (top-down, rotatable) ----------

function tennisCourt() {
  // doubles court ~24x11 with apron; drawn centered, long axis = x
  return `
  <symbol id="ground.tennis" overflow="visible">
    <rect x="-15" y="-8.5" width="30" height="17" rx="1.2" fill="#3e7a5e" stroke="#2e5c47" stroke-width="0.7"/>
    <rect x="-11.9" y="-5.5" width="23.8" height="11" fill="#5da270" stroke="#fdf6e3" stroke-width="0.55"/>
    <path d="M-11.9 -4.1 H11.9 M-11.9 4.1 H11.9 M-6 -4.1 V4.1 M6 -4.1 V4.1 M-6 0 H6" stroke="#fdf6e3" stroke-width="0.45" fill="none"/>
    <path d="M0 -5.9 V5.9" stroke="#3a332b" stroke-width="0.6"/>
    <path d="M0 -5.9 V5.9" stroke="#e8e4da" stroke-width="0.3" stroke-dasharray="0.6 0.5"/>
  </symbol>`;
}

function playgroundGround() {
  // sand patch + tiny oblique swing frame and slide
  return `
  <symbol id="ground.playground" overflow="visible">
    <ellipse cx="0" cy="0" rx="10" ry="6.5" fill="#efd9a7" stroke="#d9bc82" stroke-width="0.7"/>
    <path d="M-6.5 1.5 L-5 -3 M-3.5 1.5 L-5 -3 M-8 1.5 L-6.6 -3 M-6.6 -3 L-5 -3" stroke="#5f7285" stroke-width="0.55" fill="none"/>
    <path d="M-6.1 -3 V-0.6 M-5.4 -3 V-0.6" stroke="${INK}" stroke-width="0.3"/>
    <rect x="-6.35" y="-0.6" width="0.6" height="0.4" fill="#e07a2f" stroke="${INK}" stroke-width="0.2"/>
    <rect x="-5.65" y="-0.6" width="0.6" height="0.4" fill="#3f8ecc" stroke="${INK}" stroke-width="0.2"/>
    <path d="M3.5 1.2 L3.5 -2.4 L6.8 0.2 L6.8 1.2" fill="#f2c04c" stroke="${INK}" stroke-width="0.4" stroke-linejoin="round"/>
    <rect x="3" y="-3.2" width="1.1" height="1" fill="#e05252" stroke="${INK}" stroke-width="0.3"/>
  </symbol>`;
}

export function allSymbols() {
  return [
    polishFlat(), bungalow(), apartment(), garage(),
    storefront(), cornerTavern(), church(), school(),
    treeLinden(), treeHoneylocust(), treeFlowering(), treeMaple(), treeAsh(), treeElm(), treeOak(),
    car(), tennisCourt(), playgroundGround(),
  ].join('\n');
}

// Asset metadata the composer needs: rough half-width (m) for spacing, class, layer.
export const ASSET_META = {
  'bldg.res.polish_flat': { halfW: 6.5, cls: 'standing' },
  'bldg.res.bungalow': { halfW: 7, cls: 'standing' },
  'bldg.res.apartment': { halfW: 9, cls: 'standing' },
  'bldg.res.garage': { halfW: 5, cls: 'standing' },
  'bldg.com.storefront': { halfW: 7, cls: 'standing' },
  'bldg.com.corner_tavern': { halfW: 8, cls: 'standing' },
  'bldg.civ.church': { halfW: 10, cls: 'standing', hero: true },
  'bldg.civ.school': { halfW: 10, cls: 'standing' },
  'tree.linden': { halfW: 4.6, cls: 'tree' },
  'tree.honeylocust': { halfW: 5, cls: 'tree' },
  'tree.flowering': { halfW: 3.6, cls: 'tree' },
  'tree.maple': { halfW: 5.6, cls: 'tree' },
  'tree.ash': { halfW: 4, cls: 'tree' },
  'tree.elm': { halfW: 6.2, cls: 'tree' },
  'tree.oak': { halfW: 6.8, cls: 'tree' },
  'veh.car': { halfW: 2.6, cls: 'ambient' },
  'ground.tennis': { halfW: 15, cls: 'ground' },
  'ground.playground': { halfW: 10, cls: 'ground' },
};
