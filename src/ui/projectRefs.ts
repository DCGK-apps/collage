import type { Doc, LayoutNode } from '../core/types';

/** Photos the document needs (library, cells, layers), in a stable order. */
export function referencedIds(doc: Doc): string[] {
  const out: string[] = [];
  const add = (id: string | null) => {
    if (id && !out.includes(id)) out.push(id);
  };
  doc.library.forEach(add);
  const walk = (n: LayoutNode | null): void => {
    if (!n) return;
    if (n.type === 'cell') add(n.photoId);
    else {
      walk(n.first);
      walk(n.second);
    }
  };
  walk(doc.tree);
  doc.floats.forEach((f) => add(f.photoId));
  return out;
}
