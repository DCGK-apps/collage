import { createDoc } from './core/doc';
import { History } from './core/history';
import type { Preset } from './core/tree';
import type { Doc, Photo } from './core/types';

export type Mode = 'edges' | 'crop' | 'layers';

export interface UiState {
  mode: Mode;
  selectedCellId: string | null;
  selectedFloatId: string | null;
  /** Cell waiting for a second tap to swap photos with. */
  swapFromCellId: string | null;
  /** Show the blue edge handles (edges stay draggable when hidden). */
  showHandles: boolean;
  preset: Preset;
  exportDpi: number;
}

type Listener = () => void;

const PREFS_KEY = 'collage.prefs';

/** Per-browser preferences; storage may be unavailable (private mode), so never throw. */
export function loadPref<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')[key];
    return v === undefined ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: unknown): void {
  try {
    const all = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    all[key] = value;
    localStorage.setItem(PREFS_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

/**
 * Single source of truth. `doc` is the undoable document; `ui` is transient.
 * Rendering is batched to one frame via requestAnimationFrame, so pointer
 * moves can call `notify()` as often as they like.
 */
export class Store {
  doc: Doc = createDoc();
  ui: UiState = {
    mode: 'edges',
    selectedCellId: null,
    selectedFloatId: null,
    swapFromCellId: null,
    showHandles: loadPref('showHandles', true),
    preset: 'grid',
    exportDpi: 300,
  };
  readonly photos = new Map<string, Photo>();
  readonly images = new Map<string, HTMLImageElement>();
  readonly history = new History<Doc>();

  private listeners = new Set<Listener>();
  private frame = 0;
  private gestureCheckpointed = false;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.flush();
    });
  }

  flush(): void {
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    for (const fn of this.listeners) fn();
  }

  /** One undoable edit. Return a new Doc from `fn` or mutate the given one. */
  edit(fn: (doc: Doc) => Doc | void): void {
    this.history.checkpoint(this.doc);
    const next = fn(this.doc);
    if (next) this.doc = next;
    this.notify();
  }

  /** Start of a continuous gesture (drag). The checkpoint is taken lazily on first change. */
  beginGesture(): void {
    this.gestureCheckpointed = false;
  }

  /** Call right before the first mutation of a gesture. */
  touchGesture(): void {
    if (!this.gestureCheckpointed) {
      this.history.checkpoint(this.doc);
      this.gestureCheckpointed = true;
    }
  }

  endGesture(): boolean {
    const changed = this.gestureCheckpointed;
    this.gestureCheckpointed = false;
    this.notify();
    return changed;
  }

  undo(): void {
    const prev = this.history.undo(this.doc);
    if (prev) {
      this.doc = prev;
      this.sanitizeSelection();
      this.notify();
    }
  }

  redo(): void {
    const next = this.history.redo(this.doc);
    if (next) {
      this.doc = next;
      this.sanitizeSelection();
      this.notify();
    }
  }

  addPhoto(photo: Photo, img: HTMLImageElement): void {
    this.photos.set(photo.id, photo);
    this.images.set(photo.id, img);
  }

  /** Drop selections that point at nodes which no longer exist. */
  sanitizeSelection(): void {
    const ids = new Set<string>();
    const visit = (n: Doc['tree']): void => {
      if (!n) return;
      ids.add(n.id);
      if (n.type === 'split') {
        visit(n.first);
        visit(n.second);
      }
    };
    visit(this.doc.tree);
    if (this.ui.selectedCellId && !ids.has(this.ui.selectedCellId)) this.ui.selectedCellId = null;
    if (this.ui.swapFromCellId && !ids.has(this.ui.swapFromCellId)) this.ui.swapFromCellId = null;
    if (this.ui.selectedFloatId && !this.doc.floats.some((f) => f.id === this.ui.selectedFloatId)) {
      this.ui.selectedFloatId = null;
    }
  }
}
