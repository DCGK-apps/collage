import { packProject, projectFileName, unpackProject, ProjectError, type ProjectPhotoAsset } from '../core/project';
import { referencedIds } from './projectRefs';
import type { Store } from '../store';
import { downloadBlob } from './export';
import { loadImage, type LoadedPhoto } from './images';

/** Collect photo bytes for every photo the document uses. */
async function collectAssets(store: Store): Promise<ProjectPhotoAsset[]> {
  const out: ProjectPhotoAsset[] = [];
  for (const id of referencedIds(store.doc)) {
    const p = store.photos.get(id);
    if (!p) continue;
    const blob = await (await fetch(p.src)).blob();
    out.push({
      id,
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mime: blob.type || 'application/octet-stream',
      width: p.width,
      height: p.height,
      ...(p.name ? { name: p.name } : {}),
    });
  }
  return out;
}

/** Save the whole collage as one .collage file (share sheet on phones, download elsewhere). */
export async function saveProjectFile(store: Store): Promise<string> {
  const zip = packProject(store.doc, await collectAssets(store));
  const name = projectFileName();
  const blob = new Blob([zip as BlobPart], { type: 'application/zip' });
  const file = new File([blob], name, { type: 'application/zip' });
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  if (coarse && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return name;
    } catch {
      /* cancelled – fall back to download */
    }
  }
  downloadBlob(blob, name);
  return name;
}

/**
 * Open a .collage file and replace the current collage (undoable).
 * Returns how many photos could not be restored.
 */
export async function openProjectFile(
  file: File,
  store: Store,
  register: (items: LoadedPhoto[]) => void,
): Promise<{ missing: number }> {
  const opened = await unpackProject(new Uint8Array(await file.arrayBuffer()));
  const items: LoadedPhoto[] = [];
  let broken = 0;
  for (const a of opened.photos) {
    try {
      const src = URL.createObjectURL(new Blob([a.bytes as BlobPart], { type: a.mime }));
      const img = await loadImage(src);
      items.push({
        photo: { id: a.id, src, width: a.width || img.naturalWidth, height: a.height || img.naturalHeight, ...(a.name ? { name: a.name } : {}) },
        img,
      });
    } catch {
      broken++;
    }
  }
  if (broken) {
    // Re-validate without photos that failed to decode.
    const ok = new Set(items.map((i) => i.photo.id));
    const visit = (n: typeof opened.doc.tree): void => {
      if (!n) return;
      if (n.type === 'cell' && n.photoId && !ok.has(n.photoId)) n.photoId = null;
      if (n.type === 'split') {
        visit(n.first);
        visit(n.second);
      }
    };
    visit(opened.doc.tree);
    opened.doc.floats = opened.doc.floats.filter((f) => ok.has(f.photoId));
    opened.doc.library = opened.doc.library.filter((id) => ok.has(id));
  }
  register(items);
  store.edit(() => opened.doc);
  store.ui.selectedCellId = null;
  store.ui.selectedFloatId = null;
  store.ui.swapFromCellId = null;
  return { missing: opened.missing + broken };
}

export { ProjectError };
