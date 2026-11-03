import type { CellNode, LayoutNode, SplitNode } from '../../src/core/types';

export function cell(id: string, photoId: string | null = id): CellNode {
  return { type: 'cell', id, photoId, crop: { zoom: 1, panX: 0, panY: 0, rotate: 0 } };
}

export function split(id: string, dir: 'v' | 'h', ratio: number, first: LayoutNode, second: LayoutNode): SplitNode {
  return { type: 'split', id, dir, ratio, first, second };
}

/** 2×2 grid: root h-split, rows are v-splits. */
export function grid2x2(): SplitNode {
  return split('root', 'h', 0.5, split('top', 'v', 0.5, cell('a'), cell('b')), split('bottom', 'v', 0.5, cell('c'), cell('d')));
}

export const PAGE = { x: 0, y: 0, w: 200, h: 300 };
