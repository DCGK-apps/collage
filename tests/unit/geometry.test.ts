import { describe, expect, it } from 'vitest';
import {
  applyDragPosition,
  beginDividerDrag,
  computeLayout,
  dividerRange,
  dividersAt,
  junctionAt,
  junctions,
  needsDirection,
  pickDivider,
  linkedDividers,
  minExtent,
  resolveDragPosition,
} from '../../src/core/geometry';
import { cell, grid2x2, PAGE, split } from './helpers';

describe('computeLayout', () => {
  it('returns nothing for an empty tree', () => {
    expect(computeLayout(null, PAGE, 4)).toEqual({ cells: [], dividers: [] });
  });

  it('single cell fills the page minus the outer margin (= gap)', () => {
    const { cells } = computeLayout(cell('a'), PAGE, 10);
    expect(cells[0]!.rect).toEqual({ x: 10, y: 10, w: 180, h: 280 });
  });

  it('gap between neighbours equals the outer margin', () => {
    const { cells, dividers } = computeLayout(split('s', 'v', 0.5, cell('a'), cell('b')), PAGE, 10);
    const [a, b] = cells;
    expect(a!.rect.x).toBe(10);
    expect(b!.rect.x - (a!.rect.x + a!.rect.w)).toBeCloseTo(10);
    expect(b!.rect.x + b!.rect.w).toBeCloseTo(190);
    expect(dividers[0]!.pos).toBeCloseTo(100);
  });

  it('cells tile the page exactly with no gap', () => {
    const { cells } = computeLayout(grid2x2(), PAGE, 0);
    const area = cells.reduce((s, c) => s + c.rect.w * c.rect.h, 0);
    expect(area).toBeCloseTo(PAGE.w * PAGE.h);
  });

  it('dividers span their parent rect', () => {
    const { dividers } = computeLayout(grid2x2(), PAGE, 0);
    const top = dividers.find((d) => d.id === 'top')!;
    expect(top.dir).toBe('v');
    expect([top.spanStart, top.spanEnd]).toEqual([0, 150]);
    const root = dividers.find((d) => d.id === 'root')!;
    expect([root.spanStart, root.spanEnd]).toEqual([0, 200]);
  });
});

describe('minExtent / dividerRange', () => {
  it('sums along the split axis and takes max across it', () => {
    const t = grid2x2();
    // width: top row has 2 cells side by side
    expect(minExtent(t, 'v', 4, 10)).toBe(28);
    // height: 2 rows stacked
    expect(minExtent(t, 'h', 4, 10)).toBe(28);
    expect(minExtent(split('s', 'v', 0.5, cell('a'), split('t', 'v', 0.5, cell('b'), cell('c'))), 'v', 0, 10)).toBe(30);
  });

  it('keeps every cell at least the minimum size', () => {
    const { dividers } = computeLayout(split('s', 'v', 0.5, cell('a'), cell('b')), PAGE, 0);
    expect(dividerRange(dividers[0]!, 0, 20)).toEqual([20, 180]);
  });
});

describe('linkedDividers', () => {
  it('links collinear row dividers in a grid', () => {
    const layout = computeLayout(grid2x2(), PAGE, 4);
    expect(linkedDividers(layout, 'top').map((d) => d.id).sort()).toEqual(['bottom', 'top']);
  });

  it('does not link once the lines are no longer aligned', () => {
    const t = grid2x2();
    (t.second as { ratio: number }).ratio = 0.3;
    const layout = computeLayout(t, PAGE, 4);
    expect(linkedDividers(layout, 'top').map((d) => d.id)).toEqual(['top']);
  });

  it('does not link perpendicular dividers', () => {
    const layout = computeLayout(grid2x2(), PAGE, 4);
    expect(linkedDividers(layout, 'root').map((d) => d.id)).toEqual(['root']);
  });
});

describe('divider drag', () => {
  it('moves linked dividers together', () => {
    const t = grid2x2();
    const layout = computeLayout(t, PAGE, 0);
    const s = beginDividerDrag(layout, 'top', 0)!;
    applyDragPosition(s, resolveDragPosition(s, 30, 0));
    const after = computeLayout(t, PAGE, 0);
    expect(after.dividers.find((d) => d.id === 'top')!.pos).toBeCloseTo(130);
    expect(after.dividers.find((d) => d.id === 'bottom')!.pos).toBeCloseTo(130);
  });

  it('moves a single divider when linking is off', () => {
    const t = grid2x2();
    const s = beginDividerDrag(computeLayout(t, PAGE, 0), 'top', 0, { linked: false })!;
    applyDragPosition(s, resolveDragPosition(s, 30, 0));
    const after = computeLayout(t, PAGE, 0);
    expect(after.dividers.find((d) => d.id === 'top')!.pos).toBeCloseTo(130);
    expect(after.dividers.find((d) => d.id === 'bottom')!.pos).toBeCloseTo(100);
  });

  it('is relative to the drag start (no jump on grab)', () => {
    const t = grid2x2();
    const s = beginDividerDrag(computeLayout(t, PAGE, 0), 'top', 0)!;
    expect(resolveDragPosition(s, 0, 0)).toBeCloseTo(100);
  });

  it('clamps so cells never collapse', () => {
    const t = grid2x2();
    const s = beginDividerDrag(computeLayout(t, PAGE, 4), 'top', 4, { minCell: 12 })!;
    const pos = resolveDragPosition(s, -1000, 0);
    applyDragPosition(s, pos);
    const cells = computeLayout(t, PAGE, 4).cells;
    for (const c of cells) expect(c.rect.w).toBeGreaterThanOrEqual(12 - 1e-6);
  });

  it('accounts for nested cells when clamping', () => {
    // a | (b | c): dragging the outer line right must leave room for b and c.
    const t = split('outer', 'v', 0.3, cell('a'), split('inner', 'v', 0.5, cell('b'), cell('c')));
    const s = beginDividerDrag(computeLayout(t, PAGE, 0), 'outer', 0, { minCell: 20 })!;
    expect(resolveDragPosition(s, 10_000, 0)).toBeCloseTo(160);
  });

  it('snaps to aligned edges and centres', () => {
    const t = split('root', 'h', 0.5, split('top', 'v', 0.4, cell('a'), cell('b')), split('bottom', 'v', 0.7, cell('c'), cell('d')));
    const s = beginDividerDrag(computeLayout(t, PAGE, 0), 'top', 0)!;
    // top line at 80; bottom line at 140; centre at 100
    expect(resolveDragPosition(s, 57, 5)).toBe(140); // 137 → snaps to 140
    expect(resolveDragPosition(s, 18, 5)).toBe(100); // 98 → snaps to centre
    expect(resolveDragPosition(s, 40, 5)).toBe(120); // nothing nearby
    expect(resolveDragPosition(s, 57, 0)).toBe(137); // snapping disabled
  });

  it('does not snap to lines inside the moving subtree', () => {
    const t = split('outer', 'v', 0.5, cell('a'), split('inner', 'v', 0.5, cell('b'), cell('c')));
    const s = beginDividerDrag(computeLayout(t, PAGE, 0), 'outer', 0)!;
    expect(s.snapTargets).not.toContain(150);
  });
});

