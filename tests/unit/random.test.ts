import { describe, expect, it } from 'vitest';
import { computeLayout, MIN_CELL_MM } from '../../src/core/geometry';
import { randomLayout, seededRng, shuffled } from '../../src/core/random';
import { aspectMismatch, listCells, matchPhotosToCells, shufflePhotos } from '../../src/core/tree';

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

describe('shuffled', () => {
  it('is a permutation and does not modify the input', () => {
    const src = ids(8);
    const out = shuffled(src, seededRng(9));
    expect(out.slice().sort()).toEqual(src.slice().sort());
    expect(src).toEqual(ids(8));
  });
});

/* ------------------------------------------------- matching photo shapes */

// p0..p(k-1) portrait 3:4, the rest landscape 4:3.
const mixed = (n: number, portrait: number) =>
  new Map(ids(n).map((id, i) => [id, i < portrait ? { width: 3000, height: 4000 } : { width: 4000, height: 3000 }]));
const isPortrait = (id: string | null, k: number) => id !== null && Number(id.slice(1)) < k;
const cellAspects = (t: any, page = A4, gap = 4) => computeLayout(t, page, gap).cells.map((c) => c.rect.w / c.rect.h);

describe('matchPhotosToCells', () => {
  it('puts portrait photos into the tallest cells and landscape into the widest', () => {
    const photos = mixed(4, 2);
    for (let seed = 1; seed <= 30; seed++) {
      const out = matchPhotosToCells([1.6, 0.6, 1.4, 0.7], ids(4), photos, seededRng(seed));
      expect(out.slice().sort()).toEqual(ids(4));
      expect([isPortrait(out[0]!, 2), isPortrait(out[1]!, 2), isPortrait(out[2]!, 2), isPortrait(out[3]!, 2)]).toEqual([
        false,
        true,
        false,
        true,
      ]);
    }
  });

  it('still mixes photos of the same shape', () => {
    const photos = mixed(4, 4);
    const seen = new Set(Array.from({ length: 20 }, (_, s) => matchPhotosToCells([0.7, 0.7, 0.7, 0.7], ids(4), photos, seededRng(s + 1)).join()));
    expect(seen.size).toBeGreaterThan(5);
  });

  it('places empty slots and unknown photos somewhere', () => {
    const out = matchPhotosToCells([1, 1, 1], [null, 'x', 'p0'], mixed(1, 1), seededRng(1));
    expect(out.slice().sort()).toEqual([null, 'p0', 'x'].sort());
  });
});

describe('randomLayout with photo sizes', () => {
  it('fits shapes much better than a blind draw', () => {
    let blind = 0;
    let matched = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const photos = mixed(6, 3);
      const a = randomLayout(ids(6), A4, 4, seededRng(seed));
      const b = randomLayout(ids(6), A4, 4, seededRng(seed), photos);
      blind += aspectMismatch(cellAspects(a), listCells(a).map((c) => c.photoId), photos);
      matched += aspectMismatch(cellAspects(b), listCells(b).map((c) => c.photoId), photos);
      expect(listCells(b).map((c) => c.photoId).sort()).toEqual(ids(6).sort());
    }
    expect(matched).toBeLessThan(blind * 0.6);
  });

  it('puts portrait photos into tall cells when the draw allows it', () => {
    // 2 portrait + 2 landscape photos: every pair should be on the right side of square.
    let wrong = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const t = randomLayout(ids(4), A4, 4, seededRng(seed), mixed(4, 2));
      const asp = cellAspects(t);
      listCells(t).forEach((c, i) => {
        if (isPortrait(c.photoId, 2) !== asp[i]! < 1) wrong++;
      });
    }
    expect(wrong).toBeLessThan(40 * 4 * 0.1);
  });

  it('still produces varied layouts', () => {
    const shapes = new Set(Array.from({ length: 30 }, (_, s) => shape(randomLayout(ids(5), A4, 4, seededRng(s + 1), mixed(5, 2)))));
    expect(shapes.size).toBeGreaterThan(5);
  });
});

describe('shufflePhotos with photo sizes', () => {
  it('keeps portrait photos in tall cells and landscape in wide ones', () => {
    // Left column: two wide cells; right column: two tall cells.
    const t: any = {
      type: 'split', id: 's', dir: 'v', ratio: 0.5,
      first: { type: 'split', id: 'l', dir: 'h', ratio: 0.5, first: cellOf('p0'), second: cellOf('p1') },
      second: { type: 'split', id: 'r', dir: 'v', ratio: 0.5, first: cellOf('p2'), second: cellOf('p3') },
    };
    const page = { x: 0, y: 0, w: 400, h: 200 };
    const photos = mixed(4, 2); // p0, p1 portrait – currently in the wide cells
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      shufflePhotos(t, seededRng(seed), { photos, page, gap: 0 });
      const asp = cellAspects(t, page, 0);
      listCells(t).forEach((c, i) => expect(isPortrait(c.photoId, 2)).toBe(asp[i]! < 1));
      seen.add(listCells(t).map((c) => c.photoId).join());
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

function cellOf(photoId: string) {
  return { type: 'cell', id: `c-${photoId}`, photoId, crop: { zoom: 1, panX: 0, panY: 0, rotate: 0 } };
}
