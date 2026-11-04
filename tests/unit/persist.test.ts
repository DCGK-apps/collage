import { describe, expect, it } from 'vitest';
import { createDoc } from '../../src/core/doc';
import { createFloat } from '../../src/core/floats';
import {
  Autosaver,
  PROJECT_VERSION,
  referencedPhotoIds,
  restoreDoc,
  type ProjectStorage,
  type SavedProject,
  type StoredPhoto,
} from '../../src/core/persist';
import type { Doc, Photo } from '../../src/core/types';
import { cell, split } from './helpers';

class MemoryStorage implements ProjectStorage {
  project: SavedProject | null = null;
  photos = new Map<string, StoredPhoto>();
  saves = 0;
  async loadProject() { return this.project; }
  async saveProject(p: SavedProject) { this.saves++; this.project = structuredClone(p); }
  async loadPhoto(id: string) { return this.photos.get(id) ?? null; }
  async savePhoto(p: StoredPhoto) { this.photos.set(p.id, p); }
  async photoIds() { return [...this.photos.keys()]; }
  async deletePhoto(id: string) { this.photos.delete(id); }
}

const photo = (id: string): Photo => ({ id, src: `blob:${id}`, width: 300, height: 200 });

function sampleDoc(): Doc {
  const doc = createDoc();
  doc.library = ['a', 'b', 'c'];
  doc.tree = split('s', 'v', 0.3, cell('c1', 'a'), cell('c2', 'b'));
  doc.floats = [createFloat(photo('c'), { w: 210, h: 297 }, 0)];
  doc.style.gapMm = 7;
  return doc;
}

describe('referencedPhotoIds', () => {
  it('collects library, cell and layer photos', () => {
    const doc = sampleDoc();
    doc.library = [];
    expect([...referencedPhotoIds(doc)].sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('restoreDoc', () => {
  const wrap = (doc: unknown) => ({ version: PROJECT_VERSION, savedAt: 1, doc });

  it('round-trips a document', () => {
    const doc = sampleDoc();
    expect(restoreDoc(wrap(JSON.parse(JSON.stringify(doc))), new Set(['a', 'b', 'c']))).toEqual(doc);
  });

  it('drops references to photos that could not be restored', () => {
    const out = restoreDoc(wrap(sampleDoc()), new Set(['a']))!;
    expect(out.library).toEqual(['a']);
    expect((out.tree as any).second.photoId).toBeNull(); // cell kept, now empty
    expect(out.floats).toEqual([]);
  });

  it('rejects unknown versions and malformed data', () => {
    expect(restoreDoc({ version: 999, doc: sampleDoc() }, new Set())).toBeNull();
    expect(restoreDoc(wrap({ ...sampleDoc(), tree: { type: 'split', id: 'x' } }), new Set())).toBeNull();
    expect(restoreDoc(wrap({ ...sampleDoc(), floats: 'nope' }), new Set())).toBeNull();
    expect(restoreDoc(null, new Set())).toBeNull();
  });

  it('fills in missing optional fields with defaults', () => {
    const d: any = sampleDoc();
    delete d.formatId;
    d.style = {};
    const out = restoreDoc(wrap(d), new Set(['a', 'b', 'c']))!;
    expect(out.formatId).toBe('a4');
    expect(out.style.gapMm).toBe(createDoc().style.gapMm);
  });
});

describe('Autosaver', () => {
  function setup(doc = sampleDoc()) {
    const storage = new MemoryStorage();
    const photos = new Map(['a', 'b', 'c', 'd'].map((id) => [id, photo(id)]));
    const errors: unknown[] = [];
    let fetched = 0;
    const saver = new Autosaver(
      storage,
      () => doc,
      (id) => photos.get(id),
      async (p) => {
        fetched++;
        return new Blob([p.id]);
      },
      (e) => errors.push(e),
      5,
    );
    return { storage, saver, doc, errors, fetchedCount: () => fetched };
  }

  it('saves the document and every referenced photo', async () => {
    const { storage, saver, doc } = setup();
    await saver.flush();
    expect(storage.project!.doc).toEqual(doc);
    expect([...storage.photos.keys()].sort()).toEqual(['a', 'b', 'c']);
  });

  it('skips saving when nothing changed and stores each photo once', async () => {
    const { storage, saver, doc, fetchedCount } = setup();
    await saver.flush();
    await saver.flush();
    expect(storage.saves).toBe(1);
    doc.style.gapMm = 9;
    await saver.flush();
    expect(storage.saves).toBe(2);
    expect(fetchedCount()).toBe(3);
  });

  it('removes photos nothing uses any more', async () => {
    const { storage, saver, doc } = setup();
    await saver.flush();
    doc.floats = [];
    doc.library = ['a', 'b'];
    await saver.flush();
    expect([...storage.photos.keys()].sort()).toEqual(['a', 'b']);
  });

  it('debounces bursts of changes into one save', async () => {
    const { storage, saver, doc } = setup();
    for (let i = 0; i < 10; i++) {
      doc.style.gapMm = i;
      saver.schedule();
    }
    await new Promise((r) => setTimeout(r, 30));
    await saver.flush();
    expect(storage.saves).toBe(1);
    expect(storage.project!.doc.style.gapMm).toBe(9);
  });

  it('after a restore it does not re-save unchanged data', async () => {
    const { storage, saver } = setup();
    saver.markStored(['a', 'b', 'c']);
    saver.markSaved();
    await saver.flush();
    expect(storage.saves).toBe(0);
  });

  it('reports a storage failure once and keeps trying later', async () => {
    const { storage, saver, doc, errors } = setup();
    const ok = storage.saveProject.bind(storage);
    storage.saveProject = async () => {
      throw new Error('quota');
    };
    await saver.flush();
    doc.style.gapMm = 1;
    await saver.flush();
    expect(errors).toHaveLength(1);
    storage.saveProject = ok;
    doc.style.gapMm = 2;
    await saver.flush();
    expect(storage.project!.doc.style.gapMm).toBe(2);
  });
});
