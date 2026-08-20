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
  children,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ s: 0, tx: 0, ty: 0, fit: 0 });
  const live = useRef<View>(view); // real-time truth during gestures
  const box = useRef({ cw: 0, ch: 0 }); // host size, cached at fit + gesture start
  const raf = useRef(0);
  const wheelSettle = useRef(0);
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
  const commit = () => setView({ ...live.current });

  // Fit-and-center on mount and on EVERY container size change (rotation,
  // browser chrome collapsing, the bottom bar claiming space). At fit scale
  // we stay fitted; zoomed in we keep the user's zoom and just re-clamp.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const apply = () => {
      const { width: cw, height: ch } = el.getBoundingClientRect();
      if (cw < 10 || ch < 10) return;
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
      window.clearTimeout(wheelSettle.current);
      wheelSettle.current = window.setTimeout(commit, 140);
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
    try {
      hostRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* a pointer can be gone by the time we capture (or synthetic in tests) */
    }
    const p = rel(e);
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
    } else if (drag.current) {
      const dx = p.x - drag.current.x0;
      const dy = p.y - drag.current.y0;
      dragDist.current = Math.max(dragDist.current, Math.hypot(dx, dy));
      live.current = clamped({ ...v, tx: drag.current.tx0 + dx, ty: drag.current.ty0 + dy });
      schedulePaint();
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
      commit();
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
    >
      <div
        ref={innerRef}
        style={{ transformOrigin: '0 0', width: worldW, height: worldH, willChange: 'transform' }}
      >
        {view.fit > 0 ? children({ scale: view.s, wasDrag: () => dragDist.current > 8 }) : null}
      </div>
    </div>
  );
}
