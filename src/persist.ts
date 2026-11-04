import { restoreDoc, type ProjectStorage, type SavedProject, type StoredPhoto } from './core/persist';
import type { Doc } from './core/types';
import { loadImage, type LoadedPhoto } from './ui/images';

const DB_NAME = 'collage';
const DB_VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** IndexedDB storage: one record for the document, one per photo (as a Blob). */
export class IdbStorage implements ProjectStorage {
  private db: Promise<IDBDatabase>;

  constructor() {
    this.db = new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('project')) db.createObjectStore('project');
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }

  private async store(name: 'project' | 'photos', mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.db).transaction(name, mode).objectStore(name);
  }

  async loadProject(): Promise<SavedProject | null> {
    return ((await req((await this.store('project', 'readonly')).get('current'))) as SavedProject | undefined) ?? null;
  }
  async saveProject(p: SavedProject): Promise<void> {
    await req((await this.store('project', 'readwrite')).put(p, 'current'));
  }
  async loadPhoto(id: string): Promise<StoredPhoto | null> {
    return ((await req((await this.store('photos', 'readonly')).get(id))) as StoredPhoto | undefined) ?? null;
  }
  async savePhoto(p: StoredPhoto): Promise<void> {
    await req((await this.store('photos', 'readwrite')).put(p));
  }
  async photoIds(): Promise<string[]> {
    return (await req((await this.store('photos', 'readonly')).getAllKeys())) as string[];
  }
  async deletePhoto(id: string): Promise<void> {
    await req((await this.store('photos', 'readwrite')).delete(id));
  }
}

/** Load the saved project with its photos, or null when there is none (or it is unusable). */
export async function restoreProject(storage: ProjectStorage): Promise<{ doc: Doc; photos: LoadedPhoto[] } | null> {
  const saved = await storage.loadProject();
  if (!saved || !saved.doc) return null;
  const wanted = new Set<string>(saved.doc.library ?? []);
  for (const f of saved.doc.floats ?? []) wanted.add(f.photoId);
  const visit = (n: Doc['tree']): void => {
    if (!n) return;
    if (n.type === 'cell' && n.photoId) wanted.add(n.photoId);
    if (n.type === 'split') {
      visit(n.first);
      visit(n.second);
    }
  };
  visit(saved.doc.tree);

  const photos: LoadedPhoto[] = [];
  await Promise.all(
    [...wanted].map(async (id) => {
      try {
        const stored = await storage.loadPhoto(id);
        if (!stored) return;
        const src = URL.createObjectURL(stored.blob);
        const img = await loadImage(src);
        photos.push({ photo: { id, src, width: stored.width || img.naturalWidth, height: stored.height || img.naturalHeight }, img });
      } catch {
        /* a broken photo is dropped by restoreDoc */
      }
    }),
  );
  const doc = restoreDoc(saved, new Set(photos.map((p) => p.photo.id)));
  return doc ? { doc, photos } : null;
}

/** Ask the browser not to evict our data under storage pressure (best effort). */
export function requestPersistentStorage(): void {
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* ignore */
  }
}
