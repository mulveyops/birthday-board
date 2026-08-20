// The illustrated-city scene, rendered INSIDE the board's own SVG so every
// sprite shares the track's coordinate frame — perfect alignment, crisp at
// every zoom. Data + symbols are baked offline (art-prototype/generate.mjs
// `full raster export-app`) from real OSM footprints, the city street-tree
// inventory, and the board graph; this layer just projects and draws.
import { Fragment, useEffect, useState } from 'react';
import type { CullRect } from './PanZoom';

/** Point inside the render window (with margin for the sprite's extent)? */
const ptIn = (c: CullRect | null | undefined, x: number, y: number, m: number) =>
  !c || (x >= c.x0 - m && x <= c.x1 + m && y >= c.y0 - m && y <= c.y1 + m);
/** Projected bounding box of a point run overlaps the render window? */
const lineIn = (c: CullRect | null | undefined, X: Proj, Y: Proj, line: [number, number][], m: number) => {
  if (!c || !line.length) return true;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of line) {
    const x = X(p), y = Y(p);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return maxX >= c.x0 - m && minX <= c.x1 + m && maxY >= c.y0 - m && minY <= c.y1 + m;
};

interface GroundEnt { ref: string; lat: number; lng: number; sc: number; rot: number }
interface StandingEnt {
  t: 'use' | 'img';
  ref?: string; href?: string;
  lat: number; lng: number;
  sc?: number; w?: number; h?: number; ax?: number; ay?: number;
  style?: string; mir?: boolean;
  sh?: [number, number];
  label?: string; labelDy?: number; labelFs?: number;
}
interface SceneData {
  ground: GroundEnt[];
  standing: StandingEnt[];
  props: { k: string; pts: [number, number][] }[];
  parks: [number, number][][];
}

type SceneCache = { defs: string; data: SceneData };
let cache: SceneCache | null = null;
let pending: Promise<SceneCache | null> | null = null;
async function loadScene() {
  if (cache) return cache;
  pending ??= Promise.all([
    fetch('/art/scene-defs.svg').then((r) => r.text()),
    fetch('/art/scene.json').then((r) => r.json()),
  ]).then(([defs, data]) => (cache = { defs, data }));
  return pending;
}
function useScene() {
  const [scene, setScene] = useState(cache);
  useEffect(() => {
    if (!scene) loadScene().then(setScene).catch(() => undefined);
  }, [scene]);
  return scene;
}

type Proj = (p: { lat: number; lng: number } | [number, number]) => number;

const PROP_STYLE: Record<string, { stroke: string; width: number; opacity: number; dash?: string }> = {
  driveway: { stroke: '#cfc7ae', width: 2.8, opacity: 0.9 },
  alley: { stroke: '#d8cfb6', width: 5.5, opacity: 0.9 },
  walk: { stroke: '#e3dbc6', width: 1.3, opacity: 0.95 },
  fence: { stroke: '#a08453', width: 0.55, opacity: 0.75, dash: '2.1 1.5' },
  retaining_wall: { stroke: '#a29a8a', width: 1.25, opacity: 0.9 },
  wall: { stroke: '#a29a8a', width: 1.05, opacity: 0.9 },
  hedge: { stroke: '#4f8f45', width: 1.9, opacity: 0.85 },
};

/** Everything that lies ON the ground: park tints, lot fabric, courts. */
export function SceneGround({ X, Y, cull }: { X: Proj; Y: Proj; cull?: CullRect | null }) {
  const scene = useScene();
  if (!scene) return null;
  const pts = (line: [number, number][]) => line.map((p) => `${X(p).toFixed(1)},${Y(p).toFixed(1)}`).join(' ');
  return (
    <g>
      <defs dangerouslySetInnerHTML={{ __html: scene.defs }} />
      {scene.data.parks.map((ring, i) =>
        !lineIn(cull, X, Y, ring, 20) ? null : (
        <polygon key={`pk${i}`} points={pts(ring)} fill="#a2d06c" stroke="#92c05d" strokeWidth={1.2} strokeLinejoin="round" />
      ))}
      {scene.data.props.map((p, i) => {
        if (!lineIn(cull, X, Y, p.pts, 20)) return null;
        if (p.k === 'parking') {
          return <polygon key={`pp${i}`} points={pts(p.pts)} fill="#cfc9b8" stroke="#b9b2a0" strokeWidth={0.6} opacity={0.9} />;
        }
        const st = PROP_STYLE[p.k] ?? PROP_STYLE.fence;
        return (
          <polyline
            key={`pp${i}`}
            points={pts(p.pts)}
            fill="none"
            stroke={st.stroke}
            strokeWidth={st.width}
            strokeLinecap="round"
            strokeDasharray={st.dash}
            opacity={st.opacity}
          />
        );
      })}
      {scene.data.ground.map((e, i) =>
        !ptIn(cull, X(e), Y(e), 50) ? null : (
        <use
          key={`g${i}`}
          href={`#${e.ref}`}
          transform={`translate(${X(e).toFixed(1)} ${Y(e).toFixed(1)}) rotate(${e.rot}) scale(${e.sc})`}
        />
      ))}
    </g>
  );
}

/** Buildings, trees, cars, heroes — painter-sorted upstream at bake time. */
export function SceneStanding({ X, Y, cull }: { X: Proj; Y: Proj; cull?: CullRect | null }) {
  const scene = useScene();
  if (!scene) return null;
  return (
    <g>
      {scene.data.standing.map((e, i) => {
        const x = X(e), y = Y(e);
        // margin covers the widest sprites (hero buildings, wide rasters)
        if (!ptIn(cull, x, y, Math.max(e.w ?? 0, 80))) return null;
        if (e.t === 'img') {
          return (
            <image
              key={`s${i}`}
              href={e.href}
              x={(x - (e.w ?? 0) * (e.ax ?? 0.5)).toFixed(1)}
              y={(y - (e.h ?? 0) * (e.ay ?? 1)).toFixed(1)}
              width={e.w}
              height={e.h}
            />
          );
        }
        if (e.w != null) {
          // raster fabric sprite: def is authored at scale 1, instance scales it
          return (
            <use
              key={`s${i}`}
              href={`#${e.ref}`}
              transform={`translate(${(x - e.w * (e.ax ?? 0.5)).toFixed(1)} ${(y - (e.h ?? 0) * (e.ay ?? 1)).toFixed(1)}) scale(${e.sc ?? 1})`}
            />
          );
        }
        const sc = e.sc ?? 1;
        return (
          <Fragment key={`s${i}`}>
            {e.sh && <ellipse cx={x + 1.2} cy={y + 1.3} rx={e.sh[0]} ry={e.sh[1]} fill="#2c2318" opacity={0.13} />}
            <use
              href={`#${e.ref}`}
              transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${e.mir ? -sc : sc} ${sc})`}
              style={e.style ? (Object.fromEntries(e.style.split(';').map((kv) => kv.split(':'))) as React.CSSProperties) : undefined}
            />
            {e.label && (
              <text
                x={x}
                y={y - (e.labelDy ?? 8)}
                fontSize={e.labelFs ?? 1.7}
                fontWeight={700}
                textAnchor="middle"
                fill="#f2c94c"
                letterSpacing={0.12}
              >
                {e.label}
              </text>
            )}
          </Fragment>
        );
      })}
    </g>
  );
}
