import { clamp } from './geometry';
import type { Crop } from './types';

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;

export interface CoverPlacement {
  /** Size of the *unrotated* image as drawn. */
  drawW: number;
  drawH: number;
  /** Offset of the image centre from the cell centre. */
  offsetX: number;
  offsetY: number;
  /** Maximum pan offset in each axis (half of the overflow). */
  maxPanX: number;
  maxPanY: number;
}

/**
 * "object-fit: cover" with zoom, pan and 90° rotations. The image always
 * covers the whole cell – pan is expressed as a fraction (-1..1) of the
 * overflow, so it survives cell resizes and any export resolution.
 */
export function coverPlacement(imgW: number, imgH: number, cellW: number, cellH: number, crop: Crop): CoverPlacement {
  const rotated = crop.rotate % 180 !== 0;
  const effW = rotated ? imgH : imgW;
  const effH = rotated ? imgW : imgH;
  if (effW <= 0 || effH <= 0 || cellW <= 0 || cellH <= 0) {
    return { drawW: 0, drawH: 0, offsetX: 0, offsetY: 0, maxPanX: 0, maxPanY: 0 };
  }
  const zoom = clamp(crop.zoom, MIN_ZOOM, MAX_ZOOM);
  const scale = Math.max(cellW / effW, cellH / effH) * zoom;
  const visW = effW * scale;
  const visH = effH * scale;
  const maxPanX = Math.max(0, (visW - cellW) / 2);
  const maxPanY = Math.max(0, (visH - cellH) / 2);
  return {
    drawW: imgW * scale,
    drawH: imgH * scale,
    offsetX: clamp(crop.panX, -1, 1) * maxPanX,
    offsetY: clamp(crop.panY, -1, 1) * maxPanY,
    maxPanX,
    maxPanY,
  };
}

/** Pan by a delta in the same units as the cell size. Returns a new crop. */
export function panBy(crop: Crop, dx: number, dy: number, placement: CoverPlacement): Crop {
  const panX = placement.maxPanX > 0 ? clamp(crop.panX + dx / placement.maxPanX, -1, 1) : 0;
  const panY = placement.maxPanY > 0 ? clamp(crop.panY + dy / placement.maxPanY, -1, 1) : 0;
  return { ...crop, panX, panY };
}

/**
 * Zoom while keeping the point under (fx, fy) – relative to the cell centre –
 * fixed on screen.
 */
export function zoomAt(
  crop: Crop,
  newZoom: number,
  fx: number,
  fy: number,
  imgW: number,
  imgH: number,
  cellW: number,
  cellH: number,
): Crop {
  const zoom = clamp(newZoom, MIN_ZOOM, MAX_ZOOM);
  const before = coverPlacement(imgW, imgH, cellW, cellH, crop);
  const k = zoom / clamp(crop.zoom, MIN_ZOOM, MAX_ZOOM);
  // Image point under the focus stays put: newOffset = f - (f - oldOffset) * k
  const ox = fx - (fx - before.offsetX) * k;
  const oy = fy - (fy - before.offsetY) * k;
  const after = coverPlacement(imgW, imgH, cellW, cellH, { ...crop, zoom, panX: 0, panY: 0 });
  return {
    ...crop,
    zoom,
    panX: after.maxPanX > 0 ? clamp(ox / after.maxPanX, -1, 1) : 0,
    panY: after.maxPanY > 0 ? clamp(oy / after.maxPanY, -1, 1) : 0,
  };
}

export function rotateCrop(crop: Crop): Crop {
  return { ...crop, rotate: (((crop.rotate + 90) % 360) as Crop['rotate']), panX: 0, panY: 0 };
}
