import { uid } from './ids';
import { computeLayout, dividerRange, clamp } from './geometry';
import type { CellNode, Crop, Dir, LayoutNode, Photo, Rect, SplitNode } from './types';

export type Preset = 'grid' | 'mosaic' | 'featured' | 'columns' | 'rows';

export function defaultCrop(): Crop {
  return { zoom: 1, panX: 0, panY: 0, rotate: 0 };
}

export function makeCell(photoId: string | null): CellNode {
  return { type: 'cell', id: uid('c'), photoId, crop: defaultCrop() };
}

export function makeSplit(dir: Dir, ratio: number, first: LayoutNode, second: LayoutNode): SplitNode {
  return { type: 'split', id: uid('s'), dir, ratio, first, second };
}

/** Equal-size chain of nodes along one direction. */
export function chain(nodes: LayoutNode[], dir: Dir): LayoutNode | null {
  if (nodes.length === 0) return null;
  if (nodes.length === 1) return nodes[0]!;
  const mid = Math.floor(nodes.length / 2);
  const a = chain(nodes.slice(0, mid), dir)!;
  const b = chain(nodes.slice(mid), dir)!;
  return makeSplit(dir, mid / nodes.length, a, b);
}

/** Columns × rows that best fit `n` items on a page of the given aspect (w/h). */
export function gridShape(n: number, pageAspect: number): { cols: number; rows: number } {
  let best = { cols: 1, rows: n, score: Infinity };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cellAspect = pageAspect * (rows / cols);
    const empty = cols * rows - n;
    // Prefer near-square cells, penalise empty slots.
    const score = Math.abs(Math.log(cellAspect)) + empty * 0.6;
    if (score < best.score) best = { cols, rows, score };
  }
  return { cols: best.cols, rows: best.rows };
}

/** Build a layout for the given photos. */
export function buildPreset(preset: Preset, photoIds: (string | null)[], pageAspect = 210 / 297): LayoutNode | null {
  const n = photoIds.length;
  if (n === 0) return null;
  const cells = photoIds.map((p) => makeCell(p));
  if (n === 1) return cells[0]!;

  switch (preset) {
    case 'columns':
      return chain(cells, 'v');
    case 'rows':
      return chain(cells, 'h');
    case 'mosaic': {
      // One large photo, the rest in a stack beside it (along the longer page axis).
      const portrait = pageAspect < 1;
      const rest = chain(cells.slice(1), portrait ? 'v' : 'h')!;
      return makeSplit(portrait ? 'h' : 'v', 0.62, cells[0]!, rest);
    }
    case 'featured': {
      const portrait = pageAspect < 1;
      const restCells = cells.slice(1);
      const shape = gridShape(restCells.length, portrait ? pageAspect / 0.4 : (pageAspect * 0.4));
      const rest = gridOf(restCells, shape.cols);
      return makeSplit(portrait ? 'h' : 'v', 0.6, cells[0]!, rest);
    }
    case 'grid':
    default: {
      const { cols } = gridShape(n, pageAspect);
      return gridOf(cells, cols);
    }
  }
}

/** Rows of `cols` cells; the last row stretches when incomplete. */
function gridOf(cells: LayoutNode[], cols: number): LayoutNode {
  const rows: LayoutNode[] = [];
  for (let i = 0; i < cells.length; i += cols) rows.push(chain(cells.slice(i, i + cols), 'v')!);
  return chain(rows, 'h')!;
}

/* ---------------------------------------------------------------- queries */

export function walk(node: LayoutNode | null, fn: (n: LayoutNode, parent: SplitNode | null) => void, parent: SplitNode | null = null): void {
  if (!node) return;
  fn(node, parent);
  if (node.type === 'split') {
    walk(node.first, fn, node);
    walk(node.second, fn, node);
  }
}

export function listCells(tree: LayoutNode | null): CellNode[] {
  const out: CellNode[] = [];
  walk(tree, (n) => {
    if (n.type === 'cell') out.push(n);
  });
  return out;
}

export function findNode(tree: LayoutNode | null, id: string): LayoutNode | null {
  let found: LayoutNode | null = null;
  walk(tree, (n) => {
    if (n.id === id) found = n;
  });
  return found;
}

export function findParent(tree: LayoutNode | null, id: string): SplitNode | null {
  let found: SplitNode | null = null;
  walk(tree, (n, p) => {
    if (n.id === id) found = p;
  });
  return found;
}

export function findSplit(tree: LayoutNode | null, id: string): SplitNode | null {
  const n = findNode(tree, id);
  return n && n.type === 'split' ? n : null;
}

/* ---------------------------------------------------------------- edits */

