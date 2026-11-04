import { clamp, computeLayout } from './geometry';
import { aspectMismatch, clampRatios, makeCell, makeSplit, matchPhotosToCells, smartFit, walk, type PhotoSizes } from './tree';
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

export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** How many random structures to try when photo shapes are known. */
const CANDIDATES = 40;

/** How far each split moves toward the „Dopasuj” ratio: enough to fit, not enough to look uniform. */
const FIT_PULL_MIN = 0.5;
const FIT_PULL_MAX = 0.85;

/** A random split structure for `n` cells (cells empty), ratios clamped to the valid range. */
function randomStructure(n: number, page: Rect, gap: number, rng: Rng): LayoutNode {
  const build = (count: number, r: Rect): LayoutNode => {
    if (count === 1) return makeCell(null);
    const k = clamp(Math.round(count * (0.3 + 0.4 * rng())), 1, count - 1);
    const pVertical = r.w >= r.h ? 0.75 : 0.25;
    const dir: Dir = rng() < pVertical ? 'v' : 'h';
    const ratio = clamp((k / count) * (0.8 + 0.4 * rng()), 0.18, 0.82);
    const [ra, rb]: [Rect, Rect] =
      dir === 'v'
        ? [{ ...r, w: r.w * ratio }, { ...r, x: r.x + r.w * ratio, w: r.w * (1 - ratio) }]
        : [{ ...r, h: r.h * ratio }, { ...r, y: r.y + r.h * ratio, h: r.h * (1 - ratio) }];
    return makeSplit(dir, ratio, build(k, ra), build(count - k, rb));
  };
  const tree = build(n, page);
  clampRatios(tree, page, gap);
  return tree;
}

/**
 * A random layout for the given photos. Each region is split in two, usually
 * across its longer side, into unequal but sensible parts; every cell keeps
 * its minimum size. The separator width (`gap`) is the document's own – the
 * draw never changes the style.
 *
 * With `photos` (sizes), several structures are drawn and photos are matched
 * to cells by shape (portrait to tall cells, landscape to wide ones); one of
 * the best-fitting candidates is picked at random. Without it photos are
 * placed in random order.
 */
export function randomLayout(
  photoIds: readonly (string | null)[],
  page: Rect,
  gap: number,
  rng: Rng,
  photos?: PhotoSizes,
): LayoutNode | null {
  if (photoIds.length === 0) return null;
  const n = photoIds.length;

  const fill = (tree: LayoutNode, ids: readonly (string | null)[]) => {
    computeLayout(tree, page, gap).cells.forEach((c, i) => (c.node.photoId = ids[i] ?? null));
    return tree;
  };

  if (!photos) return fill(randomStructure(n, page, gap, rng), shuffled(photoIds, rng));

  const aspectsOf = (tree: LayoutNode) =>
    computeLayout(tree, page, gap).cells.map((c) => (c.rect.h > 0 ? c.rect.w / c.rect.h : 1));

  const candidates = Array.from({ length: CANDIDATES }, () => {
    const tree = randomStructure(n, page, gap, rng);
    // Match photos to the drawn cells, then pull the splits part-way toward the
    // photos' own proportions and match once more on the adjusted cells.
    fill(tree, matchPhotosToCells(aspectsOf(tree), photoIds, photos, rng));
    const drawn = new Map<string, number>();
    walk(tree, (node) => node.type === 'split' && drawn.set(node.id, node.ratio));
    smartFit(tree, photos, page, gap);
    const pull = FIT_PULL_MIN + (FIT_PULL_MAX - FIT_PULL_MIN) * rng();
    walk(tree, (node) => {
      if (node.type === 'split') node.ratio = drawn.get(node.id)! + (node.ratio - drawn.get(node.id)!) * pull;
    });
    clampRatios(tree, page, gap);
    const aspects = aspectsOf(tree);
    const ids = matchPhotosToCells(aspects, photoIds, photos, rng);
    return { tree, ids, cost: aspectMismatch(aspects, ids, photos) };
  });
  // Keep variety: choose among all candidates close to the best one.
  const best = Math.min(...candidates.map((c) => c.cost));
  const pool = candidates.filter((c) => c.cost <= best + 0.08 * n);
  const pick = pool[Math.floor(rng() * pool.length)]!;
  return fill(pick.tree, pick.ids);
}
