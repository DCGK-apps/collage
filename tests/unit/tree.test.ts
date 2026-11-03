import { describe, expect, it } from 'vitest';
import { computeLayout } from '../../src/core/geometry';
import {
  buildPreset,
  equalize,
  findNode,
  gridShape,
  insertPhoto,
  listCells,
  removeCell,
  removePhotoFromTree,
  shufflePhotos,
  smartFit,
  swapCells,
  toggleSplitDir,
} from '../../src/core/tree';
import type { Photo, SplitNode } from '../../src/core/types';
import { cell, grid2x2, PAGE, split } from './helpers';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
const PRESETS = ['grid', 'mosaic', 'featured', 'columns', 'rows'] as const;

describe('buildPreset', () => {
  it.each(PRESETS)('%s keeps every photo exactly once (1..12 photos)', (preset) => {
    for (let n = 1; n <= 12; n++) {
      const tree = buildPreset(preset, ids(n));
      expect(listCells(tree).map((c) => c.photoId)).toEqual(ids(n));
    }
  });

  it('returns null for no photos', () => {
    expect(buildPreset('grid', [])).toBeNull();
  });

  it('grid of 4 on A4 is 2×2 with equal cells', () => {
    const tree = buildPreset('grid', ids(4), 210 / 297);
    const { cells } = computeLayout(tree, { x: 0, y: 0, w: 210, h: 297 }, 0);
    for (const c of cells) {
      expect(c.rect.w).toBeCloseTo(105);
      expect(c.rect.h).toBeCloseTo(148.5);
    }
  });

  it('columns produce equal widths for odd counts', () => {
    const { cells } = computeLayout(buildPreset('columns', ids(3)), PAGE, 0);
    for (const c of cells) expect(c.rect.w).toBeCloseTo(200 / 3);
  });

  it('node ids are unique', () => {
    const all: string[] = [];
    const walk = (n: any) => {
      all.push(n.id);
      if (n.type === 'split') { walk(n.first); walk(n.second); }
    };
    walk(buildPreset('featured', ids(9)));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('gridShape', () => {
  it('chooses sensible shapes', () => {
    expect(gridShape(4, 210 / 297)).toEqual({ cols: 2, rows: 2 });
    expect(gridShape(6, 210 / 297)).toEqual({ cols: 2, rows: 3 });
    expect(gridShape(6, 297 / 210)).toEqual({ cols: 3, rows: 2 });
  });
});

describe('toggleSplitDir', () => {
  it('flips vertical ↔ horizontal and keeps the ratio', () => {
    const t = split('s', 'v', 0.3, cell('a'), cell('b'));
    expect(toggleSplitDir(t, 's')).toBe(true);
    expect(t.dir).toBe('h');
    expect(t.ratio).toBe(0.3);
    toggleSplitDir(t, 's');
    expect(t.dir).toBe('v');
  });

  it('changes the geometry of the two neighbours', () => {
    const t = split('s', 'v', 0.5, cell('a'), cell('b'));
    toggleSplitDir(t, 's');
    const [a, b] = computeLayout(t, PAGE, 0).cells;
    expect(a!.rect).toEqual({ x: 0, y: 0, w: 200, h: 150 });
    expect(b!.rect).toEqual({ x: 0, y: 150, w: 200, h: 150 });
  });

  it('returns false for unknown ids and cells', () => {
    expect(toggleSplitDir(grid2x2(), 'nope')).toBe(false);
    expect(toggleSplitDir(grid2x2(), 'a')).toBe(false);
  });
});

describe('insertPhoto', () => {
  it('creates a single cell for an empty layout', () => {
    const t = insertPhoto(null, 'x', PAGE, 0);
    expect(listCells(t).map((c) => c.photoId)).toEqual(['x']);
  });

  it('fills empty cells first', () => {
    const t = split('s', 'v', 0.5, cell('a'), cell('b', null));
    insertPhoto(t, 'x', PAGE, 0);
    expect(findNode(t, 'b')).toMatchObject({ photoId: 'x' });
  });

  it('splits the largest cell and preserves existing ratios', () => {
    const t = split('s', 'v', 0.7, cell('a'), cell('b'));
    const out = insertPhoto(t, 'x', PAGE, 0) as SplitNode;
    expect(out.ratio).toBe(0.7);
    const first = out.first as SplitNode;
    expect(first.type).toBe('split');
    expect(first.dir).toBe('h'); // 140×300 cell is taller than wide
    expect(listCells(out).map((c) => c.photoId)).toEqual(['a', 'x', 'b']);
  });
});

describe('removeCell', () => {
  it('lets the sibling take over the parent', () => {
    const t = grid2x2();
    const out = removeCell(t, 'a')!;
    expect(listCells(out).map((c) => c.id)).toEqual(['b', 'c', 'd']);
    const { cells } = computeLayout(out, PAGE, 0);
    expect(cells.find((c) => c.id === 'b')!.rect.w).toBeCloseTo(200);
  });

  it('removing the last cell yields an empty layout', () => {
    expect(removeCell(cell('a'), 'a')).toBeNull();
  });

  it('removePhotoFromTree removes all cells with the photo', () => {
    const t = split('s', 'v', 0.5, cell('a', 'p'), split('t', 'h', 0.5, cell('b', 'p'), cell('c', 'q')));
    expect(listCells(removePhotoFromTree(t, 'p')).map((c) => c.photoId)).toEqual(['q']);
  });
});

describe('swap / shuffle / equalize', () => {
  it('swaps photo and crop between cells', () => {
    const t = grid2x2();
    (findNode(t, 'a') as any).crop.zoom = 2;
    expect(swapCells(t, 'a', 'd')).toBe(true);
    expect(findNode(t, 'a')).toMatchObject({ photoId: 'd', crop: { zoom: 1 } });
    expect(findNode(t, 'd')).toMatchObject({ photoId: 'a', crop: { zoom: 2 } });
    expect(swapCells(t, 'a', 'a')).toBe(false);
  });

  it('shuffle is a permutation', () => {
    const t = grid2x2();
    let seed = 1;
    shufflePhotos(t, () => ((seed = (seed * 16807) % 2147483647) / 2147483647));
    expect(listCells(t).map((c) => c.photoId).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('equalize gives chained splits equal shares', () => {
    const t = split('o', 'v', 0.9, cell('a'), split('i', 'v', 0.1, cell('b'), cell('c')));
    equalize(t);
    const { cells } = computeLayout(t, PAGE, 0);
    for (const c of cells) expect(c.rect.w).toBeCloseTo(200 / 3);
  });
});

describe('smartFit', () => {
  const photos = new Map<string, Photo>([
    ['wide', { id: 'wide', src: '', width: 3000, height: 1000 }],
    ['tall', { id: 'tall', src: '', width: 1000, height: 3000 }],
  ]);

  it('gives wider photos more width side by side', () => {
    const t = split('s', 'v', 0.5, cell('a', 'wide'), cell('b', 'tall'));
    smartFit(t, photos, PAGE, 0);
    expect(t.ratio).toBeGreaterThan(0.5);
  });

  it('respects minimum cell sizes', () => {
    const t = split('s', 'v', 0.5, cell('a', 'wide'), cell('b', 'tall'));
    smartFit(t, photos, { x: 0, y: 0, w: 40, h: 300 }, 0);
    const { cells } = computeLayout(t, { x: 0, y: 0, w: 40, h: 300 }, 0);
    for (const c of cells) expect(c.rect.w).toBeGreaterThanOrEqual(12 - 1e-6);
  });
});
