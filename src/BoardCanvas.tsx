import { Fragment, useEffect, useMemo } from 'react';
import {
  ImageOverlay,
  MapContainer,
  TileLayer,
  Marker,
  Polygon,
  Polyline,
  SVGOverlay,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import type { Board, LatLng } from './types';
import { SQUARE_TYPES } from './squareTypes';
import { metersBetween } from './snap';

export type Mode = 'select' | 'boundary' | 'add' | 'connect';

// CARTO Voyager — a free, soft-color basemap (no API key needed).
const VOYAGER_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png';

// The whole board is drawn ONCE into an SVG overlay in WORLD units (meters),
// so Leaflet scales it natively with zoom — like magnifying a static image.
// Nothing re-renders or re-proportions while zooming. Sizes below are meters.
const CASING_M = 26; // dark track outline width
const FILL_M = 20; // tile fill width
const DIVIDER_L = 26;
const DIVIDER_W = 4.5;

// POI-focused board: the procedural house/shop fabric was decluttering noise that
// fought the track, so it's off. Flip to true to bring the illustrated city back.
const SHOW_FABRIC = false;
// Clean board for mechanics work: POIs/landmarks, trees, and land-use tints are
// off — just streets + intersection nodes + green grass. Flip any back on later.
const SHOW_POIS = false;
const SHOW_BLOCK_TINTS = false;
const SHOW_GREENS = false; // parks/woods patches off — cleaner uniform grass
const TREE_KEEP = 0; // no trees for now

// Illustrated-city underlay (Vocabulary v1 bake): a single pre-rendered image
// of the whole neighborhood under the vector track/nodes. Toggled per-board by
// the designer's "Add surroundings" button (board.artUnderlay), so players see
// it too once the board is saved/published.
// bounds of the baked image (from art-prototype/out/style-c-full-raster-underlay.bounds.json)
const ART_BOUNDS: [[number, number], [number, number]] = [
  [43.049077397699506, -87.9037801166488],
  [43.056460884389494, -87.89324663677681],
];

const vertexIcon = L.divIcon({ className: '', html: '<div class="vtx"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
const vertexIconSel = L.divIcon({ className: '', html: '<div class="vtx vtx--sel"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });

/** Transparent square used as a click/drag target; visuals live in the SVG. */
function hitIcon(s: number): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="width:${s}px;height:${s}px"></div>`,
    iconSize: [s, s],
    iconAnchor: [s / 2, s / 2],
  });
}

// Ground-plane palette — the whole board sits on one illustrated surface so
// nothing floats. Grass is the base; non-residential blocks get a paved tint,
// a sidewalk strip flanks every street, and each building casts a soft shadow.
const GRASS = '#c3d7a4';
const BLOCK_LAWN: Record<string, string | null> = {
  residential: null, // stays grass — leafy Milwaukee blocks
  commercial: '#e2d6b5',
  retail: '#e6d3bd',
  industrial: '#d3cfc0',
  civic: '#dbe0cd',
};
const PARK_FILL = '#a8cf7b';
const WOOD_FILL = '#8bb463';
const WATER_FILL = '#8fd8e8';
const SIDEWALK = '#dad3c2';
const SHADOW = '#2c2822';
// POI-only board: the road is one clean path (single fill, no per-tile colors or
// dividers). The "spaces" are the intersections, drawn as nodes on top.
const ROAD_FILL = '#e9e4d7';
const NODE_FILL = '#f4efe4';

// ---- Stylized art sprites (drawn in world meters, outlined flat style) ----

/** Deterministic 0..1 from two numbers — stable art variation, no Math.random. */
const hash01 = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const INK = '#3a362f';
const TREE_PALETTES = [
  { base: '#6aa84f', light: '#8ec46d' },
  { base: '#5c9a45', light: '#7fb45f' },
  { base: '#79b25c', light: '#9bcb79' },
];

function TreeSprite({ x, y, s, v }: { x: number; y: number; s: number; v: number }) {
  const t = `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})`;
  if (v % 3 === 2) {
    // evergreen: stacked tiers
    return (
      <g transform={t}>
        <rect x={-0.9} y={-2.5} width={1.8} height={3.2} rx={0.8} fill="#7a4f33" stroke={INK} strokeWidth={0.7} />
        <polygon points="-4.6,-2.5 4.6,-2.5 0,-8" fill="#4e8a4a" stroke={INK} strokeWidth={0.8} strokeLinejoin="round" />
        <polygon points="-3.9,-6 3.9,-6 0,-11" fill="#589753" stroke={INK} strokeWidth={0.8} strokeLinejoin="round" />
        <polygon points="-3,-9 3,-9 0,-13.5" fill="#63a55e" stroke={INK} strokeWidth={0.8} strokeLinejoin="round" />
      </g>
    );
  }
  const P = TREE_PALETTES[v % TREE_PALETTES.length];
  const blobs: [number, number, number][] =
    v % 2 === 0
      ? [
          [-3.6, -7.2, 4.4],
          [3.6, -7.8, 4.6],
          [0, -11, 4.8],
          [0, -6.8, 4],
        ]
      : [
          [-2.8, -6.8, 3.8],
          [3, -7.2, 4.2],
          [0, -10, 4.4],
        ];
  const top = blobs[2];
  return (
    <g transform={t}>
      <rect x={-1} y={-3.2} width={2} height={4} rx={0.9} fill="#7a4f33" stroke={INK} strokeWidth={0.7} />
      {blobs.map(([cx, cy, r], i) => (
        <circle key={`o${i}`} cx={cx} cy={cy} r={r} fill={P.base} stroke={INK} strokeWidth={1.3} />
      ))}
      {blobs.map(([cx, cy, r], i) => (
        <circle key={`f${i}`} cx={cx} cy={cy} r={r} fill={P.base} />
      ))}
      <circle cx={top[0] - 1.4} cy={top[1] - 1.4} r={top[2] * 0.5} fill={P.light} />
    </g>
  );
}

// Milwaukee houses: narrow and tall, Cream City brick most common of all.
const CREAM = '#eadfbc';
const HOUSE_BODY = [CREAM, CREAM, '#d8b98e', '#c9d3d8', '#d9a08c', '#c9cf9f', CREAM, '#b9c9d6'];
const HOUSE_ROOF = ['#a25b45', '#7d6b5a', '#946e52', '#87604b', '#6f7d86', '#9c5a50'];
const WINDOW = '#f2e6ae';

function HouseSprite({ x, y, s, c, v }: { x: number; y: number; s: number; c: number; v: number }) {
  const body = HOUSE_BODY[c % HOUSE_BODY.length];
  const roof = HOUSE_ROOF[(c + 2) % HOUSE_ROOF.length];
  const t = `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})`;
  const brick = body === CREAM && (
    <>
      <line x1={-4} y1={-7.3} x2={4} y2={-7.3} stroke="#d9c791" strokeWidth={0.35} />
      <line x1={-4} y1={-5.9} x2={4} y2={-5.9} stroke="#d9c791" strokeWidth={0.35} />
    </>
  );
  if (v % 3 === 1) {
    // Polish-flat duplex: flat roof, two full stories, bay window
    return (
      <g transform={t}>
        <rect x={-4} y={-12} width={8} height={12} fill={body} stroke={INK} strokeWidth={0.7} />
        <rect x={-4.6} y={-12.9} width={9.2} height={1.4} fill={roof} stroke={INK} strokeWidth={0.5} />
        <rect x={-2.9} y={-10.9} width={2} height={2.6} fill={WINDOW} stroke={INK} strokeWidth={0.45} />
        <rect x={0.9} y={-10.9} width={2} height={2.6} fill={WINDOW} stroke={INK} strokeWidth={0.45} />
        <rect x={-3.4} y={-5.4} width={2.8} height={3.2} fill={WINDOW} stroke={INK} strokeWidth={0.45} />
        <rect x={1} y={-4} width={2.2} height={4} fill="#5b4632" stroke={INK} strokeWidth={0.45} />
        <rect x={0.4} y={-4.9} width={3.4} height={0.9} fill={roof} stroke={INK} strokeWidth={0.4} />
        {brick}
      </g>
    );
  }
  const steep = v % 3 === 2;
  const ridgeY = steep ? -17 : -15;
  return (
    <g transform={t}>
      <rect x={1.7} y={ridgeY + 1} width={1.4} height={4} fill="#9c5a50" stroke={INK} strokeWidth={0.4} />
      <rect x={-4} y={-10.5} width={8} height={10.5} fill={body} stroke={INK} strokeWidth={0.7} />
      <polygon
        points={`-4.8,-10.5 0,${ridgeY} 4.8,-10.5`}
        fill={roof}
        stroke={INK}
        strokeWidth={0.7}
        strokeLinejoin="round"
      />
      {steep ? (
        <circle cx={0} cy={-12.1} r={0.95} fill={WINDOW} stroke={INK} strokeWidth={0.4} />
      ) : (
        <rect x={-0.9} y={-13.2} width={1.8} height={1.9} fill={WINDOW} stroke={INK} strokeWidth={0.4} />
      )}
      <rect x={-2.9} y={-9.5} width={2} height={2.5} fill={WINDOW} stroke={INK} strokeWidth={0.45} />
      <rect x={0.9} y={-9.5} width={2} height={2.5} fill={WINDOW} stroke={INK} strokeWidth={0.45} />
      <rect x={-3.1} y={-4} width={2.2} height={4} fill="#5b4632" stroke={INK} strokeWidth={0.45} />
      <rect x={0.7} y={-5} width={2.6} height={2.9} fill={WINDOW} stroke={INK} strokeWidth={0.45} />
      <rect x={-3.7} y={-4.9} width={3.4} height={0.9} fill={roof} stroke={INK} strokeWidth={0.4} />
      {brick}
    </g>
  );
}

/** Yard bush — softens block interiors. */
function BushSprite({ x, y, s, v }: { x: number; y: number; s: number; v: number }) {
  const P = TREE_PALETTES[v % TREE_PALETTES.length];
  const blobs: [number, number, number, number][] = [
    [-2.2, -1.6, 2.8, 2.2],
    [2.2, -1.9, 3, 2.4],
    [0, -2.8, 2.6, 2.1],
  ];
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})`}>
      {blobs.map(([cx, cy, rx, ry], i) => (
        <ellipse key={`o${i}`} cx={cx} cy={cy} rx={rx} ry={ry} fill={P.base} stroke={INK} strokeWidth={1.1} />
      ))}
      {blobs.map(([cx, cy, rx, ry], i) => (
        <ellipse key={`f${i}`} cx={cx} cy={cy} rx={rx} ry={ry} fill={P.base} />
      ))}
      <ellipse cx={-0.6} cy={-3.4} rx={1.3} ry={1} fill={P.light} />
    </g>
  );
}

const SHOP_BODY = ['#c86f5a', '#7c9a8e', '#b98c4a', '#8e7cae', '#5f8aa8', '#c2a05a'];
const AWNING = ['#b23b3b', '#3f6d54', '#3f5d8a', '#a8632f', '#6d4f8a', '#2f7d6d'];

