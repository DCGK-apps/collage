import { createDoc } from './doc';
import { readCustom } from './page';
import { sha256Hex } from './sha256';
import { createZip, readZip, type InflateRaw } from './zip';
import type { Doc, LayoutNode } from './types';

/**
 * Whole-collage files (`*.collage`): a ZIP archive with
 *
 *   project.json          – the document + list of photos
 *   photos/<sha256>.<ext> – each photo once, named by its content hash
 *
 * Paths in project.json are relative to the archive root, always with "/".
 * Nothing outside the archive is referenced, so a project can be copied,
 * mailed or opened on another device as a single file.
 */

export const PROJECT_TYPE = 'collage-project';
export const PROJECT_FILE_VERSION = 1;
export const PROJECT_EXT = '.collage';
export const PROJECT_JSON = 'project.json';

export interface ProjectPhotoAsset {
  id: string;
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
  /** Original file name, informational only. */
  name?: string;
}

export interface ProjectPhotoEntry {
  id: string;
  path: string;
  mime: string;
  width: number;
  height: number;
  name?: string;
}

export interface ProjectManifest {
  type: typeof PROJECT_TYPE;
  version: number;
  app: 'Collage';
  savedAt: string;
  doc: Doc;
  photos: ProjectPhotoEntry[];
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/svg+xml': 'svg',
};
const MIME_BY_EXT: Record<string, string> = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));

/** Only paths we write ourselves are accepted when reading (no "../", no absolute paths). */
const SAFE_PATH = /^photos\/[0-9a-f]{16,64}\.[a-z0-9]{2,5}$/;

export function photoPath(bytes: Uint8Array, mime: string): string {
  return `photos/${sha256Hex(bytes)}.${EXT[mime.split(';')[0]!.trim().toLowerCase()] ?? 'bin'}`;
}

/* ------------------------------------------------------------------ write */

/** Build the .collage archive. Identical photos are stored once. */
export function packProject(doc: Doc, assets: ProjectPhotoAsset[], now = new Date()): Uint8Array {
  const files = new Map<string, Uint8Array>();
  const photos: ProjectPhotoEntry[] = [];
  for (const a of assets) {
    const path = photoPath(a.bytes, a.mime);
    if (!files.has(path)) files.set(path, a.bytes);
    photos.push({ id: a.id, path, mime: a.mime, width: a.width, height: a.height, ...(a.name ? { name: a.name } : {}) });
  }
  const manifest: ProjectManifest = {
    type: PROJECT_TYPE,
    version: PROJECT_FILE_VERSION,
    app: 'Collage',
    savedAt: now.toISOString(),
    doc: structuredClone(doc),
    photos,
  };
  const json = new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n');
  return createZip([{ name: PROJECT_JSON, data: json }, ...[...files].map(([name, data]) => ({ name, data }))], now);
}

/* ------------------------------------------------------------------ read */

export class ProjectError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function validNode(n: unknown, depth = 0): n is LayoutNode {
  if (!isObj(n) || typeof n.id !== 'string' || depth > 200) return false;
  if (n.type === 'cell') return isObj(n.crop) && isNum(n.crop.zoom) && (n.photoId === null || typeof n.photoId === 'string');
  if (n.type === 'split')
    return (n.dir === 'v' || n.dir === 'h') && isNum(n.ratio) && validNode(n.first, depth + 1) && validNode(n.second, depth + 1);
  return false;
}

function walk(n: LayoutNode | null, fn: (n: LayoutNode) => void): void {
  if (!n) return;
  fn(n);
  if (n.type === 'split') {
    walk(n.first, fn);
    walk(n.second, fn);
  }
}

/**
 * Validate a document from a file. References to photos that are not
 * available are dropped (cells become empty, layers disappear).
 */
