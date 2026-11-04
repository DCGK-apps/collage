import { clamp } from './geometry';
import { clampRatios, makeCell, makeSplit } from './tree';
import type { Dir, LayoutNode, Rect } from './types';

export type Rng = () => number;

/** Small seeded PRNG (mulberry32) – deterministic layouts in tests. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Separator thicknesses (mm) to draw from – from seamless to a wide passe-partout. */
export const GAP_CHOICES = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12] as const;

export function randomGap(rng: Rng): number {
  return GAP_CHOICES[Math.floor(rng() * GAP_CHOICES.length)]!;
}

export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * A random layout for the given photos (in random order). Each region is split
 * in two, usually across its longer side, into unequal but sensible parts;
 * afterwards every cell is guaranteed its minimum size.
 */
export function randomLayout(photoIds: readonly (string | null)[], page: Rect, gap: number, rng: Rng): LayoutNode | null {
  if (photoIds.length === 0) return null;
  const ids = shuffled(photoIds, rng);

  const build = (items: (string | null)[], r: Rect): LayoutNode => {
    if (items.length === 1) return makeCell(items[0]!);
    const n = items.length;
    const k = clamp(Math.round(n * (0.3 + 0.4 * rng())), 1, n - 1);
    const pVertical = r.w >= r.h ? 0.75 : 0.25;
    const dir: Dir = rng() < pVertical ? 'v' : 'h';
    const ratio = clamp((k / n) * (0.8 + 0.4 * rng()), 0.18, 0.82);
    const [ra, rb]: [Rect, Rect] =
      dir === 'v'
        ? [{ ...r, w: r.w * ratio }, { ...r, x: r.x + r.w * ratio, w: r.w * (1 - ratio) }]
        : [{ ...r, h: r.h * ratio }, { ...r, y: r.y + r.h * ratio, h: r.h * (1 - ratio) }];
    return makeSplit(dir, ratio, build(items.slice(0, k), ra), build(items.slice(k), rb));
  };

  const tree = build(ids, page);
  clampRatios(tree, page, gap);
  return tree;
}