/** Generic storefront with a striped awning; an icon signboard for real POIs,
 * a plain painted sign band for anonymous block-fabric shops. */
function StorefrontSprite({ x, y, s, c, icon }: { x: number; y: number; s: number; c: number; icon?: string }) {
  const body = SHOP_BODY[c % SHOP_BODY.length];
  const awn = AWNING[c % AWNING.length];
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})`}>
      <rect x={-5.5} y={-10} width={11} height={10} fill={body} stroke={INK} strokeWidth={0.8} />
      <rect x={-6} y={-10.9} width={12} height={1.7} fill="#8a7360" stroke={INK} strokeWidth={0.6} />
      {icon ? (
        <>
          <rect x={-2.7} y={-9.5} width={5.4} height={2.5} rx={0.5} fill="#fff6e0" stroke={INK} strokeWidth={0.5} />
          <text x={0} y={-7.6} fontSize={2.2} textAnchor="middle">
            {icon}
          </text>
        </>
      ) : (
        <rect x={-3.6} y={-9.3} width={7.2} height={2} rx={0.4} fill={AWNING[(c + 3) % AWNING.length]} stroke={INK} strokeWidth={0.5} />
      )}
      <rect x={-5.8} y={-6.6} width={11.6} height={2.4} fill={awn} stroke={INK} strokeWidth={0.6} />
      {[1, 3, 5].map((i) => (
        <rect key={i} x={-5.8 + (i * 11.6) / 6} y={-6.6} width={11.6 / 6} height={2.4} fill="#f5efdf" />
      ))}
      <rect x={-4.6} y={-3.7} width={5} height={3.7} fill="#f6e6b0" stroke={INK} strokeWidth={0.5} />
      <rect x={1.4} y={-3.7} width={2.7} height={3.7} fill="#5b4632" stroke={INK} strokeWidth={0.5} />
    </g>
  );
}

/** Industrial-block fabric: wide low warehouse with a loading door. */
function WarehouseSprite({ x, y, s, c }: { x: number; y: number; s: number; c: number }) {
  const body = ['#b9a48c', '#a8a39a', '#b0937f'][c % 3];
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})`}>
      <rect x={-8} y={-7} width={16} height={7} fill={body} stroke={INK} strokeWidth={0.8} />
      <rect x={-8.5} y={-7.9} width={17} height={1.2} fill="#8a7a66" stroke={INK} strokeWidth={0.5} />
      <rect x={-3} y={-4.6} width={6} height={4.6} fill="#6b5747" stroke={INK} strokeWidth={0.5} />
      <line x1={-3} y1={-3.4} x2={3} y2={-3.4} stroke={INK} strokeWidth={0.3} />
      <line x1={-3} y1={-2.2} x2={3} y2={-2.2} stroke={INK} strokeWidth={0.3} />
      <rect x={-6.8} y={-6} width={2.2} height={1.6} fill="#cfd8d0" stroke={INK} strokeWidth={0.4} />
      <rect x={4.6} y={-6} width={2.2} height={1.6} fill="#cfd8d0" stroke={INK} strokeWidth={0.4} />
    </g>
  );
}

/** Hero landmark: theater with a bulb-lit marquee and blade sign. */
function TheaterSprite({ x, y, s, icon }: { x: number; y: number; s: number; icon: string }) {
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})`}>
      <rect x={-7} y={-13} width={14} height={13} fill="#8a3b4a" stroke={INK} strokeWidth={0.9} />
      <rect x={-7.5} y={-13.9} width={15} height={1.8} fill="#5e2b36" stroke={INK} strokeWidth={0.6} />
      <rect x={-9.4} y={-12.2} width={2.3} height={6.8} rx={0.4} fill="#f0c33c" stroke={INK} strokeWidth={0.5} />
      <rect x={-6.2} y={-8.2} width={12.4} height={3} rx={0.6} fill="#fff6e0" stroke={INK} strokeWidth={0.6} />
      <text x={0} y={-5.9} fontSize={2.4} textAnchor="middle">
        {icon}
      </text>
      {[-5, -2.5, 0, 2.5, 5].map((cx) => (
        <circle key={cx} cx={cx} cy={-4.6} r={0.45} fill="#f6d98a" stroke={INK} strokeWidth={0.25} />
      ))}
      <rect x={-4.4} y={-3.4} width={2.6} height={3.4} fill="#5b4632" stroke={INK} strokeWidth={0.5} />
      <rect x={-1.3} y={-3.4} width={2.6} height={3.4} fill="#5b4632" stroke={INK} strokeWidth={0.5} />
      <rect x={1.8} y={-3.4} width={2.6} height={3.4} fill="#5b4632" stroke={INK} strokeWidth={0.5} />
    </g>
  );
}

/** The bars are the gameplay hubs — brick tavern, warm windows, hanging mug. */
function BarSprite({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})`}>
      <rect x={-6.5} y={-11} width={13} height={11} fill="#7a4636" stroke={INK} strokeWidth={0.9} />
      <rect x={-7} y={-11.9} width={14} height={1.8} fill="#59392e" stroke={INK} strokeWidth={0.6} />
      <rect x={-6.8} y={-7} width={13.6} height={2.6} fill="#3f6d54" stroke={INK} strokeWidth={0.6} />
      {[1, 3, 5].map((i) => (
        <rect key={i} x={-6.8 + (i * 13.6) / 7} y={-7} width={13.6 / 7} height={2.6} fill="#f5efdf" />
      ))}
      <rect x={-5.4} y={-4} width={4.6} height={4} fill="#f6d98a" stroke={INK} strokeWidth={0.5} />
      <rect x={2} y={-4} width={3} height={4} fill="#5b4632" stroke={INK} strokeWidth={0.5} />
      <rect x={-1.6} y={-4} width={2.6} height={2.4} fill="#f6d98a" stroke={INK} strokeWidth={0.5} />
      <line x1={6.5} y1={-9.8} x2={9.2} y2={-9.8} stroke={INK} strokeWidth={0.6} />
      <circle cx={9.2} cy={-8} r={2} fill="#fff6e0" stroke={INK} strokeWidth={0.5} />
      <rect x={8.35} y={-8.8} width={1.5} height={1.7} rx={0.2} fill="#e8a33d" stroke={INK} strokeWidth={0.4} />
      <ellipse cx={9.1} cy={-8.85} rx={0.85} ry={0.4} fill="#fffdf5" stroke={INK} strokeWidth={0.3} />
    </g>
  );
}

function ChurchSprite({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})`}>
      <rect x={-5} y={-9} width={10} height={9} fill="#e8e0cf" stroke={INK} strokeWidth={0.8} />
      <polygon points="-6,-9 0,-13.2 6,-9" fill="#8a6f5a" stroke={INK} strokeWidth={0.8} strokeLinejoin="round" />
      <rect x={-1.7} y={-16.5} width={3.4} height={6} fill="#e8e0cf" stroke={INK} strokeWidth={0.7} />
      <polygon points="-2.3,-16.5 0,-21 2.3,-16.5" fill="#8a6f5a" stroke={INK} strokeWidth={0.7} strokeLinejoin="round" />
      <line x1={0} y1={-21} x2={0} y2={-22.8} stroke={INK} strokeWidth={0.6} />
      <line x1={-0.9} y1={-22} x2={0.9} y2={-22} stroke={INK} strokeWidth={0.6} />
      <circle cx={0} cy={-6.7} r={1.2} fill="#9db8d6" stroke={INK} strokeWidth={0.5} />
      <path d="M -1.5 0 L -1.5 -2.8 A 1.5 1.5 0 0 1 1.5 -2.8 L 1.5 0 Z" fill="#5b4632" stroke={INK} strokeWidth={0.5} />
    </g>
  );
}

function CivicSprite({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})`}>
      <rect x={-6.6} y={-1.1} width={13.2} height={1.1} fill="#c4bba4" stroke={INK} strokeWidth={0.5} />
      <rect x={-6} y={-8} width={12} height={7} fill="#ddd6c2" stroke={INK} strokeWidth={0.8} />
      {[-4.4, -1.5, 1.5, 4.4].map((cx) => (
        <rect key={cx} x={cx - 0.7} y={-7.2} width={1.4} height={6.2} fill="#f0ead8" stroke={INK} strokeWidth={0.5} />
      ))}
      <polygon points="-7,-8 0,-12 7,-8" fill="#c9c0a8" stroke={INK} strokeWidth={0.8} strokeLinejoin="round" />
    </g>
  );
}

/** Bespoke hero: St. Hedwig's — red brick, central tower, tall copper spire. */
function HedwigSprite({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})`}>
      <rect x={-9} y={-14} width={18} height={14} fill="#c46a4f" stroke={INK} strokeWidth={0.8} />
      <polygon points="-10,-14 0,-20 10,-14" fill="#7d6b5a" stroke={INK} strokeWidth={0.8} strokeLinejoin="round" />
      {[-6.2, 3.4].map((wx) => (
        <path
          key={wx}
          d={`M ${wx} -4 L ${wx} -9.6 A 1.4 1.6 0 0 1 ${wx + 2.8} -9.6 L ${wx + 2.8} -4 Z`}
          fill="#9db8d6"
          stroke={INK}
          strokeWidth={0.5}
        />
      ))}
      <rect x={-3.2} y={-26} width={6.4} height={26} fill="#c46a4f" stroke={INK} strokeWidth={0.8} />
      <line x1={-3.2} y1={-16} x2={3.2} y2={-16} stroke="#a04f38" strokeWidth={0.4} />
      <circle cx={0} cy={-21.5} r={1.7} fill="#9db8d6" stroke={INK} strokeWidth={0.5} />
      <rect x={-2.6} y={-30.5} width={5.2} height={4.5} fill="#e8dcc2" stroke={INK} strokeWidth={0.7} />
      <rect x={-1.1} y={-29.7} width={2.2} height={2.9} fill="#5b4632" stroke={INK} strokeWidth={0.4} />
      <polygon points="-3.5,-30.5 0,-45 3.5,-30.5" fill="#5a7d6d" stroke={INK} strokeWidth={0.7} strokeLinejoin="round" />
      <line x1={0} y1={-45} x2={0} y2={-47.6} stroke={INK} strokeWidth={0.6} />
      <line x1={-1.1} y1={-46.6} x2={1.1} y2={-46.6} stroke={INK} strokeWidth={0.6} />
      <path d="M -1.8 0 L -1.8 -3.4 A 1.8 1.8 0 0 1 1.8 -3.4 L 1.8 0 Z" fill="#5b4632" stroke={INK} strokeWidth={0.5} />
    </g>
  );
}

/* ---- Bespoke hero locations (name/place-keyed; fall back to generic art) ---- */

/** Fink's — narrow copper-sheathed tavern with evenly-paced windows. */
function FinksSprite({ x, y, s }: { x: number; y: number; s: number }) {
  const COP = '#b5794a';
  const HI = '#cf9560';
  const SEAM = '#8a5a37';
  const PAT = '#6ea896';
  const win = (wx: number, wy: number) => (
    <rect x={wx} y={wy} width={1.9} height={2.3} fill={WINDOW} stroke={INK} strokeWidth={0.4} />
  );
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})`}>
      <rect x={-5} y={-16} width={10} height={16} fill={COP} stroke={INK} strokeWidth={0.9} />
      <rect x={-5.7} y={-17.2} width={11.4} height={1.7} fill={HI} stroke={INK} strokeWidth={0.6} />
      <line x1={-5} y1={-11.5} x2={5} y2={-11.5} stroke={SEAM} strokeWidth={0.35} />
      <line x1={0} y1={-16} x2={0} y2={-6.4} stroke={SEAM} strokeWidth={0.3} opacity={0.5} />
      <path d="M-3 -15.5 q1.2 4 0.2 8" fill="none" stroke={PAT} strokeWidth={0.7} opacity={0.55} />
      <path d="M3.2 -13 q-1 3 0 6" fill="none" stroke={PAT} strokeWidth={0.6} opacity={0.45} />
      {win(-3.1, -14.7)}
      {win(1.2, -14.7)}
      {win(-3.1, -10.4)}
      {win(1.2, -10.4)}
      <rect x={-4.6} y={-6.4} width={9.2} height={2} rx={0.3} fill="#2c2622" stroke={INK} strokeWidth={0.5} />
      <text x={0} y={-4.9} fontSize={1.7} fontWeight={700} textAnchor="middle" fill={HI} fontFamily="Georgia, serif">
        FINK&apos;S
      </text>
      <rect x={-4} y={-4} width={2.2} height={4} fill={WINDOW} stroke={INK} strokeWidth={0.45} />
      <rect x={-0.9} y={-4} width={2.4} height={4} fill="#5b4632" stroke={INK} strokeWidth={0.5} />
      <rect x={2} y={-4} width={2} height={4} fill={WINDOW} stroke={INK} strokeWidth={0.45} />
    </g>
  );
}

