import { computeLayout } from './geometry';
import { uid } from './ids';
import { findNode, replaceNode } from './tree';
import type { Dir, LayoutNode, SplitNode } from './types';

/**
 * Geometry-preserving rewrites of the layout tree.
 *
 * The same picture can be built in several ways: a 2×2 grid is either "two rows,
 * each split in two" or "two columns, each split in two". Which one is used
 * decides which line is a single divider and which consists of independent
 * segments. To let the user move any segment on its own, the tree is rewritten
 * on the fly into an equivalent one where that segment is its own divider.
 * Every rewrite keeps all cell rectangles exactly the same.
 */

/** ((X | Y) | Z) → (X | (Y | Z)), same positions. The X|Y line keeps the old inner id and becomes the root. */
function rotateRight(s: SplitNode): SplitNode {
  const t = s.first as SplitNode;
  const r = s.ratio;
  const q = t.ratio;
  const outer = r * q;
  const inner = (r - outer) / (1 - outer);
  return { ...t, ratio: outer, first: t.first, second: { ...s, ratio: inner, first: t.second, second: s.second } };
}

/** (X | (Y | Z)) → ((X | Y) | Z), same positions. The Y|Z line keeps the old inner id and becomes the root. */
function rotateLeft(s: SplitNode): SplitNode {
  const t = s.second as SplitNode;
  const r = s.ratio;
  const q = t.ratio;
  const outer = r + (1 - r) * q;
  const inner = r / outer;
  return { ...t, ratio: outer, first: { ...s, ratio: inner, first: s.first, second: t.first }, second: t.second };
}

function contains(n: LayoutNode, id: string): boolean {
  if (n.id === id) return true;
  return n.type === 'split' && (contains(n.first, id) || contains(n.second, id));
}

/** Position of every divider of `dir`, as a fraction of `n`'s own extent (gap-free unit layout). */
function dividerFractions(n: LayoutNode, dir: Dir): { id: string; pos: number }[] {
  return computeLayout(n, { x: 0, y: 0, w: 1, h: 1 }, 0)
    .dividers.filter((d) => d.dir === dir)
    .map((d) => ({ id: d.id, pos: d.pos }));
}

/**
 * Rewrite `node` so that the divider `targetId` becomes its root, keeping the
 * picture identical. Returns null when impossible (the line does not run across
 * the whole subtree, e.g. it is not aligned with its neighbours).
 */
export function raise(node: LayoutNode, targetId: string): LayoutNode | null {
  if (node.type === 'cell') return null;
  if (node.id === targetId) return node;
  const target = findNode(node, targetId);
  if (!target || target.type !== 'split') return null;
  const inFirst = contains(node.first, targetId);

  if (node.dir === target.dir) {
    const child = raise(inFirst ? node.first : node.second, targetId);
    if (!child || child.type !== 'split' || child.dir !== node.dir) return null;
    const n: SplitNode = inFirst ? { ...node, first: child } : { ...node, second: child };
    return inFirst ? rotateRight(n) : rotateLeft(n);
  }

  // Perpendicular: the target line must continue through the other child too.
  const raisedChild = raise(inFirst ? node.first : node.second, targetId);
  if (!raisedChild || raisedChild.type !== 'split') return null;
  const other = inFirst ? node.second : node.first;
  // The partner may itself be made of several segments – try each one at that position.
  let raisedOther: LayoutNode | null = null;
  for (const c of dividerFractions(other, target.dir)) {
    if (Math.abs(c.pos - raisedChild.ratio) > 1e-4) continue;
    raisedOther = raise(structuredClone(other), c.id);
    if (raisedOther) break;
  }
  if (!raisedOther || raisedOther.type !== 'split') return null;
  const A = (inFirst ? raisedChild : raisedOther) as SplitNode;
  const B = (inFirst ? raisedOther : raisedChild) as SplitNode;
  const p = (A.ratio + B.ratio) / 2;
  // (A1|A2) over (B1|B2)  →  (A1 over B1) | (A2 over B2)
  return {
    type: 'split',
    id: targetId,
    dir: target.dir,
    ratio: p,
    first: { type: 'split', id: node.id, dir: node.dir, ratio: node.ratio, first: A.first, second: B.first },
    second: { type: 'split', id: uid('s'), dir: node.dir, ratio: node.ratio, first: A.second, second: B.second },
  };
}

/**
 * Break divider `dividerId` where the perpendicular line `crossingId` meets it,
 * so that each part becomes its own divider. Returns the new tree, or null when
 * the layout cannot be rewritten that way.
 */
export function splitDividerAt(tree: LayoutNode, dividerId: string, crossingId: string): LayoutNode | null {
  const d = findNode(tree, dividerId);
  if (!d || d.type !== 'split' || !contains(d, crossingId) || d.id === crossingId) return null;
  const sub = raise(structuredClone(d), crossingId);
  if (!sub) return null;
  return replaceNode(structuredClone(tree), dividerId, sub);
}
