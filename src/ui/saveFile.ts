import { loadPref, savePref } from '../store';
import { downloadBlob } from './export';

/**
 * Saving files with a "Save as" dialog where the browser supports it
 * (File System Access API – desktop Chrome, Edge, Opera, Brave).
 *
 * A web page cannot choose the download folder, but the save dialog can:
 * the user picks a folder once and the browser reopens the dialog there next
 * time (it remembers the last folder per `id`). Elsewhere the file is shared
 * (phones) or downloaded to the browser's download folder, as before.
 */

/** Which folder the browser remembers: collages (images, PDF, projects) or templates. */
export type SaveKind = 'collage' | 'template';

export interface SaveResult {
  /** 'saved' – written where the user chose; 'downloaded'/'shared' – fallback; 'cancelled' – dialog closed. */
  how: 'saved' | 'downloaded' | 'shared' | 'cancelled';
  /** The file name actually used (the user may rename it in the dialog). */
  name: string;
}

const PREF = 'askWhereToSave';

const FOLDER_ID: Record<SaveKind, string> = { collage: 'collage-kolaze', template: 'collage-szablony' };

const TYPES: Record<string, { description: string; accept: Record<string, string[]> }> = {
  png: { description: 'Obraz PNG', accept: { 'image/png': ['.png'] } },
  jpg: { description: 'Obraz JPEG', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } },
  pdf: { description: 'Dokument PDF', accept: { 'application/pdf': ['.pdf'] } },
  collage: { description: 'Projekt kolażu', accept: { 'application/zip': ['.collage'] } },
  json: { description: 'Szablony kolaży', accept: { 'application/json': ['.json'] } },
};

interface Writable {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}
interface FileHandle {
  name: string;
  createWritable(): Promise<Writable>;
  remove?(): Promise<void>;
}
type Picker = (opts: {
  id?: string;
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
  excludeAcceptAllOption?: boolean;
}) => Promise<FileHandle>;

function picker(): Picker | null {
  const p = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker;
  return typeof p === 'function' ? p.bind(window) : null;
}

/** The browser can show a "Save as" dialog that remembers the folder. */
export function canAskWhereToSave(): boolean {
  return picker() !== null;
}

/** User setting: ask where to save (default on where supported). */
export function askWhereToSave(): boolean {
  return canAskWhereToSave() && loadPref(PREF, true);
}

export function setAskWhereToSave(on: boolean): void {
  savePref(PREF, on);
}

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

/**
 * Save a file. `make` builds the contents; it runs after the dialog closes,
 * because the dialog must open straight from the click (browsers refuse it
 * once a long export has used up the click's permission).
 */
export async function saveFile(
  name: string,
  kind: SaveKind,
  make: () => Blob | Promise<Blob>,
  opts: { share?: boolean } = {},
): Promise<SaveResult> {
  const show = askWhereToSave() ? picker() : null;
  if (show) {
    let handle: FileHandle | null = null;
    try {
      const type = TYPES[name.split('.').pop()!.toLowerCase()];
      handle = await show({ id: FOLDER_ID[kind], suggestedName: name, ...(type ? { types: [type] } : {}) });
    } catch (err) {
      if (isAbort(err)) return { how: 'cancelled', name };
      // Not allowed here (e.g. inside a frame) – fall back to a normal download below.
      console.warn('Save dialog unavailable, downloading instead', err);
    }
    if (handle) {
      try {
        const blob = await make();
        const out = await handle.createWritable();
        await out.write(blob);
        await out.close();
        return { how: 'saved', name: handle.name };
      } catch (err) {
        // Don't leave an empty file behind.
        await handle.remove?.().catch(() => undefined);
        throw err;
      }
    }
  }

  const blob = await make();
  if (opts.share && window.matchMedia?.('(pointer: coarse)').matches) {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return { how: 'shared', name };
      } catch {
        /* cancelled or unsupported – fall back to download */
      }
    }
  }
  downloadBlob(blob, name);
  return { how: 'downloaded', name };
}