/** Y-Not II — 1919 brick corner tavern, big plate-glass windows, red neon sign. */
function YNotSprite({ x, y, s }: { x: number; y: number; s: number }) {
  const BRICK = '#9c5545';
  const BRICK_D = '#824539';
  const NEON = '#f0455a';
  const GLASS = '#3a4a52';
  const FRAME = '#b5794a';
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})`}>
      <rect x={-6.5} y={-11} width={13} height={11} fill={BRICK} stroke={INK} strokeWidth={0.9} />
      <rect x={-7} y={-11.9} width={14} height={1.7} fill={BRICK_D} stroke={INK} strokeWidth={0.6} />
      <line x1={-6.5} y1={-4} x2={6.5} y2={-4} stroke={BRICK_D} strokeWidth={0.3} opacity={0.7} />
      {/* big plate-glass windows with copper frames, central door */}
      <rect x={-6} y={-6.6} width={4.6} height={6.6} fill={GLASS} stroke={FRAME} strokeWidth={0.9} />
      <rect x={1.4} y={-6.6} width={4.6} height={6.6} fill={GLASS} stroke={FRAME} strokeWidth={0.9} />
      <rect x={-1.2} y={-6.6} width={2.6} height={6.6} fill="#5b4632" stroke={INK} strokeWidth={0.5} />
      {/* red neon sign */}
      <rect x={-5.2} y={-10.2} width={10.4} height={2.6} rx={0.5} fill="#241a1a" stroke={INK} strokeWidth={0.5} />
      <rect x={-4.7} y={-9.8} width={9.4} height={1.8} rx={0.4} fill="none" stroke={NEON} strokeWidth={0.45} opacity={0.7} />
      <text x={0} y={-8.2} fontSize={2.5} fontWeight={700} textAnchor="middle" fill={NEON} fontFamily="Arial, sans-serif" letterSpacing={0.4}>
        Y-NOT
      </text>
    </g>
  );
}

/** Hosed on Brady — firefighter-themed brick, angled stone base, hydrant & beacon. */
function HosedSprite({ x, y, s }: { x: number; y: number; s: number }) {
  const BRICK = '#b5643f';
  const STONE = '#b7b0a2';
  const RED = '#c62d2d';
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})`}>
      <rect x={-6} y={-12.5} width={12} height={9.5} fill={BRICK} stroke={INK} strokeWidth={0.9} />
      <rect x={-6.6} y={-13.4} width={13.2} height={1.7} fill="#8f4e32" stroke={INK} strokeWidth={0.6} />
      {/* red roof beacon (the flasher) */}
      <rect x={-1} y={-15} width={2} height={1.7} fill="#5b4632" stroke={INK} strokeWidth={0.4} />
      <circle cx={0} cy={-15.4} r={1.1} fill={RED} stroke={INK} strokeWidth={0.4} />
      <line x1={-2.4} y1={-16.6} x2={-1.4} y2={-15.8} stroke={RED} strokeWidth={0.4} />
      <line x1={2.4} y1={-16.6} x2={1.4} y2={-15.8} stroke={RED} strokeWidth={0.4} />
      {/* upper windows */}
      <rect x={-4.3} y={-11.4} width={2.4} height={3} fill={WINDOW} stroke={INK} strokeWidth={0.45} />
      <rect x={1.9} y={-11.4} width={2.4} height={3} fill={WINDOW} stroke={INK} strokeWidth={0.45} />
      {/* HOSED sign band */}
      <rect x={-5.2} y={-7.4} width={10.4} height={2.2} fill={RED} stroke={INK} strokeWidth={0.5} />
      <text x={0} y={-5.8} fontSize={2} fontWeight={700} textAnchor="middle" fill="#fff2e6" fontFamily="Arial, sans-serif" letterSpacing={0.5}>
        HOSED
      </text>
      {/* angled stone first-floor projection + recessed door */}
      <polygon points="-6.6,-3 6.6,-3 5.2,0 -5.2,0" fill={STONE} stroke={INK} strokeWidth={0.8} strokeLinejoin="round" />
      <rect x={-1.6} y={-2.6} width={3.2} height={2.6} fill="#4a3a2c" stroke={INK} strokeWidth={0.5} />
      {/* fire hydrant out front */}
      <g transform="translate(8.4 0)">
        <rect x={-1.1} y={-3.2} width={2.2} height={3.2} rx={0.5} fill={RED} stroke={INK} strokeWidth={0.5} />
        <path d="M-1.1 -3.4 A 1.1 1.1 0 0 1 1.1 -3.4 Z" fill={RED} stroke={INK} strokeWidth={0.5} />
        <rect x={-2} y={-2.4} width={0.9} height={0.9} fill={RED} stroke={INK} strokeWidth={0.35} />
        <rect x={1.1} y={-2.4} width={0.9} height={0.9} fill={RED} stroke={INK} strokeWidth={0.35} />
        <circle cx={0} cy={-4.1} r={0.5} fill="#e2a0a0" stroke={INK} strokeWidth={0.3} />
      </g>
    </g>
  );
}

/** Nomad World Pub — corner tavern with world-flag bunting, soccer ball & mask. */
function NomadSprite({ x, y, s }: { x: number; y: number; s: number }) {
  const BRICK = '#a8683f';
  const flags = ['#e23b4e', '#f0c33c', '#3f8ecc', '#4e9a54', '#e07a2f', '#8e5aa8'];
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})`}>
      <rect x={-6.5} y={-11} width={13} height={11} fill={BRICK} stroke={INK} strokeWidth={0.9} />
      <rect x={-7} y={-11.9} width={14} height={1.7} fill="#8a5230" stroke={INK} strokeWidth={0.6} />
      <rect x={-5.4} y={-6.8} width={4} height={4} fill="#f6d98a" stroke={INK} strokeWidth={0.45} />
      <rect x={1.4} y={-6.8} width={4} height={4} fill="#f6d98a" stroke={INK} strokeWidth={0.45} />
      <rect x={-1.4} y={-4.6} width={2.8} height={4.6} fill="#5b4632" stroke={INK} strokeWidth={0.5} />
      {/* NOMAD sign */}
      <rect x={-4.4} y={-10.3} width={8.8} height={2} rx={0.4} fill="#2b2118" stroke={INK} strokeWidth={0.5} />
      <text x={0} y={-8.8} fontSize={1.8} fontWeight={700} textAnchor="middle" fill="#f0c33c" fontFamily="Georgia, serif" letterSpacing={0.4}>
        NOMAD
      </text>
      {/* world-flag bunting draped across the facade */}
      <path d="M-6.2 -7.6 Q0 -5.4 6.2 -7.6" fill="none" stroke={INK} strokeWidth={0.35} />
      {flags.map((col, i) => {
        const t = i / (flags.length - 1);
        // point on the bunting curve (quadratic Bézier: -6.2→0→6.2 x, -7.6→-5.4→-7.6 y)
        const fx = -6.2 + t * 12.4;
        const fy = (1 - t) * (1 - t) * -7.6 + 2 * (1 - t) * t * -5.4 + t * t * -7.6;
        return <polygon key={i} points={`${fx - 0.9},${fy} ${fx + 0.9},${fy} ${fx},${fy + 1.8}`} fill={col} stroke={INK} strokeWidth={0.25} />;
      })}
      {/* soccer-ball planter */}
      <circle cx={5} cy={-1.6} r={1.6} fill="#fbfbf7" stroke={INK} strokeWidth={0.5} />
      <polygon points="5,-2.5 5.7,-1.9 5.4,-1 4.6,-1 4.3,-1.9" fill={INK} />
    </g>
  );
}

/** Cass Street Playground — swings, slide & Marina Lee's painted sculptures. */
function CassPlaygroundSprite({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})`}>
      {/* swing set: A-frame + two swings */}
      <line x1={-9} y1={0} x2={-6.5} y2={-6} stroke="#6b7078" strokeWidth={0.7} />
      <line x1={-4} y1={0} x2={-6.5} y2={-6} stroke="#6b7078" strokeWidth={0.7} />
      <line x1={-10.5} y1={0} x2={-8} y2={-6} stroke="#6b7078" strokeWidth={0.7} />
      <line x1={-8} y1={-6} x2={-6.5} y2={-6} stroke="#6b7078" strokeWidth={0.7} />
      <line x1={-8.7} y1={-6} x2={-8.7} y2={-2.6} stroke={INK} strokeWidth={0.35} />
      <line x1={-6.8} y1={-6} x2={-6.8} y2={-2.6} stroke={INK} strokeWidth={0.35} />
      <rect x={-9.1} y={-2.6} width={0.8} height={0.5} fill="#e07a2f" stroke={INK} strokeWidth={0.2} />
      <rect x={-7.2} y={-2.6} width={0.8} height={0.5} fill="#3f8ecc" stroke={INK} strokeWidth={0.2} />
      {/* slide */}
      <path d="M4 0 L4 -5 L9 -1.5 L9 0" fill="#e2b23a" stroke={INK} strokeWidth={0.5} strokeLinejoin="round" />
      <line x1={2.4} y1={0} x2={4} y2={-5} stroke={INK} strokeWidth={0.4} />
      <rect x={3.4} y={-6} width={1.4} height={1.2} fill="#c62d2d" stroke={INK} strokeWidth={0.4} />
      {/* Marina Lee painted fiberglass sculptures — bright organic blobs on posts */}
      <line x1={-1.5} y1={0} x2={-1.5} y2={-4} stroke={INK} strokeWidth={0.5} />
      <path d="M-1.5 -4 q-2.4 -0.6 -1.6 -2.6 q1.4 -2 3 -0.4 q1.8 1.8 -1.4 3" fill="#e23b4e" stroke={INK} strokeWidth={0.5} />
      <line x1={1.6} y1={0} x2={1.6} y2={-3} stroke={INK} strokeWidth={0.5} />
      <circle cx={1.6} cy={-4} r={1.7} fill="#4e9a54" stroke={INK} strokeWidth={0.5} />
      <circle cx={1.6} cy={-4} r={0.7} fill="#f0c33c" stroke={INK} strokeWidth={0.3} />
    </g>
  );
}

