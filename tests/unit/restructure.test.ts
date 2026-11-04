import { describe, expect, it } from 'vitest';
import { computeLayout } from '../../src/core/geometry';
import { raise, splitDividerAt } from '../../src/core/restructure';
import { buildPreset } from '../../src/core/tree';
import type { LayoutNode } from '../../src/core/types';
import { cell, grid2x2, PAGE, split } from './helpers';

/** Cell rectangles by photo, rounded – the picture the user sees. */
function picture(t: LayoutNode | null, gap = 4) {
  const out: Record<string, number[]> = {};
  for (const c of computeLayout(t, PAGE, gap).cells) {
    out[c.node.photoId ?? c.id] = [c.rect.x, c.rect.y, c.rect.w, c.rect.h].map((v) => Math.round(v * 1e6) / 1e6);
  }
  return out;
}

const dividerAt = (t: LayoutNode, x: number, y: number, dir: 'v' | 'h') =>
  computeLayout(t, PAGE, 0).dividers.find(
    (d) => d.dir === dir && Math.abs((dir === 'v' ? x : y) - d.pos) < 0.5 && (dir === 'v' ? y : x) > d.spanStart && (dir === 'v' ? y : x) < d.spanEnd,
  );

describe('raise', () => {
  it('rotates a chain so a deeper divider becomes the root, without moving anything', () => {
    const t = split('a', 'v', 0.25, cell('p'), split('b', 'v', 0.4, cell('q'), cell('r')));
    const r = raise(structuredClone(t), 'b')!;
    expect(r.id).toBe('b');
    expect(picture(r)).toEqual(picture(t));
  });

  it('transposes a 2×2 grid from rows to columns', () => {
    const t = grid2x2(); // h(root) over v(top), v(bottom)
    const r = raise(structuredClone(t), 'top') as any;
    expect(r.dir).toBe('v');
    expect(r.id).toBe('top');
    expect(r.first.dir).toBe('h');
    expect(picture(r)).toEqual(picture(t));
  });

  it('refuses when the line is not aligned across the whole area', () => {
    const t = grid2x2();
    (t.second as any).ratio = 0.3;
    expect(raise(structuredClone(t), 'top')).toBeNull();
  });
});

describe('splitDividerAt', () => {
  it('2×2: the horizontal line becomes two independent halves', () => {
    const t = grid2x2();
    const out = splitDividerAt(t, 'root', 'top')!;
    expect(picture(out)).toEqual(picture(t));
    const left = dividerAt(out, 50, 150, 'h')!;
    const right = dividerAt(out, 150, 150, 'h')!;
    expect(left.id).not.toBe(right.id);
    expect([left.spanStart, left.spanEnd]).toEqual([0, 100]);
    // Moving the left half leaves the right one in place.
    left.node.ratio = 0.3;
    const after = computeLayout(out, PAGE, 0);
    expect(after.dividers.find((d) => d.id === right.id)!.pos).toBeCloseTo(150);
    // the input tree is not modified
    expect((t as any).dir).toBe('h');
  });

  it('works back and forth: after splitting horizontally, the vertical line can be split again', () => {
    const cols = splitDividerAt(grid2x2(), 'root', 'top')!; // now the vertical line is one divider
    const vLine = dividerAt(cols, 100, 75, 'v')!;
    const hLeft = dividerAt(cols, 50, 150, 'h')!;
    const rows = splitDividerAt(cols, vLine.id, hLeft.id)!;
    expect(picture(rows)).toEqual(picture(grid2x2()));
    expect(dividerAt(rows, 100, 75, 'v')!.id).not.toBe(dividerAt(rows, 100, 225, 'v')!.id);
  });

  it('3×3 grid: isolates the middle third of a horizontal line', () => {
    const ids = Array.from({ length: 9 }, (_, i) => `p${i}`);
    let t = buildPreset('grid', ids, 1)!; // 3 rows × 3 columns
    const pic = picture(t);
    // Split the first row line at both vertical crossings.
    for (let i = 0; i < 2; i++) {
      const line = dividerAt(t, 100, 100, 'h')!;
      const lay = computeLayout(t, PAGE, 0);
      const crossing = lay.dividers.find(
        (d) => d.dir === 'v' && d.pos > line.spanStart + 1 && d.pos < line.spanEnd - 1 && Math.abs(d.spanEnd - 100) < 0.5,
      )!;
      const next = splitDividerAt(t, line.id, crossing.id);
      expect(next).not.toBeNull();
      t = next!;
    }
    expect(picture(t)).toEqual(pic);
    const mid = dividerAt(t, 100, 100, 'h')!;
    expect(mid.spanStart).toBeCloseTo(66.667, 2);
    expect(mid.spanEnd).toBeCloseTo(133.333, 2);
  });

  it('keeps the picture identical with a gap', () => {
    const t = grid2x2();
    expect(picture(splitDividerAt(t, 'root', 'bottom')!, 9)).toEqual(picture(t, 9));
  });

  it('returns null for unknown or unrelated dividers', () => {
    expect(splitDividerAt(grid2x2(), 'nope', 'top')).toBeNull();
    expect(splitDividerAt(grid2x2(), 'top', 'root')).toBeNull();
  });
});