/** Flip a divider between vertical and horizontal. Returns false if not found. */
export function toggleSplitDir(tree: LayoutNode | null, splitId: string): boolean {
  const s = findSplit(tree, splitId);
  if (!s) return false;
  s.dir = s.dir === 'v' ? 'h' : 'v';
  return true;
}

/**
 * Add a photo to the layout. Fills the first empty cell, otherwise splits the
 * largest cell along its longer side so existing edge tweaks are preserved.
 */
export function insertPhoto(tree: LayoutNode | null, photoId: string, page: Rect, gap: number): LayoutNode {
  if (!tree) return makeCell(photoId);
  const empty = listCells(tree).find((c) => c.photoId === null);
  if (empty) {
    empty.photoId = photoId;
    empty.crop = defaultCrop();
    return tree;
  }
  const { cells } = computeLayout(tree, page, gap);
  let target = cells[0]!;
  for (const c of cells) if (c.rect.w * c.rect.h > target.rect.w * target.rect.h) target = c;
  const dir: Dir = target.rect.w >= target.rect.h ? 'v' : 'h';
  return replaceNode(tree, target.id, makeSplit(dir, 0.5, target.node, makeCell(photoId)));
}

/** Replace node `id` with `replacement`; returns the (possibly new) root. */
export function replaceNode(tree: LayoutNode, id: string, replacement: LayoutNode): LayoutNode {
  if (tree.id === id) return replacement;
  const parent = findParent(tree, id);
  if (!parent) return tree;
  if (parent.first.id === id) parent.first = replacement;
  else parent.second = replacement;
  return tree;
}

/** Remove a cell; its sibling takes over the parent's space. */
export function removeCell(tree: LayoutNode | null, cellId: string): LayoutNode | null {
  if (!tree) return null;
  if (tree.id === cellId) return null;
  const parent = findParent(tree, cellId);
  if (!parent) return tree;
  const sibling = parent.first.id === cellId ? parent.second : parent.first;
  return replaceNode(tree, parent.id, sibling);
}

/** Remove every cell showing `photoId`. */
export function removePhotoFromTree(tree: LayoutNode | null, photoId: string): LayoutNode | null {
  let t = tree;
  for (const c of listCells(tree)) if (c.photoId === photoId) t = removeCell(t, c.id);
  return t;
}

/** Swap photos (and their framing) between two cells. */
export function swapCells(tree: LayoutNode | null, a: string, b: string): boolean {
  const na = findNode(tree, a);
  const nb = findNode(tree, b);
  if (!na || !nb || na.type !== 'cell' || nb.type !== 'cell' || a === b) return false;
  [na.photoId, nb.photoId] = [nb.photoId, na.photoId];
  [na.crop, nb.crop] = [nb.crop, na.crop];
  return true;
}

export function setCellPhoto(tree: LayoutNode | null, cellId: string, photoId: string | null): boolean {
  const n = findNode(tree, cellId);
  if (!n || n.type !== 'cell') return false;
  n.photoId = photoId;
  n.crop = defaultCrop();
  return true;
}

/** Photo lookup used to match photos to cells by shape. */
export type PhotoSizes = ReadonlyMap<string, Pick<Photo, 'width' | 'height'>>;

/** Natural aspect (w/h) of a photo, or undefined when unknown / empty slot. */
function photoAspect(id: string | null, photos: PhotoSizes): number | undefined {
  const p = id ? photos.get(id) : undefined;
  return p && p.width > 0 && p.height > 0 ? p.width / p.height : undefined;
}

/**
 * Random noise added to log-aspects before matching. Wide enough to mix photos
 * of similar shape (3:4 vs 2:3), far too narrow to swap portrait and landscape
 * (log(4/3) − log(3/4) ≈ 0.58).
 */
const ASPECT_JITTER = 0.3;

/**
 * Order `photoIds` so that the i-th photo suits the i-th cell (given cell
 * aspects w/h): the tallest photos go to the tallest cells, the widest to the
 * widest. Photos of similar shape are mixed randomly; photos of unknown shape
 * and empty slots land anywhere.
 */
export function matchPhotosToCells(
  cellAspects: readonly number[],
  photoIds: readonly (string | null)[],
  photos: PhotoSizes,
  rng: () => number = Math.random,
): (string | null)[] {
  const jitter = () => (rng() - 0.5) * ASPECT_JITTER;
  const cellKeys = cellAspects.map((a, i) => ({ i, key: Math.log(a) + jitter() }));
  const lo = Math.min(...cellKeys.map((c) => c.key));
  const hi = Math.max(...cellKeys.map((c) => c.key));
  const photoKeys = photoIds.map((id) => {
    const a = photoAspect(id, photos);
    return { id, key: a === undefined ? lo + (hi - lo) * rng() : Math.log(a) + jitter() };
  });
  cellKeys.sort((a, b) => a.key - b.key);
  photoKeys.sort((a, b) => a.key - b.key);
  const out: (string | null)[] = new Array(cellAspects.length).fill(null);
  cellKeys.forEach((c, k) => (out[c.i] = photoKeys[k]?.id ?? null));
  return out;
}