/** Pulaski Playfield — ball diamond with a chain-link backstop. */
function PulaskiFieldSprite({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})`}>
      {/* infield diamond (skin) */}
      <polygon points="0,3 9,-4 0,-11 -9,-4" fill="#ca9a5f" stroke="#9c7645" strokeWidth={0.6} />
      <polygon points="0,1.4 5.4,-3.2 0,-7.8 -5.4,-3.2" fill="#a8cf7b" stroke="#8bb463" strokeWidth={0.5} />
      {/* base paths + bases */}
      <polygon points="0,2.4 5.6,-2.4 0,-7.2 -5.6,-2.4" fill="none" stroke="#e8e0cf" strokeWidth={0.7} />
      {[[0, 2.4], [5.6, -2.4], [0, -7.2], [-5.6, -2.4]].map(([bx, by], i) => (
        <rect key={i} x={bx - 0.5} y={by - 0.5} width={1} height={1} fill="#fbfbf7" stroke={INK} strokeWidth={0.3} />
      ))}
      {/* pitcher's mound */}
      <circle cx={0} cy={-2.4} r={0.9} fill="#ca9a5f" stroke="#9c7645" strokeWidth={0.4} />
      {/* chain-link backstop behind home plate */}
      <path d="M-6 5.6 Q0 2 6 5.6" fill="none" stroke="#8a8f96" strokeWidth={0.7} />
      <path d="M-6 5.6 Q0 2 6 5.6" fill="none" stroke="#b8bcc2" strokeWidth={2.4} strokeOpacity={0.25} />
      {[-4, -2, 0, 2, 4].map((px) => (
        <line key={px} x1={px} y1={5} x2={px} y2={3.4} stroke="#8a8f96" strokeWidth={0.3} />
      ))}
    </g>
  );
}

/* ---- Spot-type icons: a distinct token per generic/POI space type ---- */

/** Coins — a gold coin with a sparkle. */
function CoinSpotSprite({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s})`}>
      <circle r={13} fill="#f2c94c" stroke={INK} strokeWidth={2} />
      <circle r={9} fill="none" stroke="#c8901a" strokeWidth={1.4} />
      <path d="M0 -6 L1.7 -1.7 L6 0 L1.7 1.7 L0 6 L-1.7 1.7 L-6 0 L-1.7 -1.7 Z" fill="#fbe9a6" stroke="#c8901a" strokeWidth={0.6} strokeLinejoin="round" />
      <circle cx={-4.2} cy={-5} r={1.5} fill="#fff7dd" opacity={0.9} />
    </g>
  );
}

/** Chance — a Mario-Party "?" mystery block. */
function ChanceSpotSprite({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s})`}>
      <rect x={-12} y={-12} width={24} height={24} rx={4.5} fill="#a855f7" stroke={INK} strokeWidth={2} />
      {[[-8.5, -8.5], [8.5, -8.5], [-8.5, 8.5], [8.5, 8.5]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={1.3} fill="#e9d5ff" stroke={INK} strokeWidth={0.4} />
      ))}
      <text x={0} y={1} fontSize={17} fontWeight={800} textAnchor="middle" dominantBaseline="central" fill="#fff" fontFamily="Arial, sans-serif">
        ?
      </text>
    </g>
  );
}

/** Challenge — a puzzle piece. */
function ChallengeSpotSprite({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s})`}>
      <path d="M-9 -7 H-3 C-3 -12 3 -12 3 -7 H9 V-1 C13 -1 13 5 9 5 V9 H-9 V5 C-13 5 -13 -1 -9 -1 Z" fill="#3b82f6" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      <circle cx={-3} cy={0.5} r={1.7} fill="#bfdbfe" />
    </g>
  );
}

/** Point of interest — a map pin (tip marks the real spot). */
function PoiSpotSprite({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s})`}>
      <path d="M0 0 C-7 -10 -9 -15 -9 -18 A9 9 0 1 1 9 -18 C9 -15 7 -10 0 0 Z" fill="#ec4899" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      <circle cx={0} cy={-18} r={3.4} fill="#fff" stroke={INK} strokeWidth={1} />
    </g>
  );
}

/** Start — a green flag on a pole. */
function StartSprite({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s})`}>
      <line x1={-7} y1={-13} x2={-7} y2={9} stroke={INK} strokeWidth={2} strokeLinecap="round" />
      <path d="M-7 -13 L8 -9 L-7 -5 Z" fill="#22c55e" stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
      <circle cx={-7} cy={9} r={1.7} fill={INK} />
    </g>
  );
}

/** Finish — a checkered flag on a pole. */
function FinishSprite({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  const cells: [number, number][] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) if ((r + c) % 2 === 0) cells.push([c, r]);
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s})`}>
      <line x1={-7} y1={-13} x2={-7} y2={9} stroke={INK} strokeWidth={2} strokeLinecap="round" />
      <rect x={-7} y={-13} width={14} height={8} fill="#fff" />
      {cells.map(([c, r], i) => (
        <rect key={i} x={-7 + c * 3.5} y={-13 + r * (8 / 3)} width={3.5} height={8 / 3} fill="#111827" />
      ))}
      <rect x={-7} y={-13} width={14} height={8} fill="none" stroke={INK} strokeWidth={1.6} />
    </g>
  );
}

const SPOT_SPRITE: Partial<Record<string, typeof CoinSpotSprite>> = {
  coin: CoinSpotSprite,
  chance: ChanceSpotSprite,
  challenge: ChallengeSpotSprite,
  poi: PoiSpotSprite,
  start: StartSprite,
  finish: FinishSprite,
  bowser: ChallengeSpotSprite, // reuse the challenge sprite for now
};

// Registry seam: a named bar matches a bespoke sprite, else falls back to the
// generic BarSprite. Adding a future hero is a one-line entry here.
type SpriteFn = typeof BarSprite;
const BESPOKE_BARS: { test: RegExp; Sprite: SpriteFn }[] = [
  { test: /fink/i, Sprite: FinksSprite },
  { test: /y[-\s]?not/i, Sprite: YNotSprite },
  { test: /hosed/i, Sprite: HosedSprite },
  { test: /nomad/i, Sprite: NomadSprite },
];
const bespokeBar = (name?: string): SpriteFn | null =>
  (name && BESPOKE_BARS.find((b) => b.test.test(name))?.Sprite) || null;

// Parks are unnamed polygons, so bespoke greens anchor to a real coordinate and
// snap to the nearest park polygon on the board.
const BESPOKE_PARKS: { lat: number; lng: number; Sprite: SpriteFn; sc: number }[] = [
  { lat: 43.0508, lng: -87.9017, Sprite: CassPlaygroundSprite, sc: 1.7 },
  { lat: 43.0553, lng: -87.8959, Sprite: PulaskiFieldSprite, sc: 1.9 },
];

/** Title banner: red ribbon with swallow-tail ends, drawn in the top margin. */
function RibbonSprite({ x, y, text }: { x: number; y: number; text: string }) {
  const w = Math.max(420, text.length * 17 + 90);
  const tail = (sgn: number) => {
    const inner = sgn * (w / 2 - 6);
    const outer = sgn * (w / 2 + 62);
    const notch = sgn * (w / 2 + 36);
    return `${inner},-16 ${outer},-16 ${notch},7 ${outer},30 ${inner},30`;
  };
  return (
    <g transform={`translate(${x.toFixed(0)} ${y.toFixed(0)})`}>
      <polygon points={tail(1)} fill="#8f2d2d" stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
      <polygon points={tail(-1)} fill="#8f2d2d" stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
      <rect x={-w / 2} y={-28} width={w} height={52} rx={3} fill="#b23b3b" stroke={INK} strokeWidth={2} />
      <rect x={-w / 2 + 7} y={-21} width={w - 14} height={38} rx={2} fill="none" stroke="#d98a76" strokeWidth={1.1} />
      <text
        x={0}
        y={9}
        fontSize={30}
        fontWeight={700}
        fontFamily="Georgia, 'Times New Roman', serif"
        letterSpacing={3}
        textAnchor="middle"
        fill="#fff6e0"
      >
        {text.toUpperCase()}
      </text>
    </g>
  );
}

/** Corner cartouche: compass rose with a beer stein at its heart. */
function CartoucheSprite({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x.toFixed(0)} ${y.toFixed(0)}) scale(${s.toFixed(2)})`}>
      <circle r={30} fill="#f5efdf" stroke={INK} strokeWidth={1.6} />
      <circle r={25} fill="none" stroke={INK} strokeWidth={0.7} />
      {[45, 135, 225, 315].map((a) => (
        <polygon key={a} points="0,-16 2.4,-2.6 0,0 -2.4,-2.6" fill="#8a8471" stroke={INK} strokeWidth={0.35} transform={`rotate(${a})`} />
      ))}
      {[0, 90, 180, 270].map((a) => (
        <polygon
          key={a}
          points="0,-23 3,-3.2 0,0 -3,-3.2"
          fill={a % 180 === 0 ? '#b23b3b' : '#3a362f'}
          stroke={INK}
          strokeWidth={0.4}
          transform={`rotate(${a})`}
        />
      ))}
      <circle r={5.6} fill="#f5efdf" stroke={INK} strokeWidth={0.7} />
      <rect x={-2.4} y={-2.6} width={4.4} height={5} rx={0.4} fill="#e8a33d" stroke={INK} strokeWidth={0.5} />
      <path d="M 2 -1.4 A 1.6 1.6 0 0 1 2 1.6" fill="none" stroke={INK} strokeWidth={0.6} />
      <ellipse cx={-0.2} cy={-2.7} rx={2.4} ry={1} fill="#fffdf5" stroke={INK} strokeWidth={0.4} />
      <text y={-33.5} fontSize={8} fontWeight={700} textAnchor="middle" fill={INK} fontFamily="Georgia, serif">
        N
      </text>
    </g>
  );
}

