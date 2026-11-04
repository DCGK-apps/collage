import type { Doc, Orientation, Size } from './types';

export interface PageFormat {
  id: string;
  label: string;
  /** Portrait dimensions in millimetres (w <= h). */
  widthMm: number;
  heightMm: number;
  /** True for real paper formats (offers PDF / print at physical size). */
  print: boolean;
}

export const FORMATS: readonly PageFormat[] = [
  { id: 'a4', label: 'A4', widthMm: 210, heightMm: 297, print: true },
  { id: 'a3', label: 'A3', widthMm: 297, heightMm: 420, print: true },
  { id: 'a5', label: 'A5', widthMm: 148, heightMm: 210, print: true },
  { id: 'photo10x15', label: '10×15', widthMm: 100, heightMm: 150, print: true },
  { id: 'photo13x18', label: '13×18', widthMm: 130, heightMm: 180, print: true },
  { id: 'square', label: '1:1', widthMm: 200, heightMm: 200, print: false },
  { id: 'insta', label: '4:5', widthMm: 200, heightMm: 250, print: false },
  { id: 'story', label: '9:16', widthMm: 180, heightMm: 320, print: false },
];

export const DEFAULT_FORMAT_ID = 'a4';

/** User-defined page size; the dimensions live in `Doc.customMm`. */
export const CUSTOM_FORMAT_ID = 'custom';
export const CUSTOM_MIN_MM = 10;
export const CUSTOM_MAX_MM = 2000;
export const DEFAULT_CUSTOM_MM: Size = { w: 200, h: 300 };

export function getFormat(id: string, custom?: Size): PageFormat {
  if (id === CUSTOM_FORMAT_ID) {
    const c = normalizeCustom(custom ?? DEFAULT_CUSTOM_MM);
    return { id, label: 'Własny', widthMm: c.w, heightMm: c.h, print: true };
  }
  return FORMATS.find((f) => f.id === id) ?? FORMATS[0]!;
}

/** Clamp to sane limits, round to 0.01 mm and order as portrait (w <= h). */
export function normalizeCustom(s: Size): Size {
  const fix = (v: number) =>
    Math.round(Math.min(CUSTOM_MAX_MM, Math.max(CUSTOM_MIN_MM, Number.isFinite(v) ? v : CUSTOM_MIN_MM)) * 100) / 100;
  const a = fix(s.w);
  const b = fix(s.h);
  return { w: Math.min(a, b), h: Math.max(a, b) };
}

/** Validate a stored custom size; undefined when it is not usable. */
export function readCustom(raw: unknown): Size | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { w, h } = raw as Record<string, unknown>;
  if (typeof w !== 'number' || typeof h !== 'number' || !Number.isFinite(w) || !Number.isFinite(h)) return undefined;
  return normalizeCustom({ w, h });
}

export function pageSizeMm(formatId: string, orientation: Orientation, custom?: Size): Size {
  const f = getFormat(formatId, custom);
  const w = Math.min(f.widthMm, f.heightMm);
  const h = Math.max(f.widthMm, f.heightMm);
  return orientation === 'portrait' ? { w, h } : { w: h, h: w };
}

export function docPageSize(doc: Doc): Size {
  return pageSizeMm(doc.formatId, doc.orientation, doc.customMm);
}

export function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

export function pxToMm(px: number, dpi: number): number {
  return (px / dpi) * 25.4;
}

/** Pixel size of the page at the given DPI (rounded like print drivers do). */
export function pageSizePx(size: Size, dpi: number): Size {
  return { w: mmToPx(size.w, dpi), h: mmToPx(size.h, dpi) };
}

/** Fit a page into an available box, returning px-per-mm scale. */
export function fitScale(page: Size, availW: number, availH: number): number {
  if (page.w <= 0 || page.h <= 0 || availW <= 0 || availH <= 0) return 1;
  return Math.min(availW / page.w, availH / page.h);
}
