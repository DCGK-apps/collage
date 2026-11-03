import type { CellNode, Dir, LayoutNode, Rect, SplitNode } from './types';

/** Minimum visible size of a cell (mm). */
export const MIN_CELL_MM = 12;

export interface CellBox {
  id: string;
  node: CellNode;
  /** Visible photo window (already inset by the gap). */
  rect: Rect;
}

export interface DividerBox {
  id: string;
  node: SplitNode;
  dir: Dir;
  /** Rect of the split node (space that is being divided). */
  parent: Rect;
  /** Position of the line along the split axis (x for 'v', y for 'h'), mm. */
  pos: number;
  /** Extent of the line along the other axis. */
  spanStart: number;
  spanEnd: number;
}

export interface Layout {
  cells: CellBox[];
  dividers: DividerBox[];
}

function inset(r: Rect, d: number): Rect {
  return { x: r.x + d, y: r.y + d, w: Math.max(0, r.w - 2 * d), h: Math.max(0, r.h - 2 * d) };
}

/**
 * Compute cell and divider geometry. `gap` is the spacing between photos and
 * also the outer margin of the page.
 */
export function computeLayout(tree: LayoutNode | null, page: Rect, gap: number): Layout {
  const cells: CellBox[] = [];
  const dividers: DividerBox[] = [];
  if (!tree) return { cells, dividers };
  const half = gap / 2;

  const walk = (node: LayoutNode, r: Rect): void => {
    if (node.type === 'cell') {
      cells.push({ id: node.id, node, rect: inset(r, half) });
      return;
    }
    const ratio = clamp01(node.ratio);
    if (node.dir === 'v') {
      const pos = r.x + r.w * ratio;
      dividers.push({ id: node.id, node, dir: 'v', parent: r, pos, spanStart: r.y, spanEnd: r.y + r.h });
      walk(node.first, { x: r.x, y: r.y, w: pos - r.x, h: r.h });
      walk(node.second, { x: pos, y: r.y, w: r.x + r.w - pos, h: r.h });
    } else {
      const pos = r.y + r.h * ratio;
      dividers.push({ id: node.id, node, dir: 'h', parent: r, pos, spanStart: r.x, spanEnd: r.x + r.w });
      walk(node.first, { x: r.x, y: r.y, w: r.w, h: pos - r.y });
      walk(node.second, { x: r.x, y: pos, w: r.w, h: r.y + r.h - pos });
    }
  };

  walk(tree, inset(page, half));
  return { cells, dividers };
}

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Minimum allocated extent of a subtree along `axis` ('v' → width, 'h' → height)
 * such that every cell keeps at least `minCell` mm of visible size.
 */
export function minExtent(node: LayoutNode, axis: Dir, gap: number, minCell = MIN_CELL_MM): number {
  if (node.type === 'cell') return minCell + gap;
  const a = minExtent(node.first, axis, gap, minCell);
  const b = minExtent(node.second, axis, gap, minCell);
  return node.dir === axis ? a + b : Math.max(a, b);
}

/** Allowed line positions [lo, hi] (mm) for a divider. */
export function dividerRange(d: DividerBox, gap: number, minCell = MIN_CELL_MM): [number, number] {
  const start = d.dir === 'v' ? d.parent.x : d.parent.y;
  const size = d.dir === 'v' ? d.parent.w : d.parent.h;
  const minA = minExtent(d.node.first, d.dir, gap, minCell);
  const minB = minExtent(d.node.second, d.dir, gap, minCell);
  if (minA + minB >= size) {
    const p = start + (size * minA) / (minA + minB);
    return [p, p];
  }
  return [start + minA, start + size - minB];
}

function collectIds(node: LayoutNode, out: Set<string>): Set<string> {
  out.add(node.id);
  if (node.type === 'split') {
    collectIds(node.first, out);
    collectIds(node.second, out);
  }
  return out;
}

const EPS = 1e-6;

/**
 * Dividers that visually form one continuous line with `id` (same direction,
 * same position, touching spans). In a 2×2 grid the vertical line of the top
 * row and the bottom row are linked, so they move together like a table edge.
 */
