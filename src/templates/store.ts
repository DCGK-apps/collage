import type { Template } from '../core/templates';

export interface StoredTemplate {
  /** Content key (templateKey) – the same layout is stored once. */
  id: string;
  template: Template;
  createdAt: number;
}

/** User templates on the device (IndexedDB database "collage-templates"). */
export class TemplateStore {
  private db: Promise<IDBDatabase>;

  constructor() {
    this.db = new Promise((resolve, reject) => {
      const open = indexedDB.open('collage-templates', 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains('templates')) open.result.createObjectStore('templates', { keyPath: 'id' });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }

  private async run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const store = (await this.db).transaction('templates', mode).objectStore('templates');
    return new Promise((resolve, reject) => {
      const r = fn(store);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  async list(): Promise<StoredTemplate[]> {
    const all = await this.run('readonly', (s) => s.getAll() as IDBRequest<StoredTemplate[]>);
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }

  async put(t: StoredTemplate): Promise<void> {
    await this.run('readwrite', (s) => s.put(t));
  }

  async delete(id: string): Promise<void> {
    await this.run('readwrite', (s) => s.delete(id));
  }
}
