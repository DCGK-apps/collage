import { describe, expect, it } from 'vitest';
import { computeLayout, MIN_CELL_MM } from '../../src/core/geometry';
import { GAP_CHOICES, randomGap, randomLayout, seededRng, shuffled } from '../../src/core/random';
import { listCells } from '../../src/core/tree';

const A4 = { x: 0, y: 0, w: 210, h: 297 };
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
const shape = (t: any): string => (t.type === 'cell' ? 'c' : `${t.dir}(${shape(t.first)},${shape(t.second)})`);

describe('seededRng', () => {
  it('is deterministic and in [0, 1)', () => {
    const a = seededRng(42);
    const b = seededRng(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('randomLayout', () => {
  it('uses every photo exactly once (1..12 photos, many seeds)', () => {
    for (let n = 1; n <= 12; n++)
      for (let seed = 1; seed <= 20; seed++) {
        const t = randomLayout(ids(n), A4, 4, seededRng(seed));
        expect(listCells(t).map((c) => c.photoId).sort()).toEqual(ids(n).sort());
      }
  });

  it('keeps every cell at least the minimum size, even with a wide gap', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const gap = 12;
      const t = randomLayout(ids(9), A4, gap, seededRng(seed));
      for (const c of computeLayout(t, A4, gap).cells) {
        expect(c.rect.w).toBeGreaterThanOrEqual(MIN_CELL_MM - 1e-6);
        expect(c.rect.h).toBeGreaterThanOrEqual(MIN_CELL_MM - 1e-6);
      }
    }
  });

  it('produces varied layouts', () => {
    const shapes = new Set(Array.from({ length: 30 }, (_, s) => shape(randomLayout(ids(5), A4, 4, seededRng(s + 1)))));
    expect(shapes.size).toBeGreaterThan(5);
  });

  it('keeps empty cells and handles no photos', () => {
    expect(listCells(randomLayout([null, null, 'a'], A4, 4, seededRng(1)))).toHaveLength(3);
    expect(randomLayout([], A4, 4, seededRng(1))).toBeNull();
  });

  it('is reproducible for a seed', () => {
    expect(shape(randomLayout(ids(6), A4, 4, seededRng(7)))).toBe(shape(randomLayout(ids(6), A4, 4, seededRng(7))));
  });
});

describe('randomGap / shuffled', () => {
  it('draws gaps from the allowed set and covers it', () => {
    const rng = seededRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const g = randomGap(rng);
      expect(GAP_CHOICES).toContain(g);
      seen.add(g);
    }
    expect(seen.size).toBe(GAP_CHOICES.length);
  });

  it('shuffle is a permutation and does not modify the input', () => {
    const src = ids(8);
    const out = shuffled(src, seededRng(9));
    expect(out.slice().sort()).toEqual(src.slice().sort());
    expect(src).toEqual(ids(8));
  });
});
