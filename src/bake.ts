// Bake the board's static art into raster tiles, once per board version.
// Phones were re-rasterizing thousands of vector sprites (plus an SVG filter)
// on every pan at high zoom — seconds of freeze. Baked, a pan is the GPU
// sliding a few decoded bitmaps. The bake happens in the app at load from the
// exact SVG on screen (perfect visual parity), and is cached in IndexedDB so
// later sessions skip straight to the tiles.

export interface BakedTile {
  x: number; // world rect (meters, board frame)
  y: number;
  w: number;
  h: number;
  blob: Blob;
}
export interface BakedBoard {
  key: string;
  scale: number; // tile raster px per world meter
  W: number;
  H: number;
  base: Blob; // whole-board image for the zoomed-out view
  baseScale: number;
  tiles: BakedTile[];
}
export interface BakeUrls {
  key: string;
  W: number;
  H: number;
  baseUrl: string;
  tiles: { x: number; y: number; w: number; h: number; url: string }[];
}

// Bump to invalidate every cached bake after a rendering change.
const BAKE_VERSION = 1;
const TILE_PX = 2048;
// Tiles overlap by a few px so antialiased edges never show as hairline seams.
const TILE_STEP = TILE_PX - 8;
const MAX_MEGAPIXELS = 36e6; // full-board raster budget at tile scale
const BASE_SCALE = 1.5; // px per meter for the zoomed-out image

/** Content hash of whatever defines the board's static look. */
export function bakeKey(boardLike: unknown): string {
  const s = JSON.stringify(boardLike);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `v${BAKE_VERSION}-${(h >>> 0).toString(36)}-${s.length}`;
}

// --- IndexedDB (one board's bake at a time; blobs structured-clone fine) ---
function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open('board-bake', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('bakes');
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
export async function loadBake(key: string): Promise<BakedBoard | null> {
  try {
    const db = await openDb();
    return await new Promise((res) => {
      const rq = db.transaction('bakes', 'readonly').objectStore('bakes').get(key);
      rq.onsuccess = () => res((rq.result as BakedBoard | undefined) ?? null);
      rq.onerror = () => res(null);
    });
  } catch {
    return null; // private mode etc. — bake still works for this session
  }
}
export async function saveBake(b: BakedBoard): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((res) => {
      const tx = db.transaction('bakes', 'readwrite');
      const store = tx.objectStore('bakes');
      store.clear(); // old board versions are dead weight
      store.put(b, b.key);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  } catch {
    /* storage denied — session-only bake */
  }
}

// --- rasterization ---
/** SVG-in-<img> rasterization can't fetch: swap every image href for a data URI. */
async function inlineImages(root: Element): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('image'));
  await Promise.all(
    imgs.map(async (el) => {
      const href = el.getAttribute('href') ?? el.getAttribute('xlink:href');
      if (!href || href.startsWith('data:')) return;
      const blob = await (await fetch(href)).blob();
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = () => rej(r.error);
        r.readAsDataURL(blob);
      });
      el.setAttribute('href', dataUrl);
      el.removeAttribute('xlink:href');
    }),
  );
}

/** Intrinsic size = target raster size, so Safari rasterizes at full quality
 * instead of upscaling a small default raster. */
function svgUrl(inner: string, W: number, H: number, scale: number): string {
  const s = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${Math.round(W * scale)}" height="${Math.round(H * scale)}" viewBox="0 0 ${W} ${H}">${inner}</svg>`;
  return URL.createObjectURL(new Blob([s], { type: 'image/svg+xml' }));
}

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('bake: SVG image failed to load'));
    img.src = url;
  });
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) =>
    // Safari quietly encodes PNG instead of WebP — either is fine.
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('bake: toBlob failed'))), 'image/webp', 0.85),
  );
}

/**
 * Rasterize the given static SVG groups (already mounted, uncculled) into a
 * base image + overlapping tiles. Heavy SVG rasterization happens once per
 * horizontal band, not once per tile.
 */
export async function rasterizeBoard(groups: Element[], W: number, H: number, key: string): Promise<BakedBoard> {
  const holder = document.createElement('div');
  for (const g of groups) holder.appendChild(g.cloneNode(true));
  await inlineImages(holder);
  const inner = holder.innerHTML;

  let scale = 4;
  if (W * H * scale * scale > MAX_MEGAPIXELS) scale = Math.sqrt(MAX_MEGAPIXELS / (W * H));
  scale = Math.min(scale, 8000 / W); // keep a band canvas under iOS limits

  // Whole-board image for the fit view.
  const baseUrl = svgUrl(inner, W, H, BASE_SCALE);
  const baseImg = await loadImg(baseUrl);
  const bc = document.createElement('canvas');
  bc.width = Math.round(W * BASE_SCALE);
  bc.height = Math.round(H * BASE_SCALE);
  bc.getContext('2d')!.drawImage(baseImg, 0, 0, bc.width, bc.height);
  const base = await canvasBlob(bc);
  URL.revokeObjectURL(baseUrl);

  // Tile pyramid level for zoomed-in play.
  const url = svgUrl(inner, W, H, scale);
  const img = await loadImg(url);
  const pw = Math.round(W * scale);
  const ph = Math.round(H * scale);
  const band = document.createElement('canvas');
  band.width = pw;
  band.height = TILE_PX;
  const bctx = band.getContext('2d')!;
  const tiles: BakedTile[] = [];
  for (let py = 0; py < ph; py += TILE_STEP) {
    const bh = Math.min(TILE_PX, ph - py);
    bctx.clearRect(0, 0, pw, TILE_PX);
    bctx.drawImage(img, 0, py, pw, bh, 0, 0, pw, bh);
    for (let px = 0; px < pw; px += TILE_STEP) {
      const tw = Math.min(TILE_PX, pw - px);
      const tc = document.createElement('canvas');
      tc.width = tw;
      tc.height = bh;
      tc.getContext('2d')!.drawImage(band, px, 0, tw, bh, 0, 0, tw, bh);
      tiles.push({ x: px / scale, y: py / scale, w: tw / scale, h: bh / scale, blob: await canvasBlob(tc) });
    }
  }
  URL.revokeObjectURL(url);
  return { key, scale, W, H, base, baseScale: BASE_SCALE, tiles };
}

/** Blobs → object URLs for rendering (kept for the session). */
export function bakeUrls(b: BakedBoard): BakeUrls {
  return {
    key: b.key,
    W: b.W,
    H: b.H,
    baseUrl: URL.createObjectURL(b.base),
    tiles: b.tiles.map((t) => ({ x: t.x, y: t.y, w: t.w, h: t.h, url: URL.createObjectURL(t.blob) })),
  };
}