function CloudSprite({ x, y, s, v = 0, flip = false }: { x: number; y: number; s: number; v?: number; flip?: boolean }) {
  // three silhouettes so a field of clouds doesn't read as one repeated shape
  const shapes: [number, number, number][][] = [
    [
      [0, 0, 15],
      [14, 3, 10],
      [-15, 3, 10],
      [7, -8, 11],
      [-8, -7, 9],
    ],
    [
      [0, 1, 13],
      [16, 4, 9],
      [-14, 4, 11],
      [24, 6, 7],
      [4, -9, 10],
      [-10, -6, 8],
    ],
    [
      [0, 0, 12],
      [11, 2, 11],
      [-12, 3, 9],
      [-2, -8, 9],
      [12, -6, 7],
    ],
  ];
  const puffs = shapes[v % shapes.length];
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${flip ? -s : s} ${s})`} opacity={0.95}>
      {puffs.map(([cx, cy, r], i) => (
        <circle key={`o${i}`} cx={cx} cy={cy} r={r} fill="#ffffff" stroke="#b9b29e" strokeWidth={1.6} />
      ))}
      {puffs.map(([cx, cy, r], i) => (
        <circle key={`f${i}`} cx={cx} cy={cy} r={r} fill="#ffffff" />
      ))}
    </g>
  );
}

function pointInPolyLL(p: LatLng, poly: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lng;
    const yi = poly[i].lat;
    const xj = poly[j].lng;
    const yj = poly[j].lat;
    if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const rad = (d: number) => (d * Math.PI) / 180;
const degOf = (r: number) => (r * 180) / Math.PI;
function bearing(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return degOf(Math.atan2(y, x));
}

/** Split a polyline at its halfway point; returns the two halves + the midpoint. */
function splitAtMid(line: [number, number][]) {
  if (line.length < 2) return { first: line, second: line, mid: line[0], brg: 0 };
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    const d = metersBetween(
      { lat: line[i - 1][0], lng: line[i - 1][1] },
      { lat: line[i][0], lng: line[i][1] },
    );
    seg.push(d);
    total += d;
  }
  const half = total / 2;
  let acc = 0;
  let i = 0;
  for (; i < seg.length - 1; i++) {
    if (acc + seg[i] >= half) break;
    acc += seg[i];
  }
  const t = seg[i] === 0 ? 0 : (half - acc) / seg[i];
  const a = line[i];
  const b = line[i + 1];
  const mid: [number, number] = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  return {
    first: [...line.slice(0, i + 1), mid] as [number, number][],
    second: [mid, ...line.slice(i + 1)] as [number, number][],
    mid,
    brg: bearing({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }),
  };
}

function MapController({ board, recage }: { board: Board; recage: number }) {
  const map = useMap();
  useEffect(() => {
    if (board.phase === 'area' || board.boundary.length < 3) {
      map.setMinZoom(13);
      map.setMaxZoom(18);
      map.setMaxBounds(null as unknown as L.LatLngBounds);
      map.options.maxBoundsViscosity = 0;
      return;
    }
    const skyPad = board.phase === 'squares' ? 0.14 : 0; // extra blue sky around the board
    const bounds = L.latLngBounds(
      board.boundary.map((p) => [p.lat, p.lng] as [number, number]),
    ).pad(board.padding + skyPad);
    const fitZoom = map.getBoundsZoom(bounds);
    map.setMinZoom(fitZoom);
    map.setMaxZoom(fitZoom + 3);
    map.setMaxBounds(bounds);
    map.options.maxBoundsViscosity = 1.0;
    map.fitBounds(bounds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, board.phase, board.padding, recage]);
  return null;
}

function ClickHandler({ enabled, onClick }: { enabled: boolean; onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => enabled && onClick(e.latlng.lat, e.latlng.lng) });
  return null;
}

interface Props {
  board: Board;
  mode: Mode;
  selectedId: string | null;
  selectedVertex: number | null;
  selectedEdgeId: string | null;
  recage: number;
  onMapClick: (lat: number, lng: number) => void;
  onSelectSquare: (id: string) => void;
  onMoveSquare: (id: string, lat: number, lng: number) => void;
  onSelectVertex: (index: number) => void;
  onMoveVertex: (index: number, lat: number, lng: number) => void;
  onDeleteVertex: (index: number) => void;
  onSelectEdge: (id: string) => void;
  /** Play mode: intersection nodes become clickable check-in spots. */
  playActive?: boolean;
  cleared?: string[];
  onCheckIn?: (id: string) => void;
  nodeType?: Record<string, string>;
  starBars?: string[];
  spawns?: { id: string; lat: number; lng: number }[];
  onClaimSpawn?: (id: string) => void;
  /** Bars currently under a star claim (meter ring). */
  starClaims?: { barSpotId: string; pct: number; mine: boolean }[];
  /** Live team tokens (other players) drawn on the board. */
  tokens?: { teamId: string; lat: number; lng: number; emoji: string; name: string; me?: boolean }[];
}

const WORLD_RING: [number, number][] = [
  [-89, -179],
  [-89, 179],
  [89, 179],
  [89, -179],
];

/** Push a ring's vertices outward by `meters` (along the corner bisectors), so
 * the board-edge mask clears streets that bow slightly past the drawn boundary. */
function expandRing(ring: [number, number][], meters: number): [number, number][] {
  if (ring.length < 3) return ring;
  const kx = Math.cos((ring[0][0] * Math.PI) / 180) * 111320;
  const ky = 111320;
  const xs = ring.map(([, lng]) => lng * kx);
  const ys = ring.map(([lat]) => lat * ky);
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) area += xs[j] * ys[i] - xs[i] * ys[j];
  const ccw = area > 0;
  const n = ring.length;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n;
    const q = (i + 1) % n;
    const normal = (ax: number, ay: number, bx: number, by: number): [number, number] => {
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      return ccw ? [dy / len, -dx / len] : [-dy / len, dx / len];
    };
    const n1 = normal(xs[p], ys[p], xs[i], ys[i]);
    const n2 = normal(xs[i], ys[i], xs[q], ys[q]);
    let bx = n1[0] + n2[0];
    let by = n1[1] + n2[1];
    const bl = Math.hypot(bx, by);
    if (bl < 1e-6) {
      bx = n1[0];
      by = n1[1];
    } else {
      bx /= bl;
      by /= bl;
    }
    const dot = Math.max(0.4, bx * n1[0] + by * n1[1]); // cap miter growth at sharp corners
    out.push([(ys[i] + (by * meters) / dot) / ky, (xs[i] + (bx * meters) / dot) / kx]);
  }
  return out;
}

export default function BoardCanvas({
  board,
  mode,
  selectedId,
  selectedVertex,
  selectedEdgeId,
  recage,
  onMapClick,
  onSelectSquare,
  onMoveSquare,
  onSelectVertex,
  onMoveVertex,
  onDeleteVertex,
  onSelectEdge,
  playActive = false,
  cleared,
  onCheckIn,
  nodeType,
  starBars,
  spawns,
  onClaimSpawn,
  starClaims,
  tokens,
}: Props) {
  const clearedSet = useMemo(() => new Set(cleared ?? []), [cleared]);
  const starSet = useMemo(() => new Set(starBars ?? []), [starBars]);
  const ring = board.boundary.map((p) => [p.lat, p.lng] as [number, number]);
  const closed = board.boundaryClosed && ring.length >= 3;
  const editingArea = board.phase === 'area';
  const placingSquares = board.phase === 'squares';
  // Grass reaches the mask edge (junctions sit ~12m outside the drawn line).
  const groundRing = closed ? expandRing(ring, 30) : ring;

  const byId = new Map(board.squares.map((s) => [s.id, s]));

  const edgeLine = (edge: Board['edges'][number]): [number, number][] | null => {
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    if (!a || !b) return null;
    const pts =
      edge.path && edge.path.length >= 2 ? edge.path : [{ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }];
    return pts.map((p) => [p.lat, p.lng] as [number, number]);
  };

  // Equirectangular frame for the board SVG: world meters, y down.
  const geo = useMemo(() => {
    if (board.boundary.length < 3) return null;
    const lats = board.boundary.map((p) => p.lat);
    const lngs = board.boundary.map((p) => p.lng);
    const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const kx = Math.cos((midLat * Math.PI) / 180) * 111320;
    const ky = 111320;
    const padM = 620; // room for the sky + clouds around the board
    const minLat = Math.min(...lats) - padM / ky;
    const maxLat = Math.max(...lats) + padM / ky;
    const minLng = Math.min(...lngs) - padM / kx;
    const maxLng = Math.max(...lngs) + padM / kx;
    return { minLat, maxLat, minLng, maxLng, kx, ky, W: (maxLng - minLng) * kx, H: (maxLat - minLat) * ky };
  }, [board.boundary]);

  // Bars and POIs become storefront art snapped to face the nearest street,
  // standing 17m off the centerline (clear of the 26m-wide track) on their
  // real-world side. Bars claim spots first; nearby POIs dedupe away.
  interface Front {
    kind: 'bar' | 'shop' | 'church' | 'civic' | 'theater' | 'museum' | 'hedwigs';
    x: number;
    y: number;
    s: number;
    c: number;
    icon: string;
    name?: string;
  }
  const fronts = useMemo(() => {
    if (!geo || !board.scenery) return [] as Front[];
    const toX = (p: LatLng) => (p.lng - geo.minLng) * geo.kx;
    const toY = (p: LatLng) => (geo.maxLat - p.lat) * geo.ky;
    const segs: [number, number, number, number][] = [];
    for (const e of board.edges) {
      if (!e.path || e.path.length < 2) continue;
      for (let i = 1; i < e.path.length; i++) {
        segs.push([toX(e.path[i - 1]), toY(e.path[i - 1]), toX(e.path[i]), toY(e.path[i])]);
      }
    }
    const out: Front[] = [];
    const push = (p: LatLng, kind: Front['kind'], icon: string, name?: string) => {
      const px = toX(p);
      const py = toY(p);
      const base =
        kind === 'hedwigs'
          ? 1.35
          : kind === 'church'
            ? 2.1
            : kind === 'theater'
              ? 2
              : kind === 'museum'
                ? 1.8
                : kind === 'bar'
                  ? 2.0
                  : kind === 'civic'
                    ? 1.8
                    : 1.7;
      // upward sprite extent (world meters) — caps how far a south-facing front
      // drapes over the street now that buildings draw above the track.
      const localH =
        kind === 'hedwigs' ? 48 : kind === 'church' ? 23 : kind === 'theater' ? 14 : kind === 'museum' || kind === 'civic' ? 12 : kind === 'bar' ? 12 : 11;
      const effH = localH * base;
      let best: { d: number; qx: number; qy: number; dx: number; dy: number; len: number } | null = null;
      for (const [ax, ay, bx, by] of segs) {
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        if (!len2) continue;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        const qx = ax + t * dx;
        const qy = ay + t * dy;
        const d = Math.hypot(px - qx, py - qy);
        if (d < (best?.d ?? Infinity)) best = { d, qx, qy, dx, dy, len: Math.sqrt(len2) };
      }
      let x = px;
      let y = py;
      if (best && best.d < 60) {
        let nx = -best.dy / best.len;
        let ny = best.dx / best.len;
        if ((px - best.qx) * nx + (py - best.qy) * ny < 0) {
          nx = -nx;
          ny = -ny;
        }
        // grow = share of upward growth heading into the street; set the front
        // back enough that its roof covers ≤1/3 of the street (clamped at 40m so
        // the tall church spires don't float far off their street).
        const grow = Math.max(0, ny);
        const off = Math.min(40, Math.max(17, CASING_M / 6 + effH * grow));
        x = best.qx + nx * off;
        y = best.qy + ny * off;
      }
      // keep the masked margin quiet: only place art inside the play area
      const ll = { lat: geo.maxLat - y / geo.ky, lng: geo.minLng + x / geo.kx };
      if (!pointInPolyLL(ll, board.boundary) && !pointInPolyLL(p, board.boundary)) return;
      const hero = kind === 'church' || kind === 'theater' || kind === 'museum' || kind === 'hedwigs';
      for (const q of out) if (Math.hypot(q.x - x, q.y - y) < (hero ? 26 : 22)) return;
      const h = hash01(x, y);
      out.push({ kind, x, y, s: base + h * 0.2, c: Math.floor(h * 89), icon, name });
    };
    const kindOf = (e: string): Front['kind'] =>
      e === '⛪'
        ? 'church'
        : e === '🎭' || e === '🎬'
          ? 'theater'
          : e === '🏛️' || e === '🏛'
            ? 'museum'
            : ['🏫', '🏦', '🏥', '📚'].includes(e)
              ? 'civic'
              : 'shop';
    // Heroes claim ground first, then bars, then the everyday storefronts.
    const heroes = board.scenery.pois.filter((p) => ['church', 'theater', 'museum'].includes(kindOf(p.emoji)));
    const everyday = board.scenery.pois.filter((p) => !['church', 'theater', 'museum'].includes(kindOf(p.emoji)));
    for (const p of heroes) {
      const kind = kindOf(p.emoji) === 'church' && /hedwig/i.test(p.name ?? '') ? 'hedwigs' : kindOf(p.emoji);
      push(p, kind, p.emoji);
    }
    for (const bar of board.scenery.bars) push(bar, 'bar', '🍺', bar.name);
    for (const p of everyday) push(p, kindOf(p.emoji), p.emoji);
    return out;
  }, [geo, board.scenery, board.edges]);

  // The city fabric grows along the STREETS, like real lots: buildings line
  // both sides of every path at a fixed setback (behind the parkway trees),
  // typed by the land-use block they stand in; bushes fill deep block
  // interiors. Deterministic (hash of position), identical every render.
  interface Fab {
    t: 'house' | 'shopRow' | 'warehouse' | 'bush';
    x: number;
    y: number;
    s: number;
    c: number;
    v: number;
  }
  const fabric = useMemo(() => {
    if (!SHOW_FABRIC || !geo || !board.scenery) return [] as Fab[];
    const toX = (p: LatLng) => (p.lng - geo.minLng) * geo.kx;
    const toY = (p: LatLng) => (geo.maxLat - p.lat) * geo.ky;
    const toLL = (x: number, y: number): LatLng => ({ lat: geo.maxLat - y / geo.ky, lng: geo.minLng + x / geo.kx });
    const out: Fab[] = [];
    const deg = new Map<string, number>();
    for (const e of board.edges) {
      deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
      deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
    }
    const junctions = board.squares
      .filter((sq) => (deg.get(sq.id) ?? 0) >= 3)
      .map((sq) => [toX(sq), toY(sq)] as [number, number]);
    const inAny = (p: LatLng, polys: LatLng[][]) => polys.some((ring) => ring.length >= 3 && pointInPolyLL(p, ring));
    // Every street segment (in world meters) + a squared point-distance helper,
    // so we can cap how far a building's roof grows into ANY nearby street.
    interface Seg { ax: number; ay: number; dx: number; dy: number; l2: number }
    const streetSegs: Seg[] = [];
    for (const e of board.edges) {
      if (!e.path || e.path.length < 2) continue;
      const xy = e.path.map((p) => [toX(p), toY(p)] as [number, number]);
      for (let i = 1; i < xy.length; i++) {
        const dx = xy[i][0] - xy[i - 1][0];
        const dy = xy[i][1] - xy[i - 1][1];
        streetSegs.push({ ax: xy[i - 1][0], ay: xy[i - 1][1], dx, dy, l2: dx * dx + dy * dy || 1 });
      }
    }
    const d2seg = (x: number, y: number, s: Seg) => {
      let t = ((x - s.ax) * s.dx + (y - s.ay) * s.dy) / s.l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = s.ax + t * s.dx;
      const qy = s.ay + t * s.dy;
      return (x - qx) ** 2 + (y - qy) ** 2;
    };
    const SETBACK = 22; // clear of the 26m track, behind the 17m parkway trees
    const STEP = 24; // narrow Milwaukee lots
    for (const e of board.edges) {
      if (!e.path || e.path.length < 2) continue;
      const xy = e.path.map((p) => [toX(p), toY(p)] as [number, number]);
      const arc = [0];
      for (let i = 1; i < xy.length; i++) arc.push(arc[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
      const total = arc[arc.length - 1];
      for (let d = STEP / 2; d < total; d += STEP) {
        let seg = 0;
        while (seg < xy.length - 2 && arc[seg + 1] < d) seg++;
        const span = arc[seg + 1] - arc[seg] || 1;
        const tt = (d - arc[seg]) / span;
        const px = xy[seg][0] + tt * (xy[seg + 1][0] - xy[seg][0]);
        const py = xy[seg][1] + tt * (xy[seg + 1][1] - xy[seg][1]);
        const ux = (xy[seg + 1][0] - xy[seg][0]) / span;
        const uy = (xy[seg + 1][1] - xy[seg][1]) / span;
        for (const sgn of [1, -1]) {
          // Sprites grow upward (north); one on the SOUTH side of a street grows
          // toward it. Sample its type/scale at the base setback, then set it back
          // by (height × how perpendicular the street is) so the roof drapes over
          // at most 1/3 of the street width.
          const grow = Math.max(0, ux * sgn); // toward-street share of upward growth
          const bx = px - uy * SETBACK * sgn;
          const by = py + ux * SETBACK * sgn;
          const bll = toLL(bx, by);
          if (!pointInPolyLL(bll, board.boundary)) continue;
          let t: Fab['t'] = 'house';
          for (const blk of board.scenery.blocks) {
            if (blk.ring.length >= 3 && pointInPolyLL(bll, blk.ring)) {
              t = blk.kind === 'residential' ? 'house' : blk.kind === 'industrial' ? 'warehouse' : 'shopRow';
              break;
            }
          }
          const h = hash01(bx, by);
          if (t === 'warehouse' && h < 0.4) continue; // warehouses are wide — thin them out
          const s = t === 'house' ? 1.4 + h * 0.4 : t === 'shopRow' ? 1.35 + h * 0.25 : 1.35 + h * 0.3;
          const effH = (t === 'house' ? 17 : t === 'shopRow' ? 11 : 8) * s; // upward extent, m
          const setback = Math.max(SETBACK, CASING_M / 6 + effH * grow);
          const hx = px - uy * setback * sgn;
          const hy = py + ux * setback * sgn;
          const ll = toLL(hx, hy);
          if (!pointInPolyLL(ll, board.boundary)) continue;
          if (junctions.some(([jx, jy]) => Math.hypot(jx - hx, jy - hy) < 27)) continue;
          if (fronts.some((f) => Math.hypot(f.x - hx, f.y - hy) < 20)) continue;
          if (out.some((o) => Math.hypot(o.x - hx, o.y - hy) < 17)) continue;
          if (inAny(ll, board.scenery.water) || inAny(ll, board.scenery.parks) || inAny(ll, board.scenery.woods)) continue;
          // Grow straight up, but stop before the roof covers more than 1/3 of ANY
          // street it rises into (a tall sprite reaching a cross-street was the real
          // overlap). Shrink to fit; if it'd be too squat, leave grass instead.
          const hBase = t === 'house' ? 17 : t === 'shopRow' ? 11 : 8;
          const clr2 = (CASING_M / 2 - CASING_M / 3 + 0.3) ** 2; // within this of a centerline ⇒ >1/3
          const reach2 = (effH + 14) ** 2;
          const near = streetSegs.filter((sg) => d2seg(hx, hy, sg) <= reach2);
          let hClamp = effH;
          for (let H = 3; H <= effH; H += 1.5) {
            if (near.some((sg) => d2seg(hx, hy - H, sg) < clr2)) {
              hClamp = H - 1.5;
              break;
            }
          }
          let sFinal = s;
          if (hClamp < effH - 0.01) {
            const ns = hClamp / hBase;
            if (ns < 1.15) continue; // too squeezed between streets — leave grass
            sFinal = ns;
          }
          out.push({ t, x: hx, y: hy, s: sFinal, c: Math.floor(h * 97), v: Math.floor(h * 53) });
          if (out.length >= 520) break;
        }
        if (out.length >= 520) break;
      }
      if (out.length >= 520) break;
    }
    // bushes soften the empty block interiors
    let bushes = 0;
    for (const blk of board.scenery.blocks) {
      if (bushes >= 110 || blk.ring.length < 3) continue;
      const bxs = blk.ring.map(toX);
      const bys = blk.ring.map(toY);
      const minX = Math.min(...bxs);
      const maxX = Math.max(...bxs);
      const minY = Math.min(...bys);
      const maxY = Math.max(...bys);
      for (let tr = 0; tr < 6; tr++) {
        const h1 = hash01(minX + tr * 13.7, minY);
        const h2 = hash01(minY + tr * 7.3, maxX);
        const bx = minX + h1 * (maxX - minX);
        const by = minY + h2 * (maxY - minY);
        const ll = toLL(bx, by);
        if (!pointInPolyLL(ll, blk.ring) || !pointInPolyLL(ll, board.boundary)) continue;
        if (out.some((o) => Math.hypot(o.x - bx, o.y - by) < 15)) continue;
        if (fronts.some((f) => Math.hypot(f.x - bx, f.y - by) < 15)) continue;
        const h = hash01(bx, by);
        out.push({ t: 'bush', x: bx, y: by, s: 0.9 + h * 0.6, c: Math.floor(h * 97), v: Math.floor(h * 53) });
        bushes++;
        if (bushes >= 110) break;
      }
    }
    return out.sort((a, b) => a.y - b.y);
  }, [geo, board.scenery, board.boundary, board.edges, board.squares, fronts]);

  // Bespoke green spaces: anchor each to its real coordinate, snapped to the
  // nearest park polygon centroid on the board (so it sits centered in the park).
  const parkFeatures = useMemo(() => {
    if (!board.scenery) return [] as { lat: number; lng: number; Sprite: SpriteFn; sc: number }[];
    const centroid = (ring: LatLng[]) => {
      let la = 0;
      let ln = 0;
      for (const p of ring) {
        la += p.lat;
        ln += p.lng;
      }
      return { lat: la / ring.length, lng: ln / ring.length };
    };
    const cents = board.scenery.parks.filter((r) => r.length >= 3).map(centroid);
    const out: { lat: number; lng: number; Sprite: SpriteFn; sc: number }[] = [];
    for (const a of BESPOKE_PARKS) {
      let best: LatLng | null = null;
      let bd = Infinity;
      for (const c of cents) {
        const d = metersBetween(a, c);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      const at = best && bd < 170 ? best : a;
      if (!pointInPolyLL(at, board.boundary)) continue;
      out.push({ lat: at.lat, lng: at.lng, Sprite: a.Sprite, sc: a.sc });
    }
    return out;
  }, [board.scenery, board.boundary]);

  // The board's spot nodes: road intersections (3+ roads meet) PLUS any square
  // the designer gave an explicit type (e.g. a hand-placed bar).
  const intersections = useMemo(() => {
    const deg = new Map<string, number>();
    for (const e of board.edges) {
      deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
      deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
    }
    return board.squares.filter((sq) => (deg.get(sq.id) ?? 0) >= 3 || sq.type !== 'blank');
  }, [board.edges, board.squares]);

  const X = (p: LatLng | [number, number]) => {
    const lng = Array.isArray(p) ? p[1] : p.lng;
    return (lng - geo!.minLng) * geo!.kx;
  };
  const Y = (p: LatLng | [number, number]) => {
    const lat = Array.isArray(p) ? p[0] : p.lat;
    return (geo!.maxLat - lat) * geo!.ky;
  };
  const ptsOf = (line: (LatLng | [number, number])[]) => line.map((p) => `${X(p).toFixed(1)},${Y(p).toFixed(1)}`).join(' ');
  // Clear a gap in the tree fill for each bespoke park scene so it isn't buried.
  const pfClear = parkFeatures.map((pf) => ({ x: X({ lat: pf.lat, lng: pf.lng }), y: Y({ lat: pf.lat, lng: pf.lng }), r: 24 * pf.sc }));

  return (
    <MapContainer center={board.center} zoom={board.zoom} className="map">
      {/* Real map tiles only during setup; the board itself is stylized art. */}
      {!placingSquares && (
        <TileLayer
          url={VOYAGER_URL}
          subdomains={['a', 'b', 'c', 'd']}
          attribution='&copy; OpenStreetMap contributors &copy; CARTO'
          maxZoom={20}
        />
      )}
      <MapController board={board} recage={recage} />
      <ClickHandler
        enabled={(editingArea && mode === 'boundary') || (placingSquares && mode === 'add')}
        onClick={onMapClick}
      />

      {/* Land-use fills (grass/blocks/parks/water) now render inside the board
          SVG below, so they composite as one illustration with the sprites. */}

      {/* Illustrated-city underlay — baked art beneath the vector game layer */}
      {placingSquares && board.artUnderlay && (
        <ImageOverlay url="/art/board-underlay.webp" bounds={ART_BOUNDS} zIndex={1} />
      )}

      {closed && (
        <Polygon
          positions={[WORLD_RING, placingSquares ? expandRing(ring, 30) : ring]}
          pathOptions={{
            stroke: false,
            fillColor: placingSquares ? '#8fc4e8' : '#020617',
            fillOpacity: placingSquares ? 0.95 : 0.5,
          }}
          interactive={false}
        />
      )}

      {/* Boundary outline — setup phases only; the finished board has no map line. */}
      {!placingSquares &&
        ring.length > 0 &&
        (closed ? (
          <Polygon
            positions={ring}
            pathOptions={{ color: '#2563eb', weight: 2, fillColor: '#60a5fa', fillOpacity: 0.08 }}
            interactive={false}
          />
        ) : (
          <Polyline positions={ring} pathOptions={{ color: '#2563eb', weight: 2, dashArray: '6 4' }} interactive={false} />
        ))}

      {/* THE BOARD — one SVG in world coordinates. Leaflet scales it with zoom
          like a static image: nothing re-renders or re-proportions. */}
      {placingSquares && geo && (
        <SVGOverlay
          bounds={[
            [geo.minLat, geo.minLng],
            [geo.maxLat, geo.maxLng],
          ]}
          attributes={{ viewBox: `0 0 ${geo.W.toFixed(1)} ${geo.H.toFixed(1)}` }}
        >
          <defs>
            {/* subtle lift so the track floats above the scenery */}
            <filter id="track-shadow" x="-5%" y="-5%" width="110%" height="110%">
              <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#3a362f" floodOpacity="0.28" />
            </filter>
          </defs>

          {/* GROUND PLANE — one continuous surface so nothing floats. Grass
              base, then paved tints on non-residential blocks, then greens/water.
              With the art underlay on, the baked image IS the ground plane. */}
          {!board.artUnderlay && <polygon points={ptsOf(groundRing)} fill={GRASS} />}
          {SHOW_BLOCK_TINTS &&
            board.scenery?.blocks.map((b, i) => {
              const lawn = BLOCK_LAWN[b.kind];
              return b.ring.length >= 3 && lawn ? (
                <polygon key={`bl${i}`} points={ptsOf(b.ring)} fill={lawn} opacity={0.92} />
              ) : null;
            })}
          {SHOW_GREENS &&
            board.scenery?.woods.map((r, i) =>
              r.length >= 3 ? <polygon key={`wd${i}`} points={ptsOf(r)} fill={WOOD_FILL} /> : null,
            )}
          {SHOW_GREENS &&
            board.scenery?.parks.map((r, i) =>
              r.length >= 3 ? <polygon key={`pk${i}`} points={ptsOf(r)} fill={PARK_FILL} /> : null,
            )}
          {board.scenery?.water.map((r, i) =>
            r.length >= 3 ? (
              <polygon key={`wt${i}`} points={ptsOf(r)} fill={WATER_FILL} stroke="#3a7b8c" strokeWidth={1.5} />
            ) : null,
          )}

          {/* rivers: dark bank, bright water, dashed current */}
          {board.scenery?.rivers.map((line, i) => (
            <Fragment key={`rv${i}`}>
              <polyline
                points={ptsOf(line)}
                fill="none"
                stroke="#3a7b8c"
                strokeWidth={14}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline
                points={ptsOf(line)}
                fill="none"
                stroke="#8fd8e8"
                strokeWidth={11}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline
                points={ptsOf(line)}
                fill="none"
                stroke="#c3e9f2"
                strokeWidth={1.1}
                strokeDasharray="4 22"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.8}
              />
            </Fragment>
          ))}

          {/* sidewalks — a pale curb strip flanking every street, so buildings
              read as set back on their lots instead of clipped by the track
              (baked into the art underlay when that's active) */}
          {!board.artUnderlay && board.edges.map((edge) => {
            const line = edgeLine(edge);
            if (!line) return null;
            return (
              <polyline
                key={`sw${edge.id}`}
                points={ptsOf(line)}
                fill="none"
                stroke={SIDEWALK}
                strokeWidth={CASING_M + 12}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}

          {/* Buildings, shadows & trees now render ABOVE the track (below the
              closing </g>) so south-side roofs drape over the road edge. */}

          <g filter="url(#track-shadow)">
          {/* track casing */}
          {board.edges.map((edge) => {
            const line = edgeLine(edge);
            if (!line) return null;
            return (
              <polyline
                key={`c${edge.id}`}
                points={ptsOf(line)}
                fill="none"
                stroke={edge.id === selectedEdgeId ? '#a16207' : '#3f3b36'}
                strokeWidth={CASING_M}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}

          {/* road fill — one clean pavement color, round caps so junctions
              merge smoothly. No per-tile coloring, no dividers. */}
          {board.edges.map((edge) => {
            const line = edgeLine(edge);
            if (!line) return null;
            return (
              <polyline
                key={`f${edge.id}`}
                points={ptsOf(line)}
                fill="none"
                stroke={ROAD_FILL}
                strokeWidth={FILL_M}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}

          {/* the "spaces" are the intersections — a node where 3+ roads meet,
              drawn a touch wider than the street so it reads as a distinct pip.
              In play mode a cleared node grays out; the active one glows. */}
          {intersections.map((sq) => {
            if (sq.type === 'bar') return null; // bars render as custom SVG POIs below
            const done = clearedSet.has(sq.id);
            // Explicit type wins (design + play); a blank intersection uses its
            // resolved play type (coin/chance) or stays a plain node in design.
            const t = sq.type !== 'blank' ? sq.type : playActive ? nodeType?.[sq.id] : undefined;
            const Icon = t ? SPOT_SPRITE[t] : undefined;
            if (Icon) {
              return (
                <g key={`n${sq.id}`} opacity={done ? 0.4 : 1}>
                  <Icon x={X(sq)} y={Y(sq)} s={1.15} />
                </g>
              );
            }
            return (
              <circle
                key={`n${sq.id}`}
                cx={X(sq)}
                cy={Y(sq)}
                r={15}
                fill={done ? '#c3bdae' : NODE_FILL}
                stroke={done ? '#8f897a' : '#3f3b36'}
                strokeWidth={3}
                opacity={done ? 0.85 : 1}
              />
            );
          })}

          </g>

          {/* ground shadows anchor every building/hero to the lawn */}
          {fabric.map((h, i) => (
            <ellipse
              key={`sh${i}`}
              cx={h.x}
              cy={h.y + 1.5}
              rx={(h.t === 'warehouse' ? 9 : h.t === 'shopRow' ? 6.2 : h.t === 'bush' ? 3.2 : 5) * h.s}
              ry={h.t === 'bush' ? 1.6 : 2.4}
              fill={SHADOW}
              opacity={0.12}
            />
          ))}
          {SHOW_POIS &&
            fronts.map((f, i) => (
            <ellipse
              key={`shf${i}`}
              cx={f.x}
              cy={f.y + 1.5}
              rx={
                (f.kind === 'hedwigs'
                  ? 9
                  : f.kind === 'bar'
                    ? 7
                    : f.kind === 'theater'
                      ? 7.5
                      : f.kind === 'museum' || f.kind === 'civic'
                        ? 6.5
                        : 5.5) * f.s
              }
              ry={2.6}
              fill={SHADOW}
              opacity={0.12}
            />
          ))}

          {/* buildings ABOVE the track: a south-side roof drapes over the road
              edge instead of being clipped by it. Painter-sorted by y. */}
          {[
            ...fabric.map((h, i) => ({
              y: h.y,
              el:
                h.t === 'house' ? (
                  <HouseSprite key={`h${i}`} x={h.x} y={h.y} s={h.s} c={h.c} v={h.v} />
                ) : h.t === 'warehouse' ? (
                  <WarehouseSprite key={`h${i}`} x={h.x} y={h.y} s={h.s} c={h.c} />
                ) : h.t === 'bush' ? (
                  <BushSprite key={`h${i}`} x={h.x} y={h.y} s={h.s} v={h.v} />
                ) : (
                  <StorefrontSprite key={`h${i}`} x={h.x} y={h.y} s={h.s} c={h.c} />
                ),
            })),
            ...(SHOW_POIS ? fronts : []).map((f, i) => ({
              y: f.y,
              el:
                f.kind === 'bar' ? (
                  (() => {
                    const B = bespokeBar(f.name);
                    return B ? (
                      <B key={`fr${i}`} x={f.x} y={f.y} s={f.s} />
                    ) : (
                      <BarSprite key={`fr${i}`} x={f.x} y={f.y} s={f.s} />
                    );
                  })()
                ) : f.kind === 'hedwigs' ? (
                  <HedwigSprite key={`fr${i}`} x={f.x} y={f.y} s={f.s} />
                ) : f.kind === 'church' ? (
                  <ChurchSprite key={`fr${i}`} x={f.x} y={f.y} s={f.s} />
                ) : f.kind === 'theater' ? (
                  <TheaterSprite key={`fr${i}`} x={f.x} y={f.y} s={f.s} icon={f.icon} />
                ) : f.kind === 'civic' || f.kind === 'museum' ? (
                  <CivicSprite key={`fr${i}`} x={f.x} y={f.y} s={f.s} />
                ) : (
                  <StorefrontSprite key={`fr${i}`} x={f.x} y={f.y} s={f.s} c={f.c} icon={f.icon} />
                ),
            })),
          ]
            .sort((a, b) => a.y - b.y)
            .map((o) => o.el)}

          {/* trees over the track edge too, so canopies overlap the road */}
          {board.scenery?.trees
            .filter((p) => hash01(p.lat * 7.13, p.lng * 3.37) < TREE_KEEP)
            .filter((p) => !pfClear.some((c) => Math.hypot(X(p) - c.x, Y(p) - c.y) < c.r))
            .map((p, i) => {
            const h = hash01(p.lng * 1e4, p.lat * 1e4);
            const s = 0.8 + h * 0.55;
            return (
              <Fragment key={`t${i}`}>
                <ellipse cx={X(p)} cy={Y(p) + 1} rx={4.4 * s} ry={1.8} fill={SHADOW} opacity={0.1} />
                <TreeSprite x={X(p)} y={Y(p)} s={s} v={Math.floor(h * 91)} />
              </Fragment>
            );
          })}

          {/* bespoke green-space scenes (playground, ball field) on their parks */}
          {SHOW_POIS &&
            parkFeatures.map((p, i) => {
              const P = p.Sprite;
              return <P key={`pf${i}`} x={X({ lat: p.lat, lng: p.lng })} y={Y({ lat: p.lat, lng: p.lng })} s={p.sc} />;
            })}

          {/* bar POIs — a custom SVG pinned at the real place (bespoke by name,
              else the generic tavern); dims once cleared/claimed */}
          {intersections
            .filter((sq) => sq.type === 'bar')
            .map((sq) => {
              const B = bespokeBar(sq.title) ?? BarSprite;
              const dim = clearedSet.has(sq.id) || starSet.has(sq.id);
              const claim = starClaims?.find((c) => c.barSpotId === sq.id);
              const cx = X(sq);
              const cy = Y(sq);
              const R = 30;
              const C = 2 * Math.PI * R;
              return (
                <Fragment key={`bar${sq.id}`}>
                  <g opacity={dim ? 0.5 : 1}>
                    <B x={cx} y={cy} s={2} />
                  </g>
                  {claim && (
                    <>
                      <circle cx={cx} cy={cy} r={R} fill="none" stroke="#3f3b36" strokeOpacity={0.22} strokeWidth={5} />
                      <circle
                        cx={cx}
                        cy={cy}
                        r={R}
                        fill="none"
                        stroke={claim.mine ? '#f0c33c' : '#e0533a'}
                        strokeWidth={5}
                        strokeLinecap="round"
                        strokeDasharray={C}
                        strokeDashoffset={C * (1 - claim.pct)}
                        transform={`rotate(-90 ${cx} ${cy})`}
                        style={{ transition: 'stroke-dashoffset 0.5s linear' }}
                      />
                    </>
                  )}
                </Fragment>
              );
            })}

          {/* (dividers & one-way arrows removed — the road is one clean path) */}

          {/* selected-space glow + emoji for special spaces */}
          {board.squares.map((sq) => {
            const sel = sq.id === selectedId;
            if (sq.type === 'blank' && !sel) return null;
            return (
              <Fragment key={`e${sq.id}`}>
                {sel && <circle cx={X(sq)} cy={Y(sq)} r={13} fill="rgba(253,224,71,0.65)" />}
                {sq.type !== 'blank' && SHOW_POIS && (
                  <text x={X(sq)} y={Y(sq)} fontSize={15} textAnchor="middle" dominantBaseline="central">
                    {SQUARE_TYPES[sq.type].emoji}
                  </text>
                )}
              </Fragment>
            );
          })}


          {/* dynamic spawns — glowing first-come drops */}
          {spawns?.map((s) => (
            <g key={`spw${s.id}`}>
              <circle cx={X(s)} cy={Y(s)} r={22} fill="none" stroke="#ffcf4a" strokeWidth={1.5} opacity={0.7} />
              <circle cx={X(s)} cy={Y(s)} r={18} fill="#ffe08a" stroke="#c8901a" strokeWidth={2.5} />
              <text x={X(s)} y={Y(s)} fontSize={17} textAnchor="middle" dominantBaseline="central">
                🎁
              </text>
            </g>
          ))}

          {/* live team tokens (other players' positions) */}
          {tokens?.map((tk) => (
            <g key={`tok${tk.teamId}`}>
              <circle
                cx={X(tk)}
                cy={Y(tk)}
                r={14}
                fill={tk.me ? '#fde047' : '#ffffff'}
                stroke="#3f3b36"
                strokeWidth={2.6}
              />
              <text x={X(tk)} y={Y(tk)} fontSize={14} textAnchor="middle" dominantBaseline="central">
                {tk.emoji}
              </text>
              <text
                x={X(tk)}
                y={Y(tk) + 22}
                fontSize={8}
                fontWeight={700}
                textAnchor="middle"
                fill="#3f3b36"
                stroke="#fff"
                strokeWidth={2.4}
                paintOrder="stroke"
              >
                {tk.name}
              </text>
            </g>
          ))}

          {/* clouds scattered across the whole blue sky around the board */}
          {closed &&
            (() => {
              const clouds: JSX.Element[] = [];
              const keepOut = expandRing(ring, 48).map(([lat, lng]) => ({ lat, lng }));
              const step = 175;
              const cols = Math.ceil(geo.W / step);
              const rows = Math.ceil(geo.H / step);
              for (let gx = 0; gx <= cols; gx++) {
                for (let gy = 0; gy <= rows; gy++) {
                  const jx = hash01(gx * 3.13 + 1, gy * 7.71 + 2);
                  const jy = hash01(gy * 5.37 + 3, gx * 2.91 + 4);
                  const cx = (gx + (jx - 0.5) * 0.85) * step;
                  const cy = (gy + (jy - 0.5) * 0.85) * step;
                  const ll = { lat: geo.maxLat - cy / geo.ky, lng: geo.minLng + cx / geo.kx };
                  if (pointInPolyLL(ll, keepOut)) continue; // keep clouds off the board itself
                  const h = hash01(cx, cy);
                  if (h < 0.34) continue; // scatter, not a solid sheet
                  clouds.push(
                    <CloudSprite key={`sky${gx}-${gy}`} x={cx} y={cy} s={0.9 + h * 0.8} v={Math.floor(jx * 3)} flip={jy < 0.5} />,
                  );
                }
              }
              return clouds;
            })()}

          {/* board-game garnish: title ribbon + compass cartouche */}
          <RibbonSprite x={geo.W / 2} y={100} text="Lower East Side" />
          <CartoucheSprite x={geo.W - 165} y={geo.H - 175} s={1.5} />
        </SVGOverlay>
      )}

      {/* PLAY MODE — each intersection node is a clickable check-in spot. */}
      {placingSquares &&
        playActive &&
        intersections.map((sq) => (
          <Marker
            key={`play-${sq.id}`}
            position={[sq.lat, sq.lng]}
            icon={hitIcon(sq.type === 'bar' ? 50 : 34)}
            opacity={0}
            interactive
            eventHandlers={{ click: () => onCheckIn?.(sq.id) }}
          />
        ))}
      {placingSquares &&
        playActive &&
        spawns?.map((s) => (
          <Marker
            key={`spawn-${s.id}`}
            position={[s.lat, s.lng]}
            icon={hitIcon(40)}
            opacity={0}
            interactive
            eventHandlers={{ click: () => onClaimSpawn?.(s.id) }}
          />
        ))}

      {/* INVISIBLE hit layers — the SVG above is pointer-transparent, so these
          keep tiles/dividers/spaces clickable and spaces draggable. */}
      {placingSquares &&
        !playActive &&
        board.edges.map((edge) => {
          const line = edgeLine(edge);
          const from = byId.get(edge.from);
          const to = byId.get(edge.to);
          if (!line || !from || !to) return null;
          const { first, second, mid } = splitAtMid(line);
          const opts = { weight: 26, opacity: 0, lineCap: 'butt' as const, lineJoin: 'round' as const };
          return (
            <Fragment key={`hit-${edge.id}`}>
              <Polyline
                positions={first}
                pathOptions={opts}
                interactive={mode === 'select'}
                eventHandlers={{ click: () => onSelectSquare(edge.from) }}
              />
              <Polyline
                positions={second}
                pathOptions={opts}
                interactive={mode === 'select'}
                eventHandlers={{ click: () => onSelectSquare(edge.to) }}
              />
              <Marker
                position={mid}
                icon={hitIcon(26)}
                interactive={mode === 'select'}
                opacity={0}
                eventHandlers={{ click: () => onSelectEdge(edge.id) }}
              />
            </Fragment>
          );
        })}
      {placingSquares &&
        !playActive &&
        board.squares.map((sq) => (
          <Marker
            key={`hs-${sq.id}`}
            position={[sq.lat, sq.lng]}
            icon={hitIcon(30)}
            opacity={0}
            draggable={mode === 'select'}
            interactive={mode === 'select' || mode === 'connect'}
            eventHandlers={{
              click: () => onSelectSquare(sq.id),
              dragend: (e) => {
                const ll = (e.target as L.Marker).getLatLng();
                onMoveSquare(sq.id, ll.lat, ll.lng);
              },
            }}
          />
        ))}

      {/* Boundary handles — only in the Area step */}
      {editingArea &&
        board.boundary.map((p, i) => (
          <Marker
            key={`v${i}`}
            position={[p.lat, p.lng]}
            icon={i === selectedVertex ? vertexIconSel : vertexIcon}
            draggable
            eventHandlers={{
              click: () => onSelectVertex(i),
              contextmenu: (e) => {
                (e as unknown as { originalEvent: Event }).originalEvent.preventDefault();
                onDeleteVertex(i);
              },
              dragend: (e) => {
                const ll = (e.target as L.Marker).getLatLng();
                onMoveVertex(i, ll.lat, ll.lng);
              },
            }}
          />
        ))}
    </MapContainer>
  );
}