/** How badly photos fit their cells: sum of |log(cell aspect / photo aspect)|. */
export function aspectMismatch(cellAspects: readonly number[], photoIds: readonly (string | null)[], photos: PhotoSizes): number {
  let cost = 0;
  cellAspects.forEach((a, i) => {
    const p = photoAspect(photoIds[i] ?? null, photos);
    if (p !== undefined && a > 0) cost += Math.abs(Math.log(a / p));
  });
  return cost;
}

/**
 * Shuffle photos among cells (injectable RNG for tests). With photo sizes and
 * the page, photos are matched to cells by shape – portrait photos go to tall
 * cells, landscape ones to wide cells – and shuffled among similar ones.
 */
export function shufflePhotos(
  tree: LayoutNode | null,
  rng: () => number = Math.random,
  fit?: { photos: PhotoSizes; page: Rect; gap: number },
): void {
  const cells = listCells(tree);
  const current = cells.map((c) => c.photoId);
  let photos: (string | null)[];
  if (fit) {
    const aspects = computeLayout(tree, fit.page, fit.gap).cells.map((c) => (c.rect.h > 0 ? c.rect.w / c.rect.h : 1));
    // A few tries so the button visibly changes something when it can.
    photos = matchPhotosToCells(aspects, current, fit.photos, rng);
    for (let t = 0; t < 8 && photos.every((p, i) => p === current[i]); t++)
      photos = matchPhotosToCells(aspects, current, fit.photos, rng);
  } else {
    photos = current.slice();
    for (let i = photos.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [photos[i], photos[j]] = [photos[j]!, photos[i]!];
    }
  }
  cells.forEach((c, i) => {
    c.photoId = photos[i] ?? null;
    c.crop = defaultCrop();
  });
}

/** Reset all dividers to equal shares (respecting chained splits). */
export function equalize(tree: LayoutNode | null): void {
  const count = (n: LayoutNode, dir: Dir): number =>
    n.type === 'split' && n.dir === dir ? count(n.first, dir) + count(n.second, dir) : 1;
  walk(tree, (n) => {
    if (n.type === 'split') {
      const a = count(n.first, n.dir);
      const b = count(n.second, n.dir);
      n.ratio = a / (a + b);
    }
  });
}

/**
 * Adjust ratios so cells approach their photos' aspect ratios (less cropping).
 * Ratios are kept within the valid drag range.
 */
export function smartFit(tree: LayoutNode | null, photos: PhotoSizes, page: Rect, gap: number): void {
  if (!tree) return;
  const aspect = (n: LayoutNode): number => {
    // Natural aspect (w/h) of a subtree when every photo keeps its own aspect.
    if (n.type === 'cell') {
      const p = n.photoId ? photos.get(n.photoId) : undefined;
      if (!p || !p.width || !p.height) return 1;
      const r = n.crop.rotate % 180 === 0 ? p.width / p.height : p.height / p.width;
      return r;
    }
    const a = aspect(n.first);
    const b = aspect(n.second);
    return n.dir === 'v' ? a + b : 1 / (1 / a + 1 / b);
  };
  walk(tree, (n) => {
    if (n.type !== 'split') return;
    const a = aspect(n.first);
    const b = aspect(n.second);
    n.ratio = n.dir === 'v' ? a / (a + b) : (1 / a) / (1 / a + 1 / b);
  });
  clampRatios(tree, page, gap);
}

/**
 * Pull every divider into its allowed range so each cell keeps the minimum
 * size. Pre-order, re-computing after each parent so children see their final rect.
 */
export function clampRatios(tree: LayoutNode | null, page: Rect, gap: number): void {
  if (!tree) return;
  const ids = computeLayout(tree, page, gap).dividers.map((d) => d.id);
  for (const id of ids) {
    const d = computeLayout(tree, page, gap).dividers.find((x) => x.id === id);
    if (!d) continue;
    const [lo, hi] = dividerRange(d, gap);
    const start = d.dir === 'v' ? d.parent.x : d.parent.y;
    const size = d.dir === 'v' ? d.parent.w : d.parent.h;
    const pos = clamp(start + size * d.node.ratio, lo, hi);
    d.node.ratio = size > 0 ? (pos - start) / size : 0.5;
  }
}
