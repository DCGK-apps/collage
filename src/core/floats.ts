import { clamp } from './geometry';
import { uid } from './ids';
import type { FloatLayer, Photo, Size } from './types';

export const MIN_FLOAT_MM = 15;
/** Width of the optional white frame, as a fraction of the shorter photo side. */
export const FRAME_FRACTION = 0.05;

export interface FloatBox {
  /** Centre and size of the photo itself (frame excluded), mm. */
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** Frame thickness in mm (0 when no frame). */
  frame: number;
  rotation: number;
}

export function photoAspect(p: Photo | undefined): number {
  return p && p.width > 0 && p.height > 0 ? p.width / p.height : 1;
}

export function floatBox(f: FloatLayer, photo: Photo | undefined, page: Size): FloatBox {
  const w = f.size * page.w;
  const h = w / photoAspect(photo);
  return {
    cx: f.cx * page.w,
    cy: f.cy * page.h,
    w,
    h,
    frame: f.frame ? Math.min(w, h) * FRAME_FRACTION : 0,
    rotation: f.rotation,
  };
}

/** Size limits (fraction of page width) so a float is never tiny nor much larger than the page. */
export function sizeLimits(photo: Photo | undefined, page: Size): [number, number] {
  const a = photoAspect(photo);
  const minW = Math.max(MIN_FLOAT_MM, MIN_FLOAT_MM * a);
  const maxW = Math.min(page.w * 1.5, page.h * 1.5 * a);
  return [minW / page.w, Math.max(minW, maxW) / page.w];
}

/** Create a new float layer centred on the page (staggered when several are added). */
export function createFloat(photo: Photo, page: Size, existing: number): FloatLayer {
  const a = photoAspect(photo);
  // ~45% of the shorter page side on the longer photo side.
  const target = Math.min(page.w, page.h) * 0.45;
  const wMm = a >= 1 ? target : target * a;
  const step = (existing % 6) * 0.04;
  const [lo, hi] = sizeLimits(photo, page);
  return {
    id: uid('f'),
    photoId: photo.id,
    cx: clamp(0.5 + step, 0.1, 0.9),
    cy: clamp(0.5 + step, 0.1, 0.9),
    size: clamp(wMm / page.w, lo, hi),
    rotation: 0,
    frame: true,
    shadow: true,
  };
}

/** Keep the centre on the page so a float can never be lost off-canvas. */
export function moveFloat(f: FloatLayer, dxMm: number, dyMm: number, page: Size): void {
  f.cx = clamp(f.cx + dxMm / page.w, 0, 1);
  f.cy = clamp(f.cy + dyMm / page.h, 0, 1);
}

export function setFloatSize(f: FloatLayer, size: number, photo: Photo | undefined, page: Size): void {
  const [lo, hi] = sizeLimits(photo, page);
  f.size = clamp(size, lo, hi);
}

export function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}

/** Rotation with a gentle snap to multiples of 90° (within `snap` degrees). */
export function snapAngle(deg: number, snap = 4): number {
  const a = normalizeAngle(deg);
  const nearest = Math.round(a / 90) * 90;
  return Math.abs(a - nearest) <= snap ? normalizeAngle(nearest) : a;
}

export type ZMove = 'front' | 'back' | 'up' | 'down';

/** Change z-order. Returns a new array; the input is not modified. */
export function reorder(floats: FloatLayer[], id: string, move: ZMove): FloatLayer[] {
  const i = floats.findIndex((f) => f.id === id);
  if (i < 0) return floats;
  const out = floats.slice();
  const [item] = out.splice(i, 1);
  let j = i;
  if (move === 'front') j = out.length;
  else if (move === 'back') j = 0;
  else if (move === 'up') j = Math.min(out.length, i + 1);
  else j = Math.max(0, i - 1);
  out.splice(j, 0, item!);
  return out;
}

/** Point-in-rotated-rect test (page mm), used for hit testing in tests and export. */
export function hitFloat(box: FloatBox, x: number, y: number): boolean {
  const r = (-box.rotation * Math.PI) / 180;
  const dx = x - box.cx;
  const dy = y - box.cy;
  const lx = dx * Math.cos(r) - dy * Math.sin(r);
  const ly = dx * Math.sin(r) + dy * Math.cos(r);
  return Math.abs(lx) <= box.w / 2 + box.frame && Math.abs(ly) <= box.h / 2 + box.frame;
}