describe('picking dividers at crossings', () => {
  // 2×2 grid on 200×300, no gap: horizontal line y=150, vertical lines x=100 (top and bottom).
  const layout = () => computeLayout(grid2x2(), PAGE, 0);
  const opts = { hitHalf: 5, pillHalf: 12 };

  it('finds every line whose band contains the point, nearest first', () => {
    expect(dividersAt(layout(), 101, 150, 5).map((d) => d.id).sort()).toEqual(['bottom', 'root', 'top']);
    // Just above the crossing the bottom vertical line (which starts at y=150) is not hit.
    expect(dividersAt(layout(), 101, 149, 5).map((d) => d.id).sort()).toEqual(['root', 'top']);
    expect(dividersAt(layout(), 101, 60, 5).map((d) => d.id)).toEqual(['top']);
    expect(dividersAt(layout(), 40, 60, 5)).toEqual([]);
  });

  it('a crossing is ambiguous, a plain line is not', () => {
    expect(needsDirection(dividersAt(layout(), 100, 150, 5))).toBe(true);
    expect(needsDirection(dividersAt(layout(), 100, 60, 5))).toBe(false);
  });

  it('vertical movement at the crossing picks the horizontal line', () => {
    const c = dividersAt(layout(), 100, 150, 5);
    expect(pickDivider(c, 100, 150, { dx: 1, dy: 8 }, opts)!.id).toBe('root');
  });

  it('sideways movement picks the nearest vertical line', () => {
    expect(pickDivider(dividersAt(layout(), 100, 148, 5), 100, 148, { dx: 8, dy: 1 }, opts)!.id).toBe('top');
    expect(pickDivider(dividersAt(layout(), 100, 152, 5), 100, 152, { dx: -8, dy: 0 }, opts)!.id).toBe('bottom');
  });

  it('a tap picks the pill under the finger (horizontal pill sits on the crossing)', () => {
    const c = dividersAt(layout(), 100, 150, 5);
    expect(pickDivider(c, 100, 150, null, opts)!.id).toBe('root');
  });

  it('a tap on a vertical pill picks that line', () => {
    const c = dividersAt(layout(), 100, 75, 5);
    expect(pickDivider(c, 100, 75, null, opts)!.id).toBe('top');
  });

  it('without a pill, the nearest line wins', () => {
    const c = dividersAt(layout(), 103, 146, 5); // 3 mm from vertical, 4 mm from horizontal, off the horizontal pill
    expect(pickDivider(c, 103, 146, null, { hitHalf: 5, pillHalf: 1 })!.id).toBe('top');
  });
});

describe('junctions', () => {
  it('finds the point where the top and bottom vertical edges of a 2×2 grid meet', () => {
    const js = junctions(computeLayout(grid2x2(), PAGE, 0));
    expect(js).toHaveLength(1);
    expect(js[0]).toMatchObject({ x: 100, y: 150, dir: 'v' });
    expect([...js[0]!.ids].sort()).toEqual(['bottom', 'top']);
  });

  it('has no junction once the edges are no longer aligned', () => {
    const t = grid2x2();
    (t.second as any).ratio = 0.3;
    expect(junctions(computeLayout(t, PAGE, 0))).toEqual([]);
  });

  it('works with a gap and for horizontal lines', () => {
    // Two columns, each split horizontally at the same height → horizontal junction.
    const t = split('root', 'v', 0.5, split('l', 'h', 0.4, cell('a'), cell('b')), split('r', 'h', 0.4, cell('c'), cell('d')));
    const js = junctions(computeLayout(t, PAGE, 6));
    expect(js).toHaveLength(1);
    expect(js[0]!.dir).toBe('h');
    expect(js[0]!.x).toBeCloseTo(100);
  });

  it('junctionAt picks the nearest junction within the radius', () => {
    const js = junctions(computeLayout(grid2x2(), PAGE, 0));
    expect(junctionAt(js, 103, 152, 5)).toBe(js[0]);
    expect(junctionAt(js, 110, 150, 5)).toBeNull();
  });
});
