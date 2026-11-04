import { createDoc } from './doc';
import { readCustom } from './page';
import type { Doc, LayoutNode, Photo } from './types';

/**
 * Saving the project on the device (survives reloads, app updates and closing
 * the app). Pure logic lives here; the IndexedDB adapter is in src/persist.ts.
 */

export const PROJECT_VERSION = 1;

export interface SavedProject {
  version: number;
  savedAt: number;
  doc: Doc;
}

export interface StoredPhoto {
  id: string;
  width: number;
  height: number;
  blob: Blob;
}

export interface ProjectStorage {
  loadProject(): Promise<SavedProject | null>;
  saveProject(p: SavedProject): Promise<void>;
  loadPhoto(id: string): Promise<StoredPhoto | null>;
  savePhoto(p: StoredPhoto): Promise<void>;
  photoIds(): Promise<string[]>;
  deletePhoto(id: string): Promise<void>;
}

function walk(n: LayoutNode | null, fn: (n: LayoutNode) => void): void {
  if (!n) return;
  fn(n);
  if (n.type === 'split') {
    walk(n.first, fn);
    walk(n.second, fn);
  }
}

/** Every photo the document needs: library, cells and floating layers. */
export function referencedPhotoIds(doc: Doc): Set<string> {
  const ids = new Set(doc.library);
  walk(doc.tree, (n) => {
    if (n.type === 'cell' && n.photoId) ids.add(n.photoId);
  });
  for (const f of doc.floats) ids.add(f.photoId);
  return ids;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function validNode(n: unknown): n is LayoutNode {
  if (!isObj(n) || typeof n.id !== 'string') return false;
  if (n.type === 'cell') return isObj(n.crop) && isNum(n.crop.zoom) && (n.photoId === null || typeof n.photoId === 'string');
  if (n.type === 'split') return (n.dir === 'v' || n.dir === 'h') && isNum(n.ratio) && validNode(n.first) && validNode(n.second);
  return false;
}

/**
 * Turn stored data back into a usable document, or null when it is not a
 * project we understand. References to photos that could not be restored are
 * dropped (cells become empty, layers disappear), so a damaged photo never
 * breaks the whole collage.
 */
export function restoreDoc(raw: unknown, available: Set<string>): Doc | null {
  if (!isObj(raw) || raw.version !== PROJECT_VERSION || !isObj(raw.doc)) return null;
  const d = raw.doc;
  if (d.tree !== null && !validNode(d.tree)) return null;
  if (!Array.isArray(d.floats) || !Array.isArray(d.library) || !isObj(d.style)) return null;

  const base = createDoc();
  const doc: Doc = {
    ...base,
    formatId: typeof d.formatId === 'string' ? d.formatId : base.formatId,
    ...(readCustom(d.customMm) ? { customMm: readCustom(d.customMm) } : {}),
    orientation: d.orientation === 'landscape' ? 'landscape' : 'portrait',
    style: {
      gapMm: isNum(d.style.gapMm) ? d.style.gapMm : base.style.gapMm,
      radiusMm: isNum(d.style.radiusMm) ? d.style.radiusMm : base.style.radiusMm,
      background: typeof d.style.background === 'string' ? d.style.background : base.style.background,
    },
    tree: structuredClone(d.tree as LayoutNode | null),
    floats: structuredClone(d.floats as Doc['floats']).filter((f) => isObj(f) && available.has(f.photoId)),
    library: (d.library as unknown[]).filter((id): id is string => typeof id === 'string' && available.has(id)),
  };
  walk(doc.tree, (n) => {
    if (n.type === 'cell' && n.photoId && !available.has(n.photoId)) n.photoId = null;
  });
  return doc;
}

/**
 * Debounced autosave. Saves the document when it changed, stores photos the
 * first time they are referenced and removes photos nothing uses any more.
 * Saves never overlap; the latest state always wins.
 */
export class Autosaver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSaved = '';
  private stored = new Set<string>();
  private running: Promise<void> = Promise.resolve();
  private failed = false;

  constructor(
    private readonly storage: ProjectStorage,
    private readonly getDoc: () => Doc,
    private readonly getPhoto: (id: string) => Photo | undefined,
    private readonly toBlob: (photo: Photo) => Promise<Blob>,
    private readonly onError: (err: unknown) => void,
    private readonly delayMs = 400,
  ) {}

  /** Photos already in storage (after a restore) – skip re-saving them. */
  markStored(ids: Iterable<string>): void {
    for (const id of ids) this.stored.add(id);
  }

  /** Treat the current document as saved (e.g. right after restoring it). */
  markSaved(): void {
    this.lastSaved = JSON.stringify(this.getDoc());
  }

  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.delayMs);
  }

  /** Save now (also used when the app goes to the background). */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.running = this.running.then(() => this.save()).catch((err) => {
      if (!this.failed) this.onError(err);
      this.failed = true;
    });
    return this.running;
  }

  private async save(): Promise<void> {
    const doc = this.getDoc();
    const json = JSON.stringify(doc);
    if (json === this.lastSaved) return;
    const needed = referencedPhotoIds(doc);
    for (const id of needed) {
      if (this.stored.has(id)) continue;
      const p = this.getPhoto(id);
      if (!p) continue;
      await this.storage.savePhoto({ id, width: p.width, height: p.height, blob: await this.toBlob(p) });
      this.stored.add(id);
    }
    await this.storage.saveProject({ version: PROJECT_VERSION, savedAt: Date.now(), doc: JSON.parse(json) });
    this.lastSaved = json;
    this.failed = false;
    for (const id of await this.storage.photoIds()) {
      if (!needed.has(id)) {
        await this.storage.deletePhoto(id);
        this.stored.delete(id);
      }
    }
  }
}