export function linkedDividers(layout: Layout, id: string, tolerance = 0.01): DividerBox[] {
  const start = layout.dividers.find((d) => d.id === id);
  if (!start) return [];
  const group = [start];
  const inGroup = new Set([start.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of layout.dividers) {
      if (inGroup.has(d.id) || d.dir !== start.dir) continue;
      if (Math.abs(d.pos - start.pos) > tolerance) continue;
      const touches = group.some(
        (g) => d.spanStart <= g.spanEnd + tolerance && g.spanStart <= d.spanEnd + tolerance,
      );
      if (touches) {
        group.push(d);
        inGroup.add(d.id);
        grew = true;
      }
    }
  }
  // A divider nested inside another group member would be moved twice; drop it.
  const nested = new Set<string>();
  for (const g of group) {
    const ids = collectIds(g.node, new Set());
    ids.delete(g.id);
    for (const other of group) if (ids.has(other.id)) nested.add(other.id);
  }
  return group.filter((g) => !nested.has(g.id));
}

export interface DragSession {
  dir: Dir;
  group: DividerBox[];
  /** Line position at drag start. */
  origin: number;
  range: [number, number];
  snapTargets: number[];
}

/**
 * Prepare a divider drag. All values are captured at drag start so the drag is
 * stable: the parent rects of the dragged dividers never change while dragging.
 */
export function beginDividerDrag(
  layout: Layout,
  id: string,
  gap: number,
  opts: { linked?: boolean; minCell?: number; pageRect?: Rect } = {},
): DragSession | null {
  const main = layout.dividers.find((d) => d.id === id);
  if (!main) return null;
  const group = opts.linked === false ? [main] : linkedDividers(layout, id);
  let lo = -Infinity;
  let hi = Infinity;
  for (const g of group) {
    const [a, b] = dividerRange(g, gap, opts.minCell);
    lo = Math.max(lo, a);
    hi = Math.min(hi, b);
  }
  if (lo > hi) lo = hi = main.pos;

  // Lines inside moving subtrees shift during the drag – they are not stable snap targets.
  const moving = new Set<string>();
  for (const g of group) collectIds(g.node, moving);
  const targets = new Set<number>();
  for (const d of layout.dividers) {
    if (d.dir === main.dir && !moving.has(d.id)) targets.add(round3(d.pos));
  }
  for (const g of group) {
    const s = main.dir === 'v' ? g.parent.x : g.parent.y;
    const size = main.dir === 'v' ? g.parent.w : g.parent.h;
    targets.add(round3(s + size / 2));
  }
  if (opts.pageRect) {
    const pr = opts.pageRect;
    targets.add(round3(main.dir === 'v' ? pr.x + pr.w / 2 : pr.y + pr.h / 2));
  }
  return { dir: main.dir, group, origin: main.pos, range: [lo, hi], snapTargets: [...targets] };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * Resolve the new line position for a drag delta (mm), with clamping and
 * magnetic snapping (`snapMm` = 0 disables snapping).
 */
export function resolveDragPosition(session: DragSession, deltaMm: number, snapMm: number): number {
  const [lo, hi] = session.range;
  let pos = clamp(session.origin + deltaMm, lo, hi);
  if (snapMm > 0) {
    let best: number | null = null;
    for (const t of session.snapTargets) {
      if (t < lo - EPS || t > hi + EPS) continue;
      const d = Math.abs(t - pos);
      if (d <= snapMm && (best === null || d < Math.abs(best - pos))) best = t;
    }
    if (best !== null) pos = best;
  }
  return pos;
}

/** Apply a line position to every divider in the drag group (mutates ratios). */
export function applyDragPosition(session: DragSession, pos: number): void {
  for (const g of session.group) {
    const start = session.dir === 'v' ? g.parent.x : g.parent.y;
    const size = session.dir === 'v' ? g.parent.w : g.parent.h;
    if (size > 0) g.node.ratio = clamp01((pos - start) / size);
  }
}
