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

export function getFormat(id: string): PageFormat {
  return FORMATS.find((f) => f.id === id) ?? FORMATS[0]!;
}

export function pageSizeMm(formatId: string, orientation: Orientation): Size {
  const f = getFormat(formatId);
  const w = Math.min(f.widthMm, f.heightMm);
  const h = Math.max(f.widthMm, f.heightMm);
  return orientation === 'portrait' ? { w, h } : { w: h, h: w };
}

export function docPageSize(doc: Doc): Size {
  return pageSizeMm(doc.formatId, doc.orientation);
}

/** Pixel size of the page at the given DPI (rounded like print drivers do). */
export function pageSizePx(size: Size, dpi: number): Size {
  return { w: Math.round((size.w / 25.4) * dpi), h: Math.round((size.h / 25.4) * dpi) };
}

/** Fit a page into an available box, returning px-per-mm scale. */
export function fitScale(page: Size, availW: number, availH: number): number {
  if (page.w <= 0 || page.h <= 0 || availW <= 0 || availH <= 0) return 1;
  return Math.min(availW / page.w, availH / page.h);
}