export function sanitizeProjectDoc(raw: unknown, available: Set<string>): Doc {
  if (!isObj(raw) || !isObj(raw.style) || !Array.isArray(raw.floats) || !Array.isArray(raw.library)) {
    throw new ProjectError('Nieprawidłowy projekt');
  }
  if (raw.tree !== null && !validNode(raw.tree)) throw new ProjectError('Nieprawidłowy układ w projekcie');
  const base = createDoc();
  const s = raw.style;
  const doc: Doc = {
    formatId: typeof raw.formatId === 'string' ? raw.formatId : base.formatId,
    ...(readCustom(raw.customMm) ? { customMm: readCustom(raw.customMm) } : {}),
    orientation: raw.orientation === 'landscape' ? 'landscape' : 'portrait',
    style: {
      gapMm: isNum(s.gapMm) ? s.gapMm : base.style.gapMm,
      radiusMm: isNum(s.radiusMm) ? s.radiusMm : base.style.radiusMm,
      background: typeof s.background === 'string' ? s.background : base.style.background,
    },
    tree: structuredClone(raw.tree as LayoutNode | null),
    floats: (structuredClone(raw.floats) as Doc['floats']).filter(
      (f) => isObj(f) && typeof f.photoId === 'string' && available.has(f.photoId) && isNum(f.cx) && isNum(f.cy) && isNum(f.size),
    ),
    library: (raw.library as unknown[]).filter((id): id is string => typeof id === 'string' && available.has(id)),
  };
  walk(doc.tree, (n) => {
    if (n.type === 'cell' && n.photoId && !available.has(n.photoId)) n.photoId = null;
  });
  return doc;
}

export interface OpenedProject {
  doc: Doc;
  photos: ProjectPhotoAsset[];
  /** Photos listed in project.json but missing or unreadable in the archive. */
  missing: number;
}

/** Open a .collage archive. Throws ProjectError with a user-facing message. */
export async function unpackProject(bytes: Uint8Array, inflate?: InflateRaw): Promise<OpenedProject> {
  let files: Map<string, Uint8Array>;
  try {
    files = await readZip(bytes, inflate);
  } catch (e) {
    throw new ProjectError(e instanceof Error ? e.message : 'Nie udało się otworzyć pliku');
  }
  const jsonBytes = files.get(PROJECT_JSON);
  if (!jsonBytes) throw new ProjectError('W pliku brakuje project.json – to nie jest projekt Collage');
  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder().decode(jsonBytes));
  } catch {
    throw new ProjectError('Uszkodzony project.json');
  }
  if (!isObj(manifest) || manifest.type !== PROJECT_TYPE) throw new ProjectError('To nie jest projekt Collage');
  if (manifest.version !== PROJECT_FILE_VERSION) throw new ProjectError('Projekt zapisany w nowszej wersji aplikacji');
  if (!Array.isArray(manifest.photos)) throw new ProjectError('Nieprawidłowy projekt');

  const photos: ProjectPhotoAsset[] = [];
  let missing = 0;
  for (const p of manifest.photos) {
    if (!isObj(p) || typeof p.id !== 'string' || typeof p.path !== 'string' || !SAFE_PATH.test(p.path)) {
      missing++;
      continue;
    }
    const data = files.get(p.path);
    if (!data || sha256Hex(data) !== p.path.slice('photos/'.length, p.path.lastIndexOf('.'))) {
      missing++; // absent, or content does not match its hash
      continue;
    }
    const ext = p.path.split('.').pop()!;
    photos.push({
      id: p.id,
      bytes: data,
      mime: MIME_BY_EXT[ext] ?? (typeof p.mime === 'string' ? p.mime : 'application/octet-stream'),
      width: isNum(p.width) ? p.width : 0,
      height: isNum(p.height) ? p.height : 0,
      ...(typeof p.name === 'string' ? { name: p.name.slice(0, 200) } : {}),
    });
  }
  const doc = sanitizeProjectDoc(manifest.doc, new Set(photos.map((p) => p.id)));
  return { doc, photos, missing };
}

/** Default file name, e.g. "kolaz-2026-11-04.collage". */
export function projectFileName(now = new Date()): string {
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `kolaz-${d}${PROJECT_EXT}`;
}
