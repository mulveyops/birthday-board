// A flat pan/zoom viewport for the player board - the deliberate replacement
// for Leaflet in play mode. The whole layout is three numbers - scale, tx, ty -
// re-derived from the MEASURED container on every resize, so "centered" is
// arithmetic, not stored state that can go stale.
//
// Smoothness architecture: during a gesture the LIVE view lives in a ref and
// is painted straight onto the DOM once per animation frame - React re-renders
// only at commit points (gesture end, wheel settling, fit changes). A pinch
// never waits on a render cycle, and mid-gesture parent re-renders cannot
// stomp the transform because the style prop does not carry it.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface View {
  s: number;
  tx: number;
  ty: number;
  fit: number;
}

/** World-space window the child should bother rendering (null = everything). */
export interface CullRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Culling kicks in past this multiple of the fit scale. Below it the whole
// board rasterizes cheaply; above it, painting offscreen sprites at high
// device resolution is what froze pans for seconds on phones.
const CULL_ZOOM = 2;

interface Props {
  worldW: number;
  worldH: number;
  /** Breathing room around the fitted art (fraction of the fit scale) so the
   * artwork's own border clears rounded screen corners. */
  margin?: number;
  /** Max zoom-in as a multiple of the fitted scale (8 = Leaflet's +3 levels). */
  maxZoomX?: number;
  background?: string;
  /** Zoom above fit in Leaflet-like levels: log2(scale / fit). Fires on
   * commits, not per frame - like Leaflet's zoomend. */
  onRelZoom?: (rel: number) => void;
  /** Fires when the render-worthy world window changes: null at low zoom
   * (draw everything), else the visible rect padded by a viewport on each
   * side. Fires mid-drag too, so long pans fill in as they go. */
  onCull?: (rect: CullRect | null) => void;
  /** Render prop: committed scale (px per world unit) + whether the gesture
   * that just ended was a drag (so taps after a pan can be ignored). */
  children: (view: { scale: number; wasDrag: () => boolean }) => ReactNode;
}

export default function PanZoom({
  worldW,
  worldH,
  margin = 0.03,
  maxZoomX = 8,
  background,
  onRelZoom,
  onCull,
  children,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ s: 0, tx: 0, ty: 0, fit: 0 });
  const live = useRef<View>(view); // real-time truth during gestures
  const box = useRef({ cw: 0, ch: 0 }); // host size, cached at fit + gesture start
  const raf = useRef(0);
  const wheelSettle = useRef(0);
  const commitTimer = useRef(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x0: number; y0: number; tx0: number; ty0: number } | null>(null);
  const pinch = useRef<{ d0: number; s0: number; wx: number; wy: number } | null>(null);
  const dragDist = useRef(0);

  /** Keep the art on screen: an axis smaller than the viewport centers; a
   * larger one clamps so no empty gap opens at the edges. */
  function clamped(v: View): View {
    const { cw, ch } = box.current;
    const W = worldW * v.s;
    const H = worldH * v.s;
    const tx = W <= cw ? (cw - W) / 2 : Math.max(cw - W, Math.min(0, v.tx));
    const ty = H <= ch ? (ch - H) / 2 : Math.max(ch - H, Math.min(0, v.ty));
    return { ...v, tx, ty };
  }

  const paint = () => {
    const v = live.current;
    if (innerRef.current) {
      innerRef.current.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.s})`;
    }
  };
  const schedulePaint = () => {
    if (!raf.current) {
      raf.current = requestAnimationFrame(() => {
        raf.current = 0;
        paint();
      });
    }
  };
  // The world window worth rendering. Hysteresis: the rect is padded by a
  // full viewport per side, and only moves when the screen escapes it — so
  // panning inside the window costs nothing, and an escape re-renders only
  // the small zoomed-in subset of the board.
  const cullRef = useRef<{ rect: CullRect; s: number } | null>(null);
  const maybeCull = () => {
    const v = live.current;
    const { cw, ch } = box.current;
    let next: CullRect | null = null;
    if (v.fit > 0 && v.s > v.fit * CULL_ZOOM && cw > 0) {
      const vis = { x0: -v.tx / v.s, y0: -v.ty / v.s, x1: (cw - v.tx) / v.s, y1: (ch - v.ty) / v.s };
      const c = cullRef.current;
      // The window survives while the screen stays inside it AND the zoom is
      // near the level it was built for. Zooming in shrinks the visible rect
      // (it never escapes), so without the scale check the window would stay
      // fit-sized forever and cull nothing.
      const sameZoom = c && v.s < c.s * 1.5 && v.s > c.s / 1.5;
      if (c && sameZoom && vis.x0 >= c.rect.x0 && vis.y0 >= c.rect.y0 && vis.x1 <= c.rect.x1 && vis.y1 <= c.rect.y1) return;
      const padX = (vis.x1 - vis.x0) / 2;
      const padY = (vis.y1 - vis.y0) / 2;
      next = { x0: vis.x0 - padX, y0: vis.y0 - padY, x1: vis.x1 + padX, y1: vis.y1 + padY };
    } else if (!cullRef.current) {
      return;
    }
    cullRef.current = next ? { rect: next, s: v.s } : null;
    onCull?.(next);
  };
  // A pan leaves the scale untouched, and children consume ONLY the scale —
  // the transform is painted imperatively. So a pan-only commit has nothing
  // to tell React; skipping it keeps gesture-end free of re-render jank.
  // (The cull window is the exception, and it updates via onCull.)
  const commit = () => {
    maybeCull();
    setView((prev) => {
      const v = live.current;
      return prev.s === v.s && prev.fit === v.fit ? prev : { ...v };
    });
  };
  // Committing re-renders React and re-rasterizes the SVG at the new scale -
  // real work. Do it after a quiet gap, so a follow-up gesture that starts
  // right away cancels it and never trips over the burst.
  const commitSoon = () => {
    window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(commit, 180);
  };

  // Fit-and-center on mount and on EVERY container size change (rotation,
  // browser chrome collapsing, the bottom bar claiming space). At fit scale
  // we stay fitted; zoomed in we keep the user's zoom and just re-clamp.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    let retry = 0;
    const apply = () => {
      const { width: cw, height: ch } = el.getBoundingClientRect();
      if (cw < 10 || ch < 10) {
        // Container hasn't been laid out yet (or the environment throttles
        // resize signals) - keep checking until it has a real size.
        window.clearTimeout(retry);
        retry = window.setTimeout(apply, 400);
        return;
      }
      box.current = { cw, ch };
      const fit = (Math.min(cw / worldW, ch / worldH) || 0) * (1 - margin);
      const v = live.current;
      const atFit = !v.fit || Math.abs(v.s - v.fit) < 1e-9;
      const s = atFit ? fit : Math.max(fit, Math.min(v.s, fit * maxZoomX));
      live.current = clamped(atFit ? { s, tx: 0, ty: 0, fit } : { ...v, s, fit });
      paint();
      commit();
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    // Belt and braces: RO callbacks ride the render pipeline, which some
    // environments throttle - window/visualViewport resizes always arrive.
    window.addEventListener('resize', apply);
    window.visualViewport?.addEventListener('resize', apply);
    return () => {
      window.clearTimeout(retry);
      ro.disconnect();
      window.removeEventListener('resize', apply);
      window.visualViewport?.removeEventListener('resize', apply);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldW, worldH, margin, maxZoomX]);

  // Committed view -> DOM (covers commits; gestures already painted live).
  useLayoutEffect(paint, [view]);

  useEffect(() => {
    if (view.fit > 0) onRelZoom?.(Math.log2(view.s / view.fit));
  }, [view, onRelZoom]);

  // Wheel must be a native non-passive listener to be allowed to preventDefault.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      box.current = { cw: rect.width, ch: rect.height };
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const v = live.current;
      if (!v.fit) return;
      const s = Math.max(v.fit, Math.min(v.fit * maxZoomX, v.s * Math.exp(-e.deltaY * 0.0018)));
      const wx = (mx - v.tx) / v.s;
      const wy = (my - v.ty) / v.s;
      live.current = clamped({ ...v, s, tx: mx - wx * s, ty: my - wy * s });
      schedulePaint();
      maybeCull();
      window.clearTimeout(wheelSettle.current);
      wheelSettle.current = window.setTimeout(commit, 180);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxZoomX]);

  /** Pointer position in host coordinates; refreshes the cached host box. */
  const rel = (e: React.PointerEvent) => {
    const rect = hostRef.current!.getBoundingClientRect();
    box.current = { cw: rect.width, ch: rect.height };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  /** Per-move position (host box already cached at gesture start). */
  const relFast = (e: React.PointerEvent) => {
    const rect = hostRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  function onPointerDown(e: React.PointerEvent) {
    window.clearTimeout(commitTimer.current); // a new gesture outruns the commit
    try {
      hostRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* a pointer can be gone by the time we capture (or synthetic in tests) */
    }
    const p = rel(e);
    // A missed pointerup (mobile Safari steals touches for system gestures)
    // would wedge the map forever - a third "finger" means we lost one.
    if (pointers.current.size >= 2 && !pointers.current.has(e.pointerId)) pointers.current.clear();
    pointers.current.set(e.pointerId, p);
    const v = live.current;
    if (pointers.current.size === 1) {
      drag.current = { x0: p.x, y0: p.y, tx0: v.tx, ty0: v.ty };
      pinch.current = null;
      dragDist.current = 0;
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      pinch.current = {
        d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        s0: v.s,
        wx: (mx - v.tx) / v.s,
        wy: (my - v.ty) / v.s,
      };
      drag.current = null;
      dragDist.current = 99; // a pinch is never a tap
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    const p = relFast(e);
    pointers.current.set(e.pointerId, p);
    const v = live.current;
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const s = Math.max(v.fit, Math.min(v.fit * maxZoomX, pinch.current.s0 * (d / pinch.current.d0)));
      live.current = clamped({ ...v, s, tx: mx - pinch.current.wx * s, ty: my - pinch.current.wy * s });
      schedulePaint();
      maybeCull();
    } else if (drag.current) {
      const dx = p.x - drag.current.x0;
      const dy = p.y - drag.current.y0;
      dragDist.current = Math.max(dragDist.current, Math.hypot(dx, dy));
      live.current = clamped({ ...v, tx: drag.current.tx0 + dx, ty: drag.current.ty0 + dy });
      schedulePaint();
      maybeCull();
    }
  }

  function onPointerEnd(e: React.PointerEvent) {
    if (!pointers.current.delete(e.pointerId)) return;
    pinch.current = null;
    if (pointers.current.size === 1) {
      // hand the remaining finger a fresh drag anchor
      const [p] = [...pointers.current.values()];
      const v = live.current;
      drag.current = { x0: p.x, y0: p.y, tx0: v.tx, ty0: v.ty };
    } else {
      drag.current = null;
      commitSoon();
    }
  }

  return (
    <div
      ref={hostRef}
      className="panzoom"
      style={{ background }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
    >
      <div
        ref={innerRef}
        style={{ transformOrigin: '0 0', width: worldW, height: worldH, willChange: 'transform' }}
      >
        {view.fit > 0
          ? children({
              scale: view.fit * Math.pow(2, Math.round(Math.log2(view.s / view.fit) * 2) / 2),
              wasDrag: () => dragDist.current > 8,
            })
          : null}
      </div>
    </div>
  );
}
